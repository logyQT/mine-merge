import { describe, expect, it } from 'vitest';
import { accLvl } from '../../src/core/economy';
import { createSeededRng, type Rng } from '../../src/core/rng';
import { createInitialState, type GameState } from '../../src/core/state';
import { armyList, enemyArmy, mk, prepareFight, tick, wcost, wEnd, WP, type Fight } from '../../src/core/war';

// Phase 2: war combat ported from legacy/app.js lines 206–259 — deterministic
// seeds pin the RNG paths; balance bands pin the ±3 eLvl band and army sizes.

const rng = (seed = 42): Rng => createSeededRng(seed);
const fresh = (): GameState => createInitialState();

/** Scripted RNG: returns seq values in order, then 1. */
const scripted = (seq: number[]): Rng => {
  let i = 0;
  return () => seq[i++] ?? 1;
};

const fightOf = (eLvl: number): Fight => ({ p: [], e: [], eLvl, over: false, run: false });

describe('mk / wcost / armyList', () => {
  it('mk: hp = pw×4, atk = pw×0.7, cd0 honored, random cd otherwise', () => {
    const m = mk(3, 1, 1, 100, rng());
    expect(m.max).toBe(28); // pw(3) = 7 × 4
    expect(m.hp).toBe(28);
    expect(m.atk).toBeCloseTo(4.9, 10); // 7 × 0.7
    expect(m.cd).toBe(100);
    expect(m.burn).toBe(0);
    expect(m.slow).toBe(0);
    expect(m.wk).toBe(0);
    expect(m.sm).toBe(1);

    const randomCd = mk(2, 1, 1, undefined, createSeededRng(5));
    expect(randomCd.cd).toBeGreaterThanOrEqual(0);
    expect(randomCd.cd).toBeLessThan(500);

    const buffed = mk(3, 1.5, 1.2, 0, rng());
    expect(buffed.max).toBeCloseTo(7 * 4 * 1.2, 10);
    expect(buffed.atk).toBeCloseTo(7 * 0.7 * 1.5, 10);
  });

  it('wcost doubles-ish per level (×2.2)', () => {
    expect(wcost(0)).toBe(100);
    expect(wcost(1)).toBe(220);
    expect(wcost(2)).toBe(484);
  });

  it('armyList: 5 strongest balls from grid + inventory, descending', () => {
    const s = fresh();
    const g = Array(25).fill(0);
    g[0] = 3;
    g[2] = 5;
    g[7] = 1;
    s.grid = g;
    s.inv = { 6: 2, 2: 4 };
    expect(armyList(s)).toEqual([6, 6, 5, 3, 2]);
    expect(armyList(fresh())).toEqual([]);
  });
});

describe('WP', () => {
  it('player power = war upgrades + skin perks (weak has no perk)', () => {
    const s = fresh();
    s.war.fire = 2;
    s.war.slow = 1;
    s.war.weak = 1;
    expect(WP(s, null, 'p', rng())).toEqual({ fire: 2, slow: 1, weak: 1 });

    s.skins.items = [{ id: 1, theme: 'crypto', rar: 0, perks: [{ t: 'fire', q: 2 }] }]; // +1.3
    s.skins.cur = 1;
    const p = WP(s, null, 'p', rng());
    expect(p.fire).toBeCloseTo(3.3, 10);
    expect(p.slow).toBe(1);
    expect(p.weak).toBe(1); // legacy: no skin perk feeds weak
  });

  it('enemy power unlocks from eLvl thresholds (fire 4+, slow 6+, weak 8+)', () => {
    const s = fresh();
    expect(WP(s, fightOf(1), 'e', rng())).toEqual({ fire: 0, slow: 0, weak: 0 });
    expect(WP(s, fightOf(3), 'e', rng())).toEqual({ fire: 0, slow: 0, weak: 0 });
    expect(WP(s, fightOf(4), 'e', rng())).toEqual({ fire: 1, slow: 0, weak: 0 });
    expect(WP(s, fightOf(6), 'e', rng())).toEqual({ fire: 1, slow: 1, weak: 0 });
    expect(WP(s, fightOf(8), 'e', rng())).toEqual({ fire: 2, slow: 1, weak: 1 });
    expect(WP(s, fightOf(10), 'e', rng())).toEqual({ fire: 3, slow: 2, weak: 1 });
  });

  it('a fight with explicit powers overrides both sides (pvp shape)', () => {
    const s = fresh();
    const f = fightOf(1);
    f.pw = {
      p: { fire: 9, slow: 8, weak: 7 },
      e: { fire: 1, slow: 2, weak: 3 },
    };
    expect(WP(s, f, 'p', rng())).toEqual({ fire: 9, slow: 8, weak: 7 });
    expect(WP(s, f, 'e', rng())).toEqual({ fire: 1, slow: 2, weak: 3 });
  });
});

describe('enemyArmy / prepareFight (balance)', () => {
  it('enemyArmy: 1–5 balls, levels ≥ 1, descending, deterministic per seed', () => {
    for (const base of [0.85, 3.05, 5.8]) {
      const a = enemyArmy(base, createSeededRng(42));
      expect(a.length).toBeGreaterThanOrEqual(1);
      expect(a.length).toBeLessThanOrEqual(5);
      a.forEach((l) => expect(l).toBeGreaterThanOrEqual(1));
      expect([...a].sort((x, y) => y - x)).toEqual(a);
    }
    expect(enemyArmy(3.05, createSeededRng(7))).toEqual(enemyArmy(3.05, createSeededRng(7)));
  });

  it('balance: enemy levels for account level 5 stay in band [1, 5]', () => {
    const base = 0.3 + 5 * 0.55; // prepareFight's base for eL = 5
    for (let seed = 0; seed < 100; seed++) {
      for (const l of enemyArmy(base, createSeededRng(seed))) {
        expect(l).toBeGreaterThanOrEqual(1);
        expect(l).toBeLessThanOrEqual(5);
      }
    }
  });

  it('prepareFight: no balls → null fight with the legacy message', () => {
    const { fight, message } = prepareFight(fresh(), rng());
    expect(fight).toBeNull();
    expect(message).toBe('Nie masz kulek! Połącz je na planszy w kopalni.');
  });

  it('prepareFight: eL within ±3 of the account level, armies from state', () => {
    const s = fresh();
    s.acc.xp = 160; // account level 3
    s.grid[0] = 4;
    s.grid[1] = 2;
    s.acc.s.pow = 2;
    s.acc.s.hp = 1;
    for (let seed = 0; seed < 50; seed++) {
      const { fight, message } = prepareFight(s, createSeededRng(seed));
      expect(fight).not.toBeNull();
      const f = fight as Fight;
      expect(f.eLvl).toBeGreaterThanOrEqual(Math.max(1, accLvl(s) - 3));
      expect(f.eLvl).toBeLessThanOrEqual(accLvl(s) + 3);
      expect(f.p).toHaveLength(2);
      expect(f.e.length).toBeGreaterThanOrEqual(1);
      expect(f.e.length).toBeLessThanOrEqual(5);
      expect(f.over).toBe(false);
      expect(f.run).toBe(false);
      expect(message).toContain(`Wróg poz. ${f.eLvl}`);
      expect(message).toContain(`(twoich: 2)`);
    }
    // Stat scaling on the strongest ball (L=4): atk ×(1+0.08·pow), hp ×(1+0.06·hp)
    const { fight } = prepareFight(s, rng());
    const top = (fight as Fight).p[0];
    expect(top.L).toBe(4);
    expect(top.atk).toBeCloseTo(15 * 0.7 * (1 + 0.16), 10);
    expect(top.max).toBeCloseTo(60 * 1.06, 10);
  });
});

describe('wEnd', () => {
  it('win: reward formula, wave advance, XP', () => {
    const s = fresh();
    s.acc.xp = 160; // level 3 — 140 XP does not level up... (160+90 = 250 → level 3)
    const fight: Fight = { p: [mk(4, 1, 1, 0, rng())], e: [], eLvl: 5, over: false, run: true };
    const r = wEnd(s, fight, true, rng());
    expect(fight.over).toBe(true);
    expect(r.coins).toBe(225); // 30 × 5 × (1 + 0.5)
    expect(r.xp).toBe(90); // 40 + 10 × 5
    expect(s.coins).toBe(30 + 225);
    expect(s.war.wave).toBe(2);
    expect(s.acc.xp).toBe(250);
    expect(r.levelUp).toBeNull(); // accLvl(250) = 3, same as before
    expect(r.lostLvl).toBeUndefined();
    expect(r.message).toBe('Zwycięstwo! +🪙225, +90 XP. Kliknij Dalej.');
  });

  it('win at eL 1 pays 33 coins / 50 XP and reports the level-up', () => {
    const s = fresh();
    const fight: Fight = { p: [mk(2, 1, 1, 0, rng())], e: [], eLvl: 1, over: false, run: true };
    const r = wEnd(s, fight, true, rng());
    expect(r.coins).toBe(33); // round(30 × 1.1)
    expect(r.xp).toBe(50);
    expect(r.levelUp).toEqual({ level: 2, crates: 0 });
    expect(s.acc.crates).toBe(0);
  });

  it('loss: 15 coins/XP + 50% ball-loss roll (scripted rng)', () => {
    const s = fresh();
    s.grid[0] = 4;
    const fight: Fight = { p: [mk(4, 1, 1, 0, rng())], e: [], eLvl: 3, over: false, run: true };
    const r = wEnd(s, fight, false, scripted([0.49, 0.99])); // roll < 0.5 → loss, pick index 1
    expect(fight.over).toBe(true);
    expect(r.coins).toBe(15);
    expect(r.xp).toBe(15);
    expect(r.lostLvl).toBe(4);
    expect(s.coins).toBe(45);
    expect(s.grid[0]).toBe(0); // ball removed
    expect(r.message).toBe('Porażka! Tracisz kulkę poz. 4. (+🪙15)');

    const s2 = fresh();
    s2.grid[0] = 4;
    const fight2: Fight = { p: [mk(4, 1, 1, 0, rng())], e: [], eLvl: 3, over: false, run: true };
    const r2 = wEnd(s2, fight2, false, scripted([0.51])); // roll ≥ 0.5 → balls survive
    expect(r2.lostLvl).toBeUndefined();
    expect(s2.grid[0]).toBe(4);
    expect(s2.coins).toBe(45);
    expect(r2.message).toBe('Porażka, ale kulki ocalały! (+🪙15)');
  });
});

describe('tick', () => {
  it('attacks land on cooldown and reset the attacker cooldown to 1000', () => {
    const s = fresh();
    const fight: Fight = { p: [mk(4, 1, 1, 100, rng())], e: [mk(4, 1, 1, 500, rng())], eLvl: 1, over: false, run: true };
    const ev = tick(s, fight, rng());
    expect(ev).toEqual({ hits: 1, kills: 0 });
    expect(fight.e[0].hp).toBeCloseTo(60 - 10.5, 10);
    expect(fight.p[0].cd).toBe(1000); // reset after attacking
    expect(fight.e[0].cd).toBe(400); // still cooling down, no counter-attack
    expect(ev.done).toBeUndefined();
  });

  it('done fires when a side is wiped, with the player-win flag', () => {
    const s = fresh();
    const fight: Fight = { p: [mk(6, 1, 1, 100, rng())], e: [mk(1, 1, 1, 1000, rng())], eLvl: 1, over: false, run: true };
    const ev = tick(s, fight, rng());
    expect(ev.hits).toBe(1);
    expect(ev.kills).toBe(1);
    expect(fight.e[0].hp).toBe(0);
    expect(ev.done).toEqual({ pa: true, ea: false, playerWon: true });
  });

  it('returns early when the fight is over (no mutations)', () => {
    const s = fresh();
    const fight: Fight = { p: [mk(4, 1, 1, 100, rng())], e: [mk(4, 1, 1, 100, rng())], eLvl: 1, over: true, run: false };
    expect(tick(s, fight, rng())).toEqual({ hits: 0, kills: 0 });
    expect(fight.e[0].hp).toBe(60);
  });

  it('fire power burns the victim on every following step', () => {
    const s = fresh();
    s.war.fire = 1;
    const fight: Fight = { p: [mk(4, 1, 1, 100, rng())], e: [mk(4, 1, 1, 500, rng())], eLvl: 1, over: false, run: true };
    tick(s, fight, rng()); // hit → e.burn = 3000; e's own pass same step: −100
    expect(fight.e[0].burn).toBe(2900);
    expect(fight.e[0].bd).toBeCloseTo(10.5 * 0.3, 10);
    expect(fight.e[0].hp).toBeCloseTo(60 - 10.5 - 10.5 * 0.3 * 0.1, 10);
    const hpAfterTick1 = fight.e[0].hp;
    const ev2 = tick(s, fight, rng()); // burn ticks again: −bd × 0.1 s
    expect(ev2.hits).toBe(0);
    expect(fight.e[0].hp).toBeCloseTo(hpAfterTick1 - 10.5 * 0.3 * 0.1, 10);
    expect(fight.e[0].burn).toBe(2800);
  });

  it('slow power stretches the victim’s next attack cooldown (×1.3 at 1)', () => {
    const s = fresh();
    s.war.slow = 1;
    const fight: Fight = { p: [mk(4, 1, 1, 100, rng())], e: [mk(4, 1, 1, 100, rng())], eLvl: 1, over: false, run: true };
    tick(s, fight, rng()); // p slows e first; e attacks in the same step
    expect(fight.e[0].slow).toBe(2400); // 2500 − 100
    expect(fight.e[0].sm).toBeCloseTo(1.3, 10);
    expect(fight.e[0].cd).toBeCloseTo(1300, 10); // 1000 × sm
    expect(fight.p[0].hp).toBeCloseTo(60 - 10.5, 10); // e counter-attacked
  });

  it('kills by the weak power poison ALL defenders (legacy: even the corpse)', () => {
    const s = fresh();
    s.war.weak = 1;
    const fight: Fight = {
      p: [mk(6, 1, 1, 100, rng())],
      e: [mk(1, 1, 1, 1000, rng()), mk(1, 1, 1, 1000, rng())],
      eLvl: 1,
      over: false,
      run: true,
    };
    const ev = tick(s, fight, rng());
    expect(ev.kills).toBe(1);
    expect(ev.done).toBeUndefined(); // one enemy still alive
    expect(fight.e[0].wk).toBeCloseTo(0.12, 10); // corpse gets it too (verbatim)
    expect(fight.e[1].wk).toBeCloseTo(0.12, 10);
  });
});
