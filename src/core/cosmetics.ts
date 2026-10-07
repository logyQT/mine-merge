// Skins, rarities, perks and crate rolls (PLAN.md Phase 2 core/cosmetics.ts).
// Data tables and roll functions ported verbatim from legacy/app.js lines
// 295–324 — display strings stay Polish (parity with the oracle); comments
// are English. Every roll takes an injected RNG (core/rng.ts).
//
// Display-only helpers (CSS strings, HTML markup) stay in the view layer.

import type { Rng } from './rng';
import type { GameState, Perk, PerkType, SkinItem } from './state';

export interface SkinDef {
  id: string;
  name: string;
  price: number;
  sym: string[] | null;
  pal: string[] | null;
  rad: string;
}

export interface Rarity {
  n: string;
  v: number;
  c: string;
}

export interface PerkDef {
  ic: string;
  n: string;
  v: number[];
  u: string;
}

export interface CrateDef {
  name: string;
  price: number;
  odds: number[];
}

// Key order matters: rollPerks() shuffles Object.keys(PERK).
export const PERK: Record<PerkType, PerkDef> = {
  pow: { ic: '💪', n: 'Siła kulek', v: [3, 6, 10, 16], u: '%' },
  gain: { ic: '💰', n: 'Zysk monet', v: [4, 8, 14, 22], u: '%' },
  exp: { ic: '📘', n: 'Doświadczenie', v: [5, 10, 18, 30], u: '%' },
  blast: { ic: '💥', n: 'Wybuchy', v: [0.4, 0.8, 1.3, 2], u: ' poz.' },
  fire: { ic: '🔥', n: 'Podpalanie wrogów', v: [0.4, 0.8, 1.3, 2], u: ' poz.' },
  slow: { ic: '❄', n: 'Zamrażanie wrogów', v: [0.4, 0.8, 1.3, 2], u: ' poz.' },
  luck: { ic: '🍀', n: 'Diamenty w blokach', v: [1, 2, 4, 6], u: '%' },
};

export const SKINS: SkinDef[] = [
  { id: 'def', name: 'Klasyczne', price: 0, sym: null, pal: null, rad: '50%' },
  { id: 'crypto', name: 'Kryptowaluty', price: 250, sym: ['₿', 'Ξ', 'Ł', 'Ð', '◎', '₮', '⬡', '✺'], pal: ['#f7931a', '#627eea', '#8a8d93', '#c2a633', '#0aa57a', '#26a17b', '#e84142', '#8247e5'], rad: '50%' },
  { id: 'fx', name: 'Kursy walut', price: 250, sym: ['$', '€', '£', '¥', '₣', '₹', '₩', '₽', '₺'], pal: ['#2e8b57', '#2f5fb3', '#8a3fb0', '#c2452f', '#3a7ca5', '#d98a1f', '#2fa6a0', '#a03a5a', '#6a6f2f'], rad: '50%' },
  { id: 'sq', name: 'Kwadraty', price: 150, sym: ['■', '▣', '▤', '▦', '▧', '◼', '▩', '⬛'], pal: null, rad: '18%' },
  { id: 'planet', name: 'Planety', price: 400, sym: ['🌑', '🌙', '🌍', '🪐', '☀️', '🌕', '⭐', '🌠'], pal: ['#3b3f66', '#5b5f8a', '#2e6fa6', '#a0662f', '#c28a1f', '#7a7aa0', '#6a4bb0', '#2a2f5a'], rad: '50%' },
  { id: 'fruit', name: 'Owoce', price: 400, sym: ['🍒', '🍓', '🍊', '🍋', '🍇', '🍉', '🍍', '🥭'], pal: ['#a8324a', '#c24a4a', '#d98a1f', '#b8a62f', '#6a3fa0', '#2f8a4a', '#c2a02f', '#c2702f'], rad: '50%' },
];

export const RAR: Rarity[] = [
  { n: 'Zwykły', v: 150, c: '#9aa0a6' },
  { n: 'Rzadki', v: 600, c: '#4b9cf5' },
  { n: 'Epicki', v: 2500, c: '#b266f0' },
  { n: 'Legendarny', v: 12000, c: '#f5b82e' },
];

export const CRATES: CrateDef[] = [{ name: 'Skrzynia Skinów', price: 1200, odds: [60, 25, 11, 4] }];

/** Perk quality weights per rarity (sum 100), perk count per rarity. */
export const QW: number[][] = [
  [70, 25, 4, 1],
  [45, 35, 15, 5],
  [25, 35, 28, 12],
  [10, 25, 35, 30],
];
export const PCOUNT: number[] = [1, 1, 2, 3];

export function curItem(s: GameState): SkinItem | undefined {
  return s.skins.items.find((i) => i.id === s.skins.cur);
}

export function curSkin(s: GameState): SkinDef {
  const it = curItem(s);
  return it ? SKINS.find((k) => k.id === it.theme) ?? SKINS[0] : SKINS[0];
}

export function curRar(s: GameState): number {
  const it = curItem(s);
  return it ? it.rar : 0;
}

/** Rolls rarities against odds (legacy rollRar, RNG injected). */
export function rollRar(rng: Rng, odds: number[]): number {
  let x = rng() * odds.reduce((a, b) => a + b, 0);
  for (let i = 0; i < odds.length; i++) {
    x -= odds[i];
    if (x <= 0) return i;
  }
  return 0;
}

export function rollPerks(rng: Rng, rar: number): Perk[] {
  // Verbatim legacy shuffle (biased random comparator and all) — parity over purity.
  const keys = Object.keys(PERK).sort(() => rng() - 0.5).slice(0, PCOUNT[rar]);
  return keys.map((t) => ({ t: t as PerkType, q: rollRar(rng, QW[rar]) }));
}

/** Lazy-rolls and caches perks on the item, like legacy perksOf(). */
export function perksOf(it: SkinItem, rng: Rng): Perk[] {
  return it.perks ?? (it.perks = rollPerks(rng, it.rar));
}

/** Total bonus of perk type t from the currently equipped skin (0 if none). */
export function perk(s: GameState, t: PerkType, rng: Rng): number {
  const it = curItem(s);
  if (!it) return 0;
  return perksOf(it, rng)
    .filter((p) => p.t === t)
    .reduce((a, p) => a + PERK[t].v[p.q], 0);
}

export function itVal(it: SkinItem, rng: Rng): number {
  return Math.round(RAR[it.rar].v * (1 + 0.15 * perksOf(it, rng).reduce((a, p) => a + p.q, 0)));
}

export function itName(it: SkinItem): string {
  const k = SKINS.find((x) => x.id === it.theme) ?? SKINS[0];
  return `${k.name} · ${RAR[it.rar].n}`;
}

/** Any skin except the default (crate spins). */
export const rollTheme = (rng: Rng): SkinDef => SKINS[1 + Math.floor(rng() * (SKINS.length - 1))];

/** Reward level 1..5 (level-up crates). */
export const rnd5 = (rng: Rng): number => 1 + Math.floor(rng() * 5);

/** Random ball level 1..m (level-up crate strip cells). */
export const crateRoll = (rng: Rng, m: number): number => 1 + Math.floor(rng() * m);
