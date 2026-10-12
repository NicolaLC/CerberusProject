// Workshop document model (instructions/workshop.md): the edited level as plain data plus its undo / redo history.
// Pure: no three.js, no DOM, no registry. The editor passes two hooks and keeps the scene equal to the doc through them.
//   sync(cmd, reverse)  before the doc changes: builds / frees the scene objects (may throw: the doc is then untouched)
//   changed()           after it changed (selection, panels)
//   snap(v)             horizontal grid snap for move / duplicate
// Edits are commands { index, before, after } (before null = an insert, after null = a delete, both = a replace in place).

const QUARTER = Math.PI / 2;
const STEP = Math.PI / 12; // 15 degrees
const DUPE = 1; // m: where a duplicate lands (+x)

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const round = (v) => Math.round(v * 1e4) / 1e4 + 0; // + 0: no -0
export const xyz = (p) => (Array.isArray(p) ? [p[0], p[1] ?? 0, p[2]] : [p.x, p.y ?? 0, p.z]);

// How a piece turns: 'quarter' kit.* (axis-aligned, yaw in 90 degree steps: kit.js throws otherwise), 'box' env.box /
// env.strip / trigger.volume / zone.interior / objective.reach (builders ignore yaw: a quarter turn swaps width and depth), 'label' (yaw is a param), 'none' (lights),
// 'free' everything else (enemies, pickups, props: 15 degree steps).
export function rotationKind(id) {
  if (id.startsWith('kit.')) return 'quarter';
  if (id === 'env.box' || id === 'env.strip' || id === 'trigger.volume' || id === 'zone.interior' || id === 'objective.reach') return 'box';
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
      const [w, h, d] = p.params.size ?? (p.id === 'zone.interior' ? [8, 4, 8] : [4, 3, 4]); // trigger.volume / zone.interior default
      p.params.size = [d, h, w];
      if (p.params.faces) p.params.faces = Object.fromEntries(Object.entries(p.params.faces).map(([k, v]) => [map[k] ?? k, v]));
    }
  }
  return p;
}

// A copy of `level` whose top-level `interiorZones` ({ min, max } boxes, the file's older form) are `zone.interior` pieces
// (appended in order) so the editor can select, move and resize them; `interiorZones` becomes []. Pure.
export function zonesToPieces(level) {
  const out = clone(level);
  const zones = out.interiorZones ?? [];
  if (!zones.length) return out;
  for (const { min, max } of zones) out.pieces.push({ id: 'zone.interior', pos: [round((min[0] + max[0]) / 2), round(min[1]), round((min[2] + max[2]) / 2)], params: { size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])] } });
  out.interiorZones = [];
  return out;
}

export class WorkshopDoc {
  constructor(level, { sync, changed, snap = round } = {}) {
    this.level = level; // the plain level object (level.md format); the editor and the save path read it
    this.sync = sync;
    this.changed = changed;
    this.snap = snap;
    this.undoStack = [];
    this.redoStack = [];
    this.sel = -1; // index of the selected piece, -1 = none
    this.dirty = false; // edited since the last reset() / markSaved()
  }

  // A doc from a level file's content (older `interiorZones` become pieces).
  static fromJSON(level, opts) {
    return new WorkshopDoc(zonesToPieces(level), opts);
  }

  // The level as plain data (a deep copy): what io.js serializes.
  toJSON() {
    return clone(this.level);
  }

  get count() {
    return this.level.pieces.length;
  }

  // A copy of piece i (throws when there is none).
  piece(i) {
    if (!(i >= 0 && i < this.count)) throw new Error(`workshop: no piece #${i}`);
    return clone(this.level.pieces[i]);
  }

  select(i) {
    return (this.sel = i >= 0 && i < this.count ? i : -1);
  }

  markSaved() {
    this.dirty = false;
  }

  // Replaces the level (open a file, back from play). History is forgotten unless `keepHistory` (its commands act on a doc
  // that did not change, as after play). The selection is the caller's to fix.
  reset(level, keepHistory = false) {
    this.level = level;
    if (!keepHistory) {
      this.undoStack.length = this.redoStack.length = 0;
      this.dirty = false;
    }
  }

  // ---- edits: each is one undoable command; they return the index of the piece they leave ----

  // Inserts a ready piece (the editor fitted its pos / yaw / params) at `index` (default: the end).
  add(piece, index = this.count) {
    return this.#exec({ index, before: null, after: clone(piece) });
  }

  // Moves piece i (horizontal snap). A mover's rail (`to`) and a boss arena travel with it.
  move(i, pos) {
    const old = this.piece(i);
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
    const old = this.piece(i);
    if (rotationKind(old.id) === 'none') return i;
    return this.#exec({ index: i, before: old, after: turned(old, steps) });
  }

  // Merges `patch` into the params of piece i. A null value removes that key (no params left: no `params`).
  setParams(i, patch) {
    const old = this.piece(i);
    const params = { ...old.params, ...clone(patch) };
    for (const k of Object.keys(params)) if (params[k] === null) delete params[k];
    const after = clone(old);
    if (Object.keys(params).length) after.params = params;
    else delete after.params;
    return this.#exec({ index: i, before: old, after });
  }

  // Sets (or with '' / null removes) the `name` of piece i.
  setName(i, name) {
    const old = this.piece(i);
    const after = clone(old);
    if (name == null || name === '') delete after.name;
    else after.name = String(name);
    return this.#exec({ index: i, before: old, after });
  }

  // Returns the new piece count.
  remove(i) {
    this.#exec({ index: i, before: this.piece(i), after: null });
    return this.count;
  }

  // Copies piece i next to itself (+1 m in x, grid-snapped), without its `name`. Returns the copy's index.
  duplicate(i) {
    const p = this.piece(i);
    delete p.name;
    p.pos[0] = this.snap(p.pos[0] + DUPE);
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

  #exec(cmd) {
    this.#apply(cmd, false); // throws before touching the doc when the scene cannot build the piece
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    return cmd.index;
  }

  #apply(cmd, reverse) {
    const to = reverse ? cmd.before : cmd.after;
    const i = cmd.index;
    this.sync?.(cmd, reverse);
    const pieces = this.level.pieces;
    if (!to) pieces.splice(i, 1);
    else if (reverse ? !cmd.after : !cmd.before) pieces.splice(i, 0, clone(to));
    else pieces[i] = clone(to);
    this.sel = to ? i : -1;
    this.dirty = true;
    this.changed?.();
  }
}
