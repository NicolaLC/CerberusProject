// Frame-time monitor and dynamic resolution. Holds the frame budget (60 fps) by lowering the
// render pixel ratio when frames run long and raising it back when there is headroom.
// The GPU cost of this game scales with pixels (MSAA HDR target + bloom), so resolution is the lever.
const TUNING = {
  budget: 1000 / 60, // ms
  slow: 1.12, // work (or gap, see sample) above budget * slow -> step down
  fast: 0.8, // work below budget * fast -> step up
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
    this.avg = TUNING.budget; // smoothed ms between frames (real fps)
    this.work = 0; // smoothed ms of CPU work per frame (simulate + render submission)
    this.minGap = Infinity; // smallest smoothed frame gap seen: the display's refresh interval
    this.fps = 60;
    this.slowFor = 0;
    this.fastFor = 0;
    this.enabled = true;
    this.warmup = 2; // ignore the first seconds (shader compiles, texture uploads)
  }

  // gap: wall ms between rAF frames (fps readout). work: ms the CPU spent on the frame.
  // vsync pins the gap at the refresh interval however light the frame is, so the gap alone can neither
  // show headroom nor tell a 30/50 Hz display from a slow game. The scaler therefore judges `work`.
  // GPU work is asynchronous and invisible to `work`, so the gap counts as "slow" too, but only when it is
  // over budget AND clearly above the best gap seen (the display can go faster than this): a 30 Hz display
  // never does, a GPU-bound frame on a 60 Hz one does. (Ceiling: a game GPU-bound from the first frame
  // learns its own gap as the best one; only `work` can then trigger a step down.)
  sample(gap, work, dtSec) {
    this.avg += (gap - this.avg) * 0.08;
    this.work += (work - this.work) * 0.08;
    this.fps = 1000 / this.avg;
    if (this.warmup > 0) {
      this.warmup -= dtSec;
      return;
    }
    this.minGap = Math.min(this.minGap, this.avg);
    if (!this.enabled) return;
    const t = this.t;
    const gapSlow = this.avg > t.budget * t.slow && this.avg > this.minGap * 1.25;
    if (this.work > t.budget * t.slow || gapSlow) {
      this.slowFor += dtSec;
      this.fastFor = 0;
    } else if (this.work < t.budget * t.fast) {
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
