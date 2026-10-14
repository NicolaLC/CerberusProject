import * as THREE from 'three';
import { mergeStaticSteps } from '../../engine/batch.js';
import { disposeTree } from '../../engine/dispose.js';

// Sectors (rooms) of a level: what is drawn, built and freed (instructions/level.md "Sectors", engine.md "Draw calls").
// Data: `zone.sector` pieces (a box each: pos = centre x / bottom y / centre z, params.size) and portals between them: every
// `kit.doorway` (gated by the `kit.gate` on the same pos, open while it is opening / open / closing) and `zone.portal` boxes (always
// open; doors made of plain boxes). Space in no box is the implicit OUTSIDE sector (bit 0); sector i is bit i + 1.
// A level without `zone.sector` pieces has no sectors: everything is built at load and drawn as before (World checks `active`).
//
// Membership (a static mesh -> a mask of sectors, `maskOf`): every sector box its world bbox reaches into (by more than EPS), plus OUTSIDE when a point just
// off one of its faces is in no box (an exterior wall, a roof top). Boxes should run to the centre line of their walls: a shared wall
// then touches both rooms, an exterior wall gets OUTSIDE from its outer face. The static batches are merged per mask (batch.js groupOf).
//
// Visibility (each frame, `update`): roots = the sectors holding the camera and the player (cinematics follow the camera); then
// through every OPEN portal whose screen rectangle overlaps the rectangle its sector is seen through (portal culling, as deep as
// it goes; no occlusion inside a sector). Drawing uses three's layers: layer 0 = always
// (everything untagged), layer 1 = OUTSIDE, layer i + 2 = sector i; a batch (and its shadow-only mesh) or a tagged object is on the layers
// of its mask, the camera on layer 0 + the visible set. The colour pass and the shadow pass both test object layers against the main
// camera, so shadows follow. Never tag a raycast target (Raycaster tests layer 0 only): `tag` skips world.meshes.
// No per-frame allocation, no per-object work: one camera mask a frame.
//
// Build on approach: a render-only piece (registry meta `defer`, e.g. the interior kit) whose pos lies in exactly one sector box is not
// built at load but with its sector: at load the start sector (the spawn's) and its neighbours, then, a few ms per frame, every
// sector one portal away from a root (closed gates count: they are the next rooms). A visible sector that is not built yet is built at
// once (never missing, at worst a hitch). Sectors more than two portals away, or cut off by a gate closed for good (`closeOn`), are
// freed: their batches and pieces are disposed (they are rebuilt from the level data if the player comes back).
const BIT_OUT = 1;
const MAX = 29; // sectors per level: layer i + 2 of three's 32 (layer 0 = always, 1 = OUTSIDE)
const EPS = 0.05; // m: bbox touch tolerance and face sample offset
const PORTAL_PAD = 0.3; // m: a doorway's portal box sticks this far out of the wall on both sides
const BUDGET = 3; // ms of sector building per frame
const FREE_HOPS = 2; // a built sector farther than this many portals from a root is freed

const _box = new THREE.Box3();
const _p = new THREE.Vector3();
const EMPTY = new Float32Array(4); // a portal off screen

export class Sectors {
  constructor(world) {
    this.world = world;
    this.list = []; // { name, box, bit, pieces: [data], built, steps (generator while building), group, batches, handles }
    this.portals = []; // { box, mask, gate }
    this.active = false;
    this.vis = -1; // visible mask (all while inactive)
    this.reach = 0; // mask of the sectors within one portal of a root (built ahead)
    this.hops = new Int8Array(MAX + 1);
    this.rects = new Float32Array((MAX + 1) * 4); // screen rectangle (NDC x0 y0 x1 y1) each sector is seen through, per frame
    this.camera = null;
    this.boxes = []; // world-space Box3 per sector, index = bit index - 1
    this.deferred = new Set(); // level pieces waiting for their sector (World skips them at load)
  }

  // Reads the level's sectors and portals and sorts the deferred pieces into their sectors (`deferred`: World skips them at load).
  setup(level, registry) {
    this.clear();
    const defs = level.pieces.filter((p) => p.id === 'zone.sector');
    if (!defs.length) return;
    if (defs.length > MAX) throw new Error(`level: more than ${MAX} zone.sector pieces`);
    this.active = true;
    defs.forEach((d, i) => {
      const [w, h, dd] = d.params.size;
      const box = new THREE.Box3(new THREE.Vector3(d.pos[0] - w / 2, d.pos[1], d.pos[2] - dd / 2), new THREE.Vector3(d.pos[0] + w / 2, d.pos[1] + h, d.pos[2] + dd / 2));
      this.boxes.push(box);
      this.list.push({ name: d.name ?? `sector${i}`, box, i: i + 1, bit: 1 << (i + 1), pieces: [], built: false, steps: null, group: null, batches: null, handles: [] });
    });
    for (const d of level.pieces) {
      if (d.id === 'kit.doorway' || d.id === 'zone.portal') this.#portal(d);
      else if (registry.meta(d.id).defer?.(d.params ?? {})) {
        const m = this.maskAt(_p.fromArray(d.pos));
        const s = this.list.find((x) => x.bit === m); // exactly one sector box: a piece on a shared boundary or outdoors stays eager
        if (!s) continue;
        s.pieces.push(d);
        this.deferred.add(d);
      }
    }
  }

  // A kit.doorway / zone.portal: its box and the sectors on its two sides (along its thin horizontal axis).
  #portal(d) {
    const p = d.params ?? {};
    let w, h, t;
    if (d.id === 'zone.portal') [w, h, t] = p.size;
    else {
      w = Math.max(2, p.width ?? 4);
      h = Math.max(1.8, p.height ?? 4);
      t = (p.thickness ?? 0.5) + 2 * PORTAL_PAD;
    }
    // doorways are along X at yaw 0 (wall thickness along Z); a quarter turn swaps the axes. zone.portal sizes are world axes.
    if (d.id === 'kit.doorway' && Math.round((d.yaw ?? 0) / (Math.PI / 2)) % 2) [w, t] = [t, w];
    const box = new THREE.Box3(new THREE.Vector3(d.pos[0] - w / 2, d.pos[1], d.pos[2] - t / 2), new THREE.Vector3(d.pos[0] + w / 2, d.pos[1] + h, d.pos[2] + t / 2));
    const alongX = box.max.x - box.min.x < box.max.z - box.min.z; // the thin axis is the way through
    const y = d.pos[1] + Math.min(1, h / 2);
    let mask = 0;
    for (const s of [-1, 1]) {
      if (alongX) _p.set(s > 0 ? box.max.x + PORTAL_PAD : box.min.x - PORTAL_PAD, y, d.pos[2]);
      else _p.set(d.pos[0], y, s > 0 ? box.max.z + PORTAL_PAD : box.min.z - PORTAL_PAD);
      mask |= this.maskAt(_p);
    }
    this.portals.push({ box, mask, pos: d.pos, gated: d.id === 'kit.doorway', gate: null, buf: new Float32Array(4), rect: null });
  }

  // Gates are built by World; a doorway's portal takes the kit.gate standing on its pos.
  linkGates(gates) {
    for (const pt of this.portals) {
      if (!pt.gated) continue;
      pt.gate = gates.find((g) => !g.inert && Math.abs(g.mesh.position.x - pt.pos[0]) < 0.05 && Math.abs(g.mesh.position.z - pt.pos[2]) < 0.05) ?? null;
    }
  }

  // Sector mask of a point (OUTSIDE when in no box).
  maskAt(p) {
    let m = 0;
    for (let i = 0; i < this.boxes.length; i++) if (this.boxes[i].containsPoint(p)) m |= 2 << i;
    return m || BIT_OUT;
  }

  // True when the point's sector is drawn this frame (always without sectors).
  visibleAt(p) {
    return !this.active || (this.maskAt(p) & this.vis) !== 0;
  }

  // Membership mask of a static mesh (see the header). Meshes must have their world matrix.
  maskOf(mesh) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return this.#maskOfBox(_box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
  }

  #maskOfBox(b) {
    let m = 0;
    for (let i = 0; i < this.boxes.length; i++) {
      const s = this.boxes[i];
      if (b.min.x < s.max.x - EPS && b.max.x > s.min.x + EPS && b.min.y < s.max.y - EPS && b.max.y > s.min.y + EPS && b.min.z < s.max.z - EPS && b.max.z > s.min.z + EPS) m |= 2 << i;
    }
    if (!m || this.#faceOutside(b)) m |= BIT_OUT;
    return m;
  }

  // Is a point just off one of the bbox's faces (3 x 3 samples per face) in no sector box?
  #faceOutside(b) {
    const lo = [b.min.x, b.min.y, b.min.z];
    const hi = [b.max.x, b.max.y, b.max.z];
    for (let axis = 0; axis < 3; axis++) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      for (const side of [lo[axis] - EPS, hi[axis] + EPS]) {
        for (const fu of [0.1, 0.5, 0.9]) {
          for (const fv of [0.1, 0.5, 0.9]) {
            const c = [0, 0, 0];
            c[axis] = side;
            c[u] = lo[u] + (hi[u] - lo[u]) * fu;
            c[v] = lo[v] + (hi[v] - lo[v]) * fv;
            if (this.maskAt(_p.fromArray(c)) === BIT_OUT) return true;
          }
        }
      }
    }
    return false;
  }

  // The level's start: the spawn sector and its neighbours are built now (load time), the rest on approach.
  buildStart(spawnPos) {
    if (!this.active) return;
    const root = this.maskAt(_p.fromArray(spawnPos));
    this.#hops(root);
    for (const s of this.list) if (this.reach & s.bit) this.#finish(s);
  }

  // Builds every sector now (tests, tools: a reference render with nothing culled).
  buildAll() {
    for (const s of this.list) this.#finish(s);
  }

  // Puts a merged batch list (and its shadow-only meshes) on the layers of their masks.
  layer(batches) {
    for (const m of batches) m.layers.mask = m.userData.group << 1;
    for (const m of batches.shadows) m.layers.mask = m.userData.group << 1;
  }

  // Puts a per-level object that stays in place (a prop, a label, a gate's frame, a pickup) on the layers of the sectors its bbox
  // touches: drawn only when one of them is. Raycast targets (world.meshes) stay on layer 0.
  tag(obj) {
    if (!this.active) return;
    _box.setFromObject(obj);
    if (_box.isEmpty()) return;
    const mask = this.#maskOfBox(_box) << 1;
    const ray = this.world.meshes;
    obj.traverse((o) => {
      if (!ray.includes(o)) o.layers.mask = mask;
    });
  }

  // Camera layers: everything (the Workshop editor) or layer 0 only (no sectors).
  showAll(camera) {
    camera.layers.enableAll();
  }

  // Per frame (World.cull): visible set, batch visibility, building ahead, freeing behind.
  update(camera, focus) {
    if (!this.active) return;
    this.camera = camera;
    camera.updateMatrixWorld();
    const root = this.maskAt(camera.position) | (focus ? this.maskAt(focus) : 0);
    // portal culling on screen rectangles: a root sees the whole screen; a sector behind an open portal sees the part of its
    // parent's rectangle the portal covers (so a door seen through a door narrows the view); rectangles only grow, so it settles
    const R = this.rects;
    const n = this.list.length;
    for (let i = 0; i <= n; i++) {
      const full = (root >> i) & 1;
      R[i * 4] = full ? -1 : 2;
      R[i * 4 + 1] = full ? -1 : 2;
      R[i * 4 + 2] = full ? 1 : -2;
      R[i * 4 + 3] = full ? 1 : -2;
    }
    for (const pt of this.portals) pt.rect = null;
    let vis = root;
    for (let changed = true; changed; ) {
      changed = false;
      for (const pt of this.portals) {
        if ((vis & pt.mask) === 0 || !open(pt.gate)) continue;
        const P = pt.rect ?? this.#project(pt, camera);
        if (P === EMPTY) continue;
        for (let a = 0; a <= n; a++) {
          if (!((pt.mask >> a) & 1) || !((vis >> a) & 1)) continue;
          // the part of a's rectangle this portal covers
          const x0 = Math.max(R[a * 4], P[0]);
          const y0 = Math.max(R[a * 4 + 1], P[1]);
          const x1 = Math.min(R[a * 4 + 2], P[2]);
          const y1 = Math.min(R[a * 4 + 3], P[3]);
          if (x0 >= x1 || y0 >= y1) continue;
          for (let b = 0; b <= n; b++) {
            if (b === a || !((pt.mask >> b) & 1)) continue;
            const k = b * 4;
            if (R[k] <= x0 && R[k + 1] <= y0 && R[k + 2] >= x1 && R[k + 3] >= y1) continue;
            R[k] = Math.min(R[k], x0);
            R[k + 1] = Math.min(R[k + 1], y0);
            R[k + 2] = Math.max(R[k + 2], x1);
            R[k + 3] = Math.max(R[k + 3], y1);
            vis |= 1 << b;
            changed = true;
          }
        }
      }
    }
    this.vis = vis;
    this.#hops(root);
    // a visible sector is never missing: finish it now; else build ahead for BUDGET ms; free one far sector per frame
    for (const s of this.list) if (vis & s.bit && !s.built) this.#finish(s);
    const t0 = performance.now();
    for (const s of this.list) {
      if (s.built || !(this.reach & s.bit)) continue;
      if (this.#step(s, t0)) break;
    }
    for (const s of this.list) {
      if ((s.built || s.steps) && !(vis & s.bit) && this.hops[s.i] > FREE_HOPS) {
        this.free(s);
        break;
      }
    }
    camera.layers.mask = 1 | (vis << 1);
    // a gate slab is a raycast target (layer 0, see tag): drawn while shut and one of its rooms is visible (Raycaster ignores visible)
    for (const pt of this.portals) {
      const g = pt.gate;
      if (g) g.mesh.visible = g.open < 1 && (pt.mask & vis) !== 0;
    }
  }

  // A portal box's screen rectangle in NDC (pt.rect, a reused Float32Array; EMPTY when off screen or wholly behind the camera); a box
  // crossing the camera plane covers the whole screen.
  #project(pt, camera) {
    const b = pt.box;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let behind = 0;
    for (let i = 0; i < 8; i++) {
      _p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(camera.matrixWorldInverse);
      if (_p.z > -camera.near) {
        behind++;
        continue;
      }
      _p.applyMatrix4(camera.projectionMatrix);
      x0 = Math.min(x0, _p.x);
      y0 = Math.min(y0, _p.y);
      x1 = Math.max(x1, _p.x);
      y1 = Math.max(y1, _p.y);
    }
    if (behind === 8) return (pt.rect = EMPTY);
    if (behind) {
      x0 = y0 = -1; // crosses the camera plane: the whole screen
      x1 = y1 = 1;
    }
    const r = (pt.rect = pt.buf);
    r[0] = Math.max(-1, x0);
    r[1] = Math.max(-1, y0);
    r[2] = Math.min(1, x1);
    r[3] = Math.min(1, y1);
    if (r[0] >= r[2] || r[1] >= r[3]) pt.rect = EMPTY;
    return pt.rect;
  }

  // Portal distance of every sector from the roots (closed-for-good gates block; shut gates do not: they are the way on).
  #hops(root) {
    const h = this.hops;
    h.fill(127);
    let reach = root;
    for (let i = 0; i <= this.list.length; i++) if (root & (1 << i)) h[i] = 0;
    for (let d = 0; d < FREE_HOPS + 1; d++) {
      for (const pt of this.portals) {
        if (pt.gate?.closed) continue;
        let near = false;
        for (let i = 0; i <= this.list.length; i++) if (pt.mask & (1 << i) && h[i] === d) near = true;
        if (!near) continue;
        for (let i = 0; i <= this.list.length; i++) if (pt.mask & (1 << i) && h[i] > d + 1) h[i] = d + 1;
      }
    }
    for (let i = 1; i <= this.list.length; i++) if (h[i] <= 1) reach |= 1 << i;
    this.reach = reach;
  }

  // Generator: builds the sector's pieces (one per step), merges them per mask (time-sliced), drops the merged sources.
  *#build(s) {
    const w = this.world;
    for (const d of s.pieces) {
      // a heavy piece may build in steps (registry meta `steps`, a generator yielding the meshes of each step and returning
      // { meshes, colliders }: arch.corridor); the rest in one go through World.spawn
      const steps = w.registry.meta(d.id).steps;
      let h;
      if (steps) {
        const it = steps(w, d);
        let r = it.next();
        for (; !r.done; r = it.next()) {
          for (const o of r.value) o.visible = false;
          yield;
        }
        h = { piece: null, objects: [...r.value.meshes, ...r.value.colliders] };
      } else h = w.spawn(d);
      for (const o of h.objects) {
        if (o.userData.live) o.layers.mask = s.bit << 1; // its own draws (env.backdrop): stays, drawn with this sector
        else o.visible = false; // not drawn until merged (they all end up in the batches or as hidden colliders)
      }
      s.handles.push(h);
      yield;
    }
    const own = new Set();
    for (const h of s.handles) for (const o of h.objects) own.add(o);
    const meshes = w.staticMeshes.filter((m) => own.has(m));
    for (const m of meshes) m.updateMatrixWorld(true);
    s.group = new THREE.Group();
    // interior dressing of one room is seen only from it or through its portals (which makes it visible): one group, the sector
    s.batches = yield* mergeStaticSteps(meshes, s.group, () => s.bit);
    this.layer(s.batches);
    // the merged sources are render-only (raycasts never see them): free them now, the level data rebuilds them
    const drop = new Set(meshes.filter((m) => !m.userData.collider));
    let j = 0;
    for (const m of w.staticMeshes) if (!drop.has(m)) w.staticMeshes[j++] = m;
    w.staticMeshes.length = j;
    for (const m of drop) disposeTree(m, { keep: w.keep });
    w.scene.add(s.group);
  }

  // Runs a sector's build until the frame budget is used; true when the budget ran out.
  #step(s, t0) {
    s.steps ??= this.#build(s);
    while (performance.now() - t0 < BUDGET) {
      if (s.steps.next().done) {
        this.#done(s);
        return false;
      }
    }
    return true;
  }

  #finish(s) {
    if (s.built) return;
    s.steps ??= this.#build(s);
    while (!s.steps.next().done);
    this.#done(s);
  }

  #done(s) {
    s.steps = null;
    s.built = true;
  }

  // Frees a built (or half built) sector: its batches, its pieces (colliders, hidden collision boxes, proxies) and their geometry.
  free(s) {
    s.steps?.return();
    s.steps = null;
    if (s.group) disposeTree(s.group, { keep: this.world.keep });
    for (const h of s.handles) this.world.despawn(h);
    s.handles.length = 0;
    s.group = s.batches = null;
    s.built = false;
  }

  // Level unload: everything built for sectors goes (World frees its own lists after).
  clear() {
    for (const s of this.list) this.free(s);
    this.list.length = 0;
    this.portals.length = 0;
    this.boxes.length = 0;
    this.deferred.clear();
    this.active = false;
    this.vis = -1;
    this.camera?.layers.set(0); // back to three's default: layer 0
    this.camera = null;
  }

  // Debug / tests: sector names in a mask.
  names(mask = this.vis) {
    return [...(mask & BIT_OUT ? ['outside'] : []), ...this.list.filter((s) => mask & s.bit).map((s) => s.name)];
  }
}

// A portal is open while its gate is opening, open or closing (no gate = always).
function open(g) {
  return !g || (!g.closed && (g.opening || g.open > 0));
}
