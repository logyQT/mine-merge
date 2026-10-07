// Runtime texture generation for the Phaser board (PLAN.md Phase 3.1).
// Every texture is drawn at boot from the existing palettes — color(L), TC,
// PAT and the skin pal/sym/rad tables — so public/assets/ stays empty
// (0 files: CSP-clean, budget-clean; no PNGs for gradients).
//
// Implementation note vs PLAN wording: shapes *could* go through
// GameObjects.Graphics → generateTexture, but blocks need clipped CSS patterns
// and balls need baked text/emoji (legacy .it innerHTML), neither of which
// Graphics renders — CanvasTexture gives both from the same palettes with the
// same "0 asset files" outcome. Textures are plain 2D canvases: CSP-safe.
//
// Inventory:
//   mine-empty, mine-0 … mine-9   one flat cell per HP tier + its PAT pattern
//   ball-<skin>-<L>-<rar>         lazily per (skin × level × rarity), cached —
//                                 BootScene prewarms the common ones at boot.

import * as Phaser from 'phaser';
import { fmt, pw } from '../core/economy';
import { RAR, SKINS, type SkinDef } from '../core/cosmetics';
import { color, TC } from '../ui/palette';

// ---- mine cell textures (legacy .b: aspect-ratio 1.1, flat tier color + PAT overlay) ----

/** Canonical mine-cell texture size (legacy .b is aspect-ratio 1.1). */
export const CELL_W = 66;
export const CELL_H = 60;

export const MINE_EMPTY = 'mine-empty';

/** Texture key for the cell texture of HP tier t (0..9). */
export const mineTexKey = (t: number): string => `mine-${t}`;

/**
 * Per-pixel alpha of pattern `p` (legacy PAT[p]) painted once across the cell,
 * mirroring how the CSS background layers composite: a white-dot layer for
 * p = 0, black overlays for the rest. The CSS is the spec — see ./palette.ts.
 */
function patAlpha(p: number, x: number, y: number): number {
  const sqrt2 = Math.SQRT2;
  switch (p) {
    case 0: {
      // radial-gradient(rgba(255,255,255,.35) 1.5px,transparent 2px) 0 0/8px 8px
      const mx = x % 8;
      const my = y % 8;
      const dx = Math.min(mx, 8 - mx);
      const dy = Math.min(my, 8 - my);
      const d = Math.hypot(dx, dy);
      return d <= 1.5 ? 0.35 : d < 2 ? (0.35 * (2 - d)) / 0.5 : 0;
    }
    case 1: {
      // repeating-linear-gradient(45deg,rgba(0,0,0,.18) 0 4px,transparent 4px 8px)
      // 45° axis points up-right; the gradient starts in the bottom-left corner.
      const s = (x - y + CELL_H) / sqrt2;
      return s % 8 < 4 ? 0.18 : 0;
    }
    case 2: {
      // Two 2px rules at 50% of each axis (tile sizes 100%/50% ↔ 66×30 px).
      return y % 30 < 2 || x % 33 < 2 ? 0.25 : 0;
    }
    case 3: {
      // Two crossing repeating gradients, 2px dark every 7px along each axis.
      const s1 = (x - y + CELL_H) / sqrt2; // 45°: starts bottom-left
      const s2 = (CELL_W + CELL_H - x - y) / sqrt2; // -45°: starts bottom-right
      const a1 = s1 % 7 < 2 ? 0.2 : 0;
      const a2 = s2 % 7 < 2 ? 0.2 : 0;
      return a1 + a2 * (1 - a1); // legacy: two stacked background layers
    }
    case 4: {
      // conic-gradient(…25%,transparent 0 50%,… 0 75%,transparent 0) 0 0/10px 10px
      const cx = Math.floor(x / 10) * 10 + 5;
      const cy = Math.floor(y / 10) * 10 + 5;
      let a = Math.atan2(x - cx, cy - y); // 0 = up, clockwise (CSS conic)
      if (a < 0) a += Math.PI * 2;
      return a < Math.PI / 2 || (a >= Math.PI && a < 1.5 * Math.PI) ? 0.2 : 0;
    }
    default:
      return 0;
  }
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Draws one cell texture: flat base color with its `PAT[p]` layer composited. */
function drawCell(manager: Phaser.Textures.TextureManager, key: string, base: string, p: number): void {
  const cv = manager.createCanvas(key, CELL_W, CELL_H);
  if (!cv) return; // key already present — callers guard with exists()
  const ctx = cv.getContext();
  const img = ctx.createImageData(CELL_W, CELL_H);
  const [br, bg, bb] = hexToRgb(base);
  const white = p === 0; // PAT[0] overlays white dots, the rest black
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const a = p < 0 ? 0 : patAlpha(p, x, y);
      const i = (y * CELL_W + x) * 4;
      const inv = 1 - a;
      img.data[i] = white ? br * inv + 255 * a : br * inv;
      img.data[i + 1] = white ? bg * inv + 255 * a : bg * inv;
      img.data[i + 2] = white ? bb * inv + 255 * a : bb * inv;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cv.refresh();
}

/** Generates mine-empty + mine-0..mine-9 from TC/PAT (idempotent). */
export function generateMineTextures(manager: Phaser.Textures.TextureManager): void {
  if (!manager.exists(MINE_EMPTY)) drawCell(manager, MINE_EMPTY, '#4a2a2a', -1);
  for (let t = 0; t <= 9; t++) {
    const key = mineTexKey(t);
    if (manager.exists(key)) continue;
    drawCell(manager, key, TC[t], t % 5);
  }
}

// ---- ball textures (legacy .it: skin bg + border-radius + inset + label + rarity ring) ----

/** Ball box diameter in texture px (legacy .it = 80% of a ~54 px grid cell). */
export const BALL_D = 64;
/** Room around the ball for the rarity glow (≤14 legacy px) and drop shadow. */
export const BALL_MARGIN = 22;
/** Full ball texture size: ball box + margins. */
export const BALL_TEX = BALL_D + 2 * BALL_MARGIN;

/** Legacy .it box at the reference 380 px column — scales px values below. */
const LEGACY_BALL = 54;
const K = BALL_D / LEGACY_BALL; // legacy px → texture px

/** Texture key for one (skin × level × rarity) ball. */
export const ballTexKey = (skinId: string, L: number, rar: number): string =>
  `ball-${skinId}-${L}-${rar}`;

/** Shape path grown by `grow` px — the border box (or beyond, for the ring). */
function shapePath(ctx: CanvasRenderingContext2D, radius: number, grow: number): void {
  const half = BALL_D / 2 + grow;
  const rr = radius + grow;
  const x = BALL_TEX / 2 - half;
  ctx.beginPath();
  if (rr >= half) {
    // border-radius ≥ 50% renders as a circle (all non-square skins use 50%).
    ctx.arc(BALL_TEX / 2, BALL_TEX / 2, half, 0, Math.PI * 2);
  } else {
    const w = half * 2;
    ctx.moveTo(x + rr, x);
    ctx.arcTo(x + w, x, x + w, x + w, rr);
    ctx.arcTo(x + w, x + w, x, x + w, rr);
    ctx.arcTo(x, x + w, x, x, rr);
    ctx.arcTo(x, x, x + w, x, rr);
    ctx.closePath();
  }
}

/**
 * Generates (once) the texture for a ball of level L under `skin` at rarity
 * `rar`: background from pal/color(L), border-radius from rad, the inset bottom
 * shade, the legacy label (symbol or level + power line) and the rarity
 * ring/glow. Returns the key — safe to call repeatedly (cache hit).
 */
export function ensureBallTexture(
  manager: Phaser.Textures.TextureManager,
  skinId: string,
  L: number,
  rar: number,
): string {
  const key = ballTexKey(skinId, L, rar);
  if (manager.exists(key)) return key;
  const skin: SkinDef = SKINS.find((s) => s.id === skinId) ?? SKINS[0];
  const cv = manager.createCanvas(key, BALL_TEX, BALL_TEX);
  if (!cv) return key;
  const ctx = cv.getContext();
  const bg = skin.pal ? skin.pal[(L - 1) % skin.pal.length] : color(L);
  const radius = (parseFloat(skin.rad) / 100) * BALL_D;
  const font = (weight: number, px: number): string =>
    `${weight} ${px}px "Trebuchet MS", "Segoe UI", sans-serif`;

  // Base fill + legacy `box-shadow: 0 3px 0 rgba(0,0,0,.2)` drop shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowOffsetY = 3 * K;
  shapePath(ctx, radius, 0);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.restore();

  // Legacy `box-shadow: inset 0 -6px 0 rgba(0,0,0,.25)` bottom shade.
  ctx.save();
  shapePath(ctx, radius, 0);
  ctx.clip();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, BALL_TEX / 2 + BALL_D / 2 - 6 * K, BALL_TEX, 6 * K);
  ctx.restore();

  // Label (legacy .it flex-column: symbol/level on top, power line below).
  const main = skin.sym ? skin.sym[(L - 1) % skin.sym.length] : String(L);
  const small = skin.sym ? `${L}·${fmt(pw(L))}` : fmt(pw(L));
  const mainSize = 22 * K;
  const smallSize = 11 * K;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)'; // legacy text-shadow: 0 2px 0
  ctx.shadowOffsetY = 2 * K;
  ctx.fillStyle = '#fff';
  ctx.font = font(800, mainSize);
  ctx.fillText(main, BALL_TEX / 2, BALL_TEX / 2 - smallSize / 2);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowOffsetY = 2 * K;
  ctx.fillStyle = '#fff';
  ctx.font = font(700, smallSize);
  ctx.fillText(small, BALL_TEX / 2, BALL_TEX / 2 + mainSize / 2);
  ctx.restore();

  // Rarity: `0 0 0 3px c` solid ring + `0 0 14px c` glow, drawn outside the box.
  if (rar > 0) {
    ctx.strokeStyle = RAR[rar].c;
    ctx.lineWidth = 3 * K;
    shapePath(ctx, radius, 1.5 * K);
    ctx.stroke();
    // The glow is a blur — approximate with concentric fading strokes.
    const glow: Array<[number, number]> = [
      [4.5 * K, 0.18],
      [8 * K, 0.13],
      [11.5 * K, 0.09],
      [15 * K, 0.05],
    ];
    glow.forEach(([grow, alpha]) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 3.5 * K;
      shapePath(ctx, radius, grow);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  cv.refresh();
  return key;
}

/** Boot-time prewarm: classic balls for the early levels + one ball per skin. */
export function prewarmBallTextures(manager: Phaser.Textures.TextureManager): void {
  for (let L = 1; L <= 12; L++) ensureBallTexture(manager, 'def', L, 0);
  SKINS.forEach((s) => ensureBallTexture(manager, s.id, 1, 0));
}
