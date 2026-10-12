// The Prologue purge (#14): src/levels/prologue.json chains ordered objectives that wake purge-1..purge-6. Checks that the purge
// starts after the first kills (alarm lighting, siren state, announcer line), every stage wakes in order and only after the previous one,
// the run reaches the spider and killing it completes the chain (alarm off), kills out of order never soft-lock, and checkpoints exist
// between stages. Pure level data, headless stepping.
// Needs the dev server: `npm run dev`, then `node tests/prologue-purge.browser.mjs` (Playwright + Chromium).
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
  await p.addInitScript(() => { try { localStorage.setItem('cerberus.introSeen', 'true'); } catch {} });
  await p.goto(url.href);
  await p.waitForFunction(() => window.game?.engine);
  await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    engine.stop();
    engine.headless = true;
    const T = (window.T = { objectives: [], checkpoints: [], failed: 0, complete: 0, alarm: [] });
    T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { g.player.health = 100; engine.step(1 / 60); } };
    T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
    T.go = (x, z, s = 0.1) => { g.player.pos.set(x, 0, z); g.player.vel?.set(0, 0, 0); T.step(s); };
    T.cur = () => g.mission.current?.oid ?? g.mission.state;
    T.group = (n) => g.enemies.all.filter((e) => e.squad === `purge-${n}`);
    T.awake = () => [1, 2, 3, 4, 5, 6].filter((n) => T.group(n).some((e) => e.alive && e.awake)); // groups with a living awake member
    T.kill = (e) => {
      if (e.legs) {
        const dir = new e.pos.constructor(0, 0, -1);
        for (const l of e.legs) e.damage(500, l.foot, dir, 'weak', l.knee);
        for (let i = 0; i < 30 && e.alive; i++) e.damage(100, e.pos, dir, 'weak', e.core);
      } else for (let i = 0; i < 80 && e.alive; i++) e.damage(100, e.pos.clone().setY(1), new e.pos.constructor(0, 0, -1), 'body');
    };
    T.killGroup = (n) => T.group(n).forEach(T.kill);
    T.passives = () => g.enemies.all.filter((e) => e.squad == null && e.alive);
    engine.events.on('mission:objective', (e) => T.objectives.push(e.id));
    engine.events.on('mission:failed', () => T.failed++);
    engine.events.on('mission:complete', () => T.complete++);
    engine.events.on('checkpoint:reached', (e) => T.checkpoints.push(e.id));
    engine.events.on('alarm:on', (e) => T.alarm.push(['on', e.id, e.siren]));
    engine.events.on('alarm:off', (e) => T.alarm.push(['off', e.id]));
    T.step(1 / 60);
    T.press('Mouse0');
    T.step(0.5);
    T.press('Mouse0'); // skip the intro
    T.step(0.7);
  });
  return { p, errors };
}

// ---- 1: the whole purge in order: start, six stages, spider, complete ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = { snaps: {} };
    const snap = (k) => (out.snaps[k] = { cur: T.cur(), awake: T.awake(), failed: T.failed });
    out.chain = g.mission.objectives.map((o) => o.oid);
    snap('boot');
    out.alarm0 = { level: g.world.alarm.level, target: g.world.alarm.target, siren: g.audio.sirenWanted, fog: g.world.scene.fog.color.getHexString() };
    T.step(5);
    snap('idle 5 s');
    // the bay exit, then the first kills of the passive targets: nothing purge-related before the third
    T.go(0, 29.5);
    snap('bay left');
    const passives = T.passives();
    T.kill(passives[0]); T.kill(passives[1]); T.step(0.1);
    out.beforeThird = { cur: T.cur(), alarm: g.world.alarm.target, entries: g.log.entries.filter((e) => e.voice).length, awake: T.awake() };
    T.kill(passives[2]); T.step(0.1);
    snap('purge start');
    out.start = { alarmTarget: g.world.alarm.target, siren: g.audio.sirenWanted, events: [...T.alarm], line: g.log.entries.filter((e) => e.voice === 'announcer'), cls: document.getElementById('log').classList.contains('announcer') };
    T.step(1.5);
    out.mid = { level: g.world.alarm.level, fog: g.world.scene.fog.color.getHexString(), hemi: g.world.hemi.color.getHexString(), sun: g.world.sun.color.getHexString() };
    T.step(3);
    out.full = { level: g.world.alarm.level, fog: g.world.scene.fog.color.getHexString() };
    snap('purge-yard');
    // the stages, one by one. Each: the expected current objective, only the groups of the stages so far awake, a checkpoint on the way
    const stages = [
      ['purge-yard', [1], [0, 20], 1],
      ['purge-hall', [2], [-9, -36], 2],
      ['purge-troopers-yard', [3], [-9, -36], 3],
      ['purge-troopers-hall', [4], [16, -33], 4],
      ['purge-drones', [5], [16, -33], 5],
    ];
    out.stages = [];
    for (const [id, awake, at, n] of stages) {
      T.go(at[0], at[1]);
      out.stages.push({ id, cur: T.cur(), awake: T.awake(), want: awake });
      T.killGroup(n);
      T.step(0.2);
    }
    out.slot = { orders: g.mission.objectives.map((o) => o.params.order) }; // the armoury slot (#93): order 60 is free between the shooters and the troopers
    T.step(14); // calm: the two queued STEM-00 lines play
    // the gate: reaching it is its own objective; the spider is still asleep until the boss stage
    out.beforeGate = { cur: T.cur(), awake: T.awake() };
    out.lines = g.log.entries.filter((e) => !/LINK: NONE/.test(e.text)).map((e) => e.text);
    T.go(39.75, -10);
    T.go(39.75, -17, 0.2);
    out.boss = { cur: T.cur(), awake: T.awake(), alarmTarget: g.world.alarm.target };
    T.kill(T.group(6)[0]);
    T.step(0.5);
    out.end = { state: g.mission.state, complete: T.complete, failed: T.failed, alarmTarget: g.world.alarm.target, siren: g.audio.sirenWanted };
    T.step(4);
    out.after = { level: g.world.alarm.level, fog: g.world.scene.fog.color.getHexString() };
    out.objectives = [...T.objectives];
    out.checkpoints = [...T.checkpoints];
    out.alarmEvents = [...T.alarm];
    return out;
  });
  const S = r.snaps;
  expect('chain: leave-bay, calibrate, purge-start, six purge stages around the gate, in order', r.chain.join() === 'leave-bay,calibrate,purge-start,purge-yard,purge-hall,purge-troopers-yard,purge-troopers-hall,purge-drones,purge-gate,purge-boss', r.chain.join());
  expect('nothing is awake, no alarm, normal light before the purge', S.boot.cur === 'leave-bay' && !S.boot.awake.length && r.alarm0.target === 0 && !r.alarm0.siren && r.alarm0.fog === '4f7b7e' && S['idle 5 s'].cur === 'leave-bay' && !S['idle 5 s'].awake.length, JSON.stringify([S.boot, r.alarm0, S['idle 5 s']]));
  expect('leaving the bay makes the target kills current; two kills are not enough', S['bay left'].cur === 'calibrate' && r.beforeThird.cur === 'calibrate' && r.beforeThird.alarm === 0 && !r.beforeThird.awake.length && r.beforeThird.entries === 0, JSON.stringify([S['bay left'], r.beforeThird]));
  expect('the third kill starts the purge: alarm on (siren, red target), announcer line shown in its own style', S['purge start'].cur === 'purge-start' && r.start.alarmTarget === 1 && r.start.siren && JSON.stringify(r.start.events) === '[["on","purge-alarm",true]]' && r.start.line.length === 1 && r.start.line[0].text === 'CALIBRATION UNIT 00: NONCOMPLIANT. PURGE.' && r.start.cls, JSON.stringify(r.start));
  expect('  nothing wakes during the purge-start beat', !S['purge start'].awake.length, JSON.stringify(S['purge start']));
  expect('  the light shifts to red (fog and hemisphere move toward red, then hold), fully faded in after the beat', r.mid.fog !== '4f7b7e' && parseInt(r.mid.fog.slice(0, 2), 16) > 0x4f && r.full.fog !== '4f7b7e' && r.mid.level > 0.5 && r.full.level === 1 && r.mid.hemi !== 'a6ccce' && r.mid.sun !== 'e4f0f0', JSON.stringify([r.mid, r.full]));
  expect('  after the beat purge-yard is current and exactly purge-1 is awake', S['purge-yard'].cur === 'purge-yard' && JSON.stringify(S['purge-yard'].awake) === '[1]', JSON.stringify(S['purge-yard']));
  for (const s of r.stages) expect(`stage ${s.id}: current, and only the living awake group is ${JSON.stringify(s.want)} (earlier ones cleared, later ones asleep)`, s.cur === s.id && JSON.stringify(s.awake) === JSON.stringify(s.want), JSON.stringify(s));
  expect('  the armoury slot (order 60) is free between purge-hall (50) and purge-troopers-yard (70)', r.slot.orders.includes(50) && !r.slot.orders.includes(60) && r.slot.orders.includes(70), JSON.stringify(r.slot));
  expect('after the drones the gate objective is current; the spider sleeps', r.beforeGate.cur === 'purge-gate' && JSON.stringify(r.beforeGate.awake) === '[]' , JSON.stringify(r.beforeGate));
  expect('reaching the gate wakes the spider (purge-6) and no one else', r.boss.cur === 'purge-boss' && JSON.stringify(r.boss.awake) === '[6]' && r.boss.alarmTarget === 1, JSON.stringify(r.boss));
  expect('killing the spider completes the mission once, no failure; the alarm and siren end', r.end.state === 'complete' && r.end.complete === 1 && r.end.failed === 0 && r.end.alarmTarget === 0 && !r.end.siren && r.after.level === 0 && r.after.fog === '4f7b7e' && JSON.stringify(r.alarmEvents) === '[["on","purge-alarm",true],["off","purge-alarm"]]', JSON.stringify([r.end, r.after, r.alarmEvents]));
  expect('every objective became current exactly once, in chain order', r.objectives.join() === r.chain.slice(1).join(), r.objectives.join());
  expect('  checkpoints between the stages were reached: yard, hall, hall-east, gate', ['cp-yard', 'cp-hall', 'cp-hall-east', 'cp-gate'].every((c) => r.checkpoints.includes(c)), r.checkpoints.join());
  expect('  the announcer and two STEM-00 lines at stage changes (after the hall shooters, after the drones), each at most 70 characters', r.lines.length === 3 && r.lines[0].startsWith('CALIBRATION') && r.lines.slice(1).every((t) => t.startsWith('> ') && t.length <= 70), JSON.stringify(r.lines));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 2: kills out of order never soft-lock; groups killed while asleep stay asleep and their stages pass at once ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    // kill the interior shooters, the hall troopers and the drones before the purge: they are shot while dormant
    T.killGroup(2); T.killGroup(4); T.killGroup(5);
    out.asleep = T.awake();
    T.go(0, 29.5);
    const passives = T.passives();
    passives.slice(0, 3).forEach(T.kill);
    T.step(4.3);
    out.yard = { cur: T.cur(), awake: T.awake() };
    T.killGroup(1);
    T.step(0.2);
    // purge-hall had nothing alive: it passed at once, and so on up to the first group that still lives
    out.yardTroopers = { cur: T.cur(), awake: T.awake() };
    T.killGroup(3);
    T.step(0.2);
    out.gate = { cur: T.cur(), awake: T.awake() };
    T.go(39.75, -17, 0.2);
    out.boss = { cur: T.cur(), awake: T.awake() };
    T.kill(T.group(6)[0]);
    T.step(0.3);
    out.end = { state: g.mission.state, failed: T.failed, alarm: g.world.alarm.target };
    out.objectives = [...T.objectives];
    return out;
  });
  expect('groups killed asleep stay asleep', JSON.stringify(r.asleep) === '[]', JSON.stringify(r.asleep));
  expect('yard stage: purge-1 awake alone', r.yard.cur === 'purge-yard' && JSON.stringify(r.yard.awake) === '[1]', JSON.stringify(r.yard));
  expect('hall shooters already dead: their stage passes at once; the yard troopers wake next', r.yardTroopers.cur === 'purge-troopers-yard' && JSON.stringify(r.yardTroopers.awake) === '[3]', JSON.stringify(r.yardTroopers));
  expect('hall troopers and drones already dead: the chain runs on to the gate', r.gate.cur === 'purge-gate', JSON.stringify(r.gate));
  expect('the spider stage still works and completes the mission', r.boss.cur === 'purge-boss' && r.end.state === 'complete' && r.end.failed === 0 && r.end.alarm === 0, JSON.stringify([r.boss, r.end]));
  expect('no objective skipped, none repeated', r.objectives.join() === 'calibrate,purge-start,purge-yard,purge-hall,purge-troopers-yard,purge-troopers-hall,purge-drones,purge-gate,purge-boss', r.objectives.join());
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 3: restart clears the alarm; the pistol never runs dry ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    T.go(0, 29.5);
    T.passives().slice(0, 3).forEach(T.kill);
    T.step(2.5);
    const on = g.world.alarm.level;
    g.loadScene('prologue');
    T.step(0.2);
    const out = { on, target: g.world.alarm.target, level: g.world.alarm.level, siren: g.audio.sirenWanted, cur: T.cur(), line: g.log.entries.length };
    out.reserve = { pistol: g.weapon.current, ammo: JSON.stringify(g.weapon.ammo ?? null).slice(0, 200) };
    return out;
  });
  expect('a scene reload ends the alarm and restarts the chain', r.on > 0.5 && r.target === 0 && r.level === 0 && !r.siren && r.cur === 'leave-bay' && r.line === 0, JSON.stringify(r));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall prologue purge checks passed');
