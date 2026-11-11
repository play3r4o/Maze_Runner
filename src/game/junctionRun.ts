import { GATE_IDS, gateColliders, gateRect, JUNCTION_SPAWN, JUNCTION_WALLS } from '../simulation/junction';
import type { GateId } from '../simulation/junction';
import { PLAYER_HALF_WIDTH, stepPlayer } from '../simulation/player';
import type { MoveIntent, PlayerState } from '../simulation/player';
import { advanceShift, createJunctionState, requestShift } from '../simulation/shift';
import type { JunctionState } from '../simulation/shift';

export type JunctionRun = {
  player: PlayerState;
  junction: JunctionState;
  crushedBy: GateId | null;
};

export function createJunctionRun(): JunctionRun {
  return { player: { ...JUNCTION_SPAWN }, junction: createJunctionState(), crushedBy: null };
}

// Translation is along one axis, so this union is the exact swept volume.
// Check the body footprint against physical stone, never the warning zone.
export function crushingGateBetween(before: JunctionState, after: JunctionState, player: PlayerState): GateId | null {
  const epsilon = 1e-8;
  for (const id of GATE_IDS) {
    if (after.openness[id] >= before.openness[id]) continue;
    const a = gateRect(id, before.openness[id]);
    const b = gateRect(id, after.openness[id]);
    if (player.x + PLAYER_HALF_WIDTH > Math.min(a.minX, b.minX) + epsilon
      && player.x - PLAYER_HALF_WIDTH < Math.max(a.maxX, b.maxX) - epsilon
      && player.z + PLAYER_HALF_WIDTH > Math.min(a.minZ, b.minZ) + epsilon
      && player.z - PLAYER_HALF_WIDTH < Math.max(a.maxZ, b.maxZ) - epsilon) return id;
  }
  return null;
}

export function requestRunShift(run: JunctionRun): JunctionRun {
  return run.crushedBy ? run : { ...run, junction: requestShift(run.junction) };
}

export function stepJunctionRun(run: JunctionRun, intent: MoveIntent, yaw: number, dtSeconds: number): JunctionRun {
  const junction = advanceShift(run.junction, dtSeconds);
  // Complete the mechanism's motion after death, without moving the player.
  if (run.crushedBy) return { ...run, junction };
  const crushedBy = crushingGateBetween(run.junction, junction, run.player);
  if (crushedBy) return { ...run, junction, crushedBy };
  const walls = [...JUNCTION_WALLS, ...gateColliders(junction.openness)];
  return { player: stepPlayer({ ...run.player, yaw }, intent, walls, dtSeconds), junction, crushedBy: null };
}
