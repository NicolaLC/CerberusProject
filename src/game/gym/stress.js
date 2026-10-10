import * as THREE from 'three';
import { disposeTree } from '../../engine/dispose.js';

// Gym tool: Performance stress room (#67, instructions/gym.md). A panel spawns N of each kind through the
// registry builders (the same ids as level files) and reports what they cost: frame time, draw calls, triangles,
// geometries, textures, lights. The player is invisible to the enemies (`enemies.demo`), so the room measures
// rendering and update cost, not combat.
// Keys: [ and ] step the selected count down / up (Shift: 4 at a time), P runs the automatic sweep.

const TUNING = {
  max: 64, // slider range per kind
  refresh: 0.25, // s between readout updates
  samples: 120, // frame times kept for avg / p95
  settle: 0.6, // s after a sweep step before sampling (shader compiles, first uploads)
  hold: 1.2, // s sampled per sweep step
  sweep: [0, 4, 8, 16, 32, 64],
  burstEvery: 0.5, // s between effect bursts while the fx count is above 0
};

// One spawn kind: registry id + params (null for fx, which is no piece), ring band (radius of the first ring) and height.
const KINDS = [
  { key: 'puppets', label: 'Puppets', id: 'enemy.static', r0: 5, y: 0 },
  { key: 'troopers', label: 'Troopers', id: 'enemy.trooper', r0: 11, y: 0 },
  { key: 'drones', label: 'Drones', id: 'enemy.drone', r0: 16, y: 0 },
  { key: 'lights', label: 'Point lights', id: 'light.point', r0: 21, y: 4, params: { color: '#ffd8a0', intensity: 12, distance: 10 } },
  { key: 'fx', label: 'Effect bursts / s', id: null, r0: 8, y: 0.2 },
];

const GAP = 1.7; // m between neighbours on a ring
const RING_STEP = 1.7; // m between rings
const _p = new THREE.Vector3();
const _n = new THREE.Vector3(0, 1, 0);
const BLAST = { point: _p, radius: 4, kind: 'drone' };

// Position of the i-th unit of a kind: concentric rings around the centre, each as full as the spacing allows.
// Deterministic, so the same count always costs the same.
export function ringSlot(i, r0) {
  let r = r0;
  let left = i;
  for (;;) {
    const cap = Math.floor((2 * Math.PI * r) / GAP);
    if (left < cap) {
      const a = (left / cap) * Math.PI * 2 + r * 0.7;
      return [Math.sin(a) * r, Math.cos(a) * r];
    }
    left -= cap;
    r += RING_STEP;
  }
}

export class StressTool {
  constructor(game, level) {
    this.game = game;
    this.level = level;
    this.units = Object.fromEntries(KINDS.map((k) => [k.key, []])); // spawned actors / lights per kind
    this.counts = Object.fromEntries(KINDS.map((k) => [k.key, 0]));
    this.selected = 0;
    this.burstT = 0;
    this.burstN = 0;
    this.sweep = null; // { steps, i, t, phase } while running
    this.results = []; // finished sweep rows
    this.frames = new Float32Array(TUNING.samples); // frame time ring buffer (ms)
    this.sorted = new Float32Array(TUNING.samples);
    this.frameN = 0;
    this.last = 0;
    this.refreshT = 0;
    this.stats = { avg: 0, p95: 0 };
    game.enemies.demo = true; // enemies see a dead player: no waking, aiming or firing

    this.#buildPanel();
    this.onKey = (e) => this.#key(e);
    window.addEventListener('keydown', this.onKey);
  }

  // ---- spawning ----

  // Sets the number of units of a kind (spawns or frees the difference).
  setCount(key, n) {
    const kind = KINDS.find((k) => k.key === key);
    n = Math.max(0, Math.min(TUNING.max, Math.round(n)));
    if (key === 'fx' && !this.counts.fx) this.burstT = 0; // first burst on the next frame
    this.counts[key] = n;
    const list = this.units[key];
    if (kind.id) {
      while (list.length < n) list.push(this.#spawn(kind, list.length));
      while (list.length > n) this.#free(kind, list.pop());
    }
    this.#syncPanel();
    return n;
  }

  // Frees everything the tool spawned and drops the particles and decals still in flight.
  clear() {
    for (const k of KINDS) this.setCount(k.key, 0);
    this.game.fx.reset();
  }

  #spawn(kind, i) {
    const { world, enemies, registry } = this.game;
    const [x, z] = ringSlot(i, kind.r0);
    const data = { id: kind.id, pos: [x, kind.y, z], yaw: Math.atan2(-x, -z), params: kind.params ?? {} };
    // spawned lights are the tool's own list (World.lights would free them at unload as well, but a tool that
    // adds something must also remove it)
    if (kind.key === 'lights') return registry.build('world', world, data);
    return enemies.spawn(data);
  }

  #free(kind, unit) {
    const { world, enemies } = this.game;
    if (kind.key === 'lights') {
      const i = world.lights.indexOf(unit);
      if (i >= 0) world.lights.splice(i, 1);
      disposeTree(unit);
    } else enemies.despawn(unit);
  }

  // Blows up every living spawned enemy: debris, sparks and smoke cost, from a full scene.
  destroyAll() {
    const dir = new THREE.Vector3(0, 0.3, -1).normalize();
    let n = 0;
    for (const list of [this.units.puppets, this.units.troopers, this.units.drones]) {
      for (const e of list) if (e.alive && e.damage(1e6, e.pos, dir, 'body')) n++;
    }
    return n;
  }

  // Effects in the "fx" kind: N blasts per burst (sparks, smoke, shockwave ring), spread on a ring.
  #burst() {
    const { events } = this.game.engine;
    const n = this.counts.fx;
    for (let i = 0; i < n; i++) {
      const [x, z] = ringSlot(this.burstN++ % 48, 8);
      _p.set(x, 0.2, z);
      events.emit('blast', BLAST);
    }
  }

  // ---- sweep ----

  startSweep() {
    this.clear();
    const steps = [];
    for (const k of KINDS) for (const n of TUNING.sweep) steps.push({ key: k.key, n });
    this.sweep = { steps, i: 0, t: 0, phase: 'settle' };
    this.results = [];
    this.#applyStep();
  }

  #applyStep() {
    const s = this.sweep.steps[this.sweep.i];
    this.clear();
    this.setCount(s.key, s.n);
    this.burstT = 0;
    this.sweep.t = 0;
    this.sweep.phase = 'settle';
    this.frameN = 0;
  }

  #updateSweep(dt) {
    const sw = this.sweep;
    sw.t += dt;
    if (sw.phase === 'settle' && sw.t >= TUNING.settle) {
      sw.phase = 'hold';
      sw.t = 0;
      this.frameN = 0; // sample from here on
    } else if (sw.phase === 'hold' && sw.t >= TUNING.hold) {
      const s = sw.steps[sw.i];
      this.#measure();
      this.results.push({ kind: s.key, n: s.n, ...this.reading });
      if (++sw.i >= sw.steps.length) {
        this.sweep = null;
        this.clear();
        console.table(this.results);
      } else this.#applyStep();
    }
  }

  // ---- readout ----

  // What the renderer reports for the last frame (info accumulates over the whole frame, all post passes).
  #measure() {
    const { engine, world } = this.game;
    const { render, memory } = engine.renderer.info;
    const n = Math.min(this.frameN, TUNING.samples);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.frames[i];
    this.stats.avg = n ? sum / n : 0;
    if (n) {
      const s = this.sorted.subarray(0, n);
      s.set(this.frames.subarray(0, n));
      s.sort();
      this.stats.p95 = s[Math.min(n - 1, Math.floor(n * 0.95))];
    } else this.stats.p95 = 0;
    this.reading = {
      avgMs: +this.stats.avg.toFixed(2),
      p95Ms: +this.stats.p95.toFixed(2),
      draws: render.calls,
      tris: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      lights: world.lights.length,
    };
    return this.reading;
  }

  // ---- frame ----

  update(dt) {
    const now = performance.now();
    if (this.last) {
      this.frames[this.frameN % TUNING.samples] = now - this.last;
      this.frameN++;
    }
    this.last = now;
    if (this.counts.fx > 0 && (this.burstT -= dt) <= 0) {
      this.burstT = TUNING.burstEvery;
      this.#burst();
    }
    if (this.sweep) this.#updateSweep(dt);
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = TUNING.refresh;
      this.#measure();
      this.#showReadout();
    }
  }

  // ---- panel ----

  #buildPanel() {
    const el = (this.el = document.createElement('div'));
    el.id = 'stress-panel';
    el.style.cssText =
      'position:fixed;left:8px;top:48px;z-index:40;width:250px;padding:8px 10px;font:11px/1.5 var(--font-main),monospace;' +
      'color:#9fe8ff;background:rgba(0,10,20,0.72);border:1px solid rgba(58,192,255,0.35);pointer-events:auto;user-select:none';
    el.innerHTML = '<b style="letter-spacing:2px">STRESS</b> <span style="opacity:.6">[ ] step · P sweep</span>';
    this.rows = KINDS.map((k, i) => {
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:96px 1fr 28px;gap:6px;align-items:center;cursor:pointer;margin-top:3px';
      const name = document.createElement('span');
      name.textContent = k.label;
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = TUNING.max;
      slider.value = 0;
      slider.oninput = () => this.setCount(k.key, +slider.value);
      slider.onfocus = row.onclick = () => this.#select(i);
      const out = document.createElement('output');
      out.textContent = '0';
      row.append(name, slider, out);
      el.append(row);
      return { row, slider, out };
    });
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:6px;margin-top:6px';
    for (const [label, fn] of [
      ['Destroy', () => this.destroyAll()],
      ['Clear', () => this.clear()],
      ['Sweep', () => this.startSweep()],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'flex:1;font:inherit;color:#9fe8ff;background:transparent;border:1px solid rgba(58,192,255,0.4);cursor:pointer';
      b.onclick = fn;
      buttons.append(b);
    }
    this.readout = document.createElement('div');
    this.readout.style.cssText = 'white-space:pre;margin-top:6px';
    el.append(buttons, this.readout);
    document.body.appendChild(el);
    this.#select(0);
  }

  #select(i) {
    this.selected = i;
    this.rows.forEach((r, j) => (r.row.style.color = j === i ? '#ffd23a' : ''));
  }

  #syncPanel() {
    KINDS.forEach((k, i) => {
      const r = this.rows[i];
      if (+r.slider.value !== this.counts[k.key]) r.slider.value = this.counts[k.key];
      r.out.textContent = this.counts[k.key];
    });
  }

  #showReadout() {
    const r = this.reading;
    const sw = this.sweep ? `\nSWEEP ${this.sweep.i + 1}/${this.sweep.steps.length} ${this.sweep.steps[this.sweep.i].key} ${this.sweep.steps[this.sweep.i].n}` : '';
    const text =
      `frame ${r.avgMs} ms avg · ${r.p95Ms} p95\n` +
      `${r.draws} draws · ${(r.tris / 1000).toFixed(1)}k tris\n` +
      `${r.geometries} geometries · ${r.textures} textures · ${r.lights} lights${sw}`;
    if (this.readout.textContent !== text) this.readout.textContent = text;
  }

  #key(e) {
    const k = KINDS[this.selected];
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      const step = (e.code === 'BracketRight' ? 1 : -1) * (e.shiftKey ? 4 : 1);
      this.sweep = null; // manual control cancels a running sweep
      this.setCount(k.key, this.counts[k.key] + step);
    } else if (e.code === 'KeyP' && !e.repeat) this.startSweep();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.sweep = null;
    this.clear();
    this.el.remove();
    this.game.enemies.demo = false;
  }
}
