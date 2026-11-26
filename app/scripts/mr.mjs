// Shared helpers for Mid-Rip scripts (Node). Base layer = Solana devnet; game = MagicBlock private rollup (devnet-tee).
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAuthToken, verifyTeeRpcIntegrity, PERMISSION_PROGRAM_ID, MAGIC_PROGRAM_ID, permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
export const idl = JSON.parse(fs.readFileSync(path.join(here, "../src/idl/midrip.json")));
export const PROGRAM_ID = new PublicKey(idl.address);
export const BASE_RPC = process.env.BASE_RPC || "https://api.devnet.solana.com";
export const TEE = "https://devnet-tee.magicblock.app";
export const TEE_VALIDATOR = new PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
export const VRF_EPHEMERAL_QUEUE = new PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
export const VAULT = new PublicKey("MagicVau1t999999999999999999999999999999999");
export const base = new Connection(BASE_RPC, "confirmed");
export const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const loadKeypair = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p.replace("~", process.env.HOME)))));
export const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const configPda = () => pda(Buffer.from("config"));
export const playerPda = (w) => pda(Buffer.from("player2"), w.toBuffer());
export const mintPda = (tier) => pda(Buffer.from("card-mint"), Buffer.from([tier]));
export const claimPda = (w) => pda(Buffer.from("claim"), w.toBuffer());
export const tablePda = (id) => pda(Buffer.from("table"), Buffer.from([id]));
export const sealedPda = (id) => pda(Buffer.from("sealed"), Buffer.from([id]));

export const program = (conn, kp) => new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed", skipPreflight: true }));
export const coder = new anchor.BorshAccountsCoder(idl);
export const decode = (name, info) => (info ? coder.decode(name, info.data) : null);

let attested = false;
export async function teeConn(kp) {
  if (!attested) { await verifyTeeRpcIntegrity(TEE); attested = true; }
  const { token } = await getAuthToken(TEE, kp.publicKey, async (m) => nacl.sign.detached(m, kp.secretKey));
  return new Connection(`${TEE}?token=${token}`, { commitment: "confirmed", wsEndpoint: `wss://devnet-tee.magicblock.app?token=${token}` });
}

// Send a transaction on the rollup and wait for its status; returns {sig, err, ms}.
export async function sendEr(conn, tx, signers) {
  const t0 = Date.now();
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  for (let i = 0; i < 100; i++) {
    const st = (await conn.getSignatureStatus(sig)).value;
    if (st && (st.confirmationStatus || st.err)) return { sig, err: st.err, ms: Date.now() - t0 };
    await sleep(40);
  }
  return { sig, err: "timeout", ms: Date.now() - t0 };
}

export async function fund(from, to, lamports) {
  return sendAndConfirmTransaction(base, new Transaction().add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })), [from]);
}
export { anchor, PublicKey, Keypair, Transaction, PERMISSION_PROGRAM_ID, MAGIC_PROGRAM_ID, permissionPdaFromAccount };
