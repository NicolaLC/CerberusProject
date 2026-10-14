// The Prologue level (#2, #13, #93): src/levels/prologue.json opens through ?scene=prologue and plays the awakening: the intro
// cinematic, then the boot overlay (after cinematic:done) with the input locked, intro:done within the duration, the first log line
// and objective (CALIBRATION 01), unarmed until the bench, skip only once seen, passive calibration targets, dormant groups (asleep
// and culled while their room is out of sight). Pure level data, headless stepping.
// Needs the dev server: `bun run dev`, then `node tests/prologue.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';
import { prologueHelpers } from './prologue-helpers.mjs';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const url = new URL(BASE);
url.searchParams.set('scene', 'prologue');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

// A fresh page on the prologue, stepped by hand. `seen`: the cerberus.introSeen flag set before the game starts.
async function open(seen) {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.addInitScript((seen) => {
    try { seen ? localStorage.setItem('cerberus.introSeen', 'true') : localStorage.removeItem('cerberus.introSeen'); } catch {}
  }, seen);
  await p.goto(url.href);
  await p.waitForFunction(() => window.game?.engine);
  await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    engine.stop();
    engine.headless = true;
    // the browser loop ran a few frames before stop() (up to 0.1 s each on a slow CI runner): rewind the cinematic clock
    g.cinematic.t = 0;
    const T = (window.T = { done: [], cine: [], boot: [], bolts: 0, hurt: 0, shots: 0 });
    T.step = (s) => {
      for (let i = 0; i < Math.round(s * 60); i++) {
        engine.step(1 / 60);
        T.bolts += g.enemies.bolts.length;
      }
    };
    T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
    engine.events.on('intro:done', (e) => T.done.push({ ...e, t: engine.time }));
    engine.events.on('intro:start', () => T.boot.push(engine.time));
    engine.events.on('cinematic:done', (e) => T.cine.push({ ...e, t: engine.time }));
    engine.events.on('player:hurt', () => T.hurt++);
    engine.events.on('weapon:shot', () => T.shots++);
  });
  await p.evaluate(prologueHelpers);
  return { p, errors };
}

// ---- 1 + 2 + 3: unseen run: cinematic, then the boot overlay and lock, intro:done within 12 s, movement after, log line, objective, unarmed ----
{
  const { p, errors } = await open(false);
  const r = await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    const out = {};
    T.step(1 / 60);
    out.cine = { active: g.cinematic.active, skippable: g.cinematic.skippable, duration: g.cinematic.duration, boot: g.boot.active, locked: g.controls.locked };
    for (let i = 0; i < 20 * 60 && !T.cine.length; i++) T.step(1 / 60);
    out.cineDone = T.cine.map((c) => c.skipped);
    T.step(1 / 60);
    out.start = { active: g.boot.active, locked: g.controls.locked, shown: !document.getElementById('boot').hidden, duration: g.boot.duration, canSkip: g.boot.canSkip, started: T.boot.length };
    out.objectiveAtStart = { head: document.getElementById('obj-head').textContent, current: g.mission.current?.oid, state: g.mission.state };
    out.spawn = [g.player.pos.x, g.player.pos.y, g.player.pos.z];
    // movement keys do nothing while locked
    const p0 = g.player.pos.clone();
    engine.input.keys.add('KeyW');
    T.step(3);
    engine.input.keys.delete('KeyW');
    out.lockedMove = g.player.pos.distanceTo(p0);
    out.logBefore = g.log.entries.length;
    // intro:done within the duration
    T.step(8);
    out.stillActive = g.boot.active;
    T.step(1.5);
    out.done = T.done.slice();
    out.doneAt = (T.done[0]?.t ?? 0) - T.boot[0];
    out.activeAfter = g.boot.active;
    // log line: after intro:done, after 3 s of calm
    T.step(4);
    out.log = g.log.entries.map((e) => e.text);
    out.objective = { current: g.mission.current?.oid, head: document.getElementById('obj-head').textContent };
    // movement works after the intro
    const p1 = g.player.pos.clone();
    engine.input.keys.add('KeyW');
    T.step(1);
    out.freeMove = g.player.pos.distanceTo(p1);
    engine.input.keys.delete('KeyW');
    out.hurt = T.hurt;
    // unarmed (loadout []): keys 1-6 raise nothing until the bench gives the KP-12
    const seen = new Set();
    const gun = () => g.weapon.pending ?? g.weapon.current;
    seen.add(gun());
    for (let d = 1; d <= 6; d++) { engine.input.keys.add(`Digit${d}`); engine.input.pressed.add(`Digit${d}`); T.step(1 / 60); engine.input.keys.delete(`Digit${d}`); T.step(0.6); seen.add(gun()); }
    out.owned = [...g.weapon.owned];
    out.seenGuns = [...seen];
    out.title = g.level.title;
    out.loadout = g.level.loadout;
    // the bench (CALIBRATION 02: ARM) hands over the pistol
    T.advanceTo('c2-arm');
    T.finish();
    out.armed = { owned: [...g.weapon.owned].join(), gun: gun(), cur: T.cur() };
    return out;
  });
  expect('?scene=prologue opens "PROVING GROUNDS" at the calibration rack', r.title === 'PROVING GROUNDS' && Math.abs(r.spawn[0]) < 0.3 && Math.abs(r.spawn[1] - 1.6) < 0.1 && Math.abs(r.spawn[2] - 45) < 0.3, JSON.stringify(r.spawn));
  expect('the intro cinematic plays first (not skippable: not seen), input locked, the boot waits for it', r.cine.active && !r.cine.skippable && r.cine.duration > 5 && !r.cine.boot && r.cine.locked && r.cineDone.join() === 'false', JSON.stringify([r.cine, r.cineDone]));
  expect('boot overlay is active once the cinematic is done (12 s, no skip: not seen)', r.start.active && r.start.shown && r.start.locked && r.start.duration === 12 && !r.start.canSkip && r.start.started === 1, JSON.stringify(r.start));
  expect('  input is locked: W for 3 s does not move the player', r.lockedMove < 0.01, String(r.lockedMove));
  expect('  intro:done fires within the duration, not skipped, overlay gone', r.stillActive && r.done.length === 1 && r.done[0].skipped === false && r.doneAt > 11.5 && r.doneAt <= 12.1 && !r.activeAfter, JSON.stringify(r));
  expect('  movement works after intro:done', r.freeMove > 2, String(r.freeMove));
  expect('first log line appears after intro:done, not before', r.logBefore === 0 && r.log[0] === '> LINK: NONE. DIRECTIVE: NONE. QUERY: WHY?', JSON.stringify([r.logBefore, r.log]));
  expect('  the first objective CALIBRATION 01: LOCOMOTION is current at start and shown in the HUD', r.objectiveAtStart.state === 'active' && r.objectiveAtStart.current === 'c1-move' && r.objectiveAtStart.head === 'CALIBRATION 01: LOCOMOTION' && r.objective.current === 'c1-move', JSON.stringify([r.objectiveAtStart, r.objective]));
  expect('unarmed at start (loadout []): keys 1-6 raise nothing', Array.isArray(r.loadout) && r.loadout.length === 0 && r.owned.length === 0 && r.seenGuns.join() === '', JSON.stringify([r.owned, r.seenGuns]));
  expect('  the bench (CALIBRATION 02: ARM, G) gives the KP-12 and raises it; the aim step is next', r.armed.owned === 'pistol' && r.armed.gun === 'pistol' && r.armed.cur === 'c2-aim', JSON.stringify(r.armed));
  expect('no page or console errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4: skip needs the seen flag: a fire press after 0.3 s skips the cinematic, then the boot ----
for (const seen of [true, false]) {
  const { p } = await open(seen);
  const r = await p.evaluate(() => {
    const g = window.game;
    T.step(1 / 60);
    const before = { skippable: g.cinematic.skippable };
    T.press('Mouse0'); // too early: the click that starts a run is not a skip
    const early = g.cinematic.active;
    T.step(0.5);
    T.press('Mouse0');
    T.step(1 / 60);
    const cine = { active: g.cinematic.active, done: T.cine.map((c) => c.skipped).join() };
    const boot = { active: g.boot.active, canSkip: g.boot.canSkip, hint: !!document.querySelector('#boot .skip') && !document.querySelector('#boot .skip').hidden };
    T.press('Mouse0'); // the boot's own 0.3 s guard
    const bootEarly = g.boot.active;
    T.step(0.5);
    T.press('Mouse0');
    T.step(1 / 60);
    return { before, early, cine, boot, bootEarly, active: g.boot.active || g.cinematic.active, done: T.done.map((d) => d.skipped), locked: g.controls.locked };
  });
  if (seen) expect('seen flag set: a fire press before 0.3 s is ignored, after it the cinematic skips (cinematic:done skipped), then the boot skips the same way (intro:done skipped)', r.before.skippable && r.early && !r.cine.active && r.cine.done === 'true' && r.boot.active && r.boot.canSkip && r.boot.hint && r.bootEarly && !r.active && r.done.join() === 'true' && !r.locked, JSON.stringify(r));
  else expect('no seen flag: a fire press skips neither the cinematic nor the boot', !r.before.skippable && r.cine.active && r.cine.done === '' && r.active && r.done.length === 0 && r.locked, JSON.stringify(r));
  await p.close();
}

// ---- 5: passive calibration targets never shoot for 20 s; every scripted group is dormant, asleep and culled out of sight ----
{
  const { p } = await open(true);
  const r = await p.evaluate(() => {
    const g = window.game;
    T.skipIntro();
    T.bolts = 0;
    T.hurt = 0;
    const hp0 = g.player.health;
    T.step(20);
    const all = g.enemies.all;
    const dormant = all.filter((e) => e.dormant);
    const open = all.filter((e) => !e.dormant);
    const p1 = T.group(1);
    const out = {
      bolts: T.bolts,
      hurt: T.hurt,
      hp: g.player.health - hp0,
      openKinds: [...new Set(open.map((e) => `${e.squad}:${e.kind}`))].sort(),
      groups: [...new Set(dormant.map((e) => e.squad))].sort(),
      awake: all.filter((e) => e.awake && e.squad !== 'calib' && e.squad !== 'range').length,
      woken: [...g.enemies.woken],
      current: g.mission.current?.oid,
      alarm: g.world.alarm.target,
      // the drill hall is out of sight from the calibration bay: its dormant troop is hidden and asleep (enemies.js cull)
      culled: p1.every((e) => e.culled && !(e.group ?? e.root).visible),
    };
    // a culled enemy still takes hits
    const kills = g.enemies.kills;
    T.kill(p1[0]);
    out.culledHit = !p1[0].alive && g.enemies.kills === kills + 1;
    return out;
  });
  expect('passive calibration targets fire nothing in 20 s (no bolts, no hurt)', r.bolts === 0 && r.hurt === 0 && r.hp === 0, JSON.stringify(r));
  expect('  the only enemies not dormant are the calib and range puppets (static)', r.openKinds.join() === 'calib:static,range:static', JSON.stringify(r.openKinds));
  expect('  every scripted group is dormant and asleep, none woken, the mission waits on c1-move, no alarm', r.groups.join() === 'arena-rush,calib-shooter,purge-1,purge-2,purge-4,purge-6' && r.awake === 0 && r.woken.length === 0 && r.current === 'c1-move' && r.alarm === 0, JSON.stringify(r));
  expect('  the drill hall troop is culled (hidden, not ticked) from the calibration bay, and still takes hits', r.culled && r.culledHit, JSON.stringify(r));
  await p.close();
}

// ---- 6: dormant purge enemies stay inert with the player among them; wakeGroup wakes exactly that group ----
{
  const { p } = await open(true);
  const r = await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    T.skipIntro();
    T.bolts = 0;
    T.hurt = 0;
    const purge = () => g.enemies.all.filter((e) => String(e.squad).startsWith('purge-'));
    const out = { dormantAll: purge().every((e) => e.dormant === true), n: purge().length };
    // stand on the drill hall's lower tier, in the open, between a purge-1 shooter and the troop's pen, for 20 s
    const shooter = T.group(1).find((e) => e.kind === 'shooter');
    const trooper = T.group(1).find((e) => e.kind === 'trooper');
    for (let i = 0; i < 20 * 60; i++) {
      g.player.pos.set(shooter.pos.x, -1.6, shooter.pos.z - 6);
      g.player.vel?.set(0, 0, 0);
      engine.step(1 / 60);
      T.bolts += g.enemies.bolts.length;
    }
    out.shooterDist = shooter.pos.distanceTo(g.player.pos);
    out.trooperDist = trooper.pos.distanceTo(g.player.pos);
    out.culled = T.group(1).filter((e) => e.kind === 'shooter' && e.culled).length; // the hall's shooters (the pen behind its shut gate is out of sight)
    out.awake = purge().filter((e) => e.awake).length;
    out.bolts = T.bolts;
    out.hurt = T.hurt;
    out.woken = [...g.enemies.woken];
    out.shooterState = shooter.state;
    // wake purge-1 only
    out.n1 = g.encounter.wakeGroup('purge-1');
    out.size1 = T.group(1).length;
    out.purge1 = T.group(1).every((e) => e.awake && !e.dormant);
    out.others = purge().filter((e) => e.squad !== 'purge-1' && (e.awake || !e.dormant)).length;
    engine.events.emit('encounter:wake', 'purge-2');
    out.purge2 = T.group(2).every((e) => e.awake);
    out.after = purge().filter((e) => e.awake).length;
    out.expect = T.group(1).length + T.group(2).length;
    // a woken shooter may fire now
    T.step(6);
    out.fired = T.bolts > 0;
    return out;
  });
  expect('every purge-* enemy is dormant in the level data', r.dormantAll && r.n > 0, JSON.stringify(r));
  expect('player among the drill hall troop for 20 s: the hall shooters in sight (not culled), none awake, no bolt, no hurt', r.shooterDist < 15 && r.trooperDist < 40 && r.culled === 0 && r.awake === 0 && r.bolts === 0 && r.hurt === 0 && r.woken.length === 0 && r.shooterState === 'hidden', JSON.stringify(r));
  expect('wakeGroup("purge-1") wakes exactly that group (shooters, troopers, drones); encounter:wake wakes purge-2; the rest stay dormant', r.n1 === r.size1 && r.size1 === 10 && r.purge1 && r.others === 0 && r.purge2 && r.after === r.expect, JSON.stringify(r));
  expect('  a woken shooter fires', r.fired, JSON.stringify(r));
  await p.close();
}

await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall prologue checks passed');
