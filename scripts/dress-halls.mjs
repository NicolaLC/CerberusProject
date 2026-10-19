// Dresses the Prologue's hall A, hall B and the boss arena (src/levels/prologue.json): interior-kit walls, hanging ceilings, lit coves,
// floor channels, pipes, cables, signs, catwalks. Dressing only: nothing here collides (cover, colliders and metrics unchanged).
// Re-runnable: drops the pieces named `dress-*` first, then appends them again. Run: `node scripts/dress-halls.mjs`.
import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';

registerHooks({
  resolve: (spec, ctx, next) => {
    const res = next(spec, ctx);
    return res.url.endsWith('.json') ? { ...res, importAttributes: { type: 'json' } } : res;
  },
});
const { serializeLevel } = await import('../src/game/workshop/io.js');

const file = new URL('../src/levels/prologue.json', import.meta.url);
const level = JSON.parse(readFileSync(file, 'utf8'));
level.pieces = level.pieces.filter((p) => !p.name?.startsWith('dress-'));

// yaw: the side the room is on (arch pieces face +Z at yaw 0)
const ROOM = { pz: 0, nz: 3.1416, px: 1.5708, nx: 4.7124 };
let n = 0;
const add = (id, pos, params, yaw = 0) => level.pieces.push({ id, name: `dress-${++n}`, pos, ...(yaw ? { yaw } : {}), params });
// a slim kit wall from a to b along the face (x for z-facing walls, z for x-facing ones)
const wallX = (z, x0, x1, room, height = 4.4, seed = n) => add('arch.wall', [(x0 + x1) / 2, 0, z], { length: +(x1 - x0).toFixed(2), height, slim: true, seed }, ROOM[room]);
const wallZ = (x, z0, z1, room, height = 4.4, seed = n) => add('arch.wall', [x, 0, (z0 + z1) / 2], { length: +(z1 - z0).toFixed(2), height, slim: true, seed }, ROOM[room]);

// ---------------------------------------------------------------- the building: faces x -23.7 / 7.75 | 8.25 / 23.7, z -62 / -30.3, ceiling 7
const N = -30.3;
const S = -62;
// hall A (x -23.7..7.75): west door in the north wall x -14..-10, the opening to hall B in the divider z -42..-38
wallX(N, -23.4, -14.4, 'nz');
wallX(N, -9.6, 7.45, 'nz');
wallX(S, -23.4, 7.45, 'pz');
wallZ(-23.7, -61.7, -30.6, 'px'); // the armoury rack stands in front of it (slim: <= 0.12 off the wall)
wallZ(7.75, -61.7, -42.4, 'nx');
wallZ(7.75, -37.6, -30.6, 'nx');
// the roof has a skylight over x -10..-2, z -50..-42: two hanging ceilings either side of it
add('arch.ceiling', [-16.85, 7, -46.15], { size: [13.7, 31.4], pipes: 2, seed: 61 });
add('arch.ceiling', [2.875, 7, -46.15], { size: [9.75, 31.4], pipes: 1, seed: 62 });
add('arch.cove', [-7.975, 7, N], { length: 31, corner: 'ceiling', light: 'cyan' }, ROOM.nz);
add('arch.cove', [-7.975, 7, S], { length: 31, corner: 'ceiling', light: 'cyan' }, ROOM.pz);
add('arch.cove', [-23.7, 0, S], { length: 7, size: 0.6, corner: 'wall', light: 'none' }); // south-west corner chamfer
add('arch.floorChannel', [-12, 0, -37], { size: [0.5, 8], light: 'cyan' }); // from the west door in
add('arch.floorChannel', [2, 0, -40], { size: [8.5, 0.5], light: 'cyan' }); // to the opening into hall B
add('arch.floorChannel', [-6, 0, -46], { size: [1.2, 1.2], light: 'none' }); // a hatch under the skylight
add('arch.floorChannel', [-19, 0, -54], { size: [1.2, 1.2], light: 'none' });
// (the south wall holds the solid mezzanine, hall-mezzanine: deck at 3.6, so the pipes and the sign go above head height on it)
add('prop.pipes', [-17, 6.2, S], { length: 9, count: 3, mount: 'wall', valves: 2 }, ROOM.pz);
add('prop.pipes', [-23.7, 5.9, -46], { length: 10, count: 2, mount: 'wall', valves: 1 }, ROOM.px);
add('prop.cables', [-23.2, 0, -44], { to: [3, 0, -6], count: 3 });
add('prop.cables', [7.2, 0, -56], { to: [-4, 0, 2.5], count: 2 });
add('prop.panel', [-8.4, 5.9, S + 0.06], { text: 'ASSEMBLY HALL A\nLINE 2', width: 1.8 }, ROOM.pz);
add('prop.panel', [7.75 - 0.06, 2.75, -44], { text: 'HALL B\nMAINTENANCE', width: 1.4 }, ROOM.nx);

// hall B (x 8.25..23.7): the arena door in the east wall z -54..-50, the heavy supply against it at z -59
wallX(N, 8.55, 23.4, 'nz');
wallX(S, 8.55, 23.4, 'pz');
wallZ(8.25, -61.7, -42.4, 'px');
wallZ(8.25, -37.6, -30.6, 'px');
wallZ(23.7, -61.7, -54.5, 'nx');
wallZ(23.7, -49.5, -30.6, 'nx');
add('arch.ceiling', [15.975, 7, -46.15], { size: [15.45, 31.4], pipes: 2, seed: 63 });
add('arch.cove', [15.975, 7, N], { length: 15.45, corner: 'ceiling', light: 'white' }, ROOM.nz);
add('arch.cove', [15.975, 7, S], { length: 15.45, corner: 'ceiling', light: 'white' }, ROOM.pz);
add('arch.floorChannel', [11, 0, -46], { size: [0.5, 10], light: 'cyan' });
add('arch.floorChannel', [16, 0, -60], { size: [1.2, 1.2], light: 'none' });
add('prop.pipes', [16, 5.4, N], { length: 12, count: 2, mount: 'wall', valves: 1 }, ROOM.nz);
add('prop.pipes', [23.7, 5.9, -40], { length: 14, count: 3, mount: 'wall', valves: 2 }, ROOM.nx);
add('prop.cables', [23.2, 0, -48.6], { to: [-3, 0, 4], count: 3 });
add('prop.panel', [23.7 - 0.06, 2.75, -47.6], { text: 'TEST ARENA 2\nLIVE FIRE', width: 1.4 }, ROOM.nx);

// ---------------------------------------------------------------- the boss arena: a round SX-6 proving floor, open sky, 8 m walls
// The ring: inner radius 24 about (48.5, -38.25), four `kit.arcWall`s (prologue.json `arena-arc-*`) with two openings: the south door's passage
// (104.5..118.6 deg) and the NW alcove (205.5..226.6 deg) that both fixed doors (hall B's arena-door, the exit-door) open into.
// Cover (nothing here collides): four 3.2 m walls at 10.5 m and four low blocks at 17 m on the axes, four low pillars at 16 m on the diagonals.
const H = 6; // panelling up to 6 m (the wall lamps sit at 6.6)
const C = [48.5, -38.25];
const RAD = 24;
const rad = (d) => (d * Math.PI) / 180;
// a point on the ring at radius r (convention: a -> (cx + r cos a, cz + r sin a)) with the yaw that turns +Z toward the centre
const onArc = (r, deg, c = C) => {
  const a = rad(deg);
  return { pos: [+(c[0] + r * Math.cos(a)).toFixed(3), +(c[1] + r * Math.sin(a)).toFixed(3)], yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) };
};
// the alcove (x 24.3..32, z -62..-48.6): hall B's wall on the west, the exit door in the north wall, a short wall each side to the ring
wallZ(24.3, -61.7, -54.5, 'px', H);
wallX(-62, 24.6, 27.6, 'pz', H);
wallZ(32, -61.8, -55.8, 'nx', H);
wallX(-48.6, 24.6, 26.8, 'nz', H);
add('arch.catwalk', [24.3, 0, -58.1], { length: 7, width: 1.2, height: 5.2 }, ROOM.px);
add('arch.catwalk', [32, 0, -58.9], { length: 6, width: 1.2, height: 5.4 }, ROOM.nx);
add('prop.pipes', [24.3, 7.2, -58.1], { length: 7, count: 2, mount: 'wall', valves: 1 }, ROOM.px);
add('prop.pipes', [32, 7.2, -58.9], { length: 6, count: 2, mount: 'wall', valves: 1 }, ROOM.nx);
add('prop.panel', [32 - 0.06, 3.2, -59.5], { text: 'SX-6 PROVING FLOOR\nKEEP CLEAR', width: 1.8 }, ROOM.nx);
add('prop.panel', [25.8, 3.4, -48.6 - 0.06], { text: 'IMPACT\nPLATE', width: 1.2 }, ROOM.nz);
add('prop.cables', [32, 7.6, -57], { to: [0, -7.6, -0.3], count: 3 });
add('prop.cables', [24.5, 7.6, -60.4], { to: [0.3, -7.6, 0], count: 2 });
add('arch.floorChannel', [30, 0, -55.5], { size: [0.5, 13], light: 'cyan' }); // a lit lane from the exit door out onto the floor
add('arch.floorChannel', [27, 0, -58.5], { size: [1.2, 1.2], light: 'none' });
add('prop.hazard', [27, 0.01, -50.6], { size: [0.5, 4] }, ROOM.px); // across the arena door's mouth (the door sits at z -54..-50)
// the ring: pipe runs in two rows and cable drops (arch.wall takes only quarter turns: the arcs keep their own wall mesh, no panelling)
for (const [a0, a1] of [[5, 99], [124, 200], [232, 355]]) {
  const step = 10;
  const chord = +(2 * RAD * Math.sin(rad(step / 2)) + 0.05).toFixed(2);
  for (let a = a0; a < a1; a += step) {
    const { pos, yaw } = onArc(RAD, a + step / 2);
    add('prop.pipes', [pos[0], 6.8, pos[1]], { length: chord, count: 2, mount: 'wall', valves: 0 }, yaw);
    add('prop.pipes', [pos[0], 4.3, pos[1]], { length: chord, count: 1, mount: 'wall', valves: 0 }, yaw);
    if ((a - a0) % 30 === 0) add('prop.cables', [pos[0], 7.6, pos[1]], { to: [+(0.3 * Math.sin(yaw)).toFixed(2), -7.6, +(0.3 * Math.cos(yaw)).toFixed(2)], count: 2 }); // trunks dropping down the ring
  }
}
// sensor masts watching the floor high on the ring, impact plates lower down, at matching angles round the four quadrants
for (const a of [30, 75, 150, 300, 345]) {
  const m = onArc(RAD, a);
  add('prop.panel', [m.pos[0], 5.2, m.pos[1]], { text: 'SENSOR\nMAST', width: 0.9 }, m.yaw);
  const q = onArc(RAD, a + 8);
  add('prop.panel', [q.pos[0], 2.2, q.pos[1]], { text: 'IMPACT\nPLATE', width: 1.2 }, q.yaw);
}
{
  const s = onArc(RAD, 60);
  add('prop.panel', [s.pos[0], 3.2, s.pos[1]], { text: 'LOAD LIMIT 40 T', width: 1.4 }, s.yaw);
  const w = onArc(RAD, 172);
  add('prop.panel', [w.pos[0], 3.2, w.pos[1]], { text: 'ARM PARK\nLOCKOUT', width: 1.2 }, w.yaw);
  const t = onArc(RAD, 195);
  add('prop.panel', [t.pos[0], 1.6, t.pos[1]], { text: 'LOAD ANCHOR\nTEST ROW', width: 1.2 }, t.yaw);
}
add('prop.arm', [25.6, 0, -35.5], { mount: 4.85 }, 0); // an arm parked on the west of the ring
// the floor: two lit rings about the centre, four lit lanes between the inner walls, a landing pad on each diagonal (the SX-6 lands on the south-west one), hatches
add('arch.floorRing', [C[0], 0, C[1]], { radius: 13.5, width: 0.3, light: 'cyan' });
add('arch.floorRing', [C[0], 0, C[1]], { radius: 2.2, width: 0.25, light: 'cyan' });
for (const s of [-1, 1]) {
  add('arch.floorChannel', [C[0] + s * 5.5, 0, C[1]], { size: [6.8, 0.5], light: 'cyan' });
  add('arch.floorChannel', [C[0], 0, C[1] + s * 5.5], { size: [0.5, 6.8], light: 'cyan' });
  add('prop.hazard', [C[0] + s * 9.2, 0.01, C[1]], { size: [0.5, 5] }, ROOM.px);
  add('prop.hazard', [C[0], 0.01, C[1] + s * 9.2], { size: [5, 0.5] });
}
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const x = +(C[0] + sx * 5.657).toFixed(2);
  const z = +(C[1] + sz * 5.657).toFixed(2);
  add('arch.floorRing', [x, 0, z], { radius: 4.2, width: 0.25, light: 'cyan' });
  add('arch.floorChannel', [x, 0, z], { size: [1.2, 1.2], light: 'none' });
}
// load-test anchors: tie-down rings flat in the floor at 20 m, every 45 deg offset 22.5
for (let a = 22.5; a < 360; a += 45) {
  const { pos } = onArc(20, a);
  add('arch.floorRing', [pos[0], 0, pos[1]], { radius: 0.45, width: 0.18, light: 'none' });
  add('arch.floorChannel', [pos[0], 0, pos[1]], { size: [0.3, 0.3], light: 'none' });
}
// cable runs along the floor at the wall feet, mirrored
for (const a of [60, 300]) {
  const { pos } = onArc(23.4, a);
  add('prop.cables', [pos[0], 0, pos[1]], { to: [+(-3.5 * Math.cos(rad(a + 40))).toFixed(2), 0, +(-3.5 * Math.sin(rad(a + 40))).toFixed(2)], count: 3 });
}

writeFileSync(file, serializeLevel(level));
console.log(`prologue.json: ${n} dressing pieces`);
