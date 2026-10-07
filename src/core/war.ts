// War combat simulation (PLAN.md Phase 2 core/war.ts), ported verbatim from
// legacy/app.js lines 206–259 (minus the view calls: wLog/renderWar/save and
// the sfx.* inside tick — the controller replays those from the event
// counts returned here). Multiplayer (mpBegin/mpEnd) builds on the same
// Fight shape and lands with the multiplayer slice.
// Convention: the injected RNG is always the LAST parameter.

import { perk } from './cosmetics';
import { accLvl, addXp, type LevelUp, pw } from './economy';
import type { Rng } from './rng';
import type { GameState } from './state';

export interface Combatant {
  L: number;
  hp: number;
  max: number;
  atk: number;
  cd: number; // ms until next attack
  burn: number; // ms of burn left
  bd: number; // burn damage per second
  slow: number; // ms of slow left
  sm: number; // slow multiplier for the victim's cooldown
  wk: number; // weakness 0..0.6, raised on kills by the weak power
}

export interface Power {
  fire: number;
  slow: number;
  weak: number;
}

export interface Fight {
  p: Combatant[];
  e: Combatant[];
  eLvl: number;
  over: boolean;
  run: boolean;
  /** PvP overrides the derived powers (set by mpBegin). */
  pw?: { p: Power; e: Power };
  pvp?: boolean;
  /** PvP row order: true when this client renders its army at the top. */
  flip?: boolean;
}

/** Power for one side: player = war upgrades + skin perks, enemy = from eLvl. */
export function WP(s: GameState, fight: Fight | null, side: 'p' | 'e', rng: Rng): Power {
  if (fight?.pw) return fight.pw[side];
  const L = fight ? fight.eLvl : 1;
  if (side === 'p') {
    return {
      fire: s.war.fire + perk(s, 'fire', rng),
      slow: s.war.slow + perk(s, 'slow', rng),
      weak: s.war.weak,
    };
  }
  return {
    fire: L >= 4 ? Math.floor((L - 1) / 3) : 0,
    slow: L >= 6 ? Math.floor((L - 3) / 3) : 0,
    weak: L >= 8 ? Math.floor((L - 5) / 3) : 0,
  };
}

/** Cost of the next level of a war upgrade (legacy wcost). */
export const wcost = (l: number): number => Math.round(100 * Math.pow(2.2, l));

/** Builds one combatant; without cd0 the starting cooldown is random 0–500 ms. */
export function mk(L: number, am = 1, hm = 1, cd0?: number, rng: Rng = Math.random): Combatant {
  const m = pw(L) * 4 * hm;
  return {
    L,
    hp: m,
    max: m,
    atk: pw(L) * 0.7 * am,
    cd: cd0 == null ? rng() * 500 : cd0,
    burn: 0,
    bd: 0,
    slow: 0,
    sm: 1,
    wk: 0,
  };
}

/** The 5 strongest balls from grid + inventory (legacy armyList). */
export function armyList(s: GameState): number[] {
  const a = s.grid.filter((x) => x);
  Object.keys(s.inv).forEach((k) => {
    for (let i = 0; i < s.inv[k]; i++) a.push(+k);
  });
  return a.sort((x, y) => y - x).slice(0, 5);
}

/** Random enemy army around the given difficulty base (legacy enemyArmy). */
export function enemyArmy(base: number, rng: Rng): number[] {
  const U = 3 * Math.pow(2, base - 1) * (0.7 + rng() * 0.6);
  const n = 1 + Math.floor(rng() * 5);
  const w = Array.from({ length: n }, () => 0.3 + rng());
  const sw = w.reduce((x, y) => x + y, 0);
  return w
    .map((x) => Math.floor(Math.log2(Math.max(1, (U * x) / sw))) + 1)
    .sort((x, y) => y - x);
}

export interface PreparedFight {
  fight: Fight | null;
  /** Message for the war log (Polish, verbatim from legacy prepare()). */
  message: string;
}

/** Rolls the next battle. fight is null when the player has no balls. */
export function prepareFight(s: GameState, rng: Rng): PreparedFight {
  const pl = armyList(s);
  if (!pl.length) {
    return { fight: null, message: 'Nie masz kulek! Połącz je na planszy w kopalni.' };
  }
  const eL = Math.max(1, accLvl(s) + Math.floor(rng() * 7) - 3);
  const base = 0.3 + eL * 0.55;
  const fight: Fight = {
    p: pl.map((L) =>
      mk(L, 1 + 0.08 * s.acc.s.pow + perk(s, 'pow', rng) / 100, 1 + 0.06 * s.acc.s.hp, undefined, rng),
    ),
    e: enemyArmy(base, rng).map((L) => mk(L, 1, 1, undefined, rng)),
    eLvl: eL,
    over: false,
    run: false,
  };
  return {
    fight,
    message: `Wróg poz. ${eL} wystawił ${fight.e.length} kulek (twoich: ${pl.length}). Uwaga: przegrana grozi stratą kulki (50%)!`,
  };
}

/** Removes one ball of level L from grid or inventory (legacy loseBall). */
export function loseBall(s: GameState, L: number): boolean {
  const i = s.grid.indexOf(L);
  if (i >= 0) {
    s.grid[i] = 0;
    return true;
  }
  if (s.inv[L] > 0) {
    s.inv[L] -= 1;
    return true;
  }
  return false;
}

export interface WarEndResult {
  coins: number; // granted (win: reward, loss: 15)
  xp: number; // granted (win: 40 + 10 × eLvl, loss: 15)
  lostLvl?: number; // ball level lost on defeat (only on the loss roll)
  message: string; // for the war log (Polish, verbatim)
  levelUp: LevelUp | null; // controller schedules the level-up toast + sfx
}

/**
 * Ends a fight with the legacy reward/penalty rules (lines 232–238): wins
 * pay 30·eL·(1+0.1·eL) + 40+10·eL XP and advance the wave; losses pay 15
 * and roll a 50% chance to lose one fighting ball. Sets fight.over.
 * State mutations (coins/xp/war.wave/loseBall) happen here; save(), the war
 * log text and sfx.coin() are the controller's.
 */
export function wEnd(s: GameState, fight: Fight, win: boolean, rng: Rng): WarEndResult {
  fight.over = true;
  const eL = fight.eLvl;
  if (win) {
    const coins = Math.round(30 * eL * (1 + eL * 0.1));
    const xp = 40 + 10 * eL;
    s.coins += coins;
    s.war.wave += 1;
    const levelUp = addXp(s, xp, rng);
    return {
      coins,
      xp,
      message: `Zwycięstwo! +🪙${coins}, +${xp} XP. Kliknij Dalej.`,
      levelUp,
    };
  }
  s.coins += 15;
  const levelUp = addXp(s, 15, rng);
  if (rng() < 0.5) {
    const L = fight.p[Math.floor(rng() * fight.p.length)].L;
    loseBall(s, L);
    return { coins: 15, xp: 15, lostLvl: L, message: `Porażka! Tracisz kulkę poz. ${L}. (+🪙15)`, levelUp };
  }
  return { coins: 15, xp: 15, message: 'Porażka, ale kulki ocalały! (+🪙15)', levelUp };
}

export interface TickEvents {
  hits: number; // → controller plays sfx.hit() this many times
  kills: number; // → controller plays sfx.brk() this many times
  /** Set on the tick a side is wiped — controller runs wEnd (or mpEnd). */
  done?: { pa: boolean; ea: boolean; playerWon: boolean };
}

/**
 * One 100 ms combat step (legacy tick, dt = 100): burn/slow ticks, then
 * attacks per side (player side first). The legacy version called
 * sfx.hit()/sfx.brk() inline and auto-invoked wEnd — both are returned as
 * events instead so the controller owns sound and flow.
 */
export function tick(s: GameState, fight: Fight, rng: Rng): TickEvents {
  const ev: TickEvents = { hits: 0, kills: 0 };
  if (fight.over) return ev;
  const dt = 100;
  const sides: Array<['p', 'e'] | ['e', 'p']> = [
    ['p', 'e'],
    ['e', 'p'],
  ];
  sides.forEach(([a, d]) => {
    const A = fight[a];
    const D = fight[d];
    const P = WP(s, fight, a, rng);
    A.forEach((b) => {
      if (b.hp <= 0) return;
      if (b.burn > 0) {
        b.burn -= dt;
        b.hp -= (b.bd * dt) / 1000;
      }
      if (b.slow > 0) b.slow -= dt;
      if (b.hp <= 0) {
        b.hp = 0;
        return;
      }
      b.cd -= dt;
      if (b.cd > 0) return;
      const t = D.find((x) => x.hp > 0);
      if (!t) return;
      t.hp -= b.atk * (1 - b.wk);
      ev.hits += 1;
      if (P.fire > 0) {
        t.burn = 3000;
        t.bd = b.atk * 0.3 * P.fire;
      }
      if (P.slow > 0) {
        t.slow = 2500;
        t.sm = 1 + 0.3 * P.slow;
      }
      if (t.hp <= 0) {
        t.hp = 0;
        ev.kills += 1;
        if (P.weak > 0) D.forEach((x) => (x.wk = Math.min(0.6, x.wk + 0.12 * P.weak)));
      }
      b.cd = 1000 * (b.slow > 0 ? b.sm : 1);
    });
  });
  const pa = fight.p.some((b) => b.hp > 0);
  const ea = fight.e.some((b) => b.hp > 0);
  if (!pa || !ea) ev.done = { pa, ea, playerWon: pa && !ea };
  return ev;
}
