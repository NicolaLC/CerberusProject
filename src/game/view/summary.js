import { bound } from '../controls.js';

// Mission complete screen (#15): the debrief after `mission:complete`. STEM-00's terminal in the art-style.md look (blue-black,
// scanlines, monospace, amber for STEM-00's own light, cold white for the figures; no red, no faces). Presentation only.
//
// Flow: `mission:complete` -> the game slows down (juice.hold) for TUNING.delay real seconds so the last kill and the gate are seen ->
// the report opens: time stands almost still, the input is locked, the pointer is released (host.release) and a RESTART button
// (click, Enter, pad A) reloads the scene (host.restart). `Game.resetRun` (scene load, Workshop play / restart / edit) calls reset():
// the overlay, its key listener and the slow-down are gone. Nothing here outlives a level, nothing is left on the window.
// Stats come from RunStats (run-stats.js); salvage is a placeholder until Progression (#7) lands.
export const TUNING = {
  delay: 2.2, // real s between the mission's end and the report
  slow: 0.25, // game time scale while waiting
  frozen: 0.02, // game time scale behind the report
  armed: 1.0, // s after the report opens before RESTART reacts (a trigger finger on fire / jump must not skip it)
};

const clock = (s) => {
  const t = Math.max(0, Math.floor(s));
  const m = Math.floor(t / 60);
  return `${String(m).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

export class Summary {
  // host: { stats: RunStats, juice, controls, title(): string, release(): free the pointer for the button, restart(): reload the scene }
  constructor(host) {
    this.host = host;
    this.el = document.getElementById('summary');
    this.state = 'idle'; // 'idle' | 'waiting' (slow motion) | 'open'
    this.t = 0; // real s in the current state
    this.button = null;
    this.onKey = (e) => {
      if (this.t >= TUNING.armed && !e.repeat && bound('restart', e.code)) {
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
      this.state = 'waiting';
      this.t = 0;
      this.host.juice.hold(TUNING.slow);
    });
    return this;
  }

  // Real seconds (the present phase, not while paused). padPressed: the pad's RESTART press this frame.
  update(realDt, padPressed = false) {
    if (this.state === 'idle') return;
    this.t += realDt;
    if (this.state === 'waiting' && this.t >= TUNING.delay) this.#show();
    else if (this.state === 'open' && padPressed && this.t >= TUNING.armed) setTimeout(() => this.open && this.restart(), 0); // never reload inside a frame
  }

  restart() {
    if (!this.open) return;
    this.host.restart(); // loads the scene: resetRun calls reset()
  }

  // Back to nothing: overlay emptied and hidden, listener removed, time and input free.
  reset() {
    if (this.state === 'open') {
      removeEventListener('keydown', this.onKey);
      this.host.controls.locked = false; // (Juice.reset, also run by resetRun, ends the slow-down)
    }
    this.state = 'idle';
    this.t = 0;
    this.button = null;
    this.el.hidden = true;
    this.el.replaceChildren();
  }

  #show() {
    const { host, el } = this;
    this.state = 'open';
    this.t = 0;
    host.juice.hold(TUNING.frozen);
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
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'RESTART';
    b.addEventListener('click', () => this.t >= TUNING.armed && this.restart());
    this.button = b;
    panel.append(b, div('hint', 'ENTER  /  A'));
    el.replaceChildren(div('scan'), panel);
    el.hidden = false;
    addEventListener('keydown', this.onKey);
  }
}
