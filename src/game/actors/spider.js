import * as THREE from 'three';
import { RigidSkin } from '../../engine/batch.js';
import { disposeTree } from '../../engine/dispose.js';
import { damp, wrapAngle, lerpAngle } from '../../engine/math.js';
import { rbox, rb, cyl, look } from './parts.js';
import { sightRay, rim, VISOR, PROJECTILE } from './enemy.js';
import { navGrid, navStep } from '../ai/nav.js';
import { wornMaterial } from '../world/textures.js';

// Miniboss: a six-legged walker (saucer hull, twin gun pods) guarding the north-east arena.
// The hull is armored (shots bounce). Each leg has a glowing knee joint: break legs to bring it down.
// Every second destroyed leg collapses it for a few seconds and opens the shutters over its core,
// the only part that takes real damage. Attacks: cannon bursts from the gun pods, plasma mortars lobbed
// over cover (worse the longer you hide), and a stomp when you get under it.
//
// Same interface as the other enemies (see enemy.js) plus armor(zone, object) and aimPoints(out, n).
// Built from bones like the humanoids: one RigidSkin draw per material, the part meshes stay as hitboxes.

export const TUNING = {
  name: 'SX-6 TARANTULA',
  core: 900, // health of the core (the boss dies with it)
  coreBite: 0.34, // share of the core's health one collapse can take; spent, it stands up early (none left: no cap)
  legHealth: 160,
  height: 3.4, // body height standing (tall walker stance, art-style.md)
  downHeight: 0.85,
  downTime: 7, // s collapsed per two legs lost
  coreRise: 1.2, // m the core rises out of its hatch while down, clear of the hull rim from the ground
  speed: 2.4, // m/s, minus legSlow per lost leg
  legSlow: 0.12,
  range: [8, 15], // keeps this distance to the player while it sees them; out of sight it walks at them (pursuit)
  rush: { every: [7, 11], speed: 2.0, until: 5, time: 4 }, // charge: every few s (in sight, farther than `until`) it rushes the
  // player at speed x `speed` for up to `time` s or until `until` m away, where the stomp takes over
  steer: { look: 3.5, fan: [0, 0.45, 0.9, 1.35, 1.9, 2.5], stuck: 0.8 }, // obstacle avoidance: probe `look` m ahead along the wish
  // turned by each fan angle (both sides, the last detour side first); no progress for `stuck` s flips the detour side
  nav: { cell: 0.5, every: 0.4, ahead: 4 }, // pursuit pathing: a grid of `cell` m over the arena (free = the collision circle fits),
  // breadth-first search every `every` s, the boss heads for the path cell `ahead` cells on
  radius: 4.2, // collision: the whole leg span, not just the hull (legs must not reach into walls)
  wakeRange: 28,
  burst: { charge: 0.7, shots: 6, gap: 0.11, cooldown: [2.2, 3.4], spread: 0.025, damage: 9 },
  mortar: { every: [6, 8.5], coverBoost: 1.8, flight: 1.5, radius: 3.6, damage: 34, minRange: 8 },
  stomp: { range: 6.5, telegraph: 0.75, radius: 7, damage: 24, cooldown: 3 },
};

const LEG = { femur: 2.4, tibia: 3.8, step: 1.3, stepTime: 0.3, stepHeight: 0.7, lead: 0.35 };
const HIPS = [[1.25, 1.2], [1.45, 0], [1.25, -1.2]]; // [|x|, z] on the hull, front to back
const REST = [[3.8, 3.1], [4.4, 0], [3.8, -3.1]]; // foot rest offsets in the body's space (legs splayed wide)
// rim sensor clusters: [angle around the rim (0 = front), height on the band, cluster radius, lenses]
const SENSORS = [[0.08, 0.0, 0.1, 3], [-0.14, -0.01, 0.085, 3], [0.27, 0.01, 0.075, 3], [-0.33, 0.0, 0.065, 2], [0.45, -0.01, 0.055, 2], [-0.55, 0.01, 0.045, 2]];
const GREAVES = 0.3; // leg damage factor of light rounds and the pistol (plate greaves); heavy rounds x1
const GUN_SIDE = 2.95; // m from the muzzle to each gun pod, sideways

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Vector3();
const _k = new THREE.Vector3();
const _f = new THREE.Vector3();
const _c = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const DEBRIS_DIR = new THREE.Vector3();
const DEBRIS = { dir: DEBRIS_DIR, push: [3, 3], spread: 3, up: [3, 3], spin: 8, life: 6 }; // see DebrisBank.burst
const BLAST = { point: new THREE.Vector3(), radius: 0, kind: '' };
const STEP = { point: new THREE.Vector3(), big: false };
const HITBOX_MAT = new THREE.MeshBasicMaterial(); // never drawn
const CORE_Y = 0.86; // core height on the body, hatch closed

export class SpiderMech {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.t = TUNING;
    this.kind = 'boss';
    this.name = TUNING.name;
    this.pos = new THREE.Vector3(...def.pos);
    this.yaw = def.yaw ?? 0;
    this.arena = def.arena ?? { minX: def.pos[0] - 10, maxX: def.pos[0] + 10, minZ: def.pos[2] - 10, maxZ: def.pos[2] + 10 }; // { minX, maxX, minZ, maxZ } from the level file: the boss stays inside, and wakes when the player walks in
    this.maxHealth = this.health = TUNING.core;
    this.alive = true;
    this.lift = 0;
    this.awake = false;
    this.down = 0; // > 0: collapsed, core exposed (seconds left)
    this.bite = 0; // core damage this collapse can still take
    this.height = 2.4; // dormant: crouched
    this.vel = new THREE.Vector3();
    this.strafe = 1;
    this.strafeTimer = 4;
    this.detour = 1; // side the steering tries first (+1 left / -1 right)
    this.stuck = 0;
    this.rushTimer = 6; // s to the next charge
    this.rushing = 0; // s left in a charge
    this.flash = 0;
    this.time = 0;
    this.gun = { state: 'idle', timer: 2, shots: 0 };
    this.mortarTimer = 4;
    this.stomp = { state: 'idle', timer: 0 };
    this.debris = [];
    this.orbs = [];

    const M = {
      hull: wornMaterial(0x3a3d40, { roughness: 0.6, metalness: 0.5, wear: 'metal' }), // dark metal hull
      plate: wornMaterial(0xc9a23a, { roughness: 0.85, metalness: 0.15 }), // matte ochre livery, chipped
      trim: wornMaterial(0x17181b, { roughness: 0.5, metalness: 0.65, wear: 'metal' }), // black frame, rams
      eye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: VISOR, emissiveIntensity: 1 }), // violet sensor cluster
      weak: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 }),
    };
    M.weak.userData.lodGlow = 5; // far LOD: knees and core stay readable
    M.eye.userData.lodGlow = 3;
    this.mats = M;

    // ----- bones + parts -----
    this.root = new THREE.Group();
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    const bones = [];
    const bone = (parent, x = 0, y = 0, z = 0) => {
      const b = new THREE.Bone();
      b.position.set(x, y, z);
      parent.add(b);
      bones.push(b);
      return b;
    };
    this.hitMeshes = [];
    // hitboxes: invisible boxes (not drawn, still raycast), except the glowing weak parts, drawn as they are
    const part = (b, w, h, d, mat, x, y, z, zone, partId) => {
      const weak = mat === M.weak;
      const m = new THREE.Mesh(weak ? rbox(w, h, d, 0.08) : new THREE.BoxGeometry(w, h, d), weak ? mat : HITBOX_MAT);
      m.position.set(x, y, z);
      m.visible = weak;
      m.userData = { enemy: this, zone, part: partId };
      b.add(m);
      this.hitMeshes.push(m);
      return m;
    };
    const R = Math.PI / 2;

    // Look (art-style.md, the owner's walker concept): a saucer hull in worn ochre over dark metal, a dark sensor band
    // round the rim with small uneven violet lens clusters, twin-barrel gun pods on side pylons, jointed hydraulic legs
    // hung from a hub under the hull, the core under a split hatch on top. Hitboxes stay boxes (invisible).
    this.body = bone(this.root, 0, this.height, 0);
    part(this.body, 4.6, 1.0, 4.6, M.hull, 0, 0.2, 0, 'torso', 'hull'); // saucer
    part(this.body, 1.6, 0.6, 1.6, M.hull, 0, -0.5, 0, 'torso', 'hull'); // hub under the hull
    for (const s of [1, -1]) for (const [hx, hz] of HIPS) part(this.body, 0.5, 0.5, 0.5, M.hull, s * hx, -0.1, hz, 'torso', 'hull'); // hip mounts
    // hull, in pieces so it breaks apart: lower shell and hub, upper shell and deck, hip mounts per side
    const D = 22; // saucer segments
    this.body.add(
      look(
        cyl(M.plate, 2.5, 1.45, 0.5, 0, -0.17, 0, 0, 0, 0, D), // lower shell
        cyl(M.trim, 1.47, 1.47, 0.06, 0, -0.43, 0, 0, 0, 0, D), // keel ring
        cyl(M.hull, 0.75, 0.6, 0.55, 0, -0.62, 0, 0, 0, 0, 14), // hub
        cyl(M.trim, 0.78, 0.78, 0.08, 0, -0.42, 0, 0, 0, 0, 14),
        rb(M.trim, 0.5, 0.3, 0.9, 0.06, 0, -0.75, 0.55), // under-hub sensor mast block
        ...[0, 1, 2, 3, 4, 5].map((k) => rb(M.trim, 0.06, 0.42, 0.8, 0.02, Math.sin((k * Math.PI) / 3) * 2.0, -0.2, Math.cos((k * Math.PI) / 3) * 2.0, 0, (k * Math.PI) / 3, 0)), // shell ribs
      ),
      look(
        cyl(M.plate, 1.6, 2.52, 0.36, 0, 0.47, 0, 0, 0, 0, D), // upper shell
        cyl(M.trim, 2.54, 2.54, 0.05, 0, 0.29, 0, 0, 0, 0, D), // rim lip
        cyl(M.hull, 1.0, 1.6, 0.1, 0, 0.7, 0, 0, 0, 0, D), // deck
        cyl(M.trim, 0.7, 0.7, 0.08, 0, 0.74, 0, 0, 0, 0, 16), // hatch ring around the core
        rb(M.plate, 0.6, 0.03, 0.5, 0.01, 1.3, 0.6, -0.9, -0.15, 0.6, 0), // welded patch plates
        rb(M.hull, 0.45, 0.03, 0.35, 0.01, -1.5, 0.57, 0.7, 0.12, -0.9, 0.08),
        cyl(M.trim, 0.025, 0.025, 1.1, 0.55, 1.2, -0.8, 0, 0, 0.1, 6), // antennas
        cyl(M.trim, 0.015, 0.015, 0.7, 0.75, 1.0, -0.7, 0, 0, -0.15, 5),
        cyl(M.trim, 0.2, 0.24, 0.55, 0, 0.95, -1.0, -0.4, 0, 0, 12), // mortar tube
        cyl(M.plate, 0.25, 0.25, 0.08, 0, 0.82, -0.92, -0.4, 0, 0, 12),
      ),
    );
    for (const s of [1, -1]) {
      const hips = [];
      for (const [hx, hz] of HIPS) {
        hips.push(
          cyl(M.hull, 0.27, 0.27, 0.5, s * hx, -0.1, hz, 0, 0, R, 14), // hip drum
          cyl(M.trim, 0.29, 0.29, 0.08, s * (hx + 0.2), -0.1, hz, 0, 0, R, 14),
          cyl(M.plate, 0.12, 0.12, 0.06, s * (hx + 0.27), -0.1, hz, 0, 0, R, 10), // cap
          cyl(M.trim, 0.03, 0.03, 0.9, s * (hx - 0.4), -0.35, hz * 0.7, 0.4, 0, s * 0.9, 5), // cable bundle to the hub
        );
      }
      this.body.add(look(...hips));
    }
    // core on top, under a split armored hatch; its bone lifts it out while the mech is down
    this.coreLift = bone(this.body, 0, CORE_Y, 0);
    this.core = part(this.coreLift, 1.0, 0.35, 1.0, M.weak, 0, 0, 0, 'weak', 'core');
    this.shutters = [1, -1].map((s) => {
      const b = bone(this.body, s * 0.62, 1.05, 0);
      part(b, 0.64, 0.12, 1.15, M.plate, -s * 0.32, 0, 0, 'torso', 'hull');
      b.add(
        look(
          rb(M.plate, 0.64, 0.12, 1.15, 0.05, -s * 0.32, 0, 0), // hatch half
          rb(M.trim, 0.58, 0.05, 0.08, 0.02, -s * 0.32, 0.07, -0.3), // ribs
          rb(M.trim, 0.58, 0.05, 0.08, 0.02, -s * 0.32, 0.07, 0),
          rb(M.trim, 0.58, 0.05, 0.08, 0.02, -s * 0.32, 0.07, 0.3),
          cyl(M.hull, 0.06, 0.06, 1.1, 0, -0.02, 0, R, 0, 0, 10), // hinge
        ),
      );
      b.userData.side = s;
      return b;
    });
    // turret: the sensor band turns on the rim toward the target; the gun pods pitch on their own bone
    this.turret = bone(this.body, 0, 0.17, 0);
    part(this.turret, 1.8, 0.24, 0.12, M.eye, 0, 0, 2.47, 'torso', 'hull'); // sensor band front
    const band = [
      cyl(M.trim, 2.51, 2.51, 0.24, 0, 0, 0, 0, 0, 0, D), // dark sensor band
    ];
    // small violet lens clusters on the band, uneven in size and spacing (never a row of eyes)
    for (const [a, y, r, n] of SENSORS) {
      const cx = Math.sin(a) * 2.52;
      const cz = Math.cos(a) * 2.52;
      band.push(cyl(M.trim, r * 1.6, r * 1.6, 0.05, cx, y, cz, R, 0, -a, 10)); // lens housing
      for (let k = 0; k < n; k++) {
        const t = (k / n) * Math.PI * 2 + a * 3;
        const lx = Math.cos(t) * r * 0.6;
        const ly = Math.sin(t) * r * 0.6;
        band.push(cyl(M.eye, r * 0.42, r * 0.42, 0.06, cx + Math.cos(a) * lx, y + ly, cz - Math.sin(a) * lx, R, 0, -a, 8));
      }
    }
    this.turret.add(look(...band));
    this.guns = bone(this.turret, 0, 0, 0);
    for (const s of [1, -1]) part(this.guns, 0.6, 0.55, 1.9, M.hull, s * GUN_SIDE, 0, 0.6, 'torso', 'hull');
    const pods = [];
    for (const s of [1, -1]) {
      const x = s * GUN_SIDE;
      pods.push(
        rb(M.trim, 0.55, 0.16, 0.36, 0.04, s * 2.55, 0, 0.2), // pylon from the rim
        cyl(M.trim, 0.06, 0.06, 0.6, s * 2.5, -0.15, 0.25, 0, 0, s * 0.9, 6), // pylon ram
        rb(M.plate, 0.5, 0.52, 0.8, 0.07, x, 0, 0.2), // gun pod (ochre)
        rb(M.trim, 0.52, 0.08, 0.82, 0.02, x, 0.14, 0.2), // pod band
        rb(M.plate, 0.4, 0.36, 0.3, 0.05, x, 0, 0.72), // breech
        cyl(M.hull, 0.065, 0.075, 1.2, x + 0.1, 0.06, 1.35, R, 0, 0, 10), // twin barrels
        cyl(M.hull, 0.065, 0.075, 1.2, x - 0.1, 0.06, 1.35, R, 0, 0, 10),
        cyl(M.trim, 0.09, 0.09, 0.1, x + 0.1, 0.06, 1.05, R, 0, 0, 10), // cooling rings
        cyl(M.trim, 0.09, 0.09, 0.1, x - 0.1, 0.06, 1.05, R, 0, 0, 10),
        cyl(M.trim, 0.085, 0.085, 0.14, x + 0.1, 0.06, 1.98, R, 0, 0, 10), // scorched muzzles
        cyl(M.trim, 0.085, 0.085, 0.14, x - 0.1, 0.06, 1.98, R, 0, 0, 10),
        rb(M.trim, 0.24, 0.14, 0.36, 0.03, x, -0.32, 0.1), // ammo feed
      );
    }
    this.guns.add(look(...pods));
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.06, 2.05); // between the pods; shots alternate to each pod (GUN_SIDE)
    this.guns.add(this.muzzle);

    // legs: femur and tibia bones are posed by IK every frame (root space), +Y along the segment; their twist is
    // arbitrary, so the leg looks stay round-ish
    this.legs = [];
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? 1 : -1; // +X = the mech's left
      const row = i % 3;
      const femur = bone(this.root);
      const tibia = bone(this.root);
      const id = i;
      const F = LEG.femur;
      const T = LEG.tibia;
      part(femur, 0.42, F, 0.44, M.hull, 0, F / 2, 0, 'limb', id);
      part(femur, 0.48, F * 0.6, 0.12, M.plate, 0, F * 0.5, 0.26, 'limb', id);
      femur.add(
        look(
          rb(M.hull, 0.4, F - 0.2, 0.42, 0.1, 0, F / 2, 0), // femur beam
          rb(M.plate, 0.48, F * 0.6, 0.1, 0.04, 0, F * 0.5, 0.26), // armor
          rb(M.trim, 0.49, 0.08, 0.11, 0.03, 0, F * 0.32, 0.27),
          rb(M.trim, 0.49, 0.08, 0.11, 0.03, 0, F * 0.68, 0.27),
          rb(M.plate, 0.44, 0.34, 0.5, 0.06, 0, F * 0.08, 0), // collar plate over the hip end
          cyl(M.trim, 0.085, 0.085, F * 0.7, 0, F * 0.48, -0.3, 0, 0, 0, 10), // hydraulic ram
          cyl(M.hull, 0.05, 0.05, F * 0.5, 0, F * 0.76, -0.3, 0, 0, 0, 10),
          cyl(M.plate, 0.1, 0.1, 0.06, 0, F * 0.18, -0.3, 0, 0, 0, 10),
          cyl(M.trim, 0.02, 0.02, F * 0.8, 0.14, F * 0.5, -0.24, 0, 0, 0, 5), // cable bundle
          cyl(M.trim, 0.02, 0.02, F * 0.8, -0.14, F * 0.5, -0.24, 0, 0, 0, 5),
        ),
      );
      const knee = part(tibia, 0.42, 0.42, 0.42, M.weak, 0, 0, 0, 'weak', id);
      part(tibia, 0.32, T, 0.34, M.hull, 0, T / 2, 0, 'limb', id);
      part(tibia, 0.54, 0.25, 0.54, M.plate, 0, T, 0, 'limb', id); // foot
      tibia.add(
        look(
          cyl(M.trim, 0.29, 0.29, 0.14, 0, 0, 0, 0, 0, R, 14), // knee collar
          rb(M.hull, 0.32, T - 0.5, 0.34, 0.08, 0, T * 0.45, 0), // shin
          rb(M.plate, 0.4, T * 0.35, 0.4, 0.06, 0, T * 0.3, 0), // shin guard
          rb(M.trim, 0.41, 0.06, 0.41, 0.02, 0, T * 0.47, 0),
          cyl(M.trim, 0.06, 0.06, T * 0.5, 0, T * 0.62, -0.2, 0, 0, 0, 8), // shin ram
          cyl(M.hull, 0.15, 0.24, 0.55, 0, T - 0.2, 0, 0, 0, 0, 12), // ankle
          rb(M.plate, 0.56, 0.2, 0.56, 0.06, 0, T - 0.02, 0), // foot pad
          rb(M.trim, 0.6, 0.06, 0.6, 0.02, 0, T + 0.08, 0), // sole
          cyl(M.trim, 0.13, 0.03, 0.22, 0, T + 0.2, 0, 0, 0, 0, 8), // spike
        ),
      );
      const hip = new THREE.Vector3(side * HIPS[row][0], -0.1, HIPS[row][1]);
      const rest = new THREE.Vector3(side * REST[row][0], 0, REST[row][1]);
      const foot = this.root.localToWorld(rest.clone());
      foot.y = ctx.world.groundAt(foot.x, foot.z, foot.y + 2);
      this.legs.push({
        side, row, femur, tibia, knee, hip, rest, foot,
        group: (row + (side > 0 ? 0 : 1)) % 2, // tripod gait: two alternating groups of three
        from: new THREE.Vector3(), to: new THREE.Vector3(), stepT: -1,
        health: TUNING.legHealth, alive: true,
      });
    }
    this.skeleton = new THREE.Skeleton(bones);
    ctx.scene.add(this.root);
    this.#pose(0);
    this.skin = new RigidSkin(this.root, this.skeleton, { cullMargin: 1.6, lod: true });
    rim([M.hull, M.plate, M.trim, this.skin.lodMaterial]);
    ctx.debris.prime(this.kind, this.skin);
    ctx.markDirty();
  }

  // Removes the mech from the scene and frees everything it owns (rig, skin, debris, mortar orbs and rings).
  dispose() {
    this.ctx.debris.releaseAll(this.debris);
    for (const o of this.orbs) {
      disposeTree(o.obj);
      disposeTree(o.ring);
    }
    this.orbs.length = 0;
    disposeTree(this.root);
    for (const m of [...Object.values(this.mats), this.skin.lodMaterial]) m.dispose();
  }

  get legsLost() {
    let n = 0;
    for (const l of this.legs) if (!l.alive) n++;
    return n;
  }

  // Core open: collapsed with the hatch up (its bite not spent, or no legs left).
  get coreOpen() {
    return this.down > 0 && (this.bite > 0 || this.down === Infinity);
  }

  // Damage multiplier for a hit on this object: the hull and closed core shrug shots off; while the core is open the legs
  // do too (sparks, weapon:armored), so the collapse is the moment to shoot the core. Plate greaves: light rounds and the
  // pistol (GUNS ammo not 'heavy') do GREAVES to a leg, knees included; heavy rounds full.
  armor(zone, object, gun) {
    const p = object.userData.part;
    if (p === 'hull') return 0;
    if (p === 'core') return this.coreOpen ? 1 : 0;
    if (this.coreOpen) return 0;
    return gun?.ammo === 'heavy' ? 1 : GREAVES;
  }

  // Returns true if this hit destroyed it.
  damage(amount, point, dir, zone, object) {
    if (!this.alive || amount <= 0) return false;
    this.flash = 0.06;
    if (!this.awake && !this.dormant) this.#wake();
    const p = object?.userData.part;
    if (p === 'core') {
      if (this.down !== Infinity) {
        amount = Math.min(amount, this.bite);
        this.bite -= amount;
        if (this.bite <= 0) this.down = Math.min(this.down, 0.6); // hatch closes: break more legs
      }
      this.health -= amount;
      if (this.health <= 0) {
        this.#die(dir);
        return true;
      }
      return false;
    }
    if (typeof p === 'number') {
      const leg = this.legs[p];
      if (!leg.alive) return false;
      leg.health -= amount;
      if (leg.health <= 0) this.#breakLeg(leg, dir);
    }
    return false;
  }

  // What the camera frames while the boss is engaged: the body, a bit low so the legs stay in view.
  focusPoint(out) {
    this.body.getWorldPosition(out);
    out.y -= 0.6;
    return out;
  }

  // Aim assist targets: knees and the exposed core.
  aimPoints(out, n) {
    for (const l of this.legs) {
      if (!l.alive) continue;
      if (!out[n]) out[n] = new THREE.Vector3();
      l.knee.getWorldPosition(out[n++]);
    }
    if (this.down > 0) {
      if (!out[n]) out[n] = new THREE.Vector3();
      this.core.getWorldPosition(out[n++]);
    }
    return n;
  }

  // Spawn groups (enemies.js wakeGroup).
  wake() {
    if (!this.alive) return;
    this.dormant = false;
    this.#wake();
  }

  #wake() {
    if (this.awake) return;
    this.awake = true;
    this.ctx.events.emit('boss:wake', this);
  }

  #breakLeg(leg, dir) {
    leg.alive = false;
    this.root.updateMatrixWorld(true);
    leg.knee.getWorldPosition(BLAST.point);
    BLAST.radius = 2;
    BLAST.kind = 'leg';
    this.ctx.events.emit('boss:leg', BLAST);
    this.#debris([leg.femur, leg.tibia], dir);
    for (const b of [leg.femur, leg.tibia]) b.scale.setScalar(1e-4); // hides its skinned parts
    this.hitMeshes = this.hitMeshes.filter((m) => m.userData.part !== this.legs.indexOf(leg));
    this.ctx.markDirty();
    // every second leg lost brings it down (a mech with no legs left stays down)
    const lost = this.legsLost;
    if (lost % 2 === 0 || lost >= 5) {
      this.down = lost >= 6 ? Infinity : this.t.downTime;
      this.bite = this.t.coreBite * this.maxHealth;
      this.gun.state = 'idle';
      this.gun.timer = 1.5;
      this.stomp.state = 'idle';
      this.ctx.events.emit('boss:down', this);
    }
  }

  // The pieces on these bones (look, weak part) fly off as debris chunks.
  #debris(bones, dir) {
    DEBRIS_DIR.copy(dir);
    this.ctx.debris.burst(this.kind, this.skin, this.ctx.scene, this.debris, DEBRIS, bones);
  }

  #die(dir) {
    this.alive = false;
    this.health = 0;
    this.root.updateMatrixWorld(true);
    this.core.getWorldPosition(BLAST.point);
    BLAST.radius = 6;
    BLAST.kind = 'death';
    this.ctx.events.emit('boss:dead', BLAST);
    this.ctx.reportKill(this);
    this.#debris(this.skeleton.bones.filter((b) => b.scale.x > 0.01), dir); // broken legs already burst
    this.root.visible = false;
    for (const o of this.orbs) o.obj.visible = o.ring.visible = false;
  }

  // Scripted leap (a cut shot's `leap`, encounter.js): flies on an arc from where it stands to `to` in `time` s (`peak` m over the
  // straight line), legs tucked under the hull, and lands with a slam (shake and dust, no damage). Ignores the arena bounds on the
  // way; `to` should be inside them. settle() lands it at once (a skipped cut).
  leap(to, { time = 1.8, peak = 9 } = {}) {
    if (!this.alive) return;
    this.jump = { from: this.pos.clone(), to: new THREE.Vector3(...to), t: 0, time, peak };
    this.yaw = Math.atan2(to[0] - this.pos.x, to[2] - this.pos.z);
    this.vel.set(0, 0, 0);
  }

  settle() {
    if (this.jump) this.jump.t = this.jump.time;
  }

  #leapStep(dt) {
    const j = this.jump;
    j.t = Math.min(j.time, j.t + dt);
    const u = j.t / j.time;
    this.pos.lerpVectors(j.from, j.to, u);
    this.pos.y += j.peak * 4 * u * (1 - u);
    this.height += (this.t.height - 0.6 - this.height) * damp(6, dt); // legs drawn in
    if (u < 1) return;
    this.jump = null;
    this.pos.copy(j.to);
    BLAST.point.copy(this.pos);
    BLAST.radius = this.t.stomp.radius;
    BLAST.kind = 'stomp';
    this.ctx.events.emit('blast', BLAST); // landing slam: dust, shake, sound (no damage)
    for (const l of this.legs) if (l.alive) l.stepT = -1;
  }

  update(dt, player) {
    this.time += dt;
    this.#updateDebris(dt);
    if (!this.alive) return;
    if (this.jump) {
      this.#leapStep(dt);
      this.#pose(dt);
      return;
    }

    // wake when the player comes into the arena (or close with line of sight)
    if (!this.awake && !this.dormant && !player.dead) {
      const p = player.pos;
      const A = this.arena;
      const inArena = p.x > A.minX && p.x < A.maxX && p.z > A.minZ && p.z < A.maxZ;
      if (inArena || (p.distanceTo(this.pos) < this.t.wakeRange && this.#sees(player))) this.#wake();
    }

    const active = this.awake && !player.dead;
    if (this.down > 0) this.down -= dt;
    const isDown = this.down > 0;
    if (active && !isDown) {
      this.#move(dt, player);
      this.#cannon(dt, player);
      this.#mortar(dt, player);
      this.#stomp(dt, player);
    } else {
      this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
    }
    this.#updateOrbs(dt, player);

    // body height: dormant crouch, standing, collapsed; stomp rears up then slams
    let want = this.awake ? this.t.height - this.legsLost * 0.08 : 2.4;
    if (isDown) want = this.t.downHeight;
    if (this.stomp.state === 'rear') want += 0.7;
    const rate = isDown ? 7 : this.stomp.state === 'slam' ? 30 : 3;
    this.height += (want - this.height) * damp(rate, dt);

    // turret tracks the player; the body slowly turns toward them
    const target = player.chest(_v);
    const toYaw = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    if (active && !isDown) this.yaw = lerpAngle(this.yaw, toYaw, damp(0.9, dt));
    const tYaw = active ? wrapAngle(toYaw - this.yaw) : 0;
    this.turret.rotation.y += (THREE.MathUtils.clamp(tYaw, -1.6, 1.6) - this.turret.rotation.y) * damp(isDown ? 1 : 5, dt);
    const muzzleY = this.pos.y + this.height + 0.23;
    const pitch = Math.atan2(target.y - muzzleY, Math.hypot(target.x - this.pos.x, target.z - this.pos.z));
    this.guns.rotation.x += (THREE.MathUtils.clamp(-pitch, -0.5, 0.6) - this.guns.rotation.x) * damp(5, dt);
    // shutters open while down and the core rises out of the hatch, bigger, so it can be hit from the ground
    for (const s of this.shutters) {
      const open = isDown ? 1.35 : 0;
      s.rotation.z += (open * s.userData.side - s.rotation.z) * damp(6, dt);
    }
    const rise = isDown ? 1 : 0;
    const lift = this.coreLift;
    lift.position.y += (CORE_Y + rise * this.t.coreRise - lift.position.y) * damp(5, dt);
    lift.scale.setScalar(1 + (lift.position.y - CORE_Y) / this.t.coreRise * 0.3);

    this.#pose(dt);

    // looks: eye charge, hit flash, pulsing weak spots
    this.flash -= dt;
    const e = this.flash > 0 ? 0.6 : 0;
    this.mats.hull.emissive.setScalar(e);
    this.mats.plate.emissive.setScalar(e);
    this.mats.trim.emissive.setScalar(e);
    const charge = this.gun.state === 'charge' ? 1 - this.gun.timer / this.t.burst.charge : 0;
    this.mats.eye.emissiveIntensity = this.awake ? 1 + charge * 10 : 0.3; // at rest dimmer than the weak spots
    this.mats.weak.emissiveIntensity = (isDown ? 4 : 2.8) + Math.sin(this.time * (isDown ? 14 : 8)) * 1.0;
  }

  // ----- behavior -----

  #move(dt, player) {
    const dx = player.pos.x - this.pos.x;
    const dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const [near, far] = this.t.range;
    const R = this.t.rush;
    if ((this.seeTimer = (this.seeTimer ?? 0) - dt) <= 0) {
      this.seeTimer = 0.25; // a raycast four times a second is plenty for steering
      this.seen = this.#sees(player);
    }
    const sees = this.seen;
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafe = -this.strafe;
      this.strafeTimer = 4 + Math.random() * 3;
    }
    // charge: in sight and not yet close, every few seconds it rushes in (the stomp follows at the end)
    this.rushTimer -= dt;
    if (this.rushing > 0) {
      this.rushing -= dt;
      if (dist < R.until) this.rushing = 0;
    } else if (this.rushTimer <= 0 && sees && dist > R.until + 2) {
      this.rushing = R.time;
      this.rushTimer = R.every[0] + Math.random() * (R.every[1] - R.every[0]);
    }
    // pursue: rushing, or the player out of sight (behind cover) or too far -> walk at them; too close -> back off;
    // else circle them, drifting in
    const pursue = this.rushing > 0 || !sees || dist > far;
    const radial = pursue ? 1 : dist < near ? -1 : 0.25;
    const circle = pursue ? 0 : 0.7;
    _w.set((dx / dist) * radial - (dz / dist) * this.strafe * circle, 0, (dz / dist) * radial + (dx / dist) * this.strafe * circle);
    if (_w.lengthSq() > 1) _w.normalize();
    // pursuit goes round the cover on a path; circling only needs the local steering
    if (pursue) {
      if ((this.navTimer = (this.navTimer ?? 0) - dt) <= 0) {
        this.navTimer = this.t.nav.every;
        this.waypoint = this.#path(player.pos, this.waypoint ?? new THREE.Vector3());
      }
      if (this.waypoint) _w.set(this.waypoint.x - this.pos.x, 0, this.waypoint.z - this.pos.z).normalize();
    }
    if (!pursue || !this.waypoint) this.#steer(_w); // a path is already clear
    const speed = this.t.speed * (1 - this.legsLost * this.t.legSlow) * (this.rushing > 0 ? R.speed : 1);
    const k = damp(2, dt);
    this.vel.x += (_w.x * speed - this.vel.x) * k;
    this.vel.z += (_w.z * speed - this.vel.z) * k;
    const before = _v.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    this.ctx.world.collideCircle(this.pos, this.t.radius, 2.4, 1.3); // walks over low cover, not through walls
    const A = this.arena;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, A.minX + this.t.radius, A.maxX - this.t.radius);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, A.minZ + this.t.radius, A.maxZ - this.t.radius);
    // blocked (little progress for a while): detour the other way round, circle the other way
    if (before.distanceTo(this.pos) < this.vel.length() * dt * 0.3 && this.vel.lengthSq() > 0.5) {
      if ((this.stuck += dt) > this.t.steer.stuck) {
        this.stuck = 0;
        this.detour = -this.detour;
        this.strafe = -this.strafe;
        this.strafeTimer = 3;
      }
    } else this.stuck = Math.max(0, this.stuck - dt);
  }

  // Pursuit path (ai/nav.js): over the arena grid, built once on first use (the colliders don't move); the path cell `ahead` cells on, or null.
  #path(goal, out) {
    this.nav ??= navGrid(this.ctx.world, this.arena, { radius: this.t.radius, cell: this.t.nav.cell, feet: this.pos.y, climb: 1.3, height: 2.4 });
    return navStep(this.nav, this.pos, goal, this.t.nav.ahead, out);
  }

  // Obstacle avoidance: turns the wish `w` (xz, length = throttle) to the nearest fan angle whose path `look` m ahead is clear
  // of walls and high cover (low cover is walked over) and stays in the arena; the detour side is tried first. None clear: unchanged
  // (the stuck check flips the side).
  #steer(w) {
    const len = Math.hypot(w.x, w.z);
    if (len < 1e-3) return;
    const S = this.t.steer;
    const A = this.arena;
    const r = this.t.radius - 0.1; // just inside the collision circle: the start never overlaps what it is pressed against
    const base = Math.atan2(w.x, w.z);
    for (const a of S.fan) {
      for (const side of a ? [this.detour, -this.detour] : [1]) {
        const ang = base + a * side;
        _c.set(this.pos.x + Math.sin(ang) * S.look, this.pos.y, this.pos.z + Math.cos(ang) * S.look);
        if (_c.x < A.minX + this.t.radius || _c.x > A.maxX - this.t.radius || _c.z < A.minZ + this.t.radius || _c.z > A.maxZ - this.t.radius) continue;
        if (!this.ctx.world.segmentClear(this.pos, _c, r, 1.3, 2.4)) continue;
        if (a) this.detour = side; // keep going round the same way
        w.set(Math.sin(ang) * len, 0, Math.cos(ang) * len);
        return;
      }
    }
  }

  #sees(player) {
    return sightRay(this.muzzle.getWorldPosition(_h), player.chest(_k), this.ctx.world.meshes);
  }

  #cannon(dt, player) {
    const g = this.gun;
    const b = this.t.burst;
    g.timer -= dt;
    if (g.state === 'idle') {
      if (g.timer <= 0) {
        if (this.#sees(player)) {
          g.state = 'charge';
          g.timer = b.charge;
          this.ctx.events.emit('boss:charge', this);
        } else g.timer = 0.5;
      }
    } else if (g.state === 'charge') {
      if (g.timer <= 0) {
        g.state = 'burst';
        g.shots = b.shots;
        g.timer = 0;
      }
    } else if (g.timer <= 0) {
      this.muzzle.getWorldPosition(_h);
      const target = player.chest(_k);
      const spread = b.spread + _h.distanceTo(target) * 0.004;
      _f.subVectors(target, _h).normalize();
      _f.x += (Math.random() - 0.5) * spread * 2;
      _f.y += (Math.random() - 0.5) * spread * 2;
      _f.z += (Math.random() - 0.5) * spread * 2;
      // alternate gun pods
      _h.addScaledVector(_w.set(Math.cos(this.yaw + this.turret.rotation.y), 0, -Math.sin(this.yaw + this.turret.rotation.y)), g.shots % 2 ? GUN_SIDE : -GUN_SIDE);
      this.ctx.spawnBolt(_h, _f.normalize(), b.damage);
      g.timer = b.gap;
      if (--g.shots <= 0) {
        g.state = 'idle';
        g.timer = b.cooldown[0] + Math.random() * (b.cooldown[1] - b.cooldown[0]);
      }
    }
  }

  // Plasma mortar: lobbed at where the player is; a ring on the ground marks the impact.
  #mortar(dt, player) {
    const m = this.t.mortar;
    // hiding makes it come sooner: cover doesn't help against a lob
    this.mortarTimer -= dt * (player.cover ? m.coverBoost : 1);
    if (this.mortarTimer > 0) return;
    this.mortarTimer = m.every[0] + Math.random() * (m.every[1] - m.every[0]);
    if (player.pos.distanceTo(this.pos) < m.minRange) return;
    const o = this.#orb();
    this.root.updateMatrixWorld(true);
    o.obj.position.set(this.pos.x, this.pos.y + this.height + 1.2, this.pos.z);
    // lead a moving player a little
    o.target.copy(player.pos).addScaledVector(player.vel, 0.5);
    o.target.y = this.ctx.world.groundAt(o.target.x, o.target.z, player.pos.y + 0.5);
    o.t = 0;
    o.flight = m.flight;
    o.vel.subVectors(o.target, o.obj.position).divideScalar(m.flight);
    o.vel.y += 0.5 * GRAVITY * m.flight;
    o.ring.position.set(o.target.x, o.target.y + 0.03, o.target.z);
    o.obj.visible = o.ring.visible = true;
    this.ctx.events.emit('boss:mortar', o.obj.position);
  }

  #orb() {
    let o = this.orbs.find((x) => !x.obj.visible);
    if (o) return o;
    const obj = new THREE.Mesh(ORB_GEO, ORB_MAT);
    obj.add(new THREE.Mesh(ORB_GLOW_GEO, ORB_GLOW_MAT));
    const ring = new THREE.Mesh(RING_GEO, RING_MAT.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(this.t.mortar.radius);
    this.ctx.scene.add(obj, ring);
    o = { obj, ring, vel: new THREE.Vector3(), target: new THREE.Vector3(), t: 0, flight: 1 };
    this.orbs.push(o);
    return o;
  }

  #updateOrbs(dt, player) {
    const m = this.t.mortar;
    for (const o of this.orbs) {
      if (!o.obj.visible) continue;
      o.t += dt;
      o.vel.y -= GRAVITY * dt;
      o.obj.position.addScaledVector(o.vel, dt);
      const k = Math.min(1, o.t / o.flight);
      o.ring.material.opacity = 0.25 + 0.5 * k * (0.6 + 0.4 * Math.sin(o.t * 30));
      if (o.t < o.flight) continue;
      o.obj.visible = o.ring.visible = false;
      this.#blast(o.target, m.radius, m.damage, player, 'mortar');
    }
  }

  #stomp(dt, player) {
    const s = this.stomp;
    const st = this.t.stomp;
    s.timer -= dt;
    const near = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z) < st.range;
    if (s.state === 'idle') {
      if (near && s.timer <= 0) {
        s.state = 'rear';
        s.timer = st.telegraph;
        this.ctx.events.emit('boss:stomp', this);
      }
    } else if (s.state === 'rear') {
      if (s.timer <= 0) {
        s.state = 'slam';
        s.timer = 0.25;
      }
    } else if (s.state === 'slam') {
      if (s.timer <= 0) {
        s.state = 'idle';
        s.timer = st.cooldown;
        _v.set(this.pos.x, this.pos.y, this.pos.z);
        this.#blast(_v, st.radius, st.damage, player, 'stomp');
      }
    }
  }

  #blast(point, radius, damage, player, kind) {
    BLAST.point.copy(point);
    BLAST.radius = radius;
    BLAST.kind = kind;
    this.ctx.events.emit('blast', BLAST);
    if (player.dead) return;
    const d = Math.hypot(player.pos.x - point.x, player.pos.z - point.z);
    if (d > radius || Math.abs(player.pos.y - point.y) > 2) return;
    this.ctx.hurtPlayer(damage * (1 - 0.5 * (d / radius)), point);
  }

  // ----- body + legs -----

  #pose(dt) {
    const root = this.root;
    root.position.copy(this.pos);
    root.rotation.y = this.yaw;
    // tilt toward lost legs (and settle on what's left)
    let roll = 0;
    let pitch = 0;
    for (const l of this.legs) {
      if (l.alive) continue;
      roll += l.side * 0.07;
      pitch += (l.row - 1) * -0.06;
    }
    this.body.position.y = this.height;
    this.body.rotation.set(pitch, 0, roll);
    root.updateMatrixWorld(true);

    // gait: a foot steps when it trails too far from its rest spot and the other tripod is planted
    const world = this.ctx.world;
    let stepping = -1;
    for (const l of this.legs) if (l.alive && l.stepT >= 0) stepping = l.group;
    for (const l of this.legs) {
      if (!l.alive) continue;
      const home = root.localToWorld(_h.copy(l.rest));
      home.addScaledVector(this.vel, LEG.lead);
      // never plant a foot in or on a wall: pull it in toward the body until the way is clear
      _c.set(this.pos.x, this.pos.y, this.pos.z);
      for (let f = 0.8; f > 0.2 && !world.segmentClear(_c, home, 0.3, 1.3, 3); f -= 0.2) home.lerpVectors(_c, home, f / (f + 0.2));
      home.y = world.groundAt(home.x, home.z, this.pos.y + 1.5);
      if (this.jump) {
        l.stepT = -1;
        l.foot.set(home.x, this.pos.y + 0.4, home.z); // in the air: feet tucked under the body (a planted foot would stretch the leg)
      } else if (l.stepT < 0) {
        const far = Math.hypot(home.x - l.foot.x, home.z - l.foot.z) > (this.down > 0 ? 3 : LEG.step);
        if (far && (stepping < 0 || stepping === l.group) && dt > 0) {
          l.stepT = 0;
          l.from.copy(l.foot);
          l.to.copy(home);
          stepping = l.group;
        }
      }
      if (l.stepT >= 0) {
        l.stepT = Math.min(1, l.stepT + dt / LEG.stepTime);
        const e = l.stepT * l.stepT * (3 - 2 * l.stepT);
        l.foot.lerpVectors(l.from, l.to, e);
        l.foot.y += Math.sin(Math.PI * l.stepT) * LEG.stepHeight;
        if (l.stepT >= 1) {
          l.stepT = -1;
          STEP.point.copy(l.foot);
          STEP.big = this.stomp.state === 'slam';
          this.ctx.events.emit('boss:step', STEP);
        }
      }
      // IK: hip -> knee (bends up and out) -> foot
      const hip = this.body.localToWorld(_h.copy(l.hip));
      const d = _f.subVectors(l.foot, hip);
      const dist = THREE.MathUtils.clamp(d.length(), 0.3, LEG.femur + LEG.tibia - 0.01);
      d.normalize();
      const a = LEG.femur;
      const b = LEG.tibia;
      const cosA = THREE.MathUtils.clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      // bend direction: up, a little outward
      _w.set(Math.cos(this.yaw) * l.side * 0.15, 1, -Math.sin(this.yaw) * l.side * 0.15);
      _w.addScaledVector(d, -_w.dot(d)).normalize();
      const knee = _k.copy(hip).addScaledVector(d, a * cosA).addScaledVector(_w, a * sinA);
      const reach = _v.copy(hip).addScaledVector(d, dist);
      placeBone(l.femur, root, hip, knee);
      placeBone(l.tibia, root, knee, reach, true);
    }
    root.updateMatrixWorld(true);
    // the glowing parts (core, knees) were baked into the skin, so their meshes are frozen proxies that the update above
    // skips: refresh the ones that are shot at, or their hitboxes stay where the mech was at the bake
    for (const m of this.hitMeshes) if (m.userData.proxy) this.skin.syncHit(m);
  }

  #updateDebris(dt) {
    if (this.debris.length) this.ctx.debris.step(this.debris, dt, this.ctx.world);
  }
}

const GRAVITY = 14;
const ORB_GEO = new THREE.SphereGeometry(0.28, 12, 8);
const ORB_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(PROJECTILE.core).multiplyScalar(5) });
const ORB_GLOW_GEO = new THREE.SphereGeometry(0.6, 12, 8);
const ORB_GLOW_MAT = new THREE.MeshBasicMaterial({ color: PROJECTILE.glow, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
const RING_GEO = new THREE.RingGeometry(0.86, 1, 40);
const RING_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(PROJECTILE.ring).multiplyScalar(2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

// Puts a segment bone (child of `root`, +Y along the segment) at world `a`, pointing at world `b`.
// The tibia is authored from the knee (y = 0) down, so it points from the knee to the foot.
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
function placeBone(bone, root, a, b) {
  const la = root.worldToLocal(_pa.copy(a));
  bone.position.copy(la);
  const lb = root.worldToLocal(_pb.copy(b)).sub(la).normalize();
  bone.quaternion.setFromUnitVectors(_yAxis, lb);
}
