import * as THREE from 'three';
import { rb, cyl, ring, part, look } from './parts.js';
import { wornMaterial } from '../world/textures.js';
import { VISOR } from './enemy.js';

// CERBERUS's body, the one model for every place it appears (art-style.md "CERBERUS"): the Skyway boss (actors/cerberus.js), the
// title's horizon (view/menu-scene.js) and the intro reel's shot (view/reel.js, rendered once to an image). A colossal quadruped war
// hound, hunched: a high rounded chest, the back sloping to the haunches, four digitigrade legs on big joint discs ringed in violet,
// and its three heads: VIGIL low at the front (one great round lens), LEGION and COLOSSUS the pods on its shoulders (an emitter
// dish, a heavy cannon). Pale worn grey plates over a dark grey frame.
//
// Units: metres, `root` at the feet, +Z where it faces, +X its left. About 13 m wide (pods), 22 m long, 14 m to the pod tops.
// Built from parts on bones (parts.js), like the other machines: the game bakes them with RigidSkin, the title merges each look.
//   buildCerberus(M, { hit }) -> { root, body, heads: [vigil, legion, colossus], bones, looks, sensors }
//   M: cerberusMaterials() (or any map with the same keys: the title passes its haze shaders)
//   hit(bone, w, h, d, x, y, z, head?): optional, adds an invisible hitbox (head null: armor); the game's
//   heads[i]: { id, bone (aims: rotation.x pitch down +, rotation.y yaw), muzzle (Object3D), weak (the weak spot's centre, Object3D) }
//   sensors: [{ obj, pos (local), size, head }] where the lenses glow (the title and the reel draw lights there)

export const HEAD_IDS = ['vigil', 'legion', 'colossus'];

export function cerberusMaterials() {
  return {
    shell: wornMaterial(0xa9aca7, { roughness: 0.78, metalness: 0.2 }), // pale grey armor plates, chipped and scuffed
    frame: wornMaterial(0x34383c, { roughness: 0.6, metalness: 0.55, wear: 'metal' }), // the dark grey frame and limbs
    trim: wornMaterial(0x16171a, { roughness: 0.5, metalness: 0.65, wear: 'metal' }), // black metal: joints, barrels, grooves
    eye: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: VISOR, emissiveIntensity: 1 }), // violet lenses and joint rings
    // per head, so a hit flashes that head only (the game sets their emissive)
    heads: HEAD_IDS.map(() => wornMaterial(0xa9aca7, { roughness: 0.78, metalness: 0.2 })),
    weak: HEAD_IDS.map(() => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 })),
  };
}

const R = Math.PI / 2;
const _y = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const SPH = new THREE.SphereGeometry(1, 24, 14);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const BY = 9; // the body bone's height (the hull's centre); the body's parts are placed in root heights, shifted down by BY

// a rounded shell: the unit sphere scaled to (sx, sy, sz)
function shell(m, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  const o = part(SPH, m, x, y, z, rx, ry, rz);
  o.scale.set(sx, sy, sz);
  return o;
}
// a rounded slab from a to b (w across X, d across the limb)
function limb(m, a, b, w, d, r = 0.3) {
  const o = rb(m, w, a.distanceTo(b), d, r, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  o.quaternion.setFromUnitVectors(_y, _d.subVectors(b, a).normalize());
  return o;
}
// a joint disc on the X axis, ringed in violet on its outer face (s: the side, +1 left)
function disc(M, r, t, x, y, z, s) {
  return [
    cyl(M.frame, r, r, t, x, y, z, 0, 0, R, 24),
    cyl(M.trim, r * 0.55, r * 0.55, t + 0.1, x, y, z, 0, 0, R, 16),
    ring(M.eye, r * 0.74, 0.07, x + s * (t / 2 + 0.02), y, z, 0, R, 0),
  ];
}

export function buildCerberus(M, { hit = null } = {}) {
  const root = new THREE.Group();
  const bones = [];
  const looks = [];
  const sensors = [];
  const bone = (parent, x = 0, y = 0, z = 0) => {
    const b = new THREE.Bone();
    b.position.set(x, y, z);
    parent.add(b);
    bones.push(b);
    return b;
  };
  const add = (b, ...parts) => {
    const g = look(...parts);
    b.add(g);
    looks.push(g);
  };
  const box = (...a) => hit?.(...a);

  // ----- legs (static on the frame bone): [shoulder / hip, elbow / knee, wrist / hock, foot] per side -----
  const frame = bone(root);
  const legParts = [];
  for (const s of [1, -1]) {
    for (const [J, fore] of [
      [[V(4.4, 8.2, 4.0), V(4.7, 4.8, 5.6), V(4.7, 1.5, 4.6), V(4.7, 0.45, 5.6)], true],
      [[V(4.1, 8.0, -4.8), V(4.4, 5.2, -2.9), V(4.4, 2.4, -6.6), V(4.4, 0.45, -5.8)], false],
    ]) {
      const [a, b, c, f] = J.map((p) => V(s * p.x, p.y, p.z));
      legParts.push(
        ...disc(M, 2.1, 1.1, a.x, a.y, a.z, s), // the big shoulder / hip disc
        shell(M.shell, 1.0, 2.0, 2.7, a.x + s * 0.15, a.y + 1.1, a.z, 0, 0, s * -0.2), // armor cowl over it
        limb(M.frame, a, b, 1.6, 2.0, 0.4), // upper limb
        limb(M.shell, V(a.x + s * 0.55, a.y - 1.2, a.z), V(b.x + s * 0.55, b.y + 0.7, b.z), 0.5, 2.2, 0.2), // its armor plate, outside
        rb(M.trim, 0.12, 0.9, 0.3, 0.04, a.x + s * 0.82, (a.y + b.y) / 2, (a.z + b.z) / 2), // a groove across the plate
        ...disc(M, 0.95, 1.9, b.x, b.y, b.z, s), // elbow / knee
        limb(M.frame, b, c, 1.1, 1.3), // lower limb
        limb(fore ? M.shell : M.frame, V(b.x + s * 0.45, b.y - 0.8, b.z), V(c.x + s * 0.45, c.y + 0.6, c.z), 0.35, 1.3, 0.15), // shin guard (pale on the forelegs)
        limb(M.trim, V(b.x - s * 0.1, b.y - 0.3, b.z + (fore ? -0.6 : 0.6)), V(c.x - s * 0.1, c.y + 0.4, c.z + (fore ? -0.4 : 0.5)), 0.22, 0.22, 0.1), // piston
        ...disc(M, 0.6, 1.3, c.x, c.y, c.z, s), // wrist / hock
        limb(M.frame, c, V(f.x, f.y + 0.3, f.z), 0.55, 0.55), // pastern
        cyl(M.trim, 0.55, 0.55, 1.1, f.x, f.y + 0.15, f.z - 0.3, 0, 0, R, 16), // the foot's wheel-like hub
        rb(M.frame, 1.2, 0.5, 1.7, 0.18, f.x, f.y, f.z + 0.3),
      );
      for (const [dx, len] of [[-0.35, 1.0], [0, 1.2], [0.35, 1.0]]) {
        legParts.push(cyl(M.trim, 0.04, 0.16, len, f.x + dx, f.y - 0.15, f.z + 1.1 + len / 2 - 0.3, R + 0.15, 0, 0, 5)); // claws
      }
      sensors.push({ obj: frame, pos: V(a.x + s * 0.6, a.y, a.z), size: 0.8, head: -1 }); // the shoulder / hip ring
    }
  }
  add(frame, ...legParts);

  // ----- body: the hunched hull over the legs (sways and settles on its own bone) -----
  const body = bone(root, 0, BY, 0); // at the hull's centre
  const hull = [
    shell(M.shell, 4.7, 3.6, 5.2, 0, 9.7, 2.4, -0.12), // chest, high
    shell(M.shell, 4.1, 2.9, 4.6, 0, 8.9, -3.9, 0.1), // back and haunches, lower
    rb(M.frame, 6.4, 2.6, 13.5, 0.8, 0, 7.4, -0.6), // the dark frame under the shells
    rb(M.trim, 1.3, 0.7, 9.5, 0.3, 0, 13.0, 0.4, -0.08), // spine ridge
    rb(M.trim, 9.5, 0.25, 0.4, 0.1, 0, 10.6, 5.5, -0.5), // panel grooves across the chest
    rb(M.trim, 9.0, 0.25, 0.4, 0.1, 0, 11.6, -1.0),
    rb(M.trim, 8.4, 0.25, 0.4, 0.1, 0, 10.4, -5.6, 0.6),
    rb(M.frame, 3.8, 2.4, 2.0, 0.6, 0, 8.6, 7.4), // collar, where VIGIL's neck comes out
    rb(M.trim, 9.6, 0.6, 0.6, 0.25, 0, 8.3, -0.9, 0.1), // dark band where the chest meets the back
    rb(M.shell, 3.2, 0.5, 6.0, 0.2, 0, 12.75, 1.6, -0.12), // dorsal plate over the chest
    rb(M.trim, 3.3, 0.15, 0.25, 0.05, 0, 13.0, 3.4, -0.12),
    rb(M.shell, 2.6, 0.45, 4.2, 0.2, 0, 11.75, -4.4, 0.18), // over the back
    rb(M.frame, 5.2, 1.4, 1.2, 0.4, 0, 6.6, -8.4), // rear frame and tow lug
    cyl(M.trim, 0.35, 0.35, 2.2, 0, 6.6, -9.1, 0, 0, R, 10),
    cyl(M.trim, 0.55, 0.55, 1.2, -1.2, 8.4, -8.8, R, 0, 0, 12), // exhausts at the rear
    cyl(M.trim, 0.55, 0.55, 1.2, 1.2, 8.4, -8.8, R, 0, 0, 12),
  ];
  for (const s of [1, -1]) {
    // vent holes on the chest flanks (a short uneven run, not a pattern)
    for (const [y, z, r] of [[9.2, 4.4, 0.22], [8.7, 3.9, 0.16], [9.6, 3.6, 0.13], [8.4, 4.8, 0.12]]) hull.push(cyl(M.trim, r, r, 0.2, s * 4.45, y, z, 0, 0, R, 10));
    hull.push(
      rb(M.trim, 0.25, 2.6, 0.35, 0.08, s * 4.2, 9.0, 0.2), // seam between chest and back
      rb(M.shell, 0.5, 3.0, 4.2, 0.2, s * 4.55, 9.4, 1.6, 0, s * 0.08, 0), // flank plates, raised off the shell
      rb(M.trim, 0.55, 0.15, 4.0, 0.05, s * 4.6, 10.95, 1.6, 0, s * 0.08, 0),
      rb(M.shell, 0.45, 2.4, 3.6, 0.2, s * 3.95, 8.9, -4.2, 0, s * -0.05, 0),
      rb(M.frame, 0.6, 1.2, 6.5, 0.25, s * 3.3, 6.9, -0.6), // side rails of the frame
    );
  }
  add(body, ...hull);
  looks[looks.length - 1].position.y = -BY;
  box(body, 9.2, 6.8, 9.8, 0, 9.6 - BY, 2.2); // chest
  box(body, 8.0, 5.6, 8.6, 0, 8.8 - BY, -4.0); // back
  box(body, 6.4, 2.6, 13.5, 0, 7.4 - BY, -0.6); // frame

  // ----- heads -----
  const heads = [];
  const head = (id, i, x, y, z) => {
    const b = bone(body, x, y - BY, z);
    b.rotation.order = 'YXZ';
    const muzzle = new THREE.Object3D();
    const weak = new THREE.Object3D();
    b.add(muzzle, weak);
    const h = { id, bone: b, muzzle, weak };
    heads.push(h);
    return h;
  };
  const W = (i) => M.weak[i];
  // VIGIL: low and forward on a short neck, a big rounded face pod around one great round lens (the iris is the weak spot); a small
  // uneven sensor cluster on the brow. One eye, an instrument, never a face.
  {
    const h = head('vigil', 0, 0, 8.6, 8.0);
    const S = M.heads[0];
    add(
      h.bone,
      cyl(M.frame, 1.3, 1.5, 2.4, 0, 0.2, -0.6, R, 0, 0, 16), // neck
      rb(S, 4.6, 4.0, 3.8, 1.5, 0, 0, 1.6), // face pod
      rb(S, 4.0, 0.9, 3.4, 0.4, 0, 2.1, 1.2, -0.12), // brow plate
      rb(M.trim, 4.7, 0.2, 0.3, 0.06, 0, 0.6, 3.5), // groove
      cyl(M.trim, 1.75, 1.75, 0.7, 0, -0.1, 3.5, R, 0, 0, 32), // lens housing
      ring(S, 1.8, 0.22, 0, -0.1, 3.85), // its rim
      cyl(M.frame, 1.35, 1.35, 0.1, 0, -0.1, 3.86, R, 0, 0, 32), // dark lens face
      ring(M.eye, 1.15, 0.12, 0, -0.1, 3.92), // violet ring
      ring(M.eye, 0.78, 0.06, 0, -0.1, 3.93),
      cyl(W(0), 0.5, 0.5, 0.12, 0, -0.1, 3.95, R, 0, 0, 20), // iris (weak spot)
      cyl(M.trim, 0.05, 0.05, 1.8, 1.4, 2.9, 0.6, 0, 0, -0.15, 5), // antenna
      ...[[1.3, 1.45, 0.11], [1.6, 1.2, 0.07], [1.05, 1.15, 0.06]].map(([x, y, r]) => cyl(M.eye, r, r, 0.08, x, y, 3.42, R, 0, 0, 8)), // brow sensors
    );
    box(h.bone, 4.6, 4.0, 3.8, 0, 0, 1.6, 0);
    h.weak.position.set(0, -0.1, 4.0);
    box(h.weak, 1.1, 1.1, 0.4, 0, 0, 0, 0, true);
    h.muzzle.position.set(0, -0.1, 4.3);
    sensors.push({ obj: h.bone, pos: V(0, -0.1, 4.0), size: 2.2, head: 0 });
  }
  // LEGION (its left shoulder) and COLOSSUS (its right): rounded pods on short turret necks. LEGION carries an emitter dish ringed
  // in violet (its node the weak spot; the drones drop from under it), COLOSSUS a heavy cannon (the glowing bore the weak spot).
  for (const [i, s] of [[1, 1], [2, -1]]) {
    const h = head(HEAD_IDS[i], i, s * 4.4, 12.6, 3.2);
    const S = M.heads[i];
    const common = [
      cyl(M.frame, 1.0, 1.3, 1.6, 0, -1.0, 0, 0, 0, 0, 16), // turret neck
      rb(S, 3.0, 2.6, 3.8, 1.0, 0, 0.3, 0.5), // pod
      rb(M.trim, 3.1, 0.2, 0.3, 0.06, 0, 0.6, 1.9), // groove
      rb(S, 0.4, 1.6, 2.6, 0.15, s * 1.55, 0.2, 0.2), // side cheek
    ];
    if (i === 1) {
      add(
        h.bone,
        ...common,
        cyl(M.trim, 1.25, 1.25, 0.5, 0, 0.3, 2.5, R, 0, 0, 28), // dish
        ring(M.eye, 1.0, 0.09, 0, 0.3, 2.77),
        ring(M.eye, 0.66, 0.06, 0, 0.3, 2.78),
        cyl(W(1), 0.36, 0.36, 0.12, 0, 0.3, 2.8, R, 0, 0, 16), // node (weak spot)
      );
      h.weak.position.set(0, 0.3, 2.85);
      h.muzzle.position.set(0, -1.6, 1.6); // the drones come out under the pod
      sensors.push({ obj: h.bone, pos: V(0, 0.3, 2.8), size: 1.6, head: 1 });
    } else {
      add(
        h.bone,
        ...common,
        cyl(M.frame, 0.7, 0.7, 3.4, 0, 0.2, 3.6, R, 0, 0, 20), // barrel
        cyl(M.trim, 0.95, 0.95, 0.6, 0, 0.2, 5.2, R, 0, 0, 20), // muzzle brake
        ring(M.eye, 0.78, 0.06, 0, 0.2, 5.52),
        cyl(M.trim, 0.55, 0.55, 0.1, 0, 0.2, 5.52, R, 0, 0, 16), // bore
        cyl(W(2), 0.4, 0.4, 0.12, 0, 0.2, 5.55, R, 0, 0, 16), // glowing bore (weak spot)
      );
      box(h.bone, 1.9, 1.9, 3.4, 0, 0.2, 3.6, 2);
      h.weak.position.set(0, 0.2, 5.6);
      h.muzzle.position.set(0, 0.2, 5.9);
      sensors.push({ obj: h.bone, pos: V(0, 0.2, 5.55), size: 1.4, head: 2 });
    }
    box(h.bone, 3.0, 2.6, 3.8, 0, 0.3, 0.5, i);
    box(h.weak, 1.0, 1.0, 0.4, 0, 0, 0, i, true);
  }
  return { root, frame, body, heads, bones, looks, sensors };
}
