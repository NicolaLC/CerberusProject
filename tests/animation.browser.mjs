// Locomotion: the key-pose gait plants its feet (no sliding while a foot carries weight) at walk, jog, sprint,
// strafe and backpedal speeds, and the swing foot actually leaves the ground.
// Needs the dev server: `npm run dev`, then `node tests/animation.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 160, height: 90 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game);
const r = await p.evaluate(() => {
  const g = window.game;
  g.engine.stop();
  g.engine.headless = true;
  const t = g.enemies.puppets.find((x) => x.kind === 'trooper');
  const V = t.pos.constructor;
  const out = {};
  // [name, speed, run, local move direction (x = left, z = forward)]
  for (const [name, v, run, dx, dz] of [['walk', 1.4, false, 0, 1], ['jog', 4.6, false, 0, 1], ['sprint', 7.4, true, 0, 1], ['strafe', 2.6, false, 1, 0], ['back', 2.0, false, 0, -1]]) {
    const pos = new V(4, 0, -6);
    const yaw = Math.PI / 2; // facing +X: local forward = +X, local left (+x) = -Z
    const vel = new V(dz * v, 0, -dx * v);
    const prev = {};
    let slide = 0;
    let planted = 0;
    let maxLift = 0;
    for (let i = 0; i < 300; i++) {
      pos.addScaledVector(vel, 1 / 60);
      t.group.position.copy(pos);
      t.rig.root.rotation.y = yaw;
      t.group.updateMatrixWorld(true);
      t.animator.update(1 / 60, { speed: v, run, crouch: 0, aimPitch: 0, combat: false, vel, yaw });
      for (const s of ['Left', 'Right']) {
        const f = t.rig.bones[s + 'Foot'].getWorldPosition(new V());
        f.st = t.animator.legs[s].stance;
        if (i > 60) {
          maxLift = Math.max(maxLift, f.y);
          if (prev[s] && f.st >= 0.99 && prev[s].st >= 0.99) {
            slide += Math.hypot(f.x - prev[s].x, f.z - prev[s].z);
            planted++;
          }
        }
        prev[s] = f;
      }
    }
    out[name] = { slideMm: +((1000 * slide) / Math.max(1, planted)).toFixed(2), planted, lift: +maxLift.toFixed(2) };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
for (const [name, m] of Object.entries(r)) {
  expect(`${name}: planted feet stay put (${m.slideMm} mm/frame)`, m.planted > 30 && m.slideMm < 2);
  expect(`${name}: the swing foot leaves the ground (${m.lift} m)`, m.lift > 0.15);
}
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
