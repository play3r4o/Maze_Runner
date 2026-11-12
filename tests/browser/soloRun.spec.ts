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
async function startRunning(page: Page, name: string) {
  await clickWithBrowserFrames(page, page.getByRole('button', { name }));
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
}
async function pause(page: Page) {
  await page.keyboard.press('Escape'); await page.clock.runFor(200);
}
const world = buildGeneratedWorld(generateMaze(41));

test('leave (automatic countdown starts), loot the relic from its reliquary, come home: extracted with it, then Retry this seed', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await installBrowserClock(page); await page.goto('/?seed=41&off=monsters');
  await expect(page).toHaveTitle('Shifting Labyrinth · M8');
  await expect(page.locator('#panel-title')).toHaveText('Loot the maze. Get out alive.');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await expect(page.getByTestId('run-objective')).toContainText('Leave Sanctuary');
  // Walk north out of the plaza through seed 41's north entrance (column 6): the run clock starts.
  await page.keyboard.down('KeyD'); await page.clock.runFor(4000); await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW'); await page.clock.runFor(8000); await page.keyboard.up('KeyW');
  await page.clock.runFor(200);
  await expect(page.getByTestId('hud-ring')).toHaveText('Inner ring');
  await expect(page.getByTestId('run-objective')).toContainText('Loot chests');
  // The automatic countdown runs once the expedition starts (its exact 45 s timing is unit-tested;
  // simulating 45 s here would render ~2 700 frames in software).
  await expect(page.getByTestId('shift-phase')).toHaveText('Maze still');
  await expect(page.getByTestId('debug-run')).toContainText('Run out');
  const remaining = async () => Number(/auto shift in ([\d.]+)s/.exec((await page.getByTestId('debug-run').textContent())!)![1]);
  const first = await remaining();
  expect(first).toBeLessThan(45);
  await page.clock.runFor(1000);
  expect(await remaining()).toBeLessThan(first - 0.5);

  // Debug teleport to the relic room (walking the whole way is covered by unit tests).
  await pause(page);
  await page.locator('.debug-events summary').click(); await page.clock.runFor(200);
  await expect(page.getByTestId('debug-events')).toContainText('run: started: left Sanctuary');
  await page.locator(`[data-testid="debug-room"][data-cell-id="${world.relic.cell}"]`).click();
  await startRunning(page, 'Resume exploring');
  await page.clock.runFor(300);
  await expect(page.getByTestId('interact-prompt')).toBeVisible();
  await expect(page.getByTestId('interact-target')).toHaveText('reliquary');
  // E opens the reliquary: the loot screen shows it beside the bag; the maze keeps running.
  await page.keyboard.press('KeyE'); await page.clock.runFor(300);
  await expect(page.getByTestId('inventory')).toBeVisible();
  await expect(page.getByTestId('inventory-left-title')).toHaveText('Reliquary');
  const clockBefore = await page.getByTestId('debug-run').textContent();
  await page.clock.runFor(1000);
  expect(await page.getByTestId('debug-run').textContent()).not.toBe(clockBefore);
  // Right-click sends the relic to the bag; Tab closes and takes the mouse again.
  await page.locator('[data-testid="inv-item"][data-item="heartOfMaze"]').click({ button: 'right' });
  await page.clock.runFor(200);
  await expect(page.locator('[data-testid="grid-bag"] [data-item="heartOfMaze"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await page.clock.runFor(300);
  await expect(page.getByTestId('inventory')).toBeHidden();
  await expect(page.getByTestId('run-objective')).toContainText('Heart of the Maze is in your bag');
  await expect(page.getByTestId('run-objective')).toHaveAttribute('data-carrying', 'true');
  // Home: teleport to the plaza edge room and step into Sanctuary.
  await pause(page);
  await page.locator(`[data-testid="debug-room"][data-cell-id="${world.maze.start}"]`).click();
  // Extraction happens on the first step after resuming and releases the mouse at once,
  // so wait for the result rather than for pointer lock.
  await clickWithBrowserFrames(page, page.getByRole('button', { name: 'Resume exploring' }));
  await page.clock.runFor(300);
  await expect(page.locator('#panel-title')).toHaveText('The Heart is yours.');
  await expect(page.locator('.panel-description')).toContainText('carrying 1 item worth 400 gold');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-result', 'extracted');
  await expect(page.locator('.panel-description')).toContainText('through 0 shifts');
  await expect(page.locator('.panel-description')).toContainText('Debug teleports used: 2');
  await expect(page.getByRole('button', { name: 'New run' })).toBeVisible();
  // Retry this seed: same maze, fresh run.
  await startRunning(page, 'Retry this seed');
  await page.clock.runFor(300);
  await expect(page.getByTestId('run-objective')).toContainText('Leave Sanctuary');
  await expect(page.getByTestId('run-time')).toHaveText('0:00');
  await expect(page.getByTestId('shift-count')).toHaveText('0 shifts');
  expect(new URL(page.url()).searchParams.get('seed')).toBe('41');
  expect(errors).toEqual([]);
});

test('abandon ends the run with nothing secured; New run loads a different seed', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await installBrowserClock(page); await page.goto('/?seed=41&off=monsters');
  // Abandon is not offered before the first start.
  await expect(page.getByRole('button', { name: 'Abandon run' })).toBeHidden();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await page.keyboard.down('KeyW'); await page.clock.runFor(1500); await page.keyboard.up('KeyW');
  await pause(page);
  await page.getByRole('button', { name: 'Abandon run' }).click();
  await expect(page.locator('#panel-title')).toHaveText('Run abandoned.');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-result', 'abandoned');
  await expect(page.locator('.panel-description')).toContainText('Nothing was secured.');
  await expect(page.getByRole('button', { name: 'Abandon run' })).toBeHidden();
  await page.getByRole('button', { name: 'New run' }).click();
  await page.waitForURL((url) => url.searchParams.get('seed') !== '41');
  await expect(page.locator('#panel-title')).toHaveText('Loot the maze. Get out alive.');
  expect(errors).toEqual([]);
});
