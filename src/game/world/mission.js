// Mission framework (#12, instructions/workshop.md "Missions"): an ordered list of objectives, one current at a time.
// Objectives are encounter pieces (`objective.*`, encounter.js): reach a zone, destroy targets, survive, interact with a terminal.
// `Encounter` owns the records and calls start / stop / update; the listeners here are permanent and look at `current`.
// Logic only: no scene objects, nothing to dispose. Events out: `mission:objective` / `mission:objective:done` { index, total, id, kind, text },
// `mission:complete` { total }, `mission:failed` { index, id, reason }. Actions on becoming current: `encounter:wake` / `encounter:spawn`.
// Optional objectives: `skipOn` (a trigger / checkpoint id) completes the current one when it fires, flagged `skipped`.
// On done: `grantGun` / `grantAmmo` emit `mission:grant` { gun, ammo } right after `mission:objective:done` (game.js hands it to the Weapon), never when skipped.

export const TUNING = {
  reach: 2.5, // m, vertical reach of an interact terminal (feet to marker)
};

const clock = (s) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export class Mission {
  constructor({ events, enemies }) {
    Object.assign(this, { events, enemies });
    this.objectives = []; // records of the objective pieces, in mission order
    this.index = 0; // of `current` (= objectives.length when complete)
    this.current = null; // record being worked on, null when none / complete / failed
    this.state = 'none'; // 'none' (no objectives) | 'active' | 'complete' | 'failed'
    this.elapsed = 0; // s since the current objective began
    this.progress = 0; // destroy: kills counted
    this.target = 0; // destroy: kills needed
    const fired = (e) => {
      const r = this.current;
      if (!r) return;
      if (r.obj === 'reach' && r.params.trigger != null && r.params.trigger === e.id) this.#complete();
      else if (r.params.skipOn != null && r.params.skipOn === e.id) this.#complete(true); // optional objective: the player moved on without it
    };
    events.on('trigger:fired', fired);
    events.on('checkpoint:reached', fired);
    events.on('puppet:down', (a) => {
      const r = this.current;
      if (r?.obj === 'destroy' && this.#matches(r, a) && ++this.progress >= this.target) this.#complete();
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
    this.elapsed = this.progress = this.target = 0;
  }

  // Every simulated frame (also while the player is dead: timers run on).
  update(dt, player, interact) {
    const r = this.current;
    if (this.state !== 'active' || !r) return;
    this.elapsed += dt;
    const p = player.pos;
    if (r.obj === 'survive') {
      if (this.elapsed >= r.time) this.#complete();
    } else if (r.obj === 'reach' && r.params.trigger == null) {
      const [w, h, d] = r.size;
      if (!player.dead && Math.abs(p.x - r.pos.x) <= w / 2 && Math.abs(p.z - r.pos.z) <= d / 2 && p.y >= r.pos.y - 0.1 && p.y <= r.pos.y + h) this.#complete();
    } else if (r.obj === 'interact' && interact && !player.dead) {
      const dx = p.x - r.pos.x;
      const dz = p.z - r.pos.z;
      if (dx * dx + dz * dz <= r.radius ** 2 && Math.abs(p.y - r.pos.y) < TUNING.reach) this.#complete();
    }
    if (this.current === r && r.params.limit != null && this.elapsed >= r.params.limit) {
      this.state = 'failed';
      this.current = null;
      this.events.emit('mission:failed', { index: this.index, id: r.oid, reason: 'time' });
    }
  }

  // The HUD state line (state, never instructions), null when the level has no objectives.
  hudText() {
    if (this.state === 'none') return null;
    if (this.state === 'complete') return 'MISSION COMPLETE';
    if (this.state === 'failed') return 'MISSION FAILED';
    const r = this.current;
    let s = r.text.toUpperCase();
    if (r.obj === 'destroy') s += `  ${this.progress} / ${this.target}`;
    else if (r.obj === 'survive') s += `  ${clock(r.time - this.elapsed)}`;
    if (r.params.limit != null && r.obj !== 'survive') s += `  ${clock(r.params.limit - this.elapsed)}`;
    return s;
  }

  #info(r, skipped = false) {
    return { index: this.index, total: this.objectives.length, id: r.oid, kind: r.obj, text: r.text, skipped };
  }

  #matches(r, a) {
    return r.params.group == null || a.squad === r.params.group;
  }

  // Makes objectives[i] current. The destroy target is set before the actions run, so reinforcements it spawns add to it.
  #begin(i) {
    const r = (this.current = this.objectives[(this.index = i)]);
    this.elapsed = this.progress = 0;
    this.target = r.obj === 'destroy' ? r.params.count ?? this.enemies.all.filter((a) => a.alive && (r.params.group == null || a.squad === r.params.group)).length : 0;
    if (r.params.wakeGroup != null) this.events.emit('encounter:wake', r.params.wakeGroup);
    if (r.params.spawnGroup != null) this.events.emit('encounter:spawn', r.params.spawnGroup);
    this.events.emit('mission:objective', this.#info(r));
    if (r.obj === 'destroy' && this.target <= 0) this.#complete(); // nothing to destroy: done at once
  }

  // skipped: `skipOn` fired instead of the objective being done (no grantGun then).
  #complete(skipped = false) {
    const r = this.current;
    this.events.emit('mission:objective:done', this.#info(r, skipped));
    if (!skipped && r.params.grantGun != null) this.events.emit('mission:grant', { gun: r.params.grantGun, ammo: r.params.grantAmmo ?? 0 }); // after :done, so its toast (OBJECTIVE COMPLETE) gives way to KR-7 WARDEN ACQUIRED
    if (this.index + 1 < this.objectives.length) return this.#begin(this.index + 1);
    this.current = null;
    this.state = 'complete';
    this.events.emit('mission:complete', { total: this.objectives.length });
  }
}
