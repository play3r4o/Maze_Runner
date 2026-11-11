import type { MazeLayout, MazeOpenness } from './maze';

export type TopologyCheck = { ok: boolean; reason: string; reachableCount: number; unreachable: string[] };
export type MazeRoute = { cells: string[]; edges: string[] };

export function mazeLayoutErrors(layout: MazeLayout): string[] {
  const errors: string[] = [];
  const cells = new Map(layout.cells.map((cell) => [cell.id, cell]));
  if (cells.size !== layout.cells.length) errors.push('Duplicate cell IDs.');
  if (!cells.has(layout.start)) errors.push('Sanctuary cell is missing.');
  const positions = new Set<string>();
  for (const cell of layout.cells) {
    if (!cell.id || !Number.isInteger(cell.column) || !Number.isInteger(cell.row)) errors.push(`Invalid cell: ${cell.id}.`);
    const key = `${cell.column},${cell.row}`;
    if (positions.has(key)) errors.push(`Duplicate grid position: ${key}.`);
    positions.add(key);
  }
  const ids = new Set<string>(), pairs = new Set<string>(), gates = new Set<string>();
  for (const edge of layout.edges) {
    if (!edge.id || ids.has(edge.id)) errors.push(`Duplicate or empty edge ID: ${edge.id}.`);
    ids.add(edge.id);
    const a = cells.get(edge.a), b = cells.get(edge.b);
    if (!a || !b) errors.push(`Unknown endpoint on ${edge.id}.`);
    else if (Math.abs(a.column - b.column) + Math.abs(a.row - b.row) !== 1) errors.push(`Nonadjacent endpoints on ${edge.id}.`);
    const pair = [edge.a, edge.b].sort().join('--');
    if (pairs.has(pair)) errors.push(`Duplicate connection: ${edge.id}.`);
    pairs.add(pair);
    if (edge.gate && gates.has(edge.gate)) errors.push(`Duplicate gate ID: ${edge.gate}.`);
    if (edge.gate) gates.add(edge.gate);
  }
  const landmarks = new Set<string>();
  for (const landmark of layout.landmarks) {
    if (!landmark.id || landmarks.has(landmark.id)) errors.push(`Duplicate or empty landmark ID: ${landmark.id}.`);
    if (!cells.has(landmark.cell)) errors.push(`Unknown landmark cell: ${landmark.id}.`);
    landmarks.add(landmark.id);
  }
  return errors;
}

export function openMazeEdges(layout: MazeLayout, openness: MazeOpenness, blocked: readonly string[] = []) {
  const excluded = new Set(blocked);
  return layout.edges.filter((edge) => !excluded.has(edge.id) && (!edge.gate || openness[edge.gate] === 1))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function adjacency(layout: MazeLayout, openness: MazeOpenness, blocked: readonly string[]) {
  const links = new Map(layout.cells.map((cell) => [cell.id, [] as { cell: string; edge: string }[]]));
  for (const edge of openMazeEdges(layout, openness, blocked)) {
    if (!links.has(edge.a) || !links.has(edge.b)) continue;
    links.get(edge.a)!.push({ cell: edge.b, edge: edge.id });
    links.get(edge.b)!.push({ cell: edge.a, edge: edge.id });
  }
  return links;
}
export function reachableMazeCells(layout: MazeLayout, openness: MazeOpenness, from: string, blocked: readonly string[] = []): Set<string> {
  const links = adjacency(layout, openness, blocked);
  const reached = new Set<string>();
  if (!links.has(from)) return reached;
  const queue = [from]; reached.add(from);
  for (let i = 0; i < queue.length; i++) for (const next of links.get(queue[i])!) {
    if (!reached.has(next.cell)) { reached.add(next.cell); queue.push(next.cell); }
  }
  return reached;
}
export function findMazeRoute(layout: MazeLayout, openness: MazeOpenness, from: string, to: string): MazeRoute | null {
  const links = adjacency(layout, openness, []);
  if (!links.has(from) || !links.has(to)) return null;
  const parents = new Map<string, { cell: string; edge: string } | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !parents.has(to); i++) for (const next of links.get(queue[i])!) {
    if (!parents.has(next.cell)) { parents.set(next.cell, { cell: queue[i], edge: next.edge }); queue.push(next.cell); }
  }
  if (!parents.has(to)) return null;
  const cells = [to], edges: string[] = [];
  let cursor = to;
  while (cursor !== from) {
    const previous = parents.get(cursor)!;
    if (!previous) return null;
    edges.push(previous.edge); cells.push(previous.cell); cursor = previous.cell;
  }
  return { cells: cells.reverse(), edges: edges.reverse() };
}
export function validateMazeTopology(layout: MazeLayout, openness: MazeOpenness, blocked: readonly string[] = []): TopologyCheck {
  const errors = mazeLayoutErrors(layout);
  for (const edge of layout.edges) {
    if (edge.gate && (!Number.isFinite(openness[edge.gate]) || openness[edge.gate] < 0 || openness[edge.gate] > 1)) {
      errors.push(`Invalid openness for gate ${edge.gate}.`);
    }
  }
  if (blocked.some((id) => !layout.edges.some((edge) => edge.id === id))) errors.push('Candidate contains an unknown edge ID.');
  if (errors.length) return { ok: false, reason: errors.join(' '), reachableCount: 0, unreachable: layout.cells.map((cell) => cell.id) };
  const reachable = reachableMazeCells(layout, openness, layout.start, blocked);
  const unreachable = layout.cells.filter((cell) => !reachable.has(cell.id)).map((cell) => cell.id);
  return { ok: unreachable.length === 0, reachableCount: reachable.size, unreachable,
    reason: unreachable.length ? `${unreachable.length} of ${layout.cells.length} cells lose their route to Sanctuary: ${unreachable.join(', ')}.`
      : `All ${layout.cells.length} cells have a route to Sanctuary.` };
}
export function validateMazeShiftPlan(layout: MazeLayout, current: MazeOpenness, planned: MazeOpenness): TopologyCheck {
  if ([planned.north, planned.east].some((value) => value !== 0 && value !== 1)) {
    return { ok: false, reason: 'A shift target must use fully open or closed gates.', reachableCount: 0, unreachable: [] };
  }
  const opening = { north: Math.max(current.north, planned.north), east: Math.max(current.east, planned.east) };
  for (const [stage, pose] of [['Current', current], ['Opening', opening], ['Target', planned]] as const) {
    const check = validateMazeTopology(layout, pose);
    if (!check.ok) return { ...check, reason: `${stage} maze rejected. ${check.reason}` };
  }
  return { ...validateMazeTopology(layout, planned), reason: 'Accepted: current, opening and target graphs retain every route to Sanctuary.' };
}

export function mazeTopologySignature(layout: MazeLayout, openness: MazeOpenness): string {
  return openMazeEdges(layout, openness).map((edge) => edge.id).join('|');
}
