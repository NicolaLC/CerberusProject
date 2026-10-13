// Mission framework (#12): `objective.*` encounter pieces, the Mission system (order, destroy / reach / survive / interact,
// limit, actions), the HUD state line, restart / edit / scene switch, and parameter errors.
// Needs the dev server: `bun run dev`, then `node tests/mission.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const url = new URL(BASE);
url.searchParams.set('scene', 'workshop');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
// same as the workshop suite: no real pointer lock (free-mouse mode), so play works deterministically in headless Chromium
await p.addInitScript(() => {
  Element.prototype.requestPointerLock = function () {
    setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
    return Promise.reject(new DOMException('refused by the test', 'NotAllowedError'));
  };
});
await p.goto(url.href);
await p.waitForFunction(() => window.game?.engine);

const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

await p.evaluate(() => {
  const g = window.game;
  const { engine } = g;
  engine.stop();
  engine.headless = true;
  const T = (window.T = {});
  T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) engine.step(1 / 60); };
  T.tool = () => g.tool;
  // a clean doc with the given pieces: [id, pos, params?, name?]
  T.setup = (pieces) => {
    const t = g.tool;
    if (t.playing) t.edit();
    t.load({ ...JSON.parse(JSON.stringify(t.doc)), pieces: [] });
    for (const [id, pos, params, name] of pieces) {
      const i = t.place(id, pos, params);
      if (name) t.setName(i, name);
    }
    T.step(0.1);
    return t;
  };
  T.hud = () => { const el = document.getElementById('objective'); return { text: el.textContent, shown: el.style.display === 'block' }; };
  T.kill = (e) => { for (let i = 0; i < 80 && e.alive; i++) e.damage(100, e.pos.clone().setY(1), new e.pos.constructor(0, 0, -1), 'body'); };
  T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 30); engine.input.keys.delete(code); };
  T.at = (x, y, z) => g.player.pos.set(x, y, z);
  // every mission event, in order
  window.EV = [];
  for (const n of ['mission:objective', 'mission:objective:done', 'mission:complete', 'mission:failed', 'encounter:wake', 'encounter:spawn', 'group:spawn']) {
    engine.events.on(n, (e) => window.EV.push({ n, id: e?.id, index: e?.index, kind: e?.kind, total: e?.total, text: e?.text, reason: e?.reason, count: e?.count }));
  }
  T.names = () => window.EV.map((e) => e.n);
  T.count = (n) => window.EV.filter((e) => e.n === n).length;
  T.step(2);
});
const ev = (fn, arg) => p.evaluate(fn, arg);

// ---- 1. pieces: one of each, gizmos in edit mode, no mission while editing ----
{
  const r = await ev(() => {
    const t = T.setup([]);
    const g = window.game;
    const ids = ['objective.reach', 'objective.destroy', 'objective.survive', 'objective.interact'];
    const out = { ids: [], reg: ids.map((id) => g.registry.owner(id)), buttons: ids.map((id) => !!document.querySelector(`#workshop-palette button[data-id="${id}"]`)) };
    ids.forEach((id, k) => {
      const i = t.place(id, [k * 6, 0, 0]);
      out.ids.push({ id, gizmo: !!t.items[i].thing.gizmo?.parent, inert: t.items[i].thing.inert, text: t.doc.pieces[i].params.text, obj: t.items[i].thing.obj });
    });
    T.step(0.3);
    out.verify = t.verify();
    out.state = g.mission.state;
    out.hud = T.hud();
    const before = JSON.stringify(t.doc);
    for (let k = 0; k < 4; k++) t.undo();
    const empty = t.count;
    for (let k = 0; k < 4; k++) t.redo();
    out.undo = { empty, same: JSON.stringify(t.doc) === before, verify: t.verify().ok };
    out.kinds = t.doc.pieces.map((q) => q.params.text);
    return out;
  });
  expect('four objective ids: owner encounter, palette buttons', r.reg.every((o) => o === 'encounter') && r.buttons.every(Boolean), JSON.stringify(r));
  expect('  each places with a gizmo (inert record) and its default text', r.ids.every((x) => x.gizmo && x.inert) && r.kinds.join('|') === 'REACH THE ZONE|DESTROY THE TARGETS|SURVIVE|ACCESS THE TERMINAL', JSON.stringify(r.ids));
  expect('  scene = doc, mission state none and HUD line hidden while editing', r.verify.ok && r.state === 'none' && !r.hud.shown, JSON.stringify({ v: r.verify, s: r.state, h: r.hud }));
  expect('  undo / redo identity', r.undo.empty === 0 && r.undo.same && r.undo.verify, JSON.stringify(r.undo));
}

// ---- 2. one full mission in play: reach -> destroy -> survive -> interact ----
{
  const r = await ev(() => {
    const t = T.setup([
      ['objective.reach', [10, 0, 10], { text: 'REACH THE GATE', size: [4, 3, 4] }],
      ['objective.destroy', [0, 0, 0], { group: 'targets' }],
      ['objective.survive', [0, 0, 0], { time: 2 }],
      ['objective.interact', [20, 0, -10], { radius: 2 }],
      ['enemy.static', [-10, 0, 10], { group: 'targets' }],
      ['enemy.static', [-12, 0, 10], { group: 'targets' }],
    ]);
    const g = window.game;
    const m = g.mission;
    window.EV.length = 0;
    const out = { steps: [] };
    const snap = (label) => out.steps.push({ label, ...T.hud(), state: m.state, index: m.index });
    t.play();
    T.step(0.3);
    out.playing = t.playing;
    snap('start');
    T.at(0, 0, 30); T.step(0.3); snap('outside the box');
    T.at(10, 0, 10); T.step(0.2); snap('in the box');
    const targets = g.enemies.all.filter((e) => e.squad === 'targets');
    out.targets = targets.length;
    T.kill(targets[0]); T.step(0.1); snap('one down');
    T.kill(targets[1]); T.step(0.1); snap('both down');
    T.step(0.8); snap('survive 1 s in');
    T.step(1.4); snap('survive done');
    T.at(0, 0, 0); T.press('KeyG'); T.step(0.1); snap('G far away');
    T.at(20, 0, -10); T.step(0.3); snap('near, no press');
    T.press('KeyG'); T.step(0.1); snap('G near');
    out.names = T.names();
    out.ids = window.EV.filter((e) => e.n === 'mission:objective').map((e) => `${e.index}/${e.total} ${e.kind} ${e.text}`);
    out.done = window.EV.filter((e) => e.n === 'mission:objective:done').map((e) => e.kind);
    out.after = { state: m.state, current: m.current, complete: T.count('mission:complete') };
    T.step(1);
    out.final = { ...T.hud(), complete: T.count('mission:complete') };
    return out;
  });
  const S = Object.fromEntries(r.steps.map((s) => [s.label, s]));
  expect('play: mission starts on the first objective, HUD shows its text', r.playing && S.start.state === 'active' && S.start.index === 0 && S.start.text === 'REACH THE GATE' && S.start.shown, JSON.stringify(S.start));
  expect('  reach: outside the box nothing happens, inside completes it', S['outside the box'].index === 0 && S['in the box'].index === 1 && S['in the box'].text === 'DESTROY THE TARGETS  0 / 2', JSON.stringify([S['outside the box'], S['in the box']]));
  expect('  destroy: counts kills of its group (1 / 2, then done)', r.targets === 2 && S['one down'].text === 'DESTROY THE TARGETS  1 / 2' && S['both down'].index === 2 && /^SURVIVE  0:0[12]$/.test(S['both down'].text), JSON.stringify([S['one down'], S['both down']]));
  expect('  survive: counts down, completes after its time', /^SURVIVE  0:0[12]$/.test(S['survive 1 s in'].text) && S['survive done'].index === 3 && S['survive done'].text === 'ACCESS THE TERMINAL', JSON.stringify([S['survive 1 s in'], S['survive done']]));
  expect('  interact: needs range and the key', S['G far away'].index === 3 && S['near, no press'].index === 3 && S['G near'].state === 'complete', JSON.stringify([S['G far away'], S['near, no press'], S['G near']]));
  expect('  HUD reads MISSION COMPLETE at the end', S['G near'].text === 'MISSION COMPLETE' && r.final.text === 'MISSION COMPLETE' && r.final.shown, JSON.stringify(r.final));
  expect('  events: 4 objective, 4 done (in order), complete once', r.ids.length === 4 && r.ids[0] === '0/4 reach REACH THE GATE' && r.done.join() === 'reach,destroy,survive,interact' && r.final.complete === 1 && r.after.current === null, JSON.stringify({ ids: r.ids, done: r.done, after: r.after }));
}

// ---- 3a. order ----
{
  const r = await ev(() => {
    const t = T.setup([
      ['objective.survive', [0, 0, 0], { text: 'LATER', time: 1, order: 5 }],
      ['objective.reach', [10, 0, 10], { text: 'FIRST', order: 1 }],
      ['objective.reach', [30, 0, 10], { text: 'TIE A' }], // no order: its file index (2)
    ]);
    const m = window.game.mission;
    t.play(); T.step(0.2);
    const order = m.objectives.map((o) => o.text);
    const first = T.hud().text;
    T.at(10, 0, 10); T.step(0.2);
    const second = T.hud().text;
    return { order, first, second, ids: m.objectives.map((o) => o.oid) };
  });
  expect('order: sorted by order, absent = file index (FIRST 1, TIE A 2, LATER 5)', r.order.join() === 'FIRST,TIE A,LATER' && r.first === 'FIRST' && r.second === 'TIE A', JSON.stringify(r));
  expect('  mission id = piece name, else objective<n> (n = file index), in mission order', r.ids.join() === 'objective1,objective2,objective0', JSON.stringify(r.ids));
}

// ---- 3b. destroy: spawnGroup reinforcements add to the target; nothing to destroy completes at once ----
{
  const r = await ev(() => {
    const g = window.game;
    const m = g.mission;
    const t = T.setup([
      ['marker.entry', [0, 0, -10], { group: 'reinf', enemies: ['enemy.static', 'enemy.static', 'enemy.static'] }],
      ['objective.destroy', [0, 0, 0], { group: 'reinf', spawnGroup: 'reinf' }, 'hold'],
    ]);
    window.EV.length = 0;
    t.play(); T.step(0.2);
    const out = { target: m.target, hud: T.hud().text, spawned: window.EV.filter((e) => e.n === 'group:spawn').map((e) => e.count), order: T.names().join() };
    const squad = g.enemies.all.filter((e) => e.squad === 'reinf');
    out.squad = squad.length;
    T.kill(squad[0]); T.kill(squad[1]); T.step(0.1);
    out.mid = { state: m.state, hud: T.hud().text };
    T.kill(squad[2]); T.step(0.1);
    out.end = { state: m.state, hud: T.hud().text };
    // nothing alive in the group: done at once
    T.setup([['objective.destroy', [0, 0, 0], { group: 'nobody' }]]);
    window.EV.length = 0;
    window.game.tool.play(); T.step(0.2);
    out.none = { state: m.state, names: T.names().join(), hud: T.hud().text };
    return out;
  });
  expect('destroy without count: reinforcements from spawnGroup add to the target (0 -> 3)', r.target === 3 && r.hud === 'DESTROY THE TARGETS  0 / 3' && r.squad === 3 && r.spawned.join() === '3', JSON.stringify(r));
  expect('  actions run before mission:objective is announced; 2 of 3 is not done, 3 of 3 completes', r.order.startsWith('group:spawn,encounter:spawn,mission:objective') && r.mid.state === 'active' && r.mid.hud === 'DESTROY THE TARGETS  2 / 3' && r.end.state === 'complete', JSON.stringify(r));
  expect('  zero targets: completes at once (objective, done, complete)', r.none.state === 'complete' && r.none.names === 'mission:objective,mission:objective:done,mission:complete' && r.none.hud === 'MISSION COMPLETE', JSON.stringify(r.none));
}

// ---- 3c. reach with a trigger id (trigger.volume or checkpoint) ----
{
  const r = await ev(() => {
    const m = window.game.mission;
    const t = T.setup([
      ['objective.reach', [-20, 0, -20], { trigger: 'gate' }],
      ['objective.reach', [-30, 0, -20], { trigger: 'cp' }],
      ['trigger.volume', [15, 0, 15], { size: [4, 3, 4] }, 'gate'],
      ['marker.checkpoint', [15, 0, -15], {}, 'cp'],
    ]);
    t.play(); T.step(0.2);
    T.at(-20, 0, -20); T.step(0.3);
    const inBox = m.index; // inside the reach box: not tested when a trigger is set
    T.at(15, 0, 15); T.step(0.3);
    const afterTrigger = m.index;
    T.at(15, 0, -15); T.step(0.3);
    return { inBox, afterTrigger, state: m.state, hud: T.hud().text };
  });
  expect('reach with trigger: the box is not tested, trigger:fired completes it, checkpoint:reached completes the next', r.inBox === 0 && r.afterTrigger === 1 && r.state === 'complete' && r.hud === 'MISSION COMPLETE', JSON.stringify(r));
}

// ---- 3d. gun conditions: requiresGun holds an objective until the gun is owned, skipIfOwned drops a "find it" step ----
{
  const r = await ev(() => {
    const g = window.game;
    const m = g.mission;
    const out = {};
    const skips = [];
    const off = g.engine.events.on('mission:objective:done', (e) => skips.push(`${e.id}${e.skipped ? ':skipped' : ''}`));
    // a reach that needs the Warden
    let t = T.setup([['objective.reach', [10, 0, 10], { text: 'EXIT', size: [4, 3, 4], requiresGun: 'rifle' }, 'exit']]);
    t.play(); T.step(0.2);
    g.weapon.reset(['pistol']);
    T.at(10, 0, 10); T.step(0.4);
    out.reachHeld = { state: m.state, held: m.held, hud: T.hud().text };
    T.at(30, 0, 30); T.step(0.2);
    g.weapon.grant('rifle', { ammo: 10 });
    T.step(0.2);
    out.reachStillOut = m.state; // the box was reached, the gun arrives later: done, wherever the player stands
    out.reachDone = { state: m.state, hud: T.hud().text };
    // a destroy that needs it: the kills are done first
    t = T.setup([['objective.destroy', [0, 0, 0], { group: 'g', requiresGun: 'rifle' }], ['enemy.static', [0, 0, -10], { group: 'g' }]]);
    t.play(); T.step(0.2);
    g.weapon.reset(['pistol']);
    T.kill(g.enemies.all[0]); T.step(0.3);
    out.destroyHeld = { state: m.state, held: m.held, index: m.index };
    g.weapon.grant('rifle', { ammo: 10 }); T.step(0.2);
    out.destroyDone = m.state;
    // skipIfOwned: stays current without the gun, drops out (silently, flagged skipped) once it is owned, later or at once
    skips.length = 0;
    t = T.setup([['objective.survive', [0, 0, 0], { time: 0.3 }, 'first'], ['objective.interact', [-20, 0, -20], { skipIfOwned: 'rifle', text: 'FIND' }, 'find'], ['objective.survive', [0, 0, 0], { time: 30 }, 'last']]);
    t.play(); T.step(0.2);
    g.weapon.reset(['pistol']);
    T.step(0.4);
    out.findWaits = { cur: m.current.oid, hud: T.hud().text };
    g.weapon.grant('rifle', { ammo: 10 }); T.step(0.1);
    out.findSkipped = { cur: m.current.oid, done: skips.join() };
    skips.length = 0;
    t = T.setup([['objective.survive', [0, 0, 0], { time: 0.3 }, 'first'], ['objective.interact', [-20, 0, -20], { skipIfOwned: 'rifle' }, 'find'], ['objective.survive', [0, 0, 0], { time: 30 }, 'last']]);
    t.play(); T.step(0.2);
    g.weapon.reset(['pistol']);
    g.weapon.grant('rifle', { ammo: 10 }); T.step(0.6);
    out.ownedAtOnce = { cur: m.current.oid, done: skips.join() };
    out.bad = ['requiresGun', 'skipIfOwned'].map((k) => { try { T.setup([['objective.reach', [0, 0, 0], { [k]: 'blaster' }]]); return null; } catch (e) { return e.message; } });
    return out;
  });
  expect('requiresGun on a reach: standing in the box without the gun waits (HUD names the gun), then completes the moment the gun is owned', r.reachHeld.state === 'active' && r.reachHeld.held && /^EXIT {2}KR-7 WARDEN: NOT FOUND$/.test(r.reachHeld.hud) && r.reachStillOut === 'complete' && r.reachDone.state === 'complete' && r.reachDone.hud === 'MISSION COMPLETE', JSON.stringify(r));
  expect('  on a destroy: the kills are counted, the objective waits for the gun and completes the moment it is owned', r.destroyHeld.state === 'active' && r.destroyHeld.held && r.destroyDone === 'complete', JSON.stringify([r.destroyHeld, r.destroyDone]));
  expect('skipIfOwned: the step waits while the gun is missing and is skipped (silently) when it arrives', r.findWaits.cur === 'find' && r.findSkipped.cur === 'last' && r.findSkipped.done === 'first,find:skipped', JSON.stringify([r.findWaits, r.findSkipped]));
  expect('  already owned when it comes up: skipped at once', r.ownedAtOnce.cur === 'last' && /first.*find:skipped/.test(r.ownedAtOnce.done), JSON.stringify(r.ownedAtOnce));
  expect('  unknown guns are rejected', r.bad.every((e) => e && /is not a known gun/.test(e)), JSON.stringify(r.bad));
}

// ---- 4. limit -> failed; timers run while the player is dead ----
{
  const r = await ev(() => {
    const g = window.game;
    const m = g.mission;
    const t = T.setup([['objective.survive', [0, 0, 0], { text: 'HOLD', time: 10, limit: 1 }]]);
    window.EV.length = 0;
    t.play(); T.step(0.5);
    const before = { state: m.state, hud: T.hud().text };
    T.step(1);
    const failed = { state: m.state, hud: T.hud().text, n: T.count('mission:failed'), ev: window.EV.find((e) => e.n === 'mission:failed') };
    T.step(2);
    const later = { state: m.state, n: T.count('mission:failed'), complete: T.count('mission:complete') };
    const t2 = T.setup([['objective.reach', [10, 0, 10], { limit: 30 }]]);
    t2.play(); T.step(0.5);
    const limitHud = T.hud().text;
    const t3 = T.setup([['objective.survive', [0, 0, 0], { time: 1 }]]);
    window.EV.length = 0;
    t3.play(); T.step(0.2);
    g.player.damage(1000); T.step(0.1);
    const dead = g.player.dead;
    T.step(1.2);
    return { before, failed, later, limitHud, dead, deadDone: m.state, deadComplete: T.count('mission:complete') };
  });
  expect('limit: before it runs out the objective shows remaining time', r.before.state === 'active' && /^HOLD {2}0:\d\d$/.test(r.before.hud) && /^REACH THE ZONE {2}0:30$/.test(r.limitHud), JSON.stringify(r));
  expect('  exceeding it fails the mission: event once, HUD MISSION FAILED, nothing more happens', r.failed.state === 'failed' && r.failed.hud === 'MISSION FAILED' && r.failed.n === 1 && r.failed.ev.reason === 'time' && r.failed.ev.index === 0 && r.later.state === 'failed' && r.later.n === 1 && r.later.complete === 0, JSON.stringify(r));
  expect('  survive keeps counting while the player is dead', r.dead && r.deadDone === 'complete' && r.deadComplete === 1, JSON.stringify(r));
}

// ---- 5. restart, edit, scene switch ----
{
  const r = await ev(() => {
    const g = window.game;
    const m = g.mission;
    const t = T.setup([
      ['objective.reach', [10, 0, 10], { text: 'ONE' }],
      ['objective.survive', [0, 0, 0], { text: 'TWO', time: 30 }],
    ]);
    const doc = JSON.stringify(t.doc);
    t.play(); T.step(0.2);
    T.at(10, 0, 10); T.step(0.3);
    const mid = { index: m.index, hud: T.hud().text };
    t.restart(); T.step(0.2);
    const restarted = { index: m.index, state: m.state, elapsed: m.elapsed < 0.5, hud: T.hud().text, objectives: m.objectives.length };
    t.edit(); T.step(0.3);
    const edited = { same: JSON.stringify(t.doc) === doc, state: m.state, objectives: m.objectives.length, hud: T.hud(), verify: t.verify().ok };
    t.play(); T.step(0.2);
    const again = m.state;
    g.loadScene('arena'); T.step(0.3);
    const arena = { state: m.state, hud: T.hud(), mission: g.mission === m, text: m.hudText() };
    return { mid, restarted, edited, again, arena };
  });
  expect('restart: back to objective 0 with a fresh clock', r.mid.index === 1 && r.mid.hud.startsWith('TWO') && r.restarted.index === 0 && r.restarted.state === 'active' && r.restarted.elapsed && r.restarted.hud === 'ONE', JSON.stringify(r));
  expect('  edit: identical doc, mission state none, HUD line hidden, scene = doc', r.edited.same && r.edited.state === 'none' && r.edited.objectives === 0 && !r.edited.hud.shown && r.edited.verify, JSON.stringify(r.edited));
  expect('  play again restarts it; loading another scene: state none, HUD line hidden', r.again === 'active' && r.arena.state === 'none' && !r.arena.hud.shown && r.arena.text === null, JSON.stringify(r));
}

// ---- 6. invalid parameters ----
{
  const r = await ev(() => {
    window.game.loadScene('workshop'); T.step(0.3); // section 5 ended in the arena
    const t = T.setup([
      ['objective.reach', [0, 0, 0]],
      ['objective.destroy', [0, 0, 0]],
      ['objective.survive', [0, 0, 0]],
      ['objective.interact', [0, 0, 0]],
    ]);
    const doc = JSON.stringify(t.doc);
    const tries = [[0, { size: [0, 3, 4] }], [0, { size: [4, 3] }], [0, { trigger: 5 }], [1, { count: 0 }], [1, { count: 1.5 }], [2, { time: 0 }], [2, { time: 'x' }], [3, { radius: -1 }], [0, { limit: 0 }], [1, { order: 'first' }], [2, { text: 7 }], [3, { wakeGroup: 1 }]];
    const errs = tries.map(([i, patch]) => {
      try { t.setParams(i, patch); return null; } catch (e) { return e.message; }
    });
    const stack = t.undoStack.length;
    const same = JSON.stringify(t.doc) === doc;
    const ok = (() => { t.setParams(2, { time: 5, limit: 9, order: 3 }); t.setParams(1, { count: null, group: null }); return JSON.stringify(t.doc.pieces[2].params); })();
    return { errs, same, stack, ok, verify: t.verify().ok };
  });
  expect('bad params throw readable errors and leave the doc alone', r.errs.every((e) => e && /^objective\.\w+: \w+ must be /.test(e)) && r.same && r.stack === 4 && r.verify, JSON.stringify(r));
  expect('  valid edits still work (optional keys can be removed)', JSON.parse(r.ok).time === 5 && JSON.parse(r.ok).limit === 9, r.ok);
}

expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
process.exit(fail.length ? 1 : 0);
