// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createYtPlatform, type YtGame } from '../../src/platform/yt.ts';
import { createPlatform } from '../../src/platform/detect.ts';

// Contract tests for the YouTube adapter, run against a fake SDK — the same
// calls legacy/app.js lines 16–29 / 471–485 made, now behind the Platform
// interface (PLAN.md §1.2).

interface FakeOptions {
  inPlay?: boolean;
  audio?: boolean;
  language?: string;
  failLoad?: boolean;
  failSave?: boolean;
}

function fakeSdk(opts: FakeOptions = {}) {
  const { inPlay = true, audio = true, language = 'pl', failLoad = false, failSave = false } = opts;
  return {
    IN_PLAYABLES_ENV: inPlay,
    game: {
      firstFrameReady: vi.fn(),
      gameReady: vi.fn(),
      loadData: vi.fn(async () => (failLoad ? Promise.reject(new Error('boom')) : '{"a":1}')),
      saveData: vi.fn(async (_data: string) => {
        if (failSave) throw new Error('boom');
      }),
    },
    system: {
      isAudioEnabled: vi.fn(() => audio),
      onAudioEnabledChange: vi.fn(),
      onPause: vi.fn(),
      onResume: vi.fn(),
      getLanguage: vi.fn(async () => language),
    },
    engagement: { sendScore: vi.fn() },
    health: { logWarning: vi.fn(), logError: vi.fn() },
  } satisfies YtGame;
}

describe('yt platform', () => {
  it('reports init progress 0 → 100 and caches the SDK language', async () => {
    const sdk = fakeSdk({ language: 'pl' });
    const p = createYtPlatform(sdk);
    const seen: number[] = [];
    expect(p.getLanguage()).not.toBe('pl'); // navigator fallback until init
    await p.init((pct) => seen.push(pct));
    expect(seen).toEqual([0, 100]);
    expect(p.getLanguage()).toBe('pl');
  });

  it('wires audio state from the SDK and forwards changes', async () => {
    const sdk = fakeSdk({ audio: false });
    const p = createYtPlatform(sdk);
    const seen: boolean[] = [];
    p.onAudioChange((on) => seen.push(on));
    await p.init(() => {});
    expect(p.isAudioEnabled()).toBe(false);
    const cb = sdk.system.onAudioEnabledChange.mock.calls[0][0];
    cb(true);
    expect(p.isAudioEnabled()).toBe(true);
    expect(seen).toEqual([true]);
  });

  it('forwards pause/resume events to registered callbacks', async () => {
    const sdk = fakeSdk();
    const p = createYtPlatform(sdk);
    const events: string[] = [];
    p.onPause(() => events.push('pause'));
    p.onResume(() => events.push('resume'));
    await p.init(() => {});
    sdk.system.onPause.mock.calls[0][0]();
    sdk.system.onResume.mock.calls[0][0]();
    expect(events).toEqual(['pause', 'resume']);
  });

  it('marks first frame synchronously and ready after double rAF', async () => {
    const sdk = fakeSdk();
    const p = createYtPlatform(sdk);
    p.markFirstFrame();
    expect(sdk.game.firstFrameReady).toHaveBeenCalledTimes(1);
    p.markReady();
    await vi.waitFor(() => expect(sdk.game.gameReady).toHaveBeenCalledTimes(1));
  });

  it('loads and saves through the SDK, tolerating failures', async () => {
    const ok = fakeSdk();
    const p = createYtPlatform(ok);
    expect(await p.loadSave()).toBe('{"a":1}');
    await p.saveSave('{"x":2}');
    expect(ok.game.saveData).toHaveBeenCalledWith('{"x":2}');

    const bad = fakeSdk({ failLoad: true, failSave: true });
    const q = createYtPlatform(bad);
    expect(await q.loadSave()).toBeNull(); // cloud error → no save, no crash
    await expect(q.saveSave('data')).resolves.toBeUndefined();
    expect(bad.health.logWarning).toHaveBeenCalled();
  });

  it('never touches the SDK outside the Playables environment', async () => {
    const sdk = fakeSdk({ inPlay: false });
    const p = createYtPlatform(sdk);
    await p.init(() => {});
    p.markFirstFrame();
    p.markReady();
    expect(await p.loadSave()).toBeNull();
    await p.saveSave('x');
    p.sendScore(5);
    expect(sdk.game.firstFrameReady).not.toHaveBeenCalled();
    expect(sdk.game.gameReady).not.toHaveBeenCalled();
    expect(sdk.game.saveData).not.toHaveBeenCalled();
    expect(sdk.engagement.sendScore).not.toHaveBeenCalled();
  });

  it('rounds and clamps scores like legacy sendBest()', async () => {
    const sdk = fakeSdk();
    const p = createYtPlatform(sdk);
    p.sendScore(-3);
    p.sendScore(12.6);
    expect(sdk.engagement.sendScore).toHaveBeenNthCalledWith(1, { value: 0 });
    expect(sdk.engagement.sendScore).toHaveBeenNthCalledWith(2, { value: 13 });
  });

  it('tolerates a rejected sendScore (official API rejects with SdkError)', async () => {
    const sdk = fakeSdk();
    sdk.engagement.sendScore.mockRejectedValueOnce(new Error('boom'));
    const p = createYtPlatform(sdk);
    p.sendScore(7); // handler attached synchronously → no unhandled rejection
    await vi.waitFor(() => expect(sdk.health.logWarning).toHaveBeenCalled());
  });

  it('keeps ads disabled until the ad API is ported', async () => {
    const p = createYtPlatform(fakeSdk());
    expect(p.features.ads).toBe(false);
    await expect(p.requestInterstitial()).resolves.toBeUndefined();
    await expect(p.requestRewarded('crate-free-1')).resolves.toBe(false);
  });
});

describe('createPlatform (detect)', () => {
  it('selects the mock for the default local build', () => {
    // vitest runs with PLATFORM unset → __PLATFORM__ === 'local'
    expect(createPlatform().id).toBe('local');
  });
});
