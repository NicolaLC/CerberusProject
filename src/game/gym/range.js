import * as THREE from 'three';
import { GUNS } from '../combat/guns.js';
import { falloff } from '../combat/ballistics.js';
import { disposeTree } from '../../engine/dispose.js';

// Gym tool: Weapon range room (#65), see instructions/gym.md. Readouts for gunplay tuning:
//   - a panel (top left): the gun's falloff and spread numbers, the last hit against what guns.js says it should be;
//   - the last damage number over every dummy (DOM labels, projected each frame);
//   - two floor strips at the gun's falloff start (green) and end (red), measured from the firing line (z = 0);
//   - impact dots on the recoil wall (coloured by the shot's place in the burst) that persist until cleared.
// Keys: B clears the recoil dots, N toggles the readouts, M resets the dummies' readouts.
// The dummies take hits and show damage but never die: their `damage` is wrapped (see #immortal).

const FIRING_LINE = 0; // z of the firing line: distances on the floor are measured from here
const DOT_MAX = 400; // instanced impact dots; the oldest are overwritten
const DOT_SIZE = 0.12;
const STRIP = { thickness: 0.6, y: 0.04 };

const ZONE_MULT = { weak: 'weakMult', head: 'headMult', limb: 'limbMult' };
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

// cone diameter (cm) at `dist` m of a half-angle `rad`
const coneCm = (rad, dist = 10) => 2 * dist * Math.tan(rad) * 100;

export class RangeTool {
  // shown in the key bar (view/keyhints.js) whatever the panel's state
  static KEYS = [['B', 'clear recoil dots'], ['N', 'panel and labels'], ['M', 'reset dummy readouts']];

  constructor(game, level) {
    this.game = game;
    this.level = level;
    const { engine } = game;
    this.scene = engine.scene;
    this.camera = engine.camera;
    this.gun = null; // gun the strips / panel currently show
    this.shown = true;
    this.lastHit = null; // { gun, distance, amount, expected, zone, crit }
    this.target = null; // dummy whose damage() is running right now (set by the wrapper, read by the hit event)
    this.readouts = new Map(); // dummy -> { el, amount, hits, crit }

    // lane geometry and the recoil wall come from the level file (named pieces), nothing is duplicated here
    const named = (n) => level.pieces.find((p) => p.name === n);
    const floor = named('range.floor');
    this.laneX = floor.pos[0];
    this.laneW = floor.params.size[0];
    const wall = named('range.recoilWall');
    const [w, h, d] = wall.params.size;
    this.wall = { minX: wall.pos[0] - w / 2, maxX: wall.pos[0] + w / 2, maxY: wall.pos[1] + h, face: wall.pos[2] + d / 2 };

    this.dummies = game.enemies.puppets.filter((p) => p.kind === 'static');
    for (const p of this.dummies) this.#immortal(p);

    this.#buildStrips();
    this.#buildDots();
    this.#buildDom();

    const { events } = engine;
    this.off = [
      events.on('weapon:hit', (h) => this.#onHit(h)),
      events.on('weapon:impact', (i) => this.#onImpact(i)),
    ];
    this.onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyB') this.clearDots();
      else if (e.code === 'KeyN') this.toggle();
      else if (e.code === 'KeyM') this.resetDummies();
    };
    addEventListener('keydown', this.onKey);
    this.#showGun();
  }

  // The dummies must show damage, not die. A round that would kill (sniper 110, railgun 100 on 100 hp) leaves no
  // room for "restore the health after the hit": the body is already destroyed by then. So the instance's
  // damage() is wrapped: it runs the real one (flash, hit reaction, event) with unlimited health, then puts the
  // health back. No change to the enemy code; dispose() removes the wrapper.
  #immortal(p) {
    const real = p.damage;
    p.damage = (...args) => {
      this.target = p;
      p.health = Infinity;
      real.apply(p, args);
      p.health = p.maxHealth;
      return false;
    };
  }

  #buildStrips() {
    const geo = new THREE.BoxGeometry(this.laneW - 0.2, 0.02, STRIP.thickness);
    const mat = (color) => new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.strips = {
      start: new THREE.Mesh(geo, mat(0x3cff6a)),
      end: new THREE.Mesh(geo, mat(0xff3b30)),
    };
    for (const s of Object.values(this.strips)) {
      s.position.set(this.laneX, STRIP.y, 0);
      s.visible = false;
      s.frustumCulled = false;
      this.scene.add(s);
    }
  }

  #buildDots() {
    const geo = new THREE.CircleGeometry(DOT_SIZE / 2, 10);
    const mat = new THREE.MeshBasicMaterial({ polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.dots = new THREE.InstancedMesh(geo, mat, DOT_MAX);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.dots.setColorAt(0, _c.setHex(0xffffff)); // allocates the color buffer
    this.scene.add(this.dots);
    this.dotNext = 0; // ring cursor
    this.dotTotal = 0;
  }

  #buildDom() {
    const hud = document.getElementById('hud') ?? document.body;
    this.panel = document.createElement('div');
    this.panel.id = 'range-panel';
    this.panel.style.cssText =
      'position:absolute;left:18px;top:56px;padding:8px 10px;white-space:pre;font:12px/1.45 monospace;color:#cfe8ff;' +
      'background:rgba(0,12,24,0.62);border-left:3px solid #3ac0ff;pointer-events:none;text-shadow:0 0 3px #000';
    this.labels = document.createElement('div');
    this.labels.id = 'range-targets';
    this.labels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden';
    hud.append(this.panel, this.labels);
    this.panelText = '';
  }

  // ---- events ----

  #onHit(h) {
    const t = GUNS[this.game.weapon.current];
    const mult = (ZONE_MULT[h.zone] ? t[ZONE_MULT[h.zone]] : 1) * (this.game.weapon.boosted ? 1.25 : 1);
    this.lastHit = {
      gun: this.game.weapon.current,
      distance: h.distance,
      amount: h.amount,
      expected: t.damage * mult * falloff(t.falloff, h.distance),
      zone: h.zone,
      crit: h.crit,
    };
    const d = this.target;
    this.target = null;
    if (!d) return;
    const r = this.readouts.get(d) ?? this.#addReadout(d);
    r.amount = h.amount;
    r.crit = h.crit;
    r.zone = h.zone;
    r.hits++;
    r.el.textContent = `${Math.round(h.amount)}${h.crit ? '!' : ''}`;
    r.el.style.color = h.zone === 'weak' ? '#ff6af0' : h.crit ? '#ffd23a' : '#fff';
  }

  #addReadout(d) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;left:0;top:0;font:700 15px monospace;text-shadow:0 0 3px #000,0 0 6px #000;transform:translate(-50%,-100%);display:none';
    this.labels.appendChild(el);
    const r = { el, amount: 0, crit: false, zone: '', hits: 0 };
    this.readouts.set(d, r);
    return r;
  }

  #onImpact(i) {
    const w = this.wall;
    const { x, y, z } = i.point;
    if (Math.abs(z - w.face) > 0.03 || x < w.minX || x > w.maxX || y < 0 || y > w.maxY) return;
    const idx = Math.max(0, this.game.weapon.burst - 1); // burst++ runs just before the hit
    _m.makeTranslation(x, y, w.face + 0.012);
    this.dots.setMatrixAt(this.dotNext, _m);
    this.dots.setColorAt(this.dotNext, _c.setHSL(0.16 * (1 - Math.min(idx, 24) / 24), 1, 0.5)); // yellow -> red
    this.dotNext = (this.dotNext + 1) % DOT_MAX;
    this.dotTotal++;
    this.dots.count = Math.min(DOT_MAX, this.dotTotal);
    this.dots.instanceMatrix.needsUpdate = true;
    this.dots.instanceColor.needsUpdate = true;
  }

  // ---- keys ----

  clearDots() {
    this.dots.count = 0;
    this.dotNext = this.dotTotal = 0;
  }

  toggle() {
    this.shown = !this.shown;
    this.panel.style.display = this.shown ? '' : 'none';
    this.labels.style.display = this.shown ? '' : 'none';
  }

  resetDummies() {
    for (const r of this.readouts.values()) r.el.remove();
    this.readouts.clear();
    this.lastHit = null;
    for (const d of this.dummies) d.health = d.maxHealth;
    this.panelText = ''; // force the panel to redraw
  }

  // ---- per frame ----

  #showGun() {
    const w = this.game.weapon;
    this.gun = w.current;
    const f = w.t.falloff;
    // distances are from the firing line; the gun's falloff is measured from the muzzle, which stands near it
    for (const [key, d] of [['start', f?.start], ['end', f?.end]]) {
      const s = this.strips[key];
      s.visible = !!f;
      if (f) s.position.z = FIRING_LINE - d;
    }
  }

  #text() {
    const w = this.game.weapon;
    const t = w.t;
    const f = t.falloff;
    const L = [];
    L.push(`${t.name}  [${t.short}]${t.pierce ? '  pierces' : ''}`);
    L.push(f ? `falloff   start ${f.start} m   end ${f.end} m   min x${f.min}` : 'falloff   none (full damage)');
    L.push(`spread    hip ${t.spreadHip.toFixed(4)}   aim ${t.spreadAim.toFixed(4)}   now ${w.spread().toFixed(4)} rad`);
    L.push(`cone@10m  hip ${coneCm(t.spreadHip).toFixed(0)} cm   aim ${coneCm(t.spreadAim).toFixed(0)} cm   (diameter)`);
    const h = this.lastHit;
    if (h) {
      const g = GUNS[h.gun];
      L.push(`last hit  ${h.distance.toFixed(1)} m   dealt ${h.amount.toFixed(1)}   expected ${h.expected.toFixed(1)}   ${h.zone}${h.crit ? '  CRIT' : ''}   (${g.short})`);
    } else L.push('last hit  -');
    L.push('B clear dots   N hide   M reset dummies');
    return L.join('\n');
  }

  update() {
    if (this.game.weapon.current !== this.gun) this.#showGun();
    if (!this.shown) return;
    const text = this.#text();
    if (text !== this.panelText) {
      this.panelText = text;
      this.panel.textContent = text;
    }
    // damage numbers over the dummies' heads
    this.camera.updateMatrixWorld();
    const W = innerWidth;
    const H = innerHeight;
    for (const [d, r] of this.readouts) {
      _p.set(d.pos.x, d.pos.y + 2.1, d.pos.z).project(this.camera);
      const on = _p.z > -1 && _p.z < 1;
      r.el.style.display = on ? '' : 'none';
      if (on) r.el.style.transform = `translate(${((_p.x + 1) / 2) * W}px,${((1 - _p.y) / 2) * H}px) translate(-50%,-100%)`;
    }
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    for (const off of this.off) off();
    for (const p of this.dummies) delete p.damage; // back to the prototype's
    this.panel.remove();
    this.labels.remove();
    for (const s of Object.values(this.strips)) {
      s.removeFromParent();
    }
    this.strips.start.geometry.dispose(); // one geometry shared by both
    this.strips.start.material.dispose();
    this.strips.end.material.dispose();
    disposeTree(this.dots);
  }
}
