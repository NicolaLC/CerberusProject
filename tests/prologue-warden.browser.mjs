// The Prologue weapon discovery (#93): unarmed start, the KP-12 from the bench, the weapons range lends guns and takes them back, the
// armoury rack (objective `armoury`, order 60: SALVAGE A WEAPON) that grants the KR-7 Warden (toast, weapon:discovered, raised), and
// the fallback: skipping the rack (walking on toward the arena) lets the first destroyed hall trooper (purge-4) drop a Warden, never
// twice, never if it is owned. The Prologue cannot end without it (#15: `armoury-late` before the arena gate, the exit needs it):
// both ways back are tested. The landing KR-7 (the usual way to get it) is left alone here. Pure level data, headless stepping.
// Needs the dev server: `bun run dev`, then `node tests/prologue-warden.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';
import { prologueHelpers } from './prologue-helpers.mjs';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const url = new URL(BASE);
url.searchParams.set('scene', 'prologue');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

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
    const T = (window.T = { complete: 0, failed: 0, disc: [] });
    T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { g.player.health = 100; engine.step(1 / 60); } };
    T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
    engine.events.on('weapon:discovered', (e) => T.disc.push(e.gun));
    engine.events.on('mission:failed', () => T.failed++);
    engine.events.on('mission:complete', () => T.complete++);
    T.guns = () => g.pickups.items.filter((i) => i.gun && i.gun !== 'sniper' && i.pos.x > -45); // trooper drops: not the range racks, the landing stand or the Farsight stand in hall A
    T.lines = () => g.log.entries.map((e) => e.text);
    T.slots = () => [...document.querySelectorAll('.slots span')].filter((s) => s.style.display !== 'none').map((s) => s.id).join();
  });
  await p.evaluate(prologueHelpers);
  await p.evaluate(() => {
    // to the armoury, pistol only: around the landing KR-7, the drill hall troop and the hall A troopers dead
    T.toArmoury = () => {
      T.advanceTo('armoury', { rifle: false });
      T.disc.length = 0; // the bench and the range lent guns on the way
    };
    T.skipIntro();
  });
  return { p, errors };
}

// ---- 1: a fresh run is unarmed; the bench gives the KP-12; the range takes its guns back; the armoury is next after the hall shooters ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = { start: { owned: [...g.weapon.owned].join(), current: g.weapon.current, slots: T.slots() } };
    T.advanceTo('c2-aim');
    out.bench = { owned: [...g.weapon.owned].join(), current: g.weapon.current, slots: T.slots(), disc: [...T.disc] };
    T.advanceTo('leave-bay');
    out.range = [...g.weapon.owned].sort().join();
    T.finish({ rifle: false });
    out.back = { owned: [...g.weapon.owned].join(), current: g.weapon.current, slots: T.slots() };
    T.toArmoury();
    out.armoury = { cur: T.cur(), awake: T.awake(), obj: g.mission.current.obj, text: g.mission.hudText(), pos: g.mission.current.pos.toArray(), gun: g.mission.current.params.grantGun };
    out.rack = g.world.props.length;
    T.step(10);
    out.idle = { cur: T.cur(), awake: T.awake() }; // the rack waits; no one comes
    return out;
  });
  expect('a fresh run owns nothing (no slot); the bench gives the KP-12 (one slot, discovered)', r.start.owned === '' && r.start.current === null && r.start.slots === '' && r.bench.owned === 'pistol' && r.bench.current === 'pistol' && r.bench.slots === 'slot-pistol' && r.bench.disc.join() === 'pistol', JSON.stringify([r.start, r.bench]));
  expect('the range lends light and heavy guns; its door takes them all back (pistol raised, one slot)', r.range.split(',').length >= 3 && r.back.owned === 'pistol' && r.back.current === 'pistol' && r.back.slots === 'slot-pistol', JSON.stringify([r.range, r.back]));
  expect('after the hall A troopers the armoury is current: SALVAGE A WEAPON, an interact at the rack, nobody awake', r.armoury.cur === 'armoury' && r.armoury.obj === 'interact' && /^SALVAGE A WEAPON/.test(r.armoury.text) && r.armoury.gun === 'rifle' && !r.armoury.awake.length && r.rack >= 1, JSON.stringify(r.armoury));
  expect('  the stage waits for the player (no timer, nothing wakes)', r.idle.cur === 'armoury' && !r.idle.awake.length, JSON.stringify(r.idle));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 2: taking the Warden at the rack, then the hall troopers ----
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
    out.slots = T.slots();
    // selectable: the number key reaches it again after switching to the pistol
    w.switchTo('pistol'); T.step(0.8);
    T.press('Digit1'); T.step(0.8);
    out.reselect = w.current;
    T.killGroup(4);
    T.step(0.2);
    out.drops = T.guns().length;
    out.after = T.cur();
    return out;
  });
  expect('the rack needs G: standing in range does not take it', r.noPress.cur === 'armoury' && r.noPress.owned === 'pistol', JSON.stringify(r.noPress));
  expect('G at the rack: the Warden is owned and raised with a full magazine and a modest reserve, the objective is done', r.taken.owned === 'pistol,rifle' && r.taken.current === 'rifle' && r.taken.mag === 32 && r.taken.reserve === 64, JSON.stringify(r.taken));
  expect('  the toast reads KR-7 WARDEN ACQUIRED, weapon:discovered fired once, a second slot appears', r.taken.toast === 'KR-7 WARDEN ACQUIRED' && r.taken.disc.join() === 'rifle' && r.slots === 'slot-rifle,slot-pistol', JSON.stringify([r.taken, r.slots]));
  expect('  the Warden is selectable (key 1)', r.reselect === 'rifle', r.reselect);
  expect('  then the hall troopers wake (and only they)', r.taken.cur === 'purge-troopers-hall' && r.taken.awake.join() === 'purge-4', JSON.stringify(r.taken));
  expect('  no Warden is dropped by the troopers (it is owned); the late armoury step passes by itself', r.drops === 0 && r.after === 'purge-gate', JSON.stringify([r.drops, r.after]));
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
    T.go(21.5, -52, 0.3); // on toward the arena door: the armoury-skip trigger
    out.skipped = { cur: T.cur(), owned: [...g.weapon.owned].join(), disc: [...T.disc], awake: T.awake() };
    // the pistol still kills them: first trooper down drops the Warden
    const [a, b2] = T.group(4);
    out.before = T.guns().length;
    T.kill(a);
    T.step(0.1);
    const drop = T.guns();
    out.first = drop.map((i) => ({ gun: i.gun, ammo: i.ammo, near: Math.hypot(i.pos.x - a.pos.x, i.pos.z - a.pos.z) < 0.1 }));
    T.kill(b2);
    for (const e of T.group(4)) if (e.alive) T.kill(e); // the hall B crossfire (gunners, drones): no drops
    T.step(0.1);
    out.second = T.guns().length;
    out.late = T.cur();
    g.player.pos.set(a.pos.x, a.pos.y, a.pos.z);
    T.step(0.3);
    out.pick = { owned: [...g.weapon.owned].sort().join(), current: g.weapon.pending ?? g.weapon.current, disc: [...T.disc], toast: document.getElementById('toast').textContent, reserve: g.weapon.state.rifle.reserve, left: T.guns().length, cur: T.cur() };
    return out;
  });
  expect('inside the hall the armoury stays current', r.inHall.cur === 'armoury', JSON.stringify(r.inHall));
  expect('walking on toward the arena skips the armoury: nothing is granted, the hall troopers wake', r.skipped.cur === 'purge-troopers-hall' && r.skipped.owned === 'pistol' && !r.skipped.disc.length && r.skipped.awake.join() === 'purge-4', JSON.stringify(r.skipped));
  expect('the first destroyed trooper leaves one Warden pickup where it fell, with ammo', r.before === 0 && r.first.length === 1 && r.first[0].gun === 'rifle' && r.first[0].ammo === 64 && r.first[0].near, JSON.stringify([r.before, r.first]));
  expect('  the second death drops nothing; the chain waits at the late armoury step', r.second === 1 && r.late === 'armoury-late', JSON.stringify([r.second, r.late]));
  expect('  picking it up gives the Warden (discovered once, raised, ammo), the pickup is gone, the late step passes', r.pick.owned === 'pistol,rifle' && r.pick.current === 'rifle' && r.pick.disc.join() === 'rifle' && r.pick.reserve >= 64 && r.pick.left === 0 && r.pick.cur === 'purge-gate', JSON.stringify(r.pick));
  expect('no page errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4: an owned Warden is never dropped ----
{
  const { p, errors } = await open();
  const r = await p.evaluate(() => {
    const g = window.game;
    const out = {};
    T.toArmoury();
    g.weapon.grant('rifle', { ammo: 10 }); // owned before the troopers (e.g. found elsewhere): the armoury skips itself
    T.step(0.2);
    out.cur = T.cur();
    T.killGroup(4);
    T.step(0.2);
    out.drops = T.guns().length;
    return out;
  });
  expect('a Warden the player already owns is never dropped', r.cur === 'purge-troopers-hall' && r.drops === 0, JSON.stringify(r));
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
      T.go(21.5, -52, 0.3); // skip the rack
      const a = T.group(4)[0];
      const dropAt = { x: a.pos.x, y: a.pos.y, z: a.pos.z };
      T.killGroup(4);
      T.step(0.2);
      const seen = [T.cur()];
      T.step(20); // time passes: the drop stays
      const out = { seen, drops: T.guns().length, hud: g.mission.hudText(), owned: [...g.weapon.owned].join() };
      T.go(26.5, -52, 0.3); // walking into the arena does not skip the step
      out.stillLate = T.cur();
      if (way === 'drop') T.put(dropAt.x, dropAt.y, dropAt.z, 0.4);
      else { T.go(-21.5, -37, 0.2); T.press('KeyG'); T.step(0.2); }
      out.found = { cur: T.cur(), owned: [...g.weapon.owned].sort().join(), disc: [...T.disc], drops: T.guns().length };
      T.advanceTo('exit');
      out.exit = { cur: T.cur(), state: g.mission.state };
      T.finish();
      out.done = { state: g.mission.state, complete: T.complete };
      return out;
    }, way);
    expect(`[${way}] every wave is beaten with the pistol; then the late armoury step waits (Warden not found), the drop is still there`, r.seen.join() === 'armoury-late' && r.owned === 'pistol' && r.drops === 1 && r.hud === 'SALVAGE A WEAPON' && r.stillLate === 'armoury-late', JSON.stringify(r));
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
