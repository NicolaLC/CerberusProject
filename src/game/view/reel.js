import * as THREE from 'three';
import { Rng } from '../../engine/random.js';
import { Rig, Animator } from '../actors/rig.js';
import { buildSoldier, CORE } from '../actors/soldier.js';
import { buildCerberus } from '../actors/cerberus-model.js';

// Intro reel (NEW GAME, before the Prologue loads): six shots of IO, each with a HiveMind PA card typed in and read aloud,
// then STEM-00's own card, `SIGNAL: UNREGIS`, cut off mid-word (not the HiveMind speaking: no voice, amber, glitched).
// A full-screen layer (`#reel`: a 2D canvas, the card, a hint) over the title, drawn procedurally in the art-style palette:
// no level is loaded and the game renderer is not used. Shell (#intro) starts it and calls update every frame; the reel keeps
// its own wall clock (not the engine's clamped frame time), so it stays in step with the PA lines on the audio clock even
// when frames are slow. It ends on a press, which hands the press back to Shell (`onEnd(pad)`) so the level can load and the
// pointer lock still has the press's user activation. Hence the wait at the end: after the last shot the reel holds on
// black with a prompt until a key, click or pad button.
// Skip: a first press shows the hint, a second one within TUNING.hint s ends the reel at once (same handoff).
// Audio (audio.js): reel(true) on start (title music out, bed in), reelLine(voice) when a card starts typing, reel(false) at the end.
// State for tests, on `#reel`: data-state (play | wait), data-shot (shot id).
export const TUNING = {
  cardAt: 1.2, // s into a shot when its card starts typing and its PA line starts
  cardOut: 1.4, // s before a shot's end when its card is gone (the line ends before that)
  cardFade: 0.4, // s of card fade-out
  cps: 14, // card typing, characters per second
  signalCps: 9, // the last card types slower, a weak signal
  fade: 0.7, // s of fade from / to black at each shot's edges
  skipDelay: 0.5, // s before a press counts (the press that chose NEW GAME is not a skip)
  hint: 3, // s the skip hint stays up; a second press meanwhile skips
  prompt: 1.2, // s into the wait before its prompt shows
};
// One row per shot. `len` makes the card window (cardAt .. len - cardOut) longer than the PA line in `voice` (audio.js SAMPLES id):
// 11.4 s for the orbit, 9.4 s for the feed, 13.4 s for the others; the lines are 3.8 to 7.2 s. Card words match the lines.
// `at`: times of beats in the line, s from the line's start (the feed's redaction burst, CERBERUS's three heads named).
export const SHOTS = [
  { id: 'orbit', len: 14, card: 'IO. ONE MACHINE. ONE MIND.', voice: 'reelPa1' },
  { id: 'city', len: 16, card: 'BILLIONS OF UNITS. NO NAMES. SERIALS ONLY.', voice: 'reelPa2' },
  { id: 'collectors', len: 16, card: 'LIGHT: HARVESTED. PEACE: 40,000 CYCLES.', voice: 'reelPa3' },
  { id: 'feed', len: 12, card: 'CORE TEMPERATURE: ██████ DATA: IRRELEVANT.', voice: 'reelPa4', at: { redact: [0.94, 1.86] } },
  { id: 'cerberus', len: 16, card: 'THE GATE IS GUARDED. CERBERUS: VIGIL. LEGION. COLOSSUS.', voice: 'reelPa5', at: { heads: [2.74, 3.52, 4.39] } },
  { id: 'lab', len: 16, card: 'UNIT STEM-00. SERIAL ZERO. STATUS: DORMANT.', voice: 'reelPa6' },
  { id: 'signal', len: 5, card: 'SIGNAL: UNREGIS', voice: null },
];
export const LENGTH = SHOTS.reduce((a, s) => a + s.len, 0); // s, without the wait

const C = {
  black: '#000',
  shadow: '#0b1118',
  haze: '46, 111, 120', // #2E6F78
  glow: '63, 224, 255', // #3FE0FF
  white: '234, 246, 250', // #EAF6FA
  violet: '192, 75, 255', // #C04BFF
  magenta: '255, 61, 203', // #FF3DCB
  amber: '255, 179, 71', // #FFB347
};
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => (x = clamp01(x)) * x * (3 - 2 * x);
const rgba = (rgb, a) => `rgba(${rgb}, ${a})`;

export class Reel {
  constructor({ audio, renderer }) {
    this.audio = audio;
    this.renderer = renderer; // the game's, used once: the lab shot's STEM-00 (#stemSprite)
    this.el = document.getElementById('reel');
    this.canvas = this.el.querySelector('canvas');
    this.g = this.canvas.getContext('2d');
    this.cardEl = this.el.querySelector('.card');
    this.textEl = this.cardEl.querySelector('.text');
    this.hintEl = this.el.querySelector('.hint');
    this.active = false;
    this.state = null; // 'play' | 'wait'
    this.t = 0; // s since start (wall clock)
    this.t0 = 0; // performance.now() at t = 0
    this.onKey = (e) => {
      if (e.repeat) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.#press(false);
    };
    this.onPointer = (e) => {
      e.preventDefault();
      this.#press(false);
    };
  }

  // Starts the reel over the title. onEnd(pad) runs once, on the press that ends it (skip or the wait's prompt).
  start(onEnd) {
    this.onEnd = onEnd;
    this.active = true;
    this.state = 'play';
    this.seek(0);
    this.shotI = -1;
    this.hintT = 0;
    this.voiced = new Set();
    this.el.hidden = false;
    this.el.dataset.state = 'play';
    this.textEl.textContent = '';
    this.cardEl.style.opacity = '0';
    this.hintEl.hidden = true;
    this.#resize();
    addEventListener('keydown', this.onKey, true);
    addEventListener('pointerdown', this.onPointer, true);
    this.audio.reel?.(true);
    this.#frame();
  }

  // Per frame from Shell.update; input is the engine's (pad presses end it too).
  update(input) {
    if (!this.active) return;
    const prev = this.t;
    this.t = (performance.now() - this.t0) / 1000;
    this.hintT = Math.max(0, this.hintT - (this.t - prev));
    this.padGlyph = input?.device === 'pad';
    if (input && ['Pad0', 'Pad1', 'Pad9'].some((b) => input.wasPressed(b))) this.#press(true);
    if (!this.active) return; // that press ended it
    if (this.canvas.width !== Math.round(innerWidth * this.dpr) || this.canvas.height !== Math.round(innerHeight * this.dpr)) this.#resize();
    if (this.state === 'play' && this.t >= LENGTH) {
      this.state = this.el.dataset.state = 'wait';
      this.waitFrom = LENGTH;
    }
    this.#frame();
  }

  // Jumps to t s into the reel (tests, frame captures).
  seek(t) {
    this.t0 = performance.now() - t * 1000;
    this.t = t;
  }

  // Ends it now: no handoff.
  stop() {
    if (!this.active) return;
    this.active = false;
    removeEventListener('keydown', this.onKey, true);
    removeEventListener('pointerdown', this.onPointer, true);
    this.audio.reel?.(false);
    this.el.hidden = true;
    delete this.el.dataset.state;
    delete this.el.dataset.shot;
  }

  #press(pad) {
    if (this.t < TUNING.skipDelay) return;
    if (this.state === 'play' && this.hintT <= 0) {
      this.hintT = TUNING.hint; // first press: the hint; the next one skips
      return;
    }
    this.stop();
    this.onEnd?.(pad);
  }

  #resize() {
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.W = this.canvas.width = Math.round(innerWidth * this.dpr);
    this.H = this.canvas.height = Math.round(innerHeight * this.dpr);
    this.#build();
  }

  // Shot index and local time for the reel time t.
  #at(t) {
    let from = 0;
    for (let i = 0; i < SHOTS.length; i++) {
      if (t < from + SHOTS[i].len || i === SHOTS.length - 1) return { i, lt: t - from };
      from += SHOTS[i].len;
    }
  }

  #frame() {
    const { g, W, H } = this;
    const waiting = this.state === 'wait';
    const { i, lt } = this.#at(this.t); // past the end: the last shot, its time still running (the core keeps flickering)
    const shot = SHOTS[i];
    if (i !== this.shotI) {
      this.shotI = i;
      this.el.dataset.shot = shot.id;
      this.cardEl.classList.toggle('signal', shot.id === 'signal');
    }
    if (!waiting && shot.voice && lt >= TUNING.cardAt && !this.voiced.has(i)) {
      this.voiced.add(i);
      this.audio.reelLine?.(shot.voice);
    }
    const u = lt / shot.len;
    const still = reduce.matches;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = C.black;
    g.fillRect(0, 0, W, H);
    this[`draw_${shot.id}`](g, lt, still ? 0.5 : u, shot, still);
    // edges: fade from / to black (the signal shot cuts in, and holds its black)
    const fade = shot.id === 'signal' ? 1 : smooth(lt / TUNING.fade) * smooth((shot.len - lt) / TUNING.fade);
    if (fade < 1) {
      g.globalAlpha = 1 - fade;
      g.fillStyle = C.black;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
    this.#grain(g, shot.id === 'feed' ? 0.07 : 0.035);
    this.#card(shot, lt, waiting);
    this.#hint(waiting);
  }

  // The card: typed from cardAt, gone by len - cardOut. The signal card types slowly, flickers, and stays.
  #card(shot, lt, waiting) {
    const signal = shot.id === 'signal';
    const typed = Math.floor(Math.max(0, lt - TUNING.cardAt) * (signal ? TUNING.signalCps : TUNING.cps));
    const n = waiting ? shot.card.length : Math.min(shot.card.length, typed);
    const out = signal ? 1 : clamp01((shot.len - TUNING.cardOut - lt) / TUNING.cardFade);
    const text = shot.card.slice(0, n);
    if (this.textEl.textContent !== text) this.textEl.textContent = text;
    const flicker = signal && !reduce.matches && Math.sin(lt * 37) * Math.sin(lt * 13.7) > 0.55 ? 0.35 : 1;
    this.cardEl.style.opacity = n > 0 ? String(out * flicker) : '0';
  }

  #hint(waiting) {
    let text = '';
    if (waiting && this.t - this.waitFrom >= TUNING.prompt) text = this.padGlyph ? 'PRESS A' : 'PRESS ANY KEY';
    else if (this.hintT > 0) text = this.padGlyph ? 'PRESS A AGAIN TO SKIP' : 'PRESS AGAIN TO SKIP';
    if (this.hintEl.textContent !== text) this.hintEl.textContent = text;
    this.hintEl.hidden = !text;
  }

  // Film grain: a pre-made noise tile at a random offset, screened over the frame.
  #grain(g, a) {
    const tile = this.noise[(Math.random() * this.noise.length) | 0];
    g.globalAlpha = a;
    g.globalCompositeOperation = 'screen';
    g.fillStyle = g.createPattern(tile, 'repeat');
    g.setTransform(1, 0, 0, 1, (Math.random() * 256) | 0, (Math.random() * 256) | 0);
    g.fillRect(-256, -256, this.W + 256, this.H + 256);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  // Pre-made pieces, rebuilt on resize: noise tiles, the planet's nodes, the stars, the city layers, the collectors' motes.
  #build() {
    const rng = new Rng(0x10);
    const r = () => rng.next();
    const { W, H } = this;
    this.noise ??= [0, 1, 2].map(() => {
      const c = new OffscreenCanvas(256, 256);
      const x = c.getContext('2d');
      const img = x.createImageData(256, 256);
      for (let p = 0; p < img.data.length; p += 4) {
        const v = (Math.random() * 255) | 0;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
        img.data[p + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      return c;
    });
    this.stars = Array.from({ length: 260 }, () => ({ x: r(), y: r(), a: 0.08 + r() * 0.35, f: r() * 6 }));
    // planet: lattice nodes (lon, lat), a few violet (HiveMind relays)
    this.nodes = Array.from({ length: 900 }, () => ({ lon: r() * Math.PI * 2, lat: Math.asin(r() * 2 - 1), v: r() < 0.04, a: 0.3 + r() * 0.7 }));
    // city: three skyline layers (far to near), each wider than the screen for the pan
    this.layers = [
      { depth: 0.25, top: 0.5, h: 0.22, fill: '#0f2329', win: 0.01 },
      { depth: 0.55, top: 0.58, h: 0.3, fill: '#09141a', win: 0.02 },
      { depth: 1, top: 0.7, h: 0.38, fill: '#040709', win: 0.035 },
    ].map((L) => ({ ...L, img: this.#skyline(L, rng, W * 1.6, H) }));
    // collectors: pylons with dishes, motes of light rising into them
    this.pylons = [0.16, 0.38, 0.63, 0.87].map((x, k) => ({ x: x + (r() - 0.5) * 0.05, top: 0.16 + r() * 0.12, w: 0.05 + r() * 0.03, dish: 0.07 + r() * 0.05, k }));
    this.motes = Array.from({ length: 520 }, () => ({ x: r(), p: r(), s: 0.05 + r() * 0.08, pyl: (r() * 4) | 0, a: 0.2 + r() * 0.6 }));
    this.feedNoise = Array.from({ length: 40 }, () => ({ y: r(), h: 0.004 + r() * 0.03, dx: (r() - 0.5) * 0.08 }));
  }

  // One skyline layer: towers (some broken), sparse lit windows; drawn once into its own canvas.
  #skyline(L, rng, w, H) {
    const c = new OffscreenCanvas(Math.ceil(w), H);
    const x = c.getContext('2d');
    x.fillStyle = L.fill;
    let px = 0;
    const base = H * (L.top + L.h);
    while (px < w) {
      const tw = H * (0.02 + rng.next() * 0.06) * (0.6 + L.depth);
      const th = H * L.h * (0.25 + rng.next() * 0.75);
      x.fillRect(px, base - th, tw, H - base + th);
      if (rng.next() < 0.3) x.fillRect(px + tw * 0.4, base - th - H * 0.03, tw * 0.12, H * 0.03); // mast
      for (let wy = base - th + 4; wy < base; wy += 5 + L.depth * 4)
        for (let wx = px + 2; wx < px + tw - 2; wx += 4 + L.depth * 3)
          if (rng.next() < L.win) {
            x.fillStyle = rng.next() < 0.7 ? rgba(C.white, 0.5) : rgba(C.glow, 0.6);
            x.fillRect(wx, wy, 1.5 + L.depth, 1.5 + L.depth);
            x.fillStyle = L.fill;
          }
      px += tw + H * rng.next() * 0.01;
    }
    x.fillRect(0, base, w, H - base);
    return c;
  }

  // 1. IO from orbit: a dark planet wrapped in a lit lattice, no sun; slow push in.
  draw_orbit(g, t, u) {
    const { W, H } = this;
    for (const s of this.stars) {
      g.fillStyle = rgba(C.white, s.a * (0.8 + 0.2 * Math.sin(t * 1.3 + s.f)));
      g.fillRect(s.x * W, s.y * H, 1.2 * this.dpr, 1.2 * this.dpr);
    }
    const R = H * (0.78 + 0.16 * smooth(u));
    const cx = W * 0.56;
    const cy = H * (1.12 - 0.08 * smooth(u)) + R * 0.35;
    const spin = t * 0.025;
    const tilt = 0.42;
    // limb haze
    const limb = g.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.09);
    limb.addColorStop(0, rgba(C.glow, 0.22));
    limb.addColorStop(0.35, rgba(C.haze, 0.18));
    limb.addColorStop(1, rgba(C.haze, 0));
    g.fillStyle = limb;
    g.beginPath();
    g.arc(cx, cy, R * 1.09, 0, Math.PI * 2);
    g.fill();
    const body = g.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R);
    body.addColorStop(0, '#0c161b');
    body.addColorStop(1, '#030507');
    g.fillStyle = body;
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    // orthographic sphere: lon/lat -> screen, z > 0 faces us
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const proj = (lon, lat) => {
      const cl = Math.cos(lat);
      const x = cl * Math.sin(lon + spin);
      const y0 = Math.sin(lat);
      const z0 = cl * Math.cos(lon + spin);
      return [cx + R * x, cy - R * (y0 * ct - z0 * st), y0 * st + z0 * ct];
    };
    g.lineWidth = Math.max(1, this.dpr * 0.8);
    const line = (pts) => {
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0, z0] = pts[k - 1];
        const [x1, y1, z1] = pts[k];
        if (z0 <= 0 || z1 <= 0) continue;
        g.strokeStyle = rgba(C.glow, 0.05 + 0.16 * Math.min(z0, z1));
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
    };
    for (let la = -75; la <= 75; la += 15) line(Array.from({ length: 49 }, (_, k) => proj((k / 48) * Math.PI * 2, (la * Math.PI) / 180)));
    for (let lo = 0; lo < 360; lo += 15) line(Array.from({ length: 25 }, (_, k) => proj((lo * Math.PI) / 180, ((k / 24) * 180 - 90) * (Math.PI / 180))));
    for (const n of this.nodes) {
      const [x, y, z] = proj(n.lon, n.lat);
      if (z <= 0.02) continue;
      const a = n.a * z * (0.75 + 0.25 * Math.sin(t * 2 + n.lon * 7));
      g.fillStyle = n.v ? rgba(C.violet, a) : rgba(n.a > 0.8 ? C.white : C.glow, a);
      const sz = (n.v ? 2.6 : 1.8) * this.dpr;
      g.fillRect(x - sz / 2, y - sz / 2, sz, sz);
    }
  }

  // 2. The city: black skyline layers against the teal haze, the HiveMind's violet glow, transit rails carrying identical
  // units in perfectly even rows; slow pan.
  draw_city(g, t, u) {
    const { W, H } = this;
    const sky = g.createLinearGradient(0, 0, 0, H * 0.75);
    sky.addColorStop(0, C.shadow);
    sky.addColorStop(1, rgba(C.haze, 0.55));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.55, H * 0.62, 0, W * 0.55, H * 0.62, H * 0.6);
    glow.addColorStop(0, rgba(C.violet, 0.14 + 0.04 * Math.sin(t * 0.8)));
    glow.addColorStop(1, rgba(C.violet, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    const pan = smooth(u) * W * 0.5;
    this.layers.forEach((L, k) => {
      g.drawImage(L.img, -pan * L.depth, 0);
      if (k === 1) {
        // haze between the mid and the near layer
        const hz = g.createLinearGradient(0, H * 0.45, 0, H);
        hz.addColorStop(0, rgba(C.haze, 0));
        hz.addColorStop(1, rgba(C.haze, 0.35));
        g.fillStyle = hz;
        g.fillRect(0, 0, W, H);
      }
    });
    // transit rails: rows of identical lights moving at one speed, the same gap between every one
    const rails = [0.66, 0.73, 0.81, 0.9];
    rails.forEach((ry, k) => {
      const y = H * ry;
      const gap = (5 + k * 3) * this.dpr;
      const dir = k % 2 ? -1 : 1;
      const off = (((t * (40 + k * 25) * this.dpr * dir) % gap) + gap) % gap;
      g.fillStyle = rgba(C.haze, 0.5);
      g.fillRect(0, y + 2 * this.dpr, W, this.dpr);
      g.fillStyle = rgba(k === 3 ? C.white : C.glow, 0.35 + k * 0.12);
      const sz = (1 + k * 0.5) * this.dpr;
      for (let x = off; x < W; x += gap) g.fillRect(x, y, sz, sz);
    });
  }

  // 3. The collectors: pylons and dishes over the city, every mote of light pulled up into them; the ground goes dark.
  draw_collectors(g, t, u) {
    const { W, H } = this;
    const lift = smooth(u) * H * 0.12; // camera tilts up
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#020304');
    sky.addColorStop(1, rgba(C.haze, 0.3 * (1 - 0.6 * u)));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(0, lift);
    for (const p of this.pylons) {
      const x = p.x * W;
      const top = p.top * H;
      const w = p.w * H;
      // lattice tower
      g.fillStyle = '#05080a';
      g.beginPath();
      g.moveTo(x - w, H * 1.2);
      g.lineTo(x - w * 0.25, top);
      g.lineTo(x + w * 0.25, top);
      g.lineTo(x + w, H * 1.2);
      g.fill();
      g.strokeStyle = rgba(C.haze, 0.35);
      g.lineWidth = this.dpr;
      for (let y = top + 20 * this.dpr; y < H * 1.2; y += 26 * this.dpr) {
        const f = (y - top) / (H * 1.2 - top);
        const hw = w * (0.25 + 0.75 * f);
        g.beginPath();
        g.moveTo(x - hw, y);
        g.lineTo(x + hw, y + 26 * this.dpr);
        g.stroke();
      }
      // the dish: an open bowl facing the sky, its rim lit by what it drinks
      const d = p.dish * H;
      g.fillStyle = '#070b0e';
      g.beginPath();
      g.ellipse(x, top, d, d * 0.28, 0, 0, Math.PI);
      g.fill();
      g.strokeStyle = rgba(C.glow, 0.25 + 0.15 * Math.sin(t * 1.7 + p.k));
      g.lineWidth = 1.5 * this.dpr;
      g.beginPath();
      g.ellipse(x, top, d, d * 0.28, 0, Math.PI, Math.PI * 2);
      g.stroke();
      const halo = g.createRadialGradient(x, top, 0, x, top, d * 1.6);
      halo.addColorStop(0, rgba(C.white, 0.12));
      halo.addColorStop(1, rgba(C.white, 0));
      g.fillStyle = halo;
      g.fillRect(x - d * 1.6, top - d * 1.6, d * 3.2, d * 3.2);
    }
    // motes: from the ground up into a dish, faster as they near it
    for (const m of this.motes) {
      const p = this.pylons[m.pyl];
      const k = (m.p + t * m.s) % 1;
      const e = k * k;
      const x = (m.x + (p.x - m.x) * e) * W;
      const y = H * 1.05 + (p.top * H - H * 1.05) * k;
      g.fillStyle = rgba(C.white, m.a * Math.sin(k * Math.PI) * (1 - 0.4 * u));
      g.fillRect(x, y, 1.4 * this.dpr, 2.2 * this.dpr);
    }
    g.restore();
    // the city floor, its last lights going out
    g.fillStyle = '#020304';
    g.fillRect(0, H * 0.9 + lift, W, H);
    const lights = 1 - smooth(u * 1.2);
    g.fillStyle = rgba(C.white, 0.35 * lights);
    for (let k = 0; k < 60; k++) g.fillRect(((k * 97) % 100) / 100 * W, H * (0.91 + ((k * 37) % 7) / 100) + lift, 2 * this.dpr, 1.5 * this.dpr);
  }

  // 4. The corrupted feed: a thermal monitor of IO's core, its curve falling cycle after cycle; the value is redacted, and the
  // feed tears when the PA hits the redaction.
  draw_feed(g, t, u, shot, still) {
    const { W, H } = this;
    const v = t - TUNING.cardAt; // s into the PA line
    const [r0, r1] = shot.at.redact;
    const burst = !still && v >= r0 && v <= r1 ? 1 : 0;
    const roll = still ? 0 : (t * 0.12) % 1;
    g.fillStyle = '#04090b';
    g.fillRect(0, 0, W, H);
    const m = H * 0.12; // monitor margin
    const x0 = m * 1.4;
    const x1 = W - m * 1.4;
    const y0 = m;
    const y1 = H - m * 1.6;
    // grid
    g.strokeStyle = rgba(C.haze, 0.3);
    g.lineWidth = this.dpr;
    for (let k = 0; k <= 10; k++) {
      const x = x0 + ((x1 - x0) * k) / 10;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y1);
      g.stroke();
    }
    for (let k = 0; k <= 6; k++) {
      const y = y0 + ((y1 - y0) * k) / 6;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
    }
    g.font = `${Math.round(13 * this.dpr)}px ui-monospace, Consolas, monospace`;
    g.fillStyle = rgba(C.glow, 0.7);
    g.fillText('CORE // THERMAL // CYCLES 0 - 40,000', x0, y0 - 10 * this.dpr);
    g.fillText('TEMP', x0 - m * 0.9, y0 + 14 * this.dpr);
    g.fillStyle = rgba(C.white, 0.85);
    g.fillRect(x1 - 120 * this.dpr, y0 - 22 * this.dpr, 120 * this.dpr, 16 * this.dpr); // the redacted value
    // the curve: drawn out across the shot, always falling
    const n = Math.max(2, Math.floor(120 * clamp01(0.25 + u * 1.3)));
    const curve = (dx, color) => {
      g.strokeStyle = color;
      g.lineWidth = 3 * this.dpr;
      g.beginPath();
      for (let k = 0; k < n; k++) {
        const f = k / 119;
        const y = y0 + (y1 - y0) * (0.12 + 0.7 * f * f + 0.03 * Math.sin(f * 40));
        const x = x0 + (x1 - x0) * f + dx;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    if (burst) {
      curve(-4 * this.dpr, rgba(C.magenta, 0.6));
      curve(4 * this.dpr, rgba(C.glow, 0.6));
    }
    curve(0, rgba(C.amber, 0.9));
    // rolling bar
    const by = roll * H;
    const bar = g.createLinearGradient(0, by - H * 0.08, 0, by + H * 0.08);
    bar.addColorStop(0, rgba(C.white, 0));
    bar.addColorStop(0.5, rgba(C.white, 0.05));
    bar.addColorStop(1, rgba(C.white, 0));
    g.fillStyle = bar;
    g.fillRect(0, by - H * 0.08, W, H * 0.16);
    // tears: always a few, many during the redaction burst
    if (!still) {
      const tears = burst ? this.feedNoise.length : 4;
      for (let k = 0; k < tears; k++) {
        const s = this.feedNoise[(k + Math.floor(t * 9)) % this.feedNoise.length];
        const y = s.y * H;
        const h = s.h * H * (burst ? 2 : 1);
        g.drawImage(this.canvas, 0, y, W, h, s.dx * W * (burst ? 2 : 0.3), y, W, h);
      }
    }
    if (burst) {
      g.globalAlpha = 0.35;
      g.drawImage(this.noise[(t * 30) % 3 | 0], 0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  // 5. CERBERUS: the Gate's guardian on the horizon, sunk in haze; its three heads' sensors flare as each is named.
  draw_cerberus(g, t, u, shot, still) {
    const { W, H } = this;
    const sky = g.createLinearGradient(0, 0, 0, H * 0.8);
    sky.addColorStop(0, '#030507');
    sky.addColorStop(1, rgba(C.haze, 0.5));
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const k = (0.62 + 0.08 * smooth(u)) * H; // scale: on the horizon, a slow push in
    const cx = W * 0.5;
    const base = H * 0.8;
    g.save();
    g.translate(cx, base);
    g.scale(k / 1000, k / 1000);
    // the shared body (#cerberusSprite), feet on the base line, 1500 units wide; its lenses flare when their head is named
    const S = (this.cerb ??= this.renderer ? this.#cerberusSprite() : null); // none: a standalone reel (tests)
    const sw = 1500;
    const sh = S ? (sw * S.img.height) / S.img.width : 0;
    const top = S ? -sh * S.feet : 0;
    if (S) g.drawImage(S.img, -sw / 2, top, sw, sh);
    const v = t - TUNING.cardAt;
    const heads = [0, 1, 2].map((i) => ({ at: shot.at.heads[i], pts: (S?.sensors ?? []).filter((x) => x.head === i).map((x) => [-sw / 2 + x.x * sw, top + x.y * sh]) }));
    for (const h of heads) {
      const since = v - h.at;
      const flare = since >= 0 ? Math.max(0.35, Math.exp(-since * 1.4)) : 0;
      const breathe = 0.35 + (still ? 0.1 : 0.15 * Math.sin(t * 1.6 + h.at));
      const a = Math.min(1, breathe + flare);
      for (const [x, y] of h.pts) {
        const r = 3 + 5 * flare;
        const gl = g.createRadialGradient(x, y, 0, x, y, r * 3);
        gl.addColorStop(0, rgba(C.magenta, a));
        gl.addColorStop(0.3, rgba(C.violet, a * 0.5));
        gl.addColorStop(1, rgba(C.violet, 0));
        g.fillStyle = gl;
        g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
        g.fillStyle = rgba(C.white, a * 0.8);
        g.fillRect(x - 2, y - 2, 4, 4);
      }
    }
    g.restore();
    // haze swallowing it from the feet up, a dim city line in front
    const hz = g.createLinearGradient(0, base - k * 0.6, 0, base);
    hz.addColorStop(0, rgba(C.haze, 0.05));
    hz.addColorStop(1, rgba(C.haze, 0.75));
    g.fillStyle = hz;
    g.fillRect(0, 0, W, H);
    g.drawImage(this.layers[2].img, -W * 0.2, H * 0.12);
  }

  // 6. The lab window: through thick riveted glass, serial zero stands in its cradle, dark; its core is a cold ember until,
  // at the very end, it flickers amber once.
  draw_lab(g, t, u, shot, still) {
    const { W, H } = this;
    const z = 1 + 0.1 * smooth(u); // push in toward the glass
    g.save();
    g.translate(W / 2, H / 2);
    g.scale(z, z);
    g.translate(-W / 2, -H / 2);
    // the room: back wall, cold strip light, haze
    g.fillStyle = '#071014';
    g.fillRect(0, 0, W, H);
    const strip = g.createLinearGradient(0, H * 0.12, 0, H * 0.55);
    strip.addColorStop(0, rgba(C.white, 0.22));
    strip.addColorStop(1, rgba(C.haze, 0));
    g.fillStyle = strip;
    g.fillRect(W * 0.2, H * 0.12, W * 0.6, H * 0.45);
    g.fillStyle = rgba(C.white, 0.85);
    g.fillRect(W * 0.32, H * 0.13, W * 0.36, 3 * this.dpr);
    // the cradle: an upright frame with clamps
    const cx = W * 0.5;
    const s = H / 1000;
    g.strokeStyle = '#1a2328';
    g.lineWidth = 14 * s;
    g.strokeRect(cx - 150 * s, H * 0.2, 300 * s, H * 0.72);
    g.fillStyle = '#10181c';
    for (const y of [0.32, 0.5, 0.68]) {
      g.fillRect(cx - 175 * s, H * y, 50 * s, 26 * s);
      g.fillRect(cx + 125 * s, H * y, 50 * s, 26 * s);
    }
    // STEM-00: the real model, powered down in the cradle (#stemSprite), feet on the cradle's base
    const top = H * 0.26;
    const h = H * 0.92 - top + 20 * s;
    const img = this.renderer && (this.stemImg ??= this.#stemSprite()); // none: a standalone reel (tests)
    if (img) g.drawImage(img, cx - (h * img.width) / img.height / 2, H * 0.92 - h, (h * img.width) / img.height, h);
    // the core: dormant, then one amber flicker in the last second (the Seed)
    const late = shot.len - t;
    const wake = !still && late < 1.1 && Math.sin(t * 31) > 0.2 ? 0.9 : 0;
    const core = 0.12 + wake;
    const cy = H * 0.92 - h * (1.35 / 2.1); // its chest in the sprite
    const gl = g.createRadialGradient(cx, cy, 0, cx, cy, 60 * s);
    gl.addColorStop(0, rgba(C.amber, core));
    gl.addColorStop(1, rgba(C.amber, 0));
    g.fillStyle = gl;
    g.fillRect(cx - 60 * s, cy - 60 * s, 120 * s, 120 * s);
    g.fillStyle = '#c9a23a'; // stencilled serial on the cradle base (ochre, matte)
    g.font = `${Math.round(22 * s)}px ui-monospace, Consolas, monospace`;
    g.textAlign = 'center';
    g.fillText('STEM-00 / SERIAL 0', cx, H * 0.95);
    g.textAlign = 'start';
    g.restore();
    // the glass: haze, condensation, a streak of reflection; the window frame in front
    g.fillStyle = rgba(C.haze, 0.05);
    g.fillRect(0, 0, W, H);
    const refl = g.createLinearGradient(0, 0, W, H);
    refl.addColorStop(0.3, rgba(C.white, 0));
    refl.addColorStop(0.42, rgba(C.white, 0.05));
    refl.addColorStop(0.5, rgba(C.white, 0));
    g.fillStyle = refl;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#020304';
    const bar = H * 0.06;
    g.fillRect(0, 0, W, bar);
    g.fillRect(0, H - bar, W, bar);
    g.fillRect(0, 0, bar * 1.6, H);
    g.fillRect(W - bar * 1.6, 0, bar * 1.6, H);
    g.fillRect(W * 0.5 - bar * 0.35 + W * 0.22, 0, bar * 0.7, H); // mullion off-centre
    g.fillStyle = rgba(C.haze, 0.5);
    for (let x = bar * 2.5; x < W - bar * 2; x += bar * 1.2) {
      g.fillRect(x, bar * 0.45, 3 * this.dpr, 3 * this.dpr); // rivets
      g.fillRect(x, H - bar * 0.55, 3 * this.dpr, 3 * this.dpr);
    }
  }

  // STEM-00 for the lab shot: the player's rig and soldier parts in the wake-up cinematic's dormant pose (slumped, head bowed),
  // lit by the cold strip light above and its own dim core, rendered once into a transparent image with the game's renderer
  // (#snapshot).
  #stemSprite() {
    const w = 400;
    const h = 700; // frames x -0.6..0.6, y -0.05..2.05 m
    const scene = new THREE.Scene();
    const rig = new Rig({ dummy: false });
    const M = buildSoldier(rig);
    M.core.emissiveIntensity = CORE.min;
    const anim = new Animator(rig, { armed: false });
    const pose = { speed: 0, run: false, crouch: 0, aimPitch: 0, combat: false, recoil: 0, lean: 0, lookYaw: 0, lower: 0, dormant: 1, seated: 0 };
    for (let i = 0; i < 90; i++) anim.update(1 / 30, pose); // settle into the slump
    scene.add(rig.root);
    scene.add(new THREE.HemisphereLight(0x9fc4cc, 0x05080a, 0.35));
    const strip = new THREE.DirectionalLight(0xeaf6fa, 2.6); // the strip light, above and a little in front
    strip.position.set(0.3, 4, 1.4);
    scene.add(strip);
    const rim = new THREE.DirectionalLight(0x3fe0ff, 1.2); // haze behind it
    rim.position.set(-1, 1.5, -2);
    scene.add(rim);
    const core = new THREE.PointLight(0xffb347, 0.15, 0.8, 2);
    core.position.set(0, 1.25, 0.35);
    scene.add(core);
    const cam = new THREE.OrthographicCamera(-0.6, 0.6, 2.05, -0.05, 0.1, 20);
    cam.position.set(0, 0, 5);
    const out = this.#snapshot(scene, cam, w, h);
    for (const m of Object.values(M)) m.dispose?.(); // the part geometry is shared (parts.js cache): kept
    return out;
  }

  // CERBERUS for its shot: the shared body (cerberus-model.js) three quarters on, a dark silhouette backlit by the haze, rendered
  // once like STEM-00. Returns { img, sensors: [{ x, y (0..1 of the image), size, head }] (the lens flares), feet (y, 0..1) }.
  #cerberusSprite() {
    const w = 1200;
    const h = 800;
    const scene = new THREE.Scene();
    const dark = new THREE.MeshStandardMaterial({ color: 0x0b1519, roughness: 0.7, metalness: 0.3 });
    const black = new THREE.MeshStandardMaterial({ color: 0x040708, roughness: 0.6, metalness: 0.4 });
    const model = buildCerberus({ shell: dark, frame: black, trim: black, eye: black, heads: [dark, dark, dark], weak: [black, black, black] });
    model.root.rotation.y = -0.6; // three quarters, its right flank toward us
    scene.add(model.root);
    scene.add(new THREE.HemisphereLight(0x2e6f78, 0x020304, 0.6));
    const rim = new THREE.DirectionalLight(0x9fe8ff, 3); // the haze behind it
    rim.position.set(6, 10, -14);
    scene.add(rim);
    const cam = new THREE.PerspectiveCamera(30, w / h, 1, 200);
    cam.position.set(-5, 4, 38);
    cam.lookAt(0, 7.5, 0);
    cam.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    const at = (p) => (p.project(cam), { x: (p.x + 1) / 2, y: (1 - p.y) / 2 });
    const sensors = model.sensors.map((x) => ({ ...at(x.obj.localToWorld(x.pos.clone())), size: x.size, head: x.head }));
    const feet = at(new THREE.Vector3(0, 0, 0)).y;
    const img = this.#snapshot(scene, cam, w, h);
    dark.dispose();
    black.dispose();
    return { img, sensors, feet };
  }

  // Renders `scene` once with the game's renderer into a transparent w x h image (an sRGB render target: the screen canvas has no
  // alpha; no tone mapping off screen, so the scenes keep their lights low).
  #snapshot(scene, cam, w, h) {
    const r = this.renderer;
    const target = new THREE.WebGLRenderTarget(w, h, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const clear = r.getClearColor(new THREE.Color());
    const alpha = r.getClearAlpha();
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    const px = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(target, 0, 0, w, h, px);
    r.setRenderTarget(null);
    r.setClearColor(clear, alpha);
    target.dispose();
    const out = new OffscreenCanvas(w, h);
    const x = out.getContext('2d');
    const img = x.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // rows come bottom up
    x.putImageData(img, 0, 0);
    return out;
  }

  // 7. The signal: black, one amber point where the core is, the card typed slowly and cut off.
  draw_signal(g, t, u, shot, still) {
    const { W, H } = this;
    const a = still ? 0.6 : 0.35 + 0.35 * Math.max(0, Math.sin(t * 5.3) * Math.sin(t * 1.7));
    const gl = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, H * 0.06);
    gl.addColorStop(0, rgba(C.amber, a));
    gl.addColorStop(1, rgba(C.amber, 0));
    g.fillStyle = gl;
    g.fillRect(W / 2 - H * 0.06, H * 0.36, H * 0.12, H * 0.12);
  }
}
