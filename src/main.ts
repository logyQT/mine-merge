// Bootstrap entry point: pick the platform for this build, run the boot
// sequence (init → first frame → load save → start Phaser + DOM view → ready),
// show progress, and (locally only) mount the debug HUD.

import './style.css';
import { boot } from './boot';
import { startGame } from './game';
import { startApp, state } from './app';
import { restore } from './core/save';
import { createPlatform } from './platform/detect';
import { isDebugPlatform, mountDebugHud } from './platform/debug-hud';
import { ensureBallTexture } from './scenes/textures';

function showProgress(pct: number): void {
  let el = document.getElementById('boot-progress') as HTMLProgressElement | null;
  if (!el) {
    el = document.createElement('progress');
    el.id = 'boot-progress';
    el.max = 100;
    document.body.prepend(el);
  }
  el.value = pct;
}

const platform = createPlatform();

// Local-only handle for the Playwright e2e suite (tests/e2e). The
// __PLATFORM__ guard tree-shakes it out of yt/portal builds.
if (__PLATFORM__ === 'local' && isDebugPlatform(platform)) {
  globalThis.__platform = platform;
}

boot(platform, {
  onProgress: showProgress,
  startGame: async () => {
    const game = await startGame();
    // Kit lifecycle wiring (PLAN DoD): platform pause freezes the game loop,
    // resume restarts it, and sound output follows the platform's audio flag.
    platform.onPause(() => game.loop.sleep());
    platform.onResume(() => game.loop.wake());
    game.sound.mute = !platform.isAudioEnabled();
    platform.onAudioChange((on) => {
      game.sound.mute = !on;
    });
    // Tree-shaken out of non-local builds, like the __platform handle above.
    if (__PLATFORM__ === 'local') {
      globalThis.__game = game;
      // Lets the e2e suite force-generate any (skin × level × rarity) ball
      // texture and pin the Phase 3.1 palette → texture path.
      globalThis.__ensureBall = (skinId, L, rar) => ensureBallTexture(game.textures, skinId, L, rar);
    }
    startApp(platform); // mount the DOM view + wire controls before markReady()
    return game;
  },
  onSave: (raw) => {
    restore(state, raw); // schema-v1 accepted forever (core/save.ts)
    if (raw) console.debug(`save loaded (${raw.length} B)`); // pinned by e2e
  },
})
  .catch((err) => platform.logWarning(String(err)))
  .finally(() => {
    document.getElementById('boot-progress')?.remove();
    // Tree-shaken out of yt/fb/portal builds by the __PLATFORM__ define.
    if (__PLATFORM__ === 'local' && isDebugPlatform(platform)) {
      mountDebugHud(platform, { container: document.body });
    }
  });
