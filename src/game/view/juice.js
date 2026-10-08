import * as THREE from 'three';

// Game-feel hub: turns gameplay events into hitstop, camera trauma, FOV punch and post flashes.
// Owns the game time scale (engine.timeScale) through update().
const _n = new THREE.Vector3();
const TUNING = {
  hitstopKill: 0.07, // seconds of near-freeze on a kill
  hitstopHead: 0.025,
  hitstopScale: 0.08,
  killTrauma: 0.22,
  hurtTrauma: 0.38,
  coverTrauma: 0.16,
  landTrauma: 0.2,
};

export class Juice {
  constructor({ camRig, post, fx }) {
    Object.assign(this, { camRig, post, fx });
    this.t = TUNING;
    this.stop = 0;
    this.timeScale = 1;
  }

  listen(events) {
    events.on('weapon:hit', (h) => (h.killed ? this.kill(h.point, h.dir) : this.hit(h.crit)));
    events.on('weapon:reload', (kind) => {
      if (kind === 'perfect') this.perfectReload();
      else if (kind === 'jam') this.camRig.addTrauma(0.15);
    });
    events.on('player:hurt', () => this.hurt());
    events.on('player:coverSlam', () => this.coverSlam());
    events.on('player:land', () => this.land());
    return this;
  }

  hitstop(s) {
    this.stop = Math.max(this.stop, s);
  }

  hit(crit) {
    if (crit) this.hitstop(this.t.hitstopHead);
  }

  kill(point, dir) {
    this.hitstop(this.t.hitstopKill);
    this.camRig.addTrauma(this.t.killTrauma);
    this.camRig.punch(3);
    this.post.kill();
    this.fx.shockwave(point);
    this.fx.impact(point, _n.copy(dir).negate(), 0x6fe3ff, 24, false);
  }

  perfectReload() {
    this.camRig.punch(2.5);
    this.camRig.addTrauma(0.1);
    this.post.flash = Math.max(this.post.flash, 0.4);
  }

  hurt() {
    this.camRig.addTrauma(this.t.hurtTrauma);
    this.post.hit();
  }

  coverSlam() {
    this.camRig.addTrauma(this.t.coverTrauma);
    this.camRig.dip(0.9);
  }

  land() {
    this.camRig.addTrauma(this.t.landTrauma);
    this.camRig.dip(1.4);
  }

  // returns the game time scale for this frame (real dt in)
  update(realDt) {
    if (this.stop > 0) {
      this.stop -= realDt;
      this.timeScale = this.t.hitstopScale;
    } else {
      this.timeScale += (1 - this.timeScale) * Math.min(1, realDt * 12);
    }
    return this.timeScale;
  }
}
