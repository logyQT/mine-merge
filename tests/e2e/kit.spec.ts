// E2E suite for the kit against PLATFORM=local + the mock platform
// (PLAN.md §1.5). src/main.ts exposes __platform/__game on globalThis in
// local builds only, which is how these tests drive the mock's simulation
// hooks (setAudioEnabled / emitPause) and observe the Phaser game loop.

import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SAVE_KEY = 'mine-merge-save-v1';
// The frozen schema-v1 save fixture — the same file the unit migration tests
// pin, injected here as an opaque save string for the roundtrip test.
const saveV1 = readFileSync(new URL('../unit/fixtures/save-v1.json', import.meta.url), 'utf8');

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

test('boots on PLATFORM=local without console errors', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoKit(page);

  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.debug-hud')).toBeVisible();
  await expect(page.locator('#boot-progress')).toHaveCount(0); // boot finished
  expect(await page.evaluate(() => globalThis.__platform!.firstFrame)).toBe(true);
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

    const box = await page.locator('canvas').boundingBox();
    expect(box, 'canvas present').not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 40);
    expect(box!.width).toBeLessThanOrEqual(viewport.width + 40);
    expect(box!.height).toBeGreaterThanOrEqual(viewport.height - 40);
    expect(box!.height).toBeLessThanOrEqual(viewport.height + 40);
    expect(errors).toEqual([]);
  });
}

test('state survives a mid-game window resize', async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 800, height: 600 });
  await gotoKit(page);

  // Seed a save so we can prove nothing re-boots or wipes storage.
  await page.evaluate((save) => globalThis.__platform!.saveSave(save), saveV1);
  const initRuns = await page.evaluate(() => globalThis.__platform!.progress.length);

  await page.setViewportSize({ width: 360, height: 640 });
  // The canvas follows the viewport (Scale.RESIZE)…
  await expect
    .poll(async () => (await page.locator('canvas').boundingBox())?.width ?? 0)
    .toBeLessThan(400);

  // …while the booted session and its save stay untouched (no re-init).
  expect(await page.evaluate(() => globalThis.__platform!.ready)).toBe(true);
  expect(await page.evaluate(() => globalThis.__platform!.progress.length)).toBe(initRuns);
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe(saveV1);
  expect(errors).toEqual([]);
});

test('save → reload → identical state', async ({ page }) => {
  const errors = collectErrors(page);
  // main.ts logs the raw save size when boot hands the save off to the game.
  const saveLogs: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().includes('save loaded')) saveLogs.push(msg.text());
  });
  await gotoKit(page);

  await page.evaluate((save) => globalThis.__platform!.saveSave(save), saveV1);
  expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe(saveV1);

  await page.reload();
  await page.waitForFunction(() => globalThis.__platform?.ready === true);

  expect(await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY)).toBe(saveV1);
  expect(await page.evaluate(() => globalThis.__platform!.loadSave())).toBe(saveV1);
  expect(saveLogs.some((text) => /save loaded \(\d+ B\)/.test(text))).toBe(true);
  expect(errors).toEqual([]);
});

test('mock.setAudioEnabled(false) silences the audio path', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoKit(page);

  // A real gesture unlocks the AudioContext (Chromium starts it suspended);
  // until then, scheduled mute events are not observable via gain.value.
  await page.locator('canvas').click({ position: { x: 10, y: 10 } });

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
