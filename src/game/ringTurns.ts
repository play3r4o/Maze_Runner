// M18 rework: the rings turn on each bell, and whoever is inside rides them. At every dusk
// bell the doors of the turning ring slide shut (they push and crush like any gate), the ring
// stays sealed while it turns a quarter, then the doors open onto different corridors. Bell 1
// turns the outer ring, bell 2 the middle ring, bell 3 both (the outer clockwise, the middle
// the other way). Pure functions of the run clock, so a bug report replays them from runTicks.
import { BELL_TICKS } from './pressure';
import { parseRingGate } from '../simulation/octagon';
import { LOBBY_GATE } from '../simulation/mazeGraph';
import { RING_TURN, ticks } from './tuning';

export type TurningRing = 'inner' | 'middle'; // tier keys: 'inner' is the octagon's outer ring
export type RingPhase = 'closing' | 'sealed' | 'opening';
export type RingTurn = { index: number; rings: readonly TurningRing[]; phase: RingPhase; secondsLeft: number };
export type RingTurns = Readonly<Record<TurningRing, number>>; // quarter turns so far (mod 4, signed by direction)
export const NO_TURNS: RingTurns = { inner: 0, middle: 0 };

const RINGS_AT_BELL: readonly (readonly TurningRing[])[] = [['inner'], ['middle'], ['inner', 'middle']];
export const TURN_DIRECTION: Readonly<Record<TurningRing, 1 | -1>> = { inner: 1, middle: -1 };
const T = { closing: ticks(RING_TURN.closing), sealed: ticks(RING_TURN.sealed), opening: ticks(RING_TURN.opening) };
const TOTAL = T.closing + T.sealed + T.opening;

// The turn under way at this run tick, if any (only while dusk, and so the bells, are on).
export function ringTurnAt(runTicks: number, dusk = true): RingTurn | null {
  if (!dusk) return null;
  for (let index = 0; index < BELL_TICKS.length; index++) {
    const u = runTicks - BELL_TICKS[index];
    if (u < 0 || u >= TOTAL) continue;
    const ends = [T.closing, T.closing + T.sealed, TOTAL];
    const at = ends.findIndex((end) => u < end);
    return { index, rings: RINGS_AT_BELL[index], phase: (['closing', 'sealed', 'opening'] as const)[at], secondsLeft: (ends[at] - u) / 60 };
  }
  return null;
}
export const nextRingTurn = (runTicks: number, dusk = true) => {
  if (!dusk) return null;
  const index = BELL_TICKS.findIndex((tick) => tick > runTicks);
  return index < 0 ? null : { index, rings: RINGS_AT_BELL[index], seconds: (BELL_TICKS[index] - runTicks) / 60 };
};
// The moment a ring actually turns: the middle of its sealed phase.
const turnTick = (index: number) => BELL_TICKS[index] + T.closing + Math.floor(T.sealed / 2);
// Quarter turns completed by this tick.
export function turnsAt(runTicks: number, dusk = true): RingTurns {
  const turns = { inner: 0, middle: 0 };
  if (!dusk) return turns;
  BELL_TICKS.forEach((_, index) => {
    if (runTicks >= turnTick(index)) for (const ring of RINGS_AT_BELL[index]) turns[ring] = (turns[ring] + TURN_DIRECTION[ring] + 4) % 4;
  });
  return turns;
}
export const sameTurns = (a: RingTurns, b: RingTurns) => a.inner === b.inner && a.middle === b.middle;

// Which doors seal when a ring turns: the outer ring's doors are the home gate and the ring
// doors into the middle ring; the middle ring's are the ring doors on both its sides.
const sealsFor = (gate: string, ring: TurningRing) => {
  const door = parseRingGate(gate);
  if (ring === 'inner') return gate === LOBBY_GATE || door?.boundary === 1;
  return door !== null;
};
// How far a scheduled door is held shut by a ring turn (1 = free, 0 = sealed); null for any
// other gate. The home gate's own lobby timing is applied separately.
export function ringDoorOpenness(gate: string, runTicks: number, dusk = true): number | null {
  if (gate !== LOBBY_GATE && !parseRingGate(gate)) return null;
  const turn = ringTurnAt(runTicks, dusk);
  if (!turn || !turn.rings.some((ring) => sealsFor(gate, ring))) return 1;
  const u = runTicks - BELL_TICKS[turn.index];
  if (turn.phase === 'closing') return Math.max(0, 1 - u / T.closing);
  if (turn.phase === 'sealed') return 0;
  return Math.min(1, (u - T.closing - T.sealed) / T.opening);
}
export const RING_NAMES: Readonly<Record<TurningRing, string>> = { inner: 'outer ring', middle: 'middle ring' };
export const ringsLabel = (rings: readonly TurningRing[]) => rings.length > 1 ? 'outer and middle rings' : RING_NAMES[rings[0]];
