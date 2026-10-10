import * as THREE from 'three';
import { disposeTree } from '../../engine/dispose.js';
import { saveLevel, openLevel } from './io.js';

// Workshop editor (#70, instructions/workshop.md): `?scene=workshop` turns into a level editor (level field
// `"tool": "workshop"`, a Gym-style tool: new Tool(game, level), update(dt), dispose()).
//
// The edited level is a plain level object (`this.doc`, the file format of level.md). Every edit changes
// `doc.pieces` and rebuilds only the affected piece through the owner's runtime spawn path (world.spawn,
// enemies.spawn, registry.build for pickups), so the scene always equals the doc. `this.items[i]` is the live handle
// of `doc.pieces[i]`. Edits are commands over the doc (undo / redo); a command stores the piece before and after.
// While the tool lives the editor owns input: the player, weapon, pickups and camera systems are inert (game.js
// checks `game.editing`), enemies are frozen, the HUD is hidden and the camera is a free-fly one.

const TUNING = {
  fly: 9, // m/s
  fast: 3, // Shift multiplier
  look: 0.0025, // rad per px, right button held
  pitch: 1.5, // rad, up / down limit
  grids: [0.5, 0.25, 1, 0], // horizontal snap in metres (metrics.md: 0.5), 0 = off; G cycles
  nudgeY: 0.1, // m, vertical snap (metrics.md)
  dragPx: 4, // pixels before a press on a piece becomes a drag
  toast: 2.8, // s
  dupe: 1, // m: where a duplicate lands (+x)
  maxBox: 40, // m: a measured bound larger than this is a failed measure (fallback box)
};
const QUARTER = Math.PI / 2;
const STEP = Math.PI / 12; // 15 degrees
const TINT = { wall: 0xe8f0ff, high: 0x3aa0ff, low: 0xff9a3a, none: 0xffe14a }; // box helper by cover class
const FIELD = /^(INPUT|SELECT|TEXTAREA)$/;
const FALLBACK = new THREE.Box3(new THREE.Vector3(-0.45, 0, -0.45), new THREE.Vector3(0.45, 1.9, 0.45)); // enemy / pickup stand-in
const POINT = new THREE.Box3(new THREE.Vector3(-0.25, -0.25, -0.25), new THREE.Vector3(0.25, 0.25, 0.25)); // lights

const clone = (o) => JSON.parse(JSON.stringify(o));
const round = (v) => Math.round(v * 1e4) / 1e4 + 0; // + 0: no -0
const xyz = (p) => (Array.isArray(p) ? [p[0], p[1] ?? 0, p[2]] : [p.x, p.y ?? 0, p.z]);
const deg = (rad) => Math.round((rad * 180) / Math.PI);
const css = (el, style) => Object.assign(el.style, style);

// How a piece turns: 'quarter' kit.* (axis-aligned, yaw in 90 degree steps: kit.js throws otherwise), 'box' env.box /
// env.strip (builders ignore yaw: a quarter turn swaps width and depth), 'label' (yaw is a param), 'none' (lights),
// 'free' everything else (enemies, pickups, props: 15 degree steps).
export function rotationKind(id) {
  if (id.startsWith('kit.')) return 'quarter';
  if (id === 'env.box' || id === 'env.strip') return 'box';
  if (id === 'env.label') return 'label';
  if (id === 'light.point') return 'none';
  return 'free';
}

// Yaw a piece may store: snapped to its kind's step, 0 where yaw means nothing.
export function fitYaw(id, yaw = 0) {
  const kind = rotationKind(id);
  if (kind === 'quarter') return ((Math.round(yaw / QUARTER) % 4) + 4) % 4 * QUARTER;
  if (kind === 'free') return ((Math.round(yaw / STEP) % 24) + 24) % 24 * STEP;
  return 0;
}

// +90 degrees about Y sends +x to -z: face px -> nz -> nx -> pz -> px.
const TURN = { px: 'nz', nz: 'nx', nx: 'pz', pz: 'px' };
const TURN_BACK = Object.fromEntries(Object.entries(TURN).map(([a, b]) => [b, a]));

// A copy of `piece` turned by `steps` of its kind (see rotationKind). Pure.
export function turned(piece, steps) {
  const p = clone(piece);
  const kind = rotationKind(p.id);
  if (kind === 'quarter' || kind === 'free') {
    const unit = kind === 'quarter' ? QUARTER : STEP;
    const n = kind === 'quarter' ? 4 : 24;
    const k = ((Math.round((p.yaw ?? 0) / unit) + steps) % n + n) % n;
    if (k) p.yaw = k * unit;
    else delete p.yaw;
  } else if (kind === 'label') {
    p.params = { ...p.params };
    const k = ((Math.round((p.params.yaw ?? 0) / STEP) + steps) % 24 + 24) % 24;
    if (k) p.params.yaw = k * STEP;
    else delete p.params.yaw;
  } else if (kind === 'box') {
    p.params = { ...p.params };
    const map = steps >= 0 ? TURN : TURN_BACK;
    for (let i = 0; i < Math.abs(steps); i++) {
      const [w, h, d] = p.params.size;
      p.params.size = [d, h, w];
      if (p.params.faces) p.params.faces = Object.fromEntries(Object.entries(p.params.faces).map(([k, v]) => [map[k] ?? k, v]));
    }
  }
  return p;
}

export class WorkshopEditor {
  // shown in the key bar (view/keyhints.js); tests/workshop.browser.mjs checks that every key handled below is listed
  static KEYS = [['W A S D', 'fly'], ['Q / E', 'down / up'], ['Shift', 'fast'], ['RMB', 'look (hold)'], ['LMB', 'place / select / drag'], ['R', 'rotate (Shift: back)'], ['G', 'snap 0.5 / 0.25 / 1 / off'], ['Arrows', 'nudge'], ['PgUp / PgDn', 'raise / lower'], ['Ctrl+D', 'duplicate'], ['Del / Backspace', 'delete'], ['Ctrl+Z / Y', 'undo / redo'], ['Ctrl+S / O', 'save / open'], ['Esc', 'cancel / pause']];

  constructor(game, level) {
    this.game = game;
    // Edit mode only runs in the workshop scene; in any other level this tool does nothing.
    this.editing = game.sceneName === 'workshop';
    this.disposed = false;
    this.doc = clone(level);
    this.items = []; // live handle of doc.pieces[i]: { owner, thing }
    this.undoStack = [];
    this.redoStack = [];
    this.sel = -1;
    this.armed = null; // { id, params, yaw }: the palette entry waiting to be placed
    this.gridIndex = 0;
    this.toastText = '';
    this.toastT = 0;
    this.measured = new Map();
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, over: false, looking: false };
    this.drag = null; // { i, px, grab, from, active, target }
    this.ghostPos = null; // where the armed piece would land
    if (!this.editing) return;

    const { engine, world, enemies, pickups, registry, player } = game;
    this.ray = new THREE.Raycaster();
    this.hit = new THREE.Vector3();
    this.canvas = engine.canvas;
    this.still = Object.create(player, { dead: { value: true } }); // what posed enemies see: nobody to fight
    this.wasFrozen = enemies.frozen;
    enemies.frozen = true;

    // The level file's world pieces were merged into batches (no handles): rebuild them one by one so each doc piece
    // owns its objects. Enemies and pickups were built in file order already: adopt them.
    const actors = enemies.puppets.slice();
    const crates = pickups.items.slice();
    world.load({ ...level, pieces: level.pieces.filter((p) => registry.owner(p.id) !== 'world') }, registry);
    let ne = 0;
    let np = 0;
    this.items = this.doc.pieces.map((p) => {
      const owner = registry.owner(p.id);
      if (owner === 'enemies') {
        const a = actors[ne++];
        this.#pose(a);
        if (a.kind === 'boss') enemies.boss = a;
        return { owner, thing: a };
      }
      if (owner === 'pickups') return { owner, thing: crates[np++] };
      return this.#build(p);
    });

    // camera: above and behind the spawn, looking north
    const s = level.spawn.pos;
    this.cam = { yaw: 0, pitch: -0.55 };
    engine.camera.position.set(s[0], s[1] + 8, s[2] + 6);
    this.#aim();

    this.hud = document.getElementById('hud');
    this.hudDisplay = this.hud?.style.display ?? '';
    if (this.hud) this.hud.style.display = 'none';

    this.#buildHelpers();
    this.#buildPanels();
    this.onKeyDown = (e) => this.#keyDown(e);
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    this.onMouseDown = (e) => this.#mouseDown(e);
    this.onMouseMove = (e) => this.#mouseMove(e);
    this.onMouseUp = (e) => this.#mouseUp(e);
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);
    addEventListener('mousemove', this.onMouseMove);
    addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.#refresh();
  }

  // ---- document ----

  get grid() {
    return TUNING.grids[this.gridIndex];
  }

  snap(v) {
    const g = this.grid;
    return round(g ? Math.round(v / g) * g : v);
  }

  get count() {
    return this.doc.pieces.length;
  }

  // Places a piece at the end of the doc. pos snaps horizontally to the grid (y is the surface height, as given);
  // params default to the registry's example; yaw snaps to what the piece may hold (fitYaw). Returns its index.
  place(id, pos, params, yaw) {
    const { registry } = this.game;
    if (!registry.has(id)) throw new Error(`workshop: unknown piece id "${id}"`);
    const ex = registry.meta(id).example;
    const [x, y, z] = xyz(pos);
    const piece = { id, pos: [this.snap(x), round(y), this.snap(z)] };
    const fitted = fitYaw(id, yaw ?? ex?.yaw ?? 0);
    if (fitted) piece.yaw = fitted;
    const p = params ?? ex?.params;
    if (p && Object.keys(p).length) piece.params = clone(p);
    return this.#exec({ index: this.count, before: null, after: piece });
  }

  select(i) {
    this.sel = i >= 0 && i < this.count ? i : -1;
    this.#refreshSel();
    return this.sel;
  }

  // Moves piece i (horizontal snap). A mover's rail (`to`) and a boss arena travel with it.
  move(i, pos) {
    const old = this.#piece(i);
    const [x, y, z] = xyz(pos);
    const p = clone(old);
    p.pos = [this.snap(x), round(y), this.snap(z)];
    const d = p.pos.map((v, k) => round(v - old.pos[k]));
    if (d.every((v) => v === 0)) return i;
    if (Array.isArray(p.params?.to)) p.params.to = p.params.to.map((v, k) => round(v + d[k]));
    const a = p.params?.arena;
    if (a) Object.assign(p.params.arena, { minX: round(a.minX + d[0]), maxX: round(a.maxX + d[0]), minZ: round(a.minZ + d[2]), maxZ: round(a.maxZ + d[2]) });
    return this.#exec({ index: i, before: old, after: p });
  }

  // Turns piece i by `steps` (90 degrees for kit.* and env.box, 15 for the rest; lights do not turn).
  rotate(i, steps = 1) {
    const old = this.#piece(i);
    if (rotationKind(old.id) === 'none') return i;
    return this.#exec({ index: i, before: old, after: turned(old, steps) });
  }

  // Merges `patch` into the params of piece i (undoable).
  setParams(i, patch) {
    const old = this.#piece(i);
    return this.#exec({ index: i, before: old, after: { ...clone(old), params: { ...old.params, ...clone(patch) } } });
  }

  remove(i) {
    const old = this.#piece(i);
    this.#exec({ index: i, before: old, after: null });
    return this.count;
  }

  // Copies piece i next to itself (+1 m in x, grid-snapped), without its `name`. Returns the copy's index.
  duplicate(i) {
    const p = clone(this.#piece(i));
    delete p.name;
    p.pos[0] = this.snap(p.pos[0] + TUNING.dupe);
    return this.#exec({ index: i + 1, before: null, after: p });
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    this.#apply(cmd, true);
    this.redoStack.push(cmd);
    return true;
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    this.#apply(cmd, false);
    this.undoStack.push(cmd);
    return true;
  }

  // Replaces the whole document (Ctrl+O): validates it, rebuilds every piece, forgets the history.
  load(level) {
    this.game.registry.check(level);
    for (let i = this.items.length - 1; i >= 0; i--) this.#unbuild(this.items[i]);
    this.items = [];
    this.doc = clone(level);
    this.items = this.doc.pieces.map((p) => this.#build(p));
    this.undoStack.length = this.redoStack.length = 0;
    this.sel = -1;
    this.#refreshSel();
  }

  // Scene against doc, for tests: one live handle per piece, enemy / pickup counts, and every collider owned by a handle.
  verify() {
    const { registry, world, enemies, pickups } = this.game;
    const problems = [];
    const n = (owner) => this.doc.pieces.filter((p) => registry.owner(p.id) === owner).length;
    if (this.items.length !== this.count) problems.push(`items ${this.items.length} != pieces ${this.count}`);
    this.doc.pieces.forEach((p, i) => {
      const it = this.items[i];
      if (!it || it.owner !== registry.owner(p.id)) problems.push(`#${i} ${p.id}: wrong handle`);
    });
    if (enemies.puppets.length !== n('enemies')) problems.push(`enemies ${enemies.puppets.length} != ${n('enemies')}`);
    if (pickups.items.length !== n('pickups')) problems.push(`pickups ${pickups.items.length} != ${n('pickups')}`);
    let colliders = 0;
    for (const it of this.items) {
      if (it.owner !== 'world') continue;
      for (const o of it.thing.objects) {
        if (!o.parent) problems.push('a world object is detached');
        if (o.userData.collider) colliders++;
      }
    }
    if (colliders !== world.colliders.length) problems.push(`colliders ${world.colliders.length} != ${colliders} owned`);
    return { ok: problems.length === 0, problems, colliders, pieces: this.count };
  }

  // ---- commands ----

  #piece(i) {
    if (!(i >= 0 && i < this.count)) throw new Error(`workshop: no piece #${i}`);
    return clone(this.doc.pieces[i]);
  }

  #exec(cmd) {
    this.#apply(cmd, false); // throws before touching the doc when the piece cannot be built
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    return cmd.index;
  }

  // cmd: { index, before, after }; before null = an insert, after null = a delete, both = a rebuild in place.
  #apply(cmd, reverse) {
    const from = reverse ? cmd.after : cmd.before;
    const to = reverse ? cmd.before : cmd.after;
    const i = cmd.index;
    if (!to) {
      this.#unbuild(this.items[i]);
      this.doc.pieces.splice(i, 1);
      this.items.splice(i, 1);
    } else if (!from) {
      const item = this.#build(to);
      this.doc.pieces.splice(i, 0, clone(to));
      this.items.splice(i, 0, item);
    } else {
      const item = this.#build(to);
      this.#unbuild(this.items[i]);
      this.doc.pieces[i] = clone(to);
      this.items[i] = item;
    }
    this.sel = to ? i : -1;
    this.#refreshSel();
  }

  // ---- scene: the owner's runtime spawn path ----

  #build(piece) {
    const { registry, world, enemies, pickups } = this.game;
    const data = clone(piece); // builders may keep what they are given
    const owner = registry.owner(data.id);
    if (owner === 'world') return { owner, thing: world.spawn(data) };
    if (owner === 'enemies') {
      const a = enemies.spawn(data);
      this.#pose(a);
      if (a.kind === 'boss') enemies.boss = a;
      return { owner, thing: a };
    }
    if (owner === 'pickups') return { owner, thing: registry.build('pickups', pickups, data) };
    throw new Error(`workshop: no owner for "${data.id}"`);
  }

  #unbuild({ owner, thing }) {
    const { world, enemies, pickups } = this.game;
    if (owner === 'world') world.despawn(thing);
    else if (owner === 'enemies') {
      if (enemies.boss === thing) enemies.boss = null;
      enemies.despawn(thing);
    } else pickups.despawn(thing);
  }

  // A new enemy stands at its piece position after one tiny update (frozen enemies never get the regular ones).
  #pose(actor) {
    if ('moveT' in actor) actor.moveT = 0; // a rail mover starts at its home
    actor.update(1e-3, this.still);
  }

  // ---- bounds ----

  // World box of live item (union of its objects); a stand-in where the owner has no geometry (lights).
  #boxOf(item, at) {
    const objs = item.owner === 'world' ? item.thing.objects : item.owner === 'enemies' ? [item.thing.group ?? item.thing.root] : [item.thing.model, item.thing.ring];
    const box = new THREE.Box3();
    for (const o of objs) box.expandByObject(o);
    const size = box.getSize(new THREE.Vector3());
    if (box.isEmpty() || Math.max(size.x, size.y, size.z) > TUNING.maxBox || !Number.isFinite(size.x + size.y + size.z)) {
      const fb = item.owner === 'world' ? POINT : FALLBACK;
      return fb.clone().translate(new THREE.Vector3(...at));
    }
    return box;
  }

  #bounds(i) {
    const it = this.items[i];
    return (it.box ??= this.#boxOf(it, this.doc.pieces[i].pos));
  }

  // Bounds of a piece at the origin, yaw 0 (the ghost turns them). Cached by id and params.
  #measure(id, params) {
    const key = `${id}${JSON.stringify(params ?? {})}`;
    let b = this.measured.get(key);
    if (b) return b;
    if (id === 'light.point') b = POINT;
    else {
      const item = this.#build({ id, pos: [0, 0, 0], ...(params && Object.keys(params).length ? { params } : {}) });
      b = this.#boxOf(item, [0, 0, 0]);
      this.#unbuild(item);
    }
    this.measured.set(key, b);
    return b;
  }

  coverOf(i) {
    const it = this.items[i];
    const set = new Set();
    if (it?.owner === 'world') for (const o of it.thing.objects) if (o.userData.collider?.cover) set.add(o.userData.collider.cover);
    return ['wall', 'high', 'low'].filter((c) => set.has(c));
  }

  // ---- helpers (freed in dispose) ----

  #buildHelpers() {
    const scene = this.game.engine.scene;
    this.helper = new THREE.Box3Helper(new THREE.Box3(), TINT.none);
    this.helper.visible = false;
    this.helper.frustumCulled = false;
    scene.add(this.helper);

    this.ghost = new THREE.Group();
    this.ghostBody = new THREE.Group();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x58ff9a, transparent: true, opacity: 0.25, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x58ff9a }));
    fill.raycast = edges.raycast = () => {};
    this.ghostBody.add(fill, edges);
    this.ghost.add(this.ghostBody);
    this.ghost.visible = false;
    this.ghost.traverse((o) => (o.frustumCulled = false));
    scene.add(this.ghost);
  }

  #showGhost(box, pos, yaw) {
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    this.ghost.position.set(pos[0], pos[1], pos[2]);
    this.ghost.rotation.y = yaw;
    this.ghostBody.position.copy(c);
    this.ghostBody.scale.set(Math.max(s.x, 0.05), Math.max(s.y, 0.05), Math.max(s.z, 0.05));
    this.ghost.visible = true;
  }

  #refreshSel() {
    const on = this.sel >= 0 && this.sel < this.count;
    this.helper.visible = on;
    if (on) {
      this.helper.box.copy(this.#bounds(this.sel));
      this.helper.material.color.setHex(TINT[this.coverOf(this.sel)[0] ?? 'none']);
    }
    this.#refresh();
  }

  // ---- DOM: palette, status, toast ----

  #buildPanels() {
    const { registry } = this.game;
    const font = '11px/1.45 monospace';
    this.palette = document.createElement('div');
    this.palette.id = 'workshop-palette';
    css(this.palette, { position: 'fixed', left: '8px', top: '80px', bottom: '8px', width: '236px', overflowY: 'auto', zIndex: 50, padding: '6px', font, color: '#cfe4f7', background: 'rgba(0,0,0,0.6)' });
    this.palette.addEventListener('mousedown', (e) => e.preventDefault()); // keys stay with the editor
    const groups = new Map();
    for (const id of registry.ids()) {
      const key = `${registry.owner(id)}  ${id.split('.')[0]}.*`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    }
    this.buttons = new Map();
    for (const [name, ids] of groups) {
      const head = document.createElement('div');
      head.textContent = name;
      css(head, { margin: '8px 0 3px', color: '#ffe14a', letterSpacing: '1px' });
      this.palette.appendChild(head);
      for (const id of ids) {
        const b = document.createElement('button');
        b.dataset.id = id;
        b.title = registry.meta(id).label ?? '';
        const t = document.createElement('b');
        t.textContent = id;
        const l = document.createElement('div');
        l.textContent = registry.meta(id).label ?? '';
        css(l, { color: '#8fa6b8', fontSize: '10px', whiteSpace: 'normal' });
        b.append(t, l);
        css(b, { display: 'block', width: '100%', textAlign: 'left', margin: '0 0 2px', padding: '3px 5px', font, color: '#cfe4f7', background: 'rgba(40,60,80,0.55)', border: '1px solid transparent', cursor: 'pointer' });
        b.addEventListener('click', () => {
          this.arm(this.armed?.id === id ? null : id);
          b.blur();
        });
        this.buttons.set(id, b);
        this.palette.appendChild(b);
      }
    }
    document.body.appendChild(this.palette);

    this.status = document.createElement('div');
    css(this.status, { position: 'fixed', right: '8px', top: '8px', zIndex: 50, padding: '6px 10px', font, whiteSpace: 'pre-wrap', color: '#ffe14a', background: 'rgba(0,0,0,0.6)', pointerEvents: 'none', maxWidth: '40ch' });
    document.body.appendChild(this.status);

    this.toastEl = document.createElement('div');
    css(this.toastEl, { position: 'fixed', left: '50%', bottom: '28px', transform: 'translateX(-50%)', zIndex: 60, padding: '6px 14px', font: '13px monospace', color: '#fff', background: 'rgba(160,40,40,0.85)', pointerEvents: 'none', opacity: 0 });
    document.body.appendChild(this.toastEl);
  }

  toast(text) {
    this.toastText = text;
    this.toastT = TUNING.toast;
    if (this.toastEl) {
      this.toastEl.textContent = text;
      this.toastEl.style.opacity = 1;
    }
  }

  #refresh() {
    if (!this.status) return;
    for (const [id, b] of this.buttons) b.style.borderColor = this.armed?.id === id ? '#58ff9a' : 'transparent';
    const lines = [`WORKSHOP  ${this.count} pieces   snap ${this.grid ? `${this.grid} m` : 'off'}   undo ${this.undoStack.length} redo ${this.redoStack.length}`];
    if (this.armed) lines.push(`placing ${this.armed.id}  (click to place, R turns, Esc cancels)`);
    if (this.sel >= 0) {
      const p = this.doc.pieces[this.sel];
      const b = this.#bounds(this.sel);
      const s = b.getSize(new THREE.Vector3());
      const yaw = rotationKind(p.id) === 'label' ? p.params?.yaw ?? 0 : p.yaw ?? 0;
      lines.push(`#${this.sel} ${p.id}`, `pos ${p.pos.join(', ')}   yaw ${deg(yaw)}`, `size ${s.x.toFixed(1)} x ${s.y.toFixed(1)} x ${s.z.toFixed(1)}`, `cover ${this.coverOf(this.sel).join(', ') || 'none'}`);
    }
    const text = lines.join('\n');
    if (text !== this.statusText) this.status.textContent = this.statusText = text;
  }

  // Arms a palette entry for placement (null disarms).
  arm(id) {
    if (id == null) this.armed = null;
    else {
      const { registry } = this.game;
      if (!registry.has(id)) throw new Error(`workshop: unknown piece id "${id}"`);
      const ex = registry.meta(id).example;
      this.armed = { id, params: clone(ex?.params ?? {}), yaw: fitYaw(id, ex?.yaw ?? 0) };
      this.select(-1);
    }
    if (!this.armed) this.ghost.visible = false;
    this.#refresh();
  }

  // ---- input ----

  #active(e) {
    return !this.game.engine.paused && !FIELD.test(e.target?.tagName ?? '');
  }

  #guard(fn) {
    try {
      return fn();
    } catch (err) {
      this.toast(err.message);
      return undefined;
    }
  }

  #keyDown(e) {
    if (!this.#active(e)) return;
    const c = e.code;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) this.keys.add(c); // held keys fly the camera; a Ctrl chord (Ctrl+D...) must not
    if (mod) {
      let done = true;
      if (c === 'KeyZ') (e.shiftKey ? this.redo() : this.undo());
      else if (c === 'KeyY') this.redo();
      else if (c === 'KeyS') this.save();
      else if (c === 'KeyO') this.open();
      else if (c === 'KeyD') this.sel >= 0 && this.#guard(() => this.duplicate(this.sel));
      else done = false;
      if (done) e.preventDefault();
      return;
    }
    if (e.repeat && !/^(Arrow|Page)/.test(c)) return;
    if (c === 'KeyR') this.#turn(e.shiftKey ? -1 : 1);
    else if (c === 'KeyG') {
      this.gridIndex = (this.gridIndex + 1) % TUNING.grids.length;
      this.#refresh();
    } else if (c === 'Delete' || c === 'Backspace') {
      if (this.sel >= 0) this.#guard(() => this.remove(this.sel));
    } else if (c === 'Escape') this.#cancel();
    else if (c === 'ArrowUp' || c === 'ArrowDown' || c === 'ArrowLeft' || c === 'ArrowRight') this.#nudge(c);
    else if (c === 'PageUp' || c === 'PageDown') {
      if (this.sel < 0) return;
      const p = this.doc.pieces[this.sel].pos;
      this.#guard(() => this.move(this.sel, [p[0], p[1] + (c === 'PageUp' ? 1 : -1) * TUNING.nudgeY, p[2]]));
    } else return;
    e.preventDefault();
  }

  #turn(steps) {
    if (this.armed) {
      const p = turned({ id: this.armed.id, pos: [0, 0, 0], yaw: this.armed.yaw, params: this.armed.params }, steps);
      this.armed.yaw = p.yaw ?? 0;
      this.armed.params = p.params ?? {};
      this.#refresh();
    } else if (this.sel >= 0) this.#guard(() => this.rotate(this.sel, steps));
  }

  // Arrow keys move the selection on the ground along the axis the camera looks along (Up = away from the camera).
  #nudge(code) {
    if (this.sel < 0) return;
    const fx = -Math.sin(this.cam.yaw);
    const fz = -Math.cos(this.cam.yaw);
    const [ax, az] = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
    const sign = code === 'ArrowUp' || code === 'ArrowRight' ? 1 : -1;
    const [dx, dz] = code === 'ArrowUp' || code === 'ArrowDown' ? [ax, az] : [-az, ax];
    const step = this.grid || 0.1;
    const p = this.doc.pieces[this.sel].pos;
    this.#guard(() => this.move(this.sel, [p[0] + sign * dx * step, p[1], p[2] + sign * dz * step]));
  }

  // Esc: drop what is armed, then the selection, then pause (the start panel has the scene picker).
  #cancel() {
    if (this.armed) this.arm(null);
    else if (this.sel >= 0) this.select(-1);
    else {
      this.game.padPlay = false;
      this.game.setRunning?.(false);
    }
  }

  #ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    this.mouse.over = e.target === this.canvas;
  }

  #mouseDown(e) {
    if (this.game.engine.paused) return;
    this.#ndc(e);
    if (e.button === 2) {
      this.mouse.looking = true;
      return;
    }
    if (e.button !== 0) return;
    if (this.armed) {
      if (this.ghostPos) this.#guard(() => this.place(this.armed.id, this.ghostPos, this.armed.params, this.armed.yaw));
      return;
    }
    this.#aimRay();
    const i = this.pick();
    this.select(i);
    if (i >= 0) {
      const p = this.doc.pieces[i].pos;
      const at = this.#plane(p[1]);
      this.drag = { i, px: [e.clientX, e.clientY], from: p.slice(), grab: at ? [at.x - p[0], at.z - p[2]] : [0, 0], active: false, target: null };
    }
  }

  #mouseMove(e) {
    this.#ndc(e);
    if (this.mouse.looking && !this.game.engine.paused) {
      this.cam.yaw -= e.movementX * TUNING.look;
      this.cam.pitch = THREE.MathUtils.clamp(this.cam.pitch - e.movementY * TUNING.look, -TUNING.pitch, TUNING.pitch);
    }
    const d = this.drag;
    if (d && !d.active && Math.hypot(e.clientX - d.px[0], e.clientY - d.px[1]) > TUNING.dragPx) d.active = true;
  }

  #mouseUp(e) {
    if (e.button === 2) this.mouse.looking = false;
    const d = this.drag;
    if (e.button !== 0 || !d) return;
    this.drag = null;
    this.ghost.visible = !!this.armed && !!this.ghostPos;
    if (d.active && d.target) this.#guard(() => this.move(d.i, d.target));
  }

  #aimRay() {
    this.ray.setFromCamera(this.mouse, this.game.engine.camera);
  }

  // Ground-plane point under the cursor at height y.
  #plane(y) {
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), this.hit) ? this.hit.clone() : null;
  }

  // Where a piece would stand under the cursor: on top of the box under it, else the floor plane y = 0.
  surface() {
    this.#aimRay();
    const h = this.ray.intersectObjects(this.game.world.meshes, false)[0];
    if (h && h.face && h.face.normal.y > 0.5) return h.point.clone();
    const p = this.#plane(0);
    if (p && h && h.distance < this.ray.ray.origin.distanceTo(p)) return new THREE.Vector3(h.point.x, 0, h.point.z); // a wall in front: stand at its foot
    return p;
  }

  // Nearest piece under the ray (smaller wins a tie), as an index or -1.
  pick() {
    let best = -1;
    let bd = Infinity;
    let bv = Infinity;
    const at = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      const b = this.#bounds(i);
      if (!this.ray.ray.intersectBox(b, at)) continue;
      const d = at.distanceTo(this.ray.ray.origin);
      const s = b.getSize(new THREE.Vector3());
      const v = s.x * s.y * s.z;
      if (d < bd - 1e-4 || (Math.abs(d - bd) <= 1e-4 && v < bv)) [best, bd, bv] = [i, d, v];
    }
    return best;
  }

  // ---- frame ----

  #aim() {
    const c = this.game.engine.camera;
    c.rotation.set(this.cam.pitch, this.cam.yaw, 0, 'YXZ');
    c.updateMatrixWorld();
  }

  update(dt) {
    if (!this.editing) return;
    const cam = this.game.engine.camera;
    // free-fly
    if (!this.keys.has('ControlLeft') && !this.keys.has('ControlRight') && !this.keys.has('MetaLeft')) {
      const k = this.keys;
      const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      const u = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
      const v = TUNING.fly * dt * (k.has('ShiftLeft') || k.has('ShiftRight') ? TUNING.fast : 1);
      const { yaw, pitch } = this.cam;
      cam.position.x += (-Math.sin(yaw) * Math.cos(pitch) * f + Math.cos(yaw) * s) * v;
      cam.position.y += (Math.sin(pitch) * f + u) * v;
      cam.position.z += (-Math.cos(yaw) * Math.cos(pitch) * f - Math.sin(yaw) * s) * v;
    }
    this.#aim();

    if (this.armed && this.mouse.over && !this.mouse.looking && !this.drag?.active) {
      const pt = this.surface();
      this.ghostPos = pt ? [this.snap(pt.x), round(pt.y), this.snap(pt.z)] : null;
      let shown = false;
      if (this.ghostPos) {
        try {
          const kind = rotationKind(this.armed.id);
          this.#showGhost(this.#measure(this.armed.id, this.armed.params), this.ghostPos, kind === 'quarter' || kind === 'free' ? this.armed.yaw : 0);
          shown = true;
        } catch {
          this.ghostPos = null; // the example params no longer build: nothing to place
        }
      }
      this.ghost.visible = shown;
    } else if (this.armed && this.mouse.looking) this.ghost.visible = false;

    const d = this.drag;
    if (d?.active) {
      this.#aimRay();
      const at = this.#plane(d.from[1]);
      if (at) {
        d.target = [this.snap(at.x - d.grab[0]), d.from[1], this.snap(at.z - d.grab[1])];
        const rel = this.#bounds(d.i).clone().translate(new THREE.Vector3(-d.from[0], -d.from[1], -d.from[2]));
        this.#showGhost(rel, d.target, 0);
      }
    }

    if (this.toastT > 0 && (this.toastT -= dt) <= 0 && this.toastEl) this.toastEl.style.opacity = 0;
  }

  // ---- files (io.js; "not implemented" until #72 lands: shown as a toast) ----

  async save() {
    try {
      const where = await saveLevel(this.doc);
      if (!this.disposed) this.toast(where ? `saved: ${where}` : 'saved');
    } catch (err) {
      if (!this.disposed) this.toast(err.message);
    }
  }

  async open() {
    try {
      const level = await openLevel(this.game.registry);
      if (this.disposed) return;
      this.load(level);
      this.toast(`opened ${level.name ?? 'level'}`);
    } catch (err) {
      if (!this.disposed) this.toast(err.message);
    }
  }

  dispose() {
    this.disposed = true;
    if (!this.editing) return;
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    removeEventListener('mousemove', this.onMouseMove);
    removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    for (const el of [this.palette, this.status, this.toastEl]) el.remove();
    for (const o of [this.helper, this.ghost]) disposeTree(o);
    if (this.hud) this.hud.style.display = this.hudDisplay;
    this.game.enemies.frozen = this.wasFrozen;
    for (let i = this.items.length - 1; i >= 0; i--) this.#unbuild(this.items[i]);
    this.items.length = 0;
  }
}
