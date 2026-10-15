// Prologue halls: hall A's mezzanine gunners and hall B's crossfire lane. Posted troopers (`post: true`) hold their spot and fire;
// in hall B the two corner gunners leave almost no floor spot where a crouched player is hidden from both.
// Needs the dev server: `bun run dev`, then `node tests/prologue-halls.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const url = new URL(process.env.URL ?? 'http://localhost:5173/?debug&scene=arena');
url.searchParams.set('scene', 'prologue');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.addInitScript(() => { try { localStorage.setItem('cerberus.introSeen', 'true'); } catch {} });
await p.goto(url.href);
await p.waitForFunction(() => window.game?.engine);
const r = await p.evaluate(async () => {
  const { sightRay } = await import('/src/game/actors/enemy.js');
  const g = window.game;
  const { engine, enemies, player, world } = g;
  engine.stop();
  engine.headless = true;
  const step = (s, x, z) => { for (let i = 0; i < s * 60; i++) { player.pos.set(x, 0, z); player.health = player.shields = 100; engine.step(1 / 60); } };
  for (let i = 0; i < 60 && g.cinematic.active; i++) { g.cinematic.update(1 / 60, true); step(0.2, -9, -36); } // past the intro
  const out = {};
  let bolts = 0;
  engine.events.on('bolt:fired', () => bolts++);
  const posted = (inB) => enemies.all.filter((e) => e.post && e.pos.x > 8 === inB);
  // hall A: the mezzanine gunners, 3.6 m up, fire on a player in the hall and never leave the deck
  const A = posted(false);
  const startA = A.map((e) => e.pos.clone());
  enemies.wakeGroup('purge-2');
  step(8, -4, -42);
  out.mezzanine = { n: A.length, up: A.every((e) => Math.abs(e.pos.y - 3.6) < 0.05), held: A.every((e, i) => e.pos.distanceTo(startA[i]) < 0.01), bolts };
  // hall B: crouched (chest 0.8), hidden from both gunners' standing eyes in under 10% of the free floor
  for (const e of enemies.all) if (e.squad === 'purge-2') e.alive = false;
  enemies.dirty = true;
  enemies.wakeGroup('purge-4');
  const B = posted(true);
  const startB = B.map((e) => e.pos.clone());
  step(0.5, 16, -33);
  const V = player.pos.constructor;
  let spots = 0;
  let safe = 0;
  for (let x = 9; x <= 23; x += 0.5) {
    for (let z = -61; z <= -31; z += 0.5) {
      if (world.nearColliders(x - 0.4, z - 0.4, x + 0.4, z + 0.4).some(({ box: c }) => c.max.y > 0.45 && c.min.y < 1.8)) continue;
      spots++;
      const chest = new V(x, 0.8, z);
      if (B.every((e) => !sightRay(e.pos.clone().setY(1.6), chest, world.meshes, 0.4))) safe++;
    }
  }
  bolts = 0;
  step(6, 16, -42);
  out.crossfire = { n: B.length, safe: +(safe / spots).toFixed(3), held: B.every((e, i) => e.pos.distanceTo(startB[i]) < 0.01), bolts };
  return out;
});
console.log(JSON.stringify(r));
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect('hall A: two gunners posted on the mezzanine (3.6 m), they fire and hold the deck', r.mezzanine.n === 2 && r.mezzanine.up && r.mezzanine.held && r.mezzanine.bolts > 0);
expect('hall B: two posted gunners fire on an exposed player and hold their corners', r.crossfire.n === 2 && r.crossfire.held && r.crossfire.bolts > 0);
expect('hall B: a crouched player is hidden from both gunners in under 10% of the floor', r.crossfire.safe < 0.1);
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
