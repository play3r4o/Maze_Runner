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

test('leave (automatic countdown starts), take the relic with E, carry it home: extracted, then Retry this seed', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await installBrowserClock(page); await page.goto('/?seed=41');
  await expect(page).toHaveTitle('Shifting Labyrinth · M7b');
  await expect(page.locator('#panel-title')).toHaveText('Bring the relic home.');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await expect(page.getByTestId('run-objective')).toContainText('Leave Sanctuary');
  // Walk north out of the plaza through seed 41's north entrance (column 6): the run clock starts.
  await page.keyboard.down('KeyD'); await page.clock.runFor(4000); await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW'); await page.clock.runFor(8000); await page.keyboard.up('KeyW');
  await page.clock.runFor(200);
  await expect(page.getByTestId('hud-ring')).toHaveText('Inner ring');
  await expect(page.getByTestId('run-objective')).toContainText('Find the relic');
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
  await page.keyboard.press('KeyE'); await page.clock.runFor(300);
  await expect(page.getByTestId('interact-prompt')).toBeHidden();
  await expect(page.getByTestId('run-objective')).toContainText('Relic in hand');
  await expect(page.getByTestId('run-objective')).toHaveAttribute('data-carrying', 'true');
  // Home: teleport to the plaza edge room and step into Sanctuary.
  await pause(page);
  await page.locator(`[data-testid="debug-room"][data-cell-id="${world.maze.start}"]`).click();
  // Extraction happens on the first step after resuming and releases the mouse at once,
  // so wait for the result rather than for pointer lock.
  await clickWithBrowserFrames(page, page.getByRole('button', { name: 'Resume exploring' }));
  await page.clock.runFor(300);
  await expect(page.locator('#panel-title')).toHaveText('Relic secured.');
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
  await installBrowserClock(page); await page.goto('/?seed=41');
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
  await expect(page.locator('#panel-title')).toHaveText('Bring the relic home.');
  expect(errors).toEqual([]);
});
