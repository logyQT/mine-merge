import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTERSTITIAL_GAP_MS, REWARD, showInterstitial, showRewarded } from '../../src/ads/index.ts';
import { createMockPlatform } from '../../src/platform/mock.ts';
import type { Platform } from '../../src/platform/types.ts';

// PLAN.md Phase 5.1: the ads layer owns the platform gate + pacing and must
// degrade gracefully — an ad failure can never break gameplay flow.

let base = 0; // per-test clock base (pacing state is module-level)
let tests = 0;

function platformWith(over: Partial<Platform> = {}): Platform {  return {
    id: 'local',
    features: { ads: true, multiplayer: false, cloudSave: false },
    async init() {},
    markFirstFrame() {},
    markReady() {},
    async loadSave() {
      return null;
    },
    async saveSave() {},
    getLanguage: () => 'pl',
    isAudioEnabled: () => true,
    onAudioChange() {},
    onPause() {},
    onResume() {},
    sendScore() {},
    logWarning() {},
    async requestInterstitial() {},
    async requestRewarded() {
      return true;
    },
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // Pacing state is module-level (real-game semantics), so each test starts
  // on a fresh, later clock — guarantees the gap from a prior test can't
  // swallow this test's interstitial.
  base = new Date('2026-10-10T12:00:00Z').getTime() + tests++ * INTERSTITIAL_GAP_MS * 2;
  vi.setSystemTime(new Date(base));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('reward ids', () => {
  it('are stable and carry no user data (PLAN DoD)', () => {
    expect(REWARD).toEqual({
      crateFree: 'crate-free-1',
      boost2x: 'boost-2x-1',
      warDouble: 'war-double-1',
      coinsDouble: 'coins-double-1',
      statsReset: 'stats-reset-1',
    });
    for (const id of Object.values(REWARD)) expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('showInterstitial', () => {
  it('asks the platform once and paces repeats by the gap', async () => {
    const requestInterstitial = vi.fn(async () => {});
    await showInterstitial(platformWith({ requestInterstitial }));
    expect(requestInterstitial).toHaveBeenCalledTimes(1);

    // Inside the gap: skipped.
    vi.setSystemTime(Date.now() + INTERSTITIAL_GAP_MS - 1);
    await showInterstitial(platformWith({ requestInterstitial }));
    expect(requestInterstitial).toHaveBeenCalledTimes(1);

    // Past the gap: shown again.
    vi.setSystemTime(Date.now() + 2);
    await showInterstitial(platformWith({ requestInterstitial }));
    expect(requestInterstitial).toHaveBeenCalledTimes(2);
  });

  it('is a silent no-op when the platform has no ads (portal)', async () => {
    const requestInterstitial = vi.fn(async () => {});
    await showInterstitial(platformWith({ features: { ads: false, multiplayer: false, cloudSave: false }, requestInterstitial }));
    expect(requestInterstitial).not.toHaveBeenCalled();
  });

  it('never throws into gameplay: a rejecting SDK resolves and logs', async () => {
    const logWarning = vi.fn();
    const p = platformWith({
      logWarning,
      requestInterstitial: async () => {
        throw new Error('boom');
      },
    });
    await expect(showInterstitial(p)).resolves.toBeUndefined();
    expect(logWarning).toHaveBeenCalledWith('interstitial ad failed');
  });
});

describe('showRewarded', () => {
  it('forwards the reward id and resolves the platform result', async () => {
    const requestRewarded = vi.fn(async (id: string) => id === REWARD.crateFree);
    await expect(showRewarded(platformWith({ requestRewarded }), REWARD.crateFree)).resolves.toBe(true);
    await expect(showRewarded(platformWith({ requestRewarded }), REWARD.boost2x)).resolves.toBe(false);
    expect(requestRewarded).toHaveBeenCalledWith(REWARD.crateFree);
  });

  it('resolves false on ads-less platforms (callers show their fallback)', async () => {
    const requestRewarded = vi.fn(async () => true);
    const p = platformWith({ features: { ads: false, multiplayer: false, cloudSave: false }, requestRewarded });
    await expect(showRewarded(p, REWARD.crateFree)).resolves.toBe(false);
    expect(requestRewarded).not.toHaveBeenCalled();
  });

  it('never throws into gameplay: a rejecting SDK resolves false and logs', async () => {
    const logWarning = vi.fn();
    const p = platformWith({
      logWarning,
      requestRewarded: async () => {
        throw new Error('boom');
      },
    });
    await expect(showRewarded(p, REWARD.statsReset)).resolves.toBe(false);
    expect(logWarning).toHaveBeenCalledWith('rewarded ad failed');
  });
});

describe('mock platform integration', () => {
  it('records placements for the debug HUD / e2e', async () => {
    const p = createMockPlatform();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await showInterstitial(p);
    await expect(showRewarded(p, REWARD.warDouble)).resolves.toBe(true);
    expect(p.interstitials).toBe(1);
    expect(p.rewards).toEqual([REWARD.warDouble]);
  });
});
