// Controller support with a simulated standard gamepad (navigator.getGamepads is replaced before load):
// sticks move and look, triggers aim and fire, buttons reload / switch / cover, Menu pauses and A deploys.
// Needs the dev server: `npm run dev`, then `node tests/gamepad.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.addInitScript(() => {
  const pad = {
    id: 'Test Pad (STANDARD GAMEPAD)',
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  window.__pad = pad;
  navigator.getGamepads = () => [pad];
});
await p.goto(URL);
await p.waitForFunction(() => window.game);
const r = await p.evaluate(() => {
  const g = window.game;
  const { engine, player, camRig, weapon, enemies } = g;
  engine.stop();
  engine.headless = true; // simulate only: nothing here checks pixels
  for (const e of enemies.puppets) e.alive = false; // quiet arena
  enemies.dirty = true;
  const pad = window.__pad;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const btn = (i, v) => { pad.buttons[i] = { pressed: v > 0.5, value: v }; };
  const tap = (i, frames = 1) => { btn(i, 1); step(frames); btn(i, 0); step(); };
  const out = {};
  player.pos.set(0, 0, 30);
  camRig.yaw = 0;
  step(10);

  // left stick forward: moves where the camera looks (-Z), device switches to the pad
  pad.axes = [0, -1, 0, 0];
  const z0 = player.pos.z;
  step(60);
  out.moved = +(z0 - player.pos.z).toFixed(2);
  out.device = engine.input.device;
  // half tilt walks slower
  pad.axes = [0, -0.55, 0, 0];
  step(30);
  const z1 = player.pos.z;
  step(30);
  out.halfSpeed = +((z1 - player.pos.z) * 2).toFixed(2);
  // L3 click: sprint while the stick stays pushed
  pad.axes = [0, -1, 0, 0];
  tap(10);
  step(20);
  out.sprint = player.sprinting;
  pad.axes = [0, 0, 0, 0];
  step(20);
  out.sprintEnds = !player.sprinting;

  // right stick turns the camera; the dead zone ignores drift
  pad.axes = [0, 0, 0.08, 0.05];
  let yaw = camRig.yaw;
  step(30);
  out.drift = +Math.abs(camRig.yaw - yaw).toFixed(4);
  pad.axes = [0, 0, 1, 0];
  yaw = camRig.yaw;
  step(30);
  out.turned = +(yaw - camRig.yaw).toFixed(2); // right = yaw decreases
  pad.axes = [0, 0, 0, 0];
  step(10);

  // triggers: LT aims, RT fires
  btn(6, 1);
  step(30);
  out.aiming = player.aiming;
  const ammo = weapon.ammo;
  btn(7, 1);
  step(20);
  btn(7, 0);
  btn(6, 0);
  step(5);
  out.fired = ammo - weapon.ammo;
  // X reloads, d-pad right = sniper, RB = next gun, d-pad down = pistol
  tap(2);
  out.reloading = weapon.reloading > 0;
  step(200);
  tap(15);
  step(40);
  out.sniper = weapon.current;
  tap(5);
  step(40);
  out.next = weapon.current;
  tap(13); // d-pad down: sidearm
  step(40);
  out.sidearm = weapon.current;
  // Menu pauses, A deploys again
  tap(9);
  out.paused = engine.paused;
  const overlay = getComputedStyle(document.getElementById('overlay')).display;
  out.padStatus = document.getElementById('pad-status').textContent;
  tap(0);
  out.resumed = !engine.paused;
  out.overlayShown = overlay;
  return out;
});
console.log(JSON.stringify(r, null, 1));
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect('left stick moves (camera relative)', r.moved > 2 && r.device === 'pad');
expect('half tilt walks slower', r.halfSpeed > 1 && r.halfSpeed < r.moved * 0.8);
expect('L3 sprints until the stick is released', r.sprint && r.sprintEnds);
expect('stick drift inside the dead zone is ignored', r.drift === 0);
expect('right stick turns the camera', r.turned > 0.5);
expect('LT aims', r.aiming);
expect('RT fires', r.fired >= 3); // 0.33 s at 540 rpm
expect('X reloads', r.reloading);
expect('d-pad right selects the sniper, RB cycles', r.sniper === 'sniper' && r.next === 'burst');
expect('d-pad down selects the pistol', r.sidearm === 'pistol');
expect('Menu pauses, A deploys', r.paused && r.overlayShown === 'flex' && r.resumed && /Test Pad/.test(r.padStatus));
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
