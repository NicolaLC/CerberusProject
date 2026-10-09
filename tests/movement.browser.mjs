// Movement: automatic cover (walk into a face, not along it, cooldown after leaving), the jetpack burst on
// Space (rise, land, events, onto low cover, off again) and the vault from cover.
// Needs the dev server: `npm run dev`, then `node tests/movement.browser.mjs` (Playwright + Chromium).
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
  const { engine, player, enemies, camRig, world } = g;
  engine.stop();
  engine.headless = true; // simulate only
  for (const e of enemies.puppets) e.alive = false;
  enemies.dirty = true;
  const keys = engine.input.keys;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const hold = (code, frames) => { keys.add(code); step(frames); keys.delete(code); };
  const press = (code, frames = 1) => { keys.add(code); engine.input.pressed.add(code); step(frames); keys.delete(code); };
  const events = [];
  for (const n of ['player:jet', 'player:land', 'player:vault']) engine.events.on(n, (d) => events.push(n + (n === 'player:jet' ? `@${d.point.y.toFixed(2)}/${d.dir.y}` : '')));
  const reset = (x, z) => { player.pos.set(x, 0, z); player.vel.set(0, 0, 0); player.vy = 0; player.cover = null; player.snap = null; player.airborne = false; player.jetTimer = 0; player.coverTimer = 0; camRig.yaw = 0; step(15); events.length = 0; };
  // a high block (wall) and a low one from the level itself
  const col = (kind, test) => world.colliders.find((c) => c.cover === kind && test(c.box));
  const hi = col('high', (bx) => bx.max.x - bx.min.x > 5.5 && bx.max.z - bx.min.z < 1.5); // 6 x 1 at z 12
  const lo = col('low', (bx) => bx.max.x - bx.min.x > 2.5 && bx.max.z - bx.min.z < 1.2 && bx.min.z > 20); // 3 x 1 at z 25
  const hx = (hi.box.min.x + hi.box.max.x) / 2;
  const lx = (lo.box.min.x + lo.box.max.x) / 2;
  const out = {};

  // (a) walking into a wall: cover, no key but the move
  reset(hx, hi.box.max.z + 4);
  hold('KeyW', 60);
  out.a = { cover: player.cover?.type, dist: +(player.pos.z - hi.box.max.z).toFixed(2) };

  // (b) walking along it, close to the face: never snaps
  reset(hx - 6, hi.box.max.z + 0.55);
  let snapped = false;
  keys.add('KeyD');
  for (let i = 0; i < 160; i++) { step(); if (player.cover || player.snap) snapped = true; }
  keys.delete('KeyD');
  out.b = { snapped, x: +player.pos.x.toFixed(2) };

  // (c) moving away exits; pushing straight back in right away does not re-enter, a moment later it does
  reset(hx, hi.box.max.z + 4);
  hold('KeyW', 60);
  const wasIn = !!player.cover;
  hold('KeyS', 12);
  const exited = !player.cover;
  hold('KeyW', 6);
  const instant = !!player.cover || !!player.snap;
  reset(hx, hi.box.max.z + 1);
  hold('KeyW', 30);
  out.c = { wasIn, exited, instant, later: !!player.cover };

  // (c2) a diagonal push backward leaves cover too, with no snap back
  reset(hx, hi.box.max.z + 4);
  hold('KeyW', 60);
  const inC2 = !!player.cover;
  hold('KeyS', 2); // pure back first would exit; test the diagonal instead
  reset(hx, hi.box.max.z + 4);
  hold('KeyW', 60);
  keys.add('KeyS'); keys.add('KeyD'); step(20); keys.delete('KeyS'); keys.delete('KeyD');
  out.c2 = { inC2, exited: !player.cover, z: +player.pos.z.toFixed(2) };

  // (c3) sliding past the end of the cover walks on free (not while aiming), no snap back
  reset(hx, hi.box.max.z + 4);
  hold('KeyW', 60);
  const x0 = player.pos.x;
  keys.add('KeyD');
  let exitX = null;
  for (let i = 0; i < 240 && exitX === null; i++) { step(); if (!player.cover) exitX = player.pos.x; }
  step(30); // keeps pushing: walks on past the end (the next wall is 8 m away)
  keys.delete('KeyD');
  out.c3 = { x0, exitX, endX: +player.pos.x.toFixed(2), boxMaxX: hi.box.max.x, cover: !!player.cover, snap: !!player.snap };
  // aiming at the end keeps the cover (peek)
  reset(hx, hi.box.max.z + 4);
  hold('KeyW', 60);
  keys.add('Mouse2'); keys.add('KeyD'); step(120); keys.delete('Mouse2'); keys.delete('KeyD');
  out.c3.aimStays = !!player.cover;

  // (d) Space on open ground: a burst, then back down
  reset(0, 30);
  let peak = 0;
  let jetting = 0;
  press('Space');
  for (let i = 0; i < 150; i++) { step(); peak = Math.max(peak, player.pos.y); jetting = Math.max(jetting, player.jetting); }
  out.d = { peak: +peak.toFixed(2), y: player.pos.y, airborne: player.airborne, jetting, events: events.slice() };
  // a second press right after landing is held back by the cooldown only until ~0.9 s after take-off
  reset(0, 30);
  press('Space'); step(3);
  const midAir = player.airborne;
  engine.input.pressed.add('Space'); step(); // pressing in the air does nothing
  out.d.noDouble = midAir && events.filter((e) => e.startsWith('player:jet')).length === 1;

  // (e) jump + push toward low cover from a standstill (below the run-in vault speed): lands on top or past it,
  // never inside / stuck; then walks off
  const jumpAt = (dist) => {
    reset(lx, lo.box.max.z + dist);
    keys.add('KeyW');
    press('Space');
    let pk = 0;
    for (let i = 0; i < 150 && (player.airborne || i < 5); i++) { step(); pk = Math.max(pk, player.pos.y); }
    const landed = { x: +player.pos.x.toFixed(2), y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2), cover: !!player.cover, snap: !!player.snap, airborne: player.airborne, peak: +pk.toFixed(2) };
    keys.delete('KeyW');
    return landed;
  };
  out.e = jumpAt(1.2);
  const topLanded = out.e.y > 0.9;
  hold('KeyW', 90); // keeps walking forward: off the far side if on top
  out.e.after = { y: +player.pos.y.toFixed(2), z: +player.pos.z.toFixed(2) };
  out.e.inside = (() => { const v = player.pos.clone(); world.collideCircle(v, 0.4, 1.8, 0.45); return v.distanceTo(player.pos) > 0.01; })();
  out.e.topLanded = topLanded;
  out.e2 = jumpAt(2.2); // farther back: comes down in front of the block or on it, in any case grounded and free

  // (f) Space in low cover pushing into it: vault (hop over the 1 m block)
  reset(lx, lo.box.max.z + 1.2);
  hold('KeyW', 30);
  const inLow = player.cover?.type === 'low';
  events.length = 0;
  keys.add('KeyW'); press('Space');
  step(70);
  keys.delete('KeyW');
  out.f = { inLow, events: events.slice(), z: +player.pos.z.toFixed(2), y: +player.pos.y.toFixed(2), airborne: player.airborne };

  // (h) slide vault over a deep low block (approached from its end): aim, shoot, wider FOV, still completes
  const lowDeep = world.colliders.filter((c) => c.cover === 'low' && Math.max(c.box.max.x - c.box.min.x, c.box.max.z - c.box.min.z) > 2.4 && Math.min(c.box.max.x - c.box.min.x, c.box.max.z - c.box.min.z) < 1.3);
  const startSlide = () => {
    // find a block + end where the run-up is open and Space vaults in slide mode
    for (const c of lowDeep) {
      const bx = c.box;
      const alongX = bx.max.x - bx.min.x > bx.max.z - bx.min.z;
      for (const sign of [1, -1]) {
        const cx = (bx.min.x + bx.max.x) / 2;
        const cz = (bx.min.z + bx.max.z) / 2;
        const sx = alongX ? (sign > 0 ? bx.max.x + 1.2 : bx.min.x - 1.2) : cx;
        const sz = alongX ? cz : (sign > 0 ? bx.max.z + 1.2 : bx.min.z - 1.2);
        reset(sx, sz);
        camRig.yaw = alongX ? sign * Math.PI / 2 : sign > 0 ? 0 : Math.PI; // looking at the block, W pushes into it
        camRig.pitch = -0.08;
        camRig.recoilDebt = camRig.recoilYawDebt = camRig.kickPitch = camRig.kickYaw = 0;
        hold('KeyW', 40);
        if (player.cover?.type !== 'low') continue;
        events.length = 0;
        keys.add('KeyW'); press('Space'); keys.delete('KeyW');
        if (player.snap?.vault === 'slide') return { block: c, alongX, sign };
      }
    }
    return null;
  };
  const wep = g.weapon;
  const fresh = () => { wep.switchTo('rifle'); step(40); wep.state.rifle.ammo = wep.t.mag; wep.cooldown = 0; wep.bloom = 0; };
  out.h = { found: false };
  const slide0 = (() => { fresh(); return startSlide(); })();
  if (slide0) {
    out.h.found = true;
    keys.delete('KeyW');
    const snap = player.snap;
    const fovBefore = camRig.camera.fov; // not yet widened (the slide just began)
    // fire through the whole slide
    const ammo0 = wep.ammo;
    let shots = 0;
    const onShot = () => shots++;
    engine.events.on('weapon:shot', onShot);
    keys.add('Mouse0');
    let maxFov = 0;
    let slideFrames = 0;
    while (player.snap?.vault === 'slide' && slideFrames < 200) { step(); slideFrames++; maxFov = Math.max(maxFov, camRig.camera.fov); }
    keys.delete('Mouse0');
    out.h.shots = shots;
    out.h.ammoUsed = ammo0 - wep.ammo;
    out.h.completed = !player.snap;
    out.h.cancelledByFire = slideFrames < 20;
    out.h.slideFrames = slideFrames;
    out.h.fovBefore = +fovBefore.toFixed(2);
    out.h.maxFov = +maxFov.toFixed(2);
    out.h.hipFov = camRig.t.fov.normal;
    out.h.farSide = { x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), y: player.pos.y };
    const past = slide0.alongX ? slide0.sign * (slide0.block.box[slide0.sign > 0 ? 'min' : 'max'].x - player.pos.x) > 0 : slide0.sign * (slide0.block.box[slide0.sign > 0 ? 'min' : 'max'].z - player.pos.z) > 0;
    out.h.pastBlock = past;
    step(60);
    out.h.fovAfter = +camRig.camera.fov.toFixed(2);
    engine.events.off?.('weapon:shot', onShot);
  }
  // (h2) aiming mid-slide: aim FOV (zoom wins), the gun follows the camera (yaw twist, pitch), hips keep the slide yaw
  const slide1 = (() => { fresh(); return startSlide(); })();
  out.h2 = { found: !!slide1 };
  if (slide1) {
    keys.delete('KeyW');
    keys.add('Mouse2');
    const gunDir = new g.player.root.position.constructor();
    const camF = new gunDir.constructor();
    const gunAngle = () => {
      player.rigModel.bones.Weapon.getWorldDirection(gunDir); // +Z of the gun in world space
      // Object3D.getWorldDirection returns +Z: stocks are authored along +Z
      return gunDir.angleTo(camRig.forward);
    };
    const angles = [];
    const yaw0 = camRig.yaw;
    let n = 0;
    let wasAiming = false;
    let fovAtEnd = 0;
    let facingKept = true;
    let muzzleMinGap = 9;
    const top = slide1.block.box.max.y;
    const slideYaw = player.snap.yaw;
    while (player.snap?.vault === 'slide' && n < 200) {
      step(); n++;
      if (player.snap?.vault !== 'slide') break;
      if (n === 12) camRig.yaw = yaw0 + 0.8; // look off to the side mid-slide
      if (n > 20) { angles.push(gunAngle()); wasAiming = player.aiming; fovAtEnd = camRig.camera.fov; }
      if (n > 12) facingKept = facingKept && Math.abs(Math.atan2(Math.sin(player.facing - slideYaw), Math.cos(player.facing - slideYaw))) < 0.15;
      const mz = new gunDir.constructor();
      if (player.muzzle && n > 20 && n < 40) { player.muzzle.getWorldPosition(mz); muzzleMinGap = Math.min(muzzleMinGap, mz.y - top); }
    }
    keys.delete('Mouse2');
    out.h2.aiming = wasAiming;
    out.h2.fov = +fovAtEnd.toFixed(2);
    out.h2.aimFov = camRig.t.fov.aim;
    out.h2.gunAngleMax = angles.length ? +Math.max(...angles).toFixed(2) : null;
    out.h2.facingKept = facingKept;
    out.h2.muzzleGap = +muzzleMinGap.toFixed(2);
    out.h2.frames = n;
  }

  // (g) ceiling: under the building roof the head stops below it
  const roof = world.colliders.find((c) => c.box.min.y > 3 && c.box.max.y - c.box.min.y < 1 && c.box.max.x - c.box.min.x > 10);
  if (roof) {
    reset((roof.box.min.x + roof.box.max.x) / 2, (roof.box.min.z + roof.box.max.z) / 2);
    // find a free interior spot: walk the player there only if free of colliders
    const free = (() => { const v = player.pos.clone(); world.collideCircle(v, 0.4, 1.8, 0.45); return v.distanceTo(player.pos) < 0.01; })();
    let head = 0;
    if (free) { press('Space'); for (let i = 0; i < 80; i++) { step(); head = Math.max(head, player.pos.y + 1.8); } }
    out.g = { free, roofY: roof.box.min.y, head: +head.toFixed(2), vy: player.vy };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect('(a) walking into a wall enters high cover with no key', r.a.cover === 'high' && r.a.dist < 0.6);
expect('(b) walking along the wall close to its face never snaps', !r.b.snapped && r.b.x > 3);
expect('(c) moving away exits cover', r.c.wasIn && r.c.exited);
expect('(c) no instant re-entry, but it grabs again after the cooldown', !r.c.instant && r.c.later);
expect('(c2) a diagonal backward push exits cover', r.c2.inC2 && r.c2.exited);
expect('(c3) pushing along the cover past its end exits and walks on', r.c3.exitX !== null && !r.c3.cover && !r.c3.snap && r.c3.endX > r.c3.boxMaxX + 0.5);
expect('(c3) aiming at the end keeps the cover (peek)', r.c3.aimStays);
expect('(d) Space on open ground: burst peaks 1.2-1.8 m and lands back', r.d.peak > 1.2 && r.d.peak < 1.8 && r.d.y === 0 && !r.d.airborne && r.d.jetting > 0.15);
expect('(d) player:jet (nozzle ~1.2 m up, exhaust down) then player:land', r.d.events.length === 2 && /^player:jet@1\.2\d?\/-1$/.test(r.d.events[0]) && r.d.events[1] === 'player:land');
expect('(d) no double jump in the air', r.d.noDouble);
expect('(e) jump + push at low cover: ends on top of it (1.1 m) or past it, free, then walks off', !r.e.airborne && !r.e.snap && (Math.abs(r.e.y - 1.1) < 0.02 || (r.e.y === 0 && r.e.z < 24.4)) && r.e.peak > 1.1 && r.e.after.y === 0 && !r.e.inside);
expect('(e) a longer jump from 2.2 m also ends grounded and not stuck', !r.e2.airborne && !r.e2.snap && (Math.abs(r.e2.y - 1.1) < 0.02 || r.e2.y === 0));
expect('(f) Space in low cover pushing into it vaults over', r.f.inLow && r.f.events.includes('player:vault') && !r.f.events.some((e) => e.startsWith('player:jet')) && r.f.z < 24.4 && r.f.y === 0 && !r.f.airborne);
if (r.g?.free) expect(`(g) head stops under the roof (${r.g.head} <= ${r.g.roofY})`, r.g.head <= r.g.roofY + 0.001 && r.g.head > 1.8);
if (r.h.found) {
  expect('(h) slide vault: holding fire shoots during the slide (ammo drops, weapon:shot events)', r.h.shots >= 3 && r.h.ammoUsed === r.h.shots);
  expect('(h) firing does not cancel the slide: it completes on the far side', r.h.completed && !r.h.cancelledByFire && r.h.pastBlock && r.h.farSide.y === 0);
  expect('(h) FOV widens during the slide and returns afterwards', r.h.maxFov > r.h.hipFov + 4 && Math.abs(r.h.fovAfter - r.h.hipFov) < 1.5);
} else expect('(h) found a deep low block to slide over', false);
if (r.h2.found) {
  expect('(h2) aiming mid-slide gives the aim FOV (not the widened one)', r.h2.aiming && Math.abs(r.h2.fov - r.h2.aimFov) < 4);
  expect('(h2) the gun follows the camera (<0.35 rad) after looking 0.8 rad off to the side, the hips keep the slide yaw', r.h2.gunAngleMax !== null && r.h2.gunAngleMax < 0.35 && r.h2.facingKept);
  expect('(h2) the muzzle stays above the block top (no clipping at level aim)', r.h2.muzzleGap > 0.1);
} else expect('(h2) found a deep low block to slide over', false);
expect('no page errors', errors.length === 0);
if (errors.length) console.log(errors);
await b.close();
process.exit(fail.length ? 1 : 0);
