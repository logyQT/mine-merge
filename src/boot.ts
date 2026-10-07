// Bootstrap sequence shared by every platform (PLAN.md §1.1 main.ts):
//   platform.init → markFirstFrame → load save → start game → markReady.
// Kept free of DOM/Phaser so vitest can pin the ordering.

import type { Platform } from './platform/types';

export interface BootOptions {
  onProgress?: (pct: number) => void;
  /** Receives the raw save string (Part 2 wires it into game state). */
  onSave?: (raw: string | null) => void;
}

export async function boot(platform: Platform, opts: BootOptions = {}): Promise<void> {
  await platform.init(opts.onProgress ?? (() => {}));
  platform.markFirstFrame(); // always before gameReady()
  const save = await platform.loadSave();
  opts.onSave?.(save);
  // TODO(Phase 1): start Phaser here — game must paint before markReady().
  platform.markReady(); // YT: gameReady() after double rAF (see yt.ts)
}
