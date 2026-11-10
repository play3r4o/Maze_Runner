import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// These scenarios include warnings, motion, obstruction recovery and cooldown.
// Allow time for those deliberate phases on software-rendered CI browsers.
test.setTimeout(60_000);

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

async function start(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The walls can move.' })).toBeVisible();
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
}

async function position(page: Page, axis: 'x' | 'z') {
  return Number(await page.getByTestId(`position-${axis}`).textContent());
}

test('warned shift opens a previously blocked corridor and closes the old routes', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await expect(page.getByTestId('gate-east')).toHaveText('CLOSED');
  await expect(page.getByTestId('gate-north')).toHaveText('OPEN');
  await page.keyboard.down('KeyD');
  await expect.poll(() => position(page, 'x'), { timeout: 15_000 }).toBeCloseTo(3.45, 1);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('shift-phase')).toHaveAttribute('data-phase', 'warning');
  await expect(page.getByTestId('gate-east')).toHaveText('CLOSED');
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('shift-notice')).toContainText('already in progress');
  await expect(page.getByTestId('shift-layout')).toHaveText('East / west arrangement', { timeout: 20_000 });
  await expect(page.getByTestId('gate-north')).toHaveText('CLOSED');
  await expect(page.getByTestId('gate-east')).toHaveText('OPEN');
  await expect(page.getByTestId('shift-count')).toHaveText('1 shift');
  await page.keyboard.down('KeyD');
  await expect.poll(() => position(page, 'x'), { timeout: 10_000 }).toBeGreaterThan(5);
  await page.keyboard.up('KeyD');
  expect(errors).toEqual([]);
});

test('occupied closing area holds then cancels to safe all-open recovery', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await start(page);
  await page.keyboard.down('KeyW');
  await expect.poll(() => position(page, 'z'), { intervals: [50], timeout: 15_000 }).toBeLessThan(-3.8);
  await page.keyboard.up('KeyW');
  // Position diagnostics sample at 10 Hz; capture the post-keyup sample.
  await page.waitForTimeout(150);
  const stopped = await position(page, 'z');
  expect(stopped).toBeGreaterThan(-4.7);
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('shift-notice')).toContainText('Closing held: NORTH', { timeout: 20_000 });
  await expect(page.getByTestId('gate-north')).toHaveText('HELD');
  await testInfo.attach('gate-held', { body: await page.screenshot(), contentType: 'image/png' });
  await expect(page.getByTestId('shift-layout')).toHaveText('All routes open · safe recovery', { timeout: 15_000 });
  for (const id of ['north', 'east', 'south', 'west']) await expect(page.getByTestId(`gate-${id}`)).toHaveText('OPEN');
  await expect(page.getByTestId('shift-notice')).toContainText('Shift cancelled');
  await expect(page.getByTestId('shift-count')).toHaveText('0 shifts');
  expect(await position(page, 'z')).toBe(stopped);
  await page.keyboard.down('KeyW');
  await expect.poll(() => position(page, 'z')).toBeLessThan(-5);
  await page.keyboard.up('KeyW');
  expect(errors).toEqual([]);
});

test('pause freezes shift time and ignores shift presses until resumed', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await page.keyboard.press('KeyG');
  await expect(page.getByTestId('shift-phase')).toHaveAttribute('data-phase', 'warning');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'paused');
  // Settle the throttled HUD after the last simulation tick, then compare it.
  await page.waitForTimeout(150);
  const frozen = await page.getByTestId('shift-phase').textContent();
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(300);
  expect(await page.getByTestId('shift-phase').textContent()).toBe(frozen);
  await page.getByRole('button', { name: 'Resume exploring' }).click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await page.waitForTimeout(200);
  await expect(page.getByTestId('shift-notice')).not.toContainText('ignored');
  await expect(page.getByTestId('shift-layout')).toHaveText('East / west arrangement', { timeout: 20_000 });
  await expect(page.getByTestId('shift-count')).toHaveText('1 shift');
  expect(errors).toEqual([]);
});
