// Dev-only debug HUD for the local mock platform (PLAN.md §1.1 mock.ts):
// buttons for pause / resume / audio-off / reload-save. Compiled out of YT
// builds via the __PLATFORM__ check in main.ts (and harmless if reached —
// only mounted for platforms exposing the mock's simulation hooks).

import type { MockPlatform } from './mock';
import type { Platform } from './types';

export function isDebugPlatform(p: Platform): p is MockPlatform {
  return 'emitPause' in p && 'setAudioEnabled' in p && 'emitResume' in p;
}

export interface DebugHudOptions {
  container: HTMLElement;
  /** Called by the reload-save button; defaults to a full page reload. */
  onReload?: () => void;
}

export function mountDebugHud(platform: MockPlatform, opts: DebugHudOptions): () => void {
  const bar = document.createElement('div');
  bar.className = 'debug-hud';
  bar.style.cssText =
    'position:fixed;bottom:0;left:0;right:0;display:flex;gap:4px;padding:4px;' +
    'background:rgba(0,0,0,.75);font:11px/1.2 sans-serif;z-index:99;justify-content:center';

  const add = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:11px sans-serif;padding:4px 8px';
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };

  const audioBtn = add('', () => platform.setAudioEnabled(!platform.isAudioEnabled()));
  const pauseBtn = add('', () => (platform.paused ? platform.emitResume() : platform.emitPause()));
  add('reload-save', () => (opts.onReload ?? (() => location.reload()))());

  const sync = () => {
    audioBtn.textContent = platform.isAudioEnabled() ? 'audio: on' : 'audio: off';
    pauseBtn.textContent = platform.paused ? 'resume' : 'pause';
  };
  platform.onAudioChange(sync);
  platform.onPause(sync);
  platform.onResume(sync);
  sync();

  opts.container.appendChild(bar);
  return () => bar.remove();
}
