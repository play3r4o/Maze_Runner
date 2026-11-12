import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry } from 'three';
import type { BufferGeometry, Camera, Material, Scene } from 'three';
import type { Bolt, Monster } from '../game/monsters';

// M10 monsters and M11 bolts from primitive shapes. Presentation only.
// Husk: a stooped, grey-green figure. Skitter: a low dark body on thin legs.
// Warden: a towering, near-black hulk with ember eyes. Dead monsters lie still.
export function createMonsterView(scene: Scene, camera: Camera, initial: readonly Monster[]) {
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
  const wood = mat(new MeshStandardMaterial({ color: '#6b4a2b', roughness: 0.8 }));
  const steel = mat(new MeshStandardMaterial({ color: '#9aa1a0', metalness: 0.7, roughness: 0.3 }));
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

  // A simple crossbow held at the bottom right of the view while the chalk is away.
  const crossbow = new Group();
  crossbow.add(part(geo(new BoxGeometry(0.06, 0.06, 0.5)), wood, 0, 0, 0));
  const limbs = part(geo(new BoxGeometry(0.5, 0.03, 0.04)), steel, 0, 0.02, -0.22);
  crossbow.add(limbs);
  const loaded = part(geo(new CylinderGeometry(0.01, 0.01, 0.4, 5)), steel, 0, 0.05, -0.1);
  loaded.rotation.x = Math.PI / 2;
  crossbow.add(loaded);
  crossbow.scale.setScalar(0.45);
  crossbow.position.set(0.16, -0.17, -0.4);
  camera.add(crossbow);

  return {
    update(monsters: readonly Monster[], bolts: readonly Bolt[], visible: boolean, time: number, bow: { shown: boolean; ready: boolean; recoil: number }) {
      monsters.forEach((monster, i) => {
        const body = bodies[i];
        if (!body) return;
        const gone = monster.mode === 'dead' && monster.kind === 'warden';
        body.visible = visible && !gone;
        body.position.set(monster.x, 0, monster.z);
        body.rotation.y = monster.yaw;
        if (monster.mode === 'dead') {
          body.rotation.z = Math.PI / 2; body.position.y = monster.kind === 'skitter' ? 0 : 0.35;
        } else {
          body.rotation.z = monster.stun > 0 ? 0.25 * Math.sin(time * 20) : 0;
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
      crossbow.visible = bow.shown;
      loaded.visible = bow.ready;
      crossbow.position.z = -0.4 + 0.04 * bow.recoil;
    },
    dispose() {
      camera.remove(crossbow);
      scene.remove(group);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
