import * as THREE from 'three';
import { Rng } from '../../engine/random.js';

// Procedural textures: "prototype grid" textures (one tile = TILE_METERS in world space), weathering maps for the
// models and weathered metal panels for the real scenes (bottom of the file).
export const TILE_METERS = 2;

const cache = new Map();
let anisotropy = 8; // graphics quality (view/quality.js)

export function gridTexture({
  base = '#8a8d92',
  alt = null,
  minor = 'rgba(255,255,255,0.10)',
  major = 'rgba(255,255,255,0.28)',
  border = 'rgba(0,0,0,0.35)',
  label = null,
  labelColor = 'rgba(255,255,255,0.35)',
} = {}) {
  const key = JSON.stringify(arguments[0] ?? {});
  if (cache.has(key)) return cache.get(key);

  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');

  g.fillStyle = base;
  g.fillRect(0, 0, size, size);

  // 1m checker (tile is 2m -> 2x2 checker)
  const half = size / 2;
  g.fillStyle = alt ?? 'rgba(0,0,0,0.06)';
  g.fillRect(0, 0, half, half);
  g.fillRect(half, half, half, half);

  // 25cm minor lines
  g.strokeStyle = minor;
  g.lineWidth = 2;
  for (let i = 1; i < 8; i++) {
    if (i % 4 === 0) continue;
    const p = (i * size) / 8;
    line(g, p, 0, p, size);
    line(g, 0, p, size, p);
  }
  // 1m major lines
  g.strokeStyle = major;
  g.lineWidth = 3;
  line(g, half, 0, half, size);
  line(g, 0, half, size, half);
  // tile border
  g.strokeStyle = border;
  g.lineWidth = 6;
  g.strokeRect(0, 0, size, size);

  if (label) {
    g.fillStyle = labelColor;
    g.font = 'bold 34px monospace';
    g.fillText(label, 16, 44);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = anisotropy;
  cache.set(key, tex);
  return tex;
}

function line(g, x0, y0, x1, y1) {
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

// Rewrites box UVs from world-space positions so grids line up across all geometry.
export function applyWorldUVs(geometry, offset) {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  const s = 1 / TILE_METERS;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + offset.x;
    const y = pos.getY(i) + offset.y;
    const z = pos.getZ(i) + offset.z;
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    // oriented so labels read correctly from outside each face
    if (Math.abs(nx) > 0.5) uv.setXY(i, -Math.sign(nx) * z * s, y * s);
    else if (Math.abs(ny) > 0.5) uv.setXY(i, x * s, -Math.sign(ny) * z * s);
    else uv.setXY(i, Math.sign(nz) * x * s, y * s);
  }
  uv.needsUpdate = true;
}

// Texture filtering quality for every grid texture, existing and future (graphics quality preset).
export function setAnisotropy(n) {
  anisotropy = n;
  for (const tex of cache.values()) {
    if (tex.anisotropy === n) continue;
    tex.anisotropy = n;
    tex.needsUpdate = true;
  }
}

// ---------------- weathering (instructions/art-style.md) ----------------
// Maps multiplied over a material's colour, so one map serves every tint: paint (chipped down to dark metal at the
// edges, scratches, grime streaks), metal (worn bright edges, scratches, soot) and fabric (mottled grime).
// The model parts' UVs run 0..1 per face (RoundedBox, Box, Cylinder), so the map's border is a plate's edge: chipping
// and wear gather there. Seeded, so every run (and every screenshot) looks the same. Cached like the grids: a few
// permanent textures shared by every model, never disposed.
const WEAR = {
  paint: { base: 215, mottle: 22, chips: 90, edge: 0.13, chip: [70, 68, 66], scratches: 40, scratch: 255, streaks: 14, streak: 'rgba(30,26,20,0.16)' },
  shell: { base: 215, mottle: 10, chips: 55, edge: 0.07, chip: [78, 76, 74], scratches: 30, scratch: 255, streaks: 7, streak: 'rgba(18,14,8,0.2)' }, // big curved shells (trooper dome): chips and oil streaks at the edges
  metal: { base: 205, mottle: 22, chips: 30, edge: 0.06, chip: [250, 250, 250], scratches: 40, scratch: 255, streaks: 10, streak: 'rgba(10,10,10,0.22)' },
  fabric: { base: 225, mottle: 30, chips: 0, edge: 0, chip: [0, 0, 0], scratches: 0, scratch: 255, streaks: 18, streak: 'rgba(40,34,26,0.14)' },
};

export function wearTexture(kind = 'paint') {
  const key = `wear:${kind}`;
  if (cache.has(key)) return cache.get(key);
  const o = WEAR[kind];
  const rnd = mulberry(kind.length * 9173 + 17);
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${o.base},${o.base},${o.base})`;
  g.fillRect(0, 0, size, size);
  // mottling: big soft blotches, darker and lighter
  for (let i = 0; i < 60; i++) {
    const v = o.base + (rnd() - 0.5) * 2 * o.mottle;
    soft(g, rnd() * size, rnd() * size, 10 + rnd() * 40, `${v | 0},${(v * 0.98) | 0},${(v * 0.95) | 0}`, 0.5);
  }
  // grime streaks running down from the top edge (canvas top = the face's top)
  g.strokeStyle = o.streak;
  for (let i = 0; i < o.streaks; i++) {
    const x = rnd() * size;
    g.lineWidth = 2 + rnd() * 7;
    line(g, x, rnd() * size * 0.3, x + (rnd() - 0.5) * 6, size * (0.4 + rnd() * 0.6));
  }
  // chips: dense along the border (plate edges), sparse inside
  const [cr, cg, cb] = o.chip;
  g.fillStyle = `rgb(${cr},${cg},${cb})`;
  for (let i = 0; i < o.chips; i++) {
    const edge = rnd() < 0.8;
    let x = rnd() * size;
    let y = rnd() * size;
    if (edge) {
      const d = rnd() * o.edge * size;
      const side = (rnd() * 4) | 0;
      if (side === 0) y = d;
      else if (side === 1) y = size - d;
      else if (side === 2) x = d;
      else x = size - d;
    }
    blob(g, x, y, 1.5 + rnd() * (edge ? 6 : 3), rnd);
  }
  // scratches: short thin bright lines
  g.strokeStyle = `rgba(${o.scratch},${o.scratch},${o.scratch},0.7)`;
  g.lineWidth = 1;
  for (let i = 0; i < o.scratches; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * Math.PI;
    const l = 6 + rnd() * 30;
    line(g, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  return cacheTexture(key, c);
}

// A matte, weathered model material: `color` under one of the wear maps. The far LOD (one baked colour per part,
// engine/batch.js) drops the map, so lodColor carries its average darkening.
const WEAR_AVERAGE = { shell: 0.9, paint: 0.8, metal: 0.8, fabric: 0.85 };
export function wornMaterial(color, { roughness = 0.8, metalness = 0.2, wear = 'paint', ...extra } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, map: wearTexture(wear), ...extra });
  m.userData.lodColor = new THREE.Color(color).multiplyScalar(WEAR_AVERAGE[wear]);
  return m;
}

// Stencilled serial plate: dark worn metal with faded bone-white letters (STEM-00's markings). Parts that use it
// are sized to the text's aspect (about 4:1); on small rings and tags it reads as a dark band.
export function stencilTexture(text) {
  const key = `stencil:${text}`;
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry(text.length * 31 + 7);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(58,61,64)';
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = 'rgba(200,192,170,0.85)';
  g.font = 'bold 40px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 34);
  // stencil bridges and wear: cut thin gaps through the letters, then scuff
  g.fillStyle = 'rgb(58,61,64)';
  for (let x = 20; x < 240; x += 14) g.fillRect(x, 30, 2, 5);
  for (let i = 0; i < 160; i++) blob(g, rnd() * 256, rnd() * 64, 0.8 + rnd() * 2.2, rnd);
  return cacheTexture(key, c);
}

// Weathered metal panels for "real" scenes (arena, Prologue): the Gym rooms keep the grid prototype textures because
// metrics read off them. One tile = TILE_METERS like the grids (world UVs): panel seams every metre, rivets, oil
// stains, soot and scratches. tint: the panel paint.
export function panelTexture({ tint = '#5a5f63', seams = 'rgba(0,0,0,0.45)', grime = 0.5, label = null } = {}) {
  const key = 'panel:' + JSON.stringify(arguments[0] ?? {});
  if (cache.has(key)) return cache.get(key);
  const rnd = mulberry(key.length * 131 + 3);
  const size = 512;
  const half = size / 2;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = tint;
  g.fillRect(0, 0, size, size);
  // per-panel tone shifts (repaints, different batches)
  for (const [x, y] of [[0, 0], [half, 0], [0, half], [half, half]]) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rnd() * 0.05})`;
    g.fillRect(x, y, half, half);
  }
  for (let i = 0; i < 70; i++) soft(g, rnd() * size, rnd() * size, 20 + rnd() * 70, `0,0,0`, 0.05 + rnd() * 0.12 * grime);
  // oil streaks running down from the seams
  g.strokeStyle = `rgba(12,10,8,${0.12 * grime + 0.05})`;
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() < 0.5 ? 4 : half + 4;
    g.lineWidth = 2 + rnd() * 6;
    line(g, x, y, x + (rnd() - 0.5) * 4, y + 30 + rnd() * 150);
  }
  // scratches and bare-metal chips
  g.strokeStyle = 'rgba(200,205,210,0.18)';
  g.lineWidth = 1;
  for (let i = 0; i < 70; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * Math.PI;
    const l = 8 + rnd() * 40;
    line(g, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l);
  }
  g.fillStyle = 'rgba(140,145,150,0.35)';
  for (let i = 0; i < 50; i++) blob(g, rnd() * size, rnd() * size, 1 + rnd() * 3, rnd);
  // seams (1 m panels) and rivets along them
  g.strokeStyle = seams;
  g.lineWidth = 4;
  g.strokeRect(2, 2, size - 4, size - 4);
  line(g, half, 0, half, size);
  line(g, 0, half, size, half);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (let p = 16; p < size; p += 32) {
    for (const q of [12, half - 12, half + 12, size - 12]) {
      dot(g, p, q, 2.6);
      dot(g, q, p, 2.6);
    }
  }
  if (label) {
    g.fillStyle = 'rgba(210,200,175,0.28)';
    g.font = 'bold 30px monospace';
    g.fillText(label, 22, 50);
  }
  return cacheTexture(key, c, true);
}

function cacheTexture(key, canvas, world = false) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (world) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cache.set(key, tex);
  return tex;
}

function dot(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

// soft round smudge (rgb: "r,g,b"), fading out to the edge
function soft(g, x, y, r, rgb, a) {
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${rgb},${a})`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

// irregular splat: a few overlapping circles
function blob(g, x, y, r, rnd) {
  for (let i = 0; i < 3; i++) dot(g, x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, r * (0.4 + rnd() * 0.6));
}

function mulberry(seed) {
  const r = new Rng(seed);
  return () => r.next();
}
