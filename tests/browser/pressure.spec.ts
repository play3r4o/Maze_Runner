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
// Mouse-look while the pointer is locked: relative movement in small steps, a frame each.
async function look(page: Page, dx: number, dy: number) {
  await page.evaluate(([x, y]) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y })), [dx, dy]);
  await page.clock.runFor(50);
}
// Chalk is a toggle (C) and the left mouse button draws while it is out.
async function drawWhileMoving(page: Page, moves: [number, number][]) {
  await page.mouse.down();
  for (const [dx, dy] of moves) for (let i = 0; i < 10; i++) await look(page, dx / 10, dy / 10);
  await page.mouse.up();
  await page.clock.runFor(100);
}
const world = buildGeneratedWorld(generateMaze(41));
// A report placing a running expedition just before a given run-clock time, at the relic room.
function reportAt(seconds: number) {
  const run = { ...createGeneratedRun(world), status: 'out' as const, runTicks: ticks(seconds),
    bells: [150, 195, 240].filter((bell) => seconds >= bell).length,
    player: { x: world.relic.x, z: world.relic.z, yaw: 0 }, cell: world.relic.cell, ring: 'outer' as const, leftSanctuary: true };
  return JSON.stringify(createRunReport(world, run));
}

test('free-draw chalk strokes, rule switches in the address, and positional sound on a shift', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await installBrowserClock(page); await page.goto('/?seed=41');
  await expect(page).toHaveTitle('Shifting Labyrinth · M16');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('chalk-left')).toHaveText('100% chalk');
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await expect.poll(() => html(page, 'audioState')).toBe('running');
  // Free-draw chalk: with the chalk away, the mouse button draws nothing.
  await look(page, 0, 500);
  await drawWhileMoving(page, [[60, 0]]);
  await expect(page.getByTestId('debug-chalk-stroke')).toHaveCount(0);
  await expect(page.getByTestId('chalk-mode')).toBeHidden();
  // C takes it out; hold the left button and move; release; draw a second stroke.
  await page.keyboard.press('KeyC'); await page.clock.runFor(200);
  await expect(page.getByTestId('chalk-mode')).toBeVisible();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-chalk', 'out');
  await drawWhileMoving(page, [[60, 0], [0, 40], [-60, 0]]);
  await look(page, 0, 120);
  await drawWhileMoving(page, [[0, -40]]);
  await expect(page.getByTestId('debug-chalk-stroke')).toHaveCount(2);
  const left = Number((await page.getByTestId('chalk-left').textContent())!.replace('% chalk', ''));
  expect(left).toBeLessThan(100);
  expect(left).toBeGreaterThan(80);
  // C again puts it away.
  await page.keyboard.press('KeyC'); await page.clock.runFor(200);
  await expect(page.getByTestId('chalk-mode')).toBeHidden();
  await drawWhileMoving(page, [[0, 40]]);
  await expect(page.getByTestId('debug-chalk-stroke')).toHaveCount(2);
  // A forced shift is heard: warnings at both gates, then grinding.
  // The simulation queues them deterministically; headless audio playback timing varies, so
  // require at least one to have actually played.
  const queued = Number(await html(page, 'soundsQueued')), played = Number(await html(page, 'soundsPlayed'));
  await page.keyboard.press('KeyG'); await page.clock.runFor(4000);
  await expect.poll(async () => Number(await html(page, 'soundsQueued'))).toBeGreaterThanOrEqual(queued + 4);
  await expect.poll(async () => Number(await html(page, 'soundsPlayed')), { timeout: 10_000 }).toBeGreaterThan(played);
  // Switch chalk off: C does nothing, the address remembers it, the HUD says so.
  await pause(page);
  await page.locator('[data-rule="chalk"]').uncheck();
  await expect(page).toHaveURL(/[?&]off=chalk(&|$)/);
  await page.getByTestId('mute').check();
  await startRunning(page, 'Resume exploring');
  await page.keyboard.press('KeyC');
  await drawWhileMoving(page, [[50, 0]]);
  await expect(page.getByTestId('chalk-left')).toHaveText('no chalk');
  await expect(page.getByTestId('debug-chalk-stroke')).toHaveCount(2);
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
