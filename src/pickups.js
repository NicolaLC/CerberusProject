import * as THREE from 'three';

// Ammo pickups ("thermal clips"): fixed crates that respawn, plus clips dropped by destroyed puppets.
// Walk over one to collect it. Full reserve = not collected.
const TUNING = {
  crateAmmo: 96,
  dropAmmo: 32,
  dropChance: 0.45,
  dropLife: 25,
  respawn: 15,
  radius: 1.1,
};

const SPOTS = [
  [6, 0, 34],
  [-24, 0, 2.5],
  [26, 0, 2.5],
  [-40, 1.6, 4],
  [44, 0, 34],
  [0, 0, -24],
  [-20, 0, -34],
  [20, 0, -58],
];

export class Pickups {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.t = TUNING;
    this.items = [];
    this.time = 0;
    this.toast = document.getElementById('toast');
    this.toastTime = 0;

    const caseMat = new THREE.MeshStandardMaterial({ color: 0x2a2e35, metalness: 0.6, roughness: 0.4 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d8ff, emissiveIntensity: 3 });
    this.makeModel = (scale) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), caseMat);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.24), glowMat);
      body.castShadow = true;
      g.add(body, band);
      g.scale.setScalar(scale);
      return g;
    };
    this.ringGeo = new THREE.RingGeometry(0.45, 0.55, 32).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x38d8ff).multiplyScalar(2), transparent: true, opacity: 0.5, depthWrite: false });

    for (const p of SPOTS) this.#spawn(new THREE.Vector3(...p), { crate: true, ammo: TUNING.crateAmmo });
  }

  #spawn(pos, { crate, ammo }) {
    const model = this.makeModel(crate ? 1.3 : 0.9);
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
    ring.position.copy(pos).y += 0.02;
    model.position.copy(pos);
    this.scene.add(model, ring);
    const item = { pos: pos.clone(), model, ring, crate, ammo, active: true, timer: 0, phase: Math.random() * 6 };
    this.items.push(item);
    return item;
  }

  // called by puppets when they break
  drop(pos) {
    if (Math.random() > this.t.dropChance) return;
    const item = this.#spawn(new THREE.Vector3(pos.x, pos.y, pos.z), { crate: false, ammo: this.t.dropAmmo });
    item.timer = this.t.dropLife;
  }

  #show(text) {
    this.toast.textContent = text;
    this.toastTime = 1.4;
  }

  update(dt, player, weapon) {
    this.time += dt;
    this.toastTime -= dt;
    this.toast.style.opacity = this.toastTime > 0 ? Math.min(1, this.toastTime * 3) : 0;

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
      const got = weapon.addAmmo(it.ammo);
      if (got <= 0) {
        if (this.toastTime <= 0) this.#show('AMMO FULL');
        continue;
      }
      this.#show(`+${got} AMMO`);
      this.audio.pickup();
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
