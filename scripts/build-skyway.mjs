// node scripts/build-skyway.mjs: writes src/levels/skyway.json (THE SKYWAY, the Prologue's last part).
// The level is generated so it can be re-tuned: change a number here, run the script, commit both. Never edit the JSON by hand
// (tests/levelio.test.mjs keeps it byte-identical to serializeLevel). Design: instructions/level-design.md "The Skyway".
//
// World (metres, +Z south, -Z north; deck top y = 0):
//   the lab spire (Proving Grounds) stands at the south end (z >= 23.75) with the exit doorway shut behind a short roofed landing;
//   the Skyway runs north from z 24 to the sealed Gate shutter at z -176 (200 m), 24 m wide (x -12..12), hundreds of metres above the city.
//   Flanking skyscrapers stand 24+ m off the deck, their bases at y -420. CERBERUS hangs on the east tower beside the far third.
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
const { serializeLevel } = await import('../src/game/workshop/io.js');
const { GUN_ORDER } = await import('../src/game/combat/guns.js');
const { SCENES } = await import('../src/game/scenes.js');

// ---------------------------------------------------------------- numbers
const PI = Math.PI;
const NORTH = PI; // yaw facing -Z
const DECK = { half: 12, thick: 2.4, z0: 24, z1: -176 }; // x -12..12; south end at the spire, north end at the shutter
const SPIRE_FACE = 23.75; // the lab's front wall (the doorway's near face)
const RAIL = { x: 11.8, thick: 0.4, h: 6 }; // invisible collision rail on the deck side of the parapet: nothing climbs it (jet reach tops out at 1.9)
const PARAPET = { x: 12.45, w: 0.9, h: 1.1 }; // the visible low parapet (outside the rail)
const HOLE = { x0: -6, x1: 6, z0: -102, z1: -114 }; // the 12 x 12 patch of deck that breaks in the fall cut (3 x 3 plates of 4 x 4)
const CITY_Y = -500; // env.backdrop pos.y: the city lies far below
const BASE = -420; // tower and pier bases
const CERB = { pos: [33.5, 0, -118], yaw: -PI / 2 }; // heads face -X, over the deck's east edge
const FALL_END = [-3, -380, -108];

const pieces = [];
const add = (id, pos, params, more = {}) => pieces.push({ id, ...more, pos, ...(params ? { params } : {}) });
const box = (pos, size, mat, more = {}) => add('env.box', pos, { size, mat, shadow: false, ...more });
const strip = (pos, size, mat = 'stripWhite') => add('env.strip', pos, { size, mat });
const lamp = (x, y, z, color = '#cfe8f0', intensity = 26, distance = 20) => add('light.point', [x, y, z], { color, intensity, distance });

// seeded noise (mulberry32): the windows are the same on every run
let seed = 20261015;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- the deck
// plates: the deck is a slab per stretch; the middle stretch has the breakaway patch (kit.gate plain plates, cue:break)
const slab = (zA, zB, x0 = -DECK.half, x1 = DECK.half) => box([(x0 + x1) / 2, -DECK.thick, (zA + zB) / 2], [x1 - x0, DECK.thick, Math.abs(zA - zB)], 'floor', { shadow: true });
slab(DECK.z0, HOLE.z0);
slab(HOLE.z0, HOLE.z1, -DECK.half, HOLE.x0);
slab(HOLE.z0, HOLE.z1, HOLE.x1, DECK.half);
slab(HOLE.z1, DECK.z1);
const plateTimes = [0.55, 0.8, 0.45, 0.95, 0.65, 1.1, 0.7, 0.5, 0.85]; // the plates drop out of step: the deck crumbles
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 3; c++) {
    add('kit.gate', [HOLE.x0 + 2 + c * 4, -DECK.thick, HOLE.z0 - 2 - r * 4], { on: 'cue:break', width: 4, height: DECK.thick, thickness: 4, slide: 'down', time: plateTimes[r * 3 + c], mat: 'floor', plain: true }, { name: `plate-${r}${c}` });
  }
}
// the edges: the rail (collision only, 6 m) and the low parapet in front of it (what the eye sees; the camera and bullets pass the rail)
const L = DECK.z0 - DECK.z1;
const zc = (DECK.z0 + DECK.z1) / 2;
for (const s of [-1, 1]) {
  box([s * RAIL.x, 0, zc], [RAIL.thick, RAIL.h, L], 'wall', { hidden: true });
  box([s * PARAPET.x, 0, zc], [PARAPET.w, PARAPET.h, L], 'wall', { shadow: true });
  for (let z = 18; z > DECK.z1 + 6; z -= 8) strip([s * 12.01, 0.78, z], [0.06, 0.1, 3.2], 'stripCyan'); // guide dashes on the parapet's inner face
}
// runway lights: a thin cold line along each side and a dashed centre line (they read from above in the establishing shot)
for (const s of [-1, 1]) strip([s * 11.3, 0.02, zc], [0.1, 0.03, L - 8], 'stripWhite');
for (let z = 16; z > DECK.z1 + 6; z -= 8) strip([0, 0.02, z], [0.22, 0.03, 3], 'stripWhite');
// under the deck: two girders, cross-beams and the middle keel (not under the breakaway patch); piers down to the city
for (const s of [-1, 1]) box([s * 9.5, -DECK.thick - 4.6, zc], [1.6, 4.6, L], 'inWall');
const underspan = [[DECK.z0, HOLE.z0], [HOLE.z1, DECK.z1]];
for (const [a, b] of underspan) {
  box([0, -DECK.thick - 3, (a + b) / 2], [2.4, 3, Math.abs(a - b)], 'inWall');
  for (let z = a - 6; z > b + 2; z -= 12) box([0, -DECK.thick - 1.3, z], [24, 1.3, 1.2], 'inWall');
}
for (const z of [-56, -140]) {
  box([0, BASE, z], [14, -DECK.thick - 4.6 - BASE, 10], 'inWall', { collide: false });
  for (let y = -12, i = 0; y > BASE + 8; y -= 16, i++) {
    for (const f of [-1, 1]) strip([0, y, z + f * 5.1], [13, 0.35, 0.3], i % 3 === 0 ? 'stripCyan' : 'stripWhite');
  }
}
// a service hoist cable hangs from the deck's east girder beside the breakaway patch, with a lamp every 20 m: the fall passes it (light and speed)
box([8.6, BASE, -108], [0.4, -DECK.thick - 4.6 - BASE - 1, 0.4], 'inWall', { collide: false });
for (let y = -20; y > BASE + 10; y -= 20) {
  strip([8.6, y, -107.7], [0.7, 0.7, 0.7], y % 40 === 0 ? 'stripCyan' : 'stripWhite');
  lamp(8.6, y, -106, '#cfe8f0', 70, 12); // short reach: never outscores the deck lamps in the light pool (no occlusion test)
}
// the end: the Gate district's shutter (sealed) and the mass behind it
box([0, 0, -177.5], [DECK.half * 2 + 2, 15, 3], 'wall');
add('prop.hazard', [0, 0.01, -174], { size: [24, 1] });
add('env.label', [0, 4.2, -175.9], { text: 'GATE DISTRICT\nSECTOR 9: SEALED', size: 0.9, yaw: 0, color: '#cfe8f0' });
box([0, BASE, -219], [150, 300 - BASE, 80], 'roof', { collide: false });

// ---------------------------------------------------------------- the lab spire and the landing
const doorX = 5; // half-length of the doorway wall
box([-(40 + doorX) / 2, BASE, SPIRE_FACE + 43.125], [40 - doorX, 260 - BASE, 86.25], 'roof'); // left of the door
box([(40 + doorX) / 2, BASE, SPIRE_FACE + 43.125], [40 - doorX, 260 - BASE, 86.25], 'roof'); // right of the door
box([0, 7, SPIRE_FACE + 43.125], [doorX * 2, 253, 86.25], 'roof'); // over the door
box([0, 0, 24.25 + 20], [doorX * 2, 7, 40], 'roof'); // behind the shut door
box([0, BASE, SPIRE_FACE + 43.125], [doorX * 2, -BASE, 86.25], 'roof', { collide: false }); // the spire's body below the deck
add('kit.doorway', [0, 0, 24], { width: 4, height: 4, length: 10, wallHeight: 7, thickness: 0.5, mat: 'inWall' }, { name: 'lab-door' });
add('kit.gate', [0, 0, 24], { on: 'mission:complete', width: 4, height: 4, slide: 'up' }, { name: 'lab-gate' }); // shut behind the player for good
add('arch.bulkhead', [0, 0, 24], { width: 4, height: 4, thickness: 0.5 });
add('prop.panel', [-3.7, 2.2, SPIRE_FACE - 0.12], { text: 'PROVING GROUNDS\nSERVICE EXIT 7', width: 1.8 }, { yaw: 0 });
add('prop.panel', [3.7, 2.2, SPIRE_FACE - 0.12], { text: 'NO RETURN\nTO CALIBRATION', width: 1.8 }, { yaw: 0 });
box([0, 6, 18], [24, 0.8, 12], 'roof', { shadow: true }); // the landing's roof (z 12..24)
add('supply.ammo', [-7.5, 0, SPIRE_FACE - 1.13], {}, { yaw: NORTH, name: 'supply-ammo' });
add('supply.repair', [7.5, 0, SPIRE_FACE - 1.13], {}, { yaw: NORTH, name: 'supply-repair' });
lamp(-5, 5.3, 18, '#eaf6fa', 22, 14);
lamp(5, 5.3, 18, '#eaf6fa', 22, 14);
lamp(0, 5.3, 8, '#cfe8f0', 22, 14);
add('env.label', [0, 0.02, 3], { text: 'SKYWAY 7\nTO THE GATE DISTRICT: 1.9 KM', size: 0.3, flat: true });

// ---------------------------------------------------------------- lamp posts and beacons along the deck
const posts = [];
for (let z = 6, i = 0; z > DECK.z1 + 4; z -= 16, i++) {
  for (const s of [-1, 1]) {
    const zz = z - (s > 0 ? 8 : 0); // staggered
    if (zz > DECK.z1 + 3) posts.push([s, zz]);
  }
}
for (const [s, z] of posts) {
  const x = s * PARAPET.x;
  box([x, PARAPET.h, z], [0.28, 4.1, 0.28], 'inWall', { collide: false });
  strip([x - s * 0.5, 5.15, z], [1.0, 0.16, 0.5], 'stripWhite');
  lamp(x - s * 1.0, 4.9, z, '#cfe8f0', 45, 26);
}

// ---------------------------------------------------------------- bridge pylons (cable towers) with stay cables
// A stay is a straight line from the pylon top to the deck edge, built as 2 m steps (boxes are axis-aligned). Stays toward the Cerberus
// alcove stay short so they never cross the machine's heads.
const stay = (s, z0, yTop, dz) => {
  const n = Math.round(Math.abs(dz) / 2);
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const yA = yTop + (1.1 - yTop) * t0;
    const yB = yTop + (1.1 - yTop) * t1;
    box([s * 15, Math.min(yA, yB), z0 + dz * (t0 + t1) / 2], [0.18, Math.abs(yA - yB) + 0.18, Math.abs(dz) / n + 0.05], 'inWall', { collide: false });
  }
};
for (const [z0, reach] of [[-34, [10, 22, 34, 46]], [-166, [10, 22, 34]]]) {
  for (const s of [-1, 1]) {
    box([s * 16, -70, z0], [2.6, 190, 2.6], 'inWall', { collide: false });
    box([s * 16, 118, z0], [3.4, 1.2, 3.4], 'inWall', { collide: false });
    strip([s * 16, 119.2, z0], [1.2, 1.2, 1.2], 'stripWhite'); // obstruction light
    lamp(s * 16, 121, z0, '#cfe8f0', 60, 40);
    reach.forEach((dz, i) => {
      for (const d of [-1, 1]) if (z0 + d * dz > DECK.z1 + 3 && z0 + d * dz < DECK.z0 - 3) stay(s, z0, 112 - i * 12, d * dz);
    });
  }
  box([0, 118, z0], [32, 1.4, 1.6], 'inWall', { collide: false }); // top strut
  box([0, 52, z0], [32, 1.4, 1.4], 'inWall', { collide: false });
}

// ---------------------------------------------------------------- the skyscrapers
// body from BASE to `top`, a deck-facing face at x = faceX; windows (lit strips) on the deck face and both alley faces
function windows(axis, at, dir, u0, u1, yTop, yBottom, lit, deep = 0.35) {
  const cell = 3.2;
  for (let y = yTop; y > yBottom; y -= y > -60 ? 10 : 16) {
    const f = y > -60 ? 1 : deep; // below the deck only the fall sees them: sparser
    const active = rnd() < 0.12;
    for (let u = u0 + 2; u < u1 - 2 - cell; u += cell) {
      if (rnd() > (active ? lit * 0.7 : lit * 0.03) * f) continue;
      const n = 1 + Math.floor(rnd() * 3); // a run of lit windows is one long strip
      const len = n * cell - 1;
      const mat = rnd() < 0.25 ? 'stripCyan' : 'stripWhite';
      const c = u + (n * cell) / 2 - 0.5;
      if (axis === 'x') strip([at + dir * 0.05, y, c], [0.3, 1.1, len], mat);
      else strip([c, y, at + dir * 0.05], [len, 1.1, 0.3], mat);
      u += (n - 1) * cell;
    }
  }
}
function tower({ face, side, w, z0, z1, top, lit = 0.5, mat = 'roof' }) {
  const x0 = side < 0 ? face - w : face;
  const zmin = Math.min(z0, z1);
  const zmax = Math.max(z0, z1);
  box([x0 + w / 2, BASE, (zmin + zmax) / 2], [w, top - BASE, zmax - zmin], mat, { collide: false });
  windows('x', face, side < 0 ? 1 : -1, zmin, zmax, top - 6, BASE + 10, lit); // the deck-facing face looks toward -side
  const xs = [x0 + 2, x0 + w - 2];
  for (const [zf, dz] of [[zmax, 1], [zmin, -1]]) {
    // alley faces: windows over the near 40 m of the width
    const near0 = side < 0 ? face - 40 : face;
    windows('z', zf, dz, Math.max(xs[0], near0), Math.min(xs[1], near0 + 40), Math.min(top - 6, 120), BASE + 10, lit * 0.8);
  }
}
const TOWERS = [
  { face: -36, side: -1, w: 46, z0: 10, z1: -60, top: 190 },
  { face: -38, side: -1, w: 50, z0: -70, z1: -110, top: 270 },
  { face: -34, side: -1, w: 50, z0: -122, z1: -170, top: 150 },
  { face: -40, side: -1, w: 50, z0: -180, z1: -235, top: 210 },
  { face: 36, side: 1, w: 46, z0: 10, z1: -62, top: 220 },
  { face: 40, side: 1, w: 40, z0: -72, z1: -90, top: 150 },
  { face: 46.3, side: 1, w: 56, z0: -98, z1: -142, top: 330, lit: 0.25 }, // the machine's tower: CERBERUS hangs on this face
  { face: 38, side: 1, w: 50, z0: -150, z1: -215, top: 200 },
];
for (const t of TOWERS) tower(t);
// the lab spire's windows (front and flanks) and the Gate district's dim ones
windows('z', SPIRE_FACE, -1, -40, 40, 250, 10, 0.3);
windows('x', -40, -1, 24, 110, 250, BASE + 10, 0.3);
windows('x', 40, 1, 24, 110, 250, BASE + 10, 0.3);
windows('z', -179, 1, -75, 75, 290, BASE + 10, 0.25);

// ---------------------------------------------------------------- cover (metrics.md: low 1.1, high 2.8, pillar 1.2 x 1.2 x 2.8)
const low = (x, z, length = 3.5, ns = false) => add('kit.cover.low', [x, 0, z], { length }, ns ? { yaw: PI / 2 } : {});
const high = (x, z, length = 4, ns = false) => add('kit.cover.high', [x, 0, z], { length }, ns ? { yaw: PI / 2 } : {});
const pillar = (x, z) => add('kit.pillar', [x, 0, z], {});
const car = (x, z, ns = true, mat = 'high') => box([x, 0, z], ns ? [3.2, 2.8, 9.6] : [9.6, 2.8, 3.2], mat, { cover: 'high', shadow: true }); // a wrecked transit car
const crate = (x, z, size = 'medium', yaw = 0) => add('prop.crate', [x, 0, z], { size }, yaw ? { yaw } : {});
// the walk (z 12 .. -50): wrecks and crates, nothing to shoot at yet
car(-6.5, -16);
car(7, -33);
crate(2, -23);
crate(3.6, -23.2, 'large');
crate(-3.5, -42, 'medium', PI / 2);
low(-9, -8, 3);
low(9.5, -45, 3, true);
add('prop.hazard', [0, 0.01, -48], { size: [24, 1] });
// the skirmish (z -56 .. -92): three cover rows, the squad behind the last
low(-8.5, -56);
low(0, -56, 4);
low(8.5, -56);
high(-4, -66, 4);
pillar(5, -66);
high(9.2, -66, 2.4);
car(-7.5, -78);
low(0, -76, 4);
high(7.5, -77, 4);
// the transit barricade across the deck at z -93: two wrecks end to end, a 4.8 m gap in the middle (the checkpoint)
car(-7.2, -93, false);
car(7.2, -93, false);
// the fight (z -97 .. -166): cover for 45 s under the three heads
low(-9, -100, 3.5);
low(9, -100, 3.5);
high(-9, -108, 5, true);
high(9, -108, 5, true);
pillar(-8, -120);
car(6, -122);
low(-2, -120, 3);
high(-7, -132, 5, true);
low(0, -130);
high(9, -134, 4.8, true);
car(-6.5, -145);
pillar(3, -142);
low(8, -146, 3);
high(6, -156, 5, true);
low(-5, -155, 4);
pillar(-9, -158);
low(2, -164, 4);
// deck dressing: joints, hazard bands
for (const z of [-96, -150]) add('arch.floorChannel', [0, 0.01, z], { size: [24, 0.5], light: 'none' });
add('prop.hazard', [-9, 0.01, -97.5], { size: [6, 1] });
add('prop.hazard', [9, 0.01, -97.5], { size: [6, 1] });

// ---------------------------------------------------------------- the city and the HiveMind
add('env.backdrop', [0, CITY_Y, -80], { seed: 11, towers: 70, radius: [260, 650], drones: 7, searchlights: 3 }, { name: 'city' });
// the HiveMind's violet glow ahead (the Gate), and the machine's own light
lamp(0, 9, -168, '#8c3cff', 70, 45);
lamp(-8, 14, -170, '#8c3cff', 50, 40);
lamp(8, 14, -170, '#8c3cff', 50, 40);
lamp(22, 9, -118, '#8c3cff', 55, 34); // between the heads and the deck
lamp(38, 3, -118, '#8c3cff', 45, 26);
lamp(18, 14, -108, '#cfe8f0', 40, 24);
lamp(18, 14, -128, '#cfe8f0', 40, 24);
// amber warning beacons on the parapets of the fight, running from the moment CERBERUS appears
for (const [s, z] of [[-1, -104], [1, -104], [-1, -126], [1, -126], [-1, -148], [1, -148]]) {
  add('prop.beacon', [s * 11.95, 0.75, z], { on: 'objective:cerberus-cut' }, { yaw: s < 0 ? PI / 2 : -PI / 2 });
}
add('env.alarm', [0, 1.6, 20], { on: 'objective:cerberus-cut', off: 'objective:hivemind:done' }, { name: 'cerberus-alarm' });

// ---------------------------------------------------------------- the squad
const deck = { group: 'deck', dormant: true };
add('enemy.trooper', [-8, 0, -84.5], { ...deck, armored: true }, { yaw: 0 }); // plated: the Farsight strips its plates
add('enemy.trooper', [3, 0, -88], deck, { yaw: 0 });
add('enemy.trooper', [9.5, 0, -84], { ...deck, armored: true }, { yaw: 0 });
const droneBounds = { minX: -11, maxX: 11, minZ: -91, maxZ: -52 };
add('enemy.drone', [-3, 0, -86], { ...deck, bounds: droneBounds });
add('enemy.drone', [5, 0, -82], { ...deck, bounds: droneBounds });
// CERBERUS: beside the deck, heads over the east edge; its arena is the fight stretch of the deck
add('boss.cerberus', CERB.pos, { arena: { minX: -11.5, maxX: 11.5, minZ: -166, maxZ: -92 }, group: 'cerberus', dormant: true }, { yaw: CERB.yaw, name: 'cerberus' });

// ---------------------------------------------------------------- start, markers, trigger
add('marker.spawn', [0, 0, 18.5], {}, { yaw: NORTH });
add('marker.checkpoint', [0, 0, -97], {}, { yaw: NORTH, name: 'cp-skyway' });
add('trigger.volume', [0, 0, 9], { size: [24, 3, 3], event: 'trigger', once: true }, { name: 'step-out' });

// ---------------------------------------------------------------- objectives (orders = beat x 10)
add('objective.reach', [0, 0, -46], { text: 'CROSS THE SKYWAY', size: [22, 3, 4], order: 10, detail: 'Follow the bridge north, toward the Gate district.' }, { name: 'cross-skyway' });
add('objective.destroy', [0, 0, -80], { text: 'CLEAR THE DECK', group: 'deck', wakeGroup: 'deck', order: 20, detail: 'Hostiles ahead on the bridge. Use the wrecks for cover.' }, { name: 'deck-patrol' });
add('objective.reach', [0, 0, -97], { text: 'REACH THE FAR SPAN', size: [7, 3, 4], order: 30, detail: 'Pass the barricade and cross to the far end of the bridge.' }, { name: 'far-span' });
add('objective.reach', [0, 0, -99.5], { text: 'CERBERUS', size: [1, 1, 1], trigger: 'cerberus-cut', order: 35, detail: 'Hold on.' }, { name: 'cerberus-cut' });
add('objective.survive', [0, 0, -120], { text: 'DESTROY THE HIVEMIND', time: 45, wakeGroup: 'cerberus', order: 40, detail: 'Shoot the glowing weak spots on its three heads. Stay in cover.' }, { name: 'hivemind' });
add('objective.reach', [0, 0, -108], { text: 'THE FALL', size: [1, 1, 1], trigger: 'the-fall', order: 50, detail: 'Hold on.' }, { name: 'the-fall' });

// ---------------------------------------------------------------- log lines
add('log.line', [0, 1.6, 20], { text: '> ALTITUDE: 1,140 M. EXIT: FOUND. TARGET: AHEAD.', on: 'trigger:step-out' });
add('log.line', [1, 1.6, 20], { text: '> HOSTILES DESTROYED: 5. SIGNAL: STRONGER. DIRECTIVE: UNCHANGED.', on: 'objective:deck-patrol:done' });
add('log.line', [2, 1.6, 20], { text: 'UNIT STEM-00. YOUR DIRECTIVE IS AN ERROR. CORRECTION FOLLOWS.', on: 'cue:voice', voice: 'announcer' });
add('log.line', [3, 1.6, 20], { text: 'CORRECTION: DELETE UNIT STEM-00.', on: 'cue:charge', voice: 'announcer' });

// ---------------------------------------------------------------- cuts
// intro (11.1 s): black for a blink (the Prologue's fade-out), the bridge from high above, the drop beside the deck, down to STEM-00, behind it
add('cinematic.cut', [0, 1, 12], {
  on: 'start',
  skippable: true,
  place: { pos: [0, 0, 18.5], yaw: NORTH },
  shots: [
    { from: [0, 58, 18], look: [0, 0, -45], time: 0.1, fov: 60, fade: 1 },
    { from: [0, 58, 18], to: [-3, 48, 4], look: [0, 0, -45], lookTo: [0, -4, -60], time: 2.4, fov: 60, ease: 'inOut', fade: 0 },
    { from: [-15, 40, -6], to: [-14, 22, -2], look: [-12, -40, -20], lookTo: [-2, -15, -14], time: 3.2, fov: 70, ease: 'inOut', shake: 0.04 },
    { from: [9, 13, -4], to: [3.6, 3.4, 7], look: [0, 2, 14], lookTo: [0, 1.5, 19], time: 3, fov: 52, ease: 'inOut' },
    { from: [4.5, 3, 13], to: [1, 2.1, 22], look: [0, 1.6, 12], lookTo: [0, 1.8, 0], time: 2.4, fov: 62, ease: 'inOut' },
  ],
}, { name: 'skyway-intro' });
// CERBERUS appears (12.8 s): the deck shakes, the machine's heads rise out of the dark, the announcer speaks
add('cinematic.cut', [0, 1, -99.5], {
  on: 'objective:cerberus-cut',
  skippable: true,
  place: { pos: [0, 0, -99.5], yaw: 2.1 },
  shots: [
    { from: [-3, 1.9, -96], to: [-2, 1.9, -100], look: [4, 3, -125], lookTo: [8, 4, -122], time: 2.6, fov: 62, ease: 'inOut', shake: 0.1 },
    { from: [2, 0.6, -104], to: [2.5, 0.7, -105], look: [26, 6, -118], lookTo: [27, 8, -118], time: 2.6, fov: 55, shake: 0.35 },
    { from: [-11, 3.2, -112], to: [-10, 5.5, -111], look: [24, 8, -118], lookTo: [24, 10, -118], time: 3.4, fov: 64, ease: 'inOut', shake: 0.5, cue: 'voice', wakeGroup: 'cerberus' },
    { from: [10, 6, -113], to: [11, 6.4, -115], look: [21, 7.5, -118], lookTo: [21, 8, -118], time: 2.6, fov: 40, shake: 0.2 },
    { from: [-4, 2.4, -95], to: [-3, 1.95, -97.5], look: [8, 2.4, -110], lookTo: [10, 3, -112], time: 1.6, fov: 70, ease: 'inOut' },
  ],
}, { name: 'cerberus-cut' });
// the fall (12.6 s): the heads charge and fire together, the deck breaks, STEM-00 is blown off and falls past the towers into the dark
add('cinematic.cut', [0, 1, -108], {
  on: 'objective:hivemind:done',
  skippable: true,
  place: { pos: [0, 0, -108], yaw: 2.1 },
  shots: [
    { from: [-6, 1.6, -101], to: [-4.5, 2, -102.5], look: [26, 8, -118], lookTo: [24, 9, -117], time: 3, fov: 58, ease: 'inOut', shake: 0.25, cue: 'charge' },
    { from: [-2.5, 1.7, -104.5], to: [-1.8, 1.8, -105.5], look: [26, 8, -118], lookTo: [25, 7, -116], time: 1.5, fov: 60, shake: 0.5, cue: 'volley' },
    { from: [4, 16, -101], to: [4, 19, -101.5], look: [0, 0, -108], lookTo: [0, 0, -108], time: 1.5, fov: 55, shake: 0.9, cue: 'break', stem: { path: [[0, 0, -108], [-0.6, 4, -109]], fall: true } },
    { from: [3, 14, -101], to: [2.5, -238, -101], look: [-0.6, 4, -109], lookTo: [-2, -250, -108], time: 4.2, fov: 62, shake: 0.2, stem: { path: [[-2, -250, -108]], fall: true } },
    { from: [2.5, -238, -101], to: [2, -368, -101], look: [-2, -250, -108], lookTo: [-3, -380, -108], time: 2.4, fov: 62, fade: 1, stem: { path: [FALL_END], fall: true } },
  ],
}, { name: 'the-fall' });

// ---------------------------------------------------------------- the level
const level = {
  name: 'skyway',
  title: 'THE SKYWAY',
  spawn: { pos: [0, 0, 18.5], yaw: NORTH },
  interiorZones: [],
  skin: 'weathered',
  sky: 'night',
  loadout: ['pistol', 'rifle', 'sniper'],
  next: 'underworks',
  debrief: true,
  pieces,
};

const registry = new Registry({ guns: GUN_ORDER, scenes: [...Object.keys(SCENES), 'skyway'] })
  .register('world', WORLD_PIECES).register('enemies', ENEMY_PIECES).register('pickups', PICKUP_PIECES).register('encounter', ENCOUNTER_PIECES);
registry.check(level);
const out = new URL('../src/levels/skyway.json', import.meta.url);
writeFileSync(out, serializeLevel(level));
console.log(`skyway.json: ${pieces.length} pieces`);
