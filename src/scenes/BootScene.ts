// Boot scene: currently an empty placeholder whose only job is to prove the
// full chain main.ts → Phaser → first painted frame → platform.markReady()
// (PLAN.md Part 2, Phase 1.4). Texture generation and the loading bar move
// here in Phase 3 — see PLAN.md §Phase 3.1.

import * as Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    // Intentionally empty: the game's backgroundColor covers the first frame.
    // TODO(Phase 3): generate textures from the legacy palettes + loading bar.
  }
}
