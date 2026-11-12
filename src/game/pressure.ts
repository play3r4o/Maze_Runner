// M7b pressure and wayfinding rules (plan T1–T4), as pure functions of plain run values.
import { AUTO_SHIFT_SECONDS, BELL_SECONDS, MIN_AUTO_SHIFT_SECONDS, NIGHT_AUTO_SHIFT_SECONDS, NIGHT_FADE_SECONDS, RELIC_UNREST,
  UNREST_STEP_SECONDS, ticks } from './tuning';

// Development toggles, each on by default, so a run can be compared with the plain M7 loop.
// `beams` controls the M7 light beams (navigation help), switchable for difficulty testing.
export type RuleToggles = { unrest: boolean; dusk: boolean; sound: boolean; chalk: boolean; beams: boolean };
export const RULE_KEYS = ['unrest', 'dusk', 'sound', 'chalk', 'beams'] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
export const ALL_RULES_ON: Readonly<RuleToggles> = { unrest: true, dusk: true, sound: true, chalk: true, beams: true };
export const ALL_RULES_OFF: Readonly<RuleToggles> = { unrest: false, dusk: false, sound: false, chalk: false, beams: false };

// T1: sum of carried unrest values (only the relic exists in M7b). Not shown on the player HUD.
export const unrestOf = (rules: RuleToggles, carrying: boolean) => rules.unrest && carrying ? RELIC_UNREST : 0;

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
export function autoShiftTicks(rules: RuleToggles, carrying: boolean, runTicks: number) {
  if (isNight(rules, runTicks)) return ticks(NIGHT_AUTO_SHIFT_SECONDS);
  return ticks(Math.max(MIN_AUTO_SHIFT_SECONDS, AUTO_SHIFT_SECONDS - UNREST_STEP_SECONDS * unrestOf(rules, carrying)));
}

// T4: chalk marks point where the player faced, snapped to 8 compass directions.
// 0 north (−Z), 1 north-east, 2 east (+X), … 7 north-west. Yaw 0 faces north; positive yaw turns left.
export type ChalkMark = { id: number; x: number; z: number; headingIndex: number };
export const headingIndexForYaw = (yaw: number) => ((Math.round(-yaw / (Math.PI / 4)) % 8) + 8) % 8;
export const HEADING_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

// T3: what the simulation tells the audio module. Positions are world metres; ids only grow.
export type SoundKind = 'shiftWarning' | 'gateGrind' | 'bellToll';
export type SoundEvent = { id: number; kind: SoundKind; x: number; z: number; tick: number; seconds?: number; strikes?: number };
export const SOUND_LIMIT = 32;
