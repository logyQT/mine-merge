// Local development platform: no vendor SDK, localStorage persistence, and
// hooks the debug HUD (and unit tests) use to simulate platform events.
// This *is* the SDK for PLATFORM=local — nothing is injected for it.

import type { Platform } from './types';

const SAVE_KEY = 'mine-merge-save-v1';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

function defaultStorage(): Storage {
  try {
    if (typeof globalThis.localStorage !== 'undefined') return globalThis.localStorage;
  } catch {
    // Storage can throw in privacy modes — fall through to memory.
  }
  return memoryStorage();
}

export interface MockPlatformOptions {
  language?: string;
  audioEnabled?: boolean;
  /** Save returned by the first loadSave() when storage is empty. */
  initialSave?: string | null;
  storage?: Storage;
}

export interface MockPlatform extends Platform {
  /** Simulate the OS/platform toggling audio (debug HUD + tests). */
  setAudioEnabled(on: boolean): void;
  /** Simulate platform lifecycle events. */
  emitPause(): void;
  emitResume(): void;

  // Recorded activity, for assertions and the debug HUD.
  readonly firstFrame: boolean;
  readonly ready: boolean;
  readonly progress: number[];
  readonly scores: number[];
  readonly warnings: string[];
  readonly interstitials: number;
  readonly rewards: string[];
  readonly paused: boolean;
}

export function createMockPlatform(opts: MockPlatformOptions = {}): MockPlatform {
  const storage = opts.storage ?? defaultStorage();
  const progress: number[] = [];
  const scores: number[] = [];
  const warnings: string[] = [];
  const rewards: string[] = [];
  const audioCbs: Array<(on: boolean) => void> = [];
  const pauseCbs: Array<() => void> = [];
  const resumeCbs: Array<() => void> = [];

  let audioOn = opts.audioEnabled ?? true;
  let firstFrame = false;
  let ready = false;
  let interstitials = 0;
  let paused = false;
  let initialSave = opts.initialSave ?? null;

  const platform: MockPlatform = {
    id: 'local',
    features: { ads: true, multiplayer: true, cloudSave: false },

    async init(onProgress) {
      progress.push(0);
      onProgress(0);
      progress.push(100);
      onProgress(100);
    },
    markFirstFrame() {
      firstFrame = true;
    },
    markReady() {
      ready = true;
    },

    async loadSave() {
      const stored = storage.getItem(SAVE_KEY);
      if (stored !== null) return stored;
      const pending = initialSave;
      initialSave = null; // one-shot, like a cloud save pulled on first boot
      return pending;
    },
    async saveSave(data) {
      storage.setItem(SAVE_KEY, data);
    },

    getLanguage() {
      if (opts.language) return opts.language;
      const nav = typeof navigator !== 'undefined' ? navigator.language : '';
      return nav.toLowerCase().startsWith('pl') ? 'pl' : 'en';
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
      scores.push(value);
    },
    logWarning(msg = '') {
      warnings.push(msg);
    },

    async requestInterstitial() {
      interstitials += 1;
    },
    async requestRewarded(rewardId) {
      rewards.push(rewardId);
      return true;
    },

    // --- simulation hooks ---
    setAudioEnabled(on) {
      if (on === audioOn) return;
      audioOn = on;
      for (const cb of audioCbs) cb(on);
    },
    emitPause() {
      paused = true;
      for (const cb of pauseCbs) cb();
    },
    emitResume() {
      paused = false;
      for (const cb of resumeCbs) cb();
    },

    get firstFrame() {
      return firstFrame;
    },
    get ready() {
      return ready;
    },
    get progress() {
      return progress;
    },
    get scores() {
      return scores;
    },
    get warnings() {
      return warnings;
    },
    get interstitials() {
      return interstitials;
    },
    get rewards() {
      return rewards;
    },
    get paused() {
      return paused;
    },
  };

  return platform;
}
