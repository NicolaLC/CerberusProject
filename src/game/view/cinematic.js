import * as THREE from 'three';
import { loadJSON, saveJSON } from '../../engine/storage.js';
import { STORAGE_KEY } from './boot.js';
import { damp, lerpAngle } from '../../engine/math.js';

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
// Mid-level cut (`cinematic.cut` piece, `cut: true`): the same shots without the wake (no slump, dark core or exposure surge);
//   `place` { pos, yaw } puts the player there at its start (respawn: clean slate) and the gameplay camera behind it; skippable as
//   its piece says (no "seen once" rule). Each shot start emits `cinematic:shot` { id, index, shot } (Encounter runs its `cue` /
//   `wakeGroup`); a skip emits the shots not reached yet, so what they start still happens. The end emits `cinematic:done`
//   { skipped, cut: true, id }. Enemies hold their fire while any cinematic runs (game.js sets `enemies.holdFire`).
// STEM-00 acting (a cut shot's `stem`, validated by encounter.js `cutProblem`): `stem` { path?, face?, aim?, fire?, fall? } per shot, run by
//   `act(dt)` in the simulate phase (game.js, before the player, so the pose is made from this step's state) from the clock `update` keeps (one frame behind at most).
//   While any shot has a `stem` the player is `scripted` (Player.act: no intent, gravity or collision; the cut writes pos / vel / facing / aim
//   and the usual pose follows from them). `place` happens at the cut's start, `stem` moves the player from there afterwards.
//   - `path` [[x, y, z], ...]: the feet go from where they are at the shot's start through the points at one constant speed (the polyline's
//     length over the shot's `time`), x / y / z all interpolated (no ground check; a shot without `stem` leaves STEM-00 standing). Moving
//     horizontally it plays its walk / run gait (run above the mid speed); at the end of the path it stands there. `fall: true`: airborne pose,
//     the same linear move (a 300 m drop is just a long path), and after the cut the player stays frozen where it fell (no gravity, no fall
//     death) until a scene load or respawn: the level chains on (`next`, level.md).
//   - `face` [x, y, z]: turns (yaw) toward the point and holds it for the shot. `aim: true`: the aiming pose with the gun raised toward `face`
//     (or the fire target); a shot with `fire` aims by itself. Without `face`, it turns the way it moves.
//   - `fire` { group, interval? (0.45) }: the raised gun fires at the live members of enemy group `group`, the nearest to the player first, one
//     every `interval` s from the shot's start: real shot event (Weapon.shotAt: tracer, flash, casing, sound; no ammo, no input) and the member
//     dies through its normal death (Enemies.scriptKill: debris, kill counter, objectives, `puppet:down`) although enemies hold fire. Members
//     still alive when the cut ends or is skipped die then, so a skip leaves the same end state: STEM-00 at the last path point of the last
//     shot that has one, facing as the last shot left it, every `fire` group dead.
//   `fade` (0..1) per shot: a black overlay (view/fade.js) that eases from the previous shot's value (the value at the cut's start for the first;
//   a shot without `fade` keeps the previous one) to this one over the shot. A skip goes to the last value; when control returns it eases out
//   to clear in `TUNING.fadeOut` s, unless the level chains on and fades to black itself (summary.js). `Game.resetRun` clears it.
// State for tests: `active`, `t`, `duration`, `shot` (index), `woke`, `cut`.
export const TUNING = {
  fov: 55, // default shot FOV
  dark: 0.22, // exposure factor before the surge (the bay powered down)
  surge: 0.8, // s of flicker after wake.at
  peak: 1.7, // exposure factor at the flicker's spikes
  settle: 1.2, // s for the exposure to settle to 1 after the surge
  shake: 0.45, // default wake.shake (camera trauma at the surge)
  coreIn: 0.6, // s for the core to come up after the surge
  skipDelay: 0.3, // s before a skip press counts
  interval: 0.45, // s between the scripted rounds of a shot's `stem.fire`
  run: 6, // m/s: a scripted path faster than this plays the run gait (the player's walk is 4.6, sprint 7.4)
  fadeOut: 0.5, // s for a held fade to clear when the cut gives control back
};

const ease = (u, kind) => (kind === 'inOut' ? u * u * (3 - 2 * u) : u);
const _aimAt = new THREE.Vector3();
const lerp3 = (out, a, b, u) => out.set(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);

export class Cinematic {
  constructor({ camRig, controls, post, player, weapon = null, enemies = null, fade = null }) {
    Object.assign(this, { camRig, controls, post, player, weapon, enemies, fade });
    this.active = false;
    this.t = 0;
    this.duration = 0;
    this.shot = -1;
    this.woke = false;
    this.script = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: TUNING.fov };
    this.core = null; // the core's emissive intensity before the cinematic darkened it
    this.cut = false; // a mid-level cut (no wake)
    this.id = null; // the cut's name
    this.acting = false; // some shot has a `stem`: the player is scripted for the cut
    this.stemShot = -1; // the last shot whose stem began
    this.seg = null; // the running path: { pts, lens, total, fall }
    this.faceTo = null; // the shot's face point
    this.aim = false;
    this.fire = null; // the shot's fire: { group, interval, acc }
    this.fireGroups = new Set(); // every group a shot of the cut fires at (what is left dies at the end)
    this.shotStart = 0; // s: when the current shot began
    this.fades = []; // per shot: [from, to] of its fade
    this.frozen = false; // a fall ended: the player stays scripted
    this.hasFade = false;
  }

  listen(events) {
    this.events = events;
    events.on('cinematic:start', (e) => this.start(e));
    return this;
  }

  // params are validated by the piece (encounter.js cinematicProblem).
  start({ shots, wake = {}, skippable = false, cut = false, id = null, place = null }) {
    this.reset();
    this.shots = shots;
    this.cut = cut;
    this.id = id;
    this.duration = shots.reduce((a, s) => a + s.time, 0);
    this.wake = { at: wake.at ?? 0, rise: wake.rise ?? 2, shake: wake.shake ?? TUNING.shake };
    this.skippable = cut ? skippable : skippable && loadJSON(STORAGE_KEY, false) === true; // the intro, like the boot: only once seen
    this.active = true;
    this.controls.locked = true;
    this.controls.ease = 0;
    this.fades = [];
    let f = this.fade?.value ?? 0;
    for (const s of shots) this.fades.push([f, (f = s.fade ?? f)]);
    this.hasFade = shots.some((s) => s.fade != null);
    for (const s of shots) if (s.stem?.fire) this.fireGroups.add(s.stem.fire.group);
    if (cut) {
      this.woke = true; // nothing to wake
      if (place) {
        this.player.respawn({ pos: place.pos, yaw: place.yaw ?? this.player.facing });
        this.camRig.reset(this.player.facing);
      }
      this.acting = shots.some((s) => s.stem);
      if (this.acting) {
        if (this.player.dead) this.player.respawn({ pos: this.player.pos.toArray(), yaw: this.player.facing });
        this.player.act(true);
      }
    } else {
      const mat = this.player.view.soldierMats.core;
      this.core = mat.emissiveIntensity;
      mat.emissiveIntensity = 0;
    }
    this.camRig.script = this.script;
    this.#apply();
    return this;
  }

  // Clean slate (Game.resetRun): camera, pose, core and exposure back to normal, no event. Boot.reset frees the input.
  reset() {
    if (this.active) {
      this.#release();
      if (this.acting) this.player.act(false);
    }
    this.active = false;
    this.t = 0;
    this.shot = -1;
    this.woke = false;
    this.cut = false;
    this.acting = false;
    this.stemShot = -1;
    this.seg = this.faceTo = this.fire = null;
    this.aim = false;
    this.frozen = false;
    this.fireGroups.clear();
    this.fades = [];
    this.hasFade = false;
  }

  update(dt, skipPressed = false) {
    if (!this.active) return;
    this.t += dt;
    if (skipPressed && this.skippable && this.t >= TUNING.skipDelay) return this.#end(true);
    if (this.t >= this.duration) return this.#end(false);
    this.#apply();
  }

  // ---- STEM-00 acting (header). Simulate phase; reads the clock of the last update. ----
  act(dt) {
    if (!this.active || !this.acting) return;
    for (let k = this.stemShot + 1; k <= this.shot; k++) {
      if (this.stemShot >= 0) this.#stemFinish(this.stemShot); // the shot before is over (a whole shot may pass between two steps)
      this.#stemBegin(k);
    }
    this.#stemStep(dt);
  }

  #stemBegin(k) {
    const st = this.shots[k].stem ?? {};
    this.stemShot = k;
    this.seg = null;
    if (st.path) {
      const pts = [this.player.pos.clone(), ...st.path.map((p) => new THREE.Vector3(...p))];
      const lens = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) total += lens[i - 1] = pts[i].distanceTo(pts[i - 1]);
      this.seg = { pts, lens, total, fall: !!st.fall };
    }
    this.faceTo = st.face ? new THREE.Vector3(...st.face) : null;
    this.aim = !!st.aim;
    this.fire = st.fire ? { group: st.fire.group, interval: st.fire.interval ?? TUNING.interval, acc: st.fire.interval ?? TUNING.interval } : null; // the first round at once
  }

  // The shot is over: the feet stand on the path's end, the body faces `face` (or the way it went).
  #stemFinish(k) {
    const p = this.player;
    const seg = this.seg;
    if (seg) {
      const n = seg.pts.length;
      p.pos.copy(seg.pts[n - 1]);
      const last = seg.pts[n - 1];
      for (let i = n - 2; i >= 0; i--) {
        if (seg.pts[i].distanceToSquared(last) > 1e-6) {
          p.facing = Math.atan2(last.x - seg.pts[i].x, last.z - seg.pts[i].z);
          break;
        }
      }
      if (seg.fall) this.frozen = true;
      else this.frozen = false;
    }
    if (this.faceTo) p.facing = Math.atan2(this.faceTo.x - p.pos.x, this.faceTo.z - p.pos.z);
    p.vel.set(0, 0, 0);
    p.airborne = false;
    p.sprinting = false;
    p.aiming = false;
    p.aimPitch = null;
    this.seg = null;
    this.fire = null;
  }

  #stemStep(dt) {
    const p = this.player;
    const seg = this.seg;
    const sh = this.shots[this.shot];
    const u = Math.min(1, Math.max(0, (this.t - this.shotStart) / sh.time));
    p.vel.set(0, 0, 0);
    p.airborne = false;
    p.sprinting = false;
    let heading = null;
    if (seg) {
      let d = seg.total * u;
      let i = 0;
      while (i < seg.lens.length - 1 && d > seg.lens[i]) d -= seg.lens[i++];
      const a = seg.pts[i];
      const b = seg.pts[i + 1] ?? a;
      const w = seg.lens[i] > 1e-6 ? Math.min(1, d / seg.lens[i]) : 1;
      p.pos.lerpVectors(a, b, w);
      if (u < 1 && seg.total > 1e-6) {
        const speed = seg.total / sh.time;
        p.vel.set(b.x - a.x, 0, b.z - a.z);
        const h = p.vel.length();
        if (h > 1e-6) {
          heading = Math.atan2(p.vel.x, p.vel.z);
          p.vel.multiplyScalar(speed / Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)); // horizontal part of the speed
        }
        p.airborne = seg.fall;
        p.sprinting = !seg.fall && p.vel.length() > TUNING.run;
      } else p.airborne = false;
    }
    // fire: the nearest live member of the group, one round every interval
    let target = null;
    const f = this.fire;
    if (f) {
      const live = this.enemies.liveOf(f.group);
      if (live.length) target = live.reduce((best, e) => (e.pos.distanceToSquared(p.pos) < best.pos.distanceToSquared(p.pos) ? e : best));
      else this.fire = null;
    }
    const at = target ? _aimAt.copy(target.pos).setY(target.pos.y + 1.1) : this.faceTo;
    p.aiming = this.aim || !!target;
    let yaw = heading;
    if (at) yaw = Math.atan2(at.x - p.pos.x, at.z - p.pos.z);
    if (yaw != null) p.facing = target && f.acc >= f.interval ? yaw : lerpAngle(p.facing, yaw, damp(14, dt));
    p.aimPitch = p.aiming && at ? THREE.MathUtils.clamp(Math.atan2(at.y - (p.pos.y + 1.4), Math.hypot(at.x - p.pos.x, at.z - p.pos.z)), -1, 1) : 0;
    if (target) {
      f.acc += dt;
      while (f.acc >= f.interval && target?.alive) {
        f.acc -= f.interval;
        this.weapon?.shotAt(at);
        this.enemies.scriptKill(target, p.pos);
        const live = this.enemies.liveOf(f.group);
        target = live.length ? live.reduce((best, e) => (e.pos.distanceToSquared(p.pos) < best.pos.distanceToSquared(p.pos) ? e : best)) : null;
        if (target) at.copy(target.pos).setY(target.pos.y + 1.1);
      }
    }
  }

  // The end of the cut (played or skipped): every shot not run yet runs its end state, what the fire groups have left dies,
  // the player is free again (after a fall it stays where it fell).
  #stemEnd() {
    const p = this.player;
    for (let k = Math.max(0, this.stemShot); k < this.shots.length; k++) {
      if (k !== this.stemShot) this.#stemBegin(k); // (begin sets stemShot)
      this.#stemFinish(k);
    }
    for (const g of this.fireGroups) for (const e of this.enemies.liveOf(g)) this.enemies.scriptKill(e, p.pos);
    if (this.frozen) {
      p.vel.set(0, 0, 0);
      p.vy = 0;
    } else p.act(false);
  }

  #apply() {
    const t = this.t;
    // the current shot
    let start = 0;
    let i = 0;
    while (i < this.shots.length - 1 && t >= start + this.shots[i].time) start += this.shots[i++].time;
    const s = this.shots[i];
    if (i !== this.shot) {
      for (let k = this.shot + 1; k <= i; k++) this.events?.emit('cinematic:shot', { id: this.id, index: k, shot: this.shots[k] });
      this.shot = i;
      if (s.shake) this.camRig.addTrauma(s.shake);
    }
    const u = ease(Math.min(1, (t - start) / s.time), s.ease);
    this.shotStart = start;
    if (this.hasFade) this.fade?.set(this.fades[i][0] + (this.fades[i][1] - this.fades[i][0]) * u);
    lerp3(this.script.pos, s.from, s.to ?? s.from, u);
    lerp3(this.script.look, s.look, s.lookTo ?? s.look, u);
    this.script.fov = s.fov ?? TUNING.fov;
    if (this.cut) return;
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
    if (this.cut) return;
    this.player.view.dormant = 0;
    this.player.view.soldierMats.core.emissiveIntensity = this.core;
    this.post.boost = 1;
  }

  #end(skipped) {
    for (let k = this.shot + 1; k < this.shots.length; k++) this.events?.emit('cinematic:shot', { id: this.id, index: k, shot: this.shots[k] }); // skipped past them
    if (!this.woke) {
      this.woke = true;
      this.events?.emit('cinematic:wake'); // skipped before the surge: what waits for it still happens
    }
    if (this.acting) this.#stemEnd();
    if (this.hasFade) this.fade?.set(this.fades[this.fades.length - 1][1]); // the last shot's value (a skip jumps there)
    this.#release();
    this.active = false;
    this.controls.locked = false;
    this.controls.ease = 1;
    if (this.hasFade) this.fade?.to(0, TUNING.fadeOut); // control is back: the overlay clears (a chain's fade-to-black takes over, summary.js)
    if (this.cut) return void this.events?.emit('cinematic:done', { skipped, cut: true, id: this.id });
    this.events?.emit('cinematic:done', { skipped }); // an intro.boot waiting for it locks the input again in this call
    saveJSON(STORAGE_KEY, true); // after the emit: a boot started by it still reads "not seen" on a first run
  }
}
