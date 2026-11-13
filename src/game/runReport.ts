import { FIXED_DT } from '../loop';
import { layoutGateColliders } from '../simulation/maze';
import type { MazeOpenness } from '../simulation/maze';
import { DEFAULT_GENERATOR_CONFIG, GENERATOR_VERSION, MAX_SEED, layoutFingerprint } from '../simulation/mazeGenerator';
import type { GeneratorConfig, Ring } from '../simulation/mazeGenerator';
import { overlapsBody } from '../simulation/movingWalls';
import { advanceGeneratedShift, createGeneratedShift, requestGeneratedShift } from '../simulation/generatedShift';
import type { GeneratedShift } from '../simulation/generatedShift';
import type { ShiftPhase } from '../simulation/shift';
import { RUN_EVENT_LIMIT, addRunEvent, createGeneratedRun, homeOpenness, teleportTarget } from './generatedRun';
import { OCTAGON_CONFIG, OCTAGON_VERSION } from '../simulation/octagon';
import type { GeneratedRun, GeneratedWorld, RunEvent, RunStatus } from './generatedRun';
import { RULE_KEYS } from './pressure';
import type { RuleToggles } from './pressure';
import { strokeLength } from './chalk';
import type { ChalkStroke } from './chalk';
import { CHALK_INK_METRES, CHALK_STROKE_LIMIT, PLAYER_HEALTH } from './tuning';
import type { TrapState } from './traps';
import type { Bolt, Glob, Monster } from './monsters';
import type { GridItem } from './inventory';
import { gridValid } from './inventory';
import type { Container } from './loot';
import type { Equipment } from './equipment';
import { SLOTS } from './equipment';
import { BAG_SIZE } from './tuning';

// A bug report is plain JSON. With the same build it rebuilds the maze (seed + config),
// replays the same shift requests to the same gate poses, and puts the player back.
// Bump REPORT_FORMAT if fields change meaning.
export const REPORT_FORMAT = 12;
export type RunReport = {
  format: number; version: string; seed: number; config: GeneratorConfig; fingerprint: string;
  // Replay inputs.
  requests: number; shiftTicks: number; frozen: boolean; tick: number;
  player: { x: number; z: number; yaw: number }; cell: string | null; ring: Ring;
  visited: string[]; leftSanctuary: boolean; returned: boolean; teleports: number; crushedBy: string | null;
  // M7 expedition state.
  status: RunStatus; carrying: boolean; runTicks: number; autoTicks: number;
  // M7b rules state.
  rules: RuleToggles; chalk: ChalkStroke[]; chalkLeft: number; bells: number;
  // M10/M12 state.
  health: number; killedBy: string | null; traps: TrapState[];
  // M10/M11 state.
  monsters: Monster[]; monsterRng: number; bolts: Bolt[]; boltsLeft: number; reload: number; nextBoltId: number;
  // M8 state.
  bag: GridItem[]; containers: Container[]; openContainer: string | null; runNumber: number; nextSack: number;
  footstep: number; thread: { x: number; z: number }[][]; threadLeft: number; laying: boolean;
  jam: { gate: string; seconds: number } | null; jams: { gate: string; request: number }[];
  equipment: Equipment; activeHand: 'main' | 'off'; attackCooldown: number; blocking: boolean;
  using: { uid: string; item: string; seconds: number; total: number } | null; regen: { seconds: number; carry: number } | null; torch: number;
  globs: Glob[];
  match: GeneratedRun['match'];
  // Recorded results, compared after replay.
  expect: { phase: ShiftPhase; revision: number; completedShifts: number; openness: MazeOpenness };
  // Context for a human reader; not used for replay.
  events: RunEvent[]; shiftLog: string[]; errors: string[]; note: string;
};

export function createRunReport(world: GeneratedWorld, run: GeneratedRun, context: { errors?: string[]; note?: string; shiftLog?: string[] } = {}): RunReport {
  const { maze } = world;
  return {
    format: REPORT_FORMAT, version: maze.version, seed: maze.seed, config: { ...maze.config }, fingerprint: layoutFingerprint(maze),
    requests: run.shift.requests, shiftTicks: run.shiftTicks, frozen: run.frozen, tick: run.tick,
    player: { x: run.player.x, z: run.player.z, yaw: run.player.yaw }, cell: run.cell, ring: run.ring,
    visited: [...run.visited], leftSanctuary: run.leftSanctuary, returned: run.returned, teleports: run.teleports, crushedBy: run.crushedBy,
    status: run.status, carrying: run.carrying, runTicks: run.runTicks, autoTicks: run.autoTicks,
    rules: { ...run.rules }, chalk: run.chalk.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => [...point] as typeof point) })),
    chalkLeft: run.chalkLeft, bells: run.bells,
    health: run.health, killedBy: run.killedBy, traps: run.traps.map((trap) => ({ ...trap, hits: { ...trap.hits } })),
    monsters: run.monsters.map((monster) => structuredClone(monster)), monsterRng: run.monsterRng,
    bolts: run.bolts.map((bolt) => ({ ...bolt })), boltsLeft: run.boltsLeft, reload: run.reload, nextBoltId: run.nextBoltId,
    bag: structuredClone(run.bag), containers: structuredClone(run.containers), openContainer: run.openContainer, runNumber: run.runNumber, nextSack: run.nextSack,
    footstep: run.footstep, thread: structuredClone(run.thread), threadLeft: run.threadLeft, laying: run.laying,
    jam: run.jam ? { ...run.jam } : null, jams: structuredClone(run.jams),
    equipment: structuredClone(run.equipment), activeHand: run.activeHand, attackCooldown: run.attackCooldown, blocking: run.blocking,
    using: run.using ? { ...run.using } : null, regen: run.regen ? { ...run.regen } : null, torch: run.torch, globs: run.globs.map((glob) => ({ ...glob })), match: { ...run.match },
    expect: { phase: run.shift.phase, revision: run.shift.revision, completedShifts: run.shift.completedShifts, openness: { ...run.shift.openness } },
    events: run.events.slice(-20), shiftLog: context.shiftLog ?? [], errors: (context.errors ?? []).slice(-10), note: context.note ?? '',
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const isVec3 = (value: unknown) => Array.isArray(value) && value.length === 3 && value.every(isNumber);
const isStroke = (value: unknown) => isObject(value) && isInt(value.id, 1, 1e6) && typeof value.surface === 'string'
  && isVec3(value.normal) && Array.isArray(value.points) && value.points.length > 0 && value.points.every(isVec3);

// Strict parsing: anything malformed, from another generator version or another config is
// rejected with a reason rather than partly applied.
export function parseRunReport(text: string): { ok: true; report: RunReport } | { ok: false; error: string } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'Report is not valid JSON.' }; }
  if (!isObject(data)) return { ok: false, error: 'Report must be a JSON object.' };
  if (data.format !== REPORT_FORMAT) return { ok: false, error: `Unsupported report format ${String(data.format)}; expected ${REPORT_FORMAT}.` };
  if (data.version !== GENERATOR_VERSION && data.version !== OCTAGON_VERSION) {
    return { ok: false, error: `Report is from generator ${String(data.version)}; this build is ${GENERATOR_VERSION} / ${OCTAGON_VERSION}. Use a matching build.` };
  }
  if (!isInt(data.seed, 0, MAX_SEED)) return { ok: false, error: 'Report seed must be a whole number from 0 to 4294967295.' };
  if (!isObject(data.config) || JSON.stringify(data.config) !== JSON.stringify(data.version === OCTAGON_VERSION ? OCTAGON_CONFIG : DEFAULT_GENERATOR_CONFIG)) {
    return { ok: false, error: 'Report uses a different generator config than this build.' };
  }
  if (!isInt(data.requests, 0, 100_000) || !isInt(data.shiftTicks, 0, 10_000_000) || !isInt(data.tick, 0, 1e9)) {
    return { ok: false, error: 'Report requests, shiftTicks and tick must be non-negative whole numbers.' };
  }
  if (!isObject(data.player) || !isNumber(data.player.x) || !isNumber(data.player.z) || !isNumber(data.player.yaw)) {
    return { ok: false, error: 'Report player needs numeric x, z and yaw.' };
  }
  if (!isObject(data.expect) || !isObject(data.expect.openness)) return { ok: false, error: 'Report is missing its expected gate state.' };
  const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (!strings(data.visited)) return { ok: false, error: 'Report visited must be a list of landmark IDs.' };
  if (!['ready', 'out', 'extracted', 'failed', 'abandoned'].includes(data.status as string) || typeof data.carrying !== 'boolean'
    || !isInt(data.runTicks, 0, 1e9) || !isInt(data.autoTicks, 0, 1e9)) {
    return { ok: false, error: 'Report run status, carrying, runTicks or autoTicks is missing or invalid.' };
  }
  if (!isObject(data.rules) || !RULE_KEYS.every((key) => typeof (data.rules as Record<string, unknown>)[key] === 'boolean')
    || !Array.isArray(data.chalk) || data.chalk.length > CHALK_STROKE_LIMIT || !data.chalk.every(isStroke)
    || !isNumber(data.chalkLeft) || (data.chalkLeft as number) < 0
    // Ink left plus ink drawn must account for the whole stick (rounding allowed).
    || Math.abs((data.chalkLeft as number) + (data.chalk as ChalkStroke[]).reduce((sum, stroke) => sum + strokeLength(stroke), 0) - CHALK_INK_METRES) > 0.05
    || !isInt(data.bells, 0, 3)) {
    return { ok: false, error: 'Report rules, chalk or bells are missing or invalid.' };
  }
  if (!isNumber(data.health) || (data.health as number) < 0 || (data.health as number) > PLAYER_HEALTH || !Array.isArray(data.traps)
    || !data.traps.every((trap) => isObject(trap) && typeof trap.id === 'string' && ['armed', 'warning', 'active', 'cooldown'].includes(trap.phase as string)
      && isNumber(trap.seconds) && isObject(trap.hits))) {
    return { ok: false, error: 'Report health or trap state is missing or invalid.' };
  }
  const isMonster = (m: unknown) => isObject(m) && typeof m.id === 'string' && ['husk', 'skitter', 'warden', 'spitter', 'brute', 'mimic', 'ram'].includes(m.kind as string)
    && ['patrol', 'investigate', 'chase', 'search', 'dead', 'dormant'].includes(m.mode as string) && isNumber(m.x) && isNumber(m.z)
    && Array.isArray(m.path) && typeof m.at === 'string';
  if (!Array.isArray(data.monsters) || !data.monsters.every(isMonster) || !isInt(data.monsterRng, 0, MAX_SEED)
    || !Array.isArray(data.bolts) || !isInt(data.boltsLeft, 0, 1000) || !isNumber(data.reload) || !isInt(data.nextBoltId, 1, 1e9)) {
    return { ok: false, error: 'Report monsters or crossbow state is missing or invalid.' };
  }
  if (!Array.isArray(data.bag) || !gridValid(data.bag as GridItem[], BAG_SIZE) || !Array.isArray(data.containers)
    || !data.containers.every((c) => isObject(c) && typeof c.id === 'string' && Array.isArray(c.items) && isNumber(c.x) && isNumber(c.z)
      && isInt(c.width, 1, 20) && isInt(c.height, 1, 20) && gridValid(c.items as GridItem[], { width: c.width as number, height: c.height as number }))
    || !isInt(data.runNumber, 0, 1e9) || !isInt(data.nextSack, 1, 1e9) || !(data.openContainer === null || typeof data.openContainer === 'string')) {
    return { ok: false, error: 'Report bag or containers are missing or invalid.' };
  }
  const isPoint = (p: unknown) => isObject(p) && isNumber(p.x) && isNumber(p.z);
  if (!isNumber(data.footstep) || !Array.isArray(data.thread) || !data.thread.every((strand) => Array.isArray(strand) && strand.length > 0 && strand.every(isPoint))
    || !isNumber(data.threadLeft) || typeof data.laying !== 'boolean' || !Array.isArray(data.jams)
    || !(data.jam === null || (isObject(data.jam) && typeof data.jam.gate === 'string' && isNumber(data.jam.seconds)))) {
    return { ok: false, error: 'Report thread or gate jam state is missing or invalid.' };
  }
  if (!isObject(data.equipment) || !Object.keys(data.equipment).every((slot) => (SLOTS as readonly string[]).includes(slot))
    || !['main', 'off'].includes(data.activeHand as string) || !isNumber(data.attackCooldown) || typeof data.blocking !== 'boolean') {
    return { ok: false, error: 'Report equipment is missing or invalid.' };
  }
  if (!isNumber(data.torch) || !(data.using === null || (isObject(data.using) && typeof data.using.uid === 'string' && isNumber(data.using.seconds)))
    || !(data.regen === null || (isObject(data.regen) && isNumber(data.regen.seconds)))) {
    return { ok: false, error: 'Report consumable state is missing or invalid.' };
  }
  if (!Array.isArray(data.globs)) return { ok: false, error: 'Report globs are missing.' };
  if (!isObject(data.match) || !(data.match.opensAt === null || isInt(data.match.opensAt, 0, 1e9)) || !isNumber(data.match.channel)
    || ![null, 'home', 'core'].includes(data.match.via as string | null)) return { ok: false, error: 'Report match state is missing or invalid.' };
  const report = {
    events: [], shiftLog: [], errors: [], note: '', frozen: false, cell: null, ring: 'sanctuary', leftSanctuary: false,
    returned: false, teleports: 0, crushedBy: null, killedBy: null, fingerprint: '', ...data,
  } as unknown as RunReport;
  return { ok: true, report };
}

// Replay `requests` G presses from the seed's starting gates. Every request but the last is
// run to idle (a new request is only counted when idle); the last is advanced `shiftTicks`
// fixed steps, exactly as the game's 60 Hz simulation did.
export function replayShift(world: GeneratedWorld, requests: number, shiftTicks: number): GeneratedShift {
  let shift = createGeneratedShift(world.maze);
  for (let i = 0; i < requests; i++) {
    const wasIdle = shift.phase === 'idle';
    shift = requestGeneratedShift(shift, world.maze);
    if (i < requests - 1) {
      for (let tick = 0; shift.phase !== 'idle' && tick < 10_000; tick++) shift = advanceGeneratedShift(shift, FIXED_DT, world.maze);
    } else if (wasIdle && shift.phase !== 'idle') {
      for (let tick = 0; tick < shiftTicks && shift.phase !== 'idle'; tick++) shift = advanceGeneratedShift(shift, FIXED_DT, world.maze);
    }
  }
  return shift;
}

export function reproduceRun(world: GeneratedWorld, report: RunReport): { run: GeneratedRun; mismatches: string[] } {
  const mismatches: string[] = [];
  if (report.seed !== world.maze.seed) mismatches.push(`Seed ${report.seed} does not match loaded seed ${world.maze.seed}.`);
  if (report.fingerprint && report.fingerprint !== layoutFingerprint(world.maze)) mismatches.push('Layout fingerprint differs.');
  let shift = replayShift(world, report.requests, report.shiftTicks);
  // M18: the home gate is not replayed; it follows the match clock.
  if (world.maze.homeGate) {
    const status = report.status === 'failed' ? 'out' : report.status;
    shift = { ...shift, openness: { ...shift.openness, [world.maze.homeGate]: homeOpenness({ match: report.match, tick: report.tick, status }) } };
  }
  const expect = report.expect;
  if (shift.phase !== expect.phase) mismatches.push(`Phase ${shift.phase}, report says ${expect.phase}.`);
  if (shift.revision !== expect.revision) mismatches.push(`Revision ${shift.revision}, report says ${expect.revision}.`);
  if (shift.completedShifts !== expect.completedShifts) mismatches.push(`${shift.completedShifts} shifts, report says ${expect.completedShifts}.`);
  for (const gate of world.maze.gates) {
    if (Math.abs((shift.openness[gate] ?? -1) - (expect.openness[gate] ?? -2)) > 1e-9) mismatches.push(`${gate} openness differs.`);
  }
  const base = createGeneratedRun(world);
  const body = { x: report.player.x, z: report.player.z, yaw: report.player.yaw };
  const solids = [...world.solids, ...layoutGateColliders(world.maze, shift.openness)];
  let player = body;
  if (solids.some((rect) => overlapsBody(body, rect))) {
    // A crushed body sits inside stone; restore it alive in the nearest clear room instead.
    const nearest = world.maze.cells
      .map((cell) => ({ cell, target: teleportTarget(world, { ...base, shift }, cell.id) }))
      .flatMap(({ cell, target }) => target.ok ? [{ id: cell.id, x: target.x, z: target.z }] : [])
      .sort((a, b) => Math.hypot(a.x - body.x, a.z - body.z) - Math.hypot(b.x - body.x, b.z - body.z))[0];
    player = { x: nearest.x, z: nearest.z, yaw: body.yaw };
    mismatches.push(`Recorded position overlaps stone; placed at ${nearest.id} instead.`);
  }
  const run: GeneratedRun = { ...base, shift, player, tick: report.tick, shiftTicks: report.shiftTicks, frozen: report.frozen,
    cell: report.cell, ring: report.ring, visited: [...report.visited], leftSanctuary: report.leftSanctuary, returned: report.returned,
    teleports: report.teleports, events: report.events.slice(-RUN_EVENT_LIMIT),
    // A failed run comes back alive and running, so the moment before death can be replayed.
    status: report.status === 'failed' ? 'out' : report.status, carrying: report.carrying, runTicks: report.runTicks, autoTicks: report.autoTicks,
    rules: { ...report.rules }, chalk: report.chalk.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => [...point] as typeof point) })),
    chalkLeft: report.chalkLeft, activeStroke: null, bells: report.bells,
    // A dead player comes back alive (at least 1 health) so the moment before death can be replayed.
    health: Math.max(1, report.health), killedBy: null,
    traps: report.traps.length === world.traps.length ? report.traps.map((trap) => ({ ...trap, hits: { ...trap.hits } })) : base.traps,
    monsters: report.monsters.map((monster) => structuredClone(monster)), monsterRng: report.monsterRng, noise: [],
    bolts: report.bolts.map((bolt) => ({ ...bolt })), boltsLeft: report.boltsLeft, reload: report.reload, nextBoltId: report.nextBoltId,
    bag: structuredClone(report.bag), containers: structuredClone(report.containers), openContainer: report.openContainer, runNumber: report.runNumber, nextSack: report.nextSack,
    footstep: report.footstep, thread: structuredClone(report.thread), threadLeft: report.threadLeft, laying: report.laying,
    jam: report.jam ? { ...report.jam } : null, jams: structuredClone(report.jams),
    equipment: structuredClone(report.equipment), activeHand: report.activeHand, attackCooldown: report.attackCooldown, blocking: report.blocking, swing: null,
    using: report.using ? { ...report.using } : null, regen: report.regen ? { ...report.regen } : null, torch: report.torch, globs: report.globs.map((glob) => ({ ...glob })), match: { ...report.match } };
  return { mismatches, run: { ...run, events: addRunEvent(run, 'report',
    `reproduced seed ${report.seed}, ${report.requests} requests${mismatches.length ? `; ${mismatches.length} mismatch(es)` : ''}`) } };
}
