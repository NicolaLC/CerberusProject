// Puppet rules: destroyed puppets stay destroyed; shooters only engage inside their range.
// Needs the dev server: `npm run dev`, then `node tests/enemies.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game);
const r = await p.evaluate(() => {
  const g = window.game;
  const { engine, enemies, player } = g;
  engine.stop();
  const step = (s) => { for (let i = 0; i < s * 60; i++) engine.step(1 / 60); };
  const out = {};

  // 1. a destroyed puppet stays destroyed
  const pp = enemies.puppets.find((x) => x.kind === 'static');
  const sceneBefore = engine.scene.children.length;
  pp.damage(999, pp.pos.clone(), new pp.pos.constructor(0, 0, 1), 'torso');
  step(15);
  out.stillDead = !pp.alive && !pp.rig.root.visible;
  out.debrisCleared = pp.debris.length === 0 && engine.scene.children.length === sceneBefore;
  out.notTargetable = !enemies.hitMeshes().some((m) => m.userData.enemy === pp);
  out.kills = enemies.kills;

  // 2. shooters engage only within range: count bolts per shooter
  const shooter = enemies.puppets.find((x) => x.kind === 'shooter' && x.pos.z === -15.3 && x.pos.x === 2);
  const others = enemies.puppets.filter((x) => x.kind === 'shooter' && x !== shooter);
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
expect('no page errors', errors.length === 0);
await b.close();
process.exit(fail.length ? 1 : 0);
