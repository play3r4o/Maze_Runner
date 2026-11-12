import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from 'three';
import type { BufferGeometry, Material, Scene } from 'three';
import type { Bolt, Glob, Monster } from '../game/monsters';

// M10 monsters and M11 bolts from primitive shapes. Presentation only.
// Husk: a stooped, grey-green figure. Skitter: a low dark body on thin legs.
// Warden: a towering, near-black hulk with ember eyes. Dead monsters lie still.
export function createMonsterView(scene: Scene, initial: readonly Monster[]) {
  const group = new Group();
  scene.add(group);
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const mat = <T extends Material>(m: T) => { materials.push(m); return m; };
  const geo = <T extends BufferGeometry>(g: T) => { geometries.push(g); return g; };
  const huskSkin = mat(new MeshStandardMaterial({ color: '#6f7a62', roughness: 1 }));
  const skitterShell = mat(new MeshStandardMaterial({ color: '#2a2622', roughness: 0.5, metalness: 0.2 }));
  const wardenHide = mat(new MeshStandardMaterial({ color: '#1b1717', roughness: 0.9 }));
  const ember = mat(new MeshBasicMaterial({ color: '#ff6a2a' }));
  const pale = mat(new MeshBasicMaterial({ color: '#d9e3b0' }));
  const steel = mat(new MeshStandardMaterial({ color: '#9aa1a0', metalness: 0.7, roughness: 0.3 }));
  const sickly = mat(new MeshStandardMaterial({ color: '#5d6b3a', roughness: 0.9 }));
  const sac = mat(new MeshStandardMaterial({ color: '#9bbf3a', roughness: 0.4, emissive: '#2a3a08' }));
  const plate = mat(new MeshStandardMaterial({ color: '#4f5557', metalness: 0.5, roughness: 0.5 }));
  const chestWood = mat(new MeshStandardMaterial({ color: '#6e4a2a', roughness: 0.85 }));
  const ramHide = mat(new MeshStandardMaterial({ color: '#3a2f28', roughness: 1 }));
  const horn = mat(new MeshStandardMaterial({ color: '#cbbf9e', roughness: 0.6 }));
  const globMaterial = mat(new MeshBasicMaterial({ color: '#a6e22e' }));
  const part = (g: BufferGeometry, m: Material, x: number, y: number, z: number) => {
    const mesh = new Mesh(g, m); mesh.position.set(x, y, z); return mesh;
  };

  function build(kind: Monster['kind']) {
    const body = new Group();
    if (kind === 'husk') {
      body.add(part(geo(new BoxGeometry(0.7, 1.1, 0.45)), huskSkin, 0, 0.95, 0));
      const head = part(geo(new SphereGeometry(0.24, 10, 8)), huskSkin, 0, 1.7, -0.12);
      body.add(head);
      for (const side of [-1, 1]) {
        body.add(part(geo(new BoxGeometry(0.16, 0.8, 0.16)), huskSkin, side * 0.42, 0.95, -0.25));
        body.add(part(geo(new BoxGeometry(0.2, 0.45, 0.2)), huskSkin, side * 0.18, 0.22, 0));
        body.add(part(geo(new SphereGeometry(0.04, 6, 4)), pale, side * 0.08, 1.74, -0.33));
      }
      body.rotation.x = -0.15;
    } else if (kind === 'skitter') {
      body.add(part(geo(new SphereGeometry(0.3, 12, 8)), skitterShell, 0, 0.32, 0));
      for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
        const leg = part(geo(new BoxGeometry(0.5, 0.05, 0.05)), skitterShell, side * 0.38, 0.2, -0.2 + i * 0.2);
        leg.rotation.z = side * 0.6;
        body.add(leg);
      }
      for (const side of [-1, 1]) body.add(part(geo(new SphereGeometry(0.05, 6, 4)), ember, side * 0.1, 0.42, -0.27));
    } else if (kind === 'spitter') {
      // Hunched, with a swollen throat sac.
      body.add(part(geo(new BoxGeometry(0.55, 0.8, 0.4)), sickly, 0, 0.75, 0));
      body.add(part(geo(new SphereGeometry(0.3, 10, 8)), sac, 0, 1.25, -0.12));
      for (const side of [-1, 1]) {
        body.add(part(geo(new BoxGeometry(0.14, 0.4, 0.14)), sickly, side * 0.16, 0.2, 0));
        body.add(part(geo(new SphereGeometry(0.04, 6, 4)), ember, side * 0.1, 1.35, -0.38));
      }
    } else if (kind === 'brute') {
      // Wide, plated, small head.
      body.add(part(geo(new BoxGeometry(1.1, 1.3, 0.7)), plate, 0, 1.25, 0));
      body.add(part(geo(new BoxGeometry(0.4, 0.35, 0.4)), plate, 0, 2.05, -0.05));
      for (const side of [-1, 1]) {
        body.add(part(geo(new BoxGeometry(0.4, 1.1, 0.4)), plate, side * 0.78, 1.2, 0));
        body.add(part(geo(new BoxGeometry(0.42, 0.7, 0.42)), plate, side * 0.3, 0.35, 0));
        body.add(part(geo(new SphereGeometry(0.05, 6, 4)), ember, side * 0.09, 2.08, -0.26));
      }
    } else if (kind === 'mimic') {
      // A chest with a mouth.
      body.add(part(geo(new BoxGeometry(0.9, 0.45, 0.6)), chestWood, 0, 0.3, 0));
      const lid = part(geo(new BoxGeometry(0.92, 0.14, 0.62)), chestWood, 0, 0.62, 0.12);
      lid.rotation.x = -0.6;
      body.add(lid);
      for (let i = -3; i <= 3; i++) body.add(part(geo(new BoxGeometry(0.05, 0.1, 0.05)), pale, i * 0.12, 0.55, -0.28));
      for (let i = 0; i < 4; i++) for (const side of [-1, 1]) body.add(part(geo(new BoxGeometry(0.06, 0.3, 0.06)), chestWood, side * 0.4, 0.06, -0.2 + i * 0.13));
    } else if (kind === 'ram') {
      // A heavy quadruped with curled horns.
      body.add(part(geo(new BoxGeometry(1.1, 1.0, 2.0)), ramHide, 0, 1.2, 0.2));
      const head = new Group();
      head.position.set(0, 1.3, -0.9);
      head.add(part(geo(new BoxGeometry(0.7, 0.6, 0.6)), ramHide, 0, 0, 0));
      for (const side of [-1, 1]) {
        head.add(part(geo(new SphereGeometry(0.22, 8, 6)), horn, side * 0.45, 0.2, 0.05));
        head.add(part(geo(new SphereGeometry(0.06, 6, 4)), ember, side * 0.2, 0.08, -0.31));
      }
      head.name = 'head';
      body.add(head);
      for (const [x, z] of [[-0.4, -0.5], [0.4, -0.5], [-0.4, 0.9], [0.4, 0.9]]) body.add(part(geo(new BoxGeometry(0.25, 0.8, 0.25)), ramHide, x, 0.4, z));
    } else {
      body.add(part(geo(new BoxGeometry(1.2, 1.7, 0.8)), wardenHide, 0, 1.55, 0));
      body.add(part(geo(new BoxGeometry(0.6, 0.55, 0.55)), wardenHide, 0, 2.6, -0.1));
      for (const side of [-1, 1]) {
        body.add(part(geo(new BoxGeometry(0.35, 1.5, 0.35)), wardenHide, side * 0.8, 1.4, -0.1));
        body.add(part(geo(new BoxGeometry(0.4, 0.75, 0.4)), wardenHide, side * 0.3, 0.37, 0));
        body.add(part(geo(new SphereGeometry(0.07, 6, 4)), ember, side * 0.15, 2.65, -0.38));
      }
    }
    group.add(body);
    return body;
  }
  const bodies = initial.map((monster) => build(monster.kind));

  // Bolts: a small pool of thin shafts.
  const shaft = geo(new CylinderGeometry(0.015, 0.015, 0.6, 5));
  shaft.rotateX(Math.PI / 2);
  const boltMeshes: Mesh[] = [];
  const globGeometry = geo(new SphereGeometry(0.12, 8, 6));
  const globMeshes: Mesh[] = [];

  return {
    update(monsters: readonly Monster[], bolts: readonly Bolt[], visible: boolean, time: number) {
      monsters.forEach((monster, i) => {
        const body = bodies[i];
        if (!body) return;
        const gone = (monster.mode === 'dead' && monster.kind === 'warden') || monster.mode === 'dormant';
        body.visible = visible && !gone;
        body.position.set(monster.x, 0, monster.z);
        body.rotation.y = monster.yaw;
        if (monster.mode === 'dead') {
          body.rotation.z = Math.PI / 2; body.position.y = monster.kind === 'skitter' ? 0 : 0.35;
        } else {
          body.rotation.z = monster.stun > 0 ? 0.25 * Math.sin(time * 20) : 0;
          // M17 tells: a brute rears back before its blow; the Ram lowers its head before charging.
          body.rotation.x = monster.kind === 'brute' && (monster.windup ?? 0) > 0 ? 0.35 : 0;
          const head = body.getObjectByName('head');
          if (head) head.rotation.x = (monster.windup ?? 0) > 0 || monster.charge ? 0.5 : 0;
          // Walking bob, quicker for skitters.
          const rate = monster.kind === 'skitter' ? 18 : monster.kind === 'warden' ? 5 : 7;
          body.position.y = Math.abs(Math.sin(time * rate + i)) * (monster.kind === 'warden' ? 0.08 : 0.04);
        }
      });
      while (boltMeshes.length < bolts.length) { const mesh = new Mesh(shaft, steel); group.add(mesh); boltMeshes.push(mesh); }
      boltMeshes.forEach((mesh, i) => {
        const bolt = bolts[i];
        mesh.visible = Boolean(bolt);
        if (!bolt) return;
        mesh.position.set(bolt.x, 1.45, bolt.z);
        mesh.rotation.y = Math.atan2(-bolt.dx, -bolt.dz);
      });
    },
    updateGlobs(globs: readonly Glob[]) {
      while (globMeshes.length < globs.length) { const mesh = new Mesh(globGeometry, globMaterial); group.add(mesh); globMeshes.push(mesh); }
      globMeshes.forEach((mesh, i) => { const glob = globs[i]; mesh.visible = Boolean(glob); if (glob) mesh.position.set(glob.x, 1.2, glob.z); });
    },
    dispose() {
      scene.remove(group);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
