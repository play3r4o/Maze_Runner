import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { generateMaze } from '../../src/simulation/mazeGenerator';
import { buildGeneratedWorld } from '../../src/game/generatedRun';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const world = buildGeneratedWorld(generateMaze(41));
const spikes = world.traps.filter((trap) => trap.kind === 'floorSpikes');
const pit = world.traps.find((trap) => trap.kind === 'pit')!;
// Teleport (debug) onto a room trap's plate, then resume.
async function standOn(page: Page, cell: string, name: string) {
  await page.locator(`[data-testid="debug-room"][data-cell-id="${cell}"]`).click();
  await clickWithBrowserFrames(page, page.getByRole('button', { name }));
}

test('traps on the map; a plate fires spikes and costs health; switched off they are harmless; a pit kills', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await installBrowserClock(page); await page.goto('/?seed=41&off=monsters');
  await expect(page).toHaveTitle('Shifting Labyrinth · M16');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('debug-trap')).toHaveCount(world.traps.length);
  await expect(page.getByTestId('health')).toHaveText('100');
  await standOn(page, spikes[0].cell, 'Start exploring');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await freezeBrowserClock(page);
  await page.clock.runFor(1500);
  await expect(page.getByTestId('health')).toHaveText('55');
  await page.keyboard.press('Escape'); await page.clock.runFor(200);
  await page.locator('.debug-events summary').click(); await page.clock.runFor(200);
  await expect(page.getByTestId('debug-events')).toContainText(`trap: floorSpikes ${spikes[0].id} triggered by player`);
  await expect(page.getByTestId('debug-events')).toContainText('hurt: floorSpikes -45 (55 left)');
  // Traps off: another spike room does nothing.
  await page.locator('[data-rule="traps"]').uncheck();
  await standOn(page, spikes[1].cell, 'Resume exploring');
  await page.clock.runFor(2000);
  await expect(page.getByTestId('health')).toHaveText('55');
  await page.keyboard.press('Escape'); await page.clock.runFor(200);
  await page.locator('[data-rule="traps"]').check();
  // A pit: standing still on its plate means falling.
  await standOn(page, pit.cell, 'Resume exploring');
  await page.clock.runFor(1500);
  await expect(page.locator('#panel-title')).toHaveText('You died.');
  await expect(page.locator('.panel-description')).toContainText('The floor opened and you fell');
  expect(errors).toEqual([]);
});
