import './style.css';
import { BrowserInput } from './input/browserInput';
import { createFixedStepper } from './loop';
import { createScene } from './rendering/scene';
import { stepPlayer } from './simulation/player';
import { PLAYER_SPAWN, ROOM_WALLS } from './simulation/room';
import { createJunctionRun, requestRunShift, stepJunctionRun } from './game/junctionRun';
import { createHud } from './ui/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const mode = new URLSearchParams(location.search).get('scene') === 'room' ? 'room' : 'junction';
const hud = createHud(document.querySelector<HTMLElement>('#hud')!, mode);

function startRoom() {
  let scene: ReturnType<typeof createScene>;
  try {
    scene = createScene(canvas, mode);
  } catch {
    hud.showError('WebGL 2 could not start. Enable hardware acceleration or try a current desktop browser, then reload.');
    return;
  }

  let roomPlayer = { ...PLAYER_SPAWN };
  let run = createJunctionRun();
  let graphicsAvailable = true;
  const stepper = createFixedStepper((dt) => {
    const state = input.read();
    const shiftRequested = input.consumeShiftRequest();
    if (mode === 'junction') {
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
  const input = new BrowserInput(canvas, (running, message) => {
    stepper.reset();
    hud.setMode(running, message);
  });
  const onStart = () => {
    if (run.crushedBy) {
      run = createJunctionRun();
      input.resetLook();
      stepper.reset();
      hud.resetAttempt();
    }
    void input.start();
  };
  hud.button.addEventListener('click', onStart);

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
    const playerDead = mode === 'junction' && run.crushedBy !== null;
    stepper.advance(timestamp, graphicsAvailable && !document.hidden && (state.active || playerDead));
    const player = mode === 'room' ? roomPlayer : run.player;
    if (graphicsAvailable) {
      scene.render(player, state.yaw, state.pitch, run.junction);
    }
    hud.updatePosition(player, timestamp);
    if (mode === 'junction') hud.updateJunction(run.junction, timestamp);
    frameId = requestAnimationFrame(frame);
  }
  frameId = requestAnimationFrame(frame);

  function dispose() {
    cancelAnimationFrame(frameId);
    hud.button.removeEventListener('click', onStart);
    canvas.removeEventListener('webglcontextlost', onContextLost);
    input.dispose();
    scene.dispose();
  }
  import.meta.hot?.dispose(dispose);
}

startRoom();
