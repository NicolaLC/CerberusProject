// Environment kit (`kit.*` registry ids, a public contract: instructions/level.md). Modular pieces for levels, built
// from axis-aligned boxes through World.box, so collision, cover and shadows work exactly like env.box. Every default
// size comes from the frozen metrics (instructions/metrics.md); a size change there is a change here.
//
// data: { id, pos, yaw?, params? }. `pos` = center x/z of the footprint and bottom y (like env.box). `yaw` must be a
// multiple of 90 degrees (a box turned by anything else would no longer be axis-aligned). At yaw 0 a piece's length
// runs along +X and its depth along Z; stairs climb toward -Z (north) and a platform's stairs side is given by `stairs`.
// Materials: one key per role (floor / wall / cover / platform), swapped for a piece with `params.mat` (a key of
// World.mats), the hook for region skins. Bad params and bad yaw throw a readable error (a level file is data).
// Library meta on every entry: `example` ({ params, yaw? }, what the Library spawns) and `label` (one line of stats).

import * as THREE from 'three';
import { onProblem } from './encounter.js';
import { TILE_METERS } from './textures.js';

// Material key per role: the only place a kit piece names a material.
export const KIT_MATS = { floor: 'floor', wall: 'wall', low: 'low', high: 'high', platform: 'platform' };

// Inspector field for `mat` (options: 'mats' = every key of World.mats; absent = the piece's role default).
export const MAT = { key: 'mat', type: 'enum', options: 'mats', optional: true };

// Frozen metrics (metrics.md sections 1, 3, 5).
const M = {
  tile: 4, tileThickness: 0.2,
  wallLength: 4, wallHeight: 7, wallThickness: 0.5, wallMinHeight: 2.0, // under 2.0 a jet climbs it (not a wall)
  doorWidth: 4, doorHeight: 4, doorMinWidth: 2.0, doorMinHeight: 1.8, jambMin: 0.9,
  gateThickness: 0.3, gateTime: 1.2, // a gate is thinner than the 0.5 wall around it, so it slides into the lintel without touching its faces
  stepMax: 0.45, rise: 0.4, run: 1.0, runMin: 0.6, stairWidth: 4,
  rampRise: 0.1, rampMaxRise: 0.25, rampLength: 8,
  lowHeight: 1.1, lowThickness: 1.0, lowLength: 3, lowMin: 1.6,
  highHeight: 2.8, highThickness: 0.6, highLength: 2.4, highMin: 1.2,
  pillar: 1.2,
  platform: 8, platformHeight: 1.6, parapetHeight: 1.1, parapetThickness: 0.6,
};
const MAX_STEPS = 200;

const fail = (id, msg) => {
  throw new Error(`${id}: ${msg}`);
};

// Number param with a default; must be finite and >= min (strictly above 0 unless min is given).
function num(id, params, key, def, min = 0, strict = min === 0) {
  const v = params[key] ?? def;
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(id, `"${key}" must be a number, got ${JSON.stringify(v)}`);
  if (strict ? v <= min : v < min) fail(id, `"${key}" must be ${strict ? '>' : '>='} ${min}, got ${v}`);
  return v;
}

// [a, b] param of two positive numbers (a footprint).
function pair(id, params, key, def) {
  const v = params[key] ?? def;
  if (!Array.isArray(v) || v.length !== 2) fail(id, `"${key}" must be [w, d], got ${JSON.stringify(v)}`);
  return v.map((n, i) => num(id, { [key]: n }, key, def[i]));
}

// Yaw in whole quarter turns (0..3). Anything that is not a multiple of 90 degrees throws. Tolerance 1e-4 of a turn:
// saved levels round numbers to 4 decimals (workshop/io.js), so PI/2 comes back as 1.5708.
export function quarters(id, yaw = 0) {
  const q = yaw / (Math.PI / 2);
  if (typeof yaw !== 'number' || !Number.isFinite(yaw) || Math.abs(q - Math.round(q)) > 1e-4) {
    fail(id, `yaw must be a multiple of 90 degrees (PI/2), got ${yaw}`);
  }
  return ((Math.round(q) % 4) + 4) % 4;
}

// Rotates local boxes { x, y, z, w, h, d } (x/z center, y bottom) by q quarter turns about the vertical axis, with the
// same handedness as THREE's rotation.y (q = 1 sends local +X to -Z and local -Z to -X).
export function turn(boxes, q) {
  if (!q) return boxes;
  return boxes.map((b) => {
    let { x, z, w, d } = b;
    for (let i = 0; i < q; i++) [x, z, w, d] = [z, -x, d, w];
    return { ...b, x, z, w, d };
  });
}

const shift = (boxes, dx, dz) => boxes.map((b) => ({ ...b, x: b.x + dx, z: b.z + dz }));

// Builds local boxes at the piece's pos / yaw. Each box: { x, y, z, w, h, d, mat, cover?, collide? }.
function emit(world, id, data, boxes) {
  const q = quarters(id, data.yaw);
  const [px, py, pz] = data.pos;
  return turn(boxes, q).map((b) => {
    const mat = world.material({ mat: b.mat });
    return world.box(px + b.x, py + b.y, pz + b.z, b.w, b.h, b.d, mat, { cover: b.cover ?? null, collide: b.collide ?? true });
  });
}

// Shared gate look (art-style "Gates"): dark heavy metal, ochre chevron bands, status lamp red while sealed and cyan once open
// (emissive only, MeshBasicMaterial: no lights). Built once per world and kept across levels.
function gateMats(world) {
  if (world.gateMats) return world.gateMats;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#1b1d1f';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#C9A23A';
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(0, 56);
  g.lineTo(32, 16);
  g.lineTo(64, 56);
  g.stroke();
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  const m = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.8 });
  world.gateMats = {
    door: m(0x24282b),
    frame: m(0x16181a),
    seam: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.9 }),
    band: new THREE.MeshStandardMaterial({ map, roughness: 0.7, metalness: 0.3 }),
    sealed: new THREE.MeshBasicMaterial({ color: 0xd8341c }),
    open: new THREE.MeshBasicMaterial({ color: 0x3fe0ff }),
  };
  for (const x of Object.values(world.gateMats)) world.keep.add(x);
  return world.gateMats;
}

// Material key of a piece: params.mat overrides the role default.
const matOf = (params, role) => params.mat ?? KIT_MATS[role];

// Steps climbing toward -Z, footprint centered on the origin. Each step is a solid column from the ground (no gaps
// under a tread, nothing to slip under). The last step's top is exactly `height`. n = ceil(height / rise) steps, so the
// real rise is height / n (never above the asked one).
function stairBoxes(id, { width, rise, run, height, mat }) {
  if (rise > M.stepMax) fail(id, `rise ${rise} is above the step height ${M.stepMax} (TUNING.stepHeight): the player cannot climb it`);
  const n = Math.max(1, Math.ceil(height / rise - 1e-9));
  if (n > MAX_STEPS) fail(id, `${n} steps is too many (max ${MAX_STEPS}): raise "rise" or lower "height"`);
  const r = height / n;
  const depth = n * run;
  const boxes = [];
  for (let i = 1; i <= n; i++) boxes.push({ x: 0, y: 0, z: depth / 2 - (i - 0.5) * run, w: width, h: r * i, d: run, mat });
  return { boxes, depth, rise: r, steps: n };
}

function stairsParams(id, p, role) {
  const width = num(id, p, 'width', M.stairWidth);
  const height = num(id, p, 'height', M.platformHeight);
  const rise = num(id, p, 'rise', M.rise);
  const run = num(id, p, 'run', M.run, M.runMin, false);
  return { width, height, rise, run, mat: matOf(p, role) };
}

const SIDES = { n: 0, s: 1, e: 2, w: 3 };

export const KIT_PIECES = {
  // params: size [w, d] (4 x 4), thickness (0.2), flush? (true: the top is at pos.y and the tile hangs below it, for
  // floors that replace the ground; default: the tile sits on pos.y). mat (role floor)
  'kit.floor': {
    example: { params: { size: [4, 4] } },
    label: 'FLOOR TILE 4.0 × 4.0 × 0.2',
    fields: [{ key: 'size', type: 'vec2', min: 0.1 }, { key: 'thickness', type: 'number', min: 0.01 }, { key: 'flush', type: 'bool', def: false }, MAT],
    build(world, d) {
      const id = 'kit.floor';
      const p = d.params ?? {};
      const [w, dd] = pair(id, p, 'size', [M.tile, M.tile]);
      const t = num(id, p, 'thickness', M.tileThickness);
      return emit(world, id, d, [{ x: 0, y: p.flush ? -t : 0, z: 0, w, h: t, d: dd, mat: matOf(p, 'floor') }]);
    },
  },

  // params: length (4), height (7, min 2.0), thickness (0.5), mat (role wall). Cover 'wall' (acts as high cover)
  'kit.wall': {
    example: { params: { length: 4, height: 7 } },
    label: 'WALL 4.0 × 7.0 × 0.5',
    fields: [{ key: 'length', type: 'number', min: 0.1 }, { key: 'height', type: 'number', min: 0.1 }, { key: 'thickness', type: 'number', min: 0.1 }, MAT],
    build(world, d) {
      const id = 'kit.wall';
      const p = d.params ?? {};
      const w = num(id, p, 'length', M.wallLength);
      const h = num(id, p, 'height', M.wallHeight, M.wallMinHeight, false);
      const t = num(id, p, 'thickness', M.wallThickness);
      return emit(world, id, d, [{ x: 0, y: 0, z: 0, w, h, d: t, mat: matOf(p, 'wall'), cover: 'wall' }]);
    },
  },

  // A wall segment with a rectangular opening and a lintel above it. params: width (4, clamped to >= 2.0) and height
  // (4, clamped to >= 1.8) of the opening, length (width + 6: the whole segment, each jamb >= 0.9 so the wall end still
  // works as a peek edge), wallHeight (7, above the opening by >= 0.5), thickness (0.5), mat (role wall).
  // The opening is centered on pos. The lintel is not flagged as cover (nobody stands behind it).
  'kit.doorway': {
    example: { params: { width: 4, height: 4 } },
    label: 'DOORWAY 4.0 × 4.0 in 7.0 wall',
    fields: [{ key: 'width', type: 'number', min: 0.1 }, { key: 'height', type: 'number', min: 0.1 }, { key: 'length', type: 'number', min: 0.1, optional: true }, { key: 'wallHeight', type: 'number', min: 0.1 }, { key: 'thickness', type: 'number', min: 0.1 }, MAT],
    build(world, d) {
      const id = 'kit.doorway';
      const p = d.params ?? {};
      const width = Math.max(M.doorMinWidth, num(id, p, 'width', M.doorWidth));
      const height = Math.max(M.doorMinHeight, num(id, p, 'height', M.doorHeight));
      const length = num(id, p, 'length', width + 6);
      const wallH = num(id, p, 'wallHeight', M.wallHeight);
      const t = num(id, p, 'thickness', M.wallThickness);
      if (wallH < height + 0.5) fail(id, `wallHeight ${wallH} leaves no lintel above an opening of ${height} (needs >= ${height + 0.5})`);
      const jamb = (length - width) / 2;
      if (jamb < M.jambMin - 1e-9) fail(id, `each wall end beside the opening must be >= ${M.jambMin} wide (length ${length}, width ${width} leaves ${jamb})`);
      const mat = matOf(p, 'wall');
      const off = (width + jamb) / 2;
      return emit(world, id, d, [
        { x: -off, y: 0, z: 0, w: jamb, h: wallH, d: t, mat, cover: 'wall' },
        { x: off, y: 0, z: 0, w: jamb, h: wallH, d: t, mat, cover: 'wall' },
        { x: 0, y: height, z: 0, w: width, h: wallH - height, d: t, mat },
      ]);
    },
  },

  // A sealed gate for a doorway (kit.doorway): a heavy slab that blocks the opening (collision, bullets, sight) until its `on` happens,
  // then slides into the lintel ('up') or the floor ('down') in `time` seconds. pos = center of the opening at the floor, like
  // kit.doorway, so the two share the same pos / yaw. params: on (an `on` form, encounter.js: objective:<id>:done, trigger:<id>, ...),
  // width (4, clamped up to 2.0), height (4, clamped up to 1.8), thickness (0.3), slide ('up'), time (1.2 s), mat (role high).
  // plain (false): a breakaway slab, no frame, lamp or dressing: a deck plate that drops away on its `on` (the Skyway's broken deck).
  // Opens once per run; a restart, a scene load and the editor's play / edit rebuild it shut. In the editor and the Library it is inert and
  // draws a ghost of the space it slides into (sliding up needs a lintel at least `height` tall above it: wallHeight >= 2 * height).
  // closeOn (optional, an `on` form): after it happened the gate shuts again for good once the player is through (World.addGate).
  // shutOn (optional, an `on` form): after it happened the open gate shuts for good wherever the player is (still never on an enemy).
  'kit.gate': {
    example: { params: { on: 'trigger:gate', width: 4, height: 4 } },
    label: 'GATE 4.0 × 4.0, opens on an event',
    fields: [{ key: 'on', type: 'text' }, { key: 'closeOn', type: 'text', optional: true }, { key: 'shutOn', type: 'text', optional: true }, { key: 'width', type: 'number', min: 0.1 }, { key: 'height', type: 'number', min: 0.1 }, { key: 'thickness', type: 'number', min: 0.05 }, { key: 'slide', type: 'enum', options: ['up', 'down'], optional: true }, { key: 'time', type: 'number', min: 0.1, optional: true }, { key: 'plain', type: 'bool', optional: true }, MAT],
    check: (p, registry) => gateProblem(p, registry.guns),
    build(world, d) {
      const id = 'kit.gate';
      const p = d.params ?? {};
      const width = Math.max(M.doorMinWidth, num(id, p, 'width', M.doorWidth));
      const height = Math.max(M.doorMinHeight, num(id, p, 'height', M.doorHeight));
      const t = num(id, p, 'thickness', M.gateThickness);
      const time = num(id, p, 'time', M.gateTime);
      const slide = p.slide ?? 'up';
      const problem = gateProblem(p, world.registry?.guns);
      if (problem) fail(id, problem);
      const [mesh] = emit(world, id, d, [{ x: 0, y: 0, z: 0, w: width, h: height, d: t, mat: matOf(p, 'high') }]);
      // `plain`: a breakaway slab (a deck plate that drops on an event): no frame, lamp or dressing, only the sliding box
      if (p.plain) return world.addGate(mesh, { on: p.on, closeOn: p.closeOn ?? null, shutOn: p.shutOn ?? null, height, slide, time });
      const gm = gateMats(world);
      if (p.mat == null) mesh.material = gm.door;
      // static frame (jambs + lintel trim, no collision) and the status lamp (one emissive strip poking out of both lintel faces)
      // The trim pokes 2 cm into the opening: flush with the doorway's own faces it z-fights with them.
      const ft = M.wallThickness + 0.16;
      const lip = 0.02;
      const [jl, jr, lintel, lamp] = emit(world, id, d, [
        { x: -(width / 2 + 0.15 - lip), y: 0, z: 0, w: 0.3, h: height + 0.3, d: ft, mat: 'high', collide: false },
        { x: width / 2 + 0.15 - lip, y: 0, z: 0, w: 0.3, h: height + 0.3, d: ft, mat: 'high', collide: false },
        { x: 0, y: height - lip, z: 0, w: width, h: 0.3, d: ft, mat: 'high', collide: false },
        { x: 0, y: height + 0.1, z: 0, w: width * 0.5, h: 0.1, d: ft + 0.04, mat: 'high', collide: false },
      ]);
      for (const m of [jl, jr, lintel]) m.material = gm.frame;
      world.staticMeshes.splice(world.staticMeshes.indexOf(lamp), 1); // the lamp changes material on gate:open: out of the merged batches
      lamp.material = gm.sealed;
      // slab dressing as children (they ride with it): two chevron bands and vertical seams, facing along the thin axis
      const dress = new THREE.Group();
      dress.rotation.y = quarters(id, d.yaw) % 2 ? Math.PI / 2 : 0;
      for (const y of [-height / 2 + 0.3, height / 2 - 0.3]) {
        const geo = new THREE.BoxGeometry(width, 0.4, t + 0.03);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * width / 0.8);
        const band = new THREE.Mesh(geo, gm.band);
        band.position.y = y;
        dress.add(band);
      }
      const seams = Math.max(0, Math.floor(width) - 1);
      for (let i = 1; i <= seams; i++) {
        const seam = new THREE.Mesh(new THREE.BoxGeometry(0.05, height - 1.2, t + 0.03), gm.seam);
        seam.position.x = -width / 2 + (width * i) / (seams + 1);
        dress.add(seam);
      }
      mesh.add(dress);
      return world.addGate(mesh, { on: p.on, closeOn: p.closeOn ?? null, shutOn: p.shutOn ?? null, height, slide, time, lamps: [lamp], lampOpen: gm.open });
    },
  },

  // Climbs toward -Z at yaw 0; pos = center of the footprint (width x steps * run). params: width (4), height (target
  // top, 1.6), rise (0.4, max 0.45: more is rejected), run (1.0, min 0.6), mat (role platform).
  // The step count is ceil(height / rise), so the real rise is height / steps and never above `rise`.
  'kit.stairs': {
    example: { params: { width: 4, height: 1.6 } },
    label: 'STAIRS rise 0.4 run 1.0 width 4.0 to 1.6',
    fields: [{ key: 'width', type: 'number', min: 0.1 }, { key: 'height', type: 'number', min: 0.1 }, { key: 'rise', type: 'number', min: 0.01 }, { key: 'run', type: 'number', min: 0.1 }, MAT],
    build(world, d) {
      const id = 'kit.stairs';
      return emit(world, id, d, stairBoxes(id, stairsParams(id, d.params ?? {}, 'platform')).boxes);
    },
  },

  // The code has no slopes (World.groundAt reads box tops), so a ramp IS stairs with a fine rise: ~0.1 m steps
  // walk like a slope (the step height 0.45 takes them without a hitch). params: width (4), height (1.6), length (8:
  // the horizontal run of the whole ramp), rise (0.1, max 0.25: coarser is kit.stairs), mat (role platform).
  'kit.ramp': {
    example: { params: { width: 4, height: 1.6, length: 8 } },
    label: 'RAMP 8.0 long to 1.6 (0.1 steps)',
    fields: [{ key: 'width', type: 'number', min: 0.1 }, { key: 'height', type: 'number', min: 0.1 }, { key: 'length', type: 'number', min: 0.1 }, { key: 'rise', type: 'number', min: 0.01 }, MAT],
    build(world, d) {
      const id = 'kit.ramp';
      const p = d.params ?? {};
      const rise = num(id, p, 'rise', M.rampRise);
      if (rise > M.rampMaxRise) fail(id, `rise ${rise} is not a ramp (max ${M.rampMaxRise}): use kit.stairs`);
      const height = num(id, p, 'height', M.platformHeight);
      const length = num(id, p, 'length', M.rampLength);
      const steps = Math.max(1, Math.ceil(height / rise - 1e-9));
      const run = length / steps;
      return emit(world, id, d, stairBoxes(id, { width: num(id, p, 'width', M.stairWidth), rise, run, height, mat: matOf(p, 'platform') }).boxes);
    },
  },

  // 1.1 high, 1.0 thick (a hop), length 3 (min 1.6: two bodies wide). params: length. mat (role low)
  'kit.cover.low': {
    example: { params: { length: 3 } },
    label: 'LOW COVER 1.1 × 3.0',
    fields: [{ key: 'length', type: 'number', min: 0.1 }, MAT],
    build(world, d) {
      const id = 'kit.cover.low';
      const p = d.params ?? {};
      const w = num(id, p, 'length', M.lowLength, M.lowMin, false);
      return emit(world, id, d, [{ x: 0, y: 0, z: 0, w, h: M.lowHeight, d: M.lowThickness, mat: matOf(p, 'low'), cover: 'low' }]);
    },
  },

  // 2.8 high, 0.6 thick, length 2.4 (min 1.2: a pinned spot needs it). params: length. mat (role high)
  'kit.cover.high': {
    example: { params: { length: 2.4 } },
    label: 'HIGH COVER 2.8 × 2.4',
    fields: [{ key: 'length', type: 'number', min: 0.1 }, MAT],
    build(world, d) {
      const id = 'kit.cover.high';
      const p = d.params ?? {};
      const w = num(id, p, 'length', M.highLength, M.highMin, false);
      return emit(world, id, d, [{ x: 0, y: 0, z: 0, w, h: M.highHeight, d: M.highThickness, mat: matOf(p, 'high'), cover: 'high' }]);
    },
  },

  // 1.2 x 1.2 x 2.8 post, high cover from every side. No size params (the metric is fixed). mat (role high)
  'kit.pillar': {
    example: { params: {} },
    label: 'PILLAR 1.2 × 1.2 high cover',
    fields: [MAT],
    build(world, d) {
      const id = 'kit.pillar';
      const p = d.params ?? {};
      return emit(world, id, d, [{ x: 0, y: 0, z: 0, w: M.pillar, h: M.highHeight, d: M.pillar, mat: matOf(p, 'high'), cover: 'high' }]);
    },
  },

  // A curved wall: an arc of a circle, for rounded rooms (the Prologue's boss arena). pos = the arc's CENTRE at floor height.
  // params: radius (the INNER, room-facing face; the wall grows outward by `thickness`), from / to (degrees, the arc runs from
  // `from` to `to` counter-clockwise on the plan with +X east and +Z south: angle a is the point (x + r cos a, z + r sin a), so 0 = east,
  // 90 = south, 180 = west, 270 = north; `to` may be below `from`, the arc then runs the other way), height (7, min 2.0), thickness (0.6),
  // step (0.5 m: the length of each collision box), mat (role wall). Quarter-turn yaw adds -90 degrees per turn to both angles.
  // The mesh is one smooth curve (world-space UVs: one grid tile per 2 m along the arc); collision is a chain of short axis-aligned
  // boxes along it (the only collider the world has), each overlapping the next, so the wall is a fine staircase of 0.5 m
  // steps and stands up to ~0.2 m proud of the curve into the room. Not cover (the cover system wants straight edges).
  'kit.arcWall': {
    example: { params: { radius: 6, from: 0, to: 90, height: 7 } },
    label: 'ARC WALL r 6.0, 0..90 deg, 7.0 high',
    fields: [{ key: 'radius', type: 'number', min: 0.5 }, { key: 'from', type: 'number', min: -720 }, { key: 'to', type: 'number', min: -720 }, { key: 'height', type: 'number', min: 0.1 }, { key: 'thickness', type: 'number', min: 0.1 }, { key: 'step', type: 'number', min: 0.2, optional: true }, MAT],
    build(world, d) {
      const id = 'kit.arcWall';
      const p = d.params ?? {};
      const r = num(id, p, 'radius', 6);
      const q = quarters(id, d.yaw);
      const a0 = (num(id, p, 'from', 0, -720, false) - 90 * q) * (Math.PI / 180);
      const a1 = (num(id, p, 'to', 90, -720, false) - 90 * q) * (Math.PI / 180);
      const h = num(id, p, 'height', M.wallHeight, M.wallMinHeight, false);
      const t = num(id, p, 'thickness', 0.6);
      const step = num(id, p, 'step', 0.5, 0.2, false);
      const sweep = a1 - a0;
      if (Math.abs(sweep) < 1e-4 || Math.abs(sweep) > 2 * Math.PI + 1e-4) fail(id, `from ${p.from} to ${p.to} must span between 0 and 360 degrees`);
      const n = Math.max(1, Math.ceil((Math.abs(sweep) * (r + t / 2)) / step - 1e-9));
      if (n > 600) fail(id, `${n} segments is too many (max 600): raise "step" or lower "radius"`);
      const [cx, py, cz] = d.pos;
      const ro = r + t;
      const sink = 0.3; // mesh only, like World.box: no sun line at the foot
      const mat = world.material({ mat: matOf(p, 'wall') });
      const pos = [];
      const nor = [];
      const uv = [];
      const idx = [];
      const s = 1 / TILE_METERS;
      const vert = (x, y, z, nx, ny, nz, u, v) => { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, v); return pos.length / 3 - 1; };
      const at = (rad, a, y) => [cx + rad * Math.cos(a), y, cz + rad * Math.sin(a)];
      for (let i = 0; i <= n; i++) {
        const a = a0 + (sweep * i) / n;
        const c = Math.cos(a);
        const sn = Math.sin(a);
        const k = i / n;
        const y0 = py - sink;
        const y1 = py + h;
        const uo = Math.abs(sweep) * k * ro * s;
        const ui = Math.abs(sweep) * k * r * s;
        vert(...at(ro, a, y0), c, 0, sn, uo, y0 * s); // 6 per column: outer bottom / top, inner bottom / top, cap outer / inner
        vert(...at(ro, a, y1), c, 0, sn, uo, y1 * s);
        vert(...at(r, a, y0), -c, 0, -sn, ui, y0 * s);
        vert(...at(r, a, y1), -c, 0, -sn, ui, y1 * s);
        vert(...at(ro, a, y1), 0, 1, 0, cx * s + ro * c * s, cz * s + ro * sn * s);
        vert(...at(r, a, y1), 0, 1, 0, cx * s + r * c * s, cz * s + r * sn * s);
      }
      // winding for an arc running with increasing angle; a reversed arc flips it
      const f = (a, b, c2) => (sweep > 0 ? idx.push(a, b, c2) : idx.push(a, c2, b));
      for (let i = 0; i < n; i++) {
        const [b0, t0, ib0, it0, co0, ci0] = [0, 1, 2, 3, 4, 5].map((j) => i * 6 + j);
        const [b1, t1, ib1, it1, co1, ci1] = [0, 1, 2, 3, 4, 5].map((j) => (i + 1) * 6 + j);
        f(b0, t0, t1); f(b0, t1, b1); // outer face
        f(ib0, ib1, it1); f(ib0, it1, it0); // inner face
        f(co0, ci0, ci1); f(co0, ci1, co1); // top
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      world.scene.add(mesh);
      world.staticMeshes.push(mesh);
      // collision: one box per chord (AABB of its four corners), invisible, still a raycast proxy; 2 cm longer than the chord at each end
      const out = [mesh];
      for (let i = 0; i < n; i++) {
        const aa = a0 + (sweep * i) / n;
        const bb = a0 + (sweep * (i + 1)) / n;
        const pts = [at(r, aa, 0), at(ro, aa, 0), at(r, bb, 0), at(ro, bb, 0)];
        const xs = pts.map((v) => v[0]);
        const zs = pts.map((v) => v[2]);
        const x0 = Math.min(...xs) - 0.02;
        const x1 = Math.max(...xs) + 0.02;
        const z0 = Math.min(...zs) - 0.02;
        const z1 = Math.max(...zs) + 0.02;
        const m = world.box((x0 + x1) / 2, py, (z0 + z1) / 2, x1 - x0, h, z1 - z0, mat, { shadow: false });
        world.staticMeshes.splice(world.staticMeshes.indexOf(m), 1);
        m.visible = false;
        world.props.push(m);
        out.push(m);
      }
      return out;
    },
  },

  // Raised deck, solid from the ground. pos = center of the deck. params: size [w, d] (8 x 8), height (1.6),
  // stairs? 'n' | 's' | 'e' | 'w' (a stair attached outside that side, centered, rise 0.4 / run 1.0, width stairsWidth 4,
  // so it ends at the deck edge), parapets? true (low 1.1 x 0.6 parapets on every edge, open at the stairs) or a list of
  // sides, e.g. ['n', 'e']. mat (role platform) is the deck and stairs; coverMat (role low) the parapets.
  // Sides are in the piece's own frame: 'n' = -Z at yaw 0, turned with `yaw`.
  'kit.platform': {
    example: { params: { size: [8, 8], height: 1.6, stairs: 's', parapets: true } },
    label: 'PLATFORM 8.0 × 8.0 × 1.6 + stairs',
    fields: [{ key: 'size', type: 'vec2', min: 0.1 }, { key: 'height', type: 'number', min: 0.1 }, { key: 'stairs', type: 'enum', options: ['n', 's', 'e', 'w'], optional: true }, { key: 'parapets', type: 'bool', def: false }, MAT, { key: 'coverMat', type: 'enum', options: 'mats', optional: true }],
    build(world, d) {
      const id = 'kit.platform';
      const p = d.params ?? {};
      const [w, dd] = pair(id, p, 'size', [M.platform, M.platform]);
      const height = num(id, p, 'height', M.platformHeight, M.stepMax, true);
      const mat = matOf(p, 'platform');
      const stairs = p.stairs ?? null;
      if (stairs != null && !(stairs in SIDES)) fail(id, `"stairs" must be one of n, s, e, w, got ${JSON.stringify(stairs)}`);
      let parapets = p.parapets ?? false;
      if (parapets === true) parapets = ['n', 's', 'e', 'w'];
      else if (parapets === false) parapets = [];
      else if (!Array.isArray(parapets) || parapets.some((s) => !(s in SIDES))) fail(id, '"parapets" must be true, false or a list of n, s, e, w');
      const boxes = [{ x: 0, y: 0, z: 0, w, h: height, d: dd, mat }];

      const sw = num(id, p, 'stairsWidth', M.stairWidth);
      let gap = 0; // opening in the parapet on the stairs side
      if (stairs) {
        const side = stairs === 'n' || stairs === 's' ? w : dd;
        if (sw > side) fail(id, `stairsWidth ${sw} is wider than the ${stairs} side (${side})`);
        gap = sw;
        const st = stairBoxes(id, { width: sw, rise: M.rise, run: M.run, height, mat });
        const half = (stairs === 'n' || stairs === 's' ? dd : w) / 2 + st.depth / 2;
        // built for the south side (climbing toward -Z, into the deck), then turned and moved to its side
        const q = { s: 0, n: 2, e: 1, w: 3 }[stairs];
        const [ox, oz] = { s: [0, half], n: [0, -half], e: [half, 0], w: [-half, 0] }[stairs];
        boxes.push(...shift(turn(st.boxes, q), ox, oz));
      }

      // Parapets sit inside the deck edge. n / s run the full width, e / w fit between them (no overlap).
      const t = M.parapetThickness;
      const pm = p.coverMat ?? KIT_MATS.low;
      const par = (x, z, pw, pd) => pw > 0.01 && pd > 0.01 && boxes.push({ x, y: height, z, w: pw, h: M.parapetHeight, d: pd, mat: pm, cover: 'low' });
      // one edge of length `len` centered at (cx, cz), along x when `alongX`; split around the stairs gap
      const edge = (side, cx, cz, len, alongX) => {
        if (!parapets.includes(side)) return;
        const open = stairs === side ? gap : 0;
        const seg = (len - open) / 2;
        if (open) {
          const o = (open + seg) / 2;
          if (alongX) { par(cx - o, cz, seg, t); par(cx + o, cz, seg, t); } else { par(cx, cz - o, t, seg); par(cx, cz + o, t, seg); }
        } else if (alongX) par(cx, cz, len, t);
        else par(cx, cz, t, len);
      };
      edge('n', 0, -dd / 2 + t / 2, w, true);
      edge('s', 0, dd / 2 - t / 2, w, true);
      edge('e', w / 2 - t / 2, 0, dd - 2 * t, false);
      edge('w', -w / 2 + t / 2, 0, dd - 2 * t, false);
      return emit(world, id, d, boxes);
    },
  },
};

function gateProblem(p, guns) {
  return onProblem(p.on, 'on', guns) ?? (p.closeOn != null ? onProblem(p.closeOn, 'closeOn', guns) : null) ?? (p.shutOn != null ? onProblem(p.shutOn, 'shutOn', guns) : null) ?? (p.slide != null && p.slide !== 'up' && p.slide !== 'down' ? 'slide must be up or down' : null);
}
