import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freezeBrowserClock, installBrowserClock } from './clock';

// Long walks and the new four-second closing animation execute every frame.
test.setTimeout(90_000);

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function start(page: Page) {
  await installBrowserClock(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The walls can move.' })).toBeVisible();
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await freezeBrowserClock(page);
}

async function position(page: Page) {
  return page.evaluate(() => ({
    x: Number(document.querySelector('[data-testid="position-x"]')!.textContent),
    z: Number(document.querySelector('[data-testid="position-z"]')!.textContent),
  }));
}

async function walk(page: Page, key: string, milliseconds: number) {
  await page.keyboard.down(key);
  try { await page.clock.runFor(milliseconds); }
  finally { await page.keyboard.up(key); }
  await page.clock.runFor(120);
}

test('warned shift opens a blocked long passage and closes the old routes', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await expect(page.getByTestId('gate-east')).toHaveText('CLOSED');
  await walk(page, 'KeyD', 2000);
  expect((await position(page)).x).toBeCloseTo(5.7, 1);
  await page.keyboard.press('KeyG');
  // Advance beyond one complete 10 Hz HUD sampling interval.
  await page.clock.runFor(200);
  await expect(page.getByTestId('shift-phase')).toHaveAttribute('data-phase', 'warning');
  await expect(page.getByTestId('gate-east')).toHaveText('CLOSED');
  await page.keyboard.press('KeyG');
  await page.clock.runFor(200);
  await expect(page.getByTestId('shift-notice')).toContainText('already in progress');
  await page.clock.runFor(7300);
  await expect(page.getByTestId('shift-layout')).toHaveText('East / west arrangement');
  await expect(page.getByTestId('gate-north')).toHaveText('CLOSED');
  await expect(page.getByTestId('gate-east')).toHaveText('OPEN');
  await expect(page.getByTestId('shift-count')).toHaveText('1 shift');
  await walk(page, 'KeyD', 500);
  expect((await position(page)).x).toBeGreaterThan(7);
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  expect(errors).toEqual([]);
});

test('closing stone kills, keeps moving after death, and Retry resets the attempt', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await start(page);
  await walk(page, 'KeyW', 2700);
  const stopped = await position(page);
  expect(stopped.z).toBeLessThan(-8);
  expect(stopped.z).toBeGreaterThan(-14);
  await page.keyboard.press('KeyG');
  await page.clock.runFor(3500);
  await expect(page.getByTestId('shift-phase')).toHaveAttribute('data-phase', 'closing');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await page.clock.runFor(2100);
  await expect(page.getByRole('heading', { name: 'Crushed.' })).toBeVisible();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'dead');
  await expect(page.getByText(/The NORTH gate caught you/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await testInfo.attach('crushed', { body: await page.screenshot(), contentType: 'image/png' });
  await page.keyboard.press('KeyG');
  await walk(page, 'KeyW', 2000);
  await expect(page.getByTestId('gate-north')).toHaveText('CLOSED');
  await expect(page.getByTestId('shift-count')).toHaveText('1 shift');
  expect(await position(page)).toEqual(stopped);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await page.clock.runFor(120);
  expect(await position(page)).toEqual({ x: 0, z: 0 });
  await expect(page.getByTestId('gate-north')).toHaveText('OPEN');
  await expect(page.getByTestId('gate-east')).toHaveText('CLOSED');
  await expect(page.getByTestId('shift-count')).toHaveText('0 shifts');
  await walk(page, 'KeyD', 200);
  expect((await position(page)).x).toBeGreaterThan(0.25);
  expect(errors).toEqual([]);
});

test('retreating out of the long danger zone before contact survives the closing', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await walk(page, 'KeyW', 2700);
  await page.keyboard.press('KeyG');
  await page.clock.runFor(3500);
  await walk(page, 'KeyS', 1100);
  expect((await position(page)).z).toBeGreaterThan(-5.7);
  await page.clock.runFor(3200);
  await expect(page.getByTestId('gate-north')).toHaveText('CLOSED');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await expect(page.getByRole('heading', { name: 'Crushed.' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('pause freezes warning time and ignores G until resumed', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await page.keyboard.press('KeyG');
  await page.clock.runFor(200);
  await expect(page.getByTestId('shift-phase')).toHaveAttribute('data-phase', 'warning');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'paused');
  await page.clock.runFor(120);
  const frozen = await page.getByTestId('shift-phase').textContent();
  await page.keyboard.press('KeyG');
  await page.clock.runFor(2000);
  expect(await page.getByTestId('shift-phase').textContent()).toBe(frozen);
  await page.getByRole('button', { name: 'Resume exploring' }).click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await page.clock.runFor(8000);
  await expect(page.getByTestId('shift-layout')).toHaveText('East / west arrangement');
  await expect(page.getByTestId('shift-count')).toHaveText('1 shift');
  expect(errors).toEqual([]);
});
