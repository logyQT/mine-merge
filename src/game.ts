// Creates the Phaser game and resolves only once a frame has actually been
// painted, so boot.ts can call platform.markReady() (YT: gameReady()) after
// the first render — PLAN.md Part 2, Phase 1.4 smoke test.

import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';

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
      backgroundColor: '#101828',
      banner: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      scene: [BootScene],
    });
    // POST_RENDER fires right after the first frame is drawn to the canvas.
    game.events.once(Phaser.Core.Events.POST_RENDER, () => resolve(game));
  });
}
