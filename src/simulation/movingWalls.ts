import { movePlayerBy, PLAYER_HALF_WIDTH } from './player';
import type { PlayerState, WallRect } from './player';

const EPSILON = 1e-8;
export function overlapsBody(player: PlayerState, rect: WallRect): boolean {
  return player.x + PLAYER_HALF_WIDTH > rect.minX + EPSILON
    && player.x - PLAYER_HALF_WIDTH < rect.maxX - EPSILON
    && player.z + PLAYER_HALF_WIDTH > rect.minZ + EPSILON
    && player.z - PLAYER_HALF_WIDTH < rect.maxZ - EPSILON;
}

// Axis-aligned translating slabs share the same collision rules as walking.
export function resolveMovingWalls<Id extends string>(
  player: PlayerState,
  gates: readonly { id: Id; before: WallRect; after: WallRect; closing: boolean }[],
  staticWalls: readonly WallRect[],
): { player: PlayerState; crushedBy: Id | null; pushedBy: Id | null } {
  let pushed = player;
  let pushedBy: Id | null = null;
  for (const { id, before: a, after: b, closing } of gates) {
    if (!closing) continue;
    const swept = { ...b, minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX),
      minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) };
    if (!overlapsBody(pushed, swept)) continue;
    const horizontal = Math.abs(b.minX - a.minX) > EPSILON;
    const negative = horizontal ? b.minX < a.minX : b.minZ < a.minZ;
    const face = horizontal ? (negative ? b.minX : b.maxX) : (negative ? b.minZ : b.maxZ);
    const coordinate = pushed[horizontal ? 'x' : 'z'];
    const needed = negative ? Math.min(coordinate, face - PLAYER_HALF_WIDTH)
      : Math.max(coordinate, face + PLAYER_HALF_WIDTH);
    const blockers = [...staticWalls, ...gates.filter((gate) => gate.id !== id).map((gate) => gate.after)];
    pushed = movePlayerBy(pushed, horizontal ? needed - coordinate : 0, horizontal ? 0 : needed - coordinate, blockers);
    pushedBy = id;
    if (overlapsBody(pushed, b)) return { player: pushed, crushedBy: id, pushedBy: null };
  }
  return { player: pushed, crushedBy: null, pushedBy };
}
