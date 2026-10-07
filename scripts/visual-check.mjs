// Visual side-by-side tool for the Phase 3 exit criteria: screenshots the
// kit (PLATFORM=local dev server) and legacy/ with the same save fixture so
// the two can be compared image-by-image (PLAN.md §Phase 3).
//
// Usage:  node scripts/visual-check.mjs
// Shots:  ${tmpdir}/mine-merge-visual-check/*.png
//
// Notes: full-page captures of animated frames can return a stale compositor
// frame — give the page a beat (the script waits ~1 s after each interaction)
// and prefer plain viewport shots while animations are running.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const OUT = join(tmpdir(), 'mine-merge-visual-check');
mkdirSync(OUT, { recursive: true });
const fixture = readFileSync('tests/unit/fixtures/save-v1.json', 'utf8');
const VITE = join('node_modules', 'vite', 'bin', 'vite.js');

const servers = [
  spawn(process.execPath, [VITE, '--port', '8091', '--strictPort'], { stdio: 'ignore' }),
  spawn(process.execPath, [VITE, 'legacy', '--port', '8092', '--strictPort'], { stdio: 'ignore' }),
];
process.on('exit', () => servers.forEach((s) => s.kill()));
async function waitForServer(url) {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`server did not start: ${url}`);
}
await Promise.all([waitForServer('http://localhost:8091/'), waitForServer('http://localhost:8092/')]);

const browser = await chromium.launch();
const errs = [];
async function open(url, key, viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errs.push(`${url} pageerror: ${e}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('favicon') && errs.push(`${url} console: ${m.text()}`));
  await page.addInitScript(({ k, s }) => localStorage.setItem(k, s), { k: key, s: fixture });
  await page.goto(url);
  return page;
}
const settle = async (page) => {
  await page.waitForTimeout(1000); // let the compositor present the new frame
};
const cell = async (page, i) => {
  const box = (await page.locator('#grid').boundingBox());
  const cw = (box.width - 18) / 5; // legacy grid metrics: pad 3, gap 3, square
  await page.mouse.click(box.x + 3 + (i % 5) * (cw + 3) + cw / 2, box.y + 3 + Math.floor(i / 5) * (cw + 3) + cw / 2);
};

// --- kit ---
const kit = await open('http://localhost:8091/', 'mine-merge-save-v1', { width: 800, height: 600 });
await kit.waitForFunction(() => globalThis.__platform?.ready === true);
await kit.locator('#play').click();
await settle(kit);
await kit.screenshot({ path: `${OUT}/kit-800-board.png` });
await cell(kit, 0); // selection outline + scaled ball
await settle(kit);
await kit.screenshot({ path: `${OUT}/kit-800-selected.png` });
// Drop: a burst of frames at fixed offsets (compositor lag on animated
// frames is erratic) — at least one catches the ball in flight over the
// DOM controls; by the third the drop has usually settled.
await kit.getByRole('button', { name: 'RZUĆ!' }).click();
for (const [i, t] of [900, 600, 600].entries()) {
  await kit.waitForTimeout(t);
  await kit.screenshot({ path: `${OUT}/kit-800-drop-${i + 1}.png` });
}
await kit.waitForTimeout(1500);
await kit.screenshot({ path: `${OUT}/kit-800-after-drop-full.png`, fullPage: true });
await kit.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await settle(kit);
await kit.screenshot({ path: `${OUT}/kit-800-mine.png` });
await kit.setViewportSize({ width: 360, height: 640 });
await kit.evaluate(() => window.scrollTo(0, 0));
await settle(kit);
await kit.screenshot({ path: `${OUT}/kit-360-top.png` });
await kit.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await settle(kit);
await kit.screenshot({ path: `${OUT}/kit-360-bottom.png` });

// --- legacy (same sequence, same fixture) ---
const legacy = await open('http://localhost:8092/', 'kopalnia-save-v1', { width: 800, height: 600 });
await legacy.waitForSelector('#play');
await legacy.locator('#play').click();
await settle(legacy);
await legacy.screenshot({ path: `${OUT}/legacy-800-board.png` });
await cell(legacy, 0);
await settle(legacy);
await legacy.screenshot({ path: `${OUT}/legacy-800-selected.png` });
await legacy.getByRole('button', { name: 'RZUĆ!' }).click();
for (const [i, t] of [900, 600, 600].entries()) {
  await legacy.waitForTimeout(t);
  await legacy.screenshot({ path: `${OUT}/legacy-800-drop-${i + 1}.png` });
}
await legacy.waitForTimeout(1500);
await legacy.screenshot({ path: `${OUT}/legacy-800-after-drop-full.png`, fullPage: true });
await legacy.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await settle(legacy);
await legacy.screenshot({ path: `${OUT}/legacy-800-mine.png` });
await legacy.setViewportSize({ width: 360, height: 640 });
await legacy.evaluate(() => window.scrollTo(0, 0));
await settle(legacy);
await legacy.screenshot({ path: `${OUT}/legacy-360-top.png` });
await legacy.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await settle(legacy);
await legacy.screenshot({ path: `${OUT}/legacy-360-bottom.png` });

// --- war screen (Phase 4): army rows + battle log — canvas (kit) vs DOM (legacy) ---
const warSeq = async (page, prefix) => {
  // Both pages boot into the menu with the same fixture — armyList is
  // deterministic, so the paired prepare shots line up ball-for-ball.
  await page.locator('#warBtn').click();
  await page.waitForSelector('#war');
  await settle(page);
  await page.screenshot({ path: `${OUT}/${prefix}-war-prepare.png` });
  await page.locator('#pFire').click(); // war power 1 → 🔥 markers on the first hits
  await page.locator('#wGo').click();
  await page.waitForTimeout(1400); // mid-fight: HP bars drawn down, markers live
  await page.screenshot({ path: `${OUT}/${prefix}-war-fight.png` });
  await page.setViewportSize({ width: 360, height: 640 });
  await settle(page);
  await page.screenshot({ path: `${OUT}/${prefix}-war-360.png` });
};
const kitWar = await open('http://localhost:8091/', 'mine-merge-save-v1', { width: 800, height: 600 });
await kitWar.waitForFunction(() => globalThis.__platform?.ready === true);
await warSeq(kitWar, 'kit');
const legacyWar = await open('http://localhost:8092/', 'kopalnia-save-v1', { width: 800, height: 600 });
await legacyWar.waitForSelector('#warBtn');
await warSeq(legacyWar, 'legacy');

await browser.close();
console.log('errors:', errs.length ? errs : 'none');
console.log('shots in', OUT);
process.exit(0); // don't wait on fetch keep-alive sockets
