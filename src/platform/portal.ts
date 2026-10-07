// Portal platform stub (Poki / CrazyGames — PLAN.md §1.1). Until the real
// portal SDK is ported, behave exactly like the local mock (localStorage
// persistence, navigator-driven language) but report the portal identity and
// conservative feature flags, so portal builds never claim SDK features they
// don't have yet. fb.ts follows the same shape later.

import type { Platform } from './types';
import { createMockPlatform, type MockPlatformOptions } from './mock';

export function createPortalPlatform(opts: MockPlatformOptions = {}): Platform {
  const mock = createMockPlatform(opts);

  return {
    id: 'portal',
    // ads: false until the portal ad API is ported (PLAN Part 2, Phase 5).
    // multiplayer: portal builds keep the MQTT path (PLAN Part 2, Phase 5).
    features: { ads: false, multiplayer: true, cloudSave: false },

    init: (onProgress) => mock.init(onProgress),
    markFirstFrame: () => mock.markFirstFrame(),
    markReady: () => mock.markReady(),

    loadSave: () => mock.loadSave(),
    saveSave: (data) => mock.saveSave(data),

    getLanguage: () => mock.getLanguage(),
    isAudioEnabled: () => mock.isAudioEnabled(),
    onAudioChange: (cb) => mock.onAudioChange(cb),
    onPause: (cb) => mock.onPause(cb),
    onResume: (cb) => mock.onResume(cb),

    sendScore: (value) => mock.sendScore(value),
    logWarning: (msg) => mock.logWarning(msg),

    // ads: false → same convention as yt.ts: no ad can run yet, so the
    // interstitial is a no-op and rewarded resolves false. A reward must
    // never be granted without an ad; Phase 5 ports the portal ad API.
    async requestInterstitial() {
      /* no-op */
    },
    async requestRewarded() {
      return false;
    },
  };
}
