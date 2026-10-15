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

// ---------------------------------------------------------------- the boss arena: open sky, 8 m walls, faces x 24.3 (24.6 north of z -30) / 50, z -62 / -13.7
const H = 6; // panelling up to 6 m (the wall lamps sit at 6.6)
wallZ(24.3, -61.7, -54.5, 'px', H);
wallZ(24.3, -49.5, -30.3, 'px', H);
wallZ(24.6, -29.7, -14.0, 'px', H);
wallX(-62, 32.8, 49.7, 'pz', H); // east of the exit door (x 28..32)
wallZ(50, -61.7, -37.85, 'nx', H);
wallZ(50, -37.85, -14.0, 'nx', H);
wallX(-13.7, 24.9, 36.0, 'nz', H); // west of the far door (x 37..42.5)
wallX(-13.7, 43.5, 49.7, 'nz', H);
add('arch.cove', [24.6, 0, -13.7], { length: 6, size: 0.6, corner: 'wall', light: 'none' }, ROOM.px); // north-west corner chamfer (room toward +X / -Z)
add('arch.cove', [50, 0, -62], { length: 6, size: 0.6, corner: 'wall', light: 'none' }, ROOM.nx); // south-east corner
add('arch.catwalk', [50, 0, -38], { length: 14, width: 1.2, height: 5.2 }, ROOM.nx);
add('prop.pipes', [50, 7.2, -50], { length: 20, count: 3, mount: 'wall', valves: 2 }, ROOM.nx);
add('prop.pipes', [41, 7.2, -62], { length: 16, count: 2, mount: 'wall', valves: 1 }, ROOM.pz);
add('prop.pipes', [30.5, 7.2, -13.7], { length: 10, count: 2, mount: 'wall', valves: 1 }, ROOM.nz);
// the floor: lit channels framing the middle lane the SX-6 lands in, hatches, cable runs
add('arch.floorChannel', [37.25, 0, -45.5], { size: [16, 0.5], light: 'cyan' });
add('arch.floorChannel', [31, 0, -32], { size: [0.5, 12], light: 'cyan' });
add('arch.floorChannel', [44, 0, -32], { size: [0.5, 12], light: 'cyan' });
add('arch.floorChannel', [31, 0, -56], { size: [1.2, 1.2], light: 'none' });
add('arch.floorChannel', [45, 0, -20], { size: [1.2, 1.2], light: 'none' });
add('prop.hazard', [37.25, 0.01, -43.5], { size: [10, 0.6] });
add('prop.hazard', [37.25, 0.01, -47.5], { size: [10, 0.6] });
add('prop.cables', [49.5, 0, -56], { to: [-5, 0, 3], count: 4 });
add('prop.cables', [25, 0, -36], { to: [3.5, 0, -4], count: 3 });
add('prop.panel', [24.3 + 0.06, 3.2, -42], { text: 'SX-6 PROVING FLOOR\nKEEP CLEAR', width: 1.8 }, ROOM.px);
add('prop.panel', [50 - 0.06, 3.2, -24], { text: 'LOAD LIMIT 40 T', width: 1.4 }, ROOM.nx);

writeFileSync(file, serializeLevel(level));
console.log(`prologue.json: ${n} dressing pieces`);
