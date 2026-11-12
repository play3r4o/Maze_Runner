import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { generateMaze } from '../../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun } from '../../src/game/generatedRun';
import type { GeneratedRun } from '../../src/game/generatedRun';
import { ALL_RULES_ON } from '../../src/game/pressure';
import { createRunReport } from '../../src/game/runReport';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const world = buildGeneratedWorld(generateMaze(41));

test('number keys bandage, drink and light a torch; the belt and progress bar follow', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const run: GeneratedRun = { ...createGeneratedRun(world, { ...ALL_RULES_ON, traps: false, monsters: false }), status: 'out', leftSanctuary: true, health: 40,
    player: { x: world.relic.x, z: world.relic.z, yaw: 0 },
    bag: [{ uid: 'b', item: 'bandage', x: 0, y: 0, rotated: false }, { uid: 'p', item: 'healingPotion', x: 1, y: 0, rotated: false }, { uid: 't', item: 'torch', x: 2, y: 0, rotated: false }] };
  await installBrowserClock(page);
  await page.goto(`/?seed=41&off=traps,monsters#repro=${encodeURIComponent(JSON.stringify(createRunReport(world, run)))}`);
  await clickWithBrowserFrames(page, page.getByRole('button', { name: 'Start exploring' }));
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await freezeBrowserClock(page);
  await expect(page.getByTestId('belt')).toHaveText('1 Bandage ×1 · 2 Potion ×1 · 3 Torch ×1');
  await page.keyboard.press('Digit1'); await page.clock.runFor(1000);
  await expect(page.getByTestId('use-progress')).toBeVisible();
  await expect(page.getByTestId('use-label')).toHaveText('Bandaging…');
  await page.clock.runFor(2500);
  await expect(page.getByTestId('use-progress')).toBeHidden();
  await expect(page.getByTestId('health')).toHaveText('75');
  await page.keyboard.press('Digit2'); await page.clock.runFor(6500);
  await expect(page.getByTestId('health')).toHaveText('100');
  await page.keyboard.press('Digit3'); await page.clock.runFor(1000);
  await expect(page.getByTestId('belt')).toHaveText(/1 Bandage ×0 · 2 Potion ×0 · 3 Torch ×0 \(lit 1(19|20)s\)/);
  expect(errors).toEqual([]);
});
