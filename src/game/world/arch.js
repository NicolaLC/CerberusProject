import * as THREE from 'three';
import { applyWorldUVs } from './textures.js';
import { quarters } from './kit.js';
import { bake, collider } from './props.js';

// Architectural dressing (`arch.*` registry ids, a public contract: instructions/level.md; style: art-style.md "Architecture").
// Breaks the box silhouette of kit rooms without touching their collision: coves and corner chamfers, wall ribs, layered
// panelling, door bulkheads, floor channels, ceiling coffers, catwalks. Decorative parts may take any angle (45 degree
// chamfers); the only collider is arch.rib's, an axis-aligned box flush to the wall. Every piece takes `yaw` in quarter turns
// (kit.js `quarters`), like the kit it dresses.
// Materials are the ones the level already draws (no new materials): the skin's `roof` / `inWall`, the props' worn `metal`,
// `dark`, `ochre`, and the `stripCyan` / `stripWhite` emissives for light lines (no point lights). Geometry is baked to world
// space with world UVs (the panel textures line up with the walls) and merged per material (props.js `bake`).

// Material per part key. Nothing casts: the bay is roofed (the sun never reaches in) and shadow casters would only add shadow-pass
// triangles; the props' materials get one non-casting bucket each per chunk.
const MATS = {
  roof: (w) => w.material({ mat: 'roof' }),
  inWall: (w) => w.material({ mat: 'inWall' }),
  metal: (w) => w.dressing.metal,
  dark: (w) => w.dressing.dark,
  ochre: (w) => w.dressing.ochre,
  cyan: (w) => w.mats.stripCyan,
  white: (w) => w.mats.stripWhite,
};
const LIGHTS = { cyan: 'cyan', white: 'white', none: null };
const R2 = Math.SQRT2;

const fail = (id, msg) => {
  throw new Error(`${id}: ${msg}`);
};

function num(id, p, key, def) {
  const v = p[key] ?? def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail(id, `"${key}" must be a number > 0, got ${JSON.stringify(v)}`);
  return v;
}

function pair(id, p, key, def, whole = false) {
  const v = p[key] ?? def;
  if (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || (whole && !Number.isInteger(n)))) {
    fail(id, `"${key}" must be [a, b] of ${whole ? 'whole numbers' : 'numbers'} > 0, got ${JSON.stringify(v)}`);
  }
  return v;
}

function light(id, p) {
  const v = p.light ?? 'cyan';
  if (!(v in LIGHTS)) fail(id, `"light" must be cyan, white or none, got ${JSON.stringify(v)}`);
  return LIGHTS[v];
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO = new THREE.Vector3();

// Boxes in the piece's frame -> the level: each turned (rx, ry, rz), moved, then turned by the piece's quarter yaw and placed at
// pos; world UVs; merged per material, no shadow. parts: [mat key, w, h, d, x, y, z, rx?, ry?, rz?].
function build(world, d, q, parts) {
  const root = new THREE.Matrix4().compose(_v.fromArray(d.pos), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, (q * Math.PI) / 2), ONE);
  const meshes = [];
  const m = new THREE.Matrix4();
  for (const [key, w, h, dd, x, y, z, rx = 0, ry = 0, rz = 0] of parts) {
    const geo = new THREE.BoxGeometry(w, h, dd);
    geo.applyMatrix4(m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), ONE).premultiply(root));
    applyWorldUVs(geo, ZERO);
    const mesh = new THREE.Mesh(geo, MATS[key](world));
    mesh.userData.own = true;
    meshes.push(mesh);
  }
  return bake(world, { pos: [0, 0, 0] }, meshes, { shadow: false, yaw: 0 });
}

// n evenly spaced centres over a run of `len` (whole slots of about `step`).
const slots = (len, step) => {
  const n = Math.max(1, Math.round(len / step));
  return Array.from({ length: n }, (_, i) => [-len / 2 + (len * (i + 0.5)) / n, len / n]);
};

export const ARCH_PIECES = {
  // 45 degree chamfer strip in a corner, with an optional recessed light line down its middle. corner 'ceiling': pos = the
  // wall face at the ceiling (pos.y = ceiling underside), the room toward +Z, the strip runs `length` along X. corner 'wall':
  // pos = a vertical room corner at the floor, the room in the +X / +Z quarter, the strip rises `length`. size = leg (0.7).
  'arch.cove': {
    example: { params: { length: 4, corner: 'ceiling', light: 'cyan' } },
    label: 'COVE 45° chamfer, light line, no collision',
    fields: [{ key: 'length', type: 'number', min: 0.1 }, { key: 'size', type: 'number', min: 0.1, optional: true }, { key: 'corner', type: 'enum', options: ['ceiling', 'wall'] }, { key: 'light', type: 'enum', options: Object.keys(LIGHTS), optional: true }],
    build(world, d) {
      const id = 'arch.cove';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const L = num(id, p, 'length', 4);
      const s = num(id, p, 'size', 0.7);
      const corner = p.corner ?? 'ceiling';
      if (corner !== 'ceiling' && corner !== 'wall') fail(id, `"corner" must be ceiling or wall, got ${JSON.stringify(corner)}`);
      const lit = light(id, p);
      const W = s * R2;
      const t = 0.05;
      const gap = lit ? 0.1 : 0;
      const half = (W - gap) / 2;
      const off = half / 2 + gap / 2;
      const parts = [];
      if (corner === 'ceiling') {
        // slant u = (0, 1, 1) / sqrt2 (wall foot -> ceiling), normal into the room n = (0, -1, 1) / sqrt2
        const rx = -Math.PI / 4;
        const c = (a, b) => [0, -s / 2 + (a - b) / R2, s / 2 + (a + b) / R2]; // centre + a along u + b along n
        if (!lit) parts.push(['roof', L, t, W, ...c(0, 0), rx]);
        else {
          parts.push(['roof', L, t, half, ...c(off, 0), rx], ['roof', L, t, half, ...c(-off, 0), rx]);
          parts.push(['dark', L, 0.02, gap + 0.12, ...c(0, -0.09), rx], [lit, L, 0.03, 0.05, ...c(0, -0.04), rx]);
        }
        parts.push(['dark', L, 0.06, 0.06, 0, -s - 0.03, 0.03], ['dark', L, 0.06, 0.06, 0, -0.03, s + 0.03]); // edge trims
      } else {
        // slant u = (-1, 0, 1) / sqrt2, normal into the room n = (1, 0, 1) / sqrt2
        const Lw = L - 0.01; // tops 1 cm under a ceiling cove's trim (level with it they z-fight)
        const ry = (-3 * Math.PI) / 4;
        const c = (a, b) => [s / 2 + (-a + b) / R2, Lw / 2, s / 2 + (a + b) / R2];
        if (!lit) parts.push(['inWall', W, Lw, t, ...c(0, 0), 0, ry]);
        else {
          parts.push(['inWall', half, Lw, t, ...c(off, 0), 0, ry], ['inWall', half, Lw, t, ...c(-off, 0), 0, ry]);
          parts.push(['dark', gap + 0.12, Lw, 0.02, ...c(0, -0.09), 0, ry], [lit, 0.05, Lw, 0.03, ...c(0, -0.04), 0, ry]);
        }
        parts.push(['dark', 0.06, Lw, 0.06, s + 0.03, Lw / 2, 0.03], ['dark', 0.06, Lw, 0.06, 0.03, Lw / 2, s + 0.03]);
      }
      return build(world, d, q, parts);
    },
  },

  // Structural rib (pilaster) on a wall face: pos = bottom centre on the face, sticking out toward +Z. height (6), width (0.5),
  // depth (0.35). Collides as one box flush to the wall (not cover). Base plinth, a band at the 2.6 m trim line, a dark slot.
  'arch.rib': {
    example: { params: { height: 6 } },
    label: 'RIB pilaster 0.5 × 0.35, collides, not cover',
    fields: [{ key: 'height', type: 'number', min: 0.5 }, { key: 'width', type: 'number', min: 0.1, optional: true }, { key: 'depth', type: 'number', min: 0.05, optional: true }],
    build(world, d) {
      const id = 'arch.rib';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const H = num(id, p, 'height', 6);
      const w = num(id, p, 'width', 0.5);
      const dp = num(id, p, 'depth', 0.35);
      const parts = [
        ['metal', w, H, dp, 0, H / 2, dp / 2],
        ['dark', w + 0.14, 0.45, dp + 0.1, 0, 0.225, (dp + 0.1) / 2], // plinth
        ['dark', w + 0.06, 0.15, dp + 0.05, 0, 2.53, (dp + 0.05) / 2], // band on the trim line
      ];
      if (H > 3.4) parts.push(['dark', 0.12, H - 3.4, 0.02, 0, 2.6 + (H - 3.4) / 2 + 0.1, dp + 0.005]); // slot above the band
      for (const y of [0.9, 1.6]) parts.push(['dark', w * 0.6, 0.05, 0.02, 0, y, dp + 0.005]); // louvres
      const meshes = build(world, d, q, parts);
      collider(world, d, q, { x: 0, z: dp / 2, w, d: dp }, H);
      return meshes;
    },
  },

  // Layered wall panelling on a wall face: pos = bottom centre on the face, panels toward +Z, `length` along X up to `height`
  // (4.6). Dark kick band at the base, inset lower panels with dark seams up to a metal trim rail at 2.6, larger upper panels,
  // a cap band. Under 0.12 deep, no collision.
  'arch.panelling': {
    example: { params: { length: 4, height: 4.6 } },
    label: 'PANELLING kick band, panels, 2.6 trim, no collision',
    fields: [{ key: 'length', type: 'number', min: 0.5 }, { key: 'height', type: 'number', min: 2.8 }],
    build(world, d) {
      const id = 'arch.panelling';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const L = num(id, p, 'length', 4);
      const H = Math.max(2.8, num(id, p, 'height', 4.6));
      const parts = [
        ['dark', L, 0.32, 0.1, 0, 0.16, 0.05], // kick band
        ['dark', L, 2.14, 0.02, 0, 0.32 + 1.07, 0.01], // backing (shows in the seams), up to the rail: overlapping its ends z-fights
        ['metal', L, 0.14, 0.11, 0, 2.53, 0.055], // trim rail
        ['dark', L, H - 2.68, 0.015, 0, 2.6 + (H - 2.68) / 2, 0.0075], // up to the cap
        ['dark', L, 0.08, 0.08, 0, H - 0.04, 0.04], // cap
      ];
      for (const [x, w] of slots(L, 1.25)) {
        parts.push(['inWall', w - 0.05, 2.1, 0.05, x, 0.36 + 1.05, 0.045]);
        parts.push(['dark', w * 0.5, 0.05, 0.02, x, 1.9, 0.075]); // handle / vent slot
      }
      if (H - 2.6 > 0.4) for (const [x, w] of slots(L, 2.5)) parts.push(['inWall', w - 0.06, H - 2.6 - 0.18, 0.035, x, 2.6 + (H - 2.6 - 0.08) / 2, 0.03]);
      return build(world, d, q, parts);
    },
  },

  // Bulkhead surround for a kit.doorway (same pos / yaw): an octagonal frame on both wall faces around the opening, outside
  // the gate's trim and status lamp, with ochre edges and a low sill (0.025, walked over). width (4) / height (4) of the
  // opening, thickness (0.5) of the wall, frame (0.6). No collision.
  'arch.bulkhead': {
    example: { params: { width: 4, height: 4 } },
    label: 'BULKHEAD octagonal door surround, sill, no collision',
    fields: [{ key: 'width', type: 'number', min: 0.1 }, { key: 'height', type: 'number', min: 0.1 }, { key: 'thickness', type: 'number', min: 0.1, optional: true }, { key: 'frame', type: 'number', min: 0.1, optional: true }],
    build(world, d) {
      const id = 'arch.bulkhead';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const xi = Math.max(2, num(id, p, 'width', 4)) / 2 + 0.3; // clear of the gate trim (width / 2 + 0.28)
      const yi = Math.max(1.8, num(id, p, 'height', 4)) + 0.32; // above the lamp and the trim
      const t = num(id, p, 'thickness', 0.5);
      const f = num(id, p, 'frame', 0.6);
      const dp = 0.14;
      const parts = [['dark', 2 * xi, 0.025, t + 0.3, 0, 0.0125, 0]];
      for (const s of [1, -1]) {
        const z = s * (t / 2 + dp / 2);
        parts.push(['metal', 2 * xi, f, dp, 0, yi + f / 2, z]);
        for (const x of [xi, -xi]) {
          const o = Math.sign(x);
          parts.push(
            ['metal', f, yi, dp, x + (o * f) / 2, yi / 2, z],
            ['metal', f * R2, f * R2, dp, x, yi, z, 0, 0, Math.PI / 4], // corner diamond: chamfers the opening and the outline
            ['ochre', 0.05, yi - f, dp + 0.012, x + o * 0.015, (yi - f) / 2, z], // 1 cm proud of the jamb face (flush z-fights)
            ['dark', 0.2, 0.32, 0.02, x + o * f * 0.5, 1.5, z + s * (dp / 2 + 0.01)], // access plate
          );
        }
      }
      return build(world, d, q, parts);
    },
  },

  // Floor channel or grate, flush (top 0.02, walked over, no collision): pos = centre on the floor, size [x, z] (4 × 0.5).
  // Metal rim, dark bed, cross bars; light (cyan) runs a recessed strip under the bars along X ('none': a plain grate / hatch).
  'arch.floorChannel': {
    example: { params: { size: [4, 0.5], light: 'cyan' } },
    label: 'FLOOR CHANNEL lit grate, flush, no collision',
    fields: [{ key: 'size', type: 'vec2', min: 0.2 }, { key: 'light', type: 'enum', options: Object.keys(LIGHTS), optional: true }],
    build(world, d) {
      const id = 'arch.floorChannel';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const [L, W] = pair(id, p, 'size', [4, 0.5]);
      const lit = light(id, p);
      const parts = [
        ['dark', L - 0.02, 0.006, W - 0.02, 0, 0.003, 0], // bed, 1 cm inside the rims (flush ends z-fight)
        ['metal', L, 0.02, 0.06, 0, 0.01, W / 2 - 0.03],
        ['metal', L, 0.02, 0.06, 0, 0.01, -W / 2 + 0.03],
        ['metal', 0.06, 0.02, W - 0.12, L / 2 - 0.03, 0.01, 0],
        ['metal', 0.06, 0.02, W - 0.12, -L / 2 + 0.03, 0.01, 0],
      ];
      if (lit) parts.push([lit, L - 0.12, 0.004, Math.min(0.08, W * 0.3), 0, 0.008, 0]);
      for (const [x] of slots(L - 0.12, 0.2)) parts.push(['dark', 0.035, 0.012, W - 0.12, x, 0.014, 0]);
      return build(world, d, q, parts);
    },
  },

  // Ceiling coffers: a grid of I-beams under a flat roof. pos = centre x / z, pos.y = the ceiling underside; size [x, z] (8 × 8),
  // cells [nx, nz] (2 × 2: beams between the cells, none on the edges), depth (0.45). Nodes where beams cross. No collision.
  'arch.coffers': {
    example: { params: { size: [8, 8], cells: [2, 2] } },
    label: 'COFFERS ceiling beam grid, no collision',
    fields: [{ key: 'size', type: 'vec2', min: 0.5 }, { key: 'cells', type: 'vec2', min: 1 }, { key: 'depth', type: 'number', min: 0.05, optional: true }],
    build(world, d) {
      const id = 'arch.coffers';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const [W, D] = pair(id, p, 'size', [8, 8]);
      const [nx, nz] = pair(id, p, 'cells', [2, 2], true);
      const dp = num(id, p, 'depth', 0.45);
      const xs = Array.from({ length: nx - 1 }, (_, i) => -W / 2 + (W * (i + 1)) / nx);
      const zs = Array.from({ length: nz - 1 }, (_, i) => -D / 2 + (D * (i + 1)) / nz);
      const parts = [];
      // the web stops on the flange and both stop 1 cm short of the edges: coplanar faces z-fight (the flange bottom, the cove trims)
      const web = dp - 0.06;
      for (const x of xs) parts.push(['roof', 0.22, web, D - 0.02, x, -web / 2, 0], ['metal', 0.42, 0.06, D - 0.02, x, -dp + 0.03, 0]);
      for (const z of zs) parts.push(['roof', W - 0.02, web, 0.22, 0, -web / 2, z], ['metal', W - 0.02, 0.06, 0.42, 0, -dp + 0.03, z]);
      for (const x of xs) for (const z of zs) parts.push(['dark', 0.6, 0.1, 0.6, x, -dp - 0.02, z]);
      return build(world, d, q, parts);
    },
  },

  // Catwalk on wall brackets: pos = the wall face at the floor, the walkway toward +Z, `length` along X, `width` (1.2), deck top
  // at `height` (3.4: above a jet from the floor, 3.34). Grated deck, railing on the open sides, diagonal struts, a cyan
  // light line under the lip. Scenery: no collision (keep it out of jet reach from props and decks).
  'arch.catwalk': {
    example: { params: { length: 6, width: 1.2, height: 3.4 } },
    label: 'CATWALK on wall brackets, no collision',
    fields: [{ key: 'length', type: 'number', min: 1 }, { key: 'width', type: 'number', min: 0.5 }, { key: 'height', type: 'number', min: 0.5 }],
    build(world, d) {
      const id = 'arch.catwalk';
      const p = d.params ?? {};
      const q = quarters(id, d.yaw);
      const L = num(id, p, 'length', 6);
      const W = num(id, p, 'width', 1.2);
      const h = num(id, p, 'height', 3.4);
      const parts = [
        ['dark', L - 0.02, 0.04, W - 0.02, 0, h - 0.02, W / 2], // 1 cm inside the stringers (flush faces z-fight)
        ['metal', L, 0.19, 0.08, 0, h - 0.105, W - 0.04], // stringers, tops 1 cm under the deck top
        ['metal', L, 0.19, 0.08, 0, h - 0.105, 0.04],
        ['metal', L, 0.12, 0.02, 0, h + 0.06, W - 0.01], // kick plate
        ['metal', L, 0.05, 0.05, 0, h + 1.05, W - 0.05], // rails
        ['metal', L, 0.04, 0.04, 0, h + 0.55, W - 0.05],
        ['cyan', L, 0.03, 0.03, 0, h - 0.22, W - 0.06],
      ];
      for (const [x] of slots(L, 0.3)) parts.push(['metal', 0.04, 0.03, W - 0.1, x, h + 0.015, W / 2]); // grating
      for (const [x, s] of slots(L, 1.5)) parts.push(['metal', 0.06, 1.05, 0.06, x - s / 2 + 0.03, h + 0.525, W - 0.05]);
      for (const o of [1, -1]) {
        const x = o * (L / 2 - 0.03);
        parts.push(['metal', 0.06, 1.05, 0.06, x, h + 0.525, W - 0.05], ['metal', 0.05, 0.05, W - 0.05, x, h + 1.05, W / 2], ['metal', 0.04, 0.04, W - 0.05, x, h + 0.55, W / 2]);
      }
      const dz = W - 0.15;
      const len = Math.hypot(0.9, dz);
      for (const [x] of slots(L, 2.5)) {
        parts.push(
          ['metal', 0.1, 0.12, W, x, h - 0.26, W / 2], // arm under the deck
          ['metal', 0.08, 0.08, len, x, h - 0.75, 0.05 + dz / 2, -Math.atan2(0.9, dz)], // strut to the wall
          ['dark', 0.26, 0.42, 0.04, x, h - 1.15, 0.02], // wall plate
        );
      }
      return build(world, d, q, parts);
    },
  },
};
