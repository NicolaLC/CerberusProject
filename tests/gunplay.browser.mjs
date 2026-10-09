// Deterministic gunplay checks in a real browser (engine stepped at exact 1/60 s, seeded RNG).
// Needs the dev server: `npm run dev`, then `node tests/gunplay.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game?.engine);

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
  press('KeyW', 30); // walk into the wall: automatic cover
  const wallAmmo = weapon.ammo;
  keys.add('Mouse2');
  keys.add('Mouse0');
  step(30);
  out.wall = { inCover: player.cover?.type, pinned: player.pinned, aiming: player.aiming, fired: wallAmmo - weapon.ammo };
  keys.delete('Mouse0');
  player.pos.x = 36.75; // at the east end
  step(30);
  out.wall.edgeAiming = player.aiming && !player.pinned;
  out.wall.peekRight = { peek: camRig.peekSide, shoulder: camRig.shoulder };
  player.pos.x = 31.25; // west end: the peek puts the camera on the left
  step(40);
  out.wall.peekLeft = { peek: camRig.peekSide, shoulder: camRig.shoulder, side: +camRig.side.toFixed(2) };
  keys.delete('Mouse2');
  step(60);
  keys.add('Mouse2'); // aim again away from cover: back on the player's (right) shoulder
  player.cover = null;
  player.pos.set(34, 0, -18);
  step(60);
  out.wall.afterSide = +camRig.side.toFixed(2);
  keys.delete('Mouse2');
  step(10);

  // --- sliding along cover animates the legs ---
  player.pos.set(33, 0, -21.3);
  camRig.yaw = 0;
  step(10);
  press('KeyW', 30);
  const legs = player.animator.legs;
  let swing = 0;
  const x0 = player.pos.x;
  keys.add('KeyD');
  for (let i = 0; i < 60; i++) { step(); swing = Math.max(swing, Math.abs(legs.Left.thigh - legs.Right.thigh)); }
  keys.delete('KeyD');
  out.slide = { cover: player.cover?.type, moved: +(player.pos.x - x0).toFixed(2), swing: +swing.toFixed(2) };
  press('KeyS', 20); // moving away leaves cover

  // --- aim is held, never latched (also in trackpad mode) ---
  const s = g.settings ?? null;
  out.hold = {};
  keys.add('Mouse2'); step(20); out.hold.held = player.aiming;
  keys.delete('Mouse2'); step(20); out.hold.released = player.aiming;
  if (s) {
    s.trackpad = true;
    press('Mouse2', 20); step(20); out.hold.trackpadReleased = player.aiming;
    s.trackpad = false;
  }

  // --- new guns ---
  player.pos.set(0, 0, 30);
  camRig.yaw = 0;
  camRig.pitch = 0.3; // at the sky: nothing to hit
  const fireFor = (frames) => { const a0 = weapon.ammo; keys.add('Mouse0'); step(frames); keys.delete('Mouse0'); return a0 - weapon.ammo; };
  press('Digit4'); step(40);
  out.burst = { gun: weapon.current };
  const b0 = weapon.ammo;
  press('Mouse0');
  step(20);
  out.burst.tap = b0 - weapon.ammo;
  weapon.state.burst.ammo = 24; step(30);
  out.burst.held = fireFor(50); // 0.83 s held: bursts at 0, ~0.43 s, ~0.87 s -> 2 bursts (6 rounds)
  weapon.state.burst.ammo = 24; step(30);
  keys.add('Mouse2'); step(60);
  out.burst.aimSpread = +weapon.spread().toFixed(4);
  keys.delete('Mouse2'); step(30);

  press('Digit5'); step(40);
  out.rail = { gun: weapon.current };
  const r0 = weapon.ammo;
  press('Mouse0', 1);
  step(15);
  out.rail.early = r0 - weapon.ammo; // still charging
  step(20);
  out.rail.fired = r0 - weapon.ammo;
  // pierce: a second puppet placed on the line in front of the aimed one, one slug drops both
  const A = enemies.puppets.find((x) => x.kind === 'static' && x.pos.x === -10 && x.pos.z === 18);
  const B = enemies.puppets.find((x) => x.kind === 'static' && x.pos.x === 34 && x.pos.z === 20);
  for (const e of [A, B]) { e.alive = true; e.health = 100; e.rig.root.visible = true; }
  enemies.dirty = true;
  player.pos.set(-10, 0, 34);
  weapon.state.rail.ammo = 4;
  step(60);
  const trackChest = (target) => {
    const at = target.rig.bones.Spine2.getWorldPosition(target.pos.clone());
    for (let i = 0; i < 60; i++) {
      const c = camRig.camera.position;
      camRig.yaw = Math.atan2(-(at.x - c.x), -(at.z - c.z));
      camRig.pitch = Math.atan2(at.y - c.y, Math.hypot(at.x - c.x, at.z - c.z));
      step();
    }
    return at;
  };
  keys.add('Mouse2');
  const chestA = trackChest(A);
  const muz = player.muzzle.getWorldPosition(A.pos.clone());
  const mid = muz.lerp(chestA, 0.5);
  B.pos.set(mid.x, 0, mid.z);
  step(5);
  trackChest(B);
  const railHits = [];
  engine.events.on('weapon:hit', (h) => { if (weapon.current === 'rail') railHits.push(h.zone); });
  press('Mouse0');
  step(40);
  keys.delete('Mouse2');
  out.rail.pierce = { hits: railHits.length, a: A.alive, b: B.alive };

  // --- railgun charge ring: visible mid-charge, filling, gone after the shot ---
  weapon.state.rail.ammo = 4;
  for (const e of enemies.puppets) e.alive = false;
  enemies.dirty = true;
  camRig.pitch = 0.3;
  step(60);
  const ring = document.getElementById('charge');
  const ringArc = ring.querySelector('.arc');
  const ringOp = () => +getComputedStyle(ring).opacity;
  out.ring = { before: ringOp() };
  press('Mouse0', 1);
  step(10);
  out.ring.mid = ringOp();
  out.ring.midOffset = +ringArc.style.strokeDashoffset;
  step(10);
  out.ring.lateOffset = +ringArc.style.strokeDashoffset;
  step(30);
  out.ring.after = ringOp();
  // a cancelled charge (sprint / switch) hides it too
  step(40); press('Mouse0', 1); step(8);
  out.ring.cancelMid = ringOp();
  press('Digit1'); step(40);
  out.ring.cancelled = ringOp();
  press('Digit5'); step(40);

  // --- railgun line: 6 targets in a row all hit by one slug; a wall in between stops it ---
  const targets = enemies.puppets.filter((x) => x.kind === 'static' && x.debris.length === 0).slice(0, 6);
  const V3 = player.pos.constructor;
  const chestOf = (e) => e.rig.bones.Spine2.getWorldPosition(new V3());
  const trackPoint = (at) => {
    const c = camRig.camera.position;
    camRig.yaw = Math.atan2(-(at.x - c.x), -(at.z - c.z));
    camRig.pitch = Math.atan2(at.y - c.y, Math.hypot(at.x - c.x, at.z - c.z));
  };
  const revive = (e) => { e.alive = true; e.health = 100; e.rig.root.visible = true; };
  player.pos.set(0, 0, 36);
  camRig.yaw = 0;
  step(30);
  targets.forEach(revive);
  targets[0].pos.set(0, 0, 30);
  enemies.dirty = true;
  keys.add('Mouse2');
  for (let i = 0; i < 40; i++) { trackPoint(chestOf(targets[0])); step(); }
  // put the rest on the muzzle -> chest line, 2.5 m apart, chests on the line (so each is hit on the torso)
  const M = player.muzzle.getWorldPosition(new V3());
  const C0 = chestOf(targets[0]);
  const lineDir = C0.clone().sub(M).normalize();
  const chestH = C0.y - targets[0].pos.y;
  const L0 = C0.distanceTo(M);
  const lineAt = (d) => M.clone().addScaledVector(lineDir, d);
  targets.forEach((e, i) => {
    if (i === 0) return;
    const q = lineAt(L0 + i * 2.5);
    e.pos.set(q.x, q.y - chestH, q.z);
  });
  step(5);
  for (let i = 0; i < 20; i++) { trackPoint(chestOf(targets[0])); step(); }
  const shoot = () => {
    weapon.state.rail.ammo = 4;
    weapon.cooldown = 0;
    step(30);
    let hits = 0;
    let to = null;
    const off1 = engine.events.on('weapon:hit', () => hits++);
    const off2 = engine.events.on('weapon:shot', (s2) => { to = s2.to.clone(); });
    press('Mouse0'); step(40);
    off1(); off2();
    return { hits, to };
  };
  const clear = shoot();
  out.line = { n: targets.length, hits: clear.hits, alive: targets.filter((e) => e.alive).length, endZ: clear.to ? +clear.to.z.toFixed(1) : null };
  // a wall between the 3rd and 4th target: only the first three are hit, the trail ends at the wall
  targets.forEach(revive);
  enemies.dirty = true;
  const wp = lineAt(L0 + 2.5 * 2.5);
  const wallMesh = g.world.box(wp.x, 0, wp.z, 8, 4, 0.4, g.world.meshes[0].material);
  step(5);
  const walled = shoot();
  out.line.wall = { hits: walled.hits, alive: targets.filter((e) => e.alive).length, endDist: walled.to ? +walled.to.distanceTo(M).toFixed(1) : null, wallDist: +wp.distanceTo(M).toFixed(1) };
  g.world.meshes.splice(g.world.meshes.indexOf(wallMesh), 1);
  g.world.colliders.splice(g.world.colliders.indexOf(wallMesh.userData.collider), 1);
  wallMesh.removeFromParent();
  keys.delete('Mouse2');
  for (const e of targets) e.alive = false;
  enemies.dirty = true;
  step(20);

  // --- ammo classes: light pickups refill only light guns, heavy only heavy guns ---
  const { pickups } = g;
  const light = ['rifle', 'mg', 'burst', 'pistol'];
  const heavy = ['sniper', 'rail'];
  const setRes = (ids, v) => { for (const id of ids) weapon.state[id].reserve = v; };
  const res = (ids) => ids.map((id) => weapon.state[id].reserve);
  const full = (ids) => { for (const id of ids) weapon.state[id].reserve = 9999; };
  const toasts = [];
  engine.events.on('pickup:collected', (m) => toasts.push(m));
  let fulls = 0;
  engine.events.on('pickup:full', () => fulls++);
  const itemAt = (x, z) => pickups.items.find((i) => i.pos.x === x && i.pos.z === z);
  const stand = (x, z, y = 0) => { player.pos.set(x, y, z); step(3); };
  out.ammo = {};
  setRes([...light, ...heavy], 0);
  stand(6, 34); // light crate
  out.ammo.lightType = itemAt(6, 34).type;
  out.ammo.lightGot = { light: res(light), heavy: res(heavy), active: itemAt(6, 34).active };
  out.ammo.lightToast = toasts.at(-1);
  stand(26, 2.5); // heavy crate
  out.ammo.heavyType = itemAt(26, 2.5).type;
  out.ammo.heavyGot = { light: res(light), heavy: res(heavy), active: itemAt(26, 2.5).active };
  out.ammo.heavyToast = toasts.at(-1);
  // all light guns full: a light crate stays and says so; the heavy guns are not touched
  setRes(heavy, 0);
  full(light);
  stand(-24, 2.5);
  step(3);
  out.ammo.lightFull = { stays: itemAt(-24, 2.5).active, fulls, heavy: res(heavy) };
  // heavy crate with full heavy guns but empty light guns: stays, light guns not touched
  setRes(light, 0);
  full(heavy);
  player.pos.set(-30, 0, 34); // away from the clips the line shots dropped
  step(100); // the "full" message has a cooldown
  const f0 = fulls;
  stand(-20, -34);
  out.ammo.heavyFull = { type: itemAt(-20, -34).type, stays: itemAt(-20, -34).active, fulls: fulls - f0, light: res(light) };
  out.ammo.counts = { light: pickups.items.filter((i) => i.crate && i.type === 'light').length, heavy: pickups.items.filter((i) => i.crate && i.type === 'heavy').length };
  player.pos.set(-30, 0, 34);
  step(3);
  setRes([...light, ...heavy], 50);

  press('Digit6'); step(40);
  const p0 = weapon.ammo;
  press('Mouse0', 60); // held a second: still one round
  out.pistol = { gun: weapon.current, held: p0 - weapon.ammo };
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
expect('cover peek on the left edge moves the camera left for the peek only', result.wall.peekLeft.peek === -1 && result.wall.peekLeft.shoulder === 1 && result.wall.peekLeft.side < 0);
expect('aiming after a left peek is back on the right shoulder', result.wall.afterSide > 0.8);
expect('sliding along cover moves and swings the legs', result.slide.cover === 'high' && result.slide.moved > 0.5 && result.slide.swing > 0.3);
expect('aim is hold-only', result.hold.held && !result.hold.released && result.hold.trackpadReleased !== true);
expect('burst rifle: one tap = 3 rounds', result.burst.gun === 'burst' && result.burst.tap === 3);
expect('burst rifle: held trigger repeats bursts', result.burst.held === 6);
expect('burst rifle aimed is precise', result.burst.aimSpread < 0.002);
expect('railgun charges before the shot', result.rail.gun === 'rail' && result.rail.early === 0 && result.rail.fired === 1);
expect('railgun slug pierces two enemies on one line', result.rail.pierce.hits === 2 && !result.rail.pierce.a && !result.rail.pierce.b);
expect('charge ring: hidden before, visible and filling mid-charge, gone after the shot', result.ring.before === 0 && result.ring.mid === 1 && result.ring.lateOffset < result.ring.midOffset && result.ring.midOffset < 175 && result.ring.after === 0);
expect('charge ring: gone when the charge is cancelled', result.ring.cancelMid === 1 && result.ring.cancelled === 0);
expect('railgun: one slug hits all 6 targets on the line', result.line.n >= 6 && result.line.hits === 6 && result.line.alive === 0);
expect('railgun: a wall stops the slug (only targets in front hit, trail ends at the wall)', result.line.wall.hits === 3 && result.line.wall.alive === result.line.n - 3 && Math.abs(result.line.wall.endDist - result.line.wall.wallDist) < 0.5);
expect('ammo: crate spots are typed (7 light, 3 heavy)', result.ammo.counts.light === 7 && result.ammo.counts.heavy === 3);
expect('ammo: light pickup refills light guns only', result.ammo.lightType === 'light' && result.ammo.lightGot.light.every((v) => v > 0) && result.ammo.lightGot.heavy.every((v) => v === 0) && !result.ammo.lightGot.active && /^LIGHT AMMO/.test(result.ammo.lightToast));
expect('ammo: heavy pickup refills sniper and railgun only', result.ammo.heavyType === 'heavy' && result.ammo.heavyGot.heavy.every((v) => v > 0) && !result.ammo.heavyGot.active && /^HEAVY AMMO/.test(result.ammo.heavyToast));
expect('ammo: full class leaves the pickup ("AMMO FULL"), other class untouched', result.ammo.lightFull.stays && result.ammo.lightFull.fulls === 1 && result.ammo.lightFull.heavy.every((v) => v === 0) && result.ammo.heavyFull.stays && result.ammo.heavyFull.fulls === 1 && result.ammo.heavyFull.light.every((v) => v === 0));
expect('pistol is semi-auto', result.pistol.gun === 'pistol' && result.pistol.held === 1);
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
