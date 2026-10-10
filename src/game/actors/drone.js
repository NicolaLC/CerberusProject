import * as THREE from 'three';
import { RigidSkin } from '../../engine/batch.js';
import { disposeTree } from '../../engine/dispose.js';
import { damp } from '../../engine/math.js';
import { rb, cyl, ring, look, debrisCopy, disposeDebris } from './parts.js';

// Attack drone: a small quad-rotor that hovers 3.5-5 m up, circles the player at range and fires short bolt
// bursts. Light (dies fast) but hard to hit while it strafes; the glowing core underneath is its weak spot.
// Shot down, it tumbles and bursts on the ground.
//
// Same interface as the other enemies (see enemy.js) plus aimPoints(out, n). `pos` is on the ground under it
// (pickups drop there); the body flies at pos.y + alt.

export const TUNING = {
  health: 55,
  hover: [3.5, 5], // m above the ground
  range: [9, 18], // keeps this distance to the player
  speed: 5.5,
  accel: 3,
  sight: 36, // wakes at this range with line of sight
  burst: { aim: 0.45, shots: 2, gap: 0.16, cooldown: [1.6, 2.8], spread: 0.03, damage: 6 },
  radius: 0.6,
  floorMin: 2, // m: boxes narrower than this (walls, parapets) don't lift the flight height, wide ones (platforms) do
  bounds: { minX: -48, maxX: 48, minZ: -60, maxZ: 48 },
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const BLAST = { point: new THREE.Vector3(), radius: 1.5, kind: 'drone' };
const HITBOX_MAT = new THREE.MeshBasicMaterial(); // never drawn

export class Drone {
  constructor(sys, def) {
    this.sys = sys;
    this.t = TUNING;
    this.kind = 'drone';
    this.pos = new THREE.Vector3(...def.pos);
    this.home = this.pos.clone();
    this.alt = TUNING.hover[0] + Math.random() * (TUNING.hover[1] - TUNING.hover[0]);
    this.yaw = def.yaw ?? 0;
    this.maxHealth = this.health = TUNING.health;
    this.alive = true;
    this.lift = 0;
    this.awake = false;
    this.vel = new THREE.Vector3();
    this.orbit = Math.random() < 0.5 ? 1 : -1;
    this.orbitTimer = 2 + Math.random() * 3;
    this.time = Math.random() * 10;
    this.flash = 0;
    this.gun = { state: 'idle', timer: 1 + Math.random(), shots: 0 };
    this.tilt = new THREE.Vector2();
    this.falling = null; // { vel, spin } once shot down
    this.debris = [];

    const M = {
      shell: new THREE.MeshStandardMaterial({ color: 0x464c55, roughness: 0.4, metalness: 0.65 }),
      plate: new THREE.MeshStandardMaterial({ color: 0xc8781e, roughness: 0.5, metalness: 0.35 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3020, emissiveIntensity: 2 }),
      weak: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 }),
    };
    M.weak.userData.lodGlow = 5;
    M.eye.userData.lodGlow = 4;
    this.mats = M;

    // bones: the body (tilts) and four rotors (spin). Invisible boxes are the hitboxes; the look is separate.
    this.root = new THREE.Group();
    const bones = [];
    const bone = (parent, x = 0, y = 0, z = 0) => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      parent.add(b);
      bones.push(b);
      return b;
    };
    this.hitMeshes = [];
    const hitbox = (b, w, h, d, x, y, z, zone) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HITBOX_MAT);
      m.position.set(x, y, z);
      m.visible = false; // not drawn, still raycast
      m.userData = { enemy: this, zone };
      b.add(m);
      this.hitMeshes.push(m);
      return m;
    };
    this.body = bone(this.root);
    hitbox(this.body, 0.7, 0.32, 0.8, 0, 0, 0, 'torso');
    hitbox(this.body, 0.5, 0.1, 0.5, 0, 0.2, -0.05, 'torso');
    hitbox(this.body, 0.42, 0.1, 0.05, 0, 0.02, 0.41, 'head'); // sensor
    hitbox(this.body, 0.3, 0.08, 0.3, 0, -0.2, 0, 'weak'); // core underneath
    hitbox(this.body, 0.08, 0.08, 0.35, 0, -0.1, 0.5, 'torso'); // gun
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, -0.1, 0.72);
    this.body.add(this.muzzle);
    this.rotors = [];
    const R = Math.PI / 2;
    const ROTORS = [[0.6, 0.55], [-0.6, 0.55], [0.6, -0.55], [-0.6, -0.55]];
    for (const [x, z] of ROTORS) {
      const arm = hitbox(this.body, Math.hypot(x, z), 0.06, 0.08, x / 2, 0.05, z / 2, 'torso');
      arm.rotation.y = Math.atan2(-z, x); // from the center out to the rotor
      const r = bone(this.body, x, 0.12, z);
      hitbox(r, 0.62, 0.02, 0.07, 0, 0, 0, 'torso');
      this.rotors.push(r);
    }

    // look: armored pod with an orange spine plate, a lens cluster in front, a slung cannon, the glowing core
    // underneath, four ducted rotors on struts
    this.body.add(
      look(
        rb(M.shell, 0.62, 0.26, 0.74, 0.09, 0, 0, 0), // hull
        rb(M.shell, 0.5, 0.12, 0.6, 0.05, 0, -0.14, -0.02), // belly
        rb(M.plate, 0.44, 0.07, 0.52, 0.03, 0, 0.15, -0.05), // spine plate
        rb(M.shell, 0.05, 0.075, 0.5, 0.015, 0.1, 0.16, -0.05), // plate stripes
        rb(M.shell, 0.05, 0.075, 0.5, 0.015, -0.1, 0.16, -0.05),
        rb(M.plate, 0.64, 0.05, 0.1, 0.02, 0, 0.06, 0.3), // front bumper
        rb(M.shell, 0.18, 0.1, 0.12, 0.03, 0, 0.12, -0.38), // rear sensor block
        cyl(M.shell, 0.006, 0.006, 0.26, 0.12, 0.28, -0.38, -0.35, 0, 0, 5), // antennas
        cyl(M.shell, 0.006, 0.006, 0.2, -0.12, 0.25, -0.38, -0.35, 0, 0, 5),
      ),
      look(
        cyl(M.shell, 0.13, 0.15, 0.1, 0, 0.02, 0.38, R, 0, 0, 16), // lens housing
        cyl(M.eye, 0.085, 0.085, 0.02, 0, 0.02, 0.435, R, 0, 0, 16), // main lens
        cyl(M.eye, 0.028, 0.028, 0.02, 0.19, 0.05, 0.37, R, 0, 0, 10), // side eyes
        cyl(M.eye, 0.028, 0.028, 0.02, -0.19, 0.05, 0.37, R, 0, 0, 10),
        cyl(M.eye, 0.018, 0.018, 0.02, 0.19, -0.02, 0.37, R, 0, 0, 8),
        cyl(M.eye, 0.018, 0.018, 0.02, -0.19, -0.02, 0.37, R, 0, 0, 8),
      ),
      look(
        rb(M.shell, 0.12, 0.08, 0.16, 0.02, 0, -0.17, 0.3), // gun mount
        cyl(M.shell, 0.032, 0.036, 0.4, 0, -0.1, 0.5, R, 0, 0, 10), // barrel
        cyl(M.plate, 0.045, 0.045, 0.06, 0, -0.1, 0.66, R, 0, 0, 10), // muzzle brake
        cyl(M.shell, 0.042, 0.042, 0.02, 0, -0.1, 0.42, R, 0, 0, 10),
      ),
      look(
        cyl(M.shell, 0.19, 0.17, 0.05, 0, -0.2, 0, 0, 0, 0, 16), // core housing
        cyl(M.weak, 0.14, 0.12, 0.08, 0, -0.22, 0, 0, 0, 0, 16), // core
      ),
    );
    for (const [x, z] of ROTORS) {
      this.body.add(
        look(
          rb(M.shell, Math.hypot(x, z) - 0.1, 0.05, 0.07, 0.02, x * 0.5, 0.05, z * 0.5, 0, Math.atan2(-z, x), 0), // strut
          cyl(M.shell, 0.055, 0.065, 0.14, x, 0.07, z, 0, 0, 0, 12), // motor
          cyl(M.plate, 0.067, 0.067, 0.02, x, 0.04, z, 0, 0, 0, 12),
          ring(M.shell, 0.29, 0.025, x, 0.12, z, R, 0, 0), // duct
          ring(M.plate, 0.29, 0.012, x, 0.155, z, R, 0, 0), // duct rim
          cyl(M.eye, 0.016, 0.016, 0.016, x * 1.39, 0.12, z * 1.39, 0, 0, 0, 8), // nav light
        ),
      );
    }
    for (const r of this.rotors) {
      r.add(
        look(
          rb(M.shell, 0.52, 0.012, 0.06, 0.006, 0, 0, 0, 0.15, 0, 0), // blades
          rb(M.shell, 0.06, 0.012, 0.52, 0.006, 0, 0, 0, 0, 0, 0.15),
          cyl(M.plate, 0.035, 0.035, 0.03, 0, 0.01, 0, 0, 0, 0, 10), // hub
        ),
      );
    }
    this.skeleton = new THREE.Skeleton(bones);
    sys.scene.add(this.root);
    this.#place();
    this.skin = new RigidSkin(this.root, this.skeleton, { cullMargin: 1.5, lod: true });
    sys.dirty = true;
  }

  // Removes the drone from the scene and frees everything it owns.
  dispose() {
    for (const d of this.debris) disposeDebris(d.obj);
    this.debris.length = 0;
    disposeTree(this.root);
    for (const m of [...Object.values(this.mats), this.skin.lodMaterial]) m.dispose();
  }

  // Aim assist target: the body.
  aimPoints(out, n) {
    if (this.falling) return n;
    if (!out[n]) out[n] = new THREE.Vector3();
    this.body.getWorldPosition(out[n++]);
    return n;
  }

  // Returns true if this hit destroyed it.
  damage(amount, point, dir, zone) {
    if (!this.alive || this.falling) return false;
    this.health -= amount;
    this.flash = 0.08;
    this.awake = true;
    // knocked by the hit
    this.vel.addScaledVector(dir, 2.5);
    this.tilt.x += dir.z * 0.4;
    this.tilt.y -= dir.x * 0.4;
    if (this.health > 0) return false;
    // shot down: counts now, tumbles, bursts when it lands
    this.alive = false;
    this.sys.kills++;
    this.sys.dirty = true;
    this.falling = { vel: this.vel.clone().addScaledVector(dir, 4).setY(1.5), spin: (Math.random() - 0.5) * 16 };
    this.sys.events.emit('puppet:down', this);
    if (this.sys.kills === this.sys.puppets.length) this.sys.events.emit('arena:clear');
    return true;
  }

  update(dt, player) {
    this.time += dt;
    this.#updateDebris(dt);
    if (this.falling) {
      this.#fall(dt);
      return;
    }
    if (!this.alive) return;
    const eye = player.chest(_v);
    const body = this.body.getWorldPosition(_w);
    const dist = body.distanceTo(eye);
    if (!this.awake && !player.dead && dist < this.t.sight && this.#sees(eye)) this.awake = true;
    const active = this.awake && !player.dead;
    this.#move(dt, player, active);
    if (active) this.#shoot(dt, player);

    // face the player when awake, else drift with the movement
    const want = active ? Math.atan2(eye.x - this.pos.x, eye.z - this.pos.z) : this.yaw;
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * damp(5, dt);
    this.#place();

    this.flash -= dt;
    const e = this.flash > 0 ? 0.9 : 0;
    this.mats.shell.emissive.setScalar(e);
    this.mats.plate.emissive.setScalar(e);
    this.skin.lodMaterial.emissive.setScalar(e);
    const charge = this.gun.state === 'aim' ? 1 - this.gun.timer / this.t.burst.aim : 0;
    this.mats.eye.emissiveIntensity = (this.awake ? 2 : 0.8) + charge * 8;
    this.mats.weak.emissiveIntensity = 2.4 + Math.sin(this.time * 9) * 1.2;
  }

  #move(dt, player, active) {
    const t = this.t;
    _a.set(0, 0, 0);
    if (active) {
      const dx = player.pos.x - this.pos.x;
      const dz = player.pos.z - this.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      this.orbitTimer -= dt;
      if (this.orbitTimer <= 0) {
        this.orbit = -this.orbit;
        this.orbitTimer = 2.5 + Math.random() * 3;
      }
      const radial = dist > t.range[1] ? 1 : dist < t.range[0] ? -1 : 0;
      _a.set((dx / dist) * radial - (dz / dist) * this.orbit, 0, (dz / dist) * radial + (dx / dist) * this.orbit);
      if (_a.lengthSq() > 1) _a.normalize();
      _a.multiplyScalar(t.speed);
    } else {
      // idle: lazy circle around home
      _a.set(Math.cos(this.time * 0.4) * 1.2, 0, Math.sin(this.time * 0.4) * 1.2).add(this.home).sub(this.pos).multiplyScalar(0.8);
    }
    const k = damp(t.accel, dt);
    this.vel.x += (_a.x - this.vel.x) * k;
    this.vel.z += (_a.z - this.vel.z) * k;
    this.vel.y = 0;
    const prevX = this.pos.x;
    const prevZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // stay outdoors, inside the yard, and out of walls at flight height
    const b = t.bounds;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, b.minX, b.maxX);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, b.minZ, b.maxZ);
    const world = this.sys.world;
    const ground = world.groundAt(this.pos.x, this.pos.z, this.pos.y + this.alt, 0, TUNING.floorMin);
    _b.set(this.pos.x, ground + this.alt - 0.3, this.pos.z);
    if (world.isInterior(_b)) {
      this.pos.x = prevX;
      this.pos.z = prevZ;
      this.vel.x = -this.vel.x;
      this.vel.z = -this.vel.z;
      this.orbit = -this.orbit;
    } else {
      world.collideCircle(_b, t.radius, 0.6, 0);
      this.pos.x = _b.x;
      this.pos.z = _b.z;
    }
    this.pos.y += (world.groundAt(this.pos.x, this.pos.z, this.pos.y + this.alt, 0, TUNING.floorMin) - this.pos.y) * damp(3, dt);
    // banking into the movement
    const lx = this.vel.x * Math.cos(this.yaw) - this.vel.z * Math.sin(this.yaw);
    const lz = this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw);
    this.tilt.x += (lz * 0.06 - this.tilt.x) * damp(4, dt);
    this.tilt.y += (-lx * 0.06 - this.tilt.y) * damp(4, dt);
  }

  #sees(target) {
    this.muzzle.getWorldPosition(_b);
    _w.subVectors(target, _b);
    const len = _w.length();
    _ray.set(_b, _w.divideScalar(len));
    _ray.far = Math.max(0.01, len - 0.5);
    return _ray.intersectObjects(this.sys.world.meshes, false).length === 0;
  }

  #shoot(dt, player) {
    const g = this.gun;
    const b = this.t.burst;
    g.timer -= dt;
    if (g.timer > 0) return;
    const target = player.chest(_v);
    if (g.state === 'idle') {
      if (this.pos.distanceTo(player.pos) < this.t.sight && this.#sees(target)) {
        g.state = 'aim';
        g.timer = b.aim;
      } else g.timer = 0.4;
    } else if (g.state === 'aim') {
      g.state = 'fire';
      g.shots = b.shots;
      g.timer = 0;
    } else {
      this.muzzle.getWorldPosition(_b);
      const spread = b.spread + _b.distanceTo(target) * 0.006;
      _w.subVectors(target, _b).normalize();
      _w.x += (Math.random() - 0.5) * spread * 2;
      _w.y += (Math.random() - 0.5) * spread * 2;
      _w.z += (Math.random() - 0.5) * spread * 2;
      this.sys.spawnBolt(_b, _w.normalize(), b.damage);
      g.timer = b.gap;
      if (--g.shots <= 0) {
        g.state = 'idle';
        g.timer = b.cooldown[0] + Math.random() * (b.cooldown[1] - b.cooldown[0]);
      }
    }
  }

  #place() {
    this.root.position.set(this.pos.x, this.pos.y + this.alt + Math.sin(this.time * 2.1) * 0.12, this.pos.z);
    this.root.rotation.set(0, this.yaw, 0);
    this.body.rotation.set(this.tilt.x, 0, this.tilt.y);
    for (let i = 0; i < 4; i++) this.rotors[i].rotation.y = this.time * (i % 2 ? 40 : -40);
    this.root.updateMatrixWorld(true);
  }

  #fall(dt) {
    const f = this.falling;
    f.vel.y -= 16 * dt;
    this.root.position.addScaledVector(f.vel, dt);
    this.root.rotation.y += f.spin * dt;
    this.body.rotation.x += f.spin * 0.3 * dt;
    this.root.updateMatrixWorld(true);
    const g = this.sys.world.groundAt(this.root.position.x, this.root.position.z, this.root.position.y + 0.5);
    if (this.root.position.y > g + 0.3) return;
    // burst on impact
    BLAST.point.copy(this.root.position);
    this.sys.events.emit('blast', BLAST);
    for (const bone of this.skeleton.bones) {
      for (const piece of bone.children) {
        if (piece.isBone) continue;
        const d = debrisCopy(piece);
        if (!d) continue;
        this.sys.scene.add(d);
        const v = new THREE.Vector3((Math.random() - 0.5) * 6, 2 + Math.random() * 4, (Math.random() - 0.5) * 6);
        const av = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
        this.debris.push({ obj: d, v, av, life: 4 });
      }
    }
    this.root.visible = false;
    this.falling = null;
  }

  #updateDebris(dt) {
    if (!this.debris.length) return;
    const world = this.sys.world;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.v.y -= 18 * dt;
      d.obj.position.addScaledVector(d.v, dt);
      d.obj.rotation.x += d.av.x * dt;
      d.obj.rotation.z += d.av.z * dt;
      const g = world.groundAt(d.obj.position.x, d.obj.position.z, d.obj.position.y + 0.3) + 0.05;
      if (d.obj.position.y < g) {
        d.obj.position.y = g;
        d.v.y *= -0.3;
        d.v.x *= 0.6;
        d.v.z *= 0.6;
        d.av.multiplyScalar(0.6);
      }
      if (d.life < 1) d.obj.scale.multiplyScalar(1 - dt * 3);
      if (d.life <= 0) {
        disposeDebris(d.obj);
        this.debris[i] = this.debris[this.debris.length - 1];
        this.debris.pop();
      }
    }
  }
}
