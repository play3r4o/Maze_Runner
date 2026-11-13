// M18 stage 2: the rings seal and turn. On a fixed schedule of the run clock, one ring
// boundary at a time warns, its open ring doors slide shut (pushing and crushing like any
// gate), it stays sealed while the ring turns, then the other half of its doors opens: the
// ways through have moved round by one side (45°). Pure function of the run clock, so a bug
// report replays it from runTicks alone.
import { parseRingGate } from '../simulation/octagon';
import { RING_TURN, ticks } from './tuning';

export type RingPhase = 'warning' | 'closing' | 'sealed' | 'opening';
export type RingTurn = { index: number; boundary: 1 | 2; phase: RingPhase; secondsLeft: number };

const T = {
  first: ticks(RING_TURN.first), every: ticks(RING_TURN.every), warning: ticks(RING_TURN.warning),
  closing: ticks(RING_TURN.closing), sealed: ticks(RING_TURN.sealed), opening: ticks(RING_TURN.opening),
};
const TOTAL = T.warning + T.closing + T.sealed + T.opening;
const boundaryOf = (index: number): 1 | 2 => (index % 2 === 0 ? 1 : 2);

// The turn under way at this run tick, if any.
export function ringTurnAt(runTicks: number): RingTurn | null {
  if (runTicks < T.first) return null;
  const index = Math.floor((runTicks - T.first) / T.every);
  const u = runTicks - T.first - index * T.every;
  if (u >= TOTAL) return null;
  const ends = [T.warning, T.warning + T.closing, T.warning + T.closing + T.sealed, TOTAL];
  const phases: RingPhase[] = ['warning', 'closing', 'sealed', 'opening'];
  const at = ends.findIndex((end) => u < end);
  return { index, boundary: boundaryOf(index), phase: phases[at], secondsLeft: (ends[at] - u) / 60 };
}
// The next turn to start after this tick (for the HUD countdown).
export function nextRingTurn(runTicks: number): { index: number; boundary: 1 | 2; seconds: number } {
  const index = runTicks < T.first ? 0 : Math.floor((runTicks - T.first) / T.every) + 1;
  return { index, boundary: boundaryOf(index), seconds: (T.first + index * T.every - runTicks) / 60 };
}
// Turns of this boundary fully finished by this tick.
function turnsDone(boundary: 1 | 2, runTicks: number) {
  if (runTicks < T.first + TOTAL) return 0;
  const finished = Math.floor((runTicks - T.first - TOTAL) / T.every) + 1; // turns 0..finished-1 are over
  return boundary === 1 ? Math.ceil(finished / 2) : Math.floor(finished / 2);
}

// Openness of one ring door at a run tick (null if the gate is not a ring door).
export function ringDoorOpenness(gate: string, runTicks: number): number | null {
  const door = parseRingGate(gate);
  if (!door) return null;
  const done = turnsDone(door.boundary, runTicks);
  const openNow = door.slot % 2 === done % 2;
  const turn = ringTurnAt(runTicks);
  if (!turn || turn.boundary !== door.boundary) return openNow ? 1 : 0;
  const u = runTicks - T.first - turn.index * T.every;
  if (turn.phase === 'warning') return openNow ? 1 : 0;
  if (turn.phase === 'closing') return openNow ? Math.max(0, 1 - (u - T.warning) / T.closing) : 0;
  if (turn.phase === 'sealed') return 0;
  return openNow ? 0 : Math.min(1, (u - T.warning - T.closing - T.sealed) / T.opening);
}
export const RING_BOUNDARY_NAMES = { 1: 'outer ring', 2: 'core' } as const;
