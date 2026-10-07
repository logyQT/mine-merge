// GameState: the full persisted play state (PLAN.md §1.1 core/state.ts).
// Defaults ported verbatim from the legacy globals (legacy/app.js lines 1–18);
// transient UI bits (selected cell, busy flag, timers) deliberately live in the
// controller, not here — they were never part of the save.

import { N } from '../config';

export interface MineCell {
  hp: number;
  max: number;
  gem: boolean;
}

export type PerkType = 'pow' | 'gain' | 'exp' | 'blast' | 'fire' | 'slow' | 'luck';

export interface Perk {
  t: PerkType;
  q: number; // rarity index 0..3 (quality of the roll)
}

export interface WarState {
  wave: number;
  fire: number;
  slow: number;
  weak: number;
}

export interface AccStats {
  pow: number;
  gain: number;
  luck: number;
  hp: number;
}

export interface AccState {
  xp: number;
  crates?: number; // only present once a level-up granted one
  s: AccStats;
}

export interface EconState {
  pas: number;
  dis: number;
}

export interface SkinItem {
  id: number;
  theme: string;
  rar: number;
  perks?: Perk[]; // rolled lazily on first use (cosmetics.ts) — absent until then
}

export interface SkinsState {
  items: SkinItem[];
  cur: number | null;
  nid: number;
  /** Pre-ITEMS schema: list of theme ids ("def" = default). Migrated away by
   *  normalize(); present only on saves written by very old versions. */
  owned?: string[];
}

export interface GameState {
  coins: number;
  spawnLvl: number;
  spawnCost: number;
  upCost: number;
  incLvl: number;
  incCost: number;
  renLvl: number;
  renCost: number;
  grid: number[]; // N*N cell slots: 0 = empty, else ball level
  rows: MineCell[][]; // mine rows; rows[0, topRow) durable, frontier re-rolled
  topRow: number;
  inv: Record<string, number>; // dropped balls by level (keys are level strings)
  blastLvl: number;
  blastCost: number;
  bombs: number;
  bombCost: number;
  war: WarState;
  acc: AccState;
  econ: EconState;
  skins: SkinsState;
  bestDepth: number;
}

export function createInitialState(): GameState {
  return {
    coins: 30,
    spawnLvl: 1,
    spawnCost: 5,
    upCost: 40,
    incLvl: 0,
    incCost: 60,
    renLvl: 0,
    renCost: 50,
    grid: Array(N * N).fill(0),
    rows: [],
    topRow: 0,
    inv: {},
    blastLvl: 0,
    blastCost: 80,
    bombs: 0,
    bombCost: 250,
    war: { wave: 1, fire: 0, slow: 0, weak: 0 },
    acc: { xp: 0, s: { pow: 0, gain: 0, luck: 0, hp: 0 } },
    econ: { pas: 0, dis: 0 },
    skins: { items: [], cur: null, nid: 1 },
    bestDepth: 0,
  };
}

/** Restores every persisted field to its default (legacy resetGame). */
export function resetState(s: GameState): void {
  Object.assign(s, createInitialState());
}
