// Free-draw chalk (replaces the M7b T4 arrows, developer request 2026-11-12).
// Hold C and look around: the chalk draws where the crosshair meets the floor, a wall, a
// landmark or a gate within reach. Pure geometry: rays against the same boxes used for
// collision, so the game rules stay independent of the renderer.
import { gateEdges, gateRect } from '../simulation/maze';
import type { MazeLayout, MazeOpenness } from '../simulation/maze';
import { EYE_HEIGHT } from '../simulation/player';
import type { PlayerState, WallRect } from '../simulation/player';
import { CHALK_MAX_JUMP, CHALK_MIN_STEP, CHALK_REACH, CHALK_STROKE_LIMIT } from './tuning';

export type Vec3 = [number, number, number];
// `surface` is 'static' (floor, walls, landmarks) or a gate ID. Points on a gate are stored in
// that gate's closed pose, so the drawing slides with the stone: shown = point + gateOffset().
export type ChalkStroke = { id: number; surface: string; normal: Vec3; points: Vec3[] };
export type ChalkHit = { surface: string; point: Vec3; normal: Vec3; distance: number };

export function aimRay(player: PlayerState, pitch: number) {
  const origin: Vec3 = [player.x, EYE_HEIGHT, player.z];
  const direction: Vec3 = [-Math.sin(player.yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(player.yaw) * Math.cos(pitch)];
  return { origin, direction };
}

// Ray against an upright box (rect footprint, 0..height). Returns entry distance and face normal.
function rayBox(origin: Vec3, dir: Vec3, rect: WallRect): { t: number; normal: Vec3 } | null {
  const min = [rect.minX, 0, rect.minZ], max = [rect.maxX, rect.height, rect.maxZ];
  let near = -Infinity, far = Infinity, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-12) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null;
      continue;
    }
    let t1 = (min[i] - origin[i]) / dir[i], t2 = (max[i] - origin[i]) / dir[i];
    let faceSign = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; faceSign = 1; }
    if (t1 > near) { near = t1; axis = i; sign = faceSign; }
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  if (near < 0 || axis < 0) return null; // Starting inside (never for a valid body) or behind.
  const normal: Vec3 = [0, 0, 0];
  normal[axis] = sign;
  return { t: near, normal };
}

// Gate slabs carry their ID as `gate-<id>`; everything else counts as static stone.
export function raycastChalk(origin: Vec3, dir: Vec3, statics: readonly WallRect[], gates: readonly WallRect[], reach = CHALK_REACH): ChalkHit | null {
  let best: ChalkHit | null = null;
  const consider = (t: number, normal: Vec3, surface: string) => {
    if (t > reach || (best && t >= best.distance)) return;
    best = { surface, distance: t, normal, point: [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t] };
  };
  if (dir[1] < -1e-9) consider(-origin[1] / dir[1], [0, 1, 0], 'static');
  for (const rect of statics) { const hit = rayBox(origin, dir, rect); if (hit) consider(hit.t, hit.normal, 'static'); }
  for (const rect of gates) { const hit = rayBox(origin, dir, rect); if (hit) consider(hit.t, hit.normal, rect.id.replace(/^gate-/, '')); }
  return best;
}

// How far a gate's slab currently sits from its closed pose.
export function gateOffset(layout: MazeLayout, gate: string, openness: number): { x: number; z: number } {
  const edge = gateEdges(layout).find((item) => item.gate === gate);
  if (!edge) return { x: 0, z: 0 };
  const now = gateRect(layout, edge, openness), closed = gateRect(layout, edge, 0);
  return { x: now.minX - closed.minX, z: now.minZ - closed.minZ };
}
export function shownPoint(layout: MazeLayout, openness: MazeOpenness, stroke: ChalkStroke, point: Vec3): Vec3 {
  if (stroke.surface === 'static') return point;
  const offset = gateOffset(layout, stroke.surface, openness[stroke.surface] ?? 0);
  return [point[0] + offset.x, point[1], point[2] + offset.z];
}

// Millimetres, and never negative zero (it would not survive a JSON round trip).
const round = (value: number) => Math.round(value * 1000) / 1000 || 0;
const sameNormal = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const strokeLength = (stroke: ChalkStroke) => stroke.points.slice(1)
  .reduce((sum, point, i) => sum + Math.hypot(point[0] - stroke.points[i][0], point[1] - stroke.points[i][1], point[2] - stroke.points[i][2]), 0);

export type ChalkState = { chalk: ChalkStroke[]; chalkLeft: number; activeStroke: number | null };
// One simulation step of drawing. Continues the active stroke if the crosshair stays on the
// same surface and face and has not jumped; otherwise starts a new stroke. Ink is spent by
// line length; when it runs out, drawing stops.
export function drawChalkStep(state: ChalkState, hit: ChalkHit | null, layout: MazeLayout, openness: MazeOpenness):
  { state: ChalkState; started: ChalkStroke | null } {
  if (!hit || state.chalkLeft <= 0) return { state: { ...state, activeStroke: null }, started: null };
  const offset = hit.surface === 'static' ? { x: 0, z: 0 } : gateOffset(layout, hit.surface, openness[hit.surface] ?? 0);
  const local: Vec3 = [round(hit.point[0] - offset.x), round(hit.point[1]), round(hit.point[2] - offset.z)];
  const active = state.chalk.find((stroke) => stroke.id === state.activeStroke);
  const last = active?.points.at(-1);
  const step = last ? Math.hypot(local[0] - last[0], local[1] - last[1], local[2] - last[2]) : 0;
  if (active && last && active.surface === hit.surface && sameNormal(active.normal, hit.normal) && step <= CHALK_MAX_JUMP) {
    if (step < CHALK_MIN_STEP) return { state, started: null };
    const spent = Math.min(step, state.chalkLeft);
    const updated = { ...active, points: [...active.points, local] };
    return { started: null, state: { ...state, chalkLeft: Math.max(0, round(state.chalkLeft - spent)),
      chalk: state.chalk.map((stroke) => stroke === active ? updated : stroke) } };
  }
  if (state.chalk.length >= CHALK_STROKE_LIMIT) return { state: { ...state, activeStroke: null }, started: null };
  const stroke: ChalkStroke = { id: (state.chalk.at(-1)?.id ?? 0) + 1, surface: hit.surface, normal: hit.normal, points: [local] };
  return { started: stroke, state: { ...state, chalk: [...state.chalk, stroke], activeStroke: stroke.id } };
}
