// Ad placement policy (PLAN.md Phase 5.1) — platform-agnostic: callers ask
// for a *reward id* / an interstitial at a natural breakpoint, and this layer
// owns the platform gate, the pacing rule and the graceful fallback. The
// platform adapters own the SDK calls themselves (ytgame.ads in yt.ts).
//
// Pacing: at most one interstitial per INTERSTITIAL_GAP_MS (YouTube allows
// ~1/60s; we also debounce our own breakpoint spam — war end + spin end can
// otherwise fire back to back). Rewarded ads are user-initiated, so they are
// not paced here — the UI busy-guards double taps.

import type { Platform } from '../platform/types';

/** Stable reward ids (PLAN: contain no user data). */
export const REWARD = {
  /** Free level-up crate (crate screen). */
  crateFree: 'crate-free-1',
  /** 2× coin income, 60 s (HUD). */
  boost2x: 'boost-2x-1',
  /** Double the war-win payout (war screen). */
  warDouble: 'war-double-1',
  /** Double the current coin balance (play HUD). */
  coinsDouble: 'coins-double-1',
  /** Stat respec instead of the coin cost (stats screen). */
  statsReset: 'stats-reset-1',
} as const;

export const INTERSTITIAL_GAP_MS = 60_000;

let lastInterstitial = 0;

/**
 * Shows an interstitial if the platform has ads and the pacing gap has
 * passed; always resolves — an ad failure is never allowed to break flow
 * (PLAN DoD: "Ad calls wrapped with fallback").
 */
export async function showInterstitial(p: Platform): Promise<void> {
  if (!p.features.ads) return;
  const now = Date.now();
  if (now - lastInterstitial < INTERSTITIAL_GAP_MS) return;
  lastInterstitial = now;
  try {
    await p.requestInterstitial();
  } catch {
    p.logWarning('interstitial ad failed');
  }
}

/**
 * Shows a rewarded ad for `rewardId`; resolves `true` only when the player
 * earned the reward. Missing ads support or an SDK failure resolve `false`
 * (the caller shows its fallback message — never a crash).
 */
export async function showRewarded(p: Platform, rewardId: string): Promise<boolean> {
  if (!p.features.ads) return false;
  try {
    return await p.requestRewarded(rewardId);
  } catch {
    p.logWarning('rewarded ad failed');
    return false;
  }
}
