import * as THREE from 'three';
import { EnemyBody, sightRay, VISOR_REST } from './enemy.js';
import { buildTrooper, trooperMaterials } from './looks.js';
import { GUNS, gunMaterials } from '../combat/guns.js';
import { damp, lerpAngle } from '../../engine/math.js';

// Troopers: armed assault robots (looks.js) that move and use cover.
//   idle   -> spot the player (range + line of sight), get shot, or hear a squadmate -> take cover
//   move   -> run to a cover spot that blocks the player's line of fire (CoverMap)
//   cover  -> crouch behind low cover / hide behind high cover
//   peek   -> stand up (low) or step out to the edge (high), only if the firing position sees the player (else stay down and
//             look again; no line of fire `blindChecks` times -> relocate)
//   aim    -> telegraph: visor flares, then a 3-4 bolt burst; 1-3 bursts per peek (the player still in sight), then cover
// They relocate when the spot stops protecting them (flanked), the player gets close, after a few
// bursts, or once when badly hurt (retreat). Getting hit while exposed can suppress them back into cover.
// No cover reachable: they fight in the open and keep looking.
// Squad tactics: cover choice fans out around the player (spread), and the Enemies flank director
// periodically sends one trooper (flank()) to cover on the player's side or rear while the rest keep
// the player pinned.

export const TUNING = {
  health: 150,
  radius: 0.4,
  height: 1.8,
  step: 0.45,
  run: 4.6,
  flankRun: 5.4, // flankers sprint
  flankTravel: 30, // m: how far a flanker will go
  accel: 10,
  plateMult: 0.25, // plated trooper: damage factor of light rounds and the pistol on plate (heavy rounds and the weak spot: x1)
  sight: 32, // m: notice the player within this range with line of sight
  engage: 30, // m: shoot within this range
  alertRadius: 22, // squadmates within this range join in
  tooClose: 5, // m: player this close -> leave the spot
  burstsPerSpot: [3, 6],
  burstsPerPeek: [1, 3], // bursts fired from one exposure while the player stays in sight
  burstGap: [0.5, 0.9], // s up between those bursts (re-aims, visor flares again)
  coverTime: [1.8, 3.4], // s down between exposures
  recheck: [0.6, 1.0], // s: down with no line of fire from the firing position, look again after this (no blind pop-up)
  blindChecks: 3, // that many looks in a row without a line of fire -> the spot is bad for 6 s, relocate
  peekTime: 0.4,
  aimTime: 0.5,
  shotGap: 0.14,
  shots: [3, 4],
  suppressChance: 0.35,
  suppressAfter: 0.6, // s exposed before a hit can make it duck (no flicker: a fresh pop-up commits to its burst)
  suppressTime: [1.2, 2.0], // s down after ducking from a hit
  retreatAt: 0.4, // health fraction
  spreadBase: 0.3,
  spreadPerMeter: 0.012,
};

// s without getting 5 cm closer to the move goal before a trooper gives up on it (squadmate or corner in the way)
const STALL_TIME = 1.0;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _chest = new THREE.Vector3();
const rand = ([a, b]) => a + Math.random() * (b - a);
const randInt = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));

export class Trooper extends EnemyBody {
  constructor(ctx, def) {
    super(ctx, {
      kind: 'trooper',
      pos: def.pos,
      yaw: def.yaw ?? 0,
      health: TUNING.health,
      mats: trooperMaterials(!!def.armored),
      armed: true,
      weakSpots: 1,
    });
    this.armored = !!def.armored; // `armored` param: plated, light rounds / pistol do TUNING.plateMult (weak spot excepted)
    buildTrooper(this.rig, this.mats, this.visor, this.armored);
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
    this.flanking = false;
    this.crouch = 0;
    this.recoil = 0;
    this.aimPitch = 0;

    // rifle in hand (not a hitbox), arms IK to its grips
    // HiveMind rifle: ochre furniture, no glows (guns.js)
    const gun = GUNS.rifle.build(gunMaterials({ plate: this.mats.plate, unlit: true }));
    gun.userData.noHit = true;
    this.rig.attach('Weapon', gun);
    const s = GUNS.rifle.sockets;
    this.rig.socket('Weapon', 'gripR', ...s.gripR);
    this.rig.socket('Weapon', 'gripL', ...s.gripL);
    this.muzzle = this.rig.socket('Weapon', 'muzzle', ...s.muzzle);
    this.finishBody();
    this.#place();
  }

  get speed() {
    return this.flanking ? this.t.flankRun : this.t.run;
  }

  get alerted() {
    return this.state !== 'idle';
  }

  // Spawn groups (enemies.js wakeGroup): awake = alerted.
  get awake() {
    return this.alerted;
  }

  // Damage multiplier (weapon.js): plate turns light rounds and the pistol (GUNS ammo not 'heavy') to plateMult, with sparks
  // and weapon:armored; heavy rounds and the glowing weak spot take full damage.
  armor(zone, object, gun) {
    return !this.armored || zone === 'weak' || gun?.ammo === 'heavy' ? 1 : this.t.plateMult;
  }

  wake() {
    this.dormant = false;
    this.alert();
  }

  // ---------------- perception ----------------

  #eye(out) {
    return out.copy(this.pos).add(this.offset).setY(this.pos.y + (this.crouch > 0.5 ? 1.0 : 1.6));
  }

  #canSee(from, target, slack = 0.4) {
    return sightRay(from, target, this.ctx.world.meshes, slack);
  }

  alert() {
    if (this.alerted || !this.alive || this.dormant) return; // dormant: only wake() / wakeGroup
    this.state = 'cover'; // decide immediately
    this.timer = 0.2 + Math.random() * 0.4; // reaction time
    this.ctx.alertNear(this, this.t.alertRadius);
  }

  onHit(amount, dir) {
    if (!this.alerted) this.alert();
    // exposed and taking fire: duck back
    if ((this.state === 'peek' || this.state === 'aim') && this.spot && this.exposed >= this.t.suppressAfter && Math.random() < this.t.suppressChance) {
      this.#enterCover(rand(this.t.suppressTime));
    }
    if (!this.retreated && this.health < this.maxHealth * this.t.retreatAt) {
      this.retreated = true;
      this.#relocate(true);
    }
  }

  // Recalled (a cut shot's `recall`, Enemies.recall): drop the fight and run along `path` (Vector3 list); `recalled` once at its end
  // (Enemies then removes it). No firing, no cover.
  recall(path) {
    if (!this.alive) return;
    this.ctx.cover.release(this.spot, this);
    this.spot = null;
    this.dormant = false;
    this.state = 'recall';
    this.recallPath = path.slice();
    this.visor.emissiveIntensity = VISOR_REST;
  }

  onDeath() {
    this.ctx.cover.release(this.spot, this);
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
        // the destination stopped protecting (the player moved round): pick another now, not on arrival
        this.recheck = (this.recheck ?? 0) - dt;
        if (this.recheck <= 0) {
          this.recheck = 0.5;
          if (live && !this.ctx.cover.protects(this.spot, player.pos)) {
            this.#relocate();
            break;
          }
        }
        const goal = this.path.length ? this.path[0] : this.spot.pos;
        _d.subVectors(goal, this.pos).setY(0);
        const left = _d.length();
        if (left < 0.5 && this.path.length) {
          this.path.shift(); // waypoint reached: on to the spot
          this.closest = Infinity;
          break;
        }
        if (left < 0.15) {
          this.pos.x = goal.x;
          this.pos.z = goal.z;
          this.vel.set(0, 0, 0);
          this.#enterCover(this.flanking ? 0.2 : rand([0.4, 0.8])); // a flanker opens fire right away
          this.flanking = false;
          break;
        }
        // no progress toward the goal for STALL_TIME (blocked by a squadmate or a corner): pick something else now
        // instead of standing there until the move timer runs out
        if (left < this.closest - 0.05) {
          this.closest = left;
          this.stalled = 0;
        } else if ((this.stalled += dt) > STALL_TIME) {
          this.#relocate();
          break;
        }
        _d.divideScalar(left).multiplyScalar(Math.min(this.speed, left * 4));
        const k = damp(t.accel, dt);
        this.vel.x += (_d.x - this.vel.x) * k;
        this.vel.z += (_d.z - this.vel.z) * k;
        if (this.timer <= 0) this.#relocate(); // stuck for too long: pick something else
        break;
      }

      case 'recall': {
        moving = true;
        const goal = this.recallPath[0];
        if (!goal) {
          this.recalled = true;
          break;
        }
        _d.subVectors(goal, this.pos).setY(0);
        const left = _d.length();
        if (left < 0.8) {
          this.recallPath.shift();
          break;
        }
        _d.divideScalar(left).multiplyScalar(this.t.flankRun);
        const k = damp(t.accel, dt);
        this.vel.x += (_d.x - this.vel.x) * k;
        this.vel.z += (_d.z - this.vel.z) * k;
        break;
      }

      case 'cover':
        // flanked while hiding: move at once rather than wait out the cover time
        if (live && this.spot && this.timer > 0 && !this.ctx.cover.protects(this.spot, player.pos)) {
          this.#relocate();
          break;
        }
        if (this.timer > 0) break;
        if (!live) {
          this.timer = 1;
          break;
        }
        if (!this.spot) {
          this.#relocate();
          break;
        }
        // (the player ran off beyond the retreat limit: the spot is out of the fight, move up)
        if (!this.ctx.cover.protects(this.spot, target) || dist < t.tooClose || dist > this.ctx.cover.t.maxRange + 6 || this.bursts >= this.burstLimit) {
          this.#relocate();
          break;
        }
        // no line of fire from the firing position (the player is behind cover): stay down and look again, no blind pop-up
        if (!this.ctx.cover.sees(this.spot, target)) {
          if (++this.noSight >= t.blindChecks) {
            this.spot.badUntil = this.ctx.time + 6;
            this.#relocate();
          } else this.timer = rand(t.recheck);
          break;
        }
        // pop up / step out
        this.state = 'peek';
        this.timer = t.peekTime;
        this.volley = randInt(t.burstsPerPeek);
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
            if (this.spot) this.spot.badUntil = this.ctx.time + 6;
            this.#relocate();
          } else this.#enterCover(rand(t.coverTime));
        }
        break;

      case 'aim':
        combat = true;
        this.visor.emissiveIntensity = VISOR_REST + Math.max(0, t.aimTime - Math.max(0, this.timer)) * 16; // telegraph
        if (this.timer <= 0) {
          // a follow-up burst needs the player still in sight from the muzzle, else back down
          if (this.volley > 0 && this.spot && !(live && dist < t.engage && this.#canSee(this.muzzle.getWorldPosition(_v), target))) {
            this.#enterCover(rand(t.coverTime));
            break;
          }
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
            this.visor.emissiveIntensity = VISOR_REST;
            this.bursts++;
            if (!this.spot) this.#relocate(); // fighting in the open: look for cover again
            else if (--this.volley > 0 && this.bursts < this.burstLimit) {
              this.state = 'aim'; // stay up: next burst after a short re-aim
              this.timer = t.aimTime + rand(t.burstGap);
            } else this.#enterCover(rand(t.coverTime));
          }
        }
        break;
    }

    // body: move, collide, stay on the ground, keep apart from squadmates
    if (moving) {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      this.ctx.separate(this, 0.9);
      this.ctx.world.collideCircle(this.pos, t.radius, t.height, t.step);
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 12));
    }
    this.pos.y = this.ctx.world.groundAt(this.pos.x, this.pos.z, this.pos.y + t.step);

    // stance: crouched behind low cover except while popping up to shoot
    const exposed = this.state === 'peek' || this.state === 'aim' || this.state === 'fire';
    this.exposed = exposed ? (this.exposed ?? 0) + dt : 0;
    const crouched = this.spot && this.spot.type === 'low' && !moving && !exposed && this.state !== 'idle';
    this.crouch += ((crouched ? 1 : 0) - this.crouch) * damp(10, dt);
    // high cover: step sideways to the edge while exposed
    if (this.spot && this.spot.type === 'high' && exposed && !moving) {
      this.ctx.cover.firingPos(this.spot, this.offsetTarget).sub(this.pos).setY(0);
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

    // posed once per frame by Enemies.animate (late phase), from the state of the last substep
    const as = this.animState;
    as.speed = speed;
    as.run = speed > 2.5;
    as.crouch = this.crouch;
    as.aimPitch = this.aimPitch;
    as.combat = combat || (this.alerted && !moving);
    as.recoil = this.recoil;
    as.vel = this.vel;
    as.yaw = this.yaw;
    this.group.position.copy(this.pos).add(this.offset);
    this.rig.root.position.y = 0;
    this.rig.root.rotation.y = this.yaw;
  }

  #enterCover(time) {
    this.state = 'cover';
    this.timer = time;
  }

  // Squadmates' positions for spreading out (reused array).
  #squad() {
    const out = (this._squad ??= []);
    out.length = 0;
    for (const e of this.ctx.all) if (e !== this && e.alive && e.kind === 'trooper' && e.alerted) out.push(e.spot ? e.spot.pos : e.pos);
    return out;
  }

  // Flank: run to cover beside or behind the player (outside the side they defend or face) from which
  // the player is in sight. Returns false if there is no such spot; the trooper then carries on as before.
  flank(front, eye) {
    if (!this.alive || !this.alerted || this.flanking) return false;
    const found = this.ctx.cover.find(this, this.pos, this.ctx.player.pos, this.ctx.time, {
      avoid: this.spot,
      flank: { front },
      needSight: { eye },
      spread: this.#squad(),
      maxTravel: this.t.flankTravel,
    });
    if (!found) return false;
    this.flanking = true;
    this.#take(found);
    return true;
  }

  // Pick a (new) cover spot and run there; none reachable: fight from here.
  #relocate(retreat = false) {
    const cover = this.ctx.cover;
    const opts = { avoid: this.spot, retreat, spread: this.#squad() };
    let found = cover.find(this, this.pos, this.ctx.player.pos, this.ctx.time, opts);
    // nothing in range (e.g. the player went deep into the building): take cover a bit farther out rather than
    // stand in the open; later relocations work it closer
    if (!found) {
      opts.maxRange = cover.t.maxRange + 6; // the retreat limit: never out of the fight
      found = cover.find(this, this.pos, this.ctx.player.pos, this.ctx.time, opts);
    }
    this.flanking = false;
    this.#take(found);
  }

  #take(found) {
    const cover = this.ctx.cover;
    const next = found?.spot ?? null;
    cover.release(this.spot, this);
    this.spot = next;
    this.path = found?.path ?? [];
    this.bursts = 0;
    this.noSight = 0;
    this.burstLimit = randInt(this.t.burstsPerSpot);
    if (next) {
      cover.claim(next, this);
      this.state = 'move';
      this.timer = (this.path.length ? 1.4 : 1) * (next.pos.distanceTo(this.pos) / this.speed) + 2.5; // give up if it takes much longer
      this.closest = Infinity; // progress watch (move state)
      this.stalled = 0;
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
    this.ctx.spawnBolt(from, dir.sub(from).normalize());
    this.recoil = 1;
  }

  // Spawn placement: settle on the ground, out of geometry.
  #place() {
    this.ctx.world.collideCircle(this.pos, this.t.radius, this.t.height, this.t.step);
    this.pos.y = this.ctx.world.groundAt(this.pos.x, this.pos.z, this.pos.y + this.t.step);
    this.group.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }
}


