import { Connection, Keypair } from "@solana/web3.js";
import { teeConn, tablePda, configPda, log } from "./mr.mjs";
const t = () => performance.now();
for (const rpc of ["https://rpc.magicblock.app/devnet", "https://api.devnet.solana.com"]) {
  const base = new Connection(rpc, "confirmed");
  let a = t(); await base.getAccountInfo(configPda()); const c1 = Math.round(t() - a);
  a = t(); await base.getMultipleAccountsInfo(Array.from({ length: 32 }, (_, i) => tablePda(i))); const c2 = Math.round(t() - a);
  log(rpc, "config", c1, "ms; 32 tables", c2, "ms");
}
let a = t(); const er = await teeConn(Keypair.generate()); log("tee token (incl attestation in scripts)", Math.round(t() - a), "ms");
a = t(); await er.getMultipleAccountsInfo(Array.from({ length: 12 }, (_, i) => tablePda(i))); log("tee 12 tables", Math.round(t() - a), "ms");
a = t(); await er.getSlot(); log("tee slot", Math.round(t() - a), "ms");
