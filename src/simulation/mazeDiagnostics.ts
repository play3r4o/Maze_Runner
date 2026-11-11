import { HAND_BUILT_MAZE, MAZE_GATE_IDS, cellPosition, corridorRect, findCell, mazeGateRect, plazaRect } from './maze';
import type { MazeLayout, MazeOpenness } from './maze';
import type { MazeRun } from '../game/mazeRun';
import type { PlayerState } from './player';
import type { ShiftPhase } from './shift';
import { findMazeRoute, validateMazeTopology } from './mazeGraph';

// Dry run: propose blocking every Sanctuary connection (or the listed entrances) and report.
export function probeSanctuaryIsolation(layout: MazeLayout, openness: MazeOpenness, entrances?: readonly string[]) {
  const blockedEdges = entrances ? [...entrances]
    : layout.edges.filter((edge) => edge.a === layout.start || edge.b === layout.start).map((edge) => edge.id);
  return { blockedEdges, check: validateMazeTopology(layout, openness, blockedEdges) };
}

// Read-only snapshot of live state the debug map needs. Works for hand-built and generated layouts.
export type DebugView = {
  layout: MazeLayout; player: PlayerState; openness: MazeOpenness; crushed: boolean;
  phase: ShiftPhase; target: string; revision: number; validation: string | null;
};
export function debugViewOfMazeRun(run: MazeRun): DebugView {
  return { layout: HAND_BUILT_MAZE, player: run.player, openness: run.shift.openness, crushed: run.crushedBy !== null,
    phase: run.shift.phase, target: run.shift.target, revision: run.shift.revision, validation: run.shift.validation?.reason ?? null };
}

export function buildLayoutDiagnostics(view: DebugView) {
  const { layout, player, openness } = view;
  const plaza = plazaRect(layout);
  const inPlaza = plaza !== null && player.x >= plaza.minX && player.x <= plaza.maxX && player.z >= plaza.minZ && player.z <= plaza.maxZ;
  const room = inPlaza ? findCell(layout, layout.start) : layout.cells.find((cell) => {
    const { x, z } = cellPosition(cell, layout);
    return Math.abs(player.x - x) <= 2 && Math.abs(player.z - z) <= 2;
  });
  const passage = room ? undefined : layout.edges.find((edge) => {
    const rect = corridorRect(layout, edge);
    return player.x >= rect.minX && player.x <= rect.maxX && player.z >= rect.minZ && player.z <= rect.maxZ;
  });
  const blockedPassage = passage?.gate !== undefined && openness[passage.gate] !== 1;
  let origin = room?.id ?? null;
  if (!origin && passage && !blockedPassage) {
    const distance = (id: string) => {
      const position = cellPosition(findCell(layout, id), layout);
      return Math.hypot(player.x - position.x, player.z - position.z);
    };
    origin = distance(passage.a) <= distance(passage.b) ? passage.a : passage.b;
  }
  const route = !view.crushed && origin ? findMazeRoute(layout, openness, origin, layout.start) : null;
  const gateIds = MAZE_GATE_IDS.filter((id) => layout.edges.some((edge) => edge.gate === id));
  return {
    player: { ...player }, location: inPlaza ? 'Sanctuary plaza' : room?.id ?? passage?.id ?? 'Outside walkable maze',
    cell: room?.id ?? null, origin, route,
    routeNote: view.crushed ? 'Attempt ended. Retry to inspect a new route.'
      : blockedPassage ? 'Moving/closed gate passage: escape along it. No graph route preview.'
      : origin ? `Graph route from ${origin} to Sanctuary. Fully open gates only.` : 'No route origin in walkable geometry.',
    gates: gateIds.map((id) => ({ id, rect: mazeGateRect(id, openness[id]), openness: openness[id],
      status: view.phase === 'warning' && id !== view.target ? 'warning'
        : openness[id] === 1 ? 'open' : openness[id] === 0 ? 'closed'
          : view.phase === 'closing' && id !== view.target ? 'closing' : 'opening' })),
  };
}

export const buildMazeDiagnostics = (run: MazeRun) => buildLayoutDiagnostics(debugViewOfMazeRun(run));
