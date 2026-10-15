// CERBERUS (`boss.cerberus`, actors/cerberus.js, gdd.md 8.5): the Prologue's scripted loss. Three heads, never destroyed,
// never counted, repairs, attacks (VIGIL bolts, COLOSSUS mortar, LEGION drones), the three-segment boss bar.
// Needs the dev server: `bun run dev`, then `node tests/cerberus.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const url = new URL(BASE);
url.searchParams.set('scene', 'workshop');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// no real pointer lock (free-mouse mode), so play works deterministically in headless Chromium (as the mission suite)
await p.addInitScript(() => {
  Element.prototype.requestPointerLock = function () {
    setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
    return Promise.reject(new DOMException('refused by the test', 'NotAllowedError'));
  };
});
await p.goto(url.href);
await p.waitForFunction(() => window.game?.engine);

const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

await p.evaluate(() => {
  const g = window.game;
  const { engine } = g;
  engine.stop();
  engine.headless = true;
  const T = (window.T = {});
  T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) engine.step(1 / 60); };
  // a clean doc with the given pieces: [id, pos, params?, name?], in play
  T.play = (pieces) => {
    const t = g.tool;
    if (t.playing) t.edit();
    t.load({ ...JSON.parse(JSON.stringify(t.doc)), pieces: [] });
    for (const [id, pos, params, name] of pieces) {
      const i = t.place(id, pos, params);
      if (name) t.setName(i, name);
    }
    T.step(0.1);
    t.play();
    T.step(0.3);
    g.player.shields = g.player.health = 1e6;
    return t;
  };
  // hold the player at a spot (and alive) for s seconds
  T.hold = (x, z, s) => { for (let i = 0; i < Math.round(s * 60); i++) { g.player.pos.set(x, 0, z); g.player.shields = g.player.health = 1e6; engine.step(1 / 60); } };
  T.step(1);
});
const ev = (fn, arg) => p.evaluate(fn, arg);

// ---- 1. a lone CERBERUS: spawn, bar, wake ----
const A = await ev(async () => {
  const { Raycaster, Box3, Vector3 } = await import('/node_modules/three/build/three.module.js');
  const g = window.game;
  const { enemies, engine } = g;
  T.play([['boss.cerberus', [0, 0, 0], { group: 'cb', arena: { minX: -14, maxX: 14, minZ: 30, maxZ: 60 } }]]);
  const boss = enemies.all.find((e) => e.kind === 'boss');
  const out = {};
  const root = document.getElementById('boss');
  out.meta = !!g.registry.meta('boss.cerberus').label && !!g.registry.meta('boss.cerberus').example;
  out.isBoss = boss.kind === 'boss' && boss.name === 'CERBERUS' && boss.unkillable === true && boss.heads.length === 3 && enemies.boss === boss;
  out.params = { floor: boss.floor, repair: boss.repair };
  out.dormantBar = !root.classList.contains('on');
  // footprint relative to pos: the hitboxes' world box (the hull and booms, with the heads at rest)
  const bb = new Box3();
  for (const m of boss.hitMeshes) bb.expandByObject(m);
  out.box = { min: bb.min.toArray().map((x) => +x.toFixed(1)), max: bb.max.toArray().map((x) => +x.toFixed(1)) };
  // wakes when the player enters its arena; boss:wake is the same event as the spider's
  let wakes = [];
  engine.events.on('boss:wake', (e) => wakes.push(e.name));
  T.hold(0, -30, 1);
  out.asleepOutside = !boss.awake;
  T.hold(0, 45, 0.5);
  out.awake = boss.awake;
  out.wakes = wakes;
  // boss bar: three segments, no core bar or leg pips
  out.bar = {
    on: root.classList.contains('on'),
    seg: root.classList.contains('seg'),
    name: document.getElementById('boss-name').textContent,
    segs: [...document.querySelectorAll('#boss-segs i')].map((i) => i.querySelector('u').textContent),
    coreHidden: getComputedStyle(document.querySelector('#boss .bar')).display === 'none',
  };
  // the hull blocks a shot at the hull; a shot at the eye hits the eye
  const ray = new Raycaster();
  const from = new Vector3(0, 1.6, 45);
  const shoot = (to) => { ray.set(from, to.clone().sub(from).normalize()); return ray.intersectObjects(enemies.hitMeshes(), false)[0]; };
  boss.hull.updateWorldMatrix(true, true);
  const hullHit = shoot(boss.hull.getWorldPosition(new Vector3()));
  out.hullHit = hullHit && { part: hullHit.object.userData.part, armor: boss.armor(hullHit.object.userData.zone, hullHit.object) };
  const eye = boss.heads[0].weak.getWorldPosition(new Vector3());
  const eyeHit = shoot(eye);
  out.eyeHit = eyeHit && { zone: eyeHit.object.userData.zone, head: eyeHit.object.userData.head, armor: boss.armor(eyeHit.object.userData.zone, eyeHit.object) };
  // damage: a hit chips its head only, a flash follows, the hull takes none
  const h0 = boss.heads[0];
  const hp = boss.health;
  boss.damage(50, eye, new Vector3(0, 0, -1), 'weak', eyeHit.object);
  T.step(1 / 60);
  out.chip = { vigil: h0.health, others: [boss.heads[1].health, boss.heads[2].health], segs: boss.segments.map((s) => +s.value.toFixed(3)), flash: h0.flash > 0 };
  boss.damage(50, eye, new Vector3(0, 0, -1), 'torso', hullHit.object);
  out.hullNoDamage = h0.health === 950;
  // huge damage: stops at the floor, never dies, never counted dead
  const killed = boss.damage(1e9, eye, new Vector3(0, 0, -1), 'weak', eyeHit.object);
  const killed2 = boss.damage(1e9, eye, new Vector3(0, 0, -1), 'torso', boss.heads[2].weak);
  out.floor = { killed, killed2, alive: boss.alive, vigil: h0.health, colossus: boss.heads[2].health, legion: boss.heads[1].health, kills: enemies.kills };
  T.hold(0, 45, 0.1);
  out.floorBar = [...document.querySelectorAll('#boss-segs b')].map((e) => parseFloat(e.style.width));
  // repair: nothing for repairDelay, then up to full
  T.hold(0, 45, 1.0);
  out.noRepairYet = h0.health === boss.floor * h0.max;
  T.hold(0, 45, 1.0);
  out.repairing = h0.health > boss.floor * h0.max;
  T.hold(0, 45, 8);
  const bb2 = new Box3();
  boss.root.updateMatrixWorld(true);
  for (const m of boss.hitMeshes) bb2.expandByObject(m);
  out.awakeBox = { min: bb2.min.toArray().map((x) => +x.toFixed(1)), max: bb2.max.toArray().map((x) => +x.toFixed(1)) };
  out.repaired = [h0.health, boss.heads[1].health, boss.heads[2].health];
  return out;
});
console.log('footprint relative to pos, hitboxes: dormant', JSON.stringify(A.box), 'awake', JSON.stringify(A.awakeBox));
expect('boss.cerberus: registered with label and example, builds a boss "CERBERUS", unkillable, three heads, the HUD boss', A.meta && A.isBoss, JSON.stringify(A));
expect('  defaults: floor 0.65, repair 0.08', A.params.floor === 0.65 && A.params.repair === 0.08, JSON.stringify(A.params));
expect('  colossal: about 21 m across, heads out in front', A.box.max[0] - A.box.min[0] >= 18 && A.box.max[0] - A.box.min[0] <= 25 && A.box.max[2] > 12, JSON.stringify(A.box));
expect('  dormant until the player is in its arena, no boss bar before', A.asleepOutside && A.dormantBar, JSON.stringify([A.asleepOutside, A.dormantBar]));
expect('  wakes in its arena and emits boss:wake { name } once', A.awake && A.wakes.length === 1 && A.wakes[0] === 'CERBERUS', JSON.stringify(A.wakes));
expect('  boss bar: CERBERUS with three head segments instead of the core bar', A.bar.on && A.bar.seg && A.bar.name === 'CERBERUS' && A.bar.segs.join() === 'VIGIL,LEGION,COLOSSUS' && A.bar.coreHidden, JSON.stringify(A.bar));
expect('  the hull is armor and blocks the shot; the eye is a weak spot of head 0', A.hullHit?.part === 'hull' && A.hullHit.armor === 0 && A.eyeHit?.zone === 'weak' && A.eyeHit.head === 0 && A.eyeHit.armor === 1, JSON.stringify([A.hullHit, A.eyeHit]));
expect('  a hit chips only its head (flash), the hull takes none', A.chip.vigil === 950 && A.chip.others.every((x) => x === 1000) && A.chip.segs.join() === '0.95,1,1' && A.chip.flash && A.hullNoDamage, JSON.stringify(A.chip));
expect('  huge damage stops at the floor (65%) per head and never kills it', !A.floor.killed && !A.floor.killed2 && A.floor.alive && A.floor.vigil === 650 && A.floor.colossus === 650 && A.floor.legion === 1000 && A.floor.kills === 0, JSON.stringify(A.floor));
expect('  the bar shows the floor', A.floorBar.join() === '65,100,65', A.floorBar.join());
expect('  repairs: not for 1.5 s, then back to full', A.noRepairYet && A.repairing && A.repaired.every((x) => x === 1000), JSON.stringify(A.repaired));

// ---- 2. attacks, drone cap, holdFire ----
const B = await ev(() => {
  const g = window.game;
  const { enemies, engine } = g;
  const boss = enemies.all.find((e) => e.kind === 'boss');
  const out = { maxDrones: 0, droneGroups: new Set() };
  let bolts = 0;
  let mortars = 0;
  let charges = 0;
  let hurt = 0;
  engine.events.on('bolt:fired', () => bolts++);
  engine.events.on('boss:mortar', () => mortars++);
  engine.events.on('boss:charge', () => charges++);
  engine.events.on('player:hurt', () => hurt++);
  for (let i = 0; i < 45; i++) {
    T.hold(0, 45, 1);
    const drones = enemies.all.filter((e) => e.kind === 'drone' && e.alive);
    out.maxDrones = Math.max(out.maxDrones, drones.length);
    for (const d of drones) out.droneGroups.add(d.squad);
  }
  out.droneGroups = [...out.droneGroups];
  out.bolts = bolts;
  out.charges = charges;
  out.mortars = mortars;
  out.hurt = hurt;
  out.droneAwake = enemies.all.filter((e) => e.kind === 'drone' && e.alive).every((d) => d.awake);
  // drones stay over the arena
  out.droneInArena = enemies.all.filter((e) => e.kind === 'drone' && e.alive).every((d) => d.pos.x > -15 && d.pos.x < 15 && d.pos.z > 29 && d.pos.z < 61);
  // killed drones are replaced (below the cap), never past it
  for (const d of enemies.all.filter((e) => e.kind === 'drone')) d.alive && d.damage(1e4, d.pos, d.pos.clone().set(0, 0, 1), 'head');
  T.hold(0, 45, 14);
  out.refilled = enemies.all.filter((e) => e.kind === 'drone' && e.alive).length;
  // cinematic hold fire: nothing new fires or hurts
  enemies.holdFire = true;
  T.hold(0, 45, 3); // bolts and orbs already in flight land first
  const b0 = bolts;
  const m0 = mortars;
  const h0 = hurt;
  T.hold(0, 45, 20);
  out.held = { bolts: bolts - b0, mortars: mortars - m0, hurt: hurt - h0 };
  enemies.holdFire = false;
  // in cover the mortar comes faster (the spider's rule): the timer runs 1.8x
  const hider = Object.create(g.player, { cover: { value: {} } });
  boss.mortarTimer = 100;
  boss.update(1, hider);
  out.coverBoost = +(100 - boss.mortarTimer).toFixed(2);
  return out;
});
expect('attacks: VIGIL telegraphs (boss:charge) and fires sweeping bolt bursts', B.charges >= 4 && B.bolts >= 24, JSON.stringify([B.charges, B.bolts]));
expect('  COLOSSUS mortars land at the player', B.mortars >= 4, String(B.mortars));
expect('  the player is hurt by them (so it pressures)', B.hurt >= 3, String(B.hurt));
expect('  LEGION calls drones (awake, in its group, over the arena), capped at 3', B.maxDrones === 3 && B.droneGroups.join() === 'cb' && B.droneAwake && B.droneInArena, JSON.stringify([B.maxDrones, B.droneGroups, B.droneAwake, B.droneInArena]));
expect('  shot-down drones are replaced, never above the cap', B.refilled >= 1 && B.refilled <= 3, String(B.refilled));
expect('  holdFire (cinematic): no bolts, no mortars, no damage', B.held.bolts === 0 && B.held.mortars === 0 && B.held.hurt === 0, JSON.stringify(B.held));
expect('  mortars come 1.8x faster against a player in cover', B.coverBoost >= 1.7 && B.coverBoost <= 1.9, String(B.coverBoost));

// ---- 3. counting: not a destroy target, not an arena:clear blocker ----
const C = await ev(() => {
  const g = window.game;
  const { enemies, engine, mission } = g;
  const t = T.play([
    ['objective.destroy', [0, 0, 0], {}, 'kill-all'],
    ['boss.cerberus', [0, 0, 0], { dormant: true, group: 'cb' }],
    ['enemy.static', [-10, 0, 10], {}],
  ]);
  const boss = enemies.all.find((e) => e.kind === 'boss');
  const puppet = enemies.all.find((e) => e.kind === 'static');
  const out = { target: mission.target, state: mission.state };
  let clear = 0;
  engine.events.on('arena:clear', () => clear++);
  out.killable = enemies.killable;
  out.counter = document.getElementById('kills')?.textContent;
  T.hold(0, 14, 3);
  out.dormantStays = !boss.awake; // dormant: arena entry does nothing
  puppet.damage(1e4, puppet.pos.clone().setY(1), puppet.pos.clone().set(0, 0, -1), 'body');
  T.step(0.2);
  out.afterKill = { state: mission.state, kills: enemies.kills, clear, counter: document.getElementById('kills')?.textContent, bossAlive: boss.alive };
  // wakeGroup wakes it (once)
  let wakes = 0;
  engine.events.on('boss:wake', () => wakes++);
  enemies.wakeGroup('cb');
  enemies.wakeGroup('cb');
  T.step(0.2);
  out.woke = { awake: boss.awake, wakes };
  return out;
});
expect('counting: a destroy objective without a group targets only the killable enemies (the puppet), not CERBERUS', C.target === 1 && C.killable === 1, JSON.stringify(C));
expect('  killing the last killable enemy completes the mission and clears the arena', C.afterKill.state === 'complete' && C.afterKill.clear === 1 && C.afterKill.kills === 1 && C.afterKill.bossAlive && C.afterKill.counter === '1 / 1', JSON.stringify(C.afterKill));
expect('  dormant ignores the arena; wakeGroup wakes it, once', C.dormantStays && C.woke.awake && C.woke.wakes === 1, JSON.stringify(C.woke));

// ---- 4. the spider still works next to it: the bar follows the engaged boss ----
const D = await ev(() => {
  const g = window.game;
  const { enemies } = g;
  T.play([
    ['boss.spider', [0, 0, -40], { arena: { minX: -20, maxX: 20, minZ: -60, maxZ: -20 }, dormant: true, group: 'sp' }],
    ['boss.cerberus', [60, 0, 0], { dormant: true, group: 'cb', arena: { minX: 46, maxX: 74, minZ: 30, maxZ: 60 } }],
  ]);
  const root = document.getElementById('boss');
  const spider = enemies.all.find((e) => e.name !== 'CERBERUS' && e.kind === 'boss');
  const cb = enemies.all.find((e) => e.name === 'CERBERUS');
  const out = { first: enemies.boss === spider };
  enemies.wakeGroup('sp');
  T.hold(0, -30, 0.5);
  out.spiderBar = { on: root.classList.contains('on'), seg: root.classList.contains('seg'), legs: document.querySelectorAll('#boss-legs i').length, name: document.getElementById('boss-name').textContent };
  spider.alive = false; // out of the way (the bar follows an engaged boss)
  spider.debris.length = 0;
  enemies.wakeGroup('cb');
  T.hold(60, 45, 0.5);
  out.cerberusBar = { on: root.classList.contains('on'), seg: root.classList.contains('seg'), name: document.getElementById('boss-name').textContent, boss: enemies.boss === cb };
  return out;
});
expect('the spider keeps its bar (core bar, six leg pips); the bar follows the engaged boss to CERBERUS', D.first && D.spiderBar.on && !D.spiderBar.seg && D.spiderBar.legs === 6 && D.spiderBar.name === 'SX-6 TARANTULA' && D.cerberusBar.on && D.cerberusBar.seg && D.cerberusBar.boss && D.cerberusBar.name === 'CERBERUS', JSON.stringify(D));

// ---- 5. the volley (the Skyway's loss cut): a shot with cue 'volley' charges the heads together, then three beams and a blast ----
const E = await ev(() => {
  const g = window.game;
  const { enemies, engine } = g;
  T.play([['boss.cerberus', [0, 0, 0], { group: 'cb', dormant: true, arena: { minX: -14, maxX: 14, minZ: 30, maxZ: 60 } }]]);
  const boss = enemies.all.find((e) => e.kind === 'boss');
  const blasts = [];
  engine.events.on('blast', (b) => blasts.push({ kind: b.kind, radius: b.radius, x: b.point.x, z: b.point.z }));
  const out = { dormant: !boss.awake };
  const beamsVisible = () => boss.beams.filter((x) => x.glow.visible && x.core.visible).length;
  engine.events.emit('cinematic:shot', { id: 'x', index: 0, shot: { from: [0, 1, 0], look: [0, 1, 1], time: 1 } }); // no cue: nothing
  T.hold(0, 40, 0.2);
  out.noCue = boss.volley === null;
  engine.events.emit('cinematic:shot', { id: 'x', index: 1, shot: { from: [0, 1, 0], look: [0, 1, 1], time: 1, cue: 'volley' } });
  T.hold(0, 40, 0.7);
  out.charging = { volley: !!boss.volley, awake: boss.awake, fired: boss.volley?.fired, beams: beamsVisible(), flare: boss.heads.map((h) => Math.round(h.flare * 10) / 10), blasts: blasts.length };
  T.hold(0, 40, 1.0); // 1.7 s: past the 1.5 s charge
  out.firing = { fired: boss.volley?.fired, beams: beamsVisible(), blasts: blasts.slice(), health: g.player.health };
  T.hold(0, 40, 1.2); // past the 0.9 s of beams
  out.done = { volley: boss.volley, beams: beamsVisible(), blasts: blasts.length };
  return out;
});
expect('cerberus/volley: a shot without the cue does nothing; the cue wakes a dormant one and starts charging (no beams, no blast yet)', E.dormant && E.noCue && E.charging.volley && E.charging.awake && E.charging.beams === 0 && E.charging.blasts === 0 && E.charging.flare.every((f) => f > 0.3), JSON.stringify(E));
expect('cerberus/volley: after the charge three beams show and one blast lands where the player stands (visual only: no damage)', E.firing.fired && E.firing.beams === 3 && E.firing.blasts.length === 1 && E.firing.blasts[0].kind === 'mortar' && E.firing.blasts[0].radius >= 5 && Math.abs(E.firing.blasts[0].z - 40) < 0.5 && E.firing.health >= 100, JSON.stringify(E.firing));
expect('cerberus/volley: the beams end, the volley is over, one blast in all', E.done.volley === null && E.done.beams === 0 && E.done.blasts === 1, JSON.stringify(E.done));

expect('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(fail.length ? `${fail.length} failed` : 'all passed');
process.exit(fail.length ? 1 : 0);
