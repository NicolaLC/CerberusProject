import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGroup } from '../../engine/batch.js';

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

// Debris chunk for a baked piece: the RigidSkin proxies under `obj` (its look; invisible hitboxes are left out),
// merged to one mesh per material and placed where `obj` is in the world. null if nothing under it is drawn.
// The merged geometry is the chunk's own: free it with disposeDebris.
const _inv = new THREE.Matrix4();
export function debrisCopy(obj) {
  const out = new THREE.Group();
  _inv.copy(obj.matrixWorld).invert();
  obj.traverse((o) => {
    if (!o.isMesh || !o.userData.proxy) return;
    const m = new THREE.Mesh(o.geometry, o.material);
    m.castShadow = true;
    m.applyMatrix4(new THREE.Matrix4().multiplyMatrices(_inv, o.matrixWorld));
    out.add(m);
  });
  if (!out.children.length) return null;
  mergeGroup(out);
  obj.matrixWorld.decompose(out.position, out.quaternion, out.scale);
  return out;
}

export function disposeDebris(obj) {
  obj.removeFromParent();
  for (const c of obj.children) c.geometry?.dispose();
}
