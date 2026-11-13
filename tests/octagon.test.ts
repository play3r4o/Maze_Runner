import { describe, expect, it } from 'vitest';
import { cellPosition, corridorRect, deriveMazeWalls, findCell, gateRect, plazaRect } from '../src/simulation/maze';
import { serializeMaze } from '../src/simulation/mazeGenerator';
import { reachableMazeCells } from '../src/simulation/mazeGraph';
import { HOME_GATE, OCTAGON_ROOM_HALF, RING_SLOTS, generateOctagon, inOctagon } from '../src/simulation/octagon';
import { buildGeneratedWorld, createGeneratedRun, finalSealTick, homeOpenness, requestGeneratedRunShift, spawnPoint, startMatch,
  stepGeneratedRun, teleportGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { ALL_RULES_ON, BELL_TICKS } from '../src/game/pressure';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';
import { MATCH, RING_TURN, ticks } from '../src/game/tuning';
import { nextRingTurn, ringDoorOpenness, ringTurnAt } from '../src/game/ringTurns';
import { overlapsBody } from '../src/simulation/movingWalls';

const SAFE = { ...ALL_RULES_ON, traps: false, monsters: false, unrest: false };
const DT = 1 / 60;
const worldFor = (seed: number) => buildGeneratedWorld(generateOctagon(seed));
const steps = (world: GeneratedWorld, run: GeneratedRun, count: number, intent = { forward: 0, strafe: 0 }, yaw = 0) => {
  for (let i = 0; i < count; i++) run = stepGeneratedRun(world, run, intent, yaw, DT);
  return run;
};
const centre = 6;
const offset = (id: string, world: GeneratedWorld) => { const c = findCell(world.maze, id); return { dx: c.column - centre, dy: c.row - centre }; };
// Open the gate and walk out of the lobby into the hub.
function leaveLobby(world: GeneratedWorld, run: GeneratedRun) {
  run = startMatch(world, run);
  run = steps(world, run, ticks(MATCH.countdown) + ticks(1.5) + 2);
  return steps(world, run, ticks(5), { forward: 1, strafe: 0 }, 0);
}

describe('M18 octagon layout', () => {
  it('is deterministic and generates for many seeds', () => {
    expect(serializeMaze(generateOctagon(7))).toBe(serializeMaze(generateOctagon(7)));
    expect(serializeMaze(generateOctagon(7))).not.toBe(serializeMaze(generateOctagon(8)));
    for (let seed = 0; seed < 150; seed++) expect(() => generateOctagon(seed)).not.toThrow();
  });

  it('has an eight-sided maze of rooms, one home sanctuary outside it and seven sealed bases', () => {
    const maze = generateOctagon(41);
    const inside = maze.cells.filter((cell) => maze.rings[cell.id] !== 'sanctuary');
    expect(inside).toHaveLength(109);
    expect(inside.every((cell) => inOctagon(cell.column - centre, cell.row - centre))).toBe(true);
    expect(maze.rings[maze.start]).toBe('sanctuary');
    expect(maze.roomHalf).toBe(OCTAGON_ROOM_HALF);
    expect(maze.sanctuaries).toHaveLength(8);
    expect(maze.sanctuaries!.filter((base) => base.home)).toHaveLength(1);
    // Core = 3×3 chamber, middle ring = distance 2–3, outer (entry) ring = distance 4–5.
    const tiers = { outer: 0, middle: 0, inner: 0 };
    for (const cell of inside) tiers[maze.rings[cell.id] as keyof typeof tiers]++;
    expect(tiers).toEqual({ outer: 9, middle: 40, inner: 60 });
    expect(maze.ringNames!.inner).toBe('Outer ring');
    expect(maze.ringNames!.outer).toBe('Core');
  });

  it('keeps the home gate out of the shift gates and starts it closed', () => {
    const maze = generateOctagon(41);
    expect(maze.gates).not.toContain(HOME_GATE);
    expect(maze.initialOpenness[HOME_GATE]).toBe(0);
    const home = maze.edges.find((edge) => edge.gate === HOME_GATE)!;
    expect([home.a, home.b]).toContain(maze.start);
    expect([home.a, home.b]).toContain(maze.hub);
    // The home sanctuary has no other way in.
    expect(maze.edges.filter((edge) => edge.a === maze.start || edge.b === maze.start)).toHaveLength(1);
  });

  it('joins rings by a few doorways only and keeps every room reachable with every shift gate closed', () => {
    for (const seed of [1, 41, 99]) {
      const maze = generateOctagon(seed);
      const crossing = (a: string, b: string) => maze.edges.filter((edge) => [maze.rings[edge.a], maze.rings[edge.b]].sort().join() === [a, b].sort().join());
      // Rings meet only at ring doors, one per side per boundary, half open at the start.
      for (const [a, b, n] of [['inner', 'middle', 1], ['middle', 'outer', 2]] as const) {
        const doors = crossing(a, b);
        expect(doors).toHaveLength(RING_SLOTS);
        expect(doors.every((edge) => edge.gate?.startsWith(`ring${n}-`))).toBe(true);
        expect(doors.filter((edge) => maze.initialOpenness[edge.gate!] === 1)).toHaveLength(RING_SLOTS / 2);
      }
      // With either half of the ring doors open and every shift gate closed, every room connects.
      for (const parity of [0, 1]) {
        const rings = Object.fromEntries(maze.edges.filter((edge) => edge.gate?.startsWith('ring')).map((edge) => [edge.gate!, Number(Number(edge.gate!.slice(-1)) % 2 === parity)]));
        expect(reachableMazeCells(maze, { [HOME_GATE]: 1, ...rings }, maze.start).size).toBe(maze.cells.length);
      }
    }
  });

  it('builds 10 m rooms with 4 m doorways, and the closed home gate fills its doorway', () => {
    const world = worldFor(41);
    const home = world.maze.edges.find((edge) => edge.gate === HOME_GATE)!;
    const door = corridorRect(world.maze, home);
    expect(door.maxX - door.minX).toBe(4);
    expect(door.maxZ - door.minZ).toBe(2);
    const shut = gateRect(world.maze, home, 0);
    expect(shut).toMatchObject({ minX: door.minX, maxX: door.maxX });
    // Open, the slab sits fully in stone beside the doorway.
    const open = gateRect(world.maze, home, 1);
    expect(open.minX >= door.maxX || open.maxX <= door.minX).toBe(true);
    const rect = plazaRect(world.maze)!;
    expect(rect.maxX - rect.minX).toBe(10);
    const spawn = spawnPoint(world.maze);
    expect(deriveMazeWalls(world.maze).some((wall) => overlapsBody({ ...spawn, yaw: 0 }, wall))).toBe(false);
  });

  it('puts the relic and the Ram in the core and keeps the lobby and hub free of traps and monsters', () => {
    for (const seed of [3, 41]) {
      const world = worldFor(seed);
      expect(world.maze.rings[world.relic.cell]).toBe('outer');
      expect(world.monsters.find((m) => m.kind === 'ram')!.home).toEqual(['outer']);
      expect(world.maze.rings[world.monsters.find((m) => m.kind === 'ram')!.at]).toBe('outer');
      const quiet = [world.maze.start, world.maze.hub!];
      expect(world.traps.some((trap) => quiet.includes(trap.cell))).toBe(false);
      expect(world.monsters.some((m) => quiet.includes(m.at))).toBe(false);
      expect(world.containers.length).toBeGreaterThan(10);
    }
  });
});

describe('M18 match flow', () => {
  it('starts in the closed lobby; walking at the gate does nothing until the match starts', () => {
    const world = worldFor(41);
    let run = createGeneratedRun(world, SAFE);
    const spawn = spawnPoint(world.maze);
    expect(run.player).toMatchObject(spawn);
    expect(offset(world.maze.start, world)).toEqual({ dx: 0, dy: 6 });
    run = steps(world, run, ticks(4), { forward: 1, strafe: 0 });
    expect(run.status).toBe('ready');
    expect(run.player.z).toBeGreaterThan(plazaRect(world.maze)!.minZ);
    expect(run.runTicks).toBe(0);
  });

  it('E in the lobby counts down, opens the gate, starts the clock and lets you out', () => {
    const world = worldFor(41);
    let run = startMatch(world, createGeneratedRun(world, SAFE));
    expect(run.match.opensAt).toBe(ticks(MATCH.countdown));
    expect(startMatch(world, run).match.opensAt).toBe(run.match.opensAt);
    run = steps(world, run, ticks(MATCH.countdown) - 1);
    expect(run.status).toBe('ready');
    expect(homeOpenness(run)).toBe(0);
    run = steps(world, run, 2);
    expect(run.status).toBe('out');
    run = steps(world, run, ticks(1.5));
    expect(run.shift.openness[HOME_GATE]).toBe(1);
    run = steps(world, run, ticks(5), { forward: 1, strafe: 0 });
    expect(run.leftSanctuary).toBe(true);
    expect(run.cell).toBe(world.maze.hub);
  });

  it('extracting through your own gate shuts it behind you', () => {
    const world = worldFor(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    expect(run.leftSanctuary).toBe(true);
    run = steps(world, run, ticks(5), { forward: -1, strafe: 0 });
    expect(run.status).toBe('extracted');
    expect(run.match.via).toBe('home');
    expect(run.shift.openness[HOME_GATE]).toBe(0);
  });

  it('opens the core extract only at night; standing on it extracts, stepping off resets', () => {
    const world = worldFor(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    const coreCell = world.maze.cells.find((cell) => cell.column === centre && cell.row === centre)!.id;
    const landmarkThere = world.maze.landmarks.some((landmark) => landmark.cell === coreCell);
    expect(landmarkThere).toBe(false);
    run = teleportGeneratedRun(world, run, coreCell).run;
    run = steps(world, run, ticks(MATCH.coreSeconds + 1));
    expect(run.status).toBe('out');
    expect(run.match.channel).toBe(0);
    run = { ...run, runTicks: BELL_TICKS[2] + 1, bells: 3 };
    run = steps(world, run, ticks(2));
    expect(run.match.channel).toBeGreaterThan(1.9);
    run = steps(world, run, ticks(1), { forward: 1, strafe: 0 });
    expect(run.match.channel).toBe(0);
    run = steps(world, run, ticks(1), { forward: -1, strafe: 0 });
    run = steps(world, run, ticks(MATCH.coreSeconds) + 2);
    expect(run.status).toBe('extracted');
    expect(run.match.via).toBe('core');
  });

  it('seals everyone in when the final seal comes', () => {
    const world = worldFor(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    run = steps(world, { ...run, runTicks: finalSealTick() - 2, bells: 3 }, 3);
    expect(run.status).toBe('failed');
    expect(run.killedBy).toBe('seal');
    expect(run.shift.openness[HOME_GATE]).toBe(0);
  });

  it('shifts work while the lobby gate is still shut', () => {
    const world = worldFor(41);
    const run = requestGeneratedRunShift(world, createGeneratedRun(world, SAFE));
    expect(run.shift.log.at(-1)!.outcome).toBe('accepted');
  });

  it('a bug report round-trips on the octagon, home gate included', () => {
    const world = worldFor(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    run = steps(world, run, ticks(3), { forward: 1, strafe: 0.3 });
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { run: back, mismatches } = reproduceRun(world, parsed.report);
    expect(mismatches).toEqual([]);
    expect(back.match).toEqual(run.match);
    expect(back.shift.openness[HOME_GATE]).toBe(1);
    expect(back.player).toMatchObject({ x: run.player.x, z: run.player.z });
    // Same cell centre for the hub as the layout says.
    expect(cellPosition(findCell(world.maze, world.maze.hub!), world.maze)).toEqual({ x: 0, z: 60 });
  });
});

describe('M18 stage 2: rings seal and turn', () => {
  const at = (seconds: number) => Math.round(seconds * 60);
  it('follows the schedule: warning, closing, sealed, opening the other half; boundaries alternate', () => {
    expect(ringTurnAt(at(59))).toBeNull();
    expect(ringTurnAt(at(60))).toMatchObject({ index: 0, boundary: 1, phase: 'warning' });
    expect(ringTurnAt(at(RING_TURN.first + RING_TURN.warning + 0.5))).toMatchObject({ boundary: 1, phase: 'closing' });
    expect(ringTurnAt(at(RING_TURN.first + RING_TURN.warning + RING_TURN.closing + 1))).toMatchObject({ phase: 'sealed' });
    expect(ringTurnAt(at(120))).toMatchObject({ index: 1, boundary: 2, phase: 'warning' });
    expect(nextRingTurn(0)).toEqual({ index: 0, boundary: 1, seconds: 60 });
    // Before: even doors open. Sealed: all shut. After: odd doors open. The core boundary waits.
    expect([ringDoorOpenness('ring1-0', 0), ringDoorOpenness('ring1-1', 0)]).toEqual([1, 0]);
    expect(ringDoorOpenness('ring1-0', at(61))).toBe(1);
    expect(ringDoorOpenness('ring1-0', at(65))).toBeCloseTo(0.5, 5);
    expect([ringDoorOpenness('ring1-0', at(67)), ringDoorOpenness('ring1-1', at(67))]).toEqual([0, 0]);
    expect(ringDoorOpenness('ring1-1', at(71))).toBeCloseTo(0.5, 5);
    expect([ringDoorOpenness('ring1-0', at(80)), ringDoorOpenness('ring1-1', at(80))]).toEqual([0, 1]);
    expect([ringDoorOpenness('ring2-0', at(80)), ringDoorOpenness('ring2-1', at(80))]).toEqual([1, 0]);
    expect([ringDoorOpenness('ring2-0', at(140)), ringDoorOpenness('ring2-1', at(140))]).toEqual([0, 1]);
    // The outer boundary turns back at 180 s.
    expect([ringDoorOpenness('ring1-0', at(200)), ringDoorOpenness('ring1-1', at(200))]).toEqual([1, 0]);
    expect(ringDoorOpenness('g1', 0)).toBeNull();
  });

  it('the run applies the ring doors to the maze: a closed ring door blocks, a turn moves the way through', () => {
    const world = worldFor(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    const doors = world.maze.edges.filter((edge) => edge.gate?.startsWith('ring1-'));
    expect(doors.filter((edge) => run.shift.openness[edge.gate!] === 1).map((edge) => edge.gate).sort()).toEqual(['ring1-0', 'ring1-2', 'ring1-4', 'ring1-6']);
    run = steps(world, { ...run, runTicks: at(66) - 1 }, 2);
    expect(doors.every((edge) => run.shift.openness[edge.gate!] === 0)).toBe(true);
    expect(run.events.some((event) => event.detail.includes('outer ring is sealed'))).toBe(true);
    run = steps(world, { ...run, runTicks: at(80) }, 1);
    expect(doors.filter((edge) => run.shift.openness[edge.gate!] === 1).map((edge) => edge.gate).sort()).toEqual(['ring1-1', 'ring1-3', 'ring1-5', 'ring1-7']);
    // Shifts still validate while the ring is sealed.
    run = steps(world, { ...run, runTicks: at(66) }, 1);
    expect(requestGeneratedRunShift(world, run).shift.log.at(-1)!.outcome).toBe('accepted');
  });

  it('a closing ring door pushes a body standing in it, like any gate', () => {
    const world = worldFor(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    const door = world.maze.edges.find((edge) => edge.gate === 'ring1-0')!;
    const rect = corridorRect(world.maze, door);
    const x = (rect.minX + rect.maxX) / 2, z = (rect.minZ + rect.maxZ) / 2;
    run = { ...run, player: { ...run.player, x, z }, runTicks: at(RING_TURN.first + RING_TURN.warning) };
    run = steps(world, run, ticks(RING_TURN.closing) + 2);
    const pushed = Math.hypot(run.player.x - x, run.player.z - z) > 0.5 || run.crushedBy === 'ring1-0';
    expect(pushed).toBe(true);
  });

  it('bug reports replay ring doors from the run clock', () => {
    const world = worldFor(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    run = steps(world, { ...run, runTicks: at(68) }, 1);
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    if (!parsed.ok) throw new Error(parsed.error);
    const back = reproduceRun(world, parsed.report).run;
    for (const edge of world.maze.edges.filter((item) => item.gate?.startsWith('ring'))) expect(back.shift.openness[edge.gate!]).toBe(run.shift.openness[edge.gate!]);
  });
});
