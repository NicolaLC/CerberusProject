import * as THREE from 'three';
import { EnemyBody, box, sightRay, VISOR_REST } from './enemy.js';
import { buildPuppet, puppetMaterials } from './looks.js';
import { damp, wrapAngle } from '../../engine/math.js';

// Training puppets: the shared humanoid rig hung on a pneumatic post, dressed as a crash-test robot (looks.js).
// kinds: 'static' (takes hits), 'mover' (slides on a rail), 'shooter' (pops up from fixed cover and fires).

const HIDE = -0.95; // rig lift when retracted behind low cover
export const HEALTH = { default: 100, shooter: 120 }; // hit points by kind
const ARMORED = 0x5a6066; // armored puppet: bare dark plate steel, no ochre paint
export const ENGAGE_RANGE = 30; // m: shooters only pop up and fire at a player this close (with line of sight)
// Shooter cycle (s): hidden -> up -> (telegraph -> burst) x bursts -> hidden. It only rises when the raised emitter would see the
// player (no blind pop-ups at a player in cover): hidden, it looks again every `recheck`. Up, it stays for 2-3 bursts with a
// pause between them; losing sight keeps it up for `lostGrace` before it ducks (hysteresis: no flicker on a peeking player).
export const SHOOTER = { hide: [2.0, 3.6], recheck: [0.5, 0.9], rise: 0.5, telegraph: 0.45, shots: 3, shotGap: 0.16, bursts: [2, 3], burstGap: [0.6, 1.1], lostGrace: 0.8 };
const rand = ([a, b]) => a + Math.random() * (b - a);

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _step = new THREE.Vector3();

export class Puppet extends EnemyBody {
  constructor(ctx, def) {
    super(ctx, {
      kind: def.kind,
      pos: def.pos,
      yaw: def.yaw ?? 0,
      health: def.kind === 'shooter' ? HEALTH.shooter : HEALTH.default,
      mats: def.armored ? puppetMaterials(ARMORED, true) : puppetMaterials(def.kind === 'shooter' ? 0x8a6a24 : 0xc9a640), // shooters: a darker ochre
    });
    this.armored = !!def.armored; // `armored` param: plate steel, only heavy rounds (GUNS ammo 'heavy') hurt it
    buildPuppet(this.rig, this.mats, this.visor);
    this.home = this.pos.clone();
    this.to = def.to ? new THREE.Vector3(...def.to) : null;
    this.speed = def.speed ?? 0;
    this.moveT = Math.random();
    this.lift = this.kind === 'shooter' ? HIDE : 0;
    this.state = 'hidden';
    this.timer = 1 + Math.random() * 2;
    this.shotsLeft = 0;
    this.vel = new THREE.Vector3();

    this.rig.attach('Spine2', box(0.22, 0.22, 0.02, targetMat(), 0, 0.12, 0.155)); // bullseye
    this.emitter = this.rig.socket('Spine2', 'emitter', 0, 0.15, 0.3);
    // post + base: instanced across all puppets (Enemies.stands), slot = this.index
    this.index = ctx.takeStand();
    this.finishBody();
  }

  // Damage multiplier (weapon.js): an armored puppet shrugs off everything but heavy rounds (sparks, weapon:armored); others take all.
  armor(zone, object, gun) {
    return !this.armored || gun?.ammo === 'heavy' ? 1 : 0;
  }

  // Spawn groups (enemies.js wakeGroup): only a dormant puppet takes part. `awake` stays false for ordinary puppets
  // (always on, not counted as awake by the group / combat checks); a dormant shooter becomes awake once woken.
  get awake() {
    return this.woken === true;
  }

  wake() {
    if (!this.dormant) return false;
    this.dormant = false;
    this.woken = true;
    return true;
  }

  // the empty post sinks into its base once the debris is gone
  onDebrisCleared() {
    this.ctx.setStand(this.index, this.pos, 0.02);
  }

  think(dt, player) {
    let speed = 0;
    // a mover without a rail (or with speed 0) stands still: dividing by a zero length would put it at NaN
    if (this.kind === 'mover' && this.to && this.speed > 0 && this.home.distanceTo(this.to) > 0) {
      this.moveT += (dt * this.speed) / this.home.distanceTo(this.to);
      const s = 0.5 - 0.5 * Math.cos(this.moveT * Math.PI);
      const prev = _u.copy(this.pos);
      this.pos.lerpVectors(this.home, this.to, s);
      speed = dt > 0 ? prev.distanceTo(this.pos) / dt : 0;
      if (dt > 0) this.vel.subVectors(this.pos, prev).divideScalar(dt);
    }

    if (this.kind === 'shooter' && !this.dormant) this.#shooterAI(dt, player);
    else this.lift += (0 - this.lift) * damp(4, dt);

    const as = this.animState; // posed once per frame by Enemies.animate
    as.speed = speed;
    as.vel = this.vel;
    as.yaw = this.yaw;
    this.group.position.copy(this.pos);
    this.rig.root.position.y = this.lift;
    this.rig.root.rotation.y = this.yaw;
    this.ctx.setStand(this.index, this.pos, Math.max(0.05, 0.95 + this.lift - 0.08));
  }

  #shooterAI(dt, player) {
    const head = _v.copy(this.pos).setY(this.pos.y + 1.7);
    const target = player.chest(_w);
    const dist = head.distanceTo(target);
    const active = !player.dead && dist < ENGAGE_RANGE;

    // turn to face the player
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw += wrapAngle(want - this.yaw) * damp(4, dt);

    const S = SHOOTER;
    this.timer -= dt;
    switch (this.state) {
      case 'hidden':
        this.lift += (HIDE - this.lift) * damp(8, dt);
        if (this.timer > 0) break;
        if (active && this.#hasLOS(target)) {
          this.state = 'up';
          this.timer = S.rise;
          this.burstsLeft = Math.round(rand(S.bursts));
        } else this.timer = rand(S.recheck); // no line of fire: stay down, look again shortly
        break;
      case 'up':
        this.lift += (0 - this.lift) * damp(10, dt);
        if (this.timer <= 0) this.#nextBurst(target, active);
        break;
      case 'telegraph':
        this.visor.emissiveIntensity = VISOR_REST + (S.telegraph - this.timer) * 18;
        if (this.timer <= 0) {
          this.state = 'fire';
          this.shotsLeft = S.shots;
          this.timer = 0;
        }
        break;
      case 'fire':
        if (this.timer <= 0) {
          this.#fire(target);
          this.shotsLeft--;
          this.timer = S.shotGap;
          if (this.shotsLeft <= 0) {
            this.visor.emissiveIntensity = VISOR_REST;
            this.burstsLeft--;
            this.state = 'up'; // stays up between bursts
            this.timer = this.burstsLeft > 0 ? rand(S.burstGap) : 0.6; // last burst: a beat before ducking
          }
        }
        break;
      case 'lost': // up, but the player went out of sight: wait a moment before ducking
        if (this.timer <= 0) this.#nextBurst(target, active);
        break;
    }
  }

  // Up with nothing to wait for: another burst if any are left and the player is in sight, else a grace pause, else down.
  #nextBurst(target, active) {
    const S = SHOOTER;
    const sees = active && this.#hasLOS(target);
    if (sees && this.burstsLeft > 0) {
      this.state = 'telegraph';
      this.timer = S.telegraph;
    } else if (!sees && this.burstsLeft > 0 && this.state !== 'lost') {
      this.state = 'lost';
      this.timer = S.lostGrace;
    } else {
      this.state = 'hidden';
      this.timer = rand(S.hide);
    }
  }

  // Line of sight from the emitter as it is when raised (a hidden shooter checks before rising).
  #hasLOS(target) {
    const from = this.emitter.getWorldPosition(_u);
    from.y -= this.lift;
    return sightRay(from, target, this.ctx.world.meshes);
  }

  #fire(target) {
    const from = this.emitter.getWorldPosition(_u);
    const spread = 0.25 + from.distanceTo(target) * 0.015;
    const dir = _step.copy(target);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    this.ctx.spawnBolt(from, dir.sub(from).normalize());
  }
}

let _target;
function targetMat() {
  if (_target) return _target;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#cfc8b4' : '#1c1d1f'; // calibration rings: bone white on black, matte
    g.beginPath();
    g.arc(32, 32, 32 - i * 8, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _target = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.85 });
  _target.userData.lodColor = new THREE.Color(0x77736a); // average of the rings for the far LOD
  return _target;
}
