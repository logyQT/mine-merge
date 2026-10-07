// Bootstrap entry point: pick the platform for this build, run the boot
// sequence, show progress, and (locally only) mount the debug HUD.
// Phaser boot lands here in Part 2 / Phase 1 — see PLAN.md.

import { boot } from './boot';
import { createPlatform } from './platform/detect';
import { isDebugPlatform, mountDebugHud } from './platform/debug-hud';

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

boot(platform, {
  onProgress: showProgress,
  onSave: (raw) => {
    // TODO(Phase 2): hand off to core/save.ts applySave().
    if (raw) console.debug(`save loaded (${raw.length} B)`);
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
