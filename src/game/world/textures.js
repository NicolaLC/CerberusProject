import * as THREE from 'three';

// Procedural "prototype grid" textures. One texture tile = TILE_METERS in world space.
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
