// Black screen overlay (`#fade`, above the HUD and the debrief, under the menu panel): `value` 0 (clear) .. 1 (black).
// Two users: a `cinematic.cut` shot's `fade` (view/cinematic.js sets the value every frame) and the level chain (view/summary.js
// fades to black before the next scene loads). Presentation only; `Game.resetRun` calls reset(). Nothing outlives a level.
export class Fade {
  constructor(el = document.getElementById('fade')) {
    this.el = el;
    this.value = 0;
    this.target = 0;
    this.rate = 0; // per s while easing toward `target`
    this.#paint();
  }

  // Jumps to `v` (0..1) and stops any easing.
  set(v) {
    this.value = this.target = Math.min(1, Math.max(0, v));
    this.rate = 0;
    this.#paint();
  }

  // Eases to `v` over `seconds` of update() time (real time: the game may be in slow motion behind it).
  to(v, seconds) {
    this.target = Math.min(1, Math.max(0, v));
    this.rate = Math.abs(this.target - this.value) / Math.max(1e-3, seconds);
  }

  update(dt) {
    if (this.value === this.target) return;
    const step = this.rate * dt;
    this.value = Math.abs(this.target - this.value) <= step ? this.target : this.value + Math.sign(this.target - this.value) * step;
    this.#paint();
  }

  reset() {
    this.set(0);
  }

  #paint() {
    if (!this.el) return;
    this.el.style.opacity = String(this.value);
    this.el.hidden = this.value <= 0;
  }
}
