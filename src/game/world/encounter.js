import * as THREE from 'three';

// Encounter pieces (#73, instructions/workshop.md "Encounters"): markers and trigger volumes that script a fight.
// They are level data (registry owner 'encounter', ids below, a public contract: instructions/level.md) and have no
// geometry of their own. In a played level they are logic only (nothing is built for the eye, nothing collides).
// The Workshop and the Library build them with `spawn(data, { gizmo: true })`: a coloured gizmo, inert logic.
//
//  marker.spawn       player start. Overrides `level.spawn` (the first one in the file wins), see levelSpawn().
//  marker.checkpoint  entering it in play records it; the player respawns there after dying.
//  marker.entry       reinforcement entry point: params { group, enemies: [enemy ids] }; spawnGroup(group) builds those
//                     enemies here, awake, as members of `group`.
//  trigger.volume     box (pos = centre x / bottom y / centre z). Fires `trigger:fired` { id, event } when the player
//                     enters. params { size [w,h,d], event, once (true), wakeGroup?, spawnGroup? }.
// Events out: `trigger:fired` { id, event }, `checkpoint:reached` { id, pos, yaw }, `group:wake` { group } (Enemies),
// `group:spawn` { group, count }. Events in (an objective system, later): `encounter:wake` group, `encounter:spawn` group.

export const TUNING = {
  checkpointRadius: 2, // m, horizontal reach of a checkpoint
  checkpointReach: 2.5, // m, vertical reach (feet to marker)
  spread: 1.5, // m between reinforcements side by side
  size: [4, 3, 4], // default trigger volume
};

const COLOR = { spawn: 0x58ff9a, checkpoint: 0x3affff, entry: 0xff7a3a, trigger: 0xff4bd6 };

// The level's player start: the first `marker.spawn` piece, else `level.spawn`. Pure.
export function levelSpawn(level) {
  const m = level.pieces?.find((p) => p.id === 'marker.spawn');
  return m ? { pos: m.pos.slice(), yaw: m.yaw ?? 0 } : level.spawn;
}

const bad = (id, msg) => {
  throw new Error(`${id}: ${msg}`);
};
const entry = (sys, d) => sys.add('entry', d);

export const ENCOUNTER_PIECES = {
  'marker.spawn': { example: { params: {}, yaw: Math.PI }, label: 'player start (overrides level.spawn)', build: (sys, d) => sys.add('spawn', d) },
  'marker.checkpoint': { example: { params: {} }, label: `respawn point after a death, ${TUNING.checkpointRadius} m reach`, build: (sys, d) => sys.add('checkpoint', d) },
  'marker.entry': { example: { params: { group: 'reinforce', enemies: ['enemy.trooper', 'enemy.trooper'] } }, label: 'reinforcement entry: spawns its listed enemies for its group', fields: [{ key: 'group', type: 'text' }, { key: 'enemies', type: 'list' }], build: entry },
  'trigger.volume': { example: { params: { size: [...TUNING.size], event: 'trigger', once: true } }, label: 'fires an event when the player enters; can wake / spawn a group', fields: [{ key: 'size', type: 'vec3', min: 0.1 }, { key: 'event', type: 'text' }, { key: 'once', type: 'bool', def: true }, { key: 'wakeGroup', type: 'text', optional: true }, { key: 'spawnGroup', type: 'text', optional: true }], build: (sys, d) => sys.add('trigger', d) },
};

const _right = new THREE.Vector3();

export class Encounter {
  // Permanent: event listeners. Per level (load / unload): the records.
  constructor({ scene, events, registry, enemies }) {
    Object.assign(this, { scene, events, registry, enemies });
    this.items = []; // records: { id, kind, name, pos, yaw, params, gizmo, inside, fired, ... }
    this.checkpoint = null; // { id, pos: [x, y, z], yaw } of the last checkpoint reached (play)
    this.cpRec = null;
    this.triggers = 0;
    this.gizmoMode = false; // set while spawn() builds a gizmo piece
    this.res = null; // gizmo geometry + materials: built with the first gizmo, freed with the last (nothing stays on the GPU in play)
    this.gizmos = 0;
    // requests from outside (an objective system, tests); the stored fns are permanent
    events.on('encounter:wake', (g) => this.enemies.wakeGroup(g));
    events.on('encounter:spawn', (g) => this.spawnGroup(g));
  }

  // Builds the encounter pieces of a level (logic only). Unloads the current ones first.
  load(level) {
    this.unload();
    for (const d of this.registry.piecesOf(level, 'encounter')) this.registry.build('encounter', this, d);
    return this;
  }

  unload() {
    for (const r of this.items) this.#dropGizmo(r);
    this.items.length = 0;
    this.checkpoint = this.cpRec = null;
    this.triggers = 0;
  }

  // Runtime spawn (editor, Library): one piece after load. gizmo: draw it and keep it inert. Returns the record.
  spawn(data, { gizmo = false } = {}) {
    this.gizmoMode = gizmo;
    try {
      return this.registry.build('encounter', this, data);
    } finally {
      this.gizmoMode = false;
    }
  }

  despawn(rec) {
    const i = this.items.indexOf(rec);
    if (i < 0) return;
    this.items.splice(i, 1);
    this.#dropGizmo(rec);
    if (this.cpRec === rec) this.checkpoint = this.cpRec = null;
  }

  // Builder entry (see ENCOUNTER_PIECES): validates the params, makes the record (and its gizmo).
  add(kind, d) {
    const id = d.id;
    const p = d.params ?? {};
    const rec = { id, kind, name: d.name ?? null, pos: new THREE.Vector3(...d.pos), yaw: d.yaw ?? 0, params: p, gizmo: null, inert: this.gizmoMode, inside: false, fired: false };
    if (kind === 'trigger') {
      const size = p.size ?? TUNING.size;
      if (!Array.isArray(size) || size.length !== 3 || size.some((n) => !(n > 0))) bad(id, 'size must be [w, h, d], all above 0');
      if (p.event !== undefined && typeof p.event !== 'string') bad(id, 'event must be a string');
      rec.size = size;
      rec.event = p.event ?? 'trigger';
      rec.once = p.once ?? true;
      rec.tid = d.name ?? `trigger${this.triggers}`;
    } else if (kind === 'entry') {
      const list = p.enemies ?? [];
      if (!Array.isArray(list) || list.some((e) => this.registry.owner(e) !== 'enemies')) bad(id, 'enemies must be a list of enemy piece ids');
      rec.list = list;
    }
    if (kind === 'trigger') this.triggers++;
    if (this.gizmoMode) {
      rec.gizmo = this.#gizmo(rec);
      this.scene.add(rec.gizmo);
      this.gizmos++;
    }
    this.items.push(rec);
    return rec;
  }

  // Group actions: wake everyone of `group` / build the enemies of every entry marker of `group`. Returns the count spawned.
  wakeGroup(group) {
    return this.enemies.wakeGroup(group);
  }

  spawnGroup(group) {
    if (group == null || !this.enemies.bases) return 0;
    let count = 0;
    for (const r of this.items) {
      if (r.kind !== 'entry' || r.inert || r.params.group !== group) continue;
      const n = r.list.length;
      _right.set(Math.cos(r.yaw), 0, -Math.sin(r.yaw));
      r.list.forEach((id, i) => {
        const o = (i - (n - 1) / 2) * TUNING.spread;
        const a = this.enemies.spawn({ id, pos: [r.pos.x + _right.x * o, r.pos.y, r.pos.z + _right.z * o], yaw: r.yaw, params: { group } });
        a.wake?.(); // reinforcements come into a fight
        count++;
      });
    }
    this.events.emit('group:spawn', { group, count });
    return count;
  }

  // Play: checkpoints record, trigger volumes fire. Gizmo pieces (editor) do nothing.
  update(dt, player) {
    if (player.dead || !this.items.length) return;
    const p = player.pos;
    for (const r of this.items) {
      if (r.inert) continue;
      if (r.kind === 'checkpoint') {
        const dx = p.x - r.pos.x;
        const dz = p.z - r.pos.z;
        if (this.cpRec !== r && dx * dx + dz * dz < TUNING.checkpointRadius ** 2 && Math.abs(p.y - r.pos.y) < TUNING.checkpointReach) {
          this.cpRec = r;
          this.checkpoint = { id: r.name ?? 'checkpoint', pos: [r.pos.x, r.pos.y, r.pos.z], yaw: r.yaw };
          this.events.emit('checkpoint:reached', this.checkpoint);
        }
      } else if (r.kind === 'trigger') {
        const [w, h, d] = r.size;
        const inside = Math.abs(p.x - r.pos.x) <= w / 2 && Math.abs(p.z - r.pos.z) <= d / 2 && p.y >= r.pos.y - 0.1 && p.y <= r.pos.y + h;
        const enter = inside && !r.inside;
        r.inside = inside;
        if (enter && !(r.once && r.fired)) this.#fire(r);
      }
    }
  }

  #fire(r) {
    r.fired = true;
    this.events.emit('trigger:fired', { id: r.tid, event: r.event });
    if (r.params.wakeGroup != null) this.wakeGroup(r.params.wakeGroup);
    if (r.params.spawnGroup != null) this.spawnGroup(r.params.spawnGroup);
  }

  // ---- gizmos (editor / Library only): shared geometry and materials, nothing to free per piece ----

  #resources() {
    if (this.res) return this.res;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const geo = {
      box,
      edges: new THREE.EdgesGeometry(box),
      cone: new THREE.ConeGeometry(0.25, 0.5, 12).rotateX(Math.PI / 2), // tip along +z
      ring: new THREE.RingGeometry(0.97, 1, 40).rotateX(-Math.PI / 2),
    };
    const mat = {};
    for (const [k, c] of Object.entries(COLOR)) {
      mat[k] = {
        fill: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, depthWrite: false }),
        solid: new THREE.MeshBasicMaterial({ color: c }),
        line: new THREE.LineBasicMaterial({ color: c, depthTest: false }),
        ring: new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
      };
    }
    return (this.res = { geo, mat });
  }

  #dropGizmo(rec) {
    if (!rec.gizmo) return;
    rec.gizmo.removeFromParent();
    rec.gizmo = null;
    if (--this.gizmos > 0 || !this.res) return;
    for (const g of Object.values(this.res.geo)) g.dispose();
    for (const set of Object.values(this.res.mat)) for (const m of Object.values(set)) m.dispose();
    this.res = null;
  }

  #gizmo(r) {
    const { geo: G, mat } = this.#resources();
    const m = mat[r.kind];
    const g = new THREE.Group();
    g.position.copy(r.pos);
    g.rotation.y = r.kind === 'trigger' ? 0 : r.yaw;
    const part = (geo, mat, pos, scale) => {
      const o = geo === G.edges ? new THREE.LineSegments(geo, mat) : new THREE.Mesh(geo, mat);
      o.position.set(...pos);
      o.scale.set(...scale);
      o.raycast = () => {};
      o.userData.gizmo = true;
      g.add(o);
      return o;
    };
    const solidBox = (pos, scale) => {
      part(G.box, m.fill, pos, scale);
      part(G.edges, m.line, pos, scale);
    };
    if (r.kind === 'trigger') {
      const [w, h, d] = r.size;
      solidBox([0, h / 2, 0], [w, h, d]);
    } else if (r.kind === 'spawn') {
      solidBox([0, 0.9, 0], [0.6, 1.8, 0.6]);
      part(G.cone, m.solid, [0, 0.1, 0.8], [1, 1, 1]);
    } else if (r.kind === 'checkpoint') {
      part(G.box, m.solid, [0, 1, 0], [0.06, 2, 0.06]); // pole
      part(G.box, m.solid, [0.35, 1.75, 0], [0.7, 0.4, 0.04]); // flag
      part(G.ring, m.ring, [0, 0.03, 0], [TUNING.checkpointRadius, 1, TUNING.checkpointRadius]);
      part(G.cone, m.solid, [0, 0.1, 0.9], [0.8, 0.8, 0.8]);
    } else {
      solidBox([0, 0.05, 0], [1.4, 0.1, 1.4]); // pad
      part(G.cone, m.solid, [0, 0.4, 0.9], [1.2, 1.2, 1.2]);
      const n = r.list.length;
      for (let i = 0; i < n; i++) solidBox([(i - (n - 1) / 2) * TUNING.spread * 0.4, 0.45, -0.3], [0.3, 0.6, 0.3]); // one block per enemy
    }
    g.traverse((o) => (o.frustumCulled = false));
    return g;
  }
}
