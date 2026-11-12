// M8 bag, loot and stash screens: grids of cells with items dragged between them.
// Presentation and input only; every move is decided by the game rules (handlers).
import { canRotate, fits, footprint } from '../game/inventory';
import type { GridItem, GridSize } from '../game/inventory';
import { RARITY_COLORS, itemDef } from '../game/items';

export type GridKey = 'bag' | 'container' | 'stash';
export type InventoryView = {
  left: { key: 'container' | 'stash'; title: string; size: GridSize; items: readonly GridItem[] } | null;
  bag: readonly GridItem[]; bagSize: GridSize;
  canDrop: boolean; hint: string;
};
export type InventoryHandlers = {
  move(from: GridKey, uid: string, to: GridKey, target: { x: number; y: number; rotated: boolean }): void;
  quick(from: GridKey, uid: string): void;
  drop(uid: string): void;
  close(): void;
};
const CELL = 46;

export function createInventoryUI(host: HTMLElement, handlers: InventoryHandlers) {
  const root = document.createElement('div');
  root.className = 'inventory';
  root.dataset.testid = 'inventory';
  root.setAttribute('data-testid', 'inventory');
  root.hidden = true;
  root.innerHTML = `
    <div class="inventory-panels">
      <section class="inventory-panel" data-panel="left"><h2 data-testid="inventory-left-title"></h2><div class="inventory-grid" data-grid="left"></div></section>
      <section class="inventory-panel" data-panel="bag"><h2>Bag <span data-testid="inventory-bag-summary"></span></h2><div class="inventory-grid" data-grid="bag" data-testid="grid-bag"></div>
        <div class="inventory-drop" data-testid="inventory-drop">Drop here to leave it on the floor</div></section>
    </div>
    <p class="inventory-hint" data-testid="inventory-hint"></p>
    <button type="button" class="inventory-close" data-testid="inventory-close">Close <kbd>Tab</kbd></button>
    <div class="inventory-tooltip" data-testid="inventory-tooltip" hidden></div>`;
  host.append(root);
  const leftPanel = root.querySelector<HTMLElement>('[data-panel="left"]')!;
  const leftTitle = root.querySelector<HTMLElement>('[data-testid="inventory-left-title"]')!;
  const leftGrid = root.querySelector<HTMLElement>('[data-grid="left"]')!;
  const bagGrid = root.querySelector<HTMLElement>('[data-grid="bag"]')!;
  const bagSummary = root.querySelector<HTMLElement>('[data-testid="inventory-bag-summary"]')!;
  const dropZone = root.querySelector<HTMLElement>('[data-testid="inventory-drop"]')!;
  const hint = root.querySelector<HTMLElement>('[data-testid="inventory-hint"]')!;
  const tooltip = root.querySelector<HTMLElement>('[data-testid="inventory-tooltip"]')!;
  root.querySelector('[data-testid="inventory-close"]')!.addEventListener('click', () => handlers.close());

  let view: InventoryView | null = null;
  let signature = '';
  type Drag = { uid: string; from: GridKey; item: string; rotated: boolean; grabX: number; grabY: number; ghost: HTMLElement; source: HTMLElement };
  let drag: Drag | null = null;

  const gridOf = (key: GridKey) => key === 'bag' ? { el: bagGrid, size: view!.bagSize, items: view!.bag }
    : view!.left && view!.left.key === key ? { el: leftGrid, size: view!.left.size, items: view!.left.items } : null;
  const keyOfGrid = (el: HTMLElement): GridKey => el === bagGrid ? 'bag' : view!.left!.key;

  function itemElement(entry: GridItem, from: GridKey) {
    const def = itemDef(entry.item);
    const { w, h } = footprint(entry);
    const el = document.createElement('div');
    el.className = 'inventory-item';
    el.dataset.testid = 'inv-item';
    el.setAttribute('data-testid', 'inv-item');
    el.dataset.uid = entry.uid; el.dataset.item = entry.item; el.dataset.grid = from; el.dataset.rarity = def.rarity;
    el.style.left = `${entry.x * CELL}px`; el.style.top = `${entry.y * CELL}px`;
    el.style.width = `${w * CELL - 4}px`; el.style.height = `${h * CELL - 4}px`;
    el.style.setProperty('--rarity', RARITY_COLORS[def.rarity]);
    el.innerHTML = `<span>${def.name}</span>`;
    el.addEventListener('pointerdown', (event) => startDrag(event, entry, from, el));
    el.addEventListener('contextmenu', (event) => { event.preventDefault(); if (!drag) handlers.quick(from, entry.uid); });
    el.addEventListener('pointerenter', () => showTooltip(entry, el));
    el.addEventListener('pointerleave', () => { tooltip.hidden = true; });
    return el;
  }
  function fill(el: HTMLElement, size: GridSize, items: readonly GridItem[], key: GridKey) {
    el.style.width = `${size.width * CELL}px`; el.style.height = `${size.height * CELL}px`;
    el.dataset.key = key;
    el.replaceChildren(...items.map((entry) => itemElement(entry, key)));
  }
  function showTooltip(entry: GridItem, el: HTMLElement) {
    if (drag) return;
    const def = itemDef(entry.item);
    tooltip.innerHTML = `<strong style="color:${RARITY_COLORS[def.rarity]}">${def.name}</strong>
      <span>${def.rarity} ${def.category} · ${def.width}×${def.height}</span><span>${def.value} gold</span><em>${def.description}</em>`;
    const r = el.getBoundingClientRect(), host = root.getBoundingClientRect();
    tooltip.style.left = `${r.right - host.left + 8}px`; tooltip.style.top = `${r.top - host.top}px`;
    tooltip.hidden = false;
  }

  function startDrag(event: PointerEvent, entry: GridItem, from: GridKey, el: HTMLElement) {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    tooltip.hidden = true;
    const r = el.getBoundingClientRect();
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add('inventory-ghost');
    ghost.removeAttribute('data-testid');
    root.append(ghost);
    el.classList.add('inventory-dragging');
    drag = { uid: entry.uid, from, item: entry.item, rotated: entry.rotated, ghost, source: el,
      grabX: Math.min(Math.floor((event.clientX - r.left) / CELL), footprint(entry).w - 1),
      grabY: Math.min(Math.floor((event.clientY - r.top) / CELL), footprint(entry).h - 1) };
    moveGhost(event.clientX, event.clientY);
  }
  // Which grid and cell the dragged item's top-left would land on.
  function targetAt(clientX: number, clientY: number, grab: { grabX: number; grabY: number } = drag!) {
    for (const el of [bagGrid, leftGrid]) {
      if (el === leftGrid && !view?.left) continue;
      const r = el.getBoundingClientRect();
      if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue;
      const key = keyOfGrid(el);
      return { key, el, x: Math.floor((clientX - r.left) / CELL) - grab.grabX, y: Math.floor((clientY - r.top) / CELL) - grab.grabY };
    }
    return null;
  }
  function moveGhost(clientX: number, clientY: number) {
    if (!drag) return;
    const host = root.getBoundingClientRect();
    const { w, h } = footprint({ item: drag.item, rotated: drag.rotated });
    drag.ghost.style.width = `${w * CELL - 4}px`; drag.ghost.style.height = `${h * CELL - 4}px`;
    drag.ghost.style.left = `${clientX - host.left - drag.grabX * CELL - CELL / 2}px`;
    drag.ghost.style.top = `${clientY - host.top - drag.grabY * CELL - CELL / 2}px`;
    const target = targetAt(clientX, clientY);
    let ok = false;
    if (target) {
      const grid = gridOf(target.key)!;
      ok = fits(grid.items, grid.size, { uid: drag.uid, item: drag.item, x: target.x, y: target.y, rotated: drag.rotated });
    }
    drag.ghost.dataset.valid = String(ok || (!target && overDrop(clientX, clientY)));
  }
  const overDrop = (clientX: number, clientY: number) => (drag ? overDropFor(drag, clientX, clientY) : false);
  const overDropFor = (current: { from: GridKey }, clientX: number, clientY: number) => {
    if (!view?.canDrop || current.from !== 'bag') return false;
    const r = dropZone.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  };
  function endDrag(clientX: number, clientY: number) {
    if (!drag) return;
    const current = drag;
    drag = null;
    current.ghost.remove();
    current.source.classList.remove('inventory-dragging');
    const target = targetAt(clientX, clientY, current);
    if (target) handlers.move(current.from, current.uid, target.key, { x: target.x, y: target.y, rotated: current.rotated });
    else if (overDropFor(current, clientX, clientY)) handlers.drop(current.uid);
    signature = ''; // redraw
    if (view) render(view);
  }
  const onMove = (event: PointerEvent) => moveGhost(event.clientX, event.clientY);
  const onUp = (event: PointerEvent) => endDrag(event.clientX, event.clientY);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);

  function render(next: InventoryView) {
    view = next;
    if (drag) return;
    const sig = JSON.stringify([next.left?.key, next.left?.title, next.left?.items, next.bag, next.canDrop, next.hint]);
    if (sig === signature) return;
    signature = sig;
    leftPanel.hidden = !next.left;
    if (next.left) { leftTitle.textContent = next.left.title; fill(leftGrid, next.left.size, next.left.items, next.left.key); }
    fill(bagGrid, next.bagSize, next.bag, 'bag');
    const used = next.bag.reduce((sum, entry) => { const f = footprint(entry); return sum + f.w * f.h; }, 0);
    const value = next.bag.reduce((sum, entry) => sum + itemDef(entry.item).value, 0);
    bagSummary.textContent = `${used}/${next.bagSize.width * next.bagSize.height} · ${value} gold`;
    dropZone.hidden = !next.canDrop;
    hint.textContent = next.hint;
  }
  return {
    get isOpen() { return !root.hidden; },
    open(next: InventoryView) { root.hidden = false; signature = ''; render(next); },
    close() {
      if (drag) { drag.ghost.remove(); drag.source.classList.remove('inventory-dragging'); drag = null; }
      root.hidden = true; tooltip.hidden = true;
    },
    render,
    // R while dragging: a quarter turn (non-square items only).
    rotate() {
      if (!drag || !canRotate(drag.item)) return;
      drag.rotated = !drag.rotated;
      [drag.grabX, drag.grabY] = [drag.grabY, drag.grabX];
      const r = drag.ghost.getBoundingClientRect();
      moveGhost(r.left + drag.grabY * CELL + CELL / 2, r.top + drag.grabX * CELL + CELL / 2);
    },
    dispose() { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); root.remove(); },
  };
}
