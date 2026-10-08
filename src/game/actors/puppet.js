import * as THREE from 'three';
import { EnemyBody, box } from './enemy.js';
import { damp, wrapAngle } from '../../engine/math.js';

// Training puppets: the shared humanoid rig hung on a pneumatic post.
// kinds: 'static' (takes hits), 'mover' (slides on a rail), 'shooter' (pops up from fixed cover and fires).

const HIDE = -0.95; // rig lift when retracted behind low cover
export const ENGAGE_RANGE = 30; // m: shooters only pop up and fire at a player this close (with line of sight)

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _step = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export class Puppet extends EnemyBody {
  constructor(sys, def) {
    super(sys, {
      kind: def.kind,
      pos: def.pos,
      yaw: def.yaw ?? 0,
      health: def.kind === 'shooter' ? 120 : 100,
      colors: { body: def.kind === 'shooter' ? 0xd04a2a : 0xe8c23a },
    });
    this.home = this.pos.clone();
    this.to = def.to ? new THREE.Vector3(...def.to) : null;
    this.speed = def.speed ?? 0;
    this.moveT = Math.random();
    this.lift = this.kind === 'shooter' ? HIDE : 0;
    this.state = 'hidden';
    this.timer = 1 + Math.random() * 2;
    this.shotsLeft = 0;

    this.rig.attach('Spine2', box(0.22, 0.22, 0.02, targetMat(), 0, 0.12, 0.155)); // bullseye
    this.emitter = this.rig.socket('Spine2', 'emitter', 0, 0.15, 0.3);
    // post + base: instanced across all puppets (Enemies.stands), slot = this.index
    this.index = sys.standCount++;
    this.finishBody();
  }

  // the empty post sinks into its base once the debris is gone
  onDebrisCleared() {
    this.sys.setStand(this.index, this.pos, 0.02);
  }

  think(dt, player) {
    let speed = 0;
    if (this.kind === 'mover') {
      this.moveT += (dt * this.speed) / this.home.distanceTo(this.to);
      const s = 0.5 - 0.5 * Math.cos(this.moveT * Math.PI);
      const prev = _u.copy(this.pos);
      this.pos.lerpVectors(this.home, this.to, s);
      speed = dt > 0 ? prev.distanceTo(this.pos) / dt : 0;
    }

    if (this.kind === 'shooter') this.#shooterAI(dt, player);
    else this.lift += (0 - this.lift) * damp(4, dt);

    this.animator.update(dt, { speed: speed * 0.5, run: false, crouch: 0, aimPitch: 0, combat: false });
    this.group.position.copy(this.pos);
    this.rig.root.position.y = this.lift;
    this.rig.root.rotation.y = this.yaw;
    this.sys.setStand(this.index, this.pos, Math.max(0.05, 0.95 + this.lift - 0.08));
  }

  #shooterAI(dt, player) {
    const head = _v.copy(this.pos).setY(this.pos.y + 1.7);
    const target = player.chest(_w);
    const dist = head.distanceTo(target);
    const active = !player.dead && dist < ENGAGE_RANGE;

    // turn to face the player
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw += wrapAngle(want - this.yaw) * damp(4, dt);

    this.timer -= dt;
    switch (this.state) {
      case 'hidden':
        this.lift += (HIDE - this.lift) * damp(8, dt);
        if (this.timer <= 0 && active) {
          this.state = 'up';
          this.timer = 0.5;
        }
        break;
      case 'up':
        this.lift += (0 - this.lift) * damp(10, dt);
        if (this.timer <= 0) {
          if (this.#hasLOS(target)) {
            this.state = 'telegraph';
            this.timer = 0.45;
          } else {
            this.state = 'hidden';
            this.timer = 1 + Math.random();
          }
        }
        break;
      case 'telegraph':
        this.visor.emissiveIntensity = 1.5 + (0.45 - this.timer) * 18;
        if (this.timer <= 0) {
          this.state = 'fire';
          this.shotsLeft = 3;
          this.timer = 0;
        }
        break;
      case 'fire':
        if (this.timer <= 0) {
          this.#fire(target);
          this.shotsLeft--;
          this.timer = 0.16;
          if (this.shotsLeft <= 0) {
            this.state = 'hold';
            this.timer = 0.6;
            this.visor.emissiveIntensity = 1.5;
          }
        }
        break;
      case 'hold':
        if (this.timer <= 0) {
          this.state = 'hidden';
          this.timer = 1.6 + Math.random() * 1.6;
        }
        break;
    }
  }

  #hasLOS(target) {
    const from = this.emitter.getWorldPosition(_u);
    const dir = _step.subVectors(target, from);
    const len = dir.length();
    _ray.set(from, dir.normalize());
    _ray.far = len - 0.5;
    return _ray.intersectObjects(this.sys.world.meshes, false).length === 0;
  }

  #fire(target) {
    const from = this.emitter.getWorldPosition(_u);
    const spread = 0.25 + from.distanceTo(target) * 0.015;
    const dir = _step.copy(target);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    this.sys.spawnBolt(from, dir.sub(from).normalize());
  }
}

let _target;
function targetMat() {
  if (_target) return _target;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#d01818';
    g.beginPath();
    g.arc(32, 32, 32 - i * 8, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _target = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6 });
  _target.userData.lodColor = new THREE.Color(0xd86a6a); // average of the red/white rings for the far LOD
  return _target;
}
