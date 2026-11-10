import {
  BoxGeometry, CanvasTexture, Color, DirectionalLight, DoubleSide, GridHelper, HemisphereLight,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { EYE_HEIGHT } from '../simulation/player';
import type { PlayerState } from '../simulation/player';
import { ROOM_SIZE, ROOM_WALLS } from '../simulation/room';
import { GATE_IDS, gateRect, JUNCTION_WALLS, openGatesFor } from '../simulation/junction';
import type { JunctionState } from '../simulation/shift';

export function createScene(canvas: HTMLCanvasElement, mode: 'room' | 'junction') {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  const scene = new Scene();
  scene.background = new Color('#a8b3b0');
  const camera = new PerspectiveCamera(75, 1, 0.05, 150);
  camera.rotation.order = 'YXZ';

  scene.add(new HemisphereLight('#edf3ed', '#535b55', 2.5));
  const sun = new DirectionalLight('#fff5df', 2);
  sun.position.set(5, 9, 6);
  scene.add(sun);

  const floorMaterial = new MeshStandardMaterial({ color: '#68746e', roughness: 1 });
  const wallMaterial = new MeshStandardMaterial({ color: '#929c94', roughness: 1 });
  const blockMaterial = new MeshStandardMaterial({ color: '#69776f', roughness: 1 });
  const floor = new Mesh(new PlaneGeometry(ROOM_SIZE, ROOM_SIZE), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new GridHelper(ROOM_SIZE, ROOM_SIZE, '#53635c', '#5f6e66');
  grid.position.y = 0.005;
  scene.add(grid);

  const wallMeshes = (mode === 'room' ? ROOM_WALLS : JUNCTION_WALLS).map((wall) => {
    const mesh = new Mesh(
      new BoxGeometry(wall.maxX - wall.minX, wall.height, wall.maxZ - wall.minZ),
      wall.id === 'block' ? blockMaterial : wallMaterial,
    );
    mesh.position.set((wall.minX + wall.maxX) / 2, wall.height / 2, (wall.minZ + wall.maxZ) / 2);
    scene.add(mesh);
    return mesh;
  });

  const gates = mode === 'room' ? [] : GATE_IDS.map((id) => {
    const rect = gateRect(id, 0);
    const material = new MeshStandardMaterial({ color: '#ae965f', roughness: 1 });
    const mesh = new Mesh(new BoxGeometry(rect.maxX - rect.minX, rect.height, rect.maxZ - rect.minZ), material);
    scene.add(mesh);

    const northSouth = id === 'north' || id === 'south';
    const safetyMaterial = new MeshBasicMaterial({ color: '#c4ad6e' });
    const stripes = [-0.7, 0.7].map((offset) => {
      const stripe = new Mesh(new BoxGeometry(northSouth ? 4 : 0.035, 0.012, northSouth ? 0.035 : 4), safetyMaterial);
      stripe.position.set((rect.minX + rect.maxX) / 2 + (northSouth ? 0 : offset), 0.015,
        (rect.minZ + rect.maxZ) / 2 + (northSouth ? offset : 0));
      scene.add(stripe);
      return stripe;
    });

    // Geometric debug signs keep the junction readable without external assets.
    const label = document.createElement('canvas');
    label.width = 256;
    label.height = 64;
    const context = label.getContext('2d')!;
    context.fillStyle = '#24352c';
    context.fillRect(0, 0, 256, 64);
    context.fillStyle = '#eee5ca';
    context.font = 'bold 26px monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(id.toUpperCase(), 128, 32);
    const texture = new CanvasTexture(label);
    texture.colorSpace = SRGBColorSpace;
    const signMaterial = new MeshBasicMaterial({ map: texture, side: DoubleSide });
    const sign = new Mesh(new PlaneGeometry(1.6, 0.4), signMaterial);
    sign.position.set((rect.minX + rect.maxX) / 2, 3.3, (rect.minZ + rect.maxZ) / 2);
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
    render(player: PlayerState, yaw: number, pitch: number, junction: JunctionState) {
      for (const gate of gates) {
        const rect = gateRect(gate.id, junction.openness[gate.id]);
        gate.mesh.position.set((rect.minX + rect.maxX) / 2, rect.height / 2, (rect.minZ + rect.maxZ) / 2);
        const closing = !openGatesFor(junction.target).includes(gate.id);
        const held = junction.blockedSeconds > 0 && closing && junction.phase === 'closing';
        const warning = junction.phase === 'warning';
        const color = held ? '#dc785e' : warning ? '#e6bf62' : '#ae965f';
        gate.material.color.set(color);
        gate.safetyMaterial.color.set(held ? '#e67758' : '#c4ad6e');
        gate.material.emissive.set(warning ? '#5b420b' : '#000000');
        gate.material.emissiveIntensity = warning ? 0.4 + 0.3 * Math.sin(junction.phaseSeconds * 10) : 0;
      }
      camera.position.set(player.x, EYE_HEIGHT, player.z);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', resize);
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
