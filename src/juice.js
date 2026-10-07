// Game-feel hub: gameplay code reports events, this turns them into camera, post, time and sound feedback.
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
    this.fx.impact(point, dir.clone().negate(), 0x6fe3ff, 24, false);
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
