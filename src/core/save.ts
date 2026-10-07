// Save serialization + schema-v1 migration (PLAN.md Phase 2 core/save.ts).
// Ported from legacy/app.js save()/applySave()/normalize(). The schema-v1 key
// set and normalize() edge cases are pinned by BOTH the legacy oracle
// (tests/unit/save.test.js) and this port's tests (save-core.test.ts).
// Rule for the whole rewrite: schema-v1 saves must be accepted forever.

import { N } from '../config';
import type { GameState, SkinItem } from './state';

/** Schema-v1 key set, in the order legacy save() writes them. */
export const SAVE_KEYS = [
  'coins',
  'spawnLvl',
  'spawnCost',
  'upCost',
  'incLvl',
  'incCost',
  'renLvl',
  'renCost',
  'grid',
  'rows',
  'topRow',
  'inv',
  'blastLvl',
  'blastCost',
  'bombs',
  'bombCost',
  'war',
  'acc',
  'econ',
  'skins',
  'bestDepth',
] as const;

/** Serializes exactly the schema-v1 keys (unknown/extra state never leaks). */
export function serialize(s: GameState): string {
  return JSON.stringify({
    coins: s.coins,
    spawnLvl: s.spawnLvl,
    spawnCost: s.spawnCost,
    upCost: s.upCost,
    incLvl: s.incLvl,
    incCost: s.incCost,
    renLvl: s.renLvl,
    renCost: s.renCost,
    grid: s.grid,
    rows: s.rows,
    topRow: s.topRow,
    inv: s.inv,
    blastLvl: s.blastLvl,
    blastCost: s.blastCost,
    bombs: s.bombs,
    bombCost: s.bombCost,
    war: s.war,
    acc: s.acc,
    econ: s.econ,
    skins: s.skins,
    bestDepth: s.bestDepth,
  });
}

/**
 * Merges a parsed save over the current state, mirroring legacy
 * `Object.assign(currentValues, d)` + reassign-only-known-keys:
 * unknown keys are ignored; explicit `undefined` values ARE taken (they are
 * then dropped by serialize() and reset to defaults on the next load).
 */
export function applySave(s: GameState, d: unknown): void {
  if (typeof d !== 'object' || d === null) return; // legacy: no-op for primitives
  const src = d as Record<string, unknown>;
  for (const k of SAVE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      (s as unknown as Record<string, unknown>)[k] = src[k];
    }
  }
}

/** Repairs/defaults everything normalize() repaired in legacy (line 36). */
export function normalize(s: GameState): void {
  s.rows = s.rows || [];
  s.grid = s.grid || Array(N * N).fill(0);
  s.rows.length = Math.min(s.rows.length, s.topRow); // drop the un-durable peek row
  s.inv = s.inv || {};
  s.blastLvl = s.blastLvl || 0;
  s.blastCost = s.blastCost || 80;
  s.bombs = s.bombs || 0;
  s.bombCost = s.bombCost || 250;
  s.war = s.war || { wave: 1, fire: 0, slow: 0, weak: 0 };
  s.acc = s.acc || { xp: 0, s: { pow: 0, gain: 0, luck: 0, hp: 0 } };
  s.acc.s = s.acc.s || { pow: 0, gain: 0, luck: 0, hp: 0 };
  s.econ = s.econ || { pas: 0, dis: 0 };
  s.skins = s.skins || { items: [], cur: null, nid: 1 };
  s.bestDepth = s.bestDepth || 0;
  migrateOwnedSkins(s);
}

/** v1 pre-ITEMS schema: skins.owned (theme ids, "def" = default) → items. */
function migrateOwnedSkins(s: GameState): void {
  if (!s.skins.owned) return;
  const items: SkinItem[] = [];
  let n = 1;
  let cur: number | null = null;
  s.skins.owned.forEach((o) => {
    if (o === 'def') return;
    items.push({ id: n, theme: o, rar: 0 });
    // Old saves stored the equipped skin as a theme string, not an item id.
    if ((s.skins.cur as unknown) === o) cur = n;
    n++;
  });
  s.skins = { items, cur, nid: n };
}

/**
 * Boot-time restore: parse (corrupt input ignored) → applySave → normalize.
 * normalize() runs even when there was nothing to load — same as legacy boot.
 */
export function restore(s: GameState, raw: string | null): void {
  if (raw !== null) {
    try {
      const d = JSON.parse(raw);
      if (d && typeof d === 'object') applySave(s, d);
    } catch {
      // corrupt save — keep defaults (pinned by save-core.test.ts)
    }
  }
  normalize(s);
}
