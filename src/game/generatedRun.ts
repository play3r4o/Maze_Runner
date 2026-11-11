import { deriveMazeWalls, inCellRoom, landmarkRect, plazaRect } from '../simulation/maze';
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
  // Cell room the player is standing in, or null in a corridor; ring follows the last room entered.
  cell: string | null; ring: Ring;
};
export function createGeneratedRun(): GeneratedRun {
  return { player: { x: 0, z: 0, yaw: 0 }, visited: [], leftSanctuary: false, returned: false, cell: null, ring: 'sanctuary' };
}

const insideRect = (player: PlayerState, rect: WallRect) =>
  player.x > rect.minX && player.x < rect.maxX && player.z > rect.minZ && player.z < rect.maxZ;

export function stepGeneratedRun(world: GeneratedWorld, run: GeneratedRun, intent: MoveIntent, yaw: number, dt: number): GeneratedRun {
  const player = stepPlayer({ ...run.player, yaw }, intent, world.solids, dt);
  const { maze } = world;
  const atHome = insideRect(player, world.plaza);
  const room = atHome ? maze.start : maze.cells.find((cell) => inCellRoom(player, cell.id, maze))?.id ?? null;
  const visited = [...run.visited];
  for (const landmark of maze.landmarks) {
    if (!visited.includes(landmark.id) && room === landmark.cell) visited.push(landmark.id);
  }
  return {
    player, visited, cell: room, ring: room ? maze.rings[room] : run.ring,
    leftSanctuary: run.leftSanctuary || !atHome,
    returned: run.returned || (run.leftSanctuary && atHome && visited.length === maze.landmarks.length),
  };
}
