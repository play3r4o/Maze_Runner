// M7b pressure and wayfinding rules (plan T1–T4), as pure functions of plain run values.
import { AUTO_SHIFT_SECONDS, BELL_SECONDS, MIN_AUTO_SHIFT_SECONDS, NIGHT_AUTO_SHIFT_SECONDS, NIGHT_FADE_SECONDS,
  UNREST_STEP_SECONDS, ticks } from './tuning';
import { bagUnrest } from './items';

// Development toggles, each on by default, so a run can be compared with the plain M7 loop.
// `beams` controls the M7 light beams (navigation help), switchable for difficulty testing.
// `traps` (M12) and `monsters` (M10) switch the new dangers for comparison runs.
export type RuleToggles = { unrest: boolean; dusk: boolean; sound: boolean; chalk: boolean; beams: boolean; traps: boolean; monsters: boolean };
export const RULE_KEYS = ['unrest', 'dusk', 'sound', 'chalk', 'beams', 'traps', 'monsters'] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export const ALL_RULES_ON: Readonly<RuleToggles> = { unrest: true, dusk: true, sound: true, chalk: true, beams: true, traps: true, monsters: true };
export const ALL_RULES_OFF: Readonly<RuleToggles> = { unrest: false, dusk: false, sound: false, chalk: false, beams: false, traps: false, monsters: false };

// T1: sum of carried items' unrest (M8: provisions 0, materials 1, relics 3). Not shown on the player HUD.
export const unrestOf = (rules: RuleToggles, bag: readonly { item: string }[]) => rules.unrest ? bagUnrest(bag) : 0;

// T2: bells rung by a given run clock, and night after the last bell.
export const BELL_TICKS = BELL_SECONDS.map(ticks);
export const bellsDue = (runTicks: number) => BELL_TICKS.filter((tick) => runTicks >= tick).length;
export const isNight = (rules: RuleToggles, runTicks: number) => rules.dusk && runTicks >= BELL_TICKS[BELL_TICKS.length - 1];
// 0 by day, rising to 1 over the fade after night starts. Presentation only.
export function nightFactor(rules: RuleToggles, runTicks: number) {
  if (!rules.dusk) return 0;
  return Math.max(0, Math.min(1, (runTicks - BELL_TICKS[BELL_TICKS.length - 1]) / ticks(NIGHT_FADE_SECONDS)));
}
export const nextBellTick = (runTicks: number) => BELL_TICKS.find((tick) => tick > runTicks) ?? null;

// Steps of idle maze time before the next automatic shift. Night overrides unrest.
export function autoShiftTicks(rules: RuleToggles, bag: readonly { item: string }[], runTicks: number) {
  if (isNight(rules, runTicks)) return ticks(NIGHT_AUTO_SHIFT_SECONDS);
  return ticks(Math.max(MIN_AUTO_SHIFT_SECONDS, AUTO_SHIFT_SECONDS - UNREST_STEP_SECONDS * unrestOf(rules, bag)));
}

// T4 chalk lives in chalk.ts (free draw).

// T3: what the simulation tells the audio module. Positions are world metres; ids only grow.
export type SoundKind = 'shiftWarning' | 'gateGrind' | 'bellToll' | 'trapClick' | 'trapFire' | 'bladeSwish' | 'hurt'
  | 'shot' | 'boltHit' | 'monsterHurt' | 'monsterDie' | 'growl' | 'roar' | 'wardenStep' | 'jingle' | 'gateJam' | 'swing' | 'meleeHit';
// Sounds monsters hear (M10), whether or not sound is switched on for the player. Gates are
// not among them, so the maze alone never sends monsters hunting.
export const LOUD_SOUNDS = new Set<SoundKind>(['trapClick', 'trapFire', 'hurt', 'shot', 'boltHit']);
// `trap` names the trap kind for trapFire (boulder rumble, spikes, pit, darts).
export type SoundEvent = { id: number; kind: SoundKind; x: number; z: number; tick: number; seconds?: number; strikes?: number; trap?: string; monster?: string };
export const SOUND_LIMIT = 32;
