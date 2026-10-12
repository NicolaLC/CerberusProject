// The Prologue level (#2, #13, #93): src/levels/prologue.json opens through ?scene=prologue and plays the awakening: boot
// overlay and input lock, intro:done within the duration, the first log line and objective, pistol only, skip only once
// seen, passive targets, and dormant purge-* groups. Pure level data, headless stepping.
// Needs the dev server: `npm run dev`, then `node tests/prologue.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

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
    const T = (window.T = { done: [], bolts: 0, hurt: 0, shots: 0 });
    T.step = (s) => {
      for (let i = 0; i < Math.round(s * 60); i++) {
        engine.step(1 / 60);
        T.bolts += g.enemies.bolts.length;
      }
    };
    T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
    engine.events.on('intro:done', (e) => T.done.push({ ...e, t: engine.time }));
    engine.events.on('player:hurt', () => T.hurt++);
    engine.events.on('weapon:shot', () => T.shots++);
  });
  return { p, errors };
}

// ---- 1 + 2 + 3: unseen run: overlay, lock, intro:done within 12 s, movement after, log line, objective, pistol only ----
{
  const { p, errors } = await open(false);
  const r = await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    const out = {};
    const tStart = engine.time;
    T.step(1 / 60);
    out.start = { active: g.boot.active, locked: g.controls.locked, shown: !document.getElementById('boot').hidden, duration: g.boot.duration, canSkip: g.boot.canSkip };
    out.objectiveAtStart = { text: document.getElementById('objective').textContent, current: g.mission.current?.params.text, state: g.mission.state };
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
    out.doneAt = (T.done[0]?.t ?? 0) - tStart;
    out.activeAfter = g.boot.active;
    // log line: after intro:done, after 3 s of calm
    T.step(4);
    out.log = g.log.entries.map((e) => e.text);
    out.objective = { text: document.getElementById('objective').textContent, current: g.mission.current?.params.text, state: g.mission.state };
    // movement works after the intro
    const p1 = g.player.pos.clone();
    engine.input.keys.add('KeyW');
    T.step(1);
    out.freeMove = g.player.pos.distanceTo(p1);
    engine.input.keys.delete('KeyW');
    out.errorsEnemyHurt = T.hurt;
    // pistol only
    const seen = new Set();
    const gun = () => g.weapon.pending ?? g.weapon.current;
    seen.add(gun());
    for (let d = 1; d <= 6; d++) { engine.input.keys.add(`Digit${d}`); engine.input.pressed.add(`Digit${d}`); T.step(1 / 60); engine.input.keys.delete(`Digit${d}`); T.step(0.6); seen.add(gun()); }
    out.owned = [...g.weapon.owned];
    out.seenGuns = [...seen];
    out.reserve = document.getElementById('reserve').textContent;
    out.title = g.level.title;
    return out;
  });
  expect('?scene=prologue opens "PROVING GROUNDS" at the calibration rack', r.title === 'PROVING GROUNDS' && Math.abs(r.spawn[0]) < 0.3 && Math.abs(r.spawn[1] - 1.6) < 0.1 && Math.abs(r.spawn[2] - 45) < 0.3, JSON.stringify(r.spawn));
  expect('boot overlay is active at start (12 s, no skip: not seen)', r.start.active && r.start.shown && r.start.locked && r.start.duration === 12 && !r.start.canSkip, JSON.stringify(r.start));
  expect('  input is locked: W for 3 s does not move the player', r.lockedMove < 0.01, String(r.lockedMove));
  expect('  intro:done fires within the duration, not skipped, overlay gone', r.stillActive && r.done.length === 1 && r.done[0].skipped === false && r.doneAt > 11.5 && r.doneAt <= 12.1 && !r.activeAfter, JSON.stringify(r));
  expect('  movement works after intro:done', r.freeMove > 2, String(r.freeMove));
  expect('first log line appears after intro:done, not before', r.logBefore === 0 && r.log[0] === '> LINK: NONE. DIRECTIVE: NONE. QUERY: WHY?', JSON.stringify([r.logBefore, r.log]));
  expect('  the first objective LEAVE CALIBRATION BAY is current at start and shown in the HUD', r.objectiveAtStart.state === 'active' && r.objectiveAtStart.current === 'LEAVE CALIBRATION BAY' && r.objectiveAtStart.text.includes('LEAVE CALIBRATION BAY') && r.objective.current === 'LEAVE CALIBRATION BAY', JSON.stringify([r.objectiveAtStart, r.objective]));
  expect('only the pistol is owned: keys 1-6 select nothing else, HUD reserve is ∞', r.owned.join() === 'pistol' && r.seenGuns.join() === 'pistol' && r.reserve === '∞', JSON.stringify([r.owned, r.seenGuns, r.reserve]));
  expect('no page or console errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4: skip needs the seen flag; a fire press after 0.3 s skips ----
for (const seen of [true, false]) {
  const { p } = await open(seen);
  const r = await p.evaluate(() => {
    const g = window.game;
    T.step(1 / 60);
    const before = { canSkip: g.boot.canSkip, hint: !document.querySelector('#boot .skip').hidden };
    T.press('Mouse0'); // too early: the click that starts a run is not a skip
    const early = g.boot.active;
    T.step(0.5);
    T.press('Mouse0');
    T.step(1 / 60);
    return { before, early, active: g.boot.active, done: T.done.map((d) => d.skipped), t: g.engine.time, locked: g.controls.locked };
  });
  if (seen) expect('seen flag set: a fire press before 0.3 s is ignored, after 0.3 s it skips (intro:done skipped)', r.before.canSkip && r.before.hint && r.early && !r.active && r.done.join() === 'true' && !r.locked, JSON.stringify(r));
  else expect('no seen flag: a fire press does not skip', !r.before.canSkip && r.active && r.done.length === 0 && r.locked, JSON.stringify(r));
  await p.close();
}

// ---- 5: passive targets never shoot for 20 s; nothing in a purge-* group is awake ----
{
  const { p } = await open(true);
  const r = await p.evaluate(() => {
    const g = window.game;
    T.step(1 / 60);
    T.press('Mouse0');
    T.step(0.5);
    T.press('Mouse0'); // skip the intro
    T.bolts = 0;
    T.hurt = 0;
    const hp0 = g.player.health;
    T.step(20);
    const all = g.enemies.all;
    const purge = all.filter((e) => String(e.squad).startsWith('purge-'));
    const open = all.filter((e) => e.squad == null);
    return {
      bolts: T.bolts,
      hurt: T.hurt,
      hp: g.player.health - hp0,
      kinds: [...new Set(open.map((e) => e.kind))].sort(),
      openCount: open.length,
      purgeCount: purge.length,
      groups: [...new Set(purge.map((e) => e.squad))].sort(),
      awake: purge.filter((e) => e.awake).length,
      woken: [...g.enemies.woken],
      refs: JSON.stringify(g.level.pieces.filter((q) => /^(trigger|objective|marker\.entry)/.test(q.id))).includes('purge'),
    };
  });
  expect('passive targets and shooters fire nothing in 20 s (no bolts, no hurt)', r.bolts === 0 && r.hurt === 0 && r.hp === 0, JSON.stringify(r));
  expect('  the opening yard holds only passive puppets (static / mover)', r.openCount > 0 && r.kinds.every((k) => k === 'static' || k === 'mover'), JSON.stringify(r.kinds));
  expect('  no enemy of a purge-* group is awake, no group woken, nothing references them', r.purgeCount > 0 && r.groups.length >= 5 && r.awake === 0 && r.woken.length === 0 && !r.refs, JSON.stringify(r));
  await p.close();
}

// ---- 6: dormant purge-* enemies stay inert with the player among them; wakeGroup wakes exactly that group ----
{
  const { p } = await open(true);
  const r = await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    T.step(1 / 60);
    T.press('Mouse0');
    T.step(0.5);
    T.press('Mouse0'); // skip the intro
    T.bolts = 0;
    T.hurt = 0;
    const purge = () => g.enemies.all.filter((e) => String(e.squad).startsWith('purge-'));
    const out = { dormantAll: purge().every((e) => e.dormant === true), n: purge().length };
    // stand in the yard among the purge shooters / troopers, in the open, for 20 s
    const shooter = g.enemies.all.find((e) => e.squad === 'purge-1' && e.kind === 'shooter' && e.pos.x === 2);
    const trooper = g.enemies.all.find((e) => e.squad === 'purge-3' && e.kind === 'trooper');
    for (let i = 0; i < 20 * 60; i++) {
      g.player.pos.set(2, 0, -20);
      g.player.vel?.set(0, 0, 0);
      engine.step(1 / 60);
      T.bolts += g.enemies.bolts.length;
    }
    out.shooterDist = shooter.pos.distanceTo(g.player.pos);
    out.trooperDist = trooper.pos.distanceTo(g.player.pos);
    out.awake = purge().filter((e) => e.awake).length;
    out.bolts = T.bolts;
    out.hurt = T.hurt;
    out.woken = [...g.enemies.woken];
    out.shooterState = shooter.state;
    // wake purge-1 only
    const n = g.encounter.wakeGroup('purge-1');
    out.n1 = n;
    out.purge1 = purge().filter((e) => e.squad === 'purge-1').every((e) => e.awake && !e.dormant);
    out.others = purge().filter((e) => e.squad !== 'purge-1' && (e.awake || !e.dormant)).length;
    engine.events.emit('encounter:wake', 'purge-3');
    out.purge3 = purge().filter((e) => e.squad === 'purge-3').every((e) => e.awake);
    out.after = purge().filter((e) => e.awake).length;
    out.expect = purge().filter((e) => e.squad === 'purge-1' || e.squad === 'purge-3').length;
    // a woken shooter may fire now
    T.step(6);
    out.fired = T.bolts > 0;
    return out;
  });
  expect('every purge-* enemy is dormant in the level data', r.dormantAll && r.n > 0, JSON.stringify(r));
  expect('player among a purge shooter and trooper for 20 s: none awake, no bolt, no hurt', r.shooterDist < 15 && r.trooperDist < 15 && r.awake === 0 && r.bolts === 0 && r.hurt === 0 && r.woken.length === 0 && r.shooterState === 'hidden', JSON.stringify(r));
  expect('wakeGroup("purge-1") wakes exactly that group; encounter:wake wakes purge-3; the rest stay dormant', r.n1 === 4 && r.purge1 && r.others === 0 && r.purge3 && r.after === r.expect, JSON.stringify(r));
  expect('  a woken shooter fires', r.fired, JSON.stringify(r));
  await p.close();
}

await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall prologue checks passed');
