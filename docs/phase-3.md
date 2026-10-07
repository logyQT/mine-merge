# Phase 3 — Canvas board in Phaser

Status: **PR 1 merged-track (open), PR 2 in review** (started 2026-10-07). Decision
record lives in PLAN.md §Phase 3 ("Decisions (recorded before starting)") — the short
version: **the 5×5 merge grid goes to canvas together with `#mine`** (kit guideline:
*board → canvas, forms/lists/text → DOM*).

## Stacked-PR slicing (per AGENTS.md)

| # | Branch | Scope | Status |
|---|---|---|---|
| 1 | `feature/phase3-textures` | Palettes extracted to `src/ui/palette.ts`; `src/scenes/textures.ts` generates mine-cell + ball textures from them at boot (CanvasTexture, 0 asset files); local-only `__ensureBall` e2e hook; boot contract unchanged. | PR #24 open |
| 2 | `feature/phase3-minescene` | `MineScene` draws grid + mine from `GameState` (spacers measured per frame), pointer input (tap/drag via `Phaser.Input.Pointer`), `flyBall`/land/hit animations (reduced-motion aware), DOM board deleted, e2e retargeted to canvas gestures + new resize-input test. | local, gates green |
| 3 | `feature/phase3-hud-polish` | Top bar/buttons extracted to `src/ui/hud.ts`, `style.css`/`game-view.ts` cleanup, resize verification at 360×640 / 800×600 / 1280×800, side-by-side visual check vs `legacy/` (tag `legacy-vanilla`). | not started |

## Exit criteria (PLAN §Phase 3)

- [x] Mine loop (spawn → merge → drop → destroy → coins → upgrade) fully in Phaser (PR 2)
- [x] DOM board rendering deleted (`#grid`/`#mine` are transparent spacers only)
- [ ] Side-by-side visual check vs `legacy/` passes — **human**; `node scripts/visual-check.mjs`
      shoots both (kit + legacy, same fixture) into `${tmpdir}/mine-merge-visual-check/`
- [x] All gates green: `npm test` (144), `typecheck`, `test:e2e` (15), `build:yt`/`build:web`, 3 greps

## Notes / gotchas discovered while working

- `#grid` empty in the DOM has zero height (cells gave it height) — `aspect-ratio:1`
  reproduces the legacy square exactly at any width; `#mine` height is written by
  MineScene from `viewRows()` so the canvas knows where the board ends.
- legacy sets `--d` on `.b.hit` but no CSS consumes it (dead property) — not ported.
- BootScene prewarms classic balls L1..12 + one ball per skin; every other
  (skin × level × rarity) ball texture is generated lazily on first use and cached.
- **`html, body { height: 100% }` (kit rule) diverged from legacy**: it fixes the body
  height, so `#app`'s flex column *shrinks* items (inventory clipped to one row) when
  content exceeds the viewport. legacy only has `min-height: 100vh` and grows — the kit
  rule now uses `min-height` too. Full-page heights then match legacy to the pixel (1286 px).
- **Canvas above the DOM only while dropping**: `setGone(on)` also toggles
  `#app.board-top` (canvas z-index 2) so `flyBall` passes over `#inv` like legacy's
  `z-index:20`. Controls are hidden/busy-guarded then, so no clicks are lost.
- Headless screenshots of the animated canvas can return a stale compositor frame —
  wait ~1 s after an interaction (the visual-check script does); clip-based captures
  were unreliable, full-viewport shots are stable.
- Drop order note: `flyBall` is launched *before* the controller's `refresh()`, so the
  scene captures the start geometry synchronously and the flight lives outside redraws.
