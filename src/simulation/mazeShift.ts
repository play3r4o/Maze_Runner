import { HAND_BUILT_MAZE, MAZE_GATE_IDS } from './maze';
import type { MazeGateId, MazeOpenness, MazeLayout } from './maze';
import { mazeTopologySignature, validateMazeShiftPlan, validateMazeTopology } from './mazeGraph';
import type { TopologyCheck } from './mazeGraph';
import { WARNING_SECONDS, OPENING_SECONDS, CLOSING_SECONDS, COOLDOWN_SECONDS } from './shift';
import type { ShiftPhase } from './shift';

export type MazeShift = {
  phase: ShiftPhase; phaseSeconds: number; openness: MazeOpenness;
  target: MazeGateId; settled: MazeGateId; completedShifts: number; notice: string;
  revision: number; validation: TopologyCheck | null;
};
export function createMazeShift(): MazeShift {
  return { phase: 'idle', phaseSeconds: 0, openness: { north: 1, east: 0 }, target: 'east', settled: 'north', completedShifts: 0,
    revision: 0, validation: null,
    notice: 'G swaps the NORTH and EAST shortcuts. Permanent corridors lead home.' };
}
export function requestMazeShift(state: MazeShift, layout: MazeLayout = HAND_BUILT_MAZE): MazeShift {
  if (state.phase !== 'idle') return { ...state, notice: 'Shift ignored: wait for this change and cooldown to finish.' };
  const planned = { north: Number(state.target === 'north'), east: Number(state.target === 'east') };
  const validation = validateMazeShiftPlan(layout, state.openness, planned);
  if (!validation.ok) return { ...state, validation, notice: `Shift rejected: ${validation.reason}` };
  return { ...state, phase: 'warning', phaseSeconds: 0, validation,
    notice: `${state.target.toUpperCase()} shortcut will open. Leave the other passage before the gap closes.` };
}
export function advanceMazeShift(state: MazeShift, dt: number, layout: MazeLayout = HAND_BUILT_MAZE): MazeShift {
  if (dt <= 0 || state.phase === 'idle') return state;
  const elapsed = state.phaseSeconds + dt;
  if (state.phase === 'warning' || state.phase === 'cooldown') {
    const duration = state.phase === 'warning' ? WARNING_SECONDS : COOLDOWN_SECONDS;
    return elapsed < duration - 1e-9 ? { ...state, phaseSeconds: elapsed }
      : { ...state, phase: state.phase === 'warning' ? 'opening' : 'idle', phaseSeconds: 0 };
  }
  const openness = { ...state.openness };
  const closing = MAZE_GATE_IDS.find((id) => id !== state.target)!;
  if (state.phase === 'opening') openness[state.target] = Math.min(1, openness[state.target] + dt / OPENING_SECONDS);
  else openness[closing] = Math.max(0, openness[closing] - dt / CLOSING_SECONDS);
  for (const id of MAZE_GATE_IDS) {
    if (openness[id] < 1e-9) openness[id] = 0;
    if (openness[id] > 1 - 1e-9) openness[id] = 1;
  }
  const validation = validateMazeTopology(layout, openness);
  if (!validation.ok) return { ...state, validation, notice: `Shift rejected: ${validation.reason}` };
  const changed = mazeTopologySignature(layout, state.openness) !== mazeTopologySignature(layout, openness);
  const finished = state.phase === 'opening' ? openness[state.target] === 1 : openness[closing] === 0;
  const committed = finished && state.phase === 'closing';
  return { ...state, openness, revision: state.revision + Number(changed), phaseSeconds: finished ? 0 : elapsed,
    phase: finished ? state.phase === 'opening' ? 'closing' : 'cooldown' : state.phase,
    settled: committed ? state.target : state.settled,
    target: committed ? closing : state.target,
    completedShifts: state.completedShifts + Number(committed),
    notice: committed ? 'Routes changed. Find a different way home; G is available after cooldown.' : state.notice,
  };
}
