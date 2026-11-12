import { BoxGeometry, BufferGeometry as LineGeometry, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
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
  // T5 thread: one line per strand, just above the floor. T8: a cairn of three stones.
  const threadMaterial = mat(new LineBasicMaterial({ color: '#c8382c' }));
  const threadLines: Line[] = [];
  let threadSignature = '';
  const stone = mat(new MeshStandardMaterial({ color: '#a9a294', roughness: 1 }));
  const cairn = new Group();
  [[0.32, 0.22], [0.25, 0.55], [0.17, 0.82]].forEach(([r, y], i) => { const m = new Mesh(geo(new SphereGeometry(r, 9, 7)), stone); m.scale.y = 0.65; m.position.set(i * 0.04, y, 0); cairn.add(m); });
  cairn.visible = false;
  group.add(cairn);

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
    update(containers: readonly Container[], thread: readonly (readonly { x: number; z: number }[])[] = [], trace: { x: number; z: number } | null = null) {
      cairn.visible = Boolean(trace);
      if (trace) cairn.position.set(trace.x, 0, trace.z);
      const signature = thread.map((strand) => strand.length).join(',');
      if (signature !== threadSignature) {
        threadSignature = signature;
        for (const line of threadLines) { group.remove(line); line.geometry.dispose(); }
        threadLines.length = 0;
        for (const strand of thread) {
          if (strand.length < 2) continue;
          const line = new Line(new LineGeometry().setFromPoints(strand.map((p) => new Vector3(p.x, 0.03, p.z))), threadMaterial);
          group.add(line); threadLines.push(line);
        }
      }
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
    dispose() { for (const line of threadLines) line.geometry.dispose(); scene.remove(group); for (const g of geometries) g.dispose(); for (const m of materials) m.dispose(); },
  };
}
