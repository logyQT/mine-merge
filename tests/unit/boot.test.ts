// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../../src/boot.ts';
import { createMockPlatform } from '../../src/platform/mock.ts';
import { isDebugPlatform, mountDebugHud } from '../../src/platform/debug-hud.ts';
import type { Platform } from '../../src/platform/types.ts';

// Part 1 smoke tests: the bootstrap must run init → firstFrame → load save →
// ready in that order (PLAN.md §1.1), and the local debug HUD must drive the
// mock's pause/audio/reload hooks.

function recordingPlatform(save: string | null = null): Platform & { calls: string[] } {
  const calls: string[] = [];
  return {
    id: 'local',
    features: { ads: true, multiplayer: true, cloudSave: false },
    async init(onProgress) {
      calls.push('init');
      onProgress(0);
      onProgress(100);
    },
    markFirstFrame: () => void calls.push('firstFrame'),
    markReady: () => void calls.push('ready'),
    async loadSave() {
      calls.push('loadSave');
      return save;
    },
    async saveSave() {
      calls.push('saveSave');
    },
    getLanguage: () => 'pl',
    isAudioEnabled: () => true,
    onAudioChange: () => {},
    onPause: () => {},
    onResume: () => {},
    sendScore: () => {},
    logWarning: () => {},
    async requestInterstitial() {},
    async requestRewarded() {
      return false;
    },
    calls,
  };
}

describe('boot', () => {
  it('runs init → firstFrame → loadSave → ready, forwarding progress and save', async () => {
    const p = recordingPlatform('{"coins":1}');
    const progress: number[] = [];
    const saves: (string | null)[] = [];
    await boot(p, { onProgress: (pct) => progress.push(pct), onSave: (raw) => saves.push(raw) });
    expect(p.calls).toEqual(['init', 'firstFrame', 'loadSave', 'ready']);
    expect(progress).toEqual([0, 100]);
    expect(saves).toEqual(['{"coins":1}']);
  });

  it('still marks first frame and ready when there is no save', async () => {
    const p = recordingPlatform();
    const saves: (string | null)[] = [];
    await boot(p, { onSave: (raw) => saves.push(raw) });
    expect(p.calls).toEqual(['init', 'firstFrame', 'loadSave', 'ready']);
    expect(saves).toEqual([null]);
  });

  it('boots the mock platform end-to-end', async () => {
    const p = createMockPlatform({ initialSave: 'cloud' });
    let loaded: string | null = 'unset';
    await boot(p, { onSave: (raw) => (loaded = raw) });
    expect(p.firstFrame).toBe(true);
    expect(p.ready).toBe(true);
    expect(p.progress).toEqual([0, 100]);
    expect(loaded).toBe('cloud');
  });

  it('awaits startGame (first painted frame) before markReady', async () => {
    const p = recordingPlatform();
    const calls = p.calls;
    let painted = false;
    await boot(p, {
      startGame: async () => {
        // Simulate Phaser resolving on the first POST_RENDER.
        await Promise.resolve();
        calls.push('painted');
        painted = true;
      },
    });
    expect(painted).toBe(true);
    expect(calls).toEqual(['init', 'firstFrame', 'loadSave', 'painted', 'ready']);
    // ready must never precede the painted frame (YT: gameReady after paint)
    expect(calls.indexOf('ready')).toBeGreaterThan(calls.indexOf('painted'));
  });
});

describe('debug hud', () => {
  let platform: ReturnType<typeof createMockPlatform>;

  beforeEach(() => {
    document.body.innerHTML = '';
    platform = createMockPlatform();
  });

  it('recognizes the mock as a debug platform', () => {
    expect(isDebugPlatform(platform)).toBe(true);
    expect(isDebugPlatform(recordingPlatform())).toBe(false);
  });

  it('toggles audio and pause state on the mock', () => {
    const hud = mountDebugHud(platform, { container: document.body });
    const [audioBtn, pauseBtn] = document.querySelectorAll<HTMLButtonElement>('button');
    expect(audioBtn.textContent).toBe('audio: on');
    expect(pauseBtn.textContent).toBe('pause');

    audioBtn.click();
    expect(platform.isAudioEnabled()).toBe(false);
    expect(audioBtn.textContent).toBe('audio: off');

    pauseBtn.click();
    expect(platform.paused).toBe(true);
    expect(pauseBtn.textContent).toBe('resume');
    hud();
  });

  it('triggers the reload handler and unmounts cleanly', () => {
    const onReload = vi.fn();
    const hud = mountDebugHud(platform, { container: document.body, onReload });
    const reloadBtn = document.querySelector<HTMLButtonElement>('button:last-child')!;
    expect(reloadBtn.textContent).toBe('reload-save');
    reloadBtn.click();
    expect(onReload).toHaveBeenCalledTimes(1);
    hud();
    expect(document.querySelector('.debug-hud')).toBeNull();
  });
});
