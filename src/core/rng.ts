// Injected RNG (PLAN.md §1.1 core/rng.ts): every nondeterministic core
// function takes one of these instead of calling Math.random directly, so
// tests and replays can be seeded. The app passes Math.random in play.

export type Rng = () => number;

/** Deterministic mulberry32 — for tests/replays, not for real play. */
export function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
