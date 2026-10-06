import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// Phase 0 test harness: runs the REAL legacy index.html + app.js in jsdom,
// without touching the game code. It acts as the "oracle" — the tests pin
// applySave()/normalize()/save() behavior BEFORE the refactor (PLAN Phase 0).
// In Phase 1/2 the same suite gets retargeted to src/core/save.ts (TS).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const appSource = readFileSync(join(ROOT, 'app.js'), 'utf8');

export const SAVE_KEY = 'kopalnia-save-v1';

// app.js is a classic script with top-level let/const — wrap it in an IIFE so that:
//  1) every game instance owns its state (no declaration collisions between tests),
//  2) the pure state functions are exposed via window.__kopalnia.
const wrapped = `(function () {\n${appSource}\n;window.__kopalnia = {
  save() { save(); return JSON.parse(localStorage.getItem('${SAVE_KEY}')); },
  set(d) { applySave(d); },
  normalize,
  makeRows(n) { const out = []; for (let i = 0; i < n; i++) out.push(makeRow(i)); return out; }
};\n})()`;

/**
 * Boots a fresh instance of the game in jsdom.
 * @param {{ save?: object, raw?: string }} [opts]
 *   save — save object injected into localStorage before boot (loading an old save),
 *   raw  — raw string for localStorage (corrupt-save tests).
 */
export function createGame(opts = {}) {
  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/',
    pretendToBeVisual: true,      // app.js uses requestAnimationFrame in boot()
    runScripts: 'outside-only'    // window.eval works, <script src> tags are NOT fetched
  });
  const { window } = dom;
  if (opts.raw !== undefined) window.localStorage.setItem(SAVE_KEY, opts.raw);
  else if (opts.save !== undefined) window.localStorage.setItem(SAVE_KEY, JSON.stringify(opts.save));
  window.eval(wrapped);
  return { dom, window, api: window.__kopalnia };
}

/** Current save in localStorage (or null if the game never saved). */
export function readSave(window) {
  const raw = window.localStorage.getItem(SAVE_KEY);
  return raw === null ? null : JSON.parse(raw);
}
