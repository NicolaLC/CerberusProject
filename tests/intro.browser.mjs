// Boot intro (#13): the `intro.boot` piece, the Boot view (view/boot.js), the input lock, `intro:done`, skip (only once seen),
// pause, restart / edit, `log.line` on intro:done, and validation. Built in the Workshop and played in place, headless stepping.
// Needs the dev server: `npm run dev`, then `node tests/intro.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const url = new URL(BASE);
url.searchParams.set('scene', 'workshop');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.addInitScript(() => {
  // free-mouse mode (no real pointer lock), like the other Workshop suites
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
  T.done = [];
  T.shots = 0;
  engine.events.on('intro:done', (e) => T.done.push({ ...e, t: engine.time }));
  engine.events.on('weapon:shot', () => T.shots++);
  T.seen = (v) => { try { v === undefined ? localStorage.removeItem('cerberus.introSeen') : localStorage.setItem('cerberus.introSeen', JSON.stringify(v)); } catch {} };
  T.flag = () => localStorage.getItem('cerberus.introSeen');
  // a clean doc with the pieces ([id, pos, params?, name?]), played in place; the intro starts on the first update
  T.play = (pieces) => {
    const t = g.tool;
    if (t.playing) t.edit();
    const doc = { ...JSON.parse(JSON.stringify(t.doc)), pieces: [] };
    delete doc.loadout;
    t.load(doc);
    for (const [id, pos, params, name] of pieces) {
      const i = t.place(id, pos, params);
      if (name) t.setName(i, name);
    }
    T.done.length = 0;
    t.play();
    g.player.pos.set(0, 0, 0);
    T.step(1 / 60);
  };
  T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
  T.texts = () => g.log.entries.map((e) => e.text);
  T.boot = () => ({ active: g.boot.active, t: g.boot.t, locked: g.boot.inputLocked, canSkip: g.boot.canSkip, seen: g.boot.seen });
  T.intro = (params, extra = []) => T.play([['intro.boot', [0, 0, 6], params], ['log.line', [1, 0, 6], { text: '> OPTICS: ONLINE. QUERY: WHY?', on: 'intro:done' }], ...extra]);
});

const LINES = ['> STEM-00 BOOT SEQUENCE', '> POWER: 87%', 'HIVEMIND LINK: LOST', '> OPTICS: ONLINE'];

// ---- 1. at start: overlay, locked, typed lines, HIVEMIND flicker, no skip hint (not seen yet) ----
{
  const r = await ev((LINES) => {
    const g = window.game;
    T.seen();
    T.intro({ lines: LINES, duration: 6 });
    const start = T.boot();
    const shown = !document.getElementById('boot').hidden;
    T.step(0.3);
    const early = document.getElementById('boot').textContent;
    T.step(4);
    const row = document.getElementById('boot').textContent;
    const hive = [...document.querySelectorAll('#boot .hive')].map((e) => e.textContent);
    const color = getComputedStyle(document.querySelector('#boot .lines')).color;
    const hiveColor = hive.length ? getComputedStyle(document.querySelector('#boot .hive')).color : null;
    const skipHidden = document.querySelector('#boot .skip').hidden;
    const log = T.texts();
    const lockedFlag = g.controls.locked;
    return { start, shown, early, row, hive, color, hiveColor, skipHidden, log, lockedFlag, boot: T.boot(), done: T.done.length };
  }, LINES);
  expect('intro.boot: overlay active and input locked at play start', r.start.active && r.start.locked && r.shown && r.lockedFlag && r.start.t > 0, JSON.stringify(r));
  expect('  lines are typed in over time (not all at once)', r.early.length < r.row.length && r.row.includes('> STEM-00 BOOT SEQUENCE') && r.row.includes('> POWER: 87%'), JSON.stringify(r));
  expect('  HIVEMIND LINK: LOST is a flickering violet-magenta span; text is cold white', r.hive.join() === 'HIVEMIND LINK: LOST' && r.hiveColor === 'rgb(192, 75, 255)' && r.color === 'rgb(234, 246, 250)', JSON.stringify(r));
  expect('  no skip hint before the intro was seen once', r.skipHidden && !r.boot.canSkip && !r.boot.seen, JSON.stringify(r));
  expect('  the log line on intro:done waits for the intro', r.log.length === 0 && r.done === 0 && r.boot.active, JSON.stringify(r));
}

// ---- 2. input is locked: no movement, no shot, no look, no weapon switch, no jump ----
{
  const r = await ev(() => {
    const g = window.game;
    T.intro({ lines: ['> A', '> B'], duration: 5 });
    const { engine } = g;
    const p0 = g.player.pos.clone();
    const yaw0 = g.camRig.yaw;
    const gun0 = g.weapon.current;
    engine.input.keys.add('KeyW');
    engine.input.keys.add('ShiftLeft');
    engine.input.dx = 300;
    T.step(1);
    engine.input.keys.delete('KeyW');
    engine.input.keys.delete('ShiftLeft');
    T.press('Mouse0');
    T.press('Space');
    T.press('KeyR');
    T.press('Digit6');
    T.press('KeyG');
    const moved = g.player.pos.distanceTo(p0);
    return { moved, yaw: g.camRig.yaw - yaw0, shots: T.shots, gunSame: g.weapon.current === gun0, airborne: g.player.airborne, still: T.boot() };
  });
  expect('input lock: W + sprint, mouse look, fire, jump, reload, weapon switch, interact do nothing', r.moved < 0.01 && Math.abs(r.yaw) < 1e-6 && r.shots === 0 && r.gunSame && !r.airborne && r.still.active, JSON.stringify(r));
}

// ---- 3. a run to the end: intro:done within the duration, control comes back smoothly, the log line follows ----
{
  const r = await ev(() => {
    const g = window.game;
    T.seen();
    T.intro({ lines: ['> A', 'HIVEMIND LINK: LOST'], duration: 4 });
    const t0 = g.engine.time;
    T.step(3.9);
    const before = { active: g.boot.active, done: T.done.length, log: T.texts().length };
    const fadeMid = Number(document.getElementById('boot').style.opacity);
    T.step(0.2);
    const end = { active: g.boot.active, done: T.done.slice(), flag: T.flag(), locked: g.controls.locked, boost: g.post.boost, hidden: document.getElementById('boot').hidden };
    const doneAt = (T.done[0]?.t ?? 0) - t0;
    // smooth return: the first frames after the end are eased, later ones are full speed
    const p0 = g.player.pos.clone();
    g.engine.input.keys.add('KeyW');
    T.step(1 / 60);
    const easeFirst = g.controls.ease;
    const stepFirst = g.player.pos.distanceTo(p0);
    T.step(1.5);
    const easeLater = g.controls.ease;
    const moved = g.player.pos.distanceTo(p0);
    g.engine.input.keys.delete('KeyW');
    T.step(0.2);
    return { before, fadeMid, end, doneAt, easeFirst, stepFirst, easeLater, moved, log: T.texts(), logT: g.log.entries.map((e) => e.t) };
  });
  expect('intro:done fires once, within the duration (4 s), and the overlay is gone', r.before.active && r.before.done === 0 && !r.end.active && r.end.done.length === 1 && r.end.done[0].skipped === false && r.doneAt > 3.8 && r.doneAt <= 4.05 && r.end.hidden && !r.end.locked, JSON.stringify(r));
  expect('  the view fades in (overlay translucent before the end) and exposure is back to 1', r.fadeMid < 1 && r.end.boost === 1, JSON.stringify(r));
  expect('  completing sets the seen flag', r.end.flag === 'true', JSON.stringify(r));
  expect('  movement works after: eased in, then full speed', r.easeFirst < 0.2 && r.easeLater === 1 && r.moved > 2, JSON.stringify(r));
  expect('  the log line on intro:done appears after the intro, not before', r.before.log === 0 && r.log.join() === '> OPTICS: ONLINE. QUERY: WHY?' && r.logT[0] >= 3.9, JSON.stringify(r));
}

// ---- 4. pacing: every line is typed before the fade starts, whatever the length ----
{
  const r = await ev(() => {
    const lines = Array.from({ length: 8 }, (_, i) => `> DIAGNOSTIC ${i}: SUBSYSTEM CHECK ${'X'.repeat(30)} OK`);
    T.intro({ lines, duration: 5 });
    T.step(5 * 0.6);
    const mid = document.getElementById('boot').textContent;
    T.step(1.0);
    const text = document.getElementById('boot').textContent;
    return { all: lines.every((l) => text.includes(l)), midTyped: lines.filter((l) => mid.includes(l)).length, active: window.game.boot.active };
  });
  expect('pacing: all lines typed before the fade at a short duration; typing is gradual', r.all && r.midTyped < 8 && r.midTyped > 0 && r.active, JSON.stringify(r));
}

// ---- 5. skip: only offered and only working once the intro was seen ----
{
  const r = await ev(() => {
    const g = window.game;
    const out = {};
    // not seen: every skip input is ignored
    T.seen();
    T.intro({ lines: ['> A'], duration: 8 });
    T.step(1);
    for (const c of ['Mouse0', 'Space', 'KeyG', 'Pad0']) T.press(c);
    out.unseen = T.boot();
    out.unseenDone = T.done.length;
    // seen: hint shown, each input skips
    T.seen(true);
    for (const c of ['Mouse0', 'KeyF', 'Space', 'KeyG', 'Pad0']) {
      T.intro({ lines: ['> A'], duration: 8 });
      const hint = !document.querySelector('#boot .skip').hidden;
      T.press(c); // too early: the click that starts a run is not a skip
      const early = g.boot.active;
      T.step(0.5);
      const t = g.boot.t;
      T.press(c);
      out[c] = { hint, early, ended: !g.boot.active, done: T.done.map((d) => d.skipped), t, unlocked: !g.controls.locked };
      T.step(0.1);
    }
    // seen but not skippable: no hint, no skip
    T.intro({ lines: ['> A'], duration: 8, skippable: false });
    const hidden = document.querySelector('#boot .skip').hidden;
    T.step(1);
    T.press('Mouse0');
    out.fixed = { hidden, active: g.boot.active, canSkip: g.boot.canSkip };
    // storage that throws: the intro still plays, ends, nothing breaks
    const proto = Object.getPrototypeOf(localStorage);
    const get = proto.getItem, set = proto.setItem;
    proto.getItem = proto.setItem = () => { throw new Error('blocked'); };
    try {
      T.intro({ lines: ['> A'], duration: 2 });
      out.blocked = { active: g.boot.active, hint: g.boot.canSkip };
      T.step(2.1);
      out.blocked.ended = !g.boot.active && T.done.length === 1;
    } finally {
      proto.getItem = get;
      proto.setItem = set;
    }
    return out;
  });
  expect('skip ignored (all inputs) while the intro has not been seen', r.unseen.active && r.unseenDone === 0, JSON.stringify(r));
  const codes = ['Mouse0', 'KeyF', 'Space', 'KeyG', 'Pad0'];
  expect('  seen: hint shown; fire, jump, interact and pad A each skip (after 0.3 s)', codes.every((c) => r[c].hint && r[c].early && r[c].ended && r[c].done.join() === 'true' && r[c].unlocked && r[c].t > 0.3), JSON.stringify(r));
  expect('  skippable: false: no hint, no skip even when seen', r.fixed.hidden && r.fixed.active && !r.fixed.canSkip, JSON.stringify(r));
  expect('  blocked storage: plays, not skippable, ends, no error', r.blocked.active && !r.blocked.hint && r.blocked.ended, JSON.stringify(r));
}

// ---- 6. pause freezes it (scaled time) ----
{
  const r = await ev(() => {
    const g = window.game;
    T.seen();
    T.intro({ lines: ['> A'], duration: 4 });
    T.step(1);
    const t1 = g.boot.t;
    g.engine.paused = true;
    T.step(5);
    const frozen = g.boot.t;
    const still = g.boot.active && T.done.length === 0;
    g.engine.paused = false;
    T.step(1);
    const after = g.boot.t;
    T.step(3);
    return { t1, frozen, still, after, ended: !g.boot.active && T.done.length === 1 };
  });
  expect('pause freezes the intro timer; it continues and ends after resume', Math.abs(r.frozen - r.t1) < 1e-9 && r.still && Math.abs(r.after - r.t1 - 1) < 0.05 && r.ended, JSON.stringify(r));
}

// ---- 7. restart replays; edit mode clears; gizmo + inert; scene load clears ----
{
  const r = await ev(() => {
    const g = window.game;
    T.seen();
    T.intro({ lines: ['> A'], duration: 3 });
    T.step(3.2);
    const first = T.done.length;
    g.tool.restart();
    T.step(0.1);
    const replay = T.boot();
    T.step(3.2);
    const second = T.done.length;
    g.tool.restart();
    T.step(0.5);
    g.tool.edit();
    T.step(1);
    const edit = { active: g.boot.active, locked: g.controls.locked, ease: g.controls.ease, hidden: document.getElementById('boot').hidden, boost: g.post.boost, items: g.encounter.items.filter((x) => x.kind === 'intro').map((x) => !!x.gizmo && x.inert), done: T.done.length };
    // a scene load clears a running intro
    T.intro({ lines: ['> A'], duration: 10 });
    T.step(0.5);
    g.tool.edit();
    g.loadScene('arena');
    T.step(0.1);
    const arena = { active: g.boot.active, locked: g.controls.locked, hidden: document.getElementById('boot').hidden };
    g.loadScene('workshop');
    return { first, replay, second, edit, arena };
  });
  expect('Workshop restart replays the intro (a second intro:done)', r.first === 1 && r.replay.active && r.second === 2, JSON.stringify(r));
  expect('  edit mode: gizmo, inert, no overlay, input free', r.edit.items.join() === 'true' && !r.edit.active && !r.edit.locked && r.edit.ease === 1 && r.edit.hidden && r.edit.boost === 1 && r.edit.done === 2, JSON.stringify(r));
  expect('  a scene load clears a running intro without intro:done', !r.arena.active && !r.arena.locked && r.arena.hidden, JSON.stringify(r));
}

// ---- 8. validation ----
{
  const r = await ev(() => {
    const g = window.game;
    const lvl = (id, params) => ({ name: 't', spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [{ id, pos: [0, 0, 0], params }] });
    const err = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    const check = (params, id = 'intro.boot') => err(() => g.registry.check(lvl(id, params)));
    const L = ['> A'];
    return {
      none: check({}),
      empty: check({ lines: [] }),
      blank: check({ lines: ['> A', '  '] }),
      nonString: check({ lines: ['> A', 3] }),
      notList: check({ lines: '> A' }),
      zero: check({ lines: L, duration: 0 }),
      big: check({ lines: L, duration: 20.5 }),
      str: check({ lines: L, duration: '5' }),
      skip: check({ lines: L, skippable: 'yes' }),
      ok: [check({ lines: L }), check({ lines: L, duration: 20, skippable: false }), check({ lines: L, duration: 0.5, skippable: true })],
      on: check({ text: 'X', on: 'intro:done' }, 'log.line'),
      build: err(() => g.registry.build('encounter', g.encounter, lvl('intro.boot', { lines: [] }).pieces[0])),
      fields: g.registry.meta('intro.boot').fields.map((f) => f.key),
    };
  });
  expect('validation: lines must be a non-empty list of non-empty strings', [r.none, r.empty, r.blank, r.nonString, r.notList].every((m) => /intro\.boot.*lines must be a non-empty list of non-empty strings/.test(m ?? '')), JSON.stringify(r));
  expect('  duration in (0, 20], skippable boolean', /duration/.test(r.zero ?? '') && /duration/.test(r.big ?? '') && /duration/.test(r.str ?? '') && /skippable/.test(r.skip ?? ''), JSON.stringify(r));
  expect('  valid params pass; log.line accepts on: intro:done; the builder throws; Workshop fields', r.ok.every((x) => x === null) && r.on === null && /lines/.test(r.build ?? '') && r.fields.join() === 'lines,duration,skippable', JSON.stringify(r));
}

expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
process.exit(fail.length ? 1 : 0);
