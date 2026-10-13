// The Prologue weapon discovery (#93): the pistol-only start, the armoury rack (objective `armoury`, order 60: SALVAGE A WEAPON)
// that grants the KR-7 Warden (toast, weapon:discovered once, STEM-00 log line), the stand-by pause that lets the line play before
// the troopers wake, and the fallback: skipping the rack (walking out of the hall) lets the first destroyed trooper drop a Warden,
// never twice, never if it is owned. The Prologue cannot end without it (#15: `armoury-late` before the arena gate, the exit needs it): both ways back are tested. Pure level data, headless stepping.
// Needs the dev server: `npm run dev`, then `node tests/prologue-warden.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
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
    T.disc = [];
    engine.events.on('weapon:discovered', (e) => T.disc.push(e.gun));
    T.guns = () => g.pickups.items.filter((i) => i.gun);
    T.lines = () => g.log.entries.map((e) => e.text);
    // to the armoury: the calibration kills, the purge beat, the yard and hall shooters dead
    T.toArmoury = () => {
      T.go(0, 29.5);
      T.passives().slice(0, 3).forEach(T.kill);
      T.step(4.3);
      T.killGroup(1);
      T.step(0.2);
      T.killGroup(2);
      T.step(0.2);
    };
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


const WARDEN_LINE = '> ITEM: KR-7. FUNCTION: KILL. QUERY: WHY DOES IT FEEL HEAVY?';

// ---- 1: a fresh run owns only the pistol; the armoury is next after the hall shooters ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = { owned: [...g.weapon.owned].join(), current: g.weapon.current, slots: [...document.querySelectorAll('.slots span')].filter((s) => s.style.display !== 'none').map((s) => s.id).join() };
    T.toArmoury();
    out.armoury = { cur: T.cur(), awake: T.awake(), obj: g.mission.current.obj, text: g.mission.hudText(), pos: g.mission.current.pos.toArray(), gun: g.mission.current.params.grantGun };
    out.rack = g.world.props.length;
    T.step(10);
    out.idle = { cur: T.cur(), awake: T.awake() }; // the rack waits; no one comes
    return out;
  });
  expect('a fresh run owns only the pistol (one slot)', r.owned === 'pistol' && r.current === 'pistol' && r.slots === 'slot-pistol', JSON.stringify(r));
  expect('after the hall shooters the armoury is current: SALVAGE A WEAPON, an interact at the rack, nobody awake', r.armoury.cur === 'armoury' && r.armoury.obj === 'interact' && /^SALVAGE A WEAPON/.test(r.armoury.text) && r.armoury.gun === 'rifle' && !r.armoury.awake.length && r.rack >= 1, JSON.stringify(r.armoury));
  expect('  the stage waits for the player (no timer, nothing wakes)', r.idle.cur === 'armoury' && !r.idle.awake.length, JSON.stringify(r.idle));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 2: taking the Warden: the discovery beat, then a calm pause, then the troopers ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    T.toArmoury();
    T.go(-21.5, -37);
    T.step(0.3);
    out.noPress = { cur: T.cur(), owned: [...g.weapon.owned].join() };
    T.press('KeyG');
    T.step(0.1);
    const w = g.weapon;
    out.taken = { cur: T.cur(), owned: [...w.owned].sort().join(), current: w.pending ?? w.current, mag: w.state.rifle.ammo, reserve: w.state.rifle.reserve, disc: [...T.disc], toast: document.getElementById('toast').textContent, awake: T.awake() };
    out.slots = [...document.querySelectorAll('.slots span')].filter((s) => s.style.display !== 'none').map((s) => s.id).join();
    // selectable: the number key reaches it again after switching to the pistol
    w.switchTo('pistol'); T.step(0.8);
    T.press('Digit1'); T.step(0.8);
    out.reselect = w.current;
    T.step(1); // stand by: calm, the line is due after 3 s of calm
    out.during = { cur: T.cur(), awake: T.awake(), lines: T.lines().filter((t) => /KR-7/.test(t)).length };
    T.step(4);
    out.line = T.lines().filter((t) => /KR-7/.test(t));
    out.after = { cur: T.cur(), awake: T.awake() };
    T.step(10);
    out.disc = [...T.disc];
    out.drops = T.guns().length;
    return out;
  });
  expect('the rack needs G: standing in range does not take it', r.noPress.cur === 'armoury' && r.noPress.owned === 'pistol', JSON.stringify(r.noPress));
  expect('G at the rack: the Warden is owned and raised with a full magazine and a modest reserve, the objective is done', r.taken.cur === 'purge-standby' && r.taken.owned === 'pistol,rifle' && r.taken.current === 'rifle' && r.taken.mag === 32 && r.taken.reserve === 64, JSON.stringify(r.taken));
  expect('  the toast reads KR-7 WARDEN ACQUIRED, weapon:discovered fired once, a second slot appears', r.taken.toast === 'KR-7 WARDEN ACQUIRED' && r.disc.join() === 'rifle' && r.slots === 'slot-rifle,slot-pistol', JSON.stringify([r.taken, r.slots, r.disc]));
  expect('  the Warden is selectable (key 1)', r.reselect === 'rifle', r.reselect);
  expect('  the stand-by pause: no one wakes while the line is pending', r.during.cur === 'purge-standby' && !r.during.awake.length, JSON.stringify(r.during));
  expect('  STEM-00 plays the line once, after the calm, before the troopers wake', r.line.length === 1 && r.line[0] === WARDEN_LINE, JSON.stringify(r.line));
  expect('  then the yard troopers wake (and only they)', r.after.cur === 'purge-troopers-yard' && JSON.stringify(r.after.awake) === '[3]', JSON.stringify(r.after));
  expect('  no Warden is dropped by the troopers afterwards (it is owned)', r.drops === 0, r.drops);
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 3: skipping the rack: the troopers wake anyway, the first dead trooper drops the Warden once ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    T.toArmoury();
    T.go(-9, -36, 0.5);
    out.inHall = { cur: T.cur() };
    T.go(2, -28, 0.3); // out of the hall door into the yard
    out.skipped = { cur: T.cur(), owned: [...g.weapon.owned].join(), disc: [...T.disc], awake: T.awake() };
    T.step(5.2);
    out.woke = { cur: T.cur(), awake: T.awake() };
    T.step(8);
    out.noLine = T.lines().filter((t) => /KR-7/.test(t)).length;
    // the pistol still kills them: first trooper down drops the Warden
    const [a, b, c] = T.group(3);
    out.before = T.guns().length;
    T.kill(a);
    T.step(0.1);
    const drop = T.guns();
    out.first = drop.map((i) => ({ gun: i.gun, ammo: i.ammo, near: Math.hypot(i.pos.x - a.pos.x, i.pos.z - a.pos.z) < 0.1 }));
    T.kill(b);
    T.step(0.1);
    out.second = T.guns().length;
    g.player.pos.set(a.pos.x, 0, a.pos.z);
    T.step(0.3);
    out.pick = { owned: [...g.weapon.owned].sort().join(), current: g.weapon.pending ?? g.weapon.current, disc: [...T.disc], toast: document.getElementById('toast').textContent, reserve: g.weapon.state.rifle.reserve, left: T.guns().length };
    T.kill(c);
    T.killGroup(4);
    T.step(0.1);
    out.later = T.guns().length;
    T.killGroup(5);
    T.step(8); // nothing awake left: calm
    out.lineAfter = T.lines().filter((t) => /KR-7/.test(t)).length;
    return out;
  });
  expect('inside the hall the armoury stays current', r.inHall.cur === 'armoury', JSON.stringify(r.inHall));
  expect('walking out of the hall skips the armoury: nothing is granted, then the stand-by starts', r.skipped.cur === 'purge-standby' && r.skipped.owned === 'pistol' && !r.skipped.disc.length && !r.skipped.awake.length, JSON.stringify(r.skipped));
  expect('  the troopers wake after the pause even though the rack was skipped', r.woke.cur === 'purge-troopers-yard' && JSON.stringify(r.woke.awake) === '[3]', JSON.stringify(r.woke));
  expect('  no discovery line without the discovery', r.noLine === 0, r.noLine);
  expect('the first destroyed trooper leaves one Warden pickup where it fell, with ammo', r.before === 0 && r.first.length === 1 && r.first[0].gun === 'rifle' && r.first[0].ammo === 64 && r.first[0].near, JSON.stringify([r.before, r.first]));
  expect('  the second death drops nothing', r.second === 1, r.second);
  expect('  picking it up gives the Warden (discovered once, raised, ammo), the pickup is gone', r.pick.owned === 'pistol,rifle' && r.pick.current === 'rifle' && r.pick.disc.join() === 'rifle' && r.pick.reserve >= 64 && r.pick.left === 0, JSON.stringify(r.pick));
  expect('  no more drops later in the wave, and the discovery line still plays once it is found', r.later === 0 && r.lineAfter === 1, JSON.stringify([r.later, r.lineAfter]));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4: survival never needs it: the whole wave and the rest can be killed with the pistol; an owned Warden is never dropped ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    T.toArmoury();
    g.weapon.grant('rifle', { ammo: 10 }); // owned before the troopers (e.g. found elsewhere): the armoury still stands
    T.go(2, -28, 0.3);
    T.step(5.2);
    out.cur = T.cur();
    T.group(3).forEach(T.kill);
    T.step(0.2);
    out.drops = T.guns().length;
    // pistol only: skip, then never pick the drop up; the chain still finishes
    return out;
  });
  expect('a Warden the player already owns is never dropped', r.cur === 'purge-troopers-yard' && r.drops === 0, JSON.stringify(r));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// pistol only, the Warden never picked up, never taken: every wave is beaten without it, but the exit is not reachable without it (#15).
// Two ways back to a Warden, both always available: the drop where the trooper fell (it never expires) and the armoury rack (asked for again).
{
  const run = async (way) => {
    const { p, errors } = await open();
    const r = await p.evaluate((way) => {
      const g = window.game;
      T.toArmoury();
      T.go(2, -28, 0.3);
      T.step(5.2);
      const seen = [];
      const dropAt = { x: 0, z: 0 };
      for (const n of [3, 4, 5]) {
        if (n === 3) { const a = T.group(3)[0]; dropAt.x = a.pos.x; dropAt.z = a.pos.z; }
        T.killGroup(n); T.step(0.2); seen.push(T.cur());
      }
      T.step(20); // time passes: the drop stays
      const out = { seen, drops: T.guns().length, hud: g.mission.hudText(), owned: [...g.weapon.owned].join() };
      T.go(39.75, -17, 0.3); // walking on to the arena gate does not skip the step
      out.stillLate = T.cur();
      if (way === 'drop') T.go(dropAt.x, dropAt.z, 0.4);
      else { T.go(-21.5, -37, 0.2); T.press('KeyG'); T.step(0.2); }
      out.found = { cur: T.cur(), owned: [...g.weapon.owned].sort().join(), disc: [...T.disc], drops: T.guns().length };
      T.go(39.75, -17, 0.3);
      T.kill(T.group(6)[0]);
      T.step(0.3);
      out.exit = { cur: T.cur(), state: g.mission.state };
      T.go(39.75, -75, 0.3);
      out.done = { state: g.mission.state, complete: T.complete };
      return out;
    }, way);
    expect(`[${way}] every wave is beaten with the pistol; then the late armoury step waits (Warden not found), the drop is still there`, r.seen.join() === 'purge-troopers-hall,purge-drones,armoury-late' && r.owned === 'pistol' && r.drops === 1 && r.hud === 'SALVAGE A WEAPON' && r.stillLate === 'armoury-late', JSON.stringify(r));
    expect(`[${way}] finding the Warden (${way === 'drop' ? 'picking up the trooper drop' : 'the rack, G'}) moves the chain on, discovered once`, r.found.cur === 'purge-gate' && r.found.owned === 'pistol,rifle' && r.found.disc.join() === 'rifle' && r.found.drops === (way === 'drop' ? 0 : 1), JSON.stringify(r.found)); // via the rack the drop stays (it is ammo for the Warden now)
    expect(`[${way}] after the spider the exit is current; the mission completes at the transit node`, r.exit.cur === 'exit' && r.exit.state === 'active' && r.done.state === 'complete' && r.done.complete === 1, JSON.stringify([r.exit, r.done]));
    expect(`[${way}] no page errors`, errors.length === 0, errors.join(' | '));
    await p.close();
  };
  await run('drop');
  await run('rack');
}

await b.close();
if (fail.length) { console.log(`\n${fail.length} FAILED`); process.exit(1); }
console.log('\nall prologue warden checks passed');
