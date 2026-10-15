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

// Buckets: { material, castShadow, receiveShadow, entries: [{ part, bone, col?, emi? }] }. A part is one source mesh
// group already transformed into the bake space (typed arrays, local indices); the arrays are only concatenated once, in
// toGeometry. Parts are cached per source geometry and transform (partOf), so identical rigs (two troopers with the same
// kit, in the same bind pose) transform each part once, and a re-merge (Workshop rebatch) reuses every unchanged box.

// Merges every opaque bucket into one, recording each source material's color and glow per vertex.
// A textured material may set userData.lodColor (its average look) since the texture is dropped;
// userData.lodGlow overrides emissiveIntensity (e.g. brighter, to stand in for a dropped transparent halo).
function lodBucket(buckets, material) {
  const out = { material, entries: [], lod: true };
  const c = new THREE.Color();
  const e = new THREE.Color();
  for (const b of buckets.values()) {
    const mat = b.material;
    if (mat.transparent) continue;
    c.copy(mat.userData.lodColor ?? mat.color ?? c.setScalar(1));
    if (mat.emissive) e.copy(mat.emissive).multiplyScalar(mat.userData.lodGlow ?? mat.emissiveIntensity ?? 1);
    else e.setScalar(0);
    const col = [c.r, c.g, c.b];
    const emi = [e.r, e.g, e.b];
    for (const en of b.entries) out.entries.push({ ...en, col, emi });
  }
  return out.entries.length ? out : null;
}

// Concatenates every opaque casting bucket into one bucket for the shadow-only mesh (null if none).
function shadowBucket(buckets) {
  const out = { material: SHADOW_MAT, entries: [] };
  for (const b of buckets.values()) {
    if (!b.castShadow || b.material.transparent) continue;
    for (const en of b.entries) out.entries.push(en);
  }
  return out.entries.length ? out : null;
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

// geometry -> Map(key -> part). Weak: a part dies with its geometry. Capped per geometry (a shared part geometry
// re-baked in many poses would otherwise keep every pose).
const parts = new WeakMap();
const PARTS_PER_GEOMETRY = 64;
const q = (v) => Math.round(v * 1e5); // transforms equal to 1e-5 share a part (well under a millimetre)

// One group of `geo` transformed by `matrix`: indexed, each source vertex used by the group emitted once.
function partOf(geo, start, end, matrix) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const uv = geo.attributes.uv;
  const e = matrix.elements;
  const key = `${start}|${end}|${pos.version}|${nor?.version}|${uv?.version}|${geo.index?.version}|${e.map(q).join(',')}`;
  let cache = parts.get(geo);
  let part = cache?.get(key);
  if (part) return part;
  const index = geo.index;
  const remap = new Map();
  const idx = new Uint32Array(end - start);
  const src = [];
  for (let i = start; i < end; i++) {
    const v = index ? index.getX(i) : i;
    let nv = remap.get(v);
    if (nv === undefined) {
      nv = src.length;
      remap.set(v, nv);
      src.push(v);
    }
    idx[i - start] = nv;
  }
  const n = src.length;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const U = new Float32Array(n * 2);
  _nm.getNormalMatrix(matrix);
  for (let k = 0; k < n; k++) {
    const v = src[k];
    _p.fromBufferAttribute(pos, v).applyMatrix4(matrix);
    P[k * 3] = _p.x;
    P[k * 3 + 1] = _p.y;
    P[k * 3 + 2] = _p.z;
    if (nor) _n.fromBufferAttribute(nor, v).applyMatrix3(_nm).normalize();
    else _n.set(0, 1, 0);
    N[k * 3] = _n.x;
    N[k * 3 + 1] = _n.y;
    N[k * 3 + 2] = _n.z;
    if (uv) {
      U[k * 2] = uv.getX(v);
      U[k * 2 + 1] = uv.getY(v);
    }
  }
  part = { pos: P, nor: N, uv: U, idx, n };
  if (!cache) parts.set(geo, (cache = new Map()));
  if (cache.size >= PARTS_PER_GEOMETRY) cache.clear();
  cache.set(key, part);
  return part;
}

// Buckets triangles of `mesh` (all groups, multi-material aware) into `buckets` keyed by material + shadow
// flags, transformed by `matrix`. boneIndex >= 0 also records skin attributes.
function collect(buckets, mesh, matrix, boneIndex = -1) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = Array.isArray(mesh.material) && geo.groups.length ? geo.groups : [{ start: 0, count: index ? index.count : pos.count, materialIndex: 0 }];
  for (const g of groups) {
    const mat = mats[g.materialIndex];
    if (!mat || !mat.visible) continue;
    const end = Math.min(g.start + g.count, index ? index.count : pos.count);
    if (end <= g.start) continue;
    const key = `${mat.uuid}|${mesh.castShadow ? 1 : 0}${mesh.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { material: mat, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, entries: [] }));
    b.entries.push({ part: partOf(geo, g.start, end, matrix), bone: boneIndex });
  }
}

function toGeometry(b) {
  let n = 0;
  let ni = 0;
  for (const { part } of b.entries) {
    n += part.n;
    ni += part.idx.length;
  }
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const U = new Float32Array(n * 2);
  const I = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const skinned = b.entries.some((en) => en.bone >= 0);
  const SI = skinned ? new Uint16Array(n * 4) : null;
  const SW = skinned ? new Float32Array(n * 4) : null;
  const C = b.lod ? new Float32Array(n * 3) : null;
  const E = b.lod ? new Float32Array(n * 3) : null;
  let v = 0;
  let k = 0;
  for (const { part, bone, col, emi } of b.entries) {
    P.set(part.pos, v * 3);
    N.set(part.nor, v * 3);
    U.set(part.uv, v * 2);
    const idx = part.idx;
    for (let i = 0; i < idx.length; i++) I[k + i] = idx[i] + v;
    for (let i = v; i < v + part.n; i++) {
      if (SI) {
        SI[i * 4] = bone;
        SW[i * 4] = 1;
      }
      if (C) {
        C[i * 3] = col[0];
        C[i * 3 + 1] = col[1];
        C[i * 3 + 2] = col[2];
        E[i * 3] = emi[0];
        E[i * 3 + 1] = emi[1];
        E[i * 3 + 2] = emi[2];
      }
    }
    v += part.n;
    k += idx.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (C) geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
  if (E) geo.setAttribute('lodEmissive', new THREE.BufferAttribute(E, 3));
  if (SI) {
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
  }
  if (ni) geo.setIndex(new THREE.BufferAttribute(I, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function hideAsProxy(mesh) {
  mesh.visible = false;
  mesh.userData.proxy = true;
}

// A rig's proxies are never drawn and mostly never raycast (hit boxes are the rig's own dummy parts): keep them out of
// the per-frame matrix updates. Their world matrix is only refreshed by syncProxies() (death debris) or by hand
// (RigidSkin.syncHit, the weak spots). Their local matrix is frozen as of the bake.
function freezeProxy(mesh) {
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.matrixWorldAutoUpdate = false;
}

// Static meshes are merged per material AND per XZ chunk so three can frustum-cull the level piece by piece
// (one mesh for the whole level is never culled and every pass draws all of it). A mesh belongs to the chunk
// holding its world bounding-box centre; a mesh sticking out of its chunk just widens that chunk's bounds.
const CHUNK = 64; // metres
// Chunking only pays on big levels (small ones are draw-call bound: every chunk repeats the per-material draws),
// so a level whose centres span less than this on both axes stays one chunk.
const CHUNK_MIN_EXTENT = 2 * CHUNK;

const _box = new THREE.Box3();
const _c = new THREE.Vector3();

// Merges static meshes (world space) into one mesh per material per chunk under `parent`. Sources become proxies.
// Returns the colour meshes; `.shadows` holds the shadow-only mesh of each chunk.
export function mergeStatic(meshes, parent) {
  const chunks = new Map();
  const centres = meshes.map((m) => {
    m.updateWorldMatrix(true, false);
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    return _box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld).getCenter(new THREE.Vector3());
  });
  _box.makeEmpty().setFromPoints(centres).getSize(_c);
  const single = Math.max(_c.x, _c.z) < CHUNK_MIN_EXTENT;
  for (const [i, m] of meshes.entries()) {
    const key = single ? '' : `${Math.floor(centres[i].x / CHUNK)}|${Math.floor(centres[i].z / CHUNK)}`;
    let buckets = chunks.get(key);
    if (!buckets) chunks.set(key, (buckets = new Map()));
    collect(buckets, m, m.matrixWorld);
    hideAsProxy(m);
  }
  const out = [];
  out.shadows = [];
  for (const buckets of chunks.values()) {
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
      out.shadows.push(shadow);
    }
  }
  return out;
}

// Merges LineSegments (world space) into one LineSegments per material under `parent` (editor gizmo edges). The sources
// are hidden; lines are never raycast, so they are not proxies. Returns the merged lines.
export function mergeLines(lines, parent) {
  const byMat = new Map();
  for (const l of lines) {
    l.updateWorldMatrix(true, false);
    if (!byMat.has(l.material)) byMat.set(l.material, []);
    byMat.get(l.material).push(l);
  }
  const out = [];
  for (const [material, list] of byMat) {
    let n = 0;
    for (const l of list) n += l.geometry.index ? l.geometry.index.count : l.geometry.attributes.position.count;
    const P = new Float32Array(n * 3);
    let k = 0;
    for (const l of list) {
      const pos = l.geometry.attributes.position;
      const idx = l.geometry.index;
      const count = idx ? idx.count : pos.count;
      for (let i = 0; i < count; i++) {
        _p.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(l.matrixWorld);
        P[k++] = _p.x;
        P[k++] = _p.y;
        P[k++] = _p.z;
      }
      l.visible = false;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geo.computeBoundingSphere();
    const m = new THREE.LineSegments(geo, material);
    m.matrixAutoUpdate = false;
    m.raycast = noRaycast;
    m.userData.batch = true;
    parent.add(m);
    out.push(m);
  }
  return out;
}

// Frees merged meshes (mergeStatic's colour and shadow meshes, mergeLines' lines) whose sources stay alive: only the
// merged geometry is theirs, the materials belong to the sources (disposeTree would free those too).
export function freeBatch(meshes) {
  for (const m of meshes) {
    m.removeFromParent();
    m.geometry.dispose();
    shadowOnlyMeshes.delete(m);
  }
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
    this.proxies = []; // the baked sources, parents before children (see syncProxies)
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
    // proxies from an earlier bake are frozen: wake them for the world matrices read below
    for (const [m] of sources) {
      m.matrixAutoUpdate = m.matrixWorldAutoUpdate = true;
    }
    this.proxies.length = 0;

    // bind at the current pose: vertices in root space, bone inverses from the same pose
    this.root.updateWorldMatrix(true, true);
    this.skeleton.calculateInverses();
    _inv.copy(this.root.matrixWorld).invert();
    const buckets = new Map();
    for (const [m, bi] of sources) {
      collect(buckets, m, _m.multiplyMatrices(_inv, m.matrixWorld), bi);
      hideAsProxy(m);
      freezeProxy(m);
      this.proxies.push(m);
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

  // World matrices of all proxies from their parents' (fresh) ones: death debris is cut from them.
  syncProxies() {
    for (const m of this.proxies) m.matrixWorld.multiplyMatrices(m.parent.matrixWorld, m.matrix);
  }

  // Same for one proxy that is raycast (weak spots): refreshes its parent chain first.
  syncHit(m) {
    m.parent.updateWorldMatrix(true, false);
    m.matrixWorld.multiplyMatrices(m.parent.matrixWorld, m.matrix);
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
