// Gym, traversal and cover room (?scene=gym, #64): the room is the fixture. Drives the player through its stations
// by stepping the engine (stopped, headless: deterministic) and measures the metrics.md section 8 items it covers,
// printing every value (lines starting with "item"). Asserts the current intended behaviour only: things that are
// pure simulation (no rendering), so they do not move with SwiftShader.
// Needs the dev server: `npm run dev`, then `URL='http://localhost:5173/?debug' node tests/gym-traversal.browser.mjs`.
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const PAGE = (() => { const u = new URL(BASE); u.searchParams.set('scene', 'gym'); return u.href; })();
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 160, height: 90 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(PAGE);
await p.waitForFunction(() => window.game?.engine && window.game.tool);

const r = await p.evaluate(() => {
  const g = window.game;
  const { engine, player, camRig, world, tool } = g;
  engine.stop();
  engine.headless = true; // simulate only
  const keys = engine.input.keys;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const events = [];
  for (const n of ['player:vault', 'player:jet', 'player:land', 'player:vaultRefused']) engine.events.on(n, (d) => events.push(n === 'player:vault' ? `vault:${d}` : n === 'player:jet' ? 'jet' : n === 'player:land' ? 'land' : 'refused'));
  const DIR = { N: 0, E: -Math.PI / 2, W: Math.PI / 2, S: Math.PI }; // camera yaw: the way W moves
  const put = (x, y, z, dir = 'N') => {
    keys.clear();
    Object.assign(player, { vy: 0, cover: null, snap: null, airborne: false, jetting: 0, jetTimer: 0, coverTimer: 0, pinned: false });
    player.pos.set(x, y, z);
    player.vel.set(0, 0, 0);
    player.peek.set(0, 0, 0);
    camRig.yaw = DIR[dir];
    camRig.pitch = -0.08;
    camRig.shoulder = 1;
    camRig.smoothPivot = null;
    step(20);
    events.length = 0;
  };
  // a named piece of the level file as a box: centre, size, faces
  const pc = (name) => {
    const q = g.level.pieces.find((x) => x.name === name);
    if (!q) throw new Error(`no piece "${name}" in the level`);
    const [w, h, d] = q.params.size;
    return { x: q.pos[0], y: q.pos[1], z: q.pos[2], w, h, d, top: q.pos[1] + h, zS: q.pos[2] + d / 2, zN: q.pos[2] - d / 2, xW: q.pos[0] - w / 2, xE: q.pos[0] + w / 2 };
  };
  const f = (n, k = 2) => +n.toFixed(k);
  const press = (code) => { engine.input.pressed.add(code); };
  const speed = () => Math.hypot(player.vel.x, player.vel.z);
  const out = { counts: { labels: world.labels.length, colliders: world.colliders.length } };

  // ---------- run at a low block from the south: Space as soon as the run-in vault can fire ----------
  // from: start distance to the face; sprint: Shift held. Result: 'vault:hop' | 'vault:slide' | 'jet' (refused or no vault).
  const runIn = (blk, { from = 3, sprint = false, x = blk.x } = {}) => {
    put(x, 0, blk.zS + from);
    keys.add('KeyW');
    if (sprint) keys.add('ShiftLeft');
    let fired = null;
    let how = null;
    for (let i = 0; i < 320; i++) {
      const d = player.pos.z - blk.zS;
      if (!fired && !player.snap && ((speed() > 3.5 && d < 2.0) || player.cover?.type === 'low')) { press('Space'); fired = { d: f(d), v: f(speed(), 1) }; how = player.cover ? 'from cover' : 'run-in'; }
      step();
      if (fired && !player.snap && !player.airborne && events.length) break;
    }
    keys.clear();
    step(40);
    const vault = events.find((e) => e.startsWith('vault:')) ?? null;
    return { result: vault ?? (events.includes('jet') ? 'jet' : 'none'), refused: events.includes('refused'), how, fired, y: f(player.pos.y), z: f(player.pos.z), past: player.pos.z < blk.zN };
  };

  // ---------- item 1 + cover classes (item 8): the cover height row ----------
  out.coverClass = [];
  out.vaultHeight = [];
  for (let i = 0; i < 13; i++) {
    const h = f(0.8 + 0.1 * i, 1);
    const blk = pc(`cover-h:${h.toFixed(1)}`);
    put(blk.x, 0, blk.zS + 3);
    keys.add('KeyW');
    step(90);
    out.coverClass.push({ h, cover: player.cover?.type ?? null, pinned: !!player.pinned, dist: f(player.pos.z - blk.zS) });
    keys.clear();
    if (h >= 1.0 && h <= 1.7) {
      out.vaultHeight.push({ h, walk: runIn(blk, { from: 3 }), sprint: runIn(blk, { from: 5, sprint: true }) });
    }
  }
  // the vault-height row (clear 3 m run-up, 8 m behind)
  out.vaultRow = [1.0, 1.2, 1.4, 1.5, 1.6].map((h) => ({ h, ...runIn(pc(`vault-h:${h.toFixed(1)}`)) }));

  // ---------- items 11, 10: vault depth ----------
  out.vaultDepth = [0.6, 1.0, 1.1, 1.2, 1.3, 1.6, 2.4].map((d) => ({ d, ...runIn(pc(`vault-d:${d.toFixed(1)}`)) }));

  // ---------- item 9: run-up lanes ----------
  out.runUp = [0.5, 1.0, 2.0, 3.0].map((l) => ({ l, ...runIn(pc(`lane:${l.toFixed(1)}`), { from: l }) }));

  // ---------- item 10: landing obstacles ----------
  out.landing = [0.6, 0.9, 1.2, 1.4].map((gap) => ({ gap, ...runIn(pc(`land:${gap.toFixed(1)}`)) }));

  // ---------- item 2: jet landing height (blocks 3 x 3, no cover flag) ----------
  // stand: W and Space from rest at distance d; walk / sprint: run at it, Space at distance d.
  const jetTry = (blk, d, mode) => {
    put(blk.x, 0, blk.zS + (mode === 'stand' ? d : d + 4));
    keys.add('KeyW');
    if (mode === 'sprint') keys.add('ShiftLeft');
    if (mode !== 'stand') for (let i = 0; i < 200 && player.pos.z - blk.zS > d; i++) step();
    const v = speed();
    press('Space');
    step();
    for (let i = 0; i < 200 && player.airborne; i++) step();
    const landed = Math.abs(player.pos.y - blk.top) < 0.02 && player.pos.z < blk.zS && player.pos.z > blk.zN;
    keys.clear();
    return { landed, y: f(player.pos.y), speed: f(v, 1) };
  };
  out.jetHeight = [];
  for (let i = 0; i < 11; i++) {
    const h = f(1.0 + 0.1 * i, 1);
    const blk = pc(`jet-h:${h.toFixed(1)}`);
    const row = { h };
    for (const mode of ['stand', 'walk']) row[mode] = [0.6, 1.0, 1.4, 1.8, 2.2, 2.6].map((d) => (jetTry(blk, d, mode).landed ? 1 : 0)).join('');
    out.jetHeight.push(row);
  }

  // ---------- item 3: jet gaps, from the edge of platform j to platform j+1 ----------
  const gapTry = (j, mode) => {
    const a = pc(`gap-p:${j}`);
    const n = pc(`gap-p:${j + 1}`);
    put(mode === 'stand' ? a.xE - 0.2 : a.xW + 0.4, 1.6, a.z, 'E');
    keys.add('KeyW');
    if (mode === 'sprint') keys.add('ShiftLeft');
    if (mode !== 'stand') for (let i = 0; i < 200 && player.pos.x < a.xE - 0.2; i++) step();
    const v = speed();
    const x0 = player.pos.x;
    press('Space');
    step();
    for (let i = 0; i < 200 && player.airborne; i++) step();
    keys.clear();
    return { landed: player.pos.y > 1.55 && player.pos.x > n.xW, speed: f(v, 1), reach: f(player.pos.x - x0) };
  };
  out.jetGap = {};
  for (const mode of ['stand', 'walk', 'sprint']) {
    const rows = [];
    for (let j = 0; j < 11; j++) rows.push({ gap: 2 + 0.5 * j, ...gapTry(j, mode) });
    out.jetGap[mode] = rows;
  }

  // ---------- item 4: corridors, camera pull-in ----------
  const corr = (w) => { const wall = pc(`corr-wall:${w.toFixed(1)}`); return { cx: wall.x - w / 2 - 0.5, zf: wall.zS }; };
  const camAt = (mode, shoulder, c) => {
    put(c.cx, 0, c.zf - (mode === 'sprint' ? 1.5 : 8));
    camRig.shoulder = shoulder;
    if (mode === 'aim') keys.add('Mouse2');
    if (mode === 'sprint') { keys.add('KeyW'); keys.add('ShiftLeft'); }
    step(mode === 'sprint' ? 60 : 70);
    const cp = tool.camPull();
    keys.clear();
    return { pulled: cp.pulled, actual: f(cp.actual), wanted: f(cp.wanted) };
  };
  out.corridor = [1.6, 1.8, 2.0, 2.4, 3.0, 4.0].map((w) => {
    const c = corr(w);
    const row = { w };
    for (const mode of ['walk', 'aim', 'sprint']) row[mode] = [1, -1].map((s) => camAt(mode, s, c));
    return row;
  });

  // ---------- item 5: ceilings ----------
  out.ceiling = [2.4, 2.8, 3.2, 3.4, 4.0, 5.0].map((h) => {
    const bay = pc(`bay:${h.toFixed(1)}`);
    const row = { h };
    for (const [name, pitch] of [['level', -0.08], ['down', -1.25]]) {
      put(bay.x, 0, bay.z);
      camRig.pitch = pitch;
      step(70);
      const cp = tool.camPull();
      row[name] = { pulled: cp.pulled, actual: f(cp.actual), wanted: f(cp.wanted) };
    }
    put(bay.x, 0, bay.z);
    press('Space');
    let peak = 0;
    for (let i = 0; i < 90; i++) { step(); peak = Math.max(peak, player.pos.y); }
    row.jetPeak = f(peak);
    return row;
  });

  // ---------- item 6: lintels ----------
  out.lintel = [1.7, 1.8, 2.2, 3.4, 4.0].map((h) => {
    const l = pc(`lintel:${h.toFixed(1)}`);
    put(l.x, 0, l.zS + 3);
    keys.add('KeyW');
    step(100);
    const passed = player.pos.z < l.zN - 0.2;
    keys.clear();
    let peak = null;
    if (passed || h > 1.75) {
      put(l.x, 0, l.z);
      press('Space');
      peak = 0;
      for (let i = 0; i < 90; i++) { step(); peak = Math.max(peak, player.pos.y); }
      peak = f(peak);
    }
    return { h, passed, jetPeak: peak };
  });

  // ---------- item 7: cover length, slide range and flags at the ends ----------
  const slideEnd = (blk, key) => {
    put(blk.x, 0, blk.zS + 3);
    keys.add('KeyW');
    for (let i = 0; i < 90 && !player.cover; i++) step();
    keys.clear();
    step(12);
    const mid = { type: player.cover?.type ?? null, pinned: !!player.pinned };
    keys.add(key);
    let last = null;
    for (let i = 0; i < 400 && player.cover; i++) { step(); if (player.cover) last = { x: player.pos.x, edgeL: !!player.cover.edgeL, edgeR: !!player.cover.edgeR }; }
    keys.clear();
    return { mid, last };
  };
  out.coverLength = [];
  for (const [kind, lens] of [['low', [0.8, 1.0, 1.6, 3.0]], ['high', [0.9, 1.2, 1.8, 3.0]]]) {
    for (const len of lens) {
      const blk = pc(`len-${kind}:${len.toFixed(1)}`);
      const l = slideEnd(blk, 'KeyA');
      const rr = slideEnd(blk, 'KeyD');
      out.coverLength.push({ kind, len, type: l.mid.type, pinned: l.mid.pinned, range: l.last && rr.last ? f(rr.last.x - l.last.x) : null, edgeL: l.last?.edgeL, edgeR: rr.last?.edgeR });
    }
  }

  // ---------- item 12: stairs ----------
  const foot = player.rigModel?.bones;
  const climb = (name, rise, run, mode) => {
    const s = pc(name);
    put(s.x, 0, s.zS + 3);
    keys.add('KeyW');
    if (mode === 'sprint') keys.add('ShiftLeft');
    const top = f(4 * rise, 3);
    let n = 0;
    let prev = null;
    let maxDy = 0;
    const ikErrs = [];
    const held = { Left: 0, Right: 0 };
    for (; n < 240 && player.pos.y < top - 0.005; n++) {
      step();
      if (prev !== null) maxDy = Math.max(maxDy, Math.abs(camRig.pivot.y - prev));
      prev = camRig.pivot.y;
      if (foot) {
        for (const [side, bone] of [['Left', foot.LeftFoot], ['Right', foot.RightFoot]]) {
          // a foot counts as planted once its stance weight has been full for 3 frames (heel strike settled)
          held[side] = player.animator.legs?.[side]?.stance >= 0.99 ? held[side] + 1 : 0;
          if (held[side] < 3) continue;
          const v = bone.getWorldPosition(player.pos.clone());
          // ankle is 0.08 above the sole: compare with the floor the animator plants on (ground under the ankle)
          ikErrs.push(Math.abs(v.y - 0.08 - world.groundAt(v.x, v.z, player.pos.y + 0.6)));
        }
      }
    }
    const y = f(player.pos.y);
    keys.clear();
    return { rise, run, mode, climbed: Math.abs(player.pos.y - top) < 0.02, y, frames: n, camStepMm: f(maxDy * 1000, 1), footErrMm: ikErrs.length ? f(ikErrs.sort((a, b2) => a - b2)[ikErrs.length >> 1] * 1000, 0) : null };
  };
  out.stairs = [];
  for (const rise of [0.3, 0.4, 0.45, 0.5]) for (const mode of ['walk', 'sprint']) out.stairs.push(climb(`stair-rise:${rise.toFixed(2)}`, rise, 1.0, mode));
  for (const run of [0.6, 1.2]) for (const mode of ['walk', 'sprint']) out.stairs.push(climb(`stair-run:${run.toFixed(1)}`, 0.4, run, mode));

  // ---------- item 20: standard stair up to the 1.6 platform, jet-ons ----------
  const std = pc('std-stair');
  const plat = pc('std-platform');
  put(std.x, 0, std.zS + 3);
  keys.add('KeyW');
  for (let i = 0; i < 90 && player.pos.y < 1.59; i++) step();
  keys.clear();
  out.stdStair = { y: f(player.pos.y) };
  const jetOn = (d, mode) => {
    put(plat.xW - (mode === 'stand' ? d : d + 4), 0, plat.z, 'E');
    keys.add('KeyW');
    if (mode === 'sprint') keys.add('ShiftLeft');
    if (mode !== 'stand') for (let i = 0; i < 200 && player.pos.x < plat.xW - d; i++) step();
    press('Space');
    step();
    for (let i = 0; i < 200 && player.airborne; i++) step();
    keys.clear();
    return Math.abs(player.pos.y - 1.6) < 0.02 && player.pos.x > plat.xW ? 1 : 0;
  };
  out.jetOn = {};
  for (const mode of ['stand', 'walk', 'sprint']) out.jetOn[mode] = [0.6, 1.0, 1.4, 1.8, 2.2, 2.6].map((d) => jetOn(d, mode)).join('');
  // a parapet on the platform is low cover from up there
  put(plat.x, 1.6, plat.zS - 3);
  keys.add('KeyW');
  step(80);
  out.parapet = { cover: player.cover?.type ?? null, y: f(player.pos.y) };
  keys.clear();

  // ---------- item 19: the camera against low cover, crouched, both shoulders, looking around ----------
  const lowBlk = pc('cover-h:1.1');
  const segHitsBox = (a, bpt, bx) => { // segment a -> b against the block (slab test)
    let t0 = 0, t1 = 1;
    for (const ax of ['x', 'y', 'z']) {
      const d = bpt[ax] - a[ax];
      const lo = bx.min[ax], hi = bx.max[ax];
      if (Math.abs(d) < 1e-9) { if (a[ax] < lo || a[ax] > hi) return false; continue; }
      let ta = (lo - a[ax]) / d, tb = (hi - a[ax]) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  };
  const coverBox = world.colliders.find((c) => c.mesh.position.x === lowBlk.x && Math.abs(c.box.max.y - 1.1) < 1e-6 && Math.abs(c.mesh.position.z - lowBlk.z) < 1e-6).box;
  const camCover = { samples: 0, pulled: 0, through: 0, minRatio: 9 };
  for (const shoulder of [1, -1]) {
    for (let k = 0; k < 8; k++) {
      put(lowBlk.x + (k % 2 ? 0.8 : 0), 0, lowBlk.zS + 3);
      keys.add('KeyW');
      for (let i = 0; i < 60 && !player.cover; i++) step();
      keys.clear();
      camRig.shoulder = shoulder;
      camRig.yaw = (k * Math.PI) / 4;
      step(70);
      const cp = tool.camPull();
      camCover.samples++;
      if (cp.pulled) camCover.pulled++;
      if (segHitsBox(camRig.pivot, g.engine.camera.position, coverBox)) camCover.through++;
      camCover.minRatio = Math.min(camCover.minRatio, cp.actual / cp.wanted);
      camCover.crouched = player.crouched;
      camCover.pivotY = f(camRig.pivot.y);
    }
  }
  camCover.minRatio = f(camCover.minRatio);
  out.camCover = camCover;

  // ---------- peek tests: wall end, corner, doorway ----------
  const peekAt = (blk, key, wallEnd) => {
    put(blk.x, 0, blk.zS + 3);
    keys.add('KeyW');
    for (let i = 0; i < 90 && !player.cover; i++) step();
    keys.clear();
    step(12);
    keys.add(key);
    let last = null;
    for (let i = 0; i < 400 && player.cover; i++) { step(); if (player.cover) last = { edgeL: !!player.cover.edgeL, edgeR: !!player.cover.edgeR, pinned: !!player.pinned }; }
    keys.clear();
    // back at the end of the cover: aim and see the lean (peek)
    return last;
  };
  out.peek = {
    wallEnd: peekAt(pc('wall-end'), 'KeyD'),
    hcornerWest: peekAt(pc('hcorner-a'), 'KeyA'),
    lcornerWest: peekAt(pc('lcorner-a'), 'KeyA'),
    pillar: peekAt(pc('pillar'), 'KeyD'),
    doorWallEast: peekAt(pc('door-wall-l'), 'KeyD'),
  };
  { // peek by aiming at an end
    const w = pc('wall-end');
    put(w.x, 0, w.zS + 3);
    keys.add('KeyW');
    for (let i = 0; i < 90 && !player.cover; i++) step();
    keys.clear();
    keys.add('KeyD');
    for (let i = 0; i < 200 && player.cover && !player.cover.edgeR; i++) step();
    keys.clear();
    keys.add('Mouse2');
    step(40);
    out.peek.aim = { cover: !!player.cover, aiming: player.aiming, shift: f(player.peek.length()), side: camRig.peekSide };
    keys.clear();
  }
  const dl = pc('door-lintel');
  const doorTry = (sprint) => {
    put(dl.x, 0, dl.zS + 4);
    keys.add('KeyW');
    if (sprint) keys.add('ShiftLeft');
    step(120);
    const cp = tool.camPull();
    keys.clear();
    return { passed: player.pos.z < dl.zN - 0.2, x: f(player.pos.x), pulled: cp.pulled };
  };
  out.peek.door = { walk: doorTry(false), sprint: doorTry(true), size: [4, dl.y] };

  // ---------- the tool itself: panel, keys, teleport, free on dispose ----------
  const panel = () => document.getElementById('gym-traversal');
  const tl = {};
  tl.panel = !!panel();
  put(0, 0, 18);
  step(10);
  tl.text = panel()?.textContent ?? '';
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
  tl.hidden = panel().style.display === 'none';
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
  tl.shown = panel().style.display !== 'none';
  const s0 = tool.station;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
  tl.next = tool.station === s0 + 1 && Math.hypot(player.pos.x - tool.stations[tool.station].pos[0], player.pos.z - tool.stations[tool.station].pos[2]) < 0.01;
  tl.stations = tool.stations.length;
  g.loadScene('arena');
  tl.removed = !panel();
  g.loadScene('gym');
  tl.back = !!panel() && document.querySelectorAll('#gym-traversal').length === 1;
  out.tool = tl;
  return out;
});

console.log(JSON.stringify(r.counts));
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };
const ok = (v) => (v ? 'yes' : 'no');

// ----- measurements (printed) -----
console.log('\nitem 8 cover class by height (walk into the block):');
for (const c of r.coverClass) console.log(`  h ${c.h.toFixed(1)}  cover ${c.cover}  pinned ${ok(c.pinned)}  stops ${c.dist} m from the face`);
console.log('\nitem 1 vault height (run-in at walk from 3 m, sprint from 5 m):');
for (const v of r.vaultHeight) console.log(`  h ${v.h.toFixed(1)}  walk ${v.walk.result} (${v.walk.how}, y ${v.walk.y})  sprint ${v.sprint.result} (${v.sprint.how}, y ${v.sprint.y})`);
console.log('  vault-height row (walk):', r.vaultRow.map((v) => `${v.h}:${v.result}`).join('  '));
console.log('\nitems 10, 11 vault depth (low 1.1, walk run-in; 1.2 is the hop limit, VAULT.hopDepth):');
for (const v of r.vaultDepth) console.log(`  depth ${v.d.toFixed(1)}  ${v.result}  far side ${ok(v.past)}`);
console.log('\nitem 9 run-up lane (start at the back wall, Space on the first frame the vault can fire):');
for (const v of r.runUp) console.log(`  lane ${v.l.toFixed(1)}  ${v.result} (${v.how}, speed ${v.fired?.v}, ${v.fired?.d} m from the face)`);
console.log('\nitem 10 landing obstacle behind the far face:');
for (const v of r.landing) console.log(`  ${v.gap.toFixed(1)} m  ${v.result === 'jet' ? 'REFUSED (jet burst)' : v.result}`);
console.log('\nitem 2 jet landing on a block (start distances 0.6 1.0 1.4 1.8 2.2 2.6 m, 1 = lands on top):');
for (const v of r.jetHeight) console.log(`  h ${v.h.toFixed(1)}  stand ${v.stand}  walk ${v.walk}`);
console.log('\nitem 3 jet gap (landed on the next 1.6 platform; reach = x travelled to touchdown):');
const reliable = {};
const maxClear = {};
for (const [mode, rows] of Object.entries(r.jetGap)) {
  console.log(`  ${mode}: ${rows.map((x) => `${x.gap.toFixed(1)}${x.landed ? '+' : '-'}`).join(' ')}  (take-off speed ${rows[0].speed} m/s, reach on a miss ${rows.find((x) => !x.landed)?.reach ?? '-'} m)`);
  let rel = 0;
  for (const x of rows) { if (!x.landed) break; rel = x.gap; }
  reliable[mode] = rel;
  maxClear[mode] = Math.max(0, ...rows.filter((x) => x.landed).map((x) => x.gap));
}
console.log('  reliable gap (all smaller ones clear):', JSON.stringify(reliable), ' max clear gap:', JSON.stringify(maxClear));
console.log('\nitem 4 corridor width, camera pulled in? (R / L shoulder), actual / wanted m:');
for (const c of r.corridor) console.log(`  w ${c.w.toFixed(1)}  ` + ['walk', 'aim', 'sprint'].map((m) => `${m} ${c[m].map((x) => (x.pulled ? 'PULL' : 'ok') + ` ${x.actual}/${x.wanted}`).join(' | ')}`).join('   '));
const minClear = {};
for (const m of ['walk', 'aim', 'sprint']) minClear[m] = r.corridor.find((c, i) => r.corridor.slice(i).every((k) => k[m].every((x) => !x.pulled)))?.w ?? null;
console.log('  narrowest sampled width with no pull-in:', JSON.stringify(minClear));
console.log('\nitem 5 ceiling height (camera at default pitch / looking straight down; jet peak above take-off, full burst 1.46):');
const fullBurst = r.ceiling.at(-1).jetPeak; // under the 5.0 ceiling nothing cuts it
console.log(`  (full burst measured under 5.0: ${fullBurst})`);
for (const c of r.ceiling) console.log(`  ${c.h.toFixed(1)}  level ${c.level.pulled ? 'PULL' : 'ok'} ${c.level.actual}/${c.level.wanted}  down ${c.down.pulled ? 'PULL' : 'ok'} ${c.down.actual}/${c.down.wanted}  jet peak ${c.jetPeak}${c.jetPeak < fullBurst - 0.02 ? ' CUT' : ''}`);
console.log('\nitem 6 lintel (door header): walk through / jet peak standing in the doorway');
for (const l of r.lintel) console.log(`  ${l.h.toFixed(1)}  walk ${l.passed ? 'passes' : 'BLOCKED'}  jet peak ${l.jetPeak ?? '-'}${l.jetPeak != null && l.jetPeak < fullBurst - 0.02 ? ' CUT' : ''}`);
console.log('\nitem 7 cover length (slide range between the stops, flags at the ends):');
for (const c of r.coverLength) console.log(`  ${c.kind} ${c.len.toFixed(1)}  type ${c.type}  pinned at centre ${ok(c.pinned)}  slide range ${c.range} m  end flags L ${ok(c.edgeL)} R ${ok(c.edgeR)}`);
console.log('\nitem 12 stairs (to the top landing; camera pivot step per frame, median planted-foot error vs the step under it):');
for (const s of r.stairs) console.log(`  rise ${s.rise} run ${s.run} ${s.mode}  ${s.climbed ? 'climbed' : 'NOT climbed, stuck at y ' + s.y}  ${s.frames} frames  camera step ${s.camStepMm} mm  foot error ${s.footErrMm} mm`);
console.log('\nitem 20 jet onto the 1.6 platform (start distances 0.6 1.0 1.4 1.8 2.2 2.6 m, 1 = lands on it):');
for (const [m, v] of Object.entries(r.jetOn)) console.log(`  ${m} ${v}`);
console.log('\nitem 19 camera against 1.1 cover, crouched:', JSON.stringify(r.camCover));
console.log('\npeek tests:', JSON.stringify(r.peek));

// ----- assertions -----
console.log('');
expect('cover classes snap by height: low under 1.7, high from 1.7 (0.8 .. 2.0)', r.coverClass.every((c) => c.cover === (c.h < 1.7 ? 'low' : 'high')), JSON.stringify(r.coverClass.map((c) => c.cover)));
expect('high cover pins in the middle of a 3 m block, low cover never pins', r.coverClass.filter((c) => c.h >= 1.7).every((c) => c.pinned) && r.coverClass.filter((c) => c.h < 1.7).every((c) => !c.pinned));
const v11 = r.vaultHeight.find((v) => v.h === 1.1);
expect('the 1.1 low cover vaults at walk and at sprint (a hop over the 1 m block)', v11.walk.result === 'vault:hop' && v11.walk.past && v11.walk.y === 0 && v11.sprint.result === 'vault:hop' && v11.sprint.past);
expect('every low block 1.0 .. 1.6 vaults at walk', r.vaultHeight.filter((v) => v.h < 1.7).every((v) => v.walk.result === 'vault:hop' && v.walk.past), JSON.stringify(r.vaultHeight.map((v) => v.walk.result)));
expect('a 1.7 block (high cover) is not vaulted', r.vaultHeight.find((v) => v.h === 1.7).walk.result === 'jet');
// 1.2 hops although its Box3 depth reads 1.2000000000000028 (#tryVault compares with a tolerance)
expect('vault depth: hop up to 1.2, slide from 1.3', r.vaultDepth.every((v) => v.result === (v.d <= 1.2 ? 'vault:hop' : 'vault:slide') && v.past), JSON.stringify(r.vaultDepth.map((v) => v.result)));
expect('landing space: an obstacle closer than ~1.1 m behind the far face refuses the vault (player:vaultRefused, then a jet)', r.landing.filter((v) => v.gap < 1.05).every((v) => v.result === 'jet' && v.refused) && r.landing.filter((v) => v.gap >= 1.1).every((v) => v.result === 'vault:hop'), JSON.stringify(r.landing.map((v) => v.result)));
expect('the run-in vault works from every lane length 0.5 .. 3.0 m', r.runUp.every((v) => v.result === 'vault:hop'), JSON.stringify(r.runUp.map((v) => v.result)));
const lands = (row, mode) => row[mode].includes('1');
expect('a jet from standing lands on blocks up to 1.4 (low cover 1.1 included)', r.jetHeight.filter((v) => v.h <= 1.4).every((v) => lands(v, 'stand')), JSON.stringify(r.jetHeight.map((v) => v.stand)));
expect('a jet from standing lands on 1.6', lands(r.jetHeight.find((v) => v.h === 1.6), 'stand'));
expect('a jet from a walk lands on 1.6', lands(r.jetHeight.find((v) => v.h === 1.6), 'walk'));
expect('a jet from standing lands on the 1.6 platform (jet-on from the open west edge)', r.jetOn.stand.includes('1'), r.jetOn.stand);
expect('a jet from a walk lands on the 1.6 platform', r.jetOn.walk.includes('1'), r.jetOn.walk);
expect('a jet from standing clears the 2.0 m gap between 1.6 platforms', r.jetGap.stand[0].landed);
expect('a longer start carries further: sprint reliable gap >= walk >= stand', reliable.sprint >= reliable.walk && reliable.walk >= reliable.stand, JSON.stringify(reliable));
expect('the widest corridor (4.0) never pulls the camera in; the narrowest (1.6) does', r.corridor.find((c) => c.w === 4.0).walk.every((x) => !x.pulled) && r.corridor.find((c) => c.w === 1.6).walk.some((x) => x.pulled));
expect('a high ceiling (5.0) lets the camera look down unpulled and the jet burst complete', !r.ceiling.at(-1).level.pulled && r.ceiling.at(-1).jetPeak > 1.4);
expect('a 2.4 ceiling cuts the jet (head stops under it) and pulls the camera looking down', r.ceiling[0].jetPeak < 0.7 && r.ceiling[0].down.pulled);
expect('lintel 1.7 blocks the doorway (head box), 1.8 and higher pass', !r.lintel[0].passed && r.lintel.slice(1).every((l) => l.passed));
expect('a jet under a 4.0 lintel is not cut, under 2.2 it is', r.lintel.find((l) => l.h === 4.0).jetPeak > 1.4 && r.lintel.find((l) => l.h === 2.2).jetPeak < 0.5);
expect('cover slide covers more of a longer block', ['low', 'high'].every((k) => { const rows = r.coverLength.filter((c) => c.kind === k).map((c) => c.range); return rows.every((v, i) => i === 0 || v > rows[i - 1]); }), JSON.stringify(r.coverLength.map((c) => c.range)));
expect('both ends of every high cover block can be peeked (edge flag at the stop)', r.coverLength.filter((c) => c.kind === 'high').every((c) => c.edgeL && c.edgeR), JSON.stringify(r.coverLength.filter((c) => c.kind === 'high')));
const climbed = (rise, mode) => r.stairs.find((s) => s.rise === rise && s.run === 1.0 && s.mode === mode).climbed;
expect('stairs with rise 0.3, 0.4 and 0.45 are climbable (walk and sprint)', [0.3, 0.4, 0.45].every((x) => climbed(x, 'walk') && climbed(x, 'sprint')));
expect('stairs with rise 0.5 are not (the first step is a wall)', !climbed(0.5, 'walk') && !climbed(0.5, 'sprint'));
expect('stairs of run 0.6 and 1.2 (rise 0.4) are climbable', r.stairs.filter((s) => s.rise === 0.4 && s.run !== 1.0).every((s) => s.climbed));
expect('the standard 0.4 / 1.0 / 4 wide stair reaches the 1.6 platform; its parapet is low cover', r.stdStair.y === 1.6 && r.parapet.cover === 'low');
expect('a wall end, a cover corner and a pillar are peekable (edge flag)', r.peek.wallEnd.edgeR && r.peek.hcornerWest.edgeL && r.peek.pillar.edgeR);
expect('aiming at a wall end keeps the cover and leans out (peek)', r.peek.aim.cover && r.peek.aim.aiming && r.peek.aim.shift > 0.1 && r.peek.aim.side !== 0, JSON.stringify(r.peek.aim));
expect('the 4 x 4 door in the 7 m wall passes at walk and sprint', r.peek.door.walk.passed && r.peek.door.sprint.passed);
expect('tool: panel on load, T hides and shows it, G teleports to the next station', r.tool.panel && r.tool.hidden && r.tool.shown && r.tool.next);
expect('tool: the panel reads cover, vault, jet and camera', ['feet y', 'cover', 'vault', 'jet', 'camera'].every((k) => r.tool.text.includes(k)), r.tool.text);
expect('tool: the panel is removed on a scene switch and comes back once', r.tool.removed && r.tool.back);
expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
process.exit(fail.length ? 1 : 0);
