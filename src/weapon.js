import * as THREE from 'three';

// Hitscan assault rifle. Aim ray comes from the camera; the shot is then validated from the muzzle.
const TUNING = {
  rpm: 540,
  mag: 32,
  reserve: 256,
  reloadTime: 1.8,
  damage: 18,
  headMult: 2.5,
  limbMult: 0.8,
  range: 250,
  spreadHip: 0.022,
  spreadAim: 0.004,
  bloomPerShot: 0.007,
  bloomMax: 0.05,
  bloomDecay: 0.12,
  recoilPitch: 0.012,
  recoilYaw: 0.004,
};

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _muz = new THREE.Vector3();

export class Weapon {
  constructor({ camera, rig, player, world, enemies, fx, hud, audio }) {
    Object.assign(this, { camera, rig, player, world, enemies, fx, hud, audio });
    this.t = TUNING;
    this.ammo = TUNING.mag;
    this.reserve = TUNING.reserve;
    this.cooldown = 0;
    this.reloading = 0;
    this.bloom = 0;
    this.firing = false;
  }

  spread() {
    return (this.player.aiming ? this.t.spreadAim : this.t.spreadHip) + this.bloom;
  }

  reload() {
    if (this.reloading > 0 || this.ammo === this.t.mag || this.reserve <= 0) return;
    this.reloading = this.t.reloadTime;
    this.audio.click();
  }

  update(dt, input) {
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
    const canFire = !p.dead && !p.snap && !p.sprinting && this.reloading <= 0;
    if (!input.mouse.left || !canFire) return;
    // in cover the character needs a moment to pop up before the first round leaves
    if (p.cover && p.cover.type === 'low' && p.crouchBlend > 0.45) {
      p.lastShot = 0;
      return;
    }
    if (this.ammo <= 0) {
      if (input.mouse.leftPressed) this.audio.click();
      this.reload();
      return;
    }
    while (this.cooldown <= 0 && this.ammo > 0) {
      this.cooldown += 60 / t.rpm;
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
    this.audio.shot();
    this.rig.kick(t.recoilPitch * (this.player.aiming ? 0.6 : 1), (Math.random() - 0.5) * t.recoilYaw);
    this.bloom = Math.min(t.bloomMax, this.bloom + t.bloomPerShot);

    if (!hit) return;
    const enemy = hit.object.userData.enemy;
    if (enemy) {
      const zone = hit.object.userData.zone;
      const mult = zone === 'head' ? t.headMult : zone === 'limb' ? t.limbMult : 1;
      const killed = enemy.damage(t.damage * mult, hit.point, toAim, zone);
      this.fx.impact(hit.point, toAim.clone().negate(), 0x6fe3ff, 6, false);
      this.fx.number(hit.point, t.damage * mult, zone === 'head');
      this.hud.hitmarker(zone === 'head', killed);
      this.audio.tick(zone === 'head');
    } else {
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : toAim.clone().negate();
      this.fx.impact(hit.point, n);
    }
  }
}
