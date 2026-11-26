// Gives a new browser wallet enough devnet SOL for its one-time setup (player account rent and
// delegation fees). Play itself is free on the rollup. Devnet only; the relayer key lives in env.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

const RPC = "https://rpc.magicblock.app/devnet";
const GRANT = 15_000_000; // 0.015 devnet SOL
const MIN_BALANCE = 10_000_000;
const recent = new Map<string, number>();

export default async function handler(req: { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> }, res: { status: (n: number) => { json: (b: unknown) => void } }) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { wallet?: string };
  let wallet: PublicKey;
  try { wallet = new PublicKey(String(body?.wallet)); } catch { return res.status(400).json({ error: "bad wallet" }); }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown";
  const now = Date.now();
  if ((recent.get(ip) || 0) > now - 20_000) return res.status(429).json({ error: "slow down" });
  recent.set(ip, now);
  const secret = process.env.RELAYER_SECRET;
  if (!secret) return res.status(500).json({ error: "relayer not configured" });
  const relayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
  const conn = new Connection(RPC, "confirmed");
  const bal = await conn.getBalance(wallet);
  if (bal >= MIN_BALANCE) return res.status(200).json({ funded: false, balance: bal });
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: wallet, lamports: GRANT })), [relayer]);
  return res.status(200).json({ funded: true, sig });
}
