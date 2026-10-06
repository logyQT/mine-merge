# PLAN — Kopalnia → Phaser + Vite + TS "kit"

**Goal:** turn the current single-file vanilla game (`index.html` + `app.js` + `style.css`)
into the first member of a reusable multi-platform template. The rewrite *is* the test of
the template — once Kopalnia runs on it, game #2..#N should start at ~90% done.

**Constraints this plan is built from** (YouTube Playables docs, 2026):

- `index.html` at bundle root; SDK `<script src="https://www.youtube.com/game_api/v1">`
  must execute **before any game code**.
- Strict CSP: `connect-src 'self' blob: data:` (no external network at runtime),
  `script-src` = self + YT game_api + blob + unsafe-eval/inline, `img-src` = self/blob/data.
- Size: ≤ 8000 files, ≤ 30 MiB/file, ≤ 250 MiB total; initial load (until `gameReady`)
  ideally < 15 MiB, files ideally < 512 KiB, save data < 500 KiB, load target < 5 s.
- Required SDK calls: `firstFrameReady()`, `gameReady()`, `IN_PLAYABLES_ENV`,
  `isAudioEnabled()` + `onAudioEnabledChange()`, `onPause()`, `onResume()`, `loadData()`, `saveData()`.
- Responsive: all aspect ratios, touch **and** mouse, **state must survive window resize**.
- No external links, no in-game sharing, no UI mimicking platform controls.

---

## Part 0 — Current state audit (done by reading the code)

| Area | Status |
|---|---|
| YT SDK integration | ✅ `firstFrameReady` → `gameReady`, `loadData`/`saveData` (500 ms debounce), `sendScore`, `onPause`/`onResume`, audio gating, `health.logWarning` |
| Save persistence | ✅ localStorage locally / cloud in YT, schema migration via `applySave()` + `normalize()` |
| Ads | ❌ missing entirely (`requestInterstitialAd` / `requestRewardedAd`) — add via adapter |
| i18n | ❌ every string hardcoded Polish; `getLanguage()` unused. Needs string extraction |
| Multiplayer | ⚠️ **CSP violation**: `mqtt.min.js` loaded from `cdn.jsdelivr.net` + brokers on `wss://broker.emqx.io` etc. Guarded by `if (IN_PLAY)`, but must be **compile-time removed** from the YT build, not runtime-guarded |
| Rendering | DOM (`innerHTML` strings + CSS grid), inline `style=""` everywhere |
| Structure | ~500 lines of globals; no modules, no types, no tests, no build step |

**Pre-existing bug to fix early:** if a YT player reaches the Multiplayer button before the
`IN_PLAY` guard fires, `loadMqtt()` injects a jsdelivr script → CSP error → possible
certification/health-log noise. Fix = capability flag compiled out of the YT bundle.

---

## Part 1 — Scaffold the kit

### 1.1 Target structure

```
kopalnia/
├─ index.html                    # SDK tag injected by Vite plugin (head, before game code)
├─ public/
│  └─ assets/                    # only if unavoidable — prefer generated textures (0 files)
├─ src/
│  ├─ main.ts                    # bootstrap: platform.init → load save → start Phaser → markReady
│  ├─ config.ts                  # game constants (N, COLS, VIEW, economy tuning)
│  ├─ core/                      # PURE logic, no DOM/Phaser/platform imports → Vitest
│  │  ├─ state.ts                # GameState type + createInitialState()
│  │  ├─ save.ts                 # serialize/deserialize/migrate/normalize (schema v1!)
│  │  ├─ economy.ts              # spawnPrice, incMul, renChance, sellPrice, pasCost, disCost, fmt, accLvl
│  │  ├─ mine.ts                 # makeRow/rowAt/viewRows/splash/land damage math
│  │  ├─ war.ts                  # fight sim: mk/tick/WP/enemyArmy — takes an injected RNG
│  │  ├─ cosmetics.ts            # skins, rarities, perks, crate rolls (injected RNG)
│  │  └─ rng.ts                  # seeded RNG interface (determinism for tests/replays)
│  ├─ platform/
│  │  ├─ types.ts                # Platform interface (see below)
│  │  ├─ detect.ts               # picks implementation from import.meta.env.PLATFORM
│  │  ├─ yt.ts                   # real ytgame wrapper
│  │  ├─ fb.ts                   # FBInstant (later, same shape)
│  │  ├─ portal.ts               # Poki/CrazyGames SDK stubs (later)
│  │  └─ mock.ts                 # local dev: logs calls, localStorage save, debug HUD
│  │                             #   buttons: pause / resume / audio-off / reload-save
│  ├─ scenes/
│  │  ├─ BootScene.ts            # generate textures, show loading bar (setLoadingProgress)
│  │  ├─ MineScene.ts            # grid, blocks, ball flight, drop animation
│  │  └─ WarScene.ts             # optional / Phase 4
│  ├─ ui/                        # DOM overlay: HUD, menus, shop, stats, modals
│  │  ├─ hud.ts                  # coins/depth/acc/score — reads state, calls actions
│  │  ├─ modals.ts               # shop / stats / crates / skins (i18n-ready markup)
│  │  └─ styles/                 # style.css split into modules, classes not inline styles
│  ├─ audio/sfx.ts               # tone()/noise() → gated by platform.isAudioEnabled()
│  ├─ i18n/
│  │  ├─ index.ts                # t('key', params) + Intl number/date formatting
│  │  └─ locales/{pl,en}.json    # pl is source of truth (existing strings)
│  └─ ads/                       # interstitial/rewarded placement policy (platform-agnostic)
├─ types/ytgame.d.ts             # official YT type definitions (download URL in docs)
├─ scripts/check-budget.mjs      # file count / per-file / total / initial-load gates
├─ tests/
│  ├─ unit/                      # Vitest: economy, save migration, war balance
│  └─ e2e/                       # Playwright: resize, audio toggle, pause, save roundtrip
├─ vite.config.ts                # CSP header per platform, SDK injection, budget hook
├─ tsconfig.json                 # strict
└─ PLAN.md
```

### 1.2 The `Platform` interface (the heart of the kit)

```ts
// src/platform/types.ts
export interface Platform {
  readonly id: 'yt' | 'fb' | 'portal' | 'local';
  readonly features: { ads: boolean; multiplayer: boolean; cloudSave: boolean };

  init(onProgress: (pct: number) => void): Promise<void>; // load SDK, start progress
  markFirstFrame(): void;
  markReady(): void;                                      // YT: gameReady(), FB: startGameAsync

  loadSave(): Promise<string | null>;
  saveSave(data: string): Promise<void>;                  // debounced in caller

  getLanguage(): string;                                  // 'pl' | 'en' …
  isAudioEnabled(): boolean;
  onAudioChange(cb: (on: boolean) => void): void;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;

  sendScore(value: number): void;
  logWarning(msg?: string): void;
  requestInterstitial(): Promise<void>;
  requestRewarded(rewardId: string): Promise<boolean>;
}
```

Three implementations at first: **yt.ts**, **mock.ts** (default `PLATFORM=local`),
**portal.ts** stub. `fb.ts` comes later and costs nothing extra — that's the point of the layer.

### 1.3 Build / dev tooling

```jsonc
// package.json scripts
"dev":        "vite --port 8080",
"dev:yt":     "cross-env PLATFORM=yt vite --port 8080",
"build:yt":   "cross-env PLATFORM=yt vite build --outDir dist/yt && node scripts/check-budget.mjs dist/yt",
"build:web":  "cross-env PLATFORM=portal vite build --outDir dist/web && node scripts/check-budget.mjs dist/web",
"test":       "vitest run",
"test:e2e":   "playwright test",
"typecheck":  "tsc --noEmit"
```

`vite.config.ts` responsibilities:

1. **Inject the SDK `<script>`** via `transformIndexHtml`, `head-prepend`, only for
   `PLATFORM=yt` (nothing injected for `local` — the mock *is* the SDK).
2. **Inject YouTube's exact CSP** as a dev/preview response header when `PLATFORM=yt`
   (copy the string from the Test Suite guide) so violations appear in DevTools *locally*.
   Omit the `sandbox` directive locally if it interferes with DevTools.
3. `define: { __PLATFORM__: JSON.stringify(PLATFORM) }` so `if (__PLATFORM__ !== 'yt')`
   **tree-shakes** the multiplayer/MQTT code out of YT bundles at compile time.

### 1.4 Budget + CI gates

`scripts/check-budget.mjs` fails the build on: > 8000 files, any file > 30 MiB,
total > 250 MiB; warns on: any file > 512 KiB, initial JS+CSS > 15 MiB.
Add `rollup-plugin-visualizer` for the initial-payload hunt.

### 1.5 Test harness

- **Vitest** on `src/core/*` — pure functions, injected RNG → deterministic balance tests
  (e.g. "depth-50 row has HP in [x, y]", "expected coins/minute stays in band").
- **Playwright** against `PLATFORM=local` + mock: game boots without console errors;
  viewport 360×640 / 800×600 / 1280×800 **and resize mid-game preserves state**;
  `mock.setAudio(false)` silences SFX; `mock.pause()` freezes timers; save→reload→identical state.

---

## Part 2 — Rewrite Kopalnia onto the kit

**Strategy: keep the game playable at every phase.** Never a big-bang rewrite.
The original stays untouched on a `legacy/` branch/tag as the reference oracle.

### Phase 0 — Safety net (½ day)

1. `git tag legacy-vanilla` (current state = oracle).
2. Write a **save-compatibility fixture**: take a real serialized save
   (a mid-game JSON with `grid`, `rows`, `inv`, `war`, `acc`, `econ`, `skins`, `bestDepth`)
   and freeze it as `tests/unit/fixtures/save-v1.json`.
   Rule for the whole rewrite: **`applySave()` must keep accepting schema v1 forever.**
   Existing players must not lose progress when v2 ships.
3. Port `normalize()`'s edge cases into test cases *before* touching code.

### Phase 1 — Scaffold kit with no behavior change (1–2 days)

1. `npm create vite` (vanilla-ts) + Phaser 3 + vitest + playwright + strict tsconfig.
2. Implement `Platform` interface: `mock.ts` + `yt.ts` (port lines 16–29 of `app.js` verbatim).
3. Wire CSP header + SDK injection + budget script.
4. **Smoke test:** an empty Phaser scene boots through `main.ts`, calls `markFirstFrame()`
   → `markReady()`, Test Suite accepts `http://localhost:8080`.
   ✅ *Milestone: kit runs, Test Suite green, before any game porting.*

### Phase 2 — Extract pure core (2–3 days) — **no visual changes yet**

Move logic out of `app.js` into `src/core/*` as TypeScript, **keeping the existing DOM
rendering as a temporary view layer** imported by `main.ts`:

| Existing code | Destination |
|---|---|
| `coins/spawnLvl/…` globals + `applySave`/`normalize` | `core/state.ts`, `core/save.ts` |
| `spawnPrice`, `incMul`, `renChance`, `sellPrice`, `pasCost`, `disCost`, `pw`, `fmt`, `accLvl` | `core/economy.ts` |
| `makeRow`, `rowAt`, `viewRows`, `splash`, `land` damage math | `core/mine.ts` |
| `mk`, `tick`, `WP`, `armyList`, `enemyArmy`, `wEnd` | `core/war.ts` (RNG injected) |
| `rollPerks`, `rollRar`, `perk`, `itVal`, crate rolls | `core/cosmetics.ts` (RNG injected) |
| `tone`, `noise`, `sfx` | `audio/sfx.ts`, gated by `platform.isAudioEnabled()` |
| `YG`/`IN_PLAY`/`cloudLoad`/`sendBest` blocks | **deleted** — replaced by `platform/*` |

Exit criteria: game plays identically to `legacy-vanilla`, `vitest` covers economy +
save migration + war balance, **zero gameplay logic left in the view layer.**

### Phase 3 — Canvas board in Phaser (3–5 days)

1. `BootScene`: **generate textures at runtime** from the existing palettes
   (`color(L)` hsl ramp, `TC`, skin `pal`/`sym`/`rad`) via `Phaser.GameObjects.Graphics`
   → keeps bundle at ~0 asset files (CSP-clean, budget-clean). No PNGs for gradients.
2. `MineScene`: grid, block HP tiers, `flyBall`/`land`/`splash` animations,
   drag/tap input via `Phaser.Input.Pointer` (covers **mouse + touch** with one path).
3. `Scale.RESIZE` + `autoCenter`, all positioning relative to `scale.width/height`
   → satisfies "all aspect ratios" and "state survives resize" by construction.
4. `src/ui/hud.ts` keeps the top bar + buttons in **DOM** (text-heavy, i18n-friendly,
   accessible); Phaser owns only the board. Modals (shop/stats/crates/skins/war) stay DOM
   in this phase — they're forms and lists, not a game view.
5. SFX move to WebAudio, respecting `onAudioChange`.

Exit criteria: mine loop (spawn → merge → drop → destroy → coins → upgrade) fully in
Phaser, DOM board rendering deleted. Side-by-side visual check vs `legacy/`.

### Phase 4 — Remaining screens + i18n (2–3 days)

1. **War** to `WarScene` (or keep DOM if the log-heavy UI reads better — decision point;
   log it either way as a kit guideline: *board → canvas, forms/lists → DOM*).
2. Extract every string to `locales/pl.json`, add `en.json`, switch `t()` into all UI.
   Use `Intl.NumberFormat` (fmt() currently hand-rolls k/M — replace with locale-aware).
   Get `platform.getLanguage()` from YT, default `pl` locally.
3. Layout check with longer EN/DE strings (buttons must not overflow at 360 px) —
   this is where hardcoded Polish widths usually break.
4. `viewport-fit=cover` + safe-area insets for notched phones.

### Phase 5 — Monetization + certification (1–2 days)

1. Ads via adapter: **rewarded** → free crate / coin boost / revive (`reward-id` like
   `"crate-free-1"`); **interstitial** → natural breakpoints only (game over, war end).
   Always try/catch with graceful fallback (docs: handle ad-request failures).
2. `sendScore(bestDepth)` on new best.
3. Kill runtime multiplayer guard → **compile-time** exclusion (`__PLATFORM__`),
   keep MQTT path for `portal` builds only.
4. Run the **Test Suite** (`PLATFORM=yt`, localhost → then uploaded build) and the checklist below.

### Phase 6 — Make it the kit (1 day)

Promote everything reusable out of Kopalnia into clearly generic modules so game #2 is
scaffolding-only work:

- `platform/` (all adapters), `i18n/`, `audio/`, `ads/`, `ui/` primitives (HUD, modal shell,
  buttons, toast), `scripts/check-budget.mjs`, Vite config, Playwright presets.
- Document: *"new game checklist"* — one page: scaffold command, adapter choice,
  locale files, budget run, Test Suite run.
- Decide the kit's home (this repo vs a separate `playable-kit` package this repo depends on).

---

## Definition of done (certification checklist)

- [ ] SDK `<script>` in `<head>`, before all game code (Test Suite verifies)
- [ ] `firstFrameReady()` before first paint; `gameReady()` after double-rAF
- [ ] Audio starts muted when `isAudioEnabled() === false`; reacts to `onAudioEnabledChange`
- [ ] `onPause`/`onResume` freeze/unfreeze timers (existing `sleep()` + `passiveIv` must respect pause)
- [ ] Save via `saveData()` only in YT (no localStorage writes when `IN_PLAYABLES_ENV`)
- [ ] Existing schema-v1 saves still load (fixture test)
- [ ] Touch **and** mouse playthrough; state survives resize at 3 aspect ratios
- [ ] No external requests: `grep` for `http://`, `https://`, `//cdn`, `wss://` in built bundle = only `youtube.com/game_api`
- [ ] Budget: ≤8000 files, ≤30 MiB/file, initial < 15 MiB, save < 500 KiB
- [ ] No external links / in-game sharing / platform-lookalike UI
- [ ] Ad calls wrapped with fallback; rewarded IDs contain no user data
- [ ] Local test with YT CSP header → zero violations in DevTools
- [ ] Test Suite green against localhost **and** the uploaded build

---

## Risks

| Risk | Mitigation |
|---|---|
| Phaser rewrite regresses game feel/timing | `legacy/` tag as oracle; port one system at a time; side-by-side playtest each phase |
| Save corruption / player progress loss | Frozen schema-v1 fixture + `applySave` tests run in CI before every build |
| Multiplayer MQTT breaks YT certification | Compile-time exclusion, not runtime guard; verify with `grep` on `dist/yt` |
| Canvas rewrite eats time | Phases 2–3 are separable: kit is shippable after Phase 2 (DOM view), canvas is an upgrade, not a blocker |
| i18n reveals layout bugs late | Do the EN pass in Phase 4 *before* submitting, not after rejection |
| Scope creep (war in canvas, skins in canvas) | Rule: board → canvas, forms/lists → DOM. Documented as a kit guideline |

## Effort snapshot

| Phase | Est. |
|---|---|
| 0 Safety net | ½ day |
| 1 Kit scaffold | 1–2 days |
| 2 Core extraction (DOM view kept) | 2–3 days |
| 3 Phaser board | 3–5 days |
| 4 Screens + i18n | 2–3 days |
| 5 Ads + certification | 1–2 days |
| 6 Kit promotion | 1 day |
| **Total** | **~2–3 weeks** part-time, game continuously playable |
