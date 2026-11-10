import type { PlayerState, WallRect } from './player';

export const ROOM_SIZE = 24;
export const PLAYER_SPAWN: Readonly<PlayerState> = { x: 0, z: 8, yaw: 0 };

export const ROOM_WALLS: readonly WallRect[] = [
  { id: 'north', minX: -12.5, maxX: 12.5, minZ: -12.5, maxZ: -12, height: 3 },
  { id: 'south', minX: -12.5, maxX: 12.5, minZ: 12, maxZ: 12.5, height: 3 },
  { id: 'west', minX: -12.5, maxX: -12, minZ: -12, maxZ: 12, height: 3 },
  { id: 'east', minX: 12, maxX: 12.5, minZ: -12, maxZ: 12, height: 3 },
  { id: 'block', minX: -1, maxX: 1, minZ: -1, maxZ: 1, height: 3 },
];
