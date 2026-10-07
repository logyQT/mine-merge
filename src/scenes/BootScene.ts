// Boot scene (PLAN.md Phase 3.1): generates every board texture at runtime
// from the existing palettes — 0 asset files (CSP-clean, budget-clean), no
// PNGs for gradients. Mine cells are fixed per-HP-tier; balls are prewarmed
// for the common (skin × level × rarity) combos and created lazily on demand
// by ensureBallTexture() when MineScene renders anything new.
//
// The first painted frame is what startGame() resolves on (POST_RENDER) —
// texture generation is synchronous, so it completes before that frame.

import * as Phaser from 'phaser';
import { generateMineTextures, prewarmBallTextures } from './textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    generateMineTextures(this.textures);
    prewarmBallTextures(this.textures);
    // Textures are synchronous — hand over to the board scene immediately.
    // War (Phase 4) boots in parallel behind its hidden #war overlay and
    // registers with the canvas facade until the screen opens.
    this.scene.launch('War');
    this.scene.start('Mine');
  }
}
