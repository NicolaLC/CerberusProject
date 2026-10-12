// STEM-00 log lines (#40, instructions/narrative.md): one terminal-style subtitle at a time, bottom centre above the HUD,
// typed out with a blinking cursor (CSS), held, then faded. Lines come from `log.line` pieces (encounter.js) through
// `log:say` { text, priority }, or from `say()` directly. A `high` line interrupts the current one; `normal` lines wait
// their turn (when the queue backs up the oldest waiting one is dropped). Every line shown is kept in `entries`
// ({ text, t }: t = s since the run began) for the pause-menu Log (not built yet). Presentation only: a DOM element, no scene objects.
export const TUNING = {
  cps: 40, // characters typed per second
  hold: 2.5, // s, minimum hold after typing
  holdPerChar: 0.06, // s per character, when longer than `hold`
  fade: 0.5, // s
  queue: 4, // normal lines waiting at most
};

export class Log {
  constructor() {
    this.el = document.getElementById('log');
    this.entries = [];
    this.queue = []; // texts waiting (normal priority)
    this.line = null; // { text, t, life } being shown
    this.time = 0;
    this.shown = '';
    this.voice = 'stem'; // of the line being shown
  }

  listen(events) {
    events.on('log:say', (e) => this.say(e.text, e));
    return this;
  }

  // voice 'announcer' (the HiveMind PA, `log.line` voice): shown at once, replaces the current line, styled apart (`#log.announcer`).
  say(text, { priority = 'normal', voice = 'stem' } = {}) {
    if (voice === 'announcer') return this.#show(text, voice);
    if (priority === 'high' || !this.line) return this.#show(text);
    this.queue.push(text);
    if (this.queue.length > TUNING.queue) this.queue.shift();
  }

  // Start of a run (Game.resetRun: scene load, Workshop play / restart / edit): nothing shown, queued or recorded.
  reset() {
    this.entries.length = this.queue.length = 0;
    this.line = null;
    this.time = 0;
    this.voice = 'stem';
    this.el.classList.remove('announcer');
    this.#draw('', 0);
  }

  #show(text, voice = 'stem') {
    const n = text.length;
    this.line = { text, t: 0, life: n / TUNING.cps + Math.max(TUNING.hold, TUNING.holdPerChar * n) + TUNING.fade };
    this.entries.push(voice === 'stem' ? { text, t: this.time } : { text, t: this.time, voice });
    this.voice = voice;
    this.el.classList.toggle('announcer', voice === 'announcer');
  }

  update(dt) {
    this.time += dt;
    const l = this.line;
    if (!l) return;
    l.t += dt;
    if (l.t >= l.life) {
      this.line = null;
      if (this.queue.length) this.#show(this.queue.shift());
      else this.#draw('', 0);
      return;
    }
    this.#draw(l.text.slice(0, Math.floor(l.t * TUNING.cps)), Math.min(1, (l.life - l.t) / TUNING.fade));
  }

  #draw(text, opacity) {
    if (text !== this.shown) this.el.textContent = this.shown = text;
    const o = opacity.toFixed(2);
    if (this.el.style.opacity !== o) this.el.style.opacity = o;
  }
}
