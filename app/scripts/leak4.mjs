import { teeConn, Keypair } from "./mr.mjs";
import fs from "fs";
const f = process.argv[2];
const run = JSON.parse(fs.readFileSync(f));
const es = await teeConn(Keypair.generate());
for (const st of run.steps) {
  const tx = await es.getTransaction(st.sig, { maxSupportedTransactionVersion: 0 }).catch((e) => "ERR " + String(e).slice(0, 60));
  console.log(st.name.padEnd(10), st.sig.slice(0, 10), tx === null ? "null (hidden)" : typeof tx === "string" ? tx : "VISIBLE");
}
