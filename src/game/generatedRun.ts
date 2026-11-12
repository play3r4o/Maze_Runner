import { cellPosition, corridorRect, deriveMazeWalls, gateEdges, gateRect, inCellRoom, landmarkRect, layoutGateColliders, plazaRect } from '../simulation/maze';
import { overlapsBody } from '../simulation/movingWalls';
import { advanceGeneratedShift, createGeneratedShift, requestGeneratedShift } from '../simulation/generatedShift';
import type { GeneratedShift } from '../simulation/generatedShift';
import { resolveMovingWalls } from '../simulation/movingWalls';
import type { WallRect } from '../simulation/player';
import { stepPlayer } from '../simulation/player';
import type { MoveIntent, PlayerState } from '../simulation/player';
import { createRng } from '../simulation/mazeGenerator';
import type { GeneratedMaze, Ring } from '../simulation/mazeGenerator';
import { findMazeRoute } from '../simulation/mazeGraph';
import { FIXED_DT } from '../loop';
import { CLOSING_SECONDS, OPENING_SECONDS } from '../simulation/shift';
import { AUTO_SHIFT_SECONDS, CHALK_CHARGES, RELIC_REACH, ticks } from './tuning';
import { ALL_RULES_ON, BELL_TICKS, HEADING_NAMES, SOUND_LIMIT, autoShiftTicks, bellsDue, headingIndexForYaw } from './pressure';
import type { ChalkMark, RuleKey, RuleToggles, SoundEvent, SoundKind } from './pressure';

export { AUTO_SHIFT_SECONDS, RELIC_REACH };
// Base interval in steps (no unrest, daytime). The live interval comes from autoShiftTicks().
export const AUTO_SHIFT_TICKS = ticks(AUTO_SHIFT_SECONDS);

// One relic per seed, at the centre of an outer-ring room in the farther half of outer rooms
// by static route length (gates closed), never a landmark room. Seeded, so reports reproduce it.
export type RelicSpot = { cell: string; x: number; z: number };
export function placeRelic(maze: GeneratedMaze): RelicSpot {
  const taken = new Set(maze.landmarks.map((landmark) => landmark.cell));
  const outer = maze.cells.filter((cell) => maze.rings[cell.id] === 'outer' && !taken.has(cell.id))
    .map((cell) => ({ cell, length: findMazeRoute(maze, {}, cell.id, maze.start)!.edges.length }));
  const lengths = outer.map((item) => item.length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)];
  const far = outer.filter((item) => item.length >= median).map((item) => item.cell);
  const cell = createRng((maze.seed ^ 0x5bd1e995) >>> 0).pick(far);
  return { cell: cell.id, ...cellPosition(cell, maze) };
}

// Everything physical derived once from a generated layout. Rendering, collision and the
// debug map all read these same descriptors; nothing is hand-placed separately.
export type GeneratedWorld = { maze: GeneratedMaze; walls: WallRect[]; solids: WallRect[]; plaza: WallRect; relic: RelicSpot };
export function buildGeneratedWorld(maze: GeneratedMaze): GeneratedWorld {
  const walls = deriveMazeWalls(maze);
  return { maze, walls, solids: [...walls, ...maze.landmarks.map((landmark) => landmarkRect(landmark, maze))], plaza: plazaRect(maze)!,
    relic: placeRelic(maze) };
}

// Bounded record of what happened in this attempt, for the debug panel and bug reports.
export type RunEventKind = 'shift' | 'freeze' | 'teleport' | 'visit' | 'ring' | 'death' | 'return' | 'report' | 'run' | 'relic'
  | 'bell' | 'chalk' | 'rules';
// ready: in Sanctuary, clock not started. out: the expedition is running. The other three are
// terminal: each run reaches exactly one of them, once.
export type RunStatus = 'ready' | 'out' | 'extracted' | 'failed' | 'abandoned';
export const isRunOver = (status: RunStatus) => status === 'extracted' || status === 'failed' || status === 'abandoned';
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
  // M7 expedition: status, whether the relic is carried, run clock (ticks while out and alive),
  // and idle ticks towards the next automatic shift.
  status: RunStatus; carrying: boolean; runTicks: number; autoTicks: number;
  // M7b: rule toggles, chalk marks and charges left, bells already rung, and the last sounds
  // (bounded; the audio module plays ids it has not played yet).
  rules: RuleToggles; chalk: ChalkMark[]; chalkLeft: number; bells: number; sounds: SoundEvent[]; nextSoundId: number;
};
export function createGeneratedRun(world: GeneratedWorld, rules: RuleToggles = ALL_RULES_ON): GeneratedRun {
  return { player: { x: 0, z: 0, yaw: 0 }, visited: [], leftSanctuary: false, returned: false, cell: null, ring: 'sanctuary',
    shift: createGeneratedShift(world.maze), crushedBy: null, pushedBy: null,
    tick: 0, shiftTicks: 0, frozen: false, teleports: 0, events: [],
    status: 'ready', carrying: false, runTicks: 0, autoTicks: 0,
    rules: { ...rules }, chalk: [], chalkLeft: CHALK_CHARGES, bells: 0, sounds: [], nextSoundId: 1 };
}

// T3: queue a positioned sound if sound is enabled. Returns the updated sound fields.
function withSound(run: GeneratedRun, kind: SoundKind, x: number, z: number, extra: { seconds?: number; strikes?: number } = {}) {
  if (!run.rules.sound) return run;
  const sound: SoundEvent = { id: run.nextSoundId, kind, x, z, tick: run.tick, ...extra };
  return { ...run, sounds: [...run.sounds, sound].slice(-SOUND_LIMIT), nextSoundId: run.nextSoundId + 1 };
}
const gateCentre = (world: GeneratedWorld, gate: string) => {
  const rect = corridorRect(world.maze, world.maze.edges.find((edge) => edge.gate === gate)!);
  return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
};

// T4: place a chalk arrow where the player stands, pointing where they face.
export function placeChalk(run: GeneratedRun): GeneratedRun {
  if (!run.rules.chalk || run.chalkLeft <= 0 || run.crushedBy || isRunOver(run.status)) return run;
  const mark: ChalkMark = { id: CHALK_CHARGES - run.chalkLeft + 1, x: run.player.x, z: run.player.z, headingIndex: headingIndexForYaw(run.player.yaw) };
  return { ...run, chalk: [...run.chalk, mark], chalkLeft: run.chalkLeft - 1,
    events: addRunEvent(run, 'chalk', `mark ${mark.id} points ${HEADING_NAMES[mark.headingIndex]}${run.cell ? ` in ${run.cell}` : ''}`) };
}
// Debug: switch one rule. Applies from the next step; logged so reports explain odd runs.
export function setRule(run: GeneratedRun, key: RuleKey, on: boolean): GeneratedRun {
  if (run.rules[key] === on) return run;
  return { ...run, rules: { ...run.rules, [key]: on }, events: addRunEvent(run, 'rules', `${key} ${on ? 'on' : 'off'}`) };
}
export function addRunEvent(run: GeneratedRun, kind: RunEventKind, detail: string): RunEvent[] {
  return [...run.events, { tick: run.tick, kind, detail }].slice(-RUN_EVENT_LIMIT);
}
// G (debug force) or the automatic timer. Any request from idle restarts the automatic countdown.
export function requestGeneratedRunShift(world: GeneratedWorld, run: GeneratedRun, source: 'debug' | 'auto' = 'debug'): GeneratedRun {
  if (run.crushedBy || isRunOver(run.status)) return run;
  const shift = requestGeneratedShift(run.shift, world.maze);
  const entry = shift.log.at(-1);
  const accepted = run.shift.phase === 'idle' && shift.phase === 'warning';
  const detail = entry ? `${source} ${entry.outcome}${entry.plan ? ` ${entry.plan.open} opens, ${entry.plan.close} closes` : ''} (request ${entry.request + 1})` : 'request';
  let next: GeneratedRun = { ...run, shift, shiftTicks: accepted ? 0 : run.shiftTicks, autoTicks: run.shift.phase === 'idle' ? 0 : run.autoTicks,
    events: addRunEvent(run, 'shift', detail) };
  // T3: both gates about to move are heard when the warning starts.
  if (accepted && shift.plan) for (const gate of [shift.plan.open, shift.plan.close]) {
    const { x, z } = gateCentre(world, gate);
    next = withSound(next, 'shiftWarning', x, z);
  }
  return next;
}

export const relicInReach = (world: GeneratedWorld, run: GeneratedRun) => !run.carrying && !run.crushedBy && !isRunOver(run.status)
  && Math.hypot(run.player.x - world.relic.x, run.player.z - world.relic.z) <= RELIC_REACH;
// E: take the relic when in reach. Ownership is unique: once carried it cannot be taken again.
export function interactGeneratedRun(world: GeneratedWorld, run: GeneratedRun): GeneratedRun {
  if (!relicInReach(world, run)) return run;
  return { ...run, carrying: true, events: addRunEvent(run, 'relic', `taken at ${world.relic.cell}`) };
}
// Abandon ends a started or unstarted run with nothing secured.
export function abandonGeneratedRun(run: GeneratedRun): GeneratedRun {
  if (isRunOver(run.status)) return run;
  return { ...run, status: 'abandoned', events: addRunEvent(run, 'run', `abandoned${run.carrying ? ' carrying the relic (lost)' : ''}`) };
}
export function setGeneratedRunFrozen(run: GeneratedRun, frozen: boolean): GeneratedRun {
  if (run.frozen === frozen) return run;
  return { ...run, frozen, events: addRunEvent(run, 'freeze', frozen ? 'shift timers frozen' : 'shift timers resumed') };
}

// Debug teleport target: the centre of a cell's room, if it is clear of stone and gates.
export function teleportTarget(world: GeneratedWorld, run: GeneratedRun, cellId: string): { ok: true; x: number; z: number } | { ok: false; reason: string } {
  const cell = world.maze.cells.find((item) => item.id === cellId);
  if (!cell) return { ok: false, reason: `Unknown cell ${cellId}.` };
  if (run.crushedBy || isRunOver(run.status)) return { ok: false, reason: 'Start a new run before teleporting.' };
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
  // A finished run is a fixed record.
  if (previous.status === 'extracted' || previous.status === 'abandoned') return previous;
  let start = previous;
  // Automatic shifts: only during an expedition, alive, unfrozen, with the maze idle.
  // The interval follows unrest (T1) and night (T2); a change applies to the countdown under way.
  if (start.status === 'out' && !start.crushedBy && !start.frozen && start.shift.phase === 'idle') {
    start = { ...start, autoTicks: start.autoTicks + 1 };
    if (start.autoTicks >= autoShiftTicks(start.rules, start.carrying, start.runTicks)) start = requestGeneratedRunShift(world, start, 'auto');
  }
  const moving = !start.frozen && start.shift.phase !== 'idle';
  let run: GeneratedRun = { ...start, tick: start.tick + 1, shiftTicks: start.shiftTicks + Number(moving),
    runTicks: start.runTicks + Number(start.status === 'out' && !start.crushedBy) };
  // T2: the dusk bell rings once per threshold the run clock reaches while dusk is enabled.
  if (run.rules.dusk && bellsDue(run.runTicks) > run.bells) {
    const strikes = bellsDue(run.runTicks);
    run = withSound({ ...run, bells: strikes, events: addRunEvent(run, 'bell', `${strikes} strike${strikes === 1 ? '' : 's'}${strikes === BELL_TICKS.length ? ' · night falls' : ''}`) },
      'bellToll', 0, 0, { strikes });
  }
  const shift = previous.frozen ? run.shift : advanceGeneratedShift(run.shift, dt, maze);
  // T3: a slab is heard grinding from the moment it starts to move.
  if (shift.plan && shift.phase !== run.shift.phase && (shift.phase === 'opening' || shift.phase === 'closing')) {
    const gate = shift.phase === 'opening' ? shift.plan.open : shift.plan.close;
    const { x, z } = gateCentre(world, gate);
    run = withSound(run, 'gateGrind', x, z, { seconds: shift.phase === 'opening' ? OPENING_SECONDS : CLOSING_SECONDS });
  }
  if (run.crushedBy) return { ...run, shift, pushedBy: null };
  const contact = resolveMovingWalls(run.player, gateEdges(maze).map((edge) => ({ id: edge.gate!,
    before: gateRect(maze, edge, run.shift.openness[edge.gate!]), after: gateRect(maze, edge, shift.openness[edge.gate!]),
    closing: shift.openness[edge.gate!] < run.shift.openness[edge.gate!] })), world.solids);
  if (contact.crushedBy) {
    const dead = { ...run, shift, ...contact, events: addRunEvent(run, 'death', `crushed by ${contact.crushedBy}`) };
    return isRunOver(run.status) ? dead : { ...dead, status: 'failed' as const,
      events: addRunEvent(dead, 'run', `failed after ${(run.runTicks * FIXED_DT).toFixed(1)}s${run.carrying ? ', relic lost' : ''}`) };
  }
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
  let status = run.status;
  if (status === 'ready' && !atHome) { status = 'out'; note('run', 'started: left Sanctuary'); }
  // Extraction: carrying the relic back into the Sanctuary plaza ends the run once.
  if (status === 'out' && run.carrying && atHome) {
    status = 'extracted';
    note('run', `extracted in ${(run.runTicks * FIXED_DT).toFixed(1)}s, ${shift.completedShifts} shifts${run.teleports ? `, ${run.teleports} debug teleports` : ''}`);
  }
  return {
    ...run, ...contact, shift, player, visited, cell: room, ring, events, returned, status,
    leftSanctuary: run.leftSanctuary || !atHome,
  };
}
