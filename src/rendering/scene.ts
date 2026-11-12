import {
  BoxGeometry, CanvasTexture, Color, DirectionalLight, DoubleSide, GridHelper, HemisphereLight,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { EYE_HEIGHT } from '../simulation/player';
import type { PlayerState } from '../simulation/player';
import { ROOM_SIZE, ROOM_WALLS } from '../simulation/room';
import { GATE_IDS, gateRect, JUNCTION_SIZE, JUNCTION_WALLS, openGatesFor } from '../simulation/junction';
import type { JunctionState } from '../simulation/shift';
import { MAZE_SIZE, mazeExtent } from '../simulation/maze';
import type { GeneratedWorld } from '../game/generatedRun';
import { createMazeView } from './mazeView';
import type { GateView } from './mazeView';
import { createAudio } from './audio';
import { createTrapView } from './trapView';
import { createMonsterView } from './monsterView';
import { createContainerView } from './containerView';
import type { Container } from '../game/loot';
import type { Bolt, Monster } from '../game/monsters';
import type { TrapState } from '../game/traps';
import type { SoundEvent } from '../game/pressure';
import type { ChalkStroke } from '../game/chalk';
import type { MazeOpenness } from '../simulation/maze';

// Per-frame expedition state the view presents (generated maze only).
export type ExpeditionView = { carried: boolean; beams: boolean; night: number; chalk: readonly ChalkStroke[];
  openness: MazeOpenness; sounds: readonly SoundEvent[]; traps: readonly TrapState[]; time: number;
  monsters: readonly Monster[]; bolts: readonly Bolt[]; monstersOn: boolean; containers: readonly Container[]; relicHome: boolean; bow: { shown: boolean; ready: boolean; recoil: number } };

export type SceneMode = 'room' | 'junction' | 'maze' | 'generated';
export function createScene(canvas: HTMLCanvasElement, mode: SceneMode, generated?: GeneratedWorld) {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  const scene = new Scene();
  scene.background = new Color('#a8b3b0');
  const generatedSize = generated ? mazeExtent(generated.maze).width : 0;
  const camera = new PerspectiveCamera(75, 1, 0.05, Math.max(150, generatedSize * 1.5));
  camera.rotation.order = 'YXZ';

  const sky = new HemisphereLight('#edf3ed', '#535b55', 2.5);
  scene.add(sky);
  const sun = new DirectionalLight('#fff5df', 2);
  sun.position.set(5, 9, 6);
  scene.add(sun);

  const floorMaterial = new MeshStandardMaterial({ color: '#68746e', roughness: 1 });
  const wallMaterial = new MeshStandardMaterial({ color: '#929c94', roughness: 1 });
  const blockMaterial = new MeshStandardMaterial({ color: '#69776f', roughness: 1 });
  const floorSize = mode === 'room' ? ROOM_SIZE : mode === 'maze' ? MAZE_SIZE : mode === 'generated' ? generatedSize : JUNCTION_SIZE;
  const floor = new Mesh(new PlaneGeometry(floorSize, floorSize), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new GridHelper(floorSize, floorSize, '#53635c', '#5f6e66');
  grid.position.y = 0.005;
  scene.add(grid);

  const wallMeshes = (mode === 'room' ? ROOM_WALLS : mode === 'junction' ? JUNCTION_WALLS : []).map((wall) => {
    const mesh = new Mesh(
      new BoxGeometry(wall.maxX - wall.minX, wall.height, wall.maxZ - wall.minZ),
      wall.id === 'block' ? blockMaterial : wallMaterial,
    );
    mesh.position.set((wall.minX + wall.maxX) / 2, wall.height / 2, (wall.minZ + wall.maxZ) / 2);
    scene.add(mesh);
    return mesh;
  });

  // M7b: positional audio for the generated expedition only.
  const audio = mode === 'generated' ? createAudio(scene, camera) : null;
  const trapView = mode === 'generated' && generated ? createTrapView(scene, generated.traps) : null;
  if (mode === 'generated') scene.add(camera); // so the held crossbow renders
  const monsterView = mode === 'generated' && generated ? createMonsterView(scene, camera, generated.monsters) : null;
  const containerView = mode === 'generated' ? createContainerView(scene) : null;
  const dayBackground = new Color('#a8b3b0'), nightBackground = new Color('#27302f');
  const mazeView = mode === 'maze' ? createMazeView(scene)
    : mode === 'generated' && generated ? createMazeView(scene, generated.maze, generated.walls, generated.relic) : null;
  const gates = mode !== 'junction' ? [] : GATE_IDS.map((id) => {
    const rect = gateRect(id, 0);
    const material = new MeshStandardMaterial({ color: '#ae965f', roughness: 1 });
    const mesh = new Mesh(new BoxGeometry(rect.maxX - rect.minX, rect.height, rect.maxZ - rect.minZ), material);
    scene.add(mesh);

    const northSouth = id === 'north' || id === 'south';
    const safetyMaterial = new MeshBasicMaterial({ color: '#c4ad6e' });
    const length = northSouth ? rect.maxZ - rect.minZ : rect.maxX - rect.minX;
    const stripes = [-length / 2 - 0.45, length / 2 + 0.45].map((offset) => {
      const stripe = new Mesh(new BoxGeometry(northSouth ? 4 : 0.035, 0.012, northSouth ? 0.035 : 4), safetyMaterial);
      stripe.position.set((rect.minX + rect.maxX) / 2 + (northSouth ? 0 : offset), 0.015,
        (rect.minZ + rect.maxZ) / 2 + (northSouth ? offset : 0));
      scene.add(stripe);
      return stripe;
    });
    for (const offset of [-1.95, 1.95]) {
      const stripe = new Mesh(new BoxGeometry(northSouth ? 0.035 : length, 0.012, northSouth ? length : 0.035), safetyMaterial);
      stripe.position.set((rect.minX + rect.maxX) / 2 + (northSouth ? offset : 0), 0.015,
        (rect.minZ + rect.maxZ) / 2 + (northSouth ? 0 : offset));
      scene.add(stripe);
      stripes.push(stripe);
    }

    // Geometric debug signs keep the junction readable without external assets.
    const label = document.createElement('canvas');
    label.width = 512;
    label.height = 128;
    const context = label.getContext('2d')!;
    context.fillStyle = '#452b26';
    context.fillRect(0, 0, 512, 128);
    context.fillStyle = '#eee5ca';
    context.font = 'bold 40px monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(id.toUpperCase(), 256, 45);
    context.font = '24px monospace';
    context.fillText('8m / CRUSH ZONE', 256, 96);
    const texture = new CanvasTexture(label);
    texture.colorSpace = SRGBColorSpace;
    const signMaterial = new MeshBasicMaterial({ map: texture, side: DoubleSide });
    const sign = new Mesh(new PlaneGeometry(2, 0.6), signMaterial);
    sign.position.set(northSouth ? 0 : id === 'east' ? rect.minX - 0.05 : rect.maxX + 0.05, 3.4,
      northSouth ? id === 'north' ? rect.maxZ + 0.05 : rect.minZ - 0.05 : 0);
    sign.rotation.y = id === 'east' ? -Math.PI / 2 : id === 'west' ? Math.PI / 2 : id === 'south' ? Math.PI : 0;
    scene.add(sign);
    return { id, mesh, material, stripes, safetyMaterial, sign, signMaterial, texture };
  });

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    audio,
    render(player: PlayerState, yaw: number, pitch: number, junction: JunctionState, maze?: GateView, expedition?: ExpeditionView) {
      mazeView?.update(maze);
      if (expedition) {
        mazeView?.setRelic(!expedition.relicHome, performance.now() / 1000, expedition.beams);
        containerView?.update(expedition.containers);
        mazeView?.setChalk(expedition.chalk, expedition.openness);
        audio?.update(expedition.sounds);
        trapView?.update(expedition.traps, expedition.time);
        monsterView?.update(expedition.monsters, expedition.bolts, expedition.monstersOn, expedition.time, expedition.bow);
        // Night (T2): dim the light and darken the sky over the fade. Presentation only.
        const night = expedition.night;
        sky.intensity = 2.5 - 1.7 * night; sun.intensity = 2 - 1.6 * night;
        (scene.background as Color).copy(dayBackground).lerp(nightBackground, night);
      }
      for (const gate of gates) {
        const rect = gateRect(gate.id, junction.openness[gate.id]);
        gate.mesh.position.set((rect.minX + rect.maxX) / 2, rect.height / 2, (rect.minZ + rect.maxZ) / 2);
        const closing = !openGatesFor(junction.target).includes(gate.id);
        const warning = junction.phase === 'warning';
        const lethal = closing && junction.phase === 'closing';
        const color = lethal ? '#c17a59' : warning ? '#e6bf62' : '#ae965f';
        gate.material.color.set(color);
        gate.safetyMaterial.color.set(closing && (warning || lethal) ? '#e67758' : '#c4ad6e');
        gate.material.emissive.set(warning ? '#5b420b' : '#000000');
        gate.material.emissiveIntensity = warning ? 0.4 + 0.3 * Math.sin(junction.phaseSeconds * 10) : 0;
      }
      camera.position.set(player.x, EYE_HEIGHT, player.z);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', resize);
      mazeView?.dispose();
      audio?.dispose();
      trapView?.dispose();
      monsterView?.dispose();
      containerView?.dispose();
      for (const mesh of wallMeshes) mesh.geometry.dispose();
      floor.geometry.dispose();
      grid.geometry.dispose();
      const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
      for (const material of gridMaterials) material.dispose();
      for (const gate of gates) {
        gate.mesh.geometry.dispose();
        gate.material.dispose();
        for (const stripe of gate.stripes) stripe.geometry.dispose();
        gate.safetyMaterial.dispose();
        gate.sign.geometry.dispose();
        gate.signMaterial.dispose();
        gate.texture.dispose();
      }
      floorMaterial.dispose();
      wallMaterial.dispose();
      blockMaterial.dispose();
      renderer.dispose();
    },
  };
}
