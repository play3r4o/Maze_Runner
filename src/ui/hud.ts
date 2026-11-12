import type { PlayerState } from '../simulation/player';
import { GATE_IDS, openGatesFor } from '../simulation/junction';
import type { GateId } from '../simulation/junction';
import type { JunctionState } from '../simulation/shift';
import { WARNING_SECONDS } from '../simulation/shift';
import { HAND_BUILT_MAZE, MAZE_GATE_IDS } from '../simulation/maze';
import type { MazeRun } from '../game/mazeRun';
import { isRunOver } from '../game/generatedRun';
import { CHALK_INK_METRES, PLAYER_HEALTH } from '../game/tuning';

// Result-screen wording for deaths other than gate crushes.
const DEATH_TEXT: Record<string, string> = {"boulder": "A rolling boulder flattened you", "pit": "The floor opened and you fell", "spears": "Spears from the walls ran you through", "floorSpikes": "Spikes burst from the floor beneath you", "darts": "Darts from the walls brought you down", "blade": "A swinging blade cut you down"};
import type { GeneratedRun } from '../game/generatedRun';
import type { GeneratedMaze } from '../simulation/mazeGenerator';
import type { SceneMode } from '../rendering/scene';

export function createHud(root: HTMLElement, scene: SceneMode, generated?: GeneratedMaze) {
  const isJunction = scene === 'junction';
  const isMaze = scene === 'maze';
  const isGenerated = scene === 'generated' && generated !== undefined;
  const landmarks = isGenerated ? generated.landmarks : HAND_BUILT_MAZE.landmarks;
  const hasNavigation = isMaze || isGenerated;
  const hasGates = isJunction || isMaze;
  const gateIds = isMaze ? MAZE_GATE_IDS : GATE_IDS;
  const startTitle = isGenerated ? 'Bring the relic home.' : isMaze ? 'Find your way home.' : isJunction ? 'The walls can move.' : 'A place to begin.';
  root.innerHTML = `
    <header class="prototype-header">
      <span class="eyebrow">DEVELOPMENT BUILD / ${isGenerated ? 'M10–12 · DANGER' : isMaze ? 'M3 · GRAPH DIAGNOSTICS' : isJunction ? 'M1 · PUSH &amp; CRUSH' : 'M0'}</span>
      <p class="wordmark">Shifting Labyrinth<span>Working title</span></p>
    </header>
    <div class="session-status" role="status" aria-live="polite">
      <span class="status-dot"></span><span data-mode>PAUSED</span>
    </div>
    <div class="crosshair" aria-hidden="true"></div>
    <section class="pause-overlay" aria-labelledby="panel-title">
      <div class="pause-panel">
        <p class="eyebrow">MILESTONE ${isGenerated ? '10–12 · DANGER' : isMaze ? '03 · GRAPH DIAGNOSTICS' : isJunction ? '01 · SINGLE JUNCTION' : '00'}</p>
        <h1 id="panel-title">${startTitle}</h1>
        <p class="panel-description">${isGenerated ? `A relic waits in the outer ring of this ${generated.columns}×${generated.rows} maze (seed ${generated.seed}): follow the blue beam, take it with E, then carry it back to Sanctuary under the gold beam. Warned shifts open one stone gate and close another every 45 seconds, faster while you carry the relic. A bell from Sanctuary tolls as time runs on; after the third, night falls and the maze shifts constantly. Listen for grinding stone. Press C to take out the chalk, then hold the left mouse button to draw or write on floors, walls and gates (limited chalk per run); C puts it away. Closing stone pushes you and crushes you if you no longer fit. Hidden pressure plates set off boulders, spears, spikes, pits and darts; blades swing in some corridors. You have 100 health. Every room always keeps some route home.` : isMaze ? 'Leave the warm Sanctuary marker, find three colored landmarks, then return home. G swaps two gate shortcuts. The 8-meter stone passages push and crush; permanent corridors offer detours. Learn the routes as you explore.' : isJunction ? 'Moving stone pushes you toward the opposite wall. Escape the 8-meter passage before the gap becomes too narrow to fit, or take the outer loop. Press G to shift.' : 'One room. Four walls. The foundation for a changing maze.'}</p>
        <div class="control-list" aria-label="Controls">
          <p><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>Move</span></p>
          <p><span class="control-name">Mouse</span><span>Look around</span></p>
          <p><span><kbd>Esc</kbd></span><span>Pause &amp; release cursor</span></p>
          ${isGenerated ? '<p><span><kbd>E</kbd></span><span>Take the relic</span></p><p><span><kbd>C</kbd></span><span>Chalk in hand / away · left mouse draws</span></p><p><span><kbd>G</kbd></span><span>Force a shift (debug)</span></p>'
            : hasGates ? '<p><span><kbd>G</kbd></span><span>Request a shift</span></p>' : ''}
          ${hasNavigation ? '<p><span><kbd>F2</kbd></span><span>Developer debug map</span></p>' : ''}
        </div>
        <button type="button" class="start-button">Start exploring <span aria-hidden="true">&gt;</span></button>
        ${isGenerated ? `<div class="run-actions">
          <button type="button" data-action="retry-seed" hidden>Retry this seed</button>
          <button type="button" data-action="abandon" hidden>Abandon run</button></div>
        <div class="audio-controls"><label>Volume <input type="range" data-testid="volume" min="0" max="100" value="80"></label>
          <label><input type="checkbox" data-testid="mute"> Mute</label></div>` : ''}
        <p class="panel-hint" data-message>Click to capture your mouse. Press Escape to release it.</p>
      </div>
    </section>
    ${hasGates ? `
      <aside class="shift-panel" aria-label="${isMaze ? 'Maze' : 'Junction'} status">
        <p class="eyebrow">${isMaze ? 'MAZE' : 'JUNCTION'} CONTROL <span data-testid="shift-count">0 shifts</span></p>
        <p class="shift-phase" data-testid="shift-phase">Ready</p>
        <p class="shift-layout" data-testid="shift-layout">North / south open</p>
        <div class="gate-statuses">${gateIds.map((id) => `<div><span>${id.toUpperCase()}</span><output data-testid="gate-${id}"></output></div>`).join('')}</div>
        <p class="shift-notice" data-testid="shift-notice" role="status">Press G to change routes.</p>
        <p class="shift-help"><kbd>G</kbd> SHIFT <span>Escape before the gap closes around you.</span></p>
        ${isMaze ? `<div class="navigation-check"><p class="eyebrow">NAVIGATION CHECK</p>
          ${HAND_BUILT_MAZE.landmarks.map((landmark) => `<p><span class="landmark-dot" style="background:${landmark.color}"></span>${landmark.name}<output data-testid="visit-${landmark.id}">—</output></p>`).join('')}
          <p class="return-status" data-testid="return-status" role="status">Visit all three, then return.</p></div>` : ''}
      </aside>` : ''}
    ${isGenerated ? `
      <aside class="shift-panel" aria-label="Expedition status">
        <p class="eyebrow">EXPEDITION <span data-testid="hud-seed">seed ${generated.seed}</span></p>
        <p class="run-objective" data-testid="run-objective" role="status">Leave Sanctuary and find the relic under the blue beam.</p>
        <div class="health" aria-label="Health"><span class="health-fill" data-testid="health-fill"></span><output data-testid="health">100</output></div>
        <p class="shift-layout"><span data-testid="run-time">0:00</span> · <span data-testid="shift-count">0 shifts</span> · <span data-testid="hud-ring">Sanctuary</span> · <span data-testid="chalk-left">100% chalk</span></p>
        <p class="shift-phase" data-testid="shift-phase">Maze still</p>
        <p class="shift-notice" data-testid="shift-notice" role="status"></p>
      </aside>
      <p class="interact-prompt" data-testid="interact-prompt" hidden><kbd>E</kbd> Take the relic</p>
      <p class="chalk-mode" data-testid="chalk-mode" hidden>Chalk out · hold left mouse to draw · <kbd>C</kbd> put away</p>` : ''}
    <footer class="diagnostics">
      <span class="diagnostics-label">${hasNavigation ? 'MAZE' : isJunction ? 'JUNCTION' : 'ROOM'} TEST <span class="separator">/</span> POSITION</span>
      <span>X <output data-testid="position-x">0.00</output></span>
      <span>Z <output data-testid="position-z">${hasGates || isGenerated ? '0.00' : '8.00'}</output></span>
      <span class="footer-controls">WASD · MOVE ${isGenerated ? '<span class="separator">/</span> E · TAKE <span class="separator">/</span> C + LMB · DRAW' : hasGates ? '<span class="separator">/</span> G · SHIFT' : ''} <span class="separator">/</span> ESC · PAUSE</span>
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
  const phase = hasGates ? element<HTMLElement>('[data-testid="shift-phase"]') : null;
  const layout = hasGates ? element<HTMLElement>('[data-testid="shift-layout"]') : null;
  const count = hasGates ? element<HTMLElement>('[data-testid="shift-count"]') : null;
  const notice = hasGates ? element<HTMLElement>('[data-testid="shift-notice"]') : null;
  const gateLabels = hasGates ? gateIds.map((id) => ({ id, label: element<HTMLElement>(`[data-testid="gate-${id}"]`) })) : [];
  const visits = isMaze ? landmarks.map((landmark) => ({ id: landmark.id,
    label: element<HTMLElement>(`[data-testid="visit-${landmark.id}"]`) })) : [];
  const ringLabel = isGenerated ? element<HTMLElement>('[data-testid="hud-ring"]') : null;
  const generatedPhase = isGenerated ? element<HTMLElement>('[data-testid="shift-phase"]') : null;
  const generatedCount = isGenerated ? element<HTMLElement>('[data-testid="shift-count"]') : null;
  const generatedNotice = isGenerated ? element<HTMLElement>('[data-testid="shift-notice"]') : null;
  const objective = isGenerated ? element<HTMLElement>('[data-testid="run-objective"]') : null;
  const runTime = isGenerated ? element<HTMLElement>('[data-testid="run-time"]') : null;
  const prompt = isGenerated ? element<HTMLElement>('[data-testid="interact-prompt"]') : null;
  const chalkLeft = isGenerated ? element<HTMLElement>('[data-testid="chalk-left"]') : null;
  const chalkMode = isGenerated ? element<HTMLElement>('[data-testid="chalk-mode"]') : null;
  const health = isGenerated ? element<HTMLElement>('[data-testid="health"]') : null;
  const healthFill = isGenerated ? element<HTMLElement>('[data-testid="health-fill"]') : null;
  const volume = isGenerated ? element<HTMLInputElement>('[data-testid="volume"]') : null;
  const mute = isGenerated ? element<HTMLInputElement>('[data-testid="mute"]') : null;
  const retrySeed = isGenerated ? element<HTMLButtonElement>('[data-action="retry-seed"]') : null;
  const abandon = isGenerated ? element<HTMLButtonElement>('[data-action="abandon"]') : null;
  const clock = (ticks: number) => { const seconds = Math.floor(ticks / 60); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`; };
  const returnStatus = isMaze ? element<HTMLElement>('[data-testid="return-status"]') : null;

  root.dataset.state = 'paused';

  return {
    button, retrySeed, abandon, volume, mute,
    setMode(running: boolean, notice?: string) {
      if (root.dataset.state === 'error' || root.dataset.state === 'dead') return;
      // Abandon is offered while paused mid-run; not before the first start.
      if (abandon) abandon.hidden = running || !hasStarted;
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
    updateJunction(state: JunctionState, timestamp: number, pushedBy: GateId | null) {
      if (!phase || !layout || !count || !notice || timestamp - lastJunctionUpdate < 100) return;
      lastJunctionUpdate = timestamp;
      const labels = { idle: 'Ready · press G', warning: `Shift in ${(WARNING_SECONDS - state.phaseSeconds).toFixed(1)}s`,
        opening: 'Opening new routes', closing: pushedBy ? 'Being pushed · escape' : 'Closing · squeeze hazard', cooldown: 'Cooling down' };
      phase.textContent = labels[state.phase];
      phase.dataset.phase = state.phase;
      layout.textContent = `${state.settled === 'north-south' ? 'North / south' : 'East / west'} arrangement`;
      count.textContent = `${state.completedShifts} shift${state.completedShifts === 1 ? '' : 's'}`;
      const currentNotice = pushedBy ? `${pushedBy.toUpperCase()} stone is pushing you. Move along the passage to escape!` : state.notice;
      if (notice.textContent !== currentNotice) notice.textContent = currentNotice;
      for (const { id, label } of gateLabels) {
        const closing = state.phase === 'closing' && !openGatesFor(state.target).includes(id);
        const text = state.openness[id] === 1 ? 'OPEN' : state.openness[id] === 0 ? 'CLOSED' : closing ? 'CLOSING' : 'OPENING';
        label.textContent = text;
        label.dataset.status = text.toLowerCase();
      }
    },
    showDeath(gate: string) {
      root.dataset.state = 'dead';
      overlay.hidden = false;
      title.textContent = 'Crushed.';
      mode.textContent = 'CRUSHED';
      description.textContent = `The ${gate.toUpperCase()} gate pinned you against the opposite wall. There was no longer enough room for your body. Escape earlier or use ${isMaze || isGenerated ? 'a permanent detour' : 'the outer loop'}.`;
      message.textContent = `Retry starts a fresh attempt at ${isMaze || isGenerated ? 'Sanctuary' : 'the central junction'}.`;
      button.textContent = 'Retry';
      button.focus({ preventScroll: true });
    },
    updateMaze(run: MazeRun, timestamp: number) {
      if (!phase || !layout || !count || !notice || timestamp - lastJunctionUpdate < 100) return;
      lastJunctionUpdate = timestamp;
      const state = run.shift;
      const labels = { idle: 'Ready · press G', warning: `Shift in ${(WARNING_SECONDS - state.phaseSeconds).toFixed(1)}s`,
        opening: 'Opening new shortcut', closing: run.pushedBy ? 'Being pushed · escape' : 'Closing · squeeze hazard', cooldown: 'Cooling down' };
      phase.textContent = labels[state.phase]; phase.dataset.phase = state.phase;
      layout.textContent = `${state.settled.toUpperCase()} shortcut arrangement`;
      count.textContent = `${state.completedShifts} shift${state.completedShifts === 1 ? '' : 's'}`;
      notice.textContent = run.pushedBy ? `${run.pushedBy.toUpperCase()} stone is pushing you. Escape along the passage!` : state.notice;
      for (const { id, label } of gateLabels) {
        if (id !== 'north' && id !== 'east') continue;
        const value = state.openness[id];
        const text = value === 1 ? 'OPEN' : value === 0 ? 'CLOSED' : state.phase === 'closing' && id !== state.target ? 'CLOSING' : 'OPENING';
        label.textContent = text; label.dataset.status = text.toLowerCase();
      }
      for (const { id, label } of visits) {
        label.textContent = run.visited.includes(id) ? 'FOUND' : '—';
        label.dataset.visited = String(run.visited.includes(id));
      }
      if (returnStatus) {
        returnStatus.textContent = run.returned ? 'Returned to Sanctuary · route check complete.'
          : run.visited.length === 3 ? 'All landmarks found · return to Sanctuary.' : `${run.visited.length}/3 found · visit all three, then return.`;
        returnStatus.dataset.complete = String(run.returned);
      }
    },
    updateGenerated(run: GeneratedRun, timestamp: number, inReach: boolean, chalkOut: boolean) {
      if (prompt && prompt.hidden === inReach) prompt.hidden = !inReach;
      // Chalk in hand: indicator and a ring crosshair.
      if (chalkMode && chalkMode.hidden === chalkOut) chalkMode.hidden = !chalkOut;
      if ((root.dataset.chalk === 'out') !== chalkOut) { if (chalkOut) root.dataset.chalk = 'out'; else delete root.dataset.chalk; }
      if (!ringLabel || timestamp - lastJunctionUpdate < 100) return;
      lastJunctionUpdate = timestamp;
      ringLabel.textContent = run.ring === 'sanctuary' ? 'Sanctuary' : `${run.ring[0].toUpperCase()}${run.ring.slice(1)} ring`;
      ringLabel.dataset.ring = run.ring;
      runTime!.textContent = clock(run.runTicks);
      const goal = run.status === 'ready' ? 'Leave Sanctuary and find the relic under the blue beam.'
        : run.carrying ? 'Relic in hand · carry it back to Sanctuary under the gold beam.'
        : 'Find the relic under the blue beam in the outer ring.';
      if (objective!.textContent !== goal) { objective!.textContent = goal; objective!.dataset.carrying = String(run.carrying); }
      const state = run.shift;
      const plan = state.plan;
      const labels = { idle: 'Maze still', warning: `Shift in ${(WARNING_SECONDS - state.phaseSeconds).toFixed(1)}s`,
        opening: `${plan?.open.toUpperCase()} opening`, closing: run.pushedBy ? 'Being pushed · escape' : `${plan?.close.toUpperCase()} closing`,
        cooldown: 'Settling' };
      generatedPhase!.textContent = `${labels[state.phase]}${run.frozen ? ' · frozen (debug)' : ''}`; generatedPhase!.dataset.phase = state.phase;
      generatedCount!.textContent = `${state.completedShifts} shift${state.completedShifts === 1 ? '' : 's'}`;
      // Health shows at once (not throttled) so a hit is felt immediately.
      if (health!.textContent !== String(run.health)) {
        health!.textContent = String(run.health);
        healthFill!.style.width = `${(100 * run.health) / PLAYER_HEALTH}%`;
        healthFill!.dataset.low = String(run.health <= 35);
      }
      chalkLeft!.textContent = run.rules.chalk ? `${Math.round((run.chalkLeft / CHALK_INK_METRES) * 100)}% chalk` : 'no chalk';
      // Visual equivalent of the bell (T3): name the strikes for a few seconds after they ring.
      const bell = [...run.events].reverse().find((event) => event.kind === 'bell');
      const bellNotice = bell && run.tick - bell.tick < 6 * 60
        ? `The Sanctuary bell tolls ${['once', 'twice', 'three times'][run.bells - 1] ?? ''}.${run.bells === 3 ? ' Night falls: the maze will shift constantly.' : ''}` : null;
      const notice = run.pushedBy ? `${run.pushedBy.toUpperCase()} stone is pushing you. Escape along the passage!`
        : bellNotice ?? (run.status === 'out' && state.phase === 'idle' && state.completedShifts === 0
          ? 'The maze shifts by itself, after a 2 second warning. Listen for grinding stone.' : state.notice);
      if (generatedNotice!.textContent !== notice) generatedNotice!.textContent = notice;
    },
    // Terminal result for the M7 expedition. Uses the 'dead' state so pausing cannot hide it.
    showResult(run: GeneratedRun) {
      if (!isRunOver(run.status)) return;
      root.dataset.state = 'dead';
      root.dataset.result = run.status;
      overlay.hidden = false;
      if (prompt) prompt.hidden = true;
      const time = clock(run.runTicks);
      const shifts = `${run.shift.completedShifts} shift${run.shift.completedShifts === 1 ? '' : 's'}`;
      const debug = run.teleports ? ` Debug teleports used: ${run.teleports}.` : '';
      const copy = {
        extracted: ['Relic secured.', 'EXTRACTED', `You carried the relic home in ${time}, through ${shifts}.${debug}`],
        failed: run.crushedBy
          ? ['Crushed.', 'CRUSHED', `The ${run.crushedBy.toUpperCase()} gate pinned you against the opposite wall after ${time} and ${shifts}.${run.carrying ? ' The relic is lost.' : ''}`]
          : ['You died.', 'DEAD', `${DEATH_TEXT[run.killedBy ?? ''] ?? `Killed by ${run.killedBy}`} after ${time} and ${shifts}.${run.carrying ? ' The relic is lost.' : ''}`],
        abandoned: ['Run abandoned.', 'ABANDONED', `You gave up after ${time} and ${shifts}. Nothing was secured.${run.carrying ? ' The relic stays in the maze.' : ''}`],
      }[run.status as 'extracted' | 'failed' | 'abandoned'];
      title.textContent = copy[0]; mode.textContent = copy[1]; description.textContent = copy[2];
      message.textContent = `Seed ${generated?.seed}. New run builds a fresh maze from a new seed. Retry replays this seed from the start.`;
      button.textContent = 'New run';
      if (retrySeed) retrySeed.hidden = false;
      if (abandon) abandon.hidden = true;
      button.focus({ preventScroll: true });
    },
    resetAttempt() {
      root.dataset.state = 'paused';
      delete root.dataset.result;
      if (retrySeed) retrySeed.hidden = true;
      if (abandon) abandon.hidden = true;
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
