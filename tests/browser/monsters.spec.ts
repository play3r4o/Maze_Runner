import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { cellPosition, edgeId } from '../../src/simulation/maze';
import { generateMaze } from '../../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun } from '../../src/game/generatedRun';
import type { GeneratedRun } from '../../src/game/generatedRun';
import type { Monster } from '../../src/game/monsters';
import { createRunReport } from '../../src/game/runReport';
import { CROSSBOW_BOLTS } from '../../src/game/tuning';

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
const pos = (id: string) => cellPosition(world.maze.cells.find((cell) => cell.id === id)!, world.maze);
// Two neighbouring cells joined by a static corridor, away from traps, Sanctuary and monsters.
const open = (() => {
  const { maze } = world;
  const busy = new Set([...world.traps.flatMap((trap) => [trap.cell, ...(trap.edge ? trap.edge.split('--') : [])]), ...world.monsters.map((m) => m.at)]);
  for (const a of maze.cells) for (const b of maze.cells) {
    if (b.column !== a.column + 1 || b.row !== a.row || [a, b].some((cell) => maze.rings[cell.id] === 'sanctuary' || busy.has(cell.id))) continue;
    const edge = maze.edges.find((item) => item.id === edgeId(a.id, b.id));
    if (edge && !edge.gate) return { a: a.id, b: b.id };
  }
  throw new Error('no corridor');
})();
// A running expedition with one monster moved (and set up) as given, the player at `at`.
function reportWith(index: number, patch: Partial<Monster>, at: { x: number; z: number; yaw: number }) {
  const base = createGeneratedRun(world);
  const run: GeneratedRun = { ...base, status: 'out', leftSanctuary: true, player: at, cell: null, ring: 'outer',
    monsters: base.monsters.map((monster, i) => (i === index ? { ...monster, ...patch } : monster)) };
  return JSON.stringify(createRunReport(world, run));
}

test('monsters on the map; the crossbow fires limited bolts and one bolt kills a charging skitter', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const skitter = world.monsters.findIndex((monster) => monster.kind === 'skitter');
  const from = pos(open.b), to = pos(open.a);
  const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
  await installBrowserClock(page);
  await page.goto(`/?seed=41&off=traps#repro=${encodeURIComponent(reportWith(skitter, { ...to, at: open.a, path: [], goal: null, wait: 5 }, { ...from, yaw }))}`);
  await expect(page.locator('[data-message]')).toContainText('Gate state matches the report exactly.');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('debug-monster')).toHaveCount(world.monsters.length);
  await expect(page.locator('[data-testid="debug-monster"][data-kind="warden"]')).toHaveCount(1);
  await expect(page.getByTestId('bolts')).toHaveText(`${CROSSBOW_BOLTS} bolts`);
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await page.mouse.down(); await page.mouse.up();
  await page.clock.runFor(1000);
  await expect(page.getByTestId('bolts')).toHaveText(`${CROSSBOW_BOLTS - 1} bolts`);
  const list = await events(page);
  await expect(list).toContainText('shot: bolt 1 fired');
  await expect(list).toContainText(`m${skitter + 1} skitter killed by bolt`);
  await expect(page.locator(`[data-testid="debug-monster"][data-kind="skitter"][data-mode="dead"]`)).toHaveCount(1);
  await expect(page.getByTestId('health')).toHaveText('100');
  // Chalk out: the left button draws instead of firing.
  await startRunning(page, 'Resume exploring');
  await page.keyboard.press('KeyC');
  await page.mouse.down(); await page.clock.runFor(300); await page.mouse.up();
  await page.clock.runFor(1000);
  await expect(page.getByTestId('bolts')).toHaveText(`${CROSSBOW_BOLTS - 1} bolts`);
  expect(errors).toEqual([]);
});

test('the warden falls into a pit it walks over and the notice shows', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const warden = world.monsters.findIndex((monster) => monster.kind === 'warden');
  const pit = world.traps.find((trap) => trap.kind === 'pit')!;
  const centre = { x: (pit.plate!.minX + pit.plate!.maxX) / 2, z: (pit.plate!.minZ + pit.plate!.maxZ) / 2 };
  await installBrowserClock(page);
  await page.goto(`/?seed=41#repro=${encodeURIComponent(reportWith(warden, { ...centre, at: pit.cell, mode: 'investigate', path: [], goal: null, wait: 10 },
    { x: world.relic.x, z: world.relic.z, yaw: 0 }))}`);
  await expect(page.locator('[data-message]')).toContainText('Gate state matches the report exactly.');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await page.clock.runFor(1500);
  await expect(page.getByTestId('shift-notice')).toHaveText('The Warden has fallen. It will return.');
  const list = await events(page);
  await expect(list).toContainText(`triggered by m${warden + 1}`);
  await expect(list).toContainText(`m${warden + 1} warden killed by pit; it will return`);
  await expect(page.locator('[data-testid="debug-monster"][data-kind="warden"]')).toHaveAttribute('data-mode', 'dead');
  expect(errors).toEqual([]);
});
