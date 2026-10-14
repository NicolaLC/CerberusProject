// Mission framework (#12, instructions/workshop.md "Missions"): an ordered list of objectives, one current at a time.
// Objectives are encounter pieces (`objective.*`, encounter.js): reach a zone, destroy targets, survive, interact with a terminal.
// `Encounter` owns the records and calls start / stop / update; the listeners here are permanent and look at `current`.
// Logic only: no scene objects, nothing to dispose. Events out: `mission:objective` / `mission:objective:done` { index, total, id, kind, text },
// `mission:complete` { total }, `mission:failed` { index, id, reason }. Actions on becoming current: `encounter:wake` / `encounter:spawn`.
// Optional objectives: `skipOn` (a trigger / checkpoint id) completes the current one when it fires, flagged `skipped`.
// Gun conditions (#93, #15): `skipIfOwned: <gun>` completes the objective as skipped, now or any time later, as soon as the player owns the gun (a "find it if you
// have not" step); `requiresGun: <gun>` lets it finish only once the gun is owned (the condition is met, the objective waits: `held`). Both ask `owns(gun)`.
// On done: `grantGun` / `grantAmmo` emit `mission:grant` { gun, ammo } right after `mission:objective:done` (game.js hands it to the Weapon), never when skipped.

import { GUNS } from '../combat/guns.js';

export const TUNING = {
  reach: 2.5, // m, vertical reach of an interact terminal (feet to marker)
  pinLift: 1.5, // m, the HUD objective pin floats this high over the objective's position / the target enemy's
  pinNear: 3, // m, the pin is gone within this distance of a place (reach / interact / action)...
  pinNearEnemy: 8, // m ...and of a destroy target: up close the enemy is the marker
};

const clock = (s) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export class Mission {
  // owns(gun): does the player own that gun (game.js: weapon.owned); a mission without gun conditions never calls it.
  constructor({ events, enemies, owns = () => true }) {
    Object.assign(this, { events, enemies, owns });
    this.promptAt = { x: 0, y: 0, z: 0 }; // reused by interactPrompt
    this.pinAt = { x: 0, y: 0, z: 0, near: 0 }; // reused by pinTarget
    this.held = false; // the current objective's condition is met but its `requiresGun` is not owned yet
    this.objectives = []; // records of the objective pieces, in mission order
    this.index = 0; // of `current` (= objectives.length when complete)
    this.current = null; // record being worked on, null when none / complete / failed
    this.state = 'none'; // 'none' (no objectives) | 'active' | 'complete' | 'failed'
    this.elapsed = 0; // s since the current objective began
    this.progress = 0; // destroy: kills counted
    this.target = 0; // destroy: kills needed (action: moves)
    this.player = null; // last player seen by update (the position test of an action's `size`)
    const fired = (e) => {
      const r = this.current;
      if (!r) return;
      if (r.obj === 'reach' && r.params.trigger != null && r.params.trigger === e.id) this.#complete();
      else if (r.params.skipOn != null && r.params.skipOn === e.id) this.#complete(true); // optional objective: the player moved on without it
    };
    events.on('trigger:fired', fired);
    events.on('checkpoint:reached', fired);
    events.on('cinematic:done', (e) => e?.cut && fired({ id: e.id })); // a reach `trigger` may name a cinematic.cut: done when the cut ends (played or skipped)
    events.on('puppet:down', (a) => {
      const r = this.current;
      if (r?.obj === 'destroy' && this.#matches(r, a) && ++this.progress >= this.target) this.#complete();
    });
    // objective.action: each move counts while the objective is current (and the player is inside its `size`, when it has one)
    const MOVE = { jet: 'player:jet', cover: 'player:coverSlam', vault: 'player:vault', slide: 'player:vault', coverRun: 'player:coverRun' };
    for (const [action, name] of Object.entries(MOVE)) {
      events.on(name, (e) => {
        const r = this.current;
        if (r?.obj !== 'action' || r.params.action !== action || (name === 'player:vault' && e !== (action === 'slide' ? 'slide' : 'hop'))) return;
        if (r.size && !this.#inside(r)) return;
        if (++this.progress >= this.target) this.#complete();
      });
    }
    // objective.action `fire`: a round fired while it is current; with `ammo` ('light' / 'heavy') only from a gun of that ammo class (guns.js)
    events.on('weapon:shot', (e) => {
      const r = this.current;
      if (e.scripted || r?.obj !== 'action' || r.params.action !== 'fire') return; // a cut's scripted round does not count
      const g = GUNS[e.gun];
      if (r.params.ammo != null && (g?.ammo !== r.params.ammo || g.infinite)) return;
      if (r.size && !this.#inside(r)) return;
      if (++this.progress >= this.target) this.#complete();
    });
    events.on('group:spawn', (e) => {
      const r = this.current;
      if (r?.obj === 'destroy' && r.params.count == null && (r.params.group == null || r.params.group === e.group)) this.target += e.count;
    });
  }

  // Level load: the objective records (non-inert), ordered by `order` (else file position among objectives; ties keep file order).
  start(records) {
    this.stop();
    if (!records.length) return;
    this.objectives = records
      .map((r, i) => ({ r, key: r.params.order ?? i }))
      .sort((a, b) => a.key - b.key)
      .map((o) => o.r);
    records.forEach((r, i) => (r.oid = r.name ?? `objective${i}`));
    this.state = 'active';
    this.#begin(0);
  }

  stop() {
    this.objectives = [];
    this.index = 0;
    this.current = null;
    this.state = 'none';
    this.held = false;
    this.elapsed = this.progress = this.target = 0;
  }

  // Every simulated frame (also while the player is dead: timers run on).
  update(dt, player, interact) {
    const r = this.current;
    if (this.state !== 'active' || !r) return;
    this.elapsed += dt;
    this.player = player;
    const p = player.pos;
    if (r.params.skipIfOwned != null && this.owns(r.params.skipIfOwned)) return this.#complete(true);
    if (this.held && this.owns(r.params.requiresGun)) return this.#complete();
    if (r.obj === 'survive') {
      if (this.elapsed >= r.time) this.#complete();
    } else if (r.obj === 'reach' && r.params.trigger == null) {
      const [w, h, d] = r.size;
      if (!player.dead && Math.abs(p.x - r.pos.x) <= w / 2 && Math.abs(p.z - r.pos.z) <= d / 2 && p.y >= r.pos.y - 0.1 && p.y <= r.pos.y + h) this.#complete();
    } else if (r.obj === 'interact' && interact && this.#inReach(r, player)) {
      this.#complete();
    }
    if (this.current === r && r.params.limit != null && this.elapsed >= r.params.limit) {
      this.state = 'failed';
      this.current = null;
      this.events.emit('mission:failed', { index: this.index, id: r.oid, reason: 'time' });
    }
  }

  #inReach(r, player) {
    const p = player.pos;
    const dx = p.x - r.pos.x;
    const dz = p.z - r.pos.z;
    return !player.dead && dx * dx + dz * dz <= r.radius ** 2 && Math.abs(p.y - r.pos.y) < TUNING.reach;
  }

  // The interact prompt while the player stands in reach of the current interact objective, else null: { label (the
  // `prompt` text), at (world point it floats over: `promptAt` or 1.3 m above the objective) }.
  interactPrompt(player) {
    const r = this.current;
    if (this.state !== 'active' || r?.obj !== 'interact' || !this.#inReach(r, player)) return null;
    const a = r.params.promptAt;
    const at = this.promptAt;
    [at.x, at.y, at.z] = a ?? [r.pos.x, r.pos.y + 1.3, r.pos.z];
    return { label: r.params.prompt ?? 'INTERACT', at: this.promptAt };
  }

  // Where the HUD objective pin points (reused object; `near` = distance under which the pin fades out), null when the
  // current objective has no place: survive, a destroy group with nothing alive, no objective / mission over.
  // reach / action / interact: the piece position (interact: its `promptAt` when set); destroy: the nearest alive enemy of its group.
  pinTarget(from) {
    const r = this.current;
    if (this.state !== 'active' || !r || r.obj === 'survive') return null;
    const t = this.pinAt;
    t.near = TUNING.pinNear;
    if (r.obj === 'destroy') {
      let best = Infinity;
      let hit = null;
      for (const a of this.enemies.all) {
        if (!a.alive || !this.#matches(r, a)) continue;
        const d = (a.pos.x - from.x) ** 2 + (a.pos.z - from.z) ** 2;
        if (d < best) {
          best = d;
          hit = a;
        }
      }
      if (!hit) return null;
      t.near = TUNING.pinNearEnemy;
      t.x = hit.pos.x;
      t.y = hit.pos.y + TUNING.pinLift;
      t.z = hit.pos.z;
    } else if (r.obj === 'interact' && r.params.promptAt) [t.x, t.y, t.z] = r.params.promptAt; // array destructuring: no allocation
    else {
      t.x = r.pos.x;
      t.y = r.pos.y + TUNING.pinLift;
      t.z = r.pos.z;
    }
    return t;
  }

  // The HUD state line (state, never instructions), null when the level has no objectives.
  hudText() {
    const p = this.hudPanel();
    return p && (p.prog ? `${p.head}  ${p.prog}` : p.head);
  }

  // The HUD objective panel: { key (changes with the objective / state), head, detail (raw, with input tokens), prog }, null without objectives.
  hudPanel() {
    if (this.state === 'none') return null;
    if (this.state === 'complete') return { key: 'complete', head: 'MISSION COMPLETE', detail: '', prog: '' };
    if (this.state === 'failed') return { key: 'failed', head: 'MISSION FAILED', detail: '', prog: '' };
    const r = this.current;
    const prog = [];
    if (r.params.requiresGun != null && !this.owns(r.params.requiresGun)) prog.push(`${GUNS[r.params.requiresGun].name}: NOT FOUND`);
    if (r.obj === 'destroy' || (r.obj === 'action' && this.target > 1)) prog.push(`${this.progress} / ${this.target}`);
    else if (r.obj === 'survive') prog.push(clock(r.time - this.elapsed));
    if (r.params.limit != null && r.obj !== 'survive') prog.push(clock(r.params.limit - this.elapsed));
    return { key: r.oid, head: r.text.toUpperCase(), detail: r.detail ?? '', prog: prog.join('  ') };
  }

  #info(r, skipped = false) {
    return { index: this.index, total: this.objectives.length, id: r.oid, kind: r.obj, text: r.text, skipped };
  }

  #inside(r) {
    const [w, h, d] = r.size;
    const p = this.player.pos;
    return Math.abs(p.x - r.pos.x) <= w / 2 && Math.abs(p.z - r.pos.z) <= d / 2 && p.y >= r.pos.y - 0.1 && p.y <= r.pos.y + h;
  }

  #matches(r, a) {
    return r.params.group == null || a.squad === r.params.group;
  }

  // Makes objectives[i] current. The destroy target is set before the actions run, so reinforcements it spawns add to it.
  #begin(i) {
    const r = (this.current = this.objectives[(this.index = i)]);
    this.elapsed = this.progress = 0;
    this.held = false;
    this.target = r.obj === 'action' ? r.params.count ?? 1 : r.obj === 'destroy' ? r.params.count ?? this.enemies.all.filter((a) => a.alive && (r.params.group == null || a.squad === r.params.group)).length : 0;
    if (r.params.wakeGroup != null) this.events.emit('encounter:wake', r.params.wakeGroup);
    if (r.params.spawnGroup != null) this.events.emit('encounter:spawn', r.params.spawnGroup);
    this.events.emit('mission:objective', this.#info(r));
    if (r.params.skipIfOwned != null && this.owns(r.params.skipIfOwned)) this.#complete(true); // already owned: nothing to find
    else if (r.obj === 'destroy' && this.target <= 0) this.#complete(); // nothing to destroy: done at once
  }

  // skipped: `skipOn` fired instead of the objective being done (no grantGun then).
  #complete(skipped = false) {
    const r = this.current;
    if (!skipped && r.params.requiresGun != null && !this.owns(r.params.requiresGun)) return void (this.held = true); // done, but waits for the gun
    this.events.emit('mission:objective:done', this.#info(r, skipped));
    if (!skipped && r.params.grantGun != null) this.events.emit('mission:grant', { gun: r.params.grantGun, ammo: r.params.grantAmmo ?? 0 }); // after :done, so its toast (OBJECTIVE COMPLETE) gives way to KR-7 WARDEN ACQUIRED
    if (this.index + 1 < this.objectives.length) return this.#begin(this.index + 1);
    this.current = null;
    this.state = 'complete';
    this.events.emit('mission:complete', { total: this.objectives.length });
  }
}
