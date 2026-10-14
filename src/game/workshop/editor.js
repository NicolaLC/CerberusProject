import * as THREE from 'three';
import { disposeTree } from '../../engine/dispose.js';
import { saveLevel, openLevel } from './io.js';
import { levelSpawn } from '../world/encounter.js';
import { WorkshopDoc, clone, round, xyz, fitYaw, rotationKind, turned, zonesToPieces } from './doc.js';
import { bound, boundIn } from '../controls.js';

// Workshop editor (#70, instructions/workshop.md): `?scene=workshop` turns into a level editor (level field
// `"tool": "workshop"`, a Gym-style tool: new Tool(game, level), update(dt), dispose()).
//
// The edited level is a plain level object (`this.doc`, the file format of level.md) held by a WorkshopDoc (doc.js: pure
// data, commands, undo / redo, no three.js). Every edit changes `doc.pieces` and rebuilds only the affected piece through
// the owner's runtime spawn path (world.spawn, enemies.spawn, registry.build for pickups), so the scene always equals
// the doc: the model calls `#sync` before it changes. `this.items[i]` is the live handle of `doc.pieces[i]`.
// While editing the engine runs in mode 'edit' (engine.setMode): the 'play' group (player, weapon, pickups, encounter,
// camera rig) stands still, enemies are frozen, the HUD is hidden and the camera is a free-fly one.

const TUNING = {
  fly: 9, // m/s
  fast: 3, // Shift multiplier
  look: 0.0025, // rad per px, right button held
  pitch: 1.5, // rad, up / down limit
  grids: [0.5, 0.25, 1, 0], // horizontal snap in metres (metrics.md: 0.5), 0 = off; G cycles
  nudgeY: 0.1, // m, vertical snap (metrics.md)
  dragPx: 4, // pixels before a press on a piece becomes a drag
  toast: 2.8, // s
  maxBox: 40, // m: a measured bound larger than this is a failed measure (fallback box)
};
const TINT = { wall: 0xe8f0ff, high: 0x3aa0ff, low: 0xff9a3a, none: 0xffe14a }; // box helper by cover class
const font = '11px/1.45 monospace';
const VOLUME = new Set(['trigger.volume', 'zone.interior', 'zone.sector', 'zone.portal', 'objective.reach', 'objective.action']);
const FIELD = /^(INPUT|SELECT|TEXTAREA)$/;
const FALLBACK = new THREE.Box3(new THREE.Vector3(-0.45, 0, -0.45), new THREE.Vector3(0.45, 1.9, 0.45)); // enemy / pickup stand-in
// What posed enemies see instead of the player: nobody to fight (`dead` stops every enemy from waking, aiming and firing).
// The fields are what the actors read before they check `dead`.
class Absent {
  dead = true;
  cover = false;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  chest(out) {
    return out.copy(this.pos);
  }
}
const POINT = new THREE.Box3(new THREE.Vector3(-0.25, -0.25, -0.25), new THREE.Vector3(0.25, 0.25, 0.25)); // lights

const deg = (rad) => Math.round((rad * 180) / Math.PI);
const css = (el, style) => Object.assign(el.style, style);

// ---- inspector fields (registry meta `fields`, level.md) ----
// Text of a stored value in its field. Pure.
export function formatField(f, v) {
  if (v == null) return '';
  if (f.type === 'vec2' || f.type === 'vec3') return v.join(', ');
  if (f.type === 'list') return v.join(f.sep && f.sep !== ',' ? ` ${f.sep} ` : ', ');
  return String(v);
}

// Value of a field's text: undefined = remove the key (an optional field left empty). Throws a readable error. Pure.
export function parseField(f, text) {
  const t = String(text).trim();
  const name = f.label ?? f.key;
  if (f.type === 'number') {
    if (t === '' && f.optional) return undefined;
    const n = Number(t);
    if (t === '' || !Number.isFinite(n)) throw new Error(`${name}: a number is needed`);
    if (f.min != null && n < f.min) throw new Error(`${name}: at least ${f.min}`);
    return n;
  }
  if (f.type === 'vec2' || f.type === 'vec3') {
    if (t === '' && f.optional) return undefined;
    const n = f.type === 'vec2' ? 2 : 3;
    const v = t.split(/[\s,x]+/).filter(Boolean).map(Number);
    if (v.length !== n || v.some((x) => !Number.isFinite(x))) throw new Error(`${name}: ${n} numbers are needed (like ${n === 2 ? '4, 4' : '4, 3, 4'})`);
    if (f.min != null && v.some((x) => x < f.min)) throw new Error(`${name}: each at least ${f.min}`);
    return v;
  }
  if (f.type === 'list') {
    const v = t.split(f.sep ?? ',').map((x) => x.trim()).filter(Boolean);
    return v.length || !f.optional ? v : undefined;
  }
  return t === '' && f.optional ? undefined : t; // text, enum
}

export class WorkshopEditor {
  // shown in the key bar (view/keyhints.js); tests/workshop.browser.mjs checks that every key handled below is listed
  static KEYS = [['W A S D', 'fly'], ['Q / E', 'down / up'], ['Shift', 'fast'], ['RMB', 'look (hold)'], ['LMB', 'place / select / drag'], ['R', 'rotate (Shift: back)'], ['G', 'snap 0.5 / 0.25 / 1 / off'], ['Arrows', 'nudge'], ['PgUp / PgDn', 'raise / lower'], ['Ctrl+D', 'duplicate'], ['Del / Backspace', 'delete'], ['Ctrl+Z / Y', 'undo / redo'], ['Ctrl+S / O', 'save / open'], ['P', 'play here / back to edit'], ['T', 'restart (playing)'], ['Esc', 'cancel / pause']];

  constructor(game, level) {
    this.game = game;
    // The tool only runs in the workshop scene; in any other level it does nothing. `editing` is the edit half of it
    // (false while playing in place), which is what game.js checks.
    this.active = game.sceneName === 'workshop';
    this.playing = false;
    this.snapshot = null; // the doc as it was when play started (deep copy)
    this.playLevel = null; // what play loaded: the snapshot with the spawn moved to the camera
    this.edit3d = null; // camera state kept while playing
    this.disposed = false;
    this.items = []; // live handle of doc.pieces[i]: { owner, thing }
    this.model = WorkshopDoc.fromJSON(level, { sync: (cmd, reverse) => this.#sync(cmd, reverse), changed: () => this.#refreshSel(), snap: (v) => this.snap(v) });
    this.armed = null; // { id, params, yaw }: the palette entry waiting to be placed
    this.gridIndex = 0;
    this.toastText = '';
    this.toastT = 0;
    this.measured = new Map();
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, over: false, looking: false };
    this.drag = null; // { i, px, grab, from, active, target }
    this.ghostPos = null; // where the armed piece would land
    if (!this.active) return;

    const { engine, enemies } = game;
    this.ray = new THREE.Raycaster();
    this.hit = new THREE.Vector3();
    this.canvas = engine.canvas;
    this.absent = new Absent();
    this.wasFrozen = enemies.freeze(true);
    engine.setMode('edit');

    this.#populate(false);

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

  get editing() {
    return this.active && !this.playing;
  }

  // the document (plain level object) and its history, held by the model
  get doc() {
    return this.model.level;
  }

  get undoStack() {
    return this.model.undoStack;
  }

  get redoStack() {
    return this.model.redoStack;
  }

  get sel() {
    return this.model.sel;
  }

  set sel(i) {
    this.model.sel = i;
  }

  // Builds the scene from this.doc for editing: the world pieces one by one (each doc piece owns its objects), the
  // enemies frozen and posed, the pickups. `reload` false = enemies and pickups are already loaded from the doc
  // (the scene just opened): adopt them in file order. Anything else (back from play) loads them first.
  #populate(reload) {
    const { world, enemies, pickups, encounter, registry } = this.game;
    const level = this.doc;
    encounter.unload(); // its pieces are rebuilt below as gizmos
    world.load({ ...level, pieces: level.pieces.filter((p) => registry.owner(p.id) !== 'world') }, registry);
    if (reload) {
      enemies.load(level);
      pickups.load(level);
    }
    enemies.freeze(true);
    const actors = enemies.all.slice();
    const crates = pickups.items.slice();
    let ne = 0;
    let np = 0;
    this.items = this.doc.pieces.map((p) => {
      const owner = registry.owner(p.id);
      if (owner === 'enemies') {
        const a = actors[ne++];
        this.#pose(a);
        if (a.kind === 'boss') enemies.setBoss(a);
        return { owner, thing: a };
      }
      if (owner === 'pickups') return { owner, thing: crates[np++] };
      return this.#build(p); // world and encounter pieces
    });
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
    return this.model.add(piece);
  }

  select(i) {
    this.model.select(i);
    this.#refreshSel();
    return this.sel;
  }

  // The edits are commands of the model (doc.js): undoable, each rebuilds its piece through #sync.
  move(i, pos) {
    return this.model.move(i, pos);
  }

  rotate(i, steps = 1) {
    return this.model.rotate(i, steps);
  }

  setParams(i, patch) {
    return this.model.setParams(i, patch);
  }

  setName(i, name) {
    return this.model.setName(i, name);
  }

  remove(i) {
    return this.model.remove(i);
  }

  duplicate(i) {
    return this.model.duplicate(i);
  }

  undo() {
    return this.model.undo();
  }

  redo() {
    return this.model.redo();
  }

  // Replaces the whole document (Ctrl+O): validates it, rebuilds every piece, forgets the history.
  load(level) {
    this.game.registry.check(level);
    for (let i = this.items.length - 1; i >= 0; i--) this.#unbuild(this.items[i]);
    this.items = [];
    this.model.reset(zonesToPieces(level));
    this.items = this.doc.pieces.map((p) => this.#build(p));
    this.model.select(-1);
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
    if (enemies.all.length !== n('enemies')) problems.push(`enemies ${enemies.all.length} != ${n('enemies')}`);
    if (this.game.encounter.items.length !== n('encounter')) problems.push(`encounter ${this.game.encounter.items.length} != ${n('encounter')}`);
    for (const it of this.items) if (it.owner === 'encounter' && !it.thing.gizmo?.parent) problems.push('an encounter gizmo is detached');
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

  // ---- play in place (#71) ----
  // P plays the doc: a copy of it is loaded as a normal level (world batches, cover map for the enemies, awake enemies,
  // pickups), the player stands where the camera is. P again drops that level and rebuilds the editor from the snapshot,
  // so the doc is exactly what it was. The undo / redo history is kept (its commands act on the doc, which is unchanged).

  // Where the player starts: on the ground under the camera, or the doc's spawn when there is no ground there (or the
  // spot is inside a wall). Returns { pos, yaw } of a level spawn.
  spawnAt() {
    const cam = this.game.engine.camera.position;
    const spawn = levelSpawn(this.doc); // a marker.spawn piece, else doc.spawn
    const r = 0.4; // player radius (metrics.md 1: 0.35), with a margin
    let ground = -Infinity;
    const cover = (c, lo, hi) => {
      const b = c.box;
      return b.max.y > lo && b.min.y < hi && cam.x > b.min.x - r && cam.x < b.max.x + r && cam.z > b.min.z - r && cam.z < b.max.z + r;
    };
    const colliders = this.game.world.colliders;
    for (const c of colliders) {
      if (c.box.max.y <= cam.y && c.box.max.y > ground && cover(c, -Infinity, Infinity)) ground = c.box.max.y;
    }
    // walkable: ground found, and nothing solid where the body would stand (a wall box around the camera's x / z)
    const blocked = ground === -Infinity || colliders.some((c) => c.box.max.y > ground + 0.5 && cover(c, ground + 0.5, ground + 1.7));
    if (blocked) return { pos: spawn.pos.slice(), yaw: spawn.yaw ?? Math.PI };
    return { pos: [round(cam.x), round(ground), round(cam.z)], yaw: this.cam.yaw + Math.PI };
  }

  // Edit -> play. Returns false when already playing.
  play() {
    if (!this.active || this.playing) return false;
    const { game } = this;
    const { engine } = game;
    this.snapshot = clone(this.doc);
    this.playLevel = { ...clone(this.doc), spawn: this.spawnAt() }; // first play: where the camera is
    this.edit3d = { pos: engine.camera.position.clone(), fov: engine.camera.fov };
    // forget the gestures of edit mode
    this.drag = null;
    this.keys.clear();
    this.mouse.looking = false;
    this.ghost.visible = this.helper.visible = false;
    if (this.inspector.contains(document.activeElement)) document.activeElement.blur();
    for (const el of [this.palette, this.side, this.toastEl]) el.style.display = 'none';
    // the editor's objects are freed by the level reload below (world.load / enemies.load / pickups.load unload first)
    this.items = [];
    this.playing = true;
    engine.setMode('play');
    game.padPlay = false; // like the game: losing pointer lock pauses
    if (this.hud) this.hud.style.display = this.hudDisplay;
    this.#loadPlay(this.playLevel.spawn);
    game.engine.input.lock();
    return true;
  }

  // Loads the play level (also the restart): a fresh copy of the snapshot, enemies awake, player at `spawn`; the
  // encounter pieces load as logic only (no gizmos, checkpoint forgotten).
  #loadPlay(spawn) {
    const { game } = this;
    const level = game.registry.check(clone({ ...this.snapshot, spawn }));
    game.dropHelpers();
    game.world.load(level, game.registry);
    game.enemies.load(level);
    game.pickups.load(level);
    game.encounter.load(level);
    game.enemies.freeze(false);
    game.resetRun(level, spawn);
    game.rebuildHelpers();
  }

  // Back to the editor: the doc is replaced by the snapshot, the scene rebuilt from it, the camera as it was.
  edit() {
    if (!this.active || !this.playing) return false;
    const { game } = this;
    const { engine } = game;
    game.dropHelpers();
    this.playing = false;
    engine.setMode('edit');
    this.model.reset(clone(this.snapshot), true);
    this.#populate(true);
    game.resetRun(this.doc);
    engine.camera.position.copy(this.edit3d.pos);
    engine.camera.fov = this.edit3d.fov;
    engine.camera.updateProjectionMatrix();
    this.#aim();
    this.snapshot = this.playLevel = this.edit3d = null;
    if (this.hud) this.hud.style.display = 'none';
    for (const el of [this.palette, this.side, this.toastEl]) el.style.display = '';
    if (engine.input.locked) document.exitPointerLock();
    engine.input.free = false;
    game.padPlay = true; // the editor runs without pointer lock
    game.setRunning?.(true);
    this.sel = this.sel < this.count ? this.sel : -1;
    this.#refreshSel();
    return true;
  }

  togglePlay() {
    return this.playing ? this.edit() : this.play();
  }

  // Plays the encounter again from the snapshot (every enemy and pickup new, checkpoint forgotten). The player goes to
  // the level's `marker.spawn` when the doc has one, else to where this play started.
  restart() {
    if (!this.playing) return false;
    const marked = this.snapshot.pieces.some((p) => p.id === 'marker.spawn');
    this.#loadPlay(marked ? levelSpawn(this.snapshot) : this.playLevel.spawn);
    return true;
  }

  // ---- scene: the owner's runtime spawn path ----

  // The model calls this before the doc changes (cmd: { index, before, after }, see doc.js): builds / frees the live
  // handle. A piece that cannot be built throws here and the doc stays as it was.
  #sync(cmd, reverse) {
    const to = reverse ? cmd.before : cmd.after;
    const from = reverse ? cmd.after : cmd.before;
    const i = cmd.index;
    if (!to) {
      this.#unbuild(this.items[i]);
      this.items.splice(i, 1);
    } else if (!from) this.items.splice(i, 0, this.#build(to));
    else {
      const item = this.#build(to);
      this.#unbuild(this.items[i]);
      this.items[i] = item;
    }
  }

  #build(piece) {
    const { registry, world, enemies, pickups, encounter } = this.game;
    const data = clone(piece); // builders may keep what they are given
    const owner = registry.owner(data.id);
    if (owner === 'world') return { owner, thing: world.spawn(data, { gizmo: true }) };
    if (owner === 'enemies') {
      const a = enemies.spawn(data);
      this.#pose(a);
      if (a.kind === 'boss') enemies.setBoss(a);
      return { owner, thing: a };
    }
    if (owner === 'pickups') return { owner, thing: registry.build('pickups', pickups, data) };
    if (owner === 'encounter') return { owner, thing: encounter.spawn(data, { gizmo: true }) };
    throw new Error(`workshop: no owner for "${data.id}"`);
  }

  #unbuild({ owner, thing }) {
    const { world, enemies, pickups, encounter } = this.game;
    if (owner === 'world') world.despawn(thing);
    else if (owner === 'encounter') encounter.despawn(thing);
    else if (owner === 'enemies') {
      if (enemies.boss === thing) enemies.setBoss(null);
      enemies.despawn(thing);
    } else pickups.despawn(thing);
  }

  // A new enemy stands at its piece position after one tiny update (frozen enemies never get the regular ones).
  #pose(actor) {
    this.game.enemies.pose(actor, { viewer: this.absent });
  }

  // ---- bounds ----

  // World box of live item (union of its objects); a stand-in where the owner has no geometry (lights).
  #boxOf(item, at) {
    const objs = item.owner === 'world' ? item.thing.objects : item.owner === 'encounter' ? [item.thing.gizmo] : item.owner === 'enemies' ? [item.thing.group ?? item.thing.root] : [item.thing.model, item.thing.ring];
    const box = new THREE.Box3();
    for (const o of objs) box.expandByObject(o);
    const size = box.getSize(new THREE.Vector3());
    if (box.isEmpty() || Math.max(size.x, size.y, size.z) > TUNING.maxBox || !Number.isFinite(size.x + size.y + size.z)) {
      const fb = item.owner === 'world' || item.owner === 'encounter' ? POINT : FALLBACK;
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

    // right column: status (no pointer events) over the inspector (fields of the selected piece)
    this.side = document.createElement('div');
    css(this.side, { position: 'fixed', right: '8px', top: '8px', bottom: '8px', zIndex: 50, display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', pointerEvents: 'none', width: '272px' });
    this.status = document.createElement('div');
    css(this.status, { padding: '6px 10px', font, whiteSpace: 'pre-wrap', color: '#ffe14a', background: 'rgba(0,0,0,0.6)', maxWidth: '40ch', alignSelf: 'flex-end' });
    this.inspector = document.createElement('div');
    this.inspector.id = 'workshop-inspector';
    css(this.inspector, { display: 'none', width: '100%', boxSizing: 'border-box', overflowY: 'auto', padding: '6px 8px', font, color: '#cfe4f7', background: 'rgba(0,0,0,0.6)', pointerEvents: 'auto' });
    this.side.append(this.status, this.inspector);
    document.body.appendChild(this.side);
    this.insId = null; // piece id the inspector is built for
    this.insFields = []; // { f, el }

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

  // ---- inspector: one control per `fields` entry of the selected piece's registry meta (plus its `name`) ----

  #fieldsOf(id) {
    const { registry, world } = this.game;
    const mats = Object.keys(world.mats);
    const fields = [{ key: 'name', type: 'text', optional: true, piece: true }, ...(registry.meta(id).fields ?? [])];
    return fields.map((f) => (f.options === 'mats' ? { ...f, options: mats } : f));
  }

  // Shows the selected piece's fields. Rebuilt when the piece id changes, otherwise values are refreshed in place
  // (a field being typed in keeps its text until committed or cancelled).
  #syncInspector(force = false) {
    if (!this.inspector) return;
    const on = this.editing && this.sel >= 0 && this.sel < this.count;
    this.inspector.style.display = on ? '' : 'none';
    if (!on) {
      if (this.insId !== null) {
        this.inspector.replaceChildren();
        this.insFields = [];
        this.insId = null;
      }
      return;
    }
    const piece = this.doc.pieces[this.sel];
    if (this.insId !== piece.id) this.#buildInspector(piece.id);
    this.head.textContent = `#${this.sel} ${piece.id}`;
    for (const { f, el } of this.insFields) {
      if (el === document.activeElement && !force) continue;
      const v = f.piece ? piece.name : piece.params?.[f.key];
      if (f.type === 'bool') el.checked = v ?? f.def ?? false;
      else el.value = f.type === 'enum' ? v ?? '' : formatField(f, v);
    }
  }

  #buildInspector(id) {
    this.insId = id;
    this.insFields = [];
    this.head = document.createElement('div');
    css(this.head, { color: '#ffe14a', letterSpacing: '1px', marginBottom: '4px' });
    const rows = [this.head];
    for (const f of this.#fieldsOf(id)) {
      const row = document.createElement('label');
      css(row, { display: 'flex', alignItems: 'center', gap: '6px', margin: '2px 0' });
      const name = document.createElement('span');
      name.textContent = f.label ?? f.key;
      css(name, { flex: '0 0 84px', color: '#8fa6b8' });
      let el;
      if (f.type === 'enum') {
        el = document.createElement('select');
        for (const o of f.optional ? ['', ...f.options] : f.options) el.add(new Option(o === '' ? '(none)' : o, o));
      } else {
        el = document.createElement('input');
        el.type = f.type === 'bool' ? 'checkbox' : 'text';
        el.spellcheck = false;
        el.autocomplete = 'off';
        if (f.type === 'vec2' || f.type === 'vec3') el.placeholder = f.type === 'vec2' ? 'w, d' : 'w, h, d';
        if (f.type === 'list') el.placeholder = f.sep && f.sep !== ',' ? `a ${f.sep} b` : 'a, b';
      }
      el.dataset.key = f.key;
      if (f.type !== 'bool') css(el, { flex: '1', minWidth: 0, font, color: '#cfe4f7', background: 'rgba(16,32,46,0.9)', border: '1px solid #345a78', padding: '2px 4px' });
      // typing is the field's own: no key leaves it (the editor, the game's debug keys and the engine input never see it)
      el.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.#commitField(f, el);
        else if (bound('edCancel', e.code)) {
          this.#syncInspector(true);
          el.blur();
        }
      });
      el.addEventListener('keyup', (e) => e.stopPropagation());
      // a key held when the field gains focus is released while typing: its keyup never leaves the field, so drop the
      // held keys now (editor fly keys and the engine input; edge presses are left alone)
      el.addEventListener('focus', () => {
        this.keys.clear();
        this.game.engine.input.releaseAll();
      });
      el.addEventListener('change', () => this.#commitField(f, el));
      row.append(name, el);
      rows.push(row);
      this.insFields.push({ f, el });
    }
    this.inspector.replaceChildren(...rows);
  }

  // Commits one field through the command path (setParams / setName). A bad value is a toast and the field shows the doc again.
  #commitField(f, el) {
    const i = this.sel;
    if (!this.editing || i < 0 || i >= this.count) return;
    try {
      const raw = f.type === 'bool' ? el.checked : parseField(f, el.value);
      const piece = this.doc.pieces[i];
      const cur = f.piece ? piece.name : piece.params?.[f.key];
      const same = f.type === 'bool' ? raw === (cur ?? f.def ?? false) : JSON.stringify(raw) === JSON.stringify(cur);
      if (!same) {
        if (f.piece) this.setName(i, raw);
        else this.setParams(i, { [f.key]: raw === undefined ? null : raw });
      }
    } catch (err) {
      this.toast(err.message);
    }
    this.#syncInspector(true);
  }

  #refresh() {
    if (!this.status) return;
    this.#syncInspector();
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
    if (!mod && !e.repeat && (bound('edPlay', c) || (bound('edRestart', c) && this.playing))) {
      this.#guard(() => (bound('edPlay', c) ? this.togglePlay() : this.restart()));
      e.preventDefault();
      return;
    }
    if (this.playing) return; // the game owns every other key
    if (!mod) this.keys.add(c); // held keys fly the camera; a Ctrl chord (Ctrl+D...) must not
    if (mod) {
      let done = true;
      if (bound('edUndo', c)) (e.shiftKey ? this.redo() : this.undo());
      else if (bound('edRedo', c)) this.redo();
      else if (bound('edSave', c)) this.save();
      else if (bound('edOpen', c)) this.open();
      else if (bound('edDuplicate', c)) this.sel >= 0 && this.#guard(() => this.duplicate(this.sel));
      else done = false;
      if (done) e.preventDefault();
      return;
    }
    if (e.repeat && !/^(Arrow|Page)/.test(c)) return;
    if (bound('edTurn', c)) this.#turn(e.shiftKey ? -1 : 1);
    else if (bound('edGrid', c)) {
      this.gridIndex = (this.gridIndex + 1) % TUNING.grids.length;
      this.#refresh();
    } else if (bound('edDelete', c)) {
      if (this.sel >= 0) this.#guard(() => this.remove(this.sel));
    } else if (bound('edCancel', c)) this.#cancel();
    else if (bound('edNudgeUp', c) || bound('edNudgeDown', c) || bound('edNudgeLeft', c) || bound('edNudgeRight', c)) this.#nudge(c);
    else if (bound('edRaise', c) || bound('edLower', c)) {
      if (this.sel < 0) return;
      const p = this.doc.pieces[this.sel].pos;
      this.#guard(() => this.move(this.sel, [p[0], p[1] + (bound('edRaise', c) ? 1 : -1) * TUNING.nudgeY, p[2]]));
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
    const sign = bound('edNudgeUp', code) || bound('edNudgeRight', code) ? 1 : -1;
    const [dx, dz] = bound('edNudgeUp', code) || bound('edNudgeDown', code) ? [ax, az] : [-az, ax];
    const step = this.grid || 0.1;
    const p = this.doc.pieces[this.sel].pos;
    this.#guard(() => this.move(this.sel, [p[0] + sign * dx * step, p[1], p[2] + sign * dz * step]));
  }

  // Esc: drop what is armed, then the selection, then pause (the main menu DEVELOPMENT page has the scene picker).
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
    if (this.game.engine.paused || this.playing) return;
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
      // a trigger volume or interior zone often surrounds other pieces: picked only when nothing else is under the cursor
      const d = at.distanceTo(this.ray.ray.origin) + (VOLUME.has(this.doc.pieces[i].id) ? 1000 : 0);
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
    if (!boundIn('edModifier', this.keys)) {
      const k = this.keys;
      const f = (boundIn('forward', k) ? 1 : 0) - (boundIn('back', k) ? 1 : 0);
      const s = (boundIn('right', k) ? 1 : 0) - (boundIn('left', k) ? 1 : 0);
      const u = (boundIn('edFlyUp', k) ? 1 : 0) - (boundIn('edFlyDown', k) ? 1 : 0);
      const v = TUNING.fly * dt * (boundIn('run', k) ? TUNING.fast : 1);
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
      this.model.markSaved();
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
    if (!this.active) return;
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    removeEventListener('mousemove', this.onMouseMove);
    removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    for (const el of [this.palette, this.side, this.toastEl]) el.remove();
    for (const o of [this.helper, this.ghost]) disposeTree(o);
    if (this.hud) this.hud.style.display = this.hudDisplay;
    this.game.enemies.freeze(this.wasFrozen);
    this.game.engine.setMode('play');
    for (let i = this.items.length - 1; i >= 0; i--) this.#unbuild(this.items[i]);
    this.items.length = 0;
  }
}
