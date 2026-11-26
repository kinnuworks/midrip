// Evidence run (evidence/EVAL_PLAN.md): open packs on devnet from wallets we control, rip every card,
// and record each pack's VRF randomness, commitment, cards, value and timings. Writes
// evidence/packs.json and evidence/packs.csv. Usage: PACKS=60 node scripts/evidence.mjs
import { base, loadKeypair, program, configPda, tablePda, sealedPda, playerPda, TEE_VALIDATOR, VRF_EPHEMERAL_QUEUE, teeConn, sendEr, decode, log, sleep, fund, Keypair } from "./mr.mjs";
import { verifyPack } from "../src/lib/packmath.ts";
import fs from "fs";

const N = Number(process.env.PACKS || 60);
const relayer = loadKeypair(new URL("../../.kit/keys/relayer.json", import.meta.url).pathname);
const cfg = decode("Config", await base.getAccountInfo(configPda()));
const price = Number(cfg.pack_price.toString());
const values = [...cfg.base_values, ...cfg.hit_values].map((v) => Number(v.toString()));
const wallets = [];
const packs = [];

async function newWallet() {
  const kp = Keypair.generate();
  await fund(relayer, kp.publicKey, 15_000_000);
  const p = program(base, kp);
  await p.methods.initPlayer().accounts({ wallet: kp.publicKey }).rpc();
  await p.methods.delegatePlayer().accounts({ wallet: kp.publicKey, validator: TEE_VALIDATOR }).rpc();
  const er = await teeConn(kp);
  for (let i = 0; i < 60 && !(await er.getAccountInfo(playerPda(kp.publicKey))); i++) await sleep(300);
  wallets.push(kp.publicKey.toBase58());
  log("wallet", kp.publicKey.toBase58());
  return { kp, er, pg: program(er, kp) };
}

let w = await newWallet();
while (packs.length < N) {
  const pl = decode("Player", await w.er.getAccountInfo(playerPda(w.kp.publicKey)));
  if (Number(pl.chips.toString()) < price) { w = await newWallet(); continue; }
  const ids = Array.from({ length: 32 }, (_, i) => i);
  const infos = await w.er.getMultipleAccountsInfo(ids.map(tablePda));
  const free = ids.filter((i) => { const x = decode("Table", infos[i]); return x && (x.state === 0 || x.state === 4); });
  if (!free.length) { await sleep(2000); continue; }
  const id = free[Math.floor(Math.random() * free.length)];
  const t = tablePda(id), s = sealedPda(id);
  const seed = packs.length % 255;
  const t0 = Date.now();
  const open = await sendEr(w.er, await w.pg.methods.openPack(seed).accounts({ payer: w.kp.publicKey, table: t, sealed: s, oracleQueue: VRF_EPHEMERAL_QUEUE }).transaction(), [w.kp]);
  if (open.err) { log("open failed on table", id, JSON.stringify(open.err)); await sleep(1000); continue; }
  let tb;
  for (let i = 0; i < 300; i++) { tb = decode("Table", await w.er.getAccountInfo(t)); if (tb.state === 2 && tb.holder.equals(w.kp.publicKey)) break; await sleep(40); }
  const drawMs = Date.now() - t0;
  if (tb.state !== 2) { log("VRF did not draw on table", id); continue; }
  const revealMs = [];
  let ok = true;
  for (let i = 0; i < 6; i++) {
    const r = await sendEr(w.er, await w.pg.methods.reveal().accounts({ holder: w.kp.publicKey, table: t, sealed: s }).transaction(), [w.kp]);
    if (r.err) { ok = false; log("reveal failed", JSON.stringify(r.err)); break; }
    revealMs.push(r.ms);
  }
  if (!ok) continue;
  tb = decode("Table", await w.er.getAccountInfo(t));
  const v = verifyPack({ randomness: tb.randomness, commitment: tb.commitment, revealed: tb.revealed, nonce: BigInt(tb.nonce.toString()) }, cfg.base_weights, cfg.hit_weights);
  const tiers = Array.from(tb.revealed);
  const value = tiers.reduce((a, x) => a + values[x], 0);
  packs.push({ table: id, nonce: tb.nonce.toString(), wallet: w.kp.publicKey.toBase58(), client_seed: seed, open_sig: open.sig, draw_ms: drawMs, reveal_ms: revealMs, tiers, hit_pos: v.hitPos, value, price, verified: v.ok, commitment: Buffer.from(tb.commitment).toString("hex"), randomness: Buffer.from(tb.randomness).toString("hex") });
  log(`pack ${packs.length}/${N} table ${id} tiers ${tiers.join("")} value ${value} verified ${v.ok} draw ${drawMs}ms reveal ${revealMs.join("/")}ms`);
  // Sell the cards back at their table value to fund the next pack.
  for (let tier = 0; tier < 5; tier++) {
    const n = tiers.filter((x) => x === tier).length;
    if (n) await sendEr(w.er, await w.pg.methods.sellCards(tier, n).accounts({ wallet: w.kp.publicKey }).transaction(), [w.kp]);
  }
}

const dir = new URL("../../evidence/", import.meta.url).pathname;
fs.writeFileSync(dir + "packs.json", JSON.stringify({ program: cfg && "DAthUNW8m79QheY2oNPq42ab99hCcavp1BVXDrmAHgYM", cluster: "devnet + MagicBlock devnet-tee", odds: { base_weights: cfg.base_weights, hit_weights: cfg.hit_weights, values, price, payout_bps: cfg.payout_bps }, wallets, packs }, null, 2));
fs.writeFileSync(dir + "packs.csv", "pack,table,value,price,payout,verified,draw_ms,reveal_ms_median,hit_tier\n" + packs.map((p, i) => {
  const rm = [...p.reveal_ms].sort((a, b) => a - b)[3];
  return [i + 1, p.table, p.value, p.price, (p.value / p.price).toFixed(4), p.verified ? 1 : 0, p.draw_ms, rm, p.tiers[p.hit_pos]].join(",");
}).join("\n") + "\n");
log("wrote evidence/packs.json and packs.csv:", packs.length, "packs,", packs.filter((p) => p.verified).length, "verified");
