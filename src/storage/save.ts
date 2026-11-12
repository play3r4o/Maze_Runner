// M8 local save (browser local storage). The only storage code; game rules never touch it.
// Format 1: { format, runs, bag, stash, inRun }. Unknown, corrupt or newer saves are
// reported once and replaced with an empty profile, so the game always starts.
import { gridValid } from '../game/inventory';
import type { GridItem } from '../game/inventory';
import { BAG_SIZE, STASH_SIZE } from '../game/tuning';

export const SAVE_KEY = 'shifting-labyrinth.save';
export const SAVE_FORMAT = 1;
export type Profile = { format: number; runs: number; bag: GridItem[]; stash: GridItem[]; inRun: boolean };
export const emptyProfile = (): Profile => ({ format: SAVE_FORMAT, runs: 0, bag: [], stash: [], inRun: false });

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): Store | null => { try { return window.localStorage; } catch { return null; } };

const isGridItem = (value: unknown): value is GridItem => typeof value === 'object' && value !== null
  && typeof (value as GridItem).uid === 'string' && typeof (value as GridItem).item === 'string'
  && Number.isInteger((value as GridItem).x) && Number.isInteger((value as GridItem).y) && typeof (value as GridItem).rotated === 'boolean';

export function parseProfile(text: string | null): { profile: Profile; notice: string | null } {
  if (text === null) return { profile: emptyProfile(), notice: null };
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { profile: emptyProfile(), notice: 'Your save could not be read and was reset.' }; }
  const d = data as Partial<Profile>;
  if (typeof data !== 'object' || data === null || typeof d.format !== 'number') return { profile: emptyProfile(), notice: 'Your save could not be read and was reset.' };
  if (d.format > SAVE_FORMAT) return { profile: emptyProfile(), notice: `Your save is from a newer version (format ${d.format}); starting fresh here.` };
  if (d.format !== SAVE_FORMAT || !Number.isInteger(d.runs) || (d.runs as number) < 0 || !Array.isArray(d.bag) || !Array.isArray(d.stash)
    || !d.bag.every(isGridItem) || !d.stash.every(isGridItem) || !gridValid(d.bag, BAG_SIZE) || !gridValid(d.stash, STASH_SIZE)
    || new Set([...d.bag, ...d.stash].map((entry) => entry.uid)).size !== d.bag.length + d.stash.length) {
    return { profile: emptyProfile(), notice: 'Your save was damaged and was reset.' };
  }
  const profile: Profile = { format: SAVE_FORMAT, runs: d.runs as number, bag: d.bag, stash: d.stash, inRun: d.inRun === true };
  // A run that never finished (page closed or reloaded) counts as abandoned: the bag is gone.
  if (profile.inRun) return { profile: { ...profile, inRun: false, bag: [] }, notice: 'Your last expedition was never finished. Whatever you carried is lost.' };
  return { profile, notice: null };
}
export function loadProfile(store: Store | null = storage()): { profile: Profile; notice: string | null } {
  try { return parseProfile(store?.getItem(SAVE_KEY) ?? null); } catch { return { profile: emptyProfile(), notice: null }; }
}
export function saveProfile(profile: Profile, store: Store | null = storage()): boolean {
  try { store?.setItem(SAVE_KEY, JSON.stringify(profile)); return Boolean(store); } catch { return false; }
}
export function clearProfile(store: Store | null = storage()) { try { store?.removeItem(SAVE_KEY); } catch { /* ignore */ } }

// Profile transitions around a run.
export const startedRun = (profile: Profile, runNumber: number): Profile => ({ ...profile, runs: Math.max(profile.runs, runNumber), bag: [], inRun: true });
export const finishedRun = (profile: Profile, extracted: boolean, bag: readonly GridItem[]): Profile =>
  ({ ...profile, bag: extracted ? bag.map((entry) => ({ ...entry })) : [], inRun: false });
