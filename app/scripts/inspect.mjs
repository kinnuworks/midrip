import { loadKeypair, teeConn, tablePda, decode } from "./mr.mjs";
const admin = loadKeypair("~/.config/solana/id.json");
const er = await teeConn(admin);
const id = Number(process.argv[2] || 0);
const t = decode("Table", await er.getAccountInfo(tablePda(id)));
console.log("table", id, "state", t.state, "nonce", t.nonce.toString());
const sigs = await er.getSignaturesForAddress(tablePda(id), { limit: 6 });
for (const s of sigs) {
  const tx = await er.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
  console.log("==", s.signature.slice(0, 16), "err", JSON.stringify(s.err));
  console.log(tx ? tx.meta.logMessages.slice(0, 25).join("\n") : "  (tx not visible to this token)");
}
