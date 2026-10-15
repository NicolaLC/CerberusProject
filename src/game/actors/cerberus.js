import * as THREE from 'three';
import { RigidSkin } from '../../engine/batch.js';
import { disposeTree } from '../../engine/dispose.js';
import { damp, wrapAngle } from '../../engine/math.js';
import { rb, cyl, ring, look } from './parts.js';
import { sightRay, VISOR, PROJECTILE } from './enemy.js';
import { wornMaterial } from '../world/textures.js';

// CERBERUS: the HiveMind's guardian protocol in one war-body (gdd.md 8.5), met once at the end of the Prologue on the
// Skyway. A colossal machine clamped to the tower beside the bridge, out of reach, with three heads on booms, one per
// sub-intelligence: VIGIL (one great sensor eye: sweeping bolt bursts), LEGION (a voice / emitter array: calls drones) and
// COLOSSUS (a heavy jaw cannon: mortar rings). The fight is scripted to be lost: it CANNOT BE DESTROYED.
//
// Health: three heads, each its own segment of the boss bar. A hit chips one head (zone `weak` on its glowing eye / node /
// bore, x3 by the gun); the head repairs back toward full after `repairDelay` s without damage, and never drops below
// `floor` of its health. `damage()` always returns false. The hull and the necks are armored (sparks, no damage) and block
// bullets, so only the heads can be hurt.
//
// Counting: `unkillable = true`. It is in `Enemies.all` (hit meshes, boss bar, camera lock-on) but never counts toward
// destroy objectives (mission.js), `arena:clear` or the HUD kill counter (`Enemies.killable`), so it cannot block a level.
// The drones LEGION calls are ordinary drones in its spawn group (kills count like any drone's).
//
// The volley (the Skyway's loss cut, level.md): a cut shot with `cue: 'volley'` makes all three heads charge together (glow rising for
// `volley.charge` s) and then fire a violet beam each at where the player stands (`volley.beam` s) with a blast there. Visual only (no damage),
// the last of the scripted loss; it also wakes a sleeping CERBERUS.
//
// Same interface as the other bosses (see enemy.js / spider.js): kind 'boss', name, awake, alive, pos, lift, debris,
// hitMeshes, armor(), damage(), focusPoint(), aimPoints(), wake(), update(), dispose(); the HUD's boss bar reads `segments`
// (three { name, value 0..1, floor }) instead of the spider's leg pips.
//
// Frame of the piece: local +Z is where the heads point (yaw 0 faces +Z), `pos` is on the deck line directly under the hull
// centre. The hull hovers 7 m up; x -11..11, z -10 (rear clamps) .. 18 (cannon), y -9 .. 14 around `pos` (footprint in level.md).
// Built from bones like the spider: one RigidSkin draw per material, invisible boxes are the hitboxes.

export const TUNING = {
  name: 'CERBERUS',
  head: 1000, // health of each head (the bar segment)
  floor: 0.65, // fraction of a head's health it never drops below (param `floor`)
  repair: 0.08, // of a head's health per second once repairing (param `repair`)
  repairDelay: 1.5, // s without damage before a head starts to repair
  hullY: 7, // m: hull centre above `pos`
  bolt: { charge: 0.9, shots: 8, gap: 0.14, cooldown: [3, 4.5], sweep: 3.2, spread: 0.02, damage: 8 }, // VIGIL: 8 x 8 dmg swept across +-3.2 m
  mortar: { every: [5, 7.5], coverBoost: 1.8, flight: 1.5, radius: 3.8, damage: 30, first: 4 }, // COLOSSUS (spider's lob; faster against a player in cover)
  drones: { max: 3, every: [7, 10], batch: 2, first: 3 }, // LEGION: calls up to `batch` drones when fewer than `max` live
  volley: { charge: 1.5, beam: 0.9, radius: 0.45, blast: 6 }, // the loss cut: s of charging, s of beams, beam radius (m), blast radius (m)
};

const HEADS = [
  { id: 'vigil', name: 'VIGIL', x: 0, y: 2.3, a: -0.5, b: 0.25 }, // a: pitch of the first boom segment (down +), b: extra pitch of the second
  { id: 'legion', name: 'LEGION', x: -7.2, y: 0.4, a: -0.35, b: 0.3 },
  { id: 'colossus', name: 'COLOSSUS', x: 7.2, y: 0.4, a: -0.3, b: 0.35 },
];
const BOOM = { z: 3.6, a: 4.5, b: 3.8 }; // shoulder z on the hull, lengths of the two segments
const R = Math.PI / 2;
const GRAVITY = 14;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _h = new THREE.Vector3();
const _k = new THREE.Vector3();
const _f = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const BLAST = { point: new THREE.Vector3(), radius: 0, kind: '' };
const HITBOX_MAT = new THREE.MeshBasicMaterial(); // never drawn
const ORB_GEO = new THREE.SphereGeometry(0.28, 12, 8);
const ORB_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(PROJECTILE.core).multiplyScalar(5) });
const ORB_GLOW_GEO = new THREE.SphereGeometry(0.6, 12, 8);
const ORB_GLOW_MAT = new THREE.MeshBasicMaterial({ color: PROJECTILE.glow, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
const BEAM_GEO = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0); // unit beam along +Y, scaled to (radius, length, radius)
const BEAM_GLOW_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8c3cff).multiplyScalar(2.2), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const BEAM_CORE_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf2e8ff).multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const RING_GEO = new THREE.RingGeometry(0.86, 1, 40);
const RING_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(PROJECTILE.ring).multiplyScalar(2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

// A cylinder of radius r from a to b (root space).
function strut(mat, r, a, b, seg = 10) {
  const m = cyl(mat, r, r, a.distanceTo(b), (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, 0, 0, 0, seg);
  m.quaternion.setFromUnitVectors(_yAxis, new THREE.Vector3().subVectors(b, a).normalize());
  return m;
}

export class Cerberus {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.t = TUNING;
    this.kind = 'boss';
    this.name = TUNING.name;
    this.pos = new THREE.Vector3(...def.pos);
    this.yaw = def.yaw ?? 0;
    // where the player can be (targeting, waking); default: a square in front of the heads
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    this.arena = def.arena ?? { minX: this.pos.x + fx * 14 - 14, maxX: this.pos.x + fx * 14 + 14, minZ: this.pos.z + fz * 14 - 14, maxZ: this.pos.z + fz * 14 + 14 };
    this.floor = THREE.MathUtils.clamp(def.floor ?? TUNING.floor, 0, 1);
    this.repair = Math.max(0, def.repair ?? TUNING.repair);
    this.unkillable = true; // see the header: never counted, never dies
    this.alive = true;
    this.lift = 0;
    this.awake = false;
    this.time = 0;
    this.rise = 0; // 0 folded (dormant) .. 1 heads up (awake)
    this.debris = []; // none: it never breaks (the HUD reads the length)
    this.orbs = [];
    this.drones = []; // the drones LEGION called
    this.vigil = { state: 'idle', timer: 2.5, shots: 0, dir: 1 };
    this.volley = null; // { t, fired, target } while the loss cut's volley runs
    this.beams = []; // [{ glow, core }] per head, built at the first volley
    this.offShot = ctx.events.on('cinematic:shot', (e) => {
      if (e.shot?.cue === 'volley' && !this.volley) this.volley = { t: 0, fired: false, target: new THREE.Vector3(), aimed: false };
    });
    this.mortarTimer = TUNING.mortar.first;
    this.droneTimer = TUNING.drones.first;
    this.heads = HEADS.map((h) => ({ ...h, max: TUNING.head, health: TUNING.head, since: 99, flash: 0, flare: 0, weak: null, muzzle: null, bone: null, neckA: null, neckB: null }));
    this.segments = this.heads.map((h) => ({ name: h.name, value: 1, floor: this.floor })); // the boss bar (hud.js)
    this.maxHealth = TUNING.head * 3;
    this.health = this.maxHealth;

    // ----- materials (art-style.md: dark metal hull, worn ochre livery, violet sensors, magenta weak spots) -----
    const M = {
      hull: wornMaterial(0x3a3d40, { roughness: 0.6, metalness: 0.5, wear: 'metal' }),
      plate: wornMaterial(0xc9a23a, { roughness: 0.85, metalness: 0.15 }), // matte ochre livery, chipped
      trim: wornMaterial(0x17181b, { roughness: 0.5, metalness: 0.65, wear: 'metal' }),
      rust: wornMaterial(0x9c4a26, { roughness: 0.95, metalness: 0.2 }),
      eye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: VISOR, emissiveIntensity: 1 }), // violet sensor lenses
      // per-head livery (art-style.md 3): VIGIL light and sleek, LEGION ochre and dark grey, COLOSSUS old, faded almost to bone. Each head
      // has its own so a hit flashes that head only.
      shell: [
        wornMaterial(0xd2b868, { roughness: 0.8, metalness: 0.2 }),
        wornMaterial(0xc9a23a, { roughness: 0.85, metalness: 0.15 }),
        wornMaterial(0xb9ab86, { roughness: 0.95, metalness: 0.1 }),
      ],
      weak: this.heads.map(() => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 })),
    };
    for (const w of M.weak) w.userData.lodGlow = 5; // far LOD: the weak spots stay readable
    M.eye.userData.lodGlow = 3;
    this.mats = M;
    this.matList = [M.hull, M.plate, M.trim, M.rust, M.eye, ...M.shell, ...M.weak];

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
    // hitbox: an invisible box (not drawn, never baked, still raycast). `head` set: that head takes damage; else it is hull (armor 0).
    const box = (b, w, h, d, x, y, z, zone = 'torso', head = null) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HITBOX_MAT);
      m.position.set(x, y, z);
      m.visible = false;
      m.userData = { enemy: this, zone, part: head == null ? 'hull' : 'head', head };
      b.add(m);
      this.hitMeshes.push(m);
      return m;
    };

    this.frame = bone(this.root, 0, 0, 0); // static: the clamps to the tower
    this.hull = bone(this.root, 0, TUNING.hullY, 0);
    this.#buildFrame(M);
    this.#buildHull(M, box);
    this.heads.forEach((h, i) => this.#buildHead(h, i, M, bone, box));

    this.skeleton = new THREE.Skeleton(bones);
    ctx.scene.add(this.root);
    this.#pose(0, null);
    this.skin = new RigidSkin(this.root, this.skeleton, { cullMargin: 1.4, lod: true });
    ctx.markDirty();
  }

  // Clamps: hydraulic struts from the hull down and back to the tower, upper arms and anchor blocks.
  #buildFrame(M) {
    const parts = [];
    for (const s of [1, -1]) {
      for (const [x, z] of [[5.5, -1], [8.5, -3]]) {
        parts.push(
          strut(M.trim, 0.7, new THREE.Vector3(s * x, 4.2, z), new THREE.Vector3(s * (x + 1.2), -8, -9.5), 10), // main strut
          strut(M.hull, 0.38, new THREE.Vector3(s * (x - 1.1), 3.4, z + 0.4), new THREE.Vector3(s * (x + 0.4), -7, -9.3), 8), // ram
        );
      }
      parts.push(
        rb(M.hull, 2.4, 2.2, 8, 0.3, s * 8.3, 9.4, -8), // upper arm back to the tower
        rb(M.plate, 2.6, 0.5, 6.5, 0.1, s * 8.3, 10.6, -7.6), // armor on the arm
        rb(M.trim, 3.6, 3.6, 1.4, 0.2, s * 8.6, 9.4, -12), // anchor clamp
        rb(M.hull, 3.2, 3.2, 1.2, 0.2, s * 9.4, -8, -10.4), // lower anchor foot
        cyl(M.trim, 0.45, 0.45, 1.6, s * 7.2, 9.4, -12.6, R, 0, 0, 10), // clamp bolts
        cyl(M.rust, 0.5, 0.5, 0.2, s * 9.4, -8, -11.1, R, 0, 0, 10),
      );
    }
    this.frame.add(look(...parts));
  }

  #buildHull(M, box) {
    const hull = this.hull;
    const parts = [
      rb(M.hull, 16, 5, 9, 0.5, 0, 0, 0), // carapace
      rb(M.plate, 14.5, 0.7, 7.4, 0.2, 0, 2.7, -0.2), // upper armor deck, ochre
      rb(M.trim, 14.8, 0.2, 0.5, 0.05, 0, 3.1, 1.2),
      rb(M.trim, 14.8, 0.2, 0.5, 0.05, 0, 3.1, -1.6),
      rb(M.plate, 13, 1.2, 1.5, 0.2, 0, -2.8, 0.5), // belly plate
      cyl(M.trim, 2.4, 2.4, 1.2, 0, -3.1, -0.5, 0, 0, 0, 20), // reactor drum under the hull
      cyl(M.hull, 1.6, 1.6, 0.4, 0, -3.8, -0.5, 0, 0, 0, 16),
      // front face: armored lip, vent slats, welded patches
      rb(M.plate, 15, 1.4, 0.7, 0.15, 0, 1.2, 4.6),
      rb(M.rust, 2.6, 0.9, 0.12, 0.03, 4.8, 1.0, 5.0, 0, 0, 0.05), // welded patch plates
      rb(M.hull, 2.0, 0.8, 0.12, 0.03, -5.4, 1.3, 5.0, 0, 0, -0.08),
      ...[0, 1, 2, 3, 4].map((k) => rb(M.trim, 0.25, 2.4, 0.2, 0.04, -3 + k * 1.5, -0.5, 4.6)), // vent slats
      // rear: exhaust stacks and the comms mast
      cyl(M.trim, 0.75, 0.9, 3.6, -5.2, 4.2, -2.6, 0, 0, 0, 12),
      cyl(M.trim, 0.75, 0.9, 3.6, 5.2, 4.2, -2.6, 0, 0, 0, 12),
      cyl(M.rust, 0.95, 0.95, 0.3, -5.2, 6.0, -2.6, 0, 0, 0, 12),
      cyl(M.rust, 0.95, 0.95, 0.3, 5.2, 6.0, -2.6, 0, 0, 0, 12),
      cyl(M.trim, 0.12, 0.12, 5, 1.8, 5.5, -3.2, 0, 0, 0.12, 6),
      cyl(M.trim, 0.08, 0.08, 3.4, -2.4, 4.7, -3.4, 0, 0, -0.1, 5),
    ];
    // shoulder pods carrying the three booms, with cable bundles into the carapace
    for (const s of [1, -1]) {
      parts.push(
        rb(M.hull, 4.2, 4.6, 7.4, 0.5, s * 9, 0, 0),
        rb(M.plate, 4.4, 0.6, 6.4, 0.15, s * 9, 2.5, 0),
        rb(M.trim, 4.5, 0.25, 0.5, 0.05, s * 9, 1.2, 3.7),
        rb(M.rust, 1.6, 1.1, 0.12, 0.03, s * 9.2, -0.4, 3.75),
        cyl(M.trim, 0.3, 0.3, 6.5, s * 6.9, 1.8, 0, R, 0, 0, 8), // cable bundles
        cyl(M.trim, 0.3, 0.3, 6.5, s * 6.9, -1.2, 0.4, R, 0, 0, 8),
      );
    }
    hull.add(look(...parts));
    // small violet lens clusters on the shoulder pods: uneven sizes and spacing (never a row of eyes)
    const lenses = [];
    for (const [x, y, z, r, n] of [[-9.6, 0.4, 3.78, 0.16, 3], [-8.4, -0.5, 3.78, 0.11, 2], [9.2, 0.2, 3.78, 0.14, 3], [10.0, -0.7, 3.78, 0.09, 2], [8.3, 1.4, 3.78, 0.08, 2]]) {
      lenses.push(cyl(M.trim, r * 2.2, r * 2.2, 0.06, x, y, z - 0.02, R, 0, 0, 10));
      for (let k = 0; k < n; k++) {
        const a = k * 2.4 + x;
        lenses.push(cyl(M.eye, r * 0.7, r * 0.7, 0.08, x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, z + 0.02, R, 0, 0, 8));
      }
    }
    hull.add(look(...lenses));
    // armored hitboxes: carapace, shoulder pods, upper deck
    box(hull, 16, 5.4, 9.2, 0, 0, 0);
    box(hull, 4.4, 4.8, 7.6, 9, 0, 0);
    box(hull, 4.4, 4.8, 7.6, -9, 0, 0);
    box(hull, 14.5, 1, 7.4, 0, 2.7, -0.2);
    box(hull, 5, 3, 3, 0, -3.2, -0.5); // reactor drum
  }

  #buildHead(h, i, M, bone, box) {
    const shell = M.shell[i];
    const sx = h.x;
    h.neckA = bone(this.hull, sx, h.y, BOOM.z);
    h.neckB = bone(h.neckA, 0, 0, BOOM.a);
    h.bone = bone(h.neckB, 0, 0, BOOM.b);
    h.neckA.rotation.order = h.neckB.rotation.order = h.bone.rotation.order = 'YXZ';
    // shoulder socket + the two boom segments: a beam with plates, rams and cable bundles, hung on its joint
    const seg = (len) => [
      rb(M.hull, 1.7, 1.7, len, 0.2, 0, 0, len / 2),
      rb(shell, 1.9, 0.35, len * 0.7, 0.1, 0, 0.95, len * 0.45), // armor on top
      rb(M.trim, 2.0, 0.2, 0.3, 0.04, 0, 0.95, len * 0.25),
      rb(M.trim, 2.0, 0.2, 0.3, 0.04, 0, 0.95, len * 0.65),
      cyl(M.trim, 0.16, 0.16, len * 0.8, 0.7, -0.5, len * 0.5, R, 0, 0, 8), // hydraulic rams
      cyl(M.trim, 0.16, 0.16, len * 0.8, -0.7, -0.5, len * 0.5, R, 0, 0, 8),
      cyl(M.hull, 0.09, 0.09, len * 0.7, 0, -1.0, len * 0.5, R, 0, 0, 6), // cable bundle
    ];
    h.neckA.add(look(cyl(M.trim, 1.35, 1.35, 2.3, 0, 0, 0, 0, 0, R, 16), cyl(M.rust, 1.4, 1.4, 0.2, 1.2, 0, 0, 0, 0, R, 16), ...seg(BOOM.a)));
    h.neckB.add(look(cyl(M.trim, 1.1, 1.1, 2.1, 0, 0, 0, 0, 0, R, 14), ...seg(BOOM.b)));
    box(h.neckA, 1.9, 1.9, BOOM.a, 0, 0, BOOM.a / 2);
    box(h.neckB, 1.9, 1.9, BOOM.b, 0, 0, BOOM.b / 2);
    h.bone.add(look(cyl(M.trim, 1.0, 1.0, 2.0, 0, 0, 0, 0, 0, R, 14))); // head joint
    const W = M.weak[i];
    h.muzzle = new THREE.Object3D();
    h.bone.add(h.muzzle);

    if (i === 0) {
      // VIGIL: a sleek hood over one great sensor eye. A deep dark lens barrel, a small magenta iris (the weak spot) and a ring of
      // small violet lenses at uneven angles: reads as an instrument, never a face.
      const parts = [
        rb(shell, 2.8, 2.6, 2.7, 0.35, 0, 0, 1.2), // housing
        rb(shell, 3.0, 0.45, 2.7, 0.15, 0, 1.45, 1.4), // hood
        rb(M.trim, 3.1, 0.2, 0.3, 0.04, 0, 1.45, 0.5),
        rb(shell, 0.25, 1.8, 2.2, 0.08, 1.55, 0, 1.3), // side fins
        rb(shell, 0.25, 1.8, 2.2, 0.08, -1.55, 0, 1.3),
        rb(M.trim, 0.3, 0.3, 1.0, 0.05, 1.7, -0.9, 2.3),
        cyl(M.trim, 1.2, 1.2, 1.0, 0, 0, 2.9, R, 0, 0, 24), // lens barrel
        ring(M.hull, 1.15, 0.13, 0, 0, 3.4),
        cyl(M.hull, 0.95, 0.95, 0.12, 0, 0, 3.4, R, 0, 0, 24), // dark lens face
        cyl(W, 0.45, 0.45, 0.14, 0, 0, 3.5, R, 0, 0, 16), // iris (weak spot)
        cyl(M.trim, 0.05, 0.05, 2.6, 0.9, 1.9, 0.7, 0, 0, 0.1, 5), // antennas
        cyl(M.trim, 0.04, 0.04, 1.8, -1.0, 1.7, 0.6, 0, 0, -0.15, 5),
      ];
      for (const [a, r, rr] of [[0.3, 1.02, 0.12], [1.1, 1.0, 0.07], [1.7, 1.03, 0.1], [2.9, 1.0, 0.06], [3.6, 1.02, 0.09], [4.4, 1.0, 0.13], [5.5, 1.03, 0.07]]) {
        parts.push(cyl(M.eye, rr, rr, 0.08, Math.cos(a) * r, Math.sin(a) * r, 3.46, R, 0, 0, 8)); // sensor ring lenses
      }
      h.bone.add(look(...parts));
      box(h.bone, 3.0, 2.8, 3.0, 0, 0, 1.3, 'torso', 0);
      h.weak = box(h.bone, 1.1, 1.1, 0.5, 0, 0, 3.55, 'weak', 0);
      h.muzzle.position.set(0, 0, 3.7);
    } else if (i === 1) {
      // LEGION: a wide array of identical emitter horns (mass-produced, ochre on dark grey) around one larger voice node.
      const parts = [
        rb(M.hull, 3.4, 2.6, 2.2, 0.3, 0, 0, 0.9), // back housing
        rb(shell, 5.2, 3.8, 0.5, 0.12, 0, 0, 2.15), // array plate
        rb(M.trim, 5.4, 4.0, 0.3, 0.1, 0, 0, 1.95),
        rb(shell, 5.4, 0.4, 1.6, 0.1, 0, 2.05, 1.5), // brow plate
        rb(M.trim, 0.3, 4.2, 0.5, 0.05, 2.7, 0, 1.9),
        rb(M.trim, 0.3, 4.2, 0.5, 0.05, -2.7, 0, 1.9),
        cyl(M.trim, 0.05, 0.05, 3.2, 1.8, 2.8, 1.0, 0, 0, 0.1, 5),
        cyl(M.trim, 0.05, 0.05, 2.4, -1.9, 2.5, 1.0, 0, 0, -0.08, 5),
      ];
      for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 3; r++) {
          if (c === 2 && r === 1) continue; // the voice node sits here
          const x = (c - 2) * 0.98;
          const y = (r - 1) * 1.1;
          parts.push(cyl(M.hull, 0.4, 0.2, 0.6, x, y, 2.55, R, 0, 0, 12), cyl(M.trim, 0.2, 0.2, 0.1, x, y, 2.32, R, 0, 0, 8)); // horn + throat
        }
      }
      parts.push(cyl(M.trim, 0.62, 0.45, 0.5, 0, 0, 2.5, R, 0, 0, 14), cyl(W, 0.46, 0.46, 0.14, 0, 0, 2.78, R, 0, 0, 14)); // voice node (weak spot)
      for (const [x, y, rr] of [[2.5, 1.7, 0.09], [2.3, 1.45, 0.05], [-2.55, -1.6, 0.07], [-2.35, -1.8, 0.05], [2.5, -1.7, 0.06]]) {
        parts.push(cyl(M.eye, rr, rr, 0.08, x, y, 2.42, R, 0, 0, 8)); // small violet lenses on the frame corners
      }
      h.bone.add(look(...parts));
      box(h.bone, 5.4, 4.0, 2.6, 0, 0, 1.4, 'torso', 1);
      h.weak = box(h.bone, 1.3, 1.3, 0.6, 0, 0, 2.8, 'weak', 1);
      h.muzzle.position.set(0, -1.9, 1.5); // where the drones come out: under the array
    } else {
      // COLOSSUS: old and heavy; a jaw cannon between two jaw plates, faded ochre with rust. The glowing bore is the weak spot.
      const parts = [
        rb(shell, 3.6, 3.2, 3.0, 0.3, 0, 0, 0.9), // breech
        rb(shell, 3.8, 0.8, 4.6, 0.2, 0, 1.75, 2.6), // upper jaw
        rb(M.hull, 3.8, 0.8, 4.6, 0.2, 0, -1.75, 2.6), // lower jaw
        rb(M.rust, 1.6, 0.12, 1.4, 0.03, 0.8, 2.18, 3.2, 0, 0.2, 0), // rust and frost patches
        rb(M.rust, 1.2, 0.12, 1.0, 0.03, -0.9, 2.18, 1.8, 0, -0.3, 0),
        rb(M.trim, 0.5, 3.2, 0.6, 0.1, 1.95, 0, 3.8), // jaw hinges
        rb(M.trim, 0.5, 3.2, 0.6, 0.1, -1.95, 0, 3.8),
        cyl(M.trim, 0.22, 0.22, 3.0, 1.5, 0, 3.0, 0, 0, 0, 8), // jaw rams
        cyl(M.trim, 0.22, 0.22, 3.0, -1.5, 0, 3.0, 0, 0, 0, 8),
        cyl(M.hull, 0.95, 0.95, 3.4, 0, 0, 3.4, R, 0, 0, 20), // barrel
        rb(shell, 2.4, 2.4, 1.8, 0.3, 0, 0, 2.9), // barrel jacket
        cyl(M.trim, 1.25, 1.25, 0.5, 0, 0, 4.9, R, 0, 0, 20), // muzzle brake
        cyl(M.trim, 1.15, 1.15, 0.2, 0, 0, 4.4, R, 0, 0, 20),
        cyl(M.hull, 0.7, 0.7, 0.12, 0, 0, 5.1, R, 0, 0, 16), // bore
        cyl(W, 0.46, 0.46, 0.14, 0, 0, 5.15, R, 0, 0, 14), // glowing bore (weak spot)
        cyl(M.rust, 1.3, 1.3, 0.08, 0, 0, 5.2, R, 0, 0, 20),
      ];
      for (const [x, y, rr] of [[-1.8, 0.5, 0.12], [-1.8, 0.1, 0.07], [-1.8, -0.4, 0.09]]) parts.push(cyl(M.eye, rr, rr, 0.08, x, y, 2.45, 0, 0, R, 8)); // one small cluster, side of the breech
      h.bone.add(look(...parts));
      box(h.bone, 3.8, 3.4, 3.2, 0, 0, 1.0, 'torso', 2);
      box(h.bone, 3.8, 4.2, 4.6, 0, 0, 2.6, 'torso', 2);
      box(h.bone, 2.6, 2.6, 3.4, 0, 0, 3.4, 'torso', 2);
      h.weak = box(h.bone, 1.1, 1.1, 0.5, 0, 0, 5.2, 'weak', 2);
      h.muzzle.position.set(0, 0, 5.5);
    }
  }

  // Removes it from the scene and frees everything it owns (rig, skin, materials, mortar orbs and rings).
  dispose() {
    for (const o of this.orbs) {
      disposeTree(o.obj);
      disposeTree(o.ring);
    }
    this.orbs.length = 0;
    this.offShot?.();
    for (const b of this.beams) b.glow.removeFromParent(), b.core.removeFromParent(); // shared geometry and materials stay
    this.beams.length = 0;
    disposeTree(this.root);
    for (const m of [...this.matList, this.skin.lodMaterial]) m.dispose();
  }

  // The hull and the booms are armor: sparks, no damage, and they block the shot. Only the heads take damage.
  armor(zone, object) {
    return object.userData.part === 'hull' ? 0 : 1;
  }

  // A hit on a head chips it, never below `floor`; it never dies (always false).
  damage(amount, point, dir, zone, object) {
    const i = object?.userData.head;
    if (!this.alive || amount <= 0 || i == null) return false;
    if (!this.awake && !this.dormant) this.#wake();
    const h = this.heads[i];
    h.health = Math.max(Math.min(h.health, this.floor * h.max), h.health - amount);
    h.since = 0;
    h.flash = 0.07;
    return false;
  }

  // What the camera frames while it is engaged: the hull, a bit forward and up so the heads stay in view.
  focusPoint(out) {
    this.hull.getWorldPosition(out);
    out.addScaledVector(_v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 5);
    out.y += 2;
    return out;
  }

  // Aim assist targets: the three glowing weak spots.
  aimPoints(out, n) {
    for (const h of this.heads) {
      if (!out[n]) out[n] = new THREE.Vector3();
      h.weak.getWorldPosition(out[n++]);
    }
    return n;
  }

  // Spawn groups (enemies.js wakeGroup).
  wake() {
    this.dormant = false;
    this.#wake();
  }

  #wake() {
    if (this.awake) return;
    this.awake = true;
    this.ctx.events.emit('boss:wake', this);
  }

  update(dt, player) {
    this.time += dt;
    // each head repairs toward full once it has been left alone for repairDelay s
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      const h = this.heads[i];
      h.since += dt;
      h.flash -= dt;
      h.flare = Math.max(0, h.flare - dt * 2.5);
      if (h.since > TUNING.repairDelay && h.health < h.max) h.health = Math.min(h.max, h.health + this.repair * h.max * dt);
      this.segments[i].value = h.health / h.max;
      sum += h.health;
    }
    this.health = sum;

    // wakes when the player comes into the arena (a dormant one only through wakeGroup)
    if (!this.awake && !this.dormant && !player.dead) {
      const p = player.pos;
      const A = this.arena;
      if (p.x > A.minX && p.x < A.maxX && p.z > A.minZ && p.z < A.maxZ) this.#wake();
    }
    const active = this.awake && !player.dead;
    this.rise += ((this.awake ? 1 : 0) - this.rise) * damp(1.2, dt);
    if (active && !this.ctx.holdFire) {
      this.#bolts(dt, player);
      this.#mortar(dt, player);
      this.#legion(dt, player);
    }
    this.#updateOrbs(dt, player);
    if (this.volley) this.#updateVolley(dt, player);
    this.#pose(dt, active || this.volley ? player : null);

    // looks: hit flash per head, sensors (flare while VIGIL charges), pulsing weak spots
    const M = this.mats;
    for (let i = 0; i < 3; i++) {
      const h = this.heads[i];
      M.shell[i].emissive.setScalar(h.flash > 0 ? 0.6 : 0);
      const pulse = Math.sin(this.time * 8 + i * 2.1);
      M.weak[i].emissiveIntensity = (this.awake ? 2.8 + pulse : 1.6) + h.flare * 6 + (h.flash > 0 ? 2 : 0);
    }
    const charge = this.vigil.state === 'charge' ? 1 - this.vigil.timer / TUNING.bolt.charge : 0;
    M.eye.emissiveIntensity = this.awake ? 0.9 + charge * 9 : 0.3; // at rest dimmer than the weak spots
    this.heads[0].flare = Math.max(this.heads[0].flare, charge);
  }

  // ----- behavior -----

  // The loss cut's volley: the heads charge together, then fire a beam each at the player's place (captured when it starts) and a blast lands.
  #updateVolley(dt, player) {
    const v = this.volley;
    const V = TUNING.volley;
    if (!this.awake) this.#wake();
    if (!v.aimed) {
      player.chest(v.target);
      v.aimed = true;
    }
    v.t += dt;
    if (v.t < V.charge) {
      const k = v.t / V.charge;
      for (const h of this.heads) h.flare = Math.max(h.flare, k);
      return;
    }
    if (!v.fired) {
      v.fired = true;
      BLAST.point.copy(v.target);
      BLAST.radius = V.blast;
      BLAST.kind = 'mortar';
      this.ctx.events.emit('blast', BLAST);
      for (const h of this.heads) h.flare = 1;
      while (this.beams.length < this.heads.length) {
        const glow = new THREE.Mesh(BEAM_GEO, BEAM_GLOW_MAT);
        const core = new THREE.Mesh(BEAM_GEO, BEAM_CORE_MAT);
        glow.frustumCulled = core.frustumCulled = false;
        this.ctx.scene.add(glow, core);
        this.beams.push({ glow, core });
      }
    }
    const age = v.t - V.charge;
    const live = age < V.beam;
    const width = V.radius * (1 - 0.5 * (age / V.beam));
    this.beams.forEach((b, i) => {
      b.glow.visible = b.core.visible = live;
      if (!live) return;
      const from = this.heads[i].muzzle.getWorldPosition(_h);
      _f.subVectors(v.target, from);
      const len = _f.length();
      b.glow.position.copy(from);
      b.core.position.copy(from);
      b.glow.quaternion.setFromUnitVectors(_yAxis, _f.divideScalar(len));
      b.core.quaternion.copy(b.glow.quaternion);
      b.glow.scale.set(width * 2.2, len, width * 2.2);
      b.core.scale.set(width * 0.7, len, width * 0.7);
    });
    if (!live) this.volley = null;
  }

  // VIGIL: a telegraphed burst swept across the player's position (needs line of sight from the eye).
  #bolts(dt, player) {
    const g = this.vigil;
    const b = TUNING.bolt;
    g.timer -= dt;
    if (g.state === 'idle') {
      if (g.timer > 0) return;
      if (this.#sees(player)) {
        g.state = 'charge';
        g.timer = b.charge;
        this.ctx.events.emit('boss:charge', this);
      } else g.timer = 0.5;
    } else if (g.state === 'charge') {
      if (g.timer <= 0) {
        g.state = 'burst';
        g.shots = b.shots;
        g.timer = 0;
        g.dir = -g.dir;
      }
    } else if (g.timer <= 0) {
      const eye = this.heads[0].muzzle.getWorldPosition(_h);
      const target = player.chest(_k);
      const k = 1 - g.shots / b.shots; // 0..1 across the burst
      _f.subVectors(target, eye).normalize();
      _w.set(_f.z, 0, -_f.x).normalize(); // sideways in the view
      const spread = b.spread + eye.distanceTo(target) * 0.002;
      target.addScaledVector(_w, (k * 2 - 1) * g.dir * b.sweep);
      _f.subVectors(target, eye).normalize();
      _f.x += (Math.random() - 0.5) * spread * 2;
      _f.y += (Math.random() - 0.5) * spread * 2;
      _f.z += (Math.random() - 0.5) * spread * 2;
      this.ctx.spawnBolt(eye, _f.normalize(), b.damage);
      g.timer = b.gap;
      if (--g.shots <= 0) {
        g.state = 'idle';
        g.timer = b.cooldown[0] + Math.random() * (b.cooldown[1] - b.cooldown[0]);
      }
    }
  }

  #sees(player) {
    return sightRay(this.heads[0].muzzle.getWorldPosition(_h), player.chest(_k), this.ctx.world.meshes);
  }

  // COLOSSUS: a plasma mortar (the SX-6's lob) at where the player is, a ring on the ground marks the impact. Hiding makes it come sooner.
  #mortar(dt, player) {
    const m = TUNING.mortar;
    this.mortarTimer -= dt * (player.cover ? m.coverBoost : 1);
    if (this.mortarTimer > 0) return;
    this.mortarTimer = m.every[0] + Math.random() * (m.every[1] - m.every[0]);
    const c = this.heads[2];
    const o = this.#orb();
    o.obj.position.copy(c.muzzle.getWorldPosition(_h));
    o.target.copy(player.pos).addScaledVector(player.vel, 0.5); // lead a moving player a little
    o.target.y = this.ctx.world.groundAt(o.target.x, o.target.z, player.pos.y + 0.5);
    o.t = 0;
    o.flight = m.flight;
    o.vel.subVectors(o.target, o.obj.position).divideScalar(m.flight);
    o.vel.y += 0.5 * GRAVITY * m.flight;
    o.ring.position.set(o.target.x, o.target.y + 0.03, o.target.z);
    o.obj.visible = o.ring.visible = true;
    c.flare = 1;
    this.ctx.events.emit('boss:mortar', o.obj.position);
  }

  #orb() {
    let o = this.orbs.find((x) => !x.obj.visible);
    if (o) return o;
    const obj = new THREE.Mesh(ORB_GEO, ORB_MAT);
    obj.add(new THREE.Mesh(ORB_GLOW_GEO, ORB_GLOW_MAT));
    const ring = new THREE.Mesh(RING_GEO, RING_MAT.clone());
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(TUNING.mortar.radius);
    this.ctx.scene.add(obj, ring);
    o = { obj, ring, vel: new THREE.Vector3(), target: new THREE.Vector3(), t: 0, flight: 1 };
    this.orbs.push(o);
    return o;
  }

  #updateOrbs(dt, player) {
    const m = TUNING.mortar;
    for (const o of this.orbs) {
      if (!o.obj.visible) continue;
      o.t += dt;
      o.vel.y -= GRAVITY * dt;
      o.obj.position.addScaledVector(o.vel, dt);
      const k = Math.min(1, o.t / o.flight);
      o.ring.material.opacity = 0.25 + 0.5 * k * (0.6 + 0.4 * Math.sin(o.t * 30));
      if (o.t < o.flight) continue;
      o.obj.visible = o.ring.visible = false;
      BLAST.point.copy(o.target);
      BLAST.radius = m.radius;
      BLAST.kind = 'mortar';
      this.ctx.events.emit('blast', BLAST);
      if (player.dead) continue;
      const d = Math.hypot(player.pos.x - o.target.x, player.pos.z - o.target.z);
      if (d > m.radius || Math.abs(player.pos.y - o.target.y) > 2) continue;
      this.ctx.hurtPlayer(m.damage * (1 - 0.5 * (d / m.radius)), o.target);
    }
  }

  // LEGION: while fewer than `max` of its drones live, calls up to `batch` more (ordinary drones of its spawn group, awake,
  // flying over the arena) from under its array.
  #legion(dt, player) {
    const d = TUNING.drones;
    this.droneTimer -= dt;
    if (this.droneTimer > 0) return;
    this.droneTimer = d.every[0] + Math.random() * (d.every[1] - d.every[0]);
    this.drones = this.drones.filter((x) => x.alive && this.ctx.all.includes(x));
    const n = Math.min(d.batch, d.max - this.drones.length);
    if (n <= 0) return;
    const A = this.arena;
    this.heads[1].muzzle.getWorldPosition(_h);
    for (let k = 0; k < n; k++) {
      const x = THREE.MathUtils.clamp(_h.x + (k - (n - 1) / 2) * 3, A.minX + 1, A.maxX - 1);
      const z = THREE.MathUtils.clamp(_h.z, A.minZ + 1, A.maxZ - 1);
      const drone = this.ctx.spawn({ id: 'enemy.drone', pos: [x, this.pos.y, z], params: { group: this.squad ?? undefined, bounds: A } });
      drone.wake();
      this.drones.push(drone);
    }
    this.heads[1].flare = 1;
  }

  // ----- body -----

  // Slow menacing idle: the hull sways and bobs, the booms drift, the heads track the player (or hang folded while dormant).
  #pose(dt, player) {
    const t = this.time;
    const hull = this.hull;
    hull.position.y = TUNING.hullY + Math.sin(t * 0.45) * 0.25;
    hull.rotation.set(Math.sin(t * 0.31) * 0.012, Math.sin(t * 0.23) * 0.02, Math.sin(t * 0.4) * 0.015);
    const droop = 1 - this.rise;
    const k = damp(2.5, dt);
    for (let i = 0; i < 3; i++) {
      const h = this.heads[i];
      h.neckA.rotation.set(h.a + droop * 0.5 + Math.sin(t * 0.5 + i * 2.1) * 0.04, Math.sin(t * 0.37 + i) * 0.05, 0);
      h.neckB.rotation.set(h.b + droop * 0.7 + Math.sin(t * 0.6 + i * 1.3) * 0.05, 0, 0);
      const net = h.a + h.b + droop * 1.2;
      let wantY = 0;
      let wantX = 0.1 * droop;
      if (player) {
        const head = h.bone.getWorldPosition(_h);
        const target = player.chest(_k);
        const toYaw = Math.atan2(target.x - head.x, target.z - head.z);
        wantY = THREE.MathUtils.clamp(wrapAngle(toYaw - this.yaw - hull.rotation.y - h.neckA.rotation.y), -1.1, 1.1);
        const down = Math.atan2(head.y - target.y, Math.hypot(target.x - head.x, target.z - head.z));
        wantX = THREE.MathUtils.clamp(down - net, -0.5, 0.9);
      }
      h.bone.rotation.y += (wantY - h.bone.rotation.y) * k;
      h.bone.rotation.x += (wantX - h.bone.rotation.x) * k;
    }
  }
}
