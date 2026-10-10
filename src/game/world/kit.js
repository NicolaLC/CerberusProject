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

// Material key per role: the only place a kit piece names a material.
export const KIT_MATS = { floor: 'floor', wall: 'wall', low: 'low', high: 'high', platform: 'platform' };

// Frozen metrics (metrics.md sections 1, 3, 5).
const M = {
  tile: 4, tileThickness: 0.2,
  wallLength: 4, wallHeight: 7, wallThickness: 0.5, wallMinHeight: 2.0, // under 2.0 a jet climbs it (not a wall)
  doorWidth: 4, doorHeight: 4, doorMinWidth: 2.0, doorMinHeight: 1.8, jambMin: 0.9,
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

// Yaw in whole quarter turns (0..3). Anything that is not a multiple of 90 degrees throws.
function quarters(id, yaw = 0) {
  const q = yaw / (Math.PI / 2);
  if (typeof yaw !== 'number' || !Number.isFinite(yaw) || Math.abs(q - Math.round(q)) > 1e-6) {
    fail(id, `yaw must be a multiple of 90 degrees (PI/2), got ${yaw}`);
  }
  return ((Math.round(q) % 4) + 4) % 4;
}

// Rotates local boxes { x, y, z, w, h, d } (x/z center, y bottom) by q quarter turns about the vertical axis, with the
// same handedness as THREE's rotation.y (q = 1 sends local +X to -Z and local -Z to -X).
function turn(boxes, q) {
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

  // Climbs toward -Z at yaw 0; pos = center of the footprint (width x steps * run). params: width (4), height (target
  // top, 1.6), rise (0.4, max 0.45: more is rejected), run (1.0, min 0.6), mat (role platform).
  // The step count is ceil(height / rise), so the real rise is height / steps and never above `rise`.
  'kit.stairs': {
    example: { params: { width: 4, height: 1.6 } },
    label: 'STAIRS rise 0.4 run 1.0 width 4.0 to 1.6',
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
    build(world, d) {
      const id = 'kit.pillar';
      const p = d.params ?? {};
      return emit(world, id, d, [{ x: 0, y: 0, z: 0, w: M.pillar, h: M.highHeight, d: M.pillar, mat: matOf(p, 'high'), cover: 'high' }]);
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
