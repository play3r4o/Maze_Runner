// M8 looting actions on a run: open the container in reach (E), move items between the open
// container and the bag (drag, rotate, right-click), and drop bag items into a sack at the
// player's feet. The maze keeps running while a container is open; these are applied
// between simulation steps like other player actions.
import { addRunEvent, isDead, isRunOver, withBag, withEquipment } from './generatedRun';
import { defaultSlot, equipItem, isTwoHanded, slotAccepts, unequipItem } from './equipment';
import type { Equipment, Slot } from './equipment';
import type { GeneratedRun } from './generatedRun';
import { firstFit, findItem, fits, moveBetween, quickMove, withoutItem } from './inventory';
import type { GridItem } from './inventory';
import { itemDef } from './items';
import { containerSize } from './loot';
import type { Container } from './loot';
import { BAG_SIZE, CONTAINER_SIZES, LOOT_REACH, SACK_JOIN_DISTANCE } from './tuning';

export type GridName = 'bag' | 'container';
const canAct = (run: GeneratedRun) => !isDead(run) && !isRunOver(run.status);
const distance = (run: GeneratedRun, container: Container) => Math.hypot(container.x - run.player.x, container.z - run.player.z);

// The nearest container within reach (empty sacks are gone, so never offered).
export function containerInReach(run: GeneratedRun): Container | null {
  if (!canAct(run)) return null;
  return run.containers.filter((container) => distance(run, container) <= LOOT_REACH && !(container.kind === 'sack' && !container.items.length))
    .sort((a, b) => distance(run, a) - distance(run, b))[0] ?? null;
}
export const openContainerOf = (run: GeneratedRun) => run.containers.find((container) => container.id === run.openContainer) ?? null;

// E: open the container in reach (or close the open one).
export function interactGeneratedRun(run: GeneratedRun): GeneratedRun {
  if (run.openContainer) return { ...run, openContainer: null };
  const container = containerInReach(run);
  if (!container) return run;
  return { ...run, openContainer: container.id, containers: run.containers.map((item) => (item.id === container.id ? { ...item, opened: true } : item)),
    events: container.opened ? run.events : addRunEvent(run, 'loot', `opened ${container.kind} ${container.id} in ${container.cell} (${container.items.length} items)`) };
}
export const closeLoot = (run: GeneratedRun): GeneratedRun => (run.openContainer ? { ...run, openContainer: null } : run);

function setContainer(run: GeneratedRun, id: string, items: GridItem[]): GeneratedRun {
  // Empty sacks disappear; chests and remains stay, even when empty.
  const containers = run.containers.flatMap((container) => container.id !== id ? [container]
    : container.kind === 'sack' && !items.length ? [] : [{ ...container, items }]);
  return { ...run, containers, openContainer: containers.some((container) => container.id === run.openContainer) ? run.openContainer : null };
}
function grids(run: GeneratedRun, name: GridName) {
  if (name === 'bag') return { items: run.bag, size: BAG_SIZE };
  const open = openContainerOf(run);
  return open && distance(run, open) <= LOOT_REACH + 0.25 ? { items: open.items, size: containerSize(open) } : null;
}
function store(run: GeneratedRun, name: GridName, items: GridItem[]) {
  return name === 'bag' ? withBag(run, items) : setContainer(run, run.openContainer!, items);
}
function logTake(run: GeneratedRun, from: GridName, to: GridName, uid: string): GeneratedRun {
  if (from === to) return run;
  const entry = findItem(to === 'bag' ? run.bag : openContainerOf(run)?.items ?? [], uid);
  const name = entry ? itemDef(entry.item).name : uid;
  return { ...run, events: addRunEvent(run, 'loot', `${to === 'bag' ? 'took' : 'left'} ${name}`) };
}

// Drag: move one item to a spot (x, y, rotation) in the bag or the open container.
export function lootMove(run: GeneratedRun, from: GridName, uid: string, to: GridName, target: { x: number; y: number; rotated: boolean }): GeneratedRun {
  if (!canAct(run) && !(run.status === 'ready' && from === 'bag' && to === 'bag')) return run;
  const source = grids(run, from), destination = grids(run, to);
  if (!source || !destination) return run;
  const moved = moveBetween(source.items, destination.items, destination.size, uid, target, from === to);
  if (!moved) return run;
  let next = store(run, from, moved.from);
  if (from !== to) next = store(next, to, moved.to);
  return logTake(next, from, to, uid);
}
// Right-click: first free spot on the other side.
export function lootQuickMove(run: GeneratedRun, from: GridName, uid: string): GeneratedRun {
  if (!canAct(run)) return run;
  const to: GridName = from === 'bag' ? 'container' : 'bag';
  const source = grids(run, from), destination = grids(run, to);
  if (!source || !destination) return run;
  const moved = quickMove(source.items, destination.items, destination.size, uid);
  if (!moved) return run;
  return logTake(store(store(run, from, moved.from), to, moved.to), from, to, uid);
}
// Drop a bag item at the player's feet: into a sack within reach that has room, else a new sack.
export function dropFromBag(run: GeneratedRun, uid: string): GeneratedRun {
  if (!canAct(run) || run.status !== 'out') return run;
  const entry = findItem(run.bag, uid);
  if (!entry) return run;
  const size = CONTAINER_SIZES.sack;
  const near = run.containers.find((container) => container.kind === 'sack'
    && distance(run, container) <= SACK_JOIN_DISTANCE && firstFit(container.items, size, entry.item, uid));
  let next = withBag(run, withoutItem(run.bag, uid));
  if (near) {
    next = setContainer(next, near.id, [...near.items, firstFit(near.items, size, entry.item, uid)!]);
  } else {
    const id = `sack${run.nextSack}`;
    const spot = firstFit([], size, entry.item, uid)!;
    next = { ...next, nextSack: run.nextSack + 1, containers: [...next.containers,
      { id, kind: 'sack', cell: run.cell ?? '', x: run.player.x, z: run.player.z, ...size, items: [spot], opened: true }] };
  }
  return { ...next, events: addRunEvent(next, 'loot', `dropped ${itemDef(entry.item).name}`) };
}
// Whether a spot is free for an item in a grid (for drag previews).
export const spotFree = (items: readonly GridItem[], size: { width: number; height: number }, entry: GridItem) => fits(items, size, entry);

// M16: where right-click puts gear: a free matching slot first (a one-handed weapon goes to
// the off hand if the main hand is taken), otherwise replace the usual slot.
export function smartSlot(equipment: Equipment, entry: GridItem): Slot | null {
  const slot = defaultSlot(entry);
  if (slot === 'mainHand' && equipment.mainHand && !equipment.offHand && !isTwoHanded(entry) && slotAccepts(equipment, 'offHand', entry)) return 'offHand';
  return slot;
}
const canEquipNow = (run: GeneratedRun, from: GridName) => canAct(run) || (run.status === 'ready' && from === 'bag');
// Equip from the bag or the open container.
export function lootEquip(run: GeneratedRun, from: GridName, uid: string, slot?: Slot): GeneratedRun {
  if (!canEquipNow(run, from)) return run;
  const source = grids(run, from);
  const entry = source ? findItem(source.items, uid) : null;
  if (!source || !entry) return run;
  const target = slot ?? smartSlot(run.equipment, entry);
  if (!target) return run;
  const result = equipItem(run.equipment, source.items, source.size, uid, target);
  if (!result) return run;
  const next = withEquipment(store(run, from, result.source), result.equipment);
  return { ...next, events: addRunEvent(next, 'loot', `equipped ${itemDef(entry.item).name}`) };
}
// Take gear off into the bag or the open container (at a spot, or the first free one).
export function lootUnequip(run: GeneratedRun, slot: Slot, to: GridName, target?: { x: number; y: number; rotated: boolean }): GeneratedRun {
  if (!canEquipNow(run, to)) return run;
  const dest = grids(run, to);
  if (!dest) return run;
  const result = unequipItem(run.equipment, slot, dest.items, dest.size, target);
  if (!result) return run;
  return withEquipment(store(run, to, result.dest), result.equipment);
}
