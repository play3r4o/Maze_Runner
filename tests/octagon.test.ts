import { describe, expect, it } from 'vitest';
import { cellPosition, corridorRect, deriveMazeWalls, findCell, gateRect, plazaRect } from '../src/simulation/maze';
import { serializeMaze } from '../src/simulation/mazeGenerator';
import { reachableMazeCells, scheduledOpen } from '../src/simulation/mazeGraph';
import { HOME_GATE, OCTAGON_WALL_HEIGHT, RING_SLOTS, generateOctagon, inOctagon } from '../src/simulation/octagon';
import { buildGeneratedWorld, createGeneratedRun, finalSealTick, homeOpenness, requestGeneratedRunShift, spawnPoint, startMatch,
  stepGeneratedRun, teleportGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { ALL_RULES_ON, BELL_TICKS } from '../src/game/pressure';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';
import { MATCH, RING_TURN, ticks } from '../src/game/tuning';
import { nextRingTurn, ringDoorOpenness, ringTurnAt, turnsAt } from '../src/game/ringTurns';
import { ringAtPoint, rotatePoint, turnedMaze, worldFor } from '../src/game/ringRotation';
import { overlapsBody } from '../src/simulation/movingWalls';

const SAFE = { ...ALL_RULES_ON, traps: false, monsters: false, unrest: false };
const DT = 1 / 60;
const worldFor0 = (seed: number) => buildGeneratedWorld(generateOctagon(seed));
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
    expect(maze.wallHeight).toBe(OCTAGON_WALL_HEIGHT);
    expect(inside.every((cell) => inOctagon(cell.column - centre, cell.row - centre))).toBe(true);
    expect(maze.rings[maze.start]).toBe('sanctuary');
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
    // The home base (a three-room yard) has no other way in.
    const yard = new Set(maze.cells.filter((cell) => maze.rings[cell.id] === 'sanctuary').map((cell) => cell.id));
    expect(yard.size).toBe(3);
    expect(maze.edges.filter((edge) => yard.has(edge.a) !== yard.has(edge.b)).map((edge) => edge.gate)).toEqual([HOME_GATE]);
  });

  it('joins rings only at eight fixed ring doors per boundary, all open, and keeps every room reachable', () => {
    for (const seed of [1, 41, 99]) {
      const maze = generateOctagon(seed);
      const crossing = (a: string, b: string) => maze.edges.filter((edge) => [maze.rings[edge.a], maze.rings[edge.b]].sort().join() === [a, b].sort().join());
      for (const [a, b, n] of [['inner', 'middle', 1], ['middle', 'outer', 2]] as const) {
        const doors = crossing(a, b);
        expect(doors).toHaveLength(RING_SLOTS);
        expect(doors.every((edge) => edge.gate?.startsWith(`ring${n}-`) && maze.initialOpenness[edge.gate] === 1)).toBe(true);
      }
      expect(reachableMazeCells(maze, scheduledOpen(maze), maze.start).size).toBe(maze.cells.length);
    }
  });

  it('builds the square maze\'s corridors with walls 12 m tall, and the shut home gate fills its corridor', () => {
    const world = worldFor0(41);
    const home = world.maze.edges.find((edge) => edge.gate === HOME_GATE)!;
    const corridor = corridorRect(world.maze, home);
    expect([corridor.maxX - corridor.minX, corridor.maxZ - corridor.minZ]).toEqual([4, 8]);
    expect(gateRect(world.maze, home, 0)).toMatchObject({ minX: corridor.minX, maxX: corridor.maxX, height: 12 });
    expect(world.walls.every((wall) => wall.height === 12)).toBe(true);
    const spawn = spawnPoint(world.maze);
    expect(deriveMazeWalls(world.maze).some((wall) => overlapsBody({ ...spawn, yaw: 0 }, wall))).toBe(false);
  });

  it('puts the relic and the Ram in the core and keeps the lobby and hub free of traps and monsters', () => {
    for (const seed of [3, 41]) {
      const world = worldFor0(seed);
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
    const world = worldFor0(41);
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
    const world = worldFor0(41);
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
    const world = worldFor0(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    expect(run.leftSanctuary).toBe(true);
    run = steps(world, run, ticks(5), { forward: -1, strafe: 0 });
    expect(run.status).toBe('extracted');
    expect(run.match.via).toBe('home');
    expect(run.shift.openness[HOME_GATE]).toBe(0);
  });

  it('opens the core extract only at night; standing on it extracts, stepping off resets', () => {
    const world = worldFor0(41);
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
    const world = worldFor0(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    run = steps(world, { ...run, runTicks: finalSealTick() - 2, bells: 3 }, 3);
    expect(run.status).toBe('failed');
    expect(run.killedBy).toBe('seal');
    expect(run.shift.openness[HOME_GATE]).toBe(0);
  });

  it('shifts work while the lobby gate is still shut', () => {
    const world = worldFor0(41);
    const run = requestGeneratedRunShift(world, createGeneratedRun(world, SAFE));
    expect(run.shift.log.at(-1)!.outcome).toBe('accepted');
  });

  it('a bug report round-trips on the octagon, home gate included', () => {
    const world = worldFor0(41);
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

describe('M18 rework: rings turn on each bell and you ride them', () => {
  const bell = (index: number) => BELL_TICKS[index];
  const mid = (index: number) => bell(index) + ticks(RING_TURN.closing) + ticks(RING_TURN.sealed) / 2;
  it('turns the outer ring on bell 1, the middle on bell 2, both on bell 3, sealing their doors around it', () => {
    expect(ringTurnAt(bell(0) - 1)).toBeNull();
    expect(ringTurnAt(bell(0))).toMatchObject({ index: 0, rings: ['inner'], phase: 'closing' });
    expect(ringTurnAt(bell(1) + ticks(3))).toMatchObject({ rings: ['middle'], phase: 'sealed' });
    expect(ringTurnAt(bell(2) + ticks(7))).toMatchObject({ rings: ['inner', 'middle'], phase: 'opening' });
    expect(ringTurnAt(bell(0), false)).toBeNull();
    expect(nextRingTurn(0)).toMatchObject({ index: 0, rings: ['inner'] });
    expect(turnsAt(mid(0) - 1)).toEqual({ inner: 0, middle: 0 });
    expect(turnsAt(mid(0))).toEqual({ inner: 1, middle: 0 });
    expect(turnsAt(mid(1))).toEqual({ inner: 1, middle: 3 });
    expect(turnsAt(mid(2))).toEqual({ inner: 2, middle: 2 });
    expect(turnsAt(mid(2), false)).toEqual({ inner: 0, middle: 0 });
    // Bell 1 seals the home gate and the outer ring's doors; the core doors stay open.
    const during = bell(0) + ticks(3);
    expect([ringDoorOpenness('home', during), ringDoorOpenness('ring1-3', during), ringDoorOpenness('ring2-3', during)]).toEqual([0, 0, 1]);
    expect(ringDoorOpenness('ring1-3', bell(0) + ticks(1))).toBeCloseTo(0.5, 5);
    expect([ringDoorOpenness('home', bell(1) + ticks(3)), ringDoorOpenness('ring1-0', bell(1) + ticks(3)), ringDoorOpenness('ring2-0', bell(1) + ticks(3))]).toEqual([1, 0, 0]);
    expect(ringDoorOpenness('g1', bell(0) + ticks(3))).toBeNull();
  });

  it('turns a ring\'s corridors, gates, traps and chests a quarter about the centre; doors, core and base stay', () => {
    const world = worldFor0(41);
    const turned = worldFor(world, { inner: 1, middle: 0 });
    expect(worldFor(world, { inner: 1, middle: 0 })).toBe(turned);
    expect(worldFor(turned, { inner: 0, middle: 0 })).toBe(world);
    expect(turned.maze.edges).toHaveLength(world.maze.edges.length);
    const four = turnedMaze(turnedMaze(world.maze, { inner: 2, middle: 0 }), { inner: 2, middle: 0 });
    expect(four.edges.map((edge) => edge.id)).toEqual(world.maze.edges.map((edge) => edge.id));
    for (const edge of world.maze.edges.filter((item) => item.gate?.startsWith('ring') || item.gate === HOME_GATE)) expect(turned.maze.edges).toContainEqual(edge);
    expect(turned.maze.edges.map((edge) => edge.gate).filter(Boolean).sort()).toEqual(world.maze.edges.map((edge) => edge.gate).filter(Boolean).sort());
    const outerChest = world.containers.find((container) => world.maze.rings[container.cell] === 'inner')!;
    const moved = turned.containers.find((container) => container.id === outerChest.id)!;
    expect({ x: moved.x, z: moved.z }).toEqual(rotatePoint({ x: outerChest.x, z: outerChest.z }, 1));
    const coreChest = world.containers.find((container) => world.maze.rings[container.cell] === 'outer')!;
    expect(turned.containers.find((container) => container.id === coreChest.id)).toEqual(coreChest);
    expect(reachableMazeCells(turned.maze, scheduledOpen(turned.maze), turned.maze.start).size).toBe(turned.maze.cells.length);
  });

  it('you ride the ring: standing in the outer ring at the turn moves you a quarter round, facing turns too', () => {
    const world = worldFor0(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    expect(ringAtPoint(world, run.player)).toBe('inner');
    const before = { ...run.player };
    run = steps(world, { ...run, runTicks: mid(0) - 2, bells: 1 }, 2);
    expect(run.player.x).toBeCloseTo(rotatePoint(before, 1).x, 1);
    expect(run.player.z).toBeCloseTo(rotatePoint(before, 1).z, 1);
    expect(run.player.yaw).toBeCloseTo(before.yaw - Math.PI / 2, 5);
    expect(run.events.some((event) => event.detail.includes('ring turned'))).toBe(true);
    // Now west of the centre; still in a junction or corridor, not in stone.
    const live = worldFor(world, { inner: 1, middle: 0 });
    expect(live.walls.some((wall) => overlapsBody(run.player, wall))).toBe(false);
  });

  it('someone in the core is not moved; chalk in a turning ring is ground away', () => {
    const world = worldFor0(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    const coreCell = world.maze.cells.find((cell) => cell.column === centre && cell.row === centre + 1)!.id;
    run = teleportGeneratedRun(world, run, coreCell).run;
    const at = { ...run.player };
    const stroke = { id: 99, surface: 'x', normal: [0, 0, 1] as [number, number, number], points: [[0, 1, 60] as [number, number, number]] };
    run = steps(world, { ...run, chalk: [stroke], runTicks: mid(0) - 2, bells: 1 }, 3);
    expect(run.player).toMatchObject({ x: at.x, z: at.z });
    expect(run.chalk).toEqual([]);
  });

  it('bug reports rebuild the turned rings from the run clock', () => {
    const world = worldFor0(41);
    let run = leaveLobby(world, createGeneratedRun(world, SAFE));
    run = steps(world, { ...run, runTicks: mid(0) - 2, bells: 1 }, 4);
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    if (!parsed.ok) throw new Error(parsed.error);
    const { run: back, mismatches } = reproduceRun(world, parsed.report);
    expect(mismatches).toEqual([]);
    expect(back.player).toMatchObject({ x: run.player.x, z: run.player.z });
  });
});
