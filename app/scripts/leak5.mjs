import { teeConn, Keypair, PROGRAM_ID, VRF_EPHEMERAL_QUEUE, PublicKey } from "./mr.mjs";
const idl = (await import("../src/idl/midrip.json", { with: { type: "json" } })).default;
const cb = Buffer.from(idl.instructions.find((i) => i.name === "callback_draw").discriminator);
const es = await teeConn(Keypair.generate());
const IDENT = PublicKey.findProgramAddressSync([Buffer.from("identity")], PROGRAM_ID)[0];
for (const [name, addr] of [["vrf queue", VRF_EPHEMERAL_QUEUE], ["vrf program", new PublicKey("Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz")], ["slot hashes", new PublicKey("SysvarS1otHashes111111111111111111111111111")]]) {
  let sigs = [];
  try { sigs = await es.getSignaturesForAddress(addr, { limit: 60 }); } catch (e) { console.log(name, "refused", String(e).slice(0, 80)); continue; }
  let hits = 0, seen = 0;
  for (const s of sigs) {
    const tx = await es.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
    if (!tx) continue; seen++;
    const m = tx.transaction.message, keys = m.staticAccountKeys;
    for (const ix of m.compiledInstructions) if (keys[ix.programIdIndex].equals(PROGRAM_ID) && Buffer.from(ix.data).subarray(0, 8).equals(cb)) { hits++; console.log("  FOUND our callback via", name, s.signature.slice(0, 12)); }
  }
  console.log(name, "sigs", sigs.length, "fetched", seen, "our callbacks found", hits);
}
