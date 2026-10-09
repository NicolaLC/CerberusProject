import * as THREE from 'three';
import { GUNS, GUN_ORDER } from './guns.js';
import { coneDir, recoilKick, falloff } from './ballistics.js';
import { Rng } from '../../engine/random.js';

// Hitscan weapons (stats in guns.js). Aim ray comes from the camera; the shot is then validated from the muzzle.
// Gameplay only: everything audiovisual is announced through events (see instructions/architecture.md).
const SWITCH_TIME = 0.45;
// Active reload (Gears of War style): press reload again while the marker sweeps the bar.
const ACTIVE = {
  jamPenalty: 1.0, // extra seconds when you miss
  boostMult: 1.25, // damage for the rest of a perfectly reloaded magazine
};

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _muz = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _toAim = new THREE.Vector3();
const _back = new THREE.Vector3();
const _targets = [];
const _kick = [0, 0];
const _probeDir = new THREE.Vector3();
const _passed = [];
// payloads are reused: listeners must copy what they keep
const SHOT = { from: _muz, to: new THREE.Vector3(), dir: _toAim, right: null, heavy: false, beam: false, gun: '', flash: 1, mag: 1 };
const HIT = { point: null, normal: new THREE.Vector3(), dir: _toAim, zone: '', amount: 0, crit: false, weak: false, killed: false, distance: 0 };
const IMPACT = { point: null, normal: new THREE.Vector3() };

export class Weapon {
  constructor({ camera, rig, player, world, enemies, events }) {
    Object.assign(this, { camera, rig, player, world, enemies, events });
    this.state = {};
    for (const id of GUN_ORDER) this.state[id] = { ammo: GUNS[id].mag, reserve: GUNS[id].reserve, boost: false };
    this.active = null; // { total, attempted, result } while a reload runs
    this.result = null; // last active-reload result for the HUD: { kind, time }
    this.current = 'rifle';
    this.cooldown = 0;
    this.reloading = 0;
    this.switching = 0; // > 0 while lowering / raising
    this.pending = null;
    this.spin = 0; // 0..1 spin-up for the machine gun
    this.bloom = 0;
    this.firing = false;
    this.rng = new Rng(); // own stream: spread and recoil jitter are reproducible per seed
    this.sinceShot = 99; // seconds since the last round left
    this.burst = 0; // rounds in the current burst (recoil pattern index)
    this.queued = 0; // semi-auto: seconds a click stays buffered
    this.charging = 0; // railgun: seconds left before the charged shot leaves
    this.burstLeft = 0; // burst rifle: rounds still to fire in this burst
    // what the crosshair is on, refreshed every frame by probe(): HUD reads it
    this.aim = { enemy: false, weak: false, blocked: false, blockPoint: new THREE.Vector3(), distance: 0 };
    this.player.setGun(this.current);
    this.rig.zoom = null;
  }

  get t() {
    return GUNS[this.current];
  }

  get ammo() {
    return this.state[this.current].ammo;
  }

  set ammo(v) {
    this.state[this.current].ammo = v;
  }

  get reserve() {
    return this.state[this.current].reserve;
  }

  set reserve(v) {
    this.state[this.current].reserve = v;
  }

  // 0 = gun up, 1 = fully lowered (drives the switch animation)
  lowered() {
    return this.switching > 0 ? Math.sin((1 - this.switching / SWITCH_TIME) * Math.PI) : 0;
  }

  // 0 = hip, 1 = fully aimed: follows the camera zoom, so snapping to aim and firing at once isn't free accuracy
  aimBlend() {
    const normal = this.rig.t.fov.normal;
    return THREE.MathUtils.clamp((normal - this.rig.fov) / (normal - this.rig.aimFov()), 0, 1);
  }

  // Current cone half-angle (rad) of the next round. The crosshair draws exactly this.
  spread() {
    const t = this.t;
    const a = this.aimBlend();
    const p = this.player;
    const move = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / p.t.walk) * t.spreadMove * (1 - 0.6 * a);
    let s = THREE.MathUtils.lerp(t.spreadHip, t.spreadAim, a) + move + this.bloom;
    if (this.sinceShot > t.firstShot.rest) s *= THREE.MathUtils.lerp(t.firstShot.hip, t.firstShot.aim, a);
    return s;
  }

  // Per frame, after the camera moved: what would a round hit right now?
  // Sets aim.enemy / aim.weak (crosshair over a target) and aim.blocked (muzzle path obstructed: the round
  // would hit cover in front of the gun instead of what the crosshair shows; the HUD marks the real impact).
  probe() {
    const a = this.aim;
    a.enemy = a.weak = a.blocked = false;
    if (this.player.dead || !this.player.muzzle) return;
    const camPos = this.camera.position;
    _probeDir.copy(this.rig.forward);
    this.#targets();
    _ray.set(camPos, _probeDir);
    _ray.near = camPos.distanceTo(this.rig.pivot);
    _ray.far = this.t.range;
    const hit = _ray.intersectObjects(_targets, false)[0];
    if (hit) _aim.copy(hit.point);
    else _aim.copy(camPos).addScaledVector(_probeDir, this.t.range);
    a.distance = hit ? hit.distance : this.t.range;
    this.player.muzzle.getWorldPosition(_muz);
    const d = _toAim.subVectors(_aim, _muz);
    const dist = d.length();
    _ray.set(_muz, d.normalize());
    _ray.near = 0;
    _ray.far = Math.max(0.01, dist - 0.05);
    const block = _ray.intersectObjects(_targets, false)[0];
    const final = block ?? hit;
    // only an obstruction well short of the aim point counts (grazing the target's own surroundings doesn't)
    if (block && block.point.distanceTo(_aim) > Math.max(0.4, dist * 0.04)) {
      a.blocked = true;
      a.blockPoint.copy(block.point);
    }
    const enemy = final?.object.userData.enemy;
    // armored parts (the mech's hull) read as cover, not as a target
    if (enemy && enemy.alive && (!enemy.armor || enemy.armor(final.object.userData.zone, final.object) > 0)) {
      a.enemy = true;
      a.weak = final.object.userData.zone === 'weak';
    }
  }

  #targets() {
    _targets.length = 0;
    for (const m of this.world.meshes) _targets.push(m);
    for (const m of this.enemies.hitMeshes()) _targets.push(m);
    return _targets;
  }

  // Fills every gun from a pickup (kind: 'crate' | 'drop'). Returns a short label, or '' if all were full.
  addAmmo(kind) {
    const parts = [];
    for (const id of GUN_ORDER) {
      const g = GUNS[id];
      const s = this.state[id];
      const got = Math.min(g.pickup[kind], g.maxReserve - s.reserve);
      s.reserve += got;
      if (got > 0) parts.push(`+${got} ${g.short}`);
    }
    return parts.join('  ');
  }

  switchTo(id) {
    if (id === this.current && !this.pending) return;
    if (this.switching > 0 && this.pending === id) return;
    this.pending = id;
    this.switching = SWITCH_TIME;
    this.reloading = 0;
    this.active = null;
    this.burstLeft = 0;
    this.events.emit('weapon:switch', id);
  }

  get boosted() {
    return this.state[this.current].boost;
  }

  // 0..1 position of the active-reload marker
  reloadProgress() {
    return this.active ? 1 - this.reloading / this.active.total : 0;
  }

  reload() {
    if (this.reloading > 0 || this.switching > 0 || this.ammo === this.t.mag || this.reserve <= 0) return;
    this.reloading = this.t.reloadTime;
    this.active = { total: this.t.reloadTime, attempted: false, result: null };
    this.state[this.current].boost = false;
    this.events.emit('weapon:reload', 'start');
  }

  // Second press during a reload: perfect = instant + damage boost, good = instant, else jam.
  #tryActiveReload() {
    const a = this.active;
    if (!a || a.attempted) return;
    a.attempted = true;
    const p = this.reloadProgress();
    const z = this.t.activeReload;
    if (p >= z.perfect[0] && p <= z.perfect[1]) {
      this.#finishReload();
      this.state[this.current].boost = true;
      this.#showResult('perfect');
    } else if (p >= z.good[0] && p <= z.good[1]) {
      this.#finishReload();
      this.#showResult('good');
    } else {
      a.result = 'jam';
      this.reloading += ACTIVE.jamPenalty;
      a.total += ACTIVE.jamPenalty;
      this.#showResult('jam');
    }
  }

  #finishReload() {
    const n = Math.min(this.t.mag - this.ammo, this.reserve);
    this.ammo += n;
    this.reserve -= n;
    this.reloading = 0;
    this.active = null;
  }

  #showResult(kind) {
    this.result = { kind, time: performance.now() };
    this.events.emit('weapon:reload', kind);
  }

  update(dt, controls) {
    // switching: number keys, or the mouse wheel (not in trackpad mode, where the wheel looks around)
    const slot = controls.slotPressed;
    if (slot >= 0 && slot < GUN_ORDER.length) this.switchTo(GUN_ORDER[slot]);
    if (controls.cycle) {
      const i = GUN_ORDER.indexOf(this.pending ?? this.current);
      this.switchTo(GUN_ORDER[(i + controls.cycle + GUN_ORDER.length) % GUN_ORDER.length]);
    }
    if (this.switching > 0) {
      const before = this.switching;
      this.switching -= dt;
      // swap the model at the bottom of the motion
      if (before > SWITCH_TIME / 2 && this.switching <= SWITCH_TIME / 2 && this.pending) {
        this.current = this.pending;
        this.pending = null;
        this.bloom = 0;
        this.spin = 0;
        this.cooldown = 0; // the last gun's fire cycle doesn't carry over
        this.player.setGun(this.current);
        this.rig.zoom = this.t.zoom ?? null;
        if (this.ammo === 0) this.switchedEmpty = true;
      }
    }

    if (this.switchedEmpty && this.switching <= 0) {
      this.switchedEmpty = false;
      this.reload();
    }
    const t = this.t;
    this.cooldown -= dt;
    this.sinceShot += dt;
    if (this.sinceShot > t.bloomDelay) this.bloom = Math.max(0, this.bloom - t.bloomDecay * dt);
    if (this.sinceShot > t.recoil.reset) this.burst = 0;
    this.firing = false;

    if (controls.reloadPressed) {
      if (this.reloading > 0) this.#tryActiveReload();
      else this.reload();
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.#finishReload();
        this.events.emit('weapon:reload', 'done');
      }
    }

    const p = this.player;
    const trigger = controls.firing;
    // semi-auto: one round per click; a click shortly before the bolt is back is buffered, not lost
    this.queued = controls.firePressed ? 0.25 : this.queued - dt;
    const pull = t.semi ? this.queued > 0 : trigger;
    this.spin = t.spinUp > 0 ? THREE.MathUtils.clamp(this.spin + (trigger ? dt / t.spinUp : -dt * 2), 0, 1) : 1;
    const canFire = !p.dead && (!p.snap || p.isSliding()) && !p.sprinting && !p.pinned && this.reloading <= 0 && this.switching <= 0;
    // a started charge or burst finishes whether or not the trigger is still held
    if (this.charging > 0) {
      if (!canFire) {
        this.charging = 0;
        this.events.emit('weapon:charge', false);
        return;
      }
      p.lastShot = 0; // shouldered while it charges
      this.charging -= dt;
      if (this.charging <= 0) {
        this.charging = 0;
        this.cooldown = 60 / t.rpm;
        this.#fire();
        if (this.ammo === 0) this.reload();
      }
      return;
    }
    if (this.burstLeft > 0) {
      if (!canFire || this.ammo <= 0) this.burstLeft = 0;
      else {
        this.#burstStep();
        return;
      }
    }
    if (!pull || !canFire) {
      this.cooldown = Math.max(this.cooldown, 0);
      return;
    }
    // in cover the character needs a moment to pop up before the first round leaves
    if (p.cover && p.cover.type === 'low' && p.crouchBlend > 0.45) {
      p.lastShot = 0;
      return;
    }
    if (this.ammo <= 0) {
      if (controls.firePressed) this.events.emit('weapon:dry');
      this.reload();
      return;
    }
    const rpm = t.rpm * (t.spinUp > 0 ? 0.35 + 0.65 * this.spin : 1);
    if (t.charge) {
      if (this.cooldown <= 0) {
        this.charging = t.charge;
        this.queued = 0;
        p.lastShot = 0;
        this.events.emit('weapon:charge', true);
      }
      return;
    }
    if (t.burst) {
      if (this.cooldown <= 0) {
        this.burstLeft = t.burst;
        this.cooldown = 0;
        this.#burstStep();
      }
      return;
    }
    if (t.semi) {
      if (this.cooldown <= 0) {
        this.cooldown = 60 / rpm;
        this.queued = 0;
        this.#fire();
      }
    } else {
      while (this.cooldown <= 0 && this.ammo > 0) {
        this.cooldown += 60 / rpm;
        this.#fire();
      }
    }
    // auto reload the moment the magazine runs dry
    if (this.ammo === 0) this.reload();
  }

  // Fires the burst's rounds that are due; the last one starts the pause before the next burst.
  #burstStep() {
    const t = this.t;
    while (this.cooldown <= 0 && this.burstLeft > 0 && this.ammo > 0) {
      this.burstLeft--;
      this.cooldown += this.burstLeft > 0 ? 60 / t.rpm : t.burstDelay;
      this.#fire();
    }
    if (this.ammo === 0) {
      this.burstLeft = 0;
      this.reload();
    }
  }

  #fire() {
    const t = this.t;
    this.ammo--;
    this.firing = true;
    this.player.lastShot = 0;

    // camera aim ray, uniformly inside the spread cone (spread is measured before this round adds bloom)
    coneDir(_dir, this.rig.forward, this.rig.right, this.spread(), this.rng.next(), this.rng.next());
    this.sinceShot = 0;

    const camPos = this.camera.position;
    this.#targets();
    _ray.set(camPos, _dir);
    _ray.near = camPos.distanceTo(this.rig.pivot); // skip stuff between camera and player
    _ray.far = t.range;
    let hit = _ray.intersectObjects(_targets, false)[0];
    if (hit) _aim.copy(hit.point);
    else _aim.copy(camPos).addScaledVector(_dir, t.range);

    // validate from muzzle (a piercing slug flies on past the aim point, along the same line)
    this.player.muzzle.getWorldPosition(_muz);
    const toAim = _toAim.subVectors(_aim, _muz);
    const dist = toAim.length();
    toAim.normalize();
    _ray.set(_muz, toAim);
    _ray.near = 0;
    _ray.far = t.pierce ? t.range : Math.max(0.01, dist - 0.02);
    const muzHits = _ray.intersectObjects(_targets, false);
    if (t.pierce) {
      // every enemy on the line takes the slug (once each), up to the first wall or armor
      hit = null;
      _aim.copy(_muz).addScaledVector(toAim, t.range);
      _passed.length = 0;
      for (const h of muzHits) {
        if (!this.#passes(h)) {
          hit = h;
          break;
        }
        const e = h.object.userData.enemy;
        if (!e.alive || _passed.includes(e) || _passed.length >= t.pierce) continue;
        _passed.push(e);
        this.#hit(h, toAim, e);
      }
    } else if (muzHits[0]) hit = muzHits[0];

    SHOT.to.copy(hit ? hit.point : _aim);
    SHOT.right = this.rig.right;
    SHOT.heavy = this.current === 'mg';
    SHOT.gun = this.current;
    SHOT.flash = t.flash;
    SHOT.beam = !!t.beam;
    SHOT.mag = this.ammo / t.mag;
    this.events.emit('weapon:shot', SHOT);
    const r = t.recoil;
    recoilKick(r, this.burst++, _kick, this.rng.next(), this.rng.next());
    const k = THREE.MathUtils.lerp(1, r.aim, this.aimBlend());
    this.rig.kick(_kick[0] * k, -_kick[1] * k, t.trauma, r.recover, r.hold ?? (60 / t.rpm) * 1.3);
    this.player.kick(t.kick);
    this.bloom = Math.min(t.bloomMax, this.bloom + t.bloomPerShot);

    if (!hit) return;
    this.#hit(hit, toAim, hit.object.userData.enemy);
  }

  // A pierceable hit: a live enemy's part that isn't armored.
  #passes(h) {
    const e = h.object.userData.enemy;
    return !!e && (!e.armor || e.armor(h.object.userData.zone, h.object) > 0);
  }

  #hit(hit, toAim, enemy) {
    const t = this.t;
    const armor = enemy?.armor ? enemy.armor(hit.object.userData.zone, hit.object) : 1;
    if (enemy && armor <= 0) {
      // armor: the round glances off (sparks, no damage) and the HUD hints where to shoot
      IMPACT.point = hit.point;
      IMPACT.normal.copy(toAim).negate();
      this.events.emit('weapon:impact', IMPACT);
      this.events.emit('weapon:armored', enemy);
    } else if (enemy) {
      const zone = hit.object.userData.zone;
      const boost = this.boosted ? ACTIVE.boostMult : 1;
      const mult = boost * (zone === 'weak' ? t.weakMult : zone === 'head' ? t.headMult : zone === 'limb' ? t.limbMult : 1);
      HIT.distance = _muz.distanceTo(hit.point);
      HIT.amount = t.damage * mult * armor * falloff(t.falloff, HIT.distance);
      HIT.killed = enemy.damage(HIT.amount, hit.point, toAim, zone, hit.object);
      HIT.point = hit.point;
      HIT.normal.copy(toAim).negate();
      HIT.zone = zone;
      HIT.weak = zone === 'weak';
      HIT.crit = zone === 'head' || HIT.weak;
      this.events.emit('weapon:hit', HIT);
    } else {
      IMPACT.point = hit.point;
      if (hit.face) IMPACT.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      else IMPACT.normal.copy(_back.copy(toAim).negate());
      this.events.emit('weapon:impact', IMPACT);
    }
  }
}
