export const FIXED_DT = 1 / 60;
const MAX_FRAME_SECONDS = 0.1;
const MAX_STEPS = 6;

// No browser dependency: tests can supply timestamps, including pause gaps.
export function createFixedStepper(update: (dtSeconds: number) => void) {
  let previous: number | null = null;
  let accumulator = 0;

  function reset() {
    previous = null;
    accumulator = 0;
  }

  function advance(timestampMs: number, running: boolean) {
    if (!running) {
      reset();
      return;
    }
    if (previous === null) {
      previous = timestampMs;
      return;
    }

    accumulator += Math.min(MAX_FRAME_SECONDS, Math.max(0, (timestampMs - previous) / 1000));
    previous = timestampMs;
    let steps = 0;
    while (accumulator + 1e-10 >= FIXED_DT && steps < MAX_STEPS) {
      update(FIXED_DT);
      accumulator = Math.max(0, accumulator - FIXED_DT);
      steps += 1;
    }
  }

  return { advance, reset };
}
