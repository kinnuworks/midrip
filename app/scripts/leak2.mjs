// Break test: scan a table's transaction history as a wallet with no permission, find the VRF callback
// into our program, and try to rebuild the sealed pack from its instruction data.
import { teeConn, tablePda, decode, Keypair, configPda, base, PROGRAM_ID } from "./mr.mjs";
import { drawPack } from "../src/lib/packmath.ts";
const id = Number(process.argv[2] || 3);
const es = await teeConn(Keypair.generate());
const sigs = await es.getSignaturesForAddress(tablePda(id), { limit: 50 });
console.log("signatures visible to stranger for table", id, ":", sigs.length);
const cfg = decode("Config", await base.getAccountInfo(configPda()));
const cbDisc = (await import("../src/idl/midrip.json", { with: { type: "json" } })).default.instructions.find((i) => i.name === "callback_draw").discriminator;
let found = 0;
for (const s of sigs) {
  const tx = await es.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
  if (!tx) continue;
  const m = tx.transaction.message, keys = m.staticAccountKeys;
  for (const ix of m.compiledInstructions) {
    const d = Buffer.from(ix.data);
    if (keys[ix.programIdIndex].equals(PROGRAM_ID) && d.subarray(0, 8).equals(Buffer.from(cbDisc))) {
      found++;
      const rnd = d.subarray(8, 40);
      console.log("callback", s.signature.slice(0, 12), "slot", s.slot, "randomness visible:", rnd.toString("hex").slice(0, 16), "-> predicted pack", JSON.stringify(drawPack(rnd, cfg.base_weights, cfg.hit_weights).tiers));
    }
  }
}
console.log("callbacks found:", found);
