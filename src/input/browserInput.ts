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
  private interactRequested = false;
  // Chalk (developer request 2026-11-12): C takes the chalk out or puts it away; while it is
  // out, holding the left mouse button draws.
  private chalkOut = false;
  private mouseDown = false;
  // M11 crossbow: a left click while the chalk is away fires once.
  private fireRequested = false;
  // M8: the bag or loot screen. The pointer is released but the world keeps running.
  private panelOpen = false;
  private panelHandler: ((key: 'bag' | 'close' | 'rotate' | 'paused') => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onModeChange: (running: boolean, message?: string) => void,
    private readonly onDebugAction?: (action: 'toggle' | 'probe') => void,
  ) {
    const options = { signal: this.events.signal };

    document.addEventListener('keydown', (event) => {
      if (this.onDebugAction && event.code === 'F2') {
        event.preventDefault();
        if (!event.repeat) this.onDebugAction('toggle');
        return;
      }
      if (this.panelOpen) {
        if (event.code === 'Tab' || event.code === 'Escape' || event.code === 'KeyE') {
          event.preventDefault();
          if (!event.repeat) this.panelHandler?.('close');
        } else if (event.code === 'KeyR') {
          event.preventDefault();
          this.panelHandler?.('rotate');
        }
        return;
      }
      if (!this.active) return;
      if (event.code === 'Tab') {
        event.preventDefault();
        if (!event.repeat) this.panelHandler?.('bag');
      } else if (event.code === 'Escape') {
        this.pause();
      } else if (event.code === 'KeyG') {
        event.preventDefault();
        if (!event.repeat) this.shiftRequested = true;
      } else if (event.code === 'KeyE') {
        event.preventDefault();
        if (!event.repeat) this.interactRequested = true;
      } else if (event.code === 'KeyC') {
        event.preventDefault();
        if (!event.repeat) this.chalkOut = !this.chalkOut;
      } else if (event.code === 'KeyV' && this.onDebugAction) {
        event.preventDefault();
        if (!event.repeat) this.onDebugAction('probe');
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

    document.addEventListener('mousedown', (event) => {
      if (this.active && event.button === 0) { this.mouseDown = true; if (!this.chalkOut) this.fireRequested = true; }
    }, options);
    document.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.mouseDown = false;
    }, options);

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas && !document.hidden;
      // Releasing the pointer to open the bag is not a pause.
      if (this.panelOpen && !locked) { this.active = false; this.keys.clear(); this.mouseDown = false; return; }
      this.keys.clear();
      this.shiftRequested = false;
      this.interactRequested = false;
      this.mouseDown = false;
      this.fireRequested = false;
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
    if (this.panelOpen) { this.panelOpen = false; this.panelHandler?.('paused'); }
    this.active = false;
    this.keys.clear();
    this.shiftRequested = false;
    this.interactRequested = false;
    this.mouseDown = false;
    this.fireRequested = false;
    this.onModeChange(false, message);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  read(): { active: boolean; yaw: number; pitch: number; intent: MoveIntent } {
    const panel = this.panelOpen;
    return {
      active: this.active || panel,
      yaw: this.yaw,
      pitch: this.pitch,
      intent: {
        forward: panel ? 0 : Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
        strafe: panel ? 0 : Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      },
    };
  }

  // True while the chalk is out and the left mouse button is held.
  isChalkHeld(): boolean {
    return this.active && this.chalkOut && this.mouseDown;
  }
  isChalkOut(): boolean {
    return this.chalkOut;
  }
  // A new run starts with the chalk put away.
  putChalkAway() {
    this.chalkOut = false;
  }

  setPanelHandler(handler: (key: 'bag' | 'close' | 'rotate' | 'paused') => void) { this.panelHandler = handler; }
  isPanelOpen(): boolean { return this.panelOpen; }
  // Open the bag or loot screen: release the pointer without pausing.
  openPanel() {
    if (this.panelOpen || !this.active) return;
    this.panelOpen = true;
    this.keys.clear(); this.mouseDown = false; this.fireRequested = false; this.interactRequested = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  // Close it and take the pointer again (inside the key or click that closed it).
  closePanel() {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    void this.start();
  }

  consumeFireRequest(): boolean {
    const requested = this.fireRequested;
    this.fireRequested = false;
    return requested;
  }

  consumeInteractRequest(): boolean {
    const requested = this.active && this.interactRequested;
    this.interactRequested = false;
    return requested;
  }

  consumeShiftRequest(): boolean {
    const requested = this.active && this.shiftRequested;
    this.shiftRequested = false;
    return requested;
  }

  // Restore a recorded view direction (debug bug-report reproduction).
  setLook(yaw: number, pitch = 0) {
    this.yaw = yaw;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
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
