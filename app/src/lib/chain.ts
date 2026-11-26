// Chain layer for the browser: Solana devnet for setup, MagicBlock's private rollup (devnet-tee) for play.
import { Buffer } from "buffer";
import { AnchorProvider, Program, BorshAccountsCoder, type Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import idl from "../idl/midrip.json";

export const PROGRAM_ID = new PublicKey(idl.address);
export const BASE_RPC = "https://rpc.magicblock.app/devnet";
export const TEE = "https://devnet-tee.magicblock.app";
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const TABLE_IDS = [0, 1, 2, 3, 4, 5];
export const EXPLORER = (sig: string, cluster = "devnet") => `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
export const EXPLORER_ADDR = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;

export const base = new Connection(BASE_RPC, "confirmed");
const coder = new BorshAccountsCoder(idl as never);
export const decode = <T,>(name: string, data: Uint8Array | null | undefined): T | null => (data ? (coder.decode(name, Buffer.from(data)) as T) : null);

const pda = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const enc = (s: string) => new TextEncoder().encode(s);
export const configPda = pda(enc("config"));
export const playerPda = (w: PublicKey) => pda(enc("player2"), w.toBytes());
export const mintPda = (tier: number) => pda(enc("card-mint"), Uint8Array.of(tier));
export const tablePda = (id: number) => pda(enc("table"), Uint8Array.of(id));
export const sealedPda = (id: number) => pda(enc("sealed"), Uint8Array.of(id));

// A burner keypair kept in this browser: no wallet extension, no popups.
export function loadBurner(key = "midrip.burner"): Keypair {
  try {
    const s = localStorage.getItem(key);
    if (s) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  } catch { /* storage unavailable: use a fresh keypair */ }
  const kp = Keypair.generate();
  try { localStorage.setItem(key, JSON.stringify(Array.from(kp.secretKey))); } catch { /* ignore */ }
  return kp;
}

export async function teeConnection(kp: Keypair): Promise<Connection> {
  const { token } = await getAuthToken(TEE, kp.publicKey, async (m: Uint8Array) => nacl.sign.detached(m, kp.secretKey));
  return new Connection(`${TEE}?token=${token}`, { commitment: "confirmed", wsEndpoint: `wss://devnet-tee.magicblock.app?token=${token}` });
}

export function program(conn: Connection, kp: Keypair): Program {
  const wallet = { publicKey: kp.publicKey, payer: kp, signTransaction: async <T,>(t: T) => t, signAllTransactions: async <T,>(t: T) => t } as unknown as Wallet;
  return new Program(idl as never, new AnchorProvider(conn, wallet, { commitment: "confirmed", skipPreflight: true }));
}

export interface SendResult { sig: string; err: unknown; ms: number; slot?: number }

// Sign with the burner and send on the given connection; resolves when the network reports a status.
export async function send(conn: Connection, tx: Transaction, kp: Keypair): Promise<SendResult> {
  const t0 = performance.now();
  tx.feePayer = kp.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(kp);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 300; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st && (st.confirmationStatus || st.err)) return { sig, err: st.err, ms: Math.round(performance.now() - t0), slot: st.slot };
    await new Promise((r) => setTimeout(r, 40));
  }
  return { sig, err: "timeout", ms: Math.round(performance.now() - t0) };
}

// ---- account shapes (snake_case, as the IDL coder returns them) ----
type BNish = { toString(): string };
export interface Config { base_weights: number[]; base_values: BNish[]; hit_weights: number[]; hit_values: BNish[]; ev_base_milli: BNish; ev_hit_milli: BNish; payout_bps: number; pack_price: BNish; start_bps: number; floor_bps: number; listing_slots: BNish; grace_slots: BNish; starting_chips: BNish }
export interface Player { wallet: PublicKey; chips: BNish; cards: number[]; packs_opened: number; withdrawn: number[] }
export interface Listing { list_slot: BNish; start_price: BNish; floor_price: BNish; duration_slots: BNish; end_slot: BNish; ev_rest_milli: BNish; cards_left: number }
export interface Sale { price: BNish; slot: BNish; list_slot: BNish; from: PublicKey; to: PublicKey; cards_left: number }
export interface Table { id: number; state: number; nonce: BNish; opener: PublicKey; holder: PublicKey; price_paid: BNish; opened_slot: BNish; revealed: number[]; revealed_count: number; hit_revealed: boolean; commitment: number[]; randomness: number[]; listing: Listing; last_sale: Sale; sales_count: number }
export const STATE = ["idle", "drawing", "ripping", "listed", "done"] as const;
export const big = (v: BNish | number) => BigInt(v.toString());

// One-time setup for any burner: devnet SOL for rent from our relayer, create the player account on
// Solana, delegate it to MagicBlock's private rollup, and wait until the delegation lands.
export async function ensurePlayer(kp: Keypair, onStep: (s: string) => void = () => {}): Promise<SendResult[]> {
  const out: SendResult[] = [];
  const pg = program(base, kp);
  const waitFor = async (check: () => Promise<boolean>, tries = 80) => { for (let i = 0; i < tries; i++) { if (await check()) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
  const acct = () => base.getAccountInfo(playerPda(kp.publicKey));
  let info = await acct();
  if (info && !info.owner.equals(PROGRAM_ID)) return out; // already delegated
  if ((await base.getBalance(kp.publicKey)) < 10_000_000) {
    onStep("Getting devnet SOL for setup…");
    let r = await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: kp.publicKey.toBase58() }) });
    for (let i = 0; i < 6 && r.status === 429; i++) {
      await new Promise((res) => setTimeout(res, 5000));
      r = await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: kp.publicKey.toBase58() }) });
    }
    if (!r.ok) throw new Error("funding failed: " + (await r.text()));
    await waitFor(async () => (await base.getBalance(kp.publicKey)) >= 10_000_000);
  }
  // A devnet transaction can be dropped; resend (fresh blockhash) up to three times.
  for (let attempt = 0; !info && attempt < 3; attempt++) {
    onStep("Creating your player account on Solana…");
    const r = await send(base, await pg.methods.initPlayer().accounts({ wallet: kp.publicKey }).transaction(), kp);
    out.push(r);
    if (r.err && r.err !== "timeout") throw new Error("player setup failed: " + JSON.stringify(r.err));
    if (await waitFor(async () => !!(await acct()), 25)) info = await acct();
  }
  if (!info) throw new Error("player account did not appear on Solana");
  for (let attempt = 0; attempt < 3; attempt++) {
    onStep("Moving it into MagicBlock's private rollup…");
    const r = await send(base, await pg.methods.delegatePlayer().accounts({ wallet: kp.publicKey, validator: TEE_VALIDATOR }).transaction(), kp);
    out.push(r);
    if (r.err && r.err !== "timeout") throw new Error("delegation failed: " + JSON.stringify(r.err));
    if (await waitFor(async () => !(await acct())?.owner.equals(PROGRAM_ID), 25)) return out;
  }
  throw new Error("delegation did not land");
}
