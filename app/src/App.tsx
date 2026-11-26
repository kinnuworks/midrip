import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import {
  base, big, configPda, decode, ensurePlayer, EXPLORER, EXPLORER_ADDR, loadBurner, PROGRAM_ID, playerPda, program, sealedPda, send, STATE,
  tablePda, teeConnection, VRF_EPHEMERAL_QUEUE, type Config, type Player, type SendResult, type Table,
} from "./lib/chain";
import { clockPrice, evRestMilli, PACK_SIZE, TIER_NAMES, verifyPack, type VerifyResult } from "./lib/packmath";
import { Bot } from "./lib/bot";
import "./App.css";

const MAX_TABLES = 32;
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const milliToChips = (m: bigint) => (Number(m) / 1000).toFixed(1);

interface Receipt { action: string; table?: number; sig: string; ms: number; slot?: number; ok: boolean; note?: string; base?: boolean; bot?: boolean }

export default function App() {
  const params = new URLSearchParams(location.search);
  const forced = params.get("state");
  const me = useMemo(() => loadBurner(), []);
  const [er, setEr] = useState<Connection | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [tables, setTables] = useState<Record<number, Table>>({});
  const [tableIds, setTableIds] = useState<number[]>([]);
  const [slot, setSlot] = useState<bigint>(0n);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinStep, setJoinStep] = useState<string | null>(null);
  const [delegated, setDelegated] = useState(false);
  const [verified, setVerified] = useState<Record<number, VerifyResult>>({});
  const [peek, setPeek] = useState<Record<number, string>>({});
  const erRef = useRef<Connection | null>(null);
  const botRef = useRef<Bot | null>(null);
  const [botOn, setBotOn] = useState(params.get("bot") !== "off");
  const [botStatus, setBotStatus] = useState("Bot is starting…");
  const [botPlayer, setBotPlayer] = useState<Player | null>(null);

  const botOnRef = useRef(botOn);
  botOnRef.current = botOn;
  const cfgRef = useRef<Config | null>(null);
  cfgRef.current = config;
  const prevTables = useRef<Record<number, Table>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const addReceipt = (r: Receipt) => setReceipts((xs) => [r, ...xs].slice(0, 30));

  // Connect to the private rollup with a token signed by the burner (no popup).
  useEffect(() => {
    (async () => {
      try {
        const c = await teeConnection(me);
        erRef.current = c;
        setEr(c);
        botRef.current = new Bot(c, (ev) => addReceipt({ action: ev.action, table: ev.table, sig: ev.r.sig, ms: ev.r.ms, slot: ev.r.slot, ok: !ev.r.err, note: ev.r.err ? JSON.stringify(ev.r.err) : undefined, bot: true }), setBotStatus);
        const cfg = decode<Config>("Config", (await base.getAccountInfo(configPda))?.data);
        setConfig(cfg);
        const infos = await base.getMultipleAccountsInfo(Array.from({ length: MAX_TABLES }, (_, i) => tablePda(i)));
        setTableIds(infos.map((x, i) => (x ? i : -1)).filter((i) => i >= 0));
        const mine = await base.getAccountInfo(playerPda(me.publicKey));
        if (mine && !mine.owner.equals(PROGRAM_ID)) setDelegated(true);
      } catch (e) {
        setError("Could not reach MagicBlock's private rollup: " + String(e));
      }
    })();
  }, [me]);

  // Poll tables, my player account and the rollup slot (10 ms blocks, so the clock moves every poll).
  useEffect(() => {
    if (!er || tableIds.length === 0) return;
    let stop = false;
    const tick = async () => {
      try {
        const bot = botRef.current;
        const keys = [...tableIds.map(tablePda), playerPda(bot ? bot.kp.publicKey : me.publicKey), ...(delegated ? [playerPda(me.publicKey)] : [])];
        const [infos, s] = await Promise.all([er.getMultipleAccountsInfo(keys), er.getSlot()]);
        if (stop) return;
        const next: Record<number, Table> = {};
        tableIds.forEach((id, i) => { const t = decode<Table>("Table", infos[i]?.data); if (t) next[id] = t; });
        const prev = prevTables.current;
        for (const [k, t] of Object.entries(next)) {
          const before = prev[Number(k)];
          if (before && before.holder.equals(me.publicKey) && !t.holder.equals(me.publicKey) && big(t.last_sale.slot) > big(before.last_sale.slot)) {
            const buyer = botRef.current && t.holder.equals(botRef.current.kp.publicKey) ? "The demo bot" : short(t.holder.toBase58());
            setNotice(`Sold: ${buyer} paid you ${big(t.last_sale.price).toString()} chips for the sealed rest on table ${k} at block ${big(t.last_sale.slot).toString()}, ${(big(t.last_sale.slot) - big(t.last_sale.list_slot)).toString()} blocks after you listed it.`);
          }
        }
        prevTables.current = next;
        setTables(next);
        const bp = bot?.ready ? decode<Player>("Player", infos[tableIds.length]?.data) : null;
        setBotPlayer(bp);
        if (delegated) setPlayer(decode<Player>("Player", infos[tableIds.length + 1]?.data));
        if (bot && botOnRef.current && cfgRef.current) {
          if (!bot.ready) void bot.join();
          else void bot.step(next, BigInt(s), cfgRef.current, me, bp);
        }
        setSlot(BigInt(s));
      } catch { /* transient RPC error: next tick retries */ }
    };
    tick();
    const h = setInterval(tick, 150);
    return () => { stop = true; clearInterval(h); };
  }, [er, tableIds, me, delegated]);

  const pg = useMemo(() => (er ? program(er, me) : null), [er, me]);

  const run = useCallback(async (label: string, table: number | undefined, build: () => Promise<Transaction>, onBase = false) => {
    if (!erRef.current) return null;
    setBusy(label + (table !== undefined ? table : ""));
    setError(null);
    try {
      const tx = await build();
      const r: SendResult = await send(onBase ? base : erRef.current, tx, me);
      addReceipt({ action: label, table, sig: r.sig, ms: r.ms, slot: r.slot, ok: !r.err, note: r.err ? JSON.stringify(r.err) : undefined, base: onBase });
      if (r.err) setError(`${label} failed: ${JSON.stringify(r.err)}`);
      return r;
    } catch (e) {
      setError(`${label} failed: ${String(e)}`);
      return null;
    } finally {
      setBusy(null);
    }
  }, [me]);

  // One-time setup: devnet SOL from our relayer, then create and delegate the player account.
  const join = useCallback(async () => {
    setError(null);
    try {
      const rs = await ensurePlayer(me, (st) => setJoinStep(st));
      rs.forEach((r, i) => addReceipt({ action: i === rs.length - 1 ? "delegate to rollup" : "create player", sig: r.sig, ms: r.ms, slot: r.slot, ok: !r.err, base: true }));
      for (let i = 0; i < 60 && !(await erRef.current?.getAccountInfo(playerPda(me.publicKey))); i++) await new Promise((r) => setTimeout(r, 300));
      setDelegated(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setJoinStep(null);
    }
  }, [me]);

  const open = (id: number) => pg && run("open pack", id, () => pg.methods.openPack(Math.floor(Math.random() * 255)).accounts({ payer: me.publicKey, table: tablePda(id), sealed: sealedPda(id), oracleQueue: VRF_EPHEMERAL_QUEUE }).transaction());
  const reveal = async (id: number) => {
    if (!pg) return;
    const r = await run("reveal", id, () => pg.methods.reveal().accounts({ holder: me.publicKey, table: tablePda(id), sealed: sealedPda(id) }).transaction());
    const t = tables[id];
    if (r && !r.err && t && t.revealed_count + 1 === PACK_SIZE) await settle(id, t);
  };
  const list = (id: number) => pg && run("sell the rest", id, () => pg.methods.listRest().accounts({ holder: me.publicKey, table: tablePda(id) }).transaction());
  const cancel = (id: number) => pg && run("cancel listing", id, () => pg.methods.cancelListing().accounts({ holder: me.publicKey, table: tablePda(id) }).transaction());
  const buy = (id: number, t: Table) => pg && run("buy the rest", id, () => pg.methods.buyRest().accounts({ buyer: me.publicKey, sellerPlayer: playerPda(t.holder), table: tablePda(id) }).transaction());
  const settle = async (id: number, t: Table) => {
    if (!pg) return;
    const players = [...new Set([t.opener.toBase58(), t.holder.toBase58(), me.publicKey.toBase58()])].map((w) => playerPda(new PublicKey(w)));
    const metas = players.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }));
    if (big(t.nonce) <= 9n) await run("settle to Solana", id, () => pg.methods.settle().accounts({ payer: me.publicKey, table: tablePda(id) }).remainingAccounts(metas).transaction());
    else await run("settle to Solana", id, () => pg.methods.settlePlayers().accounts({ payer: me.publicKey }).remainingAccounts(metas).transaction());
  };
  // Ask the private rollup for the sealed account with this browser's own token: it returns nothing.
  const tryRead = async (id: number) => {
    if (!erRef.current) return;
    const t0 = performance.now();
    const a = await erRef.current.getAccountInfo(sealedPda(id)).catch((e) => String(e));
    const ms = Math.round(performance.now() - t0);
    setPeek((p) => ({ ...p, [id]: a === null ? `The rollup returned nothing for sealed account ${short(sealedPda(id).toBase58())} (${ms} ms). Only the program can read it.` : typeof a === "string" ? `Refused: ${a}` : `Readable: ${a.data.length} bytes. This should not happen.` }));
  };
  const sellAll = async () => {
    if (!pg || !player) return;
    for (let tier = 0; tier < player.cards.length; tier++) {
      const n = player.cards[tier];
      if (n > 0) await run(`sell ${n} ${TIER_NAMES[tier]}`, undefined, () => pg.methods.sellCards(tier, n).accounts({ wallet: me.publicKey }).transaction());
    }
  };
  const verify = (id: number, t: Table) => config && setVerified((v) => ({ ...v, [id]: verifyPack({ randomness: t.randomness, commitment: t.commitment, revealed: t.revealed, nonce: big(t.nonce) }, config.base_weights, config.hit_weights) }));

  const joined = !!player;
  const chips = player ? big(player.chips) : 0n;
  const price = config ? big(config.pack_price) : 0n;

  return (
    <div className="page">
      <header>
        <h1>Mid-Rip</h1>
        <p className="tag">Buy the pack mid-rip.</p>
        <p className="lede">Card packs drawn by MagicBlock VRF inside a private rollup that nobody can read. Reveal a card, or put the sealed rest on a price clock that drops every 10 ms block, and anyone can buy it mid-rip.</p>
        <ol className="how">
          <li>Open a pack: MagicBlock VRF draws 6 cards (one is a guaranteed hit) into an account only the program can read.</li>
          <li>Rip or sell: rip (reveal) cards one at a time, or put the still-sealed rest on a clock that drops every rollup block.</li>
          <li>Buy mid-rip: anyone can stop the clock and keep ripping. When the pack ends, everything settles to Solana and every card checks against the VRF output.</li>
        </ol>
      </header>

      <section className="me">
        <div>Your wallet (kept in this browser): <a href={EXPLORER_ADDR(me.publicKey.toBase58())} target="_blank" rel="noreferrer">{short(me.publicKey.toBase58())}</a></div>
        {joined ? (
          <div>Chips: <b>{chips.toString()}</b> · Cards: {player!.cards.map((n, i) => `${TIER_NAMES[i]} ${n}`).join(" · ")} {player!.cards.some((n) => n > 0) && config && <button disabled={!!busy} onClick={sellAll}>Sell my cards for {player!.cards.reduce((a, n, i) => a + BigInt(n) * big(i < 2 ? config.base_values[i] : config.hit_values[i - 2]), 0n).toString()} chips</button>}</div>
        ) : (
          <button disabled={!!joinStep || !er} onClick={join}>{joinStep ?? "Get 2,000 play chips"}</button>
        )}
        <label className="botctl"><input type="checkbox" checked={botOn} onChange={(e) => setBotOn(e.target.checked)} /> Demo bot ({botStatus}{botPlayer ? ` · ${big(botPlayer.chips).toString()} chips` : ""})</label>
        <div className="slot">Rollup block <b>{slot.toString()}</b></div>
      </section>

      {error && <div className="error" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice} <button onClick={() => setNotice(null)}>OK</button></div>}

      {!er && !error && <p>Connecting to MagicBlock's private rollup…</p>}

      <section className="tables">
        {[...tableIds].sort((a, b) => {
          const rank = (id: number) => { const t = tables[id]; if (!t) return 9; if (t.holder.equals(me.publicKey) && t.state >= 1 && t.state <= 3) return 0; if (t.state === 3) return 1; if (t.state === 2 || t.state === 1) return 2; if (t.state === 0) return 3; return 4; };
          return rank(a) - rank(b) || a - b;
        }).map((id) => {
          const t = tables[id];
          if (!t) return null;
          const state = forced && STATE.includes(forced as (typeof STATE)[number]) ? forced : STATE[t.state];
          const mine = t.holder.equals(me.publicKey);
          const left = PACK_SIZE - t.revealed_count;
          const ev = config ? evRestMilli(left, t.hit_revealed, big(config.ev_base_milli), big(config.ev_hit_milli)) : 0n;
          const L = t.listing;
          const p = clockPrice(big(L.start_price), big(L.floor_price), big(L.list_slot), big(L.duration_slots), slot);
          const elapsed = slot > big(L.list_slot) ? slot - big(L.list_slot) : 0n;
          const frac = Math.min(1, Number(elapsed) / Math.max(1, Number(big(L.duration_slots))));
          const expired = slot > big(L.end_slot);
          const v = verified[id];
          return (
            <article key={id} className={`table ${state}`}>
              <div className="thead">
                <span>Table {id}</span>
                <span className="badge">{state}</span>
                {t.holder.toBase58() !== "11111111111111111111111111111111" && <span className="holder">{mine ? "you hold it" : botRef.current && t.holder.equals(botRef.current.kp.publicKey) ? "held by the demo bot" : `held by ${short(t.holder.toBase58())}`}</span>}
              </div>
              <div className="cards">
                {Array.from({ length: PACK_SIZE }, (_, i) => {
                  const tier = t.revealed[i];
                  const shown = tier !== 255 && i < t.revealed_count;
                  return <div key={i} className={`card ${shown ? "t" + tier : "sealed"}`}>{shown ? TIER_NAMES[tier] : "sealed"}</div>;
                })}
              </div>
              {(state === "ripping" || state === "listed") && (
                <div className="ev">Sealed rest: {left} cards · worth {milliToChips(ev)} chips on average{t.hit_revealed ? "" : " · the hit is still inside"}</div>
              )}
              {state === "listed" && (
                <div className="clock">
                  <div className="price">{expired ? "unsold" : p.toString()} <small>chips</small></div>
                  <div className="bar"><div style={{ width: `${(1 - frac) * 100}%` }} /></div>
                  <div className="clockmeta">Listed at block {big(L.list_slot).toString()} · {elapsed.toString()} blocks ago · floor {big(L.floor_price).toString()}</div>
                  <div className="clockmeta">The clock starts at 125% of the sealed rest's average value ({milliToChips(big(L.ev_rest_milli))}) and falls to 85% over {big(L.duration_slots).toString()} blocks. Below the average is a bargain on paper.</div>
                </div>
              )}
              {big(t.last_sale.slot) > 0n && (
                <div className="sale">Last sale: rest of pack sold for {big(t.last_sale.price).toString()} chips at block {big(t.last_sale.slot).toString()}, {(big(t.last_sale.slot) - big(t.last_sale.list_slot)).toString()} blocks after listing</div>
              )}
              <div className="actions">
                {(state === "idle" || state === "done") && joined && <button disabled={!!busy || chips < price} onClick={() => open(id)}>Open a pack · {price.toString()} chips</button>}
                {state === "drawing" && <span>MagicBlock VRF is drawing the pack…</span>}
                {state === "ripping" && mine && <><button disabled={!!busy} onClick={() => reveal(id)}>Reveal next card</button><button disabled={!!busy} onClick={() => list(id)}>Sell the sealed rest</button></>}
                {state === "ripping" && !mine && <span>Waiting for the holder to rip or sell…</span>}
                {state === "listed" && !mine && joined && !expired && <button className="buy" disabled={!!busy || chips < p} onClick={() => buy(id, t)}>Buy the rest · {p.toString()}</button>}
                {state === "listed" && mine && <button disabled={!!busy} onClick={() => cancel(id)}>Keep ripping</button>}
                {state === "done" && <button onClick={() => verify(id, t)}>Verify this pack</button>}
                {(state === "ripping" || state === "listed") && <button className="peek" onClick={() => tryRead(id)}>Try to read the sealed cards</button>}
              </div>
              {peek[id] && (state === "ripping" || state === "listed") && <div className="peekres">{peek[id]}</div>}
              {state === "done" && v && (
                <div className={`verify ${v.ok ? "ok" : "bad"}`}>
                  {v.ok ? `Verified: all ${PACK_SIZE} cards match the VRF output and the commitment posted before the first reveal.` : `Did not verify: ${v.reason ?? (v.commitmentOk ? "revealed cards differ" : "commitment differs")}`}
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="proof">
        <h2>Checked on 400 test packs</h2>
        <p>We opened 400 packs on devnet from wallets we control (test transactions, not real users) and checked every one.</p>
        <ul>
          <li>400 of 400 packs verify against their VRF output and commitment (95% interval 99.0% to 100.0%).</li>
          <li>Cards follow the published odds: 9 Legendary, 98 Epic and 293 Rare hits against 12, 88 and 300 expected.</li>
          <li>Packs paid back 93.8% of their price (95% interval 83.3% to 105.4%; designed for 97%). Collector Crypt players got back 94.2% (Bitquery).</li>
          <li>A reveal came back in 167 ms at the median; a VRF draw in 227 ms.</li>
        </ul>
      </section>

      <section className="receipts">
        <h2>Transactions (yours and the demo bot's)</h2>
        {receipts.length === 0 && <p>None yet.</p>}
        <ol>
          {receipts.map((r, i) => (
            <li key={i} className={(r.ok ? "" : "bad") + (r.bot ? " bot" : "")}>
              {r.action}{r.table !== undefined ? ` · table ${r.table}` : ""} · {r.ms} ms{r.slot ? ` · block ${r.slot}` : ""} · {r.base ? <a href={EXPLORER(r.sig)} target="_blank" rel="noreferrer">{short(r.sig)}</a> : <code title={r.sig}>{short(r.sig)}</code>}{r.note ? ` · ${r.note}` : ""}
            </li>
          ))}
        </ol>
      </section>

      <footer>
        Solana devnet with play chips. Program <a href={EXPLORER_ADDR(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">{short(PROGRAM_ID.toBase58())}</a>. Odds: {config ? `Common ${config.base_weights[0]}% / Uncommon ${config.base_weights[1]}% in five slots; one hit slot Rare ${config.hit_weights[0]}% / Epic ${config.hit_weights[1]}% / Legendary ${config.hit_weights[2]}%. Packs pay back ${config.payout_bps / 100}% of their price on average.` : "loading…"}
      </footer>
    </div>
  );
}
