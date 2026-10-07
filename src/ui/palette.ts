// Block/mine palette shared by the DOM view (legacy parity, PLAN.md Phase 2)
// and the Phaser texture generator (PLAN.md Phase 3.1): the color(L) hsl ramp,
// the tier colors TC and the CSS pattern templates PAT. Verbatim port of
// legacy/app.js — display-only data, no DOM/Phaser imports, so vitest can pin
// the math without a canvas.

/** Legacy color(L): deterministic hsl ramp used for classic balls. */
export function color(l: number): string {
  return `hsl(${(l * 47 + 200) % 360} 65% 52%)`;
}

/** Tier colors by block-HP tier (legacy TC). */
export const TC = ['#d64545', '#3f7fd9', '#3fae5a', '#d9b83f', '#8d5cc9', '#e0802f', '#2fb3a8', '#d95fa0', '#7d8aa0', '#3b3b4a'];

/** CSS background pattern layers per `tier % 5` (legacy PAT). */
export const PAT = [
  'radial-gradient(rgba(255,255,255,.35) 1.5px,transparent 2px) 0 0/8px 8px',
  'repeating-linear-gradient(45deg,rgba(0,0,0,.18) 0 4px,transparent 4px 8px)',
  'linear-gradient(rgba(0,0,0,.25) 2px,transparent 2px) 0 0/100% 50%,linear-gradient(90deg,rgba(0,0,0,.25) 2px,transparent 2px) 0 0/50% 100%',
  'repeating-linear-gradient(45deg,rgba(0,0,0,.2) 0 2px,transparent 2px 7px),repeating-linear-gradient(-45deg,rgba(0,0,0,.2) 0 2px,transparent 2px 7px)',
  'conic-gradient(rgba(0,0,0,.2) 25%,transparent 0 50%,rgba(0,0,0,.2) 0 75%,transparent 0) 0 0/10px 10px',
];

/** HP → texture tier (legacy tier): colors jump 0 → 2 at hp 2, cap 9. */
export const tier = (hp: number): number => Math.min(9, hp <= 1 ? 0 : Math.floor(Math.log2(hp)) + 1);

/** Flat tier color, or null when the block is destroyed (legacy blockColor). */
export const blockColor = (b: { hp: number }): string | null => (b.hp <= 0 ? null : TC[tier(b.hp)]);
