import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../../src/core/rng';
import { crateRoll, curItem, curRar, curSkin, itName, itVal, ownedMax, PCOUNT, PERK, perksOf, perk, QW, RAR, rollPerks, rollRar, rollTheme, rnd5, SKINS, CRATES } from '../../src/core/cosmetics';
import { createInitialState, type SkinItem } from '../../src/core/state';

// Phase 2: cosmetics ported from legacy/app.js lines 295–324. Structural and
// statistical pins (seeded RNG) — shuffle output order is intentionally NOT
// pinned exactly: V8's sort comparator count is implementation-defined.

const rng = (seed = 42) => createSeededRng(seed);

describe('rng', () => {
  it('same seed → same sequence, values in [0, 1)', () => {
    const a = rng(7);
    const b = rng(7);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(rng(8)()).not.toBe(seqA[0]); // different seed → different start
  });
});

describe('data tables', () => {
  it('PERK key order is stable (rollPerks shuffles Object.keys)', () => {
    expect(Object.keys(PERK)).toEqual(['pow', 'gain', 'exp', 'blast', 'fire', 'slow', 'luck']);
  });

  it('QW rows and crate odds sum to 100, PCOUNT matches legacy', () => {
    for (const row of QW) expect(row.reduce((a, b) => a + b, 0)).toBe(100);
    expect(CRATES[0].odds.reduce((a, b) => a + b, 0)).toBe(100);
    expect(PCOUNT).toEqual([1, 1, 2, 3]);
    expect(RAR).toHaveLength(4);
  });

  it('the default skin is first; the rest are the buyable themes', () => {
    expect(SKINS[0].id).toBe('def');
    expect(SKINS[0].price).toBe(0);
    expect(SKINS.every((k) => k.name.length > 0)).toBe(true);
  });
});

describe('rolls', () => {
  it('rollRar follows the odds statistically (seeded)', () => {
    const r = rng(1);
    const odds = [60, 25, 11, 4];
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 10000; i++) counts[rollRar(odds, r)]++;
    expect(counts[0]).toBeGreaterThan(5600); // ~6000 ± comfortable band
    expect(counts[0]).toBeLessThan(6400);
    expect(counts[1]).toBeGreaterThan(2200);
    expect(counts[1]).toBeLessThan(2800);
    expect(counts[3]).toBeGreaterThan(200); // ~400
    expect(counts[3]).toBeLessThan(600);
  });

  it('rollRar edge: zero roll lands on the first bucket', () => {
    expect(rollRar([60, 25, 11, 4], () => 0)).toBe(0);
  });

  it('rollPerks grants PCOUNT[rar] perks of valid types and qualities', () => {
    const r = rng(3);
    for (let rar = 0; rar < 4; rar++) {
      for (let i = 0; i < 200; i++) {
        const perks = rollPerks(rar, r);
        expect(perks).toHaveLength(PCOUNT[rar]);
        for (const p of perks) {
          expect(Object.keys(PERK)).toContain(p.t);
          expect(p.q).toBeGreaterThanOrEqual(0);
          expect(p.q).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('perksOf rolls once and caches on the item', () => {
    const r = rng(5);
    const it: SkinItem = { id: 1, theme: 'crypto', rar: 2 };
    const first = perksOf(it, r);
    expect(first).toHaveLength(PCOUNT[2]);
    expect(it.perks).toBe(first);
    expect(perksOf(it, r)).toBe(first); // no re-roll
  });

  it('rollTheme never returns the default skin; rnd5/crateRoll stay in range', () => {
    const r = rng(9);
    for (let i = 0; i < 500; i++) {
      expect(rollTheme(r).id).not.toBe('def');
      const l5 = rnd5(r);
      expect(l5).toBeGreaterThanOrEqual(1);
      expect(l5).toBeLessThanOrEqual(5);
      const cr = crateRoll(4, r);
      expect(cr).toBeGreaterThanOrEqual(1);
      expect(cr).toBeLessThanOrEqual(4);
    }
    expect(crateRoll(1, rng(1))).toBe(1); // m=1 → always 1
  });
});

describe('perk / itVal / equipped skin reads', () => {
  it('perk is 0 without an equipped skin and sums matching perks with one', () => {
    const s = createInitialState();
    expect(perk(s, 'pow', rng())).toBe(0);

    s.skins.items = [{ id: 1, theme: 'crypto', rar: 0, perks: [{ t: 'pow', q: 0 }] }];
    s.skins.cur = 1;
    expect(perk(s, 'pow', rng())).toBe(3); // PERK.pow.v[0]
    expect(perk(s, 'gain', rng())).toBe(0); // no matching perk

    // Multiple perks of the same type sum (q0 + q1 → 3 + 6).
    s.skins.items[0].perks = [
      { t: 'pow', q: 0 },
      { t: 'pow', q: 1 },
    ];
    expect(perk(s, 'pow', rng())).toBe(9);
  });

  it('itVal = rarity value × (1 + 0.15 × Σ perk qualities)', () => {
    const r = rng(2);
    expect(itVal({ id: 1, theme: 'crypto', rar: 0, perks: [{ t: 'pow', q: 1 }] }, r)).toBe(173); // 150 × 1.15
    expect(itVal({ id: 2, theme: 'planet', rar: 3, perks: [{ t: 'pow', q: 3 }, { t: 'luck', q: 3 }] }, r)).toBe(22800); // 12000 × 1.9
  });

  it('curItem/curSkin/curRar fall back to the default skin', () => {
    const s = createInitialState();
    expect(curItem(s)).toBeUndefined();
    expect(curSkin(s).id).toBe('def');
    expect(curRar(s)).toBe(0);

    s.skins.items = [{ id: 1, theme: 'planet', rar: 2, perks: [] }];
    s.skins.cur = 1;
    expect(curItem(s)?.theme).toBe('planet');
    expect(curSkin(s).id).toBe('planet');
    expect(curRar(s)).toBe(2);
    expect(itName(s.skins.items[0])).toBe('Planety · Epicki');
  });

  it('ownedMax: strongest ball across grid + inventory, floor 1', () => {
    const s = createInitialState();
    expect(ownedMax(s)).toBe(1); // empty state floors at 1
    s.grid[3] = 5;
    s.inv = { 7: 2, 2: 0 }; // zero-count entries do not count
    expect(ownedMax(s)).toBe(7);
    s.inv = {};
    expect(ownedMax(s)).toBe(5);
  });
});
