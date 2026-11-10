import {
  BoxGeometry, Color, DirectionalLight, GridHelper, HemisphereLight,
  Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer,
} from 'three';
import { EYE_HEIGHT } from '../simulation/player';
import type { PlayerState } from '../simulation/player';
import { ROOM_SIZE, ROOM_WALLS } from '../simulation/room';

export function createScene(canvas: HTMLCanvasElement) {
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

  const wallMeshes = ROOM_WALLS.map((wall) => {
    const mesh = new Mesh(
      new BoxGeometry(wall.maxX - wall.minX, wall.height, wall.maxZ - wall.minZ),
      wall.id === 'block' ? blockMaterial : wallMaterial,
    );
    mesh.position.set((wall.minX + wall.maxX) / 2, wall.height / 2, (wall.minZ + wall.maxZ) / 2);
    scene.add(mesh);
    return mesh;
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
    render(player: PlayerState, yaw: number, pitch: number) {
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
      floorMaterial.dispose();
      wallMaterial.dispose();
      blockMaterial.dispose();
      renderer.dispose();
    },
  };
}
