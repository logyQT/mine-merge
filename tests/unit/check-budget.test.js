import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { checkBudget, collectFiles, LIMITS } from '../../scripts/check-budget.mjs';

// PLAN.md §1.4: the budget gate must fail builds that break Playables limits
// (>8000 files, >30 MiB/file, >250 MiB total) and warn early on the soft ones
// (>512 KiB/file, initial JS+CSS >15 MiB).

const KiB = 1024;
const MiB = 1024 * KiB;

describe('checkBudget', () => {
  it('passes a small build', () => {
    const r = checkBudget([
      { path: 'index.html', bytes: 1 * KiB },
      { path: 'assets/main.js', bytes: 200 * KiB },
      { path: 'assets/main.css', bytes: 10 * KiB },
    ]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.initialBytes).toBe(210 * KiB);
  });

  it('fails when the file count exceeds 8000', () => {
    const files = Array.from({ length: LIMITS.maxFiles + 1 }, (_, i) => ({
      path: `f${i}.txt`,
      bytes: 1,
    }));
    const r = checkBudget(files);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/8001 files > 8000/);
  });

  it('fails on a single file over 30 MiB', () => {
    const r = checkBudget([{ path: 'huge.bin', bytes: 31 * MiB }]);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/huge\.bin.*30 MiB per file/);
  });

  it('fails when the total exceeds 250 MiB', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `chunk${i}.bin`,
      bytes: 26 * MiB, // each under 30 MiB, together over 250 MiB
    }));
    const r = checkBudget(files);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('total'))).toBe(true);
  });

  it('warns on a file over 512 KiB without failing', () => {
    const r = checkBudget([{ path: 'big.js', bytes: 600 * KiB }]);
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/big\.js/);
  });

  it('warns when initial JS+CSS exceeds 15 MiB', () => {
    const r = checkBudget([
      { path: 'assets/a.js', bytes: 8 * MiB },
      { path: 'assets/b.css', bytes: 8 * MiB },
      { path: 'README.md', bytes: 10 * MiB }, // non-initial, not part of JS+CSS
    ]);
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('initial JS+CSS'))).toBe(true);
  });
});

describe('collectFiles', () => {
  it('walks a real directory recursively with relative paths', async () => {
    const fixturesDir = fileURLToPath(new URL('./fixtures/', import.meta.url));
    const files = await collectFiles(fixturesDir);
    expect(files.map((f) => f.path).sort()).toEqual([
      'save-v1-legacy.json',
      'save-v1.json',
    ]);
    for (const f of files) expect(f.bytes).toBeGreaterThan(0);
  });
});
