// STEM-00 log lines (#40): `log.line` pieces fire on start / trigger / objective / discovery, `once`, `delay`, the Log view's
// priority queue and entries, and validation. Built in the Workshop and played in place, headless stepping.
// Needs the dev server: `npm run dev`, then `node tests/log.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const url = new URL(BASE);
url.searchParams.set('scene', 'workshop');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.addInitScript(() => {
  // free-mouse mode (no real pointer lock), like the workshop and mission suites
  Element.prototype.requestPointerLock = function () {
    setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
    return Promise.reject(new DOMException('refused by the test', 'NotAllowedError'));
  };
});
await p.goto(url.href);
await p.waitForFunction(() => window.game?.engine);

const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };
const ev = (fn, arg) => p.evaluate(fn, arg);

await ev(() => {
  const g = window.game;
  const { engine } = g;
  engine.stop();
  engine.headless = true;
  const T = (window.T = {});
  T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) engine.step(1 / 60); };
  // a clean doc with `extra` top-level fields and the given pieces ([id, pos, params?, name?]), played in place
  T.play = (extra, pieces) => {
    const t = g.tool;
    if (t.playing) t.edit();
    const doc = { ...JSON.parse(JSON.stringify(t.doc)), pieces: [] };
    delete doc.loadout;
    t.load({ ...doc, ...extra });
    for (const [id, pos, params, name] of pieces) {
      const i = t.place(id, pos, params);
      if (name) t.setName(i, name);
    }
    t.play();
    g.player.pos.set(0, 0, 0);
    T.step(0.1);
  };
  T.texts = () => g.log.entries.map((e) => e.text);
  T.shown = () => g.log.line?.text ?? null;
});

// ---- 1. on: start, restart, once ----
{
  const r = await ev(() => {
    const g = window.game;
    T.play({}, [['log.line', [0, 0, 6], { text: '> LINK: NONE. QUERY: WHY?', on: 'start' }]]);
    const first = T.texts();
    T.step(2);
    const dom = document.getElementById('log').textContent;
    const opacity = Number(document.getElementById('log').style.opacity);
    T.step(6);
    const later = T.texts();
    const gone = document.getElementById('log').style.opacity;
    g.tool.restart();
    T.step(0.1);
    const restarted = T.texts();
    g.tool.edit();
    T.step(0.5);
    return { first, dom, opacity, later, gone, restarted, edit: T.texts(), editItems: g.encounter.items.filter((x) => x.kind === 'log').map((x) => !!x.gizmo && x.inert) };
  });
  expect('on: start shows once at play', r.first.join() === '> LINK: NONE. QUERY: WHY?' && r.dom === '> LINK: NONE. QUERY: WHY?' && r.opacity === 1, JSON.stringify(r));
  expect('  holds within the run, then fades', r.later.length === 1 && Number(r.gone) === 0, JSON.stringify(r));
  expect('  Workshop restart shows it again (fresh entries)', r.restarted.join() === '> LINK: NONE. QUERY: WHY?', JSON.stringify(r));
  expect('  edit mode: gizmo, inert, log cleared', r.edit.length === 0 && r.editItems.join() === 'true', JSON.stringify(r));
}

// ---- 2. trigger / once / objective done / delay ----
{
  const r = await ev(() => {
    const g = window.game;
    T.play({}, [
      ['trigger.volume', [10, 0, 0], { size: [2, 3, 2], event: 'gate', once: false }, 'gate'],
      ['log.line', [0, 0, 6], { text: 'ONCE', on: 'trigger:gate' }],
      ['log.line', [1, 0, 6], { text: 'EVERY', on: 'trigger:gate', once: false, priority: 'high' }],
      ['objective.reach', [20, 0, 0], { text: 'REACH', size: [2, 3, 2] }, 'yard'],
      ['log.line', [2, 0, 6], { text: 'YARD', on: 'objective:yard:done', priority: 'high' }],
      ['log.line', [3, 0, 6], { text: 'LATE', on: 'objective:yard:done', delay: 1, priority: 'high' }],
    ]);
    const enter = () => { g.player.pos.set(10, 0, 0); T.step(0.1); g.player.pos.set(0, 0, 0); T.step(0.1); };
    enter();
    enter();
    const triggers = T.texts();
    g.player.pos.set(20, 0, 0);
    T.step(0.5);
    const done = T.texts();
    T.step(0.8);
    return { triggers, done, delayed: T.texts(), shown: T.shown() };
  });
  expect('trigger:<id> fires its line; once holds, once: false repeats', r.triggers.filter((x) => x === 'ONCE').length === 1 && r.triggers.filter((x) => x === 'EVERY').length === 2, JSON.stringify(r));
  expect('objective:<id>:done fires its line', r.done.includes('YARD') && !r.done.includes('LATE'), JSON.stringify(r));
  expect('  delay waits its seconds', r.delayed.at(-1) === 'LATE' && r.shown === 'LATE', JSON.stringify(r));
}

// ---- 3. discovered:<gun> ----
{
  const r = await ev(() => {
    const g = window.game;
    T.play({ loadout: ['pistol'] }, [['pickup.gun', [3, 0, 0], { gun: 'rifle' }], ['log.line', [0, 0, 6], { text: '> ITEM: KR-7. FUNCTION: KILL.', on: 'discovered:rifle' }]]);
    const before = T.texts();
    g.player.pos.set(3, 0, 0);
    T.step(0.2);
    return { before, after: T.texts(), owned: [...g.weapon.owned] };
  });
  expect('discovered:rifle fires on a rifle pickup.gun with a pistol-only loadout', r.before.length === 0 && r.after.join() === '> ITEM: KR-7. FUNCTION: KILL.' && r.owned.includes('rifle'), JSON.stringify(r));
}

// ---- 3b. never in a fight: lines wait for calm ----
{
  const r = await ev(() => {
    const g = window.game;
    T.play({ loadout: ['pistol'] }, [
      ['enemy.trooper', [0, 0, -70], { group: 'squad' }],
      ['trigger.volume', [4, 0, 0], { size: [2, 3, 2] }, 'gate'],
      ['log.line', [0, 0, 6], { text: 'AFTER', on: 'trigger:gate' }],
      ['trigger.volume', [-4, 0, 0], { size: [2, 3, 2] }, 'shot'],
      ['log.line', [1, 0, 6], { text: 'QUIET', on: 'trigger:shot' }],
    ]);
    // a pistol shot (no enemy awake), then a line: it waits 3 s from the shot
    g.engine.input.keys.add('Mouse0');
    g.engine.input.pressed.add('Mouse0');
    T.step(1 / 60);
    g.engine.input.keys.delete('Mouse0');
    g.player.pos.set(-4, 0, 0);
    T.step(1.5);
    const afterShot = T.texts();
    T.step(2);
    const calmShot = T.texts();
    // an awake enemy in range holds a line; out of range, it plays 3 s later
    const asleep = !g.enemies.all[0].awake;
    g.encounter.wakeGroup('squad');
    g.enemies.freeze(true); // awake but not firing: the test is about distance, not about its shots
    g.player.pos.set(4, 0, 0);
    g.enemies.all[0].pos.set(0, 0, -12);
    T.step(4);
    const awake = T.texts();
    g.player.pos.set(80, 0, 0);
    T.step(2);
    const away2 = T.texts();
    T.step(1.5);
    g.enemies.freeze(false);
    return { asleep, afterShot, calmShot, awake, away2, away: T.texts() };
  });
  expect('a line waits 3 s after a shot', r.afterShot.length === 0 && r.calmShot.join() === 'QUIET', JSON.stringify(r));
  expect('  an awake enemy in range holds it; it plays 3 s after leaving combat', r.asleep && r.awake.join() === 'QUIET' && r.away2.join() === 'QUIET' && r.away.join() === 'QUIET,AFTER', JSON.stringify(r));
}

// ---- 4. priority queue ----
{
  const r = await ev(() => {
    const g = window.game;
    T.play({}, []);
    const log = g.log;
    log.say('A');
    log.say('B');
    log.say('C');
    const queued = [...log.queue];
    log.say('H', { priority: 'high' });
    const interrupted = T.shown();
    const order = [T.shown()];
    for (let i = 0; i < 40 && order.length < 3; i++) {
      T.step(0.5);
      if (T.shown() !== order.at(-1) && T.shown()) order.push(T.shown());
    }
    // backed-up queue: the oldest normal line is dropped, new ones kept
    log.say('X0', { priority: 'high' });
    for (let i = 1; i <= 6; i++) log.say(`X${i}`);
    g.engine.events.emit('log:say', { text: 'EV', priority: 'normal' });
    return { queued, interrupted, order, entries: T.texts(), t: log.entries.map((e) => e.t), queue: [...log.queue] };
  });
  expect('normal lines wait their turn', r.queued.join() === 'B,C', JSON.stringify(r));
  expect('  a high line interrupts the current one', r.interrupted === 'H', JSON.stringify(r));
  expect('  queued normals then play in order', r.order.join() === 'H,B,C', JSON.stringify(r));
  expect('  entries record every shown line with its time', r.entries.join() === 'A,H,B,C,X0' && r.t.every((t, i) => i === 0 || t >= r.t[i - 1]), JSON.stringify(r));
  expect('  a backed-up queue drops the oldest normal line', r.queue.join() === 'X4,X5,X6,EV', JSON.stringify(r));
}

// ---- 5. validation ----
{
  const r = await ev(() => {
    const g = window.game;
    const lvl = (params) => ({ name: 't', spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [{ id: 'log.line', pos: [0, 0, 0], params }] });
    const err = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    const check = (params) => err(() => g.registry.check(lvl(params)));
    return {
      on: check({ text: 'X', on: 'kill:boss' }),
      none: check({ text: 'X' }),
      gun: check({ text: 'X', on: 'discovered:laser' }),
      empty: check({ text: '  ', on: 'start' }),
      priority: check({ text: 'X', on: 'start', priority: 'urgent' }),
      ok: ['start', 'mission:complete', 'trigger:a', 'checkpoint:b', 'objective:c', 'objective:c:done', 'discovered:rifle'].map((on) => check({ text: 'X', on, priority: 'high', once: false, delay: 1 })),
      build: err(() => g.registry.build('encounter', g.encounter, lvl({ text: '', on: 'start' }).pieces[0])),
    };
  });
  expect('bad on value: clear error', /log\.line.*on "kill:boss" is not one of/.test(r.on) && /on undefined/.test(r.none) && /unknown gun/.test(r.gun), JSON.stringify(r));
  expect('empty text / bad priority: clear error', /text must be a non-empty string/.test(r.empty) && /priority/.test(r.priority) && /text/.test(r.build), JSON.stringify(r));
  expect('  every documented on form passes', r.ok.every((x) => x === null), JSON.stringify(r));
}

// ---- 6. announcer voice (HiveMind PA) and env.alarm ----
{
  const r = await ev(() => {
    const g = window.game;
    const log = g.log;
    const el = document.getElementById('log');
    const err = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    const lvl = (id, params) => ({ name: 't', spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [{ id, pos: [0, 0, 0], params }] });
    const check = (id, params) => err(() => g.registry.check(lvl(id, params)));
    const out = {};
    // an announcer line is not held back by a fight (an awake trooper in range, a shot just fired) and replaces the current line
    T.play({ loadout: ['pistol'] }, [
      ['enemy.trooper', [0, 0, -6], { group: 'sq' }],
      ['trigger.volume', [4, 0, 0], { size: [2, 3, 2] }, 'gate'],
      ['log.line', [0, 0, 6], { text: 'STEM', on: 'trigger:gate' }],
      ['log.line', [1, 0, 6], { text: 'PA', on: 'trigger:gate', voice: 'announcer' }],
    ]);
    g.encounter.wakeGroup('sq');
    g.player.pos.set(4, 0, 0);
    T.step(0.3);
    out.fight = { texts: T.texts(), cls: el.classList.contains('announcer'), entries: log.entries.map((e) => e.voice ?? 'stem') };
    // restart clears the styling
    g.tool.restart();
    T.step(0.1);
    out.restart = { cls: el.classList.contains('announcer'), voice: log.voice };
    // validation
    out.badVoice = check('log.line', { text: 'X', on: 'start', voice: 'god' });
    out.okVoice = ['stem', 'announcer'].map((v) => check('log.line', { text: 'X', on: 'start', voice: v }));
    out.alarmOk = check('env.alarm', { on: 'start', off: 'mission:complete', duration: 5, color: '#ff0000', strength: 0.5, siren: false });
    out.alarmBad = {
      none: check('env.alarm', {}),
      on: check('env.alarm', { on: 'boom' }),
      off: check('env.alarm', { on: 'start', off: 'boom' }),
      duration: check('env.alarm', { on: 'start', duration: 0 }),
      color: check('env.alarm', { on: 'start', color: 'red' }),
      strength: check('env.alarm', { on: 'start', strength: 2 }),
      siren: check('env.alarm', { on: 'start', siren: 1 }),
      gun: check('env.alarm', { on: 'discovered:laser' }),
      build: err(() => g.registry.build('encounter', g.encounter, { id: 'env.alarm', pos: [0, 0, 0], params: { on: 'x' } })),
    };
    // alarm: on a trigger, off by duration / by an off event; two alarms keep the light until both end; unload clears
    const ev = [];
    g.engine.events.on('alarm:on', (e) => ev.push('on:' + e.id));
    g.engine.events.on('alarm:off', (e) => ev.push('off:' + e.id + ':' + e.active));
    T.play({}, [
      ['trigger.volume', [4, 0, 0], { size: [2, 3, 2] }, 'gate'],
      ['trigger.volume', [-4, 0, 0], { size: [2, 3, 2] }, 'stop'],
      ['env.alarm', [0, 0, 6], { on: 'trigger:gate', off: 'trigger:stop' }, 'A'],
      ['env.alarm', [1, 0, 6], { on: 'trigger:gate', duration: 2, siren: false }, 'B'],
    ]);
    const w = g.world;
    out.idle = { target: w.alarm.target, siren: g.audio.sirenWanted };
    g.player.pos.set(4, 0, 0);
    T.step(0.2);
    out.on = { target: w.alarm.target, siren: g.audio.sirenWanted, ev: [...ev] };
    T.step(2.5);
    out.afterB = { target: w.alarm.target, level: w.alarm.level, ev: [...ev], siren: g.audio.sirenWanted };
    g.player.pos.set(-4, 0, 0);
    T.step(0.2);
    out.afterA = { target: w.alarm.target, siren: g.audio.sirenWanted, ev: [...ev] };
    T.step(2);
    out.faded = { level: w.alarm.level, fog: w.scene.fog.color.getHexString() };
    // edit mode: gizmo, inert (nothing fires on a trigger event); unload while running clears
    g.player.pos.set(4, 0, 0);
    g.tool.restart();
    g.player.pos.set(4, 0, 0);
    T.step(0.5);
    out.running = w.alarm.target;
    g.tool.edit();
    T.step(0.3);
    out.edit = { target: w.alarm.target, siren: g.audio.sirenWanted, items: g.encounter.items.filter((x) => x.kind === 'alarm').map((x) => !!x.gizmo && x.inert) };
    return out;
  });
  expect('announcer line: shown in a fight at once, in its own style, entries carry the voice', r.fight.texts.join() === 'PA' && r.fight.cls && r.fight.entries.join() === 'announcer', JSON.stringify(r.fight));
  expect('  a restart drops the announcer style', !r.restart.cls && r.restart.voice === 'stem', JSON.stringify(r.restart));
  expect('  voice validation: stem / announcer pass, anything else errors', /voice must be one of stem, announcer/.test(r.badVoice) && r.okVoice.every((x) => x === null), JSON.stringify([r.badVoice, r.okVoice]));
  expect('env.alarm validation: every param, with a clear error', r.alarmOk === null && /env\.alarm.*on undefined is not one of/.test(r.alarmBad.none) && /on "boom"/.test(r.alarmBad.on) && /off "boom"/.test(r.alarmBad.off) && /duration/.test(r.alarmBad.duration) && /color/.test(r.alarmBad.color) && /strength/.test(r.alarmBad.strength) && /siren/.test(r.alarmBad.siren) && /unknown gun/.test(r.alarmBad.gun) && /env\.alarm: on "x"/.test(r.alarmBad.build), JSON.stringify(r.alarmBad));
  expect('env.alarm: idle until its event; then lighting target + siren + one alarm:on per alarm', r.idle.target === 0 && !r.idle.siren && r.on.target === 1 && r.on.siren && r.on.ev.join() === 'on:A,on:B', JSON.stringify([r.idle, r.on]));
  expect('  `duration` ends its alarm, the light holds while another runs', r.afterB.target === 1 && r.afterB.level === 1 && r.afterB.siren && r.afterB.ev.at(-1) === 'off:B:1', JSON.stringify(r.afterB));
  expect('  `off` ends the last one: target 0, siren off, light fades back to the normal fog', r.afterA.target === 0 && !r.afterA.siren && r.afterA.ev.at(-1) === 'off:A:0' && r.faded.level === 0 && r.faded.fog === '4f7b7e', JSON.stringify([r.afterA, r.faded]));
  expect('  a Workshop edit (unload) clears a running alarm; the pieces are inert gizmos in edit mode', r.running === 1 && r.edit.target === 0 && !r.edit.siren && r.edit.items.length === 2 && r.edit.items.every(Boolean), JSON.stringify([r.running, r.edit]));
}

expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
process.exit(fail.length ? 1 : 0);
