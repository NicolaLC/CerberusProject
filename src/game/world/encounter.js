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
//  zone.interior      box (pos = centre x / bottom y / centre z, params { size [w,h,d] }): an interior zone. In play it is added to
//                     `world.interiorZones` (camera exposure, HUD label INTERIOR, drones); the file's own `interiorZones` still work.
//  trigger.volume     box (pos = centre x / bottom y / centre z). Fires `trigger:fired` { id, event } when the player
//                     enters. params { size [w,h,d], event, once (true), wakeGroup?, spawnGroup? }.
//  objective.*        mission objectives (reach / destroy / survive / interact, #12): records only, `Mission` (mission.js) runs them.
//                     Common params { text, order?, limit?, wakeGroup?, spawnGroup? }; see OBJECTIVES below and workshop.md "Missions".
//  log.line           a STEM-00 log line (#40, instructions/narrative.md): params { text, on, priority? ('normal'), once? (true), delay? (s, 0) }.
//                     When `on` happens (LOG_ON below) it emits `log:say` { text, priority } after `delay`; the Log view (view/log.js) shows it.
// Events out: `trigger:fired` { id, event }, `checkpoint:reached` { id, pos, yaw }, `group:wake` { group } (Enemies),
// `group:spawn` { group, count }, `log:say` { text, priority }. Events in (the mission, mission.js; tests): `encounter:wake` group, `encounter:spawn` group.

export const TUNING = {
  checkpointRadius: 2, // m, horizontal reach of a checkpoint
  checkpointReach: 2.5, // m, vertical reach (feet to marker)
  spread: 1.5, // m between reinforcements side by side
  size: [4, 3, 4], // default trigger volume
  zone: [8, 4, 8], // example interior zone
  survive: 30, // s, default survive time
  radius: 2, // m, default interact radius
};

const COLOR = { spawn: 0x58ff9a, checkpoint: 0x3affff, entry: 0xff7a3a, trigger: 0xff4bd6, zone: 0x4aa8ff, objective: 0xffd23a, log: 0xffb347 };
const TEXT = { reach: 'REACH THE ZONE', destroy: 'DESTROY THE TARGETS', survive: 'SURVIVE', interact: 'ACCESS THE TERMINAL' };

// The level's player start: the first `marker.spawn` piece, else `level.spawn`. Pure.
export function levelSpawn(level) {
  const m = level.pieces?.find((p) => p.id === 'marker.spawn');
  return m ? { pos: m.pos.slice(), yaw: m.yaw ?? 0 } : level.spawn;
}

const bad = (id, msg) => {
  throw new Error(`${id}: ${msg}`);
};
const entry = (sys, d) => sys.add('entry', d);
const common = [{ key: 'text', type: 'text' }, { key: 'order', type: 'number', optional: true }, { key: 'limit', type: 'number', optional: true, min: 0.1 }, { key: 'wakeGroup', type: 'text', optional: true }, { key: 'spawnGroup', type: 'text', optional: true }];
const objective = (obj, label, params, own) => ({ example: { params: { text: TEXT[obj], ...params } }, label, fields: [...common, ...own], build: (sys, d) => sys.add('objective', d, obj) });

// `log.line` `on` forms: start | mission:complete | trigger:<id> | checkpoint:<id> | objective:<id> | objective:<id>:done | discovered:<gun>
const LOG_ON = /^(start|mission:complete|(trigger|checkpoint|discovered):[^:]+|objective:[^:]+(:done)?)$/;

// Problem with a `log.line`'s params, or null. Registry.check runs it on every level (meta `check`); Encounter.add throws it. Pure.
export function logLineProblem(p, guns = null) {
  if (typeof p.text !== 'string' || !p.text.trim()) return 'text must be a non-empty string';
  if (typeof p.on !== 'string' || !LOG_ON.test(p.on)) return `on ${JSON.stringify(p.on)} is not one of start, mission:complete, trigger:<id>, checkpoint:<id>, objective:<id>, objective:<id>:done, discovered:<gun>`;
  if (guns && p.on.startsWith('discovered:') && !guns.includes(p.on.slice(11))) return `on ${JSON.stringify(p.on)}: unknown gun (known: ${guns.join(', ')})`;
  if (p.priority != null && p.priority !== 'normal' && p.priority !== 'high') return 'priority must be normal or high';
  if (p.once != null && typeof p.once !== 'boolean') return 'once must be true or false';
  if (p.delay != null && !(typeof p.delay === 'number' && p.delay >= 0)) return 'delay must be a number, at least 0 (seconds)';
  return null;
}

export const ENCOUNTER_PIECES = {
  'marker.spawn': { example: { params: {}, yaw: Math.PI }, label: 'player start (overrides level.spawn)', build: (sys, d) => sys.add('spawn', d) },
  'marker.checkpoint': { example: { params: {} }, label: `respawn point after a death, ${TUNING.checkpointRadius} m reach`, build: (sys, d) => sys.add('checkpoint', d) },
  'marker.entry': { example: { params: { group: 'reinforce', enemies: ['enemy.trooper', 'enemy.trooper'] } }, label: 'reinforcement entry: spawns its listed enemies for its group', fields: [{ key: 'group', type: 'text' }, { key: 'enemies', type: 'list' }], build: entry },
  'zone.interior': { example: { params: { size: [...TUNING.zone] } }, label: 'interior zone: camera exposure up, HUD reads INTERIOR', fields: [{ key: 'size', type: 'vec3', min: 0.1 }], build: (sys, d) => sys.add('zone', d) },
  'trigger.volume': { example: { params: { size: [...TUNING.size], event: 'trigger', once: true } }, label: 'fires an event when the player enters; can wake / spawn a group', fields: [{ key: 'size', type: 'vec3', min: 0.1 }, { key: 'event', type: 'text' }, { key: 'once', type: 'bool', def: true }, { key: 'wakeGroup', type: 'text', optional: true }, { key: 'spawnGroup', type: 'text', optional: true }], build: (sys, d) => sys.add('trigger', d) },
  'objective.reach': objective('reach', 'objective: get the player into the box (or wait for a trigger / checkpoint id)', { size: [...TUNING.size] }, [{ key: 'size', type: 'vec3', min: 0.1 }, { key: 'trigger', type: 'text', optional: true }]),
  'objective.destroy': objective('destroy', 'objective: destroy the enemies of a group (any enemy without group)', { group: 'targets' }, [{ key: 'group', type: 'text', optional: true }, { key: 'count', type: 'number', optional: true, min: 1 }]),
  'objective.survive': objective('survive', 'objective: stay alive for a time', { time: TUNING.survive }, [{ key: 'time', type: 'number', min: 0.1 }]),
  'objective.interact': objective('interact', 'objective: press interact (G) within the radius', { radius: TUNING.radius }, [{ key: 'radius', type: 'number', min: 0.1 }]),
  'log.line': {
    example: { params: { text: '> LINK: NONE. QUERY: WHY?', on: 'start' } },
    label: 'STEM-00 log line, shown when `on` happens (narrative.md)',
    fields: [{ key: 'text', type: 'text' }, { key: 'on', type: 'text' }, { key: 'priority', type: 'enum', options: ['normal', 'high'], optional: true }, { key: 'once', type: 'bool', def: true }, { key: 'delay', type: 'number', optional: true, min: 0 }],
    check: (p, registry) => logLineProblem(p, registry.guns),
    build: (sys, d) => sys.add('log', d),
  },
};

const _right = new THREE.Vector3();

export class Encounter {
  // Permanent: event listeners. Per level (load / unload): the records.
  constructor({ scene, events, registry, enemies, world, mission = null }) {
    Object.assign(this, { scene, events, registry, enemies, world, mission });
    this.items = []; // records: { id, kind, name, pos, yaw, params, gizmo, inside, fired, ... }
    this.checkpoint = null; // { id, pos: [x, y, z], yaw } of the last checkpoint reached (play)
    this.cpRec = null;
    this.triggers = 0;
    this.gizmoMode = false; // set while spawn() builds a gizmo piece
    this.res = null; // gizmo geometry + materials: built with the first gizmo, freed with the last (nothing stays on the GPU in play)
    this.gizmos = 0;
    this.lines = []; // log lines waiting for their delay (play): { t, rec }
    // requests from outside (the mission, tests); the stored fns are permanent
    events.on('encounter:wake', (g) => this.enemies.wakeGroup(g));
    events.on('encounter:spawn', (g) => this.spawnGroup(g));
    // log.line triggers (permanent; they look at the current records)
    events.on('trigger:fired', (e) => this.#log(`trigger:${e.id}`));
    events.on('checkpoint:reached', (e) => this.#log(`checkpoint:${e.id}`));
    events.on('mission:objective', (e) => this.#log(`objective:${e.id}`));
    events.on('mission:objective:done', (e) => this.#log(`objective:${e.id}:done`));
    events.on('weapon:discovered', (e) => this.#log(`discovered:${e.gun}`));
    events.on('mission:complete', () => this.#log('mission:complete'));
  }

  // Queues the log lines waiting for `key` (an `on` value). They are emitted from update, after their delay.
  #log(key) {
    for (const r of this.items) {
      if (r.kind !== 'log' || r.inert || r.params.on !== key || (r.once && r.fired)) continue;
      r.fired = true;
      this.lines.push({ t: r.params.delay ?? 0, rec: r });
    }
  }

  // Builds the encounter pieces of a level (logic only). Unloads the current ones first.
  load(level) {
    this.unload();
    for (const d of this.registry.piecesOf(level, 'encounter')) this.registry.build('encounter', this, d);
    this.#log('start'); // shown from the first update, after the run reset (resetRun clears the Log view)
    this.mission?.start(this.items.filter((r) => r.kind === 'objective' && !r.inert));
    return this;
  }

  unload() {
    for (const r of this.items) {
      this.#dropZone(r);
      this.#dropGizmo(r);
    }
    this.items.length = 0;
    this.lines.length = 0;
    this.checkpoint = this.cpRec = null;
    this.triggers = 0;
    this.mission?.stop();
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
    this.lines = this.lines.filter((l) => l.rec !== rec);
    this.#dropZone(rec);
    this.#dropGizmo(rec);
    if (this.cpRec === rec) this.checkpoint = this.cpRec = null;
  }

  // Builder entry (see ENCOUNTER_PIECES): validates the params, makes the record (and its gizmo).
  add(kind, d, obj) {
    const id = d.id;
    const p = d.params ?? {};
    const rec = { id, kind, name: d.name ?? null, pos: new THREE.Vector3(...d.pos), yaw: d.yaw ?? 0, params: p, gizmo: null, inert: this.gizmoMode, inside: false, fired: false };
    if (kind === 'zone') {
      const size = p.size ?? TUNING.zone;
      if (!Array.isArray(size) || size.length !== 3 || size.some((n) => !(n > 0))) bad(id, 'size must be [w, h, d], all above 0');
      rec.size = size;
      if (!this.gizmoMode) {
        const [w, h, d] = size;
        rec.box = new THREE.Box3(new THREE.Vector3(rec.pos.x - w / 2, rec.pos.y, rec.pos.z - d / 2), new THREE.Vector3(rec.pos.x + w / 2, rec.pos.y + h, rec.pos.z + d / 2));
        this.world.interiorZones.push(rec.box);
      }
    }
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
    if (kind === 'objective') this.#objective(rec, obj, p);
    if (kind === 'log') {
      const problem = logLineProblem(p, this.registry.guns);
      if (problem) bad(id, problem);
      rec.once = p.once ?? true;
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

  // Objective params (see ENCOUNTER_PIECES): validated like the other kinds, kept on the record for Mission.
  #objective(rec, obj, p) {
    const id = rec.id;
    const str = (k) => p[k] !== undefined && typeof p[k] !== 'string' && bad(id, `${k} must be a string`);
    ['text', 'wakeGroup', 'spawnGroup', 'trigger', 'group'].forEach(str);
    if (p.order !== undefined && !(typeof p.order === 'number' && Number.isFinite(p.order))) bad(id, 'order must be a number');
    if (p.limit !== undefined && !(typeof p.limit === 'number' && p.limit > 0)) bad(id, 'limit must be a number above 0 (seconds)');
    rec.obj = obj;
    rec.text = p.text ?? TEXT[obj];
    if (obj === 'reach') {
      const size = p.size ?? TUNING.size;
      if (!Array.isArray(size) || size.length !== 3 || size.some((n) => !(n > 0))) bad(id, 'size must be [w, h, d], all above 0');
      rec.size = size;
    } else if (obj === 'destroy') {
      if (p.count !== undefined && !(Number.isInteger(p.count) && p.count >= 1)) bad(id, 'count must be a whole number, at least 1');
    } else if (obj === 'survive') {
      if (p.time !== undefined && !(typeof p.time === 'number' && p.time > 0)) bad(id, 'time must be a number above 0 (seconds)');
      rec.time = p.time ?? TUNING.survive;
    } else {
      if (p.radius !== undefined && !(typeof p.radius === 'number' && p.radius > 0)) bad(id, 'radius must be a number above 0 (m)');
      rec.radius = p.radius ?? TUNING.radius;
    }
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

  // Play: checkpoints record, trigger volumes fire, then the mission ticks (also while the player is dead: its timers run on).
  // Gizmo pieces (editor) do nothing. interact: the interact intent was pressed this frame.
  update(dt, player, interact = false) {
    if (!player.dead && this.items.length) this.#scan(player);
    this.mission?.update(dt, player, interact);
    if (!this.lines.length) return;
    for (const l of this.lines) if ((l.t -= dt) <= 0) this.events.emit('log:say', { text: l.rec.params.text, priority: l.rec.params.priority ?? 'normal' });
    this.lines = this.lines.filter((l) => l.t > 0);
  }

  #scan(player) {
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

  // an interior zone leaves world.interiorZones with its record (the world may have cleared the list already)
  #dropZone(rec) {
    if (!rec.box) return;
    const i = this.world.interiorZones.indexOf(rec.box);
    if (i >= 0) this.world.interiorZones.splice(i, 1);
    rec.box = null;
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
    g.rotation.y = r.kind === 'trigger' || r.kind === 'zone' || r.obj === 'reach' ? 0 : r.yaw;
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
    if (r.kind === 'trigger' || r.kind === 'zone' || r.obj === 'reach') {
      const [w, h, d] = r.size;
      solidBox([0, h / 2, 0], [w, h, d]);
    } else if (r.obj === 'destroy') {
      solidBox([0, 0.05, 0], [1.4, 0.1, 1.4]); // pad
      solidBox([0, 0.5, 0], [0.5, 0.8, 0.5]); // the target
    } else if (r.obj === 'survive') {
      part(G.box, m.solid, [0, 1, 0], [0.06, 2, 0.06]); // pole
      part(G.ring, m.ring, [0, 0.03, 0], [1, 1, 1]);
      part(G.ring, m.ring, [0, 2, 0], [0.5, 1, 0.5]);
    } else if (r.obj === 'interact') {
      part(G.ring, m.ring, [0, 0.03, 0], [r.radius, 1, r.radius]);
      solidBox([0, 0.55, 0], [0.7, 1.1, 0.4]); // terminal
      part(G.box, m.solid, [0, 0.85, 0.21], [0.5, 0.3, 0.02]); // screen
    } else if (r.kind === 'spawn') {
      solidBox([0, 0.9, 0], [0.6, 1.8, 0.6]);
      part(G.cone, m.solid, [0, 0.1, 0.8], [1, 1, 1]);
    } else if (r.kind === 'log') {
      solidBox([0, 1.2, 0], [0.8, 0.5, 0.06]); // a terminal screen on a post
      part(G.box, m.solid, [-0.2, 1.2, 0.04], [0.3, 0.05, 0.02]); // the prompt line
      part(G.box, m.solid, [0, 0.475, 0], [0.06, 0.95, 0.06]);
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
