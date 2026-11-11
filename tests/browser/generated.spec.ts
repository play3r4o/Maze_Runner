import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock } from './clock';
import { generateMaze, layoutFingerprint } from '../../src/simulation/mazeGenerator';
import { CELL_SPACING, findCell } from '../../src/simulation/maze';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const fingerprint = (page: Page) => page.evaluate(() => document.documentElement.dataset.mazeFingerprint);
const position = (page: Page) => page.evaluate(() => ({ x: Number(document.querySelector('[data-testid="position-x"]')!.textContent),
  z: Number(document.querySelector('[data-testid="position-z"]')!.textContent) }));
async function walk(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  try { await page.clock.runFor(ms); } finally { await page.keyboard.up(key); }
  await page.clock.runFor(120);
}

test('a seed rebuilds the same maze; other seeds, reloads and the seed form behave', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?seed=1');
  await expect(page).toHaveTitle('Shifting Labyrinth · M7');
  await expect(page.getByText('DEVELOPMENT BUILD / M7 · SOLO EXTRACTION')).toBeVisible();
  await expect(page.getByTestId('hud-seed')).toHaveText('seed 1');
  expect(await fingerprint(page)).toBe(layoutFingerprint(generateMaze(1)));
  await page.reload();
  expect(await fingerprint(page)).toBe(layoutFingerprint(generateMaze(1)));
  await page.goto('/?seed=2');
  expect(await fingerprint(page)).toBe(layoutFingerprint(generateMaze(2)));
  expect(layoutFingerprint(generateMaze(2))).not.toBe(layoutFingerprint(generateMaze(1)));

  // No seed: one is chosen and written into the address so the URL reproduces it.
  await page.goto('/');
  await expect(page).toHaveURL(/[?&]seed=\d+/);
  const chosen = Number(new URL(page.url()).searchParams.get('seed'));
  expect(await fingerprint(page)).toBe(layoutFingerprint(generateMaze(chosen)));
  // Invalid seeds are reported and replaced, never coerced.
  await page.goto('/?seed=abc');
  await expect(page.locator('[data-message]')).toContainText('Seed “abc” is not a whole number');
  await expect(page).toHaveURL(/[?&]seed=\d+/);

  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await page.getByTestId('seed-input').fill('12x');
  await page.getByRole('button', { name: 'Load seed' }).click();
  await expect(page.getByTestId('seed-error')).toContainText('whole number');
  await page.getByTestId('seed-input').fill('777');
  await page.getByRole('button', { name: 'Load seed' }).click();
  await expect(page).toHaveURL(/[?&]seed=777(&|$)/);
  expect(await fingerprint(page)).toBe(layoutFingerprint(generateMaze(777)));
  await expect(page.getByTestId('hud-seed')).toHaveText('seed 777');
  expect(errors).toEqual([]);
});

test('debug map shows the generated graph, rings, gates and a rejected entrance probe; walking leaves Sanctuary', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = watchErrors(page);
  const maze = generateMaze(1);
  await installBrowserClock(page); await page.goto('/?seed=1');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('maze-debug')).toBeVisible();
  await expect(page.getByTestId('debug-room')).toHaveCount(121);
  await expect(page.locator('[data-edge-id]')).toHaveCount(maze.edges.length);
  for (const [ring, count] of [['sanctuary', 9], ['inner', 40], ['middle', 32], ['outer', 40]] as const) {
    await expect(page.locator(`[data-testid="debug-room"][data-ring="${ring}"]`)).toHaveCount(count);
  }
  await expect(page.getByTestId('debug-seed')).toHaveText('1');
  await expect(page.getByTestId('debug-fingerprint')).toHaveText(layoutFingerprint(maze));
  await expect(page.locator('[data-testid^="debug-gate-"]')).toHaveCount(8);

  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await freezeBrowserClock(page);
  await page.keyboard.press('KeyV'); await page.clock.runFor(200);
  await expect(page.getByTestId('debug-probe-result')).toHaveAttribute('data-result', 'rejected');
  await expect(page.getByTestId('debug-probe-result')).toContainText('112/121 cells lose a route');
  await expect(page.getByTestId('hud-ring')).toHaveText('Sanctuary');

  // Walk out through the seeded north entrance using real keyboard input.
  const entrance = maze.edges.find((edge) => edge.id === maze.entrances[0])!;
  const outside = findCell(maze, maze.rings[entrance.a] === 'sanctuary' ? entrance.b : entrance.a);
  const targetX = (outside.column - 5) * CELL_SPACING;
  if (targetX !== 0) await walk(page, targetX > 0 ? 'KeyD' : 'KeyA', Math.abs(targetX) / 3 * 1000);
  await walk(page, 'KeyW', 8000);
  const { x, z } = await position(page);
  expect(x).toBeCloseTo(targetX, 0);
  expect(z).toBeLessThan(-22);
  await expect(page.getByTestId('hud-ring')).toHaveText('Inner ring');
  await expect(page.getByTestId('debug-location')).toContainText(`${outside.id} · inner ring`);
  await expect(page.getByTestId('debug-route')).toContainText('connections home');
  expect(errors).toEqual([]);
});

test('G runs a validated seeded shift: warning, opening, closing, revisions and the shift log', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const maze = generateMaze(1);
  await installBrowserClock(page); await page.goto('/?seed=1');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await freezeBrowserClock(page);
  await expect(page.getByTestId('shift-phase')).toHaveText('Maze still');
  await page.keyboard.press('KeyG'); await page.clock.runFor(200);
  await expect(page.getByTestId('shift-phase')).toHaveAttribute('data-phase', 'warning');
  await expect(page.getByTestId('debug-phase')).toHaveText('warning');
  await expect(page.getByTestId('debug-shift-log')).toContainText('#1 rev 0 ACCEPTED');
  const entry = await page.getByTestId('debug-shift-log').locator('li').first().textContent();
  const [, opening, closing] = /· (G\d) opens, (G\d) closes/.exec(entry!)!;
  expect(maze.initialOpenness[opening.toLowerCase()]).toBe(0);
  expect(maze.initialOpenness[closing.toLowerCase()]).toBe(1);
  await expect(page.getByTestId(`debug-gate-${closing.toLowerCase()}`)).toHaveAttribute('data-status', 'warning');
  // A second G while busy is ignored and logged.
  await page.keyboard.press('KeyG'); await page.clock.runFor(200);
  await expect(page.getByTestId('debug-shift-log')).toContainText('IGNORED');
  await page.clock.runFor(3500);
  await expect(page.getByTestId('debug-revision')).toHaveText('2');
  await expect(page.getByTestId(`debug-gate-${opening.toLowerCase()}`)).toHaveAttribute('data-status', 'open');
  await expect(page.getByTestId(`debug-gate-${closing.toLowerCase()}`)).toHaveAttribute('data-status', 'closing');
  await page.clock.runFor(7000);
  await expect(page.getByTestId('shift-count')).toHaveText('1 shift');
  await expect(page.getByTestId('shift-phase')).toHaveText('Maze still');
  await expect(page.getByTestId(`debug-gate-${closing.toLowerCase()}`)).toHaveAttribute('data-status', 'closed');
  await expect(page.getByTestId('debug-revision')).toHaveText('2');
  expect(errors).toEqual([]);
});
