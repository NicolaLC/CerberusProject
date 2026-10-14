import * as THREE from 'three';
import { GUNS, GUN_ORDER } from '../combat/guns.js';
import { inputName } from '../controls.js';

const _p = new THREE.Vector3();

// DOM HUD. All elements live in index.html.
// Writes go through text()/css(), which skip unchanged values: no style recalc or layout for a static HUD.
const $ = (id) => document.getElementById(id);
const LAST = new WeakMap();
// the ammo counter turns red at this fraction of the gun's magazine (at least the last round)
const LOW_AMMO = 0.25;
// circumference of the charge ring's circle (r = 28 in index.html)
const RING = 2 * Math.PI * 28;
const AR_LABEL = { perfect: 'PERFECT', good: 'GOOD' };
// objective pin: px kept clear of the screen edge when clamped; m over `near` (Mission.pinTarget) to fade fully in; fade speed (1/s)
const PIN = { edge: 56, fade: 4, rate: 8 };
function changed(el, key, value) {
  let last = LAST.get(el);
  if (!last) LAST.set(el, (last = {}));
  if (last[key] === value) return false;
  last[key] = value;
  return true;
}
function css(el, prop, value) {
  if (changed(el, prop, value)) el.style[prop] = value;
}
function text(el, value) {
  if (changed(el, '#text', value)) el.textContent = value;
}

export class Hud {
  constructor() {
    this.el = {
      cross: $('crosshair'),
      charge: $('charge'),
      chargeArc: document.querySelector('#charge .arc'),
      hit: $('hitmarker'),
      ammo: $('ammo'),
      reserve: $('reserve'),
      reload: $('reload'),
      shield: $('shield-fill'),
      health: $('health-fill'),
      kills: $('kills'),
      vignette: $('vignette'),
      dmgDir: $('dmg-dir'),
      overlay: $('overlay'),
      death: $('death'),
      zone: $('zone'),
      objective: $('objective'),
      objHead: $('obj-head'),
      objDetail: $('obj-detail'),
      prompt: $('prompt'),
      objProg: $('obj-prog'),
      killsWrap: $('kills-wrap'),
      gunName: $('gun-name'),
      weapon: $('weapon'),
      ar: $('areload'),
      arGood: document.querySelector('#areload .good'),
      arPerfect: document.querySelector('#areload .perfect'),
      arCursor: document.querySelector('#areload .cursor'),
      arLabel: document.querySelector('#areload .label'),
      slots: Object.fromEntries(GUN_ORDER.map((id) => [id, $(`slot-${id}`)])),
    };
    this.el.toast = $('toast');
    this.el.block = $('blockmark');
    this.el.scope = $('scope');
    this.el.lock = $('lockmark');
    const pin = $('pin');
    this.el.pin = { root: pin, arrow: pin.querySelector('.arrow'), dist: pin.querySelector('.dist') };
    this.pinO = 0; // pin opacity, eased
    this.pinStale = true; // pin keep-out boxes need measuring (#measurePin)
    addEventListener('resize', () => (this.pinStale = true));
    this.el.log = $('log');
    this.el.status = $('status');
    this.el.boss = { root: $('boss'), name: $('boss-name'), fill: $('boss-fill'), legs: $('boss-legs'), state: $('boss-state') };
    this.hitTime = 0;
    this.hitMax = 1;
    this.hitPop = 0;
    this.dmgTime = 0;
    this.toastTime = 0;
  }

  // Level change: no boss bar, lock-on, toast or hit feedback left over from the last one.
  // Per-scene reset; the zone label shows the level's title (outdoors) or INTERIOR.
  reset(level) {
    this.zoneName = level?.title ?? level?.name?.toUpperCase() ?? '';
    this.hitTime = this.dmgTime = this.toastTime = this.pinO = 0;
    this.pinStale = true;
    this.bossLegs = null;
    this.el.boss.root.classList.remove('on');
  }

  // HUD reactions to gameplay events. camRig: for the damage direction indicator.
  listen(events, camRig) {
    events.on('weapon:hit', (h) => this.hitmarker(h.crit, h.killed, h.amount));
    events.on('player:hurt', (h) => this.damage(h.dir, camRig));
    events.on('pickup:collected', (msg) => this.toast(msg));
    events.on('pickup:full', () => this.toast('AMMO FULL'));
    events.on('weapon:discovered', ({ gun }) => this.toast(`${GUNS[gun].name} ACQUIRED`, 3)); // the log line is level data (log.line on: discovered:<gun>)
    events.on('arena:clear', () => this.toast('ARENA CLEAR', 6));
    events.on('boss:wake', (b) => this.toast(`⚠ ${b.name}`, 3));
    events.on('boss:down', () => this.toast('CORE EXPOSED', 2));
    events.on('boss:dead', () => this.toast('MECH DESTROYED', 3));
    events.on('mission:objective:done', (e) => !e.skipped && this.toast('OBJECTIVE COMPLETE')); // a skipped optional objective is silent
    events.on('mission:complete', () => this.toast('MISSION COMPLETE', 4)); // after the last objective's toast: wins
    events.on('mission:failed', () => this.toast('MISSION FAILED', 4));
    return this;
  }

  // Objective panel: the detail (key-cap spans) is rebuilt only when the objective or the input scheme changes; the slide-in replays on an objective change.
  #objective(p, scheme) {
    const e = this.el;
    css(e.objective, 'display', p ? 'block' : 'none');
    if (changed(e.objective, 'pinShown', !!p)) this.pinStale = true;
    css(e.killsWrap, 'display', p ? 'none' : ''); // the kill counter stays for scenes without objectives
    if (!p) return;
    text(e.objHead, p.head);
    text(e.objProg, p.prog);
    if (!changed(e.objDetail, 'detail', `${p.key}|${scheme}|${p.detail}`)) return;
    const nodes = p.detail.split(/\{(\w+)\}/).map((s, i) => {
      if (i % 2 === 0) return s;
      const k = document.createElement('kbd');
      try { k.textContent = inputName(s, scheme); } catch { k.textContent = s; }
      return k;
    });
    e.objDetail.replaceChildren(...nodes);
    if (changed(e.objective, 'key', p.key)) {
      this.pinStale = true; // the panel's size changed
      e.objective.classList.remove('in');
      void e.objective.offsetWidth;
      e.objective.classList.add('in');
    }
  }

  // Interact prompt floating in the world over the thing to take (projected each frame), key cap + text; the content
  // is rebuilt only when the text or the input scheme changes. Hidden when the point is behind the camera.
  #prompt(p, scheme, camera) {
    const e = this.el.prompt;
    let on = !!p;
    if (on) {
      _p.set(p.at.x, p.at.y, p.at.z).project(camera);
      on = _p.z < 1;
      if (on) css(e, 'transform', `translate(${(((_p.x + 1) / 2) * innerWidth).toFixed(0)}px, ${(((1 - _p.y) / 2) * innerHeight).toFixed(0)}px) translate(-50%, -100%)`);
    }
    css(e, 'display', on ? 'block' : 'none');
    if (!on || !changed(e, 'prompt', `${p.label}|${scheme}`)) return;
    const k = document.createElement('kbd');
    k.textContent = inputName('interact', scheme);
    e.replaceChildren(k, ` ${p.label}`);
  }

  // Objective pin (Mission.pinTarget): diamond + horizontal distance projected on the target; off screen or behind the
  // camera it sticks to the screen edge with an arrow toward it. Fades in / out (near the target, objective without a place).
  // Keeps its last place while fading out after the objective ends. The clamp keeps out of the bottom HUD band (log, weapon,
  // status) and the objective panel: boxes measured by #measurePin when stale (resize, objective / weapon change), never per frame.
  #pin(t, from, camera, dt) {
    const e = this.el.pin;
    let want = 0;
    let d = 0;
    if (t) {
      d = Math.hypot(t.x - from.x, t.z - from.z);
      want = Math.min(1, Math.max(0, (d - t.near) / PIN.fade));
    }
    this.pinO += (want - this.pinO) * Math.min(1, dt * PIN.rate);
    if (this.pinO < 0.01) this.pinO = 0;
    css(e.root, 'opacity', this.pinO.toFixed(2));
    if (!t || this.pinO === 0) return;
    if (this.pinStale) this.#measurePin();
    const b = this.pinBox;
    _p.set(t.x, t.y, t.z).project(camera);
    const behind = _p.z > 1; // projected through the camera: x / y come out mirrored
    const W = innerWidth / 2;
    const H = innerHeight / 2;
    let x = (behind ? -_p.x : _p.x) * W;
    let y = (behind ? _p.y : -_p.y) * H; // screen offset from the centre, y down
    const lx = W - b.edge; // left / right / top limit
    const ly = H - b.edge;
    const by = H - b.bottom; // bottom limit: above the bottom HUD band
    const off = behind || Math.abs(x) > lx || y < -ly || y > by;
    let down = false;
    if (off) {
      if (Math.abs(x) < 1 && Math.abs(y) < 1) y = 1; // dead behind: point down
      const s = Math.max(Math.abs(x) / lx, y < 0 ? -y / ly : y / by);
      x /= s;
      y /= s;
      css(e.arrow, 'transform', `rotate(${Math.atan2(y, x).toFixed(2)}rad)`);
      down = y > 0.6 * Math.hypot(x, y); // the arrow points down, where the distance tag sits: the tag moves above
      // clamped into the objective panel's corner: slide along the edge it sits on, past the panel
      if (W + x < b.objRight && H + y < b.objBottom) {
        if (x <= -lx + 1) y = b.objBottom - H;
        else x = b.objRight - W;
      }
    }
    e.root.classList.toggle('off', off);
    e.root.classList.toggle('tag-up', down);
    css(e.root, 'transform', `translate(${(W + x).toFixed(0)}px, ${(H + y).toFixed(0)}px)`);
    text(e.dist, `${Math.round(d)} M`);
  }

  // Pin keep-out boxes in px, from the HUD elements' layout boxes (offset*: no transforms, so the panels' slide-in doesn't skew
  // them). `pad` = the pin's own reach (diamond, distance tag, arrow) in its em. The log's band is kept from a non-announcer
  // measure (the announcer moves the element to the top).
  #measurePin() {
    const e = this.el;
    const em = parseFloat(getComputedStyle(e.pin.root).fontSize) || 16;
    const pad = 2.2 * em;
    const H = innerHeight;
    const top = (el) => (el.offsetHeight ? el.offsetTop : H); // hidden element: no band
    if (!e.log.classList.contains('announcer')) this.logTop = top(e.log);
    const band = H - Math.min(this.logTop ?? H * 0.75, top(e.weapon), top(e.status));
    const o = e.objective;
    const shown = o.offsetHeight > 0;
    this.pinBox = { edge: Math.max(PIN.edge, pad), bottom: band + pad, objRight: shown ? o.offsetLeft + o.offsetWidth + pad : 0, objBottom: shown ? o.offsetTop + o.offsetHeight + pad : 0 };
    this.pinStale = false;
  }

  #boss(b) {
    const e = this.el.boss;
    const on = !!b && b.awake && (b.alive || b.debris.length > 0);
    e.root.classList.toggle('on', on);
    if (!on) return;
    text(e.name, b.name);
    css(e.fill, 'width', `${((100 * Math.max(0, b.health)) / b.maxHealth).toFixed(1)}%`);
    const legs = b.legs.map((l) => (l.alive ? 1 : 0)).join('');
    if (legs !== this.bossLegs) {
      this.bossLegs = legs;
      e.legs.innerHTML = b.legs.map((l) => `<i class="${l.alive ? '' : 'gone'}"></i>`).join('');
    }
    text(e.state, !b.alive ? 'DESTROYED' : b.down > 0 ? 'CORE EXPOSED' : '');
  }

  toast(message, seconds = 1.4) {
    text(this.el.toast, message);
    this.toastTime = seconds;
  }

  // Pops in proportion to the damage dealt; kills hold longer and bigger.
  hitmarker(crit, kill, amount = 18) {
    this.hitMax = this.hitTime = kill ? 0.32 : crit ? 0.2 : 0.14;
    this.hitPop = Math.min(1.4, 0.35 + amount / 40) * (kill ? 1.5 : 1);
    this.el.hit.className = kill ? 'kill' : crit ? 'crit' : '';
  }

  damage(dir, rig) {
    this.dmgTime = 0.5;
    // direction the shot came from, relative to camera yaw
    const from = Math.atan2(-dir.x, -dir.z);
    const rel = from - (rig.yaw + Math.PI);
    css(this.el.dmgDir, 'transform', `translate(-50%, -50%) rotate(${-rel}rad)`);
  }

  // pin: false hides the objective pin (boot intro; the cinematic, title, pause and Workshop hide it with the whole HUD)
  update(dt, { player, weapon, enemies, camRig, world, mission, pickups = null, scheme = 'kbm', pin = true }) {
    const e = this.el;
    this.#boss(enemies.boss);
    // lock-on marker on the boss while the camera follows it
    let lockVisible = false;
    if (camRig.focus && camRig.focusBlend > 0.3) {
      _p.copy(camRig.focus).project(camRig.camera);
      if (_p.z < 1) {
        lockVisible = true;
        css(e.lock, 'transform', `translate(${(((_p.x + 1) / 2) * innerWidth).toFixed(1)}px, ${(((1 - _p.y) / 2) * innerHeight).toFixed(1)}px) translate(-50%, -50%) rotate(45deg)`);
      }
    }
    css(e.lock, 'opacity', lockVisible ? 1 : 0);
    // crosshair gap from spread (rad -> px)
    const fovRad = THREE.MathUtils.degToRad(camRig.camera.fov);
    // rounded to the 0.1 px written, so small spread changes don't dirty the style
    const gap = Math.round((4 + (weapon.spread() / Math.tan(fovRad / 2)) * (innerHeight / 2)) * 10) / 10;
    if (changed(e.cross, '--gap', gap)) e.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    e.cross.classList.toggle('aim', player.aiming);
    // what the next round will hit: red over an enemy, magenta over a weak spot, grey when the gun is obstructed
    const a = weapon.aim;
    e.cross.classList.toggle('enemy', a.enemy && !a.weak);
    e.cross.classList.toggle('weak', a.weak);
    e.cross.classList.toggle('blocked', a.blocked);
    let blockVisible = false;
    if (a.blocked) {
      _p.copy(a.blockPoint).project(camRig.camera);
      if (_p.z < 1) {
        blockVisible = true;
        css(e.block, 'transform', `translate(${(((_p.x + 1) / 2) * innerWidth).toFixed(1)}px, ${(((1 - _p.y) / 2) * innerHeight).toFixed(1)}px) translate(-50%, -50%)`);
      }
    }
    css(e.block, 'opacity', blockVisible ? 1 : 0);
    css(e.cross, 'opacity', (player.snap && !player.isSliding()) || player.sprinting ? 0.15 : 1);
    // scoped gun: the overlay follows the zoom; the crosshair dims while the bolt cycles
    css(e.scope, 'opacity', weapon.t.zoom?.scope ? weapon.aimBlend().toFixed(2) : 0);
    e.cross.classList.toggle('cycling', !!weapon.t.semi && weapon.cooldown > 0.05);

    // railgun charge ring: fills over the charge time, gone once the slug leaves or the charge cancels
    const charge = weapon.charging > 0 && weapon.t.charge ? 1 - weapon.charging / weapon.t.charge : 0;
    css(e.charge, 'opacity', charge > 0 ? 1 : 0);
    if (charge > 0) {
      css(e.chargeArc, 'strokeDashoffset', (RING * (1 - charge)).toFixed(1));
      e.charge.classList.toggle('full', charge > 0.9);
    }

    this.hitTime -= dt;
    const hk = this.hitTime > 0 ? this.hitTime / this.hitMax : 0;
    css(e.hit, 'opacity', hk > 0 ? Math.min(1, hk * 2.5).toFixed(2) : 0);
    css(e.hit, 'transform', `translate(-50%, -50%) rotate(45deg) scale(${(1 + hk * hk * this.hitPop).toFixed(2)})`);

    text(e.ammo, weapon.ammo);
    text(e.gunName, weapon.t.name);
    for (const id in e.slots) {
      e.slots[id].classList.toggle('on', id === (weapon.pending ?? weapon.current));
      css(e.slots[id], 'display', weapon.owned.has(id) ? '' : 'none'); // only owned guns have a slot
    }
    text(e.reserve, weapon.t.infinite ? '∞' : weapon.reserve);
    e.ammo.classList.toggle('low', weapon.ammo <= Math.max(1, Math.floor(weapon.t.mag * LOW_AMMO)));
    css(e.reload, 'display', weapon.reloading > 0 ? 'block' : 'none');
    e.ammo.classList.toggle('boost', weapon.boosted);

    // active reload bar
    const z = weapon.t.activeReload;
    // a missed press (jam) just removes the bar: the reload carries on with its penalty, nothing to read
    const since = weapon.result && weapon.result.kind !== 'jam' ? (performance.now() - weapon.result.time) / 1000 : 99;
    const jammed = weapon.active?.result === 'jam';
    const showBar = (!!weapon.active && !jammed) || since < 0.7;
    css(e.ar, 'opacity', showBar ? 1 : 0);
    if (weapon.active && !jammed) {
      const pct = (v) => `${(v * 100).toFixed(2)}%`;
      css(e.arGood, 'left', pct(z.good[0]));
      css(e.arGood, 'width', pct(z.good[1] - z.good[0]));
      css(e.arPerfect, 'left', pct(z.perfect[0]));
      css(e.arPerfect, 'width', pct(z.perfect[1] - z.perfect[0]));
      css(e.arCursor, 'left', pct(Math.min(1, weapon.reloadProgress())));
    }
    const kind = since < 0.7 ? weapon.result.kind : weapon.active && !jammed ? 'pending' : '';
    if (changed(e.ar, 'data-state', kind)) e.ar.dataset.state = kind;
    text(e.arLabel, AR_LABEL[kind] ?? '');

    // unarmed: no weapon block, no crosshair (overrides what the lines above set)
    css(e.weapon, 'display', weapon.current ? '' : 'none');
    if (changed(e.weapon, 'pinShown', !!weapon.current)) this.pinStale = true; // armed: the weapon block joins the pin's keep-out band
    if (!weapon.current) for (const k of ['cross', 'scope', 'charge', 'ar', 'block']) css(e[k], 'opacity', 0);

    css(e.shield, 'width', `${player.shields}%`);
    css(e.health, 'width', `${player.health}%`);


    text(e.kills, `${enemies.kills} / ${enemies.all.length}`);
    text(e.zone, world.isInterior(player.pos) ? 'INTERIOR' : this.zoneName);
    this.#objective(mission.hudPanel(), scheme);
    this.#prompt(mission.interactPrompt(player) ?? pickups?.supplyPrompt(player) ?? null, scheme, camRig.camera); // an objective terminal, else a supply point
    this.#pin(pin && !player.dead ? mission.pinTarget(player.pos) : null, player.pos, camRig.camera, dt);

    this.dmgTime -= dt;
    const lowHp = player.shields <= 0 ? 0.35 + (1 - player.health / 100) * 0.5 : 0;
    css(e.vignette, 'opacity', Math.max(lowHp, this.dmgTime > 0 ? this.dmgTime * 1.4 : 0));
    css(e.dmgDir, 'opacity', this.dmgTime > 0 ? this.dmgTime * 2 : 0);

    this.toastTime -= dt;
    css(e.toast, 'opacity', this.toastTime > 0 ? Math.min(1, this.toastTime * 3) : 0);

    css(e.death, 'display', player.dead ? 'flex' : 'none');
  }
}
