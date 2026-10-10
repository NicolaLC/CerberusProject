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
//
// Shadows: the shadow pass only needs depth, so material splits are wasted there. Each batch also builds ONE
// shadow-only mesh (all opaque casters merged, material irrelevant); the color meshes stop casting.
// Result: 1 shadow draw per rig / per level instead of one per material.
// Shadow-only meshes stay `visible = false` (so the color pass never lists them) and installShadowOnly()
// makes them visible only while the renderer draws shadow maps. (Layers can't do this: three's shadow pass
// tests layers against the main camera.)

const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const noRaycast = () => {};

// depth pass ignores color; FrontSide matches the merged sources (shadow pass renders back faces of it)
const SHADOW_MAT = new THREE.MeshBasicMaterial();
SHADOW_MAT.userData.shared = true; // disposeTree (engine/dispose.js) leaves it alone
const shadowOnlyMeshes = new Set();

// Unregisters a shadow-only mesh (it is being disposed): the set would otherwise keep it alive forever.
export function forgetShadowOnly(mesh) {
  shadowOnlyMeshes.delete(mesh);
}

// Wraps renderer.shadowMap.render so shadow-only meshes exist only during the shadow pass.
export function installShadowOnly(renderer) {
  const sm = renderer.shadowMap;
  const render = sm.render.bind(sm);
  sm.render = (lights, scene, camera) => {
    for (const m of shadowOnlyMeshes) m.visible = m.userData.castEnabled;
    render(lights, scene, camera);
    for (const m of shadowOnlyMeshes) m.visible = false;
  };
}

// Far-detail LOD: one material for a whole rig. Per-vertex color (diffuse) and lodEmissive (glow, baked from
// each part's material) keep the silhouette and the readable glows (visor, weak spots) at range.
// One program for every rig; each rig gets its own instance so a hit flash (`emissive`) stays per rig.
const LOD_BASE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
LOD_BASE.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 lodEmissive;\nvarying vec3 vLodEmissive;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLodEmissive = lodEmissive;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLodEmissive;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLodEmissive;');
};
LOD_BASE.customProgramCacheKey = () => 'rig-lod';

export function makeLodMaterial() {
  const m = LOD_BASE.clone();
  m.onBeforeCompile = LOD_BASE.onBeforeCompile;
  m.customProgramCacheKey = LOD_BASE.customProgramCacheKey;
  return m;
}

// Merges every opaque bucket into one, recording each source material's color and glow per vertex.
// A textured material may set userData.lodColor (its average look) since the texture is dropped;
// userData.lodGlow overrides emissiveIntensity (e.g. brighter, to stand in for a dropped transparent halo).
function lodBucket(buckets, material) {
  const out = { material, pos: [], nor: [], uv: [], skin: [], col: [], emi: [] };
  const c = new THREE.Color();
  const e = new THREE.Color();
  for (const b of buckets.values()) {
    const mat = b.material;
    if (mat.transparent) continue;
    c.copy(mat.userData.lodColor ?? mat.color ?? c.setScalar(1));
    if (mat.emissive) e.copy(mat.emissive).multiplyScalar(mat.userData.lodGlow ?? mat.emissiveIntensity ?? 1);
    else e.setScalar(0);
    for (const k of ['pos', 'nor', 'uv', 'skin']) for (let i = 0; i < b[k].length; i++) out[k].push(b[k][i]);
    const n = b.pos.length / 3;
    for (let i = 0; i < n; i++) {
      out.col.push(c.r, c.g, c.b);
      out.emi.push(e.r, e.g, e.b);
    }
  }
  return out.pos.length ? out : null;
}

// Concatenates every opaque casting bucket into one bucket for the shadow-only mesh (null if none).
function shadowBucket(buckets) {
  const out = { material: SHADOW_MAT, pos: [], nor: [], uv: [], skin: [] };
  for (const b of buckets.values()) {
    if (!b.castShadow || b.material.transparent) continue;
    for (const k of ['pos', 'nor', 'uv', 'skin']) for (let i = 0; i < b[k].length; i++) out[k].push(b[k][i]);
  }
  return out.pos.length ? out : null;
}

function shadowOnly(mesh) {
  mesh.visible = false; // see installShadowOnly
  mesh.userData.castEnabled = true;
  shadowOnlyMeshes.add(mesh);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.raycast = noRaycast;
  mesh.userData.batch = true;
  return mesh;
}

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
  if (b.col) geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  if (b.emi) geo.setAttribute('lodEmissive', new THREE.Float32BufferAttribute(b.emi, 3));
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
    mesh.castShadow = false; // the shadow-only mesh below casts for all of them
    mesh.receiveShadow = b.receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.raycast = noRaycast;
    mesh.userData.batch = true;
    parent.add(mesh);
    out.push(mesh);
  }
  const sb = shadowBucket(buckets);
  if (sb) {
    const shadow = shadowOnly(new THREE.Mesh(toGeometry(sb), SHADOW_MAT));
    shadow.matrixAutoUpdate = false;
    parent.add(shadow);
    out.shadow = shadow;
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

// Like mergeGroup, but into ONE mesh with per-vertex colors and glow (the far-LOD bake) drawn with `material`
// (a makeLodMaterial()). One draw (plus one shadow draw) whatever the materials; transparent parts are dropped.
export function bakeGroup(group, material) {
  group.updateWorldMatrix(true, true);
  _inv.copy(group.matrixWorld).invert();
  const buckets = new Map();
  const sources = [];
  group.traverse((o) => {
    if (o.isMesh && o.visible) sources.push(o);
  });
  for (const m of sources) collect(buckets, m, _m.multiplyMatrices(_inv, m.matrixWorld));
  for (const m of sources) m.removeFromParent();
  const b = lodBucket(buckets, material);
  if (b) {
    const mesh = new THREE.Mesh(toGeometry(b), material);
    mesh.castShadow = sources.some((m) => m.castShadow);
    group.add(mesh);
  }
  return group;
}

// Bakes the visible parts on a skeleton into SkinnedMeshes (one per material), parented to `root`.
// exclude(object) -> true skips that object and its subtree (e.g. swappable guns).
// rebuild() re-bakes after parts were added or removed (e.g. new weak spots on respawn).
// lod: true also builds a far-detail mesh (one draw for the whole rig); switch with setFar().
export class RigidSkin {
  constructor(root, skeleton, { exclude = null, cullMargin = 1.3, lod = false } = {}) {
    this.lodMaterial = lod ? makeLodMaterial() : null;
    this.lodMesh = null;
    this.far = false;
    this.root = root;
    this.skeleton = skeleton;
    this.exclude = exclude;
    this.cullMargin = cullMargin;
    this.meshes = [];
    this.shadow = null; // shadow-only SkinnedMesh (see installShadowOnly)
    this.castShadow = true;
    this.boneIndex = new Map(skeleton.bones.map((b, i) => [b, i]));
    this.rebuild();
  }

  rebuild() {
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.meshes.length = 0;
    if (this.shadow) {
      this.shadow.removeFromParent();
      this.shadow.geometry.dispose();
      shadowOnlyMeshes.delete(this.shadow);
      this.shadow = null;
    }
    if (this.lodMesh) {
      this.lodMesh.removeFromParent();
      this.lodMesh.geometry.dispose();
      this.lodMesh = null;
    }

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
      mesh.castShadow = false; // see this.shadow
      mesh.receiveShadow = b.receiveShadow;
      mesh.raycast = noRaycast;
      mesh.userData.batch = true;
      this.root.add(mesh);
      mesh.bind(this.skeleton, mesh.matrixWorld.copy(this.root.matrixWorld));
      this.meshes.push(mesh);
    }
    const sb = shadowBucket(buckets);
    if (sb) {
      this.shadow = shadowOnly(new THREE.SkinnedMesh(toGeometry(sb), SHADOW_MAT));
      this.root.add(this.shadow);
      this.shadow.bind(this.skeleton, this.shadow.matrixWorld.copy(this.root.matrixWorld));
      this.shadow.userData.castEnabled = this.castShadow;
    }
    const lb = this.lodMaterial && lodBucket(buckets, this.lodMaterial);
    if (lb) {
      const mesh = new THREE.SkinnedMesh(toGeometry(lb), this.lodMaterial);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.raycast = noRaycast;
      mesh.userData.batch = true;
      this.root.add(mesh);
      mesh.bind(this.skeleton, mesh.matrixWorld.copy(this.root.matrixWorld));
      this.lodMesh = mesh;
    }
    // One culling sphere for the whole rig (a small part, e.g. a wrist light, swings far outside its own
    // bind-pose bounds), from the bind-pose geometry, padded for animation. Not computeBoundingSphere():
    // it reads skeleton.boneMatrices, unset before the first render, and collapses to a point.
    const box = new THREE.Box3();
    for (const m of this.meshes) box.union(m.geometry.boundingBox);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius *= this.cullMargin;
    for (const m of this.meshes) m.boundingSphere = sphere;
    if (this.shadow) this.shadow.boundingSphere = sphere;
    if (this.lodMesh) this.lodMesh.boundingSphere = sphere;
    this.setFar(this.far);
  }

  // Detail switch: full (one draw per material) or far (one draw, baked colors). Hitboxes are unaffected.
  setFar(far) {
    this.far = far && !!this.lodMesh;
    for (const m of this.meshes) m.visible = !this.far;
    if (this.lodMesh) this.lodMesh.visible = this.far;
  }

  // Shadow LOD: turn the rig's single shadow draw on/off (e.g. by distance).
  setCastShadow(on) {
    this.castShadow = on;
    if (this.shadow) this.shadow.userData.castEnabled = on;
  }
}
