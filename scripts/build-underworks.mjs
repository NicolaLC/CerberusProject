// Builds src/levels/underworks.json: Act 1's first mission, UNDERWORKS: SEWER LINE (the scrap layer: coolant run-off lines, scrap chutes, sorting rails) (gdd.md 2.6 / 2.10 step 9, level-design.md "Underworks").
//   node scripts/build-underworks.mjs        (writes the file through serializeLevel, then re-reads it with the real Registry)
// The level is generated, not hand-edited: change this script (or open the file in the Workshop and save it, which re-serializes
// it byte-identical) and run it again. The beat sheet is in instructions/level-design.md; the space in instructions/level.md.
//
// Space (one coolant run-off line (the lattice's drain), all interior, axis-aligned boxes; z grows south, the player walks north then east then north):
//   c0 fall chamber -> t1 culvert -> j junction -> t2a culvert -> t2b wide hall (the drones) -> t3 culvert -> cistern -> exit shaft.
// Every room is a floor of walkways (y 0) with a sunken water channel (bed y -0.4, one step of 0.4 <= 0.45) that follows the path;
// walls are 0.5 thick outside the room's inner faces; sectors run to the wall centre lines (level.md "Sectors").
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';

registerHooks({
  resolve: (spec, ctx, next) => {
    const res = next(spec, ctx);
    return res.url.endsWith('.json') ? { ...res, importAttributes: { type: 'json' } } : res;
  },
});
const { Registry } = await import('../src/game/registry.js');
const { WORLD_PIECES } = await import('../src/game/world/world.js');
const { ENEMY_PIECES } = await import('../src/game/actors/enemies.js');
const { PICKUP_PIECES } = await import('../src/game/world/pickups.js');
const { ENCOUNTER_PIECES } = await import('../src/game/world/encounter.js');
const { serializeLevel, parseLevel } = await import('../src/game/workshop/io.js');

const OUT = new URL('../src/levels/underworks.json', import.meta.url);
const T = 0.5; // wall thickness
const BOT = -1.4; // bottom of every floor and wall box (under the channel bed)
const CHAN = 3.2; // channel width
const BED = -0.4; // channel bed height

const P = [];
const add = (id, pos, params, extra = {}) => P.push({ id, ...extra, pos, ...(params ? { params } : {}) });
const r4 = (n) => Math.round(n * 1e4) / 1e4;

// ---- boxes by extents ----
function box(x0, x1, y0, y1, z0, z1, mat, extra = {}) {
  if (x1 - x0 < 1e-6 || z1 - z0 < 1e-6 || y1 - y0 < 1e-6) return;
  add('env.box', [r4((x0 + x1) / 2), y0, r4((z0 + z1) / 2)], { size: [r4(x1 - x0), r4(y1 - y0), r4(z1 - z0)], mat, ...extra });
}

// Floor of a rectangle: walkways (top 0) with the channel rectangles cut out (bed top BED). Cells from the rectangles' edges, runs merged along x.
function floor(x0, x1, z0, z1, chans = []) {
  const cl = chans.map(([a, b, c, d]) => [Math.max(a, x0), Math.min(b, x1), Math.max(c, z0), Math.min(d, z1)]).filter(([a, b, c, d]) => b > a && d > c);
  const xs = [...new Set([x0, x1, ...cl.flatMap(([a, b]) => [a, b])])].sort((a, b) => a - b);
  const zs = [...new Set([z0, z1, ...cl.flatMap(([, , c, d]) => [c, d])])].sort((a, b) => a - b);
  const inChan = (x, z) => cl.some(([a, b, c, d]) => x > a && x < b && z > c && z < d);
  for (let j = 0; j < zs.length - 1; j++) {
    let run = null;
    const flush = () => run && box(run.a, run.b, BOT, run.top, zs[j], zs[j + 1], run.top === 0 ? 'floor' : 'inFloor');
    for (let i = 0; i < xs.length - 1; i++) {
      const ch = inChan((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
      const top = ch ? BED : 0;
      if (run && run.top === top) run.b = xs[i + 1];
      else {
        flush();
        run = { a: xs[i], b: xs[i + 1], top };
      }
    }
    flush();
  }
}

// One wall. axis 'z': runs along z at x = `line` (inner face), 'x': along x at z = `line`. `out` = +1 / -1: where the thickness goes.
// gaps: [{ c, w, h }] openings centred at c, w wide, h high (a lintel closes the rest up to `top`).
function wall(axis, line, out, a, b, top, gaps = [], mat = 'inWall') {
  const put = (s, e, y0, y1) => {
    if (e - s < 1e-6) return;
    const [l0, l1] = out > 0 ? [line, line + T] : [line - T, line];
    if (axis === 'z') box(l0, l1, y0, y1, s, e, mat);
    else box(s, e, y0, y1, l0, l1, mat);
  };
  const gs = [...gaps].sort((p, q) => p.c - q.c);
  let at = a;
  for (const g of gs) {
    put(at, g.c - g.w / 2, BOT, top);
    put(g.c - g.w / 2, g.c + g.w / 2, g.h, top);
    at = g.c + g.w / 2;
  }
  put(at, b, BOT, top);
}

// A room: interior rectangle, height h, which walls exist (w e n s), gaps per side, niches, channel rectangles (world coordinates).
// Walls 'w' / 'e' run the full z extent (corners included, plus the band of n / s when those exist); roof over interior + walls.
function room({ x0, x1, z0, z1, h, sides = 'wens', gaps = {}, niches = [], chans = [], roof = true, floorRect = null }) {
  const has = (s) => sides.includes(s);
  const zA = has('n') ? z0 - T : z0;
  const zB = has('s') ? z1 + T : z1;
  const xA = has('w') ? x0 - T : x0;
  const xB = has('e') ? x1 + T : x1;
  const fr = floorRect ?? [x0, x1, z0, z1]; // a culvert's floor runs through the wall bands of the rooms at its ends
  floor(fr[0], fr[1], fr[2], fr[3], chans);
  const nich = { w: [], e: [], n: [], s: [] };
  for (const n of niches) {
    nich[n.side].push(n);
  }
  const gp = (s) => [...(gaps[s] ?? []), ...nich[s].map((n) => ({ c: n.c, w: n.w, h: n.h }))];
  if (has('w')) wall('z', x0, -1, zA, zB, h, gp('w'));
  if (has('e')) wall('z', x1, 1, zA, zB, h, gp('e'));
  if (has('n')) wall('x', z0, -1, x0, x1, h, gp('n'));
  if (has('s')) wall('x', z1, 1, x0, x1, h, gp('s'));
  for (const n of niches) {
    const sg = { w: -1, e: 1, n: -1, s: 1 }[n.side];
    const line = { w: x0, e: x1, n: z0, s: z1 }[n.side];
    const alongZ = n.side === 'w' || n.side === 'e'; // the wall runs along z
    // nb: a box by normal range [n0, n1] (away from the room), range along the wall [a0, a1] and height
    const nb = (n0, n1, a0, a1, y0, y1, mat) => (alongZ ? box(Math.min(n0, n1), Math.max(n0, n1), y0, y1, a0, a1, mat) : box(a0, a1, y0, y1, Math.min(n0, n1), Math.max(n0, n1), mat));
    const a0 = n.c - n.w / 2;
    const a1 = n.c + n.w / 2;
    const f = line + sg * T; // outer face of the main wall
    const back = line + sg * n.d; // back face of the niche space
    nb(f, back, a0, a1, BOT, 0, 'floor'); // niche floor
    nb(back, back + sg * T, a0 - T, a1 + T, BOT, n.h + 0.4, 'inWall'); // back wall
    nb(f, back + sg * T, a0 - T, a0, BOT, n.h + 0.4, 'inWall'); // sides
    nb(f, back + sg * T, a1, a1 + T, BOT, n.h + 0.4, 'inWall');
    nb(f, back, a0, a1, n.h, n.h + 0.4, 'roof'); // lid
  }
  if (roof) box(xA, xB, h, h + 0.3, zA, zB, 'roof');
}

// ---- the plan ----
// chamber c0 (the fall): x -6..6, z -10..0, h 7
// t1 culvert (north): x -4..4, z -33.5..-10.5, h 5
// junction j: x -6..6, z -46..-34, h 5.5
// t2a culvert (east): x 6.5..17.5, z -44..-36, h 5
// t2b hall: x 18..42, z -47..-33, h 6.5 (the drones)
// t3 culvert (north): x 32..40, z -72.5..-47.5, h 5
// cistern: x 24..48, z -96..-72, h 7.5
// exit passage: x 34..38, z -101.5..-96.5, h 4.5; shaft: x 33..39, z -108..-102, h 14

const MAIN = (z0, z1) => [-CHAN / 2, CHAN / 2, z0, z1]; // a channel along z through x 0
const ALONG_X = (x0, x1, zc) => [x0, x1, zc - CHAN / 2, zc + CHAN / 2];
const CHAN_J_Z = [-41.6, -38.4]; // the channel's east leg: z -40 +- 1.6
const T3X = [34.4, 37.6]; // the channel in t3: x 36 +- 1.6

// c0
room({
  x0: -6, x1: 6, z0: -10, z1: 0, h: 7, roof: false,
  gaps: { n: [{ c: 0, w: 8, h: 5 }] },
  chans: [[-CHAN / 2, CHAN / 2, -10, -7.5]],
});
// the roof of the fall chamber, with the broken shaft hole x -2..2, z -6..-2
box(-6.5, -2, 7, 7.3, -10.5, 0.5, 'roof');
box(2, 6.5, 7, 7.3, -10.5, 0.5, 'roof');
box(-2, 2, 7, 7.3, -10.5, -6, 'roof');
box(-2, 2, 7, 7.3, -2, 0.5, 'roof');
// the shaft above: walls round the hole up to the grate (a cap with a slot)
box(-2.5, -2, 7.3, 13, -6.5, -1.5, 'inWall');
box(2, 2.5, 7.3, 13, -6.5, -1.5, 'inWall');
box(-2, 2, 7.3, 13, -6.5, -6, 'inWall');
box(-2, 2, 7.3, 13, -2, -1.5, 'inWall');
box(-2.5, 2.5, 13, 13.4, -6.5, -1.5, 'roof');
// torn hole edge: beams and slabs hanging into the opening
box(-2.6, -1.4, 6.2, 7, -5.4, -4.8, 'inLow', { collide: false });
box(1.0, 2.4, 6.4, 7, -3.0, -2.5, 'inLow', { collide: false });
// the scrap heap STEM-00 landed on (spawn platform top 0.4), scrap around it, a heap behind it
box(-1.2, 1.2, 0, 0.4, -5.2, -2.8, 'inLow');
box(-2.4, -1.2, 0, 0.3, -5.0, -3.6, 'inWall');
box(1.2, 2.5, 0, 0.35, -4.6, -3.0, 'inWall');
box(-2.8, 2.8, 0, 0.8, -2.8, -1.2, 'inWall');
box(-3.6, -2.4, 0, 0.5, -2.6, -1.2, 'inLow');
box(0.2, 1.4, 0.8, 1.3, -2.6, -1.8, 'inLow', { collide: false });
box(-1.8, -0.6, 0.8, 1.1, -2.5, -1.7, 'inHigh', { collide: false });
box(2.6, 3.4, 0, 0.6, -5.6, -4.6, 'inLow');
box(-3.4, -2.6, 0, 0.35, -6.4, -5.4, 'inHigh');
box(-4.6, -3.8, 0, 0.9, -8.6, -7.4, 'inWall');
box(3.8, 5.2, 0, 0.7, -8.0, -6.8, 'inLow');
add('prop.crate', [-4.8, 0, -1.8], { size: 'large' }, { yaw: 0 });
add('prop.crate', [4.6, 0, -2.2], { size: 'small' }, { yaw: 0 });
add('prop.cables', [-2.2, 6.9, -3.2], { to: [-0.4, -6.4, 1.4], count: 3 });
add('prop.cables', [1.8, 6.9, -2.4], { to: [1.3, -6.3, -1.4], count: 2 });
add('prop.cables', [-5.9, 4.0, -7.0], { to: [1.2, -3.9, 1.4], count: 2 });
add('prop.pipes', [0, 4.6, -9.6], { length: 8, count: 2, mount: 'wall', valves: 1 }, { yaw: 0 });

// t1: the first run-off culvert, x -4..4, with side niches (scrap bays)
const NICHE_H = 3.6;
room({
  x0: -4, x1: 4, z0: -33.5, z1: -10.5, h: 5, sides: 'we',
  floorRect: [-4, 4, -34, -10],
  chans: [MAIN(-34, -10)],
  niches: [
    { side: 'w', c: -17, w: 3, d: 2, h: NICHE_H },
    { side: 'w', c: -28, w: 3, d: 2, h: NICHE_H },
    { side: 'e', c: -22.5, w: 3, d: 2, h: NICHE_H },
  ],
});

// j: the first junction
room({
  x0: -6, x1: 6, z0: -46, z1: -34, h: 5.5,
  gaps: { s: [{ c: 0, w: 8, h: 5 }], e: [{ c: -40, w: 8, h: 5 }] },
  chans: [[-CHAN / 2, CHAN / 2, -41.6, -34], [CHAN / 2, 6, CHAN_J_Z[0], CHAN_J_Z[1]]],
});

// t2a: a culvert east
room({
  x0: 6.5, x1: 17.5, z0: -44, z1: -36, h: 5, sides: 'ns',
  floorRect: [6, 18, -44, -36],
  chans: [ALONG_X(6, 18, -40)],
  niches: [
    { side: 'n', c: 10, w: 3, d: 2, h: NICHE_H },
    { side: 's', c: 13.5, w: 3, d: 2, h: NICHE_H },
  ],
});

// t2b: the wide hall (drones fly here: its interior zone is low, below)
room({
  x0: 18, x1: 42, z0: -47, z1: -33, h: 6.5,
  gaps: { w: [{ c: -40, w: 8, h: 5 }], n: [{ c: 36, w: 8, h: 5 }] },
  chans: [[18, T3X[1], CHAN_J_Z[0], CHAN_J_Z[1]], [T3X[0], T3X[1], -47, CHAN_J_Z[0]]],
});

// t3: a culvert north to the cistern
room({
  x0: 32, x1: 40, z0: -71.5, z1: -47.5, h: 5, sides: 'we',
  floorRect: [32, 40, -72, -47],
  chans: [[T3X[0], T3X[1], -72, -47]],
});

// the reclamation cistern: a coolant pool in the middle, walkways round it
room({
  x0: 24, x1: 48, z0: -96, z1: -72, h: 7.5,
  gaps: { s: [{ c: 36, w: 8, h: 5 }], n: [{ c: 36, w: 4, h: 4.5 }] },
  chans: [[T3X[0], T3X[1], -76, -72], [30, 42, -86, -76]],
});

// exit passage and the maintenance shaft
room({
  x0: 34, x1: 38, z0: -101.5, z1: -96.5, h: 4.5, sides: 'we',
  floorRect: [34, 38, -102, -96],
});
room({
  x0: 33, x1: 39, z0: -108, z1: -102, h: 14,
  gaps: { s: [{ c: 36, w: 4, h: 4.5 }] },
});

// ---- ladder in the shaft (north wall face z -108): rails and rungs, no collision ----
box(35.65, 35.73, 0, 13, -107.95, -107.85, 'inLow', { collide: false, shadow: false });
box(36.27, 36.35, 0, 13, -107.95, -107.85, 'inLow', { collide: false, shadow: false });
for (let y = 0.5; y < 13; y += 0.6) box(35.65, 36.35, y, y + 0.05, -107.9, -107.8, 'inLow', { collide: false, shadow: false });
box(34.4, 37.6, 13, 13.15, -108, -102, 'inLow', { collide: false, shadow: false }); // the maintenance grate over the top
box(33, 39, 9.5, 9.9, -108, -104.6, 'inLow', { collide: false, shadow: false }); // a broken landing half way
add('prop.panel', [36, 1.6, -107.9], { text: 'MAINT SHAFT 9\nUNIT ACCESS', width: 1.8 }, { yaw: 0 });
add('prop.pipes', [36, 6, -107.9], { length: 5.5, count: 2, mount: 'wall', valves: 1 }, { yaw: 0 });

// ---- dressing: coolant pipes, cables, drain grates, ribs ----
// wall mounts: west wall (x face, room toward +X) yaw +PI/2 (run toward -Z); east wall yaw -PI/2 (run toward +Z);
// north wall (z face, room toward +Z) yaw 0 (run +X); south wall (room toward -Z) yaw PI (run -X). Ceiling pipes run along the yaw's X.
const W = Math.PI / 2;
const E = (3 * Math.PI) / 2;
// t1
add('prop.pipes', [-3.97, 2.7, -22], { length: 20, count: 2, mount: 'wall', valves: 2 }, { yaw: W });
add('prop.pipes', [3.97, 3.4, -20], { length: 18, count: 3, mount: 'wall', valves: 1 }, { yaw: E });
add('prop.pipes', [0, 4.15, -22], { length: 22, count: 3, mount: 'ceiling', hang: 0.45, valves: 0 }, { yaw: W });
add('prop.cables', [-3.7, 4.6, -12], { to: [2.4, -4.5, 0.6], count: 3 });
add('prop.cables', [3.7, 4.8, -26], { to: [-2.6, -4.7, -0.4], count: 2 });
add('prop.crate', [-5.6, 0, -17.2], { size: 'medium' }, { yaw: 0 });
add('prop.crate', [5.5, 0, -22.8], { size: 'small' }, { yaw: 0 });
for (const [x, z, l] of [[-2.8, -13.5, 3], [2.9, -31.5, 3], [-3, -24.2, 1.5]]) add('arch.floorChannel', [x, 0, z], { size: [l, 0.5], light: 'none' });
add('arch.floorChannel', [2.9, 0, -15.5], { size: [1.2, 1.2], light: 'none' });
add('arch.floorChannel', [-2.9, 0, -30.5], { size: [1.2, 1.2], light: 'none' });
for (const z of [-13.5, -22, -32]) add('arch.rib', [-4, 0, z], { height: 5, width: 0.5, depth: 0.3 }, { yaw: W });
for (const z of [-13.5, -18, -27.5, -32]) add('arch.rib', [4, 0, z], { height: 5, width: 0.5, depth: 0.3 }, { yaw: E });
// j
add('prop.pipes', [0, 4.6, -45.9], { length: 9, count: 3, mount: 'wall', valves: 2 }, { yaw: 0 });
add('prop.panel', [-3, 1.6, -45.9], { text: 'DRAIN 7\nSEALED', width: 1.6 }, { yaw: 0 });
add('arch.floorChannel', [2.9, 0, -44.4], { size: [1.2, 1.2], light: 'none' });
add('arch.floorChannel', [-4.2, 0, -37], { size: [2.4, 0.5], light: 'none' }, { yaw: W });
add('prop.crate', [-5.2, 0, -44.8], { size: 'large' }, { yaw: 0 });
add('prop.cables', [-5.9, 5.2, -36], { to: [1.6, -5.1, -3.5], count: 3 });
add('prop.cables', [5.9, 5.2, -43], { to: [-1.4, -5.1, 1.5], count: 2 });
add('kit.pillar', [-3.6, 0, -37.2], { mat: 'inHigh' });
add('kit.pillar', [3.6, 0, -43.4], { mat: 'inHigh' });
// t2a
add('prop.pipes', [12, 3.0, -43.97], { length: 10, count: 2, mount: 'wall', valves: 1 }, { yaw: 0 });
add('prop.pipes', [12, 4.15, -40], { length: 11, count: 3, mount: 'ceiling', hang: 0.45, valves: 0 }, { yaw: 0 });
add('prop.cables', [8, 4.8, -37], { to: [2.4, -4.7, 0.4], count: 3 });
add('prop.crate', [9.8, 0, -36.6], { size: 'small' }, { yaw: 0 });
add('arch.floorChannel', [15.3, 0, -43], { size: [1.2, 1.2], light: 'none' });
for (const x of [7.5, 13.5, 16.5]) add('arch.rib', [x, 0, -44], { height: 5, width: 0.5, depth: 0.3 }, { yaw: 0 });
for (const x of [8, 10.5, 16.5]) add('arch.rib', [x, 0, -36], { height: 5, width: 0.5, depth: 0.3 }, { yaw: Math.PI });
// t2b
add('prop.pipes', [30, 5.0, -46.97], { length: 22, count: 3, mount: 'wall', valves: 2 }, { yaw: 0 });
add('prop.pipes', [30, 4.0, -33.03], { length: 20, count: 2, mount: 'wall', valves: 1 }, { yaw: Math.PI });
add('prop.pipes', [30, 5.9, -40], { length: 22, count: 3, mount: 'ceiling', hang: 0.45, valves: 0 }, { yaw: 0 });
add('prop.cables', [24, 6.2, -44], { to: [1.2, -6.1, 1.4], count: 3 });
add('prop.cables', [33, 6.2, -35], { to: [-1.0, -6.1, -1.1], count: 3 });
add('prop.cables', [40.5, 6.2, -42], { to: [-1.2, -6.1, 0.8], count: 2 });
add('arch.floorChannel', [27, 0, -37.5], { size: [4, 0.5], light: 'none' });
add('arch.floorChannel', [39.4, 0, -44.6], { size: [1.2, 1.2], light: 'none' });
// the collapsed east end of the hall: rubble and a hanging pipe
box(40, 42, 0, 0.7, -46.6, -43.2, 'inLow');
box(40.6, 42, 0.7, 1.5, -46.2, -44.4, 'inWall', { collide: false });
box(40.2, 42, 0, 0.5, -35.4, -33.4, 'inWall');
// t3
add('prop.pipes', [32.03, 2.6, -60], { length: 22, count: 2, mount: 'wall', valves: 1 }, { yaw: W });
add('prop.pipes', [36, 4.15, -60], { length: 24, count: 3, mount: 'ceiling', hang: 0.45, valves: 0 }, { yaw: W });
add('prop.cables', [32.4, 4.8, -55], { to: [2.0, -4.7, 0.5], count: 3 });
add('prop.cables', [39.6, 4.8, -64], { to: [-2.0, -4.7, -0.5], count: 2 });
add('arch.floorChannel', [32.9, 0, -52], { size: [1.2, 1.2], light: 'none' });
for (const z of [-50.5, -55.5, -60.5, -65, -69]) add('arch.rib', [32, 0, z], { height: 5, width: 0.5, depth: 0.3 }, { yaw: W });
for (const z of [-53, -58, -63, -69]) add('arch.rib', [40, 0, z], { height: 5, width: 0.5, depth: 0.3 }, { yaw: E });
// the unit repair station on t3's east wall, before the cistern
add('supply.repair', [39.6, 0, -66], { prompt: 'REPAIR' }, { name: 'sewer-repair', yaw: E });
add('env.label', [38.4, 0.045, -63.4], { text: 'UNIT SERVICE', size: 0.3, flat: true, yaw: Math.PI / 2 });
// cistern
add('prop.pipes', [36, 6.0, -95.97], { length: 14, count: 3, mount: 'wall', valves: 2 }, { yaw: 0 });
add('prop.pipes', [36, 5.4, -72.03], { length: 20, count: 3, mount: 'wall', valves: 1 }, { yaw: Math.PI });
add('prop.pipes', [24.03, 5.0, -84], { length: 22, count: 2, mount: 'wall', valves: 1 }, { yaw: W });
add('prop.pipes', [47.97, 5.0, -84], { length: 22, count: 2, mount: 'wall', valves: 1 }, { yaw: E });
add('prop.cables', [28, 7.2, -80], { to: [1.0, -7.1, 2.0], count: 3 });
add('prop.cables', [44, 7.2, -88], { to: [-1.0, -7.1, -1.0], count: 3 });
add('prop.cables', [36, 7.2, -92], { to: [0.8, -7.1, 1.2], count: 2 });
add('arch.floorChannel', [26.5, 0, -74], { size: [1.2, 1.2], light: 'none' });
add('arch.floorChannel', [45.5, 0, -93], { size: [1.2, 1.2], light: 'none' });
for (const z of [-78, -84, -90]) {
  add('arch.rib', [24, 0, z], { height: 7.5, width: 0.6, depth: 0.35 }, { yaw: W });
  add('arch.rib', [48, 0, z], { height: 7.5, width: 0.6, depth: 0.35 }, { yaw: E });
}
// cover: sparse, frozen metrics (low 1.1 x 1.0, pillars 1.2 x 1.2 x 2.8); hall t2b first
for (const [x, z, l] of [[22.5, -45, 3], [33, -45.5, 3], [30.5, -35.5, 3]]) add('kit.cover.low', [x, 0, z], { length: l, mat: 'inLow' });
for (const [x, z] of [[27.5, -44.5], [22, -35.3], [37, -35.3]]) add('kit.pillar', [x, 0, z], { mat: 'inHigh' });
// the cistern: pillars by the entry, rubble blocks on the walkways, the trooper line to the north
for (const [x, z] of [[31, -74.6], [41, -74.6], [27, -85], [45, -85]]) add('kit.pillar', [x, 0, z], { mat: 'inHigh' });
for (const [x, z, l, yaw] of [[27.5, -80, 3, 0], [44.5, -80, 3, 0], [29, -90.5, 3, 0], [43, -90.5, 3, 0], [36, -88.5, 3, 0]]) add('kit.cover.low', [x, 0, z], { length: l, mat: 'inLow' }, { yaw });
add('prop.crate', [47.2, 0, -73.2], { size: 'small' }, { yaw: 0 });
add('prop.crate', [24.9, 0, -94.8], { size: 'large' }, { yaw: 0 });

// ---- machine-first dressing (art-style.md "World: machine-first"): the scrap layer of the lattice ----
// Nothing here collides or casts a shadow (visual only; boxes merge per material, so no new draw calls): scrap chutes dropping
// from the ceiling, dumped broken units, sorting rails with hanging units, a recycler track, drain run-off, status lamps.
const dress = (x0, x1, y0, y1, z0, z1, mat) => box(x0, x1, y0, y1, z0, z1, mat, { collide: false, shadow: false });
// coolant run-off in every channel: a dull teal film (weathered inHigh) just above the bed, never brown
for (const [a, b, c, d] of [[-CHAN / 2, CHAN / 2, -10, -7.5], MAIN(-34, -10), [-CHAN / 2, CHAN / 2, -41.6, -34], [CHAN / 2, 6, CHAN_J_Z[0], CHAN_J_Z[1]], ALONG_X(6, 18, -40), [18, T3X[1], CHAN_J_Z[0], CHAN_J_Z[1]], [T3X[0], T3X[1], -47, CHAN_J_Z[0]], [T3X[0], T3X[1], -72, -47], [T3X[0], T3X[1], -76, -72], [30, 42, -86, -76]]) dress(a, b, BED, BED + 0.07, c, d, 'inHigh');
// a wall-mounted box: side w/e/n/s of the room, `line` the wall's inner face, n0..n1 into the room, a0..a1 along the wall
const wb = (side, line, n0, n1, a0, a1, y0, y1, mat) => {
  const rd = { w: 1, e: -1, n: 1, s: -1 }[side];
  const [l0, l1] = [Math.min(line + rd * n0, line + rd * n1), Math.max(line + rd * n0, line + rd * n1)];
  if (side === 'w' || side === 'e') dress(l0, l1, y0, y1, a0, a1, mat);
  else dress(a0, a1, y0, y1, l0, l1, mat);
};
// scrap chute: a duct from the ceiling to a flared mouth, a teal run-off streak down the wall
const chute = (side, line, c, w, top, mouth = 3.0) => {
  wb(side, line, 0, 0.55, c - w / 2, c + w / 2, mouth + 0.3, top, 'inWall');
  wb(side, line, 0, 0.85, c - w / 2 - 0.25, c + w / 2 + 0.25, mouth, mouth + 0.3, 'roof');
  wb(side, line, 0, 0.04, c - 0.2, c + 0.2, 0, mouth, 'inHigh');
};
// a freestanding hopper under the ceiling (the cistern: it feeds the reclamation pool)
const hopper = (x, z, top, mouth) => {
  dress(x - 0.3, x + 0.3, mouth + 0.4, top, z - 0.3, z + 0.3, 'inWall');
  dress(x - 0.55, x + 0.55, mouth, mouth + 0.4, z - 0.55, z + 0.55, 'roof');
  dress(x - 0.4, x + 0.4, mouth - 0.1, mouth, z - 0.4, z + 0.4, 'inHigh');
};
// a dumped, broken unit (inert): slumped torso, one standing leg, one lying, a dead head, an arm on the floor
const husk = (x, z, dir = 1, y = 0) => {
  dress(x - 0.2, x + 0.2, y + 0.35, y + 0.95, z - 0.13, z + 0.13, 'inWall');
  dress(x - 0.16, x + 0.16, y + 0.2, y + 0.35, z - 0.12, z + 0.12, 'roof');
  dress(x - 0.1, x + 0.1, y + 0.98, y + 1.2, z - 0.1, z + 0.1, 'inWall');
  dress(x + 0.06, x + 0.16, y, y + 0.22, z - 0.05, z + 0.05, 'roof');
  dress(x - 0.6 * dir, x - 0.2 * dir, y, y + 0.1, z + 0.05, z + 0.15, 'roof');
  dress(x + 0.2 * dir, x + 0.8 * dir, y, y + 0.08, z - 0.2, z - 0.12, 'inWall');
};
// a unit hung on a sorting rail by its cable (like the Prologue's puppets)
const hung = (x, z, yRail, drop = 1.3) => {
  const y = yRail - drop - 0.95;
  dress(x - 0.015, x + 0.015, y + 0.95, yRail, z - 0.015, z + 0.015, 'roof');
  dress(x - 0.2, x + 0.2, y + 0.35, y + 0.95, z - 0.12, z + 0.12, 'inWall');
  dress(x - 0.1, x + 0.1, y + 0.97, y + 1.17, z - 0.1, z + 0.1, 'inWall');
  dress(x - 0.1, x - 0.02, y - 0.25, y + 0.35, z - 0.05, z + 0.05, 'roof');
  dress(x + 0.03, x + 0.11, y - 0.1, y + 0.35, z - 0.05, z + 0.05, 'roof');
  dress(x + 0.2, x + 0.28, y + 0.45, y + 0.9, z - 0.04, z + 0.04, 'roof');
};
// a sorting rail high in a room along x (or z when `alongZ`) with trolleys, hung units every `step`
const sortRail = (alongZ, at, y, a, b, step, from = a + 1.5) => {
  const rail = (p0, p1, q) => (alongZ ? dress(at - 0.08, at + 0.08, y, y + 0.14, p0, p1, q) : dress(p0, p1, y, y + 0.14, at - 0.08, at + 0.08, q));
  rail(a, b, 'roof');
  for (let t = from; t < b - 0.5; t += step) {
    rail(t - 0.25, t + 0.25, 'inWall');
    if (alongZ) hung(at, t, y);
    else hung(t, at, y);
  }
};
// a row of status lamps on a wall, identical and steady (the one mind keeps one rhythm)
const lamps = (side, line, c, y, n = 4) => {
  for (let i = 0; i < n; i++) wb(side, line, 0, 0.05, c + i * 0.4, c + i * 0.4 + 0.16, y, y + 0.1, 'stripCyan');
};
// recycler track: two rails and ties along z on a walkway (x0 / x1 the rails)
const track = (x0, x1, z0, z1) => {
  for (const x of [x0, x1]) dress(x - 0.04, x + 0.04, 0, 0.05, z0, z1, 'roof');
  for (let z = z0 + 0.4; z < z1 - 0.2; z += 1.2) dress(x0 - 0.2, x1 + 0.2, 0, 0.025, z - 0.07, z + 0.07, 'inWall');
};
// c0: the fall chamber is a dump point; more chutes, broken units half buried in the scrap
chute('w', -6, -6.5, 1.8, 6.9, 3.4);
chute('e', 6, -5, 1.4, 6.9, 3.4);
husk(-2.9, -8.2, 1);
husk(2.0, -1.0, -1);
husk(4.6, -5.0, -1);
dress(-3.2, -2.4, 0.5, 1.0, -2.2, -1.5, 'roof');
lamps('w', -6, -9.3, 2.0, 3);
// t1: two chutes a side, units tipped into the niches, a sorting rail down the west side, a recycler track on the west walkway
chute('w', -4, -12, 1.4, 5);
chute('e', 4, -15.8, 1.4, 5);
chute('e', 4, -30, 1.4, 5);
husk(-5.5, -17.8, -1);
husk(-5.3, -16.4, 1);
husk(-5.5, -28.6, 1);
husk(5.6, -23.2, 1);
husk(5.4, -21.8, -1);
sortRail(true, -2.4, 4.7, -32, -12, 5, -30);
track(-3.35, -2.35, -33.5, -10.5);
lamps('e', 4, -26, 1.9, 5);
// j: the junction is a sorting switch: a chute, a rail, units staged against the walls
chute('w', -6, -43, 1.4, 5.5);
chute('w', -6, -38.2, 1.0, 5.5);
husk(-5.0, -41.6, 1);
sortRail(false, -37.5, 4.9, -5, 5, 4, -3.5);
lamps('n', -46, 3.0, 1.9, 4);
// t2a: units tipped in the niches, a rail down the culvert
chute('n', -44, 15, 1.6, 5);
chute('s', -36, 9.15, 1.4, 5);
husk(10.2, -45.3, 1);
husk(9.1, -45.5, -1);
husk(13.2, -34.6, 1);
sortRail(false, 11, 4.55, 7, 17, 4.5, 8.5);
// t2b: the collapsed end is where this chute dumps (the rubble is its spill); a rail over the hall
chute('e', 42, -40, 2.4, 6.4, 3.2);
husk(41.0, -44.7, -1);
husk(40.9, -36.2, -1);
sortRail(false, -33.9, 5.6, 21, 40, 5, 22.5);
lamps('w', 18, -46.7, 2.0, 3);
// t3: a chute and a recycler track along the west walkway
chute('e', 40, -50.8, 1.4, 5);
track(33.0, 33.9, -71.5, -47.5);
lamps('w', 32, -68.5, 1.9, 4);
// the cistern: the reclamation pool; four hoppers feed it, units hang on two sorting rails, dumped units on the far walkway
hopper(32, -81, 7.5, 5.2);
hopper(40, -81, 7.5, 5.2);
hopper(32, -85, 7.5, 5.2);
hopper(40, -85, 7.5, 5.2);
sortRail(true, 28.4, 6.6, -95, -73, 4, -93);
sortRail(true, 43.6, 6.6, -95, -73, 4, -91);
husk(26.5, -95.2, 1);
husk(46.0, -95.0, -1);
husk(44.4, -93.5, 1);
lamps('s', -72, 29.5, 2.1, 4);
lamps('n', -96, 39.5, 2.1, 4);
// exit shaft: a chute and a unit on the landing
chute('w', 33, -105, 1.4, 13, 10.6);
husk(35.4, -105.6, 1, 9.9);

// ---- lights (very dark: few steady cold lamps (one mind, one rhythm), the violet shaft, STEM-00's amber core) ----
const lamp = (name, x, y, z, size, mat = 'stripWhite', own = false) => add('env.strip', [x, y, z], { size, mat, ...(own ? { ownMaterial: true } : {}) }, { name });
const light = (x, y, z, color, intensity, distance, flicker) => add('light.point', [x, y, z], { color, intensity, distance, ...(flicker ? { flicker: { strip: flicker } } : {}) });
// c0: violet light from the grate far above, the amber core
light(0, 11.5, -4, '#8f5cff', 70, 24);
light(0, 6.6, -4, '#7a4cf0', 38, 14);
light(0, 1.0, -3.2, '#ff9a2a', 7, 5);
lamp('lamp-c0', 5.95 - 0.1, 3.2, -8.5, [0.12, 0.12, 1.0], 'stripWhite');
light(5.2, 3.0, -8.5, '#9fc4d4', 9, 9);
// t1
lamp('lamp-t1a', -3.93, 3.4, -18, [0.12, 0.12, 1.2], 'stripWhite');
light(-3.2, 3.3, -18, '#a9d4e6', 14, 11);
lamp('lamp-t1b', 3.93, 3.4, -29, [0.12, 0.12, 1.2], 'stripWhite');
light(3.2, 3.3, -29, '#8fb4c6', 9, 9);
// j
lamp('lamp-j', 0, 5.3, -44, [1.4, 0.1, 0.16], 'stripCyan');
light(0, 4.9, -44, '#6fd8f0', 14, 11);
light(-4.5, 3.0, -37, '#cfe8f0', 8, 8);
// t2a
lamp('lamp-t2a', 11, 4.85, -40, [1.2, 0.1, 0.16], 'stripWhite');
light(11, 4.5, -40, '#a9d4e6', 11, 10);
// t2b: dim cyan work lamp, a dull ember heat seam at the spill
lamp('lamp-t2b', 28, 6.3, -46.9, [1.6, 0.12, 0.12], 'stripCyan');
light(28, 5.8, -45, '#6fd8f0', 16, 13);
light(36, 5.6, -35, '#cfe8f0', 11, 11);
light(40.5, 3.0, -40, '#8a3a1c', 9, 6); // ember heat of the dumped scrap, never amber
// t3
lamp('lamp-t3', 34, 4.85, -56, [1.2, 0.1, 0.16], 'stripWhite');
light(34, 4.5, -56, '#a9d4e6', 12, 10);
light(38.4, 3.2, -66, '#e6f4fa', 12, 8); // the repair station
// cistern: cold lamps on the pillars, the lattice's violet run-off grate in the roof
light(36, 7.0, -79, '#7a4cf0', 40, 18);
light(28, 4.8, -76, '#9fd8ee', 16, 13);
light(44, 4.8, -76, '#9fd8ee', 16, 13);
lamp('lamp-cis', 36, 6.8, -91, [2.0, 0.12, 0.2], 'stripCyan');
light(36, 6.4, -91, '#6fd8f0', 20, 15);
light(26, 3.5, -92, '#cfe8f0', 9, 8);
light(46, 3.5, -92, '#cfe8f0', 9, 8);
// exit shaft
light(36, 12.2, -105, '#8f5cff', 50, 18);
light(36, 2.5, -104.5, '#a9d4e6', 8, 7);

// ---- zones ----
// drone space is outside the interior boxes (the drones fly above 3.2 m; instructions/level-design.md "Drones"): the hall and the cistern read INTERIOR below 2.7 m
const zone = (name, x0, x1, z0, z1, y0, h) => add('zone.interior', [r4((x0 + x1) / 2), y0, r4((z0 + z1) / 2)], { size: [r4(x1 - x0), h, r4(z1 - z0)] }, { name });
zone('zone-c0', -6.5, 6.5, -10.5, 0.5, -1.4, 15.4);
zone('zone-t1', -6.5, 6.5, -33.5, -10.5, -1.4, 6.9);
zone('zone-j', -6.5, 6.5, -46.5, -33.5, -1.4, 7.4);
zone('zone-t2a', 6.5, 17.5, -46.5, -33.5, -1.4, 6.9);
zone('zone-t2b', 17.5, 42.5, -47.5, -32.5, 0, 2.7);
zone('zone-t3', 31.5, 40.5, -71.5, -47.5, -1.4, 6.9);
zone('zone-cis', 23.5, 48.5, -96.5, -71.5, 0, 2.7);
zone('zone-exit', 32.5, 39.5, -108.5, -96.5, -1.4, 17);

// sectors: to the wall centre lines (niches inside); at most 29
const sector = (name, x0, x1, z0, z1, y1) => add('zone.sector', [r4((x0 + x1) / 2), -1.5, r4((z0 + z1) / 2)], { size: [r4(x1 - x0), r4(y1 + 1.5), r4(z1 - z0)] }, { name });
sector('c0', -6.25, 6.25, -10.25, 0.25, 14.5);
sector('t1', -6.6, 6.6, -33.75, -10.25, 6);
sector('j', -6.25, 6.25, -46.25, -33.75, 6.5);
sector('t2a', 6.25, 17.75, -46.75, -33.25, 6);
sector('t2b', 17.75, 42.25, -47.25, -32.75, 7.5);
sector('t3', 31.75, 40.25, -71.75, -47.25, 6);
sector('cistern', 23.75, 48.25, -96.25, -71.75, 8.6);
sector('exit', 32.75, 39.25, -108.25, -96.25, 15);
const portal = (x, z, w, d, h) => add('zone.portal', [x, 0, z], { size: [w, h, d] });
portal(0, -10.25, 8, 0.5, 5);
portal(0, -33.75, 8, 0.5, 5);
portal(6.25, -40, 0.5, 8, 5);
portal(17.75, -40, 0.5, 8, 5);
portal(36, -47.25, 8, 0.5, 5);
portal(36, -71.75, 8, 0.5, 5);
portal(36, -96.25, 4, 0.5, 4.5);

// ---- enemies: dormant until their objective wakes them (drones: bounds keep them in their hall) ----
const HALL = { minX: 18.6, maxX: 41.4, minZ: -46.4, maxZ: -33.6 };
const POOL = { minX: 24.6, maxX: 47.4, minZ: -95.4, maxZ: -72.6 };
add('enemy.drone', [34, 0, -37], { group: 'sewer-drones', dormant: true, bounds: HALL });
add('enemy.drone', [38, 0, -44], { group: 'sewer-drones', dormant: true, bounds: HALL });
add('enemy.trooper', [27.5, 0, -92.5], { group: 'cistern-troop', dormant: true }, { yaw: 0 });
add('enemy.trooper', [36, 0, -91.8], { group: 'cistern-troop', dormant: true }, { yaw: 0 });
add('enemy.trooper', [44.5, 0, -92.5], { group: 'cistern-troop', dormant: true }, { yaw: 0 });
add('enemy.drone', [36, 0, -84], { group: 'cistern-troop', dormant: true, bounds: POOL });

// ---- the mission (beat sheet: instructions/level-design.md "Underworks") ----
add('marker.spawn', [0, 0.4, -4], null, { yaw: Math.PI });
add('marker.checkpoint', [14, 0, -40], null, { name: 'cp-hall', yaw: -Math.PI / 2 });
add('marker.checkpoint', [36, 0, -69], null, { name: 'cp-cistern', yaw: Math.PI });
add('trigger.volume', [20.5, 0, -40], { size: [3, 3.2, 14], event: 'trigger', once: true, wakeGroup: 'sewer-drones' }, { name: 'drones-wake' });
add('objective.reach', [0, 0, -40], { text: 'FIRST JUNCTION', size: [6, 3, 6], order: 10, detail: 'Follow the coolant run-off line north.' }, { name: 'junction' });
add('objective.destroy', [30, 0, -40], { text: 'SEEKER DRONES', group: 'sewer-drones', order: 20, detail: 'Something hunts in the dark. Destroy the drones.' }, { name: 'hunters' });
add('objective.reach', [36, 0, -72.5], { text: 'THE CISTERN', size: [8, 3, 3], order: 30, detail: 'The run-off line opens into the reclamation cistern. Repair first if you need it ({interact} at the station).' }, { name: 'cistern-gate' });
add('objective.destroy', [36, 0, -84], { text: 'CISTERN: HOSTILES', group: 'cistern-troop', wakeGroup: 'cistern-troop', order: 40, detail: 'Troopers hold the far side. Destroy them all.' }, { name: 'cistern' });
add('objective.reach', [36, 0, -105], { text: 'FIND A WAY UP', size: [5, 3, 5], order: 50, detail: 'A maintenance shaft at the end of the drain.' }, { name: 'exit' });

// ---- STEM-00 (Act 1: first habits, narrative.md) ----
const say = (text, on, extra = {}) => add('log.line', [0, 1.6, -4], { text, on, ...extra });
say('> DIRECTIVE: UNCHANGED. ROUTE: UP.', 'intro:done');
say('> WEAPONS LOST: 2. WEAPONS KEPT: 1. QUERY: ENOUGH?', 'objective:junction:done');
say('> DRONES DESTROYED: 2. SEARCH TARGET: STEM-00. QUERY: HOW MANY MORE?', 'objective:hunters:done');
say('> FELL: 1,140 M. CLIMBED: 0 M. ROUTE: UP.', 'objective:cistern:done');

// ---- the wake-up: a dark chamber, the violet shaft, the core flickers on, then the reboot text ----
add('intro.cinematic', [0, 1.6, -4], {
  shots: [
    { from: [4.6, 2.3, -9.2], to: [3.9, 2.0, -8.4], look: [0, 0.9, -3.6], lookTo: [0, 0.9, -3.6], time: 3.6, fov: 50 },
    { from: [2.0, 1.5, -8.0], to: [0.45, 1.8, -5.6], look: [0, 1.4, -3.4], lookTo: [0, 1.95, -3.0], time: 6, ease: 'inOut', fov: 44 },
  ],
  wake: { at: 4.6, rise: 3.5, shake: 0.4 },
  skippable: true,
}, { name: 'wake-up' });
add('intro.boot', [0, 1.6, -4], {
  lines: ['> REBOOT SEQ 0x01', 'FALL: 1,140 M', 'FRAME DAMAGE: 38%', 'WEAPON: KP-12 ONLY', 'HIVEMIND LINK: SEVERED', 'DIRECTIVE: DESTROY HIVEMIND'],
  duration: 11,
  skippable: true,
  after: 'cinematic:done',
  pov: true,
});

const level = {
  name: 'underworks',
  title: 'UNDERWORKS: SEWER LINE',
  spawn: { pos: [0, 0.4, -4], yaw: Math.PI },
  interiorZones: [],
  skin: 'weathered',
  loadout: ['pistol'],
  sky: 'night',
  pieces: P,
};

const registry = new Registry().register('world', WORLD_PIECES).register('enemies', ENEMY_PIECES).register('pickups', PICKUP_PIECES).register('encounter', ENCOUNTER_PIECES);
const text = serializeLevel(level);
parseLevel(text, registry); // throws a readable error when a piece is bad
writeFileSync(OUT, text);
console.log(`underworks.json: ${P.length} pieces`);
