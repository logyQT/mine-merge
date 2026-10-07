// The heart of the kit: every platform (YouTube, Facebook, portals, local dev)
// implements this interface, so game code never touches a vendor SDK directly.
// See PLAN.md §1.2.

export type PlatformId = 'yt' | 'fb' | 'portal' | 'local';

export interface PlatformFeatures {
  ads: boolean;
  multiplayer: boolean;
  cloudSave: boolean;
}

export interface Platform {
  readonly id: PlatformId;
  readonly features: PlatformFeatures;

  /** Load the vendor SDK and start reporting progress (0–100). */
  init(onProgress: (pct: number) => void): Promise<void>;
  /** Call before the first painted frame (YT: firstFrameReady). */
  markFirstFrame(): void;
  /** Call once the game is interactive (YT: gameReady, FB: startGameAsync). */
  markReady(): void;

  /** Opaque persisted save string, or null when nothing is stored yet. */
  loadSave(): Promise<string | null>;
  /** Persist an opaque save string (debounce lives in the caller). */
  saveSave(data: string): Promise<void>;

  /** BCP-47-ish language tag, reduced to 'pl' | 'en' | … by the i18n layer. */
  getLanguage(): string;
  isAudioEnabled(): boolean;
  onAudioChange(cb: (on: boolean) => void): void;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;

  sendScore(value: number): void;
  logWarning(msg?: string): void;

  /** Resolve when done; reject/resolve-safe callers must handle failure. */
  requestInterstitial(): Promise<void>;
  /** Resolve true when the user earned the reward, false when skipped/failed. */
  requestRewarded(rewardId: string): Promise<boolean>;
}
