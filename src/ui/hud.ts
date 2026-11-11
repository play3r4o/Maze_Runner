import type { PlayerState } from '../simulation/player';
import { GATE_IDS, openGatesFor } from '../simulation/junction';
import type { GateId } from '../simulation/junction';
import type { JunctionState } from '../simulation/shift';
import { WARNING_SECONDS } from '../simulation/shift';

export function createHud(root: HTMLElement, scene: 'room' | 'junction') {
  const isJunction = scene === 'junction';
  const startTitle = isJunction ? 'The walls can move.' : 'A place to begin.';
  root.innerHTML = `
    <header class="prototype-header">
      <span class="eyebrow">DEVELOPMENT BUILD / ${isJunction ? 'M1 · CRUSHING GATES' : 'M0'}</span>
      <p class="wordmark">Shifting Labyrinth<span>Working title</span></p>
    </header>
    <div class="session-status" role="status" aria-live="polite">
      <span class="status-dot"></span><span data-mode>PAUSED</span>
    </div>
    <div class="crosshair" aria-hidden="true"></div>
    <section class="pause-overlay" aria-labelledby="panel-title">
      <div class="pause-panel">
        <p class="eyebrow">MILESTONE ${isJunction ? '01 · SINGLE JUNCTION' : '00'}</p>
        <h1 id="panel-title">${startTitle}</h1>
        <p class="panel-description">${isJunction ? 'Closing gates crush. Cross the 8-meter passages before the stone reaches you, or take the longer outer loop. Press G to shift.' : 'One room. Four walls. The foundation for a changing maze.'}</p>
        <div class="control-list" aria-label="Controls">
          <p><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move</span></p>
          <p><span class="control-name">Mouse</span><span>Look around</span></p>
          <p><span><kbd>Esc</kbd></span><span>Pause &amp; release cursor</span></p>
          ${isJunction ? '<p><span><kbd>G</kbd></span><span>Request a shift</span></p>' : ''}
        </div>
        <button type="button" class="start-button">Start exploring <span aria-hidden="true">&gt;</span></button>
        <p class="panel-hint" data-message>Click to capture your mouse. Press Escape to release it.</p>
      </div>
    </section>
    ${isJunction ? `
      <aside class="shift-panel" aria-label="Junction status">
        <p class="eyebrow">JUNCTION CONTROL <span data-testid="shift-count">0 shifts</span></p>
        <p class="shift-phase" data-testid="shift-phase">Ready</p>
        <p class="shift-layout" data-testid="shift-layout">North / south open</p>
        <div class="gate-statuses">${GATE_IDS.map((id) => `<div><span>${id.toUpperCase()}</span><output data-testid="gate-${id}"></output></div>`).join('')}</div>
        <p class="shift-notice" data-testid="shift-notice" role="status">Press G to change routes.</p>
        <p class="shift-help"><kbd>G</kbd> SHIFT <span>Marked passages are lethal during closing.</span></p>
      </aside>` : ''}
    <footer class="diagnostics">
      <span class="diagnostics-label">${isJunction ? 'JUNCTION' : 'ROOM'} TEST <span class="separator">/</span> POSITION</span>
      <span>X <output data-testid="position-x">0.00</output></span>
      <span>Z <output data-testid="position-z">${isJunction ? '0.00' : '8.00'}</output></span>
      <span class="footer-controls">WASD · MOVE ${isJunction ? '<span class="separator">/</span> G · SHIFT' : ''} <span class="separator">/</span> ESC · PAUSE</span>
    </footer>
  `;

  function element<T extends HTMLElement>(selector: string): T {
    const result = root.querySelector<T>(selector);
    if (!result) throw new Error(`Missing HUD element: ${selector}`);
    return result;
  }

  const overlay = element<HTMLElement>('.pause-overlay');
  const title = element<HTMLElement>('#panel-title');
  const mode = element<HTMLElement>('[data-mode]');
  const message = element<HTMLElement>('[data-message]');
  const button = element<HTMLButtonElement>('button');
  const description = element<HTMLElement>('.panel-description');
  const initialDescription = description.textContent;
  const x = element<HTMLOutputElement>('[data-testid="position-x"]');
  const z = element<HTMLOutputElement>('[data-testid="position-z"]');
  let hasStarted = false;
  let lastPositionUpdate = -Infinity;
  let lastJunctionUpdate = -Infinity;
  const phase = isJunction ? element<HTMLElement>('[data-testid="shift-phase"]') : null;
  const layout = isJunction ? element<HTMLElement>('[data-testid="shift-layout"]') : null;
  const count = isJunction ? element<HTMLElement>('[data-testid="shift-count"]') : null;
  const notice = isJunction ? element<HTMLElement>('[data-testid="shift-notice"]') : null;
  const gateLabels = isJunction ? GATE_IDS.map((id) => ({ id, label: element<HTMLElement>(`[data-testid="gate-${id}"]`) })) : [];

  root.dataset.state = 'paused';

  return {
    button,
    setMode(running: boolean, notice?: string) {
      if (root.dataset.state === 'error' || root.dataset.state === 'dead') return;
      if (running) hasStarted = true;
      root.dataset.state = running ? 'running' : 'paused';
      overlay.hidden = running;
      mode.textContent = running ? 'EXPLORING' : 'PAUSED';
      title.textContent = hasStarted ? 'Take your time.' : startTitle;
      button.innerHTML = `${hasStarted ? 'Resume exploring' : 'Start exploring'} <span aria-hidden="true">&gt;</span>`;
      message.textContent = notice ?? 'Click to capture your mouse. Press Escape to release it.';
      if (!running) button.focus({ preventScroll: true });
    },
    updatePosition(player: PlayerState, timestamp: number) {
      if (timestamp - lastPositionUpdate < 100) return;
      lastPositionUpdate = timestamp;
      x.value = player.x.toFixed(2);
      z.value = player.z.toFixed(2);
    },
    updateJunction(state: JunctionState, timestamp: number) {
      if (!phase || !layout || !count || !notice || timestamp - lastJunctionUpdate < 100) return;
      lastJunctionUpdate = timestamp;
      const labels = { idle: 'Ready · press G', warning: `Shift in ${(WARNING_SECONDS - state.phaseSeconds).toFixed(1)}s`,
        opening: 'Opening new routes', closing: 'Closing · lethal', cooldown: 'Cooling down' };
      phase.textContent = labels[state.phase];
      phase.dataset.phase = state.phase;
      layout.textContent = `${state.settled === 'north-south' ? 'North / south' : 'East / west'} arrangement`;
      count.textContent = `${state.completedShifts} shift${state.completedShifts === 1 ? '' : 's'}`;
      if (notice.textContent !== state.notice) notice.textContent = state.notice;
      for (const { id, label } of gateLabels) {
        const closing = state.phase === 'closing' && !openGatesFor(state.target).includes(id);
        const text = state.openness[id] === 1 ? 'OPEN' : state.openness[id] === 0 ? 'CLOSED' : closing ? 'CLOSING' : 'OPENING';
        label.textContent = text;
        label.dataset.status = text.toLowerCase();
      }
    },
    showDeath(gate: GateId) {
      root.dataset.state = 'dead';
      overlay.hidden = false;
      title.textContent = 'Crushed.';
      mode.textContent = 'CRUSHED';
      description.textContent = `The ${gate.toUpperCase()} gate caught you. Moving stone does not stop. Take the warning seriously or use the outer loop.`;
      message.textContent = 'Retry starts a fresh attempt at the central junction.';
      button.textContent = 'Retry';
      button.focus({ preventScroll: true });
    },
    resetAttempt() {
      root.dataset.state = 'paused';
      hasStarted = false;
      lastPositionUpdate = -Infinity;
      lastJunctionUpdate = -Infinity;
      description.textContent = initialDescription;
    },
    showError(notice: string) {
      root.dataset.state = 'error';
      overlay.hidden = false;
      title.textContent = 'Unable to start the room.';
      mode.textContent = 'UNAVAILABLE';
      message.textContent = notice;
      button.hidden = true;
    },
  };
}
