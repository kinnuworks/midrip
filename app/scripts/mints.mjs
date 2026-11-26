// One-time: create the five card mints (one per rarity); only the program can mint them.
import { base, loadKeypair, program, mintPda, log } from "./mr.mjs";
const admin = loadKeypair("~/.config/solana/id.json");
const p = program(base, admin);
for (let tier = 0; tier < 5; tier++) {
  if (await base.getAccountInfo(mintPda(tier))) { log("mint", tier, "exists", mintPda(tier).toBase58()); continue; }
  log("init_mint", tier, mintPda(tier).toBase58(), await p.methods.initMint(tier).accountsPartial({ admin: admin.publicKey, mint: mintPda(tier) }).rpc());
}
