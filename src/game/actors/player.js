import * as THREE from 'three';
import { GUNS } from '../combat/guns.js';
import { PlayerView } from './player-view.js';
import { damp, lerpAngle, wrapAngle } from '../../engine/math.js';

// The player character, the motor: movement, collision, cover state machine, jetpack, vault, health.
// Reads intents from Controls; reports what happened through events ('player:coverSlam', 'player:land',
// 'player:jet', 'player:vault', 'player:coverRun'). Never touches a mesh: `this.view` (PlayerView) owns the model,
// the rig and the animation and reads this state; the getters below forward what tests and tools read from it.
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _o = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _n = new THREE.Vector3();
const _hd = new THREE.Vector3(); // cover hop: push direction along the cover
const _hop = { x: 0, z: 0, nx: 0, nz: 0, col: null }; // cover hop: entry spot, face normal, collider of the best face
const _hc = new THREE.Vector3(); // corner move: control point / end
const _he = new THREE.Vector3();
const _ext = { lo: 0, hi: 0 }; // extent() result
const _cn = { cx: 0, cz: 0, ex: 0, ez: 0, nx: 0, nz: 0, col: null }; // corner move: control point, end spot, new face normal, its collider
const _cornerEvt = { kind: '' }; // 'player:coverCorner' payload (reused)
const _run = { to: new THREE.Vector3(), type: '', collider: null }; // 'player:coverRun' payload (reused)
const _ray = new THREE.Raycaster();
// extent of a box along the unit axis (ux, uz) -> _ext.lo / _ext.hi
function extent(b, ux, uz) {
  const a = b.min.x * ux + b.min.z * uz;
  const c = b.max.x * ux + b.max.z * uz;
  _ext.lo = Math.min(a, c);
  _ext.hi = Math.max(a, c);
}
const _move = { x: 0, y: 0 };
const _jet = { point: new THREE.Vector3(), dir: new THREE.Vector3(0, -1, 0) }; // 'player:jet' payload (reused)

const TUNING = {
  radius: 0.4,
  standHeight: 1.8,
  crouchHeight: 1.05,
  stepHeight: 0.45,
  stepSmooth: 0.1, // s: render-only time constant easing the model / camera up a step (physics snaps at once)
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
  coverHopReach: 5, // m from the player to the entry spot of the next cover, along the push, for the cover-to-cover run
  coverHopStandoff: 1.5, // m the next face may sit in front of / behind the current cover line
  coverWrapTime: 0.3, // s of the move around an outside corner (a curve through the corner point, hunched)
  coverTurnTime: 0.2, // s of the turn into the wall at an inside corner
  coverWrapFace: 0.9, // m: shortest face the player may wrap onto (min high cover length): door jambs (0.5 walls) walk on
  coverCornerGrace: 0.25, // s after a corner move in which "moving away" does not leave cover
  coverRunSpeed: 6.8, // m/s of that hunched run (sprint is 7.4)
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
const VAULT = { hopDepth: 1.2, hopTime: 0.5, slideTime: 0.3, slideSpeed: 5.5, runIn: 3.5, runInReach: 2.2, twist: 1.2, tail: 0.25, fovEase: 20 }; // twist / tail: used by PlayerView

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
    this.lastShot = 99;
    this.cover = null; // { normal, tangent, type, edgeL, edgeR }
    this.snap = null; // smooth move into cover / vault
    this.sliding = 0; // 0..1 eased: the hip slide over deep low cover (the camera widens its FOV)
    this.slideTail = 99; // seconds since a slide ended (the torso twist unwinds for VAULT.tail s)
    this.stepOff = 0; // render height minus pos.y (<= 0 while easing up a step), see #present
    this.lastY = 0;
    this.airborne = false; // jetpack burst: true from take-off until landed
    this.jetting = 0; // seconds of thrust left
    this.jetTimer = 0; // seconds until the next burst is allowed
    this.coverTimer = 0; // seconds until auto cover may grab again
    this.edgeTime = 0; // seconds pushing along cover while stopped at its end
    this.cornerGrace = 0; // seconds left in which pushing away does not leave cover (after a corner move)
    this.keep = { on: false, ax: 0, ay: 0, dx: 0, dz: 0, yaw: 0 }; // stick held through a corner: keeps sliding along dx, dz
    this.peek = new THREE.Vector3();
    this.shields = TUNING.maxShields;
    this.health = TUNING.maxHealth;
    this.sinceHit = 99;
    this.dead = false;
    this.deadTime = 0;
    this.scripted = false; // a cinematic.cut acts for STEM-00 (act()): no intent, no motor, no collision
    this.aimPitch = null; // scripted aim pitch (rad, up positive); null = the camera's pitch
    this.hitCapsule = { a: new THREE.Vector3(), b: new THREE.Vector3(), r: TUNING.radius };
    this.view = new PlayerView({ scene, world, events, player: this, tune: { vault: VAULT, peek: PEEK } });
  }

  // what tests, the editor and the debug overlay read from the view
  get root() { return this.view.root; }
  get rigModel() { return this.view.rigModel; }
  get skin() { return this.view.skin; }
  get animator() { return this.view.animator; }
  get muzzle() { return this.view.muzzle; }
  get gunModels() { return this.view.gunModels; }
  get soldierMats() { return this.view.soldierMats; }
  setCore(level) { this.view.setCore(level); }
  pose() { this.view.pose(); }

  // Show the gun and move the hand / muzzle sockets to it.
  setGun(id) {
    this.gun = id ? GUNS[id] : null; // null = unarmed
    this.view.setGun(id);
  }

  // The weapon fired or charges: shouldered for a moment (no sprint, combat stance, camera recoil timing).
  notifyShot() {
    this.lastShot = 0;
  }

  eyeHeight() {
    return THREE.MathUtils.lerp(1.62, 1.08, this.crouchBlend);
  }

  height() {
    return this.crouched ? this.t.crouchHeight : this.t.standHeight;
  }

  // In cover and moving along it (not shooting): hunched run facing the travel direction.
  coverMoving() {
    return (!!this.cover || !!this.snap?.run) && !this.aiming && this.lastShot >= 0.6 && this.vel.x * this.vel.x + this.vel.z * this.vel.z > 0.6;
  }

  // True during the hip slide over deep low cover: aiming and shooting stay available.
  isSliding() {
    return this.snap?.vault === 'slide';
  }

  visualPos() {
    return _v.copy(this.pos).add(this.peek).setY(this.pos.y + this.stepOff);
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
      if (this.shields <= 0) {
        this.health += this.shields;
        this.shields = 0;
        this.events.emit('player:shieldBreak'); // juice: slow motion; HUD: SHIELDS DOWN; audio
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

  // `at`: { pos, yaw } of a checkpoint (Encounter), else the level spawn.
  respawn(at = null) {
    if (at) this.pos.set(...at.pos);
    else this.pos.copy(this.spawn);
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
    this.scripted = false;
    this.aimPitch = null;
    this.facing = at ? at.yaw : this.spawnYaw;
    this.view.root.rotation.set(0, this.facing, 0);
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
    this.view.reset();
    this.lastShot = 99;
    this.sinceHit = 99;
    this.coverTimer = 0;
    this.jetTimer = 0;
    this.edgeTime = 0;
    this.deadTime = 0;
  }

  // Scripted acting (view/cinematic.js, a cut shot's `stem`): while `on` the motor does nothing (no intent, gravity or collision);
  // the cut writes pos / vel / facing / aiming / aimPitch / airborne / sprinting each step and only the pose is made from them.
  // Off: the motor takes over where the cut left the player (`respawn` / `place` also end it). Cover and moves in progress end.
  act(on) {
    this.scripted = on;
    if (!on) {
      this.aimPitch = null;
      this.aiming = this.sprinting = this.airborne = false;
      this.vel.set(0, 0, 0);
      this.vy = 0;
      return;
    }
    this.cover = null;
    this.snap = null;
    this.jetting = 0;
    this.sliding = 0;
    this.peek.set(0, 0, 0);
    this.crouched = false;
    this.crouchBlend = 0;
    this.sprinting = false;
  }

  // Visual gun kick on the model (per-gun back / climb); camera recoil is separate.
  kick(def) {
    this.view.kick(def);
  }

  update(dt, controls, rig, weapon) {
    const t = this.t;
    this.weapon = weapon; // the view reads the reload state for the animation
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
      this.#present(dt, rig, 0);
      return;
    }

    if (this.scripted) {
      this.#present(dt, rig, 1, weapon.lowered());
      return;
    }

    const ax = this.#readIntent(controls, rig, weapon, slide);
    const combat = this.aiming || this.lastShot < 0.6;
    if (this.snap) {
      this.#snapStep(dt, rig);
      this.#present(dt, rig, 1, weapon.lowered());
      return;
    }

    const grounded = !this.airborne && this.vy === 0;
    this.#jump(controls, grounded);
    this.#autoCover(grounded);
    if (this.snap) {
      this.#present(dt, rig, 1, weapon.lowered());
      return;
    }
    if (this.cover) this.#updateCover(dt, _w, rig, ax);
    else {
      this.keep.on = false;
      this.#updateFree(dt, _w);
    }
    this.#face(dt, rig, combat);
    this.#peek(dt, rig, combat);
    this.#present(dt, rig, 1, weapon.lowered());
  }

  // Controls -> the wish direction (_w, camera relative) and the aim / sprint state. Returns the move axes.
  #readIntent(controls, rig, weapon, slide) {
    const t = this.t;
    const ax = controls.move(_move);
    rig.flatForward(_f);
    rig.flatRight(_r);
    const wish = _w.set(0, 0, 0).addScaledVector(_f, ax.y).addScaledVector(_r, ax.x);
    if (wish.lengthSq() > 1) wish.normalize();

    // behind a wall or high block away from its ends there's no line of fire: no aiming, no shooting
    this.pinned = !!this.cover && this.cover.type === 'high' && !this.cover.edgeL && !this.cover.edgeR;
    const armed = !!weapon.current; // unarmed: no aiming, and the trigger doesn't stop the sprint
    this.aiming = armed && controls.aiming && (!this.snap || slide) && !this.pinned;
    if (weapon.firing) this.lastShot = 0;
    // sprint: forward only, not while aiming, shooting or in cover; pulling the trigger ends it
    this.sprinting = controls.running && ax.y > 0 && !this.aiming && !this.airborne && !this.cover && !this.snap && !(armed && controls.firing) && this.lastShot > t.sprintCooldown;

    // jump cancels a cover run / corner move (not the entry snap or a vault): drop it and its pending cover, keep the
    // velocity; the jump below does the burst (or just free movement while the jet is on cooldown)
    if (this.snap?.run && controls.jumpPressed) {
      this.snap = null;
      this.keep.on = false;
      this.coverTimer = t.autoCoverCooldown;
    }
    return ax;
  }

  // Smooth snap (enter cover / vault / cover run / corner move): advances it along its path.
  #snapStep(dt, rig) {
    const t = this.t;
    const s = this.snap;
    s.t = Math.min(1, s.t + dt / s.dur);
    // a slide keeps its momentum (linear); cover entry and the hop ease in and out
    const e = s.vault === 'slide' || s.run ? s.t : s.t * s.t * (3 - 2 * s.t);
    if (s.ctrl) {
      // corner move: quadratic curve through the control point; velocity and heading follow it
      const w = 1 - e;
      this.pos.x = w * w * s.from.x + 2 * w * e * s.ctrl.x + e * e * s.to.x;
      this.pos.z = w * w * s.from.z + 2 * w * e * s.ctrl.z + e * e * s.to.z;
      s.vx = (2 * w * (s.ctrl.x - s.from.x) + 2 * e * (s.to.x - s.ctrl.x)) / s.dur;
      s.vz = (2 * w * (s.ctrl.z - s.from.z) + 2 * e * (s.to.z - s.ctrl.z)) / s.dur;
      s.yaw = Math.atan2(s.vx, s.vz);
    } else {
      this.pos.x = THREE.MathUtils.lerp(s.from.x, s.to.x, e);
      this.pos.z = THREE.MathUtils.lerp(s.from.z, s.to.z, e);
    }
    const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight);
    // slide: up onto the top, across it on the hip, down the far side; hop: one arc
    const lift = s.vault === 'slide' ? (s.t < 0.2 ? Math.sin((s.t / 0.2) * Math.PI * 0.5) : s.t > 0.8 ? Math.cos(((s.t - 0.8) / 0.2) * Math.PI * 0.5) : 1) : Math.sin(Math.PI * s.t);
    // vault height from the take-off and landing floors (not the floor underneath: that's the block's top)
    this.pos.y = s.hop ? THREE.MathUtils.lerp(s.from.y, s.toY ?? s.from.y, e) + lift * s.hop : ground;
    if (s.vault || s.run) {
      this.facing = lerpAngle(this.facing, s.yaw, damp(20, dt)); // turn into the vault / the run
    }
    if (s.run) {
      this.vel.x += (s.vx - this.vel.x) * damp(30, dt);
      this.vel.z += (s.vz - this.vel.z) * damp(30, dt);
    }
    if (s.t >= 1) {
      this.snap = null;
      if (s.run) this.cover = s.next; // settled on the new face; the cover slide eases the velocity out
      if (s.corner) {
        this.keep.on = true;
        this.keep.yaw = rig.yaw;
        this.cornerGrace = t.coverCornerGrace;
      }
      if (s.hop) this.events.emit('player:land', 'vault');
      else this.events.emit('player:coverSlam');
      this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.stepHeight);
    }
  }

  // Jump (Space): vault low cover (from behind it, or run in at it), else a jetpack burst when grounded and ready.
  #jump(controls, grounded) {
    if (!controls.jumpPressed) return;
    const t = this.t;
    const wish = _w;
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

  // Auto cover: pushing into a cover face from free, grounded movement snaps to it.
  #autoCover(grounded) {
    const t = this.t;
    const wish = _w;
    if (!this.snap && !this.cover && grounded && this.coverTimer <= 0 && wish.lengthSq() > 0.09) {
      const c = this.#castCover(_n.copy(wish).normalize(), t.radius + t.autoCoverReach);
      if (c && -_n.dot(c.normal) > 0.6) {
        // sprinting at low cover: leave room for the run-in vault (Space) until we are touching it
        const fast = this.vel.x * this.vel.x + this.vel.z * this.vel.z > VAULT.runIn * VAULT.runIn;
        if (!(c.type === 'low' && fast && _v.subVectors(this.pos, c.point).dot(c.normal) > t.radius + 0.1)) this.#enterCover(c);
      }
    }
  }

  // Body turns toward the aim, the move or the cover wall; crouch behind low cover when not shooting.
  #face(dt, rig, combat) {
    let targetFacing = this.facing;
    if (combat) targetFacing = rig.yaw + Math.PI;
    else if (this.coverMoving()) targetFacing = Math.atan2(this.vel.x, this.vel.z); // moving along cover: turn into the move
    else if (this.cover) targetFacing = Math.atan2(this.cover.normal.x, this.cover.normal.z); // back to the wall
    else if (this.vel.lengthSq() > 0.2) targetFacing = Math.atan2(this.vel.x, this.vel.z);
    this.facing = lerpAngle(this.facing, targetFacing, damp(combat ? 25 : 12, dt));

    // crouch: only behind low cover when not shooting
    this.crouched = !!this.cover && this.cover.type === 'low' && !combat;
  }

  // High cover edge lean when aiming (the feet shift behind the cover, the view leans the torso).
  #peek(dt, rig, combat) {
    // the camera swaps shoulder only for the peek; the player's chosen shoulder comes back afterwards
    const peekTarget = _v.set(0, 0, 0);
    rig.peekSide = 0;
    // at one edge of high cover the camera sits over that shoulder (else the cover fills the view); the middle of a wall or
    // low cover keeps the player's shoulder
    const c = this.cover;
    rig.coverSide = c && c.type === 'high' && c.edgeL !== c.edgeR ? (c.edgeR ? 1 : -1) : 0;
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
  }

  // End of every substep: ease the crouch, then hand the state to the view (pose input, root placement).
  #present(dt, camRig, alive, weaponLower = 0) {
    // Render-only step smoothing: a grounded upward snap of at most a step (+ margin) leaves stepOff below pos.y and decays it;
    // anything else (falls, jet arcs, teleports, respawns) snaps the render height back at once.
    const dy = this.pos.y - this.lastY;
    this.lastY = this.pos.y;
    if (dy > 0.02 && dy <= this.t.stepHeight + 0.1 && !this.airborne && this.vy === 0 && !this.snap) this.stepOff -= dy;
    else if (dy !== 0 || this.airborne || this.snap) this.stepOff = 0;
    this.stepOff *= Math.exp(-dt / this.t.stepSmooth);
    if (this.stepOff > -0.001) this.stepOff = 0;
    const moving = this.coverMoving();
    // behind low cover the hips come half up while moving along it (crouch-run), full kneel when still
    const target = this.crouched ? (moving ? 0.45 : 1) : this.snap?.run ? (this.snap.low ? 0.45 : 0) : this.snap && !this.snap.hop ? 1 : 0;
    this.crouchBlend += (target - this.crouchBlend) * damp(12, dt);
    this.view.sample(dt, camRig, alive, weaponLower);
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

  #updateCover(dt, wish, rig, ax) {
    const c = this.cover;
    const t = this.t;
    // tangent oriented toward camera right
    c.tangent.set(c.normal.z, 0, -c.normal.x);
    if (c.tangent.dot(rig.right) < 0) c.tangent.negate();

    // after a corner move the stick (still pushed the old way) means "keep going": along the new face, until it is
    // released or turns more than ~45 deg (or the camera swings away)
    this.cornerGrace -= dt;
    const kp = this.keep;
    if (kp.on) {
      const m = Math.hypot(ax.x, ax.y);
      if (m < 0.3 || (ax.x * kp.ax + ax.y * kp.ay) / (m * Math.hypot(kp.ax, kp.ay)) < 0.7 || Math.abs(wrapAngle(rig.yaw - kp.yaw)) > 0.8) kp.on = false;
      else wish.set(kp.dx, 0, kp.dz).multiplyScalar(Math.min(1, m));
    }

    if (this.cornerGrace <= 0 && wish.dot(c.normal) > 0.5) {
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
      this.edgeTime = 0;
      // inside corner first (a wall right ahead), then the cover-to-cover run, then around the outside corner
      _hd.copy(c.tangent).multiplyScalar(Math.sign(wish.dot(c.tangent)));
      if (this.#findInsideCorner(c, _hd)) this.#startCorner('inside', ax);
      else if (this.#findCoverHop(c, _hd)) this.#startCoverRun(_hd);
      else if (this.#findOutsideCorner(c, _hd)) this.#startCorner('outside', ax);
      this.cover = null;
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

  // Another cover face to run to from the end of cover `c`, in direction d (unit, along the cover): a parallel face
  // (same normal, standoff <= coverHopStandoff) whose near end is ahead, or a perpendicular one looking back at us.
  // Nearest entry spot within coverHopReach with a clear path, same floor. Fills _hop. Axis-aligned boxes only.
  // Hot path rules: no allocation unless a candidate gets as far as the path test.
  #findCoverHop(c, d) {
    const t = this.t;
    const off = t.radius + 0.05;
    const nx = c.normal.x;
    const nz = c.normal.z;
    if (Math.abs(nx * nz) > 0.01 || Math.abs(d.x * d.z) > 0.01) return false;
    const px = this.pos.x;
    const py = this.pos.y;
    const pz = this.pos.z;
    const s0 = px * d.x + pz * d.z; // position along the push
    const l0 = px * nx + pz * nz; // position along the normal
    let best = t.coverHopReach;
    let found = false;
    for (const col of this.world.colliders) {
      if (!col.cover || col === c.collider) continue;
      const b = col.box;
      if (b.min.y > py + t.stepHeight || b.max.y <= py + 0.5) continue;
      // extent along the push (lo..hi) and along the normal (llo..lhi)
      const sa = b.min.x * d.x + b.min.z * d.z;
      const sb = b.max.x * d.x + b.max.z * d.z;
      const lo = Math.min(sa, sb);
      const hi = Math.max(sa, sb);
      const la = b.min.x * nx + b.min.z * nz;
      const lb = b.max.x * nx + b.max.z * nz;
      const llo = Math.min(la, lb);
      const lhi = Math.max(la, lb);
      // parallel: its face looking along n is at lhi (the n-most extent)
      let es = lo + 0.2; // entry along the push: 0.2 inside the near end, like the slide stop
      let el = lhi + off;
      const par = Math.abs(el - l0) <= t.coverHopStandoff && hi - lo >= 0.4 && es > s0;
      let ok = par;
      if (!ok) {
        // perpendicular: its face looking back at us (outward normal -d) is the one at `lo`; we must line up with it
        es = lo - off;
        el = l0;
        ok = es >= s0 && l0 > llo + 0.2 && l0 < lhi - 0.2;
      }
      if (!ok) continue;
      const ex = el * nx + es * d.x; // back to world x / z: n and d are perpendicular unit axes
      const ez = el * nz + es * d.z;
      const dist = Math.hypot(ex - px, ez - pz);
      if (dist >= best) continue;
      if (Math.abs(this.world.groundAt(ex, ez, py + t.stepHeight, t.radius * 0.5) - py) > 0.1) continue;
      _n.set(ex, py, ez);
      if (!this.world.segmentClear(this.pos, _n, t.radius * 0.5)) continue; // half the body: the run may graze the corner of a box in front of / behind the line
      best = dist;
      found = true;
      _hop.x = ex;
      _hop.z = ez;
      _hop.col = col;
      // outward normal of the face we run to: n for a parallel one, -d for a perpendicular one
      _hop.nx = par ? nx : -d.x;
      _hop.nz = par ? nz : -d.z;
    }
    return found;
  }

  // Committed hunched run (a snap with `run`) to the spot found by #findCoverHop, then cover on the new face.
  #startCoverRun(d) {
    const t = this.t;
    const to = new THREE.Vector3(_hop.x, this.pos.y, _hop.z);
    const len = to.distanceTo(this.pos);
    const type = _hop.col.box.max.y - this.pos.y < 1.7 ? 'low' : 'high';
    const next = { normal: new THREE.Vector3(_hop.nx, 0, _hop.nz), tangent: new THREE.Vector3(), type, collider: _hop.col, edgeL: false, edgeR: false };
    const dir = _v.subVectors(to, this.pos).setY(0).normalize();
    this.snap = { from: this.pos.clone(), to, t: 0, dur: Math.max(0.1, len / t.coverRunSpeed), hop: 0, run: true, low: this.cover.type === 'low', next, yaw: Math.atan2(dir.x, dir.z), vx: dir.x * t.coverRunSpeed, vz: dir.z * t.coverRunSpeed };
    this.edgeTime = 0;
    _run.to.copy(to);
    _run.type = type;
    _run.collider = _hop.col;
    this.events.emit('player:coverRun', _run);
  }

  // Inside corner at the end of cover `c`, pushing along d: a cover wall B whose face looks back at us, touching or
  // within ~0.3 m of the end (closer than the cover run's entry offset), sticking out past our face so we can stand
  // against it. Fills _cn: the turn is a short straight move to the spot in front of B. Axis-aligned boxes only.
  #findInsideCorner(c, d) {
    const t = this.t;
    const off = t.radius + 0.05;
    const nx = c.normal.x;
    const nz = c.normal.z;
    if (Math.abs(nx * nz) > 0.01 || Math.abs(d.x * d.z) > 0.01) return false;
    const py = this.pos.y;
    const s0 = this.pos.x * d.x + this.pos.z * d.z;
    const l0 = this.pos.x * nx + this.pos.z * nz;
    for (const col of this.world.colliders) {
      if (!col.cover || col === c.collider) continue;
      const b = col.box;
      if (b.min.y > py + t.stepHeight || b.max.y <= py + 0.5) continue;
      extent(b, d.x, d.z);
      const gap = _ext.lo - s0;
      if (gap < -0.3 || gap >= off) continue;
      extent(b, nx, nz);
      if (!(l0 > _ext.lo + 0.2 && l0 < _ext.hi - 0.2)) continue;
      const es = s0 + gap - off;
      const ex = l0 * nx + es * d.x;
      const ez = l0 * nz + es * d.z;
      if (Math.abs(this.world.groundAt(ex, ez, py + t.stepHeight, t.radius * 0.5) - py) > 0.1 || !this.#spotFree(ex, ez, py)) continue;
      _cn.ex = ex;
      _cn.ez = ez;
      _cn.cx = (ex + this.pos.x) / 2;
      _cn.cz = (ez + this.pos.z) / 2;
      _cn.nx = -d.x;
      _cn.nz = -d.z;
      _cn.col = col;
      return true;
    }
    return false;
  }

  // Outside corner at the end of cover `c`, pushing along d: the face of the same box (or of an abutting cover box
  // flush with its end and its face) that looks along d and runs back, >= coverWrapFace long, with a free spot of the
  // same floor in front of it. Fills _cn: control point = the corner spot, end = 0.2 inside the new face's near end.
  // The longest candidate wins. Axis-aligned boxes only.
  #findOutsideCorner(c, d) {
    const t = this.t;
    const off = t.radius + 0.05;
    const nx = c.normal.x;
    const nz = c.normal.z;
    if (Math.abs(nx * nz) > 0.01 || Math.abs(d.x * d.z) > 0.01) return false;
    const py = this.pos.y;
    const l0 = this.pos.x * nx + this.pos.z * nz;
    extent(c.collider.box, d.x, d.z);
    const hiA = _ext.hi;
    extent(c.collider.box, nx, nz);
    const lface = _ext.hi;
    let best = 0;
    for (const col of this.world.colliders) {
      if (!col.cover) continue;
      const b = col.box;
      if (b.min.y > py + t.stepHeight || b.max.y <= py + 0.5) continue;
      extent(b, d.x, d.z);
      if (Math.abs(_ext.hi - hiA) > 0.05) continue; // its face looking along d is flush with the end
      const es = _ext.hi + off;
      extent(b, nx, nz);
      const len = Math.min(_ext.hi, lface + 0.05) - _ext.lo;
      if (Math.abs(_ext.hi - lface) > 0.1 || len < t.coverWrapFace || len <= best) continue; // flush with our face, long enough
      const el = _ext.hi - 0.2;
      const ex = el * nx + es * d.x;
      const ez = el * nz + es * d.z;
      const cx = l0 * nx + es * d.x;
      const cz = l0 * nz + es * d.z;
      if (Math.abs(this.world.groundAt(ex, ez, py + t.stepHeight, t.radius * 0.5) - py) > 0.1 || !this.#spotFree(ex, ez, py)) continue;
      _hc.set(cx, py, cz);
      _he.set(ex, py, ez);
      if (!this.#spotFree(cx, cz, py) || !this.world.segmentClear(this.pos, _hc, t.radius * 0.5) || !this.world.segmentClear(_hc, _he, t.radius * 0.5)) continue;
      best = len;
      _cn.cx = cx;
      _cn.cz = cz;
      _cn.ex = ex;
      _cn.ez = ez;
      _cn.nx = d.x;
      _cn.nz = d.z;
      _cn.col = col;
    }
    return best > 0;
  }

  // Nothing solid (above step height, below head height) within the body radius of (x, z).
  #spotFree(x, z, py) {
    const r = this.t.radius;
    for (const col of this.world.colliders) {
      const b = col.box;
      if (b.max.y <= py + this.t.stepHeight || b.min.y > py + this.t.standHeight) continue;
      if (x > b.min.x - r && x < b.max.x + r && z > b.min.z - r && z < b.max.z + r) return false;
    }
    return true;
  }

  // Committed corner move (a snap with `run` and a curve) to the spot found in _cn, then cover on the new face.
  // The stick is remembered: after landing it keeps meaning "on", along the new face (outside: back into the box's
  // depth, inside: away from the wall we left).
  #startCorner(kind, ax) {
    const t = this.t;
    const c = this.cover;
    const py = this.pos.y;
    const to = new THREE.Vector3(_cn.ex, py, _cn.ez);
    const ctrl = new THREE.Vector3(_cn.cx, py, _cn.cz);
    const type = _cn.col.box.max.y - py < 1.7 ? 'low' : 'high';
    const next = { normal: new THREE.Vector3(_cn.nx, 0, _cn.nz), tangent: new THREE.Vector3(), type, collider: _cn.col, edgeL: false, edgeR: false };
    const dur = kind === 'outside' ? t.coverWrapTime : t.coverTurnTime;
    this.snap = { from: this.pos.clone(), to, ctrl, t: 0, dur, hop: 0, run: true, corner: true, low: c.type === 'low', next, yaw: this.facing, vx: this.vel.x, vz: this.vel.z };
    const k = this.keep;
    const sgn = kind === 'outside' ? -1 : 1;
    k.on = false; // armed on landing
    k.ax = ax.x;
    k.ay = ax.y;
    k.dx = c.normal.x * sgn;
    k.dz = c.normal.z * sgn;
    this.edgeTime = 0;
    _cornerEvt.kind = kind;
    this.events.emit('player:coverCorner', _cornerEvt);
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
      if (to.x > bb.min.x - r && to.x < bb.max.x + r && to.z > bb.min.z - r && to.z < bb.max.z + r) {
        this.events.emit('player:vaultRefused', { collider, blocker: col });
        return false;
      }
    }
    // tolerance: box extents carry float error (a 1.2 deep block can read 1.2000000000000028) and must still hop
    const slide = depth > VAULT.hopDepth + 1e-3;
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
}

