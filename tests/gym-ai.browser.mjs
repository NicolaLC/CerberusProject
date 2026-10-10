// Gym enemy behaviour room (`?scene=gym-ai`, #66): one walled room per enemy type, off a hub where nothing wakes.
// This suite uses the room as the fixture for enemies / boss and checks its tool (keys J K L O, overlays), then
// MEASURES the open items of instructions/metrics.md section 8 (13, 14, 15, 17) and prints them. Only rules that
// follow from the code are asserted; the measurements are printed, not asserted, because they depend on dice rolls
// (AI timers) and would flake under SwiftShader. The engine is stopped and stepped, frame counts rather than time.
// Needs the dev server: `npm run dev`, then `node tests/gym-ai.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const URL_ROOM = (() => {
  const u = new URL(BASE);
  u.searchParams.set('scene', 'gym-ai');
  if (!u.searchParams.has('debug')) u.searchParams.set('debug', '');
  return u.href;
})();
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(URL_ROOM);
await p.waitForFunction(() => window.game?.engine);

const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };
const show = (title, rows) => { console.log(`\n${title}`); console.table(rows); };

// ---- helpers living in the page (window.T) ----
await p.evaluate(() => {
  const g = window.game;
  const { engine, enemies, player, world } = g;
  engine.stop();
  engine.headless = true; // simulate only: nothing here checks pixels
  const T = (window.T = {});
  T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) engine.step(1 / 60); };
  T.bolts = 0;
  T.hurts = 0;
  engine.events.on('bolt:fired', () => T.bolts++);
  engine.events.on('player:hurt', () => T.hurts++);
  T.key = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  T.god = () => { player.shields = player.health = 1e6; };
  T.kind = (k) => enemies.puppets.filter((e) => e.kind === k);
  // the player stands at (x, z) for s seconds
  T.hold = (x, z, s, yaw = 0) => {
    for (let i = 0; i < Math.round(s * 60); i++) {
      player.pos.set(x, 0, z);
      player.vel?.set(0, 0, 0);
      T.god();
      engine.step(1 / 60);
    }
  };
  T.reload = () => { enemies.load(g.level); T.god(); };
  T.room = g.level.rooms;
  // a segment (a to b, shortened by `cut` at the end like the AIs' sight rays) against an AABB
  T.hits = (a, b, box, cut = 0.5) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const k = Math.max(0, (len - cut) / len);
    let t0 = 0;
    let t1 = 1;
    for (const ax of ['x', 'y', 'z']) {
      const d = (b[ax] - a[ax]) * k;
      if (Math.abs(d) < 1e-9) { if (a[ax] < box.min[ax] || a[ax] > box.max[ax]) return false; continue; }
      let ta = (box.min[ax] - a[ax]) / d;
      let tb = (box.max[ax] - a[ax]) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  };
  // the cover rows of the trooper room, south to north: { zc, th, h, xMin, xMax, boxes, gaps: [{ x0, x1, w }] }
  T.rowsInfo = () => {
    const room = T.room.troopers;
    const rows = new Map();
    for (const c of world.colliders) {
      const b = c.box;
      if (!c.cover || c.cover === 'wall' || !(b.min.x > room.minX && b.max.x < room.maxX && b.min.z > room.minZ && b.max.z < room.maxZ)) continue;
      const k = (b.min.z + b.max.z) / 2;
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(b);
    }
    return [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([zc, boxes]) => {
      boxes.sort((a, b) => a.min.x - b.min.x);
      const gaps = [];
      for (let i = 0; i < boxes.length - 1; i++) gaps.push({ x0: boxes[i].max.x, x1: boxes[i + 1].min.x, w: +(boxes[i + 1].min.x - boxes[i].max.x).toFixed(2) });
      return { zc, th: boxes[0].max.z - boxes[0].min.z, h: boxes[0].max.y - boxes[0].min.y, xMin: boxes[0].min.x, xMax: boxes[boxes.length - 1].max.x, boxes, gaps };
    });
  };
  // where a polyline crosses the row lines: [{ row: zc, how: gap width | 'end' | 'box' }]
  T.crossings = (pts) => {
    const res = [];
    const info = T.rowsInfo();
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const c = pts[k + 1];
      for (const r of info) {
        if ((a.z - r.zc) * (c.z - r.zc) >= 0) continue;
        const x = a.x + ((c.x - a.x) * (a.z - r.zc)) / (a.z - c.z);
        const gp = r.gaps.find((q) => x > q.x0 - 0.01 && x < q.x1 + 0.01);
        res.push({ row: r.zc, how: gp ? gp.w : x < r.xMin || x > r.xMax ? 'end' : 'box' });
      }
    }
    return res;
  };
  T.blocked = (a, b) => world.colliders.some((c) => T.hits(a, b, c.box));
});

// =====================================================================================================
// 1. the hub: spawn and all four corners, nothing wakes or shoots
// =====================================================================================================
const hub = await p.evaluate(() => {
  const g = window.game;
  const { enemies, player } = g;
  const out = { spawn: player.pos.toArray(), perPoint: [] };
  const awake = () => enemies.puppets.filter((e) => e.awake || e.alerted || (e.kind === 'shooter' && e.state !== 'hidden')).map((e) => e.kind);
  T.bolts = 0;
  T.step(6); // at the spawn, player left where the level put it
  out.spawnAwake = awake();
  for (const [x, z] of [[-5.5, -5.5], [5.5, -5.5], [5.5, 5.5], [-5.5, 5.5]]) {
    T.hold(x, z, 4);
    out.perPoint.push(awake().length);
  }
  out.bolts = T.bolts;
  out.hp = player.health;
  // distance of every enemy to the nearest hub point against its wake range
  const near = (e) => {
    const dx = Math.max(-6 - e.pos.x, 0, e.pos.x - 6);
    const dz = Math.max(-6 - e.pos.z, 0, e.pos.z - 6);
    return Math.hypot(dx, dz);
  };
  out.nearest = enemies.puppets.filter((e) => ['trooper', 'drone', 'boss', 'shooter'].includes(e.kind)).map((e) => ({ kind: e.kind, from: +near(e).toFixed(1), wake: e.kind === 'drone' ? e.t.sight : e.kind === 'boss' ? e.t.wakeRange : e.kind === 'trooper' ? e.t.sight : 30 }));
  return out;
});
expect('hub: spawn is in the hub, facing the rooms', hub.spawn[0] === -3 && hub.spawn[2] === 3);
expect('hub: nothing wakes at the spawn or in any hub corner', hub.spawnAwake.length === 0 && hub.perPoint.every((n) => n === 0), JSON.stringify(hub));
expect('hub: no bolts fired, no damage', hub.bolts === 0);
expect('hub: every wake range stays clear of the hub (nearest enemy farther than its range)', hub.nearest.every((n) => n.from > n.wake), JSON.stringify(hub.nearest));

// =====================================================================================================
// 2. the tool: overlays and panel exist with ?debug
// =====================================================================================================
const ov = await p.evaluate(() => {
  const g = window.game;
  const t = g.tool;
  const kinds = g.enemies.puppets.map((e) => e.kind);
  return {
    isTool: !!t && t.constructor.name === 'AiTool',
    panel: !!t.panel?.isConnected && /K\s+freeze/.test(t.panel.textContent) && /J\s+respawn/.test(t.panel.textContent),
    group: !!t.group && t.group.parent === g.engine.scene && t.group.visible,
    rings: t.rings.length,
    ringsWanted: kinds.filter((k) => k === 'trooper').length * 2 + kinds.filter((k) => k === 'shooter').length + kinds.filter((k) => k === 'drone').length + 3 * kinds.filter((k) => k === 'boss').length,
    tags: t.tags.length,
    enemies: kinds.length,
    spots: t.spots.length,
    markers: !!t.markers && t.markers.count === t.spots.length,
    lines: !!t.lines,
    layer: !!t.layer?.isConnected,
  };
});
expect('tool: AiTool with the help panel (keys listed) top-left', ov.isTool && ov.panel);
expect('overlays (?debug): group in the scene, range rings per enemy, a state text per enemy', ov.group && ov.rings === ov.ringsWanted && ov.tags === ov.enemies, JSON.stringify(ov));
expect('overlays: cover spot markers for the trooper room and a dynamic line batch', ov.markers && ov.spots > 0 && ov.lines && ov.layer, JSON.stringify(ov));

// =====================================================================================================
// 3. troopers: walking in wakes the squad, they pick cover within the metric ranges
// =====================================================================================================
const tr = await p.evaluate(() => {
  const g = window.game;
  const { enemies, player, engine, camRig } = g;
  T.reload();
  const squad = T.kind('trooper');
  const out = { count: squad.length, steps: [] };
  // really walk in: W with the camera facing north, from the corridor into the room
  player.pos.set(0, 0, -9);
  camRig.yaw = 0;
  engine.input.keys.add('KeyW');
  T.bolts = 0;
  let alertedAt = null;
  for (let i = 0; i < 60 * 14; i++) {
    T.god();
    engine.step(1 / 60);
    if (i === 60 * 2.4) engine.input.keys.delete('KeyW'); // ~11 m in, about z -20
    if (alertedAt === null && squad.some((t) => t.alerted)) alertedAt = { frame: i, z: +player.pos.z.toFixed(1) };
  }
  engine.input.keys.delete('KeyW');
  out.alertedAt = alertedAt;
  out.player = player.pos.toArray().map((v) => +v.toFixed(1));
  out.alerted = squad.map((t) => t.alerted);
  out.bolts = T.bolts;
  const cover = enemies.cover;
  out.rows = squad.map((t) => ({
    state: t.state,
    spot: t.spot ? `${t.spot.pos.x.toFixed(1)},${t.spot.pos.z.toFixed(1)} ${t.spot.type}` : 'none',
    dist: t.spot ? +t.spot.pos.distanceTo(player.pos).toFixed(1) : null,
    protects: !!t.spot && cover.protects(t.spot, player.pos),
    arrived: !!t.spot && t.pos.distanceTo(t.spot.pos) < 0.3,
  }));
  out.distinct = new Set(squad.map((t) => t.spot)).size;
  out.inside = squad.some((t) => { const v = t.pos.clone(); g.world.collideCircle(v, 0.38, 1.8, 0.45); return v.distanceTo(t.pos) > 0.01; });
  return out;
});
show('troopers after walking into their room', tr.rows);
console.log(`  squad alerted when the player was at z ${tr.alertedAt?.z}; bolts fired: ${tr.bolts}; player at ${tr.player}`);
expect('troopers: walking into the room wakes the whole squad', tr.alertedAt !== null && tr.alerted.every(Boolean), JSON.stringify(tr.alerted));
expect('troopers: each picks its own cover spot, 6-34 m from the player (cover.js range + retreat)', tr.rows.every((r) => r.spot !== 'none' && r.dist >= 6 && r.dist <= 34.5) && tr.distinct === 3, JSON.stringify(tr.rows));
expect('troopers: the spot (or the one they are moving to) blocks the player', tr.rows.every((r) => r.protects || r.state === 'move'), JSON.stringify(tr.rows));
expect('troopers: they shoot back', tr.bolts > 0);
expect('troopers: never stand inside geometry', !tr.inside);

// =====================================================================================================
// 4. K freezes the AI, 5. L stands them down, 6. J respawns
// =====================================================================================================
const fz = await p.evaluate(() => {
  const g = window.game;
  const { enemies, player } = g;
  const snap = () => enemies.puppets.map((e) => [e.pos.x, e.pos.y, e.pos.z, e.timer ?? 0, e.state ?? '', e.yaw].join('|'));
  T.key('KeyK');
  const on = enemies.frozen;
  const before = snap();
  T.hold(player.pos.x, player.pos.z, 3);
  const after = snap();
  const panel = g.tool.panel.textContent;
  T.key('KeyK');
  const off = !enemies.frozen;
  T.hold(player.pos.x, player.pos.z, 3);
  const later = snap();
  return { on, still: before.every((s, i) => s === after[i]), panelOn: /freeze AI\s+ON/.test(panel), off, moved: before.some((s, i) => s !== later[i]), n: before.length };
});
expect('K: freezes the AI (K again releases it)', fz.on && fz.off);
expect('K: every enemy keeps position, yaw, state and timer over 180 frames while frozen', fz.still, `${fz.n} enemies`);
expect('K: they think again afterwards; the panel shows the toggle', fz.moved && fz.panelOn);

const lz = await p.evaluate(() => {
  const g = window.game;
  const { enemies, player } = g;
  const out = {};
  T.key('KeyL');
  out.on = enemies.demo === true && /hidden\s+ON/.test(g.tool.panel.textContent);
  T.hold(player.pos.x, player.pos.z, 3); // bursts already under way end
  T.bolts = 0;
  T.hurts = 0;
  T.hold(player.pos.x, player.pos.z, 10);
  out.boltsHidden = T.bolts;
  out.states = T.kind('trooper').map((t) => t.state);
  T.key('KeyL');
  out.off = enemies.demo === false;
  T.bolts = 0;
  T.hold(player.pos.x, player.pos.z, 15);
  out.boltsSeen = T.bolts;
  return out;
});
expect('L: player invisible, the squad stands down: no bolts in 10 s (and the panel says so)', lz.on && lz.boltsHidden === 0, JSON.stringify(lz));
expect('L: visible again, they shoot', lz.off && lz.boltsSeen > 0, JSON.stringify(lz));

const jr = await p.evaluate(() => {
  const g = window.game;
  const { enemies, player } = g;
  const out = {};
  const old = enemies.puppets.slice();
  T.kind('trooper')[0].damage(999, player.pos.clone(), player.pos.clone().set(0, 0, 1), 'torso');
  T.step(1);
  out.killed = enemies.kills;
  T.key('KeyK');
  T.key('KeyL');
  const before = player.pos.toArray();
  T.key('KeyJ');
  out.fresh = enemies.puppets.length === old.length && enemies.puppets.every((e) => !old.includes(e)) && enemies.puppets.every((e) => e.alive);
  out.kills = enemies.kills;
  out.bolts = enemies.bolts.length;
  out.same = player.pos.toArray().every((v, i) => v === before[i]);
  out.togglesKept = enemies.frozen === true && enemies.demo === true;
  out.atSpawn = T.kind('trooper').every((t, i) => t.pos.z === -44 && t.state === 'idle' && !t.spot);
  out.spotsFree = enemies.cover.spots.every((s) => !s.owner);
  out.tags = g.tool.tags.length === enemies.puppets.length && g.tool.tags.every((t) => enemies.puppets.includes(t.enemy));
  out.helpers = g.helpers.length === enemies.puppets.filter((e) => e.rig).length;
  T.key('KeyK');
  T.key('KeyL');
  T.hold(0, -9, 6); // thaw: everything works on the fresh squad (player at the corridor mouth)
  out.afterOk = !enemies.frozen && !enemies.demo;
  return out;
});
expect('J: respawns every enemy (fresh objects, all alive, kills 0, bolts cleared)', jr.killed === 1 && jr.fresh && jr.kills === 0 && jr.bolts === 0, JSON.stringify(jr));
expect('J: the player keeps the position; K and L stay as they were', jr.same && jr.togglesKept, JSON.stringify(jr));
expect('J: squad back at the spawn, idle, with every cover spot free; overlays follow the new enemies', jr.atSpawn && jr.spotsFree && jr.tags && jr.helpers, JSON.stringify(jr));

// =====================================================================================================
// 7. the other rooms: puppets, drone, spider (wake rules; L applies to every enemy kind)
// =====================================================================================================
const rooms = await p.evaluate(() => {
  const g = window.game;
  const { enemies, player } = g;
  const out = {};
  // puppets: shooters pop up and fire from 20 m, and stand down while the player is hidden
  T.reload();
  for (const e of enemies.puppets) if (e.kind !== 'shooter') e.alive = false;
  enemies.dirty = true;
  T.bolts = 0;
  T.hold(-20, 0, 12);
  out.shooterFire = T.bolts;
  T.key('KeyL');
  T.hold(-20, 0, 3);
  T.bolts = 0;
  T.hold(-20, 0, 10);
  out.shooterHidden = T.bolts;
  T.key('KeyL');
  // drone: dormant outside its wake range, awake inside the room (36 m, line of sight)
  T.reload();
  for (const e of enemies.puppets) if (e.kind !== 'drone') e.alive = false;
  const drone = T.kind('drone')[0];
  T.hold(0, 6, 4);
  out.droneHub = drone.awake;
  T.key('KeyL');
  T.hold(0, 26, 4);
  out.droneHidden = drone.awake;
  T.key('KeyL');
  T.bolts = 0;
  T.hold(0, 26, 6);
  out.droneAwake = drone.awake;
  out.droneFire = T.bolts;
  // spider: dormant in the corridor (> 28 m, no line of sight), wakes the moment the player is in the arena
  T.reload();
  for (const e of enemies.puppets) if (e.kind !== 'boss') e.alive = false;
  const boss = enemies.boss;
  T.hold(10, 0, 4);
  out.bossCorridor = boss.awake;
  T.hold(24, 0, 1);
  out.bossArena = boss.awake;
  return out;
});
expect('puppets: shooters fire at 20 m, and not while the player is hidden (L)', rooms.shooterFire > 0 && rooms.shooterHidden === 0, JSON.stringify(rooms));
expect('drone: asleep from the hub side and while the player is hidden, awake and firing in its room', !rooms.droneHub && !rooms.droneHidden && rooms.droneAwake && rooms.droneFire > 0, JSON.stringify(rooms));
expect('spider: dormant in its corridor, awake as soon as the player is inside the arena bounds', !rooms.bossCorridor && rooms.bossArena, JSON.stringify(rooms));

// =====================================================================================================
// 8. overlays: toggle, state, and everything is freed on a scene switch
// =====================================================================================================
const ovl = await p.evaluate(() => {
  const g = window.game;
  const { enemies, player, engine } = g;
  const out = {};
  T.reload();
  const t = g.tool;
  g.camRig.yaw = Math.PI / 2; // looking west into the puppet room: the state texts show for what the camera sees
  T.hold(-20, 0, 1);
  out.tagsText = t.tags.filter((x) => x.text && x.el.style.display !== 'none').length;
  out.describe = enemies.puppets.every((e) => /^\w+/.test(t.constructor.describe(e)));
  g.camRig.yaw = 0;
  T.hold(0, -17, 12);
  const reserved = t.spots.filter((s) => s.owner).length;
  out.reserved = reserved;
  out.markersReserved = [...t.markerKey].filter((k) => k === 2).length;
  out.drawn = t.lines.geometry.drawRange.count;
  T.key('KeyO');
  out.hidden = !t.group.visible && t.layer.style.display === 'none' && /overlays\s+off/.test(t.panel.textContent);
  T.key('KeyO');
  out.shown = t.group.visible && t.layer.style.display !== 'block' && /overlays\s+ON/.test(t.panel.textContent);
  const count = () => { let n = 0; engine.scene.traverse(() => n++); return n; };
  const dom = () => document.body.children.length;
  out.before = { objects: count(), dom: dom() };
  T.key('KeyK'); // leave a toggle on: leaving the room must reset it
  const panel = t.panel;
  const layer = t.layer;
  g.loadScene('arena');
  out.gone = g.tool === null && !panel.isConnected && !layer.isConnected && !engine.scene.getObjectByName('gym-ai overlays');
  out.reset = enemies.frozen === false && enemies.demo === false;
  T.key('KeyK');
  T.key('KeyL');
  T.key('KeyJ');
  T.key('KeyO');
  out.deadKeys = enemies.frozen === false && enemies.demo === false;
  g.loadScene('gym-ai');
  out.back = g.tool?.constructor.name === 'AiTool' && g.tool.rings.length > 0;
  out.after = { objects: count(), dom: dom() };
  return out;
});
expect('overlays: state texts show over what the camera sees, spots reserved by troopers are marked, lines are drawn', ovl.tagsText > 0 && ovl.describe && ovl.reserved > 0 && ovl.reserved === ovl.markersReserved && ovl.drawn > 0, JSON.stringify(ovl));
expect('O: toggles the overlays and the panel line', ovl.hidden && ovl.shown, JSON.stringify(ovl));
expect('leaving the scene frees the panel, labels, overlay meshes and listeners; K L J O do nothing outside', ovl.gone && ovl.reset && ovl.deadKeys, JSON.stringify(ovl));
expect('coming back rebuilds the same scene object and DOM count (no leak)', ovl.back && ovl.before.objects === ovl.after.objects && ovl.before.dom === ovl.after.dom, JSON.stringify(ovl));

// =====================================================================================================
// MEASUREMENTS (printed). Item 13: trooper route clearance through gaps of 0.6-1.5 m
// =====================================================================================================
const gaps13 = await p.evaluate(() => {
  const g = window.game;
  const { enemies, world, player } = g;
  const cover = enemies.cover;
  const V = player.pos.constructor;
  const room = T.room.troopers;
  const inRoom = (b) => b.min.x > room.minX && b.max.x < room.maxX && b.min.z > room.minZ && b.max.z < room.maxZ;
  const rows = new Map();
  for (const c of world.colliders) {
    if (!c.cover || c.cover === 'wall' || !inRoom(c.box)) continue;
    const key = (c.box.min.z + c.box.max.z) / 2;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(c.box);
  }
  // walk a trooper-sized body (r 0.4, step 0.45: trooper.js TUNING) along a path, as Trooper.think moves it
  const walk = (from, path) => {
    const pos = from.clone();
    let stuckAt = null;
    for (const goal of path) {
      for (let i = 0; i < 60 * 4; i++) {
        const d = goal.clone().sub(pos).setY(0);
        const left = d.length();
        if (left < 0.15) break;
        const before = pos.clone();
        pos.addScaledVector(d.divideScalar(left), Math.min(4.6 / 60, left));
        world.collideCircle(pos, 0.4, 1.8, 0.45);
        if (i > 20 && pos.distanceTo(before) < 4.6 / 60 * 0.2) { stuckAt = pos.clone(); break; }
      }
      if (stuckAt) break;
    }
    return { ok: !stuckAt, at: pos };
  };
  const rowsOut = [];
  for (const [zc, boxes] of [...rows.entries()].sort((a, b) => b[0] - a[0])) { // south to north
    boxes.sort((a, b) => a.min.x - b.min.x);
    const h = boxes[0].max.y - boxes[0].min.y;
    const th = boxes[0].max.z - boxes[0].min.z;
    for (let i = 0; i < boxes.length - 1; i++) {
      const b1 = boxes[i];
      const b2 = boxes[i + 1];
      const gap = +(b2.min.x - b1.max.x).toFixed(2);
      const xg = (b1.max.x + b2.min.x) / 2;
      const front = new V(xg, 0, zc + th / 2 + 3);
      const back = new V(xg, 0, zc - th / 2 - 3);
      const straight = world.segmentClear(front, back, 0.35);
      const body = walk(front, [back]);
      // back-face spots of the two boxes next to the gap: the ones a trooper in front of the row would be sent to
      const near = [b1, b2].map((bx) => cover.spots.filter((s) => s.box === bx && s.normal.z < 0).sort((a, c) => Math.abs(a.pos.x - xg) - Math.abs(c.pos.x - xg))[0]).filter(Boolean);
      const routes = near.map((s) => {
        const r = cover.route(front, s);
        if (!r) return { found: false };
        const pts = [front, ...r.path, s.pos];
        let viaGap = false;
        for (let k = 0; k < pts.length - 1; k++) {
          const a = pts[k];
          const c = pts[k + 1];
          if (a.z > zc && c.z < zc) {
            const x = a.x + ((c.x - a.x) * (a.z - zc)) / (a.z - c.z);
            if (x > b1.max.x - 0.01 && x < b2.min.x + 0.01) viaGap = true;
          }
        }
        return { found: true, viaGap, len: +r.length.toFixed(1), reached: walk(front, [...r.path, s.pos]).ok };
      });
      rowsOut.push({ row: `${h.toFixed(1)} m @ z ${zc}`, gap, planner: straight, bodyPasses: body.ok, routesFound: routes.filter((r) => r.found).length + '/' + routes.length, viaGap: routes.filter((r) => r.viaGap).length, walked: routes.filter((r) => r.reached).length, stuckWalks: routes.filter((r) => r.found && !r.reached).length });
    }
  }
  // forced crossings: a trooper 2 m in front of the low row (z -23.5) with the player 8 m south of it must reach
  // cover behind the row. cover.find picks the spot and the route; which gap (or row end) does it use?
  const sweep = { starts: 0, noCover: 0, picked: {}, inGapWidth: {}, throughGap: {}, aroundEnds: 0, walked: 0 };
  const probe = T.kind('trooper')[0];
  const row1 = T.rowsInfo()[0].zc;
  for (let xs = -14; xs <= 14.01; xs += 0.5) {
    const from = new V(xs, 0, -23.5);
    const found = cover.find(probe, from, new V(xs, 0, -15.5), 0, {});
    sweep.starts++;
    if (!found) { sweep.noCover++; continue; }
    const sp = found.spot;
    const kind = sp.box.max.y - sp.box.min.y > 5 ? 'room wall' : sp.normal.z < -0.5 ? 'north face (behind the row)' : sp.normal.z > 0.5 ? 'south face' : 'end face (inside a gap)';
    sweep.picked[kind] = (sweep.picked[kind] ?? 0) + 1;
    if (kind.startsWith('end')) {
      const gp = T.rowsInfo()[0].gaps.find((q) => sp.pos.x > q.x0 && sp.pos.x < q.x1);
      if (gp) sweep.inGapWidth[gp.w] = (sweep.inGapWidth[gp.w] ?? 0) + 1;
    }
    const cr = T.crossings([from, ...found.path, sp.pos]).filter((c) => c.row === row1);
    for (const c of cr) {
      if (c.how === 'end') sweep.aroundEnds++;
      else sweep.throughGap[c.how] = (sweep.throughGap[c.how] ?? 0) + 1;
    }
    if (walk(from, [...found.path, found.spot.pos]).ok) sweep.walked++;
  }
  return { rowsOut, sweep };
});
const gaps = gaps13.rowsOut;
console.log('item 13: forced crossings of the low row (cover.find from z -23.5, player 8 m south, 57 starts across the room):', JSON.stringify(gaps13.sweep));
show('item 13: gaps between boxes (planner = segmentClear r 0.35, body = walk with collideCircle r 0.4, routes = cover.route to the two back-face spots beside the gap)', gaps);
const g10 = gaps.filter((r) => r.gap >= 0.99 && r.gap <= 1.01);
const g06 = gaps.find((r) => r.gap === 0.6);
expect('gaps: a 1.0 m gap routes and walks through (metrics: 1.0 passes)', g10.length > 0 && g10.every((r) => r.planner && r.bodyPasses), JSON.stringify(g10));
expect('gaps: a 0.6 m gap is neither planned nor walkable', g06 && !g06.planner && !g06.bodyPasses, JSON.stringify(g06));

// =====================================================================================================
// Item 14: cover spots of the layout, reserved spots and chosen distances during fights
// =====================================================================================================
const c14 = await p.evaluate(() => {
  const g = window.game;
  const { enemies, world, player } = g;
  const cover = enemies.cover;
  const room = T.room.troopers;
  const inRoom = (p) => p.x > room.minX && p.x < room.maxX && p.z > room.minZ && p.z < room.maxZ;
  const spots = cover.spots.filter((s) => inRoom(s.pos));
  const cov = () => enemies.cover;
  const hOf = (s) => s.box.max.y - s.box.min.y;
  const perBox = {};
  for (const s of spots) {
    const k = `${hOf(s) > 5 ? 'wall' : s.type} ${(s.box.max.x - s.box.min.x).toFixed(1)}x${(s.box.max.z - s.box.min.z).toFixed(1)}`;
    perBox[k] ??= new Set();
    perBox[k].add(s.box);
  }
  const boxSpots = Object.entries(perBox).map(([k, set]) => ({ box: k, boxes: set.size, spotsPerBox: +(spots.filter((s) => `${hOf(s) > 5 ? 'wall' : s.type} ${(s.box.max.x - s.box.min.x).toFixed(1)}x${(s.box.max.z - s.box.min.z).toFixed(1)}` === k).length / set.size).toFixed(1) }));
  const out = { total: spots.length, byType: { low: spots.filter((s) => hOf(s) < 5 && s.type === 'low').length, high: spots.filter((s) => hOf(s) < 5 && s.type === 'high').length, wall: spots.filter((s) => hOf(s) > 5).length }, boxSpots, fights: [] };
  const t = cover.t;
  // viable spots per player position: protects, 6-28 m, same floor
  const viable = (P) => {
    const list = spots.filter((s) => { const d = s.pos.distanceTo(P); return d >= t.minRange && d <= t.maxRange && cov().protects(s, P); });
    const bearings = new Set(list.map((s) => Math.round(Math.atan2(s.pos.x - P.x, s.pos.z - P.z) / (25 * Math.PI / 180))));
    return { n: list.length, low: list.filter((s) => s.type === 'low' && hOf(s) < 5).length, high: list.filter((s) => s.type === 'high' && hOf(s) < 5).length, wall: list.filter((s) => hOf(s) > 5).length, bearings: bearings.size };
  };
  const info = T.rowsInfo();
  out.crossGaps = {};
  out.crossEnds = 0;
  out.crossBox = 0;
  out.stuckBy = { squadmate: 0, atGap: 0, other: 0 };
  const stand = [['door', 0, -16.5], ['row 1 front', 0, -22], ['west flank', -12, -20], ['east flank', 12, -20], ['between rows', 0, -32]];
  for (const [name, x, z] of stand) {
    T.reload();
    const fresh = enemies.cover.spots.filter((s) => inRoom(s.pos)); // reload built a new cover map
    spots.length = 0;
    spots.push(...fresh);
    const squad = T.kind('trooper');
    for (const e of squad) e.alert(); // wake them all: the wake rule is measured elsewhere
    const P = new player.pos.constructor(x, 0, z);
    const via = viable(new player.pos.constructor(x, 0, z));
    const dists = [];
    const last = new Map();
    let maxReserved = 0;
    let stuck = 0;
    let noCover = 0;
    let picks = 0;
    const moveSince = new Map();
    const prev = new Map();
    T.bolts = 0;
    for (let i = 0; i < 60 * 25; i++) {
      player.pos.copy(P);
      T.god();
      g.engine.step(1 / 60);
      for (const e of squad) { // every crossing of a cover row: through which gap, or round its end
        if (!e.alive) continue;
        const pv = prev.get(e);
        if (pv) {
          for (const c of T.crossings([pv, e.pos])) {
            if (c.how === 'end') out.crossEnds++;
            else if (c.how === 'box') out.crossBox++;
            else out.crossGaps[c.how] = (out.crossGaps[c.how] ?? 0) + 1;
          }
        }
        prev.set(e, e.pos.clone());
      }
      if (i % 15) continue;
      maxReserved = Math.max(maxReserved, spots.filter((s) => s.owner).length);
      for (const e of squad) {
        if (!e.alive || !e.alerted) continue;
        if (e.spot && last.get(e) !== e.spot) { last.set(e, e.spot); dists.push(e.spot.pos.distanceTo(P)); picks++; }
        if (!e.spot) noCover++;
        // stuck: moving to a spot but not getting anywhere for 3 s
        if (e.state === 'move') {
          const m = moveSince.get(e);
          if (m && m.spot === e.spot && e.pos.distanceTo(m.pos) < 0.3) { if (++m.n >= 12) {
            stuck++;
            moveSince.delete(e);
            const bySquad = squad.some((o) => o !== e && o.alive && o.pos.distanceTo(e.pos) < 1.1);
            const atGap = info.some((r) => Math.abs(e.pos.z - r.zc) < 1.5 && r.gaps.some((q) => e.pos.x > q.x0 - 1 && e.pos.x < q.x1 + 1));
            out.stuckBy[bySquad ? 'squadmate' : atGap ? 'atGap' : 'other']++;
          } } else moveSince.set(e, { spot: e.spot, pos: e.pos.clone(), n: 0 });
        } else moveSince.delete(e);
      }
    }
    dists.sort((a, b) => a - b);
    out.fights.push({
      player: `${name} (${x}, ${z})`,
      viable: via.n,
      'low/high/wall': `${via.low}/${via.high}/${via.wall}`,
      bearings25: via.bearings,
      picks,
      reserved: maxReserved,
      min: +(dists[0] ?? NaN).toFixed(1),
      median: +(dists[dists.length >> 1] ?? NaN).toFixed(1),
      max: +(dists[dists.length - 1] ?? NaN).toFixed(1),
      inRange: dists.filter((d) => d >= 6 && d <= 28).length + '/' + dists.length,
      noCover,
      stuckMoves: stuck,
      bolts: T.bolts,
    });
  }
  return out;
});
console.log(`\nitem 14: cover spots in the trooper room: ${c14.total} (low ${c14.byType.low}, high ${c14.byType.high}, wall faces ${c14.byType.wall})`);
console.table(c14.boxSpots);
console.log('item 14: emergent crossings of the cover rows by the squad over the 5 fights: through gaps (width: count)', JSON.stringify(c14.crossGaps), `· round the row ends ${c14.crossEnds} · through a box ${c14.crossBox}`);
console.log('item 14: stuck moves (3 s without progress) by cause:', JSON.stringify(c14.stuckBy));
show('item 14: viable spots (protect, 6-28 m) and what the squad of 3 chose over 25 s per player position', c14.fights);
expect('cover: the layout offers spots, and every pick is inside the cover range window (6-34 m)', c14.total > 20 && c14.fights.every((f) => f.picks > 0 && f.min >= 6 && f.max <= 34.5), JSON.stringify(c14.fights));

// =====================================================================================================
// Item 15: drone against walls of 2.8-5.0 m, and the safe zone behind low / high cover
// =====================================================================================================
const dr = await p.evaluate(() => {
  const g = window.game;
  const { enemies, world, player } = g;
  const V = player.pos.constructor;
  const out = { walls: [], safe: [] };
  // (a) flight over walls: drone starts 2.5 m before the wall, the player is 20 m behind it; the drone flies at the
  // player in a straight line (> 18 m), so it must cross the wall at its flight altitude
  const heights = [2.8, 3.2, 3.6, 4.0, 4.4, 5.0];
  for (const alt of [3.5, 4.25, 5.0]) {
    heights.forEach((h, i) => {
      const xw = -23 + i * 5;
      T.reload();
      for (const e of enemies.puppets) if (e.kind !== 'drone') e.alive = false;
      const d = T.kind('drone')[0];
      const dir = xw > -8 ? -1 : 1; // fly toward the open side of the room
      d.alt = alt;
      d.awake = true;
      d.pos.set(xw - 2.5 * dir, 0, 32);
      d.vel.set(0, 0, 0);
      d.orbit = 0; // no circling: a straight approach, so it meets the wall head on
      d.orbitTimer = 1e9;
      let crossed = false;
      let around = false;
      let minY = Infinity;
      let closest = Infinity;
      let yAt = null;
      for (let f = 0; f < 60 * 12 && !crossed; f++) {
        player.pos.set(xw + 20 * dir, 0, 32);
        T.god();
        g.engine.step(1 / 60);
        const x = d.root.position.x;
        const z = d.root.position.z;
        const inside = Math.abs(x - xw) < 0.45 && Math.abs(z - 32) < 3.2;
        if (inside) minY = Math.min(minY, d.root.position.y);
        closest = Math.min(closest, Math.abs(x - xw));
        if ((x - xw) * dir > 0.3) { // across the plane of the wall
          crossed = true;
          around = Math.abs(z - 32) >= 3;
          yAt = +d.root.position.y.toFixed(2);
        }
      }
      out.walls.push({ alt, wall: h, crossed, how: crossed ? (around ? 'around the end' : 'over / through') : 'blocked', minYinWall: minY === Infinity ? null : +minY.toFixed(2), bodyInsideWall: minY !== Infinity && minY < h, closest: +closest.toFixed(2) });
    });
  }
  // (b) safe depth behind cover against a drone above (sight ray as in drone.js: muzzle to chest, ends 0.5 short)
  // low cover z 20.5..21.5 (1.1 m), high cover z 20.7..21.3 (2.8 m); drone on the +z side, D m from the near face
  const room = T.room.drone;
  const find = (kind) => world.colliders.find((c) => c.cover === kind && c.box.min.x > room.minX && c.box.max.x < room.maxX && c.box.min.z > room.minZ && c.box.max.z < room.maxZ).box;
  const cov = {};
  for (const kind of ['low', 'high']) {
    const bx = find(kind);
    cov[kind] = { h: bx.max.y, nearZ: bx.max.z, farZ: bx.min.z, x: (bx.min.x + bx.max.x) / 2, box: bx };
  }
  for (const [kind, c] of Object.entries(cov)) {
    const cast = (a, b) => T.hits(a, b, c.box); // only this cover: the room walls are not what is measured
    for (const [posture, chestY] of [['stand', 1.26], ['crouch', 0.735]]) {
      for (const alt of [3.5, 5.0]) {
        const row = { cover: `${kind} ${c.h}`, posture, drone: `${alt} m up` };
        for (const D of [6, 9, 12, 15]) {
          const dz = c.nearZ + D; // drone body z; muzzle 0.72 toward the player
          const muzzle = new V(c.x, alt - 0.1, dz - 0.72);
          let depth = 0;
          for (let d = 0; d <= 24; d += 0.05) { // player chest d m behind the far face
            const chest = new V(c.x, chestY, c.farZ - d);
            if (cast(muzzle, chest)) depth = d;
            else if (d > depth + 0.3) break;
          }
          row[`D${D}`] = depth >= 23.9 ? '>24' : depth === 0 ? (cast(muzzle, new V(c.x, chestY, c.farZ - 0.4)) ? 0.05 : 0) : +depth.toFixed(2);
        }
        out.safe.push(row);
      }
    }
  }
  return out;
});
show('item 15a: drone flying at the player through a wall (alt = flight altitude of the drone)', dr.walls);
show('item 15b: safe depth (m behind the far face) where the chest is hidden from a drone D m (horizontal) from the near face; 0 = never hidden', dr.safe);
const w50 = dr.walls.find((r) => r.alt === 3.5 && r.wall === 5.0);
const w28 = dr.walls.find((r) => r.alt === 5.0 && r.wall === 2.8);
expect('drone: a 5.0 m wall stops a drone flying at 3.5 m (it never crosses straight through)', w50 && (!w50.crossed || w50.how === 'around the end'), JSON.stringify(w50));
expect('drone: a 2.8 m wall does not stop a drone flying at 5.0 m', w28 && w28.crossed && w28.how === 'over / through', JSON.stringify(w28));
expect('drone: standing chest (1.26) is never hidden behind low cover (1.1)', dr.safe.filter((r) => r.cover.startsWith('low') && r.posture === 'stand').every((r) => r.D6 === 0 && r.D9 === 0 && r.D12 === 0 && r.D15 === 0), JSON.stringify(dr.safe));

// =====================================================================================================
// Item 17: spider mech in lanes of 5-9 m, leg / wall clipping, blasts against cover
// =====================================================================================================
const sp = await p.evaluate(() => {
  const g = window.game;
  const { enemies, world, player } = g;
  const V = player.pos.constructor;
  const out = { lanes: [], blast: [], legsChecked: 0 };
  const arena = T.room.spider;
  const walls = world.colliders.filter((c) => c.cover === 'wall' && c.box.min.x > arena.minX - 1 && c.box.max.x < arena.maxX + 1 && c.box.min.z > arena.minZ - 1 && c.box.max.z < arena.maxZ + 1).map((c) => c.box);
  const lane = walls.filter((bx) => bx.max.y - bx.min.y < 4 && bx.max.x - bx.min.x < 1);
  const solid = [...walls, ...world.colliders.filter((c) => c.cover && c.box.max.y - c.box.min.y > 2 && c.box.max.x - c.box.min.x < 2 && c.box.min.x > arena.minX && c.box.max.x < arena.maxX).map((c) => c.box)];
  const pen = (pt, bx) => (pt.x > bx.min.x && pt.x < bx.max.x && pt.z > bx.min.z && pt.z < bx.max.z && pt.y > bx.min.y && pt.y < bx.max.y ? Math.min(pt.x - bx.min.x, bx.max.x - pt.x, pt.z - bx.min.z, bx.max.z - pt.z) : 0);
  const k = new V();
  const hip = new V();
  const knee = new V();
  const clip = (boss) => {
    let worst = 0;
    for (const l of boss.legs) {
      if (!l.alive) continue;
      l.femur.getWorldPosition(hip);
      l.tibia.getWorldPosition(knee);
      for (const [a, b] of [[hip, knee], [knee, l.foot]]) {
        for (let s = 1; s <= 10; s++) {
          k.lerpVectors(a, b, s / 10);
          for (const bx of solid) worst = Math.max(worst, pen(k, bx));
        }
      }
    }
    return worst;
  };
  const lanes = [[-16, 5], [-16, 9], [0, 6], [0, 8], [16, 7], [16, 7.2]];
  // lane geometry from the walls themselves
  const laneOf = (zc, w) => {
    const pair = lane.filter((bx) => Math.abs((bx.min.z + bx.max.z) / 2 - zc) < 0.1).sort((a, b) => a.min.x - b.min.x);
    for (let i = 0; i < pair.length - 1; i++) {
      const gap = pair[i + 1].min.x - pair[i].max.x;
      if (Math.abs(gap - w) < 0.05) return { x0: pair[i].max.x, x1: pair[i + 1].min.x, z0: pair[i].min.z, z1: pair[i].max.z };
    }
    return null;
  };
  for (const [zc, w] of lanes) {
    const L = laneOf(zc, w);
    T.reload();
    for (const e of enemies.puppets) if (e.kind !== 'boss') e.alive = false;
    const boss = enemies.boss;
    const xc = (L.x0 + L.x1) / 2;
    const zs = Math.min(arena.maxZ - 3.6, L.z1 + 5);
    boss.pos.set(xc, 0, zs);
    boss.yaw = Math.PI; // facing north
    T.hold(0, 0, 0.1);
    for (let f = 0; f < 60 * 2; f++) { player.pos.set(0, 0, 0); T.god(); g.engine.step(1 / 60); } // dormant: feet settle on the new spot
    boss.awake = true;
    boss.stomp.timer = 99;
    let minWall = Infinity;
    let worst = 0;
    let furthest = zs;
    let entered = false;
    let traversed = null;
    let still = 0;
    let last = boss.pos.clone();
    let frames = 0;
    for (let f = 0; f < 60 * 40; f++) {
      player.pos.set(xc, 0, -58); // far to the north, outside: the spider walks toward it
      T.god();
      g.engine.step(1 / 60);
      frames++;
      const q = boss.pos;
      for (const bx of lane) {
        const dx = Math.max(bx.min.x - q.x, 0, q.x - bx.max.x);
        const dz = Math.max(bx.min.z - q.z, 0, q.z - bx.max.z);
        minWall = Math.min(minWall, Math.hypot(dx, dz));
      }
      if (q.x > L.x0 && q.x < L.x1 && q.z > L.z0 && q.z < L.z1) entered = true;
      furthest = Math.min(furthest, q.z);
      if (traversed === null && q.z < L.z0 - 0.1 && q.x > L.x0 - 1 && q.x < L.x1 + 1) traversed = +(f / 60).toFixed(1);
      worst = Math.max(worst, clip(boss));
      if (f % 60 === 59) { still = q.distanceTo(last) < 0.5 ? still + 1 : 0; last = q.clone(); }
      if (traversed !== null && f > traversed * 60 + 120) break;
    }
    out.legsChecked += frames;
    out.lanes.push({ lane: `${w} m (z ${zc})`, entered, traversed: traversed === null ? 'no' : `${traversed} s`, farthestZ: +furthest.toFixed(1), minDistToWall: +minWall.toFixed(2), 'leg/wall overlap max': +worst.toFixed(2), stuckSeconds: still, legsDown: boss.legsLost });
  }
  // blasts: the player hides behind a 3.2 m lane wall (x 21.7 west face), the mech is 13+ m east. Cover does not matter to
  // a lob: it lands where the player is. Count mortar impacts, hurts, and what a moving player does to the lead.
  const hurts = [];
  const orig = enemies.hurtPlayer.bind(enemies);
  enemies.hurtPlayer = (a, from) => { hurts.push({ a: +a.toFixed(1), from: from.clone() }); orig(a, from); };
  const blasts = [];
  g.engine.events.on('blast', (b) => { if (b.kind === 'mortar' || b.kind === 'stomp') blasts.push({ kind: b.kind, r: b.radius, x: b.point.x, z: b.point.z, px: player.pos.x, pz: player.pos.z }); });
  const wallW = lane.find((bx) => Math.abs(bx.max.x - 30.3) < 0.1 && Math.abs((bx.min.z + bx.max.z) / 2) < 0.1);
  for (const [name, speed] of [['hiding behind a 3.2 m wall, still', 0], ['running back and forth 4.6 m/s', 4.6], ['sprinting back and forth 7.4 m/s', 7.4]]) {
    T.reload();
    for (const e of enemies.puppets) if (e.kind !== 'boss') e.alive = false;
    const boss = enemies.boss;
    boss.pos.set(44, 0, 0);
    for (let f = 0; f < 60 * 2; f++) { player.pos.set(0, 0, 0); T.god(); g.engine.step(1 / 60); }
    boss.awake = true;
    hurts.length = 0;
    blasts.length = 0;
    let wallBetween = 0;
    let dir = 1;
    let vx = 0;
    const upd = player.update;
    player.update = function (...a) { upd.apply(this, a); this.vel.set(vx, 0, 0); }; // the player system recomputes vel from input
    let x = speed ? 32 : wallW.min.x - 1.2;
    const z0 = speed ? 8 : 0; // the free band between the wall rows when running
    for (let f = 0; f < 60 * 45; f++) {
      if (speed) {
        x += dir * speed / 60;
        if (x > 62 || x < 32) dir = -dir;
        vx = dir * speed;
      }
      player.pos.set(x, 0, z0);
      T.god();
      const nb = blasts.length;
      g.engine.step(1 / 60);
      for (let i = nb; i < blasts.length; i++) {
        const bl = blasts[i];
        const a = new V(bl.x, 1, bl.z);
        const b2 = new V(player.pos.x, 1, player.pos.z);
        if (walls.some((bx) => bx.max.y > 3 && T.hits(a, b2, bx, 0))) wallBetween++;
      }
    }
    delete player.update;
    const mort = blasts.filter((q) => q.kind === 'mortar');
    const d = mort.map((q) => Math.hypot(q.x - q.px, q.z - q.pz));
    out.blast.push({
      player: name,
      mortars: mort.length,
      hurt: hurts.filter((h) => h.a > 0).length,
      'mean miss (m)': d.length ? +(d.reduce((s, v) => s + v, 0) / d.length).toFixed(1) : null,
      'inside 3.6 m': d.filter((v) => v <= 3.6).length,
      'wall between impact and player': wallBetween,
      stomps: blasts.filter((q) => q.kind === 'stomp').length,
    });
  }
  // stomp: the player 4.6 m from the mech with a 3.2 m lane wall between them (stomp radius 7)
  {
    T.reload();
    for (const e of enemies.puppets) if (e.kind !== 'boss') e.alive = false;
    const boss = enemies.boss;
    boss.pos.set(40.6, 0, 0);
    for (let f = 0; f < 60 * 2; f++) { player.pos.set(0, 0, 0); T.god(); g.engine.step(1 / 60); }
    boss.awake = true;
    boss.mortarTimer = 99;
    boss.gun.timer = 99;
    hurts.length = 0;
    blasts.length = 0;
    for (let f = 0; f < 60 * 6; f++) { player.pos.set(36.0, 0, 0); T.god(); g.engine.step(1 / 60); } // inside lane 6, behind the wall at x 36.3-36.9
    const st = blasts.filter((q) => q.kind === 'stomp');
    out.stomp = { stomps: st.length, hurt: hurts.length, radius: st[0]?.r, playerToImpact: st[0] ? +Math.hypot(st[0].x - 36, st[0].z).toFixed(1) : null, mechX: +boss.pos.x.toFixed(1) };
  }
  return out;
});
show('item 17a: spider walking north through each lane toward a player 60 m away (center clearance needs r 3.6: lanes under 7.2 m should refuse it)', sp.lanes);
show('item 17b: mortar (r 3.6) and stomp (r 7) against cover; the lob lands on the player, the wall does not matter', sp.blast);
console.log('item 17c: stomp at 4.5 m', JSON.stringify(sp.stomp), `; frames checked for leg clipping: ${sp.legsChecked}`);
const narrow = sp.lanes.filter((l) => /^(5|6|7) m/.test(l.lane));
const wide = sp.lanes.filter((l) => /^(8|9) m/.test(l.lane));
expect('spider: collision keeps the body center >= 3.5 m from every freestanding wall (r 3.6)', sp.lanes.every((l) => l.minDistToWall >= 3.5), JSON.stringify(sp.lanes));
expect('spider: it never enters a lane narrower than its 7.2 m span (5, 6, 7 m)', narrow.every((l) => !l.entered), JSON.stringify(narrow));
expect('spider: it cannot be hurt by walls or leave the arena (still alive, all legs attached)', sp.lanes.every((l) => l.legsDown === 0));

expect('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall ok');
process.exit(fail.length ? 1 : 0);
