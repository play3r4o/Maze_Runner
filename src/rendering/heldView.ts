import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { BufferGeometry, Camera, Material } from 'three';

// M16 held gear in first person, from primitive shapes: the weapon in hand at the lower right
// (swinging on attack), a shield or second weapon at the lower left (raised while blocking).
export type HeldState = {
  shown: boolean; main: string | null; off: string | null; active: 'main' | 'off';
  // 0..1 through the current swing, or 1 when idle; crossbow loaded and recoil.
  swing: number; blocking: boolean; loaded: boolean; recoil: number;
};
export function createHeldView(camera: Camera) {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const mat = (color: string, metal = 0) => { const m = new MeshStandardMaterial({ color, roughness: metal ? 0.35 : 0.85, metalness: metal }); materials.push(m); return m; };
  const steel = mat('#a9b0ae', 0.7), wood = mat('#6b4a2b'), leather = mat('#4a3424'), iron = mat('#6d7270', 0.5), paint = mat('#7a2e2a');
  const box = (w: number, h: number, d: number, m: Material, x = 0, y = 0, z = 0) => {
    const g = new BoxGeometry(w, h, d); geometries.push(g); const mesh = new Mesh(g, m); mesh.position.set(x, y, z); return mesh;
  };
  // Every model points forward (−z) from a grip at the origin.
  const builders: Record<string, () => Group> = {
    sword: () => { const g = new Group(); g.add(box(0.05, 0.05, 0.16, leather, 0, 0, 0.02), box(0.18, 0.03, 0.04, iron, 0, 0, -0.08), box(0.05, 0.012, 0.6, steel, 0, 0, -0.4)); return g; },
    dagger: () => { const g = new Group(); g.add(box(0.04, 0.04, 0.12, leather, 0, 0, 0.02), box(0.1, 0.025, 0.03, iron, 0, 0, -0.05), box(0.04, 0.01, 0.28, steel, 0, 0, -0.2)); return g; },
    mace: () => { const g = new Group(); g.add(box(0.04, 0.04, 0.55, wood, 0, 0, -0.18)); const s = new SphereGeometry(0.08, 8, 6); geometries.push(s); const head = new Mesh(s, iron); head.position.z = -0.48; g.add(head); return g; },
    axe: () => { const g = new Group(); g.add(box(0.045, 0.045, 0.85, wood, 0, 0, -0.3), box(0.03, 0.26, 0.18, steel, 0, 0.06, -0.66)); return g; },
    spear: () => { const g = new Group(); const c = new CylinderGeometry(0.02, 0.02, 1.4, 6); c.rotateX(Math.PI / 2); geometries.push(c); const shaft = new Mesh(c, wood); shaft.position.z = -0.45; g.add(shaft, box(0.05, 0.012, 0.22, steel, 0, 0, -1.25)); return g; },
    crossbow: () => { const g = new Group(); g.add(box(0.06, 0.06, 0.5, wood, 0, 0, -0.15), box(0.5, 0.03, 0.04, steel, 0, 0.02, -0.37)); const b = box(0.012, 0.012, 0.4, steel, 0, 0.05, -0.25); b.name = 'bolt'; g.add(b); return g; },
    buckler: () => { const g = new Group(); const c = new CylinderGeometry(0.22, 0.22, 0.04, 16); c.rotateX(Math.PI / 2); geometries.push(c); g.add(new Mesh(c, iron)); return g; },
    heater: () => { const g = new Group(); g.add(box(0.42, 0.5, 0.04, paint), box(0.46, 0.04, 0.05, iron, 0, 0.25, 0)); return g; },
  };
  const mainHolder = new Group(), offHolder = new Group();
  camera.add(mainHolder, offHolder);
  let mainKind = '', offKind = '';
  const model = (kind: string | null) => {
    if (!kind || kind === 'fists' || !builders[kind]) return null;
    const g = builders[kind]();
    g.scale.setScalar(0.7);
    return g;
  };
  const setHolder = (holder: Group, kind: string | null) => { holder.clear(); const m = model(kind); if (m) holder.add(m); };

  return {
    update(state: HeldState) {
      const mainModel = state.main, offModel = state.off;
      if (mainModel !== mainKind) { mainKind = mainModel ?? ''; setHolder(mainHolder, mainModel); }
      if (offModel !== offKind) { offKind = offModel ?? ''; setHolder(offHolder, offModel); }
      mainHolder.visible = state.shown; offHolder.visible = state.shown;
      const shield = offModel === 'buckler' || offModel === 'heater';
      // Rest poses, low at the sides.
      mainHolder.position.set(0.3, -0.3, -0.62); mainHolder.rotation.set(0.35, 0.15, -0.25);
      offHolder.position.set(shield ? -0.42 : -0.32, shield ? -0.4 : -0.32, shield ? -0.95 : -0.62); offHolder.rotation.set(shield ? 0 : 0.35, shield ? 0.5 : -0.15, shield ? 0 : 0.25);
      offHolder.scale.setScalar(shield ? 0.6 : 1);
      const swingHolder = state.active === 'off' && !shield ? offHolder : mainHolder;
      if (state.swing < 1 && mainKind !== 'crossbow') {
        // A diagonal cut from upper right to lower left.
        const t = state.swing, side = swingHolder === offHolder ? -1 : 1;
        swingHolder.rotation.set(0.9 - 1.7 * t, side * (0.5 - 1.1 * t), side * (-0.9 + 1.5 * t));
        swingHolder.position.x = side * (0.3 - 0.35 * t);
      }
      if (mainKind === 'crossbow') {
        mainHolder.position.set(0.24, -0.24, -0.6 + 0.05 * state.recoil); mainHolder.rotation.set(0, 0, 0);
        const bolt = mainHolder.getObjectByName('bolt'); if (bolt) bolt.visible = state.loaded;
      }
      if (shield && state.blocking) { offHolder.position.set(-0.12, -0.18, -0.7); offHolder.rotation.set(0, 0.1, 0); }
    },
    dispose() { camera.remove(mainHolder, offHolder); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); },
  };
}
