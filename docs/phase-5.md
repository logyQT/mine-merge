# Phase 5 — Monetization + certification prep

Status: **code complete — PR pending.** PLAN.md §Phase 5 is the source of truth;
this file is the working log + implementation notes. Precedent: `docs/phase-3.md`,
`docs/phase-4.md`.

## Scope delivered (PLAN §Phase 5 items 1–3)

1. **Ads via adapter** — new `src/ads/index.ts` placement policy:
   - `showInterstitial(p)` — platform gate + pacing (`INTERSTITIAL_GAP_MS = 60 s`),
     always resolves, logs through `logWarning` on SDK failure.
   - `showRewarded(p, rewardId)` — resolves `false` on no-ads platforms or SDK
     failure (callers show their fallback message; never a crash — PLAN DoD).
   - Stable reward ids in `REWARD` (no user data): `crate-free-1`, `boost-2x-1`,
     `war-double-1`, `stats-reset-1` — pinned by `tests/unit/ads.test.ts`.
2. **`yt.ts` ports `ytgame.ads`** — `requestInterstitialAd()` / `requestRewardedAd(id)`
   behind the existing `guard`/try-catch; `features.ads` is now `true` for yt.
   Both degrade to no-ops outside `IN_PLAYABLES_ENV`. `portal.ts` stays inert.
3. **`mock.ts` logs placements** — `[ads] interstitial #n` / `[ads] rewarded "id" → true`
   (console.log; resolves instantly per decision below), counters unchanged and
   still exposed on `globalThis.__platform` for e2e.

## Placements (user decision, 2026-01-10)

| Placement | Reward/Event | Where | Notes |
|---|---|---|---|
| Free level-up crate | `crate-free-1` | `#cFree` in the crate overlay | grants `acc.crates + 1`; spin flow untouched |
| Coin boost (2× income, 60 s) | `boost-2x-1` | `#boost` HUD button | see "boost mechanics" |
| Double war rewards | `war-double-1` | `#wDouble` on the war screen after a win | adds the win payout again, once; hidden on loss/`prepareWar`/`wBack` |
| Stats respec | `stats-reset-1` | `#sReset` | **ad-gated instead of the coin cost** (user decision); legacy coin price kept as fallback on ads-less platforms via `renderStats(..., adGated)` |
| Interstitial: war end | — | `endFight()` | verdict on screen, ticker stopped |
| Interstitial: skin spin end | — | `sOpen` spin timeout | paid spin resolved, result on screen |

All interstitial calls go through the 60 s pacing, so war-end + spin-end back to
back still show only one.

## Boost mechanics

- Transient module state in `app.ts` (`boostUntil`), deliberately **not** in
  `GameState` — a 60 s boost must not persist, and the save schema is untouched.
- `boostMul()` (×2) applied at the three income credits: drop result, bomb,
  passive tick. Selling/war payouts are not "income" — unchanged.
- Pause-aware per the DoD: `pauseGame()` parks the remaining ms (`boostFrozen`),
  `resumeGame()` re-arms — a YT ad break can't eat the boost.
- Button counts down via a 1 s interval (label-only redraw, no full `refresh()`),
  re-rendered by `refresh()` and locale switches.

## Deviations / decisions

- **Stats respec is ad-gated, not ad-optional** (user, this phase): on
  ad-supported platforms the coin price is gone entirely; `stats.reset` (with
  `{c}`) survives in the locales and is used only when `features.ads` is false.
- **Mock resolves instantly + logs** (user choice over fail-by-default): e2e can
  assert placements deterministically; the graceful-fallback path is covered by
  unit tests (rejecting fake SDK) instead.
- **Generic `ad.fail` message** instead of per-placement fail strings — one key,
  shown in the surface the player is looking at (`#cRes`, `#sInfo`, `#msg`,
  war log).
- New locale keys are additive (`ad.*`, `stats.resetAd`); existing pl values are
  byte-identical (snapshot regenerated — diff shows only `+` lines).
- The boost button is hidden when `features.ads` is false (no dead UI), as is
  `#cFree`; `#wDouble` only appears after a win on ad platforms.

## Verification

- `npm test` — 171 pass (new `tests/unit/ads.test.ts`: pacing, gates, failure
  degradation, reward-id pinning; yt adapter tests rewritten for the ported API).
- `npm run typecheck` — clean.
- `npm run test:e2e` — 17 pass (new: rewarded placements through the mock;
  war test extended with the interstitial count + `#wDouble` visibility).
- `npm run build:yt` / `build:web` — budget gate passes (Phaser >512 KiB WARN
  is the expected one).
- CSP greps on `dist/yt/` — all clean (0 matches for mock/MQTT markers).

## Not done here (needs the human / a browser)

- **Test Suite run** (PLAN §Phase 5.4) against localhost + uploaded build —
  requires the YouTube Test Suite UI; the CSP header + SDK injection are already
  wired for it (`npm run preview:yt` serves `dist/yt` with the YT CSP).
- Certification checklist pass (PLAN "Definition of done") — items now covered
  by this phase: ad calls wrapped with fallback ✓, rewarded ids contain no user
  data ✓, sendScore on new best ✓ (earlier phase), MQTT compile-time excluded ✓
  (earlier phase, grep-verified).
