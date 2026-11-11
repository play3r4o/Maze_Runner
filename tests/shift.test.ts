import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/loop';
import { GATE_IDS, gateColliders, gateRect, hasReturnRoutes, JUNCTION_WALLS } from '../src/simulation/junction';
import { stepPlayer } from '../src/simulation/player';
import type { PlayerState } from '../src/simulation/player';
import { advanceShift, COOLDOWN_SECONDS, createJunctionState, OPENING_SECONDS, CLOSING_SECONDS, requestShift, WARNING_SECONDS } from '../src/simulation/shift';
import type { JunctionState } from '../src/simulation/shift';

const center: PlayerState = { x: 0, z: 0, yaw: 0 };

function advance(state: JunctionState, seconds: number): JunctionState {
  for (let tick = 0; tick < Math.round(seconds / FIXED_DT); tick += 1) state = advanceShift(state, FIXED_DT);
  return state;
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

  it('blocks a closed gate, allows an open gate, and has a physical return loop', () => {
    const walls = [...JUNCTION_WALLS, ...gateColliders(createJunctionState().openness)];
    let eastbound = { ...center };
    for (let i = 0; i < 340; i += 1) eastbound = stepPlayer(eastbound, { forward: 0, strafe: 1 }, walls, FIXED_DT);
    expect(eastbound.x).toBeCloseTo(5.7);
    // From beyond the closed east gate, use the north perimeter to return.
    let player = { x: 17, z: 0, yaw: 0 };
    for (const intent of [{ forward: 1, strafe: 0 }, { forward: 0, strafe: -1 }, { forward: -1, strafe: 0 }]) {
      for (let i = 0; i < 340; i += 1) player = stepPlayer(player, intent, walls, FIXED_DT);
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
    state = advance(state, OPENING_SECONDS / 5);
    expect(state.openness.east).toBeCloseTo(0.2);
    expect(state.openness.north).toBe(1);
    state = advance(state, OPENING_SECONDS * 4 / 5);
    expect(state.phase).toBe('closing');
    expect(GATE_IDS.every((id) => state.openness[id] === 1)).toBe(true);
    state = advance(state, CLOSING_SECONDS / 5);
    expect(state.openness.north).toBeCloseTo(0.8);
    expect(state.openness.east).toBe(1);
  });

  it('completes the slower four-second closing motion and alternates the next arrangement', () => {
    const state = advance(requestShift(createJunctionState()), WARNING_SECONDS + OPENING_SECONDS + CLOSING_SECONDS);
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
    let state = advance(requestShift(createJunctionState()), WARNING_SECONDS + OPENING_SECONDS + CLOSING_SECONDS);
    state = requestShift(state);
    state = advance(state, COOLDOWN_SECONDS + 5);
    expect(state.phase).toBe('idle');
    expect(state.completedShifts).toBe(1);
  });

  it('does not advance with zero elapsed simulation time', () => {
    const state = requestShift(createJunctionState());
    expect(advanceShift(state, 0)).toBe(state);
  });
});

describe('route invariants', () => {
  it('keeps return routes through twelve complete arrangements', () => {
    let state = createJunctionState();
    for (let shift = 0; shift < 12; shift += 1) {
      state = requestShift(state);
      for (let tick = 0; tick < 700; tick += 1) {
        state = advanceShift(state, FIXED_DT);
        expect(hasReturnRoutes(state.openness)).toBe(true);
        for (const id of GATE_IDS) {
          expect(state.openness[id]).toBeGreaterThanOrEqual(0);
          expect(state.openness[id]).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(state.completedShifts).toBe(12);
  });
});
