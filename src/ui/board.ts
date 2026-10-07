// Canvas board façade (PLAN.md Phase 3.2): keeps the render-cadence API the
// controller had from the DOM view — boardRender (was: the #grid block inside
// game-view render()), renderMine (hit flash) and flyBall — with unchanged
// signatures, so src/app.ts only changes its import lines. MineScene
// registers itself here on create; the last render args are cached and
// replayed because the scene boots one frame after startApp() first runs.
//
// Views only read GameState: no gameplay logic lives on this side of the
// façade, and the injected RNG stays the last parameter (core convention).

import type { Rng } from '../core/rng';
import type { GameState } from '../core/state';

export interface Ui {
  sel: number | null;
  busy: boolean;
}

export interface Handlers {
  tap(i: number): void;
  take(level: number): void;
}

export interface Hit {
  c: number;
  r: number;
}

/** What MineScene implements (all drawing/animation lives in the scene). */
export interface BoardApi {
  render(s: GameState, ui: Ui, h: Handlers, rng: Rng): void;
  renderMine(s: GameState, rng: Rng, hit?: Hit): void;
  flyBall(s: GameState, i: number, c: number, r: number, L: number, rng: Rng): Promise<void>;
}

let api: BoardApi | null = null;
let last: [GameState, Ui, Handlers, Rng] | null = null;

/** Called by MineScene.create(); replays the cached first render, if any. */
export function registerBoard(b: BoardApi): void {
  api = b;
  if (last) b.render(...last);
}

/** Full board redraw (grid + mine) — same cadence as the DOM view's render(). */
export function boardRender(s: GameState, ui: Ui, h: Handlers, rng: Rng): void {
  last = [s, ui, h, rng];
  api?.render(s, ui, h, rng);
}

/** Mine redraw + just-landed flash (controller: after land(), legacy renderMine). */
export function renderMine(s: GameState, rng: Rng, hit?: Hit): void {
  api?.renderMine(s, rng, hit);
}

/**
 * Grid → mine ball flight; resolves when the ball lands (the post-land burst
 * keeps playing, exactly like the legacy DOM flyBall). Without a scene the
 * drop still resolves — same 60 ms as the reduced-motion fallback.
 */
export function flyBall(s: GameState, i: number, c: number, r: number, L: number, rng: Rng): Promise<void> {
  if (api) return api.flyBall(s, i, c, r, L, rng);
  return new Promise((res) => setTimeout(res, 60));
}
