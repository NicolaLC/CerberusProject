// The Prologue purge (#14): src/levels/prologue.json chains ordered objectives: the calibration rooms C1-C6, the weapons range, the
// drill hall cut that starts the purge, then purge-1, purge-2, purge-4 (the yard troopers and drones were merged into the drill hall
// troop), the boss cut and purge-6. Checks the chain order, that the purge starts with the cut (alarm lighting, siren, announcer line),
// every stage wakes only its own group, the range takes its guns back on the way out, the supply corridor refills and repairs, the
// boss cut's end state (played or skipped: the SX-6 landed, the rush gone, the far gate shut), killing the spider ends the alarm,
// kills out of order never soft-lock, and checkpoints sit between stages. Pure level data, headless stepping.
// Needs the dev server: `bun run dev`, then `node tests/prologue-purge.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';
import { prologueHelpers } from './prologue-helpers.mjs';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const url = new URL(BASE);
url.searchParams.set('scene', 'prologue');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

const CHAIN = 'c1-move,c2-arm,c2-aim,c3-jet,c4-cover,c4-fire,c5-hop,c5-slide,c6-transfer,range-light,range-heavy,leave-bay,purge-start,purge-yard,purge-hall,armoury,purge-troopers-hall,armoury-late,purge-gate,boss-cut,purge-boss,exit';

// A fresh page on the prologue (intro seen), stepped by hand, past the intro.
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
    const T = (window.T = { objectives: [], checkpoints: [], triggers: [], failed: 0, complete: 0, alarm: [], mortal: false });
    T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { if (!T.mortal) g.player.health = 100; engine.step(1 / 60); } };
    T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
    engine.events.on('mission:objective', (e) => T.objectives.push(e.id));
    engine.events.on('mission:failed', () => T.failed++);
    engine.events.on('mission:complete', () => T.complete++);
    engine.events.on('checkpoint:reached', (e) => T.checkpoints.push(e.id));
    engine.events.on('trigger:fired', (e) => T.triggers.push(e.id));
    engine.events.on('alarm:on', (e) => T.alarm.push(['on', e.id, e.siren]));
    engine.events.on('alarm:off', (e) => T.alarm.push(['off', e.id]));
  });
  await p.evaluate(prologueHelpers);
  await p.evaluate(() => T.skipIntro());
  return { p, errors };
}

// ---- 1: the whole chain in order: calibration, range, the cut, three purge stages, the boss cut, the spider, the exit ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = { snaps: {} };
    const snap = (k) => (out.snaps[k] = { cur: T.cur(), awake: T.awake(), failed: T.failed });
    const light = () => ({ level: g.world.alarm.level, target: g.world.alarm.target, siren: g.audio.sirenWanted, fog: g.world.scene.fog.color.getHexString(), hemi: g.world.hemi.color.getHexString(), base: g.world.base.fog.getHexString(), baseHemi: g.world.base.hemi.getHexString() }); // base: the colours without the alarm (sky preset, camera in or out)
    out.chain = g.mission.objectives.map((o) => o.oid);
    snap('boot');
    out.light0 = light();
    T.step(5);
    snap('idle 5 s');
    // calibration and the range: the calib shooter is the only one woken; the range guns are taken back at its door
    T.advanceTo('range-light');
    snap('range');
    T.advanceTo('leave-bay');
    out.rangeOwned = [...g.weapon.owned].join();
    T.finish({ rifle: true });
    out.afterRange = { owned: [...g.weapon.owned].join(), door: T.triggers.filter((t) => t === 'range-return').length };
    // the purge starts: alarm, announcer, the cut (it wakes purge-1 at the pen gate)
    snap('purge start');
    T.step(0.2);
    out.start = { ...light(), events: [...T.alarm], line: g.log.entries.filter((e) => e.voice === 'announcer').map((e) => e.text), cls: document.getElementById('log').classList.contains('announcer'), cut: g.cinematic.active && g.cinematic.id };
    T.step(1.5);
    out.mid = light();
    T.step(3);
    out.full = light();
    T.finish(); // skips the rest of the cut
    snap('purge-yard');
    out.placed = g.player.pos.toArray().map((n) => +n.toFixed(1));
    // the stages, one by one: only the current stage's group is awake
    out.stages = [];
    for (const [id, group, cp] of [['purge-yard', 'purge-1', [-9, -36]], ['purge-hall', 'purge-2', [16, -33]], ['purge-troopers-hall', 'purge-4', null]]) {
      out.stages.push({ id, cur: T.cur(), awake: T.awake(), want: [group] });
      T.finish();
      if (cp) T.go(cp[0], cp[1], 0.2); // the checkpoint between this stage and the next
      if (T.cur() === 'armoury') out.armoury = T.cur(); // never: the landing KR-7 is owned, the armoury skips itself
    }
    out.slot = g.mission.objectives.map((o) => o.params.order);
    // calm: the queued STEM-00 lines play one by one (the range and pickup lines are still ahead of them)
    for (let i = 0; i < 60 && !g.log.entries.some((e) => e.text.startsWith('> HOSTILES DESTROYED')); i++) T.step(1);
    out.beforeGate = { cur: T.cur(), awake: T.awake() };
    out.lines = g.log.entries.map((e) => e.text);
    // the arena: the reach just inside, then the boss cut (the rush comes, the SX-6 leaps in, the rush is recalled)
    T.finish();
    T.step(0.2);
    out.cut = { cur: T.cur(), active: g.cinematic.active, id: g.cinematic.id };
    T.finish();
    T.step(3); // the far gate finishes opening, then slides shut (1 s each)
    const boss = g.enemies.boss;
    const far = g.world.gates.find((x) => x.on === 'cue:recall');
    out.boss = { cur: T.cur(), awake: T.awake(), alarmTarget: g.world.alarm.target, at: boss.pos.toArray().map((n) => +n.toFixed(1)), leaping: !!boss.jump, rush: T.group('arena-rush').length, farClosed: far.closed, player: g.player.pos.toArray().map((n) => +n.toFixed(1)) };
    T.kill(boss);
    T.step(0.5);
    out.end = { state: g.mission.state, cur: T.cur(), complete: T.complete, failed: T.failed, alarmTarget: g.world.alarm.target, siren: g.audio.sirenWanted };
    T.step(4);
    out.after = light();
    T.finish(); // the transit node beyond the open gate ends the mission (prologue-exit.browser.mjs covers the gate itself)
    out.done = { state: g.mission.state, complete: T.complete, failed: T.failed };
    out.objectives = [...T.objectives];
    out.checkpoints = [...T.checkpoints];
    out.alarmEvents = [...T.alarm];
    return out;
  });
  const S = r.snaps;
  expect('chain: calibration C1-C6, the range, leave-bay, the cut, the purge stages around the armoury steps, the boss cut, the exit', r.chain.join() === CHAIN, r.chain.join());
  expect('nothing is awake, no alarm before the purge', S.boot.cur === 'c1-move' && !S.boot.awake.length && r.light0.target === 0 && !r.light0.siren && S['idle 5 s'].cur === 'c1-move' && !S['idle 5 s'].awake.length, JSON.stringify([S.boot, r.light0, S['idle 5 s']]));
  expect('  through calibration nothing scripted stays awake (the calib shooter is dead), no alarm', S.range.cur === 'range-light' && !S.range.awake.length, JSON.stringify(S.range));
  expect('the range lends its guns; its door takes them back (loadout pistol), the landing KR-7 is picked up after it', r.rangeOwned.split(',').length >= 3 && r.afterRange.owned === 'pistol,rifle' && r.afterRange.door === 1, JSON.stringify([r.rangeOwned, r.afterRange]));
  expect('the purge starts on PURGE INITIATED: alarm on (siren), announcer line in its own style, the drill hall cut plays', S['purge start'].cur === 'purge-start' && r.start.target === 1 && r.start.siren && JSON.stringify(r.start.events) === '[["on","purge-alarm",true]]' && r.start.line.join() === 'CALIBRATION UNIT 00: NONCOMPLIANT. PURGE.' && r.start.cls && r.start.cut === 'purge-cut', JSON.stringify(r.start));
  expect('  the light shifts (fog and hemisphere move off their normal colours), fully faded in after the beat', r.mid.fog !== r.mid.base && r.mid.hemi !== r.mid.baseHemi && r.mid.level > 0.5 && r.full.level === 1, JSON.stringify([r.light0, r.mid, r.full]));
  expect('  after the cut purge-yard is current, exactly purge-1 is awake, STEM-00 stands at cp-yard', S['purge-yard'].cur === 'purge-yard' && S['purge-yard'].awake.join() === 'purge-1' && Math.abs(r.placed[0] + 46.5) < 0.2 && Math.abs(r.placed[2] - 17.4) < 0.2, JSON.stringify([S['purge-yard'], r.placed]));
  for (const s of r.stages) expect(`stage ${s.id}: current, and only its group is awake (${s.want})`, s.cur === s.id && JSON.stringify(s.awake) === JSON.stringify(s.want), JSON.stringify(s));
  expect('  with the KR-7 owned the armoury (60) and the late armoury (95) pass silently', r.slot.includes(60) && r.slot.includes(95) && !r.armoury && r.beforeGate.cur === 'purge-gate' && !r.beforeGate.awake.length, JSON.stringify([r.slot, r.beforeGate]));
  expect('reaching the arena starts the boss cut', r.cut.cur === 'boss-cut' && r.cut.active && r.cut.id === 'boss-cut', JSON.stringify(r.cut));
  expect('  skipped, the cut ends as played: the SX-6 down at its landing spot and awake (purge-6 alone), the rush gone, the far gate shut, STEM-00 at cp-gate', r.boss.cur === 'purge-boss' && r.boss.awake.join() === 'purge-6' && !r.boss.leaping && Math.abs(r.boss.at[0] - 30.5) < 1 && Math.abs(r.boss.at[2] + 57) < 1 && r.boss.rush === 0 && r.boss.farClosed && r.boss.alarmTarget === 1 && Math.abs(r.boss.player[0] - 26.5) < 0.2 && Math.abs(r.boss.player[2] + 50) < 0.2, JSON.stringify(r.boss));
  expect('killing the spider ends the alarm and siren but not the mission (the exit is next); reaching the transit node completes it once, no failure', r.end.state === 'active' && r.end.cur === 'exit' && r.end.complete === 0 && r.done.state === 'complete' && r.done.complete === 1 && r.done.failed === 0 && r.end.failed === 0 && r.end.alarmTarget === 0 && !r.end.siren && r.after.level === 0 && r.after.fog === r.after.base && JSON.stringify(r.alarmEvents) === '[["on","purge-alarm",true],["off","purge-alarm"]]', JSON.stringify([r.end, r.done, r.after, r.alarmEvents]));
  expect('every objective became current exactly once, in chain order', r.objectives.join() === r.chain.slice(1).join(), r.objectives.join());
  expect('  checkpoints between the stages were reached: yard, hall, hall-east, gate', ['cp-yard', 'cp-hall', 'cp-hall-east', 'cp-gate'].every((c) => r.checkpoints.includes(c)), r.checkpoints.join());
  expect('  the announcer and the STEM-00 lines after the hall shooters and the troopers played; every STEM-00 line is at most 70 characters', r.lines.includes('CALIBRATION UNIT 00: NONCOMPLIANT. PURGE.') && r.lines.some((t) => t.startsWith('> TARGETS: ARMED')) && r.lines.some((t) => t.startsWith('> HOSTILES DESTROYED')) && r.lines.filter((t) => t.startsWith('> ')).every((t) => t.length <= 70), JSON.stringify(r.lines));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 2: kills out of order never soft-lock; pistol only, the armoury is asked for (and skipped), then the late step gives the KR-7 ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    // kill the hall shooters and troopers before the purge: shot while dormant, they stay asleep
    T.killGroup(2); T.killGroup(4);
    out.asleep = T.awake();
    T.advanceTo('purge-yard', { rifle: false });
    out.owned = [...g.weapon.owned].join();
    out.yard = { cur: T.cur(), awake: T.awake() };
    T.killGroup(1);
    T.step(0.2);
    // purge-hall had nothing alive: it passed at once; the armoury is next, skipped by walking on toward the arena
    out.armoury = T.cur();
    T.go(21.5, -52, 0.2);
    // the hall troopers were dead too: straight to the late armoury step, which waits for the KR-7 (never required to fight, but to leave)
    out.late = { cur: T.cur(), awake: T.awake(), owned: [...g.weapon.owned].join() };
    T.step(3);
    out.lateStill = T.cur();
    T.finish(); // G at the rack
    out.gate = { cur: T.cur(), owned: [...g.weapon.owned].join() };
    T.advanceTo('purge-boss');
    out.boss = { cur: T.cur(), awake: T.awake() };
    T.finish();
    out.preExit = g.mission.state;
    T.finish();
    out.end = { state: g.mission.state, failed: T.failed, alarm: g.world.alarm.target };
    out.objectives = [...T.objectives];
    return out;
  });
  expect('groups killed asleep stay asleep', JSON.stringify(r.asleep) === '[]', JSON.stringify(r.asleep));
  expect('pistol only past the range (the landing KR-7 left); yard stage: purge-1 awake alone', r.owned === 'pistol' && r.yard.cur === 'purge-yard' && r.yard.awake.join() === 'purge-1', JSON.stringify([r.owned, r.yard]));
  expect('hall shooters already dead: their stage passes at once; the armoury is current and walking on skips it', r.armoury === 'armoury', r.armoury);
  expect('hall troopers already dead: the chain stops at the late armoury step (no KR-7 yet) until G at the rack gives it', r.late.cur === 'armoury-late' && r.late.owned === 'pistol' && !r.late.awake.length && r.lateStill === 'armoury-late' && r.gate.cur === 'purge-gate' && r.gate.owned === 'pistol,rifle', JSON.stringify([r.late, r.lateStill, r.gate]));
  expect('the spider stage still works; the mission ends at the transit node', r.boss.cur === 'purge-boss' && r.boss.awake.join() === 'purge-6' && r.preExit === 'active' && r.end.state === 'complete' && r.end.failed === 0 && r.end.alarm === 0, JSON.stringify([r.boss, r.preExit, r.end]));
  expect('no objective skipped, none repeated', r.objectives.join() === CHAIN.split(',').slice(1).join(), r.objectives.join());
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 3: the supply corridor: its line, the ammo cabinet refills the owned guns, the repair station restores health and shields ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const { weapon, player } = g;
    const out = {};
    T.advanceTo('purge-hall', { rifle: true });
    let fired = false;
    g.engine.events.on('trigger:fired', (e) => (fired ||= e.id === 'supply-in'));
    T.go(-29.5, -17.45, 0.2); // the supply-in trigger at the corridor mouth
    out.fired = fired;
    weapon.state.rifle.reserve = 0;
    T.go(-23.4, -16.3, 0.2);
    out.prompt = g.pickups.supplyPrompt(player)?.label ?? null;
    T.press('KeyG');
    out.reserve = weapon.state.rifle.reserve;
    T.mortal = true;
    player.health = 40;
    player.shields = 0;
    T.go(-17, -16.3, 0.2);
    T.press('KeyG');
    out.repaired = { health: player.health, shields: player.shields, max: [player.t.maxHealth, player.t.maxShields] };
    T.mortal = false;
    out.cur = T.cur();
    // its line waits for calm: it plays once the building is clear (the hall shooters, then the troopers the chain wakes next)
    T.killGroup(2);
    T.step(0.2);
    T.killGroup(4);
    for (let i = 0; i < 60 && !g.log.entries.some((e) => e.text.startsWith('> SUPPLY POINT: STOCKED')); i++) T.step(1);
    out.line = g.log.entries.some((e) => e.text.startsWith('> SUPPLY POINT: STOCKED'));
    return out;
  });
  expect('the supply corridor: its trigger at the mouth, its STEM-00 line once calm, a prompt at the ammo cabinet', r.fired && r.line && !!r.prompt, JSON.stringify(r));
  expect('  G at the ammo cabinet refills the KR-7 reserve; G at the repair station restores health and shields; the stage is unchanged', r.reserve > 0 && r.repaired.health === r.repaired.max[0] && r.repaired.shields === r.repaired.max[1] && r.cur === 'purge-hall', JSON.stringify(r));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4: restart clears the alarm ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    T.advanceTo('purge-start');
    T.step(2.5);
    const on = g.world.alarm.level;
    g.loadScene('prologue');
    T.step(0.2);
    return { on, target: g.world.alarm.target, level: g.world.alarm.level, siren: g.audio.sirenWanted, cur: T.cur(), line: g.log.entries.length, cut: g.cinematic.cut };
  });
  expect('a scene reload ends the alarm and the cut and restarts the chain', r.on > 0.5 && r.target === 0 && r.level === 0 && !r.siren && r.cur === 'c1-move' && r.line === 0 && !r.cut, JSON.stringify(r));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall prologue purge checks passed');
