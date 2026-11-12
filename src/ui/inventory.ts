// M8 bag, loot and stash screens, and the M16 character panel: grids of cells and equipment
// slots, with items dragged between them. Presentation and input only; every move is
// decided by the game rules (handlers).
import { canRotate, fits, footprint } from '../game/inventory';
import type { GridItem, GridSize } from '../game/inventory';
import { PERCENT_STATS, RARITY_COLORS, STAT_NAMES, itemDef, itemRarity, itemValue } from '../game/items';
import type { StatKey } from '../game/items';
import { SLOTS, SLOT_NAMES, slotAccepts } from '../game/equipment';
import type { Equipment, Slot, Stats } from '../game/equipment';

export type GridKey = 'bag' | 'container' | 'stash' | 'trader';
export type InventoryView = {
  left: { key: 'container' | 'stash' | 'trader'; title: string; size: GridSize; items: readonly GridItem[]; prices?: Record<string, number>; note?: string } | null;
  // M16 base screen: the stash beside a trader, tabs, gold, and whether the character panel shows.
  second?: { key: 'stash'; title: string; size: GridSize; items: readonly GridItem[] } | null;
  tabs?: { id: string; label: string; active: boolean }[]; gold?: number; showCharacter?: boolean;
  bag: readonly GridItem[]; bagSize: GridSize;
  canDrop: boolean; hint: string;
  // M16 character: worn gear, totals and a line about the weapon in hand.
  equipment: Equipment; stats: Stats; maxHealth: number; weapon: string;
};
export type InventoryHandlers = {
  move(from: GridKey, uid: string, to: GridKey, target: { x: number; y: number; rotated: boolean }): void;
  quick(from: GridKey, uid: string): void;
  drop(uid: string): void;
  equip(from: GridKey, uid: string, slot: Slot): void;
  unequip(slot: Slot, to: GridKey, target?: { x: number; y: number; rotated: boolean }): void;
  tab?(id: string): void;
  close(): void;
};
const CELL = 46;
const signed = (value: number, percent: boolean) => `${value > 0 ? '+' : ''}${value}${percent ? '%' : ''}`;

// Item details for tooltips: rarity, slot, base stats, rolled bonuses, weapon numbers, value.
export function describeItem(entry: GridItem): string {
  const def = itemDef(entry.item);
  const rarity = itemRarity(entry);
  const lines = [`<strong style="color:${RARITY_COLORS[rarity]}">${def.name}</strong>`];
  if (def.gear) {
    const gear = def.gear;
    lines.push(`<span>${rarity} ${gear.twoHanded ? 'two-handed ' : ''}${gear.slot}</span>`);
    if (gear.weapon) lines.push(gear.weapon.kind === 'crossbow' ? `<b>Bolts ${gear.weapon.damage} damage · 16 per run</b>` : `<b>${gear.weapon.damage} damage · ${gear.weapon.reach} m reach · ${gear.weapon.cooldown}s</b>`);
    if (gear.block) lines.push(`<b>Blocks ${gear.block}% from the front (right mouse)</b>`);
    for (const [key, value] of Object.entries(gear.stats)) lines.push(`<b>${STAT_NAMES[key as StatKey]} ${signed(value as number, PERCENT_STATS.has(key as StatKey))}</b>`);
    for (const bonus of entry.roll?.bonuses ?? []) lines.push(`<b class="bonus">${STAT_NAMES[bonus.stat]} ${signed(bonus.value, PERCENT_STATS.has(bonus.stat))}</b>`);
  } else lines.push(`<span>${rarity} ${def.category} · ${def.width}×${def.height}</span>`);
  lines.push(`<span>${itemValue(entry)} gold</span>`, `<em>${def.description}</em>`);
  return lines.join('');
}

export function createInventoryUI(host: HTMLElement, handlers: InventoryHandlers) {
  const root = document.createElement('div');
  root.className = 'inventory';
  root.setAttribute('data-testid', 'inventory');
  root.hidden = true;
  root.innerHTML = `
    <div class="inventory-panels">
      <section class="inventory-panel" data-panel="left"><div class="base-tabs" data-testid="base-tabs" hidden></div><h2 data-testid="inventory-left-title"></h2>
        <p class="trader-note" data-testid="trader-note" hidden></p><div class="inventory-grid" data-grid="left"></div></section>
      <section class="inventory-panel" data-panel="second" hidden><h2 data-testid="inventory-second-title"></h2><div class="inventory-grid" data-grid="second"></div></section>
      <section class="inventory-panel character" data-panel="character"><h2>Character</h2>
        <div class="character-slots">${SLOTS.map((slot) => `<div class="character-slot" data-slot="${slot}" data-testid="slot-${slot}"><small>${SLOT_NAMES[slot]}</small></div>`).join('')}</div>
        <dl class="character-stats" data-testid="character-stats"></dl></section>
      <section class="inventory-panel" data-panel="bag"><h2>Bag <span data-testid="inventory-bag-summary"></span></h2><div class="inventory-grid" data-grid="bag" data-testid="grid-bag"></div>
        <div class="inventory-drop" data-testid="inventory-drop">Drop here to leave it on the floor</div></section>
    </div>
    <p class="inventory-hint" data-testid="inventory-hint"></p>
    <button type="button" class="inventory-close" data-testid="inventory-close">Close <kbd>Tab</kbd></button>
    <div class="inventory-tooltip" data-testid="inventory-tooltip" hidden></div>`;
  host.append(root);
  const q = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const leftPanel = q('[data-panel="left"]'), leftTitle = q('[data-testid="inventory-left-title"]'), leftGrid = q('[data-grid="left"]');
  const secondPanel = q('[data-panel="second"]'), secondTitle = q('[data-testid="inventory-second-title"]'), secondGrid = q('[data-grid="second"]');
  const tabs = q('[data-testid="base-tabs"]'), traderNote = q('[data-testid="trader-note"]'), characterPanel = q('[data-panel="character"]');
  const bagGrid = q('[data-grid="bag"]'), bagSummary = q('[data-testid="inventory-bag-summary"]'), dropZone = q('[data-testid="inventory-drop"]');
  const hint = q('[data-testid="inventory-hint"]'), tooltip = q('[data-testid="inventory-tooltip"]'), statsList = q('[data-testid="character-stats"]');
  const slotEls = new Map(SLOTS.map((slot) => [slot, q(`[data-slot="${slot}"]`)]));
  q('[data-testid="inventory-close"]').addEventListener('click', () => handlers.close());

  let view: InventoryView | null = null;
  let hovered: string | null = null;
  let signature = '';
  type Source = { kind: 'grid'; key: GridKey } | { kind: 'slot'; slot: Slot };
  type Drag = { uid: string; source: Source; item: string; rotated: boolean; grabX: number; grabY: number; ghost: HTMLElement; el: HTMLElement };
  let drag: Drag | null = null;

  const gridOf = (key: GridKey) => key === 'bag' ? { size: view!.bagSize, items: view!.bag }
    : view!.left && view!.left.key === key ? { size: view!.left.size, items: view!.left.items }
    : view!.second && view!.second.key === key ? { size: view!.second.size, items: view!.second.items } : null;
  const keyOfGrid = (el: HTMLElement): GridKey => el === bagGrid ? 'bag' : el === secondGrid ? view!.second!.key : view!.left!.key;

  function itemElement(entry: GridItem, source: Source, w: number, h: number) {
    const def = itemDef(entry.item);
    const el = document.createElement('div');
    el.className = 'inventory-item';
    el.setAttribute('data-testid', 'inv-item');
    el.dataset.uid = entry.uid; el.dataset.item = entry.item; el.dataset.rarity = itemRarity(entry);
    el.dataset.grid = source.kind === 'grid' ? source.key : 'equipment';
    el.style.width = `${w}px`; el.style.height = `${h}px`;
    el.style.setProperty('--rarity', RARITY_COLORS[itemRarity(entry)]);
    const price = source.kind === 'grid' && source.key === 'trader' ? view?.left?.prices?.[entry.uid] : undefined;
    el.innerHTML = `<span>${def.name}</span>${price !== undefined ? `<em class="price" data-testid="price">${price}g</em>` : ''}`;
    el.addEventListener('pointerdown', (event) => startDrag(event, entry, source, el));
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      if (drag) return;
      if (source.kind === 'grid') handlers.quick(source.key, entry.uid); else handlers.unequip(source.slot, 'bag');
    });
    el.addEventListener('pointerenter', () => { hovered = source.kind === 'grid' && source.key === 'bag' ? entry.uid : null; showTooltip(entry, el); });
    el.addEventListener('pointerleave', () => { hovered = null; tooltip.hidden = true; });
    return el;
  }
  function fill(el: HTMLElement, size: GridSize, items: readonly GridItem[], key: GridKey) {
    el.style.width = `${size.width * CELL}px`; el.style.height = `${size.height * CELL}px`;
    el.dataset.key = key;
    el.replaceChildren(...items.map((entry) => {
      const { w, h } = footprint(entry);
      const item = itemElement(entry, { kind: 'grid', key }, w * CELL - 4, h * CELL - 4);
      item.style.left = `${entry.x * CELL}px`; item.style.top = `${entry.y * CELL}px`;
      return item;
    }));
  }
  function showTooltip(entry: GridItem, el: HTMLElement) {
    if (drag) return;
    tooltip.innerHTML = describeItem(entry);
    const r = el.getBoundingClientRect(), box = root.getBoundingClientRect();
    tooltip.style.left = `${Math.min(r.right - box.left + 8, box.width - 250)}px`; tooltip.style.top = `${r.top - box.top}px`;
    tooltip.hidden = false;
  }

  function startDrag(event: PointerEvent, entry: GridItem, source: Source, el: HTMLElement) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    tooltip.hidden = true;
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add('inventory-ghost');
    ghost.removeAttribute('data-testid');
    root.append(ghost);
    el.classList.add('inventory-dragging');
    const { w, h } = footprint(entry);
    const grab = source.kind === 'grid'
      ? { grabX: Math.min(Math.floor((event.clientX - r.left) / CELL), w - 1), grabY: Math.min(Math.floor((event.clientY - r.top) / CELL), h - 1) }
      : { grabX: 0, grabY: 0 };
    drag = { uid: entry.uid, source, item: entry.item, rotated: source.kind === 'grid' ? entry.rotated : false, ghost, el, ...grab };
    moveGhost(event.clientX, event.clientY);
  }
  const inside = (el: HTMLElement, x: number, y: number) => { const r = el.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
  function gridTarget(clientX: number, clientY: number, grab: { grabX: number; grabY: number }) {
    for (const el of [bagGrid, leftGrid, secondGrid]) {
      if (el === leftGrid && !view?.left) continue;
      if (el === secondGrid && !view?.second) continue;
      if (!inside(el, clientX, clientY)) continue;
      const r = el.getBoundingClientRect();
      return { key: keyOfGrid(el), x: Math.floor((clientX - r.left) / CELL) - grab.grabX, y: Math.floor((clientY - r.top) / CELL) - grab.grabY };
    }
    return null;
  }
  const slotTarget = (clientX: number, clientY: number) => SLOTS.find((slot) => inside(slotEls.get(slot)!, clientX, clientY)) ?? null;
  const overDrop = (current: Drag, clientX: number, clientY: number) =>
    Boolean(view?.canDrop) && current.source.kind === 'grid' && current.source.key === 'bag' && !dropZone.hidden && inside(dropZone, clientX, clientY);

  function moveGhost(clientX: number, clientY: number) {
    if (!drag) return;
    const box = root.getBoundingClientRect();
    const { w, h } = footprint({ item: drag.item, rotated: drag.rotated });
    drag.ghost.style.width = `${w * CELL - 4}px`; drag.ghost.style.height = `${h * CELL - 4}px`;
    drag.ghost.style.left = `${clientX - box.left - drag.grabX * CELL - CELL / 2}px`;
    drag.ghost.style.top = `${clientY - box.top - drag.grabY * CELL - CELL / 2}px`;
    const target = gridTarget(clientX, clientY, drag);
    const slot = slotTarget(clientX, clientY);
    let ok = false;
    const fromTrader = drag.source.kind === 'grid' && drag.source.key === 'trader';
    if (target && (target.key === 'trader' || fromTrader)) ok = target.key !== 'trader' || !fromTrader;
    else if (target) { const grid = gridOf(target.key)!; ok = fits(grid.items, grid.size, { uid: drag.uid, item: drag.item, x: target.x, y: target.y, rotated: drag.rotated }); }
    else if (slot) ok = drag.source.kind === 'grid' && (slot === 'mainHand' ? itemDef(drag.item).gear?.slot === 'weapon' : slotAccepts(view!.equipment, slot, drag));
    else ok = overDrop(drag, clientX, clientY);
    drag.ghost.dataset.valid = String(ok);
    for (const [key, el] of slotEls) el.dataset.target = String(key === slot && ok);
  }
  function endDrag(clientX: number, clientY: number) {
    if (!drag) return;
    const current = drag;
    drag = null;
    current.ghost.remove();
    current.el.classList.remove('inventory-dragging');
    for (const el of slotEls.values()) el.dataset.target = 'false';
    const target = gridTarget(clientX, clientY, current);
    const slot = slotTarget(clientX, clientY);
    if (current.source.kind === 'grid') {
      if (target) handlers.move(current.source.key, current.uid, target.key, { x: target.x, y: target.y, rotated: current.rotated });
      else if (slot) handlers.equip(current.source.key, current.uid, slot);
      else if (overDrop(current, clientX, clientY)) handlers.drop(current.uid);
    } else if (target) handlers.unequip(current.source.slot, target.key, { x: target.x, y: target.y, rotated: current.rotated });
    signature = '';
    if (view) render(view);
  }
  const onMove = (event: PointerEvent) => moveGhost(event.clientX, event.clientY);
  const onUp = (event: PointerEvent) => endDrag(event.clientX, event.clientY);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  function renderCharacter(next: InventoryView) {
    for (const slot of SLOTS) {
      const el = slotEls.get(slot)!;
      const entry = next.equipment[slot];
      const blocked = slot === 'offHand' && Boolean(next.equipment.mainHand && itemDef(next.equipment.mainHand.item).gear?.twoHanded);
      el.dataset.blocked = String(blocked);
      el.replaceChildren(Object.assign(document.createElement('small'), { textContent: blocked ? 'Off hand (two-handed)' : SLOT_NAMES[slot] }),
        ...(entry ? [itemElement(entry, { kind: 'slot', slot }, 84, 84)] : []));
    }
    const s = next.stats;
    const armorCut = Math.round((Math.max(0, s.armor) / (Math.max(0, s.armor) + 100)) * 100);
    const rows: [string, string][] = [
      ['Weapon', next.weapon], ['Max health', String(next.maxHealth)], ['Armour', `${s.armor} (−${armorCut}% damage)`],
      ['Move speed', signed(s.moveSpeed, true)], ['Damage', signed(s.damage, true)], ['Attack speed', signed(s.attackSpeed, true)],
      ['Stealth', signed(s.stealth, true)], ['Trap resistance', signed(s.trapResist, true)],
    ];
    statsList.replaceChildren(...rows.flatMap(([name, value]) => {
      const dd = document.createElement('dd');
      dd.textContent = value; dd.dataset.stat = name;
      return [Object.assign(document.createElement('dt'), { textContent: name }), dd];
    }));
  }
  function render(next: InventoryView) {
    view = next;
    if (drag) return;
    const sig = JSON.stringify([next.left, next.second, next.tabs, next.gold, next.showCharacter, next.bag, next.canDrop, next.hint, next.equipment, next.maxHealth, next.weapon]);
    if (sig === signature) return;
    signature = sig;
    leftPanel.hidden = !next.left;
    if (next.left) { leftTitle.textContent = next.left.title; fill(leftGrid, next.left.size, next.left.items, next.left.key); }
    traderNote.hidden = !next.left?.note;
    traderNote.textContent = next.left?.note ?? '';
    secondPanel.hidden = !next.second;
    if (next.second) { secondTitle.textContent = next.second.title; fill(secondGrid, next.second.size, next.second.items, next.second.key); }
    characterPanel.hidden = next.showCharacter === false;
    tabs.hidden = !next.tabs;
    tabs.replaceChildren(...(next.tabs ?? []).map((tab) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = tab.label; button.dataset.tab = tab.id; button.dataset.active = String(tab.active);
      button.setAttribute('data-testid', `tab-${tab.id}`);
      button.addEventListener('click', () => handlers.tab?.(tab.id));
      return button;
    }), ...(next.gold !== undefined ? [Object.assign(document.createElement('span'), { className: 'base-gold', textContent: `${next.gold} gold` })] : []));
    tabs.querySelector('.base-gold')?.setAttribute('data-testid', 'gold');
    fill(bagGrid, next.bagSize, next.bag, 'bag');
    renderCharacter(next);
    const used = next.bag.reduce((sum, entry) => { const f = footprint(entry); return sum + f.w * f.h; }, 0);
    const value = next.bag.reduce((sum, entry) => sum + itemValue(entry), 0);
    bagSummary.textContent = `${used}/${next.bagSize.width * next.bagSize.height} · ${value} gold`;
    dropZone.hidden = !next.canDrop;
    hint.textContent = next.hint;
  }
  return {
    get isOpen() { return !root.hidden; },
    // The bag item under the pointer (for F: jam a gate with it).
    get hoveredBagItem() { return hovered; },
    open(next: InventoryView) { root.hidden = false; signature = ''; render(next); },
    close() {
      if (drag) { drag.ghost.remove(); drag.el.classList.remove('inventory-dragging'); drag = null; }
      root.hidden = true; tooltip.hidden = true; hovered = null;
    },
    render,
    // R while dragging: a quarter turn (non-square items only).
    rotate() {
      if (!drag || drag.source.kind !== 'grid' || !canRotate(drag.item)) return;
      drag.rotated = !drag.rotated;
      [drag.grabX, drag.grabY] = [drag.grabY, drag.grabX];
      const r = drag.ghost.getBoundingClientRect();
      moveGhost(r.left + drag.grabY * CELL + CELL / 2, r.top + drag.grabX * CELL + CELL / 2);
    },
    dispose() { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); root.remove(); },
  };
}
