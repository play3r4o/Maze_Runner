import { AudioListener, Object3D, PositionalAudio } from 'three';
import type { Camera, Scene } from 'three';
import type { SoundEvent } from '../game/pressure';

// T3 directional sound. Consumes the simulation's SoundEvent list and plays each new id once,
// positioned in the world. All sounds are generated in code; no audio files, no occlusion.
// Audio only presents state; nothing here feeds back into the game.
const MAX_VOICES = 12;
// How far each kind carries: distance at which it is at full volume (inverse distance falloff).
const REF_DISTANCE = { shiftWarning: 8, gateGrind: 8, bellToll: 40 } as const;

export function createAudio(scene: Scene, camera: Camera) {
  const listener = new AudioListener();
  camera.add(listener);
  const context = listener.context;
  let lastId = 0;
  let volume = 0.8;
  let muted = false;
  let played = 0;
  const voices = new Set<{ audio: PositionalAudio; holder: Object3D }>();

  function buffer(seconds: number, fill: (t: number, i: number) => number) {
    const rate = context.sampleRate;
    const data = context.createBuffer(1, Math.max(1, Math.floor(seconds * rate)), rate);
    const channel = data.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = fill(i / rate, i);
    return data;
  }
  const envelope = (t: number, length: number, attack = 0.01) => Math.min(1, t / attack) * Math.max(0, 1 - t / length);
  // Two quick falling tones: a gate is about to move.
  const warning = () => buffer(0.5, (t) => {
    const tone = t < 0.22 ? 880 : t > 0.26 ? 660 : 0;
    return tone ? 0.5 * Math.sin(2 * Math.PI * tone * t) * envelope(t % 0.24, 0.24) : 0;
  });
  // Low rumbling noise for a moving slab, as long as the movement.
  function grind(seconds: number) {
    let brown = 0;
    return buffer(seconds, (t) => {
      brown = (brown + 0.02 * (Math.random() * 2 - 1)) * 0.995;
      const pulse = 0.7 + 0.3 * Math.sin(2 * Math.PI * 7 * t);
      return 3.5 * brown * pulse * Math.min(1, t / 0.15) * Math.min(1, (seconds - t) / 0.3);
    });
  }
  // A bell: inharmonic partials with a long decay, struck 1, 2 or 3 times.
  function bell(strikes: number) {
    const gap = 1.4, ring = 3.5;
    const partials = [[196, 1], [470, 0.5], [588, 0.35], [823, 0.2]];
    return buffer(gap * (strikes - 1) + ring, (t) => {
      let sum = 0;
      for (let s = 0; s < strikes; s++) {
        const local = t - s * gap;
        if (local < 0 || local > ring) continue;
        for (const [frequency, gain] of partials) sum += gain * Math.sin(2 * Math.PI * frequency * local) * Math.exp(-local * (1.1 + frequency / 600));
      }
      return 0.35 * sum * Math.min(1, t / 0.005);
    });
  }
  const warningBuffer = warning();

  function play(sound: SoundEvent) {
    if (voices.size >= MAX_VOICES) return;
    const data = sound.kind === 'shiftWarning' ? warningBuffer : sound.kind === 'gateGrind' ? grind(sound.seconds ?? 1) : bell(sound.strikes ?? 1);
    const holder = new Object3D();
    holder.position.set(sound.x, 1.5, sound.z);
    const audio = new PositionalAudio(listener);
    audio.setBuffer(data);
    audio.setRefDistance(REF_DISTANCE[sound.kind]);
    audio.setRolloffFactor(1);
    holder.add(audio);
    scene.add(holder);
    const voice = { audio, holder };
    voices.add(voice);
    audio.onEnded = () => release(voice);
    audio.play();
    played++;
  }
  function release(voice: { audio: PositionalAudio; holder: Object3D }) {
    if (!voices.delete(voice)) return;
    try { voice.audio.stop(); } catch { /* already ended */ }
    voice.holder.remove(voice.audio);
    scene.remove(voice.holder);
    voice.audio.disconnect();
  }
  const applyVolume = () => listener.setMasterVolume(muted ? 0 : volume);
  applyVolume();

  return {
    // Must run inside a user gesture (the click that requests pointer lock).
    resume() { if (context.state !== 'running') void context.resume().catch(() => undefined); },
    // Plays sounds with ids not played yet. Sounds that arrive while suspended are skipped.
    update(sounds: readonly SoundEvent[]) {
      for (const sound of sounds) {
        if (sound.id <= lastId) continue;
        lastId = sound.id;
        if (context.state === 'running') play(sound);
      }
    },
    // A new run restarts sound ids from 1.
    reset() { lastId = 0; for (const voice of [...voices]) release(voice); },
    setVolume(value: number) { volume = Math.max(0, Math.min(1, value)); applyVolume(); },
    setMuted(value: boolean) { muted = value; applyVolume(); },
    get played() { return played; },
    get state() { return context.state; },
    dispose() {
      for (const voice of [...voices]) release(voice);
      camera.remove(listener);
      void context.close().catch(() => undefined);
    },
  };
}
