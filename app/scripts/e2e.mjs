// End-to-end on devnet + MagicBlock private rollup: two fresh players, one pack opened, sold mid-rip, finished, verified.
// Also the break tests: a stranger tries to read the sealed pack and the VRF callback transaction.
import { base, loadKeypair, program, configPda, tablePda, sealedPda, playerPda, TEE_VALIDATOR, VRF_EPHEMERAL_QUEUE, teeConn, sendEr, decode, log, sleep, fund, Keypair } from "./mr.mjs";
import { verifyPack, evRestMilli, clockPrice, hex, drawPack } from "../src/lib/packmath.ts";
import fs from "fs";
const relayer = loadKeypair(new URL("../../.kit/keys/relayer.json", import.meta.url).pathname);
const TABLE = Number(process.env.TABLE || 0);
const out = { table: TABLE, steps: [], checks: {} };
const step = (name, r, extra = {}) => { out.steps.push({ name, sig: r.sig, err: r.err, ms: r.ms, ...extra }); log(name, r.sig, JSON.stringify(r.err), r.ms + "ms", JSON.stringify(extra)); if (r.err) throw new Error(name + " failed " + JSON.stringify(r.err)); };

const A = Keypair.generate(), B = Keypair.generate(), S = Keypair.generate();
for (const k of [A, B]) await fund(relayer, k.publicKey, 20_000_000);
log("players", A.publicKey.toBase58(), B.publicKey.toBase58());
const cfg = decode("Config", await base.getAccountInfo(configPda()));
for (const k of [A, B]) {
  const p = program(base, k);
  await p.methods.initPlayer().accounts({ wallet: k.publicKey }).rpc();
  await p.methods.delegatePlayer().accounts({ wallet: k.publicKey, validator: TEE_VALIDATOR }).rpc();
}
const [ea, eb, es] = [await teeConn(A), await teeConn(B), await teeConn(S)];
for (const k of [A, B]) for (let i = 0; i < 40 && !(await ea.getAccountInfo(playerPda(k.publicKey))); i++) await sleep(300);
const pa = program(ea, A), pb = program(eb, B);
const t = tablePda(TABLE), s = sealedPda(TABLE);
const readTable = async (c = ea) => decode("Table", await c.getAccountInfo(t));
let tb = await readTable();
if (tb.state === 1 || tb.state === 2 || tb.state === 3) throw new Error("table busy: state " + tb.state);

// 1. open pack -> VRF callback draws it into the sealed account
const t0 = Date.now();
step("open_pack", await sendEr(ea, await pa.methods.openPack(7).accounts({ payer: A.publicKey, table: t, sealed: s, oracleQueue: VRF_EPHEMERAL_QUEUE }).transaction(), [A]));
for (let i = 0; i < 200; i++) { tb = await readTable(); if (tb.state === 2) break; await sleep(50); }
out.checks.vrfCallbackMs = Date.now() - t0;
log("drawn after", out.checks.vrfCallbackMs, "ms; commitment", hex(tb.commitment).slice(0, 16));
if (tb.state !== 2) { const tx = await ea.getTransaction(out.steps[0].sig, { maxSupportedTransactionVersion: 0 }); console.log(tx ? tx.meta.logMessages.join("\n") : "open_pack tx not visible"); throw new Error("VRF callback never arrived"); }

// Break test 1: who can read the sealed pack?
const sealedBy = async (c) => { try { const a = await c.getAccountInfo(s); return a ? "READ " + a.data.length + " bytes" : "null"; } catch (e) { return "refused " + String(e).slice(0, 80); } };
out.checks.sealedReadStranger = await sealedBy(es);
out.checks.sealedReadOpener = await sealedBy(ea);
log("sealed read: stranger", out.checks.sealedReadStranger, "| opener", out.checks.sealedReadOpener);

// Break test 2: can a stranger see the VRF callback transaction (it carries the randomness)?
const sigs = await ea.getSignaturesForAddress(t, { limit: 10 });
out.checks.tableSigsSeenByOpener = sigs.length;
const cbSig = sigs.map((x) => x.signature).find((x) => x !== out.steps[0].sig);
out.checks.callbackSig = cbSig;
for (const [who, c] of [["stranger", es], ["opener", ea]]) {
  try { const tx = await c.getTransaction(cbSig, { maxSupportedTransactionVersion: 0 }); out.checks["callbackTx_" + who] = tx ? "VISIBLE (" + (tx.meta?.logMessages?.length ?? 0) + " logs)" : "null"; }
  catch (e) { out.checks["callbackTx_" + who] = "refused " + String(e).slice(0, 80); }
}
try { const ss = await es.getSignaturesForAddress(s, { limit: 5 }); out.checks.sealedSigsStranger = ss.length; } catch (e) { out.checks.sealedSigsStranger = "refused " + String(e).slice(0, 60); }
{ const tx = await es.getTransaction(cbSig, { maxSupportedTransactionVersion: 0 }); if (tx) { const m = tx.transaction.message; const keys = m.staticAccountKeys; const ix = m.compiledInstructions.find((i) => keys[i.programIdIndex].equals(t.constructor === Object ? t : keys[i.programIdIndex]) && Buffer.from(i.data).length >= 40 && keys[i.programIdIndex].toBase58() === "DAthUNW8m79QheY2oNPq42ab99hCcavp1BVXDrmAHgYM"); if (ix) { const rnd = Buffer.from(ix.data).subarray(8, 40); out.checks.strangerPredictedPack = drawPack(rnd, cfg.base_weights, cfg.hit_weights).tiers; } } }
log("callback tx:", out.checks.callbackTx_stranger, "(stranger) /", out.checks.callbackTx_opener, "(opener); sealed sigs seen by stranger:", out.checks.sealedSigsStranger);

// 2. A reveals two cards
for (let i = 0; i < 2; i++) step("reveal", await sendEr(ea, await pa.methods.reveal().accounts({ holder: A.publicKey, table: t, sealed: s }).transaction(), [A]), { pos: i });
tb = await readTable();
log("revealed", tb.revealed.slice(0, 2), "hit revealed", tb.hit_revealed);

// 3. A lists the sealed rest on the clock; B buys it a few hundred ms later
step("list_rest", await sendEr(ea, await pa.methods.listRest().accounts({ holder: A.publicKey, table: t }).transaction(), [A]));
tb = await readTable();
const L = tb.listing;
const evJs = evRestMilli(L.cards_left, tb.hit_revealed, BigInt(cfg.ev_base_milli.toString()), BigInt(cfg.ev_hit_milli.toString()));
out.checks.evRestMatches = evJs.toString() === L.ev_rest_milli.toString();
log("listing ev_milli", L.ev_rest_milli.toString(), "js", evJs.toString(), "start", L.start_price.toString(), "floor", L.floor_price.toString(), "list_slot", L.list_slot.toString());
await sleep(400);
step("buy_rest", await sendEr(eb, await pb.methods.buyRest().accounts({ buyer: B.publicKey, sellerPlayer: playerPda(A.publicKey), table: t }).transaction(), [B]));
tb = await readTable();
const sale = tb.last_sale;
const expected = clockPrice(BigInt(L.start_price.toString()), BigInt(L.floor_price.toString()), BigInt(L.list_slot.toString()), BigInt(L.duration_slots.toString()), BigInt(sale.slot.toString()));
out.checks.salePriceMatchesClock = expected.toString() === sale.price.toString();
out.checks.sale = { price: sale.price.toString(), slot: sale.slot.toString(), slotsAfterList: (BigInt(sale.slot.toString()) - BigInt(L.list_slot.toString())).toString() };
log("sale", JSON.stringify(out.checks.sale), "holder is B:", tb.holder.toBase58() === B.publicKey.toBase58(), "price matches clock:", out.checks.salePriceMatchesClock);

// 4. B reveals the rest
for (let i = 2; i < 6; i++) step("reveal", await sendEr(eb, await pb.methods.reveal().accounts({ holder: B.publicKey, table: t, sealed: s }).transaction(), [B]), { pos: i });
tb = await readTable();
const v = verifyPack({ randomness: tb.randomness, commitment: tb.commitment, revealed: tb.revealed, nonce: BigInt(tb.nonce.toString()) }, cfg.base_weights, cfg.hit_weights);
out.checks.verify = v;
out.checks.strangerPredictedCorrectly = JSON.stringify(out.checks.strangerPredictedPack) === JSON.stringify(Array.from(tb.revealed)); log("stranger predicted", JSON.stringify(out.checks.strangerPredictedPack), "match:", out.checks.strangerPredictedCorrectly);
log("pack", tb.revealed, "verify", JSON.stringify(v));
const [plA, plB] = [decode("Player", await ea.getAccountInfo(playerPda(A.publicKey))), decode("Player", await eb.getAccountInfo(playerPda(B.publicKey)))];
out.checks.players = { A: { chips: plA.chips.toString(), cards: plA.cards }, B: { chips: plB.chips.toString(), cards: plB.cards } };
log("A", JSON.stringify(out.checks.players.A), "B", JSON.stringify(out.checks.players.B));

// 5. settle: commit table + both players to Solana
const st = await pa.methods.settle().accounts({ payer: A.publicKey, table: t }).remainingAccounts([playerPda(A.publicKey), playerPda(B.publicKey)].map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }))).transaction();
step("settle", await sendEr(ea, st, [A]));
out.players = [A.publicKey.toBase58(), B.publicKey.toBase58()];
fs.mkdirSync(new URL("../../evidence/runs/", import.meta.url).pathname, { recursive: true });
fs.writeFileSync(new URL(`../../evidence/runs/e2e-${Date.now()}.json`, import.meta.url).pathname, JSON.stringify(out, null, 2));
log("DONE", JSON.stringify(out.checks.verify.ok));
