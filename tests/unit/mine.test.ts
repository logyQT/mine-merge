import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { COLS } from '../../src/config';
import { accLvl } from '../../src/core/economy';
import { depth, land, makeRow, planDrop, rowAt, splash, viewRows } from '../../src/core/mine';
import { createSeededRng } from '../../src/core/rng';
import { restore } from '../../src/core/save';
import { createInitialState, type GameState, type MineCell } from '../../src/core/state';

// Phase 2: mine board math ported from legacy/app.js — HP/gem formulas and
// damage rules pinned to the oracle's behavior (see save.test.js for the
// formula copy used by the legacy suite).

const rng = (seed = 42) => createSeededRng(seed);
const fresh = (): GameState => createInitialState();

// Copy of the legacy makeRow HP formula (same one save.test.js pins).
const baseHp = (r: number, lvl: number) => Math.max(1, Math.round(2.5 * Math.pow(1.12, r) * (1 + 0.05 * (lvl - 1))));

const cell = (hp: number, gem = false): MineCell => ({ hp, max: hp, gem });

/** n rows × COLS live cells, all at the given hp. */
function board(hp: number, n: number): MineCell[][] {
  return Array.from({ length: n }, () => Array.from({ length: COLS }, () => cell(hp)));
}

const fixtureText = readFileSync(new URL('./fixtures/save-v1.json', import.meta.url), 'utf8');

describe('makeRow / rowAt', () => {
  it('makeRow: full-HP cells per the 1.12^row formula, gems double HP', () => {
    const s = fresh();
    const row = makeRow(s, 0, rng());
    expect(row).toHaveLength(COLS);
    const base = baseHp(0, accLvl(s));
    row.forEach((c) => {
      expect(c.max).toBe(c.gem ? base * 2 : base);
      expect(c.hp).toBe(c.max);
    });

    s.acc.xp = 780; // account level 5 → +20% HP
    const deep = makeRow(s, 10, rng());
    const base10 = baseHp(10, accLvl(s));
    expect(accLvl(s)).toBe(5);
    deep.forEach((c) => {
      expect(c.max).toBe(c.gem ? base10 * 2 : base10);
      expect(c.hp).toBe(c.max);
    });
  });

  it('gem chance: 15% base, +2%/luck stat', () => {
    const s = fresh();
    const countGems = (rows: number): number => {
      const r = rng(11);
      let g = 0;
      for (let i = 0; i < rows; i++) for (const c of makeRow(s, 0, r)) if (c.gem) g++;
      return g;
    };
    const base = countGems(100); // 500 cells at 15% → ~75
    expect(base).toBeGreaterThan(45);
    expect(base).toBeLessThan(105);

    s.acc.s.luck = 17; // p = 0.15 + 0.34 = 0.49
    const lucky = countGems(50); // 250 cells → ~122
    expect(lucky).toBeGreaterThan(80);
    expect(lucky).toBeLessThan(165);
  });

  it("the skin's luck perk raises the gem chance", () => {
    const s = fresh();
    s.skins.items = [{ id: 1, theme: 'crypto', rar: 0, perks: [{ t: 'luck', q: 3 }] }]; // +6%
    s.skins.cur = 1;
    const r = rng(21);
    let g = 0;
    for (let i = 0; i < 100; i++) for (const c of makeRow(s, 0, r)) if (c.gem) g++;
    expect(g).toBeGreaterThan(70); // p = 0.21 → ~105 of 500
    expect(g).toBeLessThan(145);
  });

  it('rowAt generates missing rows once and caches them', () => {
    const s = fresh();
    expect(s.rows).toHaveLength(0);
    const r2 = rowAt(s, 2, rng());
    expect(s.rows).toHaveLength(3);
    expect(rowAt(s, 2, rng())).toBe(r2); // same object — no re-roll
    expect(rowAt(s, 0, rng())).toBe(s.rows[0]);
  });

  it('restore + rowAt re-peeks the trimmed frontier (boot flow)', () => {
    const s = fresh();
    restore(s, fixtureText);
    expect(s.rows).toHaveLength(s.topRow); // normalize trimmed the peek row
    const r = rowAt(s, s.topRow, rng());
    expect(s.rows).toHaveLength(s.topRow + 1);
    expect(r).toHaveLength(COLS);
    const base = baseHp(s.topRow, accLvl(s));
    r.forEach((c) => {
      expect(c.max).toBe(c.gem ? base * 2 : base);
      expect(c.hp).toBe(c.max);
    });
  });
});

describe('viewRows', () => {
  it('VIEW floor, +2 context below the deepest damage, cap 10', () => {
    const s = fresh();
    s.rows = board(10, 1);
    expect(viewRows(s, rng())).toBe(5); // floor (VIEW)

    s.rows = board(10, 12);
    for (let r = 0; r <= 3; r++) s.rows[r][0].hp = 0; // col 0 dead until row 4
    expect(viewRows(s, rng())).toBe(6); // deepest live row 4 → 4 + 2

    s.rows = board(10, 16);
    for (let r = 0; r <= 9; r++) s.rows[r][0].hp = 0; // deepest live row 10
    expect(viewRows(s, rng())).toBe(10); // 10 + 2 capped at 10
  });
});

describe('splash', () => {
  it('damages left/right/below without killing earns nothing', () => {
    const s = fresh();
    s.rows = board(10, 5);
    expect(splash(s, 1, 2, 5, rng())).toBe(0);
    expect(s.rows[1][1].hp).toBe(5);
    expect(s.rows[1][3].hp).toBe(5);
    expect(s.rows[2][2].hp).toBe(5);
    expect(s.rows[1][2].hp).toBe(10); // source untouched
  });

  it('lethal splash earns per destroyed block (gems ×6, depth scaling)', () => {
    const s = fresh();
    s.rows = board(10, 5);
    s.rows[1][1].gem = true; // dies → (1 + floor(1/3)) × 6 = 6
    s.rows[1][3].hp = 3; // dies → 1
    s.rows[2][2].hp = 1; // dies → 1
    expect(splash(s, 1, 2, 10, rng())).toBe(8);
    expect(s.rows[1][1].hp).toBe(0); // clamped at 0, never negative
    expect(s.rows[1][3].hp).toBe(0);
  });

  it('edge and pre-destroyed cells are skipped', () => {
    const s = fresh();
    s.rows = board(10, 6);
    // c=0: no left neighbor; row 3+ earns 1 + floor(r/3) = 2 each
    expect(splash(s, 3, 0, 100, rng())).toBe(4); // (3,1) → 2, (4,0) → 2

    s.rows = board(10, 5);
    s.rows[1][1].hp = 0; // already dead → not damaged, no earn
    expect(splash(s, 1, 2, 100, rng())).toBe(2); // only (1,3) and (2,2)
    expect(s.rows[1][1].hp).toBe(0);
  });
});

describe('land', () => {
  it('consumes damage down the column, reports first row and coins', () => {
    const s = fresh();
    s.rows = board(10, 6);
    const out = land(s, 2, 3, 12, rng()); // no blast upgrade → no splash
    expect(out).toEqual({ e: 1, fr: 0 }); // row 0 destroyed → 1 + floor(0/3)
    expect(s.rows[0][2].hp).toBe(0);
    expect(s.rows[1][2].hp).toBe(8); // remaining 2 damage
    expect(s.rows[2][2].hp).toBe(10); // untouched

    // Damage continues past dead blocks to the next live one.
    const out2 = land(s, 2, 1, 8, rng());
    expect(out2).toEqual({ e: 1, fr: 1 }); // row 1 destroyed on the walk down
    expect(s.rows[1][2].hp).toBe(0);
    expect(s.rows[2][2].hp).toBe(10); // still untouched
  });

  it('destroyed gems earn ×6', () => {
    const s = fresh();
    s.rows = board(10, 4);
    s.rows[0][1].gem = true;
    const out = land(s, 1, 1, 10, rng());
    expect(out).toEqual({ e: 6, fr: 0 });
    expect(s.rows[0][1].hp).toBe(0);
  });

  it('splashes from the first block when blast upgrades are owned', () => {
    const s = fresh();
    s.blastLvl = 1;
    s.rows = board(10, 5);
    // L=4 → pw(4)=15 → round(15 × 0.25 × 1) = 4 splash, source takes only the ball dmg
    const out = land(s, 2, 4, 1, rng());
    expect(out).toEqual({ e: 0, fr: 0 });
    expect(s.rows[0][1].hp).toBe(6);
    expect(s.rows[0][3].hp).toBe(6);
    expect(s.rows[1][2].hp).toBe(6);
    expect(s.rows[0][2].hp).toBe(9);

    // Splash kills count toward earnings too.
    s.rows = board(10, 5);
    s.rows[1][2].hp = 3;
    const out2 = land(s, 2, 4, 10, rng());
    expect(out2).toEqual({ e: 2, fr: 0 }); // splash kill (1) + first block (1)
    expect(s.rows[1][2].hp).toBe(0);
  });

  it('the blast perk adds fractional splash (legacy bl = blastLvl + perk)', () => {
    const s = fresh(); // blastLvl 0
    s.skins.items = [{ id: 1, theme: 'crypto', rar: 0, perks: [{ t: 'blast', q: 0 }] }]; // +0.4
    s.skins.cur = 1;
    s.rows = board(10, 5);
    land(s, 2, 4, 1, rng()); // splash round(15 × 0.25 × 0.4) = round(1.5) = 2
    expect(s.rows[0][1].hp).toBe(8);
    expect(s.rows[1][2].hp).toBe(8);
  });
});

describe('planDrop', () => {
  it('stacks planned damage down the column for later balls', () => {
    const s = fresh();
    s.rows = board(10, 6);
    const pend: Record<string, number> = {};
    expect(planDrop(s, 1, 15, pend, rng())).toBe(0);
    expect(pend).toEqual({ '0,1': 10, '1,1': 5 });

    // Second ball skips fully-planned row 0 and the 5-damaged row 1.
    expect(planDrop(s, 1, 20, pend, rng())).toBe(1);
    expect(pend).toEqual({ '0,1': 10, '1,1': 10, '2,1': 10, '3,1': 5 });

    // Third ball skips rows whose remaining HP is already fully planned.
    expect(planDrop(s, 1, 1, pend, rng())).toBe(3);
    expect(pend['3,1']).toBe(6);
  });

  it('skips pre-destroyed rows even without pending damage', () => {
    const s = fresh();
    s.rows = board(10, 6);
    s.rows[0][1].hp = 0;
    s.rows[1][1].hp = 0;
    expect(planDrop(s, 1, 5, {}, rng())).toBe(2);
  });
});

describe('depth', () => {
  it('is topRow × 2 (fixture mid-game: 12 rows → 24 m)', () => {
    const s = fresh();
    expect(depth(s)).toBe(0);
    s.topRow = 12;
    expect(depth(s)).toBe(24);
  });
});
