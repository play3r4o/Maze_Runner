import { describe, expect, it } from 'vitest';
import { cellPosition, corridorRect, edgeId, findCell } from '../src/simulation/maze';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun, jamGate, jamTarget, requestGeneratedRunShift, stepGeneratedRun, toggleThread } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { ALL_RULES_ON, autoShiftTicks } from '../src/game/pressure';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';
import { FOOTSTEP_NOISE_METRES, JAM_SECONDS, NOISY_ITEM_NOISE_METRES, THREAD_METRES, ticks } from '../src/game/tuning';
import { emptyProfile, parseProfile, traceFor, withTrace } from '../src/storage/save';
import type { GridItem } from '../src/game/inventory';

const SAFE = { ...ALL_RULES_ON, traps: false, monsters: false };
const DT = 1 / 60;
const worldFor = (seed: number) => buildGeneratedWorld(generateMaze(seed));
const entry = (uid: string, item: string, x: number, y: number): GridItem => ({ uid, item, x, y, rotated: false });
const steps = (world: GeneratedWorld, run: GeneratedRun, count: number, intent = { forward: 0, strafe: 0 }, yaw = 0) => {
  for (let i = 0; i < count; i++) run = stepGeneratedRun(world, run, intent, yaw, DT);
  return run;
};
// A straight static corridor between two non-Sanctuary cells along x.
function corridor(world: GeneratedWorld) {
  const { maze } = world;
  for (const a of maze.cells) {
    const b = maze.cells.find((cell) => cell.column === a.column + 1 && cell.row === a.row);
    if (!b || maze.rings[a.id] === 'sanctuary' || maze.rings[b.id] === 'sanctuary') continue;
    const edge = maze.edges.find((item) => item.id === edgeId(a.id, b.id));
    if (edge && !edge.gate) return { a: cellPosition(a, maze), b: cellPosition(b, maze) };
  }
  throw new Error('no corridor');
}

describe('M8 stage 2: the maze reacts to what you carry', () => {
  const world = worldFor(41);

  it('T1: unrest is the sum over carried items; the interval follows the bag', () => {
    expect(autoShiftTicks(ALL_RULES_ON, [], 0)).toBe(ticks(45));
    expect(autoShiftTicks(ALL_RULES_ON, [{ item: 'ironScrap' }], 0)).toBe(ticks(39));
    expect(autoShiftTicks(ALL_RULES_ON, [{ item: 'ironScrap' }, { item: 'stoneIdol' }], 0)).toBe(ticks(21));
    expect(autoShiftTicks(ALL_RULES_ON, [{ item: 'stoneIdol' }, { item: 'gildedMask' }, { item: 'heartOfMaze' }], 0)).toBe(ticks(15));
    expect(autoShiftTicks(ALL_RULES_ON, [{ item: 'ruby' }, { item: 'hardtack' }], 0)).toBe(ticks(45));
    // Picking up a heavy item makes the countdown under way due sooner.
    let run: GeneratedRun = { ...createGeneratedRun(world, SAFE), status: 'out', autoTicks: ticks(30) };
    expect(steps(world, run, 1).shift.requests).toBe(0);
    run = { ...run, bag: [entry('i', 'stoneIdol', 0, 0)] };
    expect(steps(world, run, 1).shift.requests).toBe(1);
  });

  it('T3: walking makes footstep noise every half second, louder with noisy items; standing still makes none', () => {
    const { a } = corridor(world);
    const base: GeneratedRun = { ...createGeneratedRun(world, SAFE), status: 'out', leftSanctuary: true, player: { ...a, yaw: 0 } };
    expect(steps(world, base, 60).noise).toEqual([]);
    const walk = (run: GeneratedRun) => { const noises: number[] = []; for (let i = 0; i < 31; i++) { run = stepGeneratedRun(world, run, { forward: 0, strafe: 1 }, 0, DT); noises.push(...run.noise.map((n) => n.radius ?? 0)); run = { ...run, noise: [] }; } return { run, noises }; };
    expect(walk(base).noises).toEqual([FOOTSTEP_NOISE_METRES]);
    const loud = walk({ ...base, bag: [entry('c', 'copperCoins', 0, 0), entry('g', 'goldPurse', 1, 0)] });
    expect(loud.noises).toEqual([FOOTSTEP_NOISE_METRES + 2 * NOISY_ITEM_NOISE_METRES]);
    expect(loud.run.sounds.some((sound) => sound.kind === 'jingle')).toBe(true);
  });

  it('starter kit: a spool is added if missing and there is room; never twice', () => {
    expect(createGeneratedRun(world, SAFE, { runNumber: 3, starterKit: true }).bag).toEqual([entry('r3.spool', 'threadSpool', 0, 0)]);
    const kept = [entry('old', 'threadSpool', 2, 2)];
    expect(createGeneratedRun(world, SAFE, { runNumber: 4, bag: kept, starterKit: true }).bag).toEqual(kept);
    const full = [0, 2, 4].flatMap((x) => [0, 2].map((y) => entry(`r${x}${y}`, 'ropeCoil', x, y)));
    expect(createGeneratedRun(world, SAFE, { bag: full, starterKit: true }).bag).toEqual(full);
    expect(createGeneratedRun(world, SAFE).bag).toEqual([]);
  });

  it('T5: T lays thread one point per metre until it runs out; no spool, no thread', () => {
    const { a } = corridor(world);
    let run: GeneratedRun = { ...createGeneratedRun(world, SAFE, { starterKit: true }), status: 'out', leftSanctuary: true, player: { ...a, yaw: 0 } };
    expect(toggleThread({ ...run, bag: [] }).laying).toBe(false);
    run = toggleThread(run);
    expect(run.laying).toBe(true);
    run = steps(world, run, 125, { forward: 0, strafe: 1 }); // 6.25 m at 3 m/s
    const strand = run.thread[0];
    expect(strand.length).toBe(7);
    expect(run.threadLeft).toBeCloseTo(THREAD_METRES - 6, 6);
    strand.slice(1).forEach((point, i) => expect(Math.hypot(point.x - strand[i].x, point.z - strand[i].z)).toBeCloseTo(1, 6));
    run = toggleThread(run);
    run = steps(world, run, 60, { forward: 0, strafe: -1 });
    expect(run.thread[0]).toEqual(strand);
    // Running out stops laying.
    run = toggleThread({ ...run, threadLeft: 2.5 });
    run = steps(world, run, 90, { forward: 0, strafe: 1 });
    expect(run.laying).toBe(false);
    expect(run.threadLeft).toBe(0);
    expect(run.thread[1].length).toBe(4);
    expect(run.events.some((event) => event.detail === 'thread ran out')).toBe(true);
    // Dropping the spool stops it too.
    const dropped = steps(world, { ...toggleThread({ ...run, threadLeft: 10 }), bag: [] }, 2, { forward: 0, strafe: 1 });
    expect(dropped.laying).toBe(false);
  });

  it('T6: a closing gate within 3 m can be jammed once per plan by destroying an item; it holds 6 s, then finishes; no crush while held', () => {
    let run: GeneratedRun = requestGeneratedRunShift(world, { ...createGeneratedRun(world, SAFE), status: 'out', leftSanctuary: true,
      bag: [entry('a', 'ruby', 0, 0), entry('b', 'stoneIdol', 1, 0)] });
    const gate = run.shift.plan!.close;
    const edge = world.maze.edges.find((item) => item.gate === gate)!;
    const rect = corridorRect(world.maze, edge);
    const centre = { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
    const near = cellPosition(findCell(world.maze, edge.a), world.maze);
    run = { ...run, player: { ...near, yaw: 0 } };
    expect(jamTarget(world, run)).toBeNull(); // still in warning
    while (run.shift.phase !== 'closing') run = steps(world, run, 1);
    run = steps(world, run, 30);
    expect(jamTarget(world, { ...run, player: { x: centre.x + 50, z: centre.z, yaw: 0 } })).toBeNull();
    expect(jamTarget(world, run)).toBe(gate);
    const before = run.shift.openness[gate];
    run = jamGate(world, run, 'b');
    expect(run.bag.map((item) => item.uid)).toEqual(['a']);
    expect(run.jam).toEqual({ gate, seconds: JAM_SECONDS });
    expect(run.events.at(-1)!.detail).toContain('jammed with Stone Idol');
    expect(jamGate(world, run, 'a')).toBe(run); // one at a time
    const held = steps(world, run, ticks(JAM_SECONDS) - 2);
    expect(held.shift.openness[gate]).toBe(before);
    expect(held.shift.phase).toBe('closing');
    expect(held.shiftTicks).toBe(run.shiftTicks);
    const freed = steps(world, held, ticks(6));
    expect(freed.jam).toBeNull();
    expect(freed.shift.phase).not.toBe('closing');
    expect(freed.events.some((event) => event.detail.endsWith('jam gave way'))).toBe(true);
    // Once per gate per plan: a second plan may be jammed again.
    expect(jamTarget(world, { ...held, jam: null })).toBeNull();
  });

  it('reports carry thread and jam state and replay the gate exactly', () => {
    const { a } = corridor(world);
    let run: GeneratedRun = { ...createGeneratedRun(world, SAFE, { starterKit: true }), status: 'out', leftSanctuary: true, player: { ...a, yaw: 0 } };
    run = steps(world, toggleThread(run), 90, { forward: 0, strafe: 1 });
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { run: copy, mismatches } = reproduceRun(world, parsed.report);
    expect(mismatches).toEqual([]);
    expect(copy.thread).toEqual(run.thread);
    expect(copy.threadLeft).toBe(run.threadLeft);
    expect(copy.laying).toBe(true);
  });
});

describe('M8 stage 2: T8 traces', () => {
  it('dying keeps one trace per seed (most recent), upgrades format 1 saves, and finds traces by seed and generator', () => {
    let profile = emptyProfile();
    profile = withTrace(profile, { seed: 41, version: 'm5.1', x: 1, z: 2, chalk: [] });
    profile = withTrace(profile, { seed: 7, version: 'm5.1', x: 3, z: 4, chalk: [] });
    profile = withTrace(profile, { seed: 41, version: 'm5.1', x: 5, z: 6, chalk: [] });
    expect(profile.traces.map((trace) => [trace.seed, trace.x])).toEqual([[41, 5], [7, 3]]);
    expect(traceFor(profile, 41, 'm5.1')).toMatchObject({ x: 5, z: 6 });
    expect(traceFor(profile, 41, 'other')).toBeNull();
    for (let seed = 100; seed < 140; seed++) profile = withTrace(profile, { seed, version: 'm5.1', x: 0, z: 0, chalk: [] });
    expect(profile.traces).toHaveLength(20);
    const old = parseProfile(JSON.stringify({ format: 1, runs: 2, bag: [], stash: [], inRun: false }));
    expect(old).toEqual({ profile: { ...emptyProfile(), runs: 2 }, notice: null });
  });
});
