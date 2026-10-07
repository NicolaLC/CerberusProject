// Tiny synthesized SFX (no assets). Context is created on first user gesture.
export class Audio {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  #env(node, peak, decay, gainNode = this.ctx.createGain()) {
    const t = this.ctx.currentTime;
    gainNode.gain.setValueAtTime(peak, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + decay);
    node.connect(gainNode).connect(this.master);
    return gainNode;
  }

  shot(heavy = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = (heavy ? 900 : 1400) + Math.random() * 300;
    f.Q.value = 0.8;
    n.connect(f);
    this.#env(f, 0.9, 0.12);
    n.start(t, Math.random() * 0.3, 0.15);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(heavy ? 110 : 160, t);
    o.frequency.exponentialRampToValueAtTime(heavy ? 32 : 45, t + 0.1);
    this.#env(o, heavy ? 0.95 : 0.7, heavy ? 0.16 : 0.12);
    o.start(t);
    o.stop(t + 0.13);
  }

  zap(volume = 0.3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    this.#env(o, volume, 0.2);
    o.start(t);
    o.stop(t + 0.2);
  }

  tick(crit) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = crit ? 1900 : 1300;
    this.#env(o, 0.12, 0.05);
    o.start(t);
    o.stop(t + 0.06);
  }

  thud() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    n.connect(f);
    this.#env(f, 0.8, 0.25);
    n.start(t, 0, 0.3);
  }

  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
    this.#env(o, 0.25, 0.18);
    o.start(t);
    o.stop(t + 0.2);
  }

  perfect() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [i, f] of [880, 1320, 1760].entries()) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.045);
      g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.045 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.045 + 0.2);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.045);
      o.stop(t + i * 0.045 + 0.22);
    }
  }

  jam() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    this.#env(o, 0.3, 0.22);
    o.start(t);
    o.stop(t + 0.24);
  }

  click() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.value = 2400;
    this.#env(o, 0.08, 0.03);
    o.start(t);
    o.stop(t + 0.04);
  }
}
