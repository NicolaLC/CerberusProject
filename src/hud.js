import * as THREE from 'three';

// DOM HUD. All elements live in index.html.
const $ = (id) => document.getElementById(id);

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
    this.hitTime = 0;
    this.dmgTime = 0;
  }

  hitmarker(crit, kill) {
    this.hitTime = 0.15;
    this.el.hit.className = kill ? 'kill' : crit ? 'crit' : '';
  }

  damage(boltVel, rig) {
    this.dmgTime = 0.5;
    // direction the bolt came from, relative to camera yaw
    const from = Math.atan2(-boltVel.x, -boltVel.z);
    const rel = from - (rig.yaw + Math.PI);
    this.el.dmgDir.style.transform = `translate(-50%, -50%) rotate(${-rel}rad)`;
  }

  update(dt, { player, weapon, enemies, camRig, world }) {
    const e = this.el;
    // crosshair gap from spread (rad -> px)
    const fovRad = THREE.MathUtils.degToRad(camRig.camera.fov);
    const gap = 4 + (weapon.spread() / Math.tan(fovRad / 2)) * (innerHeight / 2);
    e.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    e.cross.classList.toggle('aim', player.aiming);
    e.cross.style.opacity = player.snap ? 0.15 : 1;

    this.hitTime -= dt;
    e.hit.style.opacity = this.hitTime > 0 ? 1 : 0;

    e.ammo.textContent = weapon.ammo;
    e.gunName.textContent = weapon.t.name;
    for (const [id, el] of Object.entries(e.slots)) el.classList.toggle('on', id === (weapon.pending ?? weapon.current));
    e.reserve.textContent = weapon.reserve;
    e.ammo.classList.toggle('low', weapon.ammo <= 6);
    e.reload.style.display = weapon.reloading > 0 ? 'block' : 'none';
    e.ammo.classList.toggle('boost', weapon.boosted);

    // active reload bar
    const z = weapon.t.activeReload;
    const since = weapon.result ? (performance.now() - weapon.result.time) / 1000 : 99;
    const showBar = !!weapon.active || since < 0.7;
    e.ar.style.opacity = showBar ? 1 : 0;
    if (weapon.active) {
      const pct = (v) => `${(v * 100).toFixed(2)}%`;
      e.arGood.style.left = pct(z.good[0]);
      e.arGood.style.width = pct(z.good[1] - z.good[0]);
      e.arPerfect.style.left = pct(z.perfect[0]);
      e.arPerfect.style.width = pct(z.perfect[1] - z.perfect[0]);
      e.arCursor.style.left = pct(Math.min(1, weapon.reloadProgress()));
    }
    const kind = since < 0.7 ? weapon.result.kind : weapon.active ? 'pending' : '';
    e.ar.dataset.state = kind;
    e.arLabel.textContent = { perfect: 'PERFECT', good: 'GOOD', jam: 'JAMMED', pending: 'R' }[kind] ?? '';

    e.shield.style.width = `${player.shields}%`;
    e.health.style.width = `${player.health}%`;

    let prompt = '';
    if (player.cover) {
      const c = player.cover;
      prompt = c.type === 'low' ? 'SPACE leave cover · SPACE + W vault · SHIFT aim to pop up' : (c.edgeL || c.edgeR) ? 'SHIFT aim to peek from the edge' : 'Move to an edge to peek';
    } else if (player.coverCandidate) {
      prompt = `SPACE take ${player.coverCandidate.type} cover`;
    }
    if (!prompt && weapon.reserve === 0 && weapon.ammo <= 8) prompt = 'LOW AMMO · grab a glowing cyan ammo case';
    e.prompt.textContent = prompt;
    e.prompt.style.opacity = prompt ? 1 : 0;

    e.kills.textContent = enemies.kills;
    e.zone.textContent = world.isInterior(player.pos) ? 'INTERIOR' : 'TRAINING YARD';

    this.dmgTime -= dt;
    const lowHp = player.shields <= 0 ? 0.35 + (1 - player.health / 100) * 0.5 : 0;
    e.vignette.style.opacity = Math.max(lowHp, this.dmgTime > 0 ? this.dmgTime * 1.4 : 0);
    e.dmgDir.style.opacity = this.dmgTime > 0 ? this.dmgTime * 2 : 0;

    e.death.style.display = player.dead ? 'flex' : 'none';
  }
}
