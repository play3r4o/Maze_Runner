import './style.css';
import { BrowserInput } from './input/browserInput';
import { createFixedStepper } from './loop';
import { createScene } from './rendering/scene';
import { stepPlayer } from './simulation/player';
import { PLAYER_SPAWN, ROOM_WALLS } from './simulation/room';
import { createJunctionRun, requestRunShift, stepJunctionRun } from './game/junctionRun';
import { createHud } from './ui/hud';
import { createMazeRun, requestMazeRunShift, stepMazeRun } from './game/mazeRun';
import { createMazeDebug } from './ui/mazeDebug';
import { debugViewOfMazeRun } from './simulation/mazeDiagnostics';
import type { DebugView } from './simulation/mazeDiagnostics';
import type { SceneMode } from './rendering/scene';
import { MAX_SEED, generateMaze, layoutFingerprint, parseSeed, serializeMaze } from './simulation/mazeGenerator';
import { abandonGeneratedRun, drawChalk, isDead, setRule, buildGeneratedWorld, createGeneratedRun, interactGeneratedRun, isRunOver, relicInReach,
  requestGeneratedRunShift, setGeneratedRunFrozen, stepGeneratedRun, teleportGeneratedRun } from './game/generatedRun';
import { createRunReport, parseRunReport, reproduceRun } from './game/runReport';
import { ALL_RULES_ON, RULE_KEYS, autoShiftTicks, isNight, nextBellTick, nightFactor, unrestOf } from './game/pressure';
import type { RuleKey, RuleToggles } from './game/pressure';
import { dailySeed } from './game/tuning';
import type { RunReport } from './game/runReport';
import type { GeneratedRun } from './game/generatedRun';
import type { ShiftLogEntry } from './simulation/generatedShift';
import { MAZE_GATE_IDS } from './simulation/maze';
import { shownPoint } from './game/chalk';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const params = new URLSearchParams(location.search);
const requestedScene = params.get('scene');
// M0 room, M1 junction and M2/M3 hand-built maze stay reachable for regression checks.
const mode: SceneMode = requestedScene === 'room' ? 'room' : requestedScene === 'junction' ? 'junction'
  : requestedScene === 'maze' ? 'maze' : 'generated';
document.title = `Shifting Labyrinth · ${{ generated: 'M10–12', maze: 'M3', junction: 'M1', room: 'M0' }[mode]}`;
canvas.setAttribute('aria-label', { generated: 'First-person shifting seeded maze', maze: 'First-person hand-built maze',
  junction: 'First-person shifting junction', room: 'First-person gray room' }[mode]);

// Seed: ?seed=N reproduces a layout. Without a valid seed, pick one and write it into the
// address so reloading or copying the URL rebuilds the same maze.
function randomSeed() { return crypto.getRandomValues(new Uint32Array(1))[0] % (MAX_SEED + 1); }
function seedUrl(seed: number) {
  const url = new URL(location.href); url.searchParams.set('seed', String(seed)); url.searchParams.delete('scene');
  return url.toString();
}
const requestedSeed = params.get('seed');
const parsedSeed = parseSeed(requestedSeed);
// T8: with no seed in the address everyone gets today's maze (UTC date); a bad seed gets a random one.
const seed = parsedSeed ?? (requestedSeed === null ? dailySeed(new Date()) : randomSeed());
// M7b rule switches: `?off=dusk,sound` starts runs with those rules off, so comparisons survive New run.
const offRules = (params.get('off') ?? '').split(',').filter((key): key is RuleKey => (RULE_KEYS as readonly string[]).includes(key));
const initialRules: RuleToggles = { ...ALL_RULES_ON, ...Object.fromEntries(offRules.map((key) => [key, false])) };
const world = mode === 'generated' ? buildGeneratedWorld(generateMaze(seed)) : null;
if (world && parsedSeed === null) history.replaceState(null, '', seedUrl(seed));
if (world) {
  // Exposed for bug reports and automated reproducibility checks; read-only copies.
  document.documentElement.dataset.mazeSeed = String(seed);
  document.documentElement.dataset.mazeFingerprint = layoutFingerprint(world.maze);
  console.info('Seeded maze', { seed, version: world.maze.version, fingerprint: layoutFingerprint(world.maze), layout: serializeMaze(world.maze) });
}

// Page errors are counted for the debug panel and included in bug reports.
const pageErrors: string[] = [];
const recordError = (message: string) => { pageErrors.push(message); if (pageErrors.length > 10) pageErrors.shift(); };
window.addEventListener('error', (event) => recordError(event.message));
window.addEventListener('unhandledrejection', (event) => recordError(String(event.reason)));

// A bug report travels in the address hash (#repro=…) so it survives the reload to its seed.
const reproText = location.hash.startsWith('#repro=') ? decodeURIComponent(location.hash.slice('#repro='.length)) : null;
if (reproText !== null) history.replaceState(null, '', location.pathname + location.search);
// Tool callbacks need the live run, which exists only inside startRoom(); it fills this in.
let debugTools: NonNullable<Parameters<typeof createMazeDebug>[1]>['tools'] | null = null;

const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const hud = createHud(hudRoot, mode, world?.maze);
if (world && requestedSeed !== null && parsedSeed === null) {
  hud.setMode(false, `Seed “${requestedSeed}” is not a whole number from 0 to ${MAX_SEED}. Using random seed ${seed}.`);
}
const debug = mode === 'maze' ? createMazeDebug(hudRoot)
  : world ? createMazeDebug(hudRoot, { layout: world.maze, walls: world.walls, rings: world.maze.rings, entrances: world.maze.entrances,
    seed: { seed, version: world.maze.version, fingerprint: layoutFingerprint(world.maze),
      onLoad: (value) => location.assign(seedUrl(value)), onRandom: () => location.assign(seedUrl(randomSeed())) },
    tools: {
      config: `${world.maze.config.size}×${world.maze.config.size} · loops ${world.maze.config.loopChance} · ${world.maze.config.gateCount} gates`,
      teleports: [{ label: 'Sanctuary', cell: world.maze.start },
        ...world.maze.landmarks.map((landmark) => ({ label: landmark.name.split(' ')[0], cell: landmark.cell }))],
      rules: RULE_KEYS, onRule: (key, on) => debugTools?.onRule?.(key, on) ?? '', traps: world.traps,
      onFreeze: () => debugTools?.onFreeze() ?? '', onTeleport: (cell) => debugTools?.onTeleport(cell) ?? '',
      onCopyReport: () => debugTools?.onCopyReport() ?? '', onLoadReport: (text) => debugTools?.onLoadReport(text) ?? '',
    } }) : null;

function startRoom() {
  let scene: ReturnType<typeof createScene>;
  try {
    scene = createScene(canvas, mode, world ?? undefined);
  } catch {
    hud.showError('WebGL 2 could not start. Enable hardware acceleration or try a current desktop browser, then reload.');
    return;
  }

  let roomPlayer = { ...PLAYER_SPAWN };
  let run = createJunctionRun();
  let mazeRun = createMazeRun();
  let generatedRun: GeneratedRun | null = world ? createGeneratedRun(world, initialRules) : null;
  const logLine = (entry: ShiftLogEntry) => `#${entry.request + 1} rev ${entry.revision} ${entry.outcome.toUpperCase()}`
    + `${entry.plan ? ` · ${entry.plan.open.toUpperCase()} opens, ${entry.plan.close.toUpperCase()} closes` : ''}`
    + `${entry.rejectedCandidates ? ` · ${entry.rejectedCandidates} rejected` : ''} · ${entry.reason}`;
  const debugView = (): DebugView => world && generatedRun ? { layout: world.maze, player: generatedRun.player,
    openness: generatedRun.shift.openness, crushed: isDead(generatedRun), phase: generatedRun.shift.phase,
    opening: generatedRun.shift.plan?.open ?? null, closing: generatedRun.shift.plan?.close ?? null,
    revision: generatedRun.shift.revision, validation: generatedRun.shift.validation?.reason ?? null,
    log: generatedRun.shift.log.map(logLine),
    tools: { tick: generatedRun.tick, frozen: generatedRun.frozen, teleports: generatedRun.teleports, errors: pageErrors.length,
      rules: generatedRun.rules, trapPhases: generatedRun.traps.map((trap) => trap.phase),
      // Chalk strokes for the map, top-down, with gate drawings at their slab's current offset.
      chalk: generatedRun.chalk.map((stroke) => stroke.points.map((point) => { const [x, , z] = shownPoint(world.maze, generatedRun!.shift.openness, stroke, point); return { x, z }; })),
      run: (() => {
        const r = generatedRun;
        const interval = autoShiftTicks(r.rules, r.carrying, r.runTicks);
        const bell = nextBellTick(r.runTicks);
        return `Run ${r.status}${r.carrying ? ' · carrying relic' : ''} · relic ${world.relic.cell} · unrest ${unrestOf(r.rules, r.carrying)}`
          + ` · interval ${(interval / 60).toFixed(0)}s · `
          + (r.status === 'out' && r.shift.phase === 'idle' ? `auto shift in ${((interval - r.autoTicks) / 60).toFixed(1)}s` : 'auto shift waiting')
          + ` · clock ${(r.runTicks / 60).toFixed(1)}s · ${isNight(r.rules, r.runTicks) ? 'NIGHT' : r.rules.dusk && bell ? `next bell ${(bell / 60).toFixed(0)}s` : 'no bell'}`;
      })(),
      events: generatedRun.events.map((event) => `${(event.tick / 60).toFixed(1)}s ${event.kind}: ${event.detail}`) } } : debugViewOfMazeRun(mazeRun);
  let graphicsAvailable = true;
  const stepper = createFixedStepper((dt) => {
    const state = input.read();
    const shiftRequested = input.consumeShiftRequest();
    if (world) {
      let next = generatedRun!;
      const wasOver = isRunOver(next.status);
      if (input.consumeInteractRequest()) next = interactGeneratedRun(world, next);
      next = drawChalk(world, { ...next, player: { ...next.player, yaw: state.yaw } }, state.pitch, input.isChalkHeld());
      if (shiftRequested) {
        next = requestGeneratedRunShift(world, next);
        const entry = next.shift.log.at(-1);
        if (entry && entry !== generatedRun!.shift.log.at(-1)) console.info('Maze shift', { seed, ...entry });
      }
      generatedRun = next = stepGeneratedRun(world, next, state.intent, state.yaw, dt);
      if (!wasOver && isRunOver(next.status)) {
        console.info('Run ended', { seed, status: next.status, seconds: next.runTicks / 60, shifts: next.shift.completedShifts });
        input.pause();
        hud.showResult(next);
      }
    } else if (mode === 'maze') {
      const wasAlive = mazeRun.crushedBy === null;
      if (shiftRequested) mazeRun = requestMazeRunShift(mazeRun);
      mazeRun = stepMazeRun(mazeRun, state.intent, state.yaw, dt);
      if (wasAlive && mazeRun.crushedBy) {
        input.pause();
        hud.showDeath(mazeRun.crushedBy);
      }
    } else if (mode === 'junction') {
      const wasAlive = run.crushedBy === null;
      if (shiftRequested) run = requestRunShift(run);
      run = stepJunctionRun(run, state.intent, state.yaw, dt);
      if (wasAlive && run.crushedBy) {
        input.pause();
        hud.showDeath(run.crushedBy);
      }
    } else {
      roomPlayer = stepPlayer({ ...roomPlayer, yaw: state.yaw }, state.intent, ROOM_WALLS, dt);
    }
  });
  // A message to show on the next pause (set before releasing the mouse, which reports later).
  let pendingPauseMessage: string | null = null;
  const input = new BrowserInput(canvas, (running, message) => {
    stepper.reset();
    // Pausing can be reported more than once (direct pause, then the pointer-lock release),
    // so the message stays until the game runs again.
    const notice = message ?? (running ? undefined : pendingPauseMessage ?? undefined);
    if (running) pendingPauseMessage = null;
    hud.setMode(running, notice);
  }, debug ? (action) => { if (action === 'toggle') debug.toggle(); else debug.probe(debugView()); } : undefined);
  // M7 results: the main button starts a new seed; Retry replays this seed; Abandon ends the run.
  const resetGeneratedRun = () => {
    generatedRun = createGeneratedRun(world!, generatedRun?.rules ?? initialRules);
    scene.audio?.reset();
    input.putChalkAway();
    input.resetLook();
    stepper.reset();
    hud.resetAttempt();
    debug?.resetAttempt();
  };
  const onRetrySeed = () => { resetGeneratedRun(); scene.audio?.resume(); void input.start(); };
  const onAbandon = () => {
    if (!generatedRun || isRunOver(generatedRun.status)) return;
    generatedRun = abandonGeneratedRun(generatedRun);
    console.info('Run ended', { seed, status: 'abandoned', seconds: generatedRun.runTicks / 60 });
    hud.showResult(generatedRun);
  };
  hud.retrySeed?.addEventListener('click', onRetrySeed);
  hud.abandon?.addEventListener('click', onAbandon);
  const onStart = () => {
    if (generatedRun && isRunOver(generatedRun.status)) {
      location.assign(seedUrl(randomSeed()));
      return;
    }
    if (run.crushedBy || mazeRun.crushedBy) {
      run = createJunctionRun();
      mazeRun = createMazeRun();
      input.resetLook();
      stepper.reset();
      hud.resetAttempt();
      debug?.resetAttempt();
    }
    // Audio may only start inside a user gesture; this click also requests pointer lock.
    scene.audio?.resume();
    void input.start();
  };
  const onVolume = () => scene.audio?.setVolume(Number(hud.volume!.value) / 100);
  const onMute = () => scene.audio?.setMuted(hud.mute!.checked);
  hud.volume?.addEventListener('input', onVolume);
  hud.mute?.addEventListener('change', onMute);
  hud.button.addEventListener('click', onStart);

  // M6 debug tools (generated maze only). They act on the live run between simulation ticks.
  function applyReport(report: RunReport): string {
    if (!world || !generatedRun) return 'No generated maze loaded.';
    const wasDead = isDead(generatedRun) || isRunOver(generatedRun.status);
    const result = reproduceRun(world, report);
    generatedRun = result.run;
    input.setLook(result.run.player.yaw);
    stepper.reset();
    if (wasDead) { hud.resetAttempt(); debug?.resetAttempt(); }
    if (isRunOver(result.run.status)) hud.showResult(result.run);
    console.info('Reproduced bug report', { mismatches: result.mismatches, report });
    return `Reproduced report: seed ${report.seed}, ${report.requests} shift requests, tick ${report.tick}. `
      + (result.mismatches.length ? `Differences: ${result.mismatches.join(' ')}` : 'Gate state matches the report exactly.');
  }
  if (world) debugTools = {
    config: '', teleports: [],
    rules: RULE_KEYS,
    onRule(key, on) {
      generatedRun = setRule(generatedRun!, key, on);
      // Keep switched-off rules in the address so New run and reloads keep the comparison.
      const url = new URL(location.href);
      const off = RULE_KEYS.filter((rule) => !generatedRun!.rules[rule]);
      if (off.length) url.searchParams.set('off', off.join(',')); else url.searchParams.delete('off');
      history.replaceState(null, '', url);
      return `${key} ${on ? 'on' : 'off'}.`;
    },
    onFreeze() {
      generatedRun = setGeneratedRunFrozen(generatedRun!, !generatedRun!.frozen);
      return generatedRun.frozen ? 'Shift timers frozen. Gates hold their pose; walking continues.' : 'Shift timers resumed.';
    },
    onTeleport(cell) {
      const result = teleportGeneratedRun(world, generatedRun!, cell);
      generatedRun = result.run;
      return result.error ?? `Teleported to ${cell} (${generatedRun.ring}). Resume to continue from there.`;
    },
    onCopyReport() {
      const report = createRunReport(world, generatedRun!, { errors: pageErrors, shiftLog: generatedRun!.shift.log.map(logLine),
        note: `${navigator.userAgent} · ${innerWidth}×${innerHeight}` });
      const text = JSON.stringify(report);
      navigator.clipboard?.writeText(text).catch(() => undefined);
      console.info('Bug report', report);
      return text;
    },
    onLoadReport(text) {
      const parsed = parseRunReport(text.trim());
      if (!parsed.ok) return `Report not loaded: ${parsed.error}`;
      if (parsed.report.seed !== seed) {
        location.assign(`${seedUrl(parsed.report.seed)}#repro=${encodeURIComponent(text.trim())}`);
        return `Loading seed ${parsed.report.seed}…`;
      }
      return applyReport(parsed.report);
    },
  };
  if (world && reproText !== null) {
    const parsed = parseRunReport(reproText);
    hud.setMode(false, parsed.ok ? applyReport(parsed.report) : `Report not loaded: ${parsed.error}`);
  }
  // A #repro= link opened on the same page changes only the hash (no reload): apply it too.
  const onHashChange = () => {
    if (!world || !location.hash.startsWith('#repro=')) return;
    const text = decodeURIComponent(location.hash.slice('#repro='.length));
    history.replaceState(null, '', location.pathname + location.search);
    const parsed = parseRunReport(text);
    if (parsed.ok && parsed.report.seed !== seed) { location.assign(`${seedUrl(parsed.report.seed)}#repro=${encodeURIComponent(text)}`); return; }
    const message = parsed.ok ? applyReport(parsed.report) : `Report not loaded: ${parsed.error}`;
    pendingPauseMessage = message;
    input.pause();
    hud.setMode(false, message);
  };
  window.addEventListener('hashchange', onHashChange);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    graphicsAvailable = false;
    input.pause();
    hud.showError('The graphics connection was lost. Reload this page to restart the room.');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  let frameId = 0;
  function frame(timestamp: number) {
    const state = input.read();
    const playerDead = mode === 'maze' ? mazeRun.crushedBy !== null : mode === 'generated' ? (generatedRun ? isDead(generatedRun) : false)
      : mode === 'junction' && run.crushedBy !== null;
    stepper.advance(timestamp, graphicsAvailable && !document.hidden && (state.active || playerDead));
    const player = mode === 'room' ? roomPlayer : mode === 'maze' ? mazeRun.player : generatedRun ? generatedRun.player : run.player;
    if (graphicsAvailable) {
      const gates = generatedRun ? { ...generatedRun.shift, closing: generatedRun.shift.plan?.close ?? null }
        : mode === 'maze' ? { ...mazeRun.shift, closing: MAZE_GATE_IDS.find((id) => id !== mazeRun.shift.target)! } : undefined;
      const live = generatedRun;
      scene.render(player, state.yaw, state.pitch, run.junction, gates, live && world ? {
        carried: live.carrying, beams: live.rules.beams, night: nightFactor(live.rules, live.runTicks), chalk: live.chalk,
        openness: live.shift.openness, sounds: live.sounds, traps: live.traps, time: live.tick / 60 } : undefined);
      // Read-only audio diagnostics for tests and bug reports.
      if (scene.audio) {
        document.documentElement.dataset.audioState = scene.audio.state;
        document.documentElement.dataset.soundsPlayed = String(scene.audio.played);
        document.documentElement.dataset.soundsQueued = String((live?.nextSoundId ?? 1) - 1);
      }
    }
    hud.updatePosition(player, timestamp);
    if (mode === 'junction') hud.updateJunction(run.junction, timestamp, run.pushedBy);
    if (mode === 'maze') hud.updateMaze(mazeRun, timestamp);
    if (generatedRun) hud.updateGenerated(generatedRun, timestamp, relicInReach(world!, generatedRun), input.isChalkOut());
    debug?.update(debugView(), timestamp);
    frameId = requestAnimationFrame(frame);
  }
  frameId = requestAnimationFrame(frame);

  function dispose() {
    cancelAnimationFrame(frameId);
    hud.button.removeEventListener('click', onStart);
    hud.retrySeed?.removeEventListener('click', onRetrySeed);
    window.removeEventListener('hashchange', onHashChange);
    hud.volume?.removeEventListener('input', onVolume);
    hud.mute?.removeEventListener('change', onMute);
    hud.abandon?.removeEventListener('click', onAbandon);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    input.dispose();
    debug?.dispose();
    scene.dispose();
  }
  import.meta.hot?.dispose(dispose);
}

startRoom();
