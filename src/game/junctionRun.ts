import { GATE_IDS, gateColliders, gateRect, JUNCTION_SPAWN, JUNCTION_WALLS } from '../simulation/junction';
import type { GateId } from '../simulation/junction';
import { stepPlayer } from '../simulation/player';
import { resolveMovingWalls } from '../simulation/movingWalls';
import type { MoveIntent, PlayerState, WallRect } from '../simulation/player';
import { advanceShift, createJunctionState, requestShift } from '../simulation/shift';
import type { JunctionState } from '../simulation/shift';

export type JunctionRun = {
  player: PlayerState;
  junction: JunctionState;
  crushedBy: GateId | null;
  pushedBy: GateId | null;
};

export function createJunctionRun(): JunctionRun {
  return { player: { ...JUNCTION_SPAWN }, junction: createJunctionState(), crushedBy: null, pushedBy: null };
}

// A closing slab displaces the body ahead of its leading face. Sweep that
// displacement against real opposing solids; only an unresolved overlap crushes.
export function resolveClosingGatePush(
  before: JunctionState,
  after: JunctionState,
  player: PlayerState,
  staticWalls: readonly WallRect[] = JUNCTION_WALLS,
): Pick<JunctionRun, 'player' | 'crushedBy' | 'pushedBy'> {
  return resolveMovingWalls(player, GATE_IDS.map((id) => ({ id,
    before: gateRect(id, before.openness[id]), after: gateRect(id, after.openness[id]),
    closing: after.openness[id] < before.openness[id],
  })), staticWalls);
}

export function requestRunShift(run: JunctionRun): JunctionRun {
  return run.crushedBy ? run : { ...run, junction: requestShift(run.junction) };
}

export function stepJunctionRun(run: JunctionRun, intent: MoveIntent, yaw: number, dtSeconds: number): JunctionRun {
  const junction = advanceShift(run.junction, dtSeconds);
  // Complete the mechanism's motion after death, without moving the player.
  if (run.crushedBy) return { ...run, junction, pushedBy: null };
  const contact = resolveClosingGatePush(run.junction, junction, run.player);
  if (contact.crushedBy) return { ...run, junction, ...contact };
  const walls = [...JUNCTION_WALLS, ...gateColliders(junction.openness)];
  return { ...contact, player: stepPlayer({ ...contact.player, yaw }, intent, walls, dtSeconds), junction };
}
