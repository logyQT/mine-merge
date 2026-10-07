// Pure economy formulas (PLAN.md Phase 2 core/economy.ts), ported verbatim
// from legacy/app.js lines 12, 33–34, 39–40, 119–120, 128, 261–262.
// Everything is a function of GameState — no globals. The only RNG consumer
// is perk() (equipped-skin bonuses), so those take an injected Rng.

import { perk } from './cosmetics';
import type { Rng } from './rng';
import type { GameState } from './state';

/** Ball strength at level l — constant per level (legacy pw). */
export const pw = (l: number): number => Math.pow(2, l) - 1;

/** Compact number for display: k/M suffixes, whole numbers below 10k. */
export const fmt = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));

/** Account level from total XP (grows √-wise: level 5 ≈ 780 XP). */
export const accLvl = (s: GameState): number => 1 + Math.floor(Math.sqrt(s.acc.xp / 40));

/** Income multiplier from the income upgrade + skin perk. */
export const incMul = (s: GameState, rng: Rng): number =>
  1.5 * (1 + 0.5 * s.incLvl) * (1 + 0.06 * s.acc.s.gain + perk(s, 'gain', rng) / 100);

/** Auto-return chance for dropped balls (100% at renLvl 5). */
export const renChance = (s: GameState): number => Math.min(1, 0.5 + 0.1 * s.renLvl);

/** Price of spawning a ball at the current spawn level / discount. */
export const spawnPrice = (s: GameState): number =>
  Math.max(1, Math.round(4 * pw(s.spawnLvl) * Math.max(0.5, 1 - 0.08 * s.econ.dis)));

export const pasCost = (s: GameState): number => Math.round(70 * Math.pow(2, s.econ.pas));

export const disCost = (s: GameState): number => Math.round(60 * Math.pow(2.2, s.econ.dis));

export const sellPrice = (l: number): number => Math.max(1, Math.round(pw(l) * 0.8));

/** Stat points currently spent (stats screen + HUD "!" marker). */
export const spent = (s: GameState): number => Object.values(s.acc.s).reduce((a, b) => a + b, 0);

/** Free stat points = levels gained − spent (level 1 grants none). */
export const pts = (s: GameState): number => accLvl(s) - 1 - spent(s);

export interface LevelUp {
  level: number;
  crates: number; // crates granted while reaching `level` (multiples of 3)
}

/**
 * Adds XP (boosted by the skin's exp perk) and reports a level-up, if any.
 * Ported from legacy addXp(); the caller owns the side effects (message +
 * sfx after 60 ms) — that's controller work, not core.
 */
export function addXp(s: GameState, n: number, rng: Rng): LevelUp | null {
  const before = accLvl(s);
  s.acc.xp += Math.round(n * (1 + perk(s, 'exp', rng) / 100));
  const after = accLvl(s);
  if (after <= before) return null;
  let crates = 0;
  for (let l = before + 1; l <= after; l++) if (l % 3 === 0) crates++;
  s.acc.crates = (s.acc.crates || 0) + crates;
  return { level: after, crates };
}
