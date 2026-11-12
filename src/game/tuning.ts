// Every gameplay number for the solo expedition (M7) and pressure rules (M7b) lives here.
// They are starting defaults for playtesting: change them here, never as literals elsewhere.
// Simulation runs at a fixed 60 steps per second, so seconds convert to steps with `ticks()`.
export const STEPS_PER_SECOND = 60;
export const ticks = (seconds: number) => Math.round(seconds * STEPS_PER_SECOND);

// M7 expedition.
export const AUTO_SHIFT_SECONDS = 45;
export const RELIC_REACH = 1.6;

// T1 unrest: seconds between automatic shifts = max(MIN, BASE − STEP × unrest).
export const RELIC_UNREST = 3;
export const UNREST_STEP_SECONDS = 6;
export const MIN_AUTO_SHIFT_SECONDS = 15;

// T2 dusk bell: strikes at these run-clock seconds (1, 2 then 3 strikes); night after the last.
export const BELL_SECONDS = [150, 195, 240] as const;
export const NIGHT_AUTO_SHIFT_SECONDS = 10;
export const NIGHT_FADE_SECONDS = 10;

// T4 chalk, free draw (developer request 2026-11-12): metres of line per run, how far the
// chalk reaches from the eye, point spacing, the largest gap that still continues a stroke,
// and a cap on separate strokes.
export const CHALK_INK_METRES = 30;
export const CHALK_REACH = 2.5;
export const CHALK_MIN_STEP = 0.03;
export const CHALK_MAX_JUMP = 0.5;
export const CHALK_STROKE_LIMIT = 300;

// T8 daily seed: the UTC date as YYYYMMDD.
export function dailySeed(now: Date): number {
  return now.getUTCFullYear() * 10000 + (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
}

// Player health (M10/M12). No regeneration during a run.
export const PLAYER_HEALTH = 100;

// M12 traps. Counts per ring; every trap has a 1.2 m pressure plate unless noted.
export const TRAPS_PER_RING = { inner: 2, middle: 5, outer: 9 } as const;
export const PLATE_SIZE = 1.2;
export const TRAP_TIMING = {
  // seconds: warning after a plate is pressed, active time, cooldown before it re-arms.
  boulder: { warning: 0.6, active: 0, cooldown: 25 }, // active lasts as long as the roll
  spears: { warning: 0.6, active: 1.2, cooldown: 12 },
  floorSpikes: { warning: 0.8, active: 1.5, cooldown: 12 },
  pit: { warning: 0.8, active: 6, cooldown: 10 },
  darts: { warning: 0.3, active: 1.5, cooldown: 10 },
} as const;
export const TRAP_DAMAGE = { spears: 40, floorSpikes: 45, dart: 12, blade: 35 } as const;
export const BOULDER_SPEED = 7;
export const BOULDER_RADIUS = 1.6;
export const BOULDER_MIN_EDGES = 3;
export const DART_VOLLEY_SECONDS = [0, 0.5, 1.0] as const;
export const PIT_SIZE = 3;
export const SPIKE_FIELD_SIZE = 3.6;
export const CORRIDOR_ZONE_LENGTH = 5;
// Swinging blade: no plate, always moving across the corridor.
export const BLADE_PERIOD = 2.4;
export const BLADE_SWING = 1.6;
export const BLADE_THICKNESS = 0.3;
export const BLADE_WIDTH = 0.5;
export const BLADE_HIT_COOLDOWN = 1.2;

// M10 monsters (widened). Killable husks and skitters per ring; unkillable wardens.
export const MONSTERS_PER_RING = {
  inner: { husk: 1, skitter: 0 }, middle: { husk: 2, skitter: 2 }, outer: { husk: 2, skitter: 3 },
} as const;
export const WARDEN_COUNT = 1;
// Speeds in m/s (the player walks at 3). damage per hit, attackEvery in seconds between hits.
export const MONSTER_STATS = {
  husk: { health: 75, half: 0.4, patrol: 1.1, chase: 1.9, damage: 20, attackEvery: 1.2 },
  skitter: { health: 25, half: 0.3, patrol: 1.8, chase: 3.6, damage: 8, attackEvery: 0.7 },
  // The warden has no health: only a boulder, a pit or a closing gate kills it.
  warden: { health: 1, half: 0.6, patrol: 1.4, chase: 2.6, damage: 45, attackEvery: 1.5 },
} as const;
export const MONSTER_SIGHT = 20; // metres, needs a clear line
export const MONSTER_HEARING = 22; // metres, through stone
export const MONSTER_REACH = 0.5; // gap between bodies at which a monster hits
export const MONSTER_SEARCH_WAIT = 3; // seconds looking around at a noise or last sighting
export const NIGHT_MONSTER_SPEED = 1.15;
export const WARDEN_RESPAWN_SECONDS = 45;
export const WARDEN_BOLT_STUN = 1.5;
export const WARDEN_TRAP_STUN = 0.5;
export const WARDEN_STEP_SECONDS = 0.55;
export const NOISE_LIMIT = 16;

// Minimal M11 crossbow: left mouse button while the chalk is away.
export const CROSSBOW_BOLTS = 16;
export const CROSSBOW_RELOAD = 0.8;
export const BOLT_SPEED = 45;
export const BOLT_RANGE = 40;
export const BOLT_DAMAGE = 25;

// M8 inventory and loot.
export const BAG_SIZE = { width: 6, height: 4 } as const;
export const STASH_SIZE = { width: 12, height: 10 } as const;
export const CONTAINER_SIZES = {
  chest: { width: 4, height: 3 }, remains: { width: 3, height: 2 }, reliquary: { width: 2, height: 2 }, sack: { width: 4, height: 4 },
} as const;
export const CHESTS_PER_RING = { inner: 2, middle: 4, outer: 6 } as const;
// Items rolled per container [min, max] by ring; remains of skitters roll at most one.
export const LOOT_ROLLS = {
  chest: { inner: [1, 2], middle: [2, 3], outer: [2, 4] },
  remains: { inner: [0, 1], middle: [1, 1], outer: [1, 2] },
} as const;
// Rarity weights by ring (common, uncommon, rare, epic).
export const RARITY_WEIGHTS = {
  inner: [70, 25, 5, 0], middle: [45, 35, 17, 3], outer: [25, 35, 28, 12],
} as const;
export const LOOT_REACH = 2;
export const SACK_JOIN_DISTANCE = 1.5;

// M8 stage 2.
// T3: walking makes noise every half second: 6 m, plus 2 m per noisy item carried.
export const FOOTSTEP_SECONDS = 0.5;
export const FOOTSTEP_NOISE_METRES = 6;
export const NOISY_ITEM_NOISE_METRES = 2;
// T5: thread from the starter-kit spool, one point per metre walked.
export const THREAD_METRES = 150;
export const THREAD_POINT_SPACING = 1;
// T6: sacrificing an item holds a closing gate.
export const JAM_SECONDS = 6;
export const JAM_RANGE = 3;
// T8: death traces kept per seed, most recent seeds first.
export const TRACE_SEEDS_KEPT = 20;
