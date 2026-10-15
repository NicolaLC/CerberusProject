// node tests/batch.test.mjs — draw-call batching (engine/batch.js) without a browser: what the merges build (vertex,
// index and skin data, bounds), that the part cache shares only what is really equal and sees geometry edits, and the
// Workshop helpers (mergeLines, freeBatch). Rendering itself is covered by tests/render.browser.mjs.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeStatic, mergeLines, freeBatch, RigidSkin } from '../src/engine/batch.js';

let failed = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name}\n${err.stack}`);
  }
};

const box = (geo, mat, x, z, scene) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, 0.5, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  m.updateMatrixWorld();
  return m;
};
const arr = (geo, name) => Array.from(geo.attributes[name].array);

test('mergeStatic: one mesh per material, every vertex in world space, sources become hidden proxies, one shadow mesh', () => {
  const scene = new THREE.Scene();
  const geo = new THREE.BoxGeometry(1, 1, 1); // shared by both boxes: same geometry, different transforms
  const mat = new THREE.MeshStandardMaterial();
  const a = box(geo, mat, 0, 0, scene);
  const b = box(geo, mat, 10, 0, scene);
  const out = mergeStatic([a, b], scene);
  assert.equal(out.length, 1);
  assert.equal(out.shadows.length, 1);
  const g = out[0].geometry;
  assert.equal(g.attributes.position.count, 48); // 24 per box
  assert.equal(g.index.count, 72);
  assert.ok(g.index.array instanceof Uint16Array);
  g.computeBoundingBox();
  assert.deepEqual(g.boundingBox.min.toArray(), [-0.5, 0, -0.5]);
  assert.deepEqual(g.boundingBox.max.toArray(), [10.5, 1, 0.5]);
  assert.ok(!a.visible && !b.visible && a.userData.proxy && b.userData.proxy);
  assert.equal(out[0].material, mat);
  assert.equal(out[0].castShadow, false); // the shadow-only mesh casts for it
});

test('part cache: a re-merge of unchanged boxes gives the same geometry; an edited geometry (needsUpdate) is transformed again', () => {
  const scene = new THREE.Scene();
  const mat = new THREE.MeshStandardMaterial();
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const a = box(geo, mat, 3, 4, scene);
  const first = mergeStatic([a], scene);
  const again = mergeStatic([a], scene);
  assert.deepEqual(arr(again[0].geometry, 'position'), arr(first[0].geometry, 'position'));
  assert.deepEqual(arr(again[0].geometry, 'normal'), arr(first[0].geometry, 'normal'));
  assert.notEqual(again[0].geometry.attributes.position.array, first[0].geometry.attributes.position.array); // each geometry owns its arrays
  geo.scale(2, 1, 1); // three bumps the attribute version
  const edited = mergeStatic([a], scene);
  edited[0].geometry.computeBoundingBox();
  assert.equal(edited[0].geometry.boundingBox.max.x, 5);
  // the transform is part of the key too
  a.position.x = 0;
  a.updateMatrixWorld();
  const moved = mergeStatic([a], scene);
  moved[0].geometry.computeBoundingBox();
  assert.equal(moved[0].geometry.boundingBox.max.x, 2);
});

test('mergeStatic: multi-material boxes split per material (geometry groups)', () => {
  const scene = new THREE.Scene();
  const mats = [0, 1, 2, 3, 4, 5].map(() => new THREE.MeshStandardMaterial());
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [mats[0], mats[1], mats[0], mats[1], mats[0], mats[1]]);
  scene.add(m);
  m.updateMatrixWorld();
  const out = mergeStatic([m], scene);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((o) => o.geometry.attributes.position.count), [12, 12]);
});

// A two-bone rig with a part on each bone (fresh materials per rig, like the enemies).
function rig() {
  const root = new THREE.Group();
  const hip = new THREE.Bone();
  const arm = new THREE.Bone();
  arm.position.set(0, 1, 0);
  hip.add(arm);
  root.add(hip);
  const body = new THREE.MeshStandardMaterial({ color: 0x336699 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff0000, emissiveIntensity: 2 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.3), body);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), glow);
  hand.position.set(0.3, 0, 0);
  torso.castShadow = hand.castShadow = true;
  hip.add(torso);
  arm.add(hand);
  const skeleton = new THREE.Skeleton([hip, arm]);
  return { root, skeleton, body, glow, skin: new RigidSkin(root, skeleton, { lod: true }) };
}

test('RigidSkin: each part fully weighted to its bone; two identical rigs bake identical geometry with their own materials', () => {
  const a = rig();
  const b = rig();
  assert.equal(a.skin.meshes.length, 2);
  for (let k = 0; k < 2; k++) {
    const ga = a.skin.meshes[k].geometry;
    const gb = b.skin.meshes[k].geometry;
    assert.deepEqual(arr(ga, 'position'), arr(gb, 'position'));
    assert.deepEqual(arr(ga, 'skinIndex'), arr(gb, 'skinIndex'));
    assert.notEqual(ga, gb);
  }
  assert.deepEqual(new Set(a.skin.meshes.map((m) => m.material)), new Set([a.body, a.glow]));
  assert.deepEqual(new Set(b.skin.meshes.map((m) => m.material)), new Set([b.body, b.glow]));
  const torso = a.skin.meshes.find((m) => m.material === a.body).geometry;
  const hand = a.skin.meshes.find((m) => m.material === a.glow).geometry;
  const bones = (g) => new Set(arr(g, 'skinIndex').filter((_, i) => i % 4 === 0));
  assert.deepEqual([...bones(torso)], [0]);
  assert.deepEqual([...bones(hand)], [1]);
  assert.ok(arr(torso, 'skinWeight').every((w, i) => w === (i % 4 === 0 ? 1 : 0)));
  // the hand sits at arm (0, 1, 0) + (0.3, 0, 0) in root space
  hand.computeBoundingBox();
  const c = hand.boundingBox.getCenter(new THREE.Vector3());
  assert.ok(c.distanceTo(new THREE.Vector3(0.3, 1, 0)) < 1e-6, c.toArray().join());
  // shadow: every opaque caster in one mesh
  assert.equal(a.skin.shadow.geometry.attributes.position.count, torso.attributes.position.count + hand.attributes.position.count);
});

test('RigidSkin LOD: one mesh, per-vertex colour and glow from each part material', () => {
  const { skin, body } = rig();
  const g = skin.lodMesh.geometry;
  const col = arr(g, 'color');
  const emi = arr(g, 'lodEmissive');
  const n = g.attributes.position.count;
  const near = (x, y) => Math.abs(x - y) < 1e-6;
  let bodyV = 0;
  let glowV = 0;
  for (let i = 0; i < n; i++) {
    if (near(col[i * 3], body.color.r) && near(col[i * 3 + 2], body.color.b) && emi[i * 3] === 0) bodyV++;
    else if (col[i * 3] === 0 && near(emi[i * 3], 2)) glowV++;
  }
  assert.equal(bodyV + glowV, n);
  assert.ok(bodyV > 0 && glowV > 0);
  // rebuild() gives the same bake again (cached parts) and frees the old geometry
  const before = arr(g, 'position');
  skin.rebuild();
  assert.deepEqual(arr(skin.lodMesh.geometry, 'position'), before);
});

test('mergeLines: one LineSegments per material, world-space segments, sources hidden', () => {
  const scene = new THREE.Scene();
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const red = new THREE.LineBasicMaterial({ color: 0xff0000 });
  const blue = new THREE.LineBasicMaterial({ color: 0x0000ff });
  const ls = [[red, 0], [red, 5], [blue, 0]].map(([m, x]) => {
    const l = new THREE.LineSegments(edges, m);
    l.position.x = x;
    scene.add(l);
    return l;
  });
  const out = mergeLines(ls, scene);
  assert.equal(out.length, 2);
  const r = out.find((o) => o.material === red).geometry;
  assert.equal(r.attributes.position.count, 2 * edges.attributes.position.count);
  r.computeBoundingBox();
  assert.deepEqual([r.boundingBox.min.x, r.boundingBox.max.x], [-0.5, 5.5]);
  assert.ok(ls.every((l) => !l.visible));
});

test('freeBatch: removes the merged meshes and frees only their geometry (the sources keep their materials)', () => {
  const scene = new THREE.Scene();
  const mat = new THREE.MeshStandardMaterial();
  let disposed = 0;
  mat.addEventListener('dispose', () => disposed++);
  const a = box(new THREE.BoxGeometry(1, 1, 1), mat, 0, 0, scene);
  const out = mergeStatic([a], scene);
  let geoFreed = 0;
  out[0].geometry.addEventListener('dispose', () => geoFreed++);
  freeBatch([...out, ...out.shadows]);
  assert.ok(out.every((m) => !m.parent) && out.shadows.every((m) => !m.parent));
  assert.equal(geoFreed, 1);
  assert.equal(disposed, 0);
});

console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
