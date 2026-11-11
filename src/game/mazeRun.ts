import { HAND_BUILT_MAZE, MAZE_GATE_IDS, MAZE_SOLIDS, MAZE_SPAWN, inCellRoom, mazeGateRect, mazeGateColliders } from '../simulation/maze';
import type { MazeGateId } from '../simulation/maze';
import { createMazeShift, advanceMazeShift, requestMazeShift } from '../simulation/mazeShift';
import type { MazeShift } from '../simulation/mazeShift';
import { resolveMovingWalls } from '../simulation/movingWalls';
import { stepPlayer } from '../simulation/player';
import type { MoveIntent, PlayerState } from '../simulation/player';

export type MazeRun = {
  player: PlayerState; shift: MazeShift; crushedBy: MazeGateId | null; pushedBy: MazeGateId | null;
  visited: string[]; leftSanctuary: boolean; returned: boolean;
};
export function createMazeRun(): MazeRun {
  return { player: { ...MAZE_SPAWN }, shift: createMazeShift(), crushedBy: null, pushedBy: null,
    visited: [], leftSanctuary: false, returned: false };
}
export function requestMazeRunShift(run: MazeRun): MazeRun {
  return run.crushedBy ? run : { ...run, shift: requestMazeShift(run.shift) };
}
export function stepMazeRun(run: MazeRun, intent: MoveIntent, yaw: number, dt: number): MazeRun {
  const shift = advanceMazeShift(run.shift, dt);
  if (run.crushedBy) return { ...run, shift, pushedBy: null };
  const contact = resolveMovingWalls(run.player, MAZE_GATE_IDS.map((id) => ({ id,
    before: mazeGateRect(id, run.shift.openness[id]), after: mazeGateRect(id, shift.openness[id]),
    closing: shift.openness[id] < run.shift.openness[id],
  })), MAZE_SOLIDS);
  if (contact.crushedBy) return { ...run, shift, ...contact };
  const player = stepPlayer({ ...contact.player, yaw }, intent, [...MAZE_SOLIDS, ...mazeGateColliders(shift.openness)], dt);
  const visited = [...run.visited];
  for (const landmark of HAND_BUILT_MAZE.landmarks) {
    if (!visited.includes(landmark.id) && inCellRoom(player, landmark.cell)) visited.push(landmark.id);
  }
  const atHome = inCellRoom(player, HAND_BUILT_MAZE.start);
  return { ...run, ...contact, player, shift, visited, leftSanctuary: run.leftSanctuary || !atHome,
    returned: run.returned || (run.leftSanctuary && atHome && visited.length === HAND_BUILT_MAZE.landmarks.length) };
}
