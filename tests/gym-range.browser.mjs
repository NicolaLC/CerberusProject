// Gym weapon range (?scene=gym-range, #65) as a fixture for gunplay: damage falloff of every gun against the
// dummies on the lane, dummies that survive, the tool's markers / dots / keys, spread per gun, and metric item 16
// (do troopers fire across 30-40 m?). Engine stopped and stepped at exact 1/60 s, seeded RNG.
// Needs the dev server: `npm run dev`, then `node tests/gym-range.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const u = new URL(BASE);
u.searchParams.set('scene', 'gym-range');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(u.href);
await p.waitForFunction(() => window.game?.engine);

const result = await p.evaluate(async () => {
  const { GUNS } = await import('/src/game/combat/guns.js'); // the game's own table: same module instance
  const g = window.game;
  const { engine, player, camRig, weapon, enemies, world } = g;
  engine.stop();
  engine.headless = true; // simulate only: nothing here checks pixels
  const keys = engine.input.keys;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const press = (code, frames = 1) => { keys.add(code); engine.input.pressed.add(code); step(frames); keys.delete(code); };
  const key = (code) => dispatchEvent(new KeyboardEvent('keydown', { code }));
  const V3 = player.pos.constructor;
  const tool = g.tool;
  const out = { guns: {} };
  const GUN_KEYS = { rifle: 'Digit1', mg: 'Digit2', sniper: 'Digit3', burst: 'Digit4', rail: 'Digit5', pistol: 'Digit6' };
  // independent copy of the falloff rule in guns.js (1 up to start, linear to min at end)
  const fall = (f, d) => (!f || d <= f.start ? 1 : d >= f.end ? f.min : 1 + ((d - f.start) / (f.end - f.start)) * (f.min - 1));
  const zoneMult = (t, zone) => (zone === 'weak' ? t.weakMult : zone === 'head' ? t.headMult : zone === 'limb' ? t.limbMult : 1);

  // --- the room ---
  const dummies = enemies.puppets.filter((e) => e.kind === 'static').sort((a, c) => c.pos.z - a.pos.z);
  out.dummyDistances = dummies.map((d) => -d.pos.z);
  out.labels = world.labels.length;
  out.tool = tool?.constructor.name;
  out.lane = { minZ: Math.min(...world.colliders.map((c) => c.box.min.z)), maxZ: Math.max(...world.colliders.map((c) => c.box.max.z)) };
  out.crates = g.pickups.items.map((i) => i.type).sort().join();
  out.panelInDom = !!document.getElementById('range-panel');

  const select = (id) => { press(GUN_KEYS[id]); step(40); weapon.state[id].ammo = GUNS[id].mag; };
  const chestOf = (e) => e.rig.bones.Spine2.getWorldPosition(new V3());
  const track = (at) => {
    const c = camRig.camera.position;
    camRig.yaw = Math.atan2(-(at.x - c.x), -(at.z - c.z));
    camRig.pitch = Math.atan2(at.y - c.y, Math.hypot(at.x - c.x, at.z - c.z));
  };

  // Where to stand (x, on the firing line side) for the clearest line to a dummy: the widest gap to every nearer
  // dummy, with the line also clear of the recoil wall (x < -2 at z -10) and the cover bay (x > 4.5 at z -29..-36).
  // A muzzle sits to the side of the player, so a line needs a metre or so around it. Returns { x, gap }.
  const clearX = (dummy, zp) => {
    const at = (xp, z) => xp + (dummy.pos.x - xp) * ((zp - z) / (zp - dummy.pos.z));
    const gap = (xp) => {
      if (dummy.pos.z < -10 && at(xp, -10) < -1.8) return -1;
      if (dummy.pos.z < -29 && [-29, -32, -36].some((z) => at(xp, z) > 4.3)) return -1;
      return Math.min(99, ...dummies.filter((o) => o !== dummy && o.pos.z < zp && o.pos.z > dummy.pos.z).map((o) => Math.abs(at(xp, o.pos.z) - o.pos.x)));
    };
    let x = dummy.pos.x;
    for (let xp = -1.7; xp <= 6.31; xp += 0.1) if (gap(xp) > gap(x) + 1e-9) x = xp;
    return { x, gap: gap(x) };
  };
  out.layout = dummies.map((d) => ({ at: -d.pos.z, x: d.pos.x, ...clearX(d, 0.5) })); // from the firing line stance
  // Aim at the dummy's chest from `D` metres (player on the dummy's x, behind it), fire until the first hit.
  function shoot(id, dummy, D) {
    const t = GUNS[id];
    player.pos.set(clearX(dummy, dummy.pos.z + D).x, 0, dummy.pos.z + D);
    player.vel.set(0, 0, 0);
    camRig.yaw = 0; camRig.pitch = 0;
    camRig.recoilDebt = camRig.recoilYawDebt = camRig.kickPitch = camRig.kickYaw = 0;
    step(45); // settle, rest: first-shot accuracy
    keys.add('Mouse2');
    for (let i = 0; i < 70; i++) { track(chestOf(dummy)); step(); }
    const hits = [];
    const off = engine.events.on('weapon:hit', (h) => hits.push({ zone: h.zone, amount: h.amount, distance: h.distance, crit: h.crit, killed: h.killed, expected: t.damage * zoneMult(t, h.zone) * fall(t.falloff, h.distance) }));
    weapon.state[id].ammo = t.mag;
    keys.add('Mouse0'); engine.input.pressed.add('Mouse0'); // held, with the press edge semi-auto guns need
    for (let i = 0; i < 120 && !hits.length; i++) { track(chestOf(dummy)); step(); }
    keys.delete('Mouse0');
    // let every round of a burst land before comparing with the panel (a late third round would update the panel only)
    for (let i = 0; i < 45; i++) { track(chestOf(dummy)); step(); }
    off();
    keys.delete('Mouse2');
    step(60);
    const h = hits[0];
    if (!h) return { missed: true };
    // onTarget: the muzzle is ahead of the player, so the distance reads a little under D; far off = another dummy was hit
    const expected = h.expected;
    const last = hits[hits.length - 1]; // a burst lands several rounds: the tool shows the latest
    return {
      rounds: hits.length, allOk: hits.every((x) => Math.abs(x.amount - x.expected) < 1e-3), distance: +h.distance.toFixed(2), onTarget: Math.abs(h.distance - D) < 2.5, zone: h.zone, crit: h.crit, amount: +h.amount.toFixed(3), expected: +expected.toFixed(3), mult: +(fall(t.falloff, h.distance)).toFixed(3), ok: Math.abs(h.amount - expected) < 1e-3, killed: h.killed, panel: tool.lastHit ? { amount: tool.lastHit.amount, expected: tool.lastHit.expected } : null, last: { amount: last.amount, expected: last.expected } };
  }

  // --- per gun: spread, falloff markers, damage at three distances ---
  weapon.reset();
  for (const id of Object.keys(GUN_KEYS)) {
    select(id);
    const t = weapon.t;
    const r = { name: t.name, falloff: t.falloff, base: { hip: t.spreadHip, aim: t.spreadAim, bloomMax: t.bloomMax } };
    // spread, standing still, after resting (first-shot scaling applies), hip and fully aimed
    player.pos.set(1.5, 0, 0.5); player.vel.set(0, 0, 0);
    camRig.yaw = 0; camRig.pitch = 0.3;
    step(60);
    r.hip = weapon.spread();
    keys.add('Mouse2'); step(70);
    r.aim = weapon.spread();
    r.aimBlend = weapon.aimBlend();
    keys.delete('Mouse2'); step(40);
    r.hipFormula = t.spreadHip * t.firstShot.hip;
    r.aimFormula = t.spreadAim * t.firstShot.aim;
    r.cone10 = { hip: +(2000 * Math.tan(r.hip)).toFixed(1), aim: +(2000 * Math.tan(r.aim)).toFixed(1) }; // cm diameter
    // falloff markers
    const s = tool.strips;
    r.markers = { gun: tool.gun, start: s.start.visible ? -s.start.position.z : null, end: s.end.visible ? -s.end.position.z : null };
    // damage: inside the start, between start and end, beyond the end (no falloff: 10 / 60 / 100)
    const f = t.falloff;
    const Ds = f ? [Math.round(f.start * 0.5), Math.round((f.start + f.end) / 2), f.end + 4] : [10, 60, 100];
    r.shots = Ds.map((D) => {
      // the dummy whose marker is nearest to D, shot from D metres
      const dummy = dummies.reduce((a, c) => (Math.abs(-c.pos.z - D) < Math.abs(-a.pos.z - D) ? c : a));
      return { D, dummy: -dummy.pos.z, ...shoot(id, dummy, D) };
    });
    out.guns[id] = r;
  }
  out.survive = {
    alive: dummies.every((d) => d.alive),
    full: dummies.every((d) => d.health === d.maxHealth),
  };
  // a hit far beyond a dummy's health: still standing
  const big = dummies[3];
  const killed = big.damage(1e6, big.pos, new V3(0, 0, -1), 'torso');
  out.survive.huge = { killed, alive: big.alive, health: big.health === big.maxHealth };
  out.readouts = [...tool.readouts.entries()].map(([d, r]) => ({ at: -d.pos.z, text: r.el.textContent, hits: r.hits }));

  // --- recoil wall: rifle burst leaves dots, B clears them ---
  select('rifle');
  key('KeyB');
  const wallPts = [];
  const offI = engine.events.on('weapon:impact', (i) => { if (Math.abs(i.point.z + 10) < 0.03 && i.point.x < -2 && i.point.x > -7) wallPts.push(i.point.x); });
  player.pos.set(-4.5, 0, 0); player.vel.set(0, 0, 0);
  camRig.yaw = 0; camRig.pitch = 0;
  step(60);
  const wallAt = new V3(-4.5, 1.4, -10);
  keys.add('Mouse2');
  for (let i = 0; i < 40; i++) { track(wallAt); step(); }
  weapon.rng.seed(7);
  keys.add('Mouse0');
  for (let i = 0; i < 70; i++) step();
  keys.delete('Mouse0'); keys.delete('Mouse2');
  step(30);
  offI();
  out.dots = { impacts: wallPts.length, dots: tool.dots.count };
  key('KeyB');
  out.dots.afterB = tool.dots.count;

  // --- keys: N toggles the panel, M clears the readouts ---
  const panel = document.getElementById('range-panel');
  key('KeyN');
  out.keys = { hidden: panel.style.display === 'none' };
  key('KeyN');
  out.keys.shown = panel.style.display !== 'none';
  out.keys.readoutsBefore = tool.readouts.size;
  key('KeyM');
  out.keys.readoutsAfter = tool.readouts.size;
  step(2);
  out.panelText = panel.textContent;

  // --- metric item 16: do troopers fire across 30-40 m? ---
  player.pos.set(1.5, 0, 0.5); player.vel.set(0, 0, 0);
  camRig.yaw = 0; camRig.pitch = 0;
  for (const d of dummies) d.alive = true;
  // A trooper at `pos`, the player at `from`: does it notice, does it fire, from how far? `seconds` of game time.
  const trooperRun = (name, pos, from, seconds = 12) => {
    const tr = g.registry.build('enemies', enemies, { id: 'enemy.trooper', pos, yaw: 0 });
    enemies.puppets.push(tr);
    enemies.dirty = true;
    player.pos.set(from[0], 0, from[1]);
    const dist0 = Math.hypot(pos[0] - from[0], pos[2] - from[1]);
    const shots = [];
    let alertAt = null;
    const offB = engine.events.on('bolt:fired', (at) => shots.push(Math.hypot(at.x - from[0], at.z - from[1])));
    for (let f = 0; f < seconds * 60; f++) {
      player.health = 1e6; // the player is only a target here
      step();
      if (alertAt === null && tr.alerted) alertAt = +(f / 60).toFixed(2);
    }
    offB();
    const r = { name, dist: +dist0.toFixed(1), alerted: alertAt !== null, bolts: shots.length, firstShot: shots.length ? +shots[0].toFixed(1) : null, maxShot: shots.length ? +Math.max(...shots).toFixed(1) : null, endDist: +Math.hypot(tr.pos.x - from[0], tr.pos.z - from[1]).toFixed(1), state: tr.state };
    tr.dispose();
    enemies.puppets.splice(enemies.puppets.indexOf(tr), 1);
    enemies.dirty = true;
    step(2);
    return r;
  };
  out.troopers = [];
  // open lane: trooper 3 m to the side of the player's line, at distance D
  for (const D of [26, 30, 32, 34, 40]) out.troopers.push(trooperRun(`open lane ${D}`, [-1.5, 0, 0.5 - Math.sqrt(D * D - 9)], [1.5, 0.5]));
  // cover bay (east side, 30-34 m down the lane): the trooper stands behind the low / high cover; the player
  // stands in the lane at the distance D from it
  for (const [kind, tz] of [['low', -30.5], ['high', -34.2]]) {
    for (const D of [28, 30, 32, 34]) out.troopers.push(trooperRun(`bay ${kind} cover ${D}`, [6.1, 0, tz], [1.5, tz + Math.sqrt(D * D - 4.6 * 4.6)]));
  }
  return out;
});

console.log(JSON.stringify(result, null, 1));
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !extra ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };
const guns = Object.entries(result.guns);

expect('room: tool is the range tool with its panel', result.tool === 'RangeTool' && result.panelInDom);
expect('room: dummies at 5 10 15 20 25 30 35 40 50 60 70 80 100 m', JSON.stringify(result.dummyDistances) === JSON.stringify([5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100]));
expect('room: every dummy has a line from the firing line at least 1.2 m clear of the others', result.layout.every((l) => l.gap >= 1.2));
expect('room: lane is at least 105 m long', result.lane.maxZ - result.lane.minZ >= 105);
expect('room: under 60 labels (one draw call each)', result.labels > 20 && result.labels < 60);
expect('room: one light and one heavy ammo crate', result.crates === 'heavy,light');
for (const [id, r] of guns) {
  expect(`${id}: markers follow the gun (${r.markers.start}/${r.markers.end})`, r.markers.gun === id && (r.falloff ? r.markers.start === r.falloff.start && r.markers.end === r.falloff.end : r.markers.start === null && r.markers.end === null));
  expect(`${id}: spread hip / aim match guns.js (${r.hip.toFixed(4)} / ${r.aim.toFixed(4)})`, Math.abs(r.hip - r.hipFormula) < 1e-4 && Math.abs(r.aim - r.aimFormula) < 1e-4 && r.aimBlend > 0.98 && r.aim <= r.hip);
  for (const s of r.shots) {
    expect(`${id}: ${s.D} m shot hit ${s.dummy} m dummy, dealt ${s.amount} = ${s.expected} (x${s.mult} ${s.zone})`, !s.missed && s.onTarget && s.ok && s.allOk && s.panel && Math.abs(s.panel.amount - s.last.amount) < 1e-3 && Math.abs(s.panel.expected - s.last.expected) < 1e-3, JSON.stringify(s));
  }
  // falloff is monotone: never more damage farther out (same zone)
  const same = r.shots.filter((s) => !s.missed && s.zone === r.shots[0].zone);
  expect(`${id}: damage multiplier never rises with distance`, same.every((s, i) => i === 0 || s.mult <= same[i - 1].mult + 1e-9));
}
expect('dummies survive every gun, even a 1e6 hit', result.survive.alive && result.survive.full && !result.survive.huge.killed && result.survive.huge.alive && result.survive.huge.health);
expect('per-dummy readouts show the last damage', result.readouts.length >= 6 && result.readouts.every((r) => /^\d+!?$/.test(r.text) && r.hits >= 1));
expect('recoil wall: every wall impact left a dot', result.dots.impacts >= 8 && result.dots.dots === result.dots.impacts);
expect('key B clears the dots', result.dots.afterB === 0);
expect('key N toggles the panel', result.keys.hidden && result.keys.shown);
expect('key M clears the dummy readouts', result.keys.readoutsBefore > 0 && result.keys.readoutsAfter === 0);
expect('panel lists the gun, falloff, spread and cone', /KR-7/.test(result.panelText) && /falloff/.test(result.panelText) && /cone@10m/.test(result.panelText));
const t40 = result.troopers.find((t) => t.name === 'open lane 40');
const t26 = result.troopers.find((t) => t.name === 'open lane 26');
expect('troopers: none notices the player at 40 m (sight 32)', !t40.alerted && t40.bolts === 0);
expect('troopers: one at 26 m notices the player', t26.alerted);
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
