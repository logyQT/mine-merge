// Bootstrap sequence shared by every platform (PLAN.md §1.1 main.ts):
//   platform.init → markFirstFrame → load save → start game → markReady.
// Kept free of DOM/Phaser so vitest can pin the ordering.

import type { Platform } from './platform/types';

export interface BootOptions {
  onProgress?: (pct: number) => void;
  /** Receives the raw save string (Part 2 wires it into game state). */
  onSave?: (raw: string | null) => void;
  /**
   * Starts the game renderer (Phaser) and resolves once the first frame is
   * painted — injected so this module stays free of DOM/Phaser imports.
   */
  startGame?: () => Promise<unknown>;
}

export async function boot(platform: Platform, opts: BootOptions = {}): Promise<void> {
  await platform.init(opts.onProgress ?? (() => {}));
  platform.markFirstFrame(); // always before gameReady()
  const save = await platform.loadSave();
  opts.onSave?.(save);
  if (opts.startGame) await opts.startGame(); // must paint before markReady()
  platform.markReady(); // YT: gameReady() after double rAF (see yt.ts)
}
