import * as THREE from 'three';
import { Rig, Animator } from './rig.js';
import { GUNS } from '../combat/guns.js';
import { buildSoldier } from './soldier.js';
import { damp, lerpAngle, wrapAngle } from '../../engine/math.js';
import { RigidSkin, mergeGroup } from '../../engine/batch.js';

// The player character: movement, collision, cover state machine, health; drives its rig animator.
// Reads intents from Controls; reports what happened through events ('player:coverSlam', 'player:land').
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _o = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _move = { x: 0, y: 0 };
// probe directions for the wide cover search (8 compass points)
const RING = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.sin((i * Math.PI) / 4), 0, Math.cos((i * Math.PI) / 4)));

export const SPAWN = new THREE.Vector3(0, 0, 38);

const TUNING = {
  radius: 0.4,
  standHeight: 1.8,
  crouchHeight: 1.05,
  stepHeight: 0.45,
  walk: 4.6,
  sprint: 7.4,
  sprintCooldown: 0.4, // seconds after a shot before sprinting is allowed again
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
  constructor({ scene, world, events }) {
    this.scene = scene;
    this.world = world;
    this.events = events;
    this.t = TUNING;
    this.pos = SPAWN.clone();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.facing = Math.PI;
    this.crouchBlend = 0;
    this.crouched = false;
    this.aiming = false;
    this.sprinting = false;
    this.recoil = 0;
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
    this.hitCapsule = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: TUNING.radius };
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

  // Capsule for incoming projectiles (reused object, valid until the next call).
  capsule() {
    const c = this.hitCapsule;
    const r = this.t.radius;
    c.a.copy(this.pos).add(this.peek);
    c.b.copy(c.a);
    c.a.y += r;
    c.b.y += this.height() - r;
    return c;
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
      this.sprinting = false;
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

  // Visual gun kick on the model (per-gun back / climb); camera recoil is separate.
  kick(def) {
    this.recoil = 1;
    this.kickDef = def;
  }

  update(dt, controls, rig, weapon) {
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

    const ax = controls.move(_move);
    rig.flatForward(_f);
    rig.flatRight(_r);
    const wish = _w.set(0, 0, 0).addScaledVector(_f, ax.y).addScaledVector(_r, ax.x);
    if (wish.lengthSq() > 1) wish.normalize();

    // behind a wall or high block away from its ends there's no line of fire: no aiming, no shooting
    this.pinned = !!this.cover && this.cover.type === 'high' && !this.cover.edgeL && !this.cover.edgeR;
    this.aiming = controls.aiming && !this.snap && !this.pinned;
    if (weapon.firing) this.lastShot = 0;
    // sprint: forward only, not while aiming, shooting or in cover; pulling the trigger ends it
    this.sprinting = controls.running && ax.y > 0 && !this.aiming && !this.cover && !this.snap && !controls.firing && this.lastShot > t.sprintCooldown;
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
        this.events.emit(s.hop ? 'player:land' : 'player:coverSlam');
        this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight);
      }
      this.#animate(dt, rig, 1, weapon.lowered());
      return;
    }

    // ----- cover -----
    this.coverCandidate = this.cover ? null : this.#findCover(wish, _f, false);

    if (controls.coverPressed) {
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
      this.#animate(dt, rig, 1, weapon.lowered());
      return;
    }
    if (this.cover) this.#updateCover(dt, wish, rig);
    else this.#updateFree(dt, wish);

    // facing
    let targetFacing = this.facing;
    if (combat) targetFacing = rig.yaw + Math.PI;
    else if (this.cover) targetFacing = Math.atan2(this.cover.normal.x, this.cover.normal.z); // back to the wall
    else if (this.vel.lengthSq() > 0.2) targetFacing = Math.atan2(this.vel.x, this.vel.z);
    this.facing = lerpAngle(this.facing, targetFacing, damp(combat ? 25 : 12, dt));

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
    this.peek.lerp(peekTarget, damp(14, dt));

    this.#animate(dt, rig, 1, weapon.lowered());
  }

  #updateFree(dt, wish) {
    const t = this.t;
    let speed = this.aiming ? t.aimWalk : this.sprinting ? t.sprint : t.walk;
    // heavy guns slow you down while they fire
    if (this.gun?.fireMoveSpeed && this.lastShot < 0.25) speed = Math.min(speed, this.gun.fireMoveSpeed);
    const k = damp(t.accel, dt);
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
    _ray.set(_o.set(p.x, this.pos.y + 0.5, p.z), _n.set(-n.x, 0, -n.z));
    _ray.far = this.t.radius + 0.7;
    const hit = _ray.intersectObjects(this.world.coverMeshes, false)[0];
    if (!hit || !hit.face || hit.face.normal.dot(n) < 0.9) return null;
    return hit;
  }

  // Runs every frame (prompt), so it must not allocate unless it finds something.
  #findCover(wish, fwd, wide) {
    const hasWish = wish.lengthSq() > 0.1;
    const count = (hasWish ? 1 : 0) + 1 + (wide ? RING.length : 0);
    for (let i = 0; i < count; i++) {
      const j = hasWish ? i : i + 1;
      const d = j === 0 ? _n.copy(wish).normalize() : j === 1 ? fwd : RING[j - 2];
      _ray.set(_o.set(this.pos.x, this.pos.y + 0.5, this.pos.z), d);
      _ray.far = this.t.coverReach;
      const hit = _ray.intersectObjects(this.world.coverMeshes, false)[0];
      if (!hit || !hit.face) continue;
      const n = hit.face.normal;
      if (Math.abs(n.y) > 0.3 || n.dot(d) > -0.5) continue;
      // something solid between us and the cover? (another collider)
      _ray.far = hit.distance;
      const block = _ray.intersectObjects(this.world.meshes, false)[0];
      if (block && block.object !== hit.object && block.distance < hit.distance - 0.05) continue;
      const col = hit.object.userData.collider;
      const type = col.box.max.y - this.pos.y < 1.7 ? 'low' : 'high';
      return { point: hit.point, normal: n.clone(), type, collider: col };
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
    this.world.collideCircle(this.pos, this.t.radius, this.t.standHeight, this.t.stepHeight);
  }

  // ---------------- model (skeleton + soldier parts + guns) ----------------

  #buildModel() {
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const rig = new Rig({ dummy: false });
    const M = buildSoldier(rig);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.6, roughness: 0.4 });

    // every gun model hangs on the Weapon bone; only the equipped one is visible
    const gunMats = { gun: gunMat, plate: M.armor, glow: M.glow, glowHot: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a2a, emissiveIntensity: 2.5 }) };
    this.gunModels = {};
    for (const [id, def] of Object.entries(GUNS)) {
      const g = mergeGroup(def.build(gunMats, box)); // one draw per material per gun
      g.visible = false;
      g.userData.gun = true;
      rig.attach('Weapon', g);
      this.gunModels[id] = g;
    }
    // ~100 soldier parts -> one skinned draw per material; guns stay separate (visibility per gun)
    this.skin = new RigidSkin(rig.root, rig.skeleton, { exclude: (o) => o.userData.gun });

    this.scene.add(rig.root);
    this.rigModel = rig;
    this.root = rig.root;
    this.animator = new Animator(rig, { armed: true, ground: (x, z, maxY) => this.world.groundAt(x, z, maxY) });
  }

  // Show the gun and move hand/muzzle sockets to it.
  setGun(id) {
    const def = GUNS[id];
    this.gun = def;
    for (const [k, g] of Object.entries(this.gunModels)) g.visible = k === id;
    const s = def.sockets;
    this.rigModel.socket('Weapon', 'gripR', ...s.gripR);
    this.rigModel.socket('Weapon', 'gripL', ...s.gripL);
    this.muzzle = this.rigModel.socket('Weapon', 'muzzle', ...s.muzzle);
  }

  #animate(dt, camRig, alive, weaponLower = 0) {
    const k = damp(12, dt);
    const target = this.crouched || (this.snap && !this.snap.hop) ? 1 : this.snap ? 0.5 : 0;
    this.crouchBlend += (target - this.crouchBlend) * k;
    const combat = this.aiming || this.lastShot < 0.6;
    this.recoil = Math.max(0, this.recoil - dt * 11);
    // in cover with the back to the wall, the head turns to the camera
    let lookYaw = 0;
    if (this.cover && !combat && alive) {
      const c = camRig.camera.position;
      const a = Math.atan2(c.x - this.pos.x, c.z - this.pos.z) - this.facing;
      lookYaw = THREE.MathUtils.clamp(wrapAngle(a), -1.2, 1.2);
    }
    const speed = alive ? Math.hypot(this.vel.x, this.vel.z) : 0;
    this.animator.update(dt, {
      speed,
      run: this.sprinting && alive, // sprint plays the anime run
      crouch: this.crouchBlend,
      aimPitch: camRig.pitch,
      combat: combat && alive,
      recoil: this.recoil * this.recoil, // eased: sharp snap back, quick settle
      kickBack: this.kickDef?.back,
      kickClimb: this.kickDef?.climb,
      lean: this.peek.length() > 0.2 ? -camRig.shoulder * 0.25 : 0,
      lookYaw,
      lower: weaponLower,
      vel: this.vel,
      yaw: this.facing,
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

