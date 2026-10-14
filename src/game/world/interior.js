import * as THREE from 'three';
import { applyWorldUVs } from './textures.js';
import { quarters } from './kit.js';
import { bake, collider, PROP_PIECES } from './props.js';

// Interior kit (`arch.corridor`, a public contract: instructions/level.md; style: art-style.md "Interiors"). One piece dresses a
// corridor shell built from kit walls and a roof: wall bays (kick plinth, padded lattice, ochre bumper rail, a machine panel with a
// vent / fan / hatch in a recess, a leaning upper panel, a 45 degree cornice with a fluorescent fixture), a structural rib frame
// every `bay` metres (pilaster, knee brace, ceiling beam), a ceiling truss with two ribbed pipes, decked floor with a centre grate,
// steps up to a raised deck, cyan marker lights, and an end panel around a door. Visual only, except the colliders the walker
// needs: one box per side over the dressing, and the steps / raised deck.
// Surface detail is texture, not geometry: tiling colour, normal and roughness / metalness maps painted on canvases at startup
// (no downloaded textures), mapped in world space like the kit (1 tile = 2 m). Metals reflect a small generated corridor
// environment (an equirect canvas, PMREM-filtered by three on first use). Tubes glow through additive halo cards (bloom is off).
// Everything is baked to world space and merged per material into the level batches (props.js `bake`): one draw per material.

const OCHRE = '#c9a23a';
// Corridor wall profile, measured from the wall face inward (m) and up from the bay's floor (m). Tuning in one place.
const P = {
  plinth: [0.3, 0.32], // [height, depth]
  pad: [0.3, 1.05], // lattice zone [bottom, top]
  rail: [1.05, 1.25, 0.3], // ochre bumper rail [bottom, top, depth]
  panel: [1.25, 0.28], // machine panel [bottom above the floor, frame depth]; its top is the leaning panel's foot
  upper: 1.25, // leaning panel height, under the cornice (the upper zone hangs from the ceiling, so raised bays line up)
  lean: 0.26, // upper panel lean (rad)
  cornice: 0.7, // 45 degree cornice leg
  rib: [0.5, 0.45, 0.75], // rib [width along the corridor, lower depth, upper depth (from 3 m up)]
  dressing: 0.45, // side collider depth (the ribs stick out this far)
  pipe: [1.4, 0.6, 0.2], // twin pipes [|x|, below the ceiling, radius]
  truss: [0.7, 0.85], // truss chords [|x|, below the ceiling]
  grate: 1.0, // centre grate width
};

// ---------------- procedural maps ----------------
// CPU-backed canvases: the height maps are read back (getImageData), which stalls on a GPU canvas (200 ms+ at startup, a minute on SwiftShader).
const CPU = { willReadFrequently: true };
// Three canvases painted together (colour, height, roughness / metalness), then the height turns into a tangent-space normal map.
function sheet(n) {
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    return c.getContext('2d', CPU);
  };
  return { n, c: mk(), h: mk(), r: mk() };
}
const grey = (v) => `rgb(${v | 0},${v | 0},${v | 0})`;
const rm = (rough, metal) => `rgb(0,${(rough * 255) | 0},${(metal * 255) | 0})`;

// Paints one shape on the chosen layers: o = { c: colour css, h: height 0..255, r: [rough, metal] }.
function paint(s, o, draw) {
  for (const [k, v] of [['c', o.c], ['h', o.h == null ? null : grey(o.h)], ['r', o.r && rm(...o.r)]]) {
    if (v == null) continue;
    const g = s[k];
    g.fillStyle = g.strokeStyle = v;
    draw(g);
  }
}
const rect = (s, o, x, y, w, h) => paint(s, o, (g) => g.fillRect(x, y, w, h));
const disc = (s, o, x, y, r) => paint(s, o, (g) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); });
const stroke = (s, o, w, pts) => paint(s, o, (g) => { g.lineWidth = w; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke(); });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Grime: soft dark blotches (rougher) and streaks running down, over colour and roughness; wraps across the tile edges.
function grime(s, rnd, amount) {
  const { n } = s;
  for (let i = 0; i < 40 * amount; i++) {
    const x = rnd() * n;
    const y = rnd() * n;
    const r = 10 + rnd() * 50;
    for (const [k, rgb] of [['c', '0,0,0'], ['r', '0,255,0']]) {
      const g = s[k];
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const a = (k === 'c' ? 0.18 : 0.12) * rnd();
      grad.addColorStop(0, `rgba(${rgb},${a})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  for (let i = 0; i < 18 * amount; i++) {
    const x = rnd() * n;
    const y = rnd() * n;
    s.c.strokeStyle = `rgba(8,8,6,${0.06 + rnd() * 0.12})`;
    s.c.lineWidth = 1 + rnd() * 4;
    s.c.beginPath();
    s.c.moveTo(x, y);
    s.c.lineTo(x + (rnd() - 0.5) * 3, y + 20 + rnd() * 90);
    s.c.stroke();
  }
}

// Scratches: thin bright lines, smoother and barer (rough down, metal up).
function scratches(s, rnd, count) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * s.n;
    const y = rnd() * s.n;
    const a = rnd() * Math.PI;
    const l = 3 + rnd() * 12;
    stroke(s, { c: 'rgba(150,156,160,0.16)', r: [0.35, 0.8] }, 1, [[x, y], [x + Math.cos(a) * l, y + Math.sin(a) * l]]);
  }
}

// Height canvas -> tangent-space normal map (canvas y runs down, v up: the green channel flips). strength: slope gain.
function normalMap(s, strength, blur = 1) {
  const { n } = s;
  const src = document.createElement('canvas');
  src.width = src.height = n;
  const sg = src.getContext('2d', CPU);
  sg.filter = `blur(${blur}px)`;
  for (const dx of [-n, 0, n]) for (const dy of [-n, 0, n]) sg.drawImage(s.h.canvas, dx, dy); // blur wraps across the tile edges
  const h = sg.getImageData(0, 0, n, n).data;
  const out = sg.createImageData(n, n);
  const o = out.data;
  const at = (x, y) => h[(((y + n) % n) * n + ((x + n) % n)) * 4] / 255;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * strength;
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * n + x) * 4;
      o[i] = ((nx / l) * 0.5 + 0.5) * 255;
      o[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      o[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = n;
  c.getContext('2d', CPU).putImageData(out, 0, 0);
  return c;
}

function tex(canvas, color = false, repeat = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

// A material from a painted sheet: colour, normal, roughness (G) and metalness (B) maps. The maps are made once per sheet and
// shared by every material drawn from it (hull and frame are one set of textures).
function sheetMaterial(s, { strength = 6, blur = 1, normal = 1, envMap, env = 0.7, tint = 0xffffff } = {}) {
  s.maps ??= { map: tex(s.c.canvas, true), normalMap: tex(normalMap(s, strength, blur)), rm: tex(s.r.canvas) };
  return new THREE.MeshStandardMaterial({
    color: tint,
    map: s.maps.map,
    normalMap: s.maps.normalMap,
    normalScale: new THREE.Vector2(normal, normal),
    roughnessMap: s.maps.rm,
    metalnessMap: s.maps.rm,
    roughness: 1,
    metalness: 1,
    envMap,
    envMapIntensity: env,
  });
}

// Hull plating (walls, frames, ceiling): plates on a running bond, seams, bolts, recessed slots, grime, scratches. 512 px = 2 m.
function hullSheet() {
  const s = sheet(512);
  const rnd = rng(11);
  rect(s, { c: '#4b5055', h: 128, r: [0.55, 0.35] }, 0, 0, 512, 512); // painted plate: mostly dielectric, bare metal only where worn
  const plates = [[0, 0, 192, 256], [192, 0, 192, 256], [384, 0, 128, 256], [0, 256, 96, 256], [96, 256, 224, 256], [320, 256, 192, 256]];
  for (const [x, y, w, h] of plates) {
    const t = (rnd() - 0.5) * 14;
    rect(s, { c: `rgba(${t > 0 ? '255,255,255' : '0,0,0'},${Math.abs(t) / 100})`, r: [0.5 + rnd() * 0.15, 0.3 + rnd() * 0.1] }, x + 3, y + 3, w - 6, h - 6);
    // seam groove with a bevel
    paint(s, { c: 'rgba(10,12,14,0.85)', h: 40 }, (g) => { g.lineWidth = 4; g.strokeRect(x + 1, y + 1, w - 2, h - 2); });
    paint(s, { h: 150 }, (g) => { g.lineWidth = 2; g.strokeRect(x + 5, y + 5, w - 10, h - 10); });
    // bolts along the long edges
    for (let p = 16; p < w - 8; p += 32) for (const by of [y + 12, y + h - 12]) {
      disc(s, { c: '#30353a', h: 200, r: [0.45, 0.85] }, x + p, by, 3.5);
      disc(s, { c: 'rgba(200,205,210,0.4)' }, x + p - 1, by - 1, 1.2);
    }
    // one detail per plate: a recessed vent slot group, an access hatch outline or nothing
    const k = rnd();
    if (k < 0.35 && w > 120) {
      const vx = x + 24 + rnd() * (w - 120);
      const vy = y + 40 + rnd() * (h - 120);
      rect(s, { c: '#2a2e32', h: 70 }, vx, vy, 70, 44);
      for (let i = 0; i < 5; i++) rect(s, { c: '#0c0e10', h: 20, r: [0.8, 0.3] }, vx + 6, vy + 5 + i * 8, 58, 4);
    } else if (k < 0.7) {
      const hx = x + 20 + rnd() * Math.max(1, w - 100);
      const hy = y + 30 + rnd() * (h - 110);
      paint(s, { c: 'rgba(10,12,14,0.7)', h: 60 }, (g) => { g.lineWidth = 3; g.strokeRect(hx, hy, 60, 60); });
      for (const [a, b] of [[6, 6], [54, 6], [6, 54], [54, 54]]) disc(s, { h: 190, c: '#33383d' }, hx + a, hy + b, 2.5);
    }
  }
  // a weld bead across one plate
  stroke(s, { c: 'rgba(30,30,28,0.6)', h: 175 }, 3, [[200, 120], [370, 122]]);
  grime(s, rnd, 1);
  scratches(s, rnd, 50);
  return s;
}

// Deck plates (floor, treads): 1 m plates, beveled grooves, corner bolts, worn paint, wet low-roughness patches. 512 px = 2 m.
function deckSheet() {
  const s = sheet(512);
  const rnd = rng(23);
  rect(s, { c: '#3d4246', h: 128, r: [0.5, 0.35] }, 0, 0, 512, 512);
  for (const [x, y] of [[0, 0], [256, 0], [0, 256], [256, 256]]) {
    paint(s, { c: 'rgba(8,9,10,0.9)', h: 30 }, (g) => { g.lineWidth = 5; g.strokeRect(x + 1, y + 1, 254, 254); });
    paint(s, { h: 155 }, (g) => { g.lineWidth = 2; g.strokeRect(x + 6, y + 6, 244, 244); });
    for (const [a, b] of [[14, 14], [242, 14], [14, 242], [242, 242]]) disc(s, { c: '#2b2f33', h: 210, r: [0.4, 0.85] }, x + a, y + b, 4);
    // anti-slip ribs, a field of short raised dashes in the plate centre
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
      const cx = x + 48 + i * 20;
      const cy = y + 48 + j * 20;
      paint(s, { h: 165, c: 'rgba(90,95,100,0.25)' }, (g) => { g.save(); g.translate(cx, cy); g.rotate((i + j) % 2 ? 0.785 : -0.785); g.fillRect(-6, -1.5, 12, 3); g.restore(); });
    }
  }
  // wet patches: smooth, reflect the tubes
  for (let i = 0; i < 6; i++) {
    const x = rnd() * 512;
    const y = rnd() * 512;
    const r = 40 + rnd() * 70;
    const g = s.r;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(0,40,153,0.8)');
    grad.addColorStop(1, 'rgba(0,40,153,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  grime(s, rnd, 1.4);
  scratches(s, rnd, 120);
  return s;
}

// Bar grating: bearing bars every 6 cm, cross bars every 25 cm, black void between. Computed per pixel. 256 px = 2 m.
function grateSheet() {
  const s = sheet(256);
  const n = 256;
  const img = { c: s.c.createImageData(n, n), h: s.h.createImageData(n, n), r: s.r.createImageData(n, n) };
  const rnd = rng(5);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const bear = x % 8 < 2; // bearing bar
    const cross = y % 32 < 3; // cross bar
    const bar = bear || cross;
    const i = (y * n + x) * 4;
    const v = bar ? 78 + rnd() * 18 : 6;
    img.c.data.set([v, v + 3, v + 6, 255], i);
    const h = bar ? (cross && !bear ? 200 : 255) : 0;
    img.h.data.set([h, h, h, 255], i);
    img.r.data.set([0, bar ? 120 + rnd() * 40 : 240, bar ? 210 : 30, 255], i);
  }
  for (const k of ['c', 'h', 'r']) s[k].putImageData(img[k], 0, 0);
  grime(s, rnd, 0.6);
  return s;
}

// Quilted padding for the lower wall (behind the lattice): diamond cushions, dark and matte. 256 px = 2 m.
function padSheet() {
  const s = sheet(256);
  const n = 256;
  const img = { c: s.c.createImageData(n, n), h: s.h.createImageData(n, n), r: s.r.createImageData(n, n) };
  const rnd = rng(9);
  const cell = 32;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x + y) % cell;
    const w = (x - y + n * 4) % cell;
    const d = Math.min(u, cell - u, w, cell - w) / (cell / 2); // 0 on the stitch lines, 1 in the cushion middle
    const h = Math.sqrt(Math.min(1, d * 1.6)) * 255;
    const v = 26 + d * 14 + rnd() * 6;
    const i = (y * n + x) * 4;
    img.c.data.set([v, v + 2, v + 4, 255], i);
    img.h.data.set([h, h, h, 255], i);
    img.r.data.set([0, 225, 20, 255], i);
  }
  for (const k of ['c', 'h', 'r']) s[k].putImageData(img[k], 0, 0);
  grime(s, rnd, 0.5);
  return s;
}

// Hazard stripes for trims (ochre over dark, 45 degrees, chipped): 128 px tile, repeated 4x per 2 m (25 cm period).
function stripeSheet() {
  const s = sheet(128);
  const rnd = rng(31);
  rect(s, { c: '#1d1f21', h: 120, r: [0.6, 0.6] }, 0, 0, 128, 128);
  for (let k = -2; k < 4; k++) {
    paint(s, { c: '#b39236', h: 140, r: [0.82, 0.05] }, (g) => {
      g.beginPath();
      g.moveTo(k * 64, 0);
      g.lineTo(k * 64 + 32, 0);
      g.lineTo(k * 64 + 32 - 128, 128);
      g.lineTo(k * 64 - 128, 128);
      g.fill();
    });
  }
  for (let i = 0; i < 40; i++) disc(s, { c: '#3a3d40', h: 120, r: [0.45, 0.85] }, rnd() * 128, rnd() < 0.7 ? (rnd() < 0.5 ? 1 : 127) - (rnd() - 0.5) * 6 : rnd() * 128, 0.4 + rnd() * 1.1); // chips down to metal, mostly along the edges
  grime(s, rnd, 0.9);
  return s;
}

// Corridor environment for reflections: an equirect panorama of a dark gunmetal tube with two rows of cold tubes overhead and a
// brighter far end. Equirect: three PMREM-filters it on first use (roughness-correct blur), no renderer needed here.
function envTexture() {
  const w = 512;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#36424a');
  grad.addColorStop(0.5, '#222a2f');
  grad.addColorStop(1, '#090c0e');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // two lines of tube fixtures along the corridor axis (they converge at the poles of the panorama)
  g.fillStyle = '#e8f3f6';
  for (const x of [0.22, 0.28, 0.72, 0.78]) for (let y = 14; y < 110; y += 22) g.fillRect(x * w - 3, y, 6, 14);
  // the corridor ends: a softer glow in both directions
  for (const x of [0.25, 0.75]) {
    const r = g.createRadialGradient(x * w, h * 0.5, 0, x * w, h * 0.5, 60);
    r.addColorStop(0, 'rgba(160,190,196,0.55)');
    r.addColorStop(1, 'rgba(160,190,196,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  }
  // ochre trim band at hip height
  g.fillStyle = 'rgba(201,162,58,0.35)';
  g.fillRect(0, 150, w, 5);
  const t = new THREE.CanvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Soft round glow for the additive halo cards.
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.3)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The permanent interior materials (World keeps them across levels, like World.mats and the props' dressing).
export function interiorMaterials() {
  const envMap = envTexture();
  const hull = hullSheet();
  const stripe = stripeSheet();
  const glow = glowTexture();
  return {
    hull: sheetMaterial(hull, { envMap, env: 0.8 }), // wall plates, panels, ceiling
    frame: sheetMaterial(hull, { envMap, env: 0.6, tint: 0x9aa0a6, normal: 1.4 }), // ribs, frames, lattice: a darker tone of the same plate
    deck: sheetMaterial(deckSheet(), { envMap, env: 1.0, strength: 5 }),
    grate: sheetMaterial(grateSheet(), { envMap, env: 0.5, strength: 3, blur: 0.5 }),
    pad: sheetMaterial(padSheet(), { envMap, env: 0.3, strength: 4, blur: 1.5 }),
    stripe: (() => {
      const m = sheetMaterial(stripe, { envMap, env: 0.4, strength: 3 });
      for (const t of [m.map, m.normalMap, m.roughnessMap]) t.repeat.set(4, 4);
      return m;
    })(),
    pipe: new THREE.MeshStandardMaterial({ color: 0x7c8084, roughness: 0.32, metalness: 0.9, envMap, envMapIntensity: 1.2 }),
    halo: new THREE.MeshBasicMaterial({ map: glow, color: 0xd8e8ec, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    pool: new THREE.MeshBasicMaterial({ map: glow, color: 0x47616a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), // a soft light pool washed over a lit end wall / floor
  };
}

// ---------------- geometry ----------------
const fail = (id, msg) => {
  throw new Error(`${id}: ${msg}`);
};
function num(id, p, key, def, min = 0, whole = false) {
  const v = p[key] ?? def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || (whole && !Number.isInteger(v))) fail(id, `"${key}" must be ${whole ? 'a whole number' : 'a number'} >= ${min}, got ${JSON.stringify(v)}`);
  return v;
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Vector3();
const boxes = new Map();
const cyls = new Map();

const tori = new Map();
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Material key -> the world's material. Kit: World.interior; reused: the props' ochre / dark, the level's emissive strips, the
// consoles' readout.
const MATS = {
  hull: (w) => w.interior.hull,
  frame: (w) => w.interior.frame,
  deck: (w) => w.interior.deck,
  grate: (w) => w.interior.grate,
  pad: (w) => w.interior.pad,
  stripe: (w) => w.interior.stripe,
  pipe: (w) => w.interior.pipe,
  halo: (w) => w.interior.halo,
  pool: (w) => w.interior.pool,
  ochre: (w) => w.dressing.ochre,
  dark: (w) => w.dressing.dark,
  tube: (w) => w.mats.stripWhite,
  cyan: (w) => w.mats.stripCyan,
  screen: (w) => w.dressing.screen,
};
const OWN_UV = new Set(['halo', 'pool', 'screen']); // keep their 0..1 UVs (radial glow, the readout); the rest get world UVs

// Part lists: ['box', mat, w, h, d, x, y, z, rx, ry, rz] | ['cyl', mat, r, len, x, y, z, rx, ry, rz, seg] (axis +Y)
// | ['tor', mat, R, tube, x, y, z, rx, ry, rz, seg] (ring in the XY plane). Adders for a list, plus seg(): a cylinder or box from a to b.
function adders(parts) {
  const B = (mat, w, h, d, x, y, z, rx, ry, rz) => parts.push(['box', mat, w, h, d, x, y, z, rx, ry, rz]);
  const C = (mat, r, len, x, y, z, rx, ry, rz, seg) => parts.push(['cyl', mat, r, len, null, x, y, z, rx, ry, rz, seg]);
  const T = (mat, R, tube, x, y, z, rx, ry, rz, seg) => parts.push(['tor', mat, R, tube, null, x, y, z, rx, ry, rz, seg]);
  // a link from point a to point b ([x, y, z]): a cylinder of radius r, or a box r x r (square = true)
  const seg = (mat, r, a, b, square = false, sides = 8) => {
    _a.fromArray(a);
    _b.fromArray(b).sub(_a);
    const len = _b.length();
    _q.setFromUnitVectors(UP, _b.normalize());
    _e.setFromQuaternion(_q);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    if (square) B(mat, r, len, r, ...m, _e.x, _e.y, _e.z);
    else C(mat, r, len, ...m, _e.x, _e.y, _e.z, sides);
  };
  return { B, C, T, seg };
}

// Baked to the level at pos turned by q quarter turns (and `pre`, the piece's own frame); world UVs; merged per material. Floor
// props (`props`: [{ id, x, z, y, yaw, params }] in the same frame) are built through their own builders (collision included).
function build(world, d, q, parts, pre = null, props = []) {
  const root = new THREE.Matrix4().compose(_v.fromArray(d.pos), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (q * Math.PI) / 2), ONE);
  if (pre) root.multiply(pre);
  const m = new THREE.Matrix4();
  const meshes = [];
  for (const [kind, key, a, b, c, x, y, z, rx = 0, ry = 0, rz = 0, seg = 12] of parts) {
    let geo;
    if (kind === 'box') {
      const k = `${a}|${b}|${c}`;
      if (!boxes.has(k)) boxes.set(k, new THREE.BoxGeometry(a, b, c));
      geo = boxes.get(k).clone();
    } else if (kind === 'cyl') {
      const k = `${a}|${b}|${seg}`;
      if (!cyls.has(k)) cyls.set(k, new THREE.CylinderGeometry(a, a, b, seg));
      geo = cyls.get(k).clone();
    } else {
      const k = `${a}|${b}|${seg}`;
      if (!tori.has(k)) tori.set(k, new THREE.TorusGeometry(a, b, 6, seg));
      geo = tori.get(k).clone();
    }
    geo.applyMatrix4(m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), ONE).premultiply(root));
    if (!OWN_UV.has(key)) applyWorldUVs(geo, ZERO);
    const mesh = new THREE.Mesh(geo, MATS[key](world));
    mesh.userData.own = true;
    meshes.push(mesh);
  }
  const out = bake(world, { pos: [0, 0, 0] }, meshes, { shadow: false, yaw: 0 });
  const yaw0 = (q * Math.PI) / 2 + (pre ? Math.atan2(-pre.elements[2], pre.elements[0]) : 0);
  for (const pr of props) {
    _v.set(pr.x, pr.y ?? 0, pr.z).applyMatrix4(root);
    const yaw = Math.round((yaw0 + pr.yaw) / (Math.PI / 2)) * (Math.PI / 2);
    out.push(...[PROP_PIECES[pr.id].build(world, { id: pr.id, pos: _v.toArray(), yaw, params: pr.params })].flat());
  }
  return out;
}

// Fan / turbine in a wall: axis across the wall (x), a dark well at `base` m off the face, pitched blades, a hub, a shroud ring and a
// guard (rings + spokes) at the front (base + depth). X(v) places a point v m off the wall face.
function fan(A, X, s, y, z, r, base, depth, blades = 7, pitch = 0.5) {
  const { B, C, T } = A;
  const ax = [0, 0, Math.PI / 2];
  C('dark', r - 0.02, 0.04, X(base + 0.02), y, z, ...ax, 24); // the well
  for (let k = 0; k < blades; k++) {
    const a = (k * 2 * Math.PI) / blades;
    const rc = r * 0.5;
    B('frame', 0.014, r * 0.72, r * (pitch < 0.3 ? 0.22 : 0.32), X(base + depth * 0.45), y + Math.cos(a) * rc, z + Math.sin(a) * rc, a, s * pitch, 0);
  }
  C('pipe', r * 0.2, depth * 0.7, X(base + depth * 0.4), y, z, ...ax, 16); // hub
  T('frame', r, Math.min(0.07, r * 0.1), X(base + depth - 0.05), y, z, 0, Math.PI / 2, 0, 28); // shroud ring
  for (const f of [0.8, 0.55, 0.3]) T('dark', r * f, 0.01, X(base + depth - 0.015), y, z, 0, Math.PI / 2, 0, 24); // guard rings
  for (let k = 0; k < 4; k++) B('dark', 0.014, r * 1.84, 0.02, X(base + depth - 0.012), y, z, (k * Math.PI) / 4, 0, 0); // guard spokes
}

// One wall bay. o: { X (v off the wall face -> across coordinate), s (+1 / -1: which way is "off the wall"), zc, len (along the wall),
// y0 (bay floor), top (dressing top), cornice (lean panel + 45 degree cornice + fixture up to the ceiling `top`), slim (stays inside
// the arch.panelling envelope: <= 0.12 below 2.6 m, <= 0.05 above, for walls the player hugs; no one-offs), rnd (this bay's
// stream), pipe ({ v, y }: a ceiling pipe a hose can hang from), flat (the floor is level: room for a floor prop), props (list) }.
function wallBay(A, o) {
  const { B, C, seg } = A;
  const { s, zc, len, y0, slim, rnd } = o;
  const k = slim ? 0.36 : 1; // depth scale of the lower wall
  const X = (v) => o.X(v * k);
  const wb = (mat, depth, h, inset, y, l = len, z = zc, rz = 0) => B(mat, depth * k, h, l, X(inset), y, z, 0, 0, rz * s);
  wb('dark', P.plinth[1], P.plinth[0], P.plinth[1] / 2, y0 + P.plinth[0] / 2); // kick plinth
  wb('pad', 0.1, P.pad[1] - P.pad[0], 0.05, y0 + (P.pad[0] + P.pad[1]) / 2); // padding behind the lattice
  // lattice: top and bottom bars and a zigzag of diagonals (in the wall plane)
  const lh = P.pad[1] - P.pad[0];
  wb('frame', 0.1, 0.06, 0.15, y0 + P.pad[0] + 0.03); // prouder than the diagonals (flush fronts z-fight)
  wb('frame', 0.1, 0.06, 0.15, y0 + P.pad[1] - 0.03);
  const cells = Math.max(2, Math.round(len / 0.7));
  const cw = len / cells;
  const diag = Math.hypot(cw, lh - 0.06);
  const ang = Math.atan2(cw, lh - 0.06);
  for (let i = 0; i < cells; i++) B('hull', 0.08 * k, diag, 0.07, X(0.14), y0 + (P.pad[0] + P.pad[1]) / 2, zc + len / 2 - (i + 0.5) * cw, (i % 2 ? 1 : -1) * ang, 0, 0);
  // ochre bumper rail with cyan markers
  const [r0, r1, rd] = P.rail;
  wb('stripe', rd, r1 - r0, rd / 2, y0 + (r0 + r1) / 2);
  wb('dark', rd - 0.02, 0.03, (rd - 0.02) / 2, y0 + r0 + 0.005, len - 0.02); // shadow lip under the rail, 1 cm lower (flush bottoms z-fight)
  for (let i = 0; i < 4; i++) B('cyan', 0.02, 0.022, 0.04, X(rd) + s * -0.01, y0 + (r0 + r1) / 2, zc + len / 2 - (i + 0.5) * (len / 4));

  // machine panel: frame ring proud of a dark recess, a vent / fan / hatch / turbine in it
  const [p0, pd] = P.panel;
  const fillTop = o.cornice ? o.top - P.cornice - P.upper : o.top - 0.08; // where the upper zone ends (lean panel foot, or the cap)
  const p1 = slim ? Math.min(2.6, fillTop) - y0 : Math.min(fillTop - y0, p0 + 1.8); // slim: wall signs sit above 2.6
  const ph = p1 - p0;
  const py = y0 + (p0 + p1) / 2;
  const iw = len - 0.32; // inner width along the wall
  // one-off for this bay (full profile only): turbine | arm | hoses | crates | console | none
  const roll = rnd();
  const oneOff = slim ? 'none' : roll < 0.13 ? 'turbine' : roll < 0.25 ? 'arm' : roll < 0.37 && o.pipe ? 'hoses' : roll < 0.45 && o.flat && o.props ? 'crates' : roll < 0.52 && o.flat && o.props ? 'console' : 'none';
  wb('dark', 0.04, ph - 0.1, 0.02, py, len - 0.1); // recess back
  wb('frame', pd, 0.14, pd / 2, y0 + p0 + 0.07);
  wb('frame', pd, 0.18, pd / 2, y0 + p1 - 0.09);
  for (const e of [1, -1]) wb('frame', pd, ph - 0.32, pd / 2, py - 0.02, 0.16, zc + e * (len / 2 - 0.08));
  wb('hull', pd - 0.04, 0.06, (pd - 0.04) / 2, y0 + p0 + 0.17, len - 0.32); // sill inside the frame
  const kinds = ['vent', 'fan', 'hatch', 'vent', 'hatch'];
  const kind = oneOff === 'turbine' ? 'turbine' : kinds[Math.floor(rnd() * kinds.length)];
  if (kind === 'vent') {
    const nL = Math.max(3, Math.round(ph / 0.2));
    for (let i = 0; i < nL; i++) B('frame', 0.16 * k, 0.025, iw - 0.1, X(0.12), y0 + p0 + 0.35 + (i * (ph - 0.6)) / (nL - 1), zc, 0, 0, s * 0.55);
    wb('pad', 0.03, ph - 0.5, 0.055, py + 0.04, iw - 0.12);
  } else if (kind === 'fan') {
    wb('hull', 0.06, ph - 0.42, 0.05, py + 0.02, iw - 0.04); // square plate
    const fr = Math.min(0.55, (ph - 0.42) / 2);
    fan(A, X, s, py + 0.02, zc, fr, 0.08, 0.2, 7, slim ? 0.18 : 0.5); // slim: flatter blades, their tips stay behind the guard
    for (const e of [1, -1]) for (const v of [1, -1]) C('frame', 0.035, 0.06, X(0.08) + s * -0.03, py + 0.02 + v * fr, zc + e * fr, 0, 0, Math.PI / 2, 8); // corner bolts
  } else if (kind === 'turbine') {
    // a big turbine housing filling the panel: heavy ochre-banded ring, a bolt circle, the fan inside
    const tr = Math.min(0.85, ph / 2 - 0.22, iw / 2 - 0.12); // the ochre ring stays inside the panel frame
    fan(A, X, s, py, zc, tr, 0.04, 0.36, 9);
    A.T('ochre', tr + 0.05, 0.05, X(0.3), py, zc, 0, Math.PI / 2, 0, 32);
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      C('dark', 0.025, 0.05, X(0.33), py + Math.cos(a) * (tr + 0.05), zc + Math.sin(a) * (tr + 0.05), 0, 0, Math.PI / 2, 6);
    }
  } else {
    // hatch: a plate with two handles, a small status screen and a cable conduit running out of it
    wb('hull', 0.08, ph - 0.46, 0.08, py + 0.03, iw * 0.62, zc + iw * 0.17);
    for (const v of [Math.min(0.35, ph / 4), -Math.min(0.3, ph / 4)]) wb('dark', 0.06, 0.06, 0.15, py + v, 0.3, zc + iw * 0.17);
    const sy = py + Math.min(0.25, ph / 5); // screen centre
    wb('dark', 0.06, 0.34, 0.06, sy, 0.42, zc - iw * 0.32); // bezel
    wb('screen', 0.01, 0.22, 0.095, sy, 0.3, zc - iw * 0.32); // the consoles' scrolling cyan readout
    // cable conduit out of the bezel's underside down to the sill: never in front of the screen
    const c0 = y0 + p0 + 0.2;
    const c1 = sy - 0.17 - 0.01;
    if (c1 - c0 > 0.1) C('dark', 0.05 * Math.max(k, 0.6), c1 - c0, X(0.12), (c0 + c1) / 2, zc - iw * 0.32, 0, 0, 0, 8);
  }
  for (const e of [1, -1]) for (const v of [y0 + p0 + 0.07, y0 + p1 - 0.09]) B('cyan', 0.02, 0.025, 0.025, X(pd) + s * -0.01, v, zc + e * (len / 2 - 0.3)); // corner markers

  // upper zone between the panel and the lean panel / cap: plating with stiffeners (shallow in the slim profile: signs hang here)
  const u0 = y0 + p1;
  if (fillTop - u0 > 0.1) {
    const fh = fillTop - u0;
    const [plate, stiff] = slim ? [0.025, 0.045] : [0.05, 0.1];
    B('hull', plate, fh, len, o.X(plate / 2), u0 + fh / 2, zc);
    const nS = Math.max(2, Math.round(len / 0.75));
    for (let i = 1; i < nS; i++) B('frame', stiff, fh - 0.02, 0.06, o.X(stiff / 2), u0 + fh / 2, zc + len / 2 - (i * len) / nS);
    if (!slim && fh > 1.6) for (let y = u0 + 1.4; y < fillTop - 0.5; y += 1.4) B('frame', stiff + 0.02, 0.12, len, o.X((stiff + 0.02) / 2), y, zc); // horizontal frame bands
  }
  if (!o.cornice) {
    B('dark', slim ? 0.04 : 0.12, 0.08, o.capLen ?? len, o.X(slim ? 0.02 : 0.06), o.top - 0.04, zc); // cap, over the pilaster tops
  } else {
    // cables on top of the panel frame, under the leaning panel
    for (const i of [0, 1]) C('dark', 0.045, len + 0.36, X(0.1 + i * 0.1), fillTop + 0.05, zc, Math.PI / 2, 0, 0, 8);
    // leaning upper panel (top tipped inward) with stiffeners, up to the cornice
    const lh0 = fillTop;
    const lh1 = o.top - P.cornice;
    const lhh = (lh1 - lh0) / Math.cos(P.lean);
    const lin = pd + ((lh1 - lh0) * Math.tan(P.lean)) / 2; // inset of its centre
    wb('hull', 0.05, lhh, lin, (lh0 + lh1) / 2, len, zc, P.lean);
    const nS = Math.max(2, Math.round(len / 0.45));
    for (let i = 1; i < nS; i++) B('frame', 0.05, lhh, 0.05, X(lin + 0.045), (lh0 + lh1) / 2, zc + len / 2 - (i * len) / nS, 0, 0, s * P.lean);
    // 45 degree cornice up to the ceiling, a fixture on it: dark housing, three tubes, a halo card
    const c0 = pd + (lh1 - lh0) * Math.tan(P.lean);
    const cl = P.cornice * Math.SQRT2;
    const cin = c0 + P.cornice / 2;
    const cy = o.top - P.cornice / 2;
    wb('hull', 0.05, cl, cin, cy, len, zc, Math.PI / 4);
    const off = (dist) => [X(cin + dist / Math.SQRT2), cy - dist / Math.SQRT2]; // a point `dist` out from the cornice face
    const [hx, hy] = off(0.06);
    const fl = Math.min(2.0, len - 0.3);
    B('dark', 0.06, 0.44, fl, hx, hy, zc, 0, 0, s * (Math.PI / 4));
    for (const t of [-0.12, 0, 0.12]) {
      const [tx, ty] = off(0.13);
      C('tube', 0.028, fl - 0.15, tx - s * (t / Math.SQRT2), ty + t / Math.SQRT2, zc, Math.PI / 2, 0, 0, 8);
    }
    const [gx, gy] = off(0.04);
    B('halo', 0.004, 1.4, fl + 0.7, gx, gy, zc, 0, 0, s * (Math.PI / 4)); // ends inside the ribs, clear of their faces
    for (const e of [1, -1]) B('dark', 0.1, 0.5, 0.08, ...off(0.11), zc + e * (fl / 2 - 0.02), 0, 0, s * (Math.PI / 4)); // end caps
  }

  // one-offs that stick out (full profile, all above head height or on the floor against the wall)
  if (oneOff === 'arm') {
    // maintenance arm on the panel head: base, upper link up and out, forearm down to a tool head (lowest point >= 2.4 m)
    const yb = y0 + p1 - 0.12;
    const zz = zc + (rnd() - 0.5) * iw * 0.5;
    const P0 = [X(pd + 0.06), yb, zz];
    const P1 = [X(pd + 0.55), yb + 0.45, zz];
    const P2 = [X(pd + 1.0), Math.max(y0 + 2.75, yb - 0.1), zz];
    B('dark', 0.12, 0.42, 0.42, X(pd + 0.06), yb, zz); // base plate
    C('frame', 0.12, 0.16, X(pd + 0.12), yb, zz, 0, 0, Math.PI / 2, 12); // shoulder
    seg('frame', 0.15, P0, P1, true);
    seg('ochre', 0.17, [P0[0] + (P1[0] - P0[0]) * 0.4, P0[1] + (P1[1] - P0[1]) * 0.4, zz], [P0[0] + (P1[0] - P0[0]) * 0.6, P0[1] + (P1[1] - P0[1]) * 0.6, zz], true); // livery band
    C('dark', 0.1, 0.22, P1[0], P1[1], zz, Math.PI / 2, 0, 0, 12); // elbow
    seg('pipe', 0.06, P1, P2);
    C('dark', 0.09, 0.26, P2[0], P2[1] - 0.1, zz, 0, 0, 0, 10); // tool head
    C('pipe', 0.03, 0.18, P2[0], P2[1] - 0.3, zz, 0, 0, 0, 8);
    B('cyan', 0.03, 0.03, 0.03, P2[0], P2[1] - 0.02, zz + 0.1);
  } else if (oneOff === 'hoses') {
    // two hoses sagging from the ceiling pipe down into the panel head
    for (const dz of [-0.28, 0.22]) {
      const a = [o.X(o.pipe.v), o.pipe.y - 0.03, zc + dz]; // under the pipe
      const b = [X(pd * 0.6), y0 + p1 + 0.05, zc + dz * 1.6];
      const sag = 0.45 + rnd() * 0.35;
      let prev = a;
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        const pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * Math.sin(Math.PI * t), a[2] + (b[2] - a[2]) * t];
        seg('dark', 0.055, prev, pt);
        prev = pt;
      }
      C('ochre', 0.075, 0.1, ...b, 0, 0, Math.PI / 2, 10); // couplings
      C('dark', 0.08, 0.1, a[0], a[1] + 0.03, a[2], 0, 0, 0, 10);
    }
  } else if (oneOff === 'crates' || oneOff === 'console') {
    const zz = zc + (rnd() - 0.5) * (len - 2.2);
    if (oneOff === 'crates') {
      o.props.push({ id: 'prop.crate', x: o.X(P.dressing + 0.85), y: y0, z: zz, yaw: Math.PI / 2, params: { size: 'large' } });
      o.props.push({ id: 'prop.crate', x: o.X(P.dressing + 0.45), y: y0, z: zz + 1.25, yaw: 0, params: { size: 'small' } });
    } else o.props.push({ id: 'prop.console', x: o.X(P.dressing + 0.7), y: y0, z: zz, yaw: s > 0 ? -Math.PI / 2 : Math.PI / 2, params: {} });
  }
}

// The corridor in its own frame: x across (wall faces at +-W/2), y up from pos, z from the entrance (0) toward -L.
function corridor(p) {
  const { L, W, H, bayLen, steps, rise, run, stepAt, door, end, seed } = p;
  const parts = [];
  const props = [];
  const A = adders(parts);
  const { B, C } = A;
  const sides = { both: [1, -1], right: [1], left: [-1], none: [] }[p.sides];
  const R = steps * rise; // raised deck height
  const top = steps ? stepAt + Math.max(0, steps - 1) * run : 0; // where the raised deck starts (m from the entrance)
  const floorAt = (s) => (!steps || s < stepAt ? 0 : Math.min(R, (Math.floor((s - stepAt) / run) + 1) * rise)); // s = m from the entrance
  const n = Math.max(1, Math.round(L / bayLen));
  const b = L / n;
  const [px, pd, pr] = P.pipe;

  // ---- wall bays (their one-offs drawn from a per-side stream, so the pattern never tiles)
  for (const s of sides) {
    const rnd = rng(seed * 7919 + (s > 0 ? 101 : 0));
    const X = (v) => s * (W / 2 - v);
    for (let i = 0; i < n; i++) {
      const s0 = i * b;
      const s1 = s0 + b;
      const zc = -(s0 + s1) / 2;
      const y0 = floorAt(s1 - 1e-6);
      if (y0 > 0 && floorAt(s0) < y0) B('frame', 0.44, y0, b - 0.02, X(0.22), y0 / 2, zc); // stringer under a bay that starts below the raised deck
      wallBay(A, { X, s, zc, len: b - 0.4, y0, top: H, cornice: true, slim: false, rnd, pipe: p.ceiling && W / 2 - px < 2.4 ? { v: W / 2 - px, y: H - pd - pr } : null, flat: floorAt(s0) === floorAt(s1 - 1e-6) && !(steps && s1 > stepAt - 1.5 && s0 < top + 1.5), props: p.props ? props : null });
    }
  }

  // ---- rib frames at every bay line (the ends pulled inside): pilaster, upper pilaster, knee brace, ceiling beam, markers
  const [rw, rd0, rd1] = P.rib;
  for (let i = 0; i <= n; i++) {
    const z = -Math.min(L - rw / 2 - 0.1, Math.max(rw / 2 + 0.1, i * b)); // the feet stay 6 cm off the end walls
    const ry = floorAt(Math.min(L, i * b + rw / 2)); // floor at the rib
    for (const s of sides) {
      const X = (inset) => s * (W / 2 - inset);
      B('frame', rd0, 3.0, rw, X(rd0 / 2), 1.5, z);
      B('frame', rd1, H - 3.0, rw, X(rd1 / 2), 1.5 + H / 2, z);
      B('frame', 0.3, 1.25, rw - 0.02, X(rd1 + 0.25), H - 0.55, z, 0, 0, -s * (Math.PI / 4)); // knee brace into the beam
      B('dark', 0.03, 2.2, 0.12, X(rd0 + 0.01), ry + 1.75, z); // slot up the pilaster face
      B('stripe', rd0 + 0.02, P.rail[1] - P.rail[0] + 0.02, rw + 0.02, X((rd0 + 0.02) / 2), ry + (P.rail[0] + P.rail[1]) / 2, z); // ochre band continuing the rail
      B('dark', rd0 + 0.08, 0.32, rw + 0.08, X((rd0 + 0.08) / 2), ry + 0.16, z); // foot
      for (const v of [0.6, 2.95]) B('cyan', 0.02, 0.03, 0.03, X(rd0 + 0.01), ry + v, z + 0.14);
    }
    if (!p.ceiling || ((door || end) && i === n)) continue; // the end wall panel and its lamp take the last beam's place
    B('frame', W - 0.02, 0.36, rw, 0, H - 0.18, z); // ceiling beam
    B('stripe', 1.2, 0.02, rw - 0.1, 0, H - 0.37, z); // ochre underside plate
  }

  // ---- ceiling: plates, a centre truss (two lower chords, lacing, cross ties) and twin ribbed pipes with ochre collars
  if (p.ceiling) {
    B('hull', W - 0.02, 0.04, L - 0.02, 0, H - 0.03, -L / 2);
    for (let i = 0; i < n; i++) B('pad', 1.1, 0.02, b - 0.7, 0, H - 0.06, -(i + 0.5) * b); // dark recessed coffer strip above the truss
    const [tx, td] = P.truss;
    for (const s of [1, -1]) {
      B('frame', 0.12, 0.12, L - 0.04, s * tx, H - td, -L / 2);
      const nz = Math.round(L / 1.0);
      const dz = L / nz;
      const lace = Math.hypot(dz, td - 0.1);
      const la = Math.atan2(dz, td - 0.1);
      for (let k = 0; k < nz; k++) B('frame', 0.06, lace, 0.06, s * tx, H - td / 2 - 0.02, -(k + 0.5) * dz, (k % 2 ? 1 : -1) * la, 0, 0);
    }
    const nz = Math.round(L / 1.5);
    const dz = L / nz;
    const span = Math.hypot(2 * tx, dz);
    for (let k = 0; k <= nz; k++) B('frame', 2 * tx, 0.08, 0.08, 0, H - td, -Math.min(L - 0.2, Math.max(0.2, k * dz)));
    for (let k = 0; k < nz; k++) B('frame', 0.05, 0.05, span, 0, H - td + 0.08, -(k + 0.5) * dz, 0, (k % 2 ? 1 : -1) * Math.atan2(2 * tx, dz), 0);
    for (const s of [1, -1]) {
      const x = s * px;
      const y = H - pd;
      C('pipe', pr, L - 0.1, x, y, -L / 2, Math.PI / 2, 0, 0, 16); // ends 5 cm off the end walls (and their panels)
      const nr = Math.round(L / 0.2);
      for (let k = 0; k < nr; k++) C('pipe', pr + 0.025, 0.06, x, y, -(k + 0.5) * (L / nr), Math.PI / 2, 0, 0, 16); // ribs
      for (let i = 0; i < n; i++) C('ochre', pr + 0.035, 0.14, x, y, -(i + 0.5) * b, Math.PI / 2, 0, 0, 16); // collar mid-bay
      for (let i = 0; i <= n; i++) B('dark', 0.08, pd, 0.08, x, H - pd / 2, -Math.min(L - 0.4, Math.max(0.4, i * b)) + 0.32); // hanger beside the beam
    }
  }

  // ---- floor: deck plates either side of a centre grate with rims, on the low and the raised level; steps between
  const deck = (s0, s1, y) => {
    if (s1 - s0 < 0.05) return;
    const l = s1 - s0;
    const zc = -(s0 + s1) / 2;
    const g = P.grate;
    const side = W / 2 - P.dressing + 0.1 - g / 2 - 0.08; // plate width each side (under the dressing edge)
    for (const s of [1, -1]) {
      const nP = Math.max(1, Math.round(l / 1.5));
      const nX = Math.max(1, Math.round(side / 2.2)); // wide rooms: a few plates across
      for (let j = 0; j < nX; j++) for (let k = 0; k < nP; k++) B('deck', side / nX - (nX > 1 ? 0.015 : 0), 0.03, l / nP - 0.015, s * (g / 2 + 0.08 + (side * (j + 0.5)) / nX), y + 0.015, -(s0 + (k + 0.5) * (l / nP)));
      B('frame', 0.08, 0.03, l, s * (g / 2 + 0.04), y + 0.015, zc); // grate rim
    }
    B('grate', g, 0.02, l, 0, y + 0.01, zc);
    B('dark', W - 0.1, 0.02, l - 0.01, 0, y - 0.004, zc); // bed under the plate seams (bottom 1.4 cm under the plates': flush bottoms z-fight)
  };
  if (p.floor) {
    deck(0, steps ? stepAt : (door || end) ? L - 0.16 : L, 0);
    if (steps) {
      deck(top + 0.1, door ? L - 0.16 : L, R); // starts behind the last nosing (overlapping it, the two tops z-fight); stops at the bulkhead sill
      for (let k = 1; k < steps; k++) {
        const s0 = stepAt + (k - 1) * run;
        const y = k * rise;
        const zc = -(s0 + run / 2);
        B('frame', W - 0.02, y - 0.03, run, 0, (y - 0.03) / 2, zc); // block
        B('deck', W - 0.04, 0.03, run - 0.1, 0, y - 0.015, zc - 0.05); // tread
        B('stripe', W - 0.04, 0.03, 0.1, 0, y - 0.015, -s0 - 0.05); // nosing
        for (const x of [-1.6, -0.6, 0.6, 1.6]) B('cyan', 0.14, 0.03, 0.02, x, y - 0.12, -s0 + 0.01); // riser lights
      }
      B('frame', W - 0.02, R, 0.1, 0, R / 2, -top - 0.05); // the last riser, up to the raised deck
      B('stripe', W - 0.04, 0.03, 0.1, 0, R - 0.015 + 0.03, -top - 0.05);
      for (const x of [-1.6, -0.6, 0.6, 1.6]) B('cyan', 0.14, 0.03, 0.02, x, R - 0.12, -top + 0.01);
    }
  }

  // ---- end wall: panelled around the door (door [w, h]: the opening on the raised deck, centred) or whole (end), lit so it reads at range
  if (door || end) {
    const z = -L + 0.04;
    const lamp = (w, ly) => {
      B('dark', w + 0.4, 0.26, 0.05, 0, ly, z + 0.16); // in front of the stiffeners (front z + 0.13)
      for (const t of [-0.055, 0.055]) B('tube', w, 0.06, 0.06, 0, ly + t, z + 0.21);
      B('halo', w + 1.8, 1.6, 0.004, 0, ly - 0.15, z + 0.04);
    };
    if (door) {
      const [dw, dh] = door;
      const ex = dw / 2 + 0.9; // outside the bulkhead frame
      const sideW = W / 2 - ex;
      if (sideW > 0.02) for (const s of [1, -1]) B('hull', sideW, H - R - 0.01, 0.06, s * (ex + sideW / 2), R + 0.01 + (H - R - 0.01) / 2, z);
      const ty = R + dh + 0.92; // the bulkhead's outline top
      if (H - ty > 0.02) B('hull', 2 * ex + 0.02, H - ty, 0.06, 0, ty + (H - ty) / 2, z);
      for (const s of [1, -1]) B('stripe', 0.12, H - R - 0.4, 0.07, s * (ex + 0.06), R + 0.02 + (H - R - 0.4) / 2, z + 0.01);
      if (H - ty > 0.2) lamp(2.4, ty + (H - ty) / 2);
      // light pool: a soft wash over the door and the deck in front of it (additive, no light), so the gate reads from the entrance
      B('pool', 2 * ex + 1.2, dh + 1.8, 0.004, 0, R + (dh + 1.8) / 2, z + 0.2);
      B('pool', 3.4, 0.004, 3.0, 0, R + 0.045, z + 1.6);
    } else {
      B('hull', W - 0.02, H - R - 0.01, 0.06, 0, R + 0.01 + (H - R - 0.01) / 2, z);
      const nS = Math.max(2, Math.round(W / 0.9));
      for (let i = 1; i < nS; i++) B('frame', 0.12, H - R - 0.4, 0.1, -W / 2 + (i * W) / nS, R + 0.2 + (H - R - 0.4) / 2, z + 0.08);
      for (const y of [R + 0.16, R + 1.15]) B(y < R + 1 ? 'dark' : 'stripe', W - 0.04, y < R + 1 ? 0.32 : 0.2, 0.14, 0, y, z + 0.1); // kick band, ochre rail
      lamp(Math.min(4, W - 2), R + (H - R) * 0.66);
      B('pool', Math.min(7, W), (H - R) * 0.9, 0.004, 0, R + (H - R) * 0.5, z + 0.2);
    }
  }
  return { parts, props };
}

// Ceiling dressing for a room that already has a ceiling (coffers, coves, light boxes): everything hangs in one band `drop` .. drop +
// depth under the ceiling, so it clears coffer beams above and heads (and jets) below. In the frame of arch.coffers: pos = centre x / z
// at the ceiling underside, size [w across X, l along Z at yaw 0]. Twin (or more) ribbed pipe runs `inset` m in from both long edges,
// a centre truss (top and bottom chords, laced faces, cross ties, X bracing) with hanger rods to the ceiling, cable runs along the
// truss, and tube fixtures under it where the seed says. No collision.
function ceiling(c) {
  const { W, L, drop, depth, pipes, inset, seed } = c;
  const parts = [];
  const A = adders(parts);
  const { B, C, seg } = A;
  const rnd = rng(seed * 7919 + 11);
  const yTop = -drop; // band top (ceiling at y = 0)
  const yBot = -drop - depth;
  const ax = [Math.PI / 2, 0, 0]; // a cylinder along Z
  // pipes: `pipes` per side, side by side, ribbed, ochre collars at seeded spots, clamps and hanger rods
  const pr = Math.min(0.14, depth / 2 - 0.01);
  const py = (yTop + yBot) / 2;
  for (const s of [1, -1]) {
    for (let k = 0; k < pipes; k++) {
      const x = s * (W / 2 - inset - k * (2 * pr + 0.08));
      const r = k ? pr * 0.75 : pr;
      C('pipe', r, c.caps ? L - 0.3 : L + 0.4, x, py, 0, ...ax, 16); // into the end walls, or into the junction boxes (caps)
      const nr = Math.round(L / 0.25);
      for (let i = 0; i < nr; i++) C('pipe', r + 0.018, 0.05, x, py, -L / 2 + (i + 0.5) * (L / nr), ...ax, 16); // ribs
      const off = rnd() * 2.5;
      for (let z = -L / 2 + 0.8 + off; z < L / 2 - 0.6; z += 2.5 + rnd() * 1.5) C('ochre', r + 0.03, 0.12, x, py, z, ...ax, 16); // collars
    }
    const xs = s * (W / 2 - inset - ((pipes - 1) * (2 * pr + 0.08)) / 2); // clamp centre over the pipe group
    const cw = (pipes - 1) * (2 * pr + 0.08) + 2 * pr + 0.12;
    if (c.caps && pipes) for (const e of [1, -1]) {
      // junction box the run ends in (a run that stops short of a wall), hung on two rods
      B('dark', cw + 0.1, depth + 0.04, 0.34, xs, py, e * (L / 2 - 0.17));
      B('ochre', cw + 0.12, 0.06, 0.2, xs, yBot + 0.02, e * (L / 2 - 0.17));
      for (const f of [1, -1]) B('dark', 0.035, drop + 0.06, 0.035, xs + (f * cw) / 3, (yTop + 0.06) / 2, e * (L / 2 - 0.17));
    }
    for (let z = -L / 2 + 0.6; z <= L / 2 - 0.6 + 1e-6; z += Math.max(1.2, (L - 1.2) / Math.max(1, Math.round((L - 1.2) / 2)))) {
      B('dark', cw, 0.05, 0.08, xs, yTop + 0.03, z); // saddle
      for (const e of [1, -1]) B('dark', 0.035, drop + 0.08, 0.035, xs + (e * cw) / 2, (yTop + 0.06) / 2, z); // rods into the ceiling
    }
  }
  if (c.truss) {
    const tw = 0.42; // half width
    for (const sx of [1, -1]) {
      for (const y of [yTop - 0.04, yBot + 0.04]) B('frame', 0.07, 0.07, L - 0.1, sx * tw, y, 0); // chords
      const nz = Math.max(2, Math.round(L / 0.6));
      const dz = (L - 0.1) / nz;
      const h = depth - 0.08;
      const lace = Math.hypot(dz, h);
      for (let i = 0; i < nz; i++) B('frame', 0.035, lace, 0.035, sx * tw, py, -L / 2 + 0.05 + (i + 0.5) * dz, (i % 2 ? 1 : -1) * Math.atan2(dz, h), 0, 0); // laced faces
    }
    const nt = Math.max(2, Math.round(L / 1.2));
    const dt = (L - 0.2) / nt;
    for (let i = 0; i <= nt; i++) {
      const z = -L / 2 + 0.1 + i * dt;
      B('frame', 2 * tw - 0.07, 0.05, 0.05, 0, yBot + 0.04, z); // cross tie (between the chords: their faces are not shared)
      if (i < nt) seg('frame', 0.03, [tw - 0.04, yBot + 0.09, z], [-tw + 0.04, yBot + 0.09, z + dt], true); // X bracing over the ties
      if (i < nt) seg('frame', 0.03, [-tw + 0.04, yBot + 0.12, z], [tw - 0.04, yBot + 0.12, z + dt], true);
      if (i % 2 === 0) for (const sx of [1, -1]) B('dark', 0.03, drop + 0.06, 0.03, sx * tw, yTop / 2 + 0.03, z + 0.06); // hangers
    }
    // cable runs on the truss: two dark cables sagging a little between the hangers
    for (const [cx, cr] of [[tw + 0.08, 0.03], [-(tw + 0.08), 0.022]]) {
      const span = 2 * dt;
      for (let z = -L / 2 + 0.16; z < L / 2 - 0.16 - 1e-6; z += span) {
        const z1 = Math.min(L / 2 - 0.16, z + span);
        let prev = [cx, yTop - 0.02, z];
        for (let i = 1; i <= 4; i++) {
          const t = i / 4;
          const pt = [cx, yTop - 0.02 - 0.07 * Math.sin(Math.PI * t), z + (z1 - z) * t];
          seg('dark', cr, prev, pt);
          prev = pt;
        }
      }
    }
    // tube fixtures under the truss (seeded gaps): dark housing, two tubes, a downward halo
    if (c.fixtures) {
      const nf = Math.max(1, Math.round(L / 3.2));
      for (let i = 0; i < nf; i++) {
        if (nf > 2 && rnd() < 0.25) continue;
        const z = -L / 2 + (i + 0.5) * (L / nf);
        const fy = yBot - 0.05;
        B('dark', 0.3, 0.06, 1.5, 0, fy, z);
        for (const x of [-0.07, 0.07]) C('tube', 0.022, 1.36, x, fy - 0.045, z, ...ax, 8);
        B('halo', 1.1, 0.004, 2.2, 0, fy - 0.075, z);
      }
    }
  }
  return parts;
}

const SIDES = ['both', 'left', 'right', 'none'];
function flag(id, p, key, def) {
  const v = p[key] ?? def;
  if (typeof v !== 'boolean') fail(id, `"${key}" must be true or false, got ${JSON.stringify(v)}`);
  return v;
}

export const INTERIOR_PIECES = {
  // Dressing for a corridor or room shell (walls at x = +-width/2 and a roof at `height`, both built by the level): pos = the floor
  // centre of the entrance, it runs `length` toward -Z at yaw 0. Bays of about `bay` m between rib frames. steps (0 = flat) of `rise`
  // and `run` start `stepAt` m in and lead up to a raised deck (steps x rise, collides). door [w, h] panels the end wall around an
  // opening (pair it with kit.doorway + arch.bulkhead at the end); end: panels a closed end wall. sides / ceiling / floor switch the
  // parts; props: crates and consoles among the one-offs (they collide; off by default); collide: one box per side over the dressing
  // (0.45 deep). seed: the one-off pattern (turbines, arms, hoses, crates, consoles, panel kinds).
  'arch.corridor': {
    example: { params: { length: 9, width: 6, height: 5, bay: 3 } },
    label: 'CORRIDOR interior kit: wall bays, ribs, truss, pipes, tubes, deck, steps',
    fields: [
      { key: 'length', type: 'number', min: 2 },
      { key: 'width', type: 'number', min: 3 },
      { key: 'height', type: 'number', min: 4.2 },
      { key: 'bay', type: 'number', min: 1.5, optional: true },
      { key: 'steps', type: 'number', min: 0, optional: true },
      { key: 'rise', type: 'number', min: 0.05, optional: true },
      { key: 'run', type: 'number', min: 0.3, optional: true },
      { key: 'stepAt', type: 'number', min: 0, optional: true },
      { key: 'door', type: 'vec2', min: 0.5, optional: true },
      { key: 'end', type: 'bool', def: false },
      { key: 'sides', type: 'enum', options: SIDES, optional: true },
      { key: 'ceiling', type: 'bool', def: true },
      { key: 'floor', type: 'bool', def: true },
      { key: 'props', type: 'bool', def: false },
      { key: 'collide', type: 'bool', def: true },
      { key: 'seed', type: 'number', min: 0, optional: true },
    ],
    build(world, d) {
      const id = 'arch.corridor';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const c = {
        L: num(id, p, 'length', 24, 2),
        W: num(id, p, 'width', 6, 3),
        H: num(id, p, 'height', 5, 4.2),
        bayLen: num(id, p, 'bay', 3, 1.5),
        steps: num(id, p, 'steps', 0, 0, true),
        rise: num(id, p, 'rise', 0.25, 0.05),
        run: num(id, p, 'run', 0.6, 0.3),
        stepAt: num(id, p, 'stepAt', 4, 0),
        door: p.door ?? null,
        end: flag(id, p, 'end', false),
        sides: p.sides ?? 'both',
        ceiling: flag(id, p, 'ceiling', true),
        floor: flag(id, p, 'floor', true),
        props: flag(id, p, 'props', false),
        seed: num(id, p, 'seed', 1, 0, true),
      };
      const collide = flag(id, p, 'collide', true);
      if (!SIDES.includes(c.sides)) fail(id, `"sides" must be one of ${SIDES.join(', ')}, got ${JSON.stringify(c.sides)}`);
      if (c.rise > 0.45) fail(id, `"rise" ${c.rise} is above the step height 0.45`);
      if (c.steps && c.stepAt + c.steps * c.run > c.L - 0.5) fail(id, `steps end past the corridor (stepAt + steps x run must be <= length - 0.5)`);
      if (c.door && (!Array.isArray(c.door) || c.door.length !== 2 || c.door.some((v) => typeof v !== 'number' || !(v > 0)))) fail(id, `"door" must be [w, h] > 0`);
      const { parts, props } = corridor(c);
      const meshes = build(world, d, q, parts, null, props);
      if (collide) for (const s of { both: [1, -1], right: [1], left: [-1], none: [] }[c.sides]) collider(world, d, q, { x: s * (c.W / 2 - P.dressing / 2), z: -c.L / 2, w: P.dressing, d: c.L }, c.H);
      for (let k = 1; k <= c.steps; k++) {
        const s0 = c.stepAt + (k - 1) * c.run;
        collider(world, d, q, { x: 0, z: -(s0 + c.L) / 2, w: c.W, d: c.L - s0 }, k * c.rise);
      }
      return meshes;
    },
  },

  // One wall of the interior kit, for rooms: like arch.panelling (pos = bottom centre on the wall face, `length` along X, the room
  // toward +Z, up to `height`), cut into bays of about `bay` m with thin pilasters between them. slim (default): inside the
  // panelling's envelope (<= 0.12 m off the wall below 2.6 m, <= 0.05 above, where wall signs hang), so it swaps for arch.panelling on
  // walls the player hugs and takes cover against; no one-offs. slim false: the corridor's full depth (0.45) with one-offs. No collision.
  'arch.wall': {
    example: { params: { length: 6, height: 4.4 } },
    label: 'WALL interior kit wall run: bays, slim like panelling, no collision',
    fields: [
      { key: 'length', type: 'number', min: 1 },
      { key: 'height', type: 'number', min: 2.8 },
      { key: 'bay', type: 'number', min: 1, optional: true },
      { key: 'slim', type: 'bool', def: true },
      { key: 'seed', type: 'number', min: 0, optional: true },
    ],
    build(world, d) {
      const id = 'arch.wall';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const L = num(id, p, 'length', 4, 1);
      const H = Math.max(2.8, num(id, p, 'height', 4.4, 2.8));
      const slim = flag(id, p, 'slim', true);
      const n = Math.max(1, Math.round(L / num(id, p, 'bay', 2.6, 1)));
      const b = L / n;
      const parts = [];
      const A = adders(parts);
      // built like a corridor's left wall (the face at x = 0, the room toward +x, the run along -z), then turned so the run is along
      // +X and the room toward +Z
      const X = (v) => v;
      const rnd = rng(num(id, p, 'seed', 1, 0, true) * 7919 + 3);
      const [lo, hi] = slim ? [0.12, 0.05] : [0.46, 0.46];
      for (let i = 0; i <= n; i++) {
        const z = L / 2 - Math.min(L - 0.06, Math.max(0.06, i * b)); // pilasters, the end ones inside the run
        // pilasters start 1.5 cm off the wall: their backs and the bays' backs on one plane z-fight where the wall has a gap behind
        A.B('frame', lo - 0.015, 2.62, 0.115, (lo + 0.015) / 2, 1.31, z); // 2 cm over the panel heads (flush tops z-fight)
        A.B('frame', hi - 0.015, H - 2.71, 0.115, (hi + 0.015) / 2, 2.62 + (H - 2.71) / 2, z); // stops 1 cm under the cap (flush tops z-fight)
        if (slim) A.B('cyan', 0.02, 0.03, 0.03, lo, 1.8, z);
      }
      for (let i = 0; i < n; i++) wallBay(A, { X, s: -1, zc: L / 2 - (i + 0.5) * b, len: b - 0.06, y0: 0, top: H, cornice: false, slim, rnd, pipe: null, flat: false, props: null, capLen: b });
      return build(world, d, q, parts, new THREE.Matrix4().makeRotationY(-Math.PI / 2));
    },
  },
  // Ceiling dressing for a room with a ceiling already in place (fits under arch.coffers, arch.cove and light boxes): pos = centre at
  // the ceiling underside, size [w, l] (l along Z at yaw 0), everything in the band `drop` (0.58: clears 0.45 coffers) to drop +
  // `depth` (0.3) under the ceiling. `pipes` (1, 0..3) ribbed pipes per side `inset` (1.1) m in from the long edges (clear of 0.7 coves),
  // `truss` (centre truss, cable runs, hanger rods), `fixtures` (tube fixtures under the truss, seeded gaps), `caps` (the pipes end in
  // junction boxes instead of running 20 cm into the end walls: a run that stops short of a wall), `seed`. No collision.
  'arch.ceiling': {
    example: { params: { size: [6, 8] } },
    label: 'CEILING truss, ribbed pipes, cables, tube fixtures; no collision',
    fields: [
      { key: 'size', type: 'vec2', min: 1 },
      { key: 'drop', type: 'number', min: 0, optional: true },
      { key: 'depth', type: 'number', min: 0.15, optional: true },
      { key: 'pipes', type: 'number', min: 0, optional: true },
      { key: 'inset', type: 'number', min: 0.2, optional: true },
      { key: 'truss', type: 'bool', def: true },
      { key: 'fixtures', type: 'bool', def: true },
      { key: 'caps', type: 'bool', def: false },
      { key: 'seed', type: 'number', min: 0, optional: true },
    ],
    build(world, d) {
      const id = 'arch.ceiling';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const size = p.size ?? [6, 8];
      if (!Array.isArray(size) || size.length !== 2 || size.some((v) => typeof v !== 'number' || !(v > 0))) fail(id, `"size" must be [w, l] > 0, got ${JSON.stringify(size)}`);
      const c = {
        W: size[0],
        L: size[1],
        drop: p.drop ?? 0.58,
        depth: num(id, p, 'depth', 0.3, 0.15),
        pipes: num(id, p, 'pipes', 1, 0, true),
        inset: num(id, p, 'inset', 1.1, 0.2),
        truss: flag(id, p, 'truss', true),
        fixtures: flag(id, p, 'fixtures', true),
        caps: flag(id, p, 'caps', false),
        seed: num(id, p, 'seed', 1, 0, true),
      };
      if (typeof c.drop !== 'number' || !(c.drop >= 0)) fail(id, `"drop" must be a number >= 0`);
      if (c.pipes > 3) fail(id, `"pipes" must be 0..3, got ${c.pipes}`);
      return build(world, d, q, ceiling(c));
    },
  },
};
