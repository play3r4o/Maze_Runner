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
import { AUTO_SHIFT_SECONDS, CHALK_INK_METRES, RELIC_REACH, ticks } from './tuning';
import { ALL_RULES_ON, BELL_TICKS, SOUND_LIMIT, autoShiftTicks, bellsDue } from './pressure';
import type { RuleKey, RuleToggles, SoundEvent, SoundKind } from './pressure';
import { aimRay, drawChalkStep, raycastChalk } from './chalk';
import { bladeRect, boulderRollSeconds, createTrapStates, placeTraps, stepTraps } from './traps';
import type { TrapSpec, TrapState } from './traps';
import { PLAYER_HEALTH } from './tuning';
import { PLAYER_HALF_WIDTH } from '../simulation/player';
import type { ChalkStroke } from './chalk';

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
export type GeneratedWorld = { maze: GeneratedMaze; walls: WallRect[]; solids: WallRect[]; plaza: WallRect; relic: RelicSpot; traps: TrapSpec[] };
export function buildGeneratedWorld(maze: GeneratedMaze): GeneratedWorld {
  const walls = deriveMazeWalls(maze);
  const relic = placeRelic(maze);
  return { maze, walls, solids: [...walls, ...maze.landmarks.map((landmark) => landmarkRect(landmark, maze))], plaza: plazaRect(maze)!,
    relic, traps: placeTraps(maze, relic.cell) };
}

// Bounded record of what happened in this attempt, for the debug panel and bug reports.
export type RunEventKind = 'shift' | 'freeze' | 'teleport' | 'visit' | 'ring' | 'death' | 'return' | 'report' | 'run' | 'relic'
  | 'bell' | 'chalk' | 'rules' | 'trap' | 'hurt';
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
  // M7b: rule toggles, chalk strokes, metres of chalk left and the stroke being drawn, bells
  // already rung, and the last sounds (bounded; the audio module plays ids it has not played yet).
  rules: RuleToggles; chalk: ChalkStroke[]; chalkLeft: number; activeStroke: number | null;
  bells: number; sounds: SoundEvent[]; nextSoundId: number;
  // M10/M12: health (0 = dead), what killed the player other than a gate, and trap states
  // in the same order as world.traps.
  health: number; killedBy: string | null; traps: TrapState[];
};
// Dead by any cause: crushed by a gate or killed by a trap or monster.
export const isDead = (run: GeneratedRun) => run.crushedBy !== null || run.killedBy !== null;
export function createGeneratedRun(world: GeneratedWorld, rules: RuleToggles = ALL_RULES_ON): GeneratedRun {
  return { player: { x: 0, z: 0, yaw: 0 }, visited: [], leftSanctuary: false, returned: false, cell: null, ring: 'sanctuary',
    shift: createGeneratedShift(world.maze), crushedBy: null, pushedBy: null,
    tick: 0, shiftTicks: 0, frozen: false, teleports: 0, events: [],
    status: 'ready', carrying: false, runTicks: 0, autoTicks: 0,
    rules: { ...rules }, chalk: [], chalkLeft: CHALK_INK_METRES, activeStroke: null, bells: 0, sounds: [], nextSoundId: 1,
    health: PLAYER_HEALTH, killedBy: null, traps: createTrapStates(world.traps) };
}

// T3: queue a positioned sound if sound is enabled. Returns the updated sound fields.
function withSound(run: GeneratedRun, kind: SoundKind, x: number, z: number, extra: { seconds?: number; strikes?: number; trap?: string } = {}) {
  if (!run.rules.sound) return run;
  const sound: SoundEvent = { id: run.nextSoundId, kind, x, z, tick: run.tick, ...extra };
  return { ...run, sounds: [...run.sounds, sound].slice(-SOUND_LIMIT), nextSoundId: run.nextSoundId + 1 };
}
const gateCentre = (world: GeneratedWorld, gate: string) => {
  const rect = corridorRect(world.maze, world.maze.edges.find((edge) => edge.gate === gate)!);
  return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
};

// T4 free-draw chalk, one step: while `held`, draw where the player (yaw from run.player,
// pitch given) is looking, on stone or gates within reach. Releasing ends the stroke.
export function drawChalk(world: GeneratedWorld, run: GeneratedRun, pitch: number, held: boolean): GeneratedRun {
  if (!held || !run.rules.chalk || isDead(run) || isRunOver(run.status)) {
    return run.activeStroke === null ? run : { ...run, activeStroke: null };
  }
  const { origin, direction } = aimRay(run.player, pitch);
  const hit = raycastChalk(origin, direction, world.solids, layoutGateColliders(world.maze, run.shift.openness));
  const { state, started } = drawChalkStep(run, hit, world.maze, run.shift.openness);
  const next = { ...run, ...state };
  if (!started) return next;
  const where = started.surface === 'static' ? (started.normal[1] === 1 ? 'floor' : 'stone') : `gate ${started.surface.toUpperCase()}`;
  return { ...next, events: addRunEvent(run, 'chalk', `stroke ${started.id} on ${where}${run.cell ? ` in ${run.cell}` : ''}`) };
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
  if (isDead(run) || isRunOver(run.status)) return run;
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

export const relicInReach = (world: GeneratedWorld, run: GeneratedRun) => !run.carrying && !isDead(run) && !isRunOver(run.status)
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
  if (isDead(run) || isRunOver(run.status)) return { ok: false, reason: 'Start a new run before teleporting.' };
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
  if (start.status === 'out' && !isDead(start) && !start.frozen && start.shift.phase === 'idle') {
    start = { ...start, autoTicks: start.autoTicks + 1 };
    if (start.autoTicks >= autoShiftTicks(start.rules, start.carrying, start.runTicks)) start = requestGeneratedRunShift(world, start, 'auto');
  }
  const moving = !start.frozen && start.shift.phase !== 'idle';
  let run: GeneratedRun = { ...start, tick: start.tick + 1, shiftTicks: start.shiftTicks + Number(moving),
    runTicks: start.runTicks + Number(start.status === 'out' && !isDead(start)) };
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
  if (isDead(run)) return { ...run, shift, pushedBy: null };
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
  let next: GeneratedRun = {
    ...run, ...contact, shift, player, visited, cell: room, ring, events, returned, status,
    leftSanctuary: run.leftSanctuary || !atHome,
  };
  if (next.rules.traps && !isRunOver(next.status)) next = applyTraps(world, next, run, dt);
  return next;
}

// M12: step every trap with the bodies in the maze (the player now; monsters in stage 2),
// apply damage, and queue the sounds. Death by a trap fails the run once.
function applyTraps(world: GeneratedWorld, run: GeneratedRun, before: GeneratedRun, dt: number): GeneratedRun {
  const bodies = isDead(run) ? [] : [{ id: 'player', x: run.player.x, z: run.player.z, half: PLAYER_HALF_WIDTH }];
  const time = run.tick * dt;
  const outcome = stepTraps(world.traps, run.traps, bodies, dt, time, run.tick);
  let next: GeneratedRun = { ...run, traps: outcome.states };
  for (const { trap, by } of outcome.triggered) {
    const plate = trap.plate!;
    next = withSound(next, 'trapClick', (plate.minX + plate.maxX) / 2, (plate.minZ + plate.maxZ) / 2);
    next = { ...next, events: addRunEvent(next, 'trap', `${trap.kind} ${trap.id} triggered by ${by} in ${trap.cell}`) };
  }
  world.traps.forEach((trap, i) => {
    const old = before.traps[i], now = outcome.states[i];
    if (trap.kind !== 'blade' && old.phase !== 'active' && now.phase === 'active') {
      const at = trap.kind === 'boulder' ? trap.path!.from : { x: (trap.zone.minX + trap.zone.maxX) / 2, z: (trap.zone.minZ + trap.zone.maxZ) / 2 };
      next = withSound(next, 'trapFire', at.x, at.z, { trap: trap.kind, seconds: trap.kind === 'boulder' ? boulderRollSeconds(trap) : 1 });
    }
    // A swish each time a blade crosses the middle, if the player is near enough to care.
    if (trap.kind === 'blade') {
      const a = bladeRect(trap, time - dt), b = bladeRect(trap, time);
      const cx = (trap.zone.minX + trap.zone.maxX) / 2, cz = (trap.zone.minZ + trap.zone.maxZ) / 2;
      const side = (r: typeof a) => Math.sign(trap.axis === 'z' ? (r.minX + r.maxX) / 2 - cx : (r.minZ + r.maxZ) / 2 - cz);
      if (side(a) !== side(b) && Math.hypot(run.player.x - cx, run.player.z - cz) < 20) next = withSound(next, 'bladeSwish', cx, cz);
    }
  });
  for (const hit of outcome.damage) {
    if (hit.body !== 'player' || isDead(next)) continue;
    const health = hit.lethal ? 0 : Math.max(0, next.health - hit.amount);
    next = withSound({ ...next, health, events: addRunEvent(next, 'hurt', `${hit.cause} ${hit.lethal ? 'killed you' : `-${hit.amount}`} (${health} left)`) },
      'hurt', next.player.x, next.player.z);
    if (health === 0) {
      next = { ...next, killedBy: hit.cause, status: 'failed', pushedBy: null,
        events: addRunEvent(next, 'run', `failed after ${(next.runTicks * FIXED_DT).toFixed(1)}s: ${hit.cause}${next.carrying ? ', relic lost' : ''}`) };
    }
  }
  return next;
}
