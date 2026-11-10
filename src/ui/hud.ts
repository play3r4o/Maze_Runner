import type { PlayerState } from '../simulation/player';

export function createHud(root: HTMLElement) {
  root.innerHTML = `
    <header class="prototype-header">
      <span class="eyebrow">DEVELOPMENT BUILD / M0</span>
      <p class="wordmark">Shifting Labyrinth<span>Working title</span></p>
    </header>
    <div class="session-status" role="status" aria-live="polite">
      <span class="status-dot"></span><span data-mode>PAUSED</span>
    </div>
    <div class="crosshair" aria-hidden="true"></div>
    <section class="pause-overlay" aria-labelledby="panel-title">
      <div class="pause-panel">
        <p class="eyebrow">MILESTONE 00</p>
        <h1 id="panel-title">A place to begin.</h1>
        <p class="panel-description">One room. Four walls. The foundation for a changing maze.</p>
        <div class="control-list" aria-label="Controls">
          <p><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move</span></p>
          <p><span class="control-name">Mouse</span><span>Look around</span></p>
          <p><span><kbd>Esc</kbd></span><span>Pause &amp; release cursor</span></p>
        </div>
        <button type="button" class="start-button">Start exploring <span aria-hidden="true">&gt;</span></button>
        <p class="panel-hint" data-message>Click to capture your mouse. Press Escape to release it.</p>
      </div>
    </section>
    <footer class="diagnostics">
      <span class="diagnostics-label">ROOM TEST <span class="separator">/</span> POSITION</span>
      <span>X <output data-testid="position-x">0.00</output></span>
      <span>Z <output data-testid="position-z">8.00</output></span>
      <span class="footer-controls">WASD · MOVE <span class="separator">/</span> ESC · PAUSE</span>
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
  const x = element<HTMLOutputElement>('[data-testid="position-x"]');
  const z = element<HTMLOutputElement>('[data-testid="position-z"]');
  let hasStarted = false;
  let lastPositionUpdate = -Infinity;

  root.dataset.state = 'paused';

  return {
    button,
    setMode(running: boolean, notice?: string) {
      if (root.dataset.state === 'error') return;
      if (running) hasStarted = true;
      root.dataset.state = running ? 'running' : 'paused';
      overlay.hidden = running;
      mode.textContent = running ? 'EXPLORING' : 'PAUSED';
      title.textContent = hasStarted ? 'Take your time.' : 'A place to begin.';
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
