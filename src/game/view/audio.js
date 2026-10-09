import arShot from '../../assets/sfx/ar-shot.mp3';
import mgShot from '../../assets/sfx/mg-shot.mp3';
import sniperShot from '../../assets/sfx/sniper-shot.mp3';
import sniperBolt from '../../assets/sfx/sniper-bolt.mp3';
import burstShot from '../../assets/sfx/burst-shot.mp3';
import railShot from '../../assets/sfx/rail-shot.mp3';
import railCharge from '../../assets/sfx/rail-charge.mp3';
import pistolShot from '../../assets/sfx/pistol-shot.mp3';
import mgSpin from '../../assets/sfx/mg-spin.mp3';
import dryFire from '../../assets/sfx/dry-fire.mp3';
import reloadRifle from '../../assets/sfx/reload-rifle.mp3';
import reloadMg from '../../assets/sfx/reload-mg.mp3';
import reloadPerfect from '../../assets/sfx/reload-perfect.mp3';
import reloadJam from '../../assets/sfx/reload-jam.mp3';
import switchGun from '../../assets/sfx/switch.mp3';

// SFX: synthesized at runtime, plus recorded samples (ElevenLabs, see credits.md) where one exists.
// A sample replaces its synth sound once decoded; until then (or if loading fails) the synth plays.
// Context is created on first user gesture.
// [url, gain, pitch spread (±, playback rate)] per sample id. Every play also varies its volume by ±GAIN_SPREAD.
const SAMPLES = {
  rifle: [arShot, 0.6, 0.09], // shots are keyed by gun id
  mg: [mgShot, 0.5, 0.08],
  sniper: [sniperShot, 0.75, 0.06],
  burst: [burstShot, 0.55, 0.09],
  rail: [railShot, 0.7, 0.06],
  pistol: [pistolShot, 0.55, 0.1],
  sniperBolt: [sniperBolt, 0.5, 0.07],
  railCharge: [railCharge, 0.6, 0.04],
  mgSpin: [mgSpin, 0.35, 0], // looped, pitch and volume follow the spin
  dry: [dryFire, 0.5, 0.1],
  reload: [reloadRifle, 0.5, 0.06], // every gun but the MG
  reloadMg: [reloadMg, 0.5, 0.05],
  perfect: [reloadPerfect, 0.5, 0.04],
  jam: [reloadJam, 0.5, 0.06],
  switch: [switchGun, 0.9, 0.1],
};
const GAIN_SPREAD = 0.12;
const BOLT_DELAY = 0.22; // s after a sniper shot before the bolt is worked

// Sample bytes. The single-file artifact build inlines samples as base64 data: URLs, which its page's content
// policy won't fetch, so those are decoded here instead.
function bytes(url) {
  if (!url.startsWith('data:')) return fetch(url).then((r) => r.arrayBuffer());
  return new Promise((resolve) => {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    resolve(out.buffer);
  });
}

export class Audio {
  // weapon: read for the gun being reloaded (the reload event carries no gun id)
  constructor(weapon) {
    this.weapon = weapon;
    this.ctx = null;
    this.samples = {}; // id -> decoded AudioBuffer
    this.voice = {}; // id -> playing source that may be cut short (reload, rail charge)
  }

  // Sound reactions to gameplay events.
  listen(events) {
    events.on('weapon:shot', (s) => {
      if (!this.sample(s.gun)) {
        if (s.gun === 'sniper') this.snipe();
        else if (s.beam) this.rail();
        else this.shot(s.heavy);
      }
      if (s.gun === 'sniper' && this.samples.sniper) this.sample('sniperBolt', BOLT_DELAY);
      if (s.mag <= 0.2) this.lowMag(s.mag); // last rounds: a rising click warns before the mag runs dry
    });
    events.on('weapon:hit', (h) => (h.killed ? this.kill() : this.hit(h.weak ? 'weak' : h.crit ? 'head' : 'body')));
    events.on('weapon:switch', () => {
      this.#cut('reload');
      this.#cut('railCharge');
      this.sample('switch') || this.click();
    });
    events.on('weapon:charge', (on) => {
      if (!on) this.#cut('railCharge');
      else if (!this.#voice('railCharge')) this.railCharge();
    });
    events.on('weapon:dry', () => this.sample('dry') || this.click());
    events.on('weapon:reload', (kind) => {
      if (kind === 'start') this.#voice(this.weapon?.current === 'mg' ? 'reloadMg' : 'reload') || this.click();
      else if (kind === 'done') this.samples.reload || this.click(); // the reload sample ends on its own click
      else {
        this.#cut('reload'); // good / perfect finish it now; a jam stops it (the reload drags on, silent)
        if (kind === 'perfect') this.sample('perfect') || this.perfect();
        else if (kind === 'jam') this.sample('jam') || this.jam();
        else this.click();
      }
    });
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
      bytes(url)
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => (this.samples[id] = buf))
        .catch(() => {}); // keep the synth sound
    }
  }

  // Plays the recorded sample for `id` (slightly detuned each time so repeats don't sound like a loop),
  // `delay` seconds from now. Returns its source node, or null if there is no sample (yet): the caller
  // falls back to its synth sound.
  sample(id, delay = 0) {
    const buf = this.ctx && this.samples[id];
    if (!buf) return null;
    const [, gain, spread] = SAMPLES[id];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * spread;
    src.gain = this.ctx.createGain();
    src.gain.gain.value = gain * (1 + (Math.random() * 2 - 1) * GAIN_SPREAD);
    src.connect(src.gain).connect(this.master);
    src.start(this.ctx.currentTime + delay);
    return src;
  }

  // A sample that can be cut short (one per id): the reload clatter, the railgun charge.
  // Key `reload` holds both reload sounds.
  #voice(id) {
    const key = id === 'reloadMg' ? 'reload' : id;
    this.#cut(key);
    const src = this.sample(id);
    if (!src) return null;
    this.voice[key] = src;
    src.onended = () => this.voice[key] === src && delete this.voice[key];
    return src;
  }

  #cut(key) {
    const src = this.voice[key];
    if (!src) return;
    delete this.voice[key];
    const t = this.ctx.currentTime;
    src.gain.gain.setTargetAtTime(0, t, 0.015); // quick fade, no click
    src.stop(t + 0.08);
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

  // Machine gun barrel spin, 0..1 (continuous voice, created on first use): the recorded loop once decoded,
  // pitched up with the spin, else a synth whine.
  spin(level) {
    if (level < 0.01) level = 0;
    // small changes are skipped, but reaching 0 never is (else at > 60 fps it could stop on a faint, endless hum)
    if (!this.ctx || (Math.abs(level - (this.spinLevel ?? -1)) < 0.02 && (level > 0 || this.spinLevel === 0))) return;
    this.spinLevel = level;
    if (!this.spinLoop && this.samples.mgSpin) {
      this.spinLoop = this.sample('mgSpin');
      this.spinLoop.loop = true;
      this.spinLoop.playbackRate.value = 0.7;
      this.spinLoop.gain.gain.value = 0;
      if (this.spinGain) this.spinGain.gain.value = 0; // synth whine off for good
    }
    const t = this.ctx.currentTime;
    if (this.spinLoop) {
      this.spinLoop.playbackRate.setTargetAtTime(0.7 + level * 0.4, t, 0.05);
      this.spinLoop.gain.gain.setTargetAtTime(level > 0.01 ? SAMPLES.mgSpin[1] * (0.3 + 0.7 * level) : 0, t, 0.06);
      return;
    }
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
