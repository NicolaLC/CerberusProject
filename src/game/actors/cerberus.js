import * as THREE from 'three';
import { RigidSkin } from '../../engine/batch.js';
import { disposeTree } from '../../engine/dispose.js';
import { damp, wrapAngle } from '../../engine/math.js';
import { buildCerberus, cerberusMaterials } from './cerberus-model.js';
import { sightRay, rim, PROJECTILE } from './enemy.js';

// CERBERUS: the HiveMind's guardian protocol in one war-body (gdd.md 8.5), met once at the end of the Prologue on the
// Skyway. A colossal war hound (cerberus-model.js, the same body as the title's and the reel's) crouched on a ledge of the tower
// beside the bridge, out of reach, with three heads, one per sub-intelligence: VIGIL (one great sensor eye: sweeping bolt bursts), LEGION (a voice / emitter array: calls drones) and
// COLOSSUS (a heavy jaw cannon: mortar rings). The fight is scripted to be lost: it CANNOT BE DESTROYED.
//
// Health: three heads, each its own segment of the boss bar. A hit chips one head (zone `weak` on its glowing eye / node /
// bore, x3 by the gun); the head repairs back toward full after `repairDelay` s without damage, and never drops below
// `floor` of its health. `damage()` always returns false. The hull and the necks are armored (sparks, no damage) and block
// bullets, so only the heads can be hurt.
//
// Counting: `unkillable = true`. It is in `Enemies.all` (hit meshes, boss bar, camera lock-on) but never counts toward
// destroy objectives (mission.js), `arena:clear` or the HUD kill counter (`Enemies.killable`), so it cannot block a level.
// The drones LEGION calls are ordinary drones in its spawn group (kills count like any drone's).
//
// The volley (the Skyway's loss cut, level.md): a cut shot with `cue: 'volley'` makes all three heads charge together (glow rising for
// `volley.charge` s) and then fire a violet beam each at where the player stands (`volley.beam` s) with a blast there. Visual only (no damage),
// the last of the scripted loss; it also wakes a sleeping CERBERUS.
//
// Same interface as the other bosses (see enemy.js / spider.js): kind 'boss', name, awake, alive, pos, lift, debris,
// hitMeshes, armor(), damage(), focusPoint(), aimPoints(), wake(), update(), dispose(); the HUD's boss bar reads `segments`
// (three { name, value 0..1, floor }) instead of the spider's leg pips.
//
// Frame of the piece: local +Z is where the heads point (yaw 0 faces +Z), `pos` is under it at its feet. About x -10..10,
// z -15..19, y 0..21 around `pos` (TUNING.scale 1.5; footprint in level.md). One RigidSkin draw per material, invisible boxes are the hitboxes.

export const TUNING = {
  name: 'CERBERUS',
  scale: 1.5, // of the shared body (cerberus-model.js, 14 m tall): about 21 m tall, 20 m across the pods here
  head: 1000, // health of each head (the bar segment)
  floor: 0.65, // fraction of a head's health it never drops below (param `floor`)
  repair: 0.08, // of a head's health per second once repairing (param `repair`)
  repairDelay: 1.5, // s without damage before a head starts to repair
  bolt: { charge: 0.9, shots: 8, gap: 0.14, cooldown: [3, 4.5], sweep: 3.2, spread: 0.02, damage: 8 }, // VIGIL: 8 x 8 dmg swept across +-3.2 m
  mortar: { every: [5, 7.5], coverBoost: 1.8, flight: 1.5, radius: 3.8, damage: 30, first: 4 }, // COLOSSUS (spider's lob; faster against a player in cover)
  drones: { max: 3, every: [7, 10], batch: 2, first: 3 }, // LEGION: calls up to `batch` drones when fewer than `max` live
  volley: { charge: 1.5, beam: 0.9, radius: 0.45, blast: 6 }, // the loss cut: s of charging, s of beams, beam radius (m), blast radius (m)
};

const HEADS = [
  { id: 'vigil', name: 'VIGIL' },
  { id: 'legion', name: 'LEGION' },
  { id: 'colossus', name: 'COLOSSUS' },
];
const REST_PITCH = [0.15, 0.1, 0.05]; // heads' pitch at rest (down +)
const GRAVITY = 14;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Vector3();
const _k = new THREE.Vector3();
const _f = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const BLAST = { point: new THREE.Vector3(), radius: 0, kind: '' };
const HITBOX_MAT = new THREE.MeshBasicMaterial(); // never drawn
const ORB_GEO = new THREE.SphereGeometry(0.28, 12, 8);
const ORB_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(PROJECTILE.core).multiplyScalar(5) });
const ORB_GLOW_GEO = new THREE.SphereGeometry(0.6, 12, 8);
const ORB_GLOW_MAT = new THREE.MeshBasicMaterial({ color: PROJECTILE.glow, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
const BEAM_GEO = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0); // unit beam along +Y, scaled to (radius, length, radius)
const BEAM_GLOW_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8c3cff).multiplyScalar(2.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const BEAM_CORE_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2e8ff).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const RING_GEO = new THREE.RingGeometry(0.86, 1, 40);
const RING_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(PROJECTILE.ring).multiplyScalar(2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

export class Cerberus {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.t = TUNING;
    this.kind = 'boss';
    this.name = TUNING.name;
    this.pos = new THREE.Vector3(...def.pos);
    this.yaw = def.yaw ?? 0;
    // where the player can be (targeting, waking); default: a square in front of the heads
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.arena = def.arena ?? { minX: this.pos.x + fx * 14 - 14, maxX: this.pos.x + fx * 14 + 14, minZ: this.pos.z + fz * 14 - 14, maxZ: this.pos.z + fz * 14 + 14 };
    this.floor = THREE.MathUtils.clamp(def.floor ?? TUNING.floor, 0, 1);
    this.repair = Math.max(0, def.repair ?? TUNING.repair);
    this.unkillable = true; // see the header: never counted, never dies
    this.alive = true;
    this.lift = 0;
    this.awake = false;
    this.time = 0;
    this.rise = 0; // 0 folded (dormant) .. 1 heads up (awake)
    this.debris = []; // none: it never breaks (the HUD reads the length)
    this.orbs = [];
    this.drones = []; // the drones LEGION called
    this.vigil = { state: 'idle', timer: 2.5, shots: 0, dir: 1 };
    this.volley = null; // { t, fired, target } while the loss cut's volley runs
    this.beams = []; // [{ glow, core }] per head, built at the first volley
    this.offShot = ctx.events.on('cinematic:shot', (e) => {
      if (e.shot?.cue === 'volley' && !this.volley) this.volley = { t: 0, fired: false, target: new THREE.Vector3(), aimed: false };
    });
    this.mortarTimer = TUNING.mortar.first;
    this.droneTimer = TUNING.drones.first;
    this.heads = HEADS.map((h) => ({ ...h, max: TUNING.head, health: TUNING.head, since: 99, flash: 0, flare: 0, weak: null, muzzle: null, bone: null }));
    this.segments = this.heads.map((h) => ({ name: h.name, value: 1, floor: this.floor })); // the boss bar (hud.js)
    this.maxHealth = TUNING.head * 3;
    this.health = this.maxHealth;

    // ----- the body (cerberus-model.js, shared with the title and the intro reel); invisible boxes are the hitboxes -----
    const M = cerberusMaterials();
    for (const w of M.weak) w.userData.lodGlow = 5; // far LOD: the weak spots stay readable
    M.eye.userData.lodGlow = 3;
    this.mats = M;
    this.matList = [M.shell, M.frame, M.trim, M.eye, ...M.heads, ...M.weak];
    this.hitMeshes = [];
    // `head` set: that head takes damage (`weak`: its weak spot); else it is hull (armor 0)
    const hit = (b, w, h, d, x, y, z, head = null, weak = false) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HITBOX_MAT);
      m.position.set(x, y, z);
      m.visible = false;
      m.userData = { enemy: this, zone: weak ? 'weak' : 'torso', part: head == null ? 'hull' : 'head', head };
      b.add(m);
      this.hitMeshes.push(m);
    };
    const model = buildCerberus(M, { hit });
    this.root = model.root;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.scale.setScalar(TUNING.scale);
    this.hull = model.body;
    this.bodyY = model.body.position.y;
    model.heads.forEach((m, i) => {
      const h = this.heads[i];
      h.bone = m.bone;
      h.muzzle = m.muzzle;
      h.weak = m.weak.children[0];
    });
    this.skeleton = new THREE.Skeleton(model.bones);
    ctx.scene.add(this.root);
    this.#pose(0, null);
    this.skin = new RigidSkin(this.root, this.skeleton, { cullMargin: 1.4, lod: true });
    rim([M.shell, M.frame, M.trim, ...M.heads, this.skin.lodMaterial]);
    ctx.markDirty();
  }

  // Removes it from the scene and frees everything it owns (rig, skin, materials, mortar orbs and rings).
  dispose() {
    for (const o of this.orbs) {
      disposeTree(o.obj);
      disposeTree(o.ring);
    }
    this.orbs.length = 0;
    this.offShot?.();
    for (const b of this.beams) b.glow.removeFromParent(), b.core.removeFromParent(); // shared geometry and materials stay
    this.beams.length = 0;
    disposeTree(this.root);
    for (const m of [...this.matList, this.skin.lodMaterial]) m.dispose();
  }

  // The body and the pods are armor: sparks, no damage, and they block the shot. Only the heads take damage.
  armor(zone, object) {
    return object.userData.part === 'hull' ? 0 : 1;
  }

  // A hit on a head chips it, never below `floor`; it never dies (always false).
  damage(amount, point, dir, zone, object) {
    const i = object?.userData.head;
    if (!this.alive || amount <= 0 || i == null) return false;
    if (!this.awake && !this.dormant) this.#wake();
    const h = this.heads[i];
    h.health = Math.max(Math.min(h.health, this.floor * h.max), h.health - amount);
    h.since = 0;
    h.flash = 0.07;
    return false;
  }

  // What the camera frames while it is engaged: the hull, a bit forward and up so the heads stay in view.
  focusPoint(out) {
    this.hull.getWorldPosition(out);
    out.addScaledVector(_v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 5);
    out.y += 1;
    return out;
  }

  // Aim assist targets: the three glowing weak spots.
  aimPoints(out, n) {
    for (const h of this.heads) {
      if (!out[n]) out[n] = new THREE.Vector3();
      h.weak.getWorldPosition(out[n++]);
    }
    return n;
  }

  // Spawn groups (enemies.js wakeGroup).
  wake() {
    this.dormant = false;
    this.#wake();
  }

  #wake() {
    if (this.awake) return;
    this.awake = true;
    this.ctx.events.emit('boss:wake', this);
  }

  update(dt, player) {
    this.time += dt;
    // each head repairs toward full once it has been left alone for repairDelay s
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      const h = this.heads[i];
      h.since += dt;
      h.flash -= dt;
      h.flare = Math.max(0, h.flare - dt * 2.5);
      if (h.since > TUNING.repairDelay && h.health < h.max) h.health = Math.min(h.max, h.health + this.repair * h.max * dt);
      this.segments[i].value = h.health / h.max;
      sum += h.health;
    }
    this.health = sum;

    // wakes when the player comes into the arena (a dormant one only through wakeGroup)
    if (!this.awake && !this.dormant && !player.dead) {
      const p = player.pos;
      const A = this.arena;
      if (p.x > A.minX && p.x < A.maxX && p.z > A.minZ && p.z < A.maxZ) this.#wake();
    }
    const active = this.awake && !player.dead;
    this.rise += ((this.awake ? 1 : 0) - this.rise) * damp(1.2, dt);
    if (active && !this.ctx.holdFire) {
      this.#bolts(dt, player);
      this.#mortar(dt, player);
      this.#legion(dt, player);
    }
    this.#updateOrbs(dt, player);
    if (this.volley) this.#updateVolley(dt, player);
    this.#pose(dt, active || this.volley ? player : null);

    // looks: hit flash per head, sensors (flare while VIGIL charges), pulsing weak spots
    const M = this.mats;
    for (let i = 0; i < 3; i++) {
      const h = this.heads[i];
      M.heads[i].emissive.setScalar(h.flash > 0 ? 0.6 : 0);
      const pulse = Math.sin(this.time * 8 + i * 2.1);
      M.weak[i].emissiveIntensity = (this.awake ? 2.8 + pulse : 1.6) + h.flare * 6 + (h.flash > 0 ? 2 : 0);
    }
    const charge = this.vigil.state === 'charge' ? 1 - this.vigil.timer / TUNING.bolt.charge : 0;
    M.eye.emissiveIntensity = this.awake ? 0.9 + charge * 9 : 0.3; // at rest dimmer than the weak spots
    this.heads[0].flare = Math.max(this.heads[0].flare, charge);
  }

  // ----- behavior -----

  // The loss cut's volley: the heads charge together, then fire a beam each at the player's place (captured when it starts) and a blast lands.
  #updateVolley(dt, player) {
    const v = this.volley;
    const V = TUNING.volley;
    if (!this.awake) this.#wake();
    if (!v.aimed) {
      player.chest(v.target);
      v.aimed = true;
    }
    v.t += dt;
    if (v.t < V.charge) {
      const k = v.t / V.charge;
      for (const h of this.heads) h.flare = Math.max(h.flare, k);
      return;
    }
    if (!v.fired) {
      v.fired = true;
      BLAST.point.copy(v.target);
      BLAST.radius = V.blast;
      BLAST.kind = 'mortar';
      this.ctx.events.emit('blast', BLAST);
      for (const h of this.heads) h.flare = 1;
      while (this.beams.length < this.heads.length) {
        const glow = new THREE.Mesh(BEAM_GEO, BEAM_GLOW_MAT);
        const core = new THREE.Mesh(BEAM_GEO, BEAM_CORE_MAT);
        glow.frustumCulled = core.frustumCulled = false;
        this.ctx.scene.add(glow, core);
        this.beams.push({ glow, core });
      }
    }
    const age = v.t - V.charge;
    const live = age < V.beam;
    const width = V.radius * (1 - 0.5 * (age / V.beam));
    this.beams.forEach((b, i) => {
      b.glow.visible = b.core.visible = live;
      if (!live) return;
      const from = this.heads[i].muzzle.getWorldPosition(_h);
      _f.subVectors(v.target, from);
      const len = _f.length();
      b.glow.position.copy(from);
      b.core.position.copy(from);
      b.glow.quaternion.setFromUnitVectors(_yAxis, _f.divideScalar(len));
      b.core.quaternion.copy(b.glow.quaternion);
      b.glow.scale.set(width * 2.2, len, width * 2.2);
      b.core.scale.set(width * 0.7, len, width * 0.7);
    });
    if (!live) this.volley = null;
  }

  // VIGIL: a telegraphed burst swept across the player's position (needs line of sight from the eye).
  #bolts(dt, player) {
    const g = this.vigil;
    const b = TUNING.bolt;
    g.timer -= dt;
    if (g.state === 'idle') {
      if (g.timer > 0) return;
      if (this.#sees(player)) {
        g.state = 'charge';
        g.timer = b.charge;
        this.ctx.events.emit('boss:charge', this);
      } else g.timer = 0.5;
    } else if (g.state === 'charge') {
      if (g.timer <= 0) {
        g.state = 'burst';
        g.shots = b.shots;
        g.timer = 0;
        g.dir = -g.dir;
      }
    } else if (g.timer <= 0) {
      const eye = this.heads[0].muzzle.getWorldPosition(_h);
      const target = player.chest(_k);
      const k = 1 - g.shots / b.shots; // 0..1 across the burst
      _f.subVectors(target, eye).normalize();
      _w.set(_f.z, 0, -_f.x).normalize(); // sideways in the view
      const spread = b.spread + eye.distanceTo(target) * 0.002;
      target.addScaledVector(_w, (k * 2 - 1) * g.dir * b.sweep);
      _f.subVectors(target, eye).normalize();
      _f.x += (Math.random() - 0.5) * spread * 2;
      _f.y += (Math.random() - 0.5) * spread * 2;
      _f.z += (Math.random() - 0.5) * spread * 2;
      this.ctx.spawnBolt(eye, _f.normalize(), b.damage);
      g.timer = b.gap;
      if (--g.shots <= 0) {
        g.state = 'idle';
        g.timer = b.cooldown[0] + Math.random() * (b.cooldown[1] - b.cooldown[0]);
      }
    }
  }

  #sees(player) {
    return sightRay(this.heads[0].muzzle.getWorldPosition(_h), player.chest(_k), this.ctx.world.meshes);
  }

  // COLOSSUS: a plasma mortar (the SX-6's lob) at where the player is, a ring on the ground marks the impact. Hiding makes it come sooner.
  #mortar(dt, player) {
    const m = TUNING.mortar;
    this.mortarTimer -= dt * (player.cover ? m.coverBoost : 1);
    if (this.mortarTimer > 0) return;
    this.mortarTimer = m.every[0] + Math.random() * (m.every[1] - m.every[0]);
    const c = this.heads[2];
    const o = this.#orb();
    o.obj.position.copy(c.muzzle.getWorldPosition(_h));
    o.target.copy(player.pos).addScaledVector(player.vel, 0.5); // lead a moving player a little
    o.target.y = this.ctx.world.groundAt(o.target.x, o.target.z, player.pos.y + 0.5);
    o.t = 0;
    o.flight = m.flight;
    o.vel.subVectors(o.target, o.obj.position).divideScalar(m.flight);
    o.vel.y += 0.5 * GRAVITY * m.flight;
    o.ring.position.set(o.target.x, o.target.y + 0.03, o.target.z);
    o.obj.visible = o.ring.visible = true;
    c.flare = 1;
    this.ctx.events.emit('boss:mortar', o.obj.position);
  }

  #orb() {
    let o = this.orbs.find((x) => !x.obj.visible);
    if (o) return o;
    const obj = new THREE.Mesh(ORB_GEO, ORB_MAT);
    obj.add(new THREE.Mesh(ORB_GLOW_GEO, ORB_GLOW_MAT));
    const ring = new THREE.Mesh(RING_GEO, RING_MAT.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(TUNING.mortar.radius);
    this.ctx.scene.add(obj, ring);
    o = { obj, ring, vel: new THREE.Vector3(), target: new THREE.Vector3(), t: 0, flight: 1 };
    this.orbs.push(o);
    return o;
  }

  #updateOrbs(dt, player) {
    const m = TUNING.mortar;
    for (const o of this.orbs) {
      if (!o.obj.visible) continue;
      o.t += dt;
      o.vel.y -= GRAVITY * dt;
      o.obj.position.addScaledVector(o.vel, dt);
      const k = Math.min(1, o.t / o.flight);
      o.ring.material.opacity = 0.25 + 0.5 * k * (0.6 + 0.4 * Math.sin(o.t * 30));
      if (o.t < o.flight) continue;
      o.obj.visible = o.ring.visible = false;
      BLAST.point.copy(o.target);
      BLAST.radius = m.radius;
      BLAST.kind = 'mortar';
      this.ctx.events.emit('blast', BLAST);
      if (player.dead) continue;
      const d = Math.hypot(player.pos.x - o.target.x, player.pos.z - o.target.z);
      if (d > m.radius || Math.abs(player.pos.y - o.target.y) > 2) continue;
      this.ctx.hurtPlayer(m.damage * (1 - 0.5 * (d / m.radius)), o.target);
    }
  }

  // LEGION: while fewer than `max` of its drones live, calls up to `batch` more (ordinary drones of its spawn group, awake,
  // flying over the arena) from under its array.
  #legion(dt, player) {
    const d = TUNING.drones;
    this.droneTimer -= dt;
    if (this.droneTimer > 0) return;
    this.droneTimer = d.every[0] + Math.random() * (d.every[1] - d.every[0]);
    this.drones = this.drones.filter((x) => x.alive && this.ctx.all.includes(x));
    const n = Math.min(d.batch, d.max - this.drones.length);
    if (n <= 0) return;
    const A = this.arena;
    this.heads[1].muzzle.getWorldPosition(_h);
    for (let k = 0; k < n; k++) {
      const x = THREE.MathUtils.clamp(_h.x + (k - (n - 1) / 2) * 3, A.minX + 1, A.maxX - 1);
      const z = THREE.MathUtils.clamp(_h.z, A.minZ + 1, A.maxZ - 1);
      const drone = this.ctx.spawn({ id: 'enemy.drone', pos: [x, this.pos.y, z], params: { group: this.squad ?? undefined, bounds: A } });
      drone.wake();
      this.drones.push(drone);
    }
    this.heads[1].flare = 1;
  }

  // ----- body -----

  // Slow menacing idle: the body breathes and shifts its weight over the planted legs, the heads track the player; dormant, it
  // settles lower with the heads bowed.
  #pose(dt, player) {
    const t = this.time;
    const droop = 1 - this.rise;
    const body = this.hull;
    body.position.y = this.bodyY + Math.sin(t * 0.45) * 0.08 - droop * 0.5;
    body.rotation.set(droop * 0.04 + Math.sin(t * 0.31) * 0.006, Math.sin(t * 0.23) * 0.01, Math.sin(t * 0.4) * 0.006);
    const k = damp(2.5, dt);
    for (let i = 0; i < 3; i++) {
      const h = this.heads[i];
      let wantY = Math.sin(t * 0.37 + i * 2) * 0.05;
      let wantX = REST_PITCH[i] + droop * 0.6;
      if (player) {
        const head = h.bone.getWorldPosition(_h);
        const target = player.chest(_k);
        const toYaw = Math.atan2(target.x - head.x, target.z - head.z);
        wantY = THREE.MathUtils.clamp(wrapAngle(toYaw - this.yaw - body.rotation.y), -1.1, 1.1);
        wantX = THREE.MathUtils.clamp(Math.atan2(head.y - target.y, Math.hypot(target.x - head.x, target.z - head.z)), -0.5, 0.9);
      }
      h.bone.rotation.y += (wantY - h.bone.rotation.y) * k;
      h.bone.rotation.x += (wantX - h.bone.rotation.x) * k;
    }
  }
}
