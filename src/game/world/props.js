import * as THREE from 'three';
import { mergeGroup } from '../../engine/batch.js';
import { rb, cyl, ring, part } from '../actors/parts.js';
import { wornMaterial, stencilTexture } from './textures.js';
import { quarters, turn } from './kit.js';
import { onProblem } from './encounter.js';

// Set dressing (`prop.*` registry ids, a public contract: instructions/level.md; style: art-style.md "Props"). Procedural
// pieces built from primitives (parts.js) in a few permanent materials (propMaterials, made once by the World), so every
// static prop of a level ends up in the level batches: one draw per material for all of them (engine.md, mergeStatic).
// Each piece is first merged to one mesh per material (mergeGroup), so a piece spawned alone (editor, Library) is cheap too.
// Collision is an invisible axis-aligned box (World.box, hidden, kept in world.props so unload frees it): pieces with one
// take `yaw` in quarter turns only (kit.js `quarters`); purely decorative ones take any yaw.
// At yaw 0 a piece's front faces +Z and its length runs along +X (like kit.*). Only prop.arm, prop.cradle and prop.beacon move (world.props, animateProps).

const OCHRE = '#c9a23a';
const ARM = { mount: 5.85, upper: 1.4, fore: 1.2, time: 2, rest: [0.9, -0.5], folded: [1.55, -2.8] }; // m, s, [shoulder, elbow] rad
const BEACON = { color: 0xff9a2a, lamp: [0, 0.32, 0.42], turn: 0.9, spread: 0.55, reach: 3.2, beam: 0.03 }; // alarm amber (env.alarm), rev/s, beam cone m, opacity
const CRATE = { small: [0.8, 0.8, 0.8], medium: [1.6, 1.1, 1.1], large: [1.6, 1.6, 1.6] }; // [w, h, d]; medium = low cover (metrics.md 3)
const SCREEN = { rows: 32, rate: 5 }; // readout rows in the texture, rows scrolled per second
// prop.cradle release: per moving part, s after the event it starts and s it takes (all done in CRADLE.time)
const CRADLE = { time: 1.4, umbilical: [0, 0.55], foot: [0.05, 0.4], shoulder: [0.15, 0.9], brace: [0.4, 1.0] };

// Plain box (cached geometry, 12 triangles): frames, rims, brackets. Rounded boxes (rb) only where the silhouette shows it.
const boxes = new Map();
const bx = (m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
  const k = `${w}|${h}|${d}`;
  if (!boxes.has(k)) boxes.set(k, new THREE.BoxGeometry(w, h, d));
  return part(boxes.get(k), m, x, y, z, rx, ry, rz);
};

const fail = (id, msg) => {
  throw new Error(`${id}: ${msg}`);
};

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function texture(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Small deterministic noise for scuffs (the props look the same every run, like the wear maps).
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Diagonal ochre / dark warning stripes, tileable, 1 texture tile = 1 m (art-style: the warning colour is ochre, not yellow).
function hazardTexture() {
  const n = 128;
  const [c, g] = canvas(n, n);
  g.fillStyle = '#1b1d1f';
  g.fillRect(0, 0, n, n);
  g.fillStyle = OCHRE;
  for (let k = -2; k < 4; k++) {
    g.beginPath();
    g.moveTo(k * 64, 0);
    g.lineTo(k * 64 + 32, 0);
    g.lineTo(k * 64 + 32 - n, n);
    g.lineTo(k * 64 - n, n);
    g.fill();
  }
  const r = rng(7);
  g.fillStyle = 'rgba(20,18,14,0.35)';
  for (let i = 0; i < 90; i++) g.fillRect(r() * n, r() * n, 1 + r() * 5, 1 + r() * 3); // scuffs, worn by traffic
  return texture(c, true);
}

// Diagnostic readout: short bars per row, black between (an emissive map: the material's emissive colour tints it).
function screenTexture() {
  const [c, g] = canvas(128, SCREEN.rows * 8);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const r = rng(31);
  for (let row = 0; row < SCREEN.rows; row++) {
    if (r() < 0.15) continue;
    let x = 6;
    const y = row * 8 + 2;
    g.fillStyle = `rgba(255,255,255,${0.45 + r() * 0.5})`;
    while (x < 120) {
      const w = 3 + r() * 26;
      if (x + w > 122) break;
      g.fillRect(x, y, w, 4);
      x += w + 3 + r() * 8;
      if (r() < 0.2) break;
    }
  }
  return texture(c, true);
}

// The permanent prop materials (World keeps them across levels, like World.mats). Panels add one each per text (panelMaterial).
export function propMaterials() {
  return {
    metal: wornMaterial(0x3a3d40, { roughness: 0.6, metalness: 0.45, wear: 'metal' }), // dark metal frames, pedestals, pipes
    dark: wornMaterial(0x202328, { roughness: 0.65, metalness: 0.4, wear: 'metal' }), // joints, brackets, cable sheaths
    ochre: wornMaterial(0xc9a640, { roughness: 0.88, metalness: 0.08 }), // calibration-frame ochre (the puppets' shell), arm livery, valves
    crate: wornMaterial(0x4a5452, { roughness: 0.85, metalness: 0.15 }), // dull grey-green crate paint
    stencil: new THREE.MeshStandardMaterial({ map: stencilTexture('CAL-STORE 00'), roughness: 0.85, metalness: 0.2 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.9, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -2 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3fe0ff, emissiveMap: screenTexture(), emissiveIntensity: 1.3, roughness: 0.35 }),
    // ammo-class glows (the ammo cases' colours, pickups.js): light cyan, heavy amber; repair cold white. Racks and supply points only.
    glowLight: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d8ff, emissiveIntensity: 1.6 }), // low enough to keep the hue (3 reads white)
    glowHeavy: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa11c, emissiveIntensity: 2 }),
    glowWhite: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xeaf6fa, emissiveIntensity: 2.2 }),
    panels: new Map(), // text -> material
  };
}

// Stencilled warning panel face (env.label's canvas text approach): dark plate, ochre stripe band on top, ochre caps.
// Cached per text and kept for good (World.keep): a level names a handful of texts.
function panelMaterial(world, text) {
  const cache = world.dressing.panels;
  if (cache.has(text)) return cache.get(text);
  const px = 64;
  const lines = String(text).split('\n');
  const [m, mg] = canvas(8, 8);
  mg.font = `bold ${px}px monospace`;
  const pad = px * 0.5;
  const band = px * 0.45;
  const [c, g] = canvas(Math.ceil(Math.max(...lines.map((l) => mg.measureText(l).width)) + pad * 2), Math.ceil(band + lines.length * px * 1.15 + pad * 1.6));
  g.fillStyle = '#23272a';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = OCHRE;
  g.save();
  g.beginPath();
  g.rect(0, 0, c.width, band);
  g.clip();
  for (let x = -band; x < c.width; x += band * 1.2) {
    g.beginPath();
    g.moveTo(x, band);
    g.lineTo(x + band * 0.6, band);
    g.lineTo(x + band * 1.2, 0);
    g.lineTo(x + band * 0.6, 0);
    g.fill();
  }
  g.restore();
  g.font = `bold ${px}px monospace`;
  g.textBaseline = 'top';
  g.fillStyle = 'rgba(201,162,58,0.9)';
  lines.forEach((l, i) => g.fillText(l, pad, band + pad * 0.6 + i * px * 1.15));
  const r = rng(text.length * 131 + 9);
  g.fillStyle = 'rgba(35,39,42,0.9)'; // stencil bridges and scuffs
  for (let x = pad; x < c.width - pad; x += px * 0.37) g.fillRect(x, band + pad * 0.6 + px * 0.42, 3, px * 0.12);
  for (let i = 0; i < 120; i++) g.fillRect(r() * c.width, r() * c.height, 1 + r() * 4, 1 + r() * 2);
  const mat = new THREE.MeshStandardMaterial({ map: texture(c), roughness: 0.85, metalness: 0.2 });
  mat.userData.aspect = c.height / c.width;
  cache.set(text, mat);
  world.keep.add(mat);
  return mat;
}

// A plane with its own geometry (custom UVs): freed after the merge.
function plane(mat, w, h, uvW = 1, uvH = 1, v0 = 0) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvW, uv.getY(i) * uvH + v0);
  const m = new THREE.Mesh(geo, mat);
  m.userData.own = true;
  return m;
}

// Static parts -> the level: one mesh per material at pos / yaw, added to World.staticMeshes (merged with the level on
// load; freed by unload or despawn). Parts: meshes or groups in the piece's frame. shadow false: nothing casts (decals).
export function bake(world, d, parts, { shadow = true, yaw = d.yaw ?? 0 } = {}) {
  const g = new THREE.Group();
  g.position.set(...d.pos);
  g.rotation.y = yaw;
  for (const p of parts) g.add(p);
  const own = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = shadow; // same flags everywhere: one bucket per material in the level batches
    o.receiveShadow = true;
    if (o.userData.own) own.push(o.geometry);
  });
  mergeGroup(g);
  for (const geo of own) geo.dispose();
  g.updateMatrixWorld(true);
  const out = [];
  for (const m of [...g.children]) {
    if (!m.isMesh) continue; // a sub-group mergeGroup emptied
    m.matrix.copy(m.matrixWorld);
    m.matrixAutoUpdate = false;
    world.scene.add(m);
    world.staticMeshes.push(m);
    out.push(m);
  }
  return out;
}

// Invisible collision box in the piece's frame ({ x, z, w, d } local, h from pos.y), turned by q quarter turns.
export function collider(world, d, q, box, h, cover = null) {
  const [b] = turn([box], q);
  const m = world.box(d.pos[0] + b.x, d.pos[1], d.pos[2] + b.z, b.w, h, b.d, world.mats.wall, { cover, shadow: false });
  world.staticMeshes.splice(world.staticMeshes.indexOf(m), 1);
  m.visible = false;
  world.props.push(m);
  return m;
}

function vec3(id, v, key) {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) fail(id, `"${key}" must be [x, y, z], got ${JSON.stringify(v)}`);
  return v;
}

function count(id, p, key, def, lo, hi) {
  const v = p[key] ?? def;
  if (!Number.isInteger(v) || v < lo || v > hi) fail(id, `"${key}" must be a whole number ${lo}..${hi}, got ${JSON.stringify(v)}`);
  return v;
}

function length(id, p, key, def) {
  const v = p[key] ?? def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(id, `"${key}" must be a number > 0, got ${JSON.stringify(v)}`);
  return v;
}

// One hanging inert puppet (looks.js puppet, simplified to static plates in the same ochre / black), hook at y = top.
function hangingPuppet(M, x, top, tilt) {
  const g = new THREE.Group();
  g.position.set(x, top, 0);
  g.rotation.set(0.04, tilt * 2.5, tilt);
  g.add(
    cyl(M.dark, 0.015, 0.015, 0.3, 0, -0.15, 0, 0, 0, 0, 6), // hook rod
    rb(M.dark, 0.12, 0.06, 0.12, 0.02, 0, -0.32, 0), // neck clamp
    rb(M.ochre, 0.2, 0.24, 0.22, 0.05, 0, -0.48, 0.01), // head
    rb(M.dark, 0.15, 0.035, 0.02, 0.01, 0.01, -0.46, 0.125), // dead sensor band (no glow: inert)
    rb(M.ochre, 0.42, 0.42, 0.24, 0.06, 0, -0.85, 0), // chest
    rb(M.dark, 0.3, 0.12, 0.2, 0.03, 0, -1.12, 0), // waist
    rb(M.ochre, 0.32, 0.17, 0.21, 0.06, 0, -1.26, 0), // hips
  );
  for (const s of [1, -1]) {
    g.add(
      cyl(M.dark, 0.06, 0.06, 0.12, s * 0.25, -0.7, 0, 0, 0, Math.PI / 2, 8), // shoulder drum
      cyl(M.ochre, 0.05, 0.045, 0.55, s * 0.27, -1.0, 0.02, 0.08, 0, s * 0.06, 8), // arm
      cyl(M.ochre, 0.065, 0.055, 0.78, s * 0.1, -1.72, 0.02, 0.05, 0, s * 0.03, 8), // leg
      rb(M.dark, 0.1, 0.06, 0.2, 0.02, s * 0.11, -2.12, 0.05), // foot
    );
  }
  return g;
}

function armSegments(M) {
  const upper = new THREE.Group();
  upper.add(
    rb(M.ochre, 0.2, ARM.upper, 0.18, 0.04, 0, -ARM.upper / 2, 0),
    cyl(M.metal, 0.04, 0.04, ARM.upper * 0.8, 0, -ARM.upper * 0.45, 0.14, 0, 0, 0, 8), // hydraulic piston
    cyl(M.metal, 0.11, 0.11, 0.3, 0, -ARM.upper, 0, 0, 0, Math.PI / 2, 10), // elbow drum
  );
  const fore = new THREE.Group();
  fore.add(
    rb(M.metal, 0.16, ARM.fore, 0.15, 0.03, 0, -ARM.fore / 2, 0),
    rb(M.ochre, 0.18, 0.5, 0.05, 0.015, 0, -0.4, 0.09), // cover plate
    cyl(M.metal, 0.07, 0.07, 0.15, 0, -ARM.fore - 0.05, 0, 0, 0, 0, 10), // wrist
    rb(M.ochre, 0.24, 0.18, 0.24, 0.03, 0, -ARM.fore - 0.2, 0), // tool head
    cyl(M.metal, 0.025, 0.01, 0.3, 0, -ARM.fore - 0.42, 0, 0, 0, 0, 6), // probe
    rb(M.metal, 0.03, 0.16, 0.05, 0.01, 0.09, -ARM.fore - 0.35, 0), // clamp fingers
    rb(M.metal, 0.03, 0.16, 0.05, 0.01, -0.09, -ARM.fore - 0.35, 0),
  );
  return { upper: mergeGroup(upper), fore: mergeGroup(fore) };
}

function setArm(a, k) {
  const e = k * k * (3 - 2 * k);
  a.shoulder.rotation.x = ARM.rest[0] + (ARM.folded[0] - ARM.rest[0]) * e;
  a.elbow.rotation.x = ARM.rest[1] + (ARM.folded[1] - ARM.rest[1]) * e;
}

// Per frame (World.update): the screens' readout scrolls a row at a time and flickers (one shared material: no texture
// upload, no per-instance work); arms told to retract fold up. No allocations.
export function animateProps(world, t, dt) {
  const s = world.dressing.screen;
  s.emissiveMap.offset.y = Math.floor(t * SCREEN.rate) / SCREEN.rows;
  s.emissiveIntensity = Math.sin(t * 1.7) * Math.sin(t * 0.6) > 0.93 ? 0.5 : 1.25 + 0.08 * Math.sin(t * 47);
  for (const g of world.props) {
    const c = g.userData.cradle;
    if (c?.releasing && c.t < CRADLE.time) {
      c.t = Math.min(CRADLE.time, c.t + dt);
      for (const m of c.parts) setCradlePart(m, c.t);
    }
    const b = g.userData.beacon;
    if (b) {
      b.lens.material.emissiveIntensity = b.active ? 2.4 + 1.2 * Math.max(0, Math.sin(t * 9)) : 0;
      b.beam.opacity = b.active ? BEACON.beam : 0;
      if (b.active) b.spin.rotation.y += dt * BEACON.turn * Math.PI * 2;
    }
    g.userData.backdrop?.(t); // env.backdrop (backdrop.js): drones, searchlights, breathing lights
    const a = g.userData.arm;
    if (!a?.retracting || a.k >= 1) continue;
    a.k = Math.min(1, a.k + dt / ARM.time);
    setArm(a, a.k);
  }
}


// One moving part of a cradle at `t` s after its release: closed (rotation 0, its base position) -> `open` [rx, ry, rz] and
// `move` [dx, dy, dz], eased. The umbilicals fall (ease in), the clamps swing (smoothstep).
function setCradlePart(m, t) {
  const [delay, dur] = CRADLE[m.kind];
  const u = Math.min(1, Math.max(0, (t - delay) / dur));
  const e = m.kind === 'umbilical' ? u * u : u * u * (3 - 2 * u);
  m.g.rotation.set(m.open[0] * e, m.open[1] * e, m.open[2] * e);
  m.g.position.set(m.base[0] + m.move[0] * e, m.base[1] + m.move[1] * e, m.base[2] + m.move[2] * e);
}

// The cradle's moving parts, closed, each a pivot group in the piece's frame (unit at the origin facing +Z, frame at -Z):
// [{ g, kind, base, open, move }]. Closed = rotation 0 at `base`; released = rotation `open`, moved by `move`. Single-material
// groups (one draw each).
function cradleParts(M) {
  const out = [];
  const pivot = (kind, open, move, x, y, z, ...parts) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    for (const p of parts) g.add(p);
    out.push({ g, kind, base: [x, y, z], open, move });
  };
  const still = [0, 0, 0];
  for (const s of [1, -1]) {
    // shoulder clamp: hinged on the upright, reaches forward past the shoulder and folds in over it; swings out to the side
    pivot('shoulder', [0, s * 2.0, 0], still, s * 0.62, 1.47, -0.44,
      bx(M.ochre, 0.1, 0.1, 0.62, 0, 0, 0.29),
      bx(M.ochre, 0.42, 0.08, 0.1, -s * 0.2, 0.02, 0.56),
      bx(M.ochre, 0.16, 0.05, 0.22, -s * 0.4, -0.02, 0.56), // pad on the shoulder
      cyl(M.ochre, 0.04, 0.04, 0.2, 0, 0, 0, 0, 0, 0, 8)); // hinge pin
    // foot clamp jaw: lies over the outer half of the foot, tips up and out
    pivot('foot', [0, 0, -s * 1.2], still, s * 0.34, 0.12, 0.02, bx(M.ochre, 0.24, 0.05, 0.3, -s * 0.12, 0.01, 0), bx(M.ochre, 0.03, 0.1, 0.28, -s * 0.235, -0.04, 0)); // lip 1 cm short of the jaw's ends, 1 cm proud of its edge
  }
  // head brace: an arm out of the spine, a horseshoe behind the head with pads at its sides; pulls back into the spine
  const brace = [bx(M.metal, 0.1, 0.1, 0.52, 0, 0, 0.26), bx(M.metal, 0.08, 0.4, 0.08, 0, -0.18, 0.5), bx(M.metal, 0.38, 0.08, 0.06, 0, -0.38, 0.52)];
  // side arms 1 cm over / under the horseshoe bar (flush tops z-fight)
  for (const s of [1, -1]) brace.push(bx(M.metal, 0.05, 0.1, 0.28, s * 0.17, -0.38, 0.66), bx(M.metal, 0.04, 0.13, 0.09, s * 0.15, -0.38, 0.77));
  pivot('brace', still, [0, 0.12, -0.42], 0, 2.0, -0.56, ...brace);
  // umbilicals: three cables from the spine into the unit's back (plug ends at z -0.12); they drop away and hang
  const cables = [];
  for (const [x0, x1, y1, r] of [[-0.1, -0.09, -0.42, 0.035], [0.1, 0.09, -0.42, 0.035], [0, 0, -0.66, 0.045]]) {
    const pts = [[x0, 0, 0.02], [x0 * 1.1, y1 - 0.2, 0.14], [x1, y1 - 0.06, 0.3], [x1, y1, 0.38]].map((v) => new THREE.Vector3(...v));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, r, 6), M.dark);
    tube.userData.own = true;
    cables.push(tube, cyl(M.dark, r + 0.02, r + 0.02, 0.1, x1, y1, 0.39, Math.PI / 2, 0, 0, 8)); // plug
  }
  pivot('umbilical', [0.6, 0, 0], still, 0, 1.62, -0.5, ...cables);
  return out;
}

// The cradle frame (static): sill, uprights, header, the spine the unit's back rests against, sockets, a status readout.
function cradleFrame(M, phase) {
  const parts = [
    bx(M.dark, 1.3, 0.02, 1.0, 0, 0.01, -0.12), // deck plate under the feet
    bx(M.metal, 1.5, 0.16, 0.36, 0, 0.08, -0.56), // sill
    bx(M.metal, 1.44, 0.18, 0.26, 0, 2.7, -0.56), // header, ends 1 cm inside the uprights' outer faces (flush z-fights)
    bx(M.ochre, 1.0, 0.12, 0.02, 0, 2.7, -0.42), // header plate
    rb(M.dark, 0.34, 2.45, 0.2, 0.04, 0, 1.3, -0.62), // spine
    rb(M.dark, 0.38, 0.62, 0.06, 0.02, 0, 1.12, -0.42), // back rest
  ];
  for (let y = 0.45; y < 2.4; y += 0.3) parts.push(bx(M.metal, 0.46, 0.06, 0.26, 0, y, -0.6)); // vertebrae
  for (const s of [1, -1]) {
    parts.push(
      bx(M.metal, 0.14, 2.7, 0.18, s * 0.66, 1.35, -0.56), // upright
      bx(M.ochre, 0.02, 2.0, 0.1, s * 0.735, 1.35, -0.56), // livery stripe
      cyl(M.dark, 0.07, 0.07, 0.18, s * 0.62, 1.47, -0.44, 0, 0, 0, 8), // shoulder clamp hinge
      bx(M.dark, 0.13, 0.12, 0.38, s * 0.36, 0.06, 0.02), // foot clamp housing
      bx(M.metal, 0.55, 0.06, 0.06, s * 0.34, 0.6, -0.51, 0, 0, s * 0.9), // brace between upright and spine, 1 cm behind the vertebrae fronts
    );
  }
  for (const [x, z] of [[-0.1, -0.5], [0.1, -0.5], [0, -0.49]]) parts.push(cyl(M.metal, 0.06, 0.06, 0.1, x, 1.62, z, Math.PI / 2, 0, 0, 8)); // umbilical sockets (they overlap: the middle one 1 cm proud)
  const scr = plane(M.screen, 0.1, 0.36, 0.25, 0.4, phase);
  scr.position.set(-0.66, 1.85, -0.465);
  parts.push(scr);
  return parts;
}

// ---- weapon racks and supply points (gameplay props: the pickups system reads world.supplies) ----
export const SUPPLY = { reach: 1.4, front: 0.95, cooldown: 1.2 }; // m from the use spot in front, m the spot sits out from pos, s between uses
const AMMO_CLASSES = ['light', 'heavy', 'all'];
const glowOf = (M, ammo) => (ammo === 'heavy' ? M.glowHeavy : ammo === 'light' ? M.glowLight : M.glowWhite);

// One ammo case on a shelf (the pickups' look: light = small, one band; heavy = taller, two bands), bottom at y.
function ammoCase(M, ammo, x, y, z) {
  const heavy = ammo === 'heavy';
  const [w, h, d] = heavy ? [0.3, 0.34, 0.3] : [0.34, 0.2, 0.22];
  const out = [bx(M.dark, w, h, d, x, y + h / 2, z)];
  for (const dy of heavy ? [-0.08, 0.08] : [0]) out.push(bx(glowOf(M, ammo), w + 0.02, 0.05, d + 0.02, x, y + h / 2 + dy, z));
  return out;
}

// Supply cabinet shell (front +Z, back against a wall): plinth, body, ochre edges, header with a stencil plate, status screen, class band.
function supplyCabinet(world, M, text, glow) {
  const plate = panelMaterial(world, text);
  const pw = 1.0;
  const ph = Math.min(0.26, pw * plate.userData.aspect);
  const label = plane(plate, pw, ph);
  label.position.set(0, 2.24, 0.275);
  const scr = plane(M.screen, 0.46, 0.26, 1, 0.4, 0.3);
  scr.position.set(0.28, 1.62, 0.29);
  return [
    bx(M.dark, 1.36, 0.12, 0.66, 0, 0.06, -0.05), // plinth
    bx(M.metal, 1.3, 2.0, 0.6, 0, 1.1, -0.05), // body
    bx(M.dark, 1.36, 0.32, 0.16, 0, 2.24, 0.185), // header, 1.5 cm proud of the body front (flush fronts z-fight)
    label,
    bx(M.ochre, 0.06, 1.86, 0.01, 0.6, 1.08, 0.255), // ochre edges, 0.5 cm proud of the body
    bx(M.ochre, 0.06, 1.86, 0.01, -0.6, 1.08, 0.255),
    bx(M.dark, 0.56, 0.36, 0.02, 0.28, 1.62, 0.26), // screen bezel
    scr,
    bx(glow, 1.08, 0.05, 0.02, 0, 1.98, 0.27), // class band under the header
    bx(M.dark, 0.36, 0.5, 0.02, -0.33, 1.55, 0.26), // vent
  ];
}

// The use spot: a hidden record the pickups system reads (Pickups.update: prompt, interact). Kept in world.props: freed and sector-tagged with them.
function supplyRecord(world, d, kind, extra) {
  const y = d.yaw ?? 0;
  const root = new THREE.Object3D();
  root.position.set(d.pos[0] + Math.sin(y) * SUPPLY.front, d.pos[1], d.pos[2] + Math.cos(y) * SUPPLY.front);
  root.userData.supply = { kind, at: new THREE.Vector3(d.pos[0], d.pos[1] + 1.9, d.pos[2]), cool: 0, ...extra };
  world.scene.add(root);
  world.props.push(root);
  world.supplies.push(root);
  return root;
}

const RACK = { slot: 0.95, shelf: 0.95 }; // m per gun slot, shelf top

export const PROP_PIECES = {
  // Weapon rack: a low cabinet whose top is the shelf the guns lie on (place `pickup.gun` with `rack: true` on it, y = pos.y + 0.95,
  // yaw = the rack's yaw + 90 degrees so the barrel runs along it), a back board with pegs and a glowing class band along the shelf
  // edge: `ammo` 'light' (cyan) / 'heavy' (amber), the colours of the ammo cases. `slots` (3, 1..6): 0.95 m each. Front +Z at yaw 0.
  // Collision: the cabinet (slots x 0.95 + 0.3) x 0.5, 0.95 high, not cover. `yaw` in quarter turns.
  'prop.gunRack': {
    example: { params: { slots: 3, ammo: 'light' } },
    label: 'GUN RACK shelf for pickup.gun (rack: true), cyan / amber class band',
    fields: [{ key: 'slots', type: 'number', min: 1 }, { key: 'ammo', type: 'enum', options: ['light', 'heavy'] }],
    build(world, d) {
      const id = 'prop.gunRack';
      const q = quarters(id, d.yaw);
      const p = d.params ?? {};
      const n = count(id, p, 'slots', 3, 1, 6);
      const ammo = p.ammo ?? 'light';
      if (ammo !== 'light' && ammo !== 'heavy') fail(id, `"ammo" must be light or heavy, got ${JSON.stringify(ammo)}`);
      const M = world.dressing;
      const w = n * RACK.slot + 0.3;
      const parts = [
        bx(M.dark, w + 0.04, 0.1, 0.54, 0, 0.05, 0), // plinth
        bx(M.metal, w, RACK.shelf - 0.15, 0.5, 0, 0.1 + (RACK.shelf - 0.15) / 2, 0), // cabinet
        bx(M.dark, w + 0.02, 0.05, 0.52, 0, RACK.shelf - 0.025, 0), // shelf plate, 1 cm over the cabinet's sides
        bx(glowOf(M, ammo), w - 0.1, 0.04, 0.02, 0, RACK.shelf - 0.11, 0.255), // class band under the shelf edge
        bx(M.dark, w, 1.3, 0.06, 0, RACK.shelf + 0.65, -0.28), // back board
        bx(M.ochre, w + 0.04, 0.06, 0.07, 0, RACK.shelf + 1.33, -0.265), // top rail, 1 cm inside the uprights' backs
      ];
      for (const s of [1, -1]) parts.push(bx(M.metal, 0.08, RACK.shelf + 1.35, 0.1, s * (w / 2 + 0.04), (RACK.shelf + 1.35) / 2, -0.26)); // uprights
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + 0.15 + (i + 0.5) * RACK.slot;
        for (const dx of [-0.25, 0.25]) parts.push(bx(M.metal, 0.04, 0.04, 0.14, x + dx, RACK.shelf + 0.55, -0.18)); // pegs
        parts.push(bx(glowOf(M, ammo), 0.3, 0.02, 0.01, x, RACK.shelf + 1.12, -0.245)); // slot marker on the board
      }
      const meshes = bake(world, d, parts, { yaw: q * Math.PI / 2 });
      collider(world, d, q, { x: 0, z: 0, w: w + 0.04, d: 0.54 }, RACK.shelf);
      return meshes;
    },
  },

  // Ammo supply point (gameplay, campaign rule: ammo only comes from supply points): a cabinet with a shelf of ammo cases; standing
  // in front and pressing interact refills the owned guns of `ammo` ('all' (default: light and heavy) / 'light' / 'heavy') to their
  // max reserve (Pickups.update; toast + pickup sound). `prompt` (HUD text after the key cap, default by class). Unlimited uses.
  // Front +Z at yaw 0, back to a wall. Collision 1.36 x 0.8, 2.4 high, not cover. `yaw` in quarter turns.
  'supply.ammo': {
    example: { params: { ammo: 'all' } },
    label: `AMMO SUPPLY interact: refills owned guns to max | ${SUPPLY.reach} m`,
    fields: [{ key: 'ammo', type: 'enum', options: AMMO_CLASSES }, { key: 'prompt', type: 'text', optional: true }],
    build(world, d) {
      const id = 'supply.ammo';
      const q = quarters(id, d.yaw);
      const p = d.params ?? {};
      const ammo = p.ammo ?? 'all';
      if (!AMMO_CLASSES.includes(ammo)) fail(id, `"ammo" must be one of ${AMMO_CLASSES.join(', ')}, got ${JSON.stringify(ammo)}`);
      if (p.prompt != null && typeof p.prompt !== 'string') fail(id, '"prompt" must be text');
      const M = world.dressing;
      const text = { all: 'AMMUNITION', light: 'LIGHT ROUNDS', heavy: 'HEAVY ROUNDS' }[ammo];
      const parts = supplyCabinet(world, M, text, glowOf(M, ammo));
      parts.push(bx(M.metal, 1.16, 0.05, 0.36, 0, 0.82, 0.42), bx(M.dark, 0.05, 0.3, 0.3, -0.5, 0.66, 0.4), bx(M.dark, 0.05, 0.3, 0.3, 0.5, 0.66, 0.4)); // shelf on brackets
      const cases = ammo === 'all' ? ['light', 'heavy', 'light'] : [ammo, ammo, ammo];
      cases.forEach((c, i) => parts.push(...ammoCase(M, c, (i - 1) * 0.38, 0.845, 0.42)));
      const meshes = bake(world, d, parts, { yaw: q * Math.PI / 2 });
      collider(world, d, q, { x: 0, z: 0.05, w: 1.36, d: 0.8 }, 2.4);
      const rec = supplyRecord(world, d, 'ammo', { ammo: ammo === 'all' ? ['light', 'heavy'] : [ammo], prompt: p.prompt ?? `RESUPPLY ${text}` });
      return [...meshes, rec];
    },
  },

  // Repair station (campaign rule: health only comes back at repair stations, besides the slow regeneration): a cabinet with a
  // service arm and umbilicals; interact restores health and shields to full (Pickups.update). `prompt` (default REPAIR). Unlimited
  // uses. Front +Z at yaw 0, back to a wall. Collision 1.36 x 0.8, 2.4 high, not cover. `yaw` in quarter turns.
  'supply.repair': {
    example: { params: {} },
    label: `REPAIR STATION interact: full health and shields | ${SUPPLY.reach} m`,
    fields: [{ key: 'prompt', type: 'text', optional: true }],
    build(world, d) {
      const id = 'supply.repair';
      const q = quarters(id, d.yaw);
      const p = d.params ?? {};
      if (p.prompt != null && typeof p.prompt !== 'string') fail(id, '"prompt" must be text');
      const M = world.dressing;
      const parts = supplyCabinet(world, M, 'REPAIR', M.glowWhite);
      parts.push(
        bx(M.metal, 0.12, 0.12, 0.5, 0, 1.25, 0.5), // service arm out of the cabinet
        bx(M.ochre, 0.3, 0.14, 0.16, 0, 1.18, 0.78), // tool head
        cyl(M.metal, 0.02, 0.02, 0.22, -0.08, 1.02, 0.8, 0, 0, 0, 6), // probes
        cyl(M.metal, 0.02, 0.02, 0.22, 0.08, 1.02, 0.8, 0, 0, 0, 6),
        bx(M.glowWhite, 0.2, 0.02, 0.02, 0, 1.18, 0.865), // its lamp
        bx(M.dark, 0.9, 0.06, 0.3, 0, 0.5, 0.4), // footplate
      );
      for (const x of [-0.45, 0.45]) { // umbilicals hanging from the header in a sag
        const pts = [[x, 2.08, 0.3], [x * 1.05, 1.5, 0.45], [x * 0.9, 1.05, 0.42], [x * 0.7, 0.75, 0.3]].map((v) => new THREE.Vector3(...v));
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.035, 6), M.dark);
        tube.userData.own = true;
        parts.push(tube);
      }
      const meshes = bake(world, d, parts, { yaw: q * Math.PI / 2 });
      collider(world, d, q, { x: 0, z: 0.05, w: 1.36, d: 0.8 }, 2.4);
      const rec = supplyRecord(world, d, 'repair', { prompt: p.prompt ?? 'REPAIR' });
      return [...meshes, rec];
    },
  },

  // Diagnostic console: pedestal + angled screen with a scrolling cyan readout, facing +Z at yaw 0. Collision: the pedestal
  // (0.8 x 0.6, 1.35 high), not cover. No params.
  'prop.console': {
    example: { params: {} },
    label: 'CONSOLE 0.8 × 0.6 × 1.35, emissive readout',
    fields: [],
    build(world, d) {
      const id = 'prop.console';
      const q = quarters(id, d.yaw);
      const M = world.dressing;
      const head = new THREE.Group();
      head.position.set(0, 1.08, 0.02);
      head.rotation.x = 0.6;
      const scr = plane(M.screen, 0.64, 0.4, 1, 0.5, ((d.pos[0] * 7.3 + d.pos[2] * 3.1) % 1 + 1) % 1); // own phase per console
      scr.position.set(0, 0.13, 0.02); // 1 cm off the head (1 mm z-fights at range)
      scr.rotation.x = -Math.PI / 2;
      head.add(rb(M.metal, 0.8, 0.12, 0.56, 0.03, 0, 0.06, 0), bx(M.dark, 0.72, 0.03, 0.06, 0, 0.12, 0.25), scr);
      const meshes = bake(world, d, [
        bx(M.dark, 0.8, 0.08, 0.6, 0, 0.04, 0), // plinth
        rb(M.metal, 0.6, 0.98, 0.42, 0.04, 0, 0.57, -0.02), // pedestal
        bx(M.dark, 0.4, 0.3, 0.02, 0, 0.45, 0.2), // vent
        cyl(M.dark, 0.04, 0.04, 0.9, 0.18, 0.5, -0.26, 0, 0, 0, 6), // cable riser at the back
        head,
      ], { yaw: q * Math.PI / 2 });
      collider(world, d, q, { x: 0, z: 0, w: 0.8, d: 0.6 }, 1.35);
      world.consoles.push(new THREE.Vector3(...d.pos));
      return meshes;
    },
  },

  // Storage crate: size 'small' 0.8 cube | 'medium' 1.6 × 1.1 × 1.1 (low cover, a hop) | 'large' 1.6 cube. Stencil band
  // front and back, corner posts and rims. Collision: the whole crate; only medium is flagged cover (cover is 1.1 or 2.8).
  'prop.crate': {
    example: { params: { size: 'medium' } },
    label: 'CRATE small 0.8 / medium 1.6×1.1×1.1 (low cover) / large 1.6',
    fields: [{ key: 'size', type: 'enum', options: Object.keys(CRATE) }],
    build(world, d) {
      const id = 'prop.crate';
      const q = quarters(id, d.yaw);
      const size = d.params?.size ?? 'medium';
      if (!CRATE[size]) fail(id, `"size" must be one of ${Object.keys(CRATE).join(', ')}, got ${JSON.stringify(size)}`);
      const [w, h, dd] = CRATE[size];
      const M = world.dressing;
      const t = 0.08;
      const parts = [rb(M.crate, w - 0.04, h - 0.04, dd - 0.04, 0.02, 0, h / 2, 0)];
      for (const sx of [1, -1]) for (const sz of [1, -1]) parts.push(bx(M.metal, t, h, t, sx * (w / 2 - t / 2), h / 2, sz * (dd / 2 - t / 2)));
      for (const y of [t / 2, h - t / 2]) {
        for (const sz of [1, -1]) parts.push(bx(M.metal, w - 2 * t, t, t, 0, y, sz * (dd / 2 - t / 2)));
        for (const sx of [1, -1]) parts.push(bx(M.metal, t, t, dd - 2 * t, sx * (w / 2 - t / 2), y, 0));
      }
      const bw = (w - 2 * t) * 0.9;
      for (const s of [1, -1]) {
        const band = plane(M.stencil, bw, bw / 4);
        band.position.set(0, h * 0.55, s * (dd / 2 - 0.01));
        band.rotation.y = s > 0 ? 0 : Math.PI;
        parts.push(band);
      }
      const meshes = bake(world, d, parts, { yaw: q * Math.PI / 2 });
      collider(world, d, q, { x: 0, z: 0, w, d: dd }, h, size === 'medium' ? 'low' : null);
      return meshes;
    },
  },

  // Floor cable bundle from pos to pos + `to` [dx, dy, dz] (an offset, not turned by yaw; it moves with the piece): `count` (3, 1..6)
  // tubes side by side; ends above the floor sag down onto it. No collision, yaw ignored.
  'prop.cables': {
    example: { params: { to: [4, 0, 0], count: 3 } },
    label: 'CABLES floor bundle from pos to pos + to, no collision',
    fields: [{ key: 'to', type: 'vec3' }, { key: 'count', type: 'number', min: 1, optional: true }],
    build(world, d) {
      const id = 'prop.cables';
      const p = d.params ?? {};
      const to = vec3(id, p.to, 'to');
      const n = count(id, p, 'count', 3, 1, 6);
      const a = new THREE.Vector3(0, 0, 0);
      const b = new THREE.Vector3(...to);
      const run = Math.hypot(b.x, b.z);
      if (run < 0.2) fail(id, '"to" must be at least 0.2 m from pos along the floor');
      const side = new THREE.Vector3(-b.z / run, 0, b.x / run);
      const floor = -d.pos[1]; // local y of the floor (y 0) under the piece
      const parts = [];
      for (let i = 0; i < n; i++) {
        const r = 0.03 + 0.012 * (i % 3);
        const off = (i - (n - 1) / 2) * 0.1;
        const pts = [];
        for (let k = 0; k <= 8; k++) {
          const u = k / 8;
          const wob = k === 0 || k === 8 ? 0 : Math.sin(u * 9 + i * 2.1) * 0.12;
          const pt = a.clone().lerp(b, u).addScaledVector(side, off * (k === 0 || k === 8 ? 0.5 : 1) + wob);
          pt.y = Math.max(floor + r, pt.y - Math.max(0, d.pos[1], d.pos[1] + to[1]) * 2 * Math.sin(Math.PI * u)); // sag onto the floor
          pts.push(pt);
        }
        const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.min(64, Math.ceil(run * 5) + 8), r, 5);
        const m = new THREE.Mesh(geo, world.dressing.dark);
        m.userData.own = true;
        parts.push(m);
      }
      parts.push(bx(world.dressing.metal, 0.22, 0.12, 0.16, 0, Math.max(0.06, floor + 0.06), 0), bx(world.dressing.metal, 0.22, 0.12, 0.16, b.x, Math.max(b.y, floor + 0.06), b.z)); // plugs
      return bake(world, d, parts, { yaw: 0 });
    },
  },

  // Run of parallel pipes along +X: `length` (4), `count` (3, 1..4), `mount` 'ceiling' (side by side along Z, hanger rods up
  // `hang` m, 0.4) or 'wall' (stacked up from pos.y, the wall face at pos, pipes in front of it toward +Z), `valves` (1, 0..3).
  // pos = centre of the run at the lowest pipe's height. No collision: keep it above head height or flush to a wall.
  'prop.pipes': {
    example: { params: { length: 4, count: 3, mount: 'wall', valves: 1 } },
    label: 'PIPES ceiling / wall run, brackets, valves, no collision',
    fields: [{ key: 'length', type: 'number', min: 0.5 }, { key: 'count', type: 'number', min: 1, optional: true }, { key: 'mount', type: 'enum', options: ['ceiling', 'wall'] }, { key: 'hang', type: 'number', min: 0, optional: true }, { key: 'valves', type: 'number', min: 0, optional: true }],
    build(world, d) {
      const id = 'prop.pipes';
      const p = d.params ?? {};
      const L = length(id, p, 'length', 4);
      const n = count(id, p, 'count', 3, 1, 4);
      const valves = count(id, p, 'valves', 1, 0, 3);
      const mount = p.mount ?? 'ceiling';
      if (mount !== 'ceiling' && mount !== 'wall') fail(id, `"mount" must be ceiling or wall, got ${JSON.stringify(mount)}`);
      const hang = p.hang ?? 0.4;
      const M = world.dressing;
      const R = 0.09;
      const gap = 0.3;
      const wall = mount === 'wall';
      const at = (i) => (wall ? [0, i * gap, 0.2] : [0, 0, (i - (n - 1) / 2) * gap]); // pipe i centre (y, z)
      const parts = [];
      for (let i = 0; i < n; i++) parts.push(cyl(M.metal, R, R, L, ...at(i), 0, 0, Math.PI / 2, 10));
      const span = (n - 1) * gap + 2 * R + 0.06;
      for (let x = -L / 2 + 0.3; x <= L / 2 - 0.29; x += Math.max(1, (L - 0.6) / Math.max(1, Math.round((L - 0.6) / 2)))) {
        if (wall) {
          parts.push(bx(M.dark, 0.08, span, 0.07, x, ((n - 1) * gap) / 2, 0.035)); // wall bar, 1 cm proud of a 0.06 trim it crosses (cove edge)
          for (let i = 0; i < n; i++) parts.push(bx(M.dark, 0.06, 0.04, 0.2, x, i * gap, 0.1), cyl(M.dark, R + 0.02, R + 0.02, 0.06, x, i * gap, 0.2, 0, 0, Math.PI / 2, 10)); // standoff, clamp sleeve
        } else {
          parts.push(bx(M.dark, 0.08, 0.04, span, x, -R - 0.02, 0)); // strap under the bank
          for (const s of [1, -1]) parts.push(cyl(M.dark, 0.015, 0.015, hang + R + 0.02, x, (hang - R - 0.02) / 2, s * span / 2, 0, 0, 0, 6));
        }
      }
      for (let v = 0; v < valves; v++) {
        const x = -L / 2 + (L * (v + 1)) / (valves + 1) + 0.25;
        const [, y, z] = at(v % n);
        parts.push(cyl(M.dark, R + 0.04, R + 0.04, 0.1, x, y, z, 0, 0, Math.PI / 2, 10)); // flange
        if (wall) parts.push(cyl(M.dark, 0.02, 0.02, 0.2, x, y, z + 0.18, Math.PI / 2, 0, 0, 6), ring(M.ochre, 0.13, 0.02, x, y, z + 0.28));
        else parts.push(cyl(M.dark, 0.02, 0.02, 0.2, x, y - 0.18, z, 0, 0, 0, 6), ring(M.ochre, 0.13, 0.02, x, y - 0.28, z, Math.PI / 2, 0, 0));
      }
      return bake(world, d, parts);
    },
  },

  // Storage frame with `count` (3, 3..4) inert puppets hanging from its top beam, facing +Z at yaw 0. Footprint
  // (count × 0.8 + 0.4) × 0.9, 2.8 high: one collision box, not cover.
  'prop.puppetRack': {
    example: { params: { count: 3 } },
    label: 'PUPPET RACK 3-4 hanging inert puppets, 2.8 high',
    fields: [{ key: 'count', type: 'number', min: 3 }],
    build(world, d) {
      const id = 'prop.puppetRack';
      const q = quarters(id, d.yaw);
      const n = count(id, d.params ?? {}, 'count', 3, 3, 4);
      const M = world.dressing;
      const w = n * 0.8 + 0.4;
      const dd = 0.9;
      const H = 2.8;
      const parts = [];
      for (const sx of [1, -1]) {
        for (const sz of [1, -1]) parts.push(bx(M.metal, 0.1, H, 0.1, sx * (w / 2 - 0.05), H / 2, sz * (dd / 2 - 0.05)));
        parts.push(bx(M.metal, 0.1, 0.1, dd - 0.2, sx * (w / 2 - 0.05), 0.05, 0), bx(M.metal, 0.1, 0.1, dd - 0.2, sx * (w / 2 - 0.05), H - 0.05, 0)); // side rails between the posts
        parts.push(bx(M.ochre, 0.02, 0.5, 0.4, sx * (w / 2 + 0.005), H - 0.6, 0)); // rack number plates
      }
      parts.push(bx(M.metal, w - 0.2, 0.14, 0.14, 0, H - 0.07, 0), bx(M.dark, w - 0.18, 0.08, 0.1, 0, 0.04, -dd / 2 + 0.06)); // top beam, back rail (ends in the posts, 1 cm off their backs)
      for (let i = 0; i < n; i++) parts.push(hangingPuppet(M, (i - (n - 1) / 2) * 0.8, H - 0.14, ((i * 7) % 5 - 2) * 0.025));
      const meshes = bake(world, d, parts, { yaw: q * Math.PI / 2 });
      collider(world, d, q, { x: 0, z: 0, w, d: dd }, H);
      return meshes;
    },
  },

  // Ceiling maintenance arm: pos = the floor point under its mount, `mount` (5.85) = ceiling height above pos. Base on the
  // ceiling, two segments, a tool head; at yaw 0 it reaches down toward -Z (1.7 m forward, tool ~2.9 m below the mount).
  // `retractOn?` (an `on` form, encounter.js): when it happens the arm folds up against the ceiling in 2 s (once; a reload
  // rebuilds it lowered). No collision, no shadow from the moving parts.
  'prop.arm': {
    example: { params: { mount: 5.85 } },
    label: 'MAINTENANCE ARM ceiling mount, folds up on an event',
    fields: [{ key: 'mount', type: 'number', min: 1 }, { key: 'retractOn', type: 'text', optional: true }],
    check: (p, registry) => (p.retractOn == null ? null : onProblem(p.retractOn, 'retractOn', registry.guns)),
    build(world, d) {
      const id = 'prop.arm';
      const p = d.params ?? {};
      const h = length(id, p, 'mount', ARM.mount);
      if (p.retractOn != null) {
        const problem = onProblem(p.retractOn, 'retractOn', world.registry?.guns);
        if (problem) fail(id, problem);
      }
      const M = world.dressing;
      const s = h - 0.6; // shoulder height
      const meshes = bake(world, d, [
        bx(M.metal, 0.9, 0.08, 0.9, 0, h - 0.04, 0), // ceiling plate
        cyl(M.dark, 0.18, 0.18, 0.3, 0, h - 0.23, 0, 0, 0, 0, 10), // slew column
        rb(M.ochre, 0.46, 0.3, 0.4, 0.04, 0, s + 0.17, 0), // turret
        cyl(M.dark, 0.12, 0.12, 0.6, 0, s, 0, 0, 0, Math.PI / 2, 10), // shoulder axle
      ]);
      const root = new THREE.Group();
      root.position.set(d.pos[0], d.pos[1] + s, d.pos[2]);
      root.rotation.y = d.yaw ?? 0;
      const seg = armSegments(M);
      const shoulder = new THREE.Group();
      const elbow = new THREE.Group();
      elbow.position.y = -ARM.upper;
      elbow.add(seg.fore);
      shoulder.add(seg.upper, elbow);
      root.add(shoulder);
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.receiveShadow = true;
      });
      root.userData.arm = { shoulder, elbow, k: 0, retracting: false, on: p.retractOn ?? null };
      setArm(root.userData.arm, 0);
      world.scene.add(root);
      world.props.push(root);
      return [...meshes, root];
    },
  },

  // Calibration cradle: a heavy docking frame a unit is stored and serviced in. pos = the unit's feet, the unit faces +Z at
  // yaw 0 and the frame stands behind it (-Z): sill, uprights, header, a spine with the unit's back rest, shoulder clamps, a
  // head brace, three umbilicals plugged into the unit's back, foot clamps. `releaseOn?` (an `on` form, e.g. cinematic:wake):
  // the umbilicals drop away and the clamps open in 1.4 s (once; a reload rebuilds it closed). `open: true` builds it
  // released and empty (an unoccupied cradle, cables hanging). Collision: the frame behind the unit (1.5 x 0.32, 2.8 high),
  // not cover; the moving parts have none. `yaw` in quarter turns.
  'prop.cradle': {
    example: { params: { open: true } },
    label: 'CRADLE docking frame, clamps + umbilicals release on an event',
    fields: [{ key: 'releaseOn', type: 'text', optional: true }, { key: 'open', type: 'bool', def: false }],
    check: (p, registry) => (p.releaseOn == null ? null : onProblem(p.releaseOn, 'releaseOn', registry.guns)),
    build(world, d) {
      const id = 'prop.cradle';
      const q = quarters(id, d.yaw);
      const p = d.params ?? {};
      if (p.releaseOn != null) {
        const problem = onProblem(p.releaseOn, 'releaseOn', world.registry?.guns);
        if (problem) fail(id, problem);
      }
      if (p.open != null && typeof p.open !== 'boolean') fail(id, `"open" must be true or false, got ${JSON.stringify(p.open)}`);
      const M = world.dressing;
      const yaw = q * Math.PI / 2;
      const moving = cradleParts(M);
      const live = p.releaseOn != null && !p.open; // only a closed cradle waiting for an event keeps its parts apart
      if (!live) for (const m of moving) setCradlePart(m, p.open ? CRADLE.time : 0);
      const meshes = bake(world, d, [...cradleFrame(M, ((d.pos[0] * 5.1 + d.pos[2] * 2.3) % 1 + 1) % 1), ...(live ? [] : moving.map((m) => m.g))], { yaw });
      collider(world, d, q, { x: 0, z: -0.6, w: 1.5, d: 0.32 }, 2.8);
      if (!live) return meshes;
      const root = new THREE.Group();
      root.position.set(...d.pos);
      root.rotation.y = yaw;
      for (const m of moving) {
        const own = [];
        m.g.traverse((o) => o.isMesh && o.userData.own && own.push(o.geometry));
        mergeGroup(m.g);
        for (const geo of own) geo.dispose();
        m.g.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = false;
          o.receiveShadow = true;
        });
        root.add(m.g);
      }
      root.userData.cradle = { parts: moving, t: 0, releasing: false, on: p.releaseOn };
      world.scene.add(root);
      world.props.push(root);
      return [...meshes, root];
    },
  },

  // Workbench with spare parts: steel top on legs, a lower shelf, a vice, a spare puppet head and forearm, tool trays,
  // a coiled cable. Front +Z at yaw 0, 1.6 x 0.7, 0.95 high: one collision box, not cover. No params. `yaw` in quarter turns.
  'prop.bench': {
    example: { params: {} },
    label: 'WORKBENCH 1.6 × 0.7 × 0.95, spare parts',
    fields: [],
    build(world, d) {
      const id = 'prop.bench';
      const q = quarters(id, d.yaw);
      const M = world.dressing;
      const parts = [
        bx(M.metal, 1.6, 0.06, 0.7, 0, 0.88, 0), // top
        bx(M.dark, 1.5, 0.04, 0.6, 0, 0.25, 0), // shelf
        bx(M.dark, 1.6, 0.3, 0.03, 0, 1.06, -0.335), // back board
        bx(M.dark, 0.14, 0.12, 0.1, 0.62, 0.97, 0.2), // vice body
        bx(M.metal, 0.03, 0.13, 0.12, 0.62, 0.975, 0.3), // vice jaw, 1 cm over the body
        rb(M.ochre, 0.2, 0.22, 0.22, 0.05, -0.45, 1.02, 0.02, 0.2, 0.7, 0.1), // spare puppet head, on its side
        rb(M.dark, 0.15, 0.035, 0.02, 0.01, -0.39, 1.0, 0.14, 0.2, 0.7, 0.1), // its dead sensor band
        cyl(M.ochre, 0.05, 0.045, 0.55, 0.15, 0.95, 0.05, 0, 0.3, Math.PI / 2, 8), // spare forearm
        cyl(M.dark, 0.06, 0.06, 0.12, -0.12, 0.95, 0.05, 0, 0.3, Math.PI / 2, 8), // its joint
        bx(M.dark, 0.36, 0.06, 0.2, 0.35, 0.94, -0.18), // tool tray
        bx(M.crate, 0.5, 0.3, 0.4, -0.4, 0.42, 0), // parts bin on the shelf
        bx(M.crate, 0.4, 0.22, 0.4, 0.3, 0.38, 0.02),
        ring(M.dark, 0.16, 0.025, 0.55, 0.32, 0.05, Math.PI / 2, 0, 0), // coiled cable
      ];
      for (const sx of [1, -1]) for (const sz of [1, -1]) parts.push(bx(M.metal, 0.06, 0.85, 0.06, sx * 0.74, 0.425, sz * 0.3));
      for (let i = 0; i < 4; i++) parts.push(bx(M.metal, 0.03, 0.03, 0.14, 0.24 + i * 0.07, 0.985, -0.18)); // tools
      const meshes = bake(world, d, parts, { yaw: q * Math.PI / 2 });
      collider(world, d, q, { x: 0, z: 0, w: 1.6, d: 0.7 }, 0.95);
      return meshes;
    },
  },

  // Hazard floor stripes (ochre / dark diagonals, 1 m pattern): `size` [w, d] (4 × 1). Flat on pos.y, any yaw, no collision.
  'prop.hazard': {
    example: { params: { size: [4, 1] } },
    label: 'HAZARD STRIPES floor marking, no collision',
    fields: [{ key: 'size', type: 'vec2', min: 0.1 }],
    build(world, d) {
      const id = 'prop.hazard';
      const sz = d.params?.size ?? [4, 1];
      if (!Array.isArray(sz) || sz.length !== 2) fail(id, `"size" must be [w, d], got ${JSON.stringify(sz)}`);
      const [w, dd] = sz.map((v) => length(id, { v }, 'v', 1));
      const m = plane(world.dressing.hazard, w, dd, w, dd);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.012;
      return bake(world, d, [m], { shadow: false });
    },
  },

  // Wall warning panel: `text` (stencil caps, `\n` for lines), `width` (1.4; the height follows the text). pos = bottom
  // centre on the wall face, the panel faces +Z at yaw 0 (like env.label), any yaw. A thin plate, no collision, unlit.
  'prop.panel': {
    example: { params: { text: 'HIGH VOLTAGE', width: 1.4 } },
    label: 'WARNING PANEL stencilled text on a wall, no collision',
    fields: [{ key: 'text', type: 'text' }, { key: 'width', type: 'number', min: 0.2 }],
    check: (p) => (typeof p.text === 'string' && p.text.trim() ? null : 'text must be a non-empty string'),
    build(world, d) {
      const id = 'prop.panel';
      const p = d.params ?? {};
      if (typeof p.text !== 'string' || !p.text.trim()) fail(id, 'text must be a non-empty string');
      const w = length(id, p, 'width', 1.4);
      const mat = panelMaterial(world, p.text);
      const h = w * mat.userData.aspect;
      const face = plane(mat, w, h);
      face.position.set(0, h / 2 + 0.04, 0.042);
      return bake(world, d, [bx(world.dressing.metal, w + 0.08, h + 0.08, 0.04, 0, h / 2 + 0.04, 0.02), face]);
    },
  },

  // Rotating alarm beacon on a wall bracket: pos = the bracket's foot on the wall face, out toward +Z at yaw 0, the lamp
  // ~0.4 m out and 0.3 m up. `on?` (an `on` form; absent = always running): from then the amber lens glows and pulses and a
  // reflector inside turns two light beams round (BEACON.turn rev/s); `off?` (an `on` form) stops it. Dark and still before.
  // The beams are additive cones (no point light: pair it with the level's own lights / env.alarm). No collision, any yaw.
  'prop.beacon': {
    example: { params: {} },
    label: 'ALARM BEACON rotating amber lamp on a wall bracket, runs from an event',
    fields: [{ key: 'on', type: 'text', optional: true }, { key: 'off', type: 'text', optional: true }],
    check: (p, registry) => (p.on == null ? null : onProblem(p.on, 'on', registry.guns)) ?? (p.off == null ? null : onProblem(p.off, 'off', registry.guns)),
    build(world, d) {
      const id = 'prop.beacon';
      const p = d.params ?? {};
      for (const k of ['on', 'off']) {
        const problem = p[k] == null ? null : onProblem(p[k], k, world.registry?.guns);
        if (problem) fail(id, problem);
      }
      const M = world.dressing;
      const [lx, ly, lz] = BEACON.lamp;
      const meshes = bake(world, d, [
        bx(M.metal, 0.34, 0.42, 0.04, 0, 0.21, 0.02), // wall plate
        bx(M.dark, 0.1, 0.1, lz - 0.02, 0, 0.12, lz / 2 + 0.02), // arm
        bx(M.dark, 0.08, ly - 0.06, 0.08, 0, (ly - 0.06) / 2 + 0.06, lz), // post under the lamp
        cyl(M.metal, 0.17, 0.19, 0.08, lx, ly - 0.12, lz, 0, 0, 0, 16), // base ring
        cyl(M.metal, 0.08, 0.15, 0.06, lx, ly + 0.17, lz, 0, 0, 0, 16), // cap
        ...[0, 1, 2, 3].map((i) => bx(M.dark, 0.025, 0.26, 0.025, lx + Math.cos(i * Math.PI / 2 + 0.785) * 0.16, ly + 0.01, lz + Math.sin(i * Math.PI / 2 + 0.785) * 0.16)), // cage bars
      ], { shadow: false });
      // moving / glowing parts: own geometry and materials (freed with the level), never batched
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 20), new THREE.MeshStandardMaterial({ color: 0x5a3a10, emissive: BEACON.color, emissiveIntensity: 0, roughness: 0.3, transparent: true, opacity: 0.85 }));
      const spin = new THREE.Group();
      const reflector = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.02), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.9, roughness: 0.25 }));
      const beamGeo = new THREE.ConeGeometry(BEACON.spread, BEACON.reach, 18, 1, true).translate(0, -BEACON.reach / 2, 0).rotateZ(Math.PI / 2); // apex at the lamp, opening along +X
      const beamMat = new THREE.MeshBasicMaterial({ color: BEACON.color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beamA = new THREE.Mesh(beamGeo, beamMat);
      const beamB = new THREE.Mesh(beamGeo.clone(), beamMat);
      beamB.rotation.y = Math.PI;
      spin.add(reflector, beamA, beamB);
      const root = new THREE.Group();
      root.position.set(...d.pos);
      root.rotation.y = d.yaw ?? 0;
      const head = new THREE.Group();
      head.position.set(lx, ly, lz);
      head.add(lens, spin);
      root.add(head);
      root.traverse((o) => o.isMesh && (o.castShadow = false));
      root.userData.beacon = { on: p.on ?? null, off: p.off ?? null, active: p.on == null, spin, lens, beam: beamMat, t: 0 };
      world.scene.add(root);
      world.props.push(root);
      return [...meshes, root];
    },
  },
};
