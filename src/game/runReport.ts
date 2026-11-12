import { FIXED_DT } from '../loop';
import { layoutGateColliders } from '../simulation/maze';
import type { MazeOpenness } from '../simulation/maze';
import { DEFAULT_GENERATOR_CONFIG, GENERATOR_VERSION, MAX_SEED, layoutFingerprint } from '../simulation/mazeGenerator';
import type { GeneratorConfig, Ring } from '../simulation/mazeGenerator';
import { overlapsBody } from '../simulation/movingWalls';
import { advanceGeneratedShift, createGeneratedShift, requestGeneratedShift } from '../simulation/generatedShift';
import type { GeneratedShift } from '../simulation/generatedShift';
import type { ShiftPhase } from '../simulation/shift';
import { RUN_EVENT_LIMIT, addRunEvent, createGeneratedRun, teleportTarget } from './generatedRun';
import type { GeneratedRun, GeneratedWorld, RunEvent, RunStatus } from './generatedRun';
import { RULE_KEYS } from './pressure';
import type { ChalkMark, RuleToggles } from './pressure';
import { CHALK_CHARGES } from './tuning';

// A bug report is plain JSON. With the same build it rebuilds the maze (seed + config),
// replays the same shift requests to the same gate poses, and puts the player back.
// Bump REPORT_FORMAT if fields change meaning.
export const REPORT_FORMAT = 3;
export type RunReport = {
  format: number; version: string; seed: number; config: GeneratorConfig; fingerprint: string;
  // Replay inputs.
  requests: number; shiftTicks: number; frozen: boolean; tick: number;
  player: { x: number; z: number; yaw: number }; cell: string | null; ring: Ring;
  visited: string[]; leftSanctuary: boolean; returned: boolean; teleports: number; crushedBy: string | null;
  // M7 expedition state.
  status: RunStatus; carrying: boolean; runTicks: number; autoTicks: number;
  // M7b rules state.
  rules: RuleToggles; chalk: ChalkMark[]; chalkLeft: number; bells: number;
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
    rules: { ...run.rules }, chalk: run.chalk.map((mark) => ({ ...mark })), chalkLeft: run.chalkLeft, bells: run.bells,
    expect: { phase: run.shift.phase, revision: run.shift.revision, completedShifts: run.shift.completedShifts, openness: { ...run.shift.openness } },
    events: run.events.slice(-20), shiftLog: context.shiftLog ?? [], errors: (context.errors ?? []).slice(-10), note: context.note ?? '',
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

// Strict parsing: anything malformed, from another generator version or another config is
// rejected with a reason rather than partly applied.
export function parseRunReport(text: string): { ok: true; report: RunReport } | { ok: false; error: string } {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'Report is not valid JSON.' }; }
  if (!isObject(data)) return { ok: false, error: 'Report must be a JSON object.' };
  if (data.format !== REPORT_FORMAT) return { ok: false, error: `Unsupported report format ${String(data.format)}; expected ${REPORT_FORMAT}.` };
  if (data.version !== GENERATOR_VERSION) {
    return { ok: false, error: `Report is from generator ${String(data.version)}; this build is ${GENERATOR_VERSION}. Use a matching build.` };
  }
  if (!isInt(data.seed, 0, MAX_SEED)) return { ok: false, error: 'Report seed must be a whole number from 0 to 4294967295.' };
  if (!isObject(data.config) || JSON.stringify(data.config) !== JSON.stringify(DEFAULT_GENERATOR_CONFIG)) {
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
    || !Array.isArray(data.chalk) || !data.chalk.every((mark) => isObject(mark) && isInt(mark.id, 1, CHALK_CHARGES)
      && isNumber(mark.x) && isNumber(mark.z) && isInt(mark.headingIndex, 0, 7))
    || !isInt(data.chalkLeft, 0, CHALK_CHARGES) || data.chalk.length + (data.chalkLeft as number) !== CHALK_CHARGES || !isInt(data.bells, 0, 3)) {
    return { ok: false, error: 'Report rules, chalk or bells are missing or invalid.' };
  }
  const report = {
    events: [], shiftLog: [], errors: [], note: '', frozen: false, cell: null, ring: 'sanctuary', leftSanctuary: false,
    returned: false, teleports: 0, crushedBy: null, fingerprint: '', ...data,
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
  const shift = replayShift(world, report.requests, report.shiftTicks);
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
    rules: { ...report.rules }, chalk: report.chalk.map((mark) => ({ ...mark })), chalkLeft: report.chalkLeft, bells: report.bells };
  return { mismatches, run: { ...run, events: addRunEvent(run, 'report',
    `reproduced seed ${report.seed}, ${report.requests} requests${mismatches.length ? `; ${mismatches.length} mismatch(es)` : ''}`) } };
}
