import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { BufferGeometry, Material, Scene } from 'three';
import type { Container } from '../game/loot';

// M8 containers from primitive shapes: chests (lid opens once looked into), dropped sacks.
// Remains use the monster's own body; the reliquary is the relic plinth in mazeView.
export function createContainerView(scene: Scene) {
  const group = new Group();
  scene.add(group);
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const mat = <T extends Material>(m: T) => { materials.push(m); return m; };
  const geo = <T extends BufferGeometry>(g: T) => { geometries.push(g); return g; };
  const wood = mat(new MeshStandardMaterial({ color: '#6e4a2a', roughness: 0.85 }));
  const band = mat(new MeshStandardMaterial({ color: '#8d8a7c', metalness: 0.6, roughness: 0.4 }));
  const cloth = mat(new MeshStandardMaterial({ color: '#9c8462', roughness: 1 }));
  const body = geo(new BoxGeometry(0.9, 0.5, 0.6));
  const lid = geo(new BoxGeometry(0.92, 0.14, 0.62));
  const strap = geo(new BoxGeometry(0.06, 0.52, 0.62));
  const sack = geo(new SphereGeometry(0.3, 10, 8));
  const views = new Map<string, { group: Group; lid?: Group }>();

  function build(container: Container) {
    const holder = new Group();
    holder.position.set(container.x, 0, container.z);
    if (container.kind === 'chest') {
      const box = new Mesh(body, wood); box.position.y = 0.25; holder.add(box);
      for (const side of [-0.3, 0.3]) { const s = new Mesh(strap, band); s.position.set(side, 0.25, 0); holder.add(s); }
      const hinge = new Group(); hinge.position.set(0, 0.5, 0.3);
      const top = new Mesh(lid, wood); top.position.set(0, 0.07, -0.31); hinge.add(top);
      holder.add(hinge);
      // Chests sit in a room corner (cell centres are on a 12 m grid): face the room centre.
      const sx = Math.sign(container.x - Math.round(container.x / 12) * 12) || 1, sz = Math.sign(container.z - Math.round(container.z / 12) * 12) || 1;
      holder.rotation.y = Math.atan2(sx, sz);
      group.add(holder);
      return { group: holder, lid: hinge };
    }
    const bag = new Mesh(sack, cloth); bag.scale.set(1, 0.8, 1); bag.position.y = 0.24; holder.add(bag);
    group.add(holder);
    return { group: holder };
  }
  return {
    update(containers: readonly Container[]) {
      const seen = new Set<string>();
      for (const container of containers) {
        if (container.kind !== 'chest' && container.kind !== 'sack') continue;
        seen.add(container.id);
        let view = views.get(container.id);
        if (!view) { view = build(container); views.set(container.id, view); }
        if (view.lid) view.lid.rotation.x = container.opened ? -1.1 : 0;
      }
      for (const [id, view] of views) if (!seen.has(id)) { group.remove(view.group); views.delete(id); }
    },
    dispose() { scene.remove(group); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); },
  };
}
