// Break test: can a wallet with no permission recover a sealed pack from the VRF callback transaction?
import { loadKeypair, teeConn, tablePda, decode, Keypair, configPda, base } from "./mr.mjs";
import { drawPack, hex } from "../src/lib/packmath.ts";
import bs58 from "bs58";
const sig = process.argv[2];
const S = Keypair.generate();
const es = await teeConn(S);
const tx = await es.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
if (!tx) { console.log("stranger: callback tx not visible"); process.exit(0); }
const msg = tx.transaction.message;
const keys = msg.staticAccountKeys ?? msg.accountKeys;
console.log("instructions:", msg.compiledInstructions.length);
for (const ix of msg.compiledInstructions) {
  const prog = keys[ix.programIdIndex].toBase58();
  const data = Buffer.from(ix.data);
  console.log("ix prog", prog.slice(0, 8), "data bytes", data.length, "first", data.subarray(0, 8).toString("hex"));
  if (prog.startsWith("DAthUNW8") && data.length >= 40) {
    const rnd = data.subarray(8, 40);
    const cfg = decode("Config", await base.getAccountInfo(configPda()));
    console.log("randomness seen by stranger:", rnd.toString("hex").slice(0, 16), "-> predicted pack", JSON.stringify(drawPack(rnd, cfg.base_weights, cfg.hit_weights)));
  }
}
