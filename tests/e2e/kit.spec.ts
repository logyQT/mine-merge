// E2E suite for the kit against PLATFORM=local + the mock platform
// (PLAN.md §1.5). src/main.ts exposes __platform/__game on globalThis in
// local builds only, which is how these tests drive the mock's simulation
// hooks (setAudioEnabled / emitPause) and observe the game loop.
//
// Phase 3 note: the board (#grid/#mine) is canvas-drawn by MineScene; the
// spacers stay in the DOM as layout boxes, so geometry assertions still read
// them, and cell taps use mouse clicks at legacy cell coordinates (pad 3,
// gap 3, square cells — see src/scenes/MineScene.ts).

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SAVE_KEY = 'mine-merge-save-v1';
// The frozen schema-v1 save fixture — the same file the unit migration tests pin.
const saveV1 = readFileSync(new URL('../unit/fixtures/save-v1.json', import.meta.url), 'utf8');
const fixture: Record<string, unknown> = JSON.parse(saveV1);

/** Collects uncaught page errors and console errors (favicon 404s are
 *  dev-server noise, not game failures). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  return errors;
}

/** Loads the kit and waits for the boot sequence to finish (markReady). */
async function gotoKit(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => globalThis.__platform?.ready === true);
}

/** Pre-seeds localStorage so the FIRST boot loads the save, like a return visit. */
async function seedSave(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, save }) => localStorage.setItem(key, save),
    { key: SAVE_KEY, save: saveV1 },
  );
}

/** Waits out the 500 ms boot-save debounce so storage reads are stable. */
async function settleSaves(page: Page): Promise<void> {
  await page.waitForTimeout(900);
}

/** Taps a merge-grid cell on the canvas (#grid is a transparent spacer). */
async function clickCell(page: Page, i: number): Promise<void> {
  const box = (await page.locator('#grid').boundingBox())!;
  const cw = (box.width - 18) / 5; // 2*pad(3) + 4*gap(3)
  const c = i % 5;
  const r = Math.floor(i / 5);
  await page.mouse.click(box.x + 3 + c * (cw + 3) + cw / 2, box.y + 3 + r * (cw + 3) + cw / 2);
}

test('boots on PLATFORM=local without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoKit(page);

  // The DOM game view is up (legacy menu at boot)…
  await expect(page.locator('#grid')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Graj' })).toBeVisible();
  await expect(page.locator('.debug-hud')).toBeVisible();
  await expect(page.locator('#boot-progress')).toHaveCount(0); // boot finished
  // …and the kit's Phaser canvas exists behind it.
  await expect(page.locator('canvas')).toBeVisible();
  // Phase 3.1: every board texture is generated at boot from the palettes —
  // 0 asset files, so the keys are drawn in code, never fetched (CSP-clean).
  const missing = await page.evaluate(() => {
    const keys = Array.from({ length: 10 }, (_, i) => `mine-${i}`).concat([
      'mine-empty',
      'ball-def-1-0',
      'ball-def-12-0', // prewarmed through the classic color(L) ramp
      'ball-crypto-1-0', // skin pal + sym
      'ball-sq-1-0', // skin rad 18% (rounded square)
      globalThis.__ensureBall!('fruit', 7, 2), // lazy path + rarity ring
    ]);
    return keys.filter((k) => !globalThis.__game!.textures.exists(k));
  });
  expect(missing).toEqual([]);
  expect(await page.evaluate(() => globalThis.__platform!.firstFrame)).toBe(true);
  expect(errors).toEqual([]);
});

test('mine loop: spawn → merge → drop settles with a result', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoKit(page);
  await page.getByRole('button', { name: 'Graj' }).click(); // dismiss the boot menu
  await expect(page.locator('#menu')).toBeHidden();

  await page.getByRole('button', { name: 'Nowy' }).click();
  await page.getByRole('button', { name: 'Nowy' }).click();

  // Tap the first ball, then its match → merge rules from legacy tap().
  // (The board is canvas-drawn, so there are no DOM cells to count — the
  // merge message below proves both balls rendered and combined.)
  await clickCell(page, 0);
  await clickCell(page, 1);
  await expect(page.locator('#msg')).toHaveText('Połączono! Poziom 2');

  await page.getByRole('button', { name: 'RZUĆ!' }).click();
  await expect(page.locator('#msg')).toContainText('Zdobyto', { timeout: 10000 });
  expect(await page.evaluate(() => globalThis.__platform!.ready)).toBe(true);
  expect(errors).toEqual([]);
});

test('screens: stats and shop open and return to the menu', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoKit(page); // boot menu is open — stats/shop launch from here

  await page.getByRole('button', { name: 'Statystyki' }).click();
  await expect(page.locator('#stats')).toBeVisible();
  await expect(page.locator('#stats #sInfo')).toHaveText('Poziom 1 · wolne punkty: 0');
  await page.getByRole('button', { name: 'Wróć do menu' }).click();
  await expect(page.locator('#menu')).toBeVisible();

  await page.getByRole('button', { name: 'Sklep' }).click();
  await expect(page.locator('#shop')).toBeVisible();
  await expect(page.locator('#shInfo')).toContainText('skiny w ekwipunku: 0');
  await page.getByRole('button', { name: 'Wróć do menu' }).click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('level-up crate: opens, spins, awards the ball', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page); // the fixture carries acc.crates = 1
  await gotoKit(page);
  await page.locator('#play').click(); // fixture play text is "Kontynuuj"

  await expect(page.locator('#crate')).toBeVisible();
  await page.locator('#crate').click();
  await expect(page.locator('#crateov')).toBeVisible();
  await expect(page.locator('#cInfo')).toContainText('Skrzynki: 1');

  await page.locator('#cOpen').click();
  await expect(page.locator('#cRes')).toContainText('Wylosowano', { timeout: 8000 });
  await expect(page.locator('#cInfo')).toContainText('Skrzynki: 0'); // consumed
  expect(await page.evaluate(() => globalThis.__platform!.ready)).toBe(true);
  expect(errors).toEqual([]);
});

test('war: prepare rolls a battle, upgrades buy, fight runs to a result', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page); // the fixture brings balls to fight with
  await gotoKit(page); // boot menu is open — war launches from here

  await page.getByRole('button', { name: 'Wojna' }).click();
  await expect(page.locator('#war')).toBeVisible();
  await expect(page.locator('#wLog')).toContainText('Wróg poz.'); // prepareFight rolled

  // Buy one war upgrade (fixture has coins): 100 → next costs 220.
  await page.locator('#pSlow').click();
  await expect(page.locator('#pSlow')).toHaveText('❄ Spowolnienie 1 🪙220');

  // Start the fight, wait for a verdict, then roll the next battle.
  await expect(page.locator('#wGo')).toHaveText('Walka!');
  await page.locator('#wGo').click();
  await expect(page.locator('#wLog')).toHaveText('Bitwa!');
  await expect(page.locator('#wLog')).toContainText(/Zwycięstwo!|Porażka/, { timeout: 30000 });
  await expect(page.locator('#wGo')).toHaveText('Dalej');
  await page.locator('#wGo').click();
  await expect(page.locator('#wLog')).toContainText('Wróg poz.');

  await page.getByRole('button', { name: 'Wróć do menu' }).click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(await page.evaluate(() => globalThis.__platform!.ready)).toBe(true);
  expect(errors).toEqual([]);
});

test('multiplayer: screen opens with army info and returns to menu', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page); // the fixture brings 5 fighting balls
  await gotoKit(page); // boot menu open — mp launches from here

  await page.getByRole('button', { name: 'Multiplayer' }).click();
  await expect(page.locator('#mp')).toBeVisible();
  await expect(page.locator('#mpInfo')).toHaveText(
    'Do walki idzie twoich 5 najsilniejszych kulek (maks. 5). Przegrana nie odbiera kulek.',
  );
  await expect(page.locator('#mpMsg')).toHaveText('');
  await expect(page.locator('#mpLog')).not.toHaveText(''); // dbg('') entry logged
  // Note: Find/Host/Join are not clicked — they hit live MQTT brokers.

  await page.getByRole('button', { name: 'Wróć do menu' }).click();
  await expect(page.locator('#menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('audio: menu clicks and block breaks produce sound', async ({ page }) => {
  const errors = collectErrors(page);
  // Count every oscillator the game creates (one per tone() call).
  await page.addInitScript({
    content: `window.__osc = 0;
      const orig = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function () { window.__osc += 1; return orig.call(this); };`,
  });
  await seedSave(page); // spawnLvl 4 → its balls always break row-0 blocks
  await gotoKit(page);
  const osc = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { __osc?: number }).__osc ?? 0);

  // Menu buttons click (this one also opens stats).
  const m0 = await osc();
  await page.getByRole('button', { name: 'Statystyki' }).click();
  await expect(page.locator('#stats')).toBeVisible();
  expect(await osc()).toBeGreaterThan(m0);

  await page.getByRole('button', { name: 'Wróć do menu' }).click();
  await page.locator('#play').click();

  // Merge two spawned balls, then drop: every landing plays hit, and any
  // block broken plays brk (legacy land() behavior).
  await page.getByRole('button', { name: 'Nowy' }).click();
  await page.getByRole('button', { name: 'Nowy' }).click();
  await clickCell(page, 1);
  await clickCell(page, 2);
  await expect(page.locator('#msg')).toHaveText('Połączono! Poziom 5');

  const d0 = await osc();
  await page.getByRole('button', { name: 'RZUĆ!' }).click();
  await expect(page.locator('#msg')).toContainText('Zdobyto', { timeout: 10000 });
  expect((await osc()) - d0).toBeGreaterThanOrEqual(2); // hit + brk (coin adds more)
  expect(errors).toEqual([]);
});

const VIEWPORTS = [
  { width: 360, height: 640 },
  { width: 800, height: 600 },
  { width: 1280, height: 800 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`renders at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize(viewport);
    await gotoKit(page);

    // The legacy game column fits the viewport at every aspect ratio…
    await expect(page.locator('#grid')).toBeVisible();
    const app = await page.locator('#app').boundingBox();
    expect(app).not.toBeNull();
    expect(app!.width).toBeGreaterThan(0);
    expect(app!.width).toBeLessThanOrEqual(viewport.width);
    // …and the canvas (Phase 3 host) exists without overflowing.
    const canvas = await page.locator('canvas').boundingBox();
    expect(canvas).not.toBeNull();
    expect(canvas!.width).toBeGreaterThan(0);
    expect(canvas!.width).toBeLessThanOrEqual(viewport.width + 40);
    expect(errors).toEqual([]);
  });
}

test('state survives a mid-game window resize', async ({ page }) => {
  const errors = collectErrors(page);
  await seedSave(page); // load the fixture on the FIRST boot, like a return visit
  await page.setViewportSize({ width: 800, height: 600 });
  await gotoKit(page);
  await settleSaves(page);

  const before = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(JSON.parse(before!).coins).toBe(fixture.coins); // the fixture actually loaded
  const initRuns = await page.evaluate(() => globalThis.__platform!.progress.length);
  const gridBefore = (await page.locator('#grid').boundingBox())!.width;

  await page.setViewportSize({ width: 360, height: 640 });
  // The view follows the viewport…
  await expect
    .poll(async () => (await page.locator('#grid').boundingBox())?.width ?? Number.MAX_SAFE_INTEGER)
    .toBeLessThan(gridBefore);

  // …while the booted session and its save stay untouched (no re-init, no wipe).
  expect(await page.evaluate(() => globalThis.__platform!.ready)).toBe(true);
  expect(await page.evaluate(() => globalThis.__platform!.progress.length)).toBe(initRuns);
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe(before);
  expect(errors).toEqual([]);
});

test('board input follows the canvas across a resize', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await gotoKit(page);
  await page.getByRole('button', { name: 'Graj' }).click();
  await page.getByRole('button', { name: 'Nowy' }).click();
  await page.getByRole('button', { name: 'Nowy' }).click();

  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(200); // Scale.RESIZE + one MineScene layout pass

  // The board re-laid-out on the canvas (spacers moved, scene re-measured):
  // the same two cells still merge at the new size — state survives by
  // construction (nothing but geometry was touched).
  await clickCell(page, 0);
  await clickCell(page, 1);
  await expect(page.locator('#msg')).toHaveText('Połączono! Poziom 2');
  expect(await page.evaluate(() => globalThis.__platform!.ready)).toBe(true);
  expect(errors).toEqual([]);
});

test('save → reload → identical state', async ({ page }) => {
  const errors = collectErrors(page);
  // main.ts logs the raw save size when boot hands the save off to the game.
  const saveLogs: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes('save loaded')) saveLogs.push(msg.text());
  });
  await seedSave(page);
  await gotoKit(page);
  expect(saveLogs.length).toBeGreaterThan(0); // first boot consumed the save
  await settleSaves(page);

  await page.reload();
  await page.waitForFunction(() => globalThis.__platform?.ready === true);
  await settleSaves(page);
  expect(saveLogs.length).toBeGreaterThan(1); // the reload consumed it too

  const raw = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(raw).not.toBeNull();
  const saved = JSON.parse(raw!) as Record<string, unknown>;
  // Durable core identical to the fixture; frontier rows re-roll by design
  // (pinned by save-core.test.ts — same behavior as the legacy oracle).
  for (const key of Object.keys(fixture)) {
    if (key === 'rows') continue;
    expect(saved[key], `field ${key}`).toEqual(fixture[key]);
  }
  expect((saved.rows as unknown[]).slice(0, fixture.topRow as number)).toEqual(
    (fixture.rows as unknown[]).slice(0, fixture.topRow as number),
  );
  // The mock round-trips whatever is in storage.
  expect(await page.evaluate(() => globalThis.__platform!.loadSave())).toBe(raw);
  expect(errors).toEqual([]);
});

test('mock.setAudioEnabled(false) silences the audio path', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoKit(page);

  // A real gesture unlocks the AudioContext (Chromium starts it suspended).
  // The boot menu overlays the canvas, so click the menu's play button.
  await page.getByRole('button', { name: 'Graj' }).click();

  // Audio is on by default → Phaser output unmuted.
  expect(await page.evaluate(() => globalThis.__game!.sound.mute)).toBe(false);

  await page.evaluate(() => globalThis.__platform!.setAudioEnabled(false));
  expect(await page.evaluate(() => globalThis.__platform!.isAudioEnabled())).toBe(false);
  // The mute event applies (retroactively) once the unlocked context runs.
  await expect.poll(() => page.evaluate(() => globalThis.__game!.sound.mute)).toBe(true);
  await expect(page.getByRole('button', { name: 'audio: off' })).toBeVisible();

  // Flip back through the debug HUD button (drives the same mock hook).
  await page.getByRole('button', { name: 'audio: off' }).click();
  expect(await page.evaluate(() => globalThis.__platform!.isAudioEnabled())).toBe(true);
  await expect.poll(() => page.evaluate(() => globalThis.__game!.sound.mute)).toBe(false);
  expect(errors).toEqual([]);
});

test('mock.emitPause() freezes the game loop, emitResume() restarts it', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoKit(page);

  const loopTime = () => page.evaluate(() => globalThis.__game!.loop.time);
  const t0 = await loopTime();
  await page.waitForTimeout(250);
  expect(await loopTime()).toBeGreaterThan(t0); // loop is ticking

  await page.evaluate(() => globalThis.__platform!.emitPause());
  await expect(page.getByRole('button', { name: 'resume' })).toBeVisible();
  const pausedAt = await loopTime();
  await page.waitForTimeout(250);
  expect(await loopTime()).toBe(pausedAt); // frozen while paused

  await page.evaluate(() => globalThis.__platform!.emitResume());
  await expect(page.getByRole('button', { name: 'pause' })).toBeVisible();
  await page.waitForTimeout(250);
  expect(await loopTime()).toBeGreaterThan(pausedAt); // ticking again
  expect(errors).toEqual([]);
});
