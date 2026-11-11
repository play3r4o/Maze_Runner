import { GATE_IDS, hasReturnRoutes, openGatesFor } from './junction';
import type { Arrangement, GateOpenness } from './junction';

export const WARNING_SECONDS = 2;
export const OPENING_SECONDS = 1.25;
export const CLOSING_SECONDS = 4;
export const COOLDOWN_SECONDS = 3;

export type ShiftPhase = 'idle' | 'warning' | 'opening' | 'closing' | 'cooldown';
export type JunctionState = {
  phase: ShiftPhase;
  phaseSeconds: number;
  openness: GateOpenness;
  settled: Arrangement;
  target: Arrangement;
  completedShifts: number;
  notice: string;
};

export function createJunctionState(): JunctionState {
  return {
    phase: 'idle', phaseSeconds: 0,
    openness: { north: 1, east: 0, south: 1, west: 0 },
    settled: 'north-south', target: 'east-west', completedShifts: 0,
    notice: 'Press G to change routes. Closing gates crush. The outer loop is the safer detour.',
  };
}

export function requestShift(state: JunctionState): JunctionState {
  if (state.phase !== 'idle') {
    return { ...state, notice: state.phase === 'cooldown'
      ? 'Shift ignored: wait for the cooldown.' : 'Shift ignored: a change is already in progress.' };
  }
  const open = openGatesFor(state.target);
  const planned = Object.fromEntries(GATE_IDS.map((id) => [id, Number(open.includes(id))])) as GateOpenness;
  if (!hasReturnRoutes(state.openness) || !hasReturnRoutes(planned)) {
    return { ...state, notice: 'Shift rejected: a return route would be lost.' };
  }
  return {
    ...state, phase: 'warning', phaseSeconds: 0,
    notice: `${state.target === 'east-west' ? 'East / west' : 'North / south'} will open. Leave closing passages before the stone reaches you.`,
  };
}

function moveToward(value: number, target: number, step: number): number {
  const next = target > value ? Math.min(target, value + step) : Math.max(target, value - step);
  return Math.abs(next - target) < 1e-9 ? target : next;
}

function checkedPose(state: JunctionState, next: JunctionState): JunctionState {
  if (hasReturnRoutes(next.openness)) return next;
  return { ...state, notice: 'Shift rejected: a temporary return route would be lost.' };
}

export function advanceShift(state: JunctionState, dtSeconds: number): JunctionState {
  if (dtSeconds <= 0 || state.phase === 'idle') return state;
  const elapsed = state.phaseSeconds + dtSeconds;

  if (state.phase === 'warning' || state.phase === 'cooldown') {
    const duration = state.phase === 'warning' ? WARNING_SECONDS : COOLDOWN_SECONDS;
    if (elapsed < duration - 1e-9) return { ...state, phaseSeconds: elapsed };
    return { ...state, phase: state.phase === 'warning' ? 'opening' : 'idle', phaseSeconds: 0 };
  }

  const openness = { ...state.openness };
  const opening = openGatesFor(state.target);

  if (state.phase === 'opening') {
    for (const id of opening) openness[id] = moveToward(openness[id], 1, dtSeconds / OPENING_SECONDS);
    const finished = opening.every((id) => openness[id] === 1);
    return checkedPose(state, { ...state, openness, phase: finished ? 'closing' : 'opening',
      phaseSeconds: finished ? 0 : elapsed });
  }

  const closing = GATE_IDS.filter((id) => !opening.includes(id));
  for (const id of closing) openness[id] = moveToward(openness[id], 0, dtSeconds / CLOSING_SECONDS);
  const finished = closing.every((id) => openness[id] === 0);
  return checkedPose(state, {
    ...state, openness, phase: finished ? 'cooldown' : 'closing',
    phaseSeconds: finished ? 0 : elapsed,
    settled: finished ? state.target : state.settled,
    target: finished ? (state.target === 'east-west' ? 'north-south' : 'east-west') : state.target,
    completedShifts: state.completedShifts + Number(finished),
    notice: finished ? 'Shift complete. Press G again after the cooldown.' : 'Stone closing. Clear the entire marked passage!',
  });
}
