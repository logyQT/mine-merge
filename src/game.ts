// Creates the Phaser game and resolves only once a frame has actually been
// painted, so boot.ts can call platform.markReady() (YT: gameReady()) after
// the first render — PLAN.md Part 2, Phase 1.4 smoke test.
//
// The canvas is transparent and sits inside #app behind the DOM chrome: the
// DOM owns the HUD/buttons (Phase 3.4), MineScene draws the board regions
// (#grid/#mine spacers) on demand, and WarScene (Phase 4) draws the war view
// (#eRow/#wLog/#pRow) — lifted above the #war overlay via #app.canvas-top
// during the war screen (see src/style.css). During a drop, #app.board-top
// lifts the canvas above the DOM so flyBall passes over #inv.

import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MineScene } from './scenes/MineScene';
import { WarScene } from './scenes/WarScene';

export interface StartGameOptions {
  /** Container for the canvas; defaults to #app (index.html). */
  parent?: HTMLElement;
}

/** Boot Phaser and resolve with the game after the first painted frame. */
export function startGame(opts: StartGameOptions = {}): Promise<Phaser.Game> {
  return new Promise((resolve) => {
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: opts.parent ?? document.getElementById('app') ?? document.body,
      transparent: true, // the body/legacy background shows between DOM widgets
      banner: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [BootScene, MineScene, WarScene], // Boot generates textures, then starts Mine (and launches War)
    });
    // POST_RENDER fires right after the first frame is drawn to the canvas.
    game.events.once(Phaser.Core.Events.POST_RENDER, () => resolve(game));
  });
}
