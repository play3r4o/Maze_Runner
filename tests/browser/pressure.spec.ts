import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { generateMaze } from '../../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun } from '../../src/game/generatedRun';
import { createRunReport } from '../../src/game/runReport';
import { ticks } from '../../src/game/tuning';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function startRunning(page: Page, name: string) {
  await clickWithBrowserFrames(page, page.getByRole('button', { name }));
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
}
async function pause(page: Page) { await page.keyboard.press('Escape'); await page.clock.runFor(200); }
const html = (page: Page, key: string) => page.evaluate((name) => document.documentElement.dataset[name], key);
const world = buildGeneratedWorld(generateMaze(41));
// A report placing a running expedition just before a given run-clock time, at the relic room.
function reportAt(seconds: number) {
  const run = { ...createGeneratedRun(world), status: 'out' as const, runTicks: ticks(seconds),
    bells: [150, 195, 240].filter((bell) => seconds >= bell).length,
    player: { x: world.relic.x, z: world.relic.z, yaw: 0 }, cell: world.relic.cell, ring: 'outer' as const, leftSanctuary: true };
  return JSON.stringify(createRunReport(world, run));
}

test('chalk marks, rule switches in the address, and positional sound on a shift', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await installBrowserClock(page); await page.goto('/?seed=41');
  await expect(page).toHaveTitle('Shifting Labyrinth · M7b');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('chalk-left')).toHaveText('12 chalk');
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await expect.poll(() => html(page, 'audioState')).toBe('running');
  // Chalk: two marks, the map shows them.
  await page.keyboard.press('KeyC'); await page.clock.runFor(100);
  await page.keyboard.down('KeyW'); await page.clock.runFor(600); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyC'); await page.clock.runFor(200);
  await expect(page.getByTestId('chalk-left')).toHaveText('10 chalk');
  await expect(page.getByTestId('debug-chalk-mark')).toHaveCount(2);
  // A forced shift is heard: warnings at both gates, then grinding.
  const before = Number(await html(page, 'soundsPlayed'));
  await page.keyboard.press('KeyG'); await page.clock.runFor(4000);
  await expect.poll(async () => Number(await html(page, 'soundsPlayed'))).toBeGreaterThanOrEqual(before + 3);
  // Switch chalk off: C does nothing, the address remembers it, the HUD says so.
  await pause(page);
  await page.locator('[data-rule="chalk"]').uncheck();
  await expect(page).toHaveURL(/[?&]off=chalk(&|$)/);
  await page.getByTestId('mute').check();
  await startRunning(page, 'Resume exploring');
  await page.keyboard.press('KeyC'); await page.clock.runFor(300);
  await expect(page.getByTestId('chalk-left')).toHaveText('no chalk');
  await expect(page.getByTestId('debug-chalk-mark')).toHaveCount(2);
  // A reload keeps the switch: the run starts with chalk off. (The paused test clock survives
  // navigation, so resume it first or the page never draws a frame.)
  await page.clock.resume();
  await page.reload();
  await expect(page.getByTestId('chalk-left')).toHaveText('no chalk');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.locator('[data-rule="chalk"]')).not.toBeChecked();
  await expect(page.locator('[data-rule="dusk"]')).toBeChecked();
  expect(errors).toEqual([]);
});

test('the first bell rings at 150 s with a visible notice; after the third, night', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await installBrowserClock(page);
  await page.goto(`/?seed=41#repro=${encodeURIComponent(reportAt(149.5))}`);
  await expect(page.locator('[data-message]')).toContainText('Gate state matches the report exactly.');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await page.clock.runFor(1000);
  await expect(page.getByTestId('shift-notice')).toHaveText('The Sanctuary bell tolls once.');
  await pause(page);
  await page.locator('.debug-events summary').click(); await page.clock.runFor(200);
  await expect(page.getByTestId('debug-events')).toContainText('bell: 1 strike');
  await expect(page.getByTestId('debug-run')).toContainText('next bell 195s');

  // Night: reload just before the third bell.
  await page.clock.resume();
  // A different query string forces a real page load (a hash-only change would not reload).
  await page.goto(`/?seed=41&visit=2#repro=${encodeURIComponent(reportAt(239.5))}`);
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await page.clock.runFor(1000);
  await expect(page.getByTestId('shift-notice')).toContainText('three times. Night falls');
  await expect(page.getByTestId('debug-run')).toContainText('NIGHT');
  await expect(page.getByTestId('debug-run')).toContainText('interval 10s');
  // A #repro= link opened on the same page (hash change only) is applied too.
  await page.evaluate((hash) => { location.hash = hash; }, `repro=${encodeURIComponent(reportAt(100))}`);
  await page.clock.runFor(300);
  await expect(page.locator('[data-message]')).toContainText('Gate state matches the report exactly.');
  await expect(page.getByTestId('debug-run')).toContainText('clock 100.0s');
  expect(new URL(page.url()).hash).toBe('');
  expect(errors).toEqual([]);
});
