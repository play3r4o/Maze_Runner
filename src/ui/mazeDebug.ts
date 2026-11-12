import { HAND_BUILT_MAZE, MAZE_WALLS, cellPosition, corridorRect, findCell, landmarkRect, mazeExtent, plazaRect } from '../simulation/maze';
import type { MazeLayout } from '../simulation/maze';
import type { WallRect } from '../simulation/player';
import type { Ring } from '../simulation/mazeGenerator';
import type { RuleKey } from '../game/pressure';
import type { TrapSpec } from '../game/traps';
import { buildLayoutDiagnostics, probeSanctuaryIsolation } from '../simulation/mazeDiagnostics';
import type { DebugView } from '../simulation/mazeDiagnostics';

export type MazeDebugOptions = {
  layout: MazeLayout; walls: readonly WallRect[];
  // Generated mazes only: ring colouring, the entrances used by the dry-run probe, and seed controls.
  rings?: Readonly<Record<string, Ring>>; entrances?: readonly string[];
  seed?: { seed: number; version: string; fingerprint: string; onLoad(seed: number): void; onRandom(): void };
  // M6 debug tools. Each callback returns a status message for the panel.
  tools?: {
    config: string; teleports: readonly { label: string; cell: string }[];
    onFreeze(): string; onTeleport(cell: string): string; onCopyReport(): string; onLoadReport(text: string): string;
    // M7b rule switches (development only).
    rules?: readonly RuleKey[]; onRule?(key: RuleKey, on: boolean): string;
    // M12 traps to draw on the map.
    traps?: readonly TrapSpec[];
  };
};
export const RING_COLORS: Record<Ring, string> = { sanctuary: '#bba36b', inner: '#3f8a5c', middle: '#a08a3a', outer: '#a44b5a' };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>, text?: string) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createMazeDebug(root: HTMLElement,
  options: MazeDebugOptions = { layout: HAND_BUILT_MAZE, walls: MAZE_WALLS }) {
  const { layout, rings, seed } = options;
  const hasGates = layout.edges.some((edge) => edge.gate);
  const events = new AbortController();
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'debug-toggle'; toggle.textContent = 'F2 · Debug map';
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'maze-debug');
  const panel = document.createElement('aside');
  panel.id = 'maze-debug'; panel.className = 'maze-debug'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Developer maze diagnostics'); panel.dataset.testid = 'maze-debug';
  panel.innerHTML = `
    <p class="eyebrow">DEVELOPER GRAPH <span>F2 · hide</span></p>
    ${seed ? `<form class="debug-seed" data-testid="debug-seed-form">
      <p class="debug-summary">Seed <output data-testid="debug-seed">${seed.seed}</output> · ${seed.version} · layout <output data-testid="debug-fingerprint">${seed.fingerprint}</output></p>
      <label>Seed <input data-testid="seed-input" inputmode="numeric" maxlength="10" value="${seed.seed}" aria-label="Maze seed"></label>
      <button type="submit">Load seed</button><button type="button" data-action="random">Random</button>
      <p class="debug-validation" data-testid="seed-error" role="alert"></p></form>` : ''}
    <p class="debug-summary">Topology <output data-testid="debug-revision">0</output> · <output data-testid="debug-phase">idle</output></p>
    <div class="debug-map"></div>
    <p class="debug-legend">${rings ? 'N ↑ · pale line: route home · rooms: gold Sanctuary, green inner, ochre middle, red outer' : 'N ↑ · pale line: route · red: closed stone · amber: warning / motion'}</p>
    <p class="debug-location" data-testid="debug-location"></p>
    <p class="debug-route" data-testid="debug-route"></p>
    ${options.tools ? `<section class="debug-tools" aria-label="Debug tools">
      <p class="debug-caution">${options.tools.config} · tick <output data-testid="debug-tick">0</output> · page errors <output data-testid="debug-errors">0</output></p>
      <p class="debug-caution" data-testid="debug-run"></p>
      ${options.tools.rules ? `<div class="debug-tool-row debug-rules" data-testid="debug-rules" aria-label="Rules">Rules: ${options.tools.rules.map((key) =>
        `<label><input type="checkbox" data-rule="${key}" checked> ${key}</label>`).join('')}</div>` : ''}
      <div class="debug-tool-row"><button type="button" data-action="freeze" data-testid="debug-freeze" aria-pressed="false">Freeze shifts</button>
        <button type="button" data-action="copy-report">Copy report</button></div>
      <div class="debug-tool-row" aria-label="Teleport">${options.tools.teleports.map((item) =>
        `<button type="button" data-teleport="${item.cell}">→ ${item.label}</button>`).join('')}</div>
      <p class="debug-caution">Teleport: click any room on the map, or use the buttons above. Debug only.</p>
      <p class="debug-validation" data-testid="debug-tool-status" role="status"></p>
      <details class="debug-report"><summary>Bug report text</summary>
        <textarea data-testid="report-text" rows="6" spellcheck="false" aria-label="Bug report JSON"></textarea>
        <button type="button" data-action="load-report">Load report</button></details>
      <details class="debug-events"><summary>Events</summary><ol data-testid="debug-events"></ol></details>
    </section>` : ''}
    <button type="button" class="debug-probe">Probe isolation <span>V · dry run</span></button>
    <p class="debug-validation" data-testid="debug-probe-result" role="status">Dry run: block Sanctuary links. No maze changes.</p>
    <details class="debug-probe-details" hidden><summary>Proposed edges / unreachable cells</summary><code></code></details>
    <details><summary>Shift validation / graph caveats</summary>
      <p class="debug-validation" data-testid="debug-plan">No shift checked yet.</p>
      <p class="debug-caution">Fully open gates only. In corridors the route starts at the nearest junction. It does not guarantee time to escape a closing gate.</p></details>
    <details class="debug-shift-log" open hidden><summary>Shift log</summary><ol data-testid="debug-shift-log"></ol></details>
    <details class="debug-connections"><summary>${layout.edges.length} connection IDs / states</summary><ol></ol></details>
    <p class="debug-caution">Escape releases the cursor to inspect this panel. This is a prototype diagnostic, not a player map design.</p>`;
  root.append(toggle, panel);
  const element = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const { width, depth } = mazeExtent(layout);
  const map = svg('svg', { viewBox: `${-width / 2} ${-depth / 2} ${width} ${depth}`, role: 'img', 'aria-label': 'Live maze rooms, connections, gates, player and graph route', 'data-testid': 'debug-map' });
  element('.debug-map').append(map);
  map.append(svg('rect', { x: -width / 2, y: -depth / 2, width, height: depth, fill: '#16291f' }));
  const plaza = plazaRect(layout);
  if (plaza) map.append(svg('rect', { x: plaza.minX, y: plaza.minZ, width: plaza.maxX - plaza.minX,
    height: plaza.maxZ - plaza.minZ, fill: RING_COLORS.sanctuary, opacity: 0.55 }));
  for (const wall of options.walls) map.append(svg('rect', { x: wall.minX, y: wall.minZ,
    width: wall.maxX - wall.minX, height: wall.maxZ - wall.minZ, fill: '#48564c' }));
  for (const cell of layout.cells) {
    const { x, z } = cellPosition(cell, layout);
    const ring = rings?.[cell.id];
    const room = svg('rect', { x: x - 2, y: z - 2, width: 4, height: 4,
      fill: ring ? RING_COLORS[ring] : cell.id === layout.start ? '#bba36b' : '#294536', 'data-testid': 'debug-room', 'data-cell-id': cell.id,
      ...(ring ? { 'data-ring': ring } : {}) });
    room.append(svg('title', {}, ring ? `${cell.id} · ${ring}` : cell.id)); map.append(room);
    if (options.tools) room.addEventListener('click', () => status(options.tools!.onTeleport(cell.id)), { signal: events.signal });
  }
  const edges = layout.edges.map((edge) => {
    const a = cellPosition(findCell(layout, edge.a), layout);
    const b = cellPosition(findCell(layout, edge.b), layout);
    const line = svg('line', { x1: a.x, y1: a.z, x2: b.x, y2: b.z, class: 'debug-link', 'data-edge-id': edge.id });
    line.append(svg('title', {}, edge.id)); map.append(line);
    const row = document.createElement('li');
    const id = document.createElement('code'); id.textContent = edge.id;
    const status = document.createElement('output'); row.append(id, status); element('ol').append(row);
    return { edge, line, status };
  });
  for (const cell of layout.cells) {
    const { x, z } = cellPosition(cell, layout);
    map.append(svg('text', { x, y: z + 0.45, class: 'debug-cell-label' }, `${cell.column},${cell.row}`));
  }
  for (const landmark of layout.landmarks) {
    const rect = landmarkRect(landmark, layout);
    map.append(svg('rect', { x: rect.minX, y: rect.minZ, width: rect.maxX - rect.minX,
      height: rect.maxZ - rect.minZ, fill: landmark.color }));
  }
  const gates = layout.edges.filter((edge) => edge.gate).map((edge) => {
    const rect = svg('rect', { class: 'debug-stone', 'data-testid': `debug-gate-${edge.gate}` });
    const closed = corridorRect(layout, edge);
    map.append(rect, svg('text', { x: (closed.minX + closed.maxX) / 2, y: (closed.minZ + closed.maxZ) / 2 + 0.5,
      class: 'debug-gate-label' }, edge.gate === 'north' ? 'N' : edge.gate === 'east' ? 'E' : edge.gate!.toUpperCase()));
    return { id: edge.gate!, rect };
  });
  // M12 traps: plate (or blade zone) squares coloured by kind; boulder lines dashed.
  const TRAP_COLORS: Record<string, string> = { boulder: '#c08a4a', spears: '#d0d4d2', floorSpikes: '#9fb0c0', pit: '#111', darts: '#c9b37a', blade: '#e06a5a' };
  const trapMarks = (options.tools?.traps ?? []).map((trap) => {
    if (trap.path) map.append(svg('line', { x1: trap.path.from.x, y1: trap.path.from.z, x2: trap.path.to.x, y2: trap.path.to.z,
      stroke: TRAP_COLORS.boulder, 'stroke-width': 0.5, 'stroke-dasharray': '1.5 1', opacity: 0.8 }));
    const r = trap.plate ?? trap.zone;
    const mark = svg('rect', { x: r.minX, y: r.minZ, width: r.maxX - r.minX, height: r.maxZ - r.minZ, fill: TRAP_COLORS[trap.kind],
      stroke: '#000', 'stroke-width': 0.15, 'data-testid': 'debug-trap', 'data-trap-kind': trap.kind, 'data-trap-id': trap.id });
    mark.append(svg('title', {}, `${trap.id} ${trap.kind} in ${trap.cell}`));
    map.append(mark);
    return mark;
  });
  // M7b chalk strokes, drawn top-down.
  const chalkLayer = svg('g', { 'data-testid': 'debug-chalk' });
  map.append(chalkLayer);
  // M10 monsters: dots by kind (the warden larger), ringed red while chasing.
  const monsterLayer = svg('g', { 'data-testid': 'debug-monsters' });
  map.append(monsterLayer);
  const MONSTER_COLORS: Record<string, string> = { husk: '#9fb07f', skitter: '#e0a040', warden: '#ff3b2f' };
  const pointer = svg('g', { class: 'debug-player', 'data-testid': 'debug-player' });
  pointer.append(svg('rect', { x: -0.3, y: -0.3, width: 0.6, height: 0.6, fill: '#fff6d6' }),
    svg('path', { d: 'M 0 0 L 0 -1.9 M -.55 -1.2 L 0 -1.9 L .55 -1.2', fill: 'none', stroke: '#fff6d6', 'stroke-width': 0.35 }));
  map.append(pointer);
  let lastUpdate = -Infinity;
  // Declared before use by the room click handlers above; hoisted function.
  function status(message: string) {
    const output = panel.querySelector<HTMLElement>('[data-testid="debug-tool-status"]');
    if (output) output.textContent = message;
    lastUpdate = -Infinity;
  }
  function setVisible(visible: boolean) {
    panel.hidden = !visible; toggle.setAttribute('aria-expanded', String(visible)); lastUpdate = -Infinity;
  }
  function probe(view: DebugView) {
    if (panel.hidden) return;
    const result = probeSanctuaryIsolation(layout, view.openness, options.entrances);
    const message = element('[data-testid="debug-probe-result"]');
    message.dataset.result = result.check.ok ? 'accepted' : 'rejected';
    message.textContent = result.check.ok ? 'Accepted dry run. No changes applied.'
      : `Rejected dry run at revision ${view.revision}: ${result.check.unreachable.length}/${layout.cells.length} cells lose a route. No changes applied.`;
    element<HTMLDetailsElement>('.debug-probe-details').hidden = false;
    element('.debug-probe-details code').textContent = `Proposed blocked edges:\n${result.blockedEdges.join('\n')}\n\n${result.check.reason}`;
    console.info('Maze validation dry run', { revision: view.revision, ...result });
  }
  toggle.addEventListener('click', () => setVisible(Boolean(panel.hidden)), { signal: events.signal });
  // The callback reads current state; the UI never owns or mutates maze truth.
  let currentRun: DebugView | null = null;
  element('.debug-probe').addEventListener('click', () => { if (currentRun) probe(currentRun); }, { signal: events.signal });
  if (options.tools) {
    const tools = options.tools;
    const on = (selector: string, action: () => string) =>
      panel.querySelector(selector)!.addEventListener('click', () => status(action()), { signal: events.signal });
    on('[data-action="freeze"]', () => tools.onFreeze());
    on('[data-action="copy-report"]', () => {
      const text = tools.onCopyReport();
      element<HTMLTextAreaElement>('[data-testid="report-text"]').value = text;
      element<HTMLDetailsElement>('.debug-report').open = true;
      return 'Report copied (also shown below). Paste it into the bug description.';
    });
    on('[data-action="load-report"]', () => tools.onLoadReport(element<HTMLTextAreaElement>('[data-testid="report-text"]').value));
    for (const box of panel.querySelectorAll<HTMLInputElement>('[data-rule]')) {
      box.addEventListener('change', () => status(tools.onRule?.(box.dataset.rule as RuleKey, box.checked) ?? ''), { signal: events.signal });
    }
    for (const button of panel.querySelectorAll<HTMLButtonElement>('[data-teleport]')) {
      button.addEventListener('click', () => status(tools.onTeleport(button.dataset.teleport!)), { signal: events.signal });
    }
  }
  if (seed) {
    const form = element<HTMLFormElement>('.debug-seed');
    const error = element('[data-testid="seed-error"]');
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = element<HTMLInputElement>('[data-testid="seed-input"]').value.trim();
      const value = /^\d{1,10}$/.test(text) ? Number(text) : NaN;
      if (!(value <= 0xffffffff)) { error.textContent = 'Seed must be a whole number from 0 to 4294967295.'; return; }
      seed.onLoad(value);
    }, { signal: events.signal });
    form.querySelector('[data-action="random"]')!.addEventListener('click', () => seed.onRandom(), { signal: events.signal });
  }
  return {
    toggle() { setVisible(Boolean(panel.hidden)); },
    probe,
    resetAttempt() {
      const message = element('[data-testid="debug-probe-result"]'); delete message.dataset.result;
      message.textContent = 'Dry run: block Sanctuary links. No maze changes.';
      element<HTMLDetailsElement>('.debug-probe-details').hidden = true;
      element<HTMLDetailsElement>('.debug-probe-details').open = false;
      currentRun = null; lastUpdate = -Infinity;
    },
    update(view: DebugView, timestamp: number) {
      currentRun = view;
      if (panel.hidden || timestamp - lastUpdate < 100) return;
      lastUpdate = timestamp;
      const data = buildLayoutDiagnostics(view);
      element('[data-testid="debug-revision"]').textContent = String(view.revision);
      element('[data-testid="debug-phase"]').textContent = hasGates ? view.phase : 'static · shifts arrive in M5';
      const ring = rings && data.cell ? ` · ${rings[data.cell]} ring` : '';
      element('[data-testid="debug-location"]').textContent = `${data.location}${ring} · X ${data.player.x.toFixed(2)} / Z ${data.player.z.toFixed(2)}`;
      element('[data-testid="debug-route"]').textContent = data.route ? `${data.route.edges.length} connections home from ${data.origin}.` : data.routeNote;
      element('[data-testid="debug-plan"]').textContent = view.validation ?? (hasGates ? 'No shift checked yet.' : 'This layout has no gates yet.');
      if (view.tools) {
        element('[data-testid="debug-tick"]').textContent = String(view.tools.tick);
        element('[data-testid="debug-errors"]').textContent = String(view.tools.errors);
        element('[data-testid="debug-run"]').textContent = view.tools.run;
        // Chalk strokes, top-down (dots become tiny circles). Gate drawings move with their slab.
        const strokes = view.tools.chalk ?? [];
        chalkLayer.replaceChildren(...strokes.map((points) => points.length === 1
          ? svg('circle', { cx: points[0].x, cy: points[0].z, r: 0.3, fill: '#f4f1e6', 'data-testid': 'debug-chalk-stroke' })
          : svg('polyline', { points: points.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(' '), fill: 'none',
            stroke: '#f4f1e6', 'stroke-width': 0.4, 'stroke-linecap': 'round', 'data-testid': 'debug-chalk-stroke' })));
        monsterLayer.replaceChildren(...(view.tools.monsters ?? []).map((m) => svg('circle', { cx: m.x.toFixed(2), cy: m.z.toFixed(2),
          r: m.kind === 'warden' ? 1.1 : 0.7, fill: m.mode === 'dead' ? '#444' : MONSTER_COLORS[m.kind], opacity: m.mode === 'dead' ? 0.6 : 1,
          stroke: m.mode === 'chase' ? '#ff2a2a' : '#000', 'stroke-width': m.mode === 'chase' ? 0.5 : 0.15,
          'data-testid': 'debug-monster', 'data-kind': m.kind, 'data-mode': m.mode, 'data-stunned': String(m.stunned) })));
        view.tools.trapPhases?.forEach((phase, i) => { if (trapMarks[i] && trapMarks[i].dataset.phase !== phase) trapMarks[i].dataset.phase = phase; });
        for (const [key, on] of Object.entries(view.tools.rules ?? {})) {
          const box = panel.querySelector<HTMLInputElement>(`[data-rule="${key}"]`);
          if (box && box.checked !== on) box.checked = on;
        }
        const freeze = element('[data-testid="debug-freeze"]');
        freeze.setAttribute('aria-pressed', String(view.tools.frozen));
        freeze.textContent = view.tools.frozen ? 'Resume shifts' : 'Freeze shifts';
        const list = element('[data-testid="debug-events"]');
        const text = view.tools.events.join('\n');
        if (list.dataset.text !== text) {
          list.dataset.text = text;
          list.replaceChildren(...[...view.tools.events].reverse().map((line) => { const item = document.createElement('li'); item.textContent = line; return item; }));
        }
      }
      if (view.log) {
        element<HTMLDetailsElement>('.debug-shift-log').hidden = false;
        const list = element('[data-testid="debug-shift-log"]');
        const text = view.log.length ? view.log : ['No shift requested yet.'];
        if (list.dataset.text !== text.join('\n')) {
          list.dataset.text = text.join('\n');
          list.replaceChildren(...[...text].reverse().map((line) => { const item = document.createElement('li'); item.textContent = line; return item; }));
        }
      }
      pointer.setAttribute('transform', `translate(${data.player.x} ${data.player.z}) rotate(${-data.player.yaw * 180 / Math.PI})`);
      pointer.dataset.x = String(data.player.x); pointer.dataset.z = String(data.player.z); pointer.dataset.yaw = String(data.player.yaw);
      for (const { edge, line, status } of edges) {
        const gate = data.gates.find((gate) => gate.id === edge.gate);
        const open = !edge.gate || view.openness[edge.gate] === 1;
        line.dataset.open = String(open); line.dataset.route = String(data.route?.edges.includes(edge.id) ?? false);
        status.textContent = gate ? `${gate.status.toUpperCase()} ${Math.round(gate.openness * 100)}%` : 'OPEN';
      }
      for (const gate of gates) {
        const pose = data.gates.find((item) => item.id === gate.id)!;
        gate.rect.setAttribute('x', String(pose.rect.minX)); gate.rect.setAttribute('y', String(pose.rect.minZ));
        gate.rect.setAttribute('width', String(pose.rect.maxX - pose.rect.minX)); gate.rect.setAttribute('height', String(pose.rect.maxZ - pose.rect.minZ));
        gate.rect.dataset.status = pose.status; gate.rect.dataset.openness = String(pose.openness);
      }
    },
    dispose() { events.abort(); toggle.remove(); panel.remove(); },
  };
}
