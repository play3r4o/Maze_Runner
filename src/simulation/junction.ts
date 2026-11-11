import type { PlayerState, WallRect } from './player';

export const GATE_IDS = ['north', 'east', 'south', 'west'] as const;
export type GateId = typeof GATE_IDS[number];
export type Arrangement = 'north-south' | 'east-west';
export type GateOpenness = Record<GateId, number>;

export const JUNCTION_SPAWN: Readonly<PlayerState> = { x: 0, z: 0, yaw: 0 };
export const GATE_TRAVEL = 4.5;
export const GATE_LENGTH = 8;
export const JUNCTION_SIZE = 40;

// Long crushing passages fit inside solid pockets; the outer loop stays clear.
export const JUNCTION_WALLS: readonly WallRect[] = [
  { id: 'north', minX: -20.5, maxX: 20.5, minZ: -20.5, maxZ: -20, height: 3 },
  { id: 'south', minX: -20.5, maxX: 20.5, minZ: 20, maxZ: 20.5, height: 3 },
  { id: 'west', minX: -20.5, maxX: -20, minZ: -20, maxZ: 20, height: 3 },
  { id: 'east', minX: 20, maxX: 20.5, minZ: -20, maxZ: 20, height: 3 },
  { id: 'quadrant-nw', minX: -14, maxX: -2, minZ: -14, maxZ: -2, height: 3 },
  { id: 'quadrant-ne', minX: 2, maxX: 14, minZ: -14, maxZ: -2, height: 3 },
  { id: 'quadrant-sw', minX: -14, maxX: -2, minZ: 2, maxZ: 14, height: 3 },
  { id: 'quadrant-se', minX: 2, maxX: 14, minZ: 2, maxZ: 14, height: 3 },
];

const CLOSED_GATES: Record<GateId, WallRect> = {
  north: { id: 'gate-north', minX: -2, maxX: 2, minZ: -6 - GATE_LENGTH, maxZ: -6, height: 3 },
  east: { id: 'gate-east', minX: 6, maxX: 6 + GATE_LENGTH, minZ: -2, maxZ: 2, height: 3 },
  south: { id: 'gate-south', minX: -2, maxX: 2, minZ: 6, maxZ: 6 + GATE_LENGTH, height: 3 },
  west: { id: 'gate-west', minX: -6 - GATE_LENGTH, maxX: -6, minZ: -2, maxZ: 2, height: 3 },
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
