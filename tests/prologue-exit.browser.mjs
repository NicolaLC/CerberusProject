// The Prologue's exit (#15): the sealed arena gate (kit.gate `exit-gate`) opens in the breakout cut after the spider falls (a dormant squad
// behind it bursts out and STEM-00 shoots it in the cut), the last objective REACH THE SKYWAY (requiresGun: rifle, #93) ends the mission and
// chains to the `skyway` scene with no debrief (fade to black, load, progress). The mission complete screen (run stats, RESTART / CONTINUE, kept
// for levels with a debrief) is exercised on the Prologue by dropping its `next` / `debrief` fields, and a death respawns at the last checkpoint. Pure level data, headless stepping; the stats come from real shots and a real reload.
// Needs the dev server: `bun run dev`, then `node tests/prologue-exit.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';
import { prologueHelpers } from './prologue-helpers.mjs';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const url = new URL(BASE);
url.searchParams.set('scene', 'prologue');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

// A fresh page on the prologue (intro seen), stepped by hand, past the intro.
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
    T.gate = () => g.world.gates.find((x) => x.on === 'cue:breakout-gate');
    engine.events.on('mission:complete', () => T.complete++);
    engine.events.on('mission:failed', () => T.failed++);
    engine.events.on('gate:open', (e) => e.on === 'cue:breakout-gate' && T.opened++); // the exit gate only (the chain opens many)
  });
  await p.evaluate(prologueHelpers);
  await p.evaluate(() => {
    // the whole chain up to the spider (awake after the boss cut); rifle false: pistol only, the armoury skipped (the late step halts it)
    T.toBoss = ({ rifle = true } = {}) => T.advanceTo(rifle ? 'purge-boss' : 'armoury-late', { rifle, rack: rifle });
    T.skipIntro();
  });
  return { p, errors };
}

// ---- 1: the gate is shut and blocks through the fight; the breakout cut opens it and the squad behind it dies ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { world, player, camRig, engine } = g;
    const out = {};
    const G = T.gate();
    out.piece = { found: !!G, shut: G?.open === 0, collider: G && world.colliders.includes(G.col), box: G && [G.col.box.min.x, G.col.box.max.x, G.col.box.min.y, G.col.box.max.y], doorway: g.level.pieces.some((q) => q.id === 'kit.doorway' && q.pos[0] === G?.mesh.position.x && Math.abs(q.pos[2] - G?.mesh.position.z) < 0.01) };
    T.toBoss();
    out.boss = { cur: T.cur(), awake: g.enemies.boss?.awake, open: G.open, opening: G.opening, events: T.opened };
    // walk at the shut gate: face north (-Z, yaw 0) and hold forward from inside the arena
    const walk = (z0, frames) => {
      player.pos.set(30, 0, z0);
      camRig.yaw = 0; // forward is -Z
      camRig.pitch = 0;
      engine.input.keys.add('KeyW');
      let minZ = player.pos.z;
      for (let i = 0; i < frames; i++) { T.step(1 / 60); minZ = Math.min(minZ, player.pos.z); }
      engine.input.keys.delete('KeyW');
      return +minZ.toFixed(2);
    };
    out.walkShut = walk(-59, 120);
    out.sightShut = !world.segmentClear(player.pos.clone().set(30, 0, -60), player.pos.clone().set(30, 0, -66), 0.3);
    // the spider falls: the alarm ends, the breakout cut starts; the gate stays shut and the squad behind it sleeps until the cut's gate cue
    const squad = () => T.group('breakout');
    out.squadBefore = { n: squad().length, dormant: squad().every((e) => e.alive && !e.awake), armored: squad().some((e) => e.armored), behind: squad().every((e) => e.pos.z < -63) };
    T.kill(g.enemies.boss);
    T.step(0.1);
    out.fell = { cur: T.cur(), cut: g.cinematic.id, active: g.cinematic.active, opening: G.opening, events: T.opened, open: G.open, awake: squad().filter((e) => e.awake).length };
    // play the cut: when does the gate open, when does the squad wake and die, where does STEM-00 end
    const seen = { openAt: null, wakeAt: null, shots: 0, scripted: 0 };
    engine.events.on('weapon:shot', (e) => { seen.shots++; if (e.scripted) seen.scripted++; });
    let t = 0;
    for (let i = 0; i < 1000 && g.cinematic.active; i++) {
      T.step(1 / 30);
      t += 1 / 30;
      if (seen.openAt === null && G.opening) seen.openAt = +t.toFixed(1);
      if (seen.wakeAt === null && squad().some((e) => e.awake)) seen.wakeAt = +t.toFixed(1);
    }
    out.cut = { ...seen, total: +t.toFixed(1), alive: squad().filter((e) => e.alive).length, pos: player.pos.toArray().map((n) => +n.toFixed(1)), cur: T.cur(), owned: [...g.weapon.owned].join() };
    T.step(1.8);
    out.openNow = { open: G.open, visible: G.mesh.visible, solid: world.meshes.includes(G.mesh), top: G.col.box.max.y, events: T.opened };
    out.walkOpen = walk(-59, 150);
    out.exitState = { cur: T.cur(), z: player.pos.z, state: g.mission.state };
    return out;
  });
  expect('the arena has a doorway in its north wall and the exit gate, shut with a collider', r.piece.found && r.piece.shut && r.piece.collider && r.piece.doorway && r.piece.box[2] === 0 && r.piece.box[3] === 4, JSON.stringify(r.piece));
  expect('the gate stays shut through the whole purge and while the spider fights (no event)', r.boss.cur === 'purge-boss' && r.boss.awake === true && r.boss.open === 0 && !r.boss.opening && r.boss.events === 0, JSON.stringify(r.boss));
  expect('  shut: walking forward stops at the slab (z stays south of the wall) and it blocks sight', r.walkShut > -62.2 && r.sightShut, JSON.stringify([r.walkShut, r.sightShut]));
  expect('the breakout squad (4 plated-free troopers) waits dormant behind the shut gate, out of reach', r.squadBefore.n === 4 && r.squadBefore.dormant && !r.squadBefore.armored && r.squadBefore.behind, JSON.stringify(r.squadBefore));
  expect('the spider\'s death starts the breakout cut; the gate stays shut and the squad asleep until the cut\'s cue', r.fell.cur === 'breakout' && r.fell.cut === 'breakout' && r.fell.active && !r.fell.opening && r.fell.open === 0 && r.fell.events === 0 && r.fell.awake === 0, JSON.stringify(r.fell));
  expect('  in the cut the gate opens (one gate:open) after the first shot, the squad wakes, STEM-00 shoots them all (scripted shots) and the cut ends in 10-14 s', r.cut.openAt > 2 && r.cut.openAt < 3.5 && r.cut.wakeAt > 2 && r.cut.wakeAt < 3.5 && r.cut.alive === 0 && r.cut.scripted >= 4 && r.openNow.events === 1 && r.cut.total >= 10 && r.cut.total <= 14.5, JSON.stringify(r.cut));
  expect('  STEM-00 ends at the gate, the exit objective is current, the gate is fully open (no collider, not drawn)', r.cut.cur === 'exit' && Math.abs(r.cut.pos[0] - 30) < 0.3 && r.cut.pos[2] < -60 && r.cut.pos[2] > -61 && r.openNow.open === 1 && !r.openNow.visible && !r.openNow.solid && r.openNow.top < 0, JSON.stringify([r.cut, r.openNow]));
  expect('  the player walks through into the annex; the mission is not over at the gate (the exit is further on)', r.walkOpen < -64 && r.exitState.cur === 'exit' && r.exitState.state === 'active' && r.exitState.z > -76, JSON.stringify([r.walkOpen, r.exitState]));
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
    T.go(26.5, -52, 0.3);
    T.go(30, -75, 0.3); // even standing on the node (put there by hand)
    out.pistolAtNode = { cur: T.cur(), state: g.mission.state, complete: T.complete };
    // the Warden from the rack: the chain goes on; the boss cut, the spider, the gate
    T.finish();
    T.advanceTo('exit');
    T.step(2);
    out.exit = { cur: T.cur(), hud: g.mission.hudText(), pos: g.mission.current.pos.toArray(), params: g.mission.current.params };
    // requiresGun on the exit itself: with the Warden gone from the inventory (a test hand) standing in the node does not end it
    g.weapon.owned.delete('rifle');
    T.go(30, -75, 0.3);
    out.noGun = { state: g.mission.state, held: g.mission.held, hud: g.mission.hudText(), complete: T.complete };
    g.weapon.grant('rifle', { ammo: 10 });
    T.step(0.1);
    out.withGun = { state: g.mission.state, complete: T.complete, failed: T.failed, hud: g.mission.hudText() };
    return out;
  });
  expect('with the pistol alone the chain halts at the late armoury step; the node does not end it', r.pistol.cur === 'armoury-late' && r.pistol.owned === 'pistol' && r.pistolAtNode.cur === 'armoury-late' && r.pistolAtNode.state === 'active' && r.pistolAtNode.complete === 0, JSON.stringify([r.pistol, r.pistolAtNode]));
  expect('REACH THE SKYWAY is the last objective (order 120), it requires the rifle', r.exit.cur === 'exit' && /^REACH THE SKYWAY/.test(r.exit.hud) && r.exit.params.order === 120 && r.exit.params.requiresGun === 'rifle' && r.exit.pos[2] < -70, JSON.stringify(r.exit));
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
      const target = T.group('calib').find((e) => e.alive);
      const pt = target.rig.bones[bone].getWorldPosition(target.pos.clone());
      player.pos.set(target.pos.x, 0, target.pos.z - 7); // the calibration targets face south
      keys.add('Mouse2');
      for (let i = 0; i < 70; i++) { aimAt(pt); T.step(1 / 60); }
      const before = stats.shots;
      aimAt(pt);
      engine.input.pressed.add('Mouse0'); T.step(1 / 60);
      for (let i = 0; i < 20; i++) { aimAt(pt); T.step(1 / 60); }
      keys.delete('Mouse2');
      return stats.shots - before;
    };
    // the Prologue chains on with no debrief: drop those fields so the report itself (stats, RESTART) is exercised here
    delete g.activeLevel.next; delete g.activeLevel.debrief;
    T.advanceTo('c2-aim'); // the bench's KP-12 in hand, the three calibration targets
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
    T.advanceTo('exit');
    T.step(2);
    T.finish();
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
  expect('RESTART: ignored for the first second, then reloads the scene: fresh run (objective 1, unarmed, spawn, every gate shut, stats zero), screen emptied, slow-down gone', r2.early.restarts === 0 && r2.early.open && r2.after.restarts === 1 && !r2.after.open && r2.after.hidden && r2.after.children === 0 && r2.after.scale === 1 && r2.after.cur === 'c1-move' && r2.after.stats.shots === 0 && r2.after.stats.time < 1 && r2.after.owned === '' && r2.after.pos.join() === '0,2,45' && /^0(,0)*$/.test(r2.after.gate) && r2.after.scene === 'prologue', JSON.stringify([r2.early, r2.after]));
  expect('  its key listener is removed with the screen', r2.enterAfter === 1, r2.enterAfter);
  expect('no page errors after the restart', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 3a: the real end: no report, fade to black, the Skyway loads (progress follows) ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(async () => {
    const g = window.game;
    const out = {};
    try { localStorage.removeItem('cerberus.progress'); } catch {}
    out.fields = { next: g.activeLevel.next, debrief: g.activeLevel.debrief };
    T.advanceTo('exit'); T.step(2);
    T.finish();
    out.done = { state: g.mission.state, complete: T.complete, summary: g.summary.state, locked: g.controls.locked };
    T.step(0.5);
    out.half = { fade: g.fade.value, open: g.summary.open, scene: g.sceneName };
    T.step(0.7);
    await new Promise((res) => setTimeout(res, 50));
    out.after = { scene: g.sceneName, level: g.activeLevel.name, title: g.activeLevel.title, fade: g.fade.value, summary: g.summary.state, locked: g.controls.locked };
    out.progress = JSON.parse(localStorage.getItem('cerberus.progress') ?? 'null');
    return out;
  });
  expect('the Prologue chains to the skyway with no debrief', r.fields.next === 'skyway' && r.fields.debrief === false, JSON.stringify(r.fields));
  expect('  the mission completes at the exit: no report, input locked, the screen fades to black', r.done.state === 'complete' && r.done.complete === 1 && r.done.summary === 'leaving' && r.done.locked && r.half.fade > 0.3 && !r.half.open && r.half.scene === 'prologue', JSON.stringify([r.done, r.half]));
  expect('  then the skyway is loaded clean and recorded as the progress', r.after.scene === 'skyway' && r.after.level === 'skyway' && r.after.fade === 0 && r.after.summary === 'idle' && !r.after.locked && r.progress?.scene === 'skyway', JSON.stringify([r.after, r.progress]));
  expect('no page errors', errors.length === 0, errors.join(' | '));
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
    delete g.activeLevel.next; delete g.activeLevel.debrief; // see part 3: the report path
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    const closed = restarts;
    T.advanceTo('exit'); T.step(2);
    T.finish();
    T.step(3.5);
    const open = g.summary.open;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    return { closed, open, restarts, cur: T.cur() };
  });
  expect('Enter restarts from the open screen only', r.closed === 0 && r.open && r.restarts === 1 && r.cur === 'c1-move', JSON.stringify(r));
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
    T.go(-2, 42);
    player.damage(1000);
    out.dead = player.dead;
    live(3.5);
    out.spawn = { dead: player.dead, pos: player.pos.toArray().map((n) => Math.round(n)), hp: player.health };
    // checkpoints on the way: hall, then hall-east (the last one wins)
    const toasts = [];
    T.go(-8, 40); out.cpC2 = g.encounter.checkpoint?.id;
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
  expect('checkpoints record in order (C2, hall, hall-east); the last reached is the one that counts', r.cpC2 === 'cp-c2' && r.cpHall === 'cp-hall' && r.cpEast === 'cp-hall-east', JSON.stringify([r.cpC2, r.cpHall, r.cpEast]));
  expect('  dead for the 3 s respawn delay, then back at cp-hall-east facing its yaw with full health; enemies and the mission untouched', r.stillDead && !r.respawn.dead && r.respawn.pos[0] === 16 && r.respawn.pos[2] === -33 && Math.abs(r.respawn.yaw - 3.14) < 0.02 && r.respawn.hp === 100 && r.respawn.cur && r.respawn.kills && r.state === 'active', JSON.stringify(r.respawn));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall prologue exit checks passed');
