import * as THREE from 'three';
import { GUNS, GUN_ORDER } from './guns.js';

// Hitscan weapons (stats in guns.js). Aim ray comes from the camera; the shot is then validated from the muzzle.
const SWITCH_TIME = 0.45;

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _muz = new THREE.Vector3();

export class Weapon {
  constructor({ camera, rig, player, world, enemies, fx, hud, audio, juice }) {
    Object.assign(this, { camera, rig, player, world, enemies, fx, hud, audio, juice });
    this.state = {};
    for (const id of GUN_ORDER) this.state[id] = { ammo: GUNS[id].mag, reserve: GUNS[id].reserve };
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
    this.audio.click();
  }

  reload() {
    if (this.reloading > 0 || this.switching > 0 || this.ammo === this.t.mag || this.reserve <= 0) return;
    this.reloading = this.t.reloadTime;
    this.audio.click();
  }

  update(dt, input) {
    // switching: 1 / 2, or the mouse wheel (not in trackpad mode, where the wheel looks around)
    for (const id of GUN_ORDER) if (input.wasPressed(GUNS[id].key)) this.switchTo(id);
    if (input.wheelSteps) {
      const i = GUN_ORDER.indexOf(this.pending ?? this.current);
      this.switchTo(GUN_ORDER[(i + Math.sign(input.wheelSteps) + GUN_ORDER.length) % GUN_ORDER.length]);
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
      }
    }

    const t = this.t;
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - t.bloomDecay * dt);
    this.firing = false;

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const n = Math.min(t.mag - this.ammo, this.reserve);
        this.ammo += n;
        this.reserve -= n;
        this.audio.click();
      }
    }
    if (input.wasPressed('KeyR')) this.reload();

    const p = this.player;
    const trigger = input.firing();
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
      if (input.firePressed()) this.audio.click();
      this.reload();
      return;
    }
    const rpm = t.rpm * (t.spinUp > 0 ? 0.35 + 0.65 * this.spin : 1);
    while (this.cooldown <= 0 && this.ammo > 0) {
      this.cooldown += 60 / rpm;
      this.#fire();
    }
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
    const targets = [...this.world.meshes, ...this.enemies.hitMeshes()];
    _ray.set(camPos, _dir);
    _ray.near = camPos.distanceTo(this.rig.pivot); // skip stuff between camera and player
    _ray.far = t.range;
    let hit = _ray.intersectObjects(targets, false)[0];
    const aimPoint = hit ? hit.point.clone() : camPos.clone().addScaledVector(_dir, t.range);

    // validate from muzzle
    this.player.muzzle.getWorldPosition(_muz);
    const toAim = aimPoint.clone().sub(_muz);
    const dist = toAim.length();
    toAim.normalize();
    _ray.set(_muz, toAim);
    _ray.near = 0;
    _ray.far = Math.max(0.01, dist - 0.02);
    const block = _ray.intersectObjects(targets, false)[0];
    if (block) hit = block;

    const end = hit ? hit.point : aimPoint;
    this.fx.tracer(_muz, end);
    this.fx.muzzleFlash(_muz, toAim);
    this.fx.casing(_muz.clone().addScaledVector(toAim, -0.6), this.rig.right);
    this.audio.shot(this.current === 'mg');
    this.rig.kick(t.recoilPitch * (this.player.aiming ? 0.6 : 1), (Math.random() - 0.5) * t.recoilYaw, t.trauma);
    this.bloom = Math.min(t.bloomMax, this.bloom + t.bloomPerShot);

    if (!hit) return;
    const enemy = hit.object.userData.enemy;
    if (enemy) {
      const zone = hit.object.userData.zone;
      const mult = zone === 'weak' ? t.weakMult : zone === 'head' ? t.headMult : zone === 'limb' ? t.limbMult : 1;
      const crit = zone === 'head' || zone === 'weak';
      const killed = enemy.damage(t.damage * mult, hit.point, toAim, zone);
      this.fx.impact(hit.point, toAim.clone().negate(), zone === 'weak' ? 0xff2bd6 : 0x6fe3ff, zone === 'weak' ? 14 : 6, false);
      this.fx.number(hit.point, t.damage * mult, crit, zone === 'weak');
      this.hud.hitmarker(crit, killed);
      if (killed) this.juice.kill(hit.point, toAim);
      else this.juice.hit(crit);
      this.audio.tick(crit);
    } else {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : toAim.clone().negate();
      this.fx.impact(hit.point, n);
    }
  }
}
