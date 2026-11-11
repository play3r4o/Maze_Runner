import { describe, expect, it } from 'vitest';
import { createJunctionRun, requestRunShift, resolveClosingGatePush, stepJunctionRun } from '../src/game/junctionRun';
import type { JunctionRun } from '../src/game/junctionRun';
import { FIXED_DT } from '../src/loop';
import { gateColliders, gateRect, GATE_LENGTH, GATE_TRAVEL, JUNCTION_WALLS } from '../src/simulation/junction';
import { PLAYER_HALF_WIDTH } from '../src/simulation/player';
import type { MoveIntent, PlayerState, WallRect } from '../src/simulation/player';
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
function overlaps(player: PlayerState, wall: WallRect): boolean {
  return player.x + PLAYER_HALF_WIDTH > wall.minX + 1e-8 && player.x - PLAYER_HALF_WIDTH < wall.maxX - 1e-8
    && player.z + PLAYER_HALF_WIDTH > wall.minZ + 1e-8 && player.z - PLAYER_HALF_WIDTH < wall.maxZ - 1e-8;
}

describe('long passages and gate pushing', () => {
  it('requires more than a one-second dash to cross the entire passage', () => {
    expect(gateRect('north', 0).maxZ - gateRect('north', 0).minZ).toBe(GATE_LENGTH);
    let run = advance(northRun(-5.7), 1, { forward: 1, strafe: 0 });
    expect(run.player.z).toBeCloseTo(-8.7);
    expect(run.player.z).toBeGreaterThan(-14.3);
    run = advance(run, 2, { forward: 1, strafe: 0 });
    expect(run.player.z).toBeLessThan(-14.3);
    expect(run.crushedBy).toBeNull();
  });

  it('does not push or kill merely for standing in the warning zone', () => {
    const run = closingRun();
    expect(run.crushedBy).toBeNull();
    expect(run.pushedBy).toBeNull();
    expect(run.junction.phase).toBe('closing');
    expect(advance(run, 1).player).toEqual(run.player);
  });

  it('pushes on first contact and leaves the player alive while the body fits', () => {
    const before = closingRun();
    const run = advance(before, 2);
    expect(run.crushedBy).toBeNull();
    expect(run.pushedBy).toBe('north');
    expect(run.player.x).toBeCloseTo(-0.05);
    expect(run.player.z).toBe(before.player.z);
    expect(run.junction.openness.north).toBeCloseTo(0.5);
    expect(before.player.x).toBe(0);
    const later = advance(run, 1);
    expect(later.player.x).toBeLessThan(run.player.x);
    expect(later.crushedBy).toBeNull();
  });

  it('pushes the body edge even before the stone reaches its center', () => {
    const before = closingRun().junction;
    const after = advanceShift(before, CLOSING_SECONDS / 2);
    expect(gateRect('north', after.openness.north).minX).toBeGreaterThan(0);
    const result = resolveClosingGatePush(before, after, northRun().player);
    expect(result.player.x).toBeCloseTo(-0.05);
    expect(result.pushedBy).toBe('north');
    expect(result.crushedBy).toBeNull();
  });

  it.each([
    ['north', 0, -10], ['south', 0, 10], ['east', 10, 0], ['west', -10, 0],
  ] as const)('pushes toward the opposite wall before crushing in the %s passage', (id, x, z) => {
    const initial = createJunctionRun();
    const horizontal = id === 'north' || id === 'south';
    const run: JunctionRun = { ...initial, player: { x, z, yaw: 0 },
      junction: horizontal ? initial.junction : {
        ...initial.junction, openness: { north: 0, east: 1, south: 0, west: 1 },
        settled: 'east-west', target: 'north-south',
      } };
    const pushed = advance(requestRunShift(run), WARNING_SECONDS + OPENING_SECONDS + 2);
    expect(pushed.crushedBy).toBeNull();
    expect(pushed.pushedBy).toBe(id);
    expect(pushed.player[horizontal ? 'x' : 'z']).toBeLessThan(-0.01);
    expect(pushed.player[horizontal ? 'z' : 'x']).toBe(horizontal ? z : x);
    const pinned = advance(pushed, 1.5);
    expect(pinned.crushedBy).toBe(id);
    expect(pinned.player[horizontal ? 'x' : 'z']).toBeCloseTo(-1.7);
    expect(pinned.player[horizontal ? 'z' : 'x']).toBe(horizontal ? z : x);
  });

  it('allows an exact body-width gap, then kills on the first narrower step', () => {
    const fitSeconds = CLOSING_SECONDS * (1 - (2 * PLAYER_HALF_WIDTH) / GATE_TRAVEL);
    const fitting = advance(closingRun(), fitSeconds);
    const gap = gateRect('north', fitting.junction.openness.north).minX - (-2);
    expect(gap).toBeCloseTo(2 * PLAYER_HALF_WIDTH);
    expect(fitting.player.x).toBeCloseTo(-1.7);
    expect(fitting.crushedBy).toBeNull();
    const pinned = advance(fitting, FIXED_DT);
    expect(pinned.crushedBy).toBe('north');
    expect(pinned.player.x).toBeCloseTo(-1.7);
  });

  it('does not invent a crush where there is no opposing wall', () => {
    const before = closingRun().junction;
    const after = advanceShift(before, CLOSING_SECONDS);
    const result = resolveClosingGatePush(before, after, northRun().player, []);
    expect(result.crushedBy).toBeNull();
    expect(result.player.x).toBeCloseTo(-2.3);
    expect(overlaps(result.player, gateRect('north', 0))).toBe(false);
  });

  it('sweeps a large gate displacement against the real opposing wall', () => {
    const before = closingRun().junction;
    const after = advanceShift(before, CLOSING_SECONDS);
    const result = resolveClosingGatePush(before, after, northRun().player);
    expect(result.crushedBy).toBe('north');
    expect(result.player.x).toBeCloseTo(-1.7);
    expect(JUNCTION_WALLS.some((wall) => overlaps(result.player, wall))).toBe(false);
  });

  it('cannot walk through the moving gate or be shoved through the opposite wall', () => {
    let run = closingRun();
    for (let tick = 0; tick < 210; tick += 1) {
      run = stepJunctionRun(run, { forward: 0, strafe: 1 }, 0, FIXED_DT);
      expect(JUNCTION_WALLS.some((wall) => overlaps(run.player, wall))).toBe(false);
      if (!run.crushedBy) expect(gateColliders(run.junction.openness).some((wall) => overlaps(run.player, wall))).toBe(false);
    }
    expect(run.crushedBy).toBe('north');
  });

  it('finishes closing after death and ignores dead input', () => {
    const dead = advance(closingRun(), 3.5);
    expect(dead.crushedBy).toBe('north');
    expect(requestRunShift(dead)).toBe(dead);
    const finished = advance(dead, 3, { forward: 1, strafe: 1 });
    expect(finished.player).toEqual(dead.player);
    expect(finished.crushedBy).toBe('north');
    expect(finished.pushedBy).toBeNull();
    expect(finished.junction.openness.north).toBe(0);
    expect(finished.junction.completedShifts).toBe(1);
  });

  it('lets the player retreat before contact', () => {
    const run = advance(advance(closingRun(-8.1), 1, { forward: -1, strafe: 0 }), CLOSING_SECONDS);
    expect(run.player.z).toBeCloseTo(-5.1);
    expect(run.crushedBy).toBeNull();
  });

  it('lets the player walk along the passage and escape while being pushed', () => {
    let run = advance(closingRun(-8.1), 2.1);
    expect(run.pushedBy).toBe('north');
    expect(run.crushedBy).toBeNull();
    run = advance(run, 1.1, { forward: -1, strafe: 0 });
    expect(run.player.z).toBeGreaterThan(-5.7);
    run = advance(run, CLOSING_SECONDS);
    expect(run.crushedBy).toBeNull();
    expect(run.pushedBy).toBeNull();
    expect(run.junction.openness.north).toBe(0);
  });

  it('pushes late entrants before a subsequent squeeze kills them', () => {
    let run = advance(advance(closingRun(-5.7), 1), 0.5, { forward: 1, strafe: 0 });
    run = advance(run, 1);
    expect(run.player.z).toBeLessThan(-6.3);
    expect(run.pushedBy).toBe('north');
    expect(run.crushedBy).toBeNull();
    expect(advance(run, 1).crushedBy).toBe('north');
  });

  it.each([-5.69, -14.31])('leaves a player outside the passage unpushed at Z=%s', (z) => {
    const run = advance(closingRun(z), CLOSING_SECONDS);
    expect(run.crushedBy).toBeNull();
    expect(run.pushedBy).toBeNull();
    expect(run.player).toEqual(northRun(z).player);
  });

  it('does not push or crush on opening movement', () => {
    const before = { ...createJunctionRun().junction, openness: { north: 0, east: 1, south: 0, west: 1 } };
    const after = { ...before, openness: { north: 1, east: 1, south: 1, west: 1 } };
    const result = resolveClosingGatePush(before, after, northRun().player);
    expect(result.player).toEqual(northRun().player);
    expect(result.crushedBy).toBeNull();
    expect(result.pushedBy).toBeNull();
  });

  it('keeps stationary closed gates as ordinary blocking walls', () => {
    const run = advance(createJunctionRun(), 3, { forward: 0, strafe: 1 });
    expect(run.player.x).toBeCloseTo(5.7);
    expect(run.crushedBy).toBeNull();
    expect(run.pushedBy).toBeNull();
  });

  it('starts a clean retry with safe spawn, initial gates, no push and zero shifts', () => {
    expect(advance(closingRun(), CLOSING_SECONDS).crushedBy).toBe('north');
    const retry = createJunctionRun();
    expect(retry.crushedBy).toBeNull();
    expect(retry.pushedBy).toBeNull();
    expect(retry.player).toEqual({ x: 0, z: 0, yaw: 0 });
    expect(retry.junction.openness).toEqual({ north: 1, east: 0, south: 1, west: 0 });
    expect(retry.junction.completedShifts).toBe(0);
  });
});
