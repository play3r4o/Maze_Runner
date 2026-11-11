import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function start(page: Page) {
  await installBrowserClock(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find your way home.' })).toBeVisible();
  await expect(page.getByText('DEVELOPMENT BUILD / M3 · GRAPH DIAGNOSTICS')).toBeVisible();
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await freezeBrowserClock(page);
}
async function position(page: Page) {
  return page.evaluate(() => ({ x: Number(document.querySelector('[data-testid="position-x"]')!.textContent),
    z: Number(document.querySelector('[data-testid="position-z"]')!.textContent) }));
}
async function walk(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  try { await page.clock.runFor(ms); } finally { await page.keyboard.up(key); }
  await page.clock.runFor(120);
}
async function centerNorthRoom(page: Page) {
  // The 1.7 m retreat is not an integer number of RAF intervals. Finish its
  // last fixed tick with real keyboard nudges; never set simulation state.
  for (let i = 0; i < 6; i++) {
    const z = (await position(page)).z;
    if (Math.abs(z + 12) < 0.01) break;
    await walk(page, z > -12 ? 'KeyW' : 'KeyS', 16);
  }
  expect((await position(page)).z).toBeCloseTo(-12, 2);
}
test('visit three landmarks, close the old shortcut, take a detour and return home', async ({ page }) => {
  // This is a full walk at ordinary game speed, executing every fixed tick.
  // A supported smaller viewport limits software-WebGL cost on CI runners.
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 960, height: 640 });
  const errors = watchErrors(page); await start(page);
  await expect(page).toHaveTitle('Shifting Labyrinth · M3');
  await expect(page.getByTestId('return-status')).toHaveAttribute('data-complete', 'false');
  await walk(page, 'KeyW', 8000);
  expect((await position(page)).z).toBeCloseTo(-24, 1);
  await expect(page.getByTestId('visit-amber')).toHaveText('FOUND');
  await expect(page.getByTestId('visit-blue')).toHaveText('—');
  await page.keyboard.press('KeyG'); await page.clock.runFor(200);
  await expect(page.getByTestId('shift-phase')).toHaveAttribute('data-phase', 'warning');
  await page.clock.runFor(10800);
  await expect(page.getByTestId('gate-north')).toHaveText('CLOSED');
  await expect(page.getByTestId('gate-east')).toHaveText('OPEN');
  await walk(page, 'KeyS', 5000);
  expect((await position(page)).z).toBeCloseTo(-10.3, 1);
  await walk(page, 'KeyW', 567);
  await centerNorthRoom(page);
  await walk(page, 'KeyA', 4000); await walk(page, 'KeyS', 4000); await walk(page, 'KeyD', 4000);
  const home = await position(page); expect(home.x).toBeCloseTo(0, 1); expect(home.z).toBeCloseTo(0, 1);
  await expect(page.getByTestId('return-status')).toHaveAttribute('data-complete', 'false');
  await walk(page, 'KeyD', 8000); await expect(page.getByTestId('visit-blue')).toHaveText('FOUND');
  await walk(page, 'KeyA', 16000); await walk(page, 'KeyS', 8000);
  await expect(page.getByTestId('visit-rose')).toHaveText('FOUND');
  await expect(page.getByTestId('return-status')).toContainText('return to Sanctuary');
  await walk(page, 'KeyD', 8000); await walk(page, 'KeyW', 8000);
  await expect(page.getByTestId('return-status')).toHaveAttribute('data-complete', 'true');
  await expect(page.getByTestId('return-status')).toContainText('Returned to Sanctuary');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  expect(errors).toEqual([]);
});
test('maze pushing pauses, resumes, crushes and Retry clears navigation and gates', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page); await start(page);
  await walk(page, 'KeyW', 1500); await page.keyboard.press('KeyG'); await page.clock.runFor(5600);
  await expect(page.getByTestId('shift-phase')).toHaveText('Being pushed · escape');
  const pushed = await position(page); expect(pushed.x).toBeLessThan(-0.25);
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await page.keyboard.press('Escape'); await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'paused');
  await page.clock.runFor(120); const frozen = await position(page);
  await page.keyboard.press('KeyG'); await page.clock.runFor(2000);
  expect(await position(page)).toEqual(frozen);
  await page.getByRole('button', { name: 'Resume exploring' }).click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await page.clock.runFor(1800);
  await expect(page.getByRole('heading', { name: 'Crushed.', exact: true })).toBeVisible();
  expect((await position(page)).x).toBeCloseTo(-1.7, 2);
  await page.clock.runFor(4000); await expect(page.getByTestId('gate-north')).toHaveText('CLOSED');
  await page.keyboard.press('F2'); await page.clock.runFor(120);
  await expect(page.getByTestId('debug-revision')).toHaveText('2');
  await page.getByRole('button', { name: 'Probe isolation' }).click();
  await expect(page.getByTestId('debug-probe-result')).toHaveAttribute('data-result', 'rejected');
  // Keep frames available for the native click's actionability checks after
  // the debug panel changes, while retaining the original test deadline.
  await clickWithBrowserFrames(page, page.getByRole('button', { name: 'Retry', exact: true }));
  await page.clock.runFor(120);
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  expect(await position(page)).toEqual({ x: 0, z: 0 });
  await expect(page.getByTestId('gate-north')).toHaveText('OPEN');
  await expect(page.getByTestId('shift-count')).toHaveText('0 shifts');
  await expect(page.getByTestId('debug-revision')).toHaveText('0');
  await expect(page.getByTestId('debug-probe-result')).not.toHaveAttribute('data-result', 'rejected');
  for (const id of ['amber', 'blue', 'rose']) await expect(page.getByTestId(`visit-${id}`)).toHaveText('—');
  await expect(page.getByTestId('return-status')).toHaveAttribute('data-complete', 'false');
  await walk(page, 'KeyA', 300); expect((await position(page)).x).toBeLessThan(-0.5);
  expect(errors).toEqual([]);
});
