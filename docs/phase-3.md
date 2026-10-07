# Phase 3 — Canvas board in Phaser

Status: **in progress** (started 2026-10-07). Decision record lives in PLAN.md §Phase 3
("Decisions (recorded before starting)") — the short version: **the 5×5 merge grid goes to
canvas together with `#mine`** (kit guideline: *board → canvas, forms/lists/text → DOM*).

## Stacked-PR slicing (per AGENTS.md)

| # | Branch | Scope | Status |
|---|---|---|---|
| 1 | `feature/phase3-textures` | Palettes extracted to `src/ui/palette.ts`; `src/scenes/textures.ts` generates mine-cell + ball textures from them at boot (CanvasTexture, 0 asset files); local-only `__ensureBall` e2e hook; boot contract unchanged. | open |
| 2 | `feature/phase3-minescene` | `MineScene` draws grid + mine from `GameState` (spacers measured per frame), pointer input (tap/drag via `Phaser.Input.Pointer`), `flyBall`/land/hit animations (reduced-motion aware), DOM board rendering deleted, e2e retargeted to canvas gestures. | not started |
| 3 | `feature/phase3-hud-polish` | Top bar/buttons extracted to `src/ui/hud.ts`, `style.css`/`game-view.ts` cleanup, resize checks at 360×640 / 800×600 / 1280×800, side-by-side visual check vs `legacy/` (tag `legacy-vanilla`). | not started |

## Exit criteria (PLAN §Phase 3)

- [ ] Mine loop (spawn → merge → drop → destroy → coins → upgrade) fully in Phaser
- [ ] DOM board rendering deleted (`#grid`/`#mine` remain as transparent spacers only)
- [ ] Side-by-side visual check vs `legacy/` passes (human)
- [ ] All gates green: `npm test`, `typecheck`, `test:e2e`, `build:yt`, `build:web`, 3 greps

## Notes / gotchas discovered while working

- `#grid` empty in the DOM has zero height (cells gave it height) — the view sets its size
  explicitly (`aspect-ratio:1` reproduces the legacy square exactly; `#mine` height is
  derived from `viewRows()` so the canvas knows where the board ends).
- legacy sets `--d` on `.b.hit` but no CSS consumes it (dead property) — not ported.
- BootScene prewarms classic balls L1..12 + one ball per skin; every other
  (skin × level × rarity) ball texture is generated lazily on first use and cached.
