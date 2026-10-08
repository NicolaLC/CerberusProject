// Deterministic gunplay checks in a real browser (engine stepped at exact 1/60 s, seeded RNG).
// Needs the dev server: `npm run dev`, then `node tests/gunplay.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game);

const result = await p.evaluate(() => {
  const g = window.game;
  const { engine, player, camRig, weapon, enemies } = g;
  engine.stop();
  engine.headless = true; // simulate only: nothing here checks pixels
  const keys = engine.input.keys;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const deg = (r) => +(r * 57.2958).toFixed(2);
  // a key press as the browser delivers it: held + a press edge for this frame
  const press = (code, frames = 1) => { keys.add(code); engine.input.pressed.add(code); step(frames); keys.delete(code); };
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
  out.firstShot = { fired: ammo - weapon.ammo, hits: [...hits] };

  // --- sniper: semi-auto, scoped zoom, pin-point, one body shot destroys a puppet ---
  press('Digit3');
  step(60);
  const aimAt = () => {
    const c = camRig.camera.position;
    camRig.yaw = Math.atan2(-(chest.x - c.x), -(chest.z - c.z));
    camRig.pitch = Math.atan2(chest.y - c.y, Math.hypot(chest.x - c.x, chest.z - c.z));
  };
  for (let i = 0; i < 60; i++) { aimAt(); step(); }
  out.sniper = { gun: weapon.current, fov: +camRig.fov.toFixed(1), aimBlend: +weapon.aimBlend().toFixed(2), spread: +weapon.spread().toFixed(5) };
  out.sniper.scope = +getComputedStyle(document.getElementById('scope')).opacity;
  hits.length = 0;
  const sAmmo = weapon.ammo;
  press('Mouse0', 120); // held 2 s: still one round
  out.sniper.heldShots = sAmmo - weapon.ammo;
  out.sniper.killed = hits.length === 1 && hits[0].zone === 'torso' && !pp.alive;
  // a click just before the bolt is back is buffered and fires when it is
  press('Mouse0');
  step(42); // 0.72 s: bolt still cycling (0.86 s)
  const before = weapon.ammo;
  press('Mouse0');
  step(20);
  out.sniper.buffered = before - weapon.ammo;
  keys.delete('Mouse2');
  step(30);

  // --- failed active reload: the reload UI goes away ---
  press('KeyR'); step(2);
  const barUp = +document.getElementById('areload').style.opacity;
  press('KeyR'); step(2); // far too early: jam
  out.jam = { result: weapon.result?.kind, barUp, barAfter: +document.getElementById('areload').style.opacity, stillReloading: weapon.reloading > 0 };

  // --- wall cover: no aiming or shooting away from the wall's ends ---
  for (const e of enemies.puppets) e.alive = false;
  enemies.dirty = true;
  step(200); // finish the reload
  player.pos.set(34, 0, -21.3); // south face of the arena wall at (34, -23), 6 m long
  camRig.yaw = 0;
  step(10);
  press('Space', 30);
  const wallAmmo = weapon.ammo;
  keys.add('Mouse2');
  keys.add('Mouse0');
  step(30);
  out.wall = { inCover: player.cover?.type, pinned: player.pinned, aiming: player.aiming, fired: wallAmmo - weapon.ammo };
  keys.delete('Mouse0');
  player.pos.x = 36.75; // at the east end
  step(30);
  out.wall.edgeAiming = player.aiming && !player.pinned;
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
expect('sniper scopes in (narrow fov, overlay)', result.sniper.gun === 'sniper' && result.sniper.fov < 26 && result.sniper.aimBlend > 0.98 && result.sniper.scope > 0.9);
expect('sniper aimed is pin-point', result.sniper.spread === 0);
expect('sniper is semi-auto (held trigger = 1 round)', result.sniper.heldShots === 1);
expect('sniper body shot destroys a puppet', result.sniper.killed);
expect('sniper buffers a click during the bolt cycle', result.sniper.buffered === 1);
expect('failed active reload removes the reload bar', result.jam.result === 'jam' && result.jam.barUp === 1 && result.jam.barAfter === 0 && result.jam.stillReloading);
expect('wall cover: no aiming or firing mid-wall', result.wall.inCover === 'high' && result.wall.pinned && !result.wall.aiming && result.wall.fired === 0);
expect('wall cover: aiming works at the end', result.wall.edgeAiming);
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
