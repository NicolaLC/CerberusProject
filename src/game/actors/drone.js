import * as THREE from 'three';
import { RigidSkin } from '../../engine/batch.js';
import { disposeTree } from '../../engine/dispose.js';
import { damp } from '../../engine/math.js';
import { rb, cyl, ring, look } from './parts.js';
import { sightRay, rim, VISOR } from './enemy.js';
import { wornMaterial } from '../world/textures.js';
import { BoneRig, pickLook } from './skeleton.js';

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
const DEBRIS = { push: [0, 0], spread: 6, up: [2, 4], spin: 12, life: 4 }; // see DebrisBank.burst; no dir: it bursts where it lands
const BLAST = { point: new THREE.Vector3(), radius: 1.5, kind: 'drone' };

// rotor positions [x, z] on the body
export const ROTORS = [[0.6, 0.55], [-0.6, 0.55], [0.6, -0.55], [-0.6, -0.55]];

// Skeleton (skeleton.js): the body tilts, the four rotors spin. Animation touches these bones by name; looks only add meshes to them.
export const BONES = {
  Body: { parent: null, pos: [0, 0, 0] },
  ...Object.fromEntries(ROTORS.map(([x, z], i) => [`Rotor${i}`, { parent: 'Body', pos: [x, 0.12, z] }])),
};
const ZONE = (zone) => ({ zone });
// invisible hit boxes: [bone, w, h, d, x, y, z, userData, opts]
const HITS = [
  ['Body', 0.7, 0.32, 0.8, 0, 0, 0, ZONE('torso')],
  ['Body', 0.5, 0.1, 0.5, 0, 0.2, -0.05, ZONE('torso')],
  ['Body', 0.42, 0.1, 0.05, 0, 0.02, 0.41, ZONE('head')], // sensor
  ['Body', 0.3, 0.08, 0.3, 0, -0.2, 0, ZONE('weak')], // core underneath
  ['Body', 0.08, 0.08, 0.35, 0, -0.1, 0.5, ZONE('torso')], // gun
  ...ROTORS.flatMap(([x, z], i) => [
    ['Body', Math.hypot(x, z), 0.06, 0.08, x / 2, 0.05, z / 2, ZONE('torso'), { rotY: Math.atan2(-z, x) }], // arm: from the center out to the rotor
    [`Rotor${i}`, 0.62, 0.02, 0.07, 0, 0, 0, ZONE('torso')],
  ]),
];

// The skeleton with its hit boxes and the muzzle socket, no look yet.
export function buildDroneSkeleton(owner = null) {
  const rig = new BoneRig(BONES, { owner });
  rig.hits(HITS);
  rig.socket('Body', 'muzzle', 0, -0.1, 0.72);
  return rig;
}

export function droneMaterials() {
  const M = {
    shell: wornMaterial(0xa9aca7, { roughness: 0.78, metalness: 0.2 }), // pale worn grey plates (art-style.md: the HiveMind livery)
    plate: wornMaterial(0x34383c, { roughness: 0.6, metalness: 0.55, wear: 'metal' }), // dark grey frame, ducts, gun
    eye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: VISOR, emissiveIntensity: 1.2 }), // violet lens rings
    weak: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 }),
  };
  M.weak.userData.lodGlow = 5;
  M.eye.userData.lodGlow = 4;
  return M;
}

// The drone's look without bones or hitboxes: `body` parts (in the body bone's space; [hull, sensor, gun, core, ...rotor
// mounts], the title's far drones take the hull and the core) and `blades()` (one rotor's, in its own space).
// A few big parts (CERBERUS's language, cerberus-model.js): a rounded pale pod on a dark frame, one round lens ringed in violet,
// a slung cannon, the glowing core underneath, four ducted rotors.
export function droneLook(M) {
  const R = Math.PI / 2;
  const body = [
    look(
      rb(M.shell, 0.62, 0.3, 0.76, 0.14, 0, 0.02, -0.02), // pod
      rb(M.plate, 0.5, 0.12, 0.6, 0.05, 0, -0.14, -0.02), // frame under it
      rb(M.plate, 0.64, 0.04, 0.06, 0.02, 0, 0.12, 0.05), // groove across the top
    ),
    look(
      cyl(M.plate, 0.15, 0.15, 0.08, 0, 0.02, 0.38, R, 0, 0, 20), // lens housing
      cyl(M.plate, 0.1, 0.1, 0.02, 0, 0.02, 0.425, R, 0, 0, 20),
      ring(M.eye, 0.085, 0.012, 0, 0.02, 0.43), // violet ring
      cyl(M.eye, 0.025, 0.025, 0.02, 0, 0.02, 0.43, R, 0, 0, 10), // pupil
    ),
    look(
      cyl(M.plate, 0.035, 0.035, 0.42, 0, -0.1, 0.5, R, 0, 0, 10), // barrel
      cyl(M.plate, 0.05, 0.05, 0.08, 0, -0.1, 0.68, R, 0, 0, 10), // muzzle brake
    ),
    look(
      cyl(M.plate, 0.19, 0.17, 0.05, 0, -0.2, 0, 0, 0, 0, 16), // core housing
      cyl(M.weak, 0.14, 0.12, 0.08, 0, -0.22, 0, 0, 0, 0, 16), // core
    ),
  ];
  for (const [x, z] of ROTORS) {
    body.push(
      look(
        rb(M.plate, Math.hypot(x, z) - 0.1, 0.05, 0.07, 0.02, x * 0.5, 0.05, z * 0.5, 0, Math.atan2(-z, x), 0), // strut
        cyl(M.plate, 0.06, 0.06, 0.12, x, 0.07, z, 0, 0, 0, 12), // motor
        ring(M.shell, 0.29, 0.035, x, 0.12, z, R, 0, 0), // duct
      ),
    );
  }
  const blades = () =>
    look(
      rb(M.plate, 0.52, 0.012, 0.06, 0.006, 0, 0, 0, 0.15, 0, 0),
      rb(M.plate, 0.06, 0.012, 0.52, 0.006, 0, 0, 0, 0, 0, 0.15),
    );
  return { body, blades };
}

// Looks: variants of the same skeleton. A look only adds meshes to the bones (setPart / attach), nothing else.
export const droneLooks = {
  default(rig, M) {
    const L = droneLook(M);
    L.body.forEach((g, i) => (i ? rig.attach('Body', g) : rig.setPart('Body', g)));
    ROTORS.forEach((_, i) => rig.setPart(`Rotor${i}`, L.blades()));
  },
};

export class Drone {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.t = TUNING;
    this.kind = 'drone';
    this.pos = new THREE.Vector3(...def.pos);
    this.home = this.pos.clone();
    this.alt = TUNING.hover[0] + Math.random() * (TUNING.hover[1] - TUNING.hover[0]);
    this.yaw = def.yaw ?? 0;
    this.bounds = def.bounds ?? TUNING.bounds; // { minX, maxX, minZ, maxZ }: where it may fly (CERBERUS passes its arena; levels leave it)
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

    const M = droneMaterials();
    this.mats = M;

    // skeleton + look (see skeleton.js); hit boxes are invisible, the look is separate
    this.rig = buildDroneSkeleton(this);
    pickLook(droneLooks, def.look, 'enemy.drone')(this.rig, M);
    this.debrisKind = !def.look || def.look === 'default' ? this.kind : `${this.kind}.${def.look}`; // debris chunks are baked per look
    this.root = this.rig.root;
    this.skeleton = this.rig.skeleton;
    this.hitMeshes = this.rig.hitMeshes;
    this.body = this.rig.bones.Body;
    this.muzzle = this.rig.sockets.muzzle;
    this.rotors = ROTORS.map((_, i) => this.rig.bones[`Rotor${i}`]);
    ctx.scene.add(this.root);
    this.#place();
    this.skin = new RigidSkin(this.root, this.skeleton, { cullMargin: 1.5, lod: true });
    rim([M.shell, M.plate, this.skin.lodMaterial]);
    ctx.debris.prime(this.debrisKind, this.skin);
    ctx.markDirty();
  }

  // Removes the drone from the scene and frees everything it owns.
  dispose() {
    this.ctx.debris.releaseAll(this.debris);
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

  // Spawn groups (enemies.js wakeGroup).
  wake() {
    if (!this.alive) return;
    this.dormant = false;
    this.awake = true;
  }

  // Recalled (Enemies.recall): flies along `path` (Vector3 list), ignoring the player; `recalled` at its end (Enemies removes it).
  recall(path) {
    if (!this.alive) return;
    this.dormant = false;
    this.awake = false;
    this.recallPath = path.slice();
  }

  // Returns true if this hit destroyed it.
  damage(amount, point, dir, zone) {
    if (!this.alive || this.falling) return false;
    this.health -= amount;
    this.flash = 0.08;
    if (!this.dormant) this.awake = true;
    // knocked by the hit
    this.vel.addScaledVector(dir, 2.5);
    this.tilt.x += dir.z * 0.4;
    this.tilt.y -= dir.x * 0.4;
    if (this.health > 0) return false;
    // shot down: counts now, tumbles, bursts when it lands
    this.alive = false;
    this.falling = { vel: this.vel.clone().addScaledVector(dir, 4).setY(1.5), spin: (Math.random() - 0.5) * 16 };
    this.ctx.reportKill(this);
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
    if (!this.awake && !this.dormant && !player.dead && dist < this.t.sight && this.#sees(eye)) this.awake = true;
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
    this.mats.eye.emissiveIntensity = (this.awake ? 1.2 : 0.6) + charge * 8; // at rest dimmer than the weak core
    this.mats.weak.emissiveIntensity = 3 + Math.sin(this.time * 9) * 1.0;
  }

  #move(dt, player, active) {
    const t = this.t;
    _a.set(0, 0, 0);
    if (this.recallPath) {
      const goal = this.recallPath[0];
      if (!goal) this.recalled = true;
      else {
        _a.subVectors(goal, this.pos).setY(0);
        const left = _a.length();
        if (left < 1) this.recallPath.shift();
        _a.multiplyScalar(t.speed * 1.4 / Math.max(left, 0.01));
      }
    } else if (active) {
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
    const b = this.bounds;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, b.minX, b.maxX);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, b.minZ, b.maxZ);
    const world = this.ctx.world;
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
    return sightRay(this.muzzle.getWorldPosition(_b), target, this.ctx.world.meshes);
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
      this.ctx.spawnBolt(_b, _w.normalize(), b.damage);
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
    const g = this.ctx.world.groundAt(this.root.position.x, this.root.position.z, this.root.position.y + 0.5);
    if (this.root.position.y > g + 0.3) return;
    // burst on impact
    BLAST.point.copy(this.root.position);
    this.ctx.events.emit('blast', BLAST);
    this.ctx.debris.burst(this.debrisKind, this.skin, this.ctx.scene, this.debris, DEBRIS);
    this.root.visible = false;
    this.falling = null;
  }

  #updateDebris(dt) {
    if (this.debris.length) this.ctx.debris.step(this.debris, dt, this.ctx.world);
  }
}
