import * as THREE from 'three';
import { Rig, Animator } from './rig.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export const SPAWN = new THREE.Vector3(0, 0, 38);

const TUNING = {
  radius: 0.4,
  standHeight: 1.8,
  crouchHeight: 1.05,
  stepHeight: 0.45,
  walk: 4.6,
  sprint: 7.4,
  aimWalk: 2.6,
  coverSlide: 3.2,
  accel: 14,
  gravity: 22,
  coverReach: 2.2,
  maxShields: 100,
  maxHealth: 100,
  shieldDelay: 3.5,
  shieldRate: 45,
  healthDelay: 6,
  healthRate: 12,
};

export class Player {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.t = TUNING;
    this.pos = SPAWN.clone();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.facing = Math.PI;
    this.crouchBlend = 0;
    this.crouched = false;
    this.aiming = false;
    this.sprinting = false;
    this.lastShot = 99;
    this.cover = null; // { normal, tangent, type, edgeL, edgeR }
    this.coverCandidate = null;
    this.snap = null; // smooth move into cover / vault
    this.peek = new THREE.Vector3();
    this.shields = TUNING.maxShields;
    this.health = TUNING.maxHealth;
    this.sinceHit = 99;
    this.dead = false;
    this.deadTime = 0;
    this.#buildModel();
  }

  eyeHeight() {
    return THREE.MathUtils.lerp(1.62, 1.08, this.crouchBlend);
  }

  height() {
    return this.crouched ? this.t.crouchHeight : this.t.standHeight;
  }

  visualPos() {
    return _v.copy(this.pos).add(this.peek);
  }

  chest(out) {
    return out.copy(this.pos).add(this.peek).setY(this.pos.y + this.height() * 0.7);
  }

  // Capsule for incoming projectiles.
  capsule() {
    const base = this.pos.clone().add(this.peek);
    const r = this.t.radius;
    return { a: base.clone().setY(base.y + r), b: base.clone().setY(base.y + this.height() - r), r };
  }

  damage(amount) {
    if (this.dead) return 0;
    this.sinceHit = 0;
    if (this.shields > 0) {
      this.shields -= amount;
      if (this.shields < 0) {
        this.health += this.shields;
        this.shields = 0;
      }
    } else {
      this.health -= amount;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deadTime = 0;
      this.cover = null;
      this.aiming = false;
    }
    return amount;
  }

  respawn() {
    this.pos.copy(SPAWN);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.cover = null;
    this.snap = null;
    this.peek.set(0, 0, 0);
    this.shields = this.t.maxShields;
    this.health = this.t.maxHealth;
    this.dead = false;
    this.facing = Math.PI;
    this.root.rotation.set(0, this.facing, 0);
  }

  kick() {
    this.recoil = 1;
  }

  update(dt, input, rig, weapon) {
    const t = this.t;
    this.sinceHit += dt;
    this.lastShot += dt;
    if (this.sinceHit > t.shieldDelay) this.shields = Math.min(t.maxShields, this.shields + t.shieldRate * dt);
    if (this.sinceHit > t.healthDelay) this.health = Math.min(t.maxHealth, this.health + t.healthRate * dt);

    if (this.dead) {
      this.deadTime += dt;
      this.#animate(dt, rig, 0);
      return;
    }

    const ax = input.axis();
    rig.flatForward(_f);
    rig.flatRight(_r);
    const wish = _w.set(0, 0, 0).addScaledVector(_f, ax.y).addScaledVector(_r, ax.x);
    if (wish.lengthSq() > 1) wish.normalize();

    this.aiming = input.mouse.right && !this.snap;
    if (weapon.firing) this.lastShot = 0;
    const combat = this.aiming || this.lastShot < 0.6;

    // ----- smooth snap (enter cover / vault) -----
    if (this.snap) {
      const s = this.snap;
      s.t = Math.min(1, s.t + dt / s.dur);
      const e = s.t * s.t * (3 - 2 * s.t);
      this.pos.x = THREE.MathUtils.lerp(s.from.x, s.to.x, e);
      this.pos.z = THREE.MathUtils.lerp(s.from.z, s.to.z, e);
      const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight);
      this.pos.y = s.hop ? Math.max(ground, s.from.y) + Math.sin(Math.PI * s.t) * s.hop : ground;
      if (s.t >= 1) {
        this.snap = null;
        this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight);
      }
      this.sprinting = false;
      this.#animate(dt, rig, s.hop ? 0 : 1);
      return;
    }

    // ----- cover -----
    this.coverCandidate = this.cover ? null : this.#findCover(wish, _f, false);

    if (input.wasPressed('Space')) {
      if (this.cover) {
        const into = -wish.dot(this.cover.normal);
        if (this.cover.type === 'low' && into > 0.5) this.#tryVault();
        else this.cover = null;
      } else {
        const c = this.coverCandidate ?? this.#findCover(wish, _f, true);
        if (c) this.#enterCover(c);
      }
    }

    if (this.snap) {
      this.#animate(dt, rig, 1);
      return;
    }
    if (this.cover) this.#updateCover(dt, wish, rig);
    else this.#updateFree(dt, wish, input);

    // facing
    let targetFacing = this.facing;
    if (combat) targetFacing = rig.yaw + Math.PI;
    else if (this.cover) targetFacing = Math.atan2(-this.cover.normal.x, -this.cover.normal.z);
    else if (this.vel.lengthSq() > 0.2) targetFacing = Math.atan2(this.vel.x, this.vel.z);
    this.facing = lerpAngle(this.facing, targetFacing, 1 - Math.exp(-dt * (combat ? 25 : 12)));

    // crouch: only behind low cover when not shooting
    this.crouched = !!this.cover && this.cover.type === 'low' && !combat;

    // peek: high cover edge lean when aiming
    const peekTarget = _v.set(0, 0, 0);
    if (this.cover && this.cover.type === 'high' && combat) {
      const tr = this.cover.tangent; // points toward camera right
      let side = 0;
      if (rig.shoulder > 0) side = this.cover.edgeR ? 1 : this.cover.edgeL ? -1 : 0;
      else side = this.cover.edgeL ? -1 : this.cover.edgeR ? 1 : 0;
      if (side !== 0) {
        rig.shoulder = side;
        peekTarget.copy(tr).multiplyScalar(side * 0.8).addScaledVector(this.cover.normal, 0.15);
      }
    }
    this.peek.lerp(peekTarget, 1 - Math.exp(-dt * 14));

    this.#animate(dt, rig, 1);
  }

  #updateFree(dt, wish, input) {
    const t = this.t;
    this.sprinting = input.down('ShiftLeft') && input.axis().y > 0 && !this.aiming && this.lastShot > 0.4;
    const speed = this.aiming ? t.aimWalk : this.sprinting ? t.sprint : t.walk;
    const k = 1 - Math.exp(-dt * t.accel);
    this.vel.x += (wish.x * speed - this.vel.x) * k;
    this.vel.z += (wish.z * speed - this.vel.z) * k;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.#collide();

    const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight, t.radius * 0.5);
    if (this.pos.y > ground + 0.01) {
      this.vy -= t.gravity * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vy = 0;
      }
    } else {
      this.pos.y = ground;
      this.vy = 0;
    }
  }

  #updateCover(dt, wish, rig) {
    const c = this.cover;
    const t = this.t;
    this.sprinting = false;
    // tangent oriented toward camera right
    c.tangent.set(c.normal.z, 0, -c.normal.x);
    if (c.tangent.dot(rig.right) < 0) c.tangent.negate();

    if (wish.dot(c.normal) > 0.75) {
      this.cover = null;
      return;
    }

    const along = this.aiming && c.type === 'high' ? 0 : wish.dot(c.tangent);
    const speed = this.aiming ? t.aimWalk : t.coverSlide;
    const step = along * speed * dt;
    if (Math.abs(step) > 1e-4) {
      const next = _v.copy(this.pos).addScaledVector(c.tangent, step);
      const hit = this.#coverHitAt(next, c.normal);
      const margin = _r.copy(next).addScaledVector(c.tangent, Math.sign(step) * 0.2);
      if (hit && this.#coverHitAt(margin, c.normal)) {
        this.pos.x = hit.point.x + c.normal.x * (t.radius + 0.05);
        this.pos.z = hit.point.z + c.normal.z * (t.radius + 0.05);
      }
    }
    this.vel.set(0, 0, 0);
    c.edgeR = !this.#coverHitAt(_v.copy(this.pos).addScaledVector(c.tangent, 0.45), c.normal);
    c.edgeL = !this.#coverHitAt(_v.copy(this.pos).addScaledVector(c.tangent, -0.45), c.normal);
    if (!this.#coverHitAt(this.pos, c.normal)) this.cover = null;
  }

  #coverHitAt(p, n) {
    _ray.set(new THREE.Vector3(p.x, this.pos.y + 0.5, p.z), new THREE.Vector3(-n.x, 0, -n.z));
    _ray.far = this.t.radius + 0.7;
    const hit = _ray.intersectObjects(this.world.coverMeshes, false)[0];
    if (!hit || !hit.face || hit.face.normal.dot(n) < 0.9) return null;
    return hit;
  }

  #findCover(wish, fwd, wide) {
    const dirs = [];
    if (wish.lengthSq() > 0.1) dirs.push(wish.clone().normalize());
    dirs.push(fwd.clone());
    if (wide) for (let i = 0; i < 8; i++) dirs.push(new THREE.Vector3(Math.sin((i * Math.PI) / 4), 0, Math.cos((i * Math.PI) / 4)));
    const origin = new THREE.Vector3(this.pos.x, this.pos.y + 0.5, this.pos.z);
    for (const d of dirs) {
      _ray.set(origin, d);
      _ray.far = this.t.coverReach;
      const hit = _ray.intersectObjects(this.world.coverMeshes, false)[0];
      if (!hit || !hit.face) continue;
      const n = hit.face.normal.clone();
      if (Math.abs(n.y) > 0.3 || n.dot(d) > -0.5) continue;
      // something solid between us and the cover? (another collider)
      _ray.far = hit.distance;
      const block = _ray.intersectObjects(this.world.meshes, false)[0];
      if (block && block.object !== hit.object && block.distance < hit.distance - 0.05) continue;
      const col = hit.object.userData.collider;
      const type = col.box.max.y - this.pos.y < 1.7 ? 'low' : 'high';
      return { point: hit.point.clone(), normal: n, type, collider: col };
    }
    return null;
  }

  #enterCover(c) {
    const to = c.point.clone().addScaledVector(c.normal, this.t.radius + 0.05);
    to.y = this.pos.y;
    this.snap = { from: this.pos.clone(), to, t: 0, dur: Math.max(0.12, to.distanceTo(this.pos) / 9), hop: 0 };
    this.cover = { normal: c.normal, tangent: new THREE.Vector3(), type: c.type, collider: c.collider, edgeL: false, edgeR: false };
    this.vel.set(0, 0, 0);
  }

  #tryVault() {
    const c = this.cover;
    const b = c.collider.box;
    const depth = Math.abs(c.normal.x) > 0.5 ? b.max.x - b.min.x : b.max.z - b.min.z;
    const to = this.pos.clone().addScaledVector(c.normal, -(depth + this.t.radius * 2 + 0.25));
    // landing spot must be free
    const r = this.t.radius;
    for (const col of this.world.colliders) {
      const bb = col.box;
      if (bb.max.y <= this.pos.y + this.t.stepHeight || bb.min.y > this.pos.y + 1.8) continue;
      if (to.x > bb.min.x - r && to.x < bb.max.x + r && to.z > bb.min.z - r && to.z < bb.max.z + r) return;
    }
    this.cover = null;
    this.snap = { from: this.pos.clone(), to, t: 0, dur: 0.5, hop: b.max.y - this.pos.y + 0.25 };
  }

  #collide() {
    const r = this.t.radius;
    const feet = this.pos.y;
    const top = feet + this.t.standHeight;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.world.colliders) {
        const b = c.box;
        if (b.max.y <= feet + this.t.stepHeight || b.min.y >= top) continue;
        const cx = Math.max(b.min.x, Math.min(this.pos.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(this.pos.z, b.max.z));
        let dx = this.pos.x - cx;
        let dz = this.pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          this.pos.x += (dx / d) * (r - d);
          this.pos.z += (dz / d) * (r - d);
        } else {
          // center inside box: push out on the shallowest axis
          const pens = [
            [this.pos.x - b.min.x + r, -1, 0],
            [b.max.x - this.pos.x + r, 1, 0],
            [this.pos.z - b.min.z + r, 0, -1],
            [b.max.z - this.pos.z + r, 0, 1],
          ].sort((a, b2) => a[0] - b2[0]);
          this.pos.x += pens[0][1] * pens[0][0];
          this.pos.z += pens[0][2] * pens[0][0];
        }
      }
    }
  }

  // ---------------- model (skeleton + dummy parts) ----------------

  #buildModel() {
    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, ...extra });
    const materials = { body: mat(0x3d434d), plate: mat(0x8a919c) };
    const red = mat(0xb3232a, { metalness: 0.1 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x6fe3ff, emissiveIntensity: 2.2 });
    const gunMat = mat(0x1a1c20, { metalness: 0.6, roughness: 0.4 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d8ff, emissiveIntensity: 2.5 });
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    };

    const rig = new Rig({ materials });
    // accents on the dummy
    rig.attach('chest', box(0.06, 0.3, 0.02, red, 0.12, 0.13, 0.155)); // N7-ish stripe
    rig.attach('chest', box(0.34, 0.36, 0.13, materials.body, 0, 0.1, -0.21)); // backpack
    rig.attach('chest', box(0.16, 0.1, 0.2, materials.plate, 0.27, 0.25, 0));
    rig.attach('chest', box(0.16, 0.1, 0.2, materials.plate, -0.27, 0.25, 0));
    rig.attach('head', box(0.19, 0.06, 0.03, visor, 0, 0.15, 0.13));

    // rifle on the weapon bone, sockets for hands + muzzle
    const gun = new THREE.Group();
    gun.add(box(0.08, 0.14, 0.62, gunMat, 0, 0, 0.12));
    gun.add(box(0.05, 0.05, 0.28, gunMat, 0, 0.02, 0.56));
    gun.add(box(0.06, 0.18, 0.08, gunMat, 0, -0.12, -0.02));
    gun.add(box(0.02, 0.03, 0.4, glow, -0.045, 0.03, 0.12));
    gun.add(box(0.06, 0.06, 0.14, gunMat, 0, 0.1, 0.05));
    rig.attach('weapon', gun);
    rig.socket('weapon', 'gripR', 0, -0.1, 0.0);
    rig.socket('weapon', 'gripL', 0, -0.06, 0.34);
    this.muzzle = rig.socket('weapon', 'muzzle', 0, 0.02, 0.72);

    this.scene.add(rig.root);
    this.rigModel = rig;
    this.root = rig.root;
    this.animator = new Animator(rig, { armed: true });
  }

  #animate(dt, camRig, alive) {
    const k = 1 - Math.exp(-dt * 12);
    const target = this.crouched || (this.snap && !this.snap.hop) ? 1 : this.snap ? 0.5 : 0;
    this.crouchBlend += (target - this.crouchBlend) * k;
    const combat = this.aiming || this.lastShot < 0.6;
    this.recoil = Math.max(0, (this.recoil ?? 0) - dt * 8);
    this.animator.update(dt, {
      speed: alive ? Math.hypot(this.vel.x, this.vel.z) : 0,
      sprint: this.sprinting,
      crouch: this.crouchBlend,
      aimPitch: camRig.pitch,
      combat: combat && alive,
      recoil: this.recoil,
      lean: this.peek.length() > 0.2 ? -camRig.shoulder * 0.25 : 0,
    });

    this.root.position.copy(this.visualPos());
    if (alive) {
      this.root.rotation.set(0, this.facing, 0);
    } else {
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, Math.PI / 2, k * 0.5);
      this.root.position.y += 0.25;
    }
    this.root.updateMatrixWorld(true);
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

