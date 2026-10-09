// Frame-time monitor and dynamic resolution. Holds the frame budget (60 fps) by lowering the
// render pixel ratio when frames run long and raising it back when there is headroom.
// The GPU cost of this game scales with pixels (MSAA HDR target + bloom), so resolution is the lever.
const TUNING = {
  budget: 1000 / 60, // ms
  slow: 1.12, // average above budget * slow -> step down
  fast: 0.8, // average below budget * fast -> step up
  downAfter: 0.75, // seconds of slow frames before stepping down
  upAfter: 4, // seconds of fast frames before stepping up
  step: 0.1,
  minScale: 0.5,
};

export class Perf {
  constructor({ maxScale, onScale }) {
    this.t = TUNING;
    this.maxScale = maxScale;
    this.scale = maxScale;
    this.onScale = onScale;
    this.avg = TUNING.budget; // smoothed ms per frame
    this.fps = 60;
    this.slowFor = 0;
    this.fastFor = 0;
    this.enabled = true;
    this.warmup = 2; // ignore the first seconds (shader compiles, texture uploads)
  }

  // ms: wall time between frames. A display capped at 30/50 Hz would read "slow" forever,
  // so the scaler only reacts while the browser actually delivers frames faster than that.
  sample(ms, dtSec) {
    this.avg += (ms - this.avg) * 0.08;
    this.fps = 1000 / this.avg;
    if (this.warmup > 0) {
      this.warmup -= dtSec;
      return;
    }
    if (!this.enabled) return;
    const t = this.t;
    if (this.avg > t.budget * t.slow) {
      this.slowFor += dtSec;
      this.fastFor = 0;
    } else if (this.avg < t.budget * t.fast) {
      this.fastFor += dtSec;
      this.slowFor = 0;
    } else {
      this.slowFor = this.fastFor = 0;
    }
    if (this.slowFor > t.downAfter && this.scale > t.minScale) this.#set(this.scale - t.step);
    else if (this.fastFor > t.upAfter && this.scale < this.maxScale) this.#set(this.scale + t.step);
  }

  #set(s) {
    this.scale = Math.round(Math.min(this.maxScale, Math.max(this.t.minScale, s)) * 100) / 100;
    this.slowFor = this.fastFor = 0;
    this.warmup = 0.5; // let the new size settle before judging again
    this.onScale(this.scale);
  }
}

// Small debug readout (fps, ms, resolution scale, draw calls). Toggled by the game.
export class StatsPanel {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'stats';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
    this.acc = 0;
  }

  get visible() {
    return this.el.style.display !== 'none';
  }

  set visible(v) {
    this.el.style.display = v ? 'block' : 'none';
  }

  update(dt, perf, renderer, systemsMs) {
    if (!this.visible) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    this.acc = 0;
    const info = renderer.info.render;
    const top = Object.entries(systemsMs)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(' · ');
    this.el.textContent = `${perf.fps.toFixed(0)} fps · ${perf.avg.toFixed(1)} ms · res ${Math.round(perf.scale * 100)}% · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris\n${top}`;
  }
}
