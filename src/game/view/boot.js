import { loadJSON, saveJSON } from '../../engine/storage.js';

// Boot intro (#13, `intro.boot` piece in encounter.js): a full-screen overlay over the live scene while STEM-00 boots.
// Black -> scanlines and static -> diagnostic lines typed in (cold white, monospace) -> the view fades in from black with an
// exposure ramp (the optics coming online). A line containing HIVEMIND LINK: LOST flickers violet-magenta (art-style.md).
// Presentation plus the input lock: while `active`, `controls.locked` is set (controls.js); when it ends, `controls.ease`
// ramps 0 -> 1 over TUNING.ease s so move and look return smoothly (the camera never snaps). Ends emit `intro:done` { skipped }.
//
// Started by the `intro:start` event { lines, duration, skippable } (Encounter, first play frame, after Game.resetRun) and
// updated in the `present` phase with the game's scaled dt, so pause freezes it and headless stepping drives it.
// Skip: only when `skippable` and the intro was seen once before (localStorage `cerberus.introSeen`); the game passes the
// press (fire / jump / interact / pad A) to `update`. The flag is set when an intro completes or is skipped.
// State for tests: `active`, `t`, `duration`, `inputLocked`, `canSkip`, `seen`, `lines` (typed so far), `fade` (0..1).
export const TUNING = {
  duration: 12, // s, default
  maxDuration: 20, // s
  fade: 1.6, // s of fade-in at the end (at most 30% of the duration)
  lead: 0.6, // s of black, scanlines and static before the first line (at most 10% of the duration)
  hold: 0.6, // s all lines stay readable before the fade (at most 6% of the duration)
  gap: 8, // typing pause after each line, in characters
  minCps: 14, // characters per second at least: a short text finishes early and holds, it does not crawl
  ease: 0.6, // s for move and look to come back
  skipDelay: 0.3, // s before a skip press counts (the click that starts the run is not a skip)
  peak: 2.4, // exposure factor at the start of the fade, easing down to 1
  maxLines: 18, // lines kept on screen
};
export const STORAGE_KEY = 'cerberus.introSeen';
export const HIVE = 'HIVEMIND LINK: LOST';

export class Boot {
  constructor({ controls, post }) {
    Object.assign(this, { controls, post });
    this.el = document.getElementById('boot');
    this.active = false;
    this.inputLocked = false;
    this.t = 0;
    this.duration = TUNING.duration;
    this.lines = []; // texts of the current intro
    this.seen = false;
    this.canSkip = false; // skippable piece and seen before
    this.fade = 0; // 0 black .. 1 clear
    this.easing = false; // control coming back after the end
    this.src = [];
    this.rows = [];
    this.noise = null; // static texture (data URL), built once
  }

  listen(events) {
    this.events = events;
    events.on('intro:start', (e) => this.start(e));
    return this;
  }

  // Begins an intro. params { lines, duration?, skippable? } are validated by the piece (encounter.js introBootProblem).
  start({ lines, duration = TUNING.duration, skippable = true }) {
    this.reset();
    const { el, controls } = this;
    this.lines = lines.slice();
    this.duration = duration;
    this.seen = loadJSON(STORAGE_KEY, false) === true;
    this.canSkip = skippable && this.seen;
    this.active = this.inputLocked = true;
    this.t = 0;
    this.typedN = this.doneN = 0; // characters / finished lines already ticked (ui:type)
    controls.locked = true;
    controls.ease = 0;
    // pacing: every line costs its characters plus a short pause; all of it fits between the lead and the hold + fade
    const fade = Math.min(TUNING.fade, duration * 0.3);
    this.fadeStart = duration - fade;
    this.fadeLen = fade;
    this.lead = Math.min(TUNING.lead, duration * 0.1);
    const typeEnd = Math.max(this.lead + 0.1, this.fadeStart - Math.min(TUNING.hold, duration * 0.06));
    this.units = this.lines.map((l) => l.length + TUNING.gap);
    this.rate = Math.max(TUNING.minCps, this.units.reduce((a, b) => a + b, 0) / (typeEnd - this.lead)); // fits the duration, however long the text
    this.noise ??= this.#makeNoise();
    el.replaceChildren();
    el.hidden = false;
    el.style.opacity = '1';
    this.stat = this.#div('static');
    if (this.noise) this.stat.style.backgroundImage = `url(${this.noise})`;
    this.box = this.#div('lines');
    this.scan = this.#div('scan');
    this.skipEl = this.#div('skip');
    this.skipEl.textContent = 'skip';
    this.skipEl.hidden = !this.canSkip;
    el.append(this.stat, this.box, this.scan, this.skipEl);
    this.rows = [];
    this.#draw();
    return this;
  }

  // Clean slate (Game.resetRun: scene load, Workshop play / restart / edit): overlay gone, input free, no event.
  reset() {
    this.active = this.inputLocked = this.easing = false;
    this.t = 0;
    this.fade = 0;
    this.lines = [];
    this.rows = [];
    this.controls.locked = false;
    this.controls.ease = 1;
    this.post.boost = 1;
    if (this.el) {
      this.el.hidden = true;
      this.el.replaceChildren();
    }
  }

  skip() {
    if (this.active && this.canSkip && this.t >= TUNING.skipDelay) this.#end(true);
  }

  // dt: scaled game seconds (does not run while paused). skipPressed: a fire / jump / interact / pad A press this frame.
  update(dt, skipPressed = false) {
    if (this.easing) {
      const c = this.controls;
      c.ease = Math.min(1, c.ease + dt / TUNING.ease);
      if (c.ease >= 1) this.easing = false;
    }
    if (!this.active) return;
    this.t += dt;
    if (skipPressed && this.canSkip && this.t >= TUNING.skipDelay) return this.#end(true);
    if (this.t >= this.duration) return this.#end(false);
    this.#draw();
  }

  #end(skipped) {
    this.active = this.inputLocked = false;
    this.fade = 1;
    this.post.boost = 1;
    this.el.hidden = true;
    this.el.replaceChildren();
    this.rows = [];
    this.controls.locked = false;
    this.controls.ease = 0; // update() ramps it back
    this.easing = true;
    saveJSON(STORAGE_KEY, true);
    this.events?.emit('intro:done', { skipped });
  }

  #draw() {
    const t = this.t;
    // typed text: characters of each line reached by now
    const typed = Math.max(0, (t - this.lead) * this.rate);
    let from = 0;
    let chars = 0;
    let done = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const n = Math.min(this.lines[i].length, Math.max(0, Math.floor(typed - from)));
      chars += n;
      if (n === this.lines[i].length) done++;
      from += this.units[i];
      if (n <= 0 && !this.rows[i]) break;
      this.#row(i, n, typed < from && typed >= from - this.units[i]);
    }
    // one typing tick per frame that typed something (the audio throttles); `end` when a line finished
    if (chars > this.typedN) this.events?.emit('ui:type', { end: done > this.doneN });
    this.typedN = chars;
    this.doneN = done;
    // the picture: static and scanlines come up first, then everything clears while the exposure settles
    const p = t < this.fadeStart ? 0 : Math.min(1, (t - this.fadeStart) / this.fadeLen);
    this.fade = p * p * (3 - 2 * p);
    this.el.style.opacity = (1 - this.fade).toFixed(3);
    this.stat.style.opacity = (Math.min(1, t / 0.3) * (0.35 - 0.2 * Math.min(1, t / this.duration))).toFixed(3);
    this.stat.style.backgroundPosition = `${(Math.floor(t * 24) * 37) % 192}px ${(Math.floor(t * 24) * 91) % 192}px`;
    this.scan.style.opacity = Math.min(1, Math.max(0, (t - 0.15) / 0.3)).toFixed(3);
    this.post.boost = 1 + (TUNING.peak - 1) * (1 - this.fade) ** 2 * (p > 0 ? 1 : 0);
  }

  // line i with its first n characters, the HIVE text coloured; `cur` = it shows the cursor
  #row(i, n, cur) {
    let row = this.rows[i];
    if (!row) {
      row = this.rows[i] = { el: this.#div(null, this.box), n: -1, cur: null };
      while (this.box.children.length > TUNING.maxLines) this.box.firstChild.remove();
    }
    if (row.cur !== cur) {
      row.cur = cur;
      row.el.classList.toggle('cur', cur);
    }
    if (row.n === n) return;
    row.n = n;
    const text = this.lines[i];
    const a = text.toUpperCase().indexOf(HIVE);
    const b = a + HIVE.length;
    const parts = [];
    if (a < 0 || n <= a) parts.push(text.slice(0, n));
    else {
      parts.push(text.slice(0, a));
      const hive = document.createElement('span');
      hive.className = 'hive';
      hive.textContent = text.slice(a, Math.min(n, b));
      parts.push(hive);
      if (n > b) parts.push(text.slice(b, n));
    }
    row.el.replaceChildren(...parts);
  }

  #div(cls, parent = null) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    parent?.append(d);
    return d;
  }

  #makeNoise() {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 192;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(192, 192);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.random() < 0.5 ? 0 : 90 + Math.random() * 165;
        img.data[i] = img.data[i + 1] = v;
        img.data[i + 2] = v * 1.05;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c.toDataURL();
    } catch {
      return null; // no canvas: scanlines and text only
    }
  }
}
