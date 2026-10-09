// Locomotion: the key-pose gait plants its feet (no sliding while a foot carries weight) at walk, jog, sprint,
// strafe and backpedal speeds, and the swing foot actually leaves the ground.
// Needs the dev server: `npm run dev`, then `node tests/animation.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 160, height: 90 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game?.engine);
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
    let hipsPrev = null;
    let hipsVel = 0;
    let hipsJerk = 0; // largest frame-to-frame change of the hips' vertical speed (m/frame): pops show here
    for (let i = 0; i < 300; i++) {
      pos.addScaledVector(vel, 1 / 60);
      t.group.position.copy(pos);
      t.rig.root.rotation.y = yaw;
      t.group.updateMatrixWorld(true);
      t.animator.update(1 / 60, { speed: v, run, crouch: 0, aimPitch: 0, combat: false, vel, yaw });
      const hy = t.rig.bones.Hips.getWorldPosition(new V()).y;
      if (i > 60 && hipsPrev !== null) {
        hipsJerk = Math.max(hipsJerk, Math.abs(hy - hipsPrev - hipsVel));
        hipsVel = hy - hipsPrev;
      }
      hipsPrev = hy;
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
    out[name] = { slideMm: +((1000 * slide) / Math.max(1, planted)).toFixed(2), planted, lift: +maxLift.toFixed(2), hipsJerkMm: +(1000 * hipsJerk).toFixed(1) };
  }
  return out;
});

// The player: stopping settles into idle without a pop, moving along cover turns into the move with feet on
// the floor, cover is automatic, and vaulting picks a jump (thin block) or a slide (deep block).
const pl = await p.evaluate(() => {
  const g = window.game;
  const { engine, player, enemies, camRig } = g;
  for (const e of enemies.puppets) e.alive = false;
  const keys = engine.input.keys;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const press = (code, frames = 1) => { keys.add(code); engine.input.pressed.add(code); step(frames); keys.delete(code); };
  const B = player.animator.rig.bones;
  const names = ['LeftFoot', 'RightFoot', 'LeftLeg', 'RightLeg'];
  // largest per-frame joint move relative to the body, minus what the body itself did
  const track = (frames) => {
    let jump = 0;
    let low = 9;
    let prev = null;
    for (let i = 0; i < frames; i++) {
      step();
      const cur = names.map((n) => B[n].getWorldPosition(player.pos.clone()).sub(player.pos));
      if (prev) for (let j = 0; j < 4; j++) jump = Math.max(jump, cur[j].distanceTo(prev[j]));
      for (const n of ['LeftFoot', 'RightFoot']) low = Math.min(low, B[n].getWorldPosition(player.pos.clone()).y - player.pos.y);
      prev = cur;
    }
    return { jumpMm: Math.round(jump * 1000), low: +low.toFixed(3) };
  };
  const out = {};
  player.pos.set(0, 0, 30);
  camRig.yaw = 0;
  step(20);
  keys.add('KeyW'); step(90); keys.delete('KeyW');
  out.stop = track(60);
  // low cover, slide right
  player.pos.set(-24, 0, 1.3);
  step(20);
  press('KeyW', 30); // walking into the block snaps into cover (automatic)
  keys.add('KeyD'); step(12); // the block is 4 m long: measure mid-run, before its end
  out.coverMove = track(20);
  out.coverMove.crouch = +player.crouchBlend.toFixed(2);
  out.coverMove.cover = player.cover?.type;
  out.coverMove.v = +Math.hypot(player.vel.x, player.vel.z).toFixed(2);
  out.coverMove.x = +player.pos.x.toFixed(2);
  out.coverMove.facingErr = +Math.abs(Math.sin(Math.atan2(player.vel.x, player.vel.z) - player.facing)).toFixed(2);
  keys.delete('KeyD');
  step(40);
  // vaults
  const kinds = [];
  engine.events.on('player:vault', (k) => kinds.push(k));
  keys.add('KeyW'); press('Space'); keys.delete('KeyW'); // from that cover: a 1 m block -> jump
  step(60);
  out.coverVault = { kind: kinds.at(-1), z: +player.pos.z.toFixed(2), y: +player.pos.y.toFixed(2) };
  player.pos.set(-2, 0, 11); // deep side of the 1 x 3 block at (-2, 4): run in -> slide
  player.vel.set(0, 0, 0);
  camRig.yaw = 0;
  step(10);
  keys.add('ShiftLeft'); keys.add('KeyW');
  let peak = 0;
  for (let i = 0; i < 120 && !player.snap; i++) { step(); if (player.pos.z < 7.6) engine.input.pressed.add('Space'); } // Space inside the run-in reach (2.2 m from the face)
  for (let i = 0; i < 60; i++) { step(); peak = Math.max(peak, player.pos.y); }
  keys.delete('ShiftLeft'); keys.delete('KeyW');
  out.runVault = { kind: kinds.at(-1), z: +player.pos.z.toFixed(2), peak: +peak.toFixed(2) };
  return out;
});
console.log(JSON.stringify(r, null, 1), JSON.stringify(pl, null, 1));
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
for (const [name, m] of Object.entries(r)) {
  expect(`${name}: planted feet stay put (${m.slideMm} mm/frame)`, m.planted > 30 && m.slideMm < 2);
  expect(`${name}: the swing foot leaves the ground (${m.lift} m)`, m.lift > 0.15);
  expect(`${name}: the hips move smoothly (speed change ${m.hipsJerkMm} mm/frame)`, m.hipsJerkMm < 25);
}
expect(`player stops without a pop (${pl.stop.jumpMm} mm/frame)`, pl.stop.jumpMm < 120);
expect('moving along low cover: crouch-run facing the move, feet on the floor', pl.coverMove.crouch < 0.6 && pl.coverMove.facingErr < 0.2 && pl.coverMove.low > 0.07);
expect('Space + forward in cover jumps a thin block', pl.coverVault.kind === 'hop' && pl.coverVault.z < -0.7 && pl.coverVault.y < 0.05);
expect('running at a deep block slides over it (not over the head)', pl.runVault.kind === 'slide' && pl.runVault.z < 2.6 && pl.runVault.peak < 1.4);
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
