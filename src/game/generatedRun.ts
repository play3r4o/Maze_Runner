import { deriveMazeWalls, gateEdges, gateRect, inCellRoom, landmarkRect, layoutGateColliders, plazaRect } from '../simulation/maze';
import { advanceGeneratedShift, createGeneratedShift, requestGeneratedShift } from '../simulation/generatedShift';
import type { GeneratedShift } from '../simulation/generatedShift';
import { resolveMovingWalls } from '../simulation/movingWalls';
import type { WallRect } from '../simulation/player';
import { stepPlayer } from '../simulation/player';
import type { MoveIntent, PlayerState } from '../simulation/player';
import type { GeneratedMaze, Ring } from '../simulation/mazeGenerator';

// Everything physical derived once from a generated layout. Rendering, collision and the
// debug map all read these same descriptors; nothing is hand-placed separately.
export type GeneratedWorld = { maze: GeneratedMaze; walls: WallRect[]; solids: WallRect[]; plaza: WallRect };
export function buildGeneratedWorld(maze: GeneratedMaze): GeneratedWorld {
  const walls = deriveMazeWalls(maze);
  return { maze, walls, solids: [...walls, ...maze.landmarks.map((landmark) => landmarkRect(landmark, maze))], plaza: plazaRect(maze)! };
}

export type GeneratedRun = {
  player: PlayerState; visited: string[]; leftSanctuary: boolean; returned: boolean;
  shift: GeneratedShift; crushedBy: string | null; pushedBy: string | null;
  // Cell room the player is standing in, or null in a corridor; ring follows the last room entered.
  cell: string | null; ring: Ring;
};
export function createGeneratedRun(world: GeneratedWorld): GeneratedRun {
  return { player: { x: 0, z: 0, yaw: 0 }, visited: [], leftSanctuary: false, returned: false, cell: null, ring: 'sanctuary',
    shift: createGeneratedShift(world.maze), crushedBy: null, pushedBy: null };
}
export function requestGeneratedRunShift(world: GeneratedWorld, run: GeneratedRun): GeneratedRun {
  return run.crushedBy ? run : { ...run, shift: requestGeneratedShift(run.shift, world.maze) };
}

const insideRect = (player: PlayerState, rect: WallRect) =>
  player.x > rect.minX && player.x < rect.maxX && player.z > rect.minZ && player.z < rect.maxZ;

// Same order as the accepted M2 maze: advance gates, let closing stone push (or crush) the
// body, then apply walking against walls plus the gates' new poses. After death the gates
// keep moving but the body does not.
export function stepGeneratedRun(world: GeneratedWorld, run: GeneratedRun, intent: MoveIntent, yaw: number, dt: number): GeneratedRun {
  const { maze } = world;
  const shift = advanceGeneratedShift(run.shift, dt, maze);
  if (run.crushedBy) return { ...run, shift, pushedBy: null };
  const contact = resolveMovingWalls(run.player, gateEdges(maze).map((edge) => ({ id: edge.gate!,
    before: gateRect(maze, edge, run.shift.openness[edge.gate!]), after: gateRect(maze, edge, shift.openness[edge.gate!]),
    closing: shift.openness[edge.gate!] < run.shift.openness[edge.gate!] })), world.solids);
  if (contact.crushedBy) return { ...run, shift, ...contact };
  const player = stepPlayer({ ...contact.player, yaw }, intent, [...world.solids, ...layoutGateColliders(maze, shift.openness)], dt);
  const atHome = insideRect(player, world.plaza);
  const room = atHome ? maze.start : maze.cells.find((cell) => inCellRoom(player, cell.id, maze))?.id ?? null;
  const visited = [...run.visited];
  for (const landmark of maze.landmarks) {
    if (!visited.includes(landmark.id) && room === landmark.cell) visited.push(landmark.id);
  }
  return {
    ...run, ...contact, shift, player, visited, cell: room, ring: room ? maze.rings[room] : run.ring,
    leftSanctuary: run.leftSanctuary || !atHome,
    returned: run.returned || (run.leftSanctuary && atHome && visited.length === maze.landmarks.length),
  };
}
