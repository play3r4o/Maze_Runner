import { BoxGeometry, ConeGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from 'three';
import type { Material, Scene } from 'three';
import { bladeRect, boulderPosition } from '../game/traps';
import type { TrapSpec, TrapState } from '../game/traps';
import { BOULDER_RADIUS, BOULDER_SPEED, DART_VOLLEY_SECONDS } from '../game/tuning';

// M12 trap visuals from primitive shapes. Presentation only: it reads trap specs and states.
// Plates are deliberately subtle: a slightly darker floor square that a careful player can spot.
export function createTrapView(scene: Scene, traps: readonly TrapSpec[]) {
  const group = new Group();
  scene.add(group);
  const geometries = new Set<BoxGeometry | ConeGeometry | SphereGeometry>();
  const materials: Material[] = [];
  const material = <T extends Material>(m: T) => { materials.push(m); return m; };
  const plateMaterial = material(new MeshStandardMaterial({ color: '#5f6a64', roughness: 1 }));
  const plateLit = material(new MeshStandardMaterial({ color: '#8a6a3a', emissive: '#6b3d12', emissiveIntensity: 0.6 }));
  const metal = material(new MeshStandardMaterial({ color: '#9aa1a0', metalness: 0.6, roughness: 0.35 }));
  const stone = material(new MeshStandardMaterial({ color: '#7d746a', roughness: 0.9 }));
  const dark = material(new MeshBasicMaterial({ color: '#050605' }));
  const crack = material(new MeshBasicMaterial({ color: '#1d201d' }));
  const box = (w: number, h: number, d: number, m: Material) => {
    const geometry = new BoxGeometry(w, h, d); geometries.add(geometry);
    return new Mesh(geometry, m);
  };

  const views = traps.map((trap) => {
    const cx = (trap.zone.minX + trap.zone.maxX) / 2, cz = (trap.zone.minZ + trap.zone.maxZ) / 2;
    const zw = trap.zone.maxX - trap.zone.minX, zd = trap.zone.maxZ - trap.zone.minZ;
    let plate: Mesh | null = null;
    if (trap.plate) {
      plate = box(trap.plate.maxX - trap.plate.minX, 0.02, trap.plate.maxZ - trap.plate.minZ, plateMaterial);
      plate.position.set((trap.plate.minX + trap.plate.maxX) / 2, 0.011, (trap.plate.minZ + trap.plate.maxZ) / 2);
      group.add(plate);
    }
    const parts: Mesh[] = [];
    const add = (mesh: Mesh) => { group.add(mesh); parts.push(mesh); return mesh; };
    if (trap.kind === 'boulder') {
      const geometry = new SphereGeometry(BOULDER_RADIUS, 20, 14); geometries.add(geometry);
      add(new Mesh(geometry, stone)).visible = false;
    } else if (trap.kind === 'pit') {
      add(box(zw, 0.01, zd, dark)).position.set(cx, 0.015, cz);
      // Warning cracks around the edge.
      add(box(zw, 0.012, 0.06, crack)).position.set(cx, 0.016, trap.zone.minZ);
      add(box(zw, 0.012, 0.06, crack)).position.set(cx, 0.016, trap.zone.maxZ);
    } else if (trap.kind === 'floorSpikes') {
      const geometry = new ConeGeometry(0.09, 0.9, 6); geometries.add(geometry);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
        add(new Mesh(geometry, metal)).position.set(trap.zone.minX + (i + 0.5) * zw / 5, -0.5, trap.zone.minZ + (j + 0.5) * zd / 5);
      }
    } else if (trap.kind === 'spears') {
      // Spears slide out of both side walls across the corridor.
      for (let i = 0; i < 5; i++) for (const side of [-1, 1]) {
        const mesh = add(box(trap.axis === 'z' ? 1.9 : 0.06, 0.06, trap.axis === 'z' ? 0.06 : 1.9, metal));
        mesh.userData = { side, i };
      }
    } else if (trap.kind === 'darts') {
      for (let i = 0; i < 6; i++) {
        const mesh = add(box(trap.axis === 'z' ? 0.5 : 0.04, 0.04, trap.axis === 'z' ? 0.04 : 0.5, metal));
        mesh.userData = { i }; mesh.visible = false;
      }
    } else if (trap.kind === 'blade') {
      add(box(trap.axis === 'z' ? 0.5 : 0.08, 2, trap.axis === 'z' ? 0.08 : 0.5, metal));
      add(box(0.06, 1, 0.06, metal));
    }
    return { trap, plate, parts, cx, cz };
  });

  return {
    update(states: readonly TrapState[], time: number) {
      views.forEach(({ trap, plate, parts, cx, cz }, index) => {
        const state = states[index];
        if (!state) return;
        if (plate) plate.material = state.phase === 'warning' || state.phase === 'active' ? plateLit : plateMaterial;
        if (trap.kind === 'boulder') {
          const at = boulderPosition(trap, state);
          parts[0].visible = at !== null;
          if (at) {
            parts[0].position.set(at.x, BOULDER_RADIUS, at.z);
            const rolled = state.seconds * BOULDER_SPEED / BOULDER_RADIUS;
            if (trap.axis === 'x') parts[0].rotation.z = -Math.sign(trap.path!.to.x - trap.path!.from.x) * rolled;
            else parts[0].rotation.x = Math.sign(trap.path!.to.z - trap.path!.from.z) * rolled;
          }
        } else if (trap.kind === 'pit') {
          parts[0].visible = state.phase === 'active';
          parts[1].visible = parts[2].visible = state.phase === 'warning' || state.phase === 'active';
        } else if (trap.kind === 'floorSpikes') {
          const up = state.phase === 'active' ? Math.min(1, state.seconds / 0.08) : state.phase === 'warning' ? 0.1 : 0;
          for (const spike of parts) spike.position.y = -0.5 + up * 0.95;
        } else if (trap.kind === 'spears') {
          const out = state.phase === 'active' ? Math.min(1, state.seconds / 0.08) : 0;
          const length = trap.axis === 'z' ? trap.zone.maxZ - trap.zone.minZ : trap.zone.maxX - trap.zone.minX;
          for (const spear of parts) {
            const { side, i } = spear.userData as { side: number; i: number };
            const along = -length / 2 + (i + 0.5) * length / 5;
            const reach = 2 - 0.95 * out; // centre 2 m out from the middle = hidden in the wall
            const y = 0.5 + (i % 3) * 0.45;
            if (trap.axis === 'z') spear.position.set(cx + side * reach, y, cz + along);
            else spear.position.set(cx + along, y, cz + side * reach);
            spear.visible = out > 0;
          }
        } else if (trap.kind === 'darts') {
          const active = state.phase === 'active';
          const volley = DART_VOLLEY_SECONDS.findIndex((at) => active && state.seconds >= at && state.seconds < at + 0.2);
          for (const dart of parts) {
            const { i } = dart.userData as { i: number };
            dart.visible = volley >= 0;
            if (volley < 0) continue;
            const progress = (state.seconds - DART_VOLLEY_SECONDS[volley]) / 0.2;
            const side = i % 2 ? 1 : -1;
            const across = side * (2 - 4 * progress);
            const along = -2 + (i * 4) / 5;
            if (trap.axis === 'z') dart.position.set(cx + across, 1.1 + (i % 3) * 0.3, cz + along);
            else dart.position.set(cx + along, 1.1 + (i % 3) * 0.3, cz + across);
          }
        } else if (trap.kind === 'blade') {
          const r = bladeRect(trap, time);
          const bx = (r.minX + r.maxX) / 2, bz = (r.minZ + r.maxZ) / 2;
          parts[0].position.set(bx, 1.3, bz);
          parts[1].position.set((bx + cx) / 2, 2.8, (bz + cz) / 2);
        }
      });
    },
    dispose() {
      scene.remove(group);
      for (const geometry of geometries) geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
