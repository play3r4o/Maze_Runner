import type { MoveIntent } from '../simulation/player';

const SENSITIVITY = 0.002;
const MAX_PITCH = 85 * Math.PI / 180;
const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD']);

export class BrowserInput {
  private readonly keys = new Set<string>();
  private readonly events = new AbortController();
  private active = false;
  private yaw = 0;
  private pitch = 0;
  private shiftRequested = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onModeChange: (running: boolean, message?: string) => void,
  ) {
    const options = { signal: this.events.signal };

    document.addEventListener('keydown', (event) => {
      if (!this.active) return;
      if (event.code === 'Escape') {
        this.pause();
      } else if (event.code === 'KeyG') {
        event.preventDefault();
        if (!event.repeat) this.shiftRequested = true;
      } else if (MOVEMENT_KEYS.has(event.code)) {
        event.preventDefault();
        this.keys.add(event.code);
      }
    }, options);

    document.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (this.active && MOVEMENT_KEYS.has(event.code)) event.preventDefault();
    }, options);

    document.addEventListener('mousemove', (event) => {
      if (!this.active) return;
      this.yaw -= event.movementX * SENSITIVITY;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - event.movementY * SENSITIVITY));
    }, options);

    document.addEventListener('pointerlockchange', () => {
      this.keys.clear();
      this.shiftRequested = false;
      this.active = document.pointerLockElement === canvas && !document.hidden;
      this.onModeChange(this.active);
    }, options);

    document.addEventListener('pointerlockerror', () => {
      this.pause('Mouse capture was blocked. Click Start or Resume to try again.');
    }, options);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    }, options);
    window.addEventListener('blur', () => this.pause(), options);
  }

  async start() {
    if (typeof this.canvas.requestPointerLock !== 'function') {
      this.pause('This browser does not support mouse capture. Try a current desktop Chrome or Firefox.');
      return;
    }
    try {
      await this.canvas.requestPointerLock();
    } catch {
      this.pause('Mouse capture was blocked. Click Start or Resume to try again.');
    }
  }

  pause(message?: string) {
    this.active = false;
    this.keys.clear();
    this.shiftRequested = false;
    this.onModeChange(false, message);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  read(): { active: boolean; yaw: number; pitch: number; intent: MoveIntent } {
    return {
      active: this.active,
      yaw: this.yaw,
      pitch: this.pitch,
      intent: {
        forward: Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
        strafe: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      },
    };
  }

  consumeShiftRequest(): boolean {
    const requested = this.active && this.shiftRequested;
    this.shiftRequested = false;
    return requested;
  }

  resetLook() {
    this.yaw = 0;
    this.pitch = 0;
  }

  dispose() {
    this.pause();
    this.events.abort();
  }
}
