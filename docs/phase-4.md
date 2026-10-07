# Phase 4 — Remaining screens + i18n/l10n

Status: **not started** (decision record written 2026-10-07). PLAN.md §Phase 4 is the
source of truth — this file is the working log + implementation notes. Precedent:
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

- [ ] `src/scenes/WarScene.ts` — army rows (ball textures + HP bars + burn/slow/weak
      markers), battle log as wrapped Phaser Text; render from `GameState`/`Fight` at the
      controller's `renderWarView()` cadence.
- [ ] `#war` spacers + `.canvas-top` (see technical notes) in `src/style.css`.
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
