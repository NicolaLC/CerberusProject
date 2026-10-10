import * as THREE from 'three';
import { 
  isReducedMotionEnabled, 
  getReducedTraumaValue,
  getReducedHitstopValue,
  getReducedMotionValue,
  getCurrentMotionFactor 
} from '../accessibility.js';

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
  jetTrauma: 0.05, // take-off kick (frequent action: subtle)
  jetDip: -0.35, // camera sinks slightly, then springs back up
  jetLandTrauma: 0.06, // landing after a jet: light dip instead of the vault slam
  jetLandDip: 0.7,
  killPunch: 3,
  perfectReloadPunch: 2.5,
  coverDip: 0.9,
};

// Helper to get trauma value with reduced motion support
function getTrauma(key, baseValue) {
  if (!isReducedMotionEnabled()) return baseValue;
  const reduced = getReducedTraumaValue(key);
  if (reduced !== null) return reduced;
  return baseValue * getCurrentMotionFactor();
}

// Helper to get hitstop value with reduced motion support
function getHitstop(key, baseValue) {
  if (!isReducedMotionEnabled()) return baseValue;
  const reduced = getReducedHitstopValue(key);
  if (reduced !== null) return reduced;
  return baseValue * getCurrentMotionFactor();
}

// Helper to get motion value (punch, dip) with reduced motion support
function getMotion(key, baseValue) {
  if (!isReducedMotionEnabled()) return baseValue;
  const reduced = getReducedMotionValue(key);
  if (reduced !== null) return reduced;
  return baseValue * getCurrentMotionFactor();
}

export class Juice {
  constructor({ camRig, post, fx }) {
    Object.assign(this, { camRig, post, fx });
    this.t = TUNING;
    this.stop = 0;
    this.timeScale = 1;
  }

  // Level change: no hitstop left running.
  reset() {
    this.stop = 0;
    this.timeScale = 1;
  }

  listen(events) {
    events.on('weapon:hit', (h) => (h.killed ? this.kill(h.point, h.dir) : this.hit(h.crit)));
    events.on('weapon:reload', (kind) => {
      if (kind === 'perfect') this.perfectReload();
      else if (kind === 'jam') this.camRig.addTrauma(getTrauma('jamTrauma', 0.15));
    });
    events.on('player:hurt', () => this.hurt());
    events.on('player:coverSlam', () => this.coverSlam());
    events.on('player:jet', () => this.jet());
    events.on('player:land', (kind) => this.land(kind));
    // boss: the ground shakes with distance
    const near = (p, r) => Math.max(0, 1 - this.camRig.pivot.distanceTo(p) / r);
    events.on('blast', (b) => this.camRig.addTrauma(getTrauma('blastTrauma', 0.5) * near(b.point, b.radius * 4)));
    events.on('boss:step', (s) => this.camRig.addTrauma(getTrauma('bossStepTrauma', 0.08) * near(s.point, 14)));
    events.on('boss:leg', (b) => {
      this.hitstop(getHitstop('hitstopKill', this.t.hitstopKill));
      this.camRig.addTrauma(getTrauma('bossLegTrauma', 0.3) * near(b.point, 40));
    });
    events.on('boss:dead', (b) => {
      this.hitstop(getHitstop('bossDeadHitstop', 0.15));
      this.camRig.addTrauma(getTrauma('bossDeadTrauma', 0.7) * near(b.point, 60));
      this.post.kill();
    });
    return this;
  }

  hitstop(s) {
    this.stop = Math.max(this.stop, s);
  }

  hit(crit) {
    if (crit) this.hitstop(getHitstop('hitstopHead', this.t.hitstopHead));
  }

  kill(point, dir) {
    this.hitstop(getHitstop('hitstopKill', this.t.hitstopKill));
    this.camRig.addTrauma(getTrauma('killTrauma', this.t.killTrauma));
    this.camRig.punch(getMotion('killPunch', this.t.killPunch));
    this.post.kill();
    this.fx.shockwave(point);
    this.fx.impact(point, _n.copy(dir).negate(), 0x6fe3ff, 24, false);
  }

  perfectReload() {
    this.camRig.punch(getMotion('perfectReloadPunch', this.t.perfectReloadPunch));
    this.camRig.addTrauma(getTrauma('perfectReloadTrauma', 0.1));
    if (!isReducedMotionEnabled()) {
      this.post.flash = Math.max(this.post.flash, 0.4);
    }
  }

  hurt() {
    this.camRig.addTrauma(getTrauma('hurtTrauma', this.t.hurtTrauma));
    this.post.hit();
  }

  coverSlam() {
    this.camRig.addTrauma(getTrauma('coverTrauma', this.t.coverTrauma));
    this.camRig.dip(getMotion('coverDip', this.t.coverDip));
  }

  jet() {
    this.camRig.addTrauma(getTrauma('jetTrauma', this.t.jetTrauma));
    this.camRig.dip(getMotion('jetDip', this.t.jetDip));
  }

  land(kind) {
    const soft = kind === 'jet';
    this.camRig.addTrauma(getTrauma(soft ? 'jetLandTrauma' : 'landTrauma', soft ? this.t.jetLandTrauma : this.t.landTrauma));
    this.camRig.dip(getMotion('landDip', soft ? this.t.jetLandDip : 1.4));
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
