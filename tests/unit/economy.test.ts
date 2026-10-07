import { describe, expect, it } from 'vitest';
import { accLvl, addXp, disCost, fmt, incMul, pasCost, pts, renChance, sellPrice, spawnPrice, spent, pw } from '../../src/core/economy';
import { createSeededRng } from '../../src/core/rng';
import { createInitialState, type GameState, type Perk } from '../../src/core/state';

// Phase 2: economy formulas ported from legacy/app.js — every expectation
// below is the legacy output for the same input (oracle: play the legacy tag).

const fresh = (): GameState => createInitialState();
const rng = (): (() => number) => createSeededRng(42);

function withSkin(s: GameState, perks: Perk[]): GameState {
  s.skins.items = [{ id: 1, theme: 'crypto', rar: 0, perks }];
  s.skins.cur = 1;
  return s;
}

describe('pw / fmt', () => {
  it('pw is 2^l − 1', () => {
    expect(pw(0)).toBe(0);
    expect(pw(1)).toBe(1);
    expect(pw(2)).toBe(3);
    expect(pw(4)).toBe(15);
    expect(pw(10)).toBe(1023);
  });

  it('fmt matches the legacy k/M compaction, including its quirks', () => {
    expect(fmt(0)).toBe('0');
    expect(fmt(999)).toBe('999');
    expect(fmt(1500)).toBe('1500');
    expect(fmt(10000)).toBe('10.0k');
    expect(fmt(12345)).toBe('12.3k');
    expect(fmt(99999)).toBe('100.0k');
    expect(fmt(999999)).toBe('1000.0k'); // legacy quirk: rounds before the 1e6 branch
    expect(fmt(1e6)).toBe('1.0M');
    expect(fmt(2500000)).toBe('2.5M');
  });
});

describe('accLvl / spent / pts', () => {
  it('accLvl grows √-wise with XP (fixture mid-game = level 5)', () => {
    const s = fresh();
    expect(accLvl(s)).toBe(1);
    s.acc.xp = 40;
    expect(accLvl(s)).toBe(2);
    s.acc.xp = 159;
    expect(accLvl(s)).toBe(2);
    s.acc.xp = 160;
    expect(accLvl(s)).toBe(3);
    s.acc.xp = 780;
    expect(accLvl(s)).toBe(5);
  });

  it('free points = level − 1 − spent', () => {
    const s = fresh();
    expect(spent(s)).toBe(0);
    expect(pts(s)).toBe(0); // level 1 grants no points
    s.acc.xp = 160; // level 3 → 2 points
    expect(pts(s)).toBe(2);
    s.acc.s.pow = 1;
    s.acc.s.luck = 1;
    expect(spent(s)).toBe(2);
    expect(pts(s)).toBe(0);
  });
});

describe('spawnPrice / pasCost / disCost / sellPrice', () => {
  it('spawnPrice scales with spawn level and the discount upgrade', () => {
    const s = fresh();
    expect(spawnPrice(s)).toBe(4); // 4 × pw(1) × 1.0
    s.spawnLvl = 4;
    expect(spawnPrice(s)).toBe(60); // 4 × pw(4) = 4 × 15
    s.econ.dis = 1;
    expect(spawnPrice(s)).toBe(55); // × 0.92 → 55.2 → round
    s.econ.dis = 6;
    expect(spawnPrice(s)).toBe(31); // × 0.52 → 31.2 → round (UI caps dis at 6)
    s.spawnLvl = 1;
    s.econ.dis = 6;
    expect(spawnPrice(s)).toBe(2); // 4 × 0.52 → 2.08 → round, min guard 1
  });

  it('upgrade costs double per level (pas ×2, dis ×2.2)', () => {
    const s = fresh();
    expect(pasCost(s)).toBe(70);
    s.econ.pas = 2;
    expect(pasCost(s)).toBe(280);
    s.econ.dis = 1;
    expect(disCost(s)).toBe(132); // 60 × 2.2
    s.econ.dis = 3;
    expect(disCost(s)).toBe(639); // 60 × 2.2³ = 638.88 → round
  });

  it('sellPrice is 80% of pw, floored at 1', () => {
    expect(sellPrice(0)).toBe(1); // max(1, 0)
    expect(sellPrice(1)).toBe(1); // max(1, 0.8 → 1)
    expect(sellPrice(2)).toBe(2); // 3 × 0.8 = 2.4 → 2
    expect(sellPrice(4)).toBe(12); // 15 × 0.8
    expect(sellPrice(6)).toBe(50); // 63 × 0.8 = 50.4 → 50
  });
});

describe('incMul / renChance', () => {
  it('incMul starts at 1.5 and stacks income upgrade, stat and skin perk', () => {
    const s = fresh();
    expect(incMul(s, rng())).toBeCloseTo(1.5, 10);
    s.incLvl = 2;
    s.acc.s.gain = 1;
    expect(incMul(s, rng())).toBeCloseTo(3 * 1.06, 10);
    withSkin(s, [{ t: 'gain', q: 0 }]); // +4%
    expect(incMul(s, rng())).toBeCloseTo(3 * 1.1, 10);
  });

  it('renChance is 50% + 10%/level, capped at 100%', () => {
    const s = fresh();
    expect(renChance(s)).toBeCloseTo(0.5, 10);
    s.renLvl = 3;
    expect(renChance(s)).toBeCloseTo(0.8, 10);
    s.renLvl = 5;
    expect(renChance(s)).toBe(1);
    s.renLvl = 10;
    expect(renChance(s)).toBe(1); // capped
  });
});

describe('addXp', () => {
  it('reports level-ups and grants crates on every third level', () => {
    const s = fresh();
    expect(addXp(s, 39, rng())).toBeNull(); // 39 XP → still level 1
    expect(s.acc.xp).toBe(39);
    expect(addXp(s, 1, rng())).toEqual({ level: 2, crates: 0 });
    s.acc.xp = 159; // next XP crosses level 3 → one crate
    expect(addXp(s, 1, rng())).toEqual({ level: 3, crates: 1 });
    expect(s.acc.crates).toBe(1);
  });

  it('counts crates across multi-level jumps (2 → 3 grants one)', () => {
    const s = fresh();
    s.acc.xp = 39;
    expect(addXp(s, 200, rng())).toEqual({ level: 3, crates: 1 });
    expect(s.acc.crates).toBe(1);
  });

  it("the equipped skin's exp perk boosts the XP gain (+30% at q3)", () => {
    const s = withSkin(fresh(), [{ t: 'exp', q: 3 }]);
    addXp(s, 100, rng());
    expect(s.acc.xp).toBe(130); // 100 × 1.3, perks pre-rolled → no RNG consumed
  });
});
