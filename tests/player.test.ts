import { describe, expect, it } from 'vitest';
import { PLAYER_HALF_WIDTH, stepPlayer } from '../src/simulation/player';
import type { MoveIntent, PlayerState, WallRect } from '../src/simulation/player';
import { PLAYER_SPAWN, ROOM_WALLS } from '../src/simulation/room';

function walk(start: PlayerState, intent: MoveIntent, ticks = 60, walls: readonly WallRect[] = []) {
  let player = start;
  for (let tick = 0; tick < ticks; tick += 1) player = stepPlayer(player, intent, walls, 1 / 60);
  return player;
}

describe('player movement', () => {
  it('does not move without input and does not mutate the source', () => {
    const start = Object.freeze({ ...PLAYER_SPAWN });
    expect(walk(start, { forward: 0, strafe: 0 })).toEqual(start);
  });

  it('moves three meters forward in one simulated second', () => {
    const result = walk({ ...PLAYER_SPAWN }, { forward: 1, strafe: 0 });
    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(5);
  });

  it('normalizes diagonal movement', () => {
    const result = walk({ x: 0, z: 0, yaw: 0 }, { forward: 1, strafe: 1 });
    expect(Math.hypot(result.x, result.z)).toBeCloseTo(3);
  });

  it.each([
    [0, 0, -3],
    [Math.PI / 2, -3, 0],
    [Math.PI, 0, 3],
    [-Math.PI / 2, 3, 0],
  ])('moves relative to yaw %s', (yaw, x, z) => {
    const result = walk({ x: 0, z: 0, yaw }, { forward: 1, strafe: 0 });
    expect(result.x).toBeCloseTo(x);
    expect(result.z).toBeCloseTo(z);
  });

  it('preserves partial analog intent', () => {
    const result = walk({ x: 0, z: 0, yaw: 0 }, { forward: 0.5, strafe: 0 });
    expect(result.z).toBeCloseTo(-1.5);
  });
});

describe('swept wall collision', () => {
  it.each([
    ['north', { forward: 1, strafe: 0 }, 'z', -11.7],
    ['south', { forward: -1, strafe: 0 }, 'z', 11.7],
    ['east', { forward: 0, strafe: 1 }, 'x', 11.7],
    ['west', { forward: 0, strafe: -1 }, 'x', -11.7],
  ] as const)('stops at the %s wall', (_name, intent, axis, expected) => {
    const result = walk({ x: 4, z: 4, yaw: 0 }, intent, 1000, ROOM_WALLS);
    expect(result[axis]).toBeCloseTo(expected);
  });

  it('stops at the central block', () => {
    const result = walk({ ...PLAYER_SPAWN }, { forward: 1, strafe: 0 }, 400, ROOM_WALLS);
    expect(result.z).toBeCloseTo(1 + PLAYER_HALF_WIDTH);
    expect(result.x).toBeCloseTo(0);
  });

  it('slides along a wall instead of stopping both axes', () => {
    const result = walk({ x: 11.7, z: 6, yaw: 0 }, { forward: 1, strafe: 1 }, 120, ROOM_WALLS);
    expect(result.x).toBeCloseTo(11.7);
    expect(result.z).toBeCloseTo(6 - 6 / Math.sqrt(2));
  });

  it('blocks diagonal travel into a room corner', () => {
    const result = walk({ x: 10, z: -10, yaw: 0 }, { forward: 1, strafe: 1 }, 300, ROOM_WALLS);
    expect(result.x).toBeCloseTo(11.7);
    expect(result.z).toBeCloseTo(-11.7);
  });

  const thinWall: WallRect = { id: 'thin', minX: 1, maxX: 1.01, minZ: -5, maxZ: 5, height: 3 };

  it('does not tunnel through a thin wall on a large displacement', () => {
    const result = stepPlayer({ x: 0, z: 0, yaw: 0 }, { forward: 0, strafe: 1 }, [thinWall], 10);
    expect(result.x).toBeCloseTo(0.7);
  });

  it('also blocks reverse travel through a thin wall', () => {
    const result = stepPlayer({ x: 3, z: 0, yaw: 0 }, { forward: 0, strafe: -1 }, [thinWall], 10);
    expect(result.x).toBeCloseTo(1.31);
  });

  it('chooses the nearest obstacle independently of wall ordering', () => {
    const far = { ...thinWall, id: 'far', minX: 4, maxX: 4.5 };
    for (const walls of [[far, thinWall], [thinWall, far]]) {
      const result = stepPlayer({ x: 0, z: 0, yaw: 0 }, { forward: 0, strafe: 1 }, walls, 10);
      expect(result.x).toBeCloseTo(0.7);
    }
  });

  it('keeps a footprint outside obstacles throughout an extended route', () => {
    let player = { ...PLAYER_SPAWN };
    const route = [
      { forward: 1, strafe: 0 }, { forward: 1, strafe: 1 },
      { forward: -1, strafe: 1 }, { forward: -1, strafe: -1 },
      { forward: 1, strafe: -1 },
    ];
    for (const intent of route) {
      for (let tick = 0; tick < 600; tick += 1) {
        player = stepPlayer(player, intent, ROOM_WALLS, 1 / 60);
        for (const wall of ROOM_WALLS) {
          const overlapX = player.x + PLAYER_HALF_WIDTH > wall.minX + 1e-8 && player.x - PLAYER_HALF_WIDTH < wall.maxX - 1e-8;
          const overlapZ = player.z + PLAYER_HALF_WIDTH > wall.minZ + 1e-8 && player.z - PLAYER_HALF_WIDTH < wall.maxZ - 1e-8;
          expect(overlapX && overlapZ).toBe(false);
        }
      }
    }
  });
});
