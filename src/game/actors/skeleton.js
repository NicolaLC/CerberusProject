import * as THREE from 'three';
import { rbox } from './parts.js';

// The skeleton contract of the non-humanoid enemies (drone, SX-6, CERBERUS); the humanoids use rig.js (same idea, Mixamo names).
//   TABLE   { Name: { parent: 'Other' | null (the rig root), pos: [x, y, z], order?: 'YXZ', data?: {...} } } in creation order
//           (= bone index in the RigidSkin and the debris bake: never reorder a shipped table)
//   rig     = new BoneRig(TABLE, { owner })      rig.root, rig.bones[name], rig.skeleton, rig.hitMeshes
//   looks   = { default: (rig, M) => ... }       a look ONLY adds meshes to bones by name (setPart / attach) and shows the weak lenses
//   AI / animation touch rig.bones[...] and rig.sockets[...], never look meshes.
// The look is the variant axis: another look function on the same table changes how it looks, never how it moves.
// Not rig.js's setPart/attach: those force castShadow, which changes the RigidSkin batches (draw counts).

const HITBOX_MAT = new THREE.MeshBasicMaterial(); // never drawn (raycast only)

// A look by name: `def.look` (default 'default') in a kind's looks table, or a readable error listing the options.
export function pickLook(looks, name, what) {
  const look = looks[name ?? 'default'];
  if (!look) throw new Error(`${what}: unknown look ${JSON.stringify(name)}, expected one of ${Object.keys(looks).join(', ')}`);
  return look;
}

export class BoneRig {
  constructor(table, { owner = null, root = new THREE.Group() } = {}) {
    this.table = table;
    this.owner = owner; // gets `userData.enemy` on every hit mesh; null: no hit meshes (title, reel)
    this.root = root;
    this.bones = {};
    this.parts = {}; // name -> the bone's main look piece
    this.sockets = {};
    this.lenses = {}; // name -> weak-spot lens (a hit mesh a look makes visible)
    this.hitMeshes = [];
    for (const [name, def] of Object.entries(table)) {
      const b = new THREE.Bone();
      b.name = name;
      b.position.fromArray(def.pos);
      if (def.order) b.rotation.order = def.order;
      Object.assign(b.userData, def.data);
      this.bones[name] = b;
      (def.parent ? this.bones[def.parent] : root).add(b);
    }
    this.skeleton = new THREE.Skeleton(Object.values(this.bones));
    this.looks = []; // every piece a look added, in order
  }

  // The bone's main visual; replaces the previous one.
  setPart(name, object) {
    this.parts[name]?.removeFromParent();
    this.bones[name].add(object);
    this.parts[name] = object;
    if (!this.looks.includes(object)) this.looks.push(object);
    return object;
  }

  // An extra visual on the bone (kept apart so debris breaks it off as its own chunk).
  attach(name, object) {
    this.bones[name].add(object);
    this.looks.push(object);
    return object;
  }

  // Named attachment point (muzzle, weak spot centre...); calling again with the same name moves it.
  socket(bone, name, x, y, z) {
    const s = this.sockets[name] ?? new THREE.Object3D();
    s.position.set(x, y, z);
    this.bones[bone].add(s);
    this.sockets[name] = s;
    return s;
  }

  // Pieces on a bone: its main part first, then the attached ones (look groups only, no bones, sockets or hit meshes).
  partsOf(name) {
    return this.bones[name].children.filter((o) => o.userData.noHit);
  }

  // An invisible hit box on a bone (or any Object3D, e.g. a socket): userData = { enemy: owner, ...data }. `lens`: the weak-spot
  // lens, a rounded box the look lights with rig.lens(name, material) (until then it is a hidden hitbox like the others).
  hit(target, w, h, d, x, y, z, data, { rotY = 0, lens = false } = {}) {
    if (!this.owner) return null;
    const parent = typeof target === 'string' ? this.bones[target] : target;
    const m = new THREE.Mesh(lens ? rbox(w, h, d, 0.08) : new THREE.BoxGeometry(w, h, d), HITBOX_MAT);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.visible = false; // not drawn, still raycast
    m.userData = { enemy: this.owner, ...data };
    parent.add(m);
    this.hitMeshes.push(m);
    if (lens) this.lenses[target] = m;
    return m;
  }

  // Look side of the weak spot: draw its lens with this (emissive) material.
  lens(name, material) {
    const m = this.lenses[name];
    if (!m) return null;
    m.material = material;
    m.visible = true;
    return m;
  }

  // Debug skeleton lines (H in the game, game.js rebuildHelpers).
  helper() {
    this._helper ??= new THREE.SkeletonHelper(this.root);
    this._helper.material.depthTest = false;
    this._helper.material.transparent = true;
    return this._helper;
  }

  // Applies a hit table: [target, w, h, d, x, y, z, data, opts?] rows.
  hits(rows) {
    for (const [t, w, h, d, x, y, z, data, opts] of rows) this.hit(t, w, h, d, x, y, z, data, opts);
  }
}
