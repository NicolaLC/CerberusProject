import * as THREE from 'three';
import { Rig, Animator } from './rig.js';
import { GUNS } from '../combat/guns.js';
import { buildSoldier } from './soldier.js';
import { damp, lerpAngle, wrapAngle } from '../../engine/math.js';
import { RigidSkin, mergeGroup } from '../../engine/batch.js';

const STEP = { run: false, raised: false }; // player:step payload (reused)

// The player character: movement, collision, cover state machine, health; drives its rig animator.
// Reads intents from Controls; reports what happened through events ('player:coverSlam', 'player:land',
// 'player:jet', 'player:vault').
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _o = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _n = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _move = { x: 0, y: 0 };
const _jet = { point: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0) }; // 'player:jet' payload (reused)

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
  coverReach: 2.2, // run-in vault probe distance
  autoCoverReach: 0.35, // m beyond the body radius: pushing into a cover face this close snaps into cover
  autoCoverCooldown: 0.4, // s after leaving cover before it can grab again
  coverEdgeExit: 0.15, // s of pushing along the cover while stopped at its end before walking on past it
  maxShields: 100,
  maxHealth: 100,
  shieldDelay: 3.5,
  shieldRate: 45,
  healthDelay: 6,
  healthRate: 12,
};

// Vaulting low cover: blocks up to `hopDepth` deep are jumped, deeper ones slid across on the hip.
// Space while running (> runIn m/s) straight at low cover within runInReach m vaults without stopping.
// While sliding the player can aim and shoot (Vanquish style): the hips keep the slide pose and direction, the spine
// twists toward the camera yaw by at most `twist` rad (the gun can't follow further), `tail` s after the slide the
// twist is still passed on so it unwinds in step with the body turning to the camera. `fovEase` (1/s) smooths
// `player.sliding` (0..1, read by the camera for the wider FOV).
const VAULT = { hopDepth: 1.2, hopTime: 0.5, slideTime: 0.3, slideSpeed: 5.5, runIn: 3.5, runInReach: 2.2, twist: 1.2, tail: 0.25, fovEase: 20 };

// Jump = a short jetpack burst, not a real jump. Thrust lifts vy linearly to `lift` over `thrust` s (gravity is
// ignored meanwhile), then `gravity` x normal pulls back (floaty). Peak ~1.46 m: enough to land on low cover.
// `boost` m/s is added along the move input at take-off; in the air movement eases at `airAccel` (ground: accel).
// `cooldown` s counts from take-off, and the player must be on the ground (so it is ready ~at landing).
const JET = { thrust: 0.22, lift: 5.5, gravity: 0.8, boost: 1.5, airAccel: 4, cooldown: 0.9, nozzleUp: 1.2, nozzleBack: 0.25 };

// High cover corner peek: sideways weight shift (m) and torso lean (rad, split over the spine).
const PEEK = { shift: 0.2, lean: 0.6 };

export class Player {
  // spawn: { pos: [x, y, z], yaw } from the level file
  constructor({ scene, world, events, spawn }) {
    this.scene = scene;
    this.world = world;
    this.events = events;
    this.t = TUNING;
    this.spawn = new THREE.Vector3(...spawn.pos);
    this.spawnYaw = spawn.yaw;
    this.pos = this.spawn.clone();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.facing = spawn.yaw;
    this.crouchBlend = 0;
    this.crouched = false;
    this.aiming = false;
    this.sprinting = false;
    this.recoil = 0;
    this.lastShot = 99;
    this.cover = null; // { normal, tangent, type, edgeL, edgeR }
    this.snap = null; // smooth move into cover / vault
    this.sliding = 0; // 0..1 eased: the hip slide over deep low cover (the camera widens its FOV)
    this.slideTail = 99; // seconds since a slide ended (the torso twist unwinds for VAULT.tail s)
    this.airborne = false; // jetpack burst: true from take-off until landed
    this.jetting = 0; // seconds of thrust left
    this.jetTimer = 0; // seconds until the next burst is allowed
    this.coverTimer = 0; // seconds until auto cover may grab again
    this.edgeTime = 0; // seconds pushing along cover while stopped at its end
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

  // In cover and moving along it (not shooting): hunched run facing the travel direction.
  coverMoving() {
    return !!this.cover && !this.aiming && this.lastShot >= 0.6 && this.vel.x * this.vel.x + this.vel.z * this.vel.z > 0.6;
  }

  // True during the hip slide over deep low cover: aiming and shooting stay available.
  isSliding() {
    return this.snap?.vault === 'slide';
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
    this.pos.copy(this.spawn);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.airborne = false;
    this.jetting = 0;
    this.cover = null;
    this.snap = null;
    this.sliding = 0;
    this.slideTail = 99;
    this.peek.set(0, 0, 0);
    this.shields = this.t.maxShields;
    this.health = this.t.maxHealth;
    this.dead = false;
    this.facing = this.spawnYaw;
    this.root.rotation.set(0, this.facing, 0);
  }

  // Puts the player at another level's spawn ({ pos, yaw }) with a clean slate (no cover, full health).
  place(spawn) {
    this.spawn.set(...spawn.pos);
    this.spawnYaw = spawn.yaw;
    this.respawn();
    this.crouched = false;
    this.crouchBlend = 0;
    this.aiming = false;
    this.sprinting = false;
    this.recoil = 0;
    this.lastShot = 99;
    this.sinceHit = 99;
    this.coverTimer = 0;
    this.jetTimer = 0;
    this.edgeTime = 0;
    this.deadTime = 0;
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

    // the re-entry cooldown only runs once out of cover (held full while in it)
    this.coverTimer = this.cover ? t.autoCoverCooldown : Math.max(0, this.coverTimer - dt);
    this.jetTimer = Math.max(0, this.jetTimer - dt);
    const slide = this.isSliding();
    this.sliding += ((slide ? 1 : 0) - this.sliding) * damp(VAULT.fovEase, dt);
    this.slideTail = slide ? 0 : this.slideTail + dt;

    if (this.dead) {
      this.airborne = false;
      this.jetting = 0;
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
    this.aiming = controls.aiming && (!this.snap || slide) && !this.pinned;
    if (weapon.firing) this.lastShot = 0;
    // sprint: forward only, not while aiming, shooting or in cover; pulling the trigger ends it
    this.sprinting = controls.running && ax.y > 0 && !this.aiming && !this.airborne && !this.cover && !this.snap && !controls.firing && this.lastShot > t.sprintCooldown;
    const combat = this.aiming || this.lastShot < 0.6;

    // ----- smooth snap (enter cover / vault) -----
    if (this.snap) {
      const s = this.snap;
      s.t = Math.min(1, s.t + dt / s.dur);
      // a slide keeps its momentum (linear); cover entry and the hop ease in and out
      const e = s.vault === 'slide' ? s.t : s.t * s.t * (3 - 2 * s.t);
      this.pos.x = THREE.MathUtils.lerp(s.from.x, s.to.x, e);
      this.pos.z = THREE.MathUtils.lerp(s.from.z, s.to.z, e);
      const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight);
      // slide: up onto the top, across it on the hip, down the far side; hop: one arc
      const lift = s.vault === 'slide' ? (s.t < 0.2 ? Math.sin((s.t / 0.2) * Math.PI * 0.5) : s.t > 0.8 ? Math.cos(((s.t - 0.8) / 0.2) * Math.PI * 0.5) : 1) : Math.sin(Math.PI * s.t);
      // vault height from the take-off and landing floors (not the floor underneath: that's the block's top)
      this.pos.y = s.hop ? THREE.MathUtils.lerp(s.from.y, s.toY ?? s.from.y, e) + lift * s.hop : ground;
      if (s.vault) {
        this.facing = lerpAngle(this.facing, s.yaw, damp(20, dt)); // turn into the vault
      }
      if (s.t >= 1) {
        this.snap = null;
        if (s.hop) this.events.emit('player:land', 'vault');
        else this.events.emit('player:coverSlam');
        this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight);
      }
      this.#animate(dt, rig, 1, weapon.lowered());
      return;
    }

    // ----- cover -----

    const grounded = !this.airborne && this.vy === 0;
    if (controls.jumpPressed) {
      let done = false;
      if (this.cover) {
        const into = -wish.dot(this.cover.normal);
        done = this.cover.type === 'low' && into > 0.5 && this.#tryVault(this.cover.normal, this.cover.collider, this.t.radius + 0.05);
      } else if (grounded && this.vel.x * this.vel.x + this.vel.z * this.vel.z > VAULT.runIn * VAULT.runIn && wish.lengthSq() > 0.1) {
        // running straight at low cover: vault it in one go instead of stopping behind it
        const c = this.#castCover(_n.copy(wish).normalize(), t.coverReach);
        const dist = c ? _v.subVectors(this.pos, c.point).dot(c.normal) : 0;
        done = !!c && c.type === 'low' && -wish.dot(c.normal) > 0.7 && dist < VAULT.runInReach && this.#tryVault(c.normal, c.collider, dist);
      }
      if (!done && grounded && this.jetTimer <= 0) this.#jetBurst(wish);
    }

    // auto cover: pushing into a cover face from free, grounded movement snaps to it
    if (!this.snap && !this.cover && grounded && this.coverTimer <= 0 && wish.lengthSq() > 0.09) {
      const c = this.#castCover(_n.copy(wish).normalize(), t.radius + t.autoCoverReach);
      if (c && -_n.dot(c.normal) > 0.6) {
        // sprinting at low cover: leave room for the run-in vault (Space) until we are touching it
        const fast = this.vel.x * this.vel.x + this.vel.z * this.vel.z > VAULT.runIn * VAULT.runIn;
        if (!(c.type === 'low' && fast && _v.subVectors(this.pos, c.point).dot(c.normal) > t.radius + 0.1)) this.#enterCover(c);
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
    else if (this.coverMoving()) targetFacing = Math.atan2(this.vel.x, this.vel.z); // moving along cover: turn into the move
    else if (this.cover) targetFacing = Math.atan2(this.cover.normal.x, this.cover.normal.z); // back to the wall
    else if (this.vel.lengthSq() > 0.2) targetFacing = Math.atan2(this.vel.x, this.vel.z);
    this.facing = lerpAngle(this.facing, targetFacing, damp(combat ? 25 : 12, dt));

    // crouch: only behind low cover when not shooting
    this.crouched = !!this.cover && this.cover.type === 'low' && !combat;

    // peek: high cover edge lean when aiming
    // the camera swaps shoulder only for the peek; the player's chosen shoulder comes back afterwards
    const peekTarget = _v.set(0, 0, 0);
    rig.peekSide = 0;
    if (this.cover && this.cover.type === 'high' && combat) {
      const tr = this.cover.tangent; // points toward camera right
      let side = 0;
      if (rig.shoulder > 0) side = this.cover.edgeR ? 1 : this.cover.edgeL ? -1 : 0;
      else side = this.cover.edgeL ? -1 : this.cover.edgeR ? 1 : 0;
      if (side !== 0) {
        rig.peekSide = side;
        // the feet stay behind cover: a short weight shift, then the torso leans out (rig lean) to clear the edge
        peekTarget.copy(tr).multiplyScalar(side * PEEK.shift).addScaledVector(this.cover.normal, 0.1);
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
    const k = damp(this.airborne ? JET.airAccel : t.accel, dt);
    this.vel.x += (wish.x * speed - this.vel.x) * k;
    this.vel.z += (wish.z * speed - this.vel.z) * k;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.#collide();

    const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight, t.radius * 0.5);
    if (this.airborne || this.pos.y > ground + 0.01) {
      if (this.jetting > 0) {
        this.jetting = Math.max(0, this.jetting - dt);
        this.vy = Math.min(JET.lift, this.vy + (JET.lift / JET.thrust) * dt);
      } else this.vy -= t.gravity * (this.airborne ? JET.gravity : 1) * dt;
      const before = this.pos.y;
      this.pos.y += this.vy * dt;
      if (this.vy > 0) this.#ceiling(before);
      if (this.pos.y <= ground && this.vy <= 0) {
        this.pos.y = ground;
        this.vy = 0;
        if (this.airborne) {
          this.airborne = false;
          this.events.emit('player:land', 'jet');
        }
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

    if (wish.dot(c.normal) > 0.5) {
      this.cover = null; // moving away (also a diagonal push back) leaves cover
      return;
    }

    const along = this.aiming && c.type === 'high' ? 0 : wish.dot(c.tangent);
    const speed = this.aiming ? t.aimWalk : t.coverSlide;
    const step = along * speed * dt;
    const before = _prev.copy(this.pos);
    if (Math.abs(step) > 1e-4) {
      const next = _v.copy(this.pos).addScaledVector(c.tangent, step);
      const hit = this.#coverHitAt(next, c.normal);
      const margin = _r.copy(next).addScaledVector(c.tangent, Math.sign(step) * 0.2);
      if (hit && this.#coverHitAt(margin, c.normal)) {
        this.pos.x = hit.point.x + c.normal.x * (t.radius + 0.05);
        this.pos.z = hit.point.z + c.normal.z * (t.radius + 0.05);
      }
    }
    // stopped at the end of the cover and still pushing along it: walk on past the end (not while aiming: peek)
    const blocked = Math.abs(step) > 1e-4 && before.distanceToSquared(this.pos) < 1e-8;
    this.edgeTime = blocked && !this.aiming && Math.abs(wish.dot(c.tangent)) > 0.3 ? this.edgeTime + dt : 0;
    if (this.edgeTime >= t.coverEdgeExit) {
      this.cover = null;
      this.edgeTime = 0;
      return;
    }
    // real slide velocity (eased like free movement), so the legs step along the wall and settle at its end
    const k = damp(t.accel, dt);
    this.vel.x += ((this.pos.x - before.x) / dt - this.vel.x) * k;
    this.vel.z += ((this.pos.z - before.z) / dt - this.vel.z) * k;
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

  // First cover face along horizontal direction d (unit) within `reach` m of the body center, facing us.
  // Must not allocate unless it finds something.
  #castCover(d, reach) {
    _ray.set(_o.set(this.pos.x, this.pos.y + 0.5, this.pos.z), d);
    _ray.far = reach;
    const hit = _ray.intersectObjects(this.world.coverMeshes, false)[0];
    if (!hit || !hit.face) return null;
    const n = hit.face.normal;
    if (Math.abs(n.y) > 0.3 || n.dot(d) > -0.5) return null;
    // something solid between us and the cover? (another collider)
    _ray.far = hit.distance;
    const block = _ray.intersectObjects(this.world.meshes, false)[0];
    if (block && block.object !== hit.object && block.distance < hit.distance - 0.05) return null;
    const col = hit.object.userData.collider;
    const type = col.box.max.y - this.pos.y < 1.7 ? 'low' : 'high';
    return { point: hit.point, normal: n.clone(), type, collider: col };
  }

  // Jetpack burst: leave cover, start the thrust, a small push along the move input.
  #jetBurst(wish) {
    this.cover = null;
    this.airborne = true;
    this.jetting = JET.thrust;
    this.jetTimer = JET.cooldown;
    this.vy = 0;
    this.vel.x += wish.x * JET.boost;
    this.vel.z += wish.z * JET.boost;
    const sn = Math.sin(this.facing);
    const cs = Math.cos(this.facing);
    _jet.point.set(this.pos.x - sn * JET.nozzleBack, this.pos.y + JET.nozzleUp, this.pos.z - cs * JET.nozzleBack);
    this.events.emit('player:jet', _jet);
  }

  // Rising head stops under a box that was above it (building ceilings, roofs): clamp and cancel the thrust.
  #ceiling(prevY) {
    const r = this.t.radius;
    const h = this.t.standHeight;
    for (const c of this.world.colliders) {
      const b = c.box;
      if (b.min.y < prevY + h - 0.05 || b.min.y >= this.pos.y + h) continue;
      if (this.pos.x < b.min.x - r || this.pos.x > b.max.x + r || this.pos.z < b.min.z - r || this.pos.z > b.max.z + r) continue;
      this.pos.y = b.min.y - h;
      this.vy = 0;
      this.jetting = 0;
    }
  }

  #enterCover(c) {
    const to = c.point.clone().addScaledVector(c.normal, this.t.radius + 0.05);
    to.y = this.pos.y;
    this.snap = { from: this.pos.clone(), to, t: 0, dur: Math.max(0.12, to.distanceTo(this.pos) / 9), hop: 0 };
    this.cover = { normal: c.normal, tangent: new THREE.Vector3(), type: c.type, collider: c.collider, edgeL: false, edgeR: false };
    this.vel.set(0, 0, 0);
  }

  // Over low cover, from `dist` m in front of its face (normal toward us). Across the short side (thin
  // block) it's a jump; along the long side (deep block) a slide over the top on the hip. False if blocked.
  #tryVault(normal, collider, dist) {
    const b = collider.box;
    const depth = Math.abs(normal.x) > 0.5 ? b.max.x - b.min.x : b.max.z - b.min.z;
    const to = this.pos.clone().addScaledVector(normal, -(dist + depth + this.t.radius + 0.25));
    // landing spot must be free
    const r = this.t.radius;
    for (const col of this.world.colliders) {
      const bb = col.box;
      if (bb.max.y <= this.pos.y + this.t.stepHeight || bb.min.y > this.pos.y + 1.8) continue;
      if (to.x > bb.min.x - r && to.x < bb.max.x + r && to.z > bb.min.z - r && to.z < bb.max.z + r) return false;
    }
    const slide = depth > VAULT.hopDepth;
    to.y = this.world.groundAt(to.x, to.z, this.pos.y + this.t.stepHeight);
    this.cover = null;
    this.crouched = false; // leaving low cover: the crouch would sink the hips into the block on top of the vault pose
    this.snap = slide
      ? { from: this.pos.clone(), to, toY: to.y, t: 0, dur: VAULT.slideTime + depth / VAULT.slideSpeed, hop: b.max.y - this.pos.y + 0.08, vault: 'slide', yaw: Math.atan2(-normal.x, -normal.z) }
      : { from: this.pos.clone(), to, toY: to.y, t: 0, dur: VAULT.hopTime, hop: b.max.y - this.pos.y + 0.3, vault: 'hop', yaw: Math.atan2(-normal.x, -normal.z) };
    this.events.emit('player:vault', this.snap.vault);
    return true;
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
    this.animator.onStep = () => {
      if (this.airborne || this.dead) return;
      STEP.run = this.sprinting;
      STEP.raised = this.pos.y > 0.1; // on the platform, its stairs or a block (the floor is at 0)
      this.events.emit('player:step', STEP);
    };
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
    const moving = this.coverMoving();
    // behind low cover the hips come half up while moving along it (crouch-run), full kneel when still
    const target = this.crouched ? (moving ? 0.45 : 1) : this.snap && !this.snap.hop ? 1 : 0;
    this.crouchBlend += (target - this.crouchBlend) * k;
    const combat = this.aiming || this.lastShot < 0.6;
    this.recoil = Math.max(0, this.recoil - dt * 11);
    // in cover with the back to the wall, the head turns to the camera
    let lookYaw = 0;
    if (this.cover && !combat && !moving && alive) {
      const c = camRig.camera.position;
      const a = Math.atan2(c.x - this.pos.x, c.z - this.pos.z) - this.facing;
      lookYaw = THREE.MathUtils.clamp(wrapAngle(a), -1.2, 1.2);
    }
    // sliding over cover and shooting: hips stay on the slide yaw, the chest turns toward where the camera aims
    const slideAim = combat && alive && (this.isSliding() || this.slideTail < VAULT.tail);
    const aimTwist = slideAim ? THREE.MathUtils.clamp(wrapAngle(camRig.yaw + Math.PI - this.facing), -VAULT.twist, VAULT.twist) : 0;
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
      lean: (camRig.peekSide || camRig.shoulder) * PEEK.lean * Math.min(1, this.peek.length() / PEEK.shift),
      leftHanded: camRig.peekSide < 0 && alive, // peeking a left corner: the gun comes around on the left
      lookYaw,
      hunch: moving && alive ? 1 : 0, // head ahead, shoulders down, gun low
      air: this.airborne && alive ? 1 : 0,
      vault: this.snap?.vault ?? null,
      vaultT: this.snap?.t ?? 0,
      lower: weaponLower,
      slideAim: slideAim ? 1 : 0,
      aimTwist,
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

