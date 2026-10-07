// Mine board math (PLAN.md Phase 2 core/mine.ts), ported verbatim from
// legacy/app.js lines 41–43, 93, 129, 174–179 and the drop-planning block
// (186–189). Mutates GameState (rows are generated lazily, blocks take
// damage) but never touches the DOM — animations, timers and sound effects
// belong to the controller.
// Convention: the injected RNG is always the LAST parameter.

import { COLS, VIEW } from '../config';
import { accLvl, pw } from './economy';
import { perk } from './cosmetics';
import type { Rng } from './rng';
import type { GameState, MineCell } from './state';

/** Depth in meters shown in the HUD (legacy render: topRow * 2). */
export const depth = (s: GameState): number => s.topRow * 2;

/**
 * Generates one mine row: HP grows 1.12^row, +5% per account level;
 * gems double HP and roll at 15% +2%/luck stat +skin luck perk (max 50%).
 */
export function makeRow(s: GameState, r: number, rng: Rng): MineCell[] {
  const hp = Math.max(1, Math.round(2.5 * Math.pow(1.12, r) * (1 + 0.05 * (accLvl(s) - 1))));
  return Array.from({ length: COLS }, () => {
    const gem = rng() < Math.min(0.5, 0.15 + 0.02 * s.acc.s.luck + perk(s, 'luck', rng) / 100);
    const h = gem ? hp * 2 : hp;
    return { hp: h, max: h, gem };
  });
}

/** Returns row r, generating every missing row up to it (legacy rowAt). */
export function rowAt(s: GameState, r: number, rng: Rng): MineCell[] {
  while (s.rows.length <= r) s.rows.push(makeRow(s, s.rows.length, rng));
  return s.rows[r];
}

/**
 * How many rows to render: at least VIEW, plus 2 for context below the
 * deepest damaged column, capped at 10 (legacy viewRows).
 */
export function viewRows(s: GameState, rng: Rng): number {
  let mx = s.topRow;
  for (let c = 0; c < COLS; c++) {
    let r = s.topRow;
    while (rowAt(s, r, rng)[c].hp <= 0) r++;
    mx = Math.max(mx, r);
  }
  return Math.min(Math.max(VIEW, mx - s.topRow + 2), 10);
}

/**
 * First-block splash: damages left/right/below neighbors of (r,c) by d and
 * returns coins earned from blocks destroyed (legacy splash).
 */
export function splash(s: GameState, r: number, c: number, d: number, rng: Rng): number {
  let e = 0;
  const targets: Array<[number, number]> = [
    [r, c - 1],
    [r, c + 1],
    [r + 1, c],
  ];
  targets.forEach(([rr, cc]) => {
    if (cc < 0 || cc >= COLS) return;
    const b = rowAt(s, rr, rng)[cc];
    if (b.hp <= 0) return;
    b.hp = Math.max(0, b.hp - d);
    if (b.hp <= 0) e += (1 + Math.floor(rr / 3)) * (b.gem ? 6 : 1);
  });
  return e;
}

/**
 * Applies dmg down column c from topRow, splashing from the first block
 * touched if blast upgrades/perks are owned. Returns coins earned (e) and
 * the first row hit (fr). Sound effects are the caller's job — legacy land()
 * called sfx.hit()/sfx.brk() inline; the controller replays that from
 * `e > 0`.
 */
export function land(s: GameState, c: number, L: number, dmg: number, rng: Rng): { e: number; fr: number } {
  let first = true;
  let fr = s.topRow;
  let e = 0;
  while (dmg > 0) {
    let r = s.topRow;
    while (rowAt(s, r, rng)[c].hp <= 0) r++;
    const b = rowAt(s, r, rng)[c];
    const used = Math.min(dmg, b.hp);
    b.hp -= used;
    dmg -= used;
    if (first) {
      first = false;
      fr = r;
      const bl = s.blastLvl + perk(s, 'blast', rng);
      if (bl > 0) e += splash(s, r, c, Math.round(pw(L) * 0.25 * bl), rng);
    }
    if (b.hp <= 0) e += (1 + Math.floor(r / 3)) * (b.gem ? 6 : 1);
  }
  return { e, fr };
}

/**
 * Simulates a ball of dmg dropped in column c against `pend` (damage
 * already planned by earlier balls in the same drop) and returns the row it
 * lands on. Mutates `pend` so the next ball plans behind this one
 * (legacy drop handler lines 186–189).
 */
export function planDrop(
  s: GameState,
  c: number,
  dmg: number,
  pend: Record<string, number>,
  rng: Rng,
): number {
  let r = s.topRow;
  while (rowAt(s, r, rng)[c].hp - (pend[`${r},${c}`] || 0) <= 0) r++;
  let d = dmg;
  let rr = r;
  while (d > 0) {
    const key = `${rr},${c}`;
    const rem = rowAt(s, rr, rng)[c].hp - (pend[key] || 0);
    if (rem <= 0) {
      rr++;
      continue;
    }
    const u = Math.min(d, rem);
    pend[key] = (pend[key] || 0) + u;
    d -= u;
    if (d > 0) rr++;
  }
  return r;
}
