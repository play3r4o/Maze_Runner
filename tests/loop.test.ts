import { describe, expect, it } from 'vitest';
import { createFixedStepper, FIXED_DT } from '../src/loop';
import { stepPlayer } from '../src/simulation/player';

describe('fixed simulation timing', () => {
  function run(timestamps: number[]) {
    let player = { x: 0, z: 0, yaw: 0 };
    const loop = createFixedStepper((dt) => {
      player = stepPlayer(player, { forward: 1, strafe: 0 }, [], dt);
    });
    for (const timestamp of timestamps) loop.advance(timestamp, true);
    return player;
  }

  it('produces equal movement for 30 Hz and 60 Hz rendering', () => {
    const slow = run(Array.from({ length: 31 }, (_, i) => i * 1000 / 30));
    const fast = run(Array.from({ length: 61 }, (_, i) => i * 1000 / 60));
    expect(slow.z).toBeCloseTo(-3);
    expect(fast.z).toBeCloseTo(slow.z);
  });

  it('never simulates paused frames or catches up paused time', () => {
    let ticks = 0;
    const loop = createFixedStepper(() => { ticks += 1; });
    loop.advance(0, true);
    loop.advance(100, true);
    expect(ticks).toBe(6);
    loop.advance(200, false);
    loop.advance(60_000, false);
    loop.advance(120_000, true);
    expect(ticks).toBe(6);
    loop.advance(120_000 + FIXED_DT * 1000, true);
    expect(ticks).toBe(7);
  });

  it('caps a long foreground frame at six ticks', () => {
    let ticks = 0;
    const loop = createFixedStepper(() => { ticks += 1; });
    loop.advance(0, true);
    loop.advance(20_000, true);
    expect(ticks).toBe(6);
  });

  it('clears partial time when lifecycle input resets it', () => {
    let ticks = 0;
    const loop = createFixedStepper(() => { ticks += 1; });
    loop.advance(0, true);
    loop.advance(10, true);
    loop.reset();
    loop.advance(10_000, true);
    loop.advance(10_010, true);
    expect(ticks).toBe(0);
    loop.advance(10_020, true);
    expect(ticks).toBe(1);
  });
});
