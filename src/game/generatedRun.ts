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
import { ALL_RULES_ON, BELL_TICKS, LOUD_SOUNDS, SOUND_LIMIT, autoShiftTicks, bellsDue, isNight } from './pressure';
import type { RuleKey, RuleToggles, SoundEvent, SoundKind } from './pressure';
import { aimRay, drawChalkStep, raycastChalk } from './chalk';
import { bladeRect, boulderRollSeconds, createTrapStates, placeTraps, stepTraps } from './traps';
import type { Point2, TrapSpec, TrapState } from './traps';
import { MONSTER_STATS } from './tuning';
import { CROSSBOW_BOLTS, CROSSBOW_RELOAD, NOISE_LIMIT } from './tuning';
import { hurtMonster, monsterRngSeed, newBolt, spawnMonsters, stepBolts, stepMonsters } from './monsters';
import type { Bolt, Monster, MonsterKind } from './monsters';
import { CONTAINER_SIZES, LOOT_REACH } from './tuning';
import { forRun, placeContainers, rollLoot } from './loot';
import type { Container } from './loot';
import type { GridItem } from './inventory';
import { RELIC_ITEM } from './items';
import { nearestCell } from './monsters';
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
export type GeneratedWorld = { maze: GeneratedMaze; walls: WallRect[]; solids: WallRect[]; plaza: WallRect; relic: RelicSpot; traps: TrapSpec[]; monsters: Monster[]; containers: Container[] };
export function buildGeneratedWorld(maze: GeneratedMaze): GeneratedWorld {
  const walls = deriveMazeWalls(maze);
  const relic = placeRelic(maze);
  const traps = placeTraps(maze, relic.cell);
  return { maze, walls, solids: [...walls, ...maze.landmarks.map((landmark) => landmarkRect(landmark, maze))], plaza: plazaRect(maze)!,
    relic, traps, monsters: spawnMonsters(maze, relic.cell, traps), containers: placeContainers(maze, relic, traps) };
}

// Bounded record of what happened in this attempt, for the debug panel and bug reports.
export type RunEventKind = 'shift' | 'freeze' | 'teleport' | 'visit' | 'ring' | 'death' | 'return' | 'report' | 'run' | 'relic'
  | 'bell' | 'chalk' | 'rules' | 'trap' | 'hurt' | 'monster' | 'shot' | 'loot';
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
  // M10 monsters (same order as world.monsters) and their RNG state; noises they may hear
  // this step. M11 crossbow: bolts in flight, bolts left, seconds until it can fire again.
  monsters: Monster[]; monsterRng: number; noise: Point2[];
  bolts: Bolt[]; boltsLeft: number; reload: number; nextBoltId: number;
  // M8: the bag (carried grid), every container in the maze, the one open for looting, the
  // run counter (part of every new item uid) and a counter for new sacks. `carrying` above
  // is true while the relic item is in the bag.
  bag: GridItem[]; containers: Container[]; openContainer: string | null; runNumber: number; nextSack: number;
};
export const hasRelic = (bag: readonly GridItem[]) => bag.some((entry) => entry.item === RELIC_ITEM);
// Replace the bag, keeping `carrying` in step with it.
export const withBag = (run: GeneratedRun, bag: GridItem[]): GeneratedRun => ({ ...run, bag, carrying: hasRelic(bag) });
// Dead by any cause: crushed by a gate or killed by a trap or monster.
export const isDead = (run: GeneratedRun) => run.crushedBy !== null || run.killedBy !== null;
export type RunStart = { runNumber?: number; bag?: readonly GridItem[] };
export function createGeneratedRun(world: GeneratedWorld, rules: RuleToggles = ALL_RULES_ON, start: RunStart = {}): GeneratedRun {
  const runNumber = start.runNumber ?? 1;
  const bag = (start.bag ?? []).map((entry) => ({ ...entry }));
  return { player: { x: 0, z: 0, yaw: 0 }, visited: [], leftSanctuary: false, returned: false, cell: null, ring: 'sanctuary',
    shift: createGeneratedShift(world.maze), crushedBy: null, pushedBy: null,
    tick: 0, shiftTicks: 0, frozen: false, teleports: 0, events: [],
    status: 'ready', carrying: hasRelic(bag), runTicks: 0, autoTicks: 0,
    rules: { ...rules }, chalk: [], chalkLeft: CHALK_INK_METRES, activeStroke: null, bells: 0, sounds: [], nextSoundId: 1,
    health: PLAYER_HEALTH, killedBy: null, traps: createTrapStates(world.traps),
    monsters: world.monsters.map((monster) => ({ ...monster, path: [...monster.path] })), monsterRng: monsterRngSeed(world.maze), noise: [],
    bolts: [], boltsLeft: CROSSBOW_BOLTS, reload: 0, nextBoltId: 1,
    bag, containers: forRun(world.containers, runNumber), openContainer: null, runNumber, nextSack: 1 };
}

// T3: queue a positioned sound if sound is enabled. Returns the updated sound fields.
function withSound(run: GeneratedRun, kind: SoundKind, x: number, z: number, extra: { seconds?: number; strikes?: number; trap?: string; monster?: string } = {}) {
  if (LOUD_SOUNDS.has(kind)) run = { ...run, noise: [...run.noise, { x, z }].slice(-NOISE_LIMIT) };
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

// M11 crossbow (left mouse button with the chalk away): one bolt along the view direction.
export function fireCrossbow(run: GeneratedRun): GeneratedRun {
  if (isDead(run) || isRunOver(run.status) || run.boltsLeft <= 0 || run.reload > 0) return run;
  const bolt = newBolt(run.nextBoltId, run.player.x, run.player.z, run.player.yaw);
  const next = { ...run, bolts: [...run.bolts, bolt], boltsLeft: run.boltsLeft - 1, reload: CROSSBOW_RELOAD, nextBoltId: run.nextBoltId + 1,
    events: addRunEvent(run, 'shot', `bolt ${bolt.id} fired (${run.boltsLeft - 1} left)`) };
  return withSound(next, 'shot', run.player.x, run.player.z);
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
  // Extraction (M8): stepping back into the Sanctuary plaza ends the run once, with the bag.
  if (status === 'out' && run.leftSanctuary && atHome) {
    status = 'extracted';
    note('run', `extracted in ${(run.runTicks * FIXED_DT).toFixed(1)}s, ${shift.completedShifts} shifts, ${run.bag.length} items${run.carrying ? ' including the relic' : ''}${run.teleports ? `, ${run.teleports} debug teleports` : ''}`);
  }
  let next: GeneratedRun = {
    ...run, ...contact, shift, player, visited, cell: room, ring, events, returned, status,
    leftSanctuary: run.leftSanctuary || !atHome,
  };
  next = applyCombat(world, next, run, previous.frozen, dt);
  if (next.rules.traps && !isRunOver(next.status)) next = applyTraps(world, next, run, dt);
  // A container closes when the player is dead, the run is over or it is out of reach.
  if (next.openContainer) {
    const open = next.containers.find((container) => container.id === next.openContainer);
    if (!open || isDead(next) || isRunOver(next.status) || Math.hypot(open.x - next.player.x, open.z - next.player.z) > LOOT_REACH + 0.25) next = { ...next, openContainer: null };
  }
  return next;
}

// Player damage from any source; at 0 the run fails once with the cause.
function hurtPlayer(run: GeneratedRun, amount: number, lethal: boolean, cause: string): GeneratedRun {
  if (isDead(run) || isRunOver(run.status)) return run;
  const health = lethal ? 0 : Math.max(0, run.health - amount);
  let next = withSound({ ...run, health, events: addRunEvent(run, 'hurt', `${cause} ${lethal ? 'killed you' : `-${amount}`} (${health} left)`) },
    'hurt', run.player.x, run.player.z);
  if (health === 0) {
    next = { ...next, killedBy: cause, status: 'failed', pushedBy: null,
      events: addRunEvent(next, 'run', `failed after ${(next.runTicks * FIXED_DT).toFixed(1)}s: ${cause}${next.carrying ? ', relic lost' : ''}`) };
  }
  return next;
}
const MONSTER_NAMES: Record<MonsterKind, string> = { husk: 'husk', skitter: 'skitter', warden: 'warden' };
function noteMonsterHit(world: GeneratedWorld, run: GeneratedRun, hit: { monster: string; kind: MonsterKind; cause: string; killed: boolean; stunned: boolean }, at: Point2): GeneratedRun {
  if (hit.killed && hit.kind !== 'warden') run = leaveRemains(world, run, hit.monster, hit.kind, at);
  if (hit.killed) {
    const detail = hit.kind === 'warden' ? `${hit.monster} warden killed by ${hit.cause}; it will return` : `${hit.monster} ${hit.kind} killed by ${hit.cause}`;
    return withSound({ ...run, events: addRunEvent(run, 'monster', detail) }, 'monsterDie', at.x, at.z, { monster: hit.kind });
  }
  if (hit.stunned) return withSound({ ...run, events: addRunEvent(run, 'monster', `${hit.monster} warden staggered by ${hit.cause}`) }, 'monsterHurt', at.x, at.z, { monster: hit.kind });
  return withSound(run, 'monsterHurt', at.x, at.z, { monster: hit.kind });
}

// M8: a killed husk or skitter leaves remains with a seeded roll from the ring it died in.
function leaveRemains(world: GeneratedWorld, run: GeneratedRun, monster: string, kind: MonsterKind, at: Point2): GeneratedRun {
  const id = `remains-${monster}`;
  if (run.containers.some((container) => container.id === id)) return run;
  const body = run.monsters.find((item) => item.id === monster);
  const where = body ?? at;
  const cell = nearestCell(world.maze, where.x, where.z);
  const ring = world.maze.rings[cell];
  const size = CONTAINER_SIZES.remains;
  const items = ring === 'sanctuary' ? [] : rollLoot(world.maze.seed, id, ring, 'remains', size, `r${run.runNumber}.${id}`, kind === 'skitter');
  return { ...run, containers: [...run.containers, { id, kind: 'remains', cell, x: where.x, z: where.z, ...size, items, opened: false }] };
}

// M10/M11: bolts fly (and hit monsters when they are on), then monsters act on what they
// see and hear, and hit the player. Freeze (debug) holds monsters but not bolts.
function applyCombat(world: GeneratedWorld, run: GeneratedRun, before: GeneratedRun, frozen: boolean, dt: number): GeneratedRun {
  if (isRunOver(run.status) && run.status !== 'failed') return run;
  const solids = [...world.solids, ...layoutGateColliders(world.maze, run.shift.openness)];
  let next: GeneratedRun = { ...run, reload: Math.max(0, run.reload - dt) };
  if (next.bolts.length) {
    const flight = stepBolts(next.bolts, next.monsters, solids, dt, next.rules.monsters);
    next = { ...next, bolts: flight.bolts, monsters: flight.monsters };
    for (const at of flight.impacts) next = withSound(next, 'boltHit', at.x, at.z);
    for (const hit of flight.hits) next = noteMonsterHit(world, next, hit, hit);
  }
  if (!next.rules.monsters || frozen || isRunOver(next.status)) return { ...next, noise: [] };
  const outcome = stepMonsters(next.monsters, next.monsterRng, {
    maze: world.maze, solids: world.solids, plaza: world.plaza, before: before.shift.openness, openness: next.shift.openness,
    player: { x: next.player.x, z: next.player.z, alive: !isDead(next), safe: insideRect(next.player, world.plaza) },
    noises: next.noise, night: isNight(next.rules, next.runTicks), dt,
  });
  next = { ...next, monsters: outcome.monsters, monsterRng: outcome.rng, noise: [] };
  for (const sound of outcome.sounds) next = withSound(next, sound.kind, sound.x, sound.z, { monster: sound.monster });
  for (const note of outcome.notes) next = { ...next, events: addRunEvent(next, 'monster', note) };
  for (const hit of outcome.hits) {
    const monster = outcome.monsters.find((item) => item.id === hit.monster)!;
    next = noteMonsterHit(world, next, hit, monster);
  }
  for (const attack of outcome.attacks) next = hurtPlayer(next, attack.amount, false, MONSTER_NAMES[attack.kind]);
  return next;
}

// M12: step every trap with the bodies in the maze (the player now; monsters in stage 2),
// apply damage, and queue the sounds. Death by a trap fails the run once.
function applyTraps(world: GeneratedWorld, run: GeneratedRun, before: GeneratedRun, dt: number): GeneratedRun {
  const bodies = [...(isDead(run) ? [] : [{ id: 'player', x: run.player.x, z: run.player.z, half: PLAYER_HALF_WIDTH }]),
    ...(run.rules.monsters ? run.monsters.filter((monster) => monster.mode !== 'dead')
      .map((monster) => ({ id: monster.id, x: monster.x, z: monster.z, half: MONSTER_STATS[monster.kind].half,
        careful: monster.mode === 'patrol' })) : [])];
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
    if (hit.body === 'player') { next = hurtPlayer(next, hit.amount, hit.lethal, hit.cause); continue; }
    const index = next.monsters.findIndex((monster) => monster.id === hit.body);
    if (index < 0) continue;
    const result = hurtMonster(next.monsters[index], hit.amount, hit.lethal, hit.cause);
    next = { ...next, monsters: next.monsters.map((monster, i) => (i === index ? result.monster : monster)) };
    next = noteMonsterHit(world, next, result.hit, result.monster);
  }
  return next;
}
