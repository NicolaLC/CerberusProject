import * as THREE from 'three';
import { RigidSkin } from '../../engine/batch.js';
import { damp, wrapAngle, lerpAngle } from '../../engine/math.js';

// Miniboss: a six-legged spider mech guarding the north-east arena.
// The hull is armored (shots bounce). Each leg has a glowing knee joint: break legs to bring it down.
// Every second destroyed leg collapses it for a few seconds and opens the shutters over its core,
// the only part that takes real damage. Attacks: cannon bursts from the turret, plasma mortars lobbed
// over cover (worse the longer you hide), and a stomp when you get under it.
//
// Same interface as the other enemies (see enemy.js) plus armor(zone, object) and aimPoints(out, n).
// Built from bones like the humanoids: one RigidSkin draw per material, the part meshes stay as hitboxes.

const TUNING = {
  name: 'KR-6 HARVESTER',
  core: 900, // health of the core (the boss dies with it)
  legHealth: 160,
  height: 2.6, // body height standing
  downHeight: 0.85,
  downTime: 7, // s collapsed per two legs lost
  speed: 2.4, // m/s, minus legSlow per lost leg
  legSlow: 0.12,
  range: [11, 20], // keeps this distance to the player
  radius: 3.6, // collision: the whole leg span, not just the hull (legs must not reach into walls)
  wakeRange: 28,
  burst: { charge: 0.7, shots: 6, gap: 0.11, cooldown: [2.2, 3.4], spread: 0.025, damage: 9 },
  mortar: { every: [6, 8.5], coverBoost: 1.8, flight: 1.5, radius: 3.6, damage: 34, minRange: 8 },
  stomp: { range: 6.5, telegraph: 0.75, radius: 7, damage: 24, cooldown: 3 },
};

const LEG = { femur: 2.4, tibia: 3.8, step: 1.3, stepTime: 0.3, stepHeight: 0.7, lead: 0.35 };
const HIPS = [[1.25, 1.2], [1.45, 0], [1.25, -1.2]]; // [|x|, z] on the hull, front to back
const REST = [[3.3, 2.9], [4.0, 0], [3.3, -2.9]]; // foot rest offsets in the body's space
// north-east arena (world.js): the boss stays inside, and wakes when the player walks in
export const ARENA = { minX: 25, maxX: 49.5, minZ: -61.5, maxZ: -14.5 };

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Vector3();
const _k = new THREE.Vector3();
const _f = new THREE.Vector3();
const _c = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster();
const BLAST = { point: new THREE.Vector3(), radius: 0, kind: '' };
const STEP = { point: new THREE.Vector3(), big: false };

export class SpiderMech {
  constructor(sys, def) {
    this.sys = sys;
    this.t = TUNING;
    this.kind = 'boss';
    this.name = TUNING.name;
    this.pos = new THREE.Vector3(...def.pos);
    this.yaw = def.yaw ?? 0;
    this.maxHealth = this.health = TUNING.core;
    this.alive = true;
    this.lift = 0;
    this.awake = false;
    this.down = 0; // > 0: collapsed, core exposed (seconds left)
    this.height = 1.4; // dormant: crouched
    this.vel = new THREE.Vector3();
    this.strafe = 1;
    this.strafeTimer = 4;
    this.flash = 0;
    this.time = 0;
    this.gun = { state: 'idle', timer: 2, shots: 0 };
    this.mortarTimer = 4;
    this.stomp = { state: 'idle', timer: 0 };
    this.debris = [];
    this.deadTime = 0;
    this.orbs = [];

    const M = {
      hull: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.45, metalness: 0.65 }),
      plate: new THREE.MeshStandardMaterial({ color: 0xc8781e, roughness: 0.5, metalness: 0.35 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3020, emissiveIntensity: 1 }),
      weak: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 }),
    };
    M.weak.userData.lodGlow = 5; // far LOD: knees and core stay readable
    M.eye.userData.lodGlow = 3;
    this.mats = M;

    // ----- bones + parts -----
    this.root = new THREE.Group();
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const bones = [];
    const bone = (parent, x = 0, y = 0, z = 0) => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      parent.add(b);
      bones.push(b);
      return b;
    };
    this.hitMeshes = [];
    const part = (b, w, h, d, mat, x, y, z, zone, partId) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      m.userData = { enemy: this, zone, part: partId };
      b.add(m);
      this.hitMeshes.push(m);
      return m;
    };

    this.body = bone(this.root, 0, this.height, 0);
    part(this.body, 2.6, 0.8, 3.2, M.hull, 0, 0, 0, 'torso', 'hull');
    part(this.body, 2.2, 0.35, 2.6, M.hull, 0, -0.55, 0, 'torso', 'hull'); // belly
    part(this.body, 2.8, 0.14, 1.2, M.plate, 0, 0.42, 0.9, 'torso', 'hull'); // front armor
    part(this.body, 0.5, 0.5, 0.6, M.hull, 0, 0.1, -1.85, 'torso', 'hull'); // tail
    for (const s of [1, -1]) {
      part(this.body, 0.12, 0.6, 2.9, M.plate, s * 1.33, 0, 0, 'torso', 'hull'); // side skirts
      for (const [hx, hz] of HIPS) part(this.body, 0.5, 0.5, 0.5, M.hull, s * hx, -0.1, hz, 'torso', 'hull'); // hip mounts
    }
    // core on the back, under two armored shutters
    this.core = part(this.body, 0.9, 0.3, 0.9, M.weak, 0, 0.45, -0.75, 'weak', 'core');
    this.shutters = [1, -1].map((s) => {
      const b = bone(this.body, s * 0.62, 0.62, -0.75);
      part(b, 0.64, 0.12, 1.15, M.plate, -s * 0.32, 0, 0, 'torso', 'hull');
      b.userData.side = s;
      return b;
    });
    // turret: twin cannons and the eye
    this.turret = bone(this.body, 0, 0.62, 0.95);
    part(this.turret, 1.4, 0.6, 1.3, M.hull, 0, 0.2, 0, 'torso', 'hull');
    part(this.turret, 1.0, 0.12, 0.06, M.eye, 0, 0.25, 0.66, 'torso', 'hull');
    for (const s of [1, -1]) part(this.turret, 0.16, 0.16, 1.4, M.hull, s * 0.38, 0.12, 1.2, 'torso', 'hull');
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.12, 1.95);
    this.turret.add(this.muzzle);

    // legs: femur and tibia bones are posed by IK every frame (root space)
    this.legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? 1 : -1; // +X = the mech's left
      const row = i % 3;
      const femur = bone(this.root);
      const tibia = bone(this.root);
      const id = i;
      part(femur, 0.32, LEG.femur, 0.36, M.hull, 0, LEG.femur / 2, 0, 'limb', id);
      part(femur, 0.36, LEG.femur * 0.6, 0.12, M.plate, 0, LEG.femur * 0.5, 0.2, 'limb', id);
      const knee = part(tibia, 0.42, 0.42, 0.42, M.weak, 0, 0, 0, 'weak', id);
      part(tibia, 0.24, LEG.tibia, 0.26, M.hull, 0, LEG.tibia / 2, 0, 'limb', id);
      part(tibia, 0.4, 0.25, 0.4, M.plate, 0, LEG.tibia, 0, 'limb', id); // foot
      const hip = new THREE.Vector3(side * HIPS[row][0], -0.1, HIPS[row][1]);
      const rest = new THREE.Vector3(side * REST[row][0], 0, REST[row][1]);
      const foot = this.root.localToWorld(rest.clone());
      foot.y = sys.world.groundAt(foot.x, foot.z, foot.y + 2);
      this.legs.push({
        side, row, femur, tibia, knee, hip, rest, foot,
        group: (row + (side > 0 ? 0 : 1)) % 2, // tripod gait: two alternating groups of three
        from: new THREE.Vector3(), to: new THREE.Vector3(), stepT: -1,
        health: TUNING.legHealth, alive: true,
      });
    }
    this.skeleton = new THREE.Skeleton(bones);
    sys.scene.add(this.root);
    this.#pose(0);
    this.skin = new RigidSkin(this.root, this.skeleton, { cullMargin: 1.6, lod: true });
    sys.dirty = true;
  }

  get legsLost() {
    let n = 0;
    for (const l of this.legs) if (!l.alive) n++;
    return n;
  }

  // Damage multiplier for a hit on this object: the hull and closed core shrug shots off.
  armor(zone, object) {
    const p = object.userData.part;
    if (p === 'hull') return 0;
    if (p === 'core') return this.down > 0 ? 1 : 0;
    return 1;
  }

  // Returns true if this hit destroyed it.
  damage(amount, point, dir, zone, object) {
    if (!this.alive || amount <= 0) return false;
    this.flash = 0.06;
    if (!this.awake) this.#wake();
    const p = object?.userData.part;
    if (p === 'core') {
      this.health -= amount;
      if (this.health <= 0) {
        this.#die(dir);
        return true;
      }
      return false;
    }
    if (typeof p === 'number') {
      const leg = this.legs[p];
      if (!leg.alive) return false;
      leg.health -= amount;
      if (leg.health <= 0) this.#breakLeg(leg, dir);
    }
    return false;
  }

  // What the camera frames while the boss is engaged: the body, a bit low so the legs stay in view.
  focusPoint(out) {
    this.body.getWorldPosition(out);
    out.y -= 0.6;
    return out;
  }

  // Aim assist targets: knees and the exposed core.
  aimPoints(out, n) {
    for (const l of this.legs) {
      if (!l.alive) continue;
      if (!out[n]) out[n] = new THREE.Vector3();
      l.knee.getWorldPosition(out[n++]);
    }
    if (this.down > 0) {
      if (!out[n]) out[n] = new THREE.Vector3();
      this.core.getWorldPosition(out[n++]);
    }
    return n;
  }

  #wake() {
    if (this.awake) return;
    this.awake = true;
    this.sys.events.emit('boss:wake', this);
  }

  #breakLeg(leg, dir) {
    leg.alive = false;
    this.root.updateMatrixWorld(true);
    leg.knee.getWorldPosition(BLAST.point);
    BLAST.radius = 2;
    BLAST.kind = 'leg';
    this.sys.events.emit('boss:leg', BLAST);
    for (const b of [leg.femur, leg.tibia]) {
      for (const m of b.children) this.#debris(m, dir);
      b.scale.setScalar(1e-4); // hides its skinned parts
    }
    this.hitMeshes = this.hitMeshes.filter((m) => m.userData.part !== this.legs.indexOf(leg));
    this.sys.dirty = true;
    // every second leg lost brings it down (a mech with no legs left stays down)
    const lost = this.legsLost;
    if (lost % 2 === 0 || lost >= 5) {
      this.down = lost >= 6 ? Infinity : this.t.downTime;
      this.gun.state = 'idle';
      this.gun.timer = 1.5;
      this.stomp.state = 'idle';
      this.sys.events.emit('boss:down', this);
    }
  }

  #debris(m, dir) {
    if (!m.isMesh) return;
    const d = new THREE.Mesh(m.geometry, m.material);
    m.matrixWorld.decompose(d.position, d.quaternion, d.scale);
    d.castShadow = true;
    this.sys.scene.add(d);
    const v = dir.clone().multiplyScalar(3 + Math.random() * 3);
    v.y += 3 + Math.random() * 3;
    v.x += (Math.random() - 0.5) * 3;
    v.z += (Math.random() - 0.5) * 3;
    const av = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
    this.debris.push({ obj: d, v, av, life: 6 });
  }

  #die(dir) {
    this.alive = false;
    this.health = 0;
    this.sys.kills++;
    this.sys.dirty = true;
    this.root.updateMatrixWorld(true);
    this.core.getWorldPosition(BLAST.point);
    BLAST.radius = 6;
    BLAST.kind = 'death';
    this.sys.events.emit('boss:dead', BLAST);
    this.sys.events.emit('puppet:down', this);
    if (this.sys.kills === this.sys.puppets.length) this.sys.events.emit('arena:clear');
    for (const m of this.hitMeshes) this.#debris(m, dir);
    this.root.visible = false;
    for (const o of this.orbs) o.obj.visible = o.ring.visible = false;
  }

  update(dt, player) {
    this.time += dt;
    this.#updateDebris(dt);
    if (!this.alive) return;

    // wake when the player comes into the arena (or close with line of sight)
    if (!this.awake && !player.dead) {
      const p = player.pos;
      const inArena = p.x > ARENA.minX && p.x < ARENA.maxX && p.z > ARENA.minZ && p.z < ARENA.maxZ;
      if (inArena || (p.distanceTo(this.pos) < this.t.wakeRange && this.#sees(player))) this.#wake();
    }

    const active = this.awake && !player.dead;
    if (this.down > 0) this.down -= dt;
    const isDown = this.down > 0;
    if (active && !isDown) {
      this.#move(dt, player);
      this.#cannon(dt, player);
      this.#mortar(dt, player);
      this.#stomp(dt, player);
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    }
    this.#updateOrbs(dt, player);

    // body height: dormant crouch, standing, collapsed; stomp rears up then slams
    let want = this.awake ? this.t.height - this.legsLost * 0.08 : 1.5;
    if (isDown) want = this.t.downHeight;
    if (this.stomp.state === 'rear') want += 0.7;
    const rate = isDown ? 7 : this.stomp.state === 'slam' ? 30 : 3;
    this.height += (want - this.height) * damp(rate, dt);

    // turret tracks the player; the body slowly turns toward them
    const target = player.chest(_v);
    const toYaw = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    if (active && !isDown) this.yaw = lerpAngle(this.yaw, toYaw, damp(0.9, dt));
    const tYaw = active ? wrapAngle(toYaw - this.yaw) : 0;
    this.turret.rotation.y += (THREE.MathUtils.clamp(tYaw, -1.6, 1.6) - this.turret.rotation.y) * damp(isDown ? 1 : 5, dt);
    const muzzleY = this.pos.y + this.height + 0.75;
    const pitch = Math.atan2(target.y - muzzleY, Math.hypot(target.x - this.pos.x, target.z - this.pos.z));
    this.turret.rotation.x += (THREE.MathUtils.clamp(-pitch, -0.5, 0.6) - this.turret.rotation.x) * damp(5, dt);
    // shutters open while down
    for (const s of this.shutters) {
      const open = isDown ? 1.35 : 0;
      s.rotation.z += (open * s.userData.side - s.rotation.z) * damp(6, dt);
    }

    this.#pose(dt);

    // looks: eye charge, hit flash, pulsing weak spots
    this.flash -= dt;
    const e = this.flash > 0 ? 0.6 : 0;
    this.mats.hull.emissive.setScalar(e);
    this.mats.plate.emissive.setScalar(e);
    const charge = this.gun.state === 'charge' ? 1 - this.gun.timer / this.t.burst.charge : 0;
    this.mats.eye.emissiveIntensity = this.awake ? 1.5 + charge * 10 : 0.3;
    this.mats.weak.emissiveIntensity = (isDown ? 4 : 2.4) + Math.sin(this.time * (isDown ? 14 : 8)) * 1.4;
  }

  // ----- behavior -----

  #move(dt, player) {
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const [near, far] = this.t.range;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafe = -this.strafe;
      this.strafeTimer = 4 + Math.random() * 3;
    }
    // close in, back off, otherwise circle the player
    const radial = dist > far ? 1 : dist < near ? -1 : 0;
    _w.set((dx / dist) * radial - (dz / dist) * this.strafe * 0.7, 0, (dz / dist) * radial + (dx / dist) * this.strafe * 0.7);
    if (_w.lengthSq() > 1) _w.normalize();
    const speed = this.t.speed * (1 - this.legsLost * this.t.legSlow);
    const k = damp(2, dt);
    this.vel.x += (_w.x * speed - this.vel.x) * k;
    this.vel.z += (_w.z * speed - this.vel.z) * k;
    const before = _v.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    this.sys.world.collideCircle(this.pos, this.t.radius, 2.4, 1.3); // walks over low cover, not through walls
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, ARENA.minX + this.t.radius, ARENA.maxX - this.t.radius);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, ARENA.minZ + this.t.radius, ARENA.maxZ - this.t.radius);
    // blocked: turn around
    if (before.distanceTo(this.pos) < this.vel.length() * dt * 0.3 && this.vel.lengthSq() > 0.5) {
      this.strafe = -this.strafe;
      this.strafeTimer = 3;
    }
  }

  #sees(player) {
    this.muzzle.getWorldPosition(_h);
    const to = player.chest(_k).sub(_h);
    const len = to.length();
    _ray.set(_h, to.divideScalar(len));
    _ray.far = Math.max(0.01, len - 0.5);
    return _ray.intersectObjects(this.sys.world.meshes, false).length === 0;
  }

  #cannon(dt, player) {
    const g = this.gun;
    const b = this.t.burst;
    g.timer -= dt;
    if (g.state === 'idle') {
      if (g.timer <= 0) {
        if (this.#sees(player)) {
          g.state = 'charge';
          g.timer = b.charge;
          this.sys.events.emit('boss:charge', this);
        } else g.timer = 0.5;
      }
    } else if (g.state === 'charge') {
      if (g.timer <= 0) {
        g.state = 'burst';
        g.shots = b.shots;
        g.timer = 0;
      }
    } else if (g.timer <= 0) {
      this.muzzle.getWorldPosition(_h);
      const target = player.chest(_k);
      const spread = b.spread + _h.distanceTo(target) * 0.004;
      _f.subVectors(target, _h).normalize();
      _f.x += (Math.random() - 0.5) * spread * 2;
      _f.y += (Math.random() - 0.5) * spread * 2;
      _f.z += (Math.random() - 0.5) * spread * 2;
      // alternate barrels
      _h.addScaledVector(_w.set(Math.cos(this.yaw + this.turret.rotation.y), 0, -Math.sin(this.yaw + this.turret.rotation.y)), g.shots % 2 ? 0.38 : -0.38);
      this.sys.spawnBolt(_h, _f.normalize(), b.damage);
      g.timer = b.gap;
      if (--g.shots <= 0) {
        g.state = 'idle';
        g.timer = b.cooldown[0] + Math.random() * (b.cooldown[1] - b.cooldown[0]);
      }
    }
  }

  // Plasma mortar: lobbed at where the player is; a ring on the ground marks the impact.
  #mortar(dt, player) {
    const m = this.t.mortar;
    // hiding makes it come sooner: cover doesn't help against a lob
    this.mortarTimer -= dt * (player.cover ? m.coverBoost : 1);
    if (this.mortarTimer > 0) return;
    this.mortarTimer = m.every[0] + Math.random() * (m.every[1] - m.every[0]);
    if (player.pos.distanceTo(this.pos) < m.minRange) return;
    const o = this.#orb();
    this.root.updateMatrixWorld(true);
    o.obj.position.set(this.pos.x, this.pos.y + this.height + 1.2, this.pos.z);
    // lead a moving player a little
    o.target.copy(player.pos).addScaledVector(player.vel, 0.5);
    o.target.y = this.sys.world.groundAt(o.target.x, o.target.z, player.pos.y + 0.5);
    o.t = 0;
    o.flight = m.flight;
    o.vel.subVectors(o.target, o.obj.position).divideScalar(m.flight);
    o.vel.y += 0.5 * GRAVITY * m.flight;
    o.ring.position.set(o.target.x, o.target.y + 0.03, o.target.z);
    o.obj.visible = o.ring.visible = true;
    this.sys.events.emit('boss:mortar', o.obj.position);
  }

  #orb() {
    let o = this.orbs.find((x) => !x.obj.visible);
    if (o) return o;
    const obj = new THREE.Mesh(ORB_GEO, ORB_MAT);
    obj.add(new THREE.Mesh(ORB_GLOW_GEO, ORB_GLOW_MAT));
    const ring = new THREE.Mesh(RING_GEO, RING_MAT.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(this.t.mortar.radius);
    this.sys.scene.add(obj, ring);
    o = { obj, ring, vel: new THREE.Vector3(), target: new THREE.Vector3(), t: 0, flight: 1 };
    this.orbs.push(o);
    return o;
  }

  #updateOrbs(dt, player) {
    const m = this.t.mortar;
    for (const o of this.orbs) {
      if (!o.obj.visible) continue;
      o.t += dt;
      o.vel.y -= GRAVITY * dt;
      o.obj.position.addScaledVector(o.vel, dt);
      const k = Math.min(1, o.t / o.flight);
      o.ring.material.opacity = 0.25 + 0.5 * k * (0.6 + 0.4 * Math.sin(o.t * 30));
      if (o.t < o.flight) continue;
      o.obj.visible = o.ring.visible = false;
      this.#blast(o.target, m.radius, m.damage, player, 'mortar');
    }
  }

  #stomp(dt, player) {
    const s = this.stomp;
    const st = this.t.stomp;
    s.timer -= dt;
    const near = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) < st.range;
    if (s.state === 'idle') {
      if (near && s.timer <= 0) {
        s.state = 'rear';
        s.timer = st.telegraph;
        this.sys.events.emit('boss:stomp', this);
      }
    } else if (s.state === 'rear') {
      if (s.timer <= 0) {
        s.state = 'slam';
        s.timer = 0.25;
      }
    } else if (s.state === 'slam') {
      if (s.timer <= 0) {
        s.state = 'idle';
        s.timer = st.cooldown;
        _v.set(this.pos.x, this.pos.y, this.pos.z);
        this.#blast(_v, st.radius, st.damage, player, 'stomp');
      }
    }
  }

  #blast(point, radius, damage, player, kind) {
    BLAST.point.copy(point);
    BLAST.radius = radius;
    BLAST.kind = kind;
    this.sys.events.emit('blast', BLAST);
    if (player.dead) return;
    const d = Math.hypot(player.pos.x - point.x, player.pos.z - point.z);
    if (d > radius || Math.abs(player.pos.y - point.y) > 2) return;
    this.sys.hurtPlayer(damage * (1 - 0.5 * (d / radius)), point);
  }

  // ----- body + legs -----

  #pose(dt) {
    const root = this.root;
    root.position.copy(this.pos);
    root.rotation.y = this.yaw;
    // tilt toward lost legs (and settle on what's left)
    let roll = 0;
    let pitch = 0;
    for (const l of this.legs) {
      if (l.alive) continue;
      roll += l.side * 0.07;
      pitch += (l.row - 1) * -0.06;
    }
    this.body.position.y = this.height;
    this.body.rotation.set(pitch, 0, roll);
    root.updateMatrixWorld(true);

    // gait: a foot steps when it trails too far from its rest spot and the other tripod is planted
    const world = this.sys.world;
    let stepping = -1;
    for (const l of this.legs) if (l.alive && l.stepT >= 0) stepping = l.group;
    for (const l of this.legs) {
      if (!l.alive) continue;
      const home = root.localToWorld(_h.copy(l.rest));
      home.addScaledVector(this.vel, LEG.lead);
      // never plant a foot in or on a wall: pull it in toward the body until the way is clear
      _c.set(this.pos.x, this.pos.y, this.pos.z);
      for (let f = 0.8; f > 0.2 && !world.segmentClear(_c, home, 0.3, 1.3, 3); f -= 0.2) home.lerpVectors(_c, home, f / (f + 0.2));
      home.y = world.groundAt(home.x, home.z, this.pos.y + 1.5);
      if (l.stepT < 0) {
        const far = Math.hypot(home.x - l.foot.x, home.z - l.foot.z) > (this.down > 0 ? 3 : LEG.step);
        if (far && (stepping < 0 || stepping === l.group) && dt > 0) {
          l.stepT = 0;
          l.from.copy(l.foot);
          l.to.copy(home);
          stepping = l.group;
        }
      }
      if (l.stepT >= 0) {
        l.stepT = Math.min(1, l.stepT + dt / LEG.stepTime);
        const e = l.stepT * l.stepT * (3 - 2 * l.stepT);
        l.foot.lerpVectors(l.from, l.to, e);
        l.foot.y += Math.sin(Math.PI * l.stepT) * LEG.stepHeight;
        if (l.stepT >= 1) {
          l.stepT = -1;
          STEP.point.copy(l.foot);
          STEP.big = this.stomp.state === 'slam';
          this.sys.events.emit('boss:step', STEP);
        }
      }
      // IK: hip -> knee (bends up and out) -> foot
      const hip = this.body.localToWorld(_h.copy(l.hip));
      const d = _f.subVectors(l.foot, hip);
      const dist = THREE.MathUtils.clamp(d.length(), 0.3, LEG.femur + LEG.tibia - 0.01);
      d.normalize();
      const a = LEG.femur;
      const b = LEG.tibia;
      const cosA = THREE.MathUtils.clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      // bend direction: up, a little outward
      _w.set(Math.cos(this.yaw) * l.side * 0.15, 1, -Math.sin(this.yaw) * l.side * 0.15);
      _w.addScaledVector(d, -_w.dot(d)).normalize();
      const knee = _k.copy(hip).addScaledVector(d, a * cosA).addScaledVector(_w, a * sinA);
      const reach = _v.copy(hip).addScaledVector(d, dist);
      placeBone(l.femur, root, hip, knee);
      placeBone(l.tibia, root, knee, reach, true);
    }
    root.updateMatrixWorld(true);
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
      d.obj.rotation.y += d.av.y * dt;
      d.obj.rotation.z += d.av.z * dt;
      const g = world.groundAt(d.obj.position.x, d.obj.position.z, d.obj.position.y + 0.3) + 0.1;
      if (d.obj.position.y < g) {
        d.obj.position.y = g;
        d.v.y *= -0.3;
        d.v.x *= 0.6;
        d.v.z *= 0.6;
        d.av.multiplyScalar(0.6);
      }
      if (d.life < 1) d.obj.scale.multiplyScalar(1 - dt * 3);
      if (d.life <= 0) {
        this.sys.scene.remove(d.obj);
        this.debris[i] = this.debris[this.debris.length - 1];
        this.debris.pop();
      }
    }
  }
}

const GRAVITY = 14;
const ORB_GEO = new THREE.SphereGeometry(0.28, 12, 8);
const ORB_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a2a).multiplyScalar(5) });
const ORB_GLOW_GEO = new THREE.SphereGeometry(0.6, 12, 8);
const ORB_GLOW_MAT = new THREE.MeshBasicMaterial({ color: 0xff5010, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
const RING_GEO = new THREE.RingGeometry(0.86, 1, 40);
const RING_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a20).multiplyScalar(2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

// Puts a segment bone (child of `root`, +Y along the segment) at world `a`, pointing at world `b`.
// The tibia is authored from the knee (y = 0) down, so it points from the knee to the foot.
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
function placeBone(bone, root, a, b) {
  const la = root.worldToLocal(_pa.copy(a));
  bone.position.copy(la);
  const lb = root.worldToLocal(_pb.copy(b)).sub(la).normalize();
  bone.quaternion.setFromUnitVectors(_yAxis, lb);
}
