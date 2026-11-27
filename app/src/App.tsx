import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import {
  base, big, configPda, decode, ensurePlayer, mintPda, EXPLORER, EXPLORER_ADDR, loadBurner, PROGRAM_ID, playerPda, program, sealedPda, send, STATE,
  tablePda, teeConnection, VRF_EPHEMERAL_QUEUE, type Config, type Player, type SendResult, type Table,
} from "./lib/chain";
import { clockPrice, evRestMilli, PACK_SIZE, TIER_NAMES, verifyPack, type VerifyResult } from "./lib/packmath";
import { Bot } from "./lib/bot";
import { verifyTeeRpcIntegrity } from "@magicblock-labs/ephemeral-rollups-sdk";
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
  const [attested, setAttested] = useState<null | boolean>(null);
  const slotHist = useRef<{ t: number; s: bigint }[]>([]);
  const [bps, setBps] = useState<number | null>(null);
  const [settled, setSettled] = useState<Record<number, { sig: string; nonce: string }>>({});
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
  // The moment a buyer stops a clock: hold the frozen price on screen for a few seconds.
  const [frozen, setFrozen] = useState<Record<number, { price: bigint; slot: bigint; list: bigint; at: number }>>({});
  const addReceipt = (r: Receipt) => setReceipts((xs) => [r, ...xs].slice(0, 30));

  // Connect to the private rollup with a token signed by the burner (no popup).
  useEffect(() => {
    (async () => {
      try {
        verifyTeeRpcIntegrity("https://devnet-tee.magicblock.app").then(() => setAttested(true), () => setAttested(false));
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
          if (before && big(t.last_sale.slot) > big(before.last_sale.slot)) {
            setFrozen((f) => ({ ...f, [Number(k)]: { price: big(t.last_sale.price), slot: big(t.last_sale.slot), list: big(t.last_sale.list_slot), at: Date.now() } }));
          }
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
        const hist = slotHist.current;
        hist.push({ t: performance.now(), s: BigInt(s) });
        while (hist.length > 2 && hist[hist.length - 1].t - hist[0].t > 3000) hist.shift();
        if (hist.length > 2) { const a = hist[0], b = hist[hist.length - 1]; if (b.t > a.t) setBps(Math.round((Number(b.s - a.s) * 1000) / (b.t - a.t))); }
      } catch { /* transient RPC error: next tick retries */ }
    };
    tick();
    const h = setInterval(tick, 150);
    return () => { stop = true; clearInterval(h); };
  }, [er, tableIds, me, delegated]);

  const pg = useMemo(() => (er ? program(er, me) : null), [er, me]);

  // For each finished pack, find the commit that settled the table on Solana (first 9 packs per table).
  useEffect(() => {
    for (const [k, t] of Object.entries(tables)) {
      const id = Number(k);
      const nonce = t.nonce.toString();
      if (t.state !== 4 || big(t.nonce) > 9n || settled[id]?.nonce === nonce) continue;
      base.getSignaturesForAddress(tablePda(id), { limit: 1 }).then((sigs) => {
        if (sigs[0] && !sigs[0].err) setSettled((m) => ({ ...m, [id]: { sig: sigs[0].signature, nonce } }));
      }).catch(() => {});
    }
  }, [tables, settled]);

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
  const buy = async (id: number, t: Table) => {
    if (!pg) return;
    const r = await run("buy the rest", id, () => pg.methods.buyRest().accounts({ buyer: me.publicKey, sellerPlayer: playerPda(t.holder), table: tablePda(id) }).transaction());
    if (r && !r.err) setNotice(`Bought: your press landed in rollup block ${r.slot ?? "?"}, ${r.ms} ms after you clicked. Fee: 0. The sealed rest of table ${id} is yours; keep ripping.`);
  };
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
  // Move cards out of play and mint them as SPL tokens in this wallet on Solana:
  // withdraw on the rollup, commit to Solana, then claim on Solana.
  const [owned, setOwned] = useState<number[] | null>(null);
  const toWallet = async () => {
    if (!pg || !player) return;
    const counts = [...player.cards];
    for (let tier = 0; tier < counts.length; tier++) if (counts[tier] > 0) await run(`withdraw ${counts[tier]} ${TIER_NAMES[tier]}`, undefined, () => pg.methods.withdrawCards(tier, counts[tier]).accounts({ wallet: me.publicKey }).transaction());
    await run("settle to Solana", undefined, () => pg.methods.settlePlayers().accounts({ payer: me.publicKey }).remainingAccounts([{ pubkey: playerPda(me.publicKey), isSigner: false, isWritable: true }]).transaction());
    setBusy("claim");
    const target = player.withdrawn.map((w, i) => w + counts[i]);
    for (let i = 0; i < 80; i++) {
      const p = decode<Player>("Player", (await base.getAccountInfo(playerPda(me.publicKey)))?.data);
      if (p && p.withdrawn.every((w, k) => w >= target[k])) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if ((await base.getBalance(me.publicKey)) < 10_000_000) await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: me.publicKey.toBase58() }) });
    const pgBase = program(base, me);
    for (let tier = 0; tier < counts.length; tier++) if (target[tier] > 0) await run(`claim ${TIER_NAMES[tier]} tokens`, undefined, () => pgBase.methods.claimCards(tier).accountsPartial({ wallet: me.publicKey, mint: mintPda(tier) }).transaction(), true);
    const bal: number[] = [];
    for (let tier = 0; tier < 5; tier++) {
      const a = (await base.getParsedTokenAccountsByOwner(me.publicKey, { mint: mintPda(tier) })).value[0];
      bal.push(a ? Number(a.account.data.parsed.info.tokenAmount.amount) : 0);
    }
    setOwned(bal);
  };
  const verify = (id: number, t: Table) => config && setVerified((v) => ({ ...v, [id]: verifyPack({ randomness: t.randomness, commitment: t.commitment, revealed: t.revealed, nonce: big(t.nonce) }, config.base_weights, config.hit_weights) }));

  const joined = !!player;
  const chips = player ? big(player.chips) : 0n;
  const price = config ? big(config.pack_price) : 0n;
  const now = Date.now();

  const rank = (id: number) => { const t = tables[id]; if (!t) return 9; if (t.holder.equals(me.publicKey) && t.state >= 1 && t.state <= 3) return 0; if (t.state === 3) return 1; if (t.state === 2 || t.state === 1) return 2; if (t.state === 0) return 3; return 4; };
  const order = [...tableIds].filter((id) => tables[id]).sort((a, b) => rank(a) - rank(b) || a - b);
  const [heroId, ...restIds] = order;

  const renderTable = (id: number, hero = false) => {
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
    const fz = frozen[id] && now - frozen[id].at < 6000 && state !== "listed" ? frozen[id] : null;
    const holderLabel = t.holder.toBase58() !== "11111111111111111111111111111111" ? (mine ? "you hold it" : botRef.current && t.holder.equals(botRef.current.kp.publicKey) ? "held by the demo bot" : `held by ${short(t.holder.toBase58())}`) : null;
    return (
      <article key={id} id={hero ? "live" : undefined} className={`table ${state}${hero ? " hero-table" : ""}${mine ? " mine" : ""}`}>
        <div className="thead">
          <span className="tname" data-n={id}>Table {id}</span>
          <span className="badge">{state}</span>
          {holderLabel && <span className="holder">{holderLabel}</span>}
        </div>
        {state === "listed" && (
          <div className="clock">
            <div className="price ui-num">{expired ? "unsold" : <>{p.toString()} <small>chips</small></>}</div>
            <div className="bar" aria-hidden="true"><div style={{ width: `${(1 - frac) * 100}%` }} /></div>
            <div className="clockmeta ui-num">Listed at block {big(L.list_slot).toString()} · {elapsed.toString()} blocks ago · floor {big(L.floor_price).toString()}</div>
            <div className="clockexp">The clock starts at 125% of the sealed rest's average value ({milliToChips(big(L.ev_rest_milli))}) and falls to 85% over {big(L.duration_slots).toString()} blocks. Below the average is a bargain on paper.</div>
          </div>
        )}
        {fz && (
          <div className="clock frozen" role="status">
            <div className="price ui-num">{fz.price.toString()} <small>chips</small></div>
            <div className="clockmeta ui-num">Stopped at block {fz.slot.toString()} · {(fz.slot - fz.list).toString()} blocks after listing</div>
          </div>
        )}
        <div className="cards">
          {Array.from({ length: PACK_SIZE }, (_, i) => {
            const tier = t.revealed[i];
            const shown = tier !== 255 && i < t.revealed_count;
            return (
              <div key={i} className={`card ${shown ? "t" + tier : "sealed"}`}>
                <span className="card-name">{shown ? TIER_NAMES[tier] : "sealed"}</span>
              </div>
            );
          })}
        </div>
        {(state === "ripping" || state === "listed") && (
          <div className="ev ui-num">Sealed rest: {left} cards · worth {milliToChips(ev)} chips on average{t.hit_revealed ? "" : " · the hit is still inside"}</div>
        )}
        {big(t.last_sale.slot) > 0n && (
          <div className="sale ui-num">Last sale: rest of pack sold for {big(t.last_sale.price).toString()} chips at block {big(t.last_sale.slot).toString()}, {(big(t.last_sale.slot) - big(t.last_sale.list_slot)).toString()} blocks after listing</div>
        )}
        <div className="actions">
          {(state === "idle" || state === "done") && joined && <button className="ui-btn" disabled={!!busy || chips < price} onClick={() => open(id)}>Open a pack · {price.toString()} chips</button>}
          {state === "drawing" && <span className="wait">MagicBlock VRF is drawing the pack…</span>}
          {state === "ripping" && mine && <><button className="ui-btn" disabled={!!busy} onClick={() => reveal(id)}>Reveal next card</button><button className="ui-btn ui-btn--ghost" disabled={!!busy} onClick={() => list(id)}>Sell the sealed rest</button></>}
          {state === "ripping" && !mine && <span className="wait">Waiting for the holder to rip or sell…</span>}
          {state === "listed" && !mine && joined && !expired && <button className="ui-btn buy" disabled={!!busy || chips < p} onClick={() => buy(id, t)}>Buy the rest · {p.toString()}</button>}
          {state === "listed" && mine && <button className="ui-btn ui-btn--ghost" disabled={!!busy} onClick={() => cancel(id)}>Keep ripping</button>}
          {state === "done" && <button className="ui-btn ui-btn--ghost" onClick={() => verify(id, t)}>Verify this pack</button>}
          {(state === "ripping" || state === "listed") && <button className="ui-btn ui-btn--quiet peek" onClick={() => tryRead(id)}>Try to read the sealed cards</button>}
        </div>
        {peek[id] && (state === "ripping" || state === "listed") && <div className="peekres">{peek[id]}</div>}
        {state === "done" && settled[id] && <div className="settled">Settled to Solana: <a href={EXPLORER(settled[id].sig)} target="_blank" rel="noreferrer">{short(settled[id].sig)}</a></div>}
        {state === "done" && v && (
          <div className={`verify ${v.ok ? "ok" : "bad"}`}>
            {v.ok ? `Verified: all ${PACK_SIZE} cards match the VRF output and the commitment posted before the first reveal.` : `Did not verify: ${v.reason ?? (v.commitmentOk ? "revealed cards differ" : "commitment differs")}`}
          </div>
        )}
      </article>
    );
  };

  const joinBtn = !joined && (
    <button className="ui-btn join" disabled={!!joinStep || !er} onClick={join}>{joinStep ?? "Get 2,000 play chips"}</button>
  );

  const wallet = (
    <section className="me" aria-label="Your wallet">
      <div className="me-id">Your wallet (kept in this browser): <a href={EXPLORER_ADDR(me.publicKey.toBase58())} target="_blank" rel="noreferrer">{short(me.publicKey.toBase58())}</a></div>
      {joined ? (
        <div className="me-chips ui-num">Chips: <b>{chips.toString()}</b> · Cards: {player!.cards.map((n, i) => `${TIER_NAMES[i]} ${n}`).join(" · ")}</div>
      ) : null}
      {joined && player!.cards.some((n) => n > 0) && (
        <div className="me-actions">
          <button className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!!busy} onClick={toWallet}>Move my cards to my wallet</button>
          {config && <button className="ui-btn ui-btn--ghost ui-btn--sm" disabled={!!busy} onClick={sellAll}>Sell my cards for {player!.cards.reduce((a, n, i) => a + BigInt(n) * big(i < 2 ? config.base_values[i] : config.hit_values[i - 2]), 0n).toString()} chips</button>}
        </div>
      )}
      <label className="botctl"><input type="checkbox" checked={botOn} onChange={(e) => setBotOn(e.target.checked)} /> Demo bot ({botStatus}{botPlayer ? ` · ${big(botPlayer.chips).toString()} chips` : ""})</label>
      {owned && <div className="owned">In your wallet on Solana: {owned.map((n, i) => n > 0 ? <span key={i}><a href={EXPLORER_ADDR(mintPda(i).toBase58())} target="_blank" rel="noreferrer">{TIER_NAMES[i]}</a> {n} · </span> : null)}<a href={EXPLORER_ADDR(me.publicKey.toBase58())} target="_blank" rel="noreferrer">your wallet on Explorer</a></div>}
    </section>
  );

  const lede2 = "Reveal a card, or put the sealed rest on a price clock that drops every 10 ms block, and anyone can buy it mid-rip.";
  const slotPill = <div className="slot ui-num">Rollup block <b>{slot.toString()}</b>{bps ? ` · ${bps} blocks/s` : ""}{attested ? " · TEE attested" : ""}</div>;
  const heroHint = heroId !== undefined && tables[heroId]?.state === 3 && !tables[heroId].holder.equals(me.publicKey) ? <p className="hint">Watch this clock. Press Buy before someone else does.</p> : null;
  const heroTable = heroId !== undefined ? <>{renderTable(heroId, true)}{heroHint}</> : <div className="table hero-table placeholder"><p className="wait">Connecting to MagicBlock's private rollup…</p></div>;

  return (
    <div className="page">
      <div className="main">
        <nav className="nav">
          <a className="brand" href="#top">Mid-Rip</a>
          <div className="nav-links">
            <a href="#live">Tables</a>
            <a href="#how">How it works</a>
            <a href="#proof">Proof</a>
            <a href="#receipts">Transactions</a>
          </div>
          {slotPill}
        </nav>

        <header className="hero" id="top">
          <Blocks />
          <h1 className="wordmark">Mid-Rip<span className="overprint" aria-hidden="true">Mid-Rip</span></h1>
          <div className="hero-copy">
            <p className="tag">Buy the pack mid-rip.</p>
            <p className="lede">Card packs drawn by MagicBlock VRF inside a private rollup that nobody can read.</p>
            {joinBtn}
          </div>
          <div className="hero-stage"><p className="lede-2">{lede2}</p>{heroTable}</div>
        </header>

        <section className="stats" aria-label="Checked on 400 test packs">
          <div><b className="ui-num">400 of 400</b><span>packs verify</span></div>
          <div><b className="ui-num">93.8%</b><span>paid back</span></div>
          <div><b className="ui-num">227 ms</b><span>median VRF draw</span></div>
        </section>

        {Object.keys(tables).length > 0 && (
          <section className="live-stats" aria-label="Live on devnet">
            <p className="ui-num">Live on devnet: {Object.values(tables).reduce((a, t) => a + Number(t.nonce.toString()), 0)} packs opened across {Object.keys(tables).length} tables.</p>
            <ul className="steals">
              {Object.entries(tables).filter(([, t]) => t.state === 4 && t.sales_count > 0).slice(0, 4).map(([k, t]) => {
                const left = t.last_sale.cards_left;
                const after = t.revealed.slice(PACK_SIZE - left).filter((x) => x !== 255).map((x) => TIER_NAMES[x]);
                const hit = after.find((n) => n === "Rare" || n === "Epic" || n === "Legendary");
                return <li key={k}>Table {k}: the sealed {left} sold for {big(t.last_sale.price).toString()} chips mid-rip; the buyer pulled {hit ? <b>{hit}</b> : "no hit"} ({after.join(", ")}).</li>;
              })}
            </ul>
          </section>
        )}
        {error && <div className="error" role="alert">{error}</div>}
        {notice && <div className="notice" role="status">{notice} <button className="ui-btn ui-btn--sm" onClick={() => setNotice(null)}>OK</button></div>}

        <section className="tables-wrap">
          <h2 className="sec-title">Tables</h2>
          <div className="tables">
            {restIds.map((id) => renderTable(id))}
          </div>
        </section>

        {wallet}

        <section className="how-wrap" id="how">
          <h2 className="sec-title">How it works</h2>
          <ol className="how">
            <li><b>Open a pack:</b> MagicBlock VRF draws 6 cards (one is a guaranteed hit) into an account only the program can read.</li>
            <li><b>Rip or sell:</b> rip (reveal) cards one at a time, or put the still-sealed rest on a clock that drops every rollup block.</li>
            <li><b>Buy mid-rip:</b> anyone can stop the clock and keep ripping. When the pack ends, everything settles to Solana and every card checks against the VRF output.</li>
          </ol>
        </section>

        <section className="proof" id="proof">
          <h2 className="sec-title">Checked on 400 test packs</h2>
          <p>We opened 400 packs on devnet from wallets we control (test transactions, not real users) and checked every one.</p>
          <ul>
            <li>400 of 400 packs verify against their VRF output and commitment (95% interval 99.0% to 100.0%).</li>
            <li>Cards follow the published odds: 9 Legendary, 98 Epic and 293 Rare hits against 12, 88 and 300 expected.</li>
            <li>Packs paid back 93.8% of their price (95% interval 83.3% to 105.4%; designed for 97%). Collector Crypt players got back 94.2% (Bitquery).</li>
            <li>A reveal came back in 167 ms at the median; a VRF draw in 227 ms.</li>
          </ul>
          <p>Every pack with its randomness and commitment: <a href="https://github.com/kinnuworks/midrip/blob/master/evidence/packs-run1.json" target="_blank" rel="noreferrer">run 1</a>, <a href="https://github.com/kinnuworks/midrip/blob/master/evidence/packs-run2.json" target="_blank" rel="noreferrer">run 2</a>. Rerun: <code>cd app &amp;&amp; PACKS=300 node scripts/evidence.mjs</code>.</p>
        </section>

        <section className="receipts" id="receipts">
          <h2 className="sec-title">Transactions (yours and the demo bot's)</h2>
          {receipts.length === 0 && <p>None yet.</p>}
          <ol>
            {receipts.map((r, i) => (
              <li key={i} className={(r.ok ? "" : "bad") + (r.bot ? " bot" : "")}>
                <span className="r-action">{r.action}{r.table !== undefined ? ` · table ${r.table}` : ""}</span>
                <span className="r-meta ui-num">{r.ms} ms{r.slot ? ` · block ${r.slot}` : ""} · {r.base ? <a href={EXPLORER(r.sig)} target="_blank" rel="noreferrer">{short(r.sig)}</a> : <code title={r.sig}>{short(r.sig)}</code>}{r.note ? ` · ${r.note}` : ""}</span>
              </li>
            ))}
          </ol>
        </section>

        <footer>
          Solana devnet with play chips. Program <a href={EXPLORER_ADDR(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">{short(PROGRAM_ID.toBase58())}</a>. Odds: {config ? `Common ${config.base_weights[0]}% / Uncommon ${config.base_weights[1]}% in five slots; one hit slot Rare ${config.hit_weights[0]}% / Epic ${config.hit_weights[1]}% / Legendary ${config.hit_weights[2]}%. Packs pay back ${config.payout_bps / 100}% of their price on average.` : "loading…"}
        </footer>
      </div>
    </div>
  );
}

// Backdrop: flat pixel blocks in the card rarity colours (cells are 100 px on desktop).
const BLOCKS: [number, number, number, number, string, boolean?][] = [
  [0, 0, 0.5, 0.5, "pink"], [0.5, 0.5, 0.5, 0.5, "green"], [1, 1, 1.43, 2, "green", true], [0, 3, 1, 2, "pink"],
  [11, 1, 3.4, 2, "green"], [13.6, 4, 0.8, 1, "yellow", true], [11, 5, 2.5, 1, "pink", true], [10.3, 3.9, 0.7, 1, "cyan"],
  [9.75, 6, 1.25, 0.5, "cyan"], [12.25, 6, 1.25, 0.5, "green"], [11, 6.5, 1.25, 0.5, "yellow"], [13.5, 6.5, 0.9, 0.5, "pink"],
];
function Blocks() {
  return (
    <div className="blocks" aria-hidden="true">
      {BLOCKS.map(([x, y, w, h, c, dots], i) => (
        <i key={i} className={`blk ${c}${dots ? " dots" : ""}`} style={{ "--x": x, "--y": y, "--w": w, "--h": h } as CSSProperties} />
      ))}
    </div>
  );
}
