// Gives a new browser wallet enough devnet SOL (0.015) for its one-time setup: player account rent
// and delegation fees. Play itself is free on the rollup. Devnet only; the relayer key lives in env.
// Plain JS without @solana/web3.js (its dependency chain fails in the serverless runtime): one System
// Program transfer, built by hand, signed with tweetnacl and sent over JSON-RPC. Rate-limited per IP.
import nacl from "tweetnacl";
import bs58 from "bs58";
const RPC = "https://rpc.magicblock.app/devnet";
const GRANT = 15000000n;
const MIN_BALANCE = 1e7;
const recent = /* @__PURE__ */ new Map();
async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const compactU16 = (n) => n < 128 ? [n] : [n & 127 | 128, n >> 7];
const u64le = (v) => Array.from({ length: 8 }, (_, i) => Number(v >> BigInt(8 * i) & 0xffn));
function transferTx(from, to, lamports, blockhash) {
  const system = new Uint8Array(32);
  const data = [2, 0, 0, 0, ...u64le(lamports)];
  const message = Uint8Array.from([
    1,
    0,
    1,
    // header: 1 signer, 0 read-only signed, 1 read-only unsigned (System Program)
    ...compactU16(3),
    ...from.publicKey,
    ...to,
    ...system,
    ...bs58.decode(blockhash),
    ...compactU16(1),
    2,
    ...compactU16(2),
    0,
    1,
    ...compactU16(data.length),
    ...data
  ]);
  const sig = nacl.sign.detached(message, from.secretKey);
  return Buffer.from(Uint8Array.from([...compactU16(1), ...sig, ...message])).toString("base64");
}
// Client IP as Vercel sees it: x-real-ip is set by Vercel's edge; for x-forwarded-for, Vercel appends
// the real client address last, so a value the client sends itself cannot pick its own bucket.
function clientIp(req) {
  const real = req.headers["x-real-ip"];
  if (real) return String(real);
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((x) => x.trim()).filter(Boolean);
  return xff[xff.length - 1] || "unknown";
}
const HOURLY_CAP = 150; // grants per hour across everyone: at most 2.25 devnet SOL
const grants = [];

async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body; } catch { return res.status(400).json({ error: "bad json" }); }
    let wallet;
    try { wallet = bs58.decode(String(body?.wallet)); if (wallet.length !== 32) throw new Error(); } catch { return res.status(400).json({ error: "bad wallet" }); }
    const secret = process.env.RELAYER_SECRET;
    if (!secret) return res.status(500).json({ error: "relayer not configured" });
    const now = Date.now();
    for (const [k, v] of recent) { const keep = v.filter((t) => t > now - 60000); if (keep.length) recent.set(k, keep); else recent.delete(k); }
    while (grants.length && grants[0] < now - 3600000) grants.shift();
    const ip = clientIp(req);
    const hits = recent.get(ip) || [];
    if (hits.length >= 6 || grants.length >= HOURLY_CAP) return res.status(429).json({ error: "slow down" });
    hits.push(now);
    recent.set(ip, hits);
    const relayer = nacl.sign.keyPair.fromSecretKey(Uint8Array.from(JSON.parse(secret)));
    const addr = bs58.encode(wallet);
    const bal = (await rpc("getBalance", [addr, { commitment: "confirmed" }])).value;
    if (bal >= MIN_BALANCE) return res.status(200).json({ funded: false, balance: bal });
    grants.push(now);
    const { value } = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const sig = await rpc("sendTransaction", [transferTx(relayer, wallet, GRANT, value.blockhash), { encoding: "base64" }]);
    for (let i = 0; i < 40; i++) {
      const st = await rpc("getSignatureStatuses", [[sig]]);
      const s = st.value[0];
      if (s?.err) return res.status(500).json({ error: "transfer failed", sig });
      if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return res.status(200).json({ funded: true, sig });
      await new Promise((r) => setTimeout(r, 500));
    }
    return res.status(200).json({ funded: "pending", sig });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
export {
  handler as default
};
