import { AudioListener, Object3D, PositionalAudio } from 'three';
import type { Camera, Scene } from 'three';
import type { SoundEvent, SoundKind } from '../game/pressure';

// T3 directional sound. Consumes the simulation's SoundEvent list and plays each new id once,
// positioned in the world. All sounds are generated in code; no audio files, no occlusion.
// Audio only presents state; nothing here feeds back into the game.
const MAX_VOICES = 12;
// How far each kind carries: distance at which it is at full volume (inverse distance falloff).
const REF_DISTANCE: Record<SoundKind, number> = { shiftWarning: 8, gateGrind: 8, bellToll: 40, trapClick: 4, trapFire: 10, bladeSwish: 5, hurt: 3,
  shot: 3, boltHit: 4, monsterHurt: 5, monsterDie: 7, growl: 6, roar: 16, wardenStep: 9, jingle: 2, gateJam: 8 };

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
  // M12 trap sounds.
  const click = () => buffer(0.08, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.8);
  function burst(seconds: number, brightness: number, gain: number) {
    let low = 0;
    return buffer(seconds, (t) => {
      const white = Math.random() * 2 - 1;
      low += (white - low) * brightness;
      return gain * low * Math.exp(-t * 6 / seconds) * Math.min(1, t / 0.005);
    });
  }
  const darts = () => buffer(1.2, (t) => {
    const local = t % 0.5;
    return local < 0.15 ? (Math.random() * 2 - 1) * 0.5 * Math.sin((Math.PI * local) / 0.15) : 0;
  });
  const swish = () => buffer(0.35, (t) => (Math.random() * 2 - 1) * 0.35 * Math.sin((Math.PI * t) / 0.35));
  const hurt = () => buffer(0.25, (t) => 0.6 * Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 14));
  const clickBuffer = click(), swishBuffer = swish(), hurtBuffer = hurt(), dartsBuffer = darts();
  function trapBuffer(sound: SoundEvent) {
    if (sound.trap === 'boulder') return grind(sound.seconds ?? 2);
    if (sound.trap === 'pit') return grind(1);
    if (sound.trap === 'darts') return dartsBuffer;
    return burst(0.4, 0.6, 0.9); // spears and floor spikes: a sharp metallic burst
  }
  const warningBuffer = warning();
  // M10/M11: crossbow twang, bolt thud, monster voices and the warden's heavy steps.
  const shotBuffer = buffer(0.3, (t) => 0.5 * Math.sin(2 * Math.PI * (320 - 500 * t) * t) * Math.exp(-t * 18) + (Math.random() * 2 - 1) * 0.3 * Math.exp(-t * 60));
  const boltHitBuffer = buffer(0.15, (t) => 0.6 * Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t * 35) + (Math.random() * 2 - 1) * 0.3 * Math.exp(-t * 80));
  const voice = (seconds: number, base: number, wobble: number, rough: number, gain: number) => buffer(seconds, (t) => {
    const f = base * (1 + 0.15 * Math.sin(2 * Math.PI * wobble * t));
    const tone = Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.5 + Math.sin(2 * Math.PI * f * 2 * t) * 0.3;
    return gain * (tone * (1 - rough) + (Math.random() * 2 - 1) * rough) * envelope(t, seconds, 0.05);
  });
  const growlBuffers: Record<string, AudioBuffer> = { husk: voice(0.9, 70, 5, 0.5, 0.35), skitter: voice(0.5, 900, 23, 0.6, 0.2), warden: voice(1.8, 45, 3, 0.4, 0.6) };
  const hurtMonsterBuffers: Record<string, AudioBuffer> = { husk: voice(0.3, 110, 9, 0.4, 0.4), skitter: voice(0.25, 1300, 30, 0.5, 0.25), warden: voice(0.5, 60, 6, 0.4, 0.5) };
  const dieBuffers: Record<string, AudioBuffer> = { husk: voice(1.2, 90, 2, 0.5, 0.4), skitter: voice(0.6, 1100, 12, 0.6, 0.25), warden: voice(2.5, 38, 1.5, 0.45, 0.7) };
  const stepBuffer = buffer(0.25, (t) => 0.9 * Math.sin(2 * Math.PI * 48 * t) * Math.exp(-t * 16) + (Math.random() * 2 - 1) * 0.15 * Math.exp(-t * 40));
  function combatBuffer(sound: SoundEvent): AudioBuffer {
    const kind = sound.monster ?? 'husk';
    if (sound.kind === 'shot') return shotBuffer;
    if (sound.kind === 'boltHit') return boltHitBuffer;
    if (sound.kind === 'wardenStep') return stepBuffer;
    if (sound.kind === 'monsterHurt') return hurtMonsterBuffers[kind];
    if (sound.kind === 'monsterDie') return dieBuffers[kind];
    return growlBuffers[sound.kind === 'roar' ? 'warden' : kind];
  }
  const COMBAT = new Set(['shot', 'boltHit', 'wardenStep', 'monsterHurt', 'monsterDie', 'growl', 'roar']);
  // M8: coins clinking while walking; a gate jammed by a crushed item.
  const jingleBuffer = buffer(0.25, (t) => [2400, 3100, 3700].reduce((sum, f, i) => sum + Math.sin(2 * Math.PI * f * t) * Math.exp(-(t - i * 0.06) * 40) * (t >= i * 0.06 ? 0.12 : 0), 0));
  const jamBuffer = buffer(0.6, (t) => (Math.random() * 2 - 1) * 0.7 * Math.exp(-t * 7) + 0.4 * Math.sin(2 * Math.PI * 70 * t) * Math.exp(-t * 5));

  function play(sound: SoundEvent) {
    if (voices.size >= MAX_VOICES) return;
    const data = sound.kind === 'jingle' ? jingleBuffer : sound.kind === 'gateJam' ? jamBuffer : COMBAT.has(sound.kind) ? combatBuffer(sound) : sound.kind === 'shiftWarning' ? warningBuffer : sound.kind === 'gateGrind' ? grind(sound.seconds ?? 1)
      : sound.kind === 'bellToll' ? bell(sound.strikes ?? 1) : sound.kind === 'trapClick' ? clickBuffer
        : sound.kind === 'bladeSwish' ? swishBuffer : sound.kind === 'hurt' ? hurtBuffer : trapBuffer(sound);
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
