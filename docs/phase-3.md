# Phase 3 — Canvas board in Phaser

Status: **complete pending merge** — PRs #24 → #25 → #26 open (stacked; merge in that
order, GitHub retargets automatically). Human approved the side-by-side visuals
(2026-10-07). Decision record lives in PLAN.md §Phase 3 ("Decisions (recorded before
starting)") — the short version: **the 5×5 merge grid goes to canvas together with
`#mine`** (kit guideline: *board → canvas, forms/lists/text → DOM*). Next: Phase 4.

## Stacked-PR slicing (per AGENTS.md)

| # | Branch | Scope | Status |
|---|---|---|---|
| 1 | `feature/phase3-textures` | Palettes extracted to `src/ui/palette.ts`; `src/scenes/textures.ts` generates mine-cell + ball textures from them at boot (CanvasTexture, 0 asset files); local-only `__ensureBall` e2e hook; boot contract unchanged. | PR #24 open |
| 2 | `feature/phase3-minescene` | `MineScene` draws grid + mine from `GameState` (spacers measured per frame), pointer input (tap/drag via `Phaser.Input.Pointer`), `flyBall`/land/hit animations (reduced-motion aware), DOM board deleted, e2e retargeted to canvas gestures + new resize-input test. | PR #25 open |
| 3 | `feature/phase3-hud` | Play-screen chrome extracted to `src/ui/hud.ts` (game-view keeps the modal screens), comments/style cleanup, 3-viewport resize verification via e2e, `scripts/visual-check.mjs` side-by-side tool. | local, gates green |

## Exit criteria (PLAN §Phase 3)

- [x] Mine loop (spawn → merge → drop → destroy → coins → upgrade) fully in Phaser (PR 2)
- [x] DOM board rendering deleted (`#grid`/`#mine` are transparent spacers only)
- [x] Side-by-side visual check vs `legacy/` — **human reviewed the paired shots and
      approved** (2026-10-07). Accepted deviation: the falling (`flyBall`) animation
      reads slightly different from the DOM original — **fine as-is, do not "fix"**
      unless asked. Tool stays: `node scripts/visual-check.mjs` → 18 pairs in
      `${tmpdir}/mine-merge-visual-check/`
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
- **e2e msg race (legacy parity)**: the level-up toast (`msg` after 60 ms) overwrites
  the drop's "Zdobyto…" text when the drop crosses a level — legacy does this too. The
  audio test now waits on oscillator counts + the drop button re-enabling instead of
  `#msg`, which was flaky whenever re-rolled frontier rows pushed XP over.
