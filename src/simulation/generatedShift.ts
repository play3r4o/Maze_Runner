import type { MazeLayout, MazeOpenness } from './maze';
import { validateMazeTopology } from './mazeGraph';
import type { TopologyCheck } from './mazeGraph';
import { createRng } from './mazeGenerator';
import type { GeneratedMaze } from './mazeGenerator';
import { CLOSING_SECONDS, COOLDOWN_SECONDS, OPENING_SECONDS, WARNING_SECONDS } from './shift';
import type { ShiftPhase } from './shift';

// One shift swaps exactly one open gate for one closed gate: warn → open the new route →
// close the old one → cooldown. One plan at a time; requests during a plan are ignored.
export type ShiftPlan = { open: string; close: string };
export type ShiftLogEntry = {
  request: number; revision: number; outcome: 'accepted' | 'rejected' | 'ignored';
  plan: ShiftPlan | null; rejectedCandidates: number; reason: string;
};
export type GeneratedShift = {
  phase: ShiftPhase; phaseSeconds: number; openness: MazeOpenness; plan: ShiftPlan | null;
  // Count of G requests made while idle; seeds the candidate order, so a seed plus the
  // same sequence of requests always produces the same shifts.
  requests: number; completedShifts: number; revision: number; notice: string;
  validation: TopologyCheck | null; log: ShiftLogEntry[];
};
export const SHIFT_LOG_LIMIT = 12;

export function createGeneratedShift(maze: GeneratedMaze): GeneratedShift {
  return { phase: 'idle', phaseSeconds: 0, openness: { ...maze.initialOpenness }, plan: null, requests: 0, completedShifts: 0,
    revision: 0, validation: null, log: [],
    notice: `${maze.gates.length} stone gates: each shift opens one and closes another. Every room keeps a route home.` };
}

// Validate a proposed swap against the graph before, during (both open) and after.
export function validateGatePlan(layout: MazeLayout, current: MazeOpenness, plan: ShiftPlan): TopologyCheck {
  const gates = new Set(layout.edges.flatMap((edge) => edge.gate ? [edge.gate] : []));
  const fail = (reason: string): TopologyCheck => ({ ok: false, reason, reachableCount: 0, unreachable: [] });
  if (!gates.has(plan.open) || !gates.has(plan.close)) return fail('Plan names an unknown gate.');
  if (plan.open === plan.close) return fail('A gate cannot open and close in the same plan.');
  if (current[plan.open] !== 0) return fail(`${plan.open.toUpperCase()} is not fully closed.`);
  if (current[plan.close] !== 1) return fail(`${plan.close.toUpperCase()} is not fully open.`);
  const opening = { ...current, [plan.open]: 1 };
  const target = { ...opening, [plan.close]: 0 };
  for (const [stage, pose] of [['Current', current], ['Opening', opening], ['Target', target]] as const) {
    const check = validateMazeTopology(layout, pose);
    if (!check.ok) return { ...check, reason: `${stage} maze rejected. ${check.reason}` };
  }
  return { ...validateMazeTopology(layout, target),
    reason: `Accepted: ${plan.open.toUpperCase()} opens, ${plan.close.toUpperCase()} closes; every cell keeps a route to Sanctuary.` };
}

// Seeded candidate order for request n. Returns the first valid plan and every rejection before it.
export function planGeneratedShift(maze: GeneratedMaze, openness: MazeOpenness, request: number) {
  const open = maze.gates.filter((gate) => openness[gate] === 1);
  const closed = maze.gates.filter((gate) => openness[gate] === 0);
  const candidates = closed.flatMap((toOpen) => open.map((toClose) => ({ open: toOpen, close: toClose })));
  const rng = createRng((maze.seed ^ Math.imul(request + 1, 0x85ebca6b)) >>> 0);
  const rejected: { plan: ShiftPlan; reason: string }[] = [];
  for (const plan of rng.shuffle(candidates)) {
    const check = validateGatePlan(maze, openness, plan);
    if (check.ok) return { plan, check, rejected };
    rejected.push({ plan, reason: check.reason });
  }
  return { plan: null, check: null, rejected };
}

const addLog = (state: GeneratedShift, entry: ShiftLogEntry) => [...state.log, entry].slice(-SHIFT_LOG_LIMIT);

export function requestGeneratedShift(state: GeneratedShift, maze: GeneratedMaze): GeneratedShift {
  if (state.phase !== 'idle') {
    return { ...state, notice: 'Shift ignored: a change is already under way.',
      log: addLog(state, { request: state.requests, revision: state.revision, outcome: 'ignored', plan: null, rejectedCandidates: 0,
        reason: `Busy (${state.phase}).` }) };
  }
  const request = state.requests;
  const result = planGeneratedShift(maze, state.openness, request);
  const rejectedNote = result.rejected.length ? ` ${result.rejected.length} unsafe candidate${result.rejected.length === 1 ? '' : 's'} rejected first.` : '';
  if (!result.plan) {
    const reason = result.rejected.length ? `No safe plan: all ${result.rejected.length} candidates would cut rooms off. Last: ${result.rejected.at(-1)!.reason}`
      : 'No safe plan: no open/closed gate pair exists.';
    return { ...state, requests: request + 1, notice: `Shift rejected. ${reason}`,
      validation: { ok: false, reason, reachableCount: 0, unreachable: [] },
      log: addLog(state, { request, revision: state.revision, outcome: 'rejected', plan: null, rejectedCandidates: result.rejected.length, reason }) };
  }
  const { plan } = result;
  return { ...state, phase: 'warning', phaseSeconds: 0, plan, requests: request + 1, validation: result.check,
    notice: `${plan.open.toUpperCase()} will open, then ${plan.close.toUpperCase()} closes. Leave ${plan.close.toUpperCase()}'s passage.`,
    log: addLog(state, { request, revision: state.revision, outcome: 'accepted', plan, rejectedCandidates: result.rejected.length,
      reason: `${result.check.reason}${rejectedNote}` }) };
}

export function advanceGeneratedShift(state: GeneratedShift, dt: number, maze: GeneratedMaze): GeneratedShift {
  if (dt <= 0 || state.phase === 'idle' || !state.plan) return state;
  const elapsed = state.phaseSeconds + dt;
  if (state.phase === 'warning' || state.phase === 'cooldown') {
    const duration = state.phase === 'warning' ? WARNING_SECONDS : COOLDOWN_SECONDS;
    if (elapsed < duration - 1e-9) return { ...state, phaseSeconds: elapsed };
    return state.phase === 'warning' ? { ...state, phase: 'opening', phaseSeconds: 0 }
      : { ...state, phase: 'idle', phaseSeconds: 0, plan: null };
  }
  const { plan } = state;
  const openness = { ...state.openness };
  if (state.phase === 'opening') openness[plan.open] = Math.min(1, openness[plan.open] + dt / OPENING_SECONDS);
  else openness[plan.close] = Math.max(0, openness[plan.close] - dt / CLOSING_SECONDS);
  for (const gate of [plan.open, plan.close]) {
    if (openness[gate] < 1e-9) openness[gate] = 0;
    if (openness[gate] > 1 - 1e-9) openness[gate] = 1;
  }
  // The graph only changes when a plan gate becomes fully open or stops being fully open.
  const changed = [plan.open, plan.close].some((gate) => (state.openness[gate] === 1) !== (openness[gate] === 1));
  if (changed) {
    // Defensive: the plan was validated, but never commit a pose that disconnects the graph.
    const validation = validateMazeTopology(maze, openness);
    if (!validation.ok) return { ...state, validation, notice: `Shift halted: ${validation.reason}` };
  }
  const finished = state.phase === 'opening' ? openness[plan.open] === 1 : openness[plan.close] === 0;
  const committed = finished && state.phase === 'closing';
  return { ...state, openness, revision: state.revision + Number(changed), phaseSeconds: finished ? 0 : elapsed,
    phase: finished ? state.phase === 'opening' ? 'closing' : 'cooldown' : state.phase,
    completedShifts: state.completedShifts + Number(committed),
    notice: committed ? `${plan.close.toUpperCase()} is closed and ${plan.open.toUpperCase()} is open. The old way may be gone.` : state.notice,
  };
}
