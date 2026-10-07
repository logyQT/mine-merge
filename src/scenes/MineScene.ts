// MineScene — the canvas board (PLAN.md Phase 3.2).
//
// Owns the 5×5 merge grid (#grid) and the mine (#mine): both stay in the DOM
// only as transparent, click-through layout spacers whose rects this scene
// measures relative to the canvas, so the legacy column layout (and therefore
// the side-by-side vs legacy/) is preserved at every aspect ratio — resize
// just re-measures and re-lays-out; GameState is untouched ("state survives
// resize by construction").
//
// Rendering is event-driven at the controller's refresh() cadence (views only
// read GameState): textures/text update on boardRender/renderMine, geometry
// re-applies when the measured rects change (resize, setGone collapse). Input
// is one Phaser.Input.Pointer path covering mouse + tap; a drag A→B replays
// as tap(A), tap(B). flyBall/land/hit mirror the legacy DOM animations,
// including the prefers-reduced-motion opt-outs.

import * as Phaser from 'phaser';
import { COLS, N } from '../config';
import { curRar, curSkin } from '../core/cosmetics';
import { rowAt, viewRows } from '../core/mine';
import type { Rng } from '../core/rng';
import type { GameState } from '../core/state';
import { numF } from '../i18n';
import { registerBoard, type Handlers, type Hit, type Ui } from '../ui/board';
import { tier } from '../ui/palette';
import { BALL_D, CELL_H, CELL_W, ensureBallTexture, MINE_EMPTY, mineTexKey } from './textures';

// Layout metrics — legacy style.css (#grid/#mine/.c/.b).
const GRID_PAD = 3; // #grid padding
const GRID_GAP = 3; // #grid gap
const MINE_GAP = 2; // #mine gap
const PANEL_R = 10; // both panels: border-radius 10px
const CELL_R = 6; // .c: border-radius 6px

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CellView {
  wrap: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  flash: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.Text;
  gem: Phaser.GameObjects.Graphics;
}

type Args = { s: GameState; ui: Ui; h: Handlers; rng: Rng };
type Rects = { grid: Rect | null; mine: Rect | null };

const sig = (r: Rects): string =>
  [r.grid?.x, r.grid?.y, r.grid?.w, r.grid?.h, r.mine?.x, r.mine?.y, r.mine?.w, r.mine?.h].join(',');

/** Reads a hex CSS custom property (--line/--cell follow the color scheme). */
function cssVar(name: string): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? parseInt(v.slice(1), 16) : 0xffffff;
}

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion:reduce)').matches;

/** Exact CSS cubic-bezier(.55,.085,.68,.53) — legacy flyBall's timing curve. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const A = (a: number, b: number): number => 1 - 3 * b + 3 * a;
  const B = (a: number, b: number): number => 3 * b - 6 * a;
  const C = (a: number): number => 3 * a;
  const calc = (t: number, a: number, b: number): number => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t: number, a: number, b: number): number => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = calc(t, x1, x2) - x;
      if (Math.abs(err) < 1e-6) break;
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return calc(t, y1, y2);
  };
}

export class MineScene extends Phaser.Scene {
  private args: Args | null = null;
  private rects: Rects = { grid: null, mine: null };
  private lastSig = '';
  private rows = 0;
  private press: number | null = null;
  private gridGfx!: Phaser.GameObjects.Graphics;
  private mineGfx!: Phaser.GameObjects.Graphics;
  private balls: Phaser.GameObjects.Image[] = [];
  private cells: CellView[] = [];

  constructor() {
    super('Mine');
  }

  create(): void {
    this.gridGfx = this.add.graphics();
    this.mineGfx = this.add.graphics();
    for (let i = 0; i < N * N; i++) {
      this.balls.push(this.add.image(0, 0, 'ball-def-1-0').setVisible(false));
    }
    for (let k = 0; k < 10; k++) {
      for (let c = 0; c < COLS; c++) {
        const img = this.add.image(0, 0, MINE_EMPTY);
        const flash = this.add.image(0, 0, MINE_EMPTY).setTintFill(0xffffff).setAlpha(0);
        const text = this.add
          .text(0, 0, '', {
            fontFamily: '"Trebuchet MS", "Segoe UI", sans-serif',
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#ffffffe6',
          })
          .setOrigin(0.5)
          .setShadow(0, 1, 'rgba(0,0,0,0.6)', 2);
        const gem = this.add.graphics();
        gem.lineStyle(3, 0xffd1f0, 1); // legacy gem ring: inset 0 0 0 3px #ffd1f0
        gem.strokeRect(-CELL_W / 2 + 1.5, -CELL_H / 2 + 1.5, CELL_W - 3, CELL_H - 3);
        gem.setVisible(false);
        const wrap = this.add.container(0, 0, [img, flash, gem, text]);
        wrap.setVisible(false);
        this.cells.push({ wrap, img, flash, text, gem });
      }
    }

    // One pointer path for mouse + touch: tap = press+release on a cell,
    // drag A→B = tap(A) then tap(B) (legacy tap() rules live in the controller).
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const i = this.cellAt(p);
      this.press = i >= 0 ? i : null;
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const from = this.press;
      this.press = null;
      const h = this.args?.h;
      if (from === null || !h) return;
      h.tap(from);
      const to = this.cellAt(p);
      if (to >= 0 && to !== from) h.tap(to);
    });

    registerBoard({
      render: (s, ui, h, rng) => this.renderBoard(s, ui, h, rng),
      renderMine: (s, rng, hit) => this.renderMineOnly(s, rng, hit),
      flyBall: (s, i, c, r, L, rng) => this.flyBall(s, i, c, r, L, rng),
      // Phase 4: setWarOpen() hides the board while the canvas is lifted
      // above the #war overlay (it would paint over the war view).
      setVisible: (v) => this.scene.setVisible(v),
    });
  }

  /** Geometry re-apply when the spacers move (resize / setGone collapse). */
  update(): void {
    if (!this.args) return;
    const rects = this.measure();
    if (sig(rects) !== this.lastSig) this.applyLayout(rects);
  }

  // ---- content (textures / text; state → view, refresh() cadence) ----

  private renderBoard(s: GameState, ui: Ui, h: Handlers, rng: Rng): void {
    this.args = { s, ui, h, rng };
    const skin = curSkin(s);
    const rar = curRar(s);
    for (let i = 0; i < N * N; i++) {
      const L = s.grid[i];
      const img = this.balls[i];
      if (L) img.setTexture(ensureBallTexture(this.textures, skin.id, L, rar)).setVisible(true);
      else img.setVisible(false);
    }
    const rects = this.measure();
    this.drawMine(s, rng, rects);
    this.applyLayout(rects);
  }

  private renderMineOnly(s: GameState, rng: Rng, hit?: Hit): void {
    const rects = this.measure();
    this.drawMine(s, rng, rects);
    this.applyLayout(rects);
    if (hit) this.flashCell(hit, s);
  }

  /** Mine rows from state; also sizes the #mine spacer (canvas needs the box). */
  private drawMine(s: GameState, rng: Rng, rects: Rects): void {
    const mineEl = document.getElementById('mine');
    const w = rects.mine?.w ?? rects.grid?.w;
    if (!mineEl || !w) return;
    const rows = viewRows(s, rng); // lazily generates the frontier — like legacy renderMine
    this.rows = rows;
    const cellH = (w - 4 * MINE_GAP) / COLS / 1.1; // .b: aspect-ratio 1.1
    const h = rows * cellH + (rows - 1) * MINE_GAP;
    mineEl.style.height = `${h}px`;
    if (rects.mine) rects.mine.h = h; // we just wrote it — keep the rect truthful
    for (let k = 0; k < 10; k++) {
      const visible = k < rows;
      for (let c = 0; c < COLS; c++) {
        const cell = this.cells[k * COLS + c];
        cell.wrap.setVisible(visible);
        if (!visible) continue;
        const b = rowAt(s, s.topRow + k, rng)[c];
        const alive = b.hp > 0;
        const tex = alive ? mineTexKey(tier(b.hp)) : MINE_EMPTY;
        cell.img.setTexture(tex);
        cell.flash.setTexture(tex);
        cell.text.setText(alive ? (b.gem ? '💎 ' : '') + numF(b.hp) : '').setVisible(alive);
        cell.gem.setVisible(alive && b.gem);
      }
    }
  }

  /** Legacy .b.hit flash (0.2 s: down/squash+brighten → up → settle). */
  private flashCell(hit: Hit, s: GameState): void {
    if (reducedMotion()) return;
    const k = hit.r - s.topRow;
    if (k < 0 || k >= this.rows) return;
    const flash = this.cells[k * COLS + hit.c].flash;
    this.tweens.killTweensOf(flash);
    flash.setAlpha(0).setY(0).setScale(1);
    this.tweens.add({
      targets: flash,
      keyframes: [
        { y: 3, scaleX: 0.95, scaleY: 0.95, alpha: 0.85, duration: 50 },
        { y: -1, alpha: 0.35, duration: 70 },
        { y: 0, scaleX: 1, scaleY: 1, alpha: 0, duration: 80 },
      ],
    });
  }

  // ---- geometry (rects → positions; re-applied on every layout change) ----

  private measure(): Rects {
    const cb = this.game.canvas.getBoundingClientRect();
    const read = (id: string): Rect | null => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - cb.left, y: r.top - cb.top, w: r.width, h: r.height };
    };
    return { grid: read('grid'), mine: read('mine') };
  }

  private gridCellW(r: Rect): number {
    return (r.w - 2 * GRID_PAD - 4 * GRID_GAP) / N;
  }

  private applyLayout(rects: Rects): void {
    this.rects = rects;
    this.lastSig = sig(rects);
    const g = rects.grid;
    if (!g) return;

    // Merge grid: panel, cells, selection outline, balls (legacy #grid/.c/.sel).
    const line = cssVar('--line');
    const cellBg = cssVar('--cell');
    const sel = this.args?.ui.sel ?? null;
    const cw = this.gridCellW(g);
    this.gridGfx.clear();
    this.gridGfx.fillStyle(line, 1);
    this.gridGfx.fillRoundedRect(g.x, g.y, g.w, g.h, PANEL_R);
    this.gridGfx.fillStyle(cellBg, 1);
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        this.gridGfx.fillRoundedRect(
          g.x + GRID_PAD + c * (cw + GRID_GAP),
          g.y + GRID_PAD + r * (cw + GRID_GAP),
          cw,
          cw,
          CELL_R,
        );
      }
    }
    if (sel !== null && sel >= 0 && sel < N * N) {
      const sx = g.x + GRID_PAD + (sel % N) * (cw + GRID_GAP);
      const sy = g.y + GRID_PAD + Math.floor(sel / N) * (cw + GRID_GAP);
      this.gridGfx.lineStyle(4, 0xffe14d, 1); // outline 4px #ffe14d, offset -4 → inside
      this.gridGfx.strokeRect(sx + 2, sy + 2, cw - 4, cw - 4);
    }
    const base = (cw * 0.8) / BALL_D; // .it = 80% of the cell
    for (let i = 0; i < N * N; i++) {
      const img = this.balls[i];
      img.setPosition(
        g.x + GRID_PAD + (i % N) * (cw + GRID_GAP) + cw / 2,
        g.y + GRID_PAD + Math.floor(i / N) * (cw + GRID_GAP) + cw / 2,
      );
      img.setScale(i === sel ? base * 1.1 : base); // .c.sel .it { transform: scale(1.1) }
    }

    // Mine: panel + cell containers (children live in 66×60 texture space).
    const m = rects.mine;
    if (!m) return;
    this.mineGfx.clear();
    this.mineGfx.fillStyle(0x6b3d3d, 1); // #mine background
    this.mineGfx.fillRoundedRect(m.x, m.y, m.w, m.h, PANEL_R);
    const mw = (m.w - 4 * MINE_GAP) / COLS;
    const mh = mw / 1.1;
    for (let k = 0; k < 10; k++) {
      for (let c = 0; c < COLS; c++) {
        const cell = this.cells[k * COLS + c];
        cell.wrap.setPosition(
          m.x + c * (mw + MINE_GAP) + mw / 2,
          m.y + k * (mh + MINE_GAP) + mh / 2,
        );
        cell.wrap.setScale(mw / CELL_W);
      }
    }
  }

  // ---- input ----

  /** Grid cell under a pointer (gaps/padding are click-through, like DOM .c). */
  private cellAt(p: Phaser.Input.Pointer): number {
    const g = this.rects.grid;
    if (!g) return -1;
    const cw = this.gridCellW(g);
    const x = p.x - g.x - GRID_PAD;
    const y = p.y - g.y - GRID_PAD;
    if (x < 0 || y < 0) return -1;
    const c = Math.floor(x / (cw + GRID_GAP));
    const r = Math.floor(y / (cw + GRID_GAP));
    if (c >= N || r >= N) return -1;
    if (x - c * (cw + GRID_GAP) > cw || y - r * (cw + GRID_GAP) > cw) return -1;
    return r * N + c;
  }

  private gridCellCenter(i: number): { x: number; y: number } | null {
    const g = this.rects.grid;
    if (!g) return null;
    const cw = this.gridCellW(g);
    return {
      x: g.x + GRID_PAD + (i % N) * (cw + GRID_GAP) + cw / 2,
      y: g.y + GRID_PAD + Math.floor(i / N) * (cw + GRID_GAP) + cw / 2,
    };
  }

  private mineCellBox(k: number, c: number): Rect | null {
    const m = this.rects.mine;
    if (!m) return null;
    const mw = (m.w - 4 * MINE_GAP) / COLS;
    const mh = mw / 1.1;
    return { x: m.x + c * (mw + MINE_GAP), y: m.y + k * (mh + MINE_GAP), w: mw, h: mh };
  }

  // ---- flyBall (legacy DOM animation, ported) ----

  private flyBall(s: GameState, i: number, c: number, r: number, L: number, rng: Rng): Promise<void> {
    return new Promise<void>((resolve) => {
      const from = this.gridCellCenter(i);
      const k = Math.max(0, Math.min(r - s.topRow, this.rows - 1));
      const box = this.rows > 0 ? this.mineCellBox(k, c) : null;
      if (reducedMotion() || !from || !box) {
        setTimeout(resolve, 60); // legacy: reduced motion / missing geometry
        return;
      }
      const g = this.rects.grid as Rect;
      const base = (this.gridCellW(g) * 0.8) / BALL_D;
      const img = this.add
        .image(from.x, from.y, ensureBallTexture(this.textures, curSkin(s).id, L, curRar(s)))
        .setScale(base)
        .setDepth(1000);
      const tx = box.x + box.w / 2;
      const ty = box.y + box.h * 0.2; // legacy: t.top + t.height * 0.2
      const dy = ty - from.y;
      const D = 130 + Math.sqrt(Math.abs(dy)) * 11;
      const rot = (rng() < 0.5 ? -1 : 1) * (180 + rng() * 180);
      // Legacy: X linear, Y/rotation on cubic-bezier(.55,.085,.68,.53), same
      // duration. The X tween is added first so it is already finished when
      // the Y tween's onComplete fires (no two tweens fighting over x).
      this.tweens.add({ targets: img, x: tx, duration: D, ease: 'Linear' });
      this.tweens.add({
        targets: img,
        y: ty,
        angle: rot,
        duration: D,
        ease: cubicBezier(0.55, 0.085, 0.68, 0.53),
        onComplete: () => {
          resolve(); // legacy resolves when the flight ends; the burst follows
          this.burst(img, tx, ty, rot, rng);
        },
      });
    });
  }

  /** Post-land bounce (legacy: squash → pop up → squash & fade over 340 ms). */
  private burst(img: Phaser.GameObjects.Image, tx: number, ty: number, rot: number, rng: Rng): void {
    const base = img.scaleX;
    const drift = (rng() - 0.5) * 40;
    img.setY(ty).setScale(base * 1.3, base * 0.7);
    this.tweens.add({ targets: img, x: tx + drift, duration: 340, ease: 'Linear' });
    this.tweens.add({
      targets: img,
      keyframes: [
        { y: ty - 20, angle: rot + 50, scaleX: base, scaleY: base, alpha: 1, duration: 136 },
        { y: ty + 6, angle: rot + 80, scaleX: base * 1.1, scaleY: base * 0.9, alpha: 0, duration: 204 },
      ],
      ease: 'Quad.Out',
      onComplete: () => img.destroy(),
    });
  }
}
