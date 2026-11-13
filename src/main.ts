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
import { GENERATOR_VERSION, MAX_SEED, generateMaze, layoutFingerprint, parseSeed, serializeMaze } from './simulation/mazeGenerator';
import { OCTAGON_VERSION, generateOctagon } from './simulation/octagon';
import { abandonGeneratedRun, drawChalk, isDead, setRule, buildGeneratedWorld, createGeneratedRun, isRunOver,
  requestGeneratedRunShift, setGeneratedRunFrozen, stepGeneratedRun, teleportGeneratedRun } from './game/generatedRun';
import { createRunReport, parseRunReport, reproduceRun } from './game/runReport';
import { ALL_RULES_ON, RULE_KEYS, autoShiftTicks, isNight, nextBellTick, nightFactor, unrestOf } from './game/pressure';
import type { RuleKey, RuleToggles } from './game/pressure';
import { CROSSBOW_RELOAD, MATCH, dailySeed } from './game/tuning';
import { closeLoot, containerInReach, dropFromBag, interactGeneratedRun, lootMove, lootQuickMove, openContainerOf } from './game/looting';
import { coreExtractActive, startMatch, useConsumable, activeWeapon, attackGeneratedRun, hasSpool, jamGate, jamTarget, setBlocking, swapHands, toggleThread, withBag, withEquipment } from './game/generatedRun';
import { equipItem, isGear, maxHealthOf, statsOf, unequipItem } from './game/equipment';
import { lootEquip, lootUnequip, smartSlot } from './game/looting';
import { TRADERS, buyFrom, buyPrice, marketFor, sellTo, traderBuys } from './game/traders';
import type { SellFrom, TraderId, Wallet } from './game/traders';
import { TRADER_GRID } from './game/tuning';
import { moveBetween, quickMove } from './game/inventory';
import { BAG_SIZE, STASH_SIZE } from './game/tuning';
import { clearProfile, emptyProfile, finishedRun, loadProfile, saveProfile, startedRun, traceFor, withTrace } from './storage/save';
import { itemDef } from './game/items';
import type { Profile } from './storage/save';
import { createInventoryUI } from './ui/inventory';
import type { GridKey, InventoryView } from './ui/inventory';
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
document.title = `Shifting Labyrinth · ${{ generated: 'M18', maze: 'M3', junction: 'M1', room: 'M0' }[mode]}`;
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
// M18: the Octagon is the default; `?layout=square` keeps the M4–M17 square maze. A bug report
// in the address picks the layout it was made on.
const reproVersion = (() => { try { return JSON.parse(decodeURIComponent(location.hash.slice('#repro='.length))).version as string; } catch { return null; } })();
const layoutKind = reproVersion === GENERATOR_VERSION || (reproVersion !== OCTAGON_VERSION && params.get('layout') === 'square') ? 'square' : 'octagon';
const world = mode === 'generated' ? buildGeneratedWorld(layoutKind === 'square' ? generateMaze(seed) : generateOctagon(seed)) : null;
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

// M8 profile: the bag carried between runs, the stash and the run counter (local storage).
const loaded = world ? loadProfile() : null;
let profile: Profile | null = loaded?.profile ?? null;
const storeProfile = (next: Profile) => { profile = next; saveProfile(next); };

const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const hud = createHud(hudRoot, mode, world?.maze);
if (loaded?.notice) { hud.setMode(false, loaded.notice); if (profile) saveProfile(profile); }
if (world && requestedSeed !== null && parsedSeed === null) {
  hud.setMode(false, `Seed “${requestedSeed}” is not a whole number from 0 to ${MAX_SEED}. Using random seed ${seed}.`);
}
const debug = mode === 'maze' ? createMazeDebug(hudRoot)
  : world ? createMazeDebug(hudRoot, { layout: world.maze, walls: world.walls, rings: world.maze.rings, entrances: world.maze.entrances, ringNames: world.maze.ringNames,
    seed: { seed, version: world.maze.version, fingerprint: layoutFingerprint(world.maze),
      onLoad: (value) => location.assign(seedUrl(value)), onRandom: () => location.assign(seedUrl(randomSeed())) },
    tools: {
      config: `${world.maze.homeGate ? 'octagon · ' : ''}${world.maze.config.size}×${world.maze.config.size} · loops ${world.maze.config.loopChance} · ${world.maze.config.gateCount} gates`,
      teleports: [{ label: 'Sanctuary', cell: world.maze.start },
        ...world.maze.landmarks.map((landmark) => ({ label: landmark.name.split(' ')[0], cell: landmark.cell }))],
      rules: RULE_KEYS, onRule: (key, on) => debugTools?.onRule?.(key, on) ?? '', traps: world.traps,
      onFreeze: () => debugTools?.onFreeze() ?? '', onTeleport: (cell) => debugTools?.onTeleport(cell) ?? '',
      onCopyReport: () => debugTools?.onCopyReport() ?? '', onClearSave: () => debugTools?.onClearSave?.() ?? '', onLoadReport: (text) => debugTools?.onLoadReport(text) ?? '',
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
  const runStart = () => ({ runNumber: profile!.runs + 1, bag: profile!.bag, equipment: profile!.equipment, starterKit: true });
  let generatedRun: GeneratedRun | null = world ? createGeneratedRun(world, initialRules, runStart()) : null;
  // Only runs started from the profile write back to it (a loaded bug report does not).
  let profileRun = Boolean(world);
  // T8: the cairn and faded chalk of the last death on this seed (fixed for this page).
  const activeTrace = world && profile ? traceFor(profile, world.maze.seed, world.maze.version) : null;
  // Profile bookkeeping when a run starts (bag at risk) and ends (kept only if extracted).
  function trackProfile(before: GeneratedRun, after: GeneratedRun) {
    if (!profile || !profileRun) return;
    if (before.status === 'ready' && after.status !== 'ready' && !isRunOver(after.status)) storeProfile(startedRun(profile, after.runNumber));
    else if (before.status === 'ready' && !isRunOver(after.status) && (before.bag !== after.bag || before.equipment !== after.equipment)) storeProfile({ ...profile, bag: after.bag, equipment: after.equipment });
    if (!isRunOver(before.status) && isRunOver(after.status)) {
      if (before.status === 'ready') storeProfile({ ...profile, runs: Math.max(profile.runs, after.runNumber) });
      storeProfile(finishedRun(profile, after.status === 'extracted', after.bag, after.equipment));
      storeProfile({ ...profile, market: marketFor(profile.market, profile.runs) });
      // T8: dying leaves a cairn and this run's chalk for the next run of the same seed.
      if (after.status === 'failed' && world) {
        storeProfile(withTrace(profile, { seed: world.maze.seed, version: world.maze.version, x: after.player.x, z: after.player.z, chalk: after.chalk }));
      }
    }
  }
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
      thread: generatedRun.thread, cairn: activeTrace ? { x: activeTrace.x, z: activeTrace.z } : null,
      containers: generatedRun.containers.map((c) => ({ x: c.x, z: c.z, kind: c.kind, items: c.items.length, opened: c.opened })),
      monsters: generatedRun.rules.monsters ? generatedRun.monsters.map((m) => ({ x: m.x, z: m.z, kind: m.kind, mode: m.mode, stunned: m.stun > 0 })) : [],
      // Chalk strokes for the map, top-down, with gate drawings at their slab's current offset.
      chalk: generatedRun.chalk.map((stroke) => stroke.points.map((point) => { const [x, , z] = shownPoint(world.maze, generatedRun!.shift.openness, stroke, point); return { x, z }; })),
      run: (() => {
        const r = generatedRun;
        const interval = autoShiftTicks(r.rules, r.bag, r.runTicks);
        const bell = nextBellTick(r.runTicks);
        return `Run ${r.status}${r.carrying ? ' · carrying relic' : ''} · relic ${world.relic.cell} · unrest ${unrestOf(r.rules, r.bag)}`
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
      if (input.consumeInteractRequest()) {
        next = world.maze.homeGate && next.status === 'ready' ? startMatch(world, next) : interactGeneratedRun(next);
        if (next.openContainer && !input.isPanelOpen()) { input.openPanel(); stashMode = false; inventory.open(inventoryView(next)); }
      }
      next = drawChalk(world, { ...next, player: { ...next.player, yaw: state.yaw } }, state.pitch, input.isChalkHeld());
      if (input.consumeThreadRequest()) next = toggleThread(next);
      if (input.consumeJamRequest() && next.bag.length) next = jamGate(world, next, next.bag[next.bag.length - 1].uid);
      next = setBlocking(next, input.isBlockHeld());
      if (input.consumeSwapRequest()) next = swapHands(next);
      const use = input.consumeUseRequest();
      if (use) next = useConsumable(next, use);
      if (input.consumeFireRequest()) next = attackGeneratedRun(world, { ...next, player: { ...next.player, yaw: state.yaw } });
      if (shiftRequested) {
        next = requestGeneratedRunShift(world, next);
        const entry = next.shift.log.at(-1);
        if (entry && entry !== generatedRun!.shift.log.at(-1)) console.info('Maze shift', { seed, ...entry });
      }
      const before = generatedRun!;
      generatedRun = next = stepGeneratedRun(world, next, state.intent, state.yaw, dt);
      trackProfile(before, next);
      if (!wasOver && isRunOver(next.status)) {
        closeInventory(false);
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
  input.setPanelHandler((key) => {
    if (key === 'rotate') inventory.rotate();
    else if (key === 'close') closeInventory(true);
    else if (key === 'paused') closeInventory(false);
    else if (key === 'jam' && generatedRun && world) {
      const uid = inventory.hoveredBagItem ?? generatedRun.bag.at(-1)?.uid;
      if (uid) generatedRun = jamGate(world, generatedRun, uid);
    }
    else if (key === 'bag' && generatedRun && !isDead(generatedRun) && !isRunOver(generatedRun.status)) {
      // Tab: the bag; in Sanctuary before leaving, the bag beside the stash.
      stashMode = generatedRun.status === 'ready';
      baseTab = 'stash';
      input.openPanel();
      inventory.open(inventoryView(generatedRun));
    }
  });
  // M16: what the first-person hands hold.
  const MODEL_OF: Record<string, string> = { rustySword: 'sword', shortsword: 'sword', dagger: 'dagger', mace: 'mace', battleAxe: 'axe', spear: 'spear', crossbow: 'crossbow', buckler: 'buckler', heaterShield: 'heater' };
  function heldState(run: GeneratedRun) {
    const main = run.equipment.mainHand ? MODEL_OF[run.equipment.mainHand.item] ?? null : null;
    const off = run.equipment.offHand ? MODEL_OF[run.equipment.offHand.item] ?? null : null;
    const swingTicks = run.swing ? run.tick - run.swing.tick : Infinity;
    return { shown: !input.isChalkOut() && !isDead(run) && !isRunOver(run.status), main, off,
      active: run.activeHand, swing: Math.min(1, swingTicks / 18), blocking: run.blocking,
      loaded: run.boltsLeft > 0 && run.reload <= 0, recoil: Math.min(1, run.reload / CROSSBOW_RELOAD) };
  }
  // M8 bag, loot and stash screens. The pointer is released; the maze keeps running.
  let stashMode = false;
  // M16 base screen tab: the stash or a trader.
  let baseTab: 'stash' | TraderId = 'stash';
  // Trading works on the profile (gold, stash, market) and the run's bag and gear at the base.
  function trade(change: (wallet: Wallet) => Wallet | null) {
    if (!generatedRun || !profile || generatedRun.status !== 'ready') return;
    const wallet: Wallet = { gold: profile.gold, stash: profile.stash, bag: generatedRun.bag, equipment: generatedRun.equipment, market: marketFor(profile.market, profile.runs) };
    const next = change(wallet);
    if (!next) return;
    generatedRun = withEquipment(withBag(generatedRun, next.bag), next.equipment);
    storeProfile({ ...profile, gold: next.gold, stash: next.stash, bag: next.bag, equipment: next.equipment, market: next.market });
  }
  const sellNow = (from: SellFrom) => { if (baseTab !== 'stash') trade((w) => sellTo(w, baseTab as TraderId, from)); };
  const KIND_TITLES: Record<string, string> = { chest: 'Chest', remains: 'Remains', reliquary: 'Reliquary', sack: 'Dropped sack' };
  function inventoryView(run: GeneratedRun): InventoryView {
    const open = openContainerOf(run);
    const trader = stashMode && profile && baseTab !== 'stash' ? TRADERS.find((item) => item.id === baseTab)! : null;
    const stock = trader && profile ? marketFor(profile.market, profile.runs).stock[trader.id] : [];
    const left = open ? { key: 'container' as const, title: KIND_TITLES[open.kind] ?? open.kind, size: { width: open.width, height: open.height }, items: open.items }
      : trader ? { key: 'trader' as const, title: trader.name, size: TRADER_GRID, items: stock, prices: Object.fromEntries(stock.map((entry) => [entry.uid, buyPrice(entry)])),
          note: `${trader.buysText} Drag an item here (or right-click it) to sell; right-click or drag stock out to buy into your stash.` }
      : stashMode && profile ? { key: 'stash' as const, title: 'Stash', size: STASH_SIZE, items: profile.stash } : null;
    const base = stashMode && profile ? {
      tabs: [{ id: 'stash', label: 'Stash', active: baseTab === 'stash' }, ...TRADERS.map((item) => ({ id: item.id, label: item.name, active: baseTab === item.id }))],
      gold: profile.gold, showCharacter: !trader, second: trader ? { key: 'stash' as const, title: 'Stash', size: STASH_SIZE, items: profile.stash } : null } : {};
    const weapon = activeWeapon(run);
    const weaponName = weapon.item ? itemDef(weapon.item.item).name : 'Fists';
    const weaponLine = weapon.spec.kind === 'crossbow' ? `${weaponName} · ${run.boltsLeft} bolts` : `${weaponName} · ${Math.round(weapon.spec.damage * (1 + statsOf(run.equipment).damage / 100))} dmg`;
    return { left, bag: run.bag, bagSize: BAG_SIZE, canDrop: run.status === 'out',
      equipment: run.equipment, stats: statsOf(run.equipment), maxHealth: maxHealthOf(run.equipment), weapon: weaponLine, ...base,
      hint: stashMode ? 'Drag between bag and stash · R rotates while dragging · right-click sends across · whatever is in the bag when you leave is at risk'
        : 'Drag to move · R rotates while dragging · right-click sends across · drop zone leaves it on the floor · the maze keeps moving' };
  }
  const inventory = createInventoryUI(document.body, {
    tab(id) { baseTab = id as typeof baseTab; if (generatedRun) inventory.render(inventoryView(generatedRun)); },
    move(from: GridKey, uid, to: GridKey, target) {
      if (!generatedRun || !profile) return;
      if (from === 'trader') { if (to !== 'trader' && baseTab !== 'stash') trade((w) => buyFrom(w, baseTab as TraderId, uid)); return; }
      if (to === 'trader') { if (from === 'bag' || from === 'stash') sellNow({ grid: from, uid }); return; }
      if (from === 'stash' || to === 'stash') {
        if (generatedRun.status !== 'ready') return;
        const sizeOf = (key: GridKey) => (key === 'stash' ? STASH_SIZE : BAG_SIZE);
        const gridOf = (key: GridKey) => (key === 'stash' ? profile!.stash : generatedRun!.bag);
        const moved = moveBetween(gridOf(from), gridOf(to), sizeOf(to), uid, target, from === to);
        if (!moved) return;
        const bag = from === 'bag' ? moved.from : to === 'bag' ? moved.to : generatedRun.bag;
        const stash = from === 'stash' ? moved.from : to === 'stash' ? moved.to : profile.stash;
        generatedRun = withBag(generatedRun, from === to && from === 'bag' ? moved.from : bag);
        storeProfile({ ...profile, bag: generatedRun.bag, stash: from === to && from === 'stash' ? moved.from : stash });
        return;
      }
      const before = generatedRun;
      generatedRun = lootMove(generatedRun, from as 'bag' | 'container', uid, to as 'bag' | 'container', target);
      trackProfile(before, generatedRun);
    },
    equip(from: GridKey, uid, slot) {
      if (!generatedRun || !profile) return;
      if (from === 'stash') {
        if (generatedRun.status !== 'ready') return;
        const result = equipItem(generatedRun.equipment, profile.stash, STASH_SIZE, uid, slot);
        if (!result) return;
        generatedRun = withEquipment(generatedRun, result.equipment);
        storeProfile({ ...profile, stash: result.source, equipment: generatedRun.equipment, bag: generatedRun.bag });
        return;
      }
      const before = generatedRun;
      generatedRun = lootEquip(generatedRun, from as 'bag' | 'container', uid, slot);
      trackProfile(before, generatedRun);
    },
    unequip(slot, to: GridKey, target) {
      if (!generatedRun || !profile) return;
      if (to === 'trader') { sellNow({ grid: 'equipment', slot }); return; }
      if (to === 'stash') {
        if (generatedRun.status !== 'ready') return;
        const result = unequipItem(generatedRun.equipment, slot, profile.stash, STASH_SIZE, target);
        if (!result) return;
        generatedRun = withEquipment(generatedRun, result.equipment);
        storeProfile({ ...profile, stash: result.dest, equipment: generatedRun.equipment, bag: generatedRun.bag });
        return;
      }
      const before = generatedRun;
      generatedRun = lootUnequip(generatedRun, slot, to as 'bag' | 'container', target);
      trackProfile(before, generatedRun);
    },
    quick(from: GridKey, uid) {
      if (!generatedRun || !profile) return;
      // At a trader: right-click stock buys, right-click your own item sells (if they buy it).
      if (from === 'trader') { if (baseTab !== 'stash') trade((w) => buyFrom(w, baseTab as TraderId, uid)); return; }
      if (stashMode && baseTab !== 'stash' && (from === 'bag' || from === 'stash')) {
        const entry = (from === 'bag' ? generatedRun.bag : profile.stash).find((item) => item.uid === uid);
        if (entry && traderBuys(baseTab, entry)) sellNow({ grid: from, uid });
        return;
      }
      // Right-click on gear in the bag equips it.
      const entry = from === 'bag' ? generatedRun.bag.find((item) => item.uid === uid) : null;
      if (entry && isGear(entry.item)) {
        const slot = smartSlot(generatedRun.equipment, entry);
        if (slot) { this.equip('bag', uid, slot); return; }
      }
      if (stashMode && generatedRun.status === 'ready') {
        const moved = from === 'stash' ? quickMove(profile.stash, generatedRun.bag, BAG_SIZE, uid) : quickMove(generatedRun.bag, profile.stash, STASH_SIZE, uid);
        if (!moved) return;
        generatedRun = withBag(generatedRun, from === 'stash' ? moved.to : moved.from);
        storeProfile({ ...profile, bag: generatedRun.bag, stash: from === 'stash' ? moved.from : moved.to });
        return;
      }
      generatedRun = lootQuickMove(generatedRun, from as 'bag' | 'container', uid);
    },
    drop(uid) { if (generatedRun) generatedRun = dropFromBag(generatedRun, uid); },
    close() { closeInventory(true); },
  });
  function closeInventory(relock: boolean) {
    if (!inventory.isOpen) return;
    inventory.close();
    stashMode = false;
    if (generatedRun) generatedRun = closeLoot(generatedRun);
    if (relock) input.closePanel();
  }

  // M7 results: the main button starts a new seed; Retry replays this seed; Abandon ends the run.
  const resetGeneratedRun = () => {
    closeInventory(false);
    profileRun = true;
    generatedRun = createGeneratedRun(world!, generatedRun?.rules ?? initialRules, runStart());
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
    const before = generatedRun;
    generatedRun = abandonGeneratedRun(generatedRun);
    trackProfile(before, generatedRun);
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
    closeInventory(false);
    generatedRun = result.run;
    profileRun = false;
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
    onClearSave() {
      clearProfile();
      profile = emptyProfile();
      resetGeneratedRun();
      return 'Save cleared: empty bag and stash. The run was restarted.';
    },
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
        openness: live.shift.openness, sounds: live.sounds, traps: live.traps, time: live.tick / 60,
        monsters: live.monsters, bolts: live.bolts, globs: live.globs, monstersOn: live.rules.monsters,
        thread: live.thread, trace: activeTrace,
        containers: live.containers, relicHome: live.containers.some((c) => c.kind === 'reliquary' && c.items.length > 0),
        held: heldState(live), torch: live.torch > 0,
        core: { active: coreExtractActive(world, live), progress: Math.min(1, live.match.channel / MATCH.coreSeconds) } } : undefined);
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
    if (generatedRun && inventory.isOpen) inventory.render(inventoryView(generatedRun));
    const reach = generatedRun && !inventory.isOpen ? containerInReach(generatedRun) : null;
    if (generatedRun) hud.updateGenerated(generatedRun, timestamp, reach ? (KIND_TITLES[reach.kind] ?? reach.kind) : null, input.isChalkOut());
    if (generatedRun && world) {
      const gate = jamTarget(world, generatedRun);
      const sacrifice = gate ? (inventory.isOpen && inventory.hoveredBagItem ? generatedRun.bag.find((e) => e.uid === inventory.hoveredBagItem) : generatedRun.bag.at(-1)) : null;
      hud.updateTools(gate && sacrifice ? { gate, item: itemDef(sacrifice.item).name } : null,
        hasSpool(generatedRun) ? { left: generatedRun.threadLeft, laying: generatedRun.laying } : null);
    }
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
