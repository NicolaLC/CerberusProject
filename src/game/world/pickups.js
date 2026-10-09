import * as THREE from 'three';

// Ammo pickups ("thermal clips"): fixed crates that respawn, plus clips dropped by destroyed puppets.
// Two ammo classes (guns.js `ammo`): light (cyan: AR, MG, BR, pistol) and heavy (orange: SR, RG). A pickup only
// refills its own class. Walk over one to collect it; every gun of the class full = not collected.
// Emits 'pickup:collected' / 'pickup:full'.
const TUNING = {
  dropChance: 0.45,
  heavyDropChance: 0.25, // share of drops that are heavy ammo
  dropLife: 25,
  respawn: 15,
  radius: 1.1,
};

// [x, y, z, type]: 7 light, 3 heavy, spread around the map
const SPOTS = [
  [6, 0, 34, 'light'],
  [-24, 0, 2.5, 'light'],
  [26, 0, 2.5, 'heavy'], // range
  [-40, 1.6, 4, 'light'],
  [44, 0, 34, 'light'],
  [0, 0, -24, 'light'],
  [-20, 0, -34, 'heavy'], // interior
  [20, 0, -58, 'light'],
  [28, 0, -17, 'light'], // boss arena: at the gate and at the back
  [47, 0, -60, 'heavy'],
];

export class Pickups {
  constructor({ scene, events }) {
    this.scene = scene;
    this.events = events;
    this.t = TUNING;
    this.items = [];
    this.time = 0;
    this.fullCooldown = 0;

    const caseMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.6, roughness: 0.4 });
    const hex = { light: 0x38d8ff, heavy: 0xffa11c };
    const looks = {
      light: { glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex.light, emissiveIntensity: 3 }), body: [0.34, 0.2, 0.22], band: [0.36, 0.05, 0.24], bandY: [0] },
      // heavy: taller, chunkier case with two bands
      heavy: { glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: hex.heavy, emissiveIntensity: 4 }), body: [0.3, 0.34, 0.3], band: [0.33, 0.05, 0.33], bandY: [-0.08, 0.08] },
    };
    for (const l of Object.values(looks)) {
      l.bodyGeo = new THREE.BoxGeometry(...l.body);
      l.bandGeo = new THREE.BoxGeometry(...l.band);
    }
    this.makeModel = (scale, type) => {
      const l = looks[type];
      const g = new THREE.Group();
      const body = new THREE.Mesh(l.bodyGeo, caseMat);
      body.castShadow = true;
      g.add(body);
      for (const y of l.bandY) {
        const band = new THREE.Mesh(l.bandGeo, l.glow);
        band.position.y = y;
        g.add(band);
      }
      g.scale.setScalar(scale);
      return g;
    };
    this.ringGeo = new THREE.RingGeometry(0.45, 0.55, 32).rotateX(-Math.PI / 2);
    const ringMat = (c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2), transparent: true, opacity: 0.5, depthWrite: false });
    this.ringMats = { light: ringMat(hex.light), heavy: ringMat(hex.heavy) };

    for (const [x, y, z, type] of SPOTS) this.#spawn(new THREE.Vector3(x, y, z), { crate: true, type });
  }

  #spawn(pos, { crate, type }) {
    const model = this.makeModel(crate ? 1.3 : 0.9, type);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMats[type]);
    ring.position.copy(pos).y += 0.02;
    model.position.copy(pos);
    this.scene.add(model, ring);
    const item = { pos: pos.clone(), model, ring, crate, type, active: true, timer: 0, phase: Math.random() * 6 };
    this.items.push(item);
    return item;
  }

  // a broken puppet may leave a clip behind
  drop(pos) {
    if (Math.random() > this.t.dropChance) return;
    const item = this.#spawn(new THREE.Vector3(pos.x, pos.y, pos.z), { crate: false, type: Math.random() < this.t.heavyDropChance ? 'heavy' : 'light' });
    item.timer = this.t.dropLife;
  }

  update(dt, player, weapon) {
    this.time += dt;
    this.fullCooldown -= dt;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.active) {
        it.timer -= dt;
        if (it.timer <= 0) {
          it.active = true;
          it.model.visible = it.ring.visible = true;
        }
        continue;
      }
      it.model.position.y = it.pos.y + 0.45 + Math.sin(this.time * 2.5 + it.phase) * 0.08;
      it.model.rotation.y += dt * 1.5;
      if (!it.crate) {
        it.timer -= dt;
        if (it.timer <= 0) {
          this.#remove(i);
          continue;
        }
        it.model.visible = it.timer > 4 || Math.sin(this.time * 20) > 0; // blink before vanishing
      }

      if (player.dead) continue;
      const dx = player.pos.x - it.pos.x;
      const dz = player.pos.z - it.pos.z;
      if (dx * dx + dz * dz > this.t.radius ** 2 || Math.abs(player.pos.y - it.pos.y) > 1.2) continue;
      const got = weapon.addAmmo(it.crate ? 'crate' : 'drop', it.type);
      if (!got) {
        if (this.fullCooldown <= 0) this.events.emit('pickup:full');
        this.fullCooldown = 1.4;
        continue;
      }
      this.events.emit('pickup:collected', got);
      if (it.crate) {
        it.active = false;
        it.timer = this.t.respawn;
        it.model.visible = it.ring.visible = false;
      } else {
        this.#remove(i);
      }
    }
  }

  #remove(i) {
    const it = this.items[i];
    this.scene.remove(it.model, it.ring);
    this.items.splice(i, 1);
  }
}
