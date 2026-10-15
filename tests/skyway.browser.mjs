// THE SKYWAY (`skyway`, the Prologue's last part; scripts/build-skyway.mjs, level-design.md "The Skyway"): the scene loads with the three guns and no boot
// screen, the intro cut plays, the deck edges can't be crossed (walking, jetting, from cover), the objective chain order, the CERBERUS cut (it wakes
// the boss, the announcer speaks), the 45 s survive, the fall cut (heads volley, the deck plates drop, STEM-00 ends hundreds of metres down, black),
// a skipped cut ends the same, and the mission complete report offers CONTINUE into `underworks`. Headless stepping, pure level data.
// Needs the dev server: `bun run dev`, then `node tests/skyway.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';
import { prologueHelpers } from './prologue-helpers.mjs';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const url = new URL(BASE);
url.searchParams.set('scene', 'skyway');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };
const CHAIN = ['cross-skyway', 'deck-patrol', 'far-span', 'cerberus-cut', 'hivemind', 'the-fall'];

// A fresh page on the Skyway, stepped by hand. `skip`: the intro cut is skipped (a fire press after its guard).
async function open({ skip = true } = {}) {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.addInitScript(() => {
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
    const T = (window.T = { order: [] });
    T.mortal = false; // health topped up every frame unless mortal
    T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { if (!T.mortal) g.player.health = 100; engine.step(1 / 60); } };
    T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
    engine.events.on('mission:objective', (e) => T.order.push(e.id));
  });
  await p.evaluate(prologueHelpers);
  await p.evaluate((skip) => {
    // a survive objective is stepped through (the helper's chain walker knows reach / destroy / interact / action)
    const finish = T.finish;
    T.finish = (o) => {
      const r = window.game.mission.current;
      if (r?.obj === 'survive') T.step(r.time + 1);
      else finish(o);
    };
    T.beacons = () => window.game.world.props.filter((o) => o.userData.beacon);
    T.plates = () => window.game.world.gates.filter((x) => x.on === 'cue:break');
    if (skip) T.skipIntro();
  }, skip);
  return { p, errors };
}

// ---- 1. the scene: spawn, guns, no boot, the intro cut, supply, the chain, sizes ----
{
  const { p, errors } = await open({ skip: false });
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    T.step(1 / 60);
    out.scene = { name: g.sceneName, title: g.level.title, next: g.level.next, debrief: g.level.debrief, sky: g.level.sky, skin: g.level.skin };
    out.spawn = g.player.pos.toArray().map((n) => Math.round(n * 100) / 100);
    out.guns = [...g.weapon.owned].sort();
    out.boot = g.boot.active;
    out.cut = { active: g.cinematic.active, id: g.cinematic.id, locked: g.controls.locked };
    T.step(0.4);
    out.fadeEarly = g.fade.value; // black for a blink, easing out: it continues the Prologue's fade-out
    T.skipScripted();
    out.afterSkip = { active: g.cinematic.active, locked: g.controls.locked, pos: g.player.pos.toArray().map((n) => Math.round(n * 100) / 100), fade: g.fade.value };
    const ps = g.level.pieces;
    out.supply = { ammo: ps.filter((q) => q.id === 'supply.ammo').length, repair: ps.filter((q) => q.id === 'supply.repair').length, near: ps.filter((q) => q.id.startsWith('supply.')).every((q) => q.pos[2] > 15) };
    out.supplyBuilt = g.world.supplies.length;
    // deck size from its slabs and parapets
    const slabs = ps.filter((q) => q.id === 'env.box' && q.params.mat === 'floor' && q.params.size[2] > 20);
    const zs = ps.filter((q) => q.id === 'env.box' && q.params.mat === 'wall' && q.params.hidden);
    out.deck = { length: Math.max(...zs.map((q) => q.params.size[2])), width: Math.max(...slabs.map((q) => q.params.size[0])), rails: zs.length };
    out.cerberus = ps.find((q) => q.id === 'boss.cerberus');
    out.backdrop = ps.find((q) => q.id === 'env.backdrop')?.pos;
    // the chain: finish every objective in turn; the order of mission:objective is the beat order
    out.first = T.cur(); // the first objective began before the listener
    T.advanceTo('the-fall');
    out.order = [out.first, ...T.order];
    out.cur = T.cur();
    return out;
  });
  expect('skyway/scene: name, title, chain (next underworks, debrief), night sky, weathered skin', r.scene.name === 'skyway' && r.scene.title === 'THE SKYWAY' && r.scene.next === 'underworks' && r.scene.debrief === true && r.scene.sky === 'night' && r.scene.skin === 'weathered', JSON.stringify(r.scene));
  expect('skyway/spawn: STEM-00 at the lab exit landing (z 18.5), pistol + rifle + sniper only', r.spawn[0] === 0 && r.spawn[2] === 18.5 && r.guns.join() === 'pistol,rifle,sniper', JSON.stringify([r.spawn, r.guns]));
  expect('skyway/intro: a cut plays at the start (no boot screen), input locked, black easing out', r.cut.active && r.cut.id === 'skyway-intro' && r.cut.locked && r.boot === false && r.fadeEarly > 0 && r.fadeEarly < 1, JSON.stringify([r.cut, r.boot, r.fadeEarly]));
  expect('skyway/intro: skippable, control and the spawn are back after it', !r.afterSkip.active && !r.afterSkip.locked && r.afterSkip.pos[2] === 18.5 && r.afterSkip.fade === 0, JSON.stringify(r.afterSkip));
  expect('skyway/supply: one ammo + one repair point at the start, both built', r.supply.ammo === 1 && r.supply.repair === 1 && r.supply.near && r.supplyBuilt === 2, JSON.stringify([r.supply, r.supplyBuilt]));
  expect('skyway/world: a 200 m x 24 m deck, hidden rails on both sides, the city far below', r.deck.length === 200 && r.deck.width === 24 && r.deck.rails === 2 && r.backdrop[1] <= -400, JSON.stringify([r.deck, r.backdrop]));
  expect('skyway/cerberus: beside the east edge, facing -X, dormant, grouped', r.cerberus.pos[0] > 20 && Math.abs(r.cerberus.yaw + Math.PI / 2) < 1e-3 && r.cerberus.params.dormant === true && r.cerberus.params.group === 'cerberus', JSON.stringify(r.cerberus));
  expect('skyway/chain: cross, clear the deck, far span, CERBERUS cut, survive, the fall, in order', r.order.join() === CHAIN.join() && r.cur === 'the-fall', JSON.stringify([r.order, r.cur]));
  expect('no page errors (intro, chain)', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 2. the edges: no way off the deck (walking, jetting, from cover, at both ends) ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { player, camRig, engine } = g;
    const out = { runs: [] };
    // forward is -Z at yaw 0; probe which yaw walks toward +X in the middle of the deck
    const walk = (x, y, z, yaw, seconds, jet = false) => {
      player.pos.set(x, y, z);
      player.vel?.set(0, 0, 0);
      camRig.yaw = yaw;
      camRig.pitch = 0;
      T.step(0.2);
      engine.input.keys.add('KeyW');
      engine.input.keys.add('ShiftLeft');
      let minY = 1e9, maxX = -1e9, minX = 1e9, minZ = 1e9, maxZ = -1e9;
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        if (jet && i % 36 === 0) { engine.input.keys.add('Space'); engine.input.pressed.add('Space'); }
        T.step(1 / 60);
        engine.input.keys.delete('Space');
        const q = player.pos;
        minY = Math.min(minY, q.y); maxX = Math.max(maxX, q.x); minX = Math.min(minX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
      }
      engine.input.keys.delete('KeyW');
      engine.input.keys.delete('ShiftLeft');
      return { minY, maxX, minX, minZ, maxZ };
    };
    const probe = walk(0, 0, -20, -Math.PI / 2, 0.5);
    out.eastYaw = probe.maxX > 1 ? -Math.PI / 2 : Math.PI / 2; // the yaw that walks toward +X
    const east = out.eastYaw;
    const west = -east;
    for (const z of [-4, -20, -45, -70, -100, -125, -150, -172]) {
      for (const jet of [false, true]) {
        const e = walk(8, 0, z, east, 4, jet);
        const w = walk(-8, 0, z, west, 4, jet);
        out.runs.push({ z, jet, east: [e.maxX, e.minY], west: [w.minX, w.minY] });
      }
    }
    // the ends: north into the shutter, south into the lab wall
    const n = walk(0, 0, -150, 0, 5, true);
    const s = walk(0, 0, 10, Math.PI, 5, true);
    out.north = n.minZ;
    out.south = s.maxZ;
    // from the top of a low cover beside the east edge (x 9.5, z -45): jump the parapet side
    player.pos.set(9.5, 1.1, -45);
    const c = walk(9.5, 1.15, -45, east, 3, true);
    out.cover = [c.maxX, c.minY];
    // the rails are real boxes: collision only (not drawn, not raycast targets), 6 m tall
    const rails = g.world.colliders.filter((q) => !q.mesh.visible && q.mesh.parent === null && q.box.max.y - q.box.min.y >= 5.9);
    out.rails = rails.length;
    out.railsRay = rails.every((q) => !g.world.meshes.includes(q.mesh));
    return out;
  });
  const worst = (k) => r.runs.map((x) => x[k]);
  expect('skyway/edges: walking and jetting into the east edge stops inside the deck (|x| <= 12) and never drops', worst('east').every(([x, y]) => x <= 12 && y > -0.2) && r.runs.some((x) => x.east[0] > 10), JSON.stringify(r.runs.map((x) => x.east)));
  expect('skyway/edges: the same on the west edge', worst('west').every(([x, y]) => x >= -12 && y > -0.2) && r.runs.some((x) => x.west[0] < -10), JSON.stringify(r.runs.map((x) => x.west)));
  expect('skyway/edges: the shutter (north) and the lab wall (south) hold', r.north > -176 && r.south < 24, JSON.stringify([r.north, r.south]));
  expect('skyway/edges: from a low cover beside the edge a jet cannot clear the rail', r.cover[0] <= 12 && r.cover[1] > -0.2, JSON.stringify(r.cover));
  expect('skyway/edges: two collision-only rails (6 m, not raycast targets: bolts and the camera pass)', r.rails === 2 && r.railsRay, JSON.stringify([r.rails, r.railsRay]));
  expect('no page errors (edges)', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 3. beats: the skirmish, the CERBERUS cut, the 45 s survive, the fall ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { player, enemies, world } = g;
    const out = {};
    const awake = () => T.awake();
    // beat 1 -> 2: the skirmish squad sleeps until the deck is crossed
    out.dormant = awake();
    T.advanceTo('deck-patrol');
    T.step(0.3);
    out.skirmish = { awake: awake(), troopers: T.group('deck').filter((e) => e.kind === 'trooper').length, drones: T.group('deck').filter((e) => e.kind === 'drone').length, all: T.group('deck').length };
    out.logStart = null;
    T.finish(); // kill the squad
    T.step(0.3);
    out.afterSkirmish = { cur: T.cur(), awake: awake() };
    // beat 3: the far span, then the CERBERUS cut
    T.finish(); // far-span
    T.step(0.3);
    out.cut = { active: g.cinematic.active, id: g.cinematic.id, boss: enemies.boss?.awake, beacons: T.beacons().filter((o) => o.userData.beacon.active).length, hud: document.getElementById('objective').textContent };
    T.step(8.3); // the third shot (5.2 s) wakes it and the announcer speaks (the line types out)
    out.announcer = document.getElementById('log').textContent;
    out.bossMid = enemies.boss?.awake;
    T.step(8);
    out.afterCut = { active: g.cinematic.active, cur: T.cur(), boss: enemies.boss?.awake, name: enemies.boss?.name, awakeGroups: awake(), pos: enemies.boss?.pos.toArray() };
    out.hud = [document.getElementById('obj-head')?.textContent, document.getElementById('obj-prog')?.textContent];
    // beat 4: survive 45 s: nothing ends it early
    T.step(20);
    out.mid = { cur: T.cur(), dead: player.dead };
    // beat 5: the fall cut starts when the timer ends; every time below is from the cut's start
    for (let i = 0; i < 400 && !(g.cinematic.active && g.cinematic.id === 'the-fall'); i++) T.step(0.1);
    out.fall = { active: g.cinematic.active, id: g.cinematic.id, cur: T.cur(), plates: T.plates().length, open: T.plates().filter((x) => x.open >= 1).length, opening: T.plates().filter((x) => x.opening).length };
    T.step(1.5);
    out.charging = document.getElementById('log').textContent; // the announcer line of cue charge (shot 1)
    T.step(2.7); // 4.2 s: 3 s of heads charging, then the volley's charge: no beams yet
    out.charge = { volley: !!enemies.boss?.volley, beams: enemies.boss?.beams.filter((x) => x.glow.visible).length, opening: T.plates().filter((x) => x.opening).length, y: player.pos.y };
    T.step(1.0); // 5.2 s: beams on, the deck plates dropping
    out.volley = { beams: enemies.boss?.beams.filter((x) => x.glow.visible).length, opening: T.plates().filter((x) => x.opening).length };
    T.step(1.8); // 7 s
    out.broken = { open: T.plates().filter((x) => x.open >= 1).length, parked: T.plates().every((x) => x.col.box.min.y < -900), y: player.pos.y, scripted: player.scripted };
    T.step(5.4); // 12.4 s of 12.6
    out.late = { y: player.pos.y, fade: g.fade.value, active: g.cinematic.active };
    T.step(0.4);
    out.end = { y: player.pos.y, pos: player.pos.toArray().map((n) => Math.round(n)), active: g.cinematic.active, state: g.mission.state, dead: player.dead };
    // the report: CONTINUE into underworks
    T.step(3);
    const s = document.getElementById('summary');
    out.report = { open: g.summary.open, buttons: [...s.querySelectorAll('button')].map((x) => `${x.dataset.action}:${x.textContent}`) };
    return out;
  });
  expect('skyway/beat 1: the squad (3 troopers, 2 drones, one group) sleeps until the deck-patrol objective', r.dormant.length === 0 && r.skirmish.troopers === 3 && r.skirmish.drones === 2 && r.skirmish.all === 5 && r.skirmish.awake.join() === 'deck', JSON.stringify([r.dormant, r.skirmish]));
  expect('skyway/beat 2: clearing it moves on to the far span, nothing else awake', r.afterSkirmish.cur === 'far-span' && r.afterSkirmish.awake.length === 0, JSON.stringify(r.afterSkirmish));
  expect('skyway/cerberus cut: starts at the far span, input locked, beacons run, CERBERUS (dormant until now) wakes in it', r.cut.active && r.cut.id === 'cerberus-cut' && r.cut.boss === false && r.cut.beacons === 6 && r.bossMid === true, JSON.stringify([r.cut, r.bossMid]));
  expect('skyway/cerberus cut: the announcer speaks for the HiveMind', /YOUR DIRECTIVE IS AN ERROR\. CORRECTION FOLLOWS\./.test(r.announcer), r.announcer);
  expect('skyway/survive: after the cut the fight is on: DESTROY THE HIVEMIND with its timer, CERBERUS awake beside the east edge', !r.afterCut.active && r.afterCut.cur === 'hivemind' && r.afterCut.boss === true && r.afterCut.pos[0] > 30 && /DESTROY THE HIVEMIND/.test(r.hud[0]) && /0:\d\d/.test(r.hud[1]), JSON.stringify([r.afterCut, r.hud]));
  expect('skyway/survive: 45 s: still on at 20 s, the player alive', r.mid.cur === 'hivemind' && !r.mid.dead, JSON.stringify(r.mid));
  expect('skyway/fall: survive done starts the fall cut, the deck plates still shut', r.fall.active && r.fall.id === 'the-fall' && r.fall.cur === 'the-fall' && r.fall.plates === 9 && r.fall.open === 0 && r.fall.opening === 0 && r.charge.opening === 0 && r.charge.y > -1, JSON.stringify(r.fall));
  expect('skyway/fall: the heads charge first (no beams, a volley under way), then fire three beams; the announcer line; the plates start to drop with the shot', r.charge.volley && r.charge.beams === 0 && r.volley.beams === 3 && r.volley.opening > 0 && /DELETE UNIT STEM-00/.test(r.charging), JSON.stringify([r.charge, r.volley, r.charging]));
  expect('skyway/fall: all nine plates are gone, STEM-00 is falling (scripted, far below the deck)', r.broken.open === 9 && r.broken.parked && r.broken.y < -20 && r.broken.scripted, JSON.stringify(r.broken));
  expect('skyway/fall: before the end it is hundreds of metres down and the screen is nearly black', r.late.y < -300 && r.late.fade > 0.7 && r.late.active, JSON.stringify(r.late));
  expect('skyway/fall: the cut ends with STEM-00 about 380 m below the deck, alive (no fall death), mission complete', r.end.y < -370 && r.end.pos[0] === -3 && !r.end.active && r.end.state === 'complete' && !r.end.dead, JSON.stringify(r.end));
  expect('skyway/report: the debrief opens with CONTINUE (primary) and RESTART', r.report.open && r.report.buttons.join() === 'continue:CONTINUE,restart:RESTART', JSON.stringify(r.report));
  // CONTINUE loads underworks
  await p.evaluate(() => { T.step(1); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' })); });
  await p.waitForFunction(() => window.game.sceneName === 'underworks', null, { timeout: 8000 }).catch(() => {});
  const scene = await p.evaluate(() => window.game.sceneName);
  expect('skyway/report: CONTINUE opens the next scene (underworks)', scene === 'underworks', scene);
  expect('no page errors (beats, fall, continue)', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4. skipping the cuts ends in the same state ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { player, enemies } = g;
    const out = {};
    T.advanceTo('far-span');
    T.finish(); // far-span: the CERBERUS cut starts
    T.step(0.5);
    out.cutOn = g.cinematic.active;
    T.skipScripted(); // a skip still wakes it and speaks
    out.cerb = { awake: enemies.boss?.awake, cur: T.cur(), active: g.cinematic.active };
    T.finish(); // survive
    T.step(0.5);
    out.fallOn = g.cinematic.active && g.cinematic.id === 'the-fall';
    T.skipScripted();
    T.step(0.3);
    out.skipped = { y: player.pos.y, pos: player.pos.toArray().map((n) => Math.round(n)), open: T.plates().filter((x) => x.open >= 1 || x.opening).length, state: g.mission.state };
    return out;
  });
  expect('skyway/skip: the CERBERUS cut skipped still wakes it and starts the fight', r.cutOn && r.cerb.awake === true && r.cerb.cur === 'hivemind' && !r.cerb.active, JSON.stringify(r.cerb));
  expect('skyway/skip: the fall cut skipped ends at the same place (380 m down), plates dropped, mission complete', r.fallOn && r.skipped.y < -370 && r.skipped.pos[0] === -3 && r.skipped.open === 9 && r.skipped.state === 'complete', JSON.stringify(r.skipped));
  expect('no page errors (skip)', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 5. perf: the open-sky level stays in a sane draw budget ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    engine.headless = false;
    const out = [];
    for (const [z, f] of [[18.5, Math.PI], [-100, 2.1]]) {
      g.player.pos.set(0, 0, z);
      g.camRig.reset(f);
      engine.step(1 / 60);
      engine.step(1 / 60);
      out.push(engine.renderer.info.render.calls);
    }
    engine.headless = true;
    return out;
  });
  expect(`skyway/perf: draw calls at the spawn and at the fight (${r.join(', ')} <= 230)`, r.every((c) => c > 0 && c <= 230), JSON.stringify(r));
  expect('no page errors (render)', errors.length === 0, errors.join(' | '));
  await p.close();
}

await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall skyway checks passed');
