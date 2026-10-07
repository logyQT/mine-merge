# Phase 4 — Remaining screens + i18n/l10n

Status: **in progress — PR 1 (`feature/phase4-warscene`) open**. PLAN.md §Phase 4 is
the source of truth — this file is the working log + implementation notes. Precedent:
`docs/phase-3.md`.

## Decisions (recorded in PLAN.md §Phase 4)

1. **War → `WarScene` on canvas — YES, this phase.** Human direction: *everything moves
   to canvas over time*; DOM chrome is transitional. Scope mirrors Phase 3: canvas owns
   the war **view** (army rows, HP bars, log); the `#war` shell + buttons stay DOM this
   phase because they are the i18n surface. Full-canvas modals are future work.
2. **Kit guideline evolves:** canvas-first; DOM only for text-heavy chrome/forms until
   the kit ships canvas text layout (supersedes "board → canvas, forms/lists → DOM" as
   the long-term target).

## Scope checklist

- [x] `src/scenes/WarScene.ts` — army rows (ball textures + HP bars + burn/slow/weak
      markers), battle log as wrapped Phaser Text; render from `GameState`/`Fight` at the
      controller's `renderWarView()` cadence.
- [x] `#war` spacers + `.canvas-top` (see technical notes) in `src/style.css`.
- [x] `src/i18n/index.ts` — `t(key, params)` + `setLocale()`; `locales/pl.json` (source
      of truth, byte-identical extraction) + `locales/en.json`.
- [x] Wire `t()` through `src/ui/hud.ts`, `src/ui/game-view.ts`, `src/app.ts` messages,
      static `index.html` markup (menu/rules/modal shells).
- [x] `Intl.NumberFormat` (compact) for display numbers; `Intl.PluralRules` for Polish
      plural forms; language from `platform.getLanguage()`, default `pl`.
- [x] `en` e2e smoke + EN/DE layout check at 360 px.
- [x] Verify safe-area (`viewport-fit=cover` + `:root env(...)` already exist).

## Technical notes (read before coding)

- **War z-order:** `#war` is `position:fixed; inset:0; background:var(--bg)` at z-index
  10 — it *covers* the canvas, so a transparent spacer alone is not enough. While the
  war screen is open add `.canvas-top` to `#app`/root: canvas `z-index` above the
  overlay **and** `pointer-events:none` (war needs no canvas input — DOM buttons must
  keep receiving clicks). Reuse/extend the `board-top` pattern from Phase 3.
- **Three non-contiguous regions** (`#eRow`, `#wLog`, `#pRow`) — the MineScene spacer
  measurement already handles multiple rects; WarScene can share that approach (or one
  merged rect, decide during implementation).
- **PvP parity:** `renderWar(s, fight, mpOn)` hides `#pFire` when `mp.on`; keep DOM
  button behavior identical. `core/war.ts`, `tickOnce`, `mp*` paths: untouched.
- **Canvas + i18n interplay:** canvas text renders `t()` at draw time → `setLocale()`
  must trigger a full redraw (`app.refresh()` already redraws HUD + board; add the war
  scene). Ball textures bake their label (`4·15`) — keep those on the **invariant**
  compact number format, or include the locale in `ballTexKey` + regenerate.
- **Extraction traps:**
  - Polish plurals/cases need real plural keys, not concatenation — e.g.
    `Na planszę wróciło {back}, do ekwipunku {inv}` and `🎁 Otwórz skrzynkę ({n})`
    (accusative agreement: 1 kulkę / 2 kulki / 5 kulek). Model with
    `Intl.PluralRules('pl')` (one/few/many/other) + `{param}` interpolation.
  - Duplicate `#sInfo` id in `index.html` is a **preserved legacy quirk** (documented in
    `renderSpin`) — don't "fix" it during extraction without a parity test.
  - `pl.json` must be byte-identical to today's strings (including emoji) — pin with a
    snapshot test over the extraction.
- **Out of scope this phase** (future canvas work): crate/skin spin strips, shop/stats
  modals as canvas, `#inv` chips, top bar. Don't let "everything canvas" balloon this
  phase — PLAN's risk table now caps it explicitly.

## Status

### PR 3 — `feature/phase4-i18n-wiring` (stacked on PR 2)

Full extraction + wiring — every UI string now renders through `t()`:

- **`locales/pl.json` complete** (~170 keys): `index.html` statics (menu, rules,
  shells, help paragraphs), `hud.ts`, `game-view.ts`, `app.ts` messages, plus the
  content-name lookups by id/index (`rar.{i}`, `skin.{id}`, `perk.{t}`,
  `crate.name.{i}`) — core keeps its Polish values as the tested fallback.
- **Wiring**: `data-i18n`/`-aria`/`-ph` on static markup + `t()` at every dynamic
  call site. `numF()` replaced display `fmt()` (HUD coins, chips, prices, shop/
  crate values, mine-cell HP); ball labels stay on invariant `fmt()` —
  `textures.ts` and `bIn` (crate-strip balls) are untouched by the locale.
- **War log keys**: `wLog(string)` became `wLogKey(key, params)` in the
  controller — `core/war.ts` returns its Polish message and tests still pin it,
  but the view composes the line itself (`war.prepare`/`war.win`/`war.lose*`),
  so `setLocale()` can re-render the current canvas line from `{logKey, logParams}`.
- **`applyLocale()`** (the `setLocale` listener): `<html lang>`, `document.title`,
  `applyStatic()`, `updSnd`, menu labels + wipe disarm, `refresh()` (HUD + mine
  canvas), then re-renders whichever screen is open (war incl. its canvas log,
  stats/crate/shop/spin/contents/skins/mp).
- **e2e**: new `en` smoke (`?lang=en`) — `<html lang>`, title, `data-i18n`
  hint, EN menu/HUD/war strings incl. the canvas log (`Enemy level…`), plus the
  360 px overflow check (column `scrollWidth` + every visible button/input).
- **Tests**: mechanical byte-parity of `pl.json` against the inline legacy text
  kept in `index.html` (regex sweep over `data-i18n*`), exact-byte spot pins for
  the riskiest dynamic strings (U+2212 minus, emoji, ellipses), snapshots,
  key parity pl↔en. Fixed `vite.config.ts` vitest include: `*.test.*` also
  matched `__snapshots__/i18n.test.ts.snap` and tried to run it as a suite.
- Gates: 162 unit / 16 e2e / typecheck / build:yt+web budget / 3 greps 0 /
  dist/yt 3 files. `node scripts/visual-check.mjs` clean (no console errors);
  kit-vs-legacy board-shot pixel diff stays at the Phase 3 baseline (~2%,
  canvas-vs-DOM antialiasing + debug HUD — no localized text band).

**Scope notes / interpretations (recorded, not re-litigated):**

- *DE layout check*: the checklist ships `pl` + `en` only — the 360 px overflow
  gate runs against EN (the shipped expansion language); `de` is not a locale,
  adding it later needs only a `locales/de.json`.
- *Plural keys*: modeled as category objects (`Intl.PluralRules`), driving count
  passed as `params.n` (plural messages spell it `{n}`). pl variants are
  byte-identical across categories because legacy renders bare numbers — Polish
  never declines in these templates; en declines where it must (`war.prepare`).
- *`fmt()` vs `numF()`*: `numF` mirrors `fmt` below 10 000 (whole numbers, no
  grouping → pixel parity for everyday values) and compacts locale-aware from
  there (`10K`/`10 tys.`, `1.5M`/`1,5 mln`) — replacing the k/M hack was the
  recorded intent; `core/economy.fmt` itself stays pinned by its tests.
- *Left in Polish on purpose*: `src/mp.ts` debug-log lines (transport layer,
  `mp*` untouched decision, yt-tree-shaken) and the local-only debug HUD
  (dev tooling, en by design).
- *Safe-area*: verified only, as planned — `viewport-fit=cover` in `index.html`
  and `:root{padding-…:env(safe-area-inset-…)}` in `legacy/style.css` were
  already present; nothing re-added.

### PR 2 — `feature/phase4-i18n` (stacked on PR 1)

The game-agnostic engine (kept free of DOM/Phaser/game imports — a primary
Phase 6 kit candidate):

- `src/i18n/index.ts` — `t(key, params)` with `{param}` interpolation,
  `setLocale()` + `onLocaleChange()` (the app re-renders DOM **and** canvas
  from that hook in PR 3), `resolveLanguage()` (`pl*`→pl, `en*`→en, else
  `en`), `numF()`, `selectVariant()` (exported for tests), `applyStatic()`
  (opt-in `data-i18n` / `data-i18n-aria` / `data-i18n-ph` sweep).
- **Plural message keys** are objects keyed by `Intl.PluralRules` categories
  (`one/few/many/other` pl, `one/other` en) selected through `params.n` — so
  plural messages carry their driving count as `{n}`. Shipped pl variants are
  byte-identical across categories: legacy renders **bare numbers**, so
  Polish never declines in these templates (the snapshot + a dedicated test
  pin that rule); en `war.prepare` genuinely declines (1 ball / 3 balls).
- `numF()` mirrors core `fmt()` below 10 000 (whole numbers, no grouping —
  legacy pixel parity) and compacts locale-aware from there up (`10K` en,
  `10 tys.`/`1,5 mln` pl). Ball-texture labels stay on the invariant core
  `fmt()` (baked at generation). `core/economy.fmt` untouched (tests pin it).
- `locales/pl.json` seeds the extraction (`app.title`, `hud.crate`,
  `hud.dropResult`, `war.prepare` — the plural/hard cases from the handoff);
  PR 3 grows it to every string while wiring. Key parity pl↔en + snapshots
  pinned in `tests/unit/i18n.test.ts`.
- `platform.getLanguage()` mock: default **pl** locally (no navigator
  sniffing), `opts.language` for tests, `?lang=<tag>` URL override for the
  e2e EN smoke / layout checks (`platform-mock.test.ts` updated).

### PR 1 — `feature/phase4-warscene` (open, stacked base `main`)

War view on canvas. What landed:

- `src/scenes/WarScene.ts` draws both army rows (`ensureBallTexture` — same
  skin/rarity as the board) + HP bars + 🔥❄☠ markers, and the battle log as
  word-wrapped Phaser Text. `#eRow/#wLog/#pRow` stay empty spacers; the scene
  measures them (MineScene's multi-rect approach) and **writes their heights**,
  so the `#war` flex column keeps the legacy flow. Probed legacy metrics
  (headless run against `legacy/`, pinned in the scene + e2e):
  - `.wb` = 58 w, `.it` 52 + 3 px margin, `.hp` 6 px at y+55 → row **73 px**;
    **76 px** while any ball in the row shows an emoji marker (the emoji inline
    box grows the marker line from 12 → 15 px — legacy reflows +3 px mid-fight
    and so do we).
  - `#wLog`: 13 px font, **15 px line advance** (Phaser: 13 + `lineSpacing 2`),
    CSS `min-height:34` wins below — the scene writes `text height` only.
- `src/ui/war-canvas.ts` façade (mirrors `ui/board.ts`): `warRender`/`warLog`
  cache + replay for the late-booting scene; `setWarOpen()` toggles
  `#app.canvas-top` (canvas z-index 20 above the opaque overlay,
  `pointer-events:none` — zero canvas input, DOM buttons keep the clicks),
  hides MineScene (`scene.setVisible`) and shows WarScene — one canvas serves
  both scenes, so the board must not paint over `#war`.
- e2e war test reworked: the log is canvas-drawn, so it reads the local-only
  `globalThis.__warLog` hook (set in `war-canvas` behind `__PLATFORM__ ===
  'local'`) and additionally pins `.canvas-top`, canvas z-index/pointer-events
  and the legacy spacer heights (73/34).
- `scripts/visual-check.mjs` grew **6 war shots** (prepare/fight/360 × kit+legacy)
  — 24 shots total (12 pairs). Pixel-scanned parity: player-row ball x-runs
  identical between kit and legacy, markers within 1 px.
- Readable-for-review deviation note: nothing user-visible changed vs legacy —
  the enemy-count differences in paired shots are just RNG (each page rolls its
  own enemy army).
