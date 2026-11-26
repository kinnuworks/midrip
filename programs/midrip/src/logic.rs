//! Pure game math, shared by the program and the host tests.

pub const PACK_SIZE: usize = 6;
pub const NUM_TIERS: usize = 5;
/// Tiers 0..2 come from the base slots, tiers 2..5 from the hit slot.
pub const BASE_TIERS: usize = 2;
pub const HIT_TIERS: usize = 3;
pub const BPS: u64 = 10_000;
/// Values are tracked in milli-chips so expected values stay exact enough.
pub const MILLI: u64 = 1_000;

pub fn hash_parts(parts: &[&[u8]]) -> [u8; 32] {
    solana_sha256_hasher::hashv(parts).to_bytes()
}

fn u64_from(bytes: &[u8; 32]) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&bytes[0..8]);
    u64::from_le_bytes(b)
}

/// Pick an index from weights with a uniform draw in [0, total).
pub fn pick(weights: &[u16], roll: u64) -> usize {
    let total: u64 = weights.iter().map(|w| *w as u64).sum();
    let mut r = roll % total.max(1);
    for (i, w) in weights.iter().enumerate() {
        let w = *w as u64;
        if r < w {
            return i;
        }
        r -= w;
    }
    weights.len() - 1
}

/// Draw a pack from VRF randomness. Returns (tiers by position, hit position).
/// Deterministic, so anyone with the randomness and the odds table can recompute it.
pub fn draw_pack(
    randomness: &[u8; 32],
    base_weights: &[u16; BASE_TIERS],
    hit_weights: &[u16; HIT_TIERS],
) -> ([u8; PACK_SIZE], u8) {
    let h = hash_parts(&[randomness, b"hit"]);
    let hit_pos = (u64_from(&h) % PACK_SIZE as u64) as u8;
    let mut tiers = [0u8; PACK_SIZE];
    for i in 0..PACK_SIZE {
        let h = hash_parts(&[randomness, b"card", &[i as u8]]);
        let roll = u64_from(&h);
        tiers[i] = if i as u8 == hit_pos {
            (BASE_TIERS + pick(hit_weights, roll)) as u8
        } else {
            pick(base_weights, roll) as u8
        };
    }
    (tiers, hit_pos)
}

pub fn commitment(randomness: &[u8; 32], tiers: &[u8; PACK_SIZE], nonce: u64) -> [u8; 32] {
    hash_parts(&[randomness, tiers, &nonce.to_le_bytes()])
}

/// Expected value of one slot in milli-chips.
pub fn ev_milli(weights: &[u16], values: &[u64]) -> u64 {
    let total: u128 = weights.iter().map(|w| *w as u128).sum();
    if total == 0 {
        return 0;
    }
    let num: u128 = weights
        .iter()
        .zip(values.iter())
        .map(|(w, v)| *w as u128 * *v as u128)
        .sum();
    (num * MILLI as u128 / total) as u64
}

/// EV of the sealed rest of a pack, in milli-chips.
/// cards_left = cards not yet revealed; the hit slot is among them unless it was revealed.
pub fn ev_rest_milli(cards_left: u8, hit_revealed: bool, ev_base_milli: u64, ev_hit_milli: u64) -> u64 {
    if cards_left == 0 {
        return 0;
    }
    let (base_left, hit) = if hit_revealed {
        (cards_left as u64, 0)
    } else {
        (cards_left as u64 - 1, ev_hit_milli)
    };
    base_left * ev_base_milli + hit
}

/// Pack price in chips: EV of the pack divided by the payout rate, rounded up.
pub fn pack_price(ev_base_milli: u64, ev_hit_milli: u64, payout_bps: u64) -> u64 {
    let ev_pack = ev_rest_milli(PACK_SIZE as u8, false, ev_base_milli, ev_hit_milli) as u128;
    let num = ev_pack * BPS as u128;
    let den = payout_bps as u128 * MILLI as u128;
    ((num + den - 1) / den) as u64
}

/// Clock price at `slot` for a listing that started at `list_slot`, falling linearly
/// from `start` to `floor` over `duration_slots`, then staying at the floor.
pub fn clock_price(start: u64, floor: u64, list_slot: u64, duration_slots: u64, slot: u64) -> u64 {
    if slot <= list_slot || start <= floor {
        return start.max(floor);
    }
    let elapsed = slot - list_slot;
    if elapsed >= duration_slots {
        return floor;
    }
    let drop = (start - floor) as u128 * elapsed as u128 / duration_slots.max(1) as u128;
    start - drop as u64
}

pub fn bps_of(value_milli: u64, bps: u64) -> u64 {
    (value_milli as u128 * bps as u128 / BPS as u128 / MILLI as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    const BW: [u16; 2] = [80, 20];
    const BV: [u64; 2] = [10, 30];
    const HW: [u16; 3] = [80, 18, 2];
    const HV: [u64; 3] = [120, 400, 2500];

    #[test]
    fn draw_is_deterministic_and_has_one_hit() {
        for seed in 0u8..200 {
            let r = [seed; 32];
            let (a, hp) = draw_pack(&r, &BW, &HW);
            let (b, hp2) = draw_pack(&r, &BW, &HW);
            assert_eq!(a, b);
            assert_eq!(hp, hp2);
            assert!(hp < 6);
            let hits = a.iter().filter(|t| **t >= 2).count();
            assert_eq!(hits, 1, "exactly the hit slot is rare or better");
            assert!(a[hp as usize] >= 2);
        }
    }

    #[test]
    fn draw_frequencies_follow_odds() {
        let mut hit_counts = [0u32; 3];
        let mut base_counts = [0u32; 2];
        for i in 0u32..20_000 {
            let r = hash_parts(&[&i.to_le_bytes()]);
            let (t, _) = draw_pack(&r, &BW, &HW);
            for x in t {
                if x >= 2 { hit_counts[(x - 2) as usize] += 1 } else { base_counts[x as usize] += 1 }
            }
        }
        let rare = hit_counts[0] as f64 / 20_000.0;
        assert!((rare - 0.80).abs() < 0.02, "rare share {rare}");
        let common = base_counts[0] as f64 / 100_000.0;
        assert!((common - 0.80).abs() < 0.01, "common share {common}");
    }

    #[test]
    fn ev_and_price() {
        let eb = ev_milli(&BW, &BV); // 14.000
        let eh = ev_milli(&HW, &HV); // 218.000
        assert_eq!(eb, 14_000);
        assert_eq!(eh, 218_000);
        assert_eq!(ev_rest_milli(6, false, eb, eh), 288_000);
        // 2 commons out, hit still sealed: 3 base + hit
        assert_eq!(ev_rest_milli(4, false, eb, eh), 3 * 14_000 + 218_000);
        // hit already out
        assert_eq!(ev_rest_milli(4, true, eb, eh), 4 * 14_000);
        assert_eq!(ev_rest_milli(0, true, eb, eh), 0);
        assert_eq!(pack_price(eb, eh, 9_700), 297); // 288 / 0.97 = 296.9 -> 297
    }

    #[test]
    fn clock_falls_to_floor() {
        assert_eq!(clock_price(125, 85, 1000, 400, 1000), 125);
        assert_eq!(clock_price(125, 85, 1000, 400, 1200), 105);
        assert_eq!(clock_price(125, 85, 1000, 400, 1400), 85);
        assert_eq!(clock_price(125, 85, 1000, 400, 9999), 85);
        assert_eq!(bps_of(100_000, 12_500), 125);
    }

    #[test]
    fn commitment_binds_cards() {
        let r = [7u8; 32];
        let (t, _) = draw_pack(&r, &BW, &HW);
        let c = commitment(&r, &t, 3);
        let mut t2 = t;
        t2[0] ^= 1;
        assert_ne!(c, commitment(&r, &t2, 3));
        assert_ne!(c, commitment(&r, &t, 4));
    }
}
