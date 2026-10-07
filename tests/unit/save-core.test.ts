import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createInitialState, type GameState } from '../../src/core/state';
import { applySave, restore, serialize, SAVE_KEYS } from '../../src/core/save';

// Phase 2 port of the legacy oracle (tests/unit/save.test.js): same pins,
// now against src/core/save.ts. Rule (PLAN Phase 0): schema-v1 saves must
// load forever.
//
// Note: fresh loads here have rows=[] — the mine-row re-peek (rowAt) lands
// with core/mine.ts. normalize() trimming is pinned below; the full-boot
// row formula stays pinned by the legacy oracle.

const fixtureText = readFileSync(new URL('./fixtures/save-v1.json', import.meta.url), 'utf8');
const fixture: Record<string, unknown> = JSON.parse(fixtureText);
const legacyText = readFileSync(new URL('./fixtures/save-v1-legacy.json', import.meta.url), 'utf8');

const DEFAULT_ACC = { xp: 0, s: { pow: 0, gain: 0, luck: 0, hp: 0 } };

/** Fresh state + boot-time restore, as main.ts will do it. */
function load(raw: string): GameState {
  const s = createInitialState();
  restore(s, raw);
  return s;
}

function saved(s: GameState): Record<string, unknown> {
  return JSON.parse(serialize(s)) as Record<string, unknown>;
}

describe('serialize', () => {
  it('writes exactly the v1 key set', () => {
    expect(Object.keys(saved(createInitialState())).sort()).toEqual([...SAVE_KEYS].sort());
  });

  it('a fresh state has the legacy defaults', () => {
    const s = saved(createInitialState());
    expect(s.coins).toBe(30);
    expect(s.grid).toEqual(Array(25).fill(0));
    expect(s.rows).toEqual([]); // re-peeked by core/mine.ts on first render
    expect(s.topRow).toBe(0);
    expect(s.inv).toEqual({});
    expect(s.acc).toEqual(DEFAULT_ACC);
    expect(s.skins).toEqual({ items: [], cur: null, nid: 1 });
    expect(s.bestDepth).toBe(0);
  });

  it('drops explicit undefined values (JSON cannot represent them)', () => {
    const s = createInitialState();
    applySave(s, { coins: undefined });
    expect(s.coins).toBeUndefined(); // taken by applySave, like Object.assign
    expect(saved(s)).not.toHaveProperty('coins');
    // …and the next boot falls back to the default (oracle: same behavior).
    expect(load(serialize(s)).coins).toBe(30);
  });
});

describe('save-v1.json (mid-game fixture)', () => {
  it('keeps every non-rows field and trims rows to topRow', () => {
    const s = load(fixtureText);
    const out = saved(s);
    for (const key of SAVE_KEYS) {
      if (key === 'rows') continue;
      expect(out[key], `field ${key}`).toEqual(fixture[key]);
    }
    // normalize() dropped the one un-durable peek row the fixture carried.
    expect(s.rows).toHaveLength(fixture.topRow as number);
    expect(s.rows).toEqual((fixture.rows as GameState['rows']).slice(0, fixture.topRow as number));
  });

  it('durable core survives save → restore → save', () => {
    const s1 = load(fixtureText);
    const s2 = load(serialize(s1));
    for (const key of SAVE_KEYS) {
      if (key === 'rows') continue;
      expect(saved(s2)[key], `field ${key}`).toEqual(saved(s1)[key]);
    }
    expect(s2.rows).toEqual(s1.rows);
    expect(s2.rows).toHaveLength(fixture.topRow as number);
  });
});

describe('save-v1-legacy.json (old schema, missing fields)', () => {
  it('missing fields fall back to defaults, existing fields untouched', () => {
    const s = load(legacyText);
    expect(s.blastLvl).toBe(0);
    expect(s.blastCost).toBe(80);
    expect(s.bombs).toBe(0);
    expect(s.bombCost).toBe(250);
    expect(s.econ).toEqual({ pas: 0, dis: 0 });
    expect(s.acc.s).toEqual({ pow: 0, gain: 0, luck: 0, hp: 0 });
    expect(s.bestDepth).toBe(10);
    expect(s.coins).toBe(1500);
    expect(s.topRow).toBe(5);
    expect(s.inv).toEqual({ 2: 1 });
    expect(s.war).toEqual({ wave: 2, fire: 0, slow: 0, weak: 0 });
    expect(s.rows).toHaveLength(0); // no rows in the save → rowAt() re-creates on render
  });

  it('migrates skins.owned → skins.items (skips "def", maps cur to id)', () => {
    const s = load(legacyText);
    expect(s.skins.owned).toBeUndefined();
    expect(s.skins.items.map(({ id, theme, rar }) => ({ id, theme, rar }))).toEqual([
      { id: 1, theme: 'crypto', rar: 0 },
      { id: 2, theme: 'planet', rar: 0 },
    ]);
    expect(s.skins.cur).toBe(2); // "planet" → id 2
    expect(s.skins.nid).toBe(3);
    // perks roll lazily on first use (core/cosmetics.ts) — absent until then
    expect(s.skins.items[1].perks).toBeUndefined();
  });

  it('durable core survives save → restore → save', () => {
    const s1 = load(legacyText);
    const s2 = load(serialize(s1));
    for (const key of SAVE_KEYS) {
      if (key === 'rows') continue;
      expect(saved(s2)[key], `field ${key}`).toEqual(saved(s1)[key]);
    }
    expect(s2.rows).toEqual(s1.rows);
  });
});

describe('robustness', () => {
  it('corrupt JSON does not throw and keeps the defaults', () => {
    const s = createInitialState();
    expect(() => restore(s, '{"coins": 15, missing-brace')).not.toThrow();
    expect(s.coins).toBe(30);
    expect(s.grid).toEqual(Array(25).fill(0));
    expect(s.topRow).toBe(0);
  });

  it('JSON nulls in every nullable field fall back to defaults', () => {
    const s = createInitialState();
    restore(
      s,
      JSON.stringify({
        coins: 777,
        topRow: 0,
        grid: null,
        rows: null,
        inv: null,
        blastLvl: null,
        blastCost: null,
        bombs: null,
        bombCost: null,
        war: null,
        acc: null,
        econ: null,
        skins: null,
        bestDepth: null,
      }),
    );
    expect(s.coins).toBe(777);
    expect(s.grid).toEqual(Array(25).fill(0));
    expect(s.inv).toEqual({});
    expect(s.blastLvl).toBe(0);
    expect(s.blastCost).toBe(80);
    expect(s.bombs).toBe(0);
    expect(s.bombCost).toBe(250);
    expect(s.war).toEqual({ wave: 1, fire: 0, slow: 0, weak: 0 });
    expect(s.acc).toEqual(DEFAULT_ACC);
    expect(s.econ).toEqual({ pas: 0, dis: 0 });
    expect(s.skins).toEqual({ items: [], cur: null, nid: 1 });
    expect(s.bestDepth).toBe(0);
    expect(s.topRow).toBe(0);
  });

  it('restore is idempotent (second load changes nothing)', () => {
    const s = load(fixtureText);
    const once = serialize(s);
    restore(s, once);
    expect(serialize(s)).toBe(once);
  });

  it('no save string → normalize only, defaults intact', () => {
    const s = createInitialState();
    expect(() => restore(s, null)).not.toThrow();
    expect(serialize(s)).toBe(serialize(createInitialState()));
  });
});
