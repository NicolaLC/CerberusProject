import * as THREE from 'three';

// DOM HUD. All elements live in index.html.
// Writes go through text()/css(), which skip unchanged values: no style recalc or layout for a static HUD.
const $ = (id) => document.getElementById(id);
const LAST = new WeakMap();
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
      hit: $('hitmarker'),
      ammo: $('ammo'),
      reserve: $('reserve'),
      reload: $('reload'),
      shield: $('shield-fill'),
      health: $('health-fill'),
      prompt: $('prompt'),
      kills: $('kills'),
      vignette: $('vignette'),
      dmgDir: $('dmg-dir'),
      overlay: $('overlay'),
      death: $('death'),
      zone: $('zone'),
      gunName: $('gun-name'),
      ar: $('areload'),
      arGood: document.querySelector('#areload .good'),
      arPerfect: document.querySelector('#areload .perfect'),
      arCursor: document.querySelector('#areload .cursor'),
      arLabel: document.querySelector('#areload .label'),
      slots: { rifle: $('slot-rifle'), mg: $('slot-mg') },
    };
    this.el.toast = $('toast');
    this.hitTime = 0;
    this.dmgTime = 0;
    this.toastTime = 0;
    this.aimLabel = 'RMB';
  }

  // HUD reactions to gameplay events. camRig: for the damage direction indicator.
  listen(events, camRig) {
    events.on('weapon:hit', (h) => this.hitmarker(h.crit, h.killed));
    events.on('player:hurt', (h) => this.damage(h.dir, camRig));
    events.on('pickup:collected', (msg) => this.toast(msg));
    events.on('pickup:full', () => this.toast('AMMO FULL'));
    return this;
  }

  toast(message) {
    text(this.el.toast, message);
    this.toastTime = 1.4;
  }

  hitmarker(crit, kill) {
    this.hitTime = 0.15;
    this.el.hit.className = kill ? 'kill' : crit ? 'crit' : '';
  }

  damage(dir, rig) {
    this.dmgTime = 0.5;
    // direction the shot came from, relative to camera yaw
    const from = Math.atan2(-dir.x, -dir.z);
    const rel = from - (rig.yaw + Math.PI);
    css(this.el.dmgDir, 'transform', `translate(-50%, -50%) rotate(${-rel}rad)`);
  }

  update(dt, { player, weapon, enemies, camRig, world }) {
    const e = this.el;
    // crosshair gap from spread (rad -> px)
    const fovRad = THREE.MathUtils.degToRad(camRig.camera.fov);
    const gap = 4 + (weapon.spread() / Math.tan(fovRad / 2)) * (innerHeight / 2);
    e.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    e.cross.classList.toggle('aim', player.aiming);
    css(e.cross, 'opacity', player.snap || player.sprinting ? 0.15 : 1);

    this.hitTime -= dt;
    css(e.hit, 'opacity', this.hitTime > 0 ? 1 : 0);

    text(e.ammo, weapon.ammo);
    text(e.gunName, weapon.t.name);
    for (const [id, el] of Object.entries(e.slots)) el.classList.toggle('on', id === (weapon.pending ?? weapon.current));
    text(e.reserve, weapon.reserve);
    e.ammo.classList.toggle('low', weapon.ammo <= 6);
    css(e.reload, 'display', weapon.reloading > 0 ? 'block' : 'none');
    e.ammo.classList.toggle('boost', weapon.boosted);

    // active reload bar
    const z = weapon.t.activeReload;
    const since = weapon.result ? (performance.now() - weapon.result.time) / 1000 : 99;
    const showBar = !!weapon.active || since < 0.7;
    css(e.ar, 'opacity', showBar ? 1 : 0);
    if (weapon.active) {
      const pct = (v) => `${(v * 100).toFixed(2)}%`;
      css(e.arGood, 'left', pct(z.good[0]));
      css(e.arGood, 'width', pct(z.good[1] - z.good[0]));
      css(e.arPerfect, 'left', pct(z.perfect[0]));
      css(e.arPerfect, 'width', pct(z.perfect[1] - z.perfect[0]));
      css(e.arCursor, 'left', pct(Math.min(1, weapon.reloadProgress())));
    }
    const kind = since < 0.7 ? weapon.result.kind : weapon.active ? 'pending' : '';
    e.ar.dataset.state = kind;
    text(e.arLabel, { perfect: 'PERFECT', good: 'GOOD', jam: 'JAMMED', pending: 'R' }[kind] ?? '');

    css(e.shield, 'width', `${player.shields}%`);
    css(e.health, 'width', `${player.health}%`);

    let prompt = '';
    if (player.cover) {
      const c = player.cover;
      const aim = this.aimLabel;
      prompt = c.type === 'low' ? `SPACE leave cover · SPACE + W vault · ${aim} aim to pop up` : c.edgeL || c.edgeR ? `${aim} aim to peek from the edge` : 'Move to an edge to peek';
    } else if (player.coverCandidate) {
      prompt = `SPACE take ${player.coverCandidate.type} cover`;
    }
    if (!prompt && weapon.reserve === 0 && weapon.ammo <= 8) prompt = 'LOW AMMO · grab a glowing cyan ammo case';
    text(e.prompt, prompt);
    css(e.prompt, 'opacity', prompt ? 1 : 0);

    text(e.kills, enemies.kills);
    text(e.zone, world.isInterior(player.pos) ? 'INTERIOR' : 'TRAINING YARD');

    this.dmgTime -= dt;
    const lowHp = player.shields <= 0 ? 0.35 + (1 - player.health / 100) * 0.5 : 0;
    css(e.vignette, 'opacity', Math.max(lowHp, this.dmgTime > 0 ? this.dmgTime * 1.4 : 0));
    css(e.dmgDir, 'opacity', this.dmgTime > 0 ? this.dmgTime * 2 : 0);

    this.toastTime -= dt;
    css(e.toast, 'opacity', this.toastTime > 0 ? Math.min(1, this.toastTime * 3) : 0);

    css(e.death, 'display', player.dead ? 'flex' : 'none');
  }
}
