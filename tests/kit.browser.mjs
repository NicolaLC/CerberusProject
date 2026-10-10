// Environment kit (kit.* pieces, #69): every id spawns with its Library example and with edge params, the colliders
// match metrics.md (cover class by height, sizes), stairs / ramp / platform are climbed with the real movement code,
// a doorway is walked through, bad params and bad yaw throw, and the KIT station of the Gym loads.
// Pure simulation (engine stopped, headless). Needs the dev server:
// `npm run dev`, then `URL='http://localhost:5173/?debug' node tests/kit.browser.mjs`.
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const PAGE = (() => { const u = new URL(BASE); u.searchParams.set('scene', 'gym'); return u.href; })();
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 160, height: 90 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(PAGE);
await p.waitForFunction(() => window.game?.engine && window.game.level);

const r = await p.evaluate(() => {
  const g = window.game;
  const { engine, player, camRig, world, registry } = g;
  engine.stop();
  engine.headless = true;
  const keys = engine.input.keys;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const res = [];
  const ok = (name, pass, extra = '') => res.push({ name, pass: !!pass, extra: pass ? '' : String(extra) });
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  const ids = registry.ids().filter((i) => i.startsWith('kit.'));
  const EXPECT = ['kit.floor', 'kit.wall', 'kit.doorway', 'kit.stairs', 'kit.ramp', 'kit.cover.low', 'kit.cover.high', 'kit.pillar', 'kit.platform'];
  ok('all nine kit ids registered', EXPECT.every((i) => ids.includes(i)) && ids.length === EXPECT.length, ids.join());

  // Builds a piece at a free spot of the KIT floor, returns its new colliders (boxes) and meshes.
  const OX = 50;
  const OZ = 60;
  const spawn = (id, params, yaw = 0, pos = [OX, 0, OZ]) => {
    const n0 = world.colliders.length;
    const m0 = world.staticMeshes.length;
    registry.build('world', world, { id, pos, yaw, params });
    return { cols: world.colliders.slice(n0).map((c) => c.box), meshes: world.staticMeshes.slice(m0), covers: world.colliders.slice(n0) };
  };
  const bounds = (boxes) => {
    const u = boxes[0].clone();
    for (const x of boxes) u.union(x);
    return u;
  };
  const sz = (box) => [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  const throws = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

  // ---------- meta: every kit / env / light entry carries example + label ----------
  for (const id of registry.ids().filter((i) => /^(kit|env|light)\./.test(i))) {
    const m = registry.meta(id);
    ok(`${id} meta`, m.example && typeof m.example.params === 'object' && typeof m.label === 'string' && m.label.length > 0, JSON.stringify(m));
  }

  // ---------- every kit id: example, all four yaws, edge params ----------
  const EDGE = {
    'kit.floor': [{ size: [0.5, 0.5], thickness: 0.05 }, { size: [20, 12], flush: true }],
    'kit.wall': [{ length: 0.5, height: 2 }, { length: 30, height: 9, thickness: 1 }],
    'kit.doorway': [{ width: 0.1, height: 0.1 }, { width: 6, height: 5, wallHeight: 8, length: 12 }],
    'kit.stairs': [{ height: 0.3 }, { rise: 0.45, height: 3 }, { width: 1, run: 0.6 }],
    'kit.ramp': [{ rise: 0.25, height: 2 }, { rise: 0.05, length: 12 }],
    'kit.cover.low': [{ length: 1.6 }, { length: 12 }],
    'kit.cover.high': [{ length: 1.2 }, { length: 12 }],
    'kit.pillar': [{}],
    'kit.platform': [{ size: [4, 4], height: 0.5 }, { size: [12, 6], height: 1.9, stairs: 'e', parapets: ['n', 'w'], stairsWidth: 2 }, { stairs: 'n', parapets: true }, { stairs: 'w' }],
  };
  for (const id of EXPECT) {
    const ex = registry.meta(id).example;
    for (const yaw of [ex.yaw ?? 0, Math.PI / 2, Math.PI, -Math.PI / 2, 3 * Math.PI / 2]) {
      const e = throws(() => { const s = spawn(id, ex.params, yaw); if (!s.cols.length) throw new Error('no colliders'); });
      ok(`${id} example yaw ${yaw.toFixed(2)}`, e === null, e);
    }
    for (const params of EDGE[id]) {
      const e = throws(() => spawn(id, params));
      ok(`${id} edge ${JSON.stringify(params)}`, e === null, e);
    }
    const mat = throws(() => spawn(id, { ...ex.params, mat: 'inFloor' }));
    ok(`${id} mat override`, mat === null, mat);
    const bad = throws(() => spawn(id, { ...ex.params, mat: 'nope' }));
    ok(`${id} unknown mat throws`, bad && /material/.test(bad), bad);
  }

  // ---------- sizes against metrics ----------
  {
    const s = spawn('kit.cover.low', { length: 3 });
    const [w, h, d] = sz(s.cols[0]);
    ok('low cover 3.0 x 1.1 x 1.0', near(w, 3) && near(h, 1.1) && near(d, 1) && s.covers[0].cover === 'low', [w, h, d]);
    const y = spawn('kit.cover.low', { length: 3 }, Math.PI / 2);
    const [yw, , yd] = sz(y.cols[0]);
    ok('low cover yaw 90 swaps the footprint', near(yw, 1) && near(yd, 3), [yw, yd]);
    const hgh = spawn('kit.cover.high');
    const [hw, hh, hd] = sz(hgh.cols[0]);
    ok('high cover 2.4 x 2.8 x 0.6', near(hw, 2.4) && near(hh, 2.8) && near(hd, 0.6) && hgh.covers[0].cover === 'high', [hw, hh, hd]);
    const pil = spawn('kit.pillar');
    const [pw, ph, pd] = sz(pil.cols[0]);
    ok('pillar 1.2 x 2.8 x 1.2 high cover', near(pw, 1.2) && near(ph, 2.8) && near(pd, 1.2) && pil.covers[0].cover === 'high', [pw, ph, pd]);
    // class by height as the player code reads it: < 1.7 low, else high
    ok('cover class by height', s.cols[0].max.y < 1.7 && hgh.cols[0].max.y >= 1.7 && pil.cols[0].max.y >= 1.7);
    const w1 = spawn('kit.wall');
    const [ww, wh, wd] = sz(w1.cols[0]);
    ok('wall 4 x 7 x 0.5 cover wall', near(ww, 4) && near(wh, 7) && near(wd, 0.5) && w1.covers[0].cover === 'wall', [ww, wh, wd]);
    const f = spawn('kit.floor');
    const [fw, fh, fd] = sz(f.cols[0]);
    ok('floor 4 x 0.2 x 4, top 0.2', near(fw, 4) && near(fh, 0.2) && near(fd, 4) && near(f.cols[0].max.y, 0.2), [fw, fh, fd]);
    const fl = spawn('kit.floor', { flush: true });
    ok('flush floor top at pos.y', near(fl.cols[0].max.y, 0) && near(fl.cols[0].min.y, -0.2));
    const dw = spawn('kit.doorway');
    const jambs = dw.covers.filter((c) => c.cover === 'wall');
    ok('doorway: opening 4 x 4, two jambs, lintel', dw.cols.length === 3 && jambs.length === 2 && near(bounds(dw.cols).max.y, 7) && near(sz(bounds(dw.cols))[0], 10), dw.cols.length);
    const lintel = dw.cols.find((b) => b.min.y > 0);
    ok('doorway lintel bottom at 4', lintel && near(lintel.min.y, 4) && near(sz(lintel)[0], 4));
    const dc = spawn('kit.doorway', { width: 0.5, height: 0.5 });
    const lc = dc.cols.find((b) => b.min.y > 0);
    ok('doorway clamps to 2.0 wide, 1.8 high', lc && near(sz(lc)[0], 2.0) && near(lc.min.y, 1.8), lc && [sz(lc)[0], lc.min.y]);
    const st = spawn('kit.stairs', { width: 4, height: 1.6 });
    ok('stairs: 4 steps, rise 0.4, run 1.0', st.cols.length === 4 && near(sz(bounds(st.cols))[2], 4) && near(bounds(st.cols).max.y, 1.6), st.cols.length);
    const heights = st.cols.map((b) => +b.max.y.toFixed(3)).sort((a, b) => a - b);
    ok('stair heights 0.4 0.8 1.2 1.6', heights.join() === '0.4,0.8,1.2,1.6', heights.join());
    const rp = spawn('kit.ramp');
    const rh = rp.cols.map((b) => b.max.y).sort((a, b) => a - b);
    const maxRise = Math.max(...rh.map((v, i) => v - (rh[i - 1] ?? 0)));
    ok('ramp: fine steps, 8 long, 1.6 high', maxRise <= 0.1 + 1e-6 && near(sz(bounds(rp.cols))[2], 8) && near(bounds(rp.cols).max.y, 1.6), maxRise);
    const pf = spawn('kit.platform', { size: [8, 8], height: 1.6, stairs: 's', parapets: true });
    const deck = pf.cols.find((b) => near(sz(b)[0], 8) && near(sz(b)[1], 1.6) && near(sz(b)[2], 8));
    const par = pf.covers.filter((c) => c.cover === 'low');
    ok('platform: deck 8 x 1.6 x 8, low parapets 1.1 high', deck && par.length === 5 && par.every((c) => near(sz(c.box)[1], 1.1) && near(c.box.min.y, 1.6)), par.length);
    ok('platform stairs outside the deck, 4 steps', pf.cols.length === 1 + 5 + 4 && near(bounds(pf.cols).max.z - (OZ + 4), 4), pf.cols.length);
  }

  // ---------- invalid input ----------
  const bads = [
    ['stairs rise 0.5', 'kit.stairs', { rise: 0.5 }, /rise/],
    ['stairs rise 0.46', 'kit.stairs', { rise: 0.46 }, /rise/],
    ['ramp rise 0.3', 'kit.ramp', { rise: 0.3 }, /rise/],
    ['platform stairs x', 'kit.platform', { stairs: 'x' }, /stairs/],
    ['platform parapets x', 'kit.platform', { parapets: ['x'] }, /parapets/],
    ['low cover too short', 'kit.cover.low', { length: 1.5 }, /length/],
    ['high cover too short', 'kit.cover.high', { length: 1.1 }, /length/],
    ['wall too low', 'kit.wall', { height: 1.5 }, /height/],
    ['negative length', 'kit.wall', { length: -1 }, /length/],
    ['string length', 'kit.wall', { length: '4' }, /length/],
    ['floor size shape', 'kit.floor', { size: [4] }, /size/],
    ['doorway jamb too narrow', 'kit.doorway', { width: 4, length: 5 }, /wall end/],
    ['doorway no lintel', 'kit.doorway', { height: 7 }, /lintel/],
  ];
  for (const [name, id, params, re] of bads) {
    const e = throws(() => spawn(id, params));
    ok(`throws: ${name}`, e && re.test(e) && e.startsWith(id), e);
  }
  for (const id of EXPECT) {
    for (const yaw of [0.3, Math.PI / 4, 1, Math.PI / 2 + 0.01]) {
      const e = throws(() => spawn(id, registry.meta(id).example.params, yaw));
      ok(`${id} rejects yaw ${yaw.toFixed(2)}`, e && /yaw/.test(e), e);
    }
  }

  // ---------- movement: the real player code ----------
  const DIR = { N: 0, E: -Math.PI / 2, W: Math.PI / 2, S: Math.PI };
  const put = (x, y, z, dir) => {
    keys.clear();
    Object.assign(player, { vy: 0, cover: null, snap: null, airborne: false, jetting: 0, jetTimer: 0, coverTimer: 0, pinned: false });
    player.pos.set(x, y, z);
    player.vel.set(0, 0, 0);
    player.peek.set(0, 0, 0);
    camRig.yaw = DIR[dir];
    camRig.pitch = -0.08;
    camRig.smoothPivot = null;
    step(20);
  };
  let peak = 0; // highest feet y during the last walk (a bare stair ends in a drop)
  const walk = (frames, sprint = false) => {
    keys.add('KeyW');
    if (sprint) keys.add('ShiftLeft');
    peak = 0;
    for (let i = 0; i < frames; i++) { step(1); peak = Math.max(peak, player.pos.y); }
    keys.clear();
  };

  // climb a stair / ramp / platform stair going north from its south end
  const climb = (id, params, startZ, sprint) => {
    const X = 80;
    spawn(id, params, 0, [X, 0, OZ]);
    put(X, 0, startZ, 'N');
    walk(300, sprint);
    return +peak.toFixed(3);
  };
  for (const sprint of [false, true]) {
    const tag = sprint ? 'sprint' : 'walk';
    let y = climb('kit.stairs', { height: 1.6 }, OZ + 5.5, sprint);
    ok(`stairs climbed (${tag}), top 1.6`, near(y, 1.6, 0.02), y);
    y = climb('kit.stairs', { height: 1.6, rise: 0.45 }, OZ + 5.5, sprint);
    ok(`stairs rise 0.45 climbed (${tag})`, y > 1.5, y);
  }
  {
    const y = climb('kit.ramp', { height: 1.6, length: 8 }, OZ + 9.5, false);
    ok('ramp climbed (walk), top 1.6', near(y, 1.6, 0.02), y);
  }
  {
    // platform with stairs on each side: climb them from outside (south, north, east, west)
    const cases = [['s', 'N', [0, 10]], ['n', 'S', [0, -10]], ['e', 'W', [10, 0]], ['w', 'E', [-10, 0]]];
    for (const [side, dir, [dx, dz]] of cases) {
      const cx = 20 + { s: 0, n: 25, e: 50, w: 75 }[side];
      spawn('kit.platform', { size: [8, 8], height: 1.6, stairs: side, parapets: true }, 0, [cx, 0, 78]);
      put(cx + dx, 0, 78 + dz, dir);
      walk(420);
      ok(`platform stairs side ${side} climbed`, near(player.pos.y, 1.6, 0.02) && Math.hypot(player.pos.x - cx, player.pos.z - 78) < 4, [player.pos.y, player.pos.x, player.pos.z]);
    }
    // yaw 90: the stairs side 's' now faces west; the walk-up from there
    spawn('kit.platform', { size: [8, 8], height: 1.6, stairs: 's', parapets: true }, Math.PI / 2, [120, 0, 78]);
    put(130, 0, 78, 'W'); // yaw 90 turns the south side to the east
    walk(420);
    ok('platform yaw 90: stairs turn with the piece', near(player.pos.y, 1.6, 0.02), player.pos.y);
  }
  {
    // doorway: walk through the 4 x 4 opening (south to north) and the 2.0 minimum
    for (const [w, h] of [[4, 4], [2, 1.8]]) {
      const cx = 140;
      spawn('kit.doorway', { width: w, height: h }, 0, [cx, 0, 78]);
      put(cx, 0, 84, 'N');
      walk(240);
      ok(`doorway ${w} x ${h} passable`, player.pos.z < 76, player.pos.z);
      // a stand-off beside the opening is blocked
      put(cx + w / 2 + 1.5, 0, 84, 'N');
      walk(240);
      ok(`doorway ${w} wall beside the opening blocks`, player.pos.z > 77, player.pos.z);
    }
  }
  {
    // a cover piece is solid and the low one is vaultable-class; a wall blocks
    spawn('kit.wall', { length: 4 }, 0, [140, 0, 100]);
    put(140, 0, 106, 'N');
    walk(240);
    ok('wall blocks the player', player.pos.z > 100.2, player.pos.z);
  }

  // ---------- the KIT station of the Gym ----------
  const pcs = g.level.pieces;
  for (const id of EXPECT) {
    const piece = pcs.find((q) => q.id === id && q.name === `kit:${id.slice(4)}`);
    ok(`KIT station has ${id}`, !!piece && piece.pos[2] > 25);
    if (!piece) continue;
    ok(`KIT ${id} has a label sign`, pcs.some((q) => q.id === 'env.label' && q.pos[0] === piece.pos[0] && q.params.flat));
  }
  ok('KIT station sign', pcs.some((q) => q.id === 'env.label' && /KIT/.test(q.params.text)));
  ok('KIT floor extension', pcs.some((q) => q.name === 'kit-floor-ext'));
  put(0, 0, 40, 'S');
  ok('floor under the KIT station', world.groundAt(0, 50, 1, 0) === 0 && world.colliders.some((c) => c.box.min.z <= 60 && c.box.max.z >= 80 && c.box.max.y === 0));

  return res;
});

let bad = 0;
for (const x of r) {
  if (!x.pass) bad++;
  console.log(`${x.pass ? 'ok  ' : 'FAIL'} ${x.name}${x.pass ? '' : ' ' + x.extra}`);
}
if (errors.length) { console.log('page errors:', errors); bad++; }
console.log(`${r.length - r.filter((x) => !x.pass).length}/${r.length} passed`);
await b.close();
process.exit(bad ? 1 : 0);
