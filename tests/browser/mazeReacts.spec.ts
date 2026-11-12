import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { cellPosition, findCell } from '../../src/simulation/maze';
import { generateMaze } from '../../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun, requestGeneratedRunShift, stepGeneratedRun } from '../../src/game/generatedRun';
import type { GeneratedRun } from '../../src/game/generatedRun';
import { ALL_RULES_ON } from '../../src/game/pressure';
import { createRunReport } from '../../src/game/runReport';

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
async function events(page: Page) {
  await page.keyboard.press('Escape'); await page.clock.runFor(200);
  const details = page.locator('.debug-events');
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) await page.locator('.debug-events summary').click();
  await page.clock.runFor(200);
  return page.getByTestId('debug-events');
}
const world = buildGeneratedWorld(generateMaze(41));
const SAFE = { ...ALL_RULES_ON, traps: false, monsters: false };

test('T lays thread from the free spool; F jams a closing gate with the last item taken', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  // A report half a second into a closing phase, the player in the room beside the closing gate.
  let run: GeneratedRun = requestGeneratedRunShift(world, { ...createGeneratedRun(world, SAFE, { starterKit: true }), status: 'out', leftSanctuary: true,
    bag: [{ uid: 'r1.spool', item: 'threadSpool', x: 0, y: 0, rotated: false }, { uid: 't.ruby', item: 'ruby', x: 1, y: 0, rotated: false }] });
  const gate = run.shift.plan!.close;
  const edge = world.maze.edges.find((item) => item.gate === gate)!;
  run = { ...run, player: { ...cellPosition(findCell(world.maze, edge.a), world.maze), yaw: 0 }, frozen: false };
  while (run.shift.phase !== 'closing') run = stepGeneratedRun(world, run, { forward: 0, strafe: 0 }, 0, 1 / 60);
  for (let i = 0; i < 30; i++) run = stepGeneratedRun(world, run, { forward: 0, strafe: 0 }, 0, 1 / 60);
  await installBrowserClock(page);
  await page.goto(`/?seed=41&off=traps,monsters#repro=${encodeURIComponent(JSON.stringify(createRunReport(world, run)))}`);
  await expect(page.locator('[data-message]')).toContainText('Gate state matches the report exactly.');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await expect(page.getByTestId('jam-prompt')).toBeVisible();
  await expect(page.getByTestId('jam-prompt')).toContainText(`Jam gate ${gate.toUpperCase()} with your Ruby`);
  await page.keyboard.press('KeyF'); await page.clock.runFor(300);
  await expect(page.getByTestId('jam-prompt')).toBeHidden();
  await expect(page.getByTestId('bag-summary')).toContainText('bag 1 item');
  // Thread: T, walk, T.
  await expect(page.getByTestId('thread-status')).toContainText('thread 150 m');
  await page.keyboard.press('KeyT');
  await page.keyboard.down('KeyS'); await page.clock.runFor(1500); await page.keyboard.up('KeyS');
  await page.keyboard.press('KeyT'); await page.clock.runFor(200);
  await expect(page.getByTestId('thread-status')).not.toContainText('laying');
  await expect(page.getByTestId('thread-status')).not.toContainText('150 m');
  await expect(page.getByTestId('debug-thread-strand')).toHaveCount(1);
  const list = await events(page);
  await expect(list).toContainText(`${gate.toUpperCase()} jammed with Ruby for 6s`);
  await expect(list).toContainText('thread started (150 m left)');
  expect(errors).toEqual([]);
});

test('dying leaves a cairn that the next run of the same seed shows', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await installBrowserClock(page);
  await page.goto('/?seed=41&off=monsters');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('debug-cairn')).toHaveCount(0);
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  const pit = world.traps.find((trap) => trap.kind === 'pit')!;
  await page.keyboard.press('Escape'); await page.clock.runFor(200);
  await page.locator(`[data-testid="debug-room"][data-cell-id="${pit.cell}"]`).click();
  await startRunning(page, 'Resume exploring');
  await page.clock.runFor(1500);
  await expect(page.locator('#panel-title')).toHaveText('You died.');
  await page.clock.resume();
  await page.goto('/?seed=41&off=monsters&visit=2');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('debug-cairn')).toHaveCount(1);
  const cairn = page.getByTestId('debug-cairn');
  const pitCentre = { x: (pit.zone.minX + pit.zone.maxX) / 2, z: (pit.zone.minZ + pit.zone.maxZ) / 2 };
  expect(Math.abs(Number(await cairn.getAttribute('cx')) - pitCentre.x)).toBeLessThan(1.5);
  expect(Math.abs(Number(await cairn.getAttribute('cy')) - pitCentre.z)).toBeLessThan(1.5);
  // Another seed has no cairn.
  await page.goto('/?seed=42&off=monsters');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('debug-cairn')).toHaveCount(0);
  expect(errors).toEqual([]);
});
