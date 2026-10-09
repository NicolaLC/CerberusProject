import * as THREE from 'three';
import { Events } from './events.js';
import { Input } from './input.js';
import { Perf, StatsPanel } from './perf.js';
import { installShadowOnly } from './batch.js';

// Game-agnostic runtime: renderer, scene, main camera, input, event bus, frame loop and system scheduler.
//
// Systems are plain objects { name, phase, update(dt, engine), whilePaused? } run in phase order:
//   pre      once per frame, real dt          (time scale, look input)
//   simulate fixed substeps of <= MAX_STEP     (gameplay: movement, weapons, AI, projectiles)
//   late     once per frame, scaled dt         (camera follows the simulated state)
//   present  once per frame, scaled dt         (fx, HUD, animated lights)
//   render   once per frame, real dt           (post stack, exposure)
// Each call is isolated: an exception is logged and the frame continues; a system that keeps
// failing is disabled and reported through the 'engine:systemFailed' event instead of freezing the game.
export const PHASES = ['pre', 'simulate', 'late', 'present', 'render'];

const TUNING = {
  maxFrame: 0.1, // s; longer gaps (tab switch, breakpoint, hitch) are clamped to this
  maxStep: 1 / 50, // s; simulate substep cap: no tunneling, stable springs on slow frames
  maxSubsteps: 4, // beyond this the game slows down instead of spiralling
  failLimit: 10, // consecutive exceptions before a system is disabled
};

export class Engine {
  constructor({ canvas, fov = 70, near = 0.05, far = 2000 }) {
    this.t = TUNING;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.info.autoReset = false; // count the whole frame (all post passes), reset in #frame
    installShadowOnly(this.renderer); // shadow-only batch meshes (engine/batch.js)
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, near, far);
    this.events = new Events();
    this.input = new Input(canvas);

    this.perf = new Perf({ maxScale: Math.min(devicePixelRatio, 2), onScale: () => this.resize() });
    this.stats = new StatsPanel();
    this.timings = {}; // smoothed ms per system

    this.systems = Object.fromEntries(PHASES.map((p) => [p, []]));
    this.timeScale = 1; // game time multiplier (hitstop / slow motion), owned by the game
    this.time = 0; // scaled seconds since start
    this.realDt = 0; // unscaled seconds of the current frame
    this.paused = false;
    this.headless = false; // tests: step the simulation without rendering (see #tick)
    this.contextLost = false;
    this.last = 0;

    addEventListener('resize', () => this.resize());
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // allow restore
      this.contextLost = true;
      this.events.emit('engine:contextLost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.events.emit('engine:contextRestored');
    });
    this.resize();
  }

  get backend() {
    return 'webgl';
  }

  // Draw calls of the last frame (all passes: shadow, scene, post).
  get drawCalls() {
    return this.renderer.info.render.calls;
  }

  add(system) {
    const s = Object.assign({ phase: 'simulate', whilePaused: false, fails: 0, disabled: false }, system);
    if (!this.systems[s.phase]) throw new Error(`unknown phase "${s.phase}" for system ${s.name}`);
    this.systems[s.phase].push(s);
    return s;
  }

  remove(system) {
    const list = this.systems[system.phase];
    const i = list.indexOf(system);
    if (i >= 0) list.splice(i, 1);
  }

  resize() {
    this.renderer.setPixelRatio(this.perf.scale);
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.events.emit('engine:resize', { width: innerWidth, height: innerHeight, pixelRatio: this.perf.scale });
  }

  start() {
    this.running = true;
    const tick = (now) => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      this.#frame(now);
    };
    requestAnimationFrame((now) => {
      this.last = now;
      tick(now);
    });
  }

  // Stops the browser-driven loop (tests, tools). Resume with start().
  stop() {
    this.running = false;
  }

  // Runs exactly one frame of `dt` seconds, independent of wall time: deterministic tests and replays.
  step(dt = 1 / 60) {
    this.#tick(dt);
  }

  #frame(now) {
    const ms = now - this.last;
    this.last = now;
    const realDt = ms / 1000;
    if (realDt <= 0) return;
    this.perf.sample(Math.min(ms, 100), Math.min(realDt, this.t.maxFrame));
    this.#tick(realDt);
  }

  #tick(realDt) {
    if (realDt > this.t.maxFrame) realDt = this.t.maxFrame;
    this.realDt = realDt;

    const input = this.input;
    input.poll();
    this.#run('pre', realDt);

    if (this.paused) {
      this.#run('late', realDt);
      this.#run('present', realDt);
    } else {
      const dt = Math.min(realDt, this.t.maxStep * this.t.maxSubsteps) * this.timeScale;
      const n = Math.max(1, Math.ceil(dt / this.t.maxStep - 1e-6));
      const step = dt / n;
      for (let i = 0; i < n; i++) {
        input.edges = i === 0;
        this.#run('simulate', step);
      }
      input.edges = true;
      this.time += dt;
      this.#run('late', dt);
      this.#run('present', dt);
    }
    this.renderer.info.reset();
    // headless (tests): simulate without drawing; world matrices still update for raycasts and hitboxes
    if (this.headless) this.scene.updateMatrixWorld();
    else if (!this.contextLost) this.#run('render', realDt);

    input.endFrame();
    this.stats.update(realDt, this.perf, this.renderer, this.timings);
  }

  #run(phase, dt) {
    const list = this.systems[phase];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.disabled || (this.paused && !s.whilePaused)) continue;
      const t0 = performance.now();
      try {
        s.update(dt, this);
        s.fails = 0;
      } catch (err) {
        s.fails++;
        console.error(`[engine] system "${s.name}" failed (${s.fails}/${this.t.failLimit})`, err);
        if (s.fails >= this.t.failLimit) {
          s.disabled = true;
          this.events.emit('engine:systemFailed', { name: s.name, error: err });
        }
      }
      const prev = this.timings[s.name] ?? 0;
      this.timings[s.name] = prev + (performance.now() - t0 - prev) * 0.05;
    }
  }
}
