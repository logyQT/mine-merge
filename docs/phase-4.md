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
- [ ] `src/i18n/index.ts` — `t(key, params)` + `setLocale()`; `locales/pl.json` (source
      of truth, byte-identical extraction) + `locales/en.json`.
- [ ] Wire `t()` through `src/ui/hud.ts`, `src/ui/game-view.ts`, `src/app.ts` messages,
      static `index.html` markup (menu/rules/modal shells).
- [ ] `Intl.NumberFormat` (compact) for display numbers; `Intl.PluralRules` for Polish
      plural forms; language from `platform.getLanguage()`, default `pl`.
- [ ] `en` e2e smoke + EN/DE layout check at 360 px.
- [ ] Verify safe-area (`viewport-fit=cover` + `:root env(...)` already exist).

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

- [ ] PR 1 … (log branches/PRs here as they open)

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
