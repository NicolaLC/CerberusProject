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
  for (const e of enemies.puppets) if (e.kind === 'drone' || e.kind === 'boss') e.alive = false;
  enemies.dirty = true;

  // 1. a destroyed puppet stays destroyed
  const pp = enemies.puppets.find((x) => x.kind === 'static');
  pp.damage(999, pp.pos.clone(), new pp.pos.constructor(0, 0, 1), 'torso');
  const chunks = pp.debris.map((d) => d.obj); // (a clip may also drop: that's a pickup, not debris)
  step(15);
  out.stillDead = !pp.alive && !pp.rig.root.visible;
  out.debrisCleared = chunks.length > 0 && pp.debris.length === 0 && chunks.every((c) => !c.parent);
  out.notTargetable = !enemies.hitMeshes().some((m) => m.userData.enemy === pp);
  out.kills = enemies.kills;

  // 2. shooters engage only within range: count bolts per shooter
  const shooter = enemies.puppets.find((x) => x.kind === 'shooter' && x.pos.z === -15.3 && x.pos.x === 2);
  const others = enemies.puppets.filter((x) => (x.kind === 'shooter' || x.kind === 'trooper') && x !== shooter);
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
  for (const t of enemies.puppets) if (t.kind === 'trooper' && t.pos.z > -35) t.alive = true;
  player.pos.set(-6, 0, 1.6);
  g.camRig.yaw = 0;
  step(0.3);
  engine.input.keys.add('KeyW'); // walk into the low block: automatic cover
  step(0.5);
  engine.input.keys.delete('KeyW');
  step(0.3);
  out.playerInCover = !!player.cover;
  const front = player.cover.normal.clone().negate(); // the side the player defends
  for (const t of enemies.puppets) if (t.kind === 'trooper' && t.alive) t.alert();
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
  out.allInRange = enemies.puppets.filter((t) => t.kind === 'trooper' && t.alive && t.alerted && t.spot).every((t) => t.spot.pos.distanceTo(player.pos) <= 34.5);
  return out;
});
console.log(r);
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect('destroyed puppet stays destroyed after 15 s', r.stillDead);
expect('its debris is cleaned up', r.debrisCleared);
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
