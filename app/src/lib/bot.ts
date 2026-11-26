// A demo bot that plays in this browser with its own burner wallet, so there is always someone to
// open packs, sell a sealed rest and buy yours. It is labelled as a bot everywhere it appears.
import type { Connection, Keypair } from "@solana/web3.js";
import { big, ensurePlayer, loadBurner, playerPda, program, sealedPda, send, tablePda, VRF_EPHEMERAL_QUEUE, type Config, type Player, type SendResult, type Table } from "./chain";
import { clockPrice, evRestMilli, PACK_SIZE } from "./packmath";

const STALE_SLOTS = 60_000n;
const DRAW_TIMEOUT_SLOTS = 30_000n;

export interface BotEvent { action: string; table?: number; r: SendResult }

export class Bot {
  kp: Keypair = loadBurner("midrip.bot");
  ready = false;
  joining = false;
  busy = false;
  lastOpen = 0;
  private plannedBuy: Record<number, number> = {};

  private er: Connection;
  private onEvent: (e: BotEvent) => void;
  private onStatus: (s: string) => void;
  constructor(er: Connection, onEvent: (e: BotEvent) => void, onStatus: (s: string) => void) {
    this.er = er;
    this.onEvent = onEvent;
    this.onStatus = onStatus;
  }

  async join() {
    if (this.ready || this.joining) return;
    this.joining = true;
    try {
      await ensurePlayer(this.kp, (s) => this.onStatus("Bot: " + s.toLowerCase()));
      for (let i = 0; i < 60 && !(await this.er.getAccountInfo(playerPda(this.kp.publicKey))); i++) await new Promise((r) => setTimeout(r, 300));
      this.ready = true;
      this.onStatus("Bot is playing");
    } catch (e) {
      this.onStatus("Bot could not join: " + String(e));
    } finally {
      this.joining = false;
    }
  }

  private async act(action: string, table: number | undefined, build: () => Promise<import("@solana/web3.js").Transaction>) {
    this.busy = true;
    try {
      const r = await send(this.er, await build(), this.kp);
      this.onEvent({ action, table, r });
      return r;
    } catch {
      return null;
    } finally {
      this.busy = false;
    }
  }

  // One decision per call; the app calls this on its poll loop.
  async step(tables: Record<number, Table>, slot: bigint, config: Config, me: Keypair, botPlayer: Player | null) {
    if (!this.ready || this.busy || !botPlayer) return;
    const pg = program(this.er, this.kp);
    const mine = (t: Table) => t.holder.equals(this.kp.publicKey);
    const ids = Object.keys(tables).map(Number);

    // 1. Keep its own pack moving: reveal two cards, then put the sealed rest on the clock.
    for (const id of ids) {
      const t = tables[id];
      if (!mine(t)) continue;
      if (t.state === 2) {
        if (t.revealed_count < 2 || t.sales_count > 0 || big(t.listing.list_slot) > 0n) {
          const r = await this.act("bot reveals", id, () => pg.methods.reveal().accounts({ holder: this.kp.publicKey, table: tablePda(id), sealed: sealedPda(id) }).transaction());
          if (r && !r.err && t.revealed_count + 1 === PACK_SIZE) await this.act("bot settles to Solana", id, () => pg.methods.settle().accounts({ payer: this.kp.publicKey, table: tablePda(id) }).remainingAccounts([playerPda(this.kp.publicKey)].map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }))).transaction());
          return;
        }
        return void (await this.act("bot lists the sealed rest", id, () => pg.methods.listRest().accounts({ holder: this.kp.publicKey, table: tablePda(id) }).transaction()));
      }
      if (t.state === 3 && slot > big(t.listing.end_slot)) return void (await this.act("bot's clock ran out", id, () => pg.methods.expireListing().accounts({ table: tablePda(id) }).transaction()));
    }

    // 2. Buy the visitor's sealed rest once the clock drops a little below its average value.
    for (const id of ids) {
      const t = tables[id];
      if (t.state !== 3 || !t.holder.equals(me.publicKey)) { delete this.plannedBuy[id]; continue; }
      const L = t.listing;
      if (slot > big(L.end_slot)) continue;
      const ev = evRestMilli(L.cards_left, t.hit_revealed, big(config.ev_base_milli), big(config.ev_hit_milli)) / 1000n;
      const target = (ev * BigInt(this.plannedBuy[id] ??= 90 + Math.floor(Math.random() * 8))) / 100n;
      const price = clockPrice(big(L.start_price), big(L.floor_price), big(L.list_slot), big(L.duration_slots), slot);
      if (price <= target && big(botPlayer.chips) >= price) {
        return void (await this.act("bot buys your sealed rest", id, () => pg.methods.buyRest().accounts({ buyer: this.kp.publicKey, sellerPlayer: playerPda(t.holder), table: tablePda(id) }).transaction()));
      }
    }

    // 3. Tidy up packs whose holders left, so tables free up.
    for (const id of ids) {
      const t = tables[id];
      const last = [big(t.opened_slot), big(t.listing.list_slot), big(t.last_sale.slot)].reduce((a, b) => (a > b ? a : b));
      if (t.state === 3 && slot > big(t.listing.end_slot) && !mine(t)) return void (await this.act("expire an unsold clock", id, () => pg.methods.expireListing().accounts({ table: tablePda(id) }).transaction()));
      if ((t.state === 2 || t.state === 3) && slot > last + STALE_SLOTS) return void (await this.act("close an abandoned pack", id, () => pg.methods.abandonStale().accounts({ table: tablePda(id), sealed: sealedPda(id) }).transaction()));
      if (t.state === 1 && slot > big(t.opened_slot) + DRAW_TIMEOUT_SLOTS) return void (await this.act("refund a pack VRF never drew", id, () => pg.methods.refundStuck().accounts({ table: tablePda(id), openerPlayer: playerPda(t.opener) }).transaction()));
    }

    // 4. Open a new pack every so often if it holds none, leaving free tables for the visitor.
    const active = ids.some((id) => mine(tables[id]) && tables[id].state >= 1 && tables[id].state <= 3);
    const free = ids.filter((id) => tables[id].state === 0 || tables[id].state === 4);
    if (!active && free.length >= 2 && Date.now() - this.lastOpen > 6000 && big(botPlayer.chips) >= big(config.pack_price)) {
      this.lastOpen = Date.now();
      const id = free[free.length - 1];
      await this.act("bot opens a pack", id, () => pg.methods.openPack(Math.floor(Math.random() * 255)).accounts({ payer: this.kp.publicKey, table: tablePda(id), sealed: sealedPda(id), oracleQueue: VRF_EPHEMERAL_QUEUE }).transaction());
    }
  }
}
