// STEM-00 acting in `cinematic.cut` shots (`stem`: path, face, aim, fire, fall; per-shot `fade`) and level chaining (`next` /
// `debrief`): path end position and gait, scripted kills (count, events, no ammo, no stats shots), a skip leaves the played end
// state, a 300 m fall without death, the fade overlay (ease, skip, reset), mission:complete -> next scene (no debrief, CONTINUE /
// RESTART, progress), and the validation of every new field. Built in the Workshop and played in place, headless stepping.
// Needs the dev server: `bun run dev`, then `node tests/cut-acting.browser.mjs` (Playwright + Chromium).
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
  T.wait = (ms = 30) => new Promise((r) => setTimeout(r, ms)); // timers (the chained load) run between frames
  T.shots = [];
  T.downs = [];
  T.dones = [];
  engine.events.on('weapon:shot', (s) => T.shots.push({ scripted: s.scripted, gun: s.gun, t: engine.time }));
  engine.events.on('puppet:down', () => T.downs.push(engine.time));
  engine.events.on('cinematic:done', (e) => T.dones.push({ ...e }));
  // a clean doc with the pieces ([id, pos, params?, name?]) and extra level fields, played in place
  T.play = (pieces, extra = {}) => {
    if (g.sceneName !== 'workshop') g.loadScene('workshop'); // a chained load left it
    const t = g.tool;
    if (t.playing) t.edit();
    const doc = { ...JSON.parse(JSON.stringify(t.doc)), pieces: [] };
    delete doc.loadout;
    delete doc.next;
    delete doc.debrief;
    t.load({ ...doc, ...extra });
    for (const [id, pos, params, name] of pieces) {
      const i = t.place(id, pos, params);
      if (name) t.setName(i, name);
    }
    T.shots.length = T.downs.length = T.dones.length = 0;
    t.play();
    g.player.pos.set(0, 0, 0);
    T.step(1 / 60);
    return t;
  };
  T.cut = (shots, extra = {}, name = 'cut') => ['cinematic.cut', [0, 0, 8], { on: 'start', shots, skippable: true, ...extra }, name];
  T.shot = (time, stem, more = {}) => ({ from: [0, 3, 10], look: [0, 1, 0], time, ...(stem ? { stem } : {}), ...more });
  T.at = () => g.player.pos.toArray().map((n) => Math.round(n * 1000) / 1000);
  T.state = () => ({
    pos: T.at(), alive: g.enemies.liveOf('g').length, other: g.enemies.liveOf('o').length, kills: g.enemies.kills, statKills: g.stats.kills, statShots: g.stats.shots,
    active: g.cinematic.active, scripted: g.player.scripted, locked: g.controls.locked, hold: g.enemies.holdFire, dead: g.player.dead,
  });
  T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 30); engine.input.keys.delete(code); };
  T.key = (code) => dispatchEvent(new KeyboardEvent('keydown', { code }));
  T.targets = () => [['enemy.static', [-2, 0, -8], { group: 'g' }], ['enemy.static', [2, 0, -8], { group: 'g' }], ['enemy.static', [0, 0, -10], { group: 'g' }], ['enemy.static', [6, 0, -10], { group: 'o' }]];
});

// ---- 1. path: start position, mid-shot speed and gait, end position, stands afterwards; place then stem ----
{
  const r = await ev(() => {
    const g = window.game;
    // place puts the player at (0, 0, 6) at the cut's start; the path then moves it: 8 m in 1 s (run), then 2 m in 2 s (walk)
    T.play([T.cut([T.shot(1, { path: [[0, 0, 2], [6, 0, 2]] }), T.shot(2, { path: [[6, 0, 0]] }), T.shot(0.5)], { place: { pos: [0, 0, 6], yaw: 0 } })]);
    const out = { start: T.state() };
    T.step(0.5);
    out.midRun = { pos: T.at(), vx: g.player.vel.x, vz: g.player.vel.z, run: g.player.view.animState.run, speed: g.player.view.animState.speed, locked: g.controls.locked, hold: g.enemies.holdFire, scripted: g.player.scripted, facing: g.player.facing };
    T.step(1.5);
    out.midWalk = { pos: T.at(), run: g.player.view.animState.run, speed: g.player.view.animState.speed, vz: g.player.vel.z };
    T.step(2);
    out.end = T.state();
    T.step(1);
    out.later = T.state();
    out.dones = T.dones.slice();
    return out;
  });
  expect('path: place puts the player at the cut start, the cut locks input and scripts it', r.start.active && r.start.locked && r.start.scripted && r.start.hold, JSON.stringify(r.start));
  expect('path: mid-run it is on the first segment, moving fast with the run gait', Math.abs(r.midRun.pos[2] - 2) < 0.2 && r.midRun.pos[0] > 0.3 && r.midRun.pos[0] < 3 && r.midRun.vx > 6 && r.midRun.run, JSON.stringify(r.midRun));
  expect('path: it turns the way it moves (+X)', Math.abs(r.midRun.facing - Math.PI / 2) < 0.4, JSON.stringify(r.midRun));
  expect('path: the slow shot walks (no run gait) toward -Z', !r.midWalk.run && r.midWalk.vz < 0 && r.midWalk.speed > 0.5 && r.midWalk.pos[2] < 2 && r.midWalk.pos[2] > 0, JSON.stringify(r.midWalk));
  expect('path: it ends on the last point and stands there, free again', Math.abs(r.end.pos[0] - 6) < 0.01 && Math.abs(r.end.pos[2]) < 0.01 && !r.end.active && !r.end.scripted && !r.end.locked && !r.end.hold, JSON.stringify(r.end));
  expect('path: it stays there afterwards (the motor stands it on the floor)', r.later.pos[0] === r.end.pos[0] && r.later.pos[2] === r.end.pos[2] && Math.abs(r.later.pos[1]) < 0.01 && !r.later.dead, JSON.stringify(r.later));
  expect('path: cinematic:done once, a cut, not skipped', r.dones.length === 1 && r.dones[0].cut && !r.dones[0].skipped, JSON.stringify(r.dones));
}

// ---- 2. face + aim: the body turns to the point, the aiming pose with the gun raised at it ----
{
  const r = await ev(() => {
    const g = window.game;
    T.play([T.cut([T.shot(2, { face: [10, 1.4, 0], aim: true })], {}, 'look')]);
    T.step(1);
    const out = { facing: g.player.facing, aiming: g.player.aiming, combat: g.player.view.animState.combat, pitch: g.player.aimPitch };
    T.step(1.5);
    out.after = { aiming: g.player.aiming, scripted: g.player.scripted, pitch: g.player.aimPitch, facing: g.player.facing };
    return out;
  });
  expect('face: yaw toward the point (+X), aiming pose', Math.abs(r.facing - Math.PI / 2) < 0.1 && r.aiming && r.combat, JSON.stringify(r));
  expect('face: nothing stays scripted after the cut', !r.after.aiming && !r.after.scripted && r.after.pitch === null, JSON.stringify(r.after));
}

// ---- 3. fire: kills the group one by one, real shots, no ammo, no stats shots; other groups untouched ----
let played;
const FIRE = { face: [0, 1, -9], fire: { group: 'g', interval: 0.4 } };
{
  const r = await ev((FIRE) => {
    const g = window.game;
    const ammo = () => g.weapon.ammo;
    T.play([T.cut([T.shot(2.5, { ...FIRE, path: [[0, 0, -2]] }), T.shot(0.5)], {}, 'shoot'), ...T.targets()]);
    const out = { before: T.state(), ammo: ammo(), gun: g.weapon.current };
    T.step(0.05);
    out.first = { alive: g.enemies.liveOf('g').length, shots: T.shots.length };
    out.aiming = g.player.aiming;
    T.step(1.2);
    out.mid = { alive: g.enemies.liveOf('g').length, shots: T.shots.length, hold: g.enemies.holdFire };
    T.step(2);
    out.end = T.state();
    out.ammoAfter = ammo();
    out.shots = T.shots.slice();
    out.downs = T.downs.slice();
    out.debris = g.enemies.all.filter((e) => e.squad === 'g').every((e) => !e.alive && e.rig.root.visible === false);
    return out;
  }, FIRE);
  played = r.end;
  expect('fire: 3 live members of g and 1 of o at the start', r.before.alive === 3 && r.before.other === 1, JSON.stringify(r.before));
  expect('fire: the first round goes at once, the others every interval', r.first.alive === 2 && r.first.shots === 1 && r.mid.alive === 0 && r.mid.shots === 3, JSON.stringify([r.first, r.mid]));
  expect('fire: the shots are scripted weapon:shot events of the raised gun, 0.4 s apart', r.shots.length === 3 && r.shots.every((s) => s.scripted && s.gun === r.gun) && Math.abs(r.shots[1].t - r.shots[0].t - 0.4) < 0.05 && Math.abs(r.shots[2].t - r.shots[1].t - 0.4) < 0.05, JSON.stringify(r.shots));
  expect('fire: three kills through the normal death (puppet:down, debris, kill counter, run stats)', r.downs.length === 3 && r.end.kills === 3 && r.end.statKills === 3 && r.debris, JSON.stringify([r.downs, r.end]));
  expect('fire: the other group lives, the gun spent no ammo, the run stats count no player shot', r.end.other === 1 && r.ammoAfter === r.ammo && r.end.statShots === 0, JSON.stringify([r.end, r.ammo, r.ammoAfter]));
  expect('fire: it aimed while shooting, enemies held fire meanwhile', r.aiming && r.mid.hold, JSON.stringify(r.mid));
  expect('fire: the path ends at its last point', Math.abs(r.end.pos[2] + 2) < 0.01 && Math.abs(r.end.pos[0]) < 0.01 && !r.end.active && !r.end.scripted, JSON.stringify(r.end));
}

// ---- 4. a slow interval: what is alive when the cut ends dies then ----
{
  const r = await ev(() => {
    T.play([T.cut([T.shot(1, { fire: { group: 'g', interval: 5 } })], {}, 'slow'), ...T.targets()]);
    T.step(0.5);
    const mid = T.state().alive;
    T.step(1);
    return { mid, end: T.state(), shots: T.shots.length, downs: T.downs.length };
  });
  expect('fire: a long interval kills one round, the cut\'s end kills the rest', r.mid === 2 && r.end.alive === 0 && r.end.other === 1 && r.downs === 3 && r.shots === 1, JSON.stringify(r));
}

// ---- 5. skip: the same end state as played (position, group dead, kill counts), no stale lock ----
{
  const r = await ev((FIRE) => {
    T.play([T.cut([T.shot(2.5, { ...FIRE, path: [[0, 0, -2]] }), T.shot(0.5)], {}, 'shoot'), ...T.targets()]);
    T.step(0.5);
    T.press('Space'); // jump skips a skippable cut (after skipDelay)
    T.step(0.2);
    return { end: T.state(), dones: T.dones.slice(), shots: T.shots.length };
  }, FIRE);
  const same = JSON.stringify({ ...r.end, scripted: 0, locked: 0 }) === JSON.stringify({ ...played, scripted: 0, locked: 0 });
  expect('skip: cinematic:done { skipped }, the cut is over and the player free', r.dones.length === 1 && r.dones[0].skipped && r.dones[0].cut && !r.end.active && !r.end.locked && !r.end.hold && !r.end.scripted, JSON.stringify(r));
  expect('skip: same end state as the played cut (position, group dead, kills, other group alive)', same, `${JSON.stringify(r.end)} vs ${JSON.stringify(played)}`);
}

// ---- 6. fall: 300 m below any floor, falling pose, no ground, no death, frozen where it ended; a scene load frees it ----
{
  const r = await ev(() => {
    const g = window.game;
    T.play([T.cut([T.shot(2, { path: [[0, -300, -4]], fall: true }), T.shot(0.5)], { place: { pos: [0, 4, -4], yaw: 0 } }, 'drop')]);
    T.step(1);
    const mid = { y: g.player.pos.y, airborne: g.player.airborne, air: g.player.view.animState.air, dead: g.player.dead, health: g.player.health, scripted: g.player.scripted };
    T.step(1.6);
    const end = { ...T.state(), y: g.player.pos.y, health: g.player.health };
    T.step(6);
    const later = { y: g.player.pos.y, dead: g.player.dead, health: g.player.health, scripted: g.player.scripted, vy: g.player.vy };
    g.loadScene('workshop');
    T.step(0.5);
    const loaded = { scripted: g.player.scripted, y: g.player.pos.y, dead: g.player.dead };
    return { mid, end, later, loaded };
  });
  expect('fall: mid-shot it is far below the floor in the falling pose, alive', r.mid.y < -100 && r.mid.y > -250 && r.mid.airborne && r.mid.air === 1 && !r.mid.dead && r.mid.health > 0 && r.mid.scripted, JSON.stringify(r.mid));
  expect('fall: it ends at the last point, 300 m down, no death', Math.abs(r.end.y + 300) < 0.01 && !r.end.dead && !r.end.active && r.end.health > 0, JSON.stringify(r.end));
  expect('fall: afterwards it does not fall on or die (frozen where it ended)', Math.abs(r.later.y + 300) < 0.01 && !r.later.dead && r.later.vy === 0 && r.later.scripted, JSON.stringify(r.later));
  expect('fall: a scene load puts it back under the motor', !r.loaded.scripted && r.loaded.y > -1 && !r.loaded.dead, JSON.stringify(r.loaded));
}

// ---- 7. fade: eases per shot from the previous value, skip goes to the last value, clears on return, reset ----
{
  const r = await ev(() => {
    const g = window.game;
    const f = () => Math.round(g.fade.value * 1000) / 1000;
    const dom = () => ({ hidden: document.getElementById('fade').hidden, op: document.getElementById('fade').style.opacity });
    T.play([T.cut([T.shot(1, null, { fade: 1 }), T.shot(1, null, { fade: 0.5 }), T.shot(1)], {}, 'fadein')]);
    const out = { start: f() };
    T.step(0.5);
    out.a = f();
    out.domA = dom();
    T.step(1);
    out.b = f();
    T.step(0.9); // 2.4 s: the last shot keeps 0.5
    out.c = f();
    T.step(1.2); // over at 3 s: control returned, the overlay clears within 0.5 s
    out.end = { v: f(), active: g.cinematic.active, dom: dom() };
    // skip: jumps to the last value, then clears
    T.play([T.cut([T.shot(2, null, { fade: 1 }), T.shot(2, null, { fade: 0.6 })], {}, 'fadeskip')]);
    T.step(0.8);
    T.press('Space');
    out.skip = { v: f(), active: g.cinematic.active };
    T.step(0.7);
    out.skipEnd = f();
    // reset: a scene load in the middle of a faded cut
    T.play([T.cut([T.shot(3, null, { fade: 1 })], {}, 'fadereset')]);
    T.step(1.5);
    out.beforeLoad = f();
    g.loadScene('workshop');
    out.afterLoad = { v: f(), dom: dom(), active: g.cinematic.active };
    return out;
  });
  expect('fade: starts clear, eases toward the first shot\'s value', r.start < 0.05 && Math.abs(r.a - 0.5) < 0.05 && !r.domA.hidden && Math.abs(Number(r.domA.op) - r.a) < 0.01, JSON.stringify([r.start, r.a, r.domA]));
  expect('fade: the second shot eases from the first\'s value (1) to its own (0.5)', Math.abs(r.b - 0.75) < 0.05, JSON.stringify(r));
  expect('fade: a shot without fade keeps the previous value', Math.abs(r.c - 0.5) < 0.02, JSON.stringify(r));
  expect('fade: control returns and the overlay clears', r.end.v === 0 && !r.end.active && r.end.dom.hidden, JSON.stringify(r.end));
  expect('fade: a skip goes to the last value, then clears', Math.abs(r.skip.v - 0.6) < 0.08 && !r.skip.active && r.skipEnd === 0, JSON.stringify([r.skip, r.skipEnd]));
  expect('fade: a scene load resets the overlay', r.beforeLoad > 0.3 && r.afterLoad.v === 0 && r.afterLoad.dom.hidden && !r.afterLoad.active, JSON.stringify([r.beforeLoad, r.afterLoad]));
}

// ---- 8. validation: stem and fade ----
{
  const r = await ev(() => {
    const g = window.game;
    const check = (shot, extra) => {
      const level = { spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [{ id: 'cinematic.cut', pos: [0, 0, 0], params: { on: 'start', shots: [{ from: [0, 3, 10], look: [0, 1, 0], time: 1, ...shot }], ...extra } }] };
      try { g.registry.check(level); return null; } catch (e) { return e.message; }
    };
    return {
      ok: [
        check({ stem: { path: [[0, 0, 0], [1, 0, 0]], face: [0, 1, 0], aim: true, fire: { group: 'g' }, fall: false } }),
        check({ stem: { path: [[0, -300, 0]], fall: true }, fade: 1 }),
        check({ stem: {}, fade: 0 }),
        check({ stem: { fire: { group: 'g', interval: 0.2 } } }),
      ],
      bad: [
        check({ stem: 3 }),
        check({ stem: { path: [] } }),
        check({ stem: { path: [[0, 0]] } }),
        check({ stem: { face: [0, 0] } }),
        check({ stem: { aim: 'yes' } }),
        check({ stem: { fire: { group: 'a b' } } }),
        check({ stem: { fire: { group: 'g', interval: 0 } } }),
        check({ stem: { fall: true } }),
        check({ stem: { run: true } }),
        check({ fade: 1.5 }),
        check({ fade: '1' }),
        check({ stem: { path: [[0, 0, 0]] } }, { wake: { at: 1 } }),
      ],
      intro: (() => {
        const level = { spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [{ id: 'intro.cinematic', pos: [0, 0, 0], params: { shots: [{ from: [0, 3, 10], look: [0, 1, 0], time: 1, stem: { aim: true } }] } }] };
        try { g.registry.check(level); return null; } catch (e) { return e.message; }
      })(),
    };
  });
  expect('validation: valid stem / fade shapes pass', r.ok.every((m) => m === null), JSON.stringify(r.ok));
  expect('validation: every malformed stem / fade fails with a clear message', r.bad.every((m) => m && /shot 0|wake/.test(m)), JSON.stringify(r.bad));
  expect('validation: stem is for cinematic.cut only', /cinematic\.cut only/.test(r.intro ?? ''), String(r.intro));
}

// ---- 9. chaining: validation of next / debrief, CAMPAIGN ----
{
  const r = await ev(async () => {
    const g = window.game;
    const lvl = (extra) => ({ spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [], ...extra });
    const check = (extra) => { try { g.registry.check(lvl(extra)); return null; } catch (e) { return e.message; } };
    const scenes = await import('/src/game/scenes.js');
    return {
      ok: [check({}), check({ next: 'arena' }), check({ next: 'arena', debrief: true }), check({ next: 'arena', debrief: false })],
      unknown: check({ next: 'no-such-scene' }),
      notString: check({ next: 4 }),
      badDebrief: check({ next: 'arena', debrief: 'no' }),
      orphan: check({ debrief: false }),
      campaign: scenes.CAMPAIGN,
    };
  });
  expect('chain: next (a scene) and debrief (bool) are accepted', r.ok.every((m) => m === null), JSON.stringify(r.ok));
  expect('chain: an unknown or non-string next fails validation naming the scenes', /"next" is "no-such-scene".*arena/.test(r.unknown ?? '') && /"next"/.test(r.notString ?? ''), JSON.stringify([r.unknown, r.notString]));
  expect('chain: a bad debrief, or debrief false without next, fails', /debrief/.test(r.badDebrief ?? '') && /needs a "next"/.test(r.orphan ?? ''), JSON.stringify([r.badDebrief, r.orphan]));
  expect('chain: CAMPAIGN starts with the default scene (and follows next fields)', r.campaign[0] === 'prologue', JSON.stringify(r.campaign));
}

// ---- 10. chaining: debrief false fades out and loads next; progress follows ----
{
  const r = await ev(async () => {
    const g = window.game;
    try { localStorage.removeItem('cerberus.progress'); } catch {}
    T.play([['objective.reach', [0, 0, 0], { text: 'GO', size: [4, 3, 4] }]], { next: 'prologue', debrief: false });
    const out = { state: g.mission.state, summary: g.summary.state, locked: g.controls.locked };
    T.step(0.5);
    out.half = { v: g.fade.value, scene: g.sceneName, open: g.summary.open };
    T.step(0.7);
    await T.wait();
    out.after = { scene: g.sceneName, v: g.fade.value, summary: g.summary.state, locked: g.controls.locked, title: g.activeLevel.title, started: g.mission.state };
    out.progress = JSON.parse(localStorage.getItem('cerberus.progress') ?? 'null');
    return out;
  });
  expect('chain/no debrief: the mission completes, no report, the input locks and it fades out', r.state === 'complete' && r.summary === 'leaving' && r.locked && r.half.v > 0.3 && r.half.v < 0.7 && !r.half.open && r.half.scene === 'workshop', JSON.stringify(r));
  expect('chain/no debrief: after the beat the next scene is loaded, clean (fade, lock, summary reset)', r.after.scene === 'prologue' && r.after.v === 0 && r.after.summary === 'idle' && !r.after.locked, JSON.stringify(r.after));
  expect('chain/no debrief: progress records the scene entered (main menu CONTINUE resumes there)', r.progress?.scene === 'prologue', JSON.stringify(r.progress));
}

// ---- 11. a black screen already: a short beat only; a cut that fades out and completes the mission chains on without a flash ----
{
  const r = await ev(async () => {
    const g = window.game;
    T.play([
      T.cut([T.shot(1.5, { path: [[0, -300, -4]], fall: true }, { fade: 1 })], { place: { pos: [0, 4, -4], yaw: 0 } }, 'plunge'),
      ['objective.reach', [0, 0, 0], { text: 'FALL', size: [1, 1, 1], trigger: 'plunge' }],
    ], { next: 'prologue', debrief: false });
    let minFade = 1;
    const sample = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { T.step(1 / 60); if (g.cinematic.t >= 1.5 || !g.cinematic.active) minFade = Math.min(minFade, g.fade.value); } };
    sample(1.7);
    const out = { cutDone: T.dones.length, state: g.mission.state, summary: g.summary.state, scene: g.sceneName, y: g.player.pos.y };
    sample(0.6);
    await T.wait();
    out.after = { scene: g.sceneName, v: g.fade.value, scripted: g.player.scripted, y: g.player.pos.y, summary: g.summary.state };
    out.minFade = minFade;
    return out;
  });
  expect('chain/cut: the fall cut ends, the mission completes at its end and starts leaving', r.cutDone === 1 && r.state === 'complete' && r.summary !== 'idle' && r.scene === 'workshop', JSON.stringify(r));
  expect('chain/cut: the screen stays (nearly) black until the next scene loads, which frees the fallen player', r.minFade > 0.85 && r.after.scene === 'prologue' && r.after.v === 0 && !r.after.scripted && r.after.y > -1, JSON.stringify(r));
}

// ---- 12. chaining: debrief on + next: CONTINUE (Enter / pad A) loads next, RESTART (R / pad X) reloads ----
{
  const r = await ev(async () => {
    const g = window.game;
    // plays a one-objective level and runs until the report opens (it opens 2.2 s after the mission ends), 0.3 s into it
    const open = (extra) => {
      T.play([['objective.reach', [0, 0, 0], { text: 'GO', size: [4, 3, 4] }]], extra);
      T.step(2.5);
      const s = document.getElementById('summary');
      return { open: g.summary.open, buttons: [...s.querySelectorAll('button')].map((b) => `${b.dataset.action}:${b.textContent}`), sub: s.querySelector('.sub')?.textContent, title: g.tool.doc.title };
    };
    const out = {};
    out.keyboard = open({ next: 'prologue' });
    T.key('Enter'); // not armed yet (1 s)
    await T.wait();
    out.early = g.sceneName;
    T.step(1);
    T.key('KeyR');
    await T.wait(); // RESTART: the Workshop restarts its play in place
    out.restart = { scene: g.sceneName, open: g.summary.open, state: g.summary.state, mission: g.mission.state };
    // complete again and continue with the keyboard
    g.player.pos.set(0, 0, 0);
    T.step(3.5);
    out.reopened = g.summary.open;
    T.key('Enter');
    out.continued = { scene: g.sceneName };
    // the pad: X restarts, A continues
    open({ next: 'prologue' });
    T.step(1);
    T.press('Pad2');
    await T.wait();
    out.padRestart = { scene: g.sceneName, open: g.summary.open };
    g.player.pos.set(0, 0, 0);
    T.step(3.5);
    T.press('Pad0');
    await T.wait();
    out.padContinue = g.sceneName;
    // without next: one RESTART button (Enter / A, or R / X), as before
    out.plain = open({});
    return out;
  });
  expect('chain/debrief: the report has CONTINUE (primary) and RESTART', r.keyboard.open && r.keyboard.buttons.join() === 'continue:CONTINUE,restart:RESTART' && r.keyboard.sub === r.keyboard.title, JSON.stringify(r.keyboard));
  expect('chain/debrief: Enter is ignored before the report is armed', r.early === 'workshop', r.early);
  expect('chain/debrief: R restarts the play in place (the report goes, the mission runs again)', r.restart.scene === 'workshop' && !r.restart.open && r.restart.state === 'idle', JSON.stringify(r.restart));
  expect('chain/debrief: Enter (CONTINUE) loads next', r.reopened && r.continued.scene === 'prologue', JSON.stringify([r.reopened, r.continued]));
  expect('chain/debrief: pad X restarts, pad A continues', r.padRestart.scene === 'workshop' && !r.padRestart.open && r.padContinue === 'prologue', JSON.stringify([r.padRestart, r.padContinue]));
  expect('chain/debrief: without next the report keeps one RESTART button', r.plain.open && r.plain.buttons.join() === 'restart:RESTART', JSON.stringify(r.plain));
}

expect('no page errors', errors.length === 0, errors.join(' | '));
await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall cut acting checks passed');
