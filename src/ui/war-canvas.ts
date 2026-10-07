// Canvas war façade (PLAN.md Phase 4), mirroring ./board: WarScene registers
// itself here on create and draws the war VIEW — both army rows and the
// battle log — from GameState/Fight at the controller's renderWar() cadence.
// The last render/log are cached and replayed because the scene boots one
// frame after startApp() (same pattern as registerBoard).
//
// setWarOpen() owns the Phase 4 z-order state: while the war screen is open,
// #app.canvas-top lifts the canvas above the opaque #war overlay
// (background:var(--bg), z-index 10 — it would hide the canvas otherwise)
// and drops its pointer events, so war needs zero canvas input and every
// click keeps reaching the DOM buttons underneath (src/style.css).
//
// Views only read GameState: no gameplay logic lives on this side of the
// facade, and core/war.ts is untouched.

import type { GameState } from '../core/state';
import type { Fight } from '../core/war';
import { boardVisible } from './board';

/** What WarScene implements (all drawing lives in the scene). */
export interface WarApi {
  render(s: GameState, fight: Fight | null): void;
  log(text: string): void;
  setVisible(v: boolean): void;
}

let api: WarApi | null = null;
let last: [GameState, Fight | null] | null = null;
let lastLog = '';
let shown = false;

/** Called by WarScene.create(); replays the cached state, if any. */
export function registerWar(w: WarApi): void {
  api = w;
  w.setVisible(shown);
  if (last) w.render(...last);
  w.log(lastLog);
}

/** Army rows + info redraw — same cadence as the DOM renderWar() had. */
export function warRender(s: GameState, fight: Fight | null): void {
  last = [s, fight];
  api?.render(s, fight);
}

/** Battle log text (controller: wLog). */
export function warLog(text: string): void {
  lastLog = text;
  // Local-only handle for tests/e2e (like __platform/__game in main.ts): the
  // log is canvas-drawn now, so suites read it here instead of #wLog.
  if (__PLATFORM__ === 'local') globalThis.__warLog = text;
  api?.log(text);
}

/**
 * Toggles the war screen's canvas mode: .canvas-top on #app (canvas above
 * the overlay, pointer-events:none) plus scene visibility — one canvas
 * serves both scenes, so the board must not paint over #war while open.
 */
export function setWarOpen(on: boolean): void {
  shown = on;
  document.getElementById('app')?.classList.toggle('canvas-top', on);
  boardVisible(!on); // hide the mine board (it would show through)
  api?.setVisible(on);
}
