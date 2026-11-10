import type { Page } from '@playwright/test';

// Install before navigation, then freeze after pointer lock is acquired. Timed
// scenarios explicitly run every animation frame rather than jumping the clock
// (fastForward would skip simulation ticks). Game state is never set by tests.
export async function installBrowserClock(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
}

export async function freezeBrowserClock(page: Page) {
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.clock.runFor(120);
}
