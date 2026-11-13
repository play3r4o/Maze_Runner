// M8 containers: seeded chests, the reliquary, monster remains and dropped sacks.
// Contents are rolled from seeded RNGs, so a seed always offers the same chests.
import { cellPosition, edgeId } from '../simulation/maze';
import { createRng } from '../simulation/mazeGenerator';
import type { GeneratedMaze, Ring } from '../simulation/mazeGenerator';
import { firstFit } from './inventory';
import type { GridItem, GridSize } from './inventory';
import { ITEMS, RARITIES, RELIC_ITEM } from './items';
import { CHESTS_PER_RING, CONTAINER_SIZES, GEAR_SHARE, LOOT_ROLLS, RARITY_WEIGHTS } from './tuning';
import { FINDABLE_GEAR, rollGear } from './equipment';
import type { TrapSpec } from './traps';

export type ContainerKind = keyof typeof CONTAINER_SIZES;
export type Container = {
  id: string; kind: ContainerKind; cell: string; x: number; z: number;
  width: number; height: number; items: GridItem[]; opened: boolean;
  // M17: a mimic waits inside (opening it wakes the monster instead).
  mimic?: boolean;
};
type LootRing = Exclude<Ring, 'sanctuary'>;
export const containerSize = (container: { width: number; height: number }): GridSize => ({ width: container.width, height: container.height });

// A small string hash for per-container seeds.
const hash = (text: string) => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// Roll `count` items for a ring into an empty grid. Relic-category items only from epic rolls;
// the legendary relic is never rolled (it lives in the reliquary).
export function rollLoot(seed: number, key: string, ring: LootRing, kind: 'chest' | 'remains', size: GridSize, uidPrefix: string, few = false): GridItem[] {
  const rng = createRng((seed ^ hash(key)) >>> 0);
  const [min, max] = LOOT_ROLLS[kind][ring];
  const count = Math.min(few ? 1 : max, min + rng.int(max - min + 1));
  const items: GridItem[] = [];
  for (let n = 0; n < count; n++) {
    const weights = RARITY_WEIGHTS[ring];
    let roll = rng.next() * (weights as readonly number[]).reduce((sum, w) => sum + w, 0);
    let rarity = 0;
    while (roll >= weights[rarity]) { roll -= weights[rarity]; rarity++; }
    // M16: about a third of rolls are gear of the rolled rarity, with rolled bonuses.
    if (rng.next() < GEAR_SHARE) {
      const def = rng.pick(FINDABLE_GEAR);
      const roll = rollGear(RARITIES[rarity], () => rng.next());
      const spot = firstFit(items, size, def.id, `${uidPrefix}.${n + 1}`);
      if (spot) items.push({ ...spot, roll });
      continue;
    }
    const options = ITEMS.filter((def) => def.rarity === RARITIES[rarity] && def.id !== RELIC_ITEM && def.category !== 'tool');
    const def = rng.pick(options);
    const spot = firstFit(items, size, def.id, `${uidPrefix}.${n + 1}`);
    if (spot) items.push(spot);
  }
  return items;
}

// Chest positions: the room corner with the fewest corridors beside it, 1.3 m from the centre.
function chestSpot(maze: GeneratedMaze, cellId: string) {
  const cell = maze.cells.find((item) => item.id === cellId)!;
  const { x, z } = cellPosition(cell, maze);
  const linked = (dc: number, dr: number) => {
    const other = maze.cells.find((item) => item.column === cell.column + dc && item.row === cell.row + dr);
    return other ? maze.edges.some((edge) => edge.id === edgeId(cell.id, other.id)) : false;
  };
  const corners = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sz]) => ({ sx, sz, open: Number(linked(sx, 0)) + Number(linked(0, sz)) }))
    .sort((a, b) => a.open - b.open);
  return { x: x + corners[0].sx * 1.3, z: z + corners[0].sz * 1.3 };
}

// Seeded chests and the reliquary. Never in Sanctuary, the relic room (other than the
// reliquary) or a room with a trap; one chest per cell. Item uids are prefixed later per run.
export function placeContainers(maze: GeneratedMaze, relic: { cell: string; x: number; z: number }, traps: readonly TrapSpec[]): Container[] {
  const rng = createRng((maze.seed ^ 0x3c6ef372) >>> 0);
  const blocked = new Set([relic.cell, ...traps.filter((trap) => trap.edge === null).map((trap) => trap.cell)]);
  const containers: Container[] = [];
  for (const ring of ['inner', 'middle', 'outer'] as const) {
    const options = rng.shuffle(maze.cells.filter((cell) => maze.rings[cell.id] === ring && !blocked.has(cell.id)));
    for (const cell of options.slice(0, (maze.counts?.chests ?? CHESTS_PER_RING)[ring])) {
      const id = `c${containers.length + 1}`;
      const size = CONTAINER_SIZES.chest;
      containers.push({ id, kind: 'chest', cell: cell.id, ...chestSpot(maze, cell.id), ...size, opened: false,
        items: rollLoot(maze.seed, id, ring, 'chest', size, id) });
    }
  }
  // M17: one outer chest is a mimic.
  const outer = containers.filter((container) => maze.rings[container.cell] === 'outer');
  if (outer.length) rng.pick(outer).mimic = true;
  const size = CONTAINER_SIZES.reliquary;
  containers.push({ id: 'reliquary', kind: 'reliquary', cell: relic.cell, x: relic.x, z: relic.z, ...size, opened: false,
    items: [{ uid: 'reliquary.1', item: RELIC_ITEM, x: 0, y: 0, rotated: false }] });
  return containers;
}

// Give every item a uid unique to this run (the run counter is part of it).
export const forRun = (containers: readonly Container[], runNumber: number): Container[] =>
  containers.map((container) => ({ ...container, items: container.items.map((item) => ({ ...item, uid: `r${runNumber}.${item.uid}` })) }));

// M17: what a brute or the Ram drops: rare-or-better gear (the Ram: epic or legendary, plus
// two rare-or-better valuables).
export function bossDrop(seed: number, key: string, kind: 'brute' | 'ram', size: GridSize, uidPrefix: string, ring: LootRing): GridItem[] {
  const rng = createRng((seed ^ hash(`${key}:drop`)) >>> 0);
  const items: GridItem[] = [];
  const add = (item: string, roll?: GridItem['roll']) => {
    const spot = firstFit(items, size, item, `${uidPrefix}.${items.length + 1}`);
    if (spot) items.push(roll ? { ...spot, roll } : spot);
  };
  const rarity = kind === 'ram' ? (rng.next() < 0.3 ? 'legendary' : 'epic') : (rng.next() < 0.25 ? 'epic' : 'rare');
  const gear = rng.pick(FINDABLE_GEAR);
  add(gear.id, rollGear(rarity, () => rng.next()));
  if (kind === 'ram') for (let n = 0; n < 2; n++) add(rng.pick(ITEMS.filter((def) => (def.category === 'valuable' || def.category === 'relic') && (def.rarity === 'rare' || def.rarity === 'epic'))).id);
  else for (const item of rollLoot(seed, key, ring, 'remains', size, `${uidPrefix}.x`)) add(item.item, item.roll);
  return items;
}
