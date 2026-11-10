import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/loop';
import { GATE_IDS, gateColliders, gateRect, hasReturnRoutes, JUNCTION_WALLS, occupiesGateSweep } from '../src/simulation/junction';
import { PLAYER_HALF_WIDTH, stepPlayer } from '../src/simulation/player';
import type { PlayerState, WallRect } from '../src/simulation/player';
import { advanceShift, COOLDOWN_SECONDS, createJunctionState, MOTION_SECONDS, OBSTRUCTION_SECONDS, requestShift, WARNING_SECONDS } from '../src/simulation/shift';
import type { JunctionState } from '../src/simulation/shift';

const center: PlayerState = { x: 0, z: 0, yaw: 0 };
const inNorthGate: PlayerState = { x: 0, z: -4, yaw: 0 };

function advance(state: JunctionState, seconds: number, player = center): JunctionState {
  for (let tick = 0; tick < Math.round(seconds / FIXED_DT); tick += 1) state = advanceShift(state, player, FIXED_DT);
  return state;
}

function startClosing(): JunctionState {
  return advance(requestShift(createJunctionState()), WARNING_SECONDS + MOTION_SECONDS);
}

function overlaps(player: PlayerState, rect: WallRect): boolean {
  return player.x + PLAYER_HALF_WIDTH > rect.minX + 1e-8 && player.x - PLAYER_HALF_WIDTH < rect.maxX - 1e-8
    && player.z + PLAYER_HALF_WIDTH > rect.minZ + 1e-8 && player.z - PLAYER_HALF_WIDTH < rect.maxZ - 1e-8;
}

describe('junction geometry and routes', () => {
  it('starts with north/south open and every arm connected to the hub', () => {
    const state = createJunctionState();
    expect(state.openness).toEqual({ north: 1, east: 0, south: 1, west: 0 });
    expect(hasReturnRoutes(state.openness)).toBe(true);
    expect(hasReturnRoutes({ north: 0, east: 0, south: 0, west: 0 })).toBe(false);
  });

  it('uses the same intermediate gate rectangle for collision and rendering', () => {
    const rect = gateRect('north', 0.5);
    expect(rect.minX).toBeCloseTo(0.25);
    expect(rect.maxX).toBeCloseTo(4.25);
    expect(gateColliders({ north: 0.5, east: 0, south: 1, west: 0 })[0]).toEqual(rect);
  });

  it.each(GATE_IDS)('detects occupied swept space for %s with a safety margin', (id) => {
    const rect = gateRect(id, 0);
    const player = { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2, yaw: 0 };
    expect(occupiesGateSweep(id, player)).toBe(true);
    expect(occupiesGateSweep(id, center)).toBe(false);
  });

  it('blocks a closed gate, allows an open gate, and has a physical return loop', () => {
    const walls = [...JUNCTION_WALLS, ...gateColliders(createJunctionState().openness)];
    let eastbound = { ...center };
    for (let i = 0; i < 180; i += 1) eastbound = stepPlayer(eastbound, { forward: 0, strafe: 1 }, walls, FIXED_DT);
    expect(eastbound.x).toBeCloseTo(3.45);
    // From beyond the closed east gate, use the north perimeter to return.
    let player = { x: 9, z: 0, yaw: 0 };
    for (const intent of [{ forward: 1, strafe: 0 }, { forward: 0, strafe: -1 }, { forward: -1, strafe: 0 }]) {
      for (let i = 0; i < 180; i += 1) player = stepPlayer(player, intent, walls, FIXED_DT);
    }
    expect(player.x).toBeCloseTo(0);
    expect(player.z).toBeCloseTo(0);
  });
});

describe('shift phases', () => {
  it('warns without moving gates and does not mutate its source', () => {
    const original = createJunctionState();
    const copy = structuredClone(original);
    const state = advance(requestShift(original), WARNING_SECONDS - FIXED_DT);
    expect(state.phase).toBe('warning');
    expect(state.openness).toEqual(original.openness);
    expect(original).toEqual(copy);
  });

  it('opens replacement routes fully before starting to close old ones', () => {
    let state = advance(requestShift(createJunctionState()), WARNING_SECONDS);
    expect(state.phase).toBe('opening');
    state = advance(state, MOTION_SECONDS / 5);
    expect(state.openness.east).toBeCloseTo(0.2);
    expect(state.openness.north).toBe(1);
    state = advance(state, MOTION_SECONDS * 4 / 5);
    expect(state.phase).toBe('closing');
    expect(GATE_IDS.every((id) => state.openness[id] === 1)).toBe(true);
    state = advance(state, MOTION_SECONDS / 5);
    expect(state.openness.north).toBeCloseTo(0.8);
    expect(state.openness.east).toBe(1);
  });

  it('completes the 2.5-second motion and alternates the next arrangement', () => {
    const state = advance(requestShift(createJunctionState()), WARNING_SECONDS + 2 * MOTION_SECONDS);
    expect(state.phase).toBe('cooldown');
    expect(state.settled).toBe('east-west');
    expect(state.target).toBe('north-south');
    expect(state.completedShifts).toBe(1);
    expect(state.openness).toEqual({ north: 0, east: 1, south: 0, west: 1 });
  });

  it.each(['warning', 'opening', 'closing', 'cooldown'] as const)('rejects a repeated request during %s without restarting or queuing it', (phase) => {
    const original: JunctionState = { ...createJunctionState(), phase, phaseSeconds: 0.4 };
    const state = requestShift(original);
    expect(state.phase).toBe(phase);
    expect(state.phaseSeconds).toBe(0.4);
    expect(state.target).toBe(original.target);
    expect(state.notice).toMatch(/ignored/);
  });

  it('rejects a plan from a disconnected fixture rather than moving gates', () => {
    const state = requestShift({ ...createJunctionState(), openness: { north: 0, east: 0, south: 0, west: 0 } });
    expect(state.phase).toBe('idle');
    expect(state.notice).toMatch(/rejected/);
  });

  it('ends cooldown without starting an automatic or queued shift', () => {
    let state = advance(requestShift(createJunctionState()), WARNING_SECONDS + 2 * MOTION_SECONDS);
    state = requestShift(state);
    state = advance(state, COOLDOWN_SECONDS + 5);
    expect(state.phase).toBe('idle');
    expect(state.completedShifts).toBe(1);
  });

  it('does not advance with zero elapsed simulation time', () => {
    const state = requestShift(createJunctionState());
    expect(advanceShift(state, center, 0)).toBe(state);
  });
});

describe('occupied gate safety', () => {
  it('holds both closing gates when one swept area is occupied', () => {
    const original = startClosing();
    const state = advance(original, 1, inNorthGate);
    expect(state.phase).toBe('closing');
    expect(state.openness).toEqual(original.openness);
    expect(state.blockedSeconds).toBeCloseTo(1);
    expect(state.notice).toMatch(/NORTH/);
  });

  it('resumes if the area clears before the obstruction timeout', () => {
    let state = advance(startClosing(), 1, inNorthGate);
    state = advance(state, FIXED_DT);
    expect(state.phase).toBe('closing');
    expect(state.openness.north).toBeLessThan(1);
    expect(state.blockedSeconds).toBe(0);
    expect(state.notice).toMatch(/resumed/);
  });

  it('also holds when a player enters after closing has started', () => {
    const original = advance(startClosing(), 0.25);
    expect(overlaps(inNorthGate, gateRect('north', original.openness.north))).toBe(false);
    const held = advance(original, 0.5, inNorthGate);
    expect(held.openness).toEqual(original.openness);
    expect(overlaps(inNorthGate, gateRect('north', held.openness.north))).toBe(false);
  });

  it('cancels a long obstruction, reopens all gates, and allows a safe retry', () => {
    let state = advance(startClosing(), OBSTRUCTION_SECONDS, inNorthGate);
    expect(state.phase).toBe('recovering');
    state = advance(state, MOTION_SECONDS, inNorthGate);
    expect(state.phase).toBe('cooldown');
    expect(state.settled).toBe('all-open');
    expect(state.completedShifts).toBe(0);
    expect(state.notice).toMatch(/cancelled/);
    expect(GATE_IDS.every((id) => state.openness[id] === 1)).toBe(true);
    state = advance(state, COOLDOWN_SECONDS);
    state = advance(requestShift(state), WARNING_SECONDS + 2 * MOTION_SECONDS);
    expect(state.settled).toBe('east-west');
    expect(state.completedShifts).toBe(1);
  });

  it('keeps return routes at every tick through repeated arrangements', () => {
    let state = createJunctionState();
    for (let shift = 0; shift < 12; shift += 1) {
      state = requestShift(state);
      for (let tick = 0; tick < 500; tick += 1) {
        state = advanceShift(state, center, FIXED_DT);
        expect(hasReturnRoutes(state.openness)).toBe(true);
        for (const id of GATE_IDS) {
          expect(state.openness[id]).toBeGreaterThanOrEqual(0);
          expect(state.openness[id]).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(state.completedShifts).toBe(12);
  });

  it('never embeds a moving player during a two-minute navigation/shift scenario', () => {
    let state = createJunctionState();
    let player = { ...center };
    const intents = [{ forward: 0, strafe: 1 }, { forward: 1, strafe: 0 }, { forward: 0, strafe: -1 }, { forward: -1, strafe: 0 }];
    for (let tick = 0; tick < 7200; tick += 1) {
      if (tick % 500 === 0) state = requestShift(state);
      state = advanceShift(state, player, FIXED_DT);
      const walls = [...JUNCTION_WALLS, ...gateColliders(state.openness)];
      player = stepPlayer(player, intents[Math.floor(tick / 180) % intents.length], walls, FIXED_DT);
      expect(walls.some((wall) => overlaps(player, wall))).toBe(false);
      expect(hasReturnRoutes(state.openness)).toBe(true);
    }
    expect(state.completedShifts).toBeGreaterThan(5);
  });
});
