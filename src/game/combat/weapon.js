import * as THREE from 'three';
import { GUNS, GUN_ORDER } from './guns.js';

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
// payloads are reused: listeners must copy what they keep
const SHOT = { from: _muz, to: new THREE.Vector3(), dir: _toAim, right: null, heavy: false };
const HIT = { point: null, normal: new THREE.Vector3(), dir: _toAim, zone: '', amount: 0, crit: false, weak: false, killed: false };
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
    this.player.setGun(this.current);
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

  spread() {
    return (this.player.aiming ? this.t.spreadAim : this.t.spreadHip) + this.bloom;
  }

  // Fills every gun from a pickup (kind: 'crate' | 'drop'). Returns a short label, or '' if all were full.
  addAmmo(kind) {
    const parts = [];
    for (const id of GUN_ORDER) {
      const g = GUNS[id];
      const s = this.state[id];
      const got = Math.min(g.pickup[kind], g.maxReserve - s.reserve);
      s.reserve += got;
      if (got > 0) parts.push(`+${got} ${id === 'mg' ? 'MG' : 'AR'}`);
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
        this.player.setGun(this.current);
        if (this.ammo === 0) this.switchedEmpty = true;
      }
    }

    if (this.switchedEmpty && this.switching <= 0) {
      this.switchedEmpty = false;
      this.reload();
    }
    const t = this.t;
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - t.bloomDecay * dt);
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
    this.spin = t.spinUp > 0 ? THREE.MathUtils.clamp(this.spin + (trigger ? dt / t.spinUp : -dt * 2), 0, 1) : 1;
    const canFire = !p.dead && !p.snap && !p.sprinting && this.reloading <= 0 && this.switching <= 0;
    if (!trigger || !canFire) {
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
    while (this.cooldown <= 0 && this.ammo > 0) {
      this.cooldown += 60 / rpm;
      this.#fire();
    }
    // auto reload the moment the magazine runs dry
    if (this.ammo === 0) this.reload();
  }

  #fire() {
    const t = this.t;
    this.ammo--;
    this.firing = true;
    this.player.lastShot = 0;
    this.player.kick();

    // camera aim ray with spread cone
    const s = this.spread();
    _dir.copy(this.rig.forward);
    _dir.x += (Math.random() - 0.5) * 2 * s;
    _dir.y += (Math.random() - 0.5) * 2 * s;
    _dir.z += (Math.random() - 0.5) * 2 * s;
    _dir.normalize();

    const camPos = this.camera.position;
    _targets.length = 0;
    for (const m of this.world.meshes) _targets.push(m);
    for (const m of this.enemies.hitMeshes()) _targets.push(m);
    _ray.set(camPos, _dir);
    _ray.near = camPos.distanceTo(this.rig.pivot); // skip stuff between camera and player
    _ray.far = t.range;
    let hit = _ray.intersectObjects(_targets, false)[0];
    if (hit) _aim.copy(hit.point);
    else _aim.copy(camPos).addScaledVector(_dir, t.range);

    // validate from muzzle
    this.player.muzzle.getWorldPosition(_muz);
    const toAim = _toAim.subVectors(_aim, _muz);
    const dist = toAim.length();
    toAim.normalize();
    _ray.set(_muz, toAim);
    _ray.near = 0;
    _ray.far = Math.max(0.01, dist - 0.02);
    const block = _ray.intersectObjects(_targets, false)[0];
    if (block) hit = block;

    SHOT.to.copy(hit ? hit.point : _aim);
    SHOT.right = this.rig.right;
    SHOT.heavy = this.current === 'mg';
    this.events.emit('weapon:shot', SHOT);
    this.rig.kick(t.recoilPitch * (this.player.aiming ? 0.6 : 1), (Math.random() - 0.5) * t.recoilYaw, t.trauma);
    this.bloom = Math.min(t.bloomMax, this.bloom + t.bloomPerShot);

    if (!hit) return;
    const enemy = hit.object.userData.enemy;
    if (enemy) {
      const zone = hit.object.userData.zone;
      const boost = this.boosted ? ACTIVE.boostMult : 1;
      const mult = boost * (zone === 'weak' ? t.weakMult : zone === 'head' ? t.headMult : zone === 'limb' ? t.limbMult : 1);
      HIT.amount = t.damage * mult;
      HIT.killed = enemy.damage(HIT.amount, hit.point, toAim, zone);
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
