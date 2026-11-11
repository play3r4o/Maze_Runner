import { describe, expect, it } from 'vitest';
import { createJunctionRun, crushingGateBetween, requestRunShift, stepJunctionRun } from '../src/game/junctionRun';
import type { JunctionRun } from '../src/game/junctionRun';
import { FIXED_DT } from '../src/loop';
import { gateRect, GATE_LENGTH } from '../src/simulation/junction';
import type { MoveIntent } from '../src/simulation/player';
import { advanceShift, CLOSING_SECONDS, OPENING_SECONDS, WARNING_SECONDS } from '../src/simulation/shift';

const still: MoveIntent = { forward: 0, strafe: 0 };
function advance(run: JunctionRun, seconds: number, intent = still): JunctionRun {
  for (let tick = 0; tick < Math.round(seconds / FIXED_DT); tick += 1) run = stepJunctionRun(run, intent, run.player.yaw, FIXED_DT);
  return run;
}
function northRun(z = -10): JunctionRun {
  return { ...createJunctionRun(), player: { x: 0, z, yaw: 0 } };
}
function closingRun(z = -10): JunctionRun {
  return advance(requestRunShift(northRun(z)), WARNING_SECONDS + OPENING_SECONDS);
}

describe('long crushing passages', () => {
  it('requires more than a quick one-second dash to cross the entire passage', () => {
    expect(gateRect('north', 0).maxZ - gateRect('north', 0).minZ).toBe(GATE_LENGTH);
    let run = advance(northRun(-5.7), 1, { forward: 1, strafe: 0 });
    expect(run.player.z).toBeCloseTo(-8.7);
    expect(run.player.z).toBeGreaterThan(-14.3);
    run = advance(run, 2, { forward: 1, strafe: 0 });
    expect(run.player.z).toBeLessThan(-14.3);
    expect(run.crushedBy).toBeNull();
  });

  it('does not kill merely for standing in the warning zone', () => {
    const run = closingRun();
    expect(run.crushedBy).toBeNull();
    expect(run.junction.phase).toBe('closing');
    expect(run.junction.openness.north).toBe(1);
    expect(advance(run, 1).crushedBy).toBeNull();
  });

  it('kills when closing stone reaches the body instead of holding or cancelling', () => {
    const before = closingRun();
    const run = advance(before, 2);
    expect(run.crushedBy).toBe('north');
    expect(run.player).toEqual(before.player);
    expect(run.junction.phase).toBe('closing');
    expect(run.junction.openness.north).toBeCloseTo(0.5);
    expect(before.crushedBy).toBeNull();
  });

  it('checks the body footprint, rather than just the center point', () => {
    const before = closingRun().junction;
    const after = advanceShift(before, CLOSING_SECONDS / 2);
    expect(gateRect('north', after.openness.north).minX).toBeGreaterThan(0);
    expect(crushingGateBetween(before, after, northRun().player)).toBe('north');
  });

  it.each([
    ['north', 0, -10], ['south', 0, 10], ['east', 10, 0], ['west', -10, 0],
  ] as const)('resolves a physical crush in the %s passage', (id, x, z) => {
    const initial = createJunctionRun();
    const northSouth = id === 'north' || id === 'south';
    const run: JunctionRun = {
      ...initial, player: { x, z, yaw: 0 },
      junction: northSouth ? initial.junction : {
        ...initial.junction, openness: { north: 0, east: 1, south: 0, west: 1 },
        settled: 'east-west', target: 'north-south',
      },
    };
    const dead = advance(requestRunShift(run), WARNING_SECONDS + OPENING_SECONDS + 2);
    expect(dead.crushedBy).toBe(id);
    expect(dead.player).toEqual(run.player);
  });

  it('finishes closing after death and cannot award another shift from dead input', () => {
    const dead = advance(closingRun(), 2);
    expect(dead.crushedBy).toBe('north');
    expect(requestRunShift(dead)).toBe(dead);
    const finished = advance(dead, 3, { forward: 1, strafe: 1 });
    expect(finished.player).toEqual(dead.player);
    expect(finished.crushedBy).toBe('north');
    expect(finished.junction.openness.north).toBe(0);
    expect(finished.junction.completedShifts).toBe(1);
    expect(finished.junction.settled).toBe('east-west');
  });

  it('lets the player retreat before the slab arrives', () => {
    let run = closingRun(-8.1);
    run = advance(run, 1, { forward: -1, strafe: 0 });
    expect(run.player.z).toBeCloseTo(-5.1);
    run = advance(run, CLOSING_SECONDS);
    expect(run.crushedBy).toBeNull();
    expect(run.junction.openness.north).toBe(0);
  });

  it('catches a player entering the passage after closing has already begun', () => {
    let run = advance(closingRun(-5.7), 1);
    run = advance(run, 0.5, { forward: 1, strafe: 0 });
    expect(run.crushedBy).toBeNull();
    expect(run.player.z).toBeLessThan(-6.3);
    run = advance(run, 1);
    expect(run.crushedBy).toBe('north');
  });

  it.each([-5.69, -14.31])('leaves a player just outside the passage alive at Z=%s', (z) => {
    const run = advance(closingRun(z), CLOSING_SECONDS);
    expect(run.crushedBy).toBeNull();
    expect(run.player.z).toBe(z);
    expect(run.junction.openness.north).toBe(0);
  });

  it('never treats opening movement as crushing', () => {
    const before = { ...createJunctionRun().junction, openness: { north: 0, east: 1, south: 0, west: 1 } };
    const after = { ...before, openness: { north: 1, east: 1, south: 1, west: 1 } };
    expect(crushingGateBetween(before, after, northRun().player)).toBeNull();
  });

  it('keeps stationary closed gates as ordinary blocking walls', () => {
    const run = advance(createJunctionRun(), 3, { forward: 0, strafe: 1 });
    expect(run.player.x).toBeCloseTo(5.7);
    expect(run.crushedBy).toBeNull();
    expect(crushingGateBetween(run.junction, run.junction, run.player)).toBeNull();
  });

  it('starts a clean retry with safe spawn, initial gates and zero completed shifts', () => {
    const dead = advance(closingRun(), CLOSING_SECONDS);
    expect(dead.crushedBy).toBe('north');
    const retry = createJunctionRun();
    expect(retry.crushedBy).toBeNull();
    expect(retry.player).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(retry.junction.openness).toEqual({ north: 1, east: 0, south: 1, west: 0 });
    expect(retry.junction.completedShifts).toBe(0);
    expect(dead.crushedBy).toBe('north');
  });
});
