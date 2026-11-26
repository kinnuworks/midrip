//! Mid-Rip: open a card pack on a MagicBlock private rollup, and sell or buy the
//! still-sealed rest of the pack on a price clock that falls every rollup slot.
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, EphemeralPermission, PERMISSION_SEED};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral, vrf};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;
use ephemeral_rollups_sdk::vrf::{
    self,
    consts::program_identity_pubkey,
    instructions::{create_request_randomness_ix_const, RequestRandomnessParams},
    types::SerializableAccountMeta,
};

pub mod logic;
use logic::*;

declare_id!("DAthUNW8m79QheY2oNPq42ab99hCcavp1BVXDrmAHgYM");

const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);

pub const CONFIG_SEED: &[u8] = b"config";
/// v2 player layout (adds `withdrawn`); the seed changed with it so old accounts are never misread.
pub const PLAYER_SEED: &[u8] = b"player2";
pub const MINT_SEED: &[u8] = b"card-mint";
pub const MINT_AUTH_SEED: &[u8] = b"mint-auth";
pub const CLAIM_SEED: &[u8] = b"claim";
pub const DELEGATION_PROGRAM: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");
pub const TABLE_SEED: &[u8] = b"table";
pub const SEALED_SEED: &[u8] = b"sealed";
pub const NOT_REVEALED: u8 = 255;
/// If the VRF callback never lands, the buyer can be refunded after this many rollup slots.
pub const DRAW_TIMEOUT_SLOTS: u64 = 30_000;
/// A pack untouched this long (about 10 minutes of rollup blocks) can be closed by anyone.
pub const STALE_SLOTS: u64 = 60_000;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum TableState {
    Idle = 0,
    Drawing = 1,
    Ripping = 2,
    Listed = 3,
    Done = 4,
}

#[ephemeral]
#[program]
pub mod midrip {
    use super::*;

    // ---------- base layer ----------

    pub fn init_config(ctx: Context<InitConfig>, args: ConfigArgs) -> Result<()> {
        require!(args.payout_bps > 0 && args.payout_bps <= 10_000, MidripError::BadConfig);
        require!(args.floor_bps < args.start_bps, MidripError::BadConfig);
        require!(args.listing_slots > 0, MidripError::BadConfig);
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.base_weights = args.base_weights;
        c.base_values = args.base_values;
        c.hit_weights = args.hit_weights;
        c.hit_values = args.hit_values;
        c.ev_base_milli = ev_milli(&args.base_weights, &args.base_values);
        c.ev_hit_milli = ev_milli(&args.hit_weights, &args.hit_values);
        c.payout_bps = args.payout_bps;
        c.pack_price = pack_price(c.ev_base_milli, c.ev_hit_milli, args.payout_bps as u64);
        c.start_bps = args.start_bps;
        c.floor_bps = args.floor_bps;
        c.listing_slots = args.listing_slots;
        c.grace_slots = args.grace_slots;
        c.starting_chips = args.starting_chips;
        c.bump = ctx.bumps.config;
        msg!("config: pack_price={} ev_base_milli={} ev_hit_milli={}", c.pack_price, c.ev_base_milli, c.ev_hit_milli);
        Ok(())
    }

    pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
        let p = &mut ctx.accounts.player;
        if p.wallet == Pubkey::default() {
            p.wallet = ctx.accounts.wallet.key();
            p.chips = ctx.accounts.config.starting_chips;
            p.bump = ctx.bumps.player;
        }
        Ok(())
    }

    pub fn delegate_player(ctx: Context<DelegatePlayer>) -> Result<()> {
        let wallet = ctx.accounts.wallet.key();
        ctx.accounts.delegate_player(
            &ctx.accounts.wallet,
            &[PLAYER_SEED, wallet.as_ref()],
            DelegateConfig {
                validator: ctx.accounts.validator.as_ref().map(|v| v.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn init_table(ctx: Context<InitTable>, id: u8) -> Result<()> {
        // Pre-fund the sealed account for the private permission's rent on the rollup.
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: ctx.accounts.sealed.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(0) as u32),
        )?;
        let t = &mut ctx.accounts.table;
        t.id = id;
        t.state = TableState::Idle as u8;
        t.revealed = [NOT_REVEALED; PACK_SIZE];
        t.bump = ctx.bumps.table;
        let s = &mut ctx.accounts.sealed;
        s.id = id;
        s.bump = ctx.bumps.sealed;
        Ok(())
    }

    pub fn delegate_table(ctx: Context<DelegateTable>, id: u8) -> Result<()> {
        let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
        ctx.accounts.delegate_table(
            &ctx.accounts.admin,
            &[TABLE_SEED, &[id]],
            DelegateConfig { validator, ..Default::default() },
        )?;
        ctx.accounts.delegate_sealed(
            &ctx.accounts.admin,
            &[SEALED_SEED, &[id]],
            DelegateConfig { validator, ..Default::default() },
        )?;
        Ok(())
    }

    /// One SPL mint per rarity, minted only by this program.
    pub fn init_mint(ctx: Context<InitMint>, tier: u8) -> Result<()> {
        require!((tier as usize) < NUM_TIERS, MidripError::BadConfig);
        msg!("mint tier={} {}", tier, ctx.accounts.mint.key());
        Ok(())
    }

    /// Mint the cards a player has withdrawn (as last committed to Solana) and not yet claimed.
    pub fn claim_cards(ctx: Context<ClaimCards>, tier: u8) -> Result<()> {
        let t = tier as usize;
        require!(t < NUM_TIERS, MidripError::BadConfig);
        let info = &ctx.accounts.player;
        require!(info.owner == &crate::ID || info.owner == &DELEGATION_PROGRAM, MidripError::BadAccount);
        let data = info.try_borrow_data()?;
        let player = Player::try_deserialize(&mut &data[..])?;
        drop(data);
        require_keys_eq!(player.wallet, ctx.accounts.wallet.key(), MidripError::BadAccount);
        let claim = &mut ctx.accounts.claim;
        claim.wallet = player.wallet;
        let owed = player.withdrawn[t].saturating_sub(claim.claimed[t]);
        require!(owed > 0, MidripError::NotEnoughCards);
        claim.claimed[t] = player.withdrawn[t];
        let bump = ctx.bumps.mint_auth;
        let seeds: &[&[u8]] = &[MINT_AUTH_SEED, &[bump]];
        anchor_spl::token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.token_account.to_account_info(),
                    authority: ctx.accounts.mint_auth.to_account_info(),
                },
                &[seeds],
            ),
            owed as u64,
        )?;
        msg!("claim tier={} minted={} to={}", tier, owed, ctx.accounts.wallet.key());
        Ok(())
    }

    // ---------- private rollup ----------

    /// Make the sealed account private with no readers. Idempotent.
    pub fn create_sealed_permission(ctx: Context<SealedPermission>) -> Result<()> {
        if ctx.accounts.permission.owner == &PERMISSION_PROGRAM_ID && !ctx.accounts.permission.data_is_empty() {
            return Ok(());
        }
        let id = ctx.accounts.sealed.id;
        let bump = ctx.accounts.sealed.bump;
        let seeds: &[&[u8]] = &[SEALED_SEED, &[id], &[bump]];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.sealed.to_account_info(),
            permissioned_account: ctx.accounts.sealed.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: true, members: vec![] },
        }
        .invoke_signed(&[seeds])?;
        msg!("sealed {} is private", id);
        Ok(())
    }

    /// Pay for a pack and ask MagicBlock VRF for its randomness before anything is shown.
    pub fn open_pack(ctx: Context<OpenPack>, client_seed: u8) -> Result<()> {
        let config = &ctx.accounts.config;
        let table = &mut ctx.accounts.table;
        let st = table.state;
        require!(st == TableState::Idle as u8 || st == TableState::Done as u8, MidripError::TableBusy);
        let player = &mut ctx.accounts.player;
        require!(player.chips >= config.pack_price, MidripError::NotEnoughChips);
        player.chips -= config.pack_price;
        player.packs_opened = player.packs_opened.saturating_add(1);

        let slot = Clock::get()?.slot;
        table.nonce = table.nonce.saturating_add(1);
        table.state = TableState::Drawing as u8;
        table.opener = player.wallet;
        table.holder = player.wallet;
        table.price_paid = config.pack_price;
        table.revealed = [NOT_REVEALED; PACK_SIZE];
        table.revealed_count = 0;
        table.hit_revealed = false;
        table.commitment = [0; 32];
        table.randomness = [0; 32];
        table.opened_slot = slot;
        table.sales_count = 0;
        table.last_sale = Sale::default();
        table.listing = Listing::default();

        let params = RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: instruction::CallbackDraw::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed; 32],
            accounts_metas: Some(vec![
                SerializableAccountMeta { pubkey: table.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: ctx.accounts.sealed.key(), is_signer: false, is_writable: true },
                SerializableAccountMeta { pubkey: config.key(), is_signer: false, is_writable: false },
            ]),
            ..Default::default()
        };
        let ix = create_request_randomness_ix_const(params, PROGRAM_IDENTITY);
        ctx.accounts.invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        msg!("open_pack table={} nonce={} slot={} price={}", ctx.accounts.table.id, ctx.accounts.table.nonce, slot, ctx.accounts.config.pack_price);
        Ok(())
    }

    /// VRF callback: draw the pack into the private sealed account and publish only a commitment.
    pub fn callback_draw(ctx: Context<CallbackDraw>, randomness: [u8; 32]) -> Result<()> {
        let config = &ctx.accounts.config;
        let table = &mut ctx.accounts.table;
        require!(table.state == TableState::Drawing as u8, MidripError::WrongState);
        let (tiers, hit_pos) = draw_pack(&randomness, &config.base_weights, &config.hit_weights);
        let sealed = &mut ctx.accounts.sealed;
        sealed.nonce = table.nonce;
        sealed.tiers = tiers;
        sealed.hit_pos = hit_pos;
        sealed.randomness = randomness;
        table.commitment = commitment(&randomness, &tiers, table.nonce);
        table.state = TableState::Ripping as u8;
        table.revealed_count = 0;
        // No card data or randomness in logs: only the commitment is public.
        msg!("drawn table={} nonce={} slot={}", table.id, table.nonce, Clock::get()?.slot);
        Ok(())
    }

    /// The holder reveals the next sealed card; the card goes to whoever holds the pack now.
    pub fn reveal(ctx: Context<Reveal>) -> Result<()> {
        let config = &ctx.accounts.config;
        let table = &mut ctx.accounts.table;
        require!(table.state == TableState::Ripping as u8, MidripError::WrongState);
        require_keys_eq!(table.holder, ctx.accounts.holder.key(), MidripError::NotHolder);
        let sealed = &ctx.accounts.sealed;
        require!(sealed.nonce == table.nonce, MidripError::WrongState);
        let idx = table.revealed_count as usize;
        require!(idx < PACK_SIZE, MidripError::WrongState);
        let tier = sealed.tiers[idx];
        table.revealed[idx] = tier;
        table.revealed_count += 1;
        if idx as u8 == sealed.hit_pos {
            table.hit_revealed = true;
        }
        let player = &mut ctx.accounts.holder_player;
        player.cards[tier as usize] = player.cards[tier as usize].saturating_add(1);
        let value = card_value(config, tier);
        let slot = Clock::get()?.slot;
        if table.revealed_count as usize == PACK_SIZE {
            table.randomness = sealed.randomness;
            table.state = TableState::Done as u8;
        }
        msg!("reveal table={} nonce={} pos={} tier={} value={} slot={}", table.id, table.nonce, idx, tier, value, slot);
        Ok(())
    }

    /// The holder puts the still-sealed rest on a falling price clock.
    pub fn list_rest(ctx: Context<HolderAction>) -> Result<()> {
        let config = &ctx.accounts.config;
        let table = &mut ctx.accounts.table;
        require!(table.state == TableState::Ripping as u8, MidripError::WrongState);
        require_keys_eq!(table.holder, ctx.accounts.holder.key(), MidripError::NotHolder);
        let left = (PACK_SIZE as u8).saturating_sub(table.revealed_count);
        require!(left > 0, MidripError::NothingLeft);
        let ev = ev_rest_milli(left, table.hit_revealed, config.ev_base_milli, config.ev_hit_milli);
        let slot = Clock::get()?.slot;
        let start = bps_of(ev, config.start_bps as u64);
        let floor = bps_of(ev, config.floor_bps as u64);
        table.listing = Listing {
            list_slot: slot,
            start_price: start,
            floor_price: floor,
            duration_slots: config.listing_slots,
            end_slot: slot + config.listing_slots + config.grace_slots,
            ev_rest_milli: ev,
            cards_left: left,
        };
        table.state = TableState::Listed as u8;
        msg!("list table={} nonce={} left={} ev_milli={} start={} floor={} slot={} end_slot={}", table.id, table.nonce, left, ev, start, floor, slot, table.listing.end_slot);
        Ok(())
    }

    /// Any other player buys the sealed rest at the clock price of the current slot.
    pub fn buy_rest(ctx: Context<BuyRest>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(table.state == TableState::Listed as u8, MidripError::WrongState);
        require_keys_eq!(table.holder, ctx.accounts.seller_player.wallet, MidripError::NotHolder);
        require_keys_neq!(ctx.accounts.buyer.key(), table.holder, MidripError::SelfBuy);
        let slot = Clock::get()?.slot;
        let l = table.listing;
        require!(slot <= l.end_slot, MidripError::ListingExpired);
        let price = clock_price(l.start_price, l.floor_price, l.list_slot, l.duration_slots, slot);
        let buyer = &mut ctx.accounts.buyer_player;
        require!(buyer.chips >= price, MidripError::NotEnoughChips);
        buyer.chips -= price;
        let seller = &mut ctx.accounts.seller_player;
        seller.chips = seller.chips.saturating_add(price);
        let from = table.holder;
        table.holder = buyer.wallet;
        table.state = TableState::Ripping as u8;
        table.sales_count = table.sales_count.saturating_add(1);
        table.last_sale = Sale { price, slot, list_slot: l.list_slot, from, to: buyer.wallet, cards_left: l.cards_left };
        msg!("buy table={} nonce={} price={} slot={} list_slot={} slots_after_list={} from={} to={}", table.id, table.nonce, price, slot, l.list_slot, slot - l.list_slot, from, buyer.wallet);
        Ok(())
    }

    pub fn cancel_listing(ctx: Context<HolderAction>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(table.state == TableState::Listed as u8, MidripError::WrongState);
        require_keys_eq!(table.holder, ctx.accounts.holder.key(), MidripError::NotHolder);
        table.state = TableState::Ripping as u8;
        msg!("cancel table={} slot={}", table.id, Clock::get()?.slot);
        Ok(())
    }

    /// Anyone can close a listing whose clock ran out unsold; the holder keeps ripping.
    pub fn expire_listing(ctx: Context<TableOnly>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(table.state == TableState::Listed as u8, MidripError::WrongState);
        let slot = Clock::get()?.slot;
        require!(slot > table.listing.end_slot, MidripError::ListingActive);
        table.state = TableState::Ripping as u8;
        msg!("expire table={} slot={}", table.id, slot);
        Ok(())
    }

    /// If the VRF callback never arrives, refund the opener and free the table.
    pub fn refund_stuck(ctx: Context<RefundStuck>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        require!(table.state == TableState::Drawing as u8, MidripError::WrongState);
        let slot = Clock::get()?.slot;
        require!(slot > table.opened_slot + DRAW_TIMEOUT_SLOTS, MidripError::ListingActive);
        require_keys_eq!(table.opener, ctx.accounts.opener_player.wallet, MidripError::NotHolder);
        let p = &mut ctx.accounts.opener_player;
        p.chips = p.chips.saturating_add(table.price_paid);
        table.state = TableState::Idle as u8;
        msg!("refund table={} nonce={} slot={}", table.id, table.nonce, slot);
        Ok(())
    }

    /// Anyone can close a pack whose holder walked away. The unrevealed cards are forfeited, and the
    /// randomness is published so the whole pack can still be checked against its commitment.
    pub fn abandon_stale(ctx: Context<AbandonStale>) -> Result<()> {
        let table = &mut ctx.accounts.table;
        let st = table.state;
        require!(st == TableState::Ripping as u8 || st == TableState::Listed as u8, MidripError::WrongState);
        let slot = Clock::get()?.slot;
        let last = table.opened_slot.max(table.listing.list_slot).max(table.last_sale.slot);
        require!(slot > last + STALE_SLOTS, MidripError::ListingActive);
        let sealed = &ctx.accounts.sealed;
        require!(sealed.nonce == table.nonce, MidripError::WrongState);
        table.randomness = sealed.randomness;
        table.state = TableState::Done as u8;
        msg!("abandon table={} nonce={} revealed={} slot={}", table.id, table.nonce, table.revealed_count, slot);
        Ok(())
    }

    /// Take cards out of play so they can be claimed as SPL tokens on Solana after the next settle.
    pub fn withdraw_cards(ctx: Context<SellCards>, tier: u8, count: u32) -> Result<()> {
        require!((tier as usize) < NUM_TIERS && count > 0, MidripError::BadConfig);
        let p = &mut ctx.accounts.player;
        require!(p.cards[tier as usize] >= count, MidripError::NotEnoughCards);
        p.cards[tier as usize] -= count;
        p.withdrawn[tier as usize] = p.withdrawn[tier as usize].saturating_add(count);
        msg!("withdraw tier={} count={} slot={}", tier, count, Clock::get()?.slot);
        Ok(())
    }

    /// Sell cards back at 100% of their published table value.
    pub fn sell_cards(ctx: Context<SellCards>, tier: u8, count: u32) -> Result<()> {
        require!((tier as usize) < NUM_TIERS && count > 0, MidripError::BadConfig);
        let value = card_value(&ctx.accounts.config, tier);
        let p = &mut ctx.accounts.player;
        require!(p.cards[tier as usize] >= count, MidripError::NotEnoughCards);
        p.cards[tier as usize] -= count;
        p.chips = p.chips.saturating_add(value * count as u64);
        msg!("sell tier={} count={} value={} slot={}", tier, count, value, Clock::get()?.slot);
        Ok(())
    }

    /// Commit the public table and any player accounts passed as remaining accounts to Solana.
    pub fn settle<'info>(ctx: Context<'info, Settle<'info>>) -> Result<()> {
        let mut infos = vec![ctx.accounts.table.to_account_info()];
        for a in ctx.remaining_accounts.iter() {
            require_keys_eq!(*a.owner, crate::ID, MidripError::BadAccount);
            infos.push(a.clone());
        }
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&infos)
        .build_and_invoke()?;
        msg!("settle commit accounts={} slot={}", infos.len(), Clock::get()?.slot);
        Ok(())
    }

    /// Commit only player accounts to Solana (for tables past MagicBlock's 10-commit cap).
    pub fn settle_players<'info>(ctx: Context<'info, SettlePlayers<'info>>) -> Result<()> {
        let mut infos = vec![];
        for a in ctx.remaining_accounts.iter() {
            require_keys_eq!(*a.owner, crate::ID, MidripError::BadAccount);
            infos.push(a.clone());
        }
        require!(!infos.is_empty(), MidripError::BadAccount);
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&infos)
        .build_and_invoke()?;
        msg!("settle_players accounts={} slot={}", infos.len(), Clock::get()?.slot);
        Ok(())
    }

    /// Commit and hand the public table and player accounts back to Solana.
    pub fn settle_and_undelegate<'info>(ctx: Context<'info, Settle<'info>>) -> Result<()> {
        let t = &ctx.accounts.table;
        require!(t.state == TableState::Idle as u8 || t.state == TableState::Done as u8, MidripError::TableBusy);
        let mut infos = vec![ctx.accounts.table.to_account_info()];
        for a in ctx.remaining_accounts.iter() {
            require_keys_eq!(*a.owner, crate::ID, MidripError::BadAccount);
            infos.push(a.clone());
        }
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&infos)
        .build_and_invoke()?;
        msg!("settle_and_undelegate accounts={} slot={}", infos.len(), Clock::get()?.slot);
        Ok(())
    }
}

pub fn card_value(config: &Config, tier: u8) -> u64 {
    let t = tier as usize;
    if t < BASE_TIERS {
        config.base_values[t]
    } else {
        config.hit_values[t - BASE_TIERS]
    }
}

// ---------- accounts ----------

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigArgs {
    pub base_weights: [u16; BASE_TIERS],
    pub base_values: [u64; BASE_TIERS],
    pub hit_weights: [u16; HIT_TIERS],
    pub hit_values: [u64; HIT_TIERS],
    pub payout_bps: u16,
    pub start_bps: u16,
    pub floor_bps: u16,
    pub listing_slots: u64,
    pub grace_slots: u64,
    pub starting_chips: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub base_weights: [u16; BASE_TIERS],
    pub base_values: [u64; BASE_TIERS],
    pub hit_weights: [u16; HIT_TIERS],
    pub hit_values: [u64; HIT_TIERS],
    pub ev_base_milli: u64,
    pub ev_hit_milli: u64,
    pub payout_bps: u16,
    pub pack_price: u64,
    pub start_bps: u16,
    pub floor_bps: u16,
    pub listing_slots: u64,
    pub grace_slots: u64,
    pub starting_chips: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub wallet: Pubkey,
    pub chips: u64,
    pub cards: [u32; NUM_TIERS],
    pub packs_opened: u32,
    pub bump: u8,
    /// Cards taken out of play to be minted as SPL tokens on Solana; only ever grows.
    pub withdrawn: [u32; NUM_TIERS],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Listing {
    pub list_slot: u64,
    pub start_price: u64,
    pub floor_price: u64,
    pub duration_slots: u64,
    pub end_slot: u64,
    pub ev_rest_milli: u64,
    pub cards_left: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Sale {
    pub price: u64,
    pub slot: u64,
    pub list_slot: u64,
    pub from: Pubkey,
    pub to: Pubkey,
    pub cards_left: u8,
}

/// Public pack header: anyone can read it.
#[account]
#[derive(InitSpace)]
pub struct Table {
    pub id: u8,
    pub state: u8,
    pub nonce: u64,
    pub opener: Pubkey,
    pub holder: Pubkey,
    pub price_paid: u64,
    pub opened_slot: u64,
    pub revealed: [u8; PACK_SIZE],
    pub revealed_count: u8,
    pub hit_revealed: bool,
    pub commitment: [u8; 32],
    /// Zero until the pack is finished, then the VRF randomness for verification.
    pub randomness: [u8; 32],
    pub listing: Listing,
    pub last_sale: Sale,
    pub sales_count: u8,
    pub bump: u8,
}

/// Private on the rollup (permission with no readers): the drawn pack.
#[account]
#[derive(InitSpace)]
pub struct Sealed {
    pub id: u8,
    pub nonce: u64,
    pub tiers: [u8; PACK_SIZE],
    pub hit_pos: u8,
    pub randomness: [u8; 32],
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init_if_needed, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPlayer<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    #[account(init_if_needed, payer = wallet, space = 8 + Player::INIT_SPACE, seeds = [PLAYER_SEED, wallet.key().as_ref()], bump)]
    pub player: Account<'info, Player>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePlayer<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    /// CHECK: the player PDA to delegate
    #[account(mut, del, seeds = [PLAYER_SEED, wallet.key().as_ref()], bump)]
    pub player: UncheckedAccount<'info>,
    /// CHECK: optional target validator (the TEE validator)
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
#[instruction(id: u8)]
pub struct InitTable<'info> {
    #[account(mut, address = config.admin @ MidripError::NotAdmin)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = 8 + Table::INIT_SPACE, seeds = [TABLE_SEED, &[id]], bump)]
    pub table: Account<'info, Table>,
    #[account(init, payer = admin, space = 8 + Sealed::INIT_SPACE, seeds = [SEALED_SEED, &[id]], bump)]
    pub sealed: Account<'info, Sealed>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(id: u8)]
pub struct DelegateTable<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: table PDA
    #[account(mut, del, seeds = [TABLE_SEED, &[id]], bump)]
    pub table: UncheckedAccount<'info>,
    /// CHECK: sealed PDA
    #[account(mut, del, seeds = [SEALED_SEED, &[id]], bump)]
    pub sealed: UncheckedAccount<'info>,
    /// CHECK: optional target validator (the TEE validator)
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct SealedPermission<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [SEALED_SEED, &[sealed.id]], bump = sealed.bump)]
    pub sealed: Account<'info, Sealed>,
    /// CHECK: derived and checked under the permission program
    #[account(mut, seeds = [PERMISSION_SEED, sealed.key().as_ref()], bump, seeds::program = permission_program.key())]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: ephemeral vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct OpenPack<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, payer.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
    #[account(seeds = [SEALED_SEED, &[table.id]], bump = sealed.bump)]
    pub sealed: Account<'info, Sealed>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: the VRF oracle queue
    #[account(
        mut,
        constraint = oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_EPHEMERAL_TEST_QUEUE
            || oracle_queue.key() == vrf::consts::DEFAULT_TEST_QUEUE
            @ MidripError::BadAccount
    )]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// Scoped VRF identity for this program, computed at compile time. On SDK 0.18.0 the
/// `#[vrf_callback]` macro derives it at runtime and runs the callback out of compute
/// (ephemeral-rollups-sdk issue #343), so the signer is checked against this constant instead.
pub const VRF_CALLBACK_IDENTITY: Pubkey =
    Pubkey::new_from_array(ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity_const(&crate::ID).0);

#[derive(Accounts)]
pub struct CallbackDraw<'info> {
    /// Only MagicBlock's VRF program can sign as this identity, so spoofed randomness is rejected.
    #[account(address = VRF_CALLBACK_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
    #[account(mut, seeds = [SEALED_SEED, &[table.id]], bump = sealed.bump)]
    pub sealed: Account<'info, Sealed>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct Reveal<'info> {
    pub holder: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, holder.key().as_ref()], bump = holder_player.bump)]
    pub holder_player: Account<'info, Player>,
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
    #[account(seeds = [SEALED_SEED, &[table.id]], bump = sealed.bump)]
    pub sealed: Account<'info, Sealed>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct HolderAction<'info> {
    pub holder: Signer<'info>,
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct BuyRest<'info> {
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, buyer.key().as_ref()], bump = buyer_player.bump)]
    pub buyer_player: Account<'info, Player>,
    #[account(mut, seeds = [PLAYER_SEED, seller_player.wallet.as_ref()], bump = seller_player.bump)]
    pub seller_player: Account<'info, Player>,
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
}

#[derive(Accounts)]
pub struct TableOnly<'info> {
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
}

#[derive(Accounts)]
pub struct RefundStuck<'info> {
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
    #[account(mut, seeds = [PLAYER_SEED, opener_player.wallet.as_ref()], bump = opener_player.bump)]
    pub opener_player: Account<'info, Player>,
}

#[derive(Accounts)]
pub struct AbandonStale<'info> {
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
    #[account(seeds = [SEALED_SEED, &[table.id]], bump = sealed.bump)]
    pub sealed: Account<'info, Sealed>,
}

#[derive(Accounts)]
#[instruction(tier: u8)]
pub struct InitMint<'info> {
    #[account(mut, address = config.admin @ MidripError::NotAdmin)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// CHECK: PDA that signs mint_to; holds no data.
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_auth: UncheckedAccount<'info>,
    #[account(init, payer = admin, seeds = [MINT_SEED, &[tier]], bump, mint::decimals = 0, mint::authority = mint_auth)]
    pub mint: Account<'info, anchor_spl::token::Mint>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(tier: u8)]
pub struct ClaimCards<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,
    /// CHECK: the player's account as last committed to Solana (owned by this program or, while
    /// delegated, by the delegation program); deserialized and checked in the handler.
    #[account(seeds = [PLAYER_SEED, wallet.key().as_ref()], bump)]
    pub player: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = wallet, space = 8 + ClaimRecord::INIT_SPACE, seeds = [CLAIM_SEED, wallet.key().as_ref()], bump)]
    pub claim: Account<'info, ClaimRecord>,
    /// CHECK: PDA that signs mint_to.
    #[account(seeds = [MINT_AUTH_SEED], bump)]
    pub mint_auth: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_SEED, &[tier]], bump)]
    pub mint: Account<'info, anchor_spl::token::Mint>,
    #[account(init_if_needed, payer = wallet, associated_token::mint = mint, associated_token::authority = wallet)]
    pub token_account: Account<'info, anchor_spl::token::TokenAccount>,
    pub token_program: Program<'info, anchor_spl::token::Token>,
    pub associated_token_program: Program<'info, anchor_spl::associated_token::AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ClaimRecord {
    pub wallet: Pubkey,
    pub claimed: [u32; NUM_TIERS],
}

#[derive(Accounts)]
pub struct SellCards<'info> {
    pub wallet: Signer<'info>,
    #[account(mut, seeds = [PLAYER_SEED, wallet.key().as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[commit]
#[derive(Accounts)]
pub struct SettlePlayers<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [TABLE_SEED, &[table.id]], bump = table.bump)]
    pub table: Account<'info, Table>,
}

#[error_code]
pub enum MidripError {
    #[msg("Bad config")]
    BadConfig,
    #[msg("Only the admin can do this")]
    NotAdmin,
    #[msg("This table already has a pack in play")]
    TableBusy,
    #[msg("Not enough chips")]
    NotEnoughChips,
    #[msg("Not enough cards")]
    NotEnoughCards,
    #[msg("Wrong table state for this action")]
    WrongState,
    #[msg("Only the current holder of the pack can do this")]
    NotHolder,
    #[msg("No sealed cards left")]
    NothingLeft,
    #[msg("You already hold this pack")]
    SelfBuy,
    #[msg("The listing has expired")]
    ListingExpired,
    #[msg("Still running")]
    ListingActive,
    #[msg("Unexpected account")]
    BadAccount,
}
