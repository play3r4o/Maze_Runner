// M8 grid inventory: items take rectangles of cells, may be rotated a quarter turn, never
// overlap and never leave their grid. Pure functions on plain arrays.
import { ITEM_BY_ID, itemDef, itemValue } from './items';
import type { GearRoll } from './items';

// `roll` is present on gear (M16): its rarity and bonus stats.
export type GridItem = { uid: string; item: string; x: number; y: number; rotated: boolean; roll?: GearRoll };
export type GridSize = { width: number; height: number };

export const footprint = (entry: { item: string; rotated: boolean }) => {
  const def = itemDef(entry.item);
  return entry.rotated ? { w: def.height, h: def.width } : { w: def.width, h: def.height };
};
export const canRotate = (item: string) => { const def = itemDef(item); return def.width !== def.height; };

// Whether `entry` fits at its x, y, ignoring the item with uid `ignore` (the one being moved).
export function fits(grid: readonly GridItem[], size: GridSize, entry: GridItem, ignore = entry.uid): boolean {
  if (!ITEM_BY_ID.has(entry.item) || !Number.isInteger(entry.x) || !Number.isInteger(entry.y)) return false;
  if (entry.rotated && !canRotate(entry.item)) return false;
  const { w, h } = footprint(entry);
  if (entry.x < 0 || entry.y < 0 || entry.x + w > size.width || entry.y + h > size.height) return false;
  return grid.every((other) => {
    if (other.uid === ignore) return true;
    const o = footprint(other);
    return entry.x + w <= other.x || other.x + o.w <= entry.x || entry.y + h <= other.y || other.y + o.h <= entry.y;
  });
}
// First free spot scanning rows then columns, upright first, then rotated.
export function firstFit(grid: readonly GridItem[], size: GridSize, item: string, uid: string): GridItem | null {
  for (const rotated of canRotate(item) ? [false, true] : [false]) {
    for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
      const entry = { uid, item, x, y, rotated };
      if (fits(grid, size, entry)) return entry;
    }
  }
  return null;
}
export const withoutItem = (grid: readonly GridItem[], uid: string) => grid.filter((entry) => entry.uid !== uid);
export const findItem = (grid: readonly GridItem[], uid: string) => grid.find((entry) => entry.uid === uid) ?? null;

// Move an item to a spot in another (or the same) grid. Returns the new grids, or null if
// the item is not in `from` or does not fit at the target.
export function moveBetween(from: readonly GridItem[], to: readonly GridItem[], toSize: GridSize, uid: string,
  target: { x: number; y: number; rotated: boolean }, same = false): { from: GridItem[]; to: GridItem[] } | null {
  const entry = findItem(from, uid);
  if (!entry) return null;
  const placed = { ...entry, ...target };
  const destination = same ? from : to;
  if (!fits(destination, toSize, placed)) return null;
  if (same) { const grid = from.map((item) => (item.uid === uid ? placed : item)); return { from: grid, to: grid }; }
  return { from: withoutItem(from, uid), to: [...to, placed] };
}
// Right-click: first free spot on the other side.
export function quickMove(from: readonly GridItem[], to: readonly GridItem[], toSize: GridSize, uid: string) {
  const entry = findItem(from, uid);
  if (!entry) return null;
  const spot = firstFit(to, toSize, entry.item, uid);
  return spot ? { from: withoutItem(from, uid), to: [...to, spot] } : null;
}
export const gridValue = (grid: readonly GridItem[]) => grid.reduce((sum, entry) => sum + itemValue(entry), 0);
export const gridCells = (grid: readonly GridItem[]) => grid.reduce((sum, entry) => { const f = footprint(entry); return sum + f.w * f.h; }, 0);
// A whole grid is valid: known items, in bounds, no overlaps, unique uids.
export function gridValid(grid: readonly GridItem[], size: GridSize): boolean {
  const uids = new Set(grid.map((entry) => entry.uid));
  if (uids.size !== grid.length) return false;
  return grid.every((entry, i) => fits(grid.slice(0, i), size, entry));
}
