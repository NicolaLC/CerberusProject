import * as THREE from 'three';

// Draw-call batching. Every visible mesh costs one draw call per material per pass (color + shadow),
// and a WebGL frame is CPU-bound on draw calls long before it is bound on triangles.
//
// Pattern: the original meshes stay in the scene as invisible PROXIES (raycasts, hit zones, colliders and
// userData keep working: three's Raycaster ignores `visible`), while one merged mesh per material renders.
//
// - mergeStatic(meshes, parent): static level geometry -> one Mesh per material/shadow combination.
// - RigidSkin: every part hanging on a skeleton's bones -> one SkinnedMesh per material, each vertex fully
//   weighted to its bone (rigid skinning). Bones animate exactly as before; the GPU moves the parts.

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const noRaycast = () => {};

// Buckets triangles of `mesh` (all groups, multi-material aware) into `buckets` keyed by material + shadow
// flags, transformed by `matrix`. boneIndex >= 0 also records skin attributes.
function collect(buckets, mesh, matrix, boneIndex = -1) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const index = geo.index;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = Array.isArray(mesh.material) && geo.groups.length ? geo.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
  _nm.getNormalMatrix(matrix);
  for (const g of groups) {
    const mat = mats[g.materialIndex];
    if (!mat || !mat.visible) continue;
    const key = `${mat.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { material: mat, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, pos: [], nor: [], uv: [], skin: [] }));
    const end = Math.min(g.start + g.count, index ? index.count : pos.count);
    for (let i = g.start; i < end; i++) {
      const v = index ? index.getX(i) : i;
      _p.fromBufferAttribute(pos, v).applyMatrix4(matrix);
      b.pos.push(_p.x, _p.y, _p.z);
      if (nor) {
        _n.fromBufferAttribute(nor, v).applyMatrix3(_nm).normalize();
        b.nor.push(_n.x, _n.y, _n.z);
      } else b.nor.push(0, 1, 0);
      if (uv) b.uv.push(uv.getX(v), uv.getY(v));
      else b.uv.push(0, 0);
      if (boneIndex >= 0) b.skin.push(boneIndex);
    }
  }
}

function toGeometry(b) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.skin.length) {
    const n = b.skin.length;
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = b.skin[i];
      w[i * 4] = 1;
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  }
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function hideAsProxy(mesh) {
  mesh.visible = false;
  mesh.userData.proxy = true;
}

// Merges static meshes (world space) into one mesh per material under `parent`. Sources become proxies.
export function mergeStatic(meshes, parent) {
  const buckets = new Map();
  for (const m of meshes) {
    m.updateWorldMatrix(true, false);
    collect(buckets, m, m.matrixWorld);
    hideAsProxy(m);
  }
  const out = [];
  for (const b of buckets.values()) {
    const mesh = new THREE.Mesh(toGeometry(b), b.material);
    mesh.castShadow = b.castShadow;
    mesh.receiveShadow = b.receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = noRaycast;
    mesh.userData.batch = true;
    parent.add(mesh);
    out.push(mesh);
  }
  return out;
}

// Merges a rigid group's visible meshes in the group's own space (e.g. a gun model): one mesh per material.
export function mergeGroup(group) {
  group.updateWorldMatrix(true, true);
  _inv.copy(group.matrixWorld).invert();
  const buckets = new Map();
  const sources = [];
  group.traverse((o) => {
    if (o.isMesh && o.visible) sources.push(o);
  });
  for (const m of sources) collect(buckets, m, _m.multiplyMatrices(_inv, m.matrixWorld));
  for (const m of sources) m.removeFromParent();
  for (const b of buckets.values()) {
    const mesh = new THREE.Mesh(toGeometry(b), b.material);
    mesh.castShadow = b.castShadow;
    mesh.receiveShadow = b.receiveShadow;
    group.add(mesh);
  }
  return group;
}

// Bakes the visible parts on a skeleton into SkinnedMeshes (one per material), parented to `root`.
// exclude(object) -> true skips that object and its subtree (e.g. swappable guns).
// rebuild() re-bakes after parts were added or removed (e.g. new weak spots on respawn).
export class RigidSkin {
  constructor(root, skeleton, { exclude = null, cullMargin = 1.3 } = {}) {
    this.root = root;
    this.skeleton = skeleton;
    this.exclude = exclude;
    this.cullMargin = cullMargin;
    this.meshes = [];
    this.boneIndex = new Map(skeleton.bones.map((b, i) => [b, i]));
    this.rebuild();
  }

  rebuild() {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.meshes.length = 0;

    const sources = [];
    const walk = (o, bone) => {
      if (this.exclude?.(o)) return;
      const b = this.boneIndex.has(o) ? o : bone;
      if (o.isMesh && b && !o.userData.batch && (o.visible || o.userData.proxy)) sources.push([o, this.boneIndex.get(b)]);
      for (const c of o.children) walk(c, b);
    };
    walk(this.root, null);

    // bind at the current pose: vertices in root space, bone inverses from the same pose
    this.root.updateWorldMatrix(true, true);
    this.skeleton.calculateInverses();
    _inv.copy(this.root.matrixWorld).invert();
    const buckets = new Map();
    for (const [m, bi] of sources) {
      collect(buckets, m, _m.multiplyMatrices(_inv, m.matrixWorld), bi);
      hideAsProxy(m);
    }
    for (const b of buckets.values()) {
      const mesh = new THREE.SkinnedMesh(toGeometry(b), b.material);
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = b.receiveShadow;
      mesh.raycast = noRaycast;
      mesh.userData.batch = true;
      this.root.add(mesh);
      mesh.bind(this.skeleton, mesh.matrixWorld.copy(this.root.matrixWorld));
      this.meshes.push(mesh);
    }
    // One culling sphere for the whole rig (a small part, e.g. a wrist light, swings far outside its own
    // bind-pose bounds), from the bind-pose geometry, padded for animation. Not computeBoundingSphere():
    // it reads skeleton.boneMatrices, unset before the first render, and collapses to a point.
    const box = new THREE.Box3();
    for (const m of this.meshes) box.union(m.geometry.boundingBox);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius *= this.cullMargin;
    for (const m of this.meshes) m.boundingSphere = sphere;
  }
}
