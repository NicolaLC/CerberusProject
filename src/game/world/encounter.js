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
//                     Never in a fight: a fired line waits until STEM-00 has been out of combat for TUNING.calm s, `delay` counts from then.
//  intro.boot         the boot intro (#13): params { lines: [diagnostic strings], duration? (s, 12, max 20), skippable? (true) }. At the first play frame
//                     it emits `intro:start` { lines, duration, skippable }; the Boot view (view/boot.js) covers the screen, locks the input and
//                     emits `intro:done` { skipped } when it ends. The first one in the file plays. Inert in the editor and the Library (gizmo only).
//  env.alarm          the alarm lighting state (#14, workshop.md "Alarm"): params { on, off?, duration?, color? ('#ff2a1a'), strength? (0.75), siren? (true) }.
//                     When `on` happens (same forms as log.line) it emits `alarm:on` { id, color, strength, siren }: World tints the light toward `color`
//                     and pulses it (world.setAlarm), Audio loops a synthesized siren. Ends at `off`, after `duration` s, or when the level unloads (`alarm:off` / `alarm:clear`).
//                     Inert in the editor and the Library (gizmo: a beacon on a post).
// Events out: `trigger:fired` { id, event }, `checkpoint:reached` { id, pos, yaw }, `group:wake` { group } (Enemies),
// `group:spawn` { group, count }, `log:say` { text, priority, voice }, `alarm:on` { id, color, strength, siren }, `alarm:off` { id }, `alarm:clear`, `intro:start` { lines, duration, skippable }. Events in (the mission, mission.js; tests): `encounter:wake` group, `encounter:spawn` group.

export const TUNING = {
  checkpointRadius: 2, // m, horizontal reach of a checkpoint
  checkpointReach: 2.5, // m, vertical reach (feet to marker)
  spread: 1.5, // m between reinforcements side by side
  size: [4, 3, 4], // default trigger volume
  zone: [8, 4, 8], // example interior zone
  survive: 30, // s, default survive time
  radius: 2, // m, default interact radius
  combatRange: 30, // m: an awake enemy this close means STEM-00 is in combat (log lines wait)
  calm: 3, // s without combat (no awake enemy in range, no shot fired, no hit taken) before a log line may play
};

const COLOR = { spawn: 0x58ff9a, checkpoint: 0x3affff, entry: 0xff7a3a, trigger: 0xff4bd6, zone: 0x4aa8ff, objective: 0xffd23a, log: 0xffb347, alarm: 0xff3a2a, intro: 0xeaf6fa };
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

// `log.line` `on` forms: start | intro:done | mission:complete | trigger:<id> | checkpoint:<id> | objective:<id> | objective:<id>:done | discovered:<gun>
const LOG_ON = /^(start|intro:done|mission:complete|(trigger|checkpoint|discovered):[^:]+|objective:[^:]+(:done)?)$/;

// Problem with a `log.line`'s params, or null. Registry.check runs it on every level (meta `check`); Encounter.add throws it. Pure.
export function logLineProblem(p, guns = null) {
  if (typeof p.text !== 'string' || !p.text.trim()) return 'text must be a non-empty string';
  if (typeof p.on !== 'string' || !LOG_ON.test(p.on)) return `on ${JSON.stringify(p.on)} is not one of start, intro:done, mission:complete, trigger:<id>, checkpoint:<id>, objective:<id>, objective:<id>:done, discovered:<gun>`;
  if (guns && p.on.startsWith('discovered:') && !guns.includes(p.on.slice(11))) return `on ${JSON.stringify(p.on)}: unknown gun (known: ${guns.join(', ')})`;
  if (p.priority != null && p.priority !== 'normal' && p.priority !== 'high') return 'priority must be normal or high';
  if (p.once != null && typeof p.once !== 'boolean') return 'once must be true or false';
  if (p.voice != null && !VOICES.includes(p.voice)) return `voice must be one of ${VOICES.join(', ')}`;
  if (p.delay != null && !(typeof p.delay === 'number' && p.delay >= 0)) return 'delay must be a number, at least 0 (seconds)';
  return null;
}

// `voice` of a log line: whose line it is. 'stem' = STEM-00's terminal (waits for calm), 'announcer' = the HiveMind PA (shown at once, replaces the line).
export const VOICES = ['stem', 'announcer'];
export const ALARM_DEFAULT = { color: '#ff2a1a', strength: 0.75 };

// Problem with an `env.alarm`'s params, or null. Registry.check runs it on every level (meta `check`); Encounter.add throws it. Pure.
export function alarmProblem(p, guns = null) {
  const on = (k) => typeof p[k] === 'string' && LOG_ON.test(p[k]);
  if (!on('on')) return `on ${JSON.stringify(p.on)} is not one of start, intro:done, mission:complete, trigger:<id>, checkpoint:<id>, objective:<id>, objective:<id>:done, discovered:<gun>`;
  if (p.off != null && !on('off')) return `off ${JSON.stringify(p.off)} is not an \`on\` form (see on)`;
  for (const k of ['on', 'off']) if (guns && typeof p[k] === 'string' && p[k].startsWith('discovered:') && !guns.includes(p[k].slice(11))) return `${k} ${JSON.stringify(p[k])}: unknown gun (known: ${guns.join(', ')})`;
  if (p.duration != null && !(typeof p.duration === 'number' && p.duration > 0)) return 'duration must be a number above 0 (seconds)';
  if (p.color != null && !(typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color))) return 'color must be #rrggbb';
  if (p.strength != null && !(typeof p.strength === 'number' && p.strength > 0 && p.strength <= 1)) return 'strength must be a number above 0, at most 1';
  if (p.siren != null && typeof p.siren !== 'boolean') return 'siren must be true or false';
  return null;
}

export const INTRO = { duration: 12, max: 20 }; // s, default / longest `intro.boot`

// Problem with an `intro.boot`'s params, or null. Registry.check runs it on every level (meta `check`); Encounter.add throws it. Pure.
export function introBootProblem(p) {
  if (!Array.isArray(p.lines) || !p.lines.length || p.lines.some((l) => typeof l !== 'string' || !l.trim())) return 'lines must be a non-empty list of non-empty strings';
  if (p.duration != null && !(typeof p.duration === 'number' && p.duration > 0 && p.duration <= INTRO.max)) return `duration must be a number above 0, at most ${INTRO.max} (seconds)`;
  if (p.skippable != null && typeof p.skippable !== 'boolean') return 'skippable must be true or false';
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
    fields: [{ key: 'text', type: 'text' }, { key: 'on', type: 'text' }, { key: 'priority', type: 'enum', options: ['normal', 'high'], optional: true }, { key: 'once', type: 'bool', def: true }, { key: 'voice', type: 'enum', options: VOICES, optional: true }, { key: 'delay', type: 'number', optional: true, min: 0 }],
    check: (p, registry) => logLineProblem(p, registry.guns),
    build: (sys, d) => sys.add('log', d),
  },
  'env.alarm': {
    example: { params: { on: 'start', duration: 6 } },
    label: 'alarm lighting state + siren when `on` happens: light fades to red and pulses; ends at `off` / `duration`',
    fields: [{ key: 'on', type: 'text' }, { key: 'off', type: 'text', optional: true }, { key: 'duration', type: 'number', optional: true, min: 0.1 }, { key: 'color', type: 'text', optional: true }, { key: 'strength', type: 'number', optional: true, min: 0.05 }, { key: 'siren', type: 'bool', def: true }],
    check: (p, registry) => alarmProblem(p, registry.guns),
    build: (sys, d) => sys.add('alarm', d),
  },
  'intro.boot': {
    example: { params: { lines: ['> STEM-00 BOOT SEQUENCE', '> OPTICS: ONLINE', 'HIVEMIND LINK: LOST'], duration: INTRO.duration, skippable: true } },
    label: `boot intro at play start: typed diagnostics, fade in; locks input (default ${INTRO.duration} s, max ${INTRO.max})`,
    fields: [{ key: 'lines', type: 'list', sep: '|' }, { key: 'duration', type: 'number', optional: true, min: 0.1 }, { key: 'skippable', type: 'bool', def: true }],
    check: (p) => introBootProblem(p),
    build: (sys, d) => sys.add('intro', d),
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
    this.lines = []; // log lines waiting for calm and their delay (play): { t, rec }
    this.calm = TUNING.calm; // s since the last combat signal (a run starts calm)
    this.introPending = null; // the intro.boot record that starts at the first play frame
    this.alarmQueue = []; // env.alarm records whose `on` / `off` happened, handled at the next update: { rec, on }
    this.alarms = []; // env.alarm records running: { rec, t } (t = s left, Infinity without duration)
    // requests from outside (the mission, tests); the stored fns are permanent
    events.on('encounter:wake', (g) => this.enemies.wakeGroup(g));
    events.on('encounter:spawn', (g) => this.spawnGroup(g));
    // log.line triggers (permanent; they look at the current records)
    events.on('trigger:fired', (e) => this.#log(`trigger:${e.id}`));
    events.on('checkpoint:reached', (e) => this.#log(`checkpoint:${e.id}`));
    events.on('mission:objective', (e) => this.#log(`objective:${e.id}`));
    events.on('mission:objective:done', (e) => this.#log(`objective:${e.id}:done`));
    events.on('weapon:discovered', (e) => this.#log(`discovered:${e.gun}`));
    events.on('intro:done', () => this.#log('intro:done'));
    events.on('mission:complete', () => this.#log('mission:complete'));
    events.on('weapon:shot', () => (this.calm = 0));
    events.on('player:hurt', () => (this.calm = 0));
  }

  // Queues the log lines waiting for `key` (an `on` value). They are emitted from update, after their delay.
  #log(key) {
    for (const r of this.items) {
      if (r.kind !== 'log' || r.inert || r.params.on !== key || (r.once && r.fired)) continue;
      r.fired = true;
      this.lines.push({ t: r.params.delay ?? 0, rec: r });
    }
    for (const r of this.items) {
      if (r.kind !== 'alarm' || r.inert) continue;
      if (r.params.off === key) this.alarmQueue.push({ rec: r, on: false });
      if (r.params.on === key && !r.fired) {
        r.fired = true;
        this.alarmQueue.push({ rec: r, on: true });
      }
    }
  }

  // Builds the encounter pieces of a level (logic only). Unloads the current ones first.
  load(level) {
    this.unload();
    for (const d of this.registry.piecesOf(level, 'encounter')) this.registry.build('encounter', this, d);
    this.#log('start'); // shown from the first update, after the run reset (resetRun clears the Log view)
    this.introPending = this.items.find((r) => r.kind === 'intro' && !r.inert) ?? null; // starts at the first update, after the reset
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
    this.alarmQueue.length = 0;
    this.alarms.length = 0;
    this.events.emit('alarm:clear');
    this.introPending = null;
    this.calm = TUNING.calm;
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
    this.alarmQueue = this.alarmQueue.filter((a) => a.rec !== rec);
    if (this.alarms.some((a) => a.rec === rec)) this.#alarmOff(rec);
    if (this.introPending === rec) this.introPending = null;
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
    if (kind === 'alarm') {
      const problem = alarmProblem(p, this.registry.guns);
      if (problem) bad(id, problem);
    }
    if (kind === 'intro') {
      const problem = introBootProblem(p);
      if (problem) bad(id, problem);
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
    if (this.introPending) {
      const p = this.introPending.params;
      this.introPending = null;
      this.events.emit('intro:start', { lines: p.lines.slice(), duration: p.duration ?? INTRO.duration, skippable: p.skippable ?? true });
    }
    this.#alarms(dt);
    if (!player.dead && this.items.length) this.#scan(player);
    this.mission?.update(dt, player, interact);
    // log lines: you either fight or read, so they wait while an awake enemy is near, and for TUNING.calm s after any shot or hit
    const r2 = TUNING.combatRange ** 2;
    if (this.enemies.all.some((a) => a.alive && a.awake && a.pos.distanceToSquared(player.pos) < r2)) this.calm = 0;
    else this.calm += dt;
    if (!this.lines.length) return;
    const calm = this.calm >= TUNING.calm;
    const due = [];
    for (const l of this.lines) {
      const ann = l.rec.params.voice === 'announcer'; // the HiveMind PA does not wait for a quiet moment
      if ((calm || ann) && (l.t -= dt) <= 0) due.push(l);
    }
    if (!due.length) return;
    this.lines = this.lines.filter((l) => !due.includes(l));
    for (const l of due) {
      const { text, priority, voice } = l.rec.params;
      this.events.emit('log:say', { text, priority: priority ?? (voice === 'announcer' ? 'high' : 'normal'), voice: voice ?? 'stem' });
    }
  }

  // env.alarm: start / stop the queued alarms and run the `duration` timers.
  #alarms(dt) {
    for (const { rec, on } of this.alarmQueue.splice(0)) {
      if (!on) this.#alarmOff(rec);
      else if (!this.alarms.some((a) => a.rec === rec)) {
        const p = rec.params;
        this.alarms.push({ rec, t: p.duration ?? Infinity });
        this.events.emit('alarm:on', { id: rec.name ?? 'alarm', color: p.color ?? ALARM_DEFAULT.color, strength: p.strength ?? ALARM_DEFAULT.strength, siren: p.siren ?? true });
      }
    }
    for (const a of this.alarms.slice()) if ((a.t -= dt) <= 0) this.#alarmOff(a.rec);
  }

  #alarmOff(rec) {
    const i = this.alarms.findIndex((a) => a.rec === rec);
    if (i < 0) return;
    this.alarms.splice(i, 1);
    this.events.emit('alarm:off', { id: rec.name ?? 'alarm', active: this.alarms.length }); // `active`: alarms still running (the lighting stays while > 0)
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
    } else if (r.kind === 'alarm') {
      part(G.box, m.solid, [0, 0.475, 0], [0.06, 0.95, 0.06]); // a beacon on a post
      part(G.box, m.solid, [0, 1.05, 0], [0.4, 0.2, 0.4]);
      part(G.ring, m.ring, [0, 1.05, 0], [0.6, 1, 0.6]);
    } else if (r.kind === 'intro') {
      solidBox([0, 1.3, 0], [1.2, 0.7, 0.06]); // a monitor on a post, three text bars
      for (const [y, w] of [[1.5, 0.7], [1.3, 0.5], [1.1, 0.6]]) part(G.box, m.solid, [(w - 0.9) / 2, y, 0.04], [w, 0.05, 0.02]);
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
