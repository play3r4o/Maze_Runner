import { cellPosition, deriveMazeWalls, gateEdges, gateRect, inCellRoom, landmarkRect, layoutGateColliders, plazaRect } from '../simulation/maze';
import { overlapsBody } from '../simulation/movingWalls';
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

// Bounded record of what happened in this attempt, for the debug panel and bug reports.
export type RunEventKind = 'shift' | 'freeze' | 'teleport' | 'visit' | 'ring' | 'death' | 'return' | 'report';
export type RunEvent = { tick: number; kind: RunEventKind; detail: string };
export const RUN_EVENT_LIMIT = 50;

export type GeneratedRun = {
  player: PlayerState; visited: string[]; leftSanctuary: boolean; returned: boolean;
  shift: GeneratedShift; crushedBy: string | null; pushedBy: string | null;
  // Cell room the player is standing in, or null in a corridor; ring follows the last room entered.
  cell: string | null; ring: Ring;
  // Fixed 1/60 s simulation ticks since the attempt started.
  tick: number;
  // Ticks the current (or last) shift plan has actually advanced since it was accepted.
  // With the seed and request count this rebuilds gate poses exactly (see runReport.ts).
  shiftTicks: number;
  // Debug only: freeze stops gate motion and shift timers; walking continues.
  frozen: boolean; teleports: number; events: RunEvent[];
};
export function createGeneratedRun(world: GeneratedWorld): GeneratedRun {
  return { player: { x: 0, z: 0, yaw: 0 }, visited: [], leftSanctuary: false, returned: false, cell: null, ring: 'sanctuary',
    shift: createGeneratedShift(world.maze), crushedBy: null, pushedBy: null,
    tick: 0, shiftTicks: 0, frozen: false, teleports: 0, events: [] };
}
export function addRunEvent(run: GeneratedRun, kind: RunEventKind, detail: string): RunEvent[] {
  return [...run.events, { tick: run.tick, kind, detail }].slice(-RUN_EVENT_LIMIT);
}
export function requestGeneratedRunShift(world: GeneratedWorld, run: GeneratedRun): GeneratedRun {
  if (run.crushedBy) return run;
  const shift = requestGeneratedShift(run.shift, world.maze);
  const entry = shift.log.at(-1);
  const accepted = run.shift.phase === 'idle' && shift.phase === 'warning';
  const detail = entry ? `${entry.outcome}${entry.plan ? ` ${entry.plan.open} opens, ${entry.plan.close} closes` : ''} (request ${entry.request + 1})` : 'request';
  return { ...run, shift, shiftTicks: accepted ? 0 : run.shiftTicks, events: addRunEvent(run, 'shift', detail) };
}
export function setGeneratedRunFrozen(run: GeneratedRun, frozen: boolean): GeneratedRun {
  if (run.frozen === frozen) return run;
  return { ...run, frozen, events: addRunEvent(run, 'freeze', frozen ? 'shift timers frozen' : 'shift timers resumed') };
}

// Debug teleport target: the centre of a cell's room, if it is clear of stone and gates.
export function teleportTarget(world: GeneratedWorld, run: GeneratedRun, cellId: string): { ok: true; x: number; z: number } | { ok: false; reason: string } {
  const cell = world.maze.cells.find((item) => item.id === cellId);
  if (!cell) return { ok: false, reason: `Unknown cell ${cellId}.` };
  if (run.crushedBy) return { ok: false, reason: 'Retry before teleporting.' };
  const { x, z } = cellPosition(cell, world.maze);
  const body = { x, z, yaw: run.player.yaw };
  const solids = [...world.solids, ...layoutGateColliders(world.maze, run.shift.openness)];
  const blocker = solids.find((rect) => overlapsBody(body, rect));
  return blocker ? { ok: false, reason: `${cellId} is blocked by ${blocker.id}.` } : { ok: true, x, z };
}
export function teleportGeneratedRun(world: GeneratedWorld, run: GeneratedRun, cellId: string): { run: GeneratedRun; error: string | null } {
  const target = teleportTarget(world, run, cellId);
  if (!target.ok) return { run, error: target.reason };
  const ring = world.maze.rings[cellId];
  return { error: null, run: { ...run, player: { ...run.player, x: target.x, z: target.z }, cell: cellId, ring,
    leftSanctuary: run.leftSanctuary || ring !== 'sanctuary', pushedBy: null, teleports: run.teleports + 1,
    events: addRunEvent(run, 'teleport', `to ${cellId} (${ring})`) } };
}

const insideRect = (player: PlayerState, rect: WallRect) =>
  player.x > rect.minX && player.x < rect.maxX && player.z > rect.minZ && player.z < rect.maxZ;

// Same order as the accepted M2 maze: advance gates, let closing stone push (or crush) the
// body, then apply walking against walls plus the gates' new poses. After death the gates
// keep moving but the body does not.
export function stepGeneratedRun(world: GeneratedWorld, previous: GeneratedRun, intent: MoveIntent, yaw: number, dt: number): GeneratedRun {
  const { maze } = world;
  const moving = !previous.frozen && previous.shift.phase !== 'idle';
  const run = { ...previous, tick: previous.tick + 1, shiftTicks: previous.shiftTicks + Number(moving) };
  const shift = previous.frozen ? run.shift : advanceGeneratedShift(run.shift, dt, maze);
  if (run.crushedBy) return { ...run, shift, pushedBy: null };
  const contact = resolveMovingWalls(run.player, gateEdges(maze).map((edge) => ({ id: edge.gate!,
    before: gateRect(maze, edge, run.shift.openness[edge.gate!]), after: gateRect(maze, edge, shift.openness[edge.gate!]),
    closing: shift.openness[edge.gate!] < run.shift.openness[edge.gate!] })), world.solids);
  if (contact.crushedBy) return { ...run, shift, ...contact, events: addRunEvent(run, 'death', `crushed by ${contact.crushedBy}`) };
  const player = stepPlayer({ ...contact.player, yaw }, intent, [...world.solids, ...layoutGateColliders(maze, shift.openness)], dt);
  const atHome = insideRect(player, world.plaza);
  const room = atHome ? maze.start : maze.cells.find((cell) => inCellRoom(player, cell.id, maze))?.id ?? null;
  const visited = [...run.visited];
  let events = run.events;
  const note = (kind: RunEventKind, detail: string) => { events = addRunEvent({ ...run, events }, kind, detail); };
  for (const landmark of maze.landmarks) {
    if (!visited.includes(landmark.id) && room === landmark.cell) { visited.push(landmark.id); note('visit', `${landmark.id} at ${room}`); }
  }
  const ring = room ? maze.rings[room] : run.ring;
  if (ring !== run.ring) note('ring', `${run.ring} → ${ring}${room ? ` at ${room}` : ''}`);
  const returned = run.returned || (run.leftSanctuary && atHome && visited.length === maze.landmarks.length);
  if (returned && !run.returned) note('return', `home after ${visited.length} landmarks${run.teleports ? `, ${run.teleports} teleports` : ''}`);
  return {
    ...run, ...contact, shift, player, visited, cell: room, ring, events, returned,
    leftSanctuary: run.leftSanctuary || !atHome,
  };
}
