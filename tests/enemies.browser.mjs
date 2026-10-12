// Enemy rules: destroyed enemies stay destroyed; shooters only engage inside their range; troopers take
// cover that actually blocks the player, relocate when flanked, and shoot back.
// Needs the dev server: `npm run dev`, then `node tests/enemies.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game?.engine);
const r = await p.evaluate(() => {
  const g = window.game;
  const { engine, enemies, player } = g;
  engine.stop();
  engine.headless = true; // simulate only: nothing here checks pixels
  const step = (s) => { for (let i = 0; i < s * 60; i++) engine.step(1 / 60); };
  const out = {};
  // drones and the boss have their own tests: keep them out of these counts
  for (const e of enemies.all) if (e.kind === 'drone' || e.kind === 'boss') e.alive = false;
  enemies.dirty = true;

  // 1. a destroyed puppet stays destroyed
  const pp = enemies.all.find((x) => x.kind === 'static');
  pp.damage(999, pp.pos.clone(), new pp.pos.constructor(0, 0, 1), 'torso');
  const banked = [...enemies.debris.geos.values()];
  out.debrisShared = pp.debris.length > 0 && pp.debris.every((d) => banked.includes(d.obj.geometry)); // baked once per type, not per death
  const chunks = pp.debris.map((d) => d.obj); // (a clip may also drop: that's a pickup, not debris)
  step(15);
  out.stillDead = !pp.alive && !pp.rig.root.visible;
  out.debrisCleared = chunks.length > 0 && pp.debris.length === 0 && chunks.every((c) => !c.parent);
  out.notTargetable = !enemies.hitMeshes().some((m) => m.userData.enemy === pp);
  out.kills = enemies.kills;

  // 2. shooters engage only within range: count bolts per shooter
  const shooter = enemies.all.find((x) => x.kind === 'shooter' && x.pos.z === -15.3 && x.pos.x === 2);
  const others = enemies.all.filter((x) => (x.kind === 'shooter' || x.kind === 'trooper') && x !== shooter);
  for (const o of others) o.alive = false; // isolate the one under test
  let fired = 0;
  engine.events.on('bolt:fired', () => fired++);
  player.respawn();
  player.pos.set(2, 0, -15.3 + 40); // 40 m away, open line of sight
  fired = 0;
  step(12);
  out.firedAt40m = fired;
  player.pos.set(2, 0, -15.3 + 20); // 20 m
  player.shields = player.health = 1e6; // survive the test
  fired = 0;
  step(12);
  out.firedAt20m = fired;
  shooter.alive = false;

  // 3. troopers: cover that blocks the player, flank -> relocate, return fire
  const cover = enemies.cover;
  const squad = others.filter((x) => x.kind === 'trooper' && x.pos.z > -35 && x.pos.z < -20); // north field pair
  for (const t of squad) t.alive = true;
  player.pos.set(4, 0, -6);
  fired = 0;
  step(8);
  out.inCover = squad.map((t) => !!t.spot && t.state !== 'move' && t.pos.distanceTo(t.spot.pos) < 0.3 && cover.protects(t.spot, player.pos));
  out.squadFired = fired;
  const before = squad.map((t) => t.spot);
  player.pos.set(4, 0, -34); // walk around them
  step(12); // AI timings are randomized: leave room for a full cover cycle before they move
  out.relocated = squad.map((t, i) => t.spot !== before[i] && !!t.spot && cover.protects(t.spot, player.pos));
  // diagnostics when it fails: where each trooper is and what it is doing
  out.relocDetail = squad.map((t, i) => `${t.state} at ${t.pos.x.toFixed(1)},${t.pos.z.toFixed(1)} spot ${t.spot ? `${t.spot.pos.x.toFixed(1)},${t.spot.pos.z.toFixed(1)} ${t.spot.type}` : 'none'}${t.spot === before[i] ? ' (same)' : ''} protects=${!!t.spot && cover.protects(t.spot, player.pos)} alive=${t.alive}`);
  const inside = (t) => { const v = t.pos.clone(); g.world.collideCircle(v, 0.38, 1.8, 0.45); return v.distanceTo(t.pos) > 0.01; };
  out.noneInside = !squad.some(inside);

  // 4. flanking: player dug in behind low cover facing the squad -> one trooper goes round the side
  for (const t of enemies.all) if (t.kind === 'trooper' && t.pos.z > -35) t.alive = true;
  player.pos.set(-6, 0, 1.6);
  g.camRig.yaw = 0;
  step(0.3);
  engine.input.keys.add('KeyW'); // walk into the low block: automatic cover
  step(0.5);
  engine.input.keys.delete('KeyW');
  step(0.3);
  out.playerInCover = !!player.cover;
  const front = player.cover.normal.clone().negate(); // the side the player defends
  for (const t of enemies.all) if (t.kind === 'trooper' && t.alive) t.alert();
  let flanker = null;
  engine.events.on('trooper:flank', (t) => (flanker ??= t));
  for (let i = 0; i < 20 && !flanker; i++) step(1);
  out.flanked = !!flanker;
  if (flanker) {
    for (let i = 0; i < 12 && flanker.flanking; i++) step(0.5); // arrive
    const d = flanker.pos.clone().sub(player.pos).setY(0).normalize();
    out.flankAngleOk = d.dot(front) < 0.4; // beside or behind the player's cover
    out.flankerProtected = !!flanker.spot && enemies.cover.protects(flanker.spot, player.pos);
    fired = 0;
    engine.events.on('bolt:fired', (pos) => { if (pos === flanker.muzzle || pos.distanceTo(flanker.pos) < 2.5) fired++; });
    step(6);
    out.flankerFired = fired;
  }
  out.allInRange = enemies.all.filter((t) => t.kind === 'trooper' && t.alive && t.alerted && t.spot).every((t) => t.spot.pos.distanceTo(player.pos) <= 34.5);
  return out;
});

// 5. dormant enemies (params.dormant): inert in sight and in range, still take hits, only wakeGroup wakes them
await p.reload();
await p.waitForFunction(() => window.game?.engine);
const d = await p.evaluate(() => {
  const g = window.game;
  const { engine, enemies, player } = g;
  engine.stop();
  engine.headless = true;
  const step = (s) => { for (let i = 0; i < s * 60; i++) engine.step(1 / 60); };
  for (const e of enemies.all) e.alive = false; // clear the field: only the spawned ones below act
  enemies.dirty = true;
  const out = {};
  player.respawn();
  player.shields = player.health = 1e6;
  player.pos.set(2, 0, -15.3 + 12);
  const mk = (id, dx, params) => enemies.spawn({ id, pos: [2 + dx, 0, -15.3], params });
  const sh = mk('enemy.shooter', 0, { group: 'dz', dormant: true });
  const tr = mk('enemy.trooper', 3, { group: 'dz', dormant: true });
  const live = mk('enemy.static', -3, { group: 'dz', dormant: true });
  const plain = mk('enemy.static', -6, { group: 'dz' });
  let fired = 0;
  engine.events.on('bolt:fired', () => fired++);
  step(15);
  out.inert = fired === 0 && !sh.awake && !tr.awake && !tr.alerted && sh.state === 'hidden' && sh.dormant && tr.dormant;
  // damage never wakes it
  sh.damage(10, sh.pos.clone().setY(1), new sh.pos.constructor(0, 0, 1), 'body');
  tr.damage(10, tr.pos.clone().setY(1), new tr.pos.constructor(0, 0, 1), 'body');
  step(3);
  out.hit = sh.health === 110 && tr.health < tr.maxHealth && !sh.awake && !tr.awake && fired === 0;
  out.plainNotAwake = plain.awake === false && live.awake === false;
  // an ordinary puppet is not counted when the group wakes; the dormant three are
  out.woke = enemies.wakeGroup('dz');
  out.awake = sh.awake && tr.awake && !sh.dormant && !tr.dormant && live.awake && !plain.awake;
  step(8);
  out.fires = fired > 0;
  // dormant enemies can die
  const dead = mk('enemy.shooter', 6, { group: 'dz2', dormant: true });
  for (let i = 0; i < 10 && dead.alive; i++) dead.damage(50, dead.pos.clone().setY(1), new dead.pos.constructor(0, 0, 1), 'body');
  out.dies = !dead.alive;
  // validation: dormant needs a group
  const lvl = (params) => ({ version: g.level.version, spawn: { pos: [0, 0, 0] }, pieces: [{ id: 'enemy.trooper', pos: [0, 0, 0], params }] });
  const tryCheck = (params) => { try { g.registry.check(lvl(params)); return null; } catch (e) { return e.message; } };
  out.noGroup = tryCheck({ dormant: true });
  out.okGroup = tryCheck({ dormant: true, group: 'a' });
  out.okPlain = tryCheck({});
  return out;
});
console.log(d);
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect('dormant: a shooter in range and a trooper in sight stay inert for 15 s', d.inert);
expect('dormant: they take damage without waking, nothing fires', d.hit && d.plainNotAwake);
expect('dormant: wakeGroup wakes the dormant ones (3), not an ordinary puppet', d.woke === 3 && d.awake);
expect('dormant: the woken shooter / trooper now fire', d.fires);
expect('dormant: a dormant enemy can be killed', d.dies);
expect('dormant: without a group it fails validation with a clear message', /dormant/.test(d.noGroup ?? '') && /group/.test(d.noGroup ?? '') && d.okGroup === null && d.okPlain === null);
console.log(r);
expect('destroyed puppet stays destroyed after 15 s', r.stillDead);
expect('its debris is cleaned up', r.debrisCleared);
expect('its debris chunks use the type\'s shared baked geometry', r.debrisShared);
expect('it is no longer a target', r.notTargetable && r.kills === 1);
expect('no shots from 40 m', r.firedAt40m === 0);
expect('shoots inside range (20 m)', r.firedAt20m > 0);
expect('troopers end up behind cover that blocks the player', r.inCover.every(Boolean));
expect('troopers shoot back', r.squadFired > 0);
expect('flanked troopers relocate to cover against the new position', r.relocated.every(Boolean));
expect('troopers never stand inside geometry', r.noneInside);
expect('flank: a trooper is sent round when the player digs in', r.playerInCover && r.flanked);
expect('flank: it ends up beside or behind the player', r.flankAngleOk && r.flankerProtected);
expect('flank: and fires from there', r.flankerFired > 0);
expect('troopers never pick cover out of the fight (> 34 m)', r.allInRange);
expect('no page errors', errors.length === 0);
await b.close();
process.exit(fail.length ? 1 : 0);
