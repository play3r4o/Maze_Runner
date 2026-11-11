import { HAND_BUILT_MAZE, MAZE_WALLS, cellPosition, corridorRect, landmarkRect } from '../simulation/maze';
import { buildMazeDiagnostics, probeSanctuaryIsolation } from '../simulation/mazeDiagnostics';
import type { MazeRun } from '../game/mazeRun';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>, text?: string) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

export function createMazeDebug(root: HTMLElement) {
  const layout = HAND_BUILT_MAZE;
  const events = new AbortController();
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'debug-toggle'; toggle.textContent = 'F2 · Debug map';
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'maze-debug');
  const panel = document.createElement('aside');
  panel.id = 'maze-debug'; panel.className = 'maze-debug'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Developer maze diagnostics'); panel.dataset.testid = 'maze-debug';
  panel.innerHTML = `
    <p class="eyebrow">DEVELOPER GRAPH <span>F2 · hide</span></p>
    <p class="debug-summary">Topology <output data-testid="debug-revision">0</output> · <output data-testid="debug-phase">idle</output></p>
    <div class="debug-map"></div>
    <p class="debug-legend">N ↑ · pale line: route · red: closed stone · amber: warning / motion</p>
    <p class="debug-location" data-testid="debug-location"></p>
    <p class="debug-route" data-testid="debug-route"></p>
    <button type="button" class="debug-probe">Probe isolation <span>V · dry run</span></button>
    <p class="debug-validation" data-testid="debug-probe-result" role="status">Dry run: block Sanctuary links. No maze changes.</p>
    <details class="debug-probe-details" hidden><summary>Proposed edges / unreachable cells</summary><code></code></details>
    <details><summary>Shift validation / graph caveats</summary>
      <p class="debug-validation" data-testid="debug-plan">No shift checked yet.</p>
      <p class="debug-caution">Fully open gates only. In corridors the route starts at the nearest junction. It does not guarantee time to escape a closing gate.</p></details>
    <details class="debug-connections"><summary>${layout.edges.length} connection IDs / states</summary><ol></ol></details>
    <p class="debug-caution">Escape releases the cursor to inspect this panel. This is a prototype diagnostic, not a player map design.</p>`;
  root.append(toggle, panel);
  const element = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
  const map = svg('svg', { viewBox: '-30 -30 60 60', role: 'img', 'aria-label': 'Live maze rooms, connections, gates, player and graph route', 'data-testid': 'debug-map' });
  element('.debug-map').append(map);
  map.append(svg('rect', { x: -30, y: -30, width: 60, height: 60, fill: '#16291f' }));
  for (const wall of MAZE_WALLS) map.append(svg('rect', { x: wall.minX, y: wall.minZ,
    width: wall.maxX - wall.minX, height: wall.maxZ - wall.minZ, fill: '#48564c' }));
  for (const cell of layout.cells) {
    const { x, z } = cellPosition(cell);
    const room = svg('rect', { x: x - 2, y: z - 2, width: 4, height: 4,
      fill: cell.id === layout.start ? '#bba36b' : '#294536', 'data-testid': 'debug-room', 'data-cell-id': cell.id });
    room.append(svg('title', {}, cell.id)); map.append(room);
  }
  const edges = layout.edges.map((edge) => {
    const a = cellPosition(layout.cells.find((cell) => cell.id === edge.a)!);
    const b = cellPosition(layout.cells.find((cell) => cell.id === edge.b)!);
    const line = svg('line', { x1: a.x, y1: a.z, x2: b.x, y2: b.z, class: 'debug-link', 'data-edge-id': edge.id });
    line.append(svg('title', {}, edge.id)); map.append(line);
    const row = document.createElement('li');
    const id = document.createElement('code'); id.textContent = edge.id;
    const status = document.createElement('output'); row.append(id, status); element('ol').append(row);
    return { edge, line, status };
  });
  for (const cell of layout.cells) {
    const { x, z } = cellPosition(cell);
    map.append(svg('text', { x, y: z + 0.45, class: 'debug-cell-label' }, `${cell.column},${cell.row}`));
  }
  for (const landmark of layout.landmarks) {
    const rect = landmarkRect(landmark);
    map.append(svg('rect', { x: rect.minX, y: rect.minZ, width: rect.maxX - rect.minX,
      height: rect.maxZ - rect.minZ, fill: landmark.color }));
  }
  const gates = layout.edges.filter((edge) => edge.gate).map((edge) => {
    const rect = svg('rect', { class: 'debug-stone', 'data-testid': `debug-gate-${edge.gate}` });
    const closed = corridorRect(layout, edge);
    map.append(rect, svg('text', { x: (closed.minX + closed.maxX) / 2, y: (closed.minZ + closed.maxZ) / 2 + 0.5,
      class: 'debug-gate-label' }, edge.gate === 'north' ? 'N' : 'E'));
    return { id: edge.gate!, rect };
  });
  const pointer = svg('g', { class: 'debug-player', 'data-testid': 'debug-player' });
  pointer.append(svg('rect', { x: -0.3, y: -0.3, width: 0.6, height: 0.6, fill: '#fff6d6' }),
    svg('path', { d: 'M 0 0 L 0 -1.9 M -.55 -1.2 L 0 -1.9 L .55 -1.2', fill: 'none', stroke: '#fff6d6', 'stroke-width': 0.35 }));
  map.append(pointer);
  let lastUpdate = -Infinity;
  function setVisible(visible: boolean) {
    panel.hidden = !visible; toggle.setAttribute('aria-expanded', String(visible)); lastUpdate = -Infinity;
  }
  function probe(run: MazeRun) {
    if (panel.hidden) return;
    const result = probeSanctuaryIsolation(layout, run.shift.openness);
    const message = element('[data-testid="debug-probe-result"]');
    message.dataset.result = result.check.ok ? 'accepted' : 'rejected';
    message.textContent = result.check.ok ? 'Accepted dry run. No changes applied.'
      : `Rejected dry run at revision ${run.shift.revision}: ${result.check.unreachable.length}/${layout.cells.length} cells lose a route. No changes applied.`;
    element<HTMLDetailsElement>('.debug-probe-details').hidden = false;
    element('.debug-probe-details code').textContent = `Proposed blocked edges:\n${result.blockedEdges.join('\n')}\n\n${result.check.reason}`;
    console.info('Maze validation dry run', { revision: run.shift.revision, ...result });
  }
  toggle.addEventListener('click', () => setVisible(Boolean(panel.hidden)), { signal: events.signal });
  // The callback reads current state; the UI never owns or mutates maze truth.
  let currentRun: MazeRun | null = null;
  element('.debug-probe').addEventListener('click', () => { if (currentRun) probe(currentRun); }, { signal: events.signal });
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
    update(run: MazeRun, timestamp: number) {
      currentRun = run;
      if (panel.hidden || timestamp - lastUpdate < 100) return;
      lastUpdate = timestamp;
      const data = buildMazeDiagnostics(run);
      element('[data-testid="debug-revision"]').textContent = String(run.shift.revision);
      element('[data-testid="debug-phase"]').textContent = run.shift.phase;
      element('[data-testid="debug-location"]').textContent = `${data.location} · X ${data.player.x.toFixed(2)} / Z ${data.player.z.toFixed(2)}`;
      element('[data-testid="debug-route"]').textContent = data.route ? `${data.route.edges.length} connections home from ${data.origin}.` : data.routeNote;
      element('[data-testid="debug-plan"]').textContent = run.shift.validation?.reason ?? 'No shift checked yet.';
      pointer.setAttribute('transform', `translate(${data.player.x} ${data.player.z}) rotate(${-data.player.yaw * 180 / Math.PI})`);
      pointer.dataset.x = String(data.player.x); pointer.dataset.z = String(data.player.z); pointer.dataset.yaw = String(data.player.yaw);
      for (const { edge, line, status } of edges) {
        const gate = data.gates.find((gate) => gate.id === edge.gate);
        const open = !edge.gate || run.shift.openness[edge.gate] === 1;
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
