// Mirrors programs/midrip/src/logic.rs exactly, so anyone can recompute a pack from its VRF output.
import { sha256 } from "@noble/hashes/sha2";

export const PACK_SIZE = 6;
export const BASE_TIERS = 2;
export const TIER_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];

function hashParts(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return sha256(buf);
}
function u64le(b: Uint8Array): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
  return v;
}
function pick(weights: number[], roll: bigint): number {
  const total = BigInt(weights.reduce((a, b) => a + b, 0) || 1);
  let r = roll % total;
  for (let i = 0; i < weights.length; i++) {
    const w = BigInt(weights[i]);
    if (r < w) return i;
    r -= w;
  }
  return weights.length - 1;
}
const enc = new TextEncoder();

export function drawPack(randomness: Uint8Array, baseWeights: number[], hitWeights: number[]): { tiers: number[]; hitPos: number } {
  const hitPos = Number(u64le(hashParts([randomness, enc.encode("hit")])) % BigInt(PACK_SIZE));
  const tiers: number[] = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    const roll = u64le(hashParts([randomness, enc.encode("card"), Uint8Array.of(i)]));
    tiers.push(i === hitPos ? BASE_TIERS + pick(hitWeights, roll) : pick(baseWeights, roll));
  }
  return { tiers, hitPos };
}

export function commitment(randomness: Uint8Array, tiers: number[], nonce: bigint): Uint8Array {
  const n = new Uint8Array(8);
  let v = nonce;
  for (let i = 0; i < 8; i++) { n[i] = Number(v & 0xffn); v >>= 8n; }
  return hashParts([randomness, Uint8Array.from(tiers), n]);
}

export const hex = (b: Uint8Array | number[]) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export interface VerifyResult { ok: boolean; tiers: number[]; hitPos: number; commitmentOk: boolean; revealedOk: boolean; reason?: string }

// Check a finished pack: recompute the draw from the public randomness and compare with the
// commitment posted before the first reveal and with the cards that were revealed.
export function verifyPack(t: { randomness: number[]; commitment: number[]; revealed: number[]; nonce: bigint }, baseWeights: number[], hitWeights: number[]): VerifyResult {
  const rnd = Uint8Array.from(t.randomness);
  if (rnd.every((x) => x === 0)) return { ok: false, tiers: [], hitPos: -1, commitmentOk: false, revealedOk: false, reason: "pack not finished: randomness still sealed" };
  const { tiers, hitPos } = drawPack(rnd, baseWeights, hitWeights);
  const commitmentOk = hex(commitment(rnd, tiers, t.nonce)) === hex(t.commitment);
  const revealedOk = tiers.every((x, i) => t.revealed[i] === 255 || x === t.revealed[i]);
  return { ok: commitmentOk && revealedOk, tiers, hitPos, commitmentOk, revealedOk };
}

// Value of the sealed rest, in milli-chips, from public information only.
export function evRestMilli(cardsLeft: number, hitRevealed: boolean, evBaseMilli: bigint, evHitMilli: bigint): bigint {
  if (cardsLeft === 0) return 0n;
  return hitRevealed ? BigInt(cardsLeft) * evBaseMilli : BigInt(cardsLeft - 1) * evBaseMilli + evHitMilli;
}

export function clockPrice(start: bigint, floor: bigint, listSlot: bigint, duration: bigint, slot: bigint): bigint {
  if (slot <= listSlot || start <= floor) return start > floor ? start : floor;
  const elapsed = slot - listSlot;
  if (elapsed >= duration) return floor;
  return start - ((start - floor) * elapsed) / (duration > 0n ? duration : 1n);
}
