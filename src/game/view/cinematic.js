import * as THREE from 'three';
import { loadJSON, saveJSON } from '../../engine/storage.js';
import { STORAGE_KEY } from './boot.js';

// Intro cinematic (`intro.cinematic` piece in encounter.js, workshop.md "Intro cinematic"): scripted camera shots at play start
// while STEM-00 wakes up. Started by `cinematic:start` { shots, wake, skippable } (Encounter, first play frame, after Game.resetRun),
// updated in the `late` phase before the camera with the scaled game dt (pause freezes it, headless stepping drives it).
// - Camera: `camRig.script` { pos, look, fov } each frame (CameraRig takes it instead of the gameplay camera); shots play in
//   order, each moving `from` -> `to` and `look` -> `lookTo` over `time` s (`ease` 'linear' | 'inOut'), `shake` = trauma at its start.
// - STEM-00: `player.view.dormant` 1 (slumped, rig.js DORMANT) until `wake.at`, then 0 over `wake.rise` s; its core is dark until
//   `wake.at`, then a power surge: the exposure (`post.boost`) flickers up from TUNING.dark, a flash, trauma `wake.shake`, the core glows.
//   The surge emits `cinematic:wake` (an `on` form: a prop.cradle's `releaseOn` opens its clamps); a skip before `wake.at` emits it at the end.
// - Input: `controls.locked` while it plays. The end emits `cinematic:done` { skipped }: an `intro.boot` with `after: cinematic:done`
//   starts in the same call (its overlay covers the cut back to the gameplay camera). Nothing following: the input is freed.
// State for tests: `active`, `t`, `duration`, `shot` (index), `woke`.
export const TUNING = {
  fov: 55, // default shot FOV
  dark: 0.22, // exposure factor before the surge (the bay powered down)
  surge: 0.8, // s of flicker after wake.at
  peak: 1.7, // exposure factor at the flicker's spikes
  settle: 1.2, // s for the exposure to settle to 1 after the surge
  shake: 0.45, // default wake.shake (camera trauma at the surge)
  coreIn: 0.6, // s for the core to come up after the surge
  skipDelay: 0.3, // s before a skip press counts
};

const ease = (u, kind) => (kind === 'inOut' ? u * u * (3 - 2 * u) : u);
const lerp3 = (out, a, b, u) => out.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);

export class Cinematic {
  constructor({ camRig, controls, post, player }) {
    Object.assign(this, { camRig, controls, post, player });
    this.active = false;
    this.t = 0;
    this.duration = 0;
    this.shot = -1;
    this.woke = false;
    this.script = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: TUNING.fov };
    this.core = null; // the core's emissive intensity before the cinematic darkened it
  }

  listen(events) {
    this.events = events;
    events.on('cinematic:start', (e) => this.start(e));
    return this;
  }

  // params are validated by the piece (encounter.js cinematicProblem).
  start({ shots, wake = {}, skippable = false }) {
    this.reset();
    this.shots = shots;
    this.duration = shots.reduce((a, s) => a + s.time, 0);
    this.wake = { at: wake.at ?? 0, rise: wake.rise ?? 2, shake: wake.shake ?? TUNING.shake };
    this.skippable = skippable && loadJSON(STORAGE_KEY, false) === true; // like the boot: only once the intro was seen
    this.active = true;
    this.controls.locked = true;
    this.controls.ease = 0;
    const mat = this.player.view.soldierMats.core;
    this.core = mat.emissiveIntensity;
    mat.emissiveIntensity = 0;
    this.camRig.script = this.script;
    this.#apply();
    return this;
  }

  // Clean slate (Game.resetRun): camera, pose, core and exposure back to normal, no event. Boot.reset frees the input.
  reset() {
    if (this.active) this.#release();
    this.active = false;
    this.t = 0;
    this.shot = -1;
    this.woke = false;
  }

  update(dt, skipPressed = false) {
    if (!this.active) return;
    this.t += dt;
    if (skipPressed && this.skippable && this.t >= TUNING.skipDelay) return this.#end(true);
    if (this.t >= this.duration) return this.#end(false);
    this.#apply();
  }

  #apply() {
    const t = this.t;
    // the current shot
    let start = 0;
    let i = 0;
    while (i < this.shots.length - 1 && t >= start + this.shots[i].time) start += this.shots[i++].time;
    const s = this.shots[i];
    if (i !== this.shot) {
      this.shot = i;
      if (s.shake) this.camRig.addTrauma(s.shake);
    }
    const u = ease(Math.min(1, (t - start) / s.time), s.ease);
    lerp3(this.script.pos, s.from, s.to ?? s.from, u);
    lerp3(this.script.look, s.look, s.lookTo ?? s.look, u);
    this.script.fov = s.fov ?? TUNING.fov;
    // wake: the surge, then the core and the body come up
    const w = this.wake;
    const since = t - w.at;
    if (since >= 0 && !this.woke) {
      this.woke = true;
      this.camRig.addTrauma(w.shake);
      this.post.flash = Math.max(this.post.flash, 0.5);
      this.events?.emit('cinematic:wake');
    }
    this.player.view.dormant = since < 0 ? 1 : 1 - THREE.MathUtils.smoothstep(since, 0, w.rise);
    const flicker = since >= 0 && since < TUNING.surge && Math.sin(t * 61) * Math.sin(t * 23 + 1) > 0.15;
    this.post.boost = since < 0 ? TUNING.dark : flicker ? TUNING.peak : THREE.MathUtils.lerp(TUNING.dark, 1, THREE.MathUtils.smoothstep(since, 0, TUNING.surge + TUNING.settle));
    const c = since < 0 ? 0 : Math.min(1, since / TUNING.coreIn) * (flicker ? 0.4 : 1);
    this.player.view.soldierMats.core.emissiveIntensity = this.core * c;
  }

  #release() {
    this.camRig.script = null;
    this.player.view.dormant = 0;
    this.player.view.soldierMats.core.emissiveIntensity = this.core;
    this.post.boost = 1;
  }

  #end(skipped) {
    if (!this.woke) {
      this.woke = true;
      this.events?.emit('cinematic:wake'); // skipped before the surge: what waits for it still happens
    }
    this.#release();
    this.active = false;
    this.controls.locked = false;
    this.controls.ease = 1;
    this.events?.emit('cinematic:done', { skipped }); // an intro.boot waiting for it locks the input again in this call
    saveJSON(STORAGE_KEY, true); // after the emit: a boot started by it still reads "not seen" on a first run
  }
}
