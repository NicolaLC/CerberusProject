import * as THREE from 'three';
import { EnemyBody } from './enemy.js';
import { GUNS } from '../combat/guns.js';
import { damp, lerpAngle } from '../../engine/math.js';

// Troopers: armed soldiers that move and use cover.
//   idle   -> spot the player (range + line of sight), get shot, or hear a squadmate -> take cover
//   move   -> run to a cover spot that blocks the player's line of fire (CoverMap)
//   cover  -> crouch behind low cover / hide behind high cover
//   peek   -> stand up (low) or step out to the edge (high); no line of sight twice -> relocate
//   aim    -> telegraph: visor flares, then a 3-4 bolt burst; back to cover
// They relocate when the spot stops protecting them (flanked), the player gets close, after a few
// bursts, or once when badly hurt (retreat). Getting hit while exposed can suppress them back into cover.
// No cover reachable: they fight in the open and keep looking.

const TUNING = {
  health: 150,
  radius: 0.4,
  height: 1.8,
  step: 0.45,
  run: 4.6,
  accel: 10,
  sight: 32, // m: notice the player within this range with line of sight
  engage: 30, // m: shoot within this range
  alertRadius: 22, // squadmates within this range join in
  tooClose: 5, // m: player this close -> leave the spot
  burstsPerSpot: [2, 4],
  coverTime: [1.0, 2.2],
  peekTime: 0.4,
  aimTime: 0.5,
  shotGap: 0.14,
  shots: [3, 4],
  suppressChance: 0.5,
  retreatAt: 0.4, // health fraction
  spreadBase: 0.3,
  spreadPerMeter: 0.012,
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const rand = ([a, b]) => a + Math.random() * (b - a);
const randInt = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));

export class Trooper extends EnemyBody {
  constructor(sys, def) {
    super(sys, {
      kind: 'trooper',
      pos: def.pos,
      yaw: def.yaw ?? 0,
      health: TUNING.health,
      colors: { body: 0x3b4250, plate: 0x8f2a24, visor: 0xff3a20 },
      armed: true,
      weakSpots: 1,
    });
    this.t = TUNING;
    this.vel = new THREE.Vector3();
    this.offset = new THREE.Vector3(); // peek step, applied to the visual position
    this.offsetTarget = new THREE.Vector3();
    this.state = 'idle';
    this.timer = 0;
    this.spot = null;
    this.path = [];
    this.bursts = 0;
    this.noSight = 0;
    this.shotsLeft = 0;
    this.retreated = false;
    this.crouch = 0;
    this.recoil = 0;
    this.aimPitch = 0;

    // rifle in hand (not a hitbox), arms IK to its grips
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.5, roughness: 0.45 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff5a2a, emissiveIntensity: 2 });
    const gun = GUNS.rifle.build({ gun: gunMat, plate: this.mats.plate, glow, glowHot: glow }, boxMesh);
    gun.userData.noHit = true;
    this.rig.attach('Weapon', gun);
    const s = GUNS.rifle.sockets;
    this.rig.socket('Weapon', 'gripR', ...s.gripR);
    this.rig.socket('Weapon', 'gripL', ...s.gripL);
    this.muzzle = this.rig.socket('Weapon', 'muzzle', ...s.muzzle);
    this.finishBody();
    this.#place();
  }

  get alerted() {
    return this.state !== 'idle';
  }

  // ---------------- perception ----------------

  #eye(out) {
    return out.copy(this.pos).add(this.offset).setY(this.pos.y + (this.crouch > 0.5 ? 1.0 : 1.6));
  }

  #canSee(from, target, slack = 0.4) {
    const d = _d.subVectors(target, from);
    const len = d.length();
    _ray.set(from, d.divideScalar(len));
    _ray.near = 0;
    _ray.far = Math.max(0.01, len - slack);
    return _ray.intersectObjects(this.sys.world.meshes, false).length === 0;
  }

  alert() {
    if (this.alerted || !this.alive) return;
    this.state = 'cover'; // decide immediately
    this.timer = 0.2 + Math.random() * 0.4; // reaction time
    this.sys.alertNear(this, this.t.alertRadius);
  }

  onHit(amount, dir) {
    if (!this.alerted) this.alert();
    // exposed and taking fire: duck back
    if ((this.state === 'peek' || this.state === 'aim') && this.spot && Math.random() < this.t.suppressChance) {
      this.#enterCover(0.8 + Math.random() * 0.6);
    }
    if (!this.retreated && this.health < this.maxHealth * this.t.retreatAt) {
      this.retreated = true;
      this.#relocate(true);
    }
  }

  onDeath() {
    this.sys.cover.release(this.spot, this);
    this.spot = null;
  }

  // ---------------- behavior ----------------

  think(dt, player) {
    const t = this.t;
    const target = player.chest(_chest);
    const dist = this.pos.distanceTo(target);
    const live = !player.dead;
    this.timer -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 8);
    let combat = false;
    let moving = false;

    switch (this.state) {
      case 'idle':
        if (live && dist < t.sight && this.timer <= 0) {
          this.timer = 0.25; // look twice a second
          if (this.#canSee(this.#eye(_v), target)) this.alert();
        }
        break;

      case 'move': {
        moving = true;
        const goal = this.path.length ? this.path[0] : this.spot.pos;
        _d.subVectors(goal, this.pos).setY(0);
        const left = _d.length();
        if (left < 0.5 && this.path.length) {
          this.path.shift(); // waypoint reached: on to the spot
          break;
        }
        if (left < 0.15) {
          this.pos.x = goal.x;
          this.pos.z = goal.z;
          this.vel.set(0, 0, 0);
          this.#enterCover(rand([0.4, 0.8]));
          break;
        }
        _d.divideScalar(left).multiplyScalar(Math.min(t.run, left * 4));
        const k = damp(t.accel, dt);
        this.vel.x += (_d.x - this.vel.x) * k;
        this.vel.z += (_d.z - this.vel.z) * k;
        if (this.timer <= 0) this.#relocate(); // stuck for too long: pick something else
        break;
      }

      case 'cover':
        if (this.timer > 0) break;
        if (!live) {
          this.timer = 1;
          break;
        }
        if (!this.spot) {
          this.#relocate();
          break;
        }
        if (!this.sys.cover.protects(this.spot, target) || dist < t.tooClose || this.bursts >= this.burstLimit) {
          this.#relocate();
          break;
        }
        // pop up / step out
        this.state = 'peek';
        this.timer = t.peekTime;
        break;

      case 'peek':
        combat = true;
        if (this.timer > 0) break;
        if (live && dist < t.engage && this.#canSee(this.muzzle.getWorldPosition(_v), target)) {
          this.noSight = 0;
          this.state = 'aim';
          this.timer = t.aimTime;
        } else {
          // can't see the player from here: give it one more try, then move
          if (++this.noSight >= 2) {
            if (this.spot) this.spot.badUntil = this.sys.time + 6;
            this.#relocate();
          } else this.#enterCover(rand(t.coverTime));
        }
        break;

      case 'aim':
        combat = true;
        this.visor.emissiveIntensity = 1.5 + (t.aimTime - Math.max(0, this.timer)) * 16; // telegraph
        if (this.timer <= 0) {
          this.state = 'fire';
          this.shotsLeft = randInt(t.shots);
          this.timer = 0;
        }
        break;

      case 'fire':
        combat = true;
        if (this.timer <= 0) {
          this.#fire(target, dist);
          this.timer = t.shotGap;
          if (--this.shotsLeft <= 0) {
            this.visor.emissiveIntensity = 1.5;
            this.bursts++;
            if (this.spot) this.#enterCover(rand(t.coverTime));
            else this.#relocate(); // fighting in the open: look for cover again
          }
        }
        break;
    }

    // body: move, collide, stay on the ground, keep apart from squadmates
    if (moving) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.sys.separate(this, 0.9);
      this.sys.world.collideCircle(this.pos, t.radius, t.height, t.step);
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 12));
    }
    this.pos.y = this.sys.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.step);

    // stance: crouched behind low cover except while popping up to shoot
    const exposed = this.state === 'peek' || this.state === 'aim' || this.state === 'fire';
    const crouched = this.spot && this.spot.type === 'low' && !moving && !exposed && this.state !== 'idle';
    this.crouch += ((crouched ? 1 : 0) - this.crouch) * damp(10, dt);
    // high cover: step sideways to the edge while exposed
    if (this.spot && this.spot.type === 'high' && exposed && !moving) {
      this.sys.cover.firingPos(this.spot, this.offsetTarget).sub(this.pos).setY(0);
    } else this.offsetTarget.set(0, 0, 0);
    this.offset.lerp(this.offsetTarget, damp(12, dt));

    // facing: where we run, otherwise at the player
    let want = this.yaw;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (moving && speed > 0.5) want = Math.atan2(this.vel.x, this.vel.z);
    else if (this.alerted) want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw = lerpAngle(this.yaw, want, damp(combat ? 14 : 8, dt));

    // aim pitch toward the player's chest
    const eyeY = this.pos.y + 1.45;
    const flat = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
    this.aimPitch += (Math.atan2(target.y - eyeY, flat) - this.aimPitch) * damp(10, dt);

    this.animator.update(dt, {
      speed,
      run: speed > 2.5,
      crouch: this.crouch,
      aimPitch: this.aimPitch,
      combat: combat || (this.alerted && !moving),
      recoil: this.recoil,
    });
    this.group.position.copy(this.pos).add(this.offset);
    this.rig.root.position.y = 0;
    this.rig.root.rotation.y = this.yaw;
  }

  #enterCover(time) {
    this.state = 'cover';
    this.timer = time;
  }

  // Pick a (new) cover spot and run there; none reachable: fight from here.
  #relocate(retreat = false) {
    const cover = this.sys.cover;
    const threat = this.sys.player.pos;
    const prev = this.spot;
    const found = cover.find(this, this.pos, threat, this.sys.time, { avoid: prev, retreat });
    const next = found?.spot ?? null;
    cover.release(prev, this);
    this.spot = next;
    this.path = found?.path ?? [];
    this.bursts = 0;
    this.noSight = 0;
    this.burstLimit = randInt(this.t.burstsPerSpot);
    if (next) {
      cover.claim(next, this);
      this.state = 'move';
      this.timer = (this.path.length ? 1.4 : 1) * (next.pos.distanceTo(this.pos) / this.t.run) + 2.5; // give up if it takes much longer
    } else {
      this.state = 'peek'; // in the open: shoot, then look again
      this.timer = 0.3;
    }
  }

  #fire(target, dist) {
    const from = this.muzzle.getWorldPosition(_v);
    const spread = this.t.spreadBase + dist * this.t.spreadPerMeter;
    const dir = _w.copy(target);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    this.sys.spawnBolt(from, dir.sub(from).normalize());
    this.recoil = 1;
  }

  // Spawn placement: settle on the ground, out of geometry.
  #place() {
    this.sys.world.collideCircle(this.pos, this.t.radius, this.t.height, this.t.step);
    this.pos.y = this.sys.world.groundAt(this.pos.x, this.pos.z, this.pos.y + this.t.step);
    this.group.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }
}

function boxMesh(w, h, d, m, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
