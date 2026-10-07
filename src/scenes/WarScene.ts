// WarScene — the canvas war view (PLAN.md Phase 4).
//
// Draws what legacy rendered as DOM inside #war: both army rows — ball
// sprites through ensureBallTexture (same skin/rarity look as the board),
// HP bars and burn🔥/slow❄/weak☠ markers via Graphics/Text — and the battle
// log as word-wrapped Phaser Text. The #war shell (header, #wInfo, buttons,
// help paragraph) stays in the DOM this phase: it is the i18n surface.
//
// Geometry: #eRow/#wLog/#pRow are transparent spacers (index.html) measured
// relative to the canvas — the same multi-rect approach MineScene uses for
// #grid/#mine. The scene writes their heights so the #war flex column keeps
// the legacy flow while the boxes stay empty; the metrics below were probed
// against legacy/ in a headless run (legacy/style.css is the spec):
//   .wb 58 wide · .it 52 + 3px margin · .hp 6px at y+55 · marker line 12px
//   (15px once an emoji marker is present — emoji inline boxes grow the
//   line, so a row is 73px tall and 76px while any of its balls is marked;
//   legacy reflows by those +3px mid-fight, and so do we).
//   #wLog: 13px font, 15px line advance, CSS min-height 34 (wins below).
//
// While the war screen is open, #app.canvas-top puts the canvas above the
// #war overlay with pointer-events:none — zero canvas input by design; all
// clicks must keep reaching the DOM buttons (setWarOpen in ../ui/war-canvas).
//
// Rendering is event-driven at the controller's renderWar() cadence; views
// only read GameState/Fight and core/war.ts stays untouched.

import * as Phaser from 'phaser';
import { curRar, curSkin } from '../core/cosmetics';
import type { GameState } from '../core/state';
import type { Combatant, Fight } from '../core/war';
import { registerWar } from '../ui/war-canvas';
import { BALL_D, ensureBallTexture } from './textures';

// Legacy .wrow/.wb metrics (probed — see the header comment).
const WB_W = 58; // .wb width
const BALL_BOX = 52; // .wb .it box
const ROW_GAP = 6; // .wrow gap
const ROW_H = 73; // .wb height without markers
const ROW_H_MARKED = 76; // .wb height once an emoji marker is present
const HP_Y = 55; // .hp offset inside .wb (52 + 3px margin)
const HP_H = 6;
const HP_R = 3; // .hp border-radius
const MARKER_Y = 61; // marker line top inside .wb
const LOG_SIZE = 13; // #wLog font-size
const LOG_LINE = 15; // legacy line advance at 13px (probe: 2 lines = 30px)
const FONT = '"Trebuchet MS", "Segoe UI", sans-serif';
const HP_GREEN = 0x4ade80; // .hp i background

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Rects = { e: Rect | null; l: Rect | null; p: Rect | null };

const sig = (r: Rects): string =>
  [r.e?.x, r.e?.y, r.e?.w, r.e?.h, r.l?.x, r.l?.y, r.l?.w, r.l?.h, r.p?.x, r.p?.y, r.p?.w, r.p?.h].join(',');

/** One army slot: ball sprite + HP bar + marker line (legacy .wb). */
interface RowBall {
  wrap: Phaser.GameObjects.Container;
  img: Phaser.GameObjects.Image;
  hp: Phaser.GameObjects.Graphics;
  marker: Phaser.GameObjects.Text;
}

const hasMark = (c: Combatant): boolean => c.burn > 0 || c.slow > 0 || c.wk > 0;

export class WarScene extends Phaser.Scene {
  private s: GameState | null = null;
  private fight: Fight | null = null;
  private log = '';
  private shown = false;
  private lastSig = '';
  private rows: RowBall[][] = [[], []]; // [top, bottom]
  private logText!: Phaser.GameObjects.Text;

  constructor() {
    super('War');
  }

  create(): void {
    this.logText = this.add.text(0, 0, '', {
      fontFamily: FONT,
      fontSize: `${LOG_SIZE}px`,
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 1 },
    });
    this.logText.setOrigin(0.5, 0);
    this.logText.setLineSpacing(LOG_LINE - LOG_SIZE); // legacy 15px advance
    this.logText.setVisible(false);

    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 5; i++) {
        const img = this.add.image(0, 0, 'ball-def-1-0');
        img.setOrigin(0.5, 0.5);
        img.setPosition(WB_W / 2, BALL_BOX / 2);
        img.setScale(BALL_BOX / BALL_D);
        const hp = this.add.graphics();
        const marker = this.add
          .text(0, 0, '', { fontFamily: FONT, fontSize: '11px', color: '#ffffff' })
          .setOrigin(0.5, 0)
          .setPosition(WB_W / 2, MARKER_Y);
        const wrap = this.add.container(0, 0, [img, hp, marker]).setVisible(false);
        this.rows[row].push({ wrap, img, hp, marker });
      }
    }

    registerWar({
      render: (s, fight) => {
        this.s = s;
        this.fight = fight;
        this.draw();
      },
      log: (text) => {
        this.log = text;
        this.draw();
      },
      setVisible: (v) => {
        this.shown = v;
        this.scene.setVisible(v);
        this.draw();
      },
    });
  }

  /** Re-lay out when the spacers move (viewport resize, marker reflow). */
  update(): void {
    if (!this.shown) return;
    const rects = this.measure();
    if (sig(rects) !== this.lastSig) this.draw();
  }

  // ---- content (state → view, renderWar() cadence) ----

  private draw(): void {
    const pre = this.measure();

    // Battle log: wrap to the spacer, then let the written height follow the
    // text (legacy #wLog is min-height 34 — the CSS wins below that).
    this.logText.setText(this.log);
    if (pre.l) this.logText.setWordWrapWidth(pre.l.w);
    this.logText.updateText(); // setWordWrapWidth alone does not re-render

    const top = this.army(true);
    const bottom = this.army(false);
    const writeH = (id: string, h: string): void => {
      const el = document.getElementById(id);
      if (el && el.style.height !== h) el.style.height = h;
    };
    writeH('eRow', this.rowHeight(top));
    writeH('pRow', this.rowHeight(bottom));
    writeH('wLog', this.log ? `${this.logText.height}px` : '');

    // Heights are written — re-measure so the flow shift lands this frame.
    const rects = this.measure();
    this.lastSig = sig(rects);
    this.drawRow(rects.e, top, this.rows[0]);
    this.drawRow(rects.p, bottom, this.rows[1]);
    if (rects.l && this.log) {
      this.logText.setPosition(rects.l.x + rects.l.w / 2, rects.l.y).setVisible(true);
    } else {
      this.logText.setVisible(false);
    }
  }

  /** Top row = enemy (flipped for PvP), bottom = player — legacy renderWar. */
  private army(top: boolean): Combatant[] {
    const f = this.fight;
    if (!f) return [];
    return top ? (f.flip ? f.p : f.e) : f.flip ? f.e : f.p;
  }

  /** Legacy .wb height: 73, or 76 while any ball in the row shows a marker. */
  private rowHeight(arr: Combatant[]): string {
    if (!arr.length) return '';
    return `${arr.some(hasMark) ? ROW_H_MARKED : ROW_H}px`;
  }

  private drawRow(rect: Rect | null, arr: Combatant[], pool: RowBall[]): void {
    pool.forEach((b, i) => b.wrap.setVisible(i < arr.length));
    if (!rect || !arr.length || !this.s) return;
    const s = this.s;
    const skin = curSkin(s);
    const rar = curRar(s);
    const total = arr.length * WB_W + (arr.length - 1) * ROW_GAP;
    const x0 = rect.x + Math.max(0, (rect.w - total) / 2); // .wrow justify:center
    arr.forEach((c, i) => {
      const b = pool[i];
      b.wrap.setPosition(x0 + i * (WB_W + ROW_GAP), rect.y);
      b.wrap.setAlpha(c.hp <= 0 ? 0.25 : 1); // .wb.dead
      b.img.setTexture(ensureBallTexture(this.textures, skin.id, c.L, rar));
      // Legacy: 🔥 while burning, ❄ while slowed, ☠ once ever weakened.
      b.marker.setText(
        `${c.burn > 0 ? '🔥' : ''}${c.slow > 0 ? '❄' : ''}${c.wk > 0 ? '☠' : ''}\u00a0`,
      );
      this.drawHp(b.hp, c);
    });
  }

  /** Legacy .hp bar: #0006 track, #4ade80 fill (rounded only where the
   *  overflow:hidden container clips it — left edge, plus right at 100%). */
  private drawHp(g: Phaser.GameObjects.Graphics, c: Combatant): void {
    g.clear();
    g.fillStyle(0x000000, 0.4); // background:#0006
    g.fillRoundedRect(0, HP_Y, WB_W, HP_H, HP_R);
    const frac = c.max > 0 ? Math.max(0, Math.min(1, c.hp / c.max)) : 0;
    if (frac <= 0) return;
    const w = frac * WB_W;
    const r = Math.min(HP_R, w / 2);
    g.fillStyle(HP_GREEN, 1);
    g.fillRoundedRect(0, HP_Y, w, HP_H, frac >= 1 ? HP_R : { tl: r, tr: 0, br: 0, bl: r });
  }

  // ---- geometry (spacers → canvas rects; re-applied on every change) ----

  private measure(): Rects {
    const cb = this.game.canvas.getBoundingClientRect();
    const read = (id: string): Rect | null => {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - cb.left, y: r.top - cb.top, w: r.width, h: r.height };
    };
    return { e: read('eRow'), l: read('wLog'), p: read('pRow') };
  }
}
