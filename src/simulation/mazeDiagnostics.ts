import { HAND_BUILT_MAZE, MAZE_GATE_IDS, cellPosition, corridorRect, mazeGateRect } from './maze';
import type { MazeLayout, MazeOpenness } from './maze';
import type { MazeRun } from '../game/mazeRun';
import { findMazeRoute, validateMazeTopology } from './mazeGraph';

export function probeSanctuaryIsolation(layout: MazeLayout, openness: MazeOpenness) {
  const blockedEdges = layout.edges.filter((edge) => edge.a === layout.start || edge.b === layout.start).map((edge) => edge.id);
  return { blockedEdges, check: validateMazeTopology(layout, openness, blockedEdges) };
}

export function buildMazeDiagnostics(run: MazeRun) {
  const layout = HAND_BUILT_MAZE;
  const room = layout.cells.find((cell) => {
    const { x, z } = cellPosition(cell);
    return Math.abs(run.player.x - x) <= 2 && Math.abs(run.player.z - z) <= 2;
  });
  const passage = room ? undefined : layout.edges.find((edge) => {
    const rect = corridorRect(layout, edge);
    return run.player.x >= rect.minX && run.player.x <= rect.maxX && run.player.z >= rect.minZ && run.player.z <= rect.maxZ;
  });
  const blockedPassage = passage?.gate !== undefined && run.shift.openness[passage.gate] !== 1;
  let origin = room?.id ?? null;
  if (!origin && passage && !blockedPassage) {
    const distance = (id: string) => {
      const position = cellPosition(layout.cells.find((cell) => cell.id === id)!);
      return Math.hypot(run.player.x - position.x, run.player.z - position.z);
    };
    origin = distance(passage.a) <= distance(passage.b) ? passage.a : passage.b;
  }
  const route = !run.crushedBy && origin ? findMazeRoute(layout, run.shift.openness, origin, layout.start) : null;
  return {
    player: { ...run.player }, location: room?.id ?? passage?.id ?? 'Outside walkable maze', origin, route,
    routeNote: run.crushedBy ? 'Attempt ended. Retry to inspect a new route.'
      : blockedPassage ? 'Moving/closed gate passage: escape along it. No graph route preview.'
      : origin ? `Graph route from ${origin} to Sanctuary. Fully open gates only.` : 'No route origin in walkable geometry.',
    gates: MAZE_GATE_IDS.map((id) => ({ id, rect: mazeGateRect(id, run.shift.openness[id]), openness: run.shift.openness[id],
      status: run.shift.phase === 'warning' && id !== run.shift.target ? 'warning'
        : run.shift.openness[id] === 1 ? 'open' : run.shift.openness[id] === 0 ? 'closed'
          : run.shift.phase === 'closing' && id !== run.shift.target ? 'closing' : 'opening' })),
  };
}
