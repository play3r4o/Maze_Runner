import type { PlayerState } from './player';
import { GATE_IDS, hasReturnRoutes, occupiesGateSweep, openGatesFor } from './junction';
import type { Arrangement, GateOpenness } from './junction';

export const WARNING_SECONDS = 2;
export const MOTION_SECONDS = 1.25; // opening then closing: 2.5 seconds in total
export const OBSTRUCTION_SECONDS = 2;
export const COOLDOWN_SECONDS = 3;

export type ShiftPhase = 'idle' | 'warning' | 'opening' | 'closing' | 'recovering' | 'cooldown';
export type JunctionState = {
  phase: ShiftPhase;
  phaseSeconds: number;
  blockedSeconds: number;
  openness: GateOpenness;
  settled: Arrangement | 'all-open';
  target: Arrangement;
  completedShifts: number;
  notice: string;
};

export function createJunctionState(): JunctionState {
  return {
    phase: 'idle', phaseSeconds: 0, blockedSeconds: 0,
    openness: { north: 1, east: 0, south: 1, west: 0 },
    settled: 'north-south', target: 'east-west', completedShifts: 0,
    notice: 'Press G to change routes. The outer loop always leads back.',
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
    ...state, phase: 'warning', phaseSeconds: 0, blockedSeconds: 0,
    notice: `${state.target === 'east-west' ? 'East / west' : 'North / south'} will open. Keep clear of the gold gates.`,
  };
}

function moveToward(value: number, target: number, step: number): number {
  const next = target > value ? Math.min(target, value + step) : Math.max(target, value - step);
  return Math.abs(next - target) < 1e-9 ? target : next;
}

function checkedPose(state: JunctionState, next: JunctionState): JunctionState {
  if (hasReturnRoutes(next.openness)) return next;
  return { ...state, phase: 'recovering', phaseSeconds: 0,
    notice: 'Shift rejected: a temporary return route would be lost. Reopening gates.' };
}

export function advanceShift(state: JunctionState, player: PlayerState, dtSeconds: number): JunctionState {
  if (dtSeconds <= 0 || state.phase === 'idle') return state;
  const elapsed = state.phaseSeconds + dtSeconds;

  if (state.phase === 'warning' || state.phase === 'cooldown') {
    const duration = state.phase === 'warning' ? WARNING_SECONDS : COOLDOWN_SECONDS;
    if (elapsed < duration - 1e-9) return { ...state, phaseSeconds: elapsed };
    return { ...state, phase: state.phase === 'warning' ? 'opening' : 'idle', phaseSeconds: 0 };
  }

  const step = dtSeconds / MOTION_SECONDS;
  const openness = { ...state.openness };
  const opening = openGatesFor(state.target);

  if (state.phase === 'opening') {
    for (const id of opening) openness[id] = moveToward(openness[id], 1, step);
    const finished = opening.every((id) => openness[id] === 1);
    return checkedPose(state, { ...state, openness, phase: finished ? 'closing' : 'opening',
      phaseSeconds: finished ? 0 : elapsed });
  }

  if (state.phase === 'recovering') {
    for (const id of GATE_IDS) openness[id] = moveToward(openness[id], 1, step);
    const finished = GATE_IDS.every((id) => openness[id] === 1);
    return { ...state, openness, phase: finished ? 'cooldown' : 'recovering',
      phaseSeconds: finished ? 0 : elapsed, blockedSeconds: 0,
      settled: finished ? 'all-open' : state.settled,
      notice: finished ? 'Shift cancelled. All routes are open; move clear, then press G to retry.' : state.notice };
  }

  const closing = GATE_IDS.filter((id) => !opening.includes(id));
  const occupied = closing.filter((id) => openness[id] > 0 && occupiesGateSweep(id, player));
  if (occupied.length > 0) {
    const blockedSeconds = state.blockedSeconds + dtSeconds;
    const cancelled = blockedSeconds >= OBSTRUCTION_SECONDS - 1e-9;
    return { ...state, phase: cancelled ? 'recovering' : 'closing',
      phaseSeconds: cancelled ? 0 : elapsed, blockedSeconds,
      notice: cancelled ? 'Shift cancelled: safety area occupied. Reopening all gates.'
        : `Closing held: ${occupied.join(' / ').toUpperCase()} safety area occupied. Move clear.`,
    };
  }

  for (const id of closing) openness[id] = moveToward(openness[id], 0, step);
  const finished = closing.every((id) => openness[id] === 0);
  return checkedPose(state, {
    ...state, openness, phase: finished ? 'cooldown' : 'closing',
    phaseSeconds: finished ? 0 : elapsed, blockedSeconds: 0,
    settled: finished ? state.target : state.settled,
    target: finished ? (state.target === 'east-west' ? 'north-south' : 'east-west') : state.target,
    completedShifts: state.completedShifts + Number(finished),
    notice: finished ? 'Shift complete. Press G again after the cooldown.'
      : state.blockedSeconds > 0 ? 'Safety area clear. Closing resumed.' : state.notice,
  });
}
