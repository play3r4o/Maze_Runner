import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freezeBrowserClock, installBrowserClock } from './clock';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

async function start(page: Page) {
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
}

async function position(page: Page) {
  // Read one visible HUD sample, without rendering/input between coordinates.
  return page.evaluate(() => ({
    x: Number(document.querySelector('[data-testid="position-x"]')!.textContent),
    z: Number(document.querySelector('[data-testid="position-z"]')!.textContent),
  }));
}

async function moveMouseRelative(page: Page, movementX: number) {
  // Pointer-locked look consumes relative deltas. Absolute CDP mouse.move
  // coordinates do not guarantee those deltas across headless backends.
  // Dispatch input through the real DOM handler, never through game state.
  // Genuine mouse-device feel still requires the human acceptance checklist.
  await page.locator('#scene').dispatchEvent('mousemove', {
    bubbles: true,
    movementX,
    movementY: 0,
  });
}

test('production room draws geometry, shows controls, and resizes', async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await page.goto('/?scene=room');
  await expect(page.getByRole('heading', { name: 'A place to begin.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start exploring' })).toBeVisible();
  const canvas = page.locator('#scene');
  await expect(canvas).toBeVisible();

  // Inspect actual screenshot pixels, not merely canvas dimensions or a PID.
  const screenshot = await canvas.screenshot({ style: '#hud { visibility: hidden !important; }' });
  const pixelStats = await page.evaluate(async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = 64;
    sample.height = 40;
    const context = sample.getContext('2d')!;
    context.drawImage(image, 0, 0, 64, 40);
    const data = context.getImageData(0, 0, 64, 40).data;
    const colors = new Set<string>();
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      colors.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
      const brightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
      min = Math.min(min, brightness);
      max = Math.max(max, brightness);
    }
    return { colors: colors.size, contrast: max - min };
  }, `data:image/png;base64,${screenshot.toString('base64')}`);
  expect(pixelStats.colors).toBeGreaterThan(8);
  expect(pixelStats.contrast).toBeGreaterThan(30);
  await testInfo.attach('rendered-room', { body: screenshot, contentType: 'image/png' });

  await page.setViewportSize({ width: 960, height: 640 });
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => [element.width, element.height])).toEqual([960, 640]);
  expect(errors).toEqual([]);
});

test('real pointer lock, movement, block collision, pause and clean resume', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?scene=room');
  await moveMouseRelative(page, 220);
  await start(page);
  await page.keyboard.down('KeyW');
  await expect.poll(async () => (await position(page)).z, { timeout: 15_000 }).toBeCloseTo(1.3, 1);
  expect((await position(page)).x).toBeCloseTo(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'paused');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  const paused = await position(page);
  await moveMouseRelative(page, 220);
  await page.getByRole('button', { name: 'Resume exploring' }).click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  // Deliberately keep W physically held: unlock must have cleared its input.
  await page.waitForTimeout(250);
  expect(await position(page)).toEqual(paused);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyD');
  await expect.poll(async () => (await position(page)).x).toBeGreaterThan(paused.x + 0.5);
  await page.keyboard.up('KeyD');
  expect((await position(page)).z).toBeCloseTo(paused.z);
  expect(errors).toEqual([]);
});

for (const [direction, movementX] of [['right', 220], ['left', -220]] as const) {
  test(`relative mouse input turns forward movement ${direction}`, async ({ page }) => {
    const errors = watchErrors(page);
    await installBrowserClock(page);
    await page.goto('/?scene=room');
    await start(page);
    await freezeBrowserClock(page);
    await moveMouseRelative(page, movementX);
    await page.keyboard.down('KeyW');
    try {
      await page.clock.runFor(1000);
    } finally {
      await page.keyboard.up('KeyW');
    }
    // Let the 10 Hz diagnostics render the stopped position, then assert both
    // axes from the same snapshot. The player cannot drift during assertions.
    await page.clock.runFor(120);
    const stopped = await position(page);
    expect(Math.sign(movementX) * stopped.x).toBeGreaterThan(0.25);
    expect(stopped.z).toBeLessThan(7.8);
    expect(errors).toEqual([]);
  });
}

test('losing focus clears movement and pauses', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?scene=room');
  await start(page);
  await page.keyboard.down('KeyS');
  await expect.poll(async () => (await position(page)).z).toBeGreaterThan(8.2);
  // Deterministically exercise the browser blur handler; real tab switching is
  // also in the human checklist and is not claimed by this synthetic event.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'paused');
  await page.keyboard.up('KeyS');
  await page.getByRole('button', { name: 'Resume exploring' }).click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'running');
  await page.waitForTimeout(150);
  const resumed = await position(page);
  await page.waitForTimeout(200);
  expect(await position(page)).toEqual(resumed);
  expect(errors).toEqual([]);
});

test('blocked pointer lock gives a recoverable message', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error('Blocked by test'));
  });
  await page.goto('/?scene=room');
  await page.getByRole('button', { name: 'Start exploring' }).click();
  await expect(page.getByText('Mouse capture was blocked. Click Start or Resume to try again.')).toBeVisible();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'paused');
  expect(errors).toEqual([]);
});

test('unavailable WebGL gives a readable fallback', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof getContext>) {
      if (String(args[0]).includes('webgl')) return null;
      return getContext.apply(this, args);
    } as typeof getContext;
  });
  await page.goto('/?scene=room');
  await expect(page.getByRole('heading', { name: 'Unable to start the room.' })).toBeVisible();
  await expect(page.getByText(/WebGL 2 could not start/)).toBeVisible();
  await expect(page.getByRole('button')).toBeHidden();
});
