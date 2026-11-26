import { teeConn, tablePda, sealedPda, Keypair, PROGRAM_ID, loadKeypair } from "./mr.mjs";
const id = Number(process.argv[2] || 3);
const idl = (await import("../src/idl/midrip.json", { with: { type: "json" } })).default;
const discs = Object.fromEntries(idl.instructions.map((i) => [Buffer.from(i.discriminator).toString("hex"), i.name]));
for (const [who, kp] of [["stranger", Keypair.generate()], ["admin", loadKeypair("~/.config/solana/id.json")]]) {
  const c = await teeConn(kp);
  for (const [name, addr] of [["table", tablePda(id)], ["sealed", sealedPda(id)], ["program", PROGRAM_ID]]) {
    let sigs = [];
    try { sigs = await c.getSignaturesForAddress(addr, { limit: 100 }); } catch (e) { console.log(who, name, "refused", String(e).slice(0, 80)); continue; }
    const names = [];
    for (const s of sigs.slice(0, 40)) {
      const tx = await c.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
      if (!tx) { names.push("hidden"); continue; }
      const m = tx.transaction.message, keys = m.staticAccountKeys;
      const ours = m.compiledInstructions.filter((ix) => keys[ix.programIdIndex].equals(PROGRAM_ID)).map((ix) => discs[Buffer.from(ix.data).subarray(0, 8).toString("hex")] || "?");
      names.push(ours.join("+") || "other");
    }
    console.log(who, name, sigs.length, "sigs:", names.join(", "));
  }
}
