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
