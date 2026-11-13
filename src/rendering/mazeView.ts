import { BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, SRGBColorSpace } from 'three';
import type { Scene } from 'three';
import { HAND_BUILT_MAZE, MAZE_WALLS, cellPosition, chamberRects, findCell, gateEdges, gateRect, landmarkRect, plazaRect } from '../simulation/maze';
import type { GeneratedMaze } from '../simulation/mazeGenerator';
import { MATCH } from '../game/tuning';
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
  const octagon = 'homeGate' in layout && (layout as GeneratedMaze).homeGate ? layout as GeneratedMaze : null;
  const group = new Group();
  scene.add(group);
  const box = new BoxGeometry(1, 1, 1);
  const wallMaterial = new MeshStandardMaterial({ color: '#929c94', roughness: 1 });
  const walls = new InstancedMesh(box, wallMaterial, mazeWalls.length);
  const matrix = new Matrix4();
  mazeWalls.forEach((wall, i) => walls.setMatrixAt(i, matrix.makeScale(wall.maxX - wall.minX, wall.height, wall.maxZ - wall.minZ)
    .setPosition((wall.minX + wall.maxX) / 2, wall.height / 2, (wall.minZ + wall.maxZ) / 2)));
  group.add(walls);
  const geometries: BufferGeometry[] = [box];
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
  const fadedMaterial = new MeshBasicMaterial({ color: '#b9c2b4', transparent: true, opacity: 0.4, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  function makeChalkLayer(material: MeshBasicMaterial) {
    const meshes = new Map<string, Mesh>();
    let signature = '';
    return {
      set(strokes: readonly ChalkStroke[], openness: MazeOpenness) {
        const next = strokes.map((stroke) => `${stroke.id}:${stroke.points.length}`).join(',');
        if (next !== signature) {
          signature = next;
          for (const mesh of meshes.values()) { group.remove(mesh); mesh.geometry.dispose(); }
          meshes.clear();
          const bySurface = new Map<string, ChalkStroke[]>();
          for (const stroke of strokes) bySurface.set(stroke.surface, [...(bySurface.get(stroke.surface) ?? []), stroke]);
          for (const [surface, list] of bySurface) {
            const mesh = new Mesh(chalkGeometry(list), material);
            mesh.renderOrder = 1;
            group.add(mesh); meshes.set(surface, mesh);
          }
        }
        for (const [surface, mesh] of meshes) {
          if (surface === 'static') continue;
          const offset = gateOffset(layout, surface, openness[surface] ?? 0);
          mesh.position.set(offset.x, 0, offset.z);
        }
      },
      dispose() { for (const mesh of meshes.values()) mesh.geometry.dispose(); material.dispose(); },
    };
  }
  const chalkLayer = makeChalkLayer(chalkMaterial), fadedLayer = makeChalkLayer(fadedMaterial);
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
  const home = plaza ? { x: (plaza.minX + plaza.maxX) / 2, z: (plaza.minZ + plaza.maxZ) / 2 } : { x: 0, z: 0 };
  if (plaza) block(plaza.maxX - plaza.minX - 0.2, 0.02, plaza.maxZ - plaza.minZ - 0.2, home.x, 0.02, home.z, '#bba36b');
  else block(3.8, 0.02, 3.8, 0, 0.02, 0, '#bba36b');
  if (homeBeam && (home.x !== 0 || home.z !== 0)) homeBeam.position.set(home.x, homeBeam.position.y, home.z);
  sign('SANCTUARY / START', home.x, 3.5, home.z + (octagon ? 3 : -1.8), octagon ? Math.PI : 0);
  // M18: the core chamber floor, the night extract disc and the seven sealed team bases.
  for (const chamber of chamberRects(layout)) {
    block(chamber.maxX - chamber.minX - 0.2, 0.015, chamber.maxZ - chamber.minZ - 0.2, (chamber.minX + chamber.maxX) / 2, 0.015, (chamber.minZ + chamber.maxZ) / 2, '#5b4a6e');
  }
  let coreDisc: Mesh<CylinderGeometry, MeshBasicMaterial> | null = null;
  if (octagon?.core) {
    const geometry = new CylinderGeometry(MATCH.coreRadius, MATCH.coreRadius, 0.06, 32);
    const material = new MeshBasicMaterial({ color: '#7fe0a8', transparent: true, opacity: 0.25 });
    coreDisc = new Mesh(geometry, material);
    coreDisc.position.set(octagon.core.x, 0.05, octagon.core.z);
    geometries.push(geometry); materials.push(material); group.add(coreDisc);
    sign('CORE / NIGHT EXTRACT', octagon.core.x, 3.8, octagon.core.z, 0, '#7fe0a8');
  }
  for (const base of octagon?.sanctuaries ?? []) {
    if (base.home) continue;
    const inner = cellPosition({ id: '', column: base.inner.column, row: base.inner.row }, layout);
    const dx = Math.sign(base.column - base.inner.column), dz = Math.sign(base.row - base.inner.row);
    const half = layout.roomHalf ?? 2;
    const x = inner.x + dx * (half - 0.05), z = inner.z + dz * (half - 0.05);
    // A sealed slab set into the wall where that team's gate will be.
    block(dx ? 0.2 : 4, 3, dz ? 0.2 : 4, x, 1.5, z, '#6d5f86');
    sign(`SEALED · ${base.name.toUpperCase()} BASE`, x - dx * 0.15, 3.5, z - dz * 0.15, Math.atan2(-dx, -dz), '#cbbde8');
  }
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
    // Along the passage (M18 doorways are wider than they are long).
    const vertical = findCell(layout, edge.a).column === findCell(layout, edge.b).column;
    const label = id === 'home' ? 'HOME GATE' : `${id.toUpperCase()} / ${octagon ? '' : '8m '}CRUSH`;
    const outlines = [
      block(rect.maxX - rect.minX, 0.015, 0.035, (rect.minX + rect.maxX) / 2, 0.025, rect.minZ, '#c4ad6e'),
      block(rect.maxX - rect.minX, 0.015, 0.035, (rect.minX + rect.maxX) / 2, 0.025, rect.maxZ, '#c4ad6e'),
      block(0.035, 0.015, rect.maxZ - rect.minZ, rect.minX, 0.025, (rect.minZ + rect.maxZ) / 2, '#c4ad6e'),
      block(0.035, 0.015, rect.maxZ - rect.minZ, rect.maxX, 0.025, (rect.minZ + rect.maxZ) / 2, '#c4ad6e'),
    ];
    if (vertical) {
      sign(label, centerX, 3.5, rect.maxZ + 0.05);
      sign(label, centerX, 3.5, rect.minZ - 0.05, Math.PI);
    } else {
      sign(label, rect.minX - 0.05, 3.5, centerZ, -Math.PI / 2);
      sign(label, rect.maxX + 0.05, 3.5, centerZ, Math.PI / 2);
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
    // M18: the core extract glows at night and fills while you stand on it.
    setCore(active: boolean, progress: number) {
      if (!coreDisc) return;
      coreDisc.material.opacity = active ? 0.35 + 0.5 * progress : 0.08;
      coreDisc.material.color.set(active ? '#7fe0a8' : '#4d5a52');
    },
    // T4 free-draw chalk. Rebuilds geometry only when strokes change; gate drawings follow their slab.
    setChalk(strokes: readonly ChalkStroke[], openness: MazeOpenness) { chalkLayer.set(strokes, openness); },
    // T8: the last death's drawings on this seed, faded.
    setFadedChalk(strokes: readonly ChalkStroke[], openness: MazeOpenness) { fadedLayer.set(strokes, openness); },
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
      chalkLayer.dispose(); fadedLayer.dispose();
    },
  };
}
