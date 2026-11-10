import type { PlayerState, WallRect } from './player';
import { PLAYER_HALF_WIDTH } from './player';
import { ROOM_WALLS } from './room';

export const GATE_IDS = ['north', 'east', 'south', 'west'] as const;
export type GateId = typeof GATE_IDS[number];
export type Arrangement = 'north-south' | 'east-west';
export type GateOpenness = Record<GateId, number>;

export const JUNCTION_SPAWN: Readonly<PlayerState> = { x: 0, z: 0, yaw: 0 };
export const GATE_TRAVEL = 4.5;
const SAFETY_MARGIN = 0.15;

// Four solid quadrants leave a four-meter cross and a fixed outer return loop.
export const JUNCTION_WALLS: readonly WallRect[] = [
  ...ROOM_WALLS.filter((wall) => wall.id !== 'block'),
  { id: 'quadrant-nw', minX: -8, maxX: -2, minZ: -8, maxZ: -2, height: 3 },
  { id: 'quadrant-ne', minX: 2, maxX: 8, minZ: -8, maxZ: -2, height: 3 },
  { id: 'quadrant-sw', minX: -8, maxX: -2, minZ: 2, maxZ: 8, height: 3 },
  { id: 'quadrant-se', minX: 2, maxX: 8, minZ: 2, maxZ: 8, height: 3 },
];

const CLOSED_GATES: Record<GateId, WallRect> = {
  north: { id: 'gate-north', minX: -2, maxX: 2, minZ: -4.25, maxZ: -3.75, height: 3 },
  east: { id: 'gate-east', minX: 3.75, maxX: 4.25, minZ: -2, maxZ: 2, height: 3 },
  south: { id: 'gate-south', minX: -2, maxX: 2, minZ: 3.75, maxZ: 4.25, height: 3 },
  west: { id: 'gate-west', minX: -4.25, maxX: -3.75, minZ: -2, maxZ: 2, height: 3 },
};

export function openGatesFor(arrangement: Arrangement): readonly GateId[] {
  return arrangement === 'north-south' ? ['north', 'south'] : ['east', 'west'];
}

export function gateRect(id: GateId, openness: number): WallRect {
  const closed = CLOSED_GATES[id];
  const offset = Math.max(0, Math.min(1, openness)) * GATE_TRAVEL;
  const horizontal = id === 'north' || id === 'south';
  return {
    ...closed,
    minX: closed.minX + (horizontal ? offset : 0),
    maxX: closed.maxX + (horizontal ? offset : 0),
    minZ: closed.minZ + (horizontal ? 0 : offset),
    maxZ: closed.maxZ + (horizontal ? 0 : offset),
  };
}

export function gateColliders(openness: GateOpenness): WallRect[] {
  return GATE_IDS.map((id) => gateRect(id, openness[id]));
}

export function occupiesGateSweep(id: GateId, player: PlayerState): boolean {
  const closed = gateRect(id, 0);
  const open = gateRect(id, 1);
  const padding = PLAYER_HALF_WIDTH + SAFETY_MARGIN;
  return player.x >= Math.min(closed.minX, open.minX) - padding
    && player.x <= Math.max(closed.maxX, open.maxX) + padding
    && player.z >= Math.min(closed.minZ, open.minZ) - padding
    && player.z <= Math.max(closed.maxZ, open.maxZ) + padding;
}

// Only five fixture nodes: each outer arm is connected to the next by the
// permanent perimeter loop. Moving gates are conservatively not counted open.
export function hasReturnRoutes(openness: GateOpenness): boolean {
  type Node = GateId | 'hub';
  const links: [Node, Node][] = [
    ['north', 'east'], ['east', 'south'], ['south', 'west'], ['west', 'north'],
  ];
  for (const id of GATE_IDS) if (openness[id] === 1) links.push(['hub', id]);
  const reached = new Set<Node>(['hub']);
  const queue: Node[] = ['hub'];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [a, b] of links) {
      const next = a === current ? b : b === current ? a : undefined;
      if (next !== undefined && !reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached.size === 5;
}
