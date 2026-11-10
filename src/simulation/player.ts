export type PlayerState = {
  x: number;
  z: number;
  yaw: number;
};

export type MoveIntent = {
  forward: number;
  strafe: number;
};

export type WallRect = {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
};

export const PLAYER_HALF_WIDTH = 0.3;
export const PLAYER_SPEED = 3;
export const EYE_HEIGHT = 1.6;

// Sweep a point against walls inflated by the player's square footprint.
// Resolving X then Z permits wall sliding without skipping thin obstacles.
export function stepPlayer(
  player: PlayerState,
  intent: MoveIntent,
  walls: readonly WallRect[],
  dtSeconds: number,
): PlayerState {
  const length = Math.max(1, Math.hypot(intent.forward, intent.strafe));
  const distance = PLAYER_SPEED * Math.max(0, dtSeconds);
  const forward = intent.forward / length;
  const strafe = intent.strafe / length;
  const dx = (strafe * Math.cos(player.yaw) - forward * Math.sin(player.yaw)) * distance;
  const dz = (-forward * Math.cos(player.yaw) - strafe * Math.sin(player.yaw)) * distance;

  let x = player.x + dx;
  for (const wall of walls) {
    const minX = wall.minX - PLAYER_HALF_WIDTH;
    const maxX = wall.maxX + PLAYER_HALF_WIDTH;
    if (player.z <= wall.minZ - PLAYER_HALF_WIDTH || player.z >= wall.maxZ + PLAYER_HALF_WIDTH) continue;
    if (dx > 0 && player.x <= minX && x > minX) x = minX;
    if (dx < 0 && player.x >= maxX && x < maxX) x = maxX;
  }

  let z = player.z + dz;
  for (const wall of walls) {
    const minZ = wall.minZ - PLAYER_HALF_WIDTH;
    const maxZ = wall.maxZ + PLAYER_HALF_WIDTH;
    if (x <= wall.minX - PLAYER_HALF_WIDTH || x >= wall.maxX + PLAYER_HALF_WIDTH) continue;
    if (dz > 0 && player.z <= minZ && z > minZ) z = minZ;
    if (dz < 0 && player.z >= maxZ && z < maxZ) z = maxZ;
  }

  return { x, z, yaw: player.yaw };
}
