// Spider mech miniboss: dormant until the player enters its arena; the hull is armored; breaking legs
// collapses it and exposes the core; it fights back (cannon, mortar over cover); it stays in its arena.
// Needs the dev server: `bun run dev`, then `node tests/boss.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game?.engine);
const r = await p.evaluate(async () => {
  const { Raycaster } = await import('/node_modules/three/build/three.module.js');
  const g = window.game;
  const { engine, enemies, player, world } = g;
  engine.stop();
  engine.headless = true; // simulate only: nothing here checks pixels
  const step = (s) => { for (let i = 0; i < s * 60; i++) engine.step(1 / 60); };
  const boss = enemies.boss;
  const V = boss.pos.constructor;
  const out = {};
  for (const e of enemies.all) if (e !== boss) e.alive = false; // the boss alone
  enemies.dirty = true;
  player.shields = player.health = 1e6;
  const hold = (x, z, s) => { for (let i = 0; i < s * 60; i++) { player.pos.set(x, 0, z); player.health = 1e6; engine.step(1 / 60); } };

  // 1. dormant outside the arena (behind its wall)
  hold(0, 0, 3);
  out.dormantOutside = !boss.awake;
  // 2. wakes when the player walks in
  let bolts = 0;
  let blasts = 0;
  let steps = 0;
  engine.events.on('bolt:fired', () => bolts++);
  engine.events.on('blast', () => blasts++);
  engine.events.on('boss:step', () => steps++);
  hold(38, -20, 1);
  out.awake = boss.awake;
  // 2b. lock-on: the camera turns to the boss on its own; looking around overrides it, then it comes back
  const { camRig } = g;
  const offBoss = () => {
    const f = boss.focusPoint(new V());
    const want = Math.atan2(-(f.x - camRig.pivot.x), -(f.z - camRig.pivot.z));
    return Math.abs(Math.atan2(Math.sin(want - camRig.yaw), Math.cos(want - camRig.yaw)));
  };
  camRig.yaw += Math.PI * 0.8; // look away
  hold(38, -20, 2.5);
  out.lockOn = +offBoss().toFixed(3);
  for (let i = 0; i < 40; i++) { camRig.look(30, 0, false); player.pos.set(38, 0, -20); engine.step(1 / 60); }
  out.lookOverrides = +offBoss().toFixed(3);
  hold(38, -20, 2.5);
  out.lockReturns = +offBoss().toFixed(3);
  // 3. fights: cannon bursts at an exposed player, walks (feet step)
  hold(38, -20, 8);
  out.bolts = bolts;
  out.steps = steps;
  // 4. mortars reach a player hiding behind a wall
  blasts = 0;
  const far = (x, z) => Math.hypot(boss.pos.x - x, boss.pos.z - z);
  hold(34, -21.4, 14); // south side of the wall at (34, -23)
  out.blastsOnHider = blasts;
  // 4b. pursuit: it comes for a player standing still across the arena, round the cover (a path over the arena grid),
  // instead of circling where it stood
  hold(28, -58, 0.1);
  const from = far(28, -58);
  hold(28, -58, 12);
  out.pursuit = [+from.toFixed(1), +far(28, -58).toFixed(1)];
  // 5. stays in its arena, never inside a wall
  const inArena = (q) => q.x > 25 && q.x < 49.5 && q.z > -61.5 && q.z < -14.5;
  let left = false;
  let stuck = false;
  for (let i = 0; i < 20; i++) {
    hold(30 + (i % 4) * 5, -18 - (i % 3) * 12, 1);
    if (!inArena(boss.pos)) left = true;
    for (const c of world.colliders) {
      const bx = c.box;
      if (bx.max.y - boss.pos.y > 1.3 && boss.pos.x > bx.min.x && boss.pos.x < bx.max.x && boss.pos.z > bx.min.z && boss.pos.z < bx.max.z) stuck = true;
    }
  }
  out.stayedInArena = !left;
  out.neverInsideWalls = !stuck;
  // 6. armor: hull and the closed core take nothing; legs and knees do
  const hull = boss.hitMeshes.find((m) => m.userData.part === 'hull');
  out.hullArmor = boss.armor('torso', hull);
  out.coreClosed = boss.armor('weak', boss.core);
  const hp = boss.health;
  boss.damage(0, hull.position, new V(0, 0, -1), 'torso', hull);
  out.hullNoDamage = boss.health === hp;
  // 7. two legs down -> collapsed, core exposed and damageable
  const dir = new V(0, 0, -1);
  for (const l of boss.legs.slice(0, 2)) boss.damage(500, l.foot, dir, 'weak', l.knee);
  out.legsLost = boss.legsLost;
  out.down = boss.down > 0;
  out.coreOpen = boss.armor('weak', boss.core);
  out.legsNotTargetable = !enemies.hitMeshes().some((m) => m.userData.part === 0 || m.userData.part === 1);
  // core open: the standing legs are armored too (sparks, no damage), so the player shoots the core
  const knee = boss.legs[2].knee;
  const legHp = boss.legs[2].health;
  out.legsArmoredOpen = boss.armor('weak', knee) === 0 && boss.armor('limb', boss.hitMeshes.find((m) => m.userData.part === 2 && m !== knee) ?? knee) === 0 && boss.legs[2].health === legHp;
  // the risen core is the first thing a shot from a standing player's eye hits from almost every side (the standing legs
  // can cover it from up to three angles, depending on how it fell); its hitbox follows the mech: the baked glowing parts are frozen proxies that must be
  // refreshed, or they stay where the mech was baked
  step(1);
  const ray = new Raycaster();
  const core = boss.coreLift.getWorldPosition(new V()); // the core's bone: a frozen hitbox reports its own stale position
  out.coreShots = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
    const a = (k * Math.PI) / 4 + 0.4;
    const eye = new V(boss.pos.x + Math.sin(a) * 9, 1.6, boss.pos.z + Math.cos(a) * 9);
    ray.set(eye, core.clone().sub(eye).normalize());
    const hit = ray.intersectObjects(enemies.hitMeshes(), false)[0];
    return hit?.object === boss.core ? true : `${hit ? `part ${hit.object.userData.part} at ${hit.distance.toFixed(1)} m` : 'miss'}`;
  });
  step(boss.t.downTime + 0.5);
  out.getsBackUp = boss.down <= 0 && boss.height > 2;
  out.legsHittableUp = boss.armor('weak', knee) === 1;
  // 8. one collapse takes at most coreBite of the core, then the hatch closes and it stands up early
  for (const l of boss.legs.slice(2, 4)) boss.damage(500, l.foot, dir, 'weak', l.knee);
  for (let i = 0; i < 20; i++) boss.damage(100, boss.pos, dir, 'weak', boss.core);
  out.coreTaken = boss.maxHealth - boss.health;
  out.biteCapped = boss.alive && Math.abs(out.coreTaken - boss.t.coreBite * boss.maxHealth) < 1e-6 && boss.armor('weak', boss.core) === 0 && boss.down <= 0.6;
  // 9. no legs left: down for good, no cap, kill it through the core
  for (const l of boss.legs.slice(4)) boss.damage(500, l.foot, dir, 'weak', l.knee);
  const kills = enemies.kills;
  let killed = false;
  for (let i = 0; i < 20 && !killed; i++) killed = boss.damage(100, boss.pos, dir, 'weak', boss.core);
  out.dies = killed && !boss.alive && enemies.kills === kills + 1;
  step(1);
  return out;
});
console.log(JSON.stringify(r, null, 1));
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect('dormant while the player is outside', r.dormantOutside);
expect('wakes when the player enters the arena', r.awake);
expect('camera locks on to the boss', r.lockOn < 0.1);
expect('looking around overrides the lock', r.lookOverrides > 0.5);
expect('and the camera comes back to the boss', r.lockReturns < 0.1);
expect('fires cannon bursts', r.bolts >= 6);
expect('walks (legs step)', r.steps > 6);
expect('mortars a player hiding behind a wall', r.blastsOnHider >= 1);
expect('pursues a player hiding behind a wall (closes in, round the cover)', r.pursuit[0] > 20 && r.pursuit[1] < 15);
expect('stays in its arena', r.stayedInArena);
expect('never inside a wall', r.neverInsideWalls);
expect('hull is armored', r.hullArmor === 0 && r.hullNoDamage && r.coreClosed === 0);
expect('two legs down: collapsed, core exposed', r.legsLost === 2 && r.down && r.coreOpen === 1 && r.legsNotTargetable);
expect('down: the risen core is hittable from the ground (half the sides at least)', r.coreShots.filter((x) => x === true).length >= 4);
expect('core open: the legs take no damage (armored)', r.legsArmoredOpen);
expect('gets back up after a while', r.getsBackUp);
expect('  standing again: the legs take damage', r.legsHittableUp);
expect('one collapse takes at most coreBite of the core, then the hatch closes', r.biteCapped);
expect('dies when the core is destroyed', r.dies);
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
