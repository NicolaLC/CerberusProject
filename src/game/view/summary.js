import { bound } from '../controls.js';

// Mission complete screen (#15): the debrief after `mission:complete`. STEM-00's terminal in the art-style.md look (blue-black,
// scanlines, monospace, amber for STEM-00's own light, cold white for the figures; no red, no faces). Presentation only.
//
// Flow: `mission:complete` -> the game slows down (juice.hold) for TUNING.delay real seconds so the last kill and the gate are seen ->
// the report opens: time stands almost still, the input is locked, the pointer is released (host.release) and a RESTART button
// (click, Enter, pad A) reloads the scene (host.restart). `Game.resetRun` (scene load, Workshop play / restart / edit) calls reset():
// the overlay, its key listener and the slow-down are gone. Nothing here outlives a level, nothing is left on the window.
// Level chaining (level.md `next` / `debrief`, `host.next()` -> { scene, debrief }):
// - `next` with `debrief: false`: no report. The input locks, the screen fades to black (host.fade, TUNING.fadeOut s; only TUNING.beat s
//   when it already is black, e.g. after a cut that ended black) and `host.advance(scene)` loads the next scene from a timer (never inside a frame).
// - `next` with the debrief on: the report's primary button is CONTINUE (Enter / pad A, bindings `restart`) and loads `next`; RESTART is the
//   secondary one (R / pad X, binding `retry`). Without `next` nothing changes: RESTART is the only button (Enter / pad A, or R / pad X).
// Stats come from RunStats (run-stats.js); salvage is a placeholder until Progression (#7) lands.
export const TUNING = {
  delay: 2.2, // real s between the mission's end and the report
  slow: 0.25, // game time scale while waiting
  frozen: 0.02, // game time scale behind the report
  armed: 1.0, // s after the report opens before RESTART reacts (a trigger finger on fire / jump must not skip it)
  fadeOut: 1.0, // real s to fade to black before a chained scene without debrief loads
  beat: 0.4, // real s to wait when the screen is black already
};

const clock = (s) => {
  const t = Math.max(0, Math.floor(s));
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export class Summary {
  // host: { stats: RunStats, juice, controls, fade: Fade, title(): string, next(): { scene, debrief }, advance(scene): load the chained scene,
  //         release(): free the pointer for the button, restart(): reload the scene }
  constructor(host) {
    this.host = host;
    this.el = document.getElementById('summary');
    this.state = 'idle'; // 'idle' | 'waiting' (slow motion) | 'open' | 'leaving' (fading out to the next scene) | 'gone' (the load is queued)
    this.t = 0; // real s in the current state
    this.button = null; // the primary button (CONTINUE with a `next`, else RESTART)
    this.alt = null; // RESTART beside CONTINUE
    this.chain = null; // the `next` scene of this completion
    this.beat = 0; // s a 'leaving' state lasts
    this.onKey = (e) => {
      if (this.t < TUNING.armed || e.repeat) return;
      if (bound('restart', e.code)) {
        e.preventDefault();
        this.primary();
      } else if (bound('retry', e.code)) {
        e.preventDefault();
        this.restart();
      }
    };
  }

  get open() {
    return this.state === 'open';
  }

  listen(events) {
    events.on('mission:complete', () => {
      if (this.state !== 'idle') return;
      const { scene, debrief } = this.host.next();
      this.chain = scene;
      if (scene && !debrief) return this.#leave();
      this.state = 'waiting';
      this.t = 0;
      // a cut that ended black (the Skyway's fall): stay black, no slow motion to watch, the report comes up out of the dark
      this.dark = this.host.fade.value >= 0.999;
      if (this.dark) this.host.fade.set(1);
      this.host.juice.hold(TUNING.slow);
    });
    return this;
  }

  // Real seconds (the present phase, not while paused). padPressed: the pad's primary press this frame (A), retryPressed: RESTART's (X).
  update(realDt, padPressed = false, retryPressed = false) {
    if (this.state === 'idle' || this.state === 'gone') return;
    this.t += realDt;
    if (this.state === 'waiting' && this.t >= (this.dark ? TUNING.beat : TUNING.delay)) this.#show();
    else if (this.state === 'leaving' && this.t >= this.beat) {
      this.state = 'gone';
      setTimeout(() => this.state === 'gone' && this.host.advance(this.chain), 0); // never reload inside a frame
    } else if (this.state === 'open' && this.t >= TUNING.armed) {
      if (padPressed) setTimeout(() => this.open && this.primary(), 0); // never reload inside a frame
      else if (retryPressed) setTimeout(() => this.open && this.restart(), 0);
    }
  }

  // Enter / pad A / the primary button: CONTINUE to the next scene when the level has one, else RESTART.
  primary() {
    if (this.chain) this.proceed();
    else this.restart();
  }

  restart() {
    if (!this.open) return;
    this.host.restart(); // loads the scene: resetRun calls reset()
  }

  proceed() {
    if (!this.open || !this.chain) return;
    this.host.advance(this.chain); // loads the scene: resetRun calls reset()
  }

  // No report: lock the input, fade to black, then the next scene (see the header).
  #leave() {
    const { host } = this;
    this.state = 'leaving';
    this.t = 0;
    this.beat = host.fade.value >= 0.999 ? TUNING.beat : TUNING.fadeOut;
    host.controls.locked = true;
    host.fade.to(1, TUNING.fadeOut);
  }

  // Back to nothing: overlay emptied and hidden, listener removed, time and input free.
  reset() {
    if (this.state === 'open') removeEventListener('keydown', this.onKey);
    if (this.state === 'open' || this.state === 'leaving' || this.state === 'gone') this.host.controls.locked = false; // (Juice.reset, also run by resetRun, ends the slow-down)
    this.state = 'idle';
    this.t = 0;
    this.button = this.alt = this.chain = null;
    this.dark = false;
    this.el.hidden = true;
    this.el.replaceChildren();
  }

  #show() {
    const { host, el } = this;
    this.state = 'open';
    this.t = 0;
    host.juice.hold(TUNING.frozen);
    if (this.dark) host.fade.to(0, 0.6); // the black gives way to the report (its own dark backdrop hides the frozen frame)
    host.controls.locked = true;
    host.release();
    const s = host.stats.snapshot();
    const acc = s.shots ? `${Math.round(s.accuracy * 100)}%  (${Math.min(s.hits, s.shots)} / ${s.shots})` : '—';
    const rows = [
      ['TIME', clock(s.time)],
      ['ACCURACY', acc],
      ['HEADSHOTS', String(s.headshots)],
      ['PERFECT RELOADS', String(s.perfectReloads)],
      ['SALVAGE COLLECTED', '—'], // placeholder until Progression (#7)
      ['HOSTILES DESTROYED', String(s.kills)],
    ];
    const div = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      if (text != null) d.textContent = text;
      return d;
    };
    const panel = div('panel');
    panel.append(div('head', '> MISSION COMPLETE'), div('sub', host.title()));
    const list = div('rows');
    rows.forEach(([k, v], i) => {
      const row = div('row');
      row.style.setProperty('--i', i);
      row.append(div('k', k), div('dots'), div('v', v));
      row.dataset.stat = k;
      list.append(row);
    });
    panel.append(list);
    const button = (text, action, alt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.dataset.action = action;
      if (alt) b.className = 'alt';
      b.addEventListener('click', () => this.t >= TUNING.armed && (action === 'continue' ? this.proceed() : this.restart()));
      return b;
    };
    if (this.chain) {
      this.button = button('CONTINUE', 'continue');
      this.alt = button('RESTART', 'restart', true);
      panel.append(this.button, this.alt, div('hint', 'ENTER  /  A  CONTINUE      R  /  X  RESTART'));
    } else {
      this.button = button('RESTART', 'restart');
      panel.append(this.button, div('hint', 'ENTER  /  A'));
    }
    el.replaceChildren(div('scan'), panel);
    el.hidden = false;
    addEventListener('keydown', this.onKey);
  }
}
