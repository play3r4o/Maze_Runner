import { describe, expect, test } from 'vitest';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { cellPosition, edgeId } from '../src/simulation/maze';
import { FIXED_DT } from '../src/loop';
import { BOULDER_MIN_EDGES, PLAYER_HEALTH, TRAPS_PER_RING, TRAP_DAMAGE, TRAP_TIMING, ticks } from '../src/game/tuning';
import { bladeRect, boulderPosition, boulderRollSeconds, createTrapStates, placeTraps, stepTraps } from '../src/game/traps';
import type { Body, TrapKind, TrapSpec, TrapState } from '../src/game/traps';
import { buildGeneratedWorld, createGeneratedRun, setRule, stepGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 13);
const centre = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });

describe('placement', () => {
  test.each(SEEDS)('seed %i: rings, exclusions, one per cell, static corridors, straight boulder lines', (seed) => {
    const world = buildGeneratedWorld(generateMaze(seed));
    const { maze, traps } = world;
    expect(placeTraps(maze, world.relic.cell)).toEqual(traps);
    expect(traps.length).toBeGreaterThanOrEqual(10);
    for (const ring of ['inner', 'middle', 'outer'] as const) {
      const here = traps.filter((t) => t.ring === ring);
      expect(here.length).toBeLessThanOrEqual(TRAPS_PER_RING[ring]);
      for (const kind of new Set(here.map((t) => t.kind))) expect(here.filter((t) => t.kind === kind).length).toBeLessThanOrEqual(Math.ceil(TRAPS_PER_RING[ring] / 3));
    }
    const forbidden = new Set([world.relic.cell, ...maze.landmarks.map((l) => l.cell)]);
    const cells: string[] = [];
    for (const trap of traps) {
      const own = trap.edge ? maze.edges.find((e) => e.id === trap.edge)! : null;
      const touched = own ? [own.a, own.b] : [trap.cell];
      for (const id of touched) { expect(maze.rings[id]).not.toBe('sanctuary'); expect(forbidden.has(id)).toBe(false); }
      cells.push(...touched);
      if (own) expect(own.gate).toBeUndefined();
      if (trap.kind === 'floorSpikes' || trap.kind === 'pit') expect(trap.edge).toBeNull();
      if (trap.kind === 'blade') expect(trap.plate).toBeNull(); else expect(trap.plate).not.toBeNull();
      if (trap.kind === 'boulder') {
        const { from, to } = trap.path!;
        expect(from.x === to.x || from.z === to.z).toBe(true);
        expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeGreaterThanOrEqual(BOULDER_MIN_EDGES * 12 - 1e-9);
        // Every step of the line is a static corridor.
        const steps = Math.round(Math.hypot(to.x - from.x, to.z - from.z) / 12);
        for (let i = 0; i < steps; i++) {
          const p = { x: from.x + ((to.x - from.x) * i) / steps, z: from.z + ((to.z - from.z) * i) / steps };
          const q = { x: from.x + ((to.x - from.x) * (i + 1)) / steps, z: from.z + ((to.z - from.z) * (i + 1)) / steps };
          const cellAt = (pt: { x: number; z: number }) => maze.cells.find((c) => { const c2 = cellPosition(c, maze); return c2.x === pt.x && c2.z === pt.z; })!;
          const edge = maze.edges.find((e) => e.id === edgeId(cellAt(p).id, cellAt(q).id));
          expect(edge?.gate).toBeUndefined();
          expect(edge).toBeDefined();
        }
      }
    }
    // Boulder lines may cross their own plate's cells; every other trap owns its cells alone.
    expect(new Set(cells).size).toBe(cells.length);
  });
});

// Behaviour on a fixed seed, one trap of each kind.
const world = buildGeneratedWorld(generateMaze(41));
const byKind = (kind: TrapKind) => {
  for (let s = 41; s < 400; s++) {
    const w = s === 41 ? world : buildGeneratedWorld(generateMaze(s));
    const trap = w.traps.find((t) => t.kind === kind);
    if (trap) return trap;
  }
  throw new Error(`no ${kind}`);
};
function run(trap: TrapSpec, bodies: (seconds: number) => Body[], seconds: number) {
  let states: TrapState[] = createTrapStates([trap]);
  const damage: { body: string; amount: number; lethal: boolean; at: number }[] = [];
  const phases: string[] = [];
  for (let step = 0; step < ticks(seconds); step++) {
    const time = step * FIXED_DT;
    const outcome = stepTraps([trap], states, bodies(time), FIXED_DT, time, step);
    states = outcome.states;
    if (phases.at(-1) !== states[0].phase) phases.push(states[0].phase);
    for (const hit of outcome.damage) damage.push({ ...hit, at: time });
  }
  return { states, damage, phases };
}
const on = (trap: TrapSpec, id = 'player'): Body => ({ id, ...centre(trap.plate ?? trap.zone), half: 0.3 });

describe('trap behaviour', () => {
  test('spears and floor spikes: a plate, a warning, one hit per activation, then re-arm', () => {
    for (const kind of ['spears', 'floorSpikes'] as const) {
      const trap = byKind(kind);
      const t = TRAP_TIMING[kind];
      const result = run(trap, () => [on(trap)], t.warning + t.active + t.cooldown + 0.5);
      expect(result.phases).toEqual(['warning', 'active', 'cooldown', 'armed', 'warning']);
      expect(result.damage.filter((d) => d.at < t.warning + t.active + 0.1)).toEqual([expect.objectContaining({ amount: TRAP_DAMAGE[kind], lethal: false })]);
      // Stepping off the plate before the warning ends avoids the hit.
      const dodged = run(trap, (time) => [time < 0.1 ? on(trap) : { id: 'player', x: 999, z: 999, half: 0.3 }], 3);
      expect(dodged.damage).toEqual([]);
    }
  });
  test('darts fire three volleys, each exactly once', () => {
    const trap = byKind('darts');
    const result = run(trap, () => [on(trap)], 2);
    expect(result.damage.map((d) => d.amount)).toEqual([TRAP_DAMAGE.dart, TRAP_DAMAGE.dart, TRAP_DAMAGE.dart]);
  });
  test('the pit opens after its warning and kills whatever stands over it', () => {
    const trap = byKind('pit');
    const standing = run(trap, () => [on(trap), on(trap, 'monster-1')], 2);
    expect(standing.damage.map((d) => [d.body, d.lethal])).toEqual([['player', true], ['monster-1', true]]);
    expect(standing.damage[0].at).toBeGreaterThanOrEqual(TRAP_TIMING.pit.warning - 1e-9);
    // Running straight off within the warning survives.
    const c = centre(trap.zone);
    const runner = run(trap, (time) => [{ id: 'player', x: c.x + 3 * time, z: c.z, half: 0.3 }], 2);
    expect(runner.damage).toEqual([]);
  });
  test('the boulder rolls the whole line and flattens bodies in its path, not beside it', () => {
    const trap = byKind('boulder');
    const { from, to } = trap.path!;
    const mid = { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 };
    const plate = on(trap);
    const roll = boulderRollSeconds(trap);
    const result = run(trap, (time) => [time < 0.1 ? plate : { id: 'player', x: 999, z: 999, half: 0.3 }, { id: 'boss', ...mid, half: 0.8 }],
      TRAP_TIMING.boulder.warning + roll + 0.5);
    expect(result.damage).toEqual([expect.objectContaining({ body: 'boss', lethal: true })]);
    expect(result.phases).toEqual(['warning', 'active', 'cooldown']);
    const halfway = boulderPosition(trap, { id: trap.id, phase: 'active', seconds: roll / 2, hits: {} })!;
    expect(halfway.x).toBeCloseTo(mid.x, 6); expect(halfway.z).toBeCloseTo(mid.z, 6);
  });
  test('blades swing without a plate and hit at most once per cooldown', () => {
    const trap = byKind('blade');
    const result = run(trap, () => [{ id: 'player', ...centre(trap.zone), half: 0.3 }], 4.8);
    expect(result.damage.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < result.damage.length; i++) expect(result.damage[i].at - result.damage[i - 1].at).toBeGreaterThanOrEqual(1.2 - 1e-9);
    const sweep = [0, 0.6, 1.2, 1.8].map((t) => centre(bladeRect(trap, t)));
    expect(new Set(sweep.map((p) => p.x.toFixed(2) + p.z.toFixed(2))).size).toBeGreaterThan(1);
  });
});

describe('traps in a run', () => {
  const place = (w: GeneratedWorld, trap: TrapSpec, patch: Partial<GeneratedRun> = {}): GeneratedRun =>
    ({ ...createGeneratedRun(w), status: 'out', player: { ...centre(trap.plate ?? trap.zone), yaw: 0 }, ...patch });
  const steps = (w: GeneratedWorld, r: GeneratedRun, n: number) => { for (let i = 0; i < n; i++) r = stepGeneratedRun(w, r, { forward: 0, strafe: 0 }, 0, FIXED_DT); return r; };
  test('stepping on spears costs health with sounds and events; switched off, nothing happens', () => {
    const trap = byKind('spears');
    const w = buildGeneratedWorld(generateMaze(world.traps.includes(trap) ? 41 : findSeed('spears')));
    const t = w.traps.find((x) => x.id === trap.id)!;
    const hurt = steps(w, place(w, t), ticks(2));
    expect(hurt.health).toBe(PLAYER_HEALTH - TRAP_DAMAGE.spears);
    expect(hurt.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['trap', 'hurt']));
    expect(hurt.sounds.map((s) => s.kind)).toEqual(expect.arrayContaining(['trapClick', 'trapFire', 'hurt']));
    const off = steps(w, setRule(place(w, t), 'traps', false), ticks(2));
    expect(off.health).toBe(PLAYER_HEALTH);
  });
  test('falling into a pit fails the run once, with the cause; reports keep health and trap state', () => {
    const seed = findSeed('pit');
    const w = buildGeneratedWorld(generateMaze(seed));
    const t = w.traps.find((x) => x.kind === 'pit')!;
    const midway = steps(w, place(w, t, { carrying: true }), ticks(0.4));
    const text = JSON.stringify(createRunReport(w, midway));
    const parsed = parseRunReport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const copy = reproduceRun(w, parsed.report).run;
    expect(copy.traps).toEqual(midway.traps);
    const dead = steps(w, midway, ticks(1));
    expect(dead).toMatchObject({ status: 'failed', killedBy: 'pit', health: 0 });
    expect(dead.events.filter((e) => e.kind === 'run' && e.detail.includes('pit, relic lost'))).toHaveLength(1);
    // The reproduced copy meets the same fate.
    expect(steps(w, copy, ticks(1))).toMatchObject({ status: 'failed', killedBy: 'pit' });
  });
});
function findSeed(kind: TrapKind) {
  for (let s = 41; s < 400; s++) if (buildGeneratedWorld(generateMaze(s)).traps.some((t) => t.kind === kind)) return s;
  throw new Error(kind);
}
