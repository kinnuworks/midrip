import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import {
  base, big, configPda, decode, EXPLORER, EXPLORER_ADDR, loadBurner, PROGRAM_ID, playerPda, program, sealedPda, send, STATE,
  tablePda, teeConnection, TEE_VALIDATOR, VRF_EPHEMERAL_QUEUE, type Config, type Player, type SendResult, type Table,
} from "./lib/chain";
import { clockPrice, evRestMilli, PACK_SIZE, TIER_NAMES, verifyPack, type VerifyResult } from "./lib/packmath";
import "./App.css";

const MAX_TABLES = 32;
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;
const milliToChips = (m: bigint) => (Number(m) / 1000).toFixed(1);

interface Receipt { action: string; table?: number; sig: string; ms: number; slot?: number; ok: boolean; note?: string; base?: boolean }

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
  const erRef = useRef<Connection | null>(null);

  const addReceipt = (r: Receipt) => setReceipts((xs) => [r, ...xs].slice(0, 30));

  // Connect to the private rollup with a token signed by the burner (no popup).
  useEffect(() => {
    (async () => {
      try {
        const c = await teeConnection(me);
        erRef.current = c;
        setEr(c);
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
        const keys = delegated ? [...tableIds.map(tablePda), playerPda(me.publicKey)] : tableIds.map(tablePda);
        const [infos, s] = await Promise.all([er.getMultipleAccountsInfo(keys), er.getSlot()]);
        if (stop) return;
        const next: Record<number, Table> = {};
        tableIds.forEach((id, i) => { const t = decode<Table>("Table", infos[i]?.data); if (t) next[id] = t; });
        setTables(next);
        if (delegated) setPlayer(decode<Player>("Player", infos[infos.length - 1]?.data));
        setSlot(BigInt(s));
      } catch { /* transient RPC error: next tick retries */ }
    };
    tick();
    const h = setInterval(tick, 150);
    return () => { stop = true; clearInterval(h); };
  }, [er, tableIds, me, delegated]);

  const pg = useMemo(() => (er ? program(er, me) : null), [er, me]);
  const pgBase = useMemo(() => program(base, me), [me]);

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

  // One-time setup: devnet SOL for rent from our relayer, then create and delegate the player account.
  const join = useCallback(async () => {
    setJoinStep("Getting devnet SOL for setup…");
    setError(null);
    try {
      const bal = await base.getBalance(me.publicKey);
      if (bal < 10_000_000) {
        const r = await fetch("/api/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: me.publicKey.toBase58() }) });
        if (!r.ok) throw new Error("funding failed: " + (await r.text()));
      }
      setJoinStep("Creating your player account on Solana…");
      const waitFor = async (check: () => Promise<boolean>, tries = 80) => { for (let i = 0; i < tries; i++) { if (await check()) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
      if (!(await base.getAccountInfo(playerPda(me.publicKey)))) {
        await run("join", undefined, () => pgBase.methods.initPlayer().accounts({ wallet: me.publicKey }).transaction(), true);
        if (!(await waitFor(async () => !!(await base.getAccountInfo(playerPda(me.publicKey)))))) throw new Error("player account did not appear on Solana");
      }
      const info = await base.getAccountInfo(playerPda(me.publicKey));
      if (info && info.owner.equals(PROGRAM_ID)) {
        setJoinStep("Moving it into MagicBlock's private rollup…");
        const r = await run("delegate", undefined, () => pgBase.methods.delegatePlayer().accounts({ wallet: me.publicKey, validator: TEE_VALIDATOR }).transaction(), true);
        if (!r || r.err) throw new Error("delegation failed");
      }
      if (!(await waitFor(async () => !(await base.getAccountInfo(playerPda(me.publicKey)))?.owner.equals(PROGRAM_ID)))) throw new Error("delegation did not land");
      setDelegated(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setJoinStep(null);
    }
  }, [me, pgBase, run]);

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
    const accounts = big(t.nonce) <= 9n ? players : [playerPda(me.publicKey)];
    await run("settle to Solana", id, () => pg.methods.settle().accounts({ payer: me.publicKey, table: tablePda(id) }).remainingAccounts(accounts.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true }))).transaction());
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
      </header>

      <section className="me">
        <div>Your wallet (kept in this browser): <a href={EXPLORER_ADDR(me.publicKey.toBase58())} target="_blank" rel="noreferrer">{short(me.publicKey.toBase58())}</a></div>
        {joined ? (
          <div>Chips: <b>{chips.toString()}</b> · Cards: {player!.cards.map((n, i) => `${TIER_NAMES[i]} ${n}`).join(" · ")}</div>
        ) : (
          <button disabled={!!joinStep || !er} onClick={join}>{joinStep ?? "Get 2,000 play chips"}</button>
        )}
        <div className="slot">Rollup block <b>{slot.toString()}</b></div>
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      {!er && !error && <p>Connecting to MagicBlock's private rollup…</p>}

      <section className="tables">
        {tableIds.map((id) => {
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
                {t.holder.toBase58() !== "11111111111111111111111111111111" && <span className="holder">{mine ? "you hold it" : `held by ${short(t.holder.toBase58())}`}</span>}
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
              </div>
              {state === "done" && v && (
                <div className={`verify ${v.ok ? "ok" : "bad"}`}>
                  {v.ok ? `Verified: all ${PACK_SIZE} cards match the VRF output and the commitment posted before the first reveal.` : `Did not verify: ${v.reason ?? (v.commitmentOk ? "revealed cards differ" : "commitment differs")}`}
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="receipts">
        <h2>Your transactions</h2>
        {receipts.length === 0 && <p>None yet.</p>}
        <ol>
          {receipts.map((r, i) => (
            <li key={i} className={r.ok ? "" : "bad"}>
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
