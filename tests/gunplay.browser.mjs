// Deterministic gunplay checks in a real browser (engine stepped at exact 1/60 s, seeded RNG).
// Needs the dev server: `npm run dev`, then `node tests/gunplay.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game);

const result = await p.evaluate(() => {
  const g = window.game;
  const { engine, player, camRig, weapon, enemies } = g;
  engine.stop();
  const keys = engine.input.keys;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const deg = (r) => +(r * 57.2958).toFixed(2);
  const out = {};

  // --- spread states ---
  player.pos.set(0, 0, 30);
  camRig.yaw = 0;
  camRig.pitch = 0;
  step(60);
  out.hipRest = +weapon.spread().toFixed(4);
  keys.add('Mouse2');
  step(60);
  out.aimBlend = +weapon.aimBlend().toFixed(2);
  out.aimRestFirstShot = +weapon.spread().toFixed(4);

  // --- recoil burst: 10 rounds aimed, from a known start, twice ---
  const burst = (s) => {
    camRig.pitch = 0; camRig.yaw = 0; camRig.recoilDebt = camRig.recoilYawDebt = camRig.kickPitch = camRig.kickYaw = 0;
    weapon.state.rifle.ammo = 32;
    step(40); // rest: pattern resets, first-shot accuracy back
    weapon.rng.seed(s); // the weapon's own stream: other systems' randomness can't shift it
    const trace = [];
    keys.add('Mouse0');
    while (32 - weapon.state.rifle.ammo < 10) { step(); trace.push(camRig.pitch); }
    keys.delete('Mouse0');
    step(6);
    const peak = Math.max(...trace, camRig.pitch);
    const yaw = camRig.yaw;
    step(150);
    return { frames: trace.length, peak: deg(peak), yaw: deg(yaw), settled: deg(camRig.pitch) };
  };
  out.burstA = burst(42);
  out.burstB = burst(42);
  out.burstC = burst(99);
  keys.delete('Mouse2');
  step(30);

  // --- crosshair over an enemy, first shot lands on it ---
  const pp = enemies.puppets.find((x) => x.kind === 'static' && x.pos.x === 10 && x.pos.z === 18);
  player.pos.set(9, 0, 30);
  const chest = pp.rig.bones.Spine2.getWorldPosition(pp.pos.clone());
  keys.add('Mouse2');
  for (let i = 0; i < 90; i++) {
    const c = camRig.camera.position;
    camRig.yaw = Math.atan2(-(chest.x - c.x), -(chest.z - c.z));
    camRig.pitch = Math.atan2(chest.y - c.y, Math.hypot(chest.x - c.x, chest.z - c.z));
    step();
  }
  out.probe = { enemy: weapon.aim.enemy, blocked: weapon.aim.blocked, cross: document.getElementById('crosshair').className };
  const hits = [];
  engine.events.on('weapon:hit', (h) => hits.push({ zone: h.zone, amount: +h.amount.toFixed(1), dist: +h.distance.toFixed(1) }));
  const ammo = weapon.ammo;
  keys.add('Mouse0'); step(); keys.delete('Mouse0'); step(2);
  out.firstShot = { fired: ammo - weapon.ammo, hits };
  keys.delete('Mouse2');
  return out;
});

console.log(JSON.stringify(result, null, 1));
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect('aimed first shot is pin-point', result.aimRestFirstShot < 0.0006 && result.aimBlend > 0.98);
expect('hip spread wider than aimed', result.hipRest > result.aimRestFirstShot * 5);
expect('same seed = same burst', JSON.stringify(result.burstA) === JSON.stringify(result.burstB));
expect('pattern dominates jitter', Math.abs(result.burstA.peak - result.burstC.peak) < result.burstA.peak * 0.1);
expect('aimed 10-round climb 3-4.5°', result.burstA.peak > 3 && result.burstA.peak < 4.5);
expect('recovery returns most of the climb', result.burstA.settled < result.burstA.peak * 0.25);
expect('crosshair reads enemy', result.probe.enemy && !result.probe.blocked && /enemy/.test(result.probe.cross));
expect('first aimed shot hits the target', result.firstShot.fired === 1 && result.firstShot.hits.length === 1);
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
