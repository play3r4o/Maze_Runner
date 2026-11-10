import './style.css';
import { BrowserInput } from './input/browserInput';
import { createFixedStepper } from './loop';
import { createScene } from './rendering/scene';
import { stepPlayer } from './simulation/player';
import { PLAYER_SPAWN, ROOM_WALLS } from './simulation/room';
import { createHud } from './ui/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const hud = createHud(document.querySelector<HTMLElement>('#hud')!);

function startRoom() {
  let scene: ReturnType<typeof createScene>;
  try {
    scene = createScene(canvas);
  } catch {
    hud.showError('WebGL 2 could not start. Enable hardware acceleration or try a current desktop browser, then reload.');
    return;
  }

  let player = { ...PLAYER_SPAWN };
  const stepper = createFixedStepper((dt) => {
    const state = input.read();
    player = stepPlayer({ ...player, yaw: state.yaw }, state.intent, ROOM_WALLS, dt);
  });
  const input = new BrowserInput(canvas, (running, message) => {
    stepper.reset();
    hud.setMode(running, message);
  });
  const onStart = () => { void input.start(); };
  hud.button.addEventListener('click', onStart);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    input.pause();
    hud.showError('The graphics connection was lost. Reload this page to restart the room.');
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  let frameId = 0;
  function frame(timestamp: number) {
    const state = input.read();
    stepper.advance(timestamp, state.active);
    if (document.querySelector('#hud')?.getAttribute('data-state') !== 'error') {
      scene.render(player, state.yaw, state.pitch);
    }
    hud.updatePosition(player, timestamp);
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
