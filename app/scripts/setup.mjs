// One-time devnet setup: config, tables, delegation to the private rollup, sealed permissions.
import { base, loadKeypair, program, configPda, tablePda, sealedPda, TEE_VALIDATOR, teeConn, sendEr, decode, log, VAULT, PERMISSION_PROGRAM_ID, MAGIC_PROGRAM_ID, permissionPdaFromAccount, anchor } from "./mr.mjs";
const admin = loadKeypair("~/.config/solana/id.json");
const p = program(base, admin);
const N = Number(process.env.TABLES || 3);
const BN = anchor.BN;
if (!(await base.getAccountInfo(configPda()))) {
  const args = {
    baseWeights: [80, 20], baseValues: [new BN(10), new BN(40)],
    hitWeights: [75, 22, 3], hitValues: [new BN(100), new BN(400), new BN(2500)],
    payoutBps: 9700, startBps: 12500, floorBps: 8500,
    listingSlots: new BN(1500), graceSlots: new BN(300), startingChips: new BN(2000),
  };
  log("init_config", await p.methods.initConfig(args).accounts({ admin: admin.publicKey }).rpc());
}
log("config", JSON.stringify(decode("Config", await base.getAccountInfo(configPda())), (k, v) => (typeof v === "object" && v?.toNumber ? v.toString() : v)).slice(0, 400));
const er = await teeConn(admin);
const erp = program(er, admin);
for (let id = 0; id < N; id++) {
  const t = tablePda(id), s = sealedPda(id);
  const info = await base.getAccountInfo(t);
  if (!info) log("init_table", id, await p.methods.initTable(id).accounts({ admin: admin.publicKey, table: t, sealed: s }).rpc());
  const info2 = await base.getAccountInfo(t);
  if (info2.owner.toBase58() !== "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh")
    log("delegate_table", id, await p.methods.delegateTable(id).accounts({ admin: admin.publicKey, table: t, sealed: s, validator: TEE_VALIDATOR }).rpc());
  for (let k = 0; k < 40 && !(await er.getAccountInfo(s)); k++) await new Promise((r) => setTimeout(r, 500));
  const perm = permissionPdaFromAccount(s);
  const tx = await erp.methods.createSealedPermission().accountsPartial({ payer: admin.publicKey, sealed: s, permission: perm, permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: VAULT, magicProgram: MAGIC_PROGRAM_ID }).transaction();
  const r = await sendEr(er, tx, [admin]);
  log("sealed permission", id, r.sig.slice(0, 12), JSON.stringify(r.err), r.ms + "ms");
}
