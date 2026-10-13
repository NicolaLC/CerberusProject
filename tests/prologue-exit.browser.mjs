// The Prologue's exit (#15): the sealed arena gate (kit.gate `exit-gate`) opens when the spider falls, the last objective REACH TRANSIT NODE
// (requiresGun: rifle, #93) ends the mission, the mission complete screen shows the run stats and RESTART reloads the scene,
// and a death respawns at the last checkpoint. Pure level data, headless stepping; the stats come from real shots and a real reload.
// Needs the dev server: `npm run dev`, then `node tests/prologue-exit.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const url = new URL(BASE);
url.searchParams.set('scene', 'prologue');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

// A fresh page on the prologue (intro seen), stepped by hand, past the boot intro.
async function open() {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.addInitScript(() => {
    try { localStorage.setItem('cerberus.introSeen', 'true'); } catch {}
    // no real pointer lock (free-mouse mode): the restart path asks for it again and headless Chromium may swallow later events otherwise
    Element.prototype.requestPointerLock = function () {
      setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
      return Promise.reject(new DOMException('refused by the test', 'NotAllowedError'));
    };
  });
  await p.goto(url.href);
  await p.waitForFunction(() => window.game?.engine);
  await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    engine.stop();
    engine.headless = true;
    const T = (window.T = { complete: 0, failed: 0, opened: 0 });
    // health topped up every frame unless `mortal`
    T.mortal = false;
    T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { if (!T.mortal) g.player.health = 100; engine.step(1 / 60); } };
    T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
    T.go = (x, z, s = 0.1) => { g.player.pos.set(x, 0, z); g.player.vel?.set(0, 0, 0); T.step(s); };
    T.cur = () => g.mission.current?.oid ?? g.mission.state;
    T.group = (n) => g.enemies.all.filter((e) => e.squad === `purge-${n}`);
    T.passives = () => g.enemies.all.filter((e) => e.squad == null && e.alive);
    T.kill = (e) => {
      if (e.legs) {
        const dir = new e.pos.constructor(0, 0, -1);
        for (const l of e.legs) e.damage(500, l.foot, dir, 'weak', l.knee);
        for (let i = 0; i < 30 && e.alive; i++) e.damage(100, e.pos, dir, 'weak', e.core);
      } else for (let i = 0; i < 80 && e.alive; i++) e.damage(100, e.pos.clone().setY(1), new e.pos.constructor(0, 0, -1), 'body');
    };
    T.killGroup = (n) => T.group(n).forEach(T.kill);
    T.gate = () => g.world.gates.find((x) => x.on === 'objective:purge-boss:done');
    // yard -> hall -> armoury (G takes the Warden) -> troopers -> drones -> the arena gate: the spider is awake
    T.toBoss = ({ rifle = true } = {}) => {
      T.go(0, 29.5);
      T.passives().slice(0, 3).forEach(T.kill);
      T.step(4.3);
      T.killGroup(1); T.step(0.2);
      T.killGroup(2); T.step(0.2);
      if (rifle) { T.go(-21.5, -37); T.press('KeyG'); T.step(0.2); } else T.go(2, -28, 0.3);
      T.step(5.2);
      for (const n of [3, 4, 5]) { T.killGroup(n); T.step(0.2); }
      if (rifle) T.go(39.75, -17, 0.3);
    };
    engine.events.on('mission:complete', () => T.complete++);
    engine.events.on('mission:failed', () => T.failed++);
    engine.events.on('gate:open', () => T.opened++);
    T.step(1 / 60);
    T.press('Mouse0');
    T.step(0.5);
    T.press('Mouse0'); // skip the intro
    T.step(0.7);
  });
  return { p, errors };
}

// ---- 1: the gate is shut and blocks until the spider falls, then opens ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { world, player, camRig, engine } = g;
    const out = {};
    const G = T.gate();
    out.piece = { found: !!G, shut: G?.open === 0, collider: G && world.colliders.includes(G.col), box: G && [G.col.box.min.x, G.col.box.max.x, G.col.box.min.y, G.col.box.max.y], pieces: ['kit.doorway', 'kit.gate'].map((id) => g.level.pieces.filter((q) => q.id === id).length) };
    T.toBoss();
    out.boss = { cur: T.cur(), awake: g.enemies.boss?.awake, open: G.open, opening: G.opening, events: T.opened };
    // walk at the shut gate: face north (-Z, yaw 0) and hold forward from inside the arena
    const walk = (z0, frames) => {
      player.pos.set(39.75, 0, z0);
      camRig.yaw = 0; // forward is -Z
      camRig.pitch = 0;
      engine.input.keys.add('KeyW');
      let minZ = player.pos.z;
      for (let i = 0; i < frames; i++) { T.step(1 / 60); minZ = Math.min(minZ, player.pos.z); }
      engine.input.keys.delete('KeyW');
      return +minZ.toFixed(2);
    };
    out.walkShut = walk(-59, 120);
    out.sightShut = !world.segmentClear(player.pos.clone().set(39.75, 0, -60), player.pos.clone().set(39.75, 0, -66), 0.3);
    // the spider falls: the objective is done, the gate opens (about 1.5 s), the alarm ends
    T.kill(g.enemies.boss);
    T.step(0.1);
    out.fell = { cur: T.cur(), opening: G.opening, events: T.opened, open: +G.open.toFixed(2) };
    T.step(0.6);
    out.half = +G.open.toFixed(2);
    T.step(1.2);
    out.openNow = { open: G.open, visible: G.mesh.visible, solid: world.meshes.includes(G.mesh), top: G.col.box.max.y };
    out.walkOpen = walk(-59, 150);
    out.exitState = { cur: T.cur(), z: player.pos.z, state: g.mission.state };
    return out;
  });
  expect('the arena has a doorway in its north wall and the exit gate, shut with a collider', r.piece.found && r.piece.shut && r.piece.collider && r.piece.pieces.join() === '1,1' && r.piece.box[2] === 0 && r.piece.box[3] === 4, JSON.stringify(r.piece));
  expect('the gate stays shut through the whole purge and while the spider fights (no event)', r.boss.cur === 'purge-boss' && r.boss.awake === true && r.boss.open === 0 && !r.boss.opening && r.boss.events === 0, JSON.stringify(r.boss));
  expect('  shut: walking forward stops at the slab (z stays south of the wall) and it blocks sight', r.walkShut > -62.2 && r.sightShut, JSON.stringify([r.walkShut, r.sightShut]));
  expect('the moment the spider dies the gate starts to open (one gate:open), mid-way after 0.6 s', r.fell.opening && r.fell.events === 1 && r.fell.open < 0.2 && r.half > 0.3 && r.half < 0.9, JSON.stringify([r.fell, r.half]));
  expect('  fully open: out of the way (no collider, not drawn, not shot at); the player walks through into the annex', r.openNow.open === 1 && !r.openNow.visible && !r.openNow.solid && r.openNow.top < 0 && r.walkOpen < -64, JSON.stringify([r.openNow, r.walkOpen]));
  expect('  the mission is not over at the gate: the exit objective is current (the node is further on)', r.exitState.cur === 'exit' && r.exitState.state === 'active' && r.exitState.z > -76, JSON.stringify(r.exitState));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 2: the exit needs the Warden (requiresGun) and ends the mission once it is owned ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    // pistol only, nothing picked up: the chain halts before the arena gate, wherever the player stands
    T.toBoss({ rifle: false });
    out.pistol = { cur: T.cur(), owned: [...g.weapon.owned].join() };
    T.go(39.75, -17, 0.3);
    T.go(39.75, -75, 0.3); // even standing on the node (put there by hand)
    out.pistolAtNode = { cur: T.cur(), state: g.mission.state, complete: T.complete };
    // the Warden from the rack: the chain goes on; the spider, the gate
    T.go(-21.5, -37, 0.2); T.press('KeyG'); T.step(0.2);
    T.go(39.75, -17, 0.3);
    T.kill(g.enemies.boss);
    T.step(2);
    out.exit = { cur: T.cur(), hud: g.mission.hudText(), pos: g.mission.current.pos.toArray(), params: g.mission.current.params };
    // requiresGun on the exit itself: with the Warden gone from the inventory (a test hand) standing in the node does not end it
    g.weapon.owned.delete('rifle');
    T.go(39.75, -75, 0.3);
    out.noGun = { state: g.mission.state, held: g.mission.held, hud: g.mission.hudText(), complete: T.complete };
    g.weapon.grant('rifle', { ammo: 10 });
    T.step(0.1);
    out.withGun = { state: g.mission.state, complete: T.complete, failed: T.failed, hud: g.mission.hudText() };
    return out;
  });
  expect('with the pistol alone the chain halts at the late armoury step; the node does not end it', r.pistol.cur === 'armoury-late' && r.pistol.owned === 'pistol' && r.pistolAtNode.cur === 'armoury-late' && r.pistolAtNode.state === 'active' && r.pistolAtNode.complete === 0, JSON.stringify([r.pistol, r.pistolAtNode]));
  expect('REACH TRANSIT NODE is the last objective (order 120), it requires the rifle', r.exit.cur === 'exit' && /^REACH TRANSIT NODE/.test(r.exit.hud) && r.exit.params.order === 120 && r.exit.params.requiresGun === 'rifle' && r.exit.pos[2] < -70, JSON.stringify(r.exit));
  expect('  standing in the node without the rifle owned: not complete, the HUD names the missing Warden', r.noGun.state === 'active' && r.noGun.held && r.noGun.complete === 0 && /KR-7 WARDEN: NOT FOUND/.test(r.noGun.hud), JSON.stringify(r.noGun));
  expect('  with it owned the mission completes, once, no failure', r.withGun.state === 'complete' && r.withGun.complete === 1 && r.withGun.failed === 0 && r.withGun.hud === 'MISSION COMPLETE', JSON.stringify(r.withGun));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 3: stats from real play, the screen, RESTART ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { engine, camRig, weapon, player, stats } = g;
    const out = {};
    const keys = engine.input.keys;
    const aimAt = (pt) => {
      const c = camRig.camera.position;
      camRig.yaw = Math.atan2(-(pt.x - c.x), -(pt.z - c.z));
      camRig.pitch = Math.atan2(pt.y - c.y, Math.hypot(pt.x - c.x, pt.z - c.z));
    };
    const shoot = (bone) => {
      const target = T.passives()[0];
      const pt = target.rig.bones[bone].getWorldPosition(target.pos.clone());
      player.pos.set(target.pos.x, 0, target.pos.z + 7);
      keys.add('Mouse2');
      for (let i = 0; i < 70; i++) { aimAt(pt); T.step(1 / 60); }
      const before = stats.shots;
      aimAt(pt);
      engine.input.pressed.add('Mouse0'); T.step(1 / 60);
      for (let i = 0; i < 20; i++) { aimAt(pt); T.step(1 / 60); }
      keys.delete('Mouse2');
      return stats.shots - before;
    };
    T.go(0, 29.5); // out of the bay: the first objective
    out.fired = [shoot('Spine2'), shoot('Head')];
    // a miss: the sky
    camRig.pitch = 1.2;
    keys.add('Mouse2'); T.step(1.2);
    engine.input.pressed.add('Mouse0'); T.step(0.4);
    keys.delete('Mouse2');
    // a perfect reload: start it, then press again inside the perfect zone
    weapon.state.pistol.ammo = Math.min(weapon.state.pistol.ammo, 5);
    T.press('KeyR');
    const z = weapon.t.activeReload;
    for (let i = 0; i < 600 && weapon.reloadProgress() < (z.perfect[0] + z.perfect[1]) / 2; i++) T.step(1 / 60);
    T.press('KeyR');
    out.reload = { result: weapon.result?.kind, perfect: stats.perfectReloads };
    out.mid = stats.snapshot();
    out.reachedMs = Math.round(stats.time);
    // through to the end with the Warden
    T.toBoss();
    T.kill(g.enemies.boss); T.step(2);
    T.go(39.75, -75, 0.3);
    out.complete = { state: g.mission.state, n: T.complete, scale: engine.timeScale, shown: !document.getElementById('summary').hidden };
    T.step(1.2); // slow motion (real time 2.2 s before the report)
    out.slow = { scale: engine.timeScale, shown: !document.getElementById('summary').hidden, locked: g.controls.locked };
    T.step(1.5);
    const el = document.getElementById('summary');
    const rows = {};
    for (const r of el.querySelectorAll('.row')) rows[r.dataset.stat] = r.querySelector('.v').textContent;
    out.screen = { shown: !el.hidden, head: el.querySelector('.head')?.textContent, sub: el.querySelector('.sub')?.textContent, rows, button: el.querySelector('button')?.textContent };
    out.snap = stats.snapshot();
    out.frozen = { scale: engine.timeScale, locked: g.controls.locked, open: g.summary.open };
    // behind the screen nothing moves and the stats stay put
    const p0 = player.pos.clone();
    keys.add('KeyW'); engine.input.pressed.add('Mouse0'); T.step(1); keys.delete('KeyW');
    out.still = { moved: player.pos.distanceTo(p0), shots: stats.shots - out.snap.shots, time: +(stats.time - out.snap.time).toFixed(2) };
    out.pointer = { padPlay: g.padPlay, overlay: getComputedStyle(document.getElementById('overlay')).display };
    return out;
  });
  const s = r.snap;
  expect('real shots are counted: the two aimed shots hit (the second at the head), the shot at the sky is a miss', r.fired[0] === 1 && r.fired[1] === 1 && s.shots >= 3 && s.hits >= 2 && s.hits < s.shots && s.headshots >= 1, JSON.stringify([r.fired, s]));
  expect('  a perfect reload is counted', r.reload.result === 'perfect' && s.perfectReloads >= 1, JSON.stringify(r.reload));
  expect('the mission ends at the node; the game goes into slow motion first, the report opens after about 2 s of real time', r.complete.state === 'complete' && r.complete.n === 1 && !r.complete.shown && r.slow.scale < 0.3 && r.frozen.open, JSON.stringify([r.complete, r.slow]));
  expect('the screen is the mission complete report: title, the six figures, a RESTART button', r.screen.shown && /MISSION COMPLETE/.test(r.screen.head) && r.screen.sub === 'PROVING GROUNDS' && Object.keys(r.screen.rows).join() === 'TIME,ACCURACY,HEADSHOTS,PERFECT RELOADS,SALVAGE COLLECTED,HOSTILES DESTROYED' && r.screen.button === 'RESTART', JSON.stringify(r.screen));
  const pct = Math.round(s.accuracy * 100);
  const m = Math.floor(s.time / 60);
  expect('  the figures are the run\'s: accuracy %, headshots, perfect reloads, kills; salvage is a dash; time is mm:ss of the play time', r.screen.rows.ACCURACY.startsWith(`${pct}%`) && pct > 0 && pct < 100 && r.screen.rows.HEADSHOTS === String(s.headshots) && r.screen.rows['PERFECT RELOADS'] === String(s.perfectReloads) && r.screen.rows['SALVAGE COLLECTED'] === '—' && r.screen.rows['HOSTILES DESTROYED'] === String(s.kills) && s.kills >= 18 && r.screen.rows.TIME === `${String(m).padStart(2, '0')}:${String(Math.floor(s.time % 60)).padStart(2, '0')}` && s.time > 5 && s.time < 120, JSON.stringify([r.screen.rows, s]));
  expect('behind the screen time stands (scale ~0), input is locked, nothing moves, no shots are counted, the pointer is released without pausing', r.frozen.scale < 0.05 && r.frozen.locked && r.still.moved < 0.05 && r.still.shots === 0 && r.still.time < 0.1 && r.pointer.padPlay && r.pointer.overlay === 'none', JSON.stringify([r.frozen, r.still, r.pointer]));
  expect('no page errors', errors.length === 0, errors.join(' | '));

  // RESTART with the button: the scene reloads, the screen, its listener and the slow-down are gone, the run is fresh
  const r2 = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    let restarts = 0;
    const load = g.loadScene.bind(g);
    g.loadScene = (n) => { restarts++; return load(n); };
    g.summary.t = 0.2;
    document.querySelector('#summary button').click(); // inside the first second: ignored
    out.early = { restarts, open: g.summary.open };
    T.step(1);
    document.querySelector('#summary button').click();
    out.after = {
      restarts,
      open: g.summary.open,
      hidden: document.getElementById('summary').hidden,
      children: document.getElementById('summary').childElementCount,
      scale: g.juice.cap,
      cur: T.cur(),
      stats: g.stats.snapshot(),
      owned: [...g.weapon.owned].join(),
      pos: g.player.pos.toArray().map((n) => Math.round(n)),
      gate: g.world.gates.map((x) => x.open).join(),
      scene: g.sceneName,
    };
    T.step(1);
    // the key listener is gone: Enter does nothing now
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    out.enterAfter = restarts;
    return out;
  });
  expect('RESTART: ignored for the first second, then reloads the scene: fresh run (objective 1, pistol only, spawn, gate shut, stats zero), screen emptied, slow-down gone', r2.early.restarts === 0 && r2.early.open && r2.after.restarts === 1 && !r2.after.open && r2.after.hidden && r2.after.children === 0 && r2.after.scale === 1 && r2.after.cur === 'leave-bay' && r2.after.stats.shots === 0 && r2.after.stats.time < 1 && r2.after.owned === 'pistol' && r2.after.pos.join() === '0,2,45' && r2.after.gate === '0' && r2.after.scene === 'prologue', JSON.stringify([r2.early, r2.after]));
  expect('  its key listener is removed with the screen', r2.enterAfter === 1, r2.enterAfter);
  expect('no page errors after the restart', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 3b: the Enter key restarts too (and only when the screen is open) ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    let restarts = 0;
    const load = g.loadScene.bind(g);
    g.loadScene = (n) => { restarts++; return load(n); };
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    const closed = restarts;
    T.toBoss(); T.kill(g.enemies.boss); T.step(2);
    T.go(39.75, -75, 0.3);
    T.step(3.5);
    const open = g.summary.open;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    return { closed, open, restarts, cur: T.cur() };
  });
  expect('Enter restarts from the open screen only', r.closed === 0 && r.open && r.restarts === 1 && r.cur === 'leave-bay', JSON.stringify(r));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4: dying respawns at the last checkpoint ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { player } = g;
    const out = {};
    const live = (s) => { T.mortal = true; T.step(s); T.mortal = false; };
    // before any checkpoint: the level spawn
    T.go(0, 30);
    player.damage(1000);
    out.dead = player.dead;
    live(3.5);
    out.spawn = { dead: player.dead, pos: player.pos.toArray().map((n) => Math.round(n)), hp: player.health };
    // checkpoints on the way: hall, then hall-east (the last one wins)
    const toasts = [];
    T.go(0, 20); out.cpYard = g.encounter.checkpoint?.id;
    T.go(-9, -36); out.cpHall = g.encounter.checkpoint?.id;
    T.go(16, -33); out.cpEast = g.encounter.checkpoint?.id;
    out.toast = document.getElementById('toast').textContent;
    T.go(-30, 40); // far away, then dead
    const kills = g.enemies.kills;
    const cur = T.cur();
    player.damage(1000);
    live(1);
    out.stillDead = player.dead;
    live(2.5);
    out.respawn = { dead: player.dead, pos: player.pos.toArray().map((n) => +n.toFixed(1)), yaw: +player.facing.toFixed(2), hp: player.health, shields: player.shields, cur: T.cur() === cur, kills: g.enemies.kills === kills };
    // the mission and the world carry on after the respawn
    out.state = g.mission.state;
    return out;
  });
  expect('before any checkpoint a death respawns at the level spawn', r.dead && !r.spawn.dead && r.spawn.pos.join() === '0,2,45' && r.spawn.hp === 100, JSON.stringify(r.spawn));
  expect('checkpoints record in order; the last reached is the one that counts', r.cpYard === 'cp-yard' && r.cpHall === 'cp-hall' && r.cpEast === 'cp-hall-east', JSON.stringify([r.cpYard, r.cpHall, r.cpEast]));
  expect('  dead for the 3 s respawn delay, then back at cp-hall-east facing its yaw with full health; enemies and the mission untouched', r.stillDead && !r.respawn.dead && r.respawn.pos[0] === 16 && r.respawn.pos[2] === -33 && Math.abs(r.respawn.yaw - 3.14) < 0.02 && r.respawn.hp === 100 && r.respawn.cur && r.respawn.kills && r.state === 'active', JSON.stringify(r.respawn));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall prologue exit checks passed');
