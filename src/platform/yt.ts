// YouTube Playables platform adapter — the SDK <script> is injected into
// <head> by vite.config.ts (PLATFORM=yt) before any game code runs.
// Semantics ported from legacy/app.js lines 16–29 and 471–485.

import type { Platform } from './types';

/** Minimal SDK shape used by the kit. Replace with the official
 *  types/ytgame.d.ts once downloaded (PLAN.md §1.1). */
export interface YtGame {
  IN_PLAYABLES_ENV?: boolean;
  game: {
    firstFrameReady(): void;
    gameReady(): void;
    loadData(): Promise<string | null | undefined>;
    saveData(data: string): Promise<void>;
  };
  system: {
    isAudioEnabled(): boolean;
    onAudioEnabledChange(cb: (on: boolean) => void): void;
    onPause(cb: () => void): void;
    onResume(cb: () => void): void;
    getLanguage(): Promise<string>;
  };
  engagement: {
    sendScore(s: { value: number }): void | Promise<void>;
  };
  health: {
    logWarning(): void;
    logError(): void;
  };
}

declare const ytgame: YtGame | undefined;

function sdkFromGlobal(): YtGame | undefined {
  try {
    return typeof ytgame !== 'undefined' ? ytgame : undefined;
  } catch {
    return undefined;
  }
}

/** Platform for the real YouTube runtime; pass a fake SDK in tests. */
export function createYtPlatform(sdk: YtGame | undefined = sdkFromGlobal()): Platform {
  // Legacy guard: every SDK call is gated on IN_PLAYABLES_ENV and wrapped in
  // try/catch — an SDK failure must never crash the game (PLAN Part 0 bug).
  const inPlay = !!sdk?.IN_PLAYABLES_ENV;
  const guard = (fn: () => void): void => {
    if (!inPlay || !sdk) return;
    try {
      fn();
    } catch {
      /* health noise only, never fatal */
    }
  };

  const audioCbs: Array<(on: boolean) => void> = [];
  const pauseCbs: Array<() => void> = [];
  const resumeCbs: Array<() => void> = [];
  let audioOn = true;
  let lang = typeof navigator !== 'undefined' ? navigator.language : 'en';

  return {
    id: 'yt',
    // ads stays false until the ad API is ported (PLAN Part 2, Phase 5);
    // multiplayer is compile-time excluded from YT builds (__PLATFORM__).
    features: { ads: false, multiplayer: false, cloudSave: true },

    async init(onProgress) {
      onProgress(0);
      if (sdk && inPlay) {
        guard(() => {
          audioOn = sdk.system.isAudioEnabled();
          sdk.system.onAudioEnabledChange((on) => {
            audioOn = !!on;
            for (const cb of audioCbs) cb(audioOn);
          });
          sdk.system.onPause(() => {
            for (const cb of pauseCbs) cb();
          });
          sdk.system.onResume(() => {
            for (const cb of resumeCbs) cb();
          });
        });
        // Legacy line 477: language arrives async, cache it for getLanguage().
        try {
          const l = await sdk.system.getLanguage();
          if (l) lang = l;
        } catch {
          /* keep navigator fallback */
        }
      }
      onProgress(100);
    },
    markFirstFrame() {
      guard(() => sdk?.game.firstFrameReady()); // always before gameReady()
    },
    markReady() {
      // Legacy line 485: gameReady() only after a double requestAnimationFrame.
      const fire = () => guard(() => sdk?.game.gameReady());
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => requestAnimationFrame(fire));
      } else {
        fire();
      }
    },

    async loadSave() {
      if (!inPlay || !sdk) return null; // in YT, saves ONLY via saveData()
      try {
        return (await sdk.game.loadData()) || null;
      } catch {
        guard(() => sdk.health.logWarning());
        return null;
      }
    },
    async saveSave(data) {
      if (!inPlay || !sdk) return;
      try {
        await sdk.game.saveData(data);
      } catch {
        guard(() => sdk.health.logWarning());
      }
    },

    getLanguage() {
      return lang;
    },
    isAudioEnabled() {
      return audioOn;
    },
    onAudioChange(cb) {
      audioCbs.push(cb);
    },
    onPause(cb) {
      pauseCbs.push(cb);
    },
    onResume(cb) {
      resumeCbs.push(cb);
    },

    sendScore(value) {
      guard(() => sdk?.engagement.sendScore({ value: Math.max(0, Math.round(value || 0)) }));
    },
    logWarning(msg) {
      void msg; // ytgame.health.logWarning() takes no arguments
      guard(() => sdk?.health.logWarning());
    },

    // TODO(Part 2, Phase 5): port the ad API; graceful no-ops until then.
    async requestInterstitial() {
      /* no-op */
    },
    async requestRewarded() {
      return false;
    },
  };
}
