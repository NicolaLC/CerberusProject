import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bakeGroup, makeLodMaterial } from '../../engine/batch.js';

// Building blocks for the procedural models (player soldier, enemies): rounded boxes, cylinders, capsules,
// each placed and rotated in its bone's space. Geometry is cached by size, so many rigs share it.
// Models hang on bones and are baked by RigidSkin; enemies keep simple invisible hitboxes for gameplay and
// mark their looks `noHit`. See instructions/animation.md.

const geoCache = new Map();
const cached = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
export const rbox = (w, h, d, r) => cached(`b${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) - 1e-4));
const cylGeo = (rt, rb, h, seg) => cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const capGeo = (r, len) => cached(`p${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const torGeo = (r, tube) => cached(`t${r}|${tube}`, () => new THREE.TorusGeometry(r, tube, 6, 20));

// part(geometry, material, x, y, z, rx, ry, rz)
export function part(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

export const rb = (m, w, h, d, r, x, y, z, rx, ry, rz) => part(rbox(w, h, d, r), m, x, y, z, rx, ry, rz);
export const cyl = (m, rt, rbot, h, x, y, z, rx, ry, rz, seg = 12) => part(cylGeo(rt, rbot, h, seg), m, x, y, z, rx, ry, rz);
export const cap = (m, r, len, x, y, z) => part(capGeo(r, len), m, x, y, z);
export const ring = (m, r, tube, x, y, z, rx, ry, rz) => part(torGeo(r, tube), m, x, y, z, rx, ry, rz); // torus, axis +Z

export const group = (...children) => {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
};

// A visual-only group: enemies skip it when collecting hit meshes (their hitboxes are separate).
export const look = (...children) => {
  const g = group(...children);
  g.userData.noHit = true;
  return g;
};

// ----- death debris -----
// Every enemy type breaks into the same kind of chunks: each non-bone piece on a bone (look group, weak spot, gun) becomes
// one baked mesh with vertex colors, no shadow (one draw per chunk whatever its materials; a destroyed trooper was ~119
// draws), placed where the piece is in the world. A chunk's geometry only depends on the piece's own local frame, so it is
// baked once per enemy TYPE (`kind`, keyed by bone index + child index; lazily on first use or up front with prime()) and
// shared by every death of that type. A death only copies transforms and velocities into pooled chunk objects: no
// bake, no GPU upload, no allocation. One bank per Enemies system; dispose() frees the geometry once (level unload).
// The material is shared by all debris (never disposed).
const DEBRIS_MAT = makeLodMaterial();
DEBRIS_MAT.userData.shared = true;
const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const rand = () => Math.random();

// The piece's drawn proxies baked to one geometry in the piece's local space; null if nothing under it is drawn.
function bakeChunk(piece) {
  const out = new THREE.Group();
  _inv.copy(piece.matrixWorld).invert();
  piece.traverse((o) => {
    if (!o.isMesh || !o.userData.proxy) return;
    const m = new THREE.Mesh(o.geometry, o.material);
    m.applyMatrix4(_rel.multiplyMatrices(_inv, o.matrixWorld));
    out.add(m);
  });
  if (!out.children.length) return null;
  bakeGroup(out, DEBRIS_MAT);
  return out.children[0]?.geometry ?? null; // none: only transparent parts
}

export class DebrisBank {
  constructor() {
    this.geos = new Map(); // `${kind}|${boneIndex}|${childIndex}` -> BufferGeometry | null (nothing to draw)
    this.free = []; // pooled chunks { obj, v, av, life }
  }

  #geo(kind, skin, bone, i, piece) {
    const key = `${kind}|${skin.boneIndex.get(bone)}|${i}`;
    let g = this.geos.get(key);
    if (g === undefined) {
      g = bakeChunk(piece);
      this.geos.set(key, g);
    }
    return g;
  }

  // Bakes every chunk of a freshly built actor (call once its skin exists and its matrices are updated). A type's
  // second spawn finds everything cached.
  prime(kind, skin) {
    skin.syncProxies();
    for (const bone of skin.skeleton.bones) {
      for (let i = 0; i < bone.children.length; i++) if (!bone.children[i].isBone) this.#geo(kind, skin, bone, i, bone.children[i]);
    }
  }

  // Breaks the pieces on `bones` (default: the whole skeleton) into chunks pushed to `out`, added to `scene`.
  // The caller updated the world matrices; proxies are re-synced here (frozen rig proxies, see batch.js).
  // o: { dir?, push: [base, range] along dir, spread (x/z jitter), up: [base, range], spin, life }
  // only: a Set of pieces to break off (the rest stay); without it, pieces marked `userData.dropped` (already shed) are skipped.
  burst(kind, skin, scene, out, o, bones = skin.skeleton.bones, only = null) {
    skin.syncProxies();
    for (const bone of bones) {
      for (let i = 0; i < bone.children.length; i++) {
        const piece = bone.children[i];
        if (piece.isBone || (only ? !only.has(piece) : piece.userData.dropped)) continue;
        const geo = this.#geo(kind, skin, bone, i, piece);
        if (!geo) continue;
        const c = this.free.pop() ?? this.#chunk();
        c.obj.geometry = geo;
        piece.matrixWorld.decompose(c.obj.position, c.obj.quaternion, c.obj.scale);
        scene.add(c.obj);
        if (o.dir) c.v.copy(o.dir).multiplyScalar(o.push[0] + rand() * o.push[1]);
        else c.v.set(0, 0, 0);
        c.v.x += (rand() - 0.5) * o.spread;
        c.v.y += o.up[0] + rand() * o.up[1];
        c.v.z += (rand() - 0.5) * o.spread;
        c.av.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(o.spin);
        c.life = o.life;
        out.push(c);
      }
    }
  }

  #chunk() {
    const obj = new THREE.Mesh(undefined, DEBRIS_MAT);
    obj.castShadow = false; // small, fast and gone in seconds: not worth a shadow draw per chunk
    return { obj, v: new THREE.Vector3(), av: new THREE.Vector3(), life: 0 };
  }

  // Tumbles the chunks of one actor (gravity, bounce, shrink in the last second) and frees the expired ones.
  step(list, dt, world) {
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.life -= dt;
      d.v.y -= 18 * dt;
      d.obj.position.addScaledVector(d.v, dt);
      d.obj.rotation.x += d.av.x * dt;
      d.obj.rotation.y += d.av.y * dt;
      d.obj.rotation.z += d.av.z * dt;
      const g = world.groundAt(d.obj.position.x, d.obj.position.z, d.obj.position.y + 0.3) + 0.05;
      if (d.obj.position.y < g) {
        d.obj.position.y = g;
        d.v.y *= -0.3;
        d.v.x *= 0.6;
        d.v.z *= 0.6;
        d.av.multiplyScalar(0.6);
      }
      if (d.life < 1) d.obj.scale.multiplyScalar(1 - dt * 3);
      if (d.life <= 0) {
        this.#release(d);
        list[i] = list[list.length - 1];
        list.pop();
      }
    }
  }

  #release(d) {
    d.obj.removeFromParent();
    this.free.push(d);
  }

  // Hands an actor's chunks back (the actor is removed).
  releaseAll(list) {
    for (const d of list) this.#release(d);
    list.length = 0;
  }

  // Frees the baked geometry (the pooled chunks own nothing else). Chunks still out must be released first.
  dispose() {
    for (const g of this.geos.values()) g?.dispose();
    this.geos.clear();
    this.free.length = 0;
  }
}
