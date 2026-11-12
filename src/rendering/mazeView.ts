import { BoxGeometry, BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, SRGBColorSpace } from 'three';
import type { Scene } from 'three';
import { HAND_BUILT_MAZE, MAZE_WALLS, cellPosition, findCell, gateEdges, gateRect, landmarkRect, plazaRect } from '../simulation/maze';
import type { MazeLayout, MazeOpenness } from '../simulation/maze';
import type { WallRect } from '../simulation/player';
import type { ShiftPhase } from '../simulation/shift';
import { gateOffset } from '../game/chalk';
import type { ChalkStroke, Vec3 } from '../game/chalk';

// Flat chalk ribbons for strokes, lying on their surface. One mesh per surface ('static' or a
// gate ID); gate meshes are shifted each frame by the slab's offset so drawings slide with it.
const CHALK_HALF_WIDTH = 0.025, CHALK_LIFT = 0.006;
function chalkGeometry(strokes: readonly ChalkStroke[]) {
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const stroke of strokes) {
    const n = stroke.normal;
    const lift = (p: Vec3, side: number[], k: number) => [p[0] + n[0] * CHALK_LIFT + side[0] * k, p[1] + n[1] * CHALK_LIFT + side[1] * k, p[2] + n[2] * CHALK_LIFT + side[2] * k];
    if (stroke.points.length === 1) {
      // A dot: a small square in the surface plane.
      const u = Math.abs(n[1]) > 0.5 ? [1, 0, 0] : [0, 1, 0];
      const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      const p = stroke.points[0], w = CHALK_HALF_WIDTH;
      quad([...lift(p, u, -w)].map((x, i) => x - v[i] * w), [...lift(p, u, w)].map((x, i) => x - v[i] * w),
        [...lift(p, u, w)].map((x, i) => x + v[i] * w), [...lift(p, u, -w)].map((x, i) => x + v[i] * w));
      continue;
    }
    for (let i = 0; i + 1 < stroke.points.length; i++) {
      const a = stroke.points[i], b = stroke.points[i + 1];
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const length = Math.hypot(d[0], d[1], d[2]);
      if (length < 1e-6) continue;
      // Side vector in the surface plane, perpendicular to the segment; extend ends slightly to close joins.
      const side = [(d[1] * n[2] - d[2] * n[1]) / length, (d[2] * n[0] - d[0] * n[2]) / length, (d[0] * n[1] - d[1] * n[0]) / length];
      const e = CHALK_HALF_WIDTH / length;
      const a2: Vec3 = [a[0] - d[0] * e, a[1] - d[1] * e, a[2] - d[2] * e], b2: Vec3 = [b[0] + d[0] * e, b[1] + d[1] * e, b[2] + d[2] * e];
      quad(lift(a2, side, -CHALK_HALF_WIDTH), lift(b2, side, -CHALK_HALF_WIDTH), lift(b2, side, CHALK_HALF_WIDTH), lift(a2, side, CHALK_HALF_WIDTH));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

// What the view needs to draw gates: poses plus which gate is warning/closing.
export type GateView = { phase: ShiftPhase; phaseSeconds: number; openness: MazeOpenness; closing: string | null };

// Hand-built M2/M3 maze by default; generated layouts pass their own derived walls.
// M7: an optional relic (crystal + light beam) and a gold beam over Sanctuary for wayfinding.
export function createMazeView(scene: Scene, layout: MazeLayout = HAND_BUILT_MAZE, mazeWalls: readonly WallRect[] = MAZE_WALLS,
  relic?: { x: number; z: number }) {
  const group = new Group();
  scene.add(group);
  const box = new BoxGeometry(1, 1, 1);
  const wallMaterial = new MeshStandardMaterial({ color: '#929c94', roughness: 1 });
  const walls = new InstancedMesh(box, wallMaterial, mazeWalls.length);
  const matrix = new Matrix4();
  mazeWalls.forEach((wall, i) => walls.setMatrixAt(i, matrix.makeScale(wall.maxX - wall.minX, wall.height, wall.maxZ - wall.minZ)
    .setPosition((wall.minX + wall.maxX) / 2, wall.height / 2, (wall.minZ + wall.maxZ) / 2)));
  group.add(walls);
  const geometries: (BoxGeometry | PlaneGeometry | OctahedronGeometry)[] = [box];
  const materials: (MeshBasicMaterial | MeshStandardMaterial)[] = [wallMaterial];
  const textures: CanvasTexture[] = [];
  function block(width: number, height: number, depth: number, x: number, y: number, z: number, color: string) {
    const material = new MeshStandardMaterial({ color, roughness: 1 });
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    geometries.push(mesh.geometry); materials.push(material); group.add(mesh);
    return mesh;
  }
  function sign(text: string, x: number, y: number, z: number, rotation = 0, color = '#e9dfbf') {
    const label = document.createElement('canvas'); label.width = 512; label.height = 96;
    const context = label.getContext('2d')!;
    context.fillStyle = '#263b32'; context.fillRect(0, 0, label.width, label.height);
    context.fillStyle = color; context.font = 'bold 31px monospace'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text, 256, 48);
    const texture = new CanvasTexture(label); texture.colorSpace = SRGBColorSpace;
    const material = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(new PlaneGeometry(3.4, 0.64), material);
    mesh.position.set(x, y, z); mesh.rotation.y = rotation; group.add(mesh);
    // Separate front faces keep lettering readable from both approaches.
    const back = new Mesh(mesh.geometry, material);
    back.position.copy(mesh.position); back.rotation.y = rotation + Math.PI; group.add(back);
    geometries.push(mesh.geometry); materials.push(material); textures.push(texture);
  }
  // Tall, unlit, translucent column visible above the 3 m walls from anywhere in the maze.
  function beam(x: number, z: number, color: string, opacity: number) {
    const material = new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const mesh = new Mesh(new BoxGeometry(0.7, 60, 0.7), material);
    mesh.position.set(x, 30, z); mesh.renderOrder = 2;
    geometries.push(mesh.geometry); materials.push(material); group.add(mesh);
    return mesh;
  }
  const chalkMaterial = new MeshBasicMaterial({ color: '#eeece2', side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const chalkMeshes = new Map<string, Mesh>();
  let chalkSignature = '';
  let crystal: Mesh | null = null;
  let relicBeam: Mesh | null = null;
  let homeBeam: Mesh | null = null;
  if (relic) {
    homeBeam = beam(0, 0, '#f0b53c', 0.55);
    const material = new MeshBasicMaterial({ color: '#cfeffb' });
    // A floating crystal with no collider: the room centre stays walkable. Crystal and beam vanish when taken.
    const geometry = new OctahedronGeometry(0.32);
    crystal = new Mesh(geometry, material);
    crystal.position.set(relic.x, 1.25, relic.z);
    geometries.push(geometry); materials.push(material); group.add(crystal);
    relicBeam = beam(relic.x, relic.z, '#57d6f5', 0.6);
  }
  const plaza = plazaRect(layout);
  if (plaza) block(plaza.maxX - plaza.minX - 0.2, 0.02, plaza.maxZ - plaza.minZ - 0.2, 0, 0.02, 0, '#bba36b');
  else block(3.8, 0.02, 3.8, 0, 0.02, 0, '#bba36b');
  sign('SANCTUARY / START', 0, 3.5, -1.8);
  for (const landmark of layout.landmarks) {
    const rect = landmarkRect(landmark, layout);
    block(rect.maxX - rect.minX, rect.height, rect.maxZ - rect.minZ,
      (rect.minX + rect.maxX) / 2, rect.height / 2, (rect.minZ + rect.maxZ) / 2, landmark.color);
    const { x, z } = cellPosition(findCell(layout, landmark.cell), layout);
    sign(landmark.name.toUpperCase(), x, 4.5, z, Math.atan2(-x, -z), landmark.color);
  }
  const gates = gateEdges(layout).map((edge) => {
    const id = edge.gate!;
    const rect = gateRect(layout, edge, 0);
    const centerX = (rect.minX + rect.maxX) / 2, centerZ = (rect.minZ + rect.maxZ) / 2;
    const mesh = block(rect.maxX - rect.minX, rect.height, rect.maxZ - rect.minZ, 0, rect.height / 2, 0, '#ae965f');
    const vertical = rect.maxZ - rect.minZ > rect.maxX - rect.minX;
    const outlines = [
      block(rect.maxX - rect.minX, 0.015, 0.035, (rect.minX + rect.maxX) / 2, 0.025, rect.minZ, '#c4ad6e'),
      block(rect.maxX - rect.minX, 0.015, 0.035, (rect.minX + rect.maxX) / 2, 0.025, rect.maxZ, '#c4ad6e'),
      block(0.035, 0.015, rect.maxZ - rect.minZ, rect.minX, 0.025, (rect.minZ + rect.maxZ) / 2, '#c4ad6e'),
      block(0.035, 0.015, rect.maxZ - rect.minZ, rect.maxX, 0.025, (rect.minZ + rect.maxZ) / 2, '#c4ad6e'),
    ];
    if (vertical) {
      sign(`${id.toUpperCase()} / 8m CRUSH`, centerX, 3.5, rect.maxZ + 0.05);
      sign(`${id.toUpperCase()} / 8m CRUSH`, centerX, 3.5, rect.minZ - 0.05, Math.PI);
    } else {
      sign(`${id.toUpperCase()} / 8m CRUSH`, rect.minX - 0.05, 3.5, centerZ, -Math.PI / 2);
      sign(`${id.toUpperCase()} / 8m CRUSH`, rect.maxX + 0.05, 3.5, centerZ, Math.PI / 2);
    }
    return { id, edge, mesh, outlines };
  });
  return {
    // Crystal hides when carried; beams follow the `beams` rule (relic beam also hides when carried).
    setRelic(carried: boolean, seconds: number, beamsOn = true) {
      if (crystal) crystal.visible = !carried;
      if (relicBeam) relicBeam.visible = beamsOn && !carried;
      if (homeBeam) homeBeam.visible = beamsOn;
      if (crystal) { crystal.rotation.y = seconds * 1.2; crystal.position.y = 1.25 + Math.sin(seconds * 2) * 0.08; }
    },
    // T4 free-draw chalk. Rebuilds geometry only when strokes change; gate drawings follow their slab.
    setChalk(strokes: readonly ChalkStroke[], openness: MazeOpenness) {
      const signature = strokes.map((stroke) => `${stroke.id}:${stroke.points.length}`).join(',');
      if (signature !== chalkSignature) {
        chalkSignature = signature;
        for (const mesh of chalkMeshes.values()) { group.remove(mesh); mesh.geometry.dispose(); }
        chalkMeshes.clear();
        const bySurface = new Map<string, ChalkStroke[]>();
        for (const stroke of strokes) bySurface.set(stroke.surface, [...(bySurface.get(stroke.surface) ?? []), stroke]);
        for (const [surface, list] of bySurface) {
          const mesh = new Mesh(chalkGeometry(list), chalkMaterial);
          mesh.renderOrder = 1;
          group.add(mesh); chalkMeshes.set(surface, mesh);
        }
      }
      for (const [surface, mesh] of chalkMeshes) {
        if (surface === 'static') continue;
        const offset = gateOffset(layout, surface, openness[surface] ?? 0);
        mesh.position.set(offset.x, 0, offset.z);
      }
    },
    update(state?: GateView) {
      if (!state) return;
      for (const gate of gates) {
        const rect = gateRect(layout, gate.edge, state.openness[gate.id]);
        gate.mesh.position.set((rect.minX + rect.maxX) / 2, rect.height / 2, (rect.minZ + rect.maxZ) / 2);
        const closing = state.phase === 'closing' && gate.id === state.closing;
        const warning = state.phase === 'warning' && gate.id === state.closing;
        gate.mesh.material.color.set(closing ? '#c17a59' : warning ? '#e6bf62' : '#ae965f');
        gate.mesh.material.emissive.set(warning ? '#5b420b' : '#000000');
        gate.mesh.material.emissiveIntensity = warning ? 0.4 + 0.3 * Math.sin(state.phaseSeconds * 10) : 0;
        for (const line of gate.outlines) line.material.color.set(closing || warning ? '#e67758' : '#c4ad6e');
      }
    },
    dispose() {
      scene.remove(group); walls.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      for (const mesh of chalkMeshes.values()) mesh.geometry.dispose();
      chalkMaterial.dispose();
    },
  };
}
