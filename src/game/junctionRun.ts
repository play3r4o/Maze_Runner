import { GATE_IDS, gateColliders, gateRect, JUNCTION_SPAWN, JUNCTION_WALLS } from '../simulation/junction';
import type { GateId } from '../simulation/junction';
import { movePlayerBy, PLAYER_HALF_WIDTH, stepPlayer } from '../simulation/player';
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

const EPSILON = 1e-8;
function overlapsBody(player: PlayerState, rect: WallRect): boolean {
  return player.x + PLAYER_HALF_WIDTH > rect.minX + EPSILON
    && player.x - PLAYER_HALF_WIDTH < rect.maxX - EPSILON
    && player.z + PLAYER_HALF_WIDTH > rect.minZ + EPSILON
    && player.z - PLAYER_HALF_WIDTH < rect.maxZ - EPSILON;
}

// A closing slab displaces the body ahead of its leading face. Sweep that
// displacement against real opposing solids; only an unresolved overlap crushes.
export function resolveClosingGatePush(
  before: JunctionState,
  after: JunctionState,
  player: PlayerState,
  staticWalls: readonly WallRect[] = JUNCTION_WALLS,
): Pick<JunctionRun, 'player' | 'crushedBy' | 'pushedBy'> {
  let pushed = player;
  let pushedBy: GateId | null = null;
  for (const id of GATE_IDS) {
    if (after.openness[id] >= before.openness[id]) continue;
    const a = gateRect(id, before.openness[id]);
    const b = gateRect(id, after.openness[id]);
    const swept = { ...b, minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
      minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) };
    if (!overlapsBody(pushed, swept)) continue;

    const horizontal = Math.abs(b.minX - a.minX) > EPSILON;
    const negative = horizontal ? b.minX < a.minX : b.minZ < a.minZ;
    const face = horizontal ? (negative ? b.minX : b.maxX) : (negative ? b.minZ : b.maxZ);
    const coordinate = pushed[horizontal ? 'x' : 'z'];
    const needed = negative ? Math.min(coordinate, face - PLAYER_HALF_WIDTH)
      : Math.max(coordinate, face + PLAYER_HALF_WIDTH);
    const blockers = [...staticWalls, ...gateColliders(after.openness).filter((rect) => rect.id !== b.id)];
    pushed = movePlayerBy(pushed, horizontal ? needed - coordinate : 0, horizontal ? 0 : needed - coordinate, blockers);
    pushedBy = id;
    if (overlapsBody(pushed, b)) return { player: pushed, crushedBy: id, pushedBy: null };
  }
  return { player: pushed, crushedBy: null, pushedBy };
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
