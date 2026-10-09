import arShot from '../../assets/sfx/ar-shot.mp3';

// SFX: synthesized at runtime, plus recorded samples (ElevenLabs, see credits.md) where one exists.
// A sample replaces its synth sound once decoded; until then (or if loading fails) the synth plays.
// Context is created on first user gesture.
// [url, gain, pitch spread (±, playback rate)] per sample id
const SAMPLES = {
  rifle: [arShot, 0.6, 0.04], // KR-7 / AR single shot
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.samples = {}; // id -> decoded AudioBuffer
  }

  // Sound reactions to gameplay events.
  listen(events) {
    events.on('weapon:shot', (s) => {
      if (s.gun === 'sniper') this.snipe();
      else if (s.beam) this.rail();
      else if (!this.sample(s.gun)) this.shot(s.heavy);
      if (s.mag <= 0.2) this.lowMag(s.mag); // last rounds: a rising click warns before the mag runs dry
    });
    events.on('weapon:hit', (h) => (h.killed ? this.kill() : this.hit(h.weak ? 'weak' : h.crit ? 'head' : 'body')));
    events.on('weapon:switch', () => this.click());
    events.on('weapon:charge', (on) => on && this.railCharge());
    events.on('weapon:dry', () => this.click());
    events.on('weapon:reload', (kind) => (kind === 'perfect' ? this.perfect() : kind === 'jam' ? this.jam() : this.click()));
    events.on('puppet:down', () => this.thud());
    events.on('player:hurt', () => this.thud());
    events.on('player:jet', () => this.jet());
    events.on('player:land', () => this.land());
    events.on('bolt:fired', () => this.zap(0.12));
    events.on('blast', (b) => this.boom(Math.min(1.2, 0.4 + b.radius / 6)));
    events.on('boss:leg', () => this.boom(0.8));
    events.on('boss:dead', () => this.boom(1.4));
    events.on('boss:step', () => this.thud());
    events.on('boss:charge', () => this.charge());
    events.on('boss:stomp', () => this.charge());
    events.on('boss:mortar', () => this.zap(0.25));
    events.on('boss:wake', () => this.charge());
    events.on('pickup:collected', () => this.pickup());
    return this;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume(); // e.g. created from a gamepad press (no user gesture)
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    for (const [id, [url]] of Object.entries(SAMPLES)) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => (this.samples[id] = buf))
        .catch(() => {}); // keep the synth sound
    }
  }

  // Plays the recorded sample for `id` (slightly detuned each time so repeats don't sound like a loop).
  // False if there is none (yet): the caller falls back to its synth sound.
  sample(id) {
    const buf = this.ctx && this.samples[id];
    if (!buf) return false;
    const [, gain, spread] = SAMPLES[id];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master);
    src.start();
    return true;
  }

  #env(node, peak, decay, gainNode = this.ctx.createGain()) {
    const t = this.ctx.currentTime;
    gainNode.gain.setValueAtTime(peak, t);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + decay);
    node.connect(gainNode).connect(this.master);
    return gainNode;
  }

  // Layered gunshot: transient crack (bandpassed noise), body thump (pitch-dropping sine), room tail
  // (lowpassed noise, longer). Small random detune per shot so automatic fire doesn't sound like a loop.
  shot(heavy = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = 0.92 + Math.random() * 0.16;
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = (heavy ? 1000 : 1700) * v;
    bp.Q.value = 0.9;
    crack.connect(bp);
    this.#env(bp, heavy ? 0.85 : 1.0, heavy ? 0.09 : 0.07);
    crack.start(t, Math.random() * 0.3, 0.1);

    const body = this.ctx.createOscillator();
    body.frequency.setValueAtTime((heavy ? 120 : 175) * v, t);
    body.frequency.exponentialRampToValueAtTime(heavy ? 34 : 48, t + 0.09);
    this.#env(body, heavy ? 1.0 : 0.75, heavy ? 0.15 : 0.11);
    body.start(t);
    body.stop(t + 0.16);

    const tail = this.ctx.createBufferSource();
    tail.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = heavy ? 700 : 1100;
    tail.connect(lp);
    this.#env(lp, heavy ? 0.35 : 0.28, heavy ? 0.42 : 0.32);
    tail.start(t, Math.random() * 0.1, 0.45);

    if (heavy) {
      // mechanical clack of the MG action
      const clack = this.ctx.createOscillator();
      clack.type = 'square';
      clack.frequency.value = 2400 * v;
      this.#env(clack, 0.05, 0.02);
      clack.start(t + 0.012);
      clack.stop(t + 0.04);
    }
  }

  // Sniper: sharper, louder crack, deep boom, long rolling tail, then the bolt worked back and forth.
  snipe() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    crack.connect(hp);
    this.#env(hp, 1.3, 0.06);
    crack.start(t, Math.random() * 0.3, 0.08);

    const body = this.ctx.createOscillator();
    body.frequency.setValueAtTime(140, t);
    body.frequency.exponentialRampToValueAtTime(28, t + 0.2);
    this.#env(body, 1.2, 0.26);
    body.start(t);
    body.stop(t + 0.3);

    const tail = this.ctx.createBufferSource();
    tail.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    tail.connect(lp);
    this.#env(lp, 0.5, 0.9);
    tail.start(t, 0, 0.5);

    for (const [at, f] of [[0.38, 1500], [0.55, 1100]]) {
      const bolt = this.ctx.createOscillator();
      bolt.type = 'square';
      bolt.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setValueAtTime(0.06, t + at);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.04);
      bolt.connect(g).connect(this.master);
      bolt.start(t + at);
      bolt.stop(t + at + 0.05);
    }
  }

  lowMag(frac) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 2200 + (0.2 - frac) * 6000; // pitch rises as the mag empties
    this.#env(o, 0.07, 0.04);
    o.start(t + 0.02);
    o.stop(t + 0.07);
  }

  // Machine gun barrel spin whine, 0..1 (continuous voice, created on first use).
  spin(level) {
    if (!this.ctx || Math.abs(level - (this.spinLevel ?? -1)) < 0.02) return;
    this.spinLevel = level;
    if (!this.spinOsc) {
      this.spinOsc = this.ctx.createOscillator();
      this.spinOsc.type = 'sawtooth';
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 2;
      this.spinGain = this.ctx.createGain();
      this.spinGain.gain.value = 0;
      this.spinOsc.connect(f).connect(this.spinGain).connect(this.master);
      this.spinOsc.start();
    }
    const t = this.ctx.currentTime;
    this.spinOsc.frequency.setTargetAtTime(180 + level * 520, t, 0.05);
    this.spinGain.gain.setTargetAtTime(level > 0.01 ? 0.03 + level * 0.05 : 0, t, 0.06);
  }

  // Hit confirm: body = dry tick, head = bright double ping, weak spot = higher, sparkly.
  hit(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const tone = (type, f, at, peak, dur) => {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(peak, t + at);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + dur);
      o.connect(g).connect(this.master);
      o.start(t + at);
      o.stop(t + at + dur + 0.01);
    };
    if (kind === 'body') tone('square', 1300, 0, 0.1, 0.045);
    else if (kind === 'head') {
      tone('triangle', 2100, 0, 0.22, 0.08);
      tone('triangle', 3150, 0.03, 0.14, 0.08);
    } else {
      tone('triangle', 2600, 0, 0.22, 0.07);
      tone('sine', 3900, 0.025, 0.16, 0.1);
      tone('sine', 5200, 0.05, 0.08, 0.1);
    }
  }

  // Kill confirm: low thunk + bright chime, unmistakable over gunfire.
  kill() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    this.#env(o, 0.5, 0.16);
    o.start(t);
    o.stop(t + 0.17);
    for (const [i, f] of [1568, 2349].entries()) {
      const c = this.ctx.createOscillator();
      c.type = 'triangle';
      c.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + 0.03 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.04 + i * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3 + i * 0.05);
      c.connect(g).connect(this.master);
      c.start(t + 0.03 + i * 0.05);
      c.stop(t + 0.32 + i * 0.05);
    }
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

  // Explosion: low noise burst with a long tail plus a sub drop.
  boom(size = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.6 * size);
    n.connect(f);
    this.#env(f, 1.1 * size, 0.7 * size);
    n.start(t, 0, 0.5);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(25, t + 0.5);
    this.#env(o, 1.0 * size, 0.6);
    o.start(t);
    o.stop(t + 0.7);
  }

  // Railgun: capacitor whine up to the shot (weapon charge time), then a hard crack and a falling zap.
  railCharge() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.42);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.5);
  }

  rail() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const crack = this.ctx.createBufferSource();
    crack.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    crack.connect(hp);
    this.#env(hp, 1.2, 0.05);
    crack.start(t, Math.random() * 0.3, 0.06);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(2600, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.35);
    this.#env(o, 0.35, 0.38);
    o.start(t);
    o.stop(t + 0.4);
    const body = this.ctx.createOscillator();
    body.frequency.setValueAtTime(110, t);
    body.frequency.exponentialRampToValueAtTime(30, t + 0.25);
    this.#env(body, 1.0, 0.3);
    body.start(t);
    body.stop(t + 0.32);
  }

  // Rising whine: the mech charging its cannons / rearing up.
  charge() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.72);
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

  // Jetpack burst: fast-attack bandpassed noise whoosh (sweeping down, ~0.35 s) plus a low thump.
  jet() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.9;
    f.frequency.setValueAtTime(1400 + Math.random() * 200, t);
    f.frequency.exponentialRampToValueAtTime(420, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    n.connect(f).connect(g).connect(this.master);
    n.start(t, 0, 0.4);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    this.#env(o, 0.5, 0.22);
    o.start(t);
    o.stop(t + 0.24);
  }

  // Soft landing thud: low noise puff plus a short sub drop.
  land() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 320;
    n.connect(f);
    this.#env(f, 0.45, 0.18);
    n.start(t, 0, 0.2);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    this.#env(o, 0.35, 0.15);
    o.start(t);
    o.stop(t + 0.16);
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
