# AGENTS.md

## Git workflow

- **Never push directly to `main`.** Direct pushes to `main` are restricted.
- Create a feature branch for each change: `feature/<short-description>` (or `fix/<short-description>` for bug fixes).
- Keep branches focused: **one feature (or fix) per branch and per PR.**
- Open a PR for the branch and get it merged into `main` through the PR.
- Pull from `main` into your branch before opening the PR to keep it up to date.
- Stacked PRs: while a PR is still open, open the next one with `--base <that branch>`; GitHub retargets it to `main` automatically once the base merges.

## Language

- **Everything in English.** Code comments, commit messages, and pull requests must be written in English.

## Verification — run before opening every PR

- `npm test` && `npm run typecheck` && `npm run test:e2e`
- `npm run build:yt` && `npm run build:web` — the budget gate must pass. The ~1.14 MiB > 512 KiB Phaser WARN is expected; do not "fix" it by splitting the bundle.
- Tree-shaking / CSP greps — each must print nothing (or `0`):

```sh
grep -rl "emitPause\|mine-merge-save-v1\|reload-save\|createPortalPlatform" dist/yt/
grep -c "__platform\|__game" dist/yt/assets/*.js
grep -c "jsdelivr\|wss://\|mqtt" dist/yt/assets/*.js   # Playables CSP: no external requests
```

## Tooling notes

- Ports: `:8080` is reserved for `npm run dev` / `preview*` and the YouTube Test Suite; the Playwright e2e suite serves itself on `:8090`.

## Architecture (PLAN.md is the source of truth)

- Platform-specific code is removed at **compile time** via `__PLATFORM__` — runtime guards are not enough for the YT build (see the greps above).
- `src/core/*` is pure: no DOM/Phaser/platform imports. The injected `Rng` is always the **last** parameter. Views (`src/ui/`) only read `GameState`; orchestration lives in `src/app.ts`.
- `legacy/` is a read-only oracle (tag `legacy-vanilla`); tests boot it through `tests/helpers/game.js`.
- Save schema v1 must be accepted forever. Fixtures live in `tests/unit/fixtures/` — regenerate only via `npm run fixture:gen`.
- `phaser@3.90.0` is pinned: a plain `npm i phaser` installs 4.x — never upgrade casually.

## General

- Keep changes minimal and follow the existing style of the codebase.
- Current phase status and handoffs live in `docs/` — read the latest one before starting a new phase.
