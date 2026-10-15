// UNDERWORKS: SEWER LINE (Act 1's first mission): src/levels/underworks.json (built by scripts/build-underworks.mjs) opens through
// ?scene=underworks and plays the wake-up in the dark: the intro cinematic (a slumped STEM-00, the power surge), then the reboot boot
// overlay (after cinematic:done) with the input locked, intro:done within the duration, the first log line, the pistol and nothing else,
// dormant groups asleep and culled while their rooms are out of sight, the objective chain (junction, drones, cistern gate, cistern,
// exit) with each stage waking only its own group, the repair station, the drones staying under the hall's roof, and the debrief.
// Pure level data, headless stepping.
// Needs the dev server: `bun run dev`, then `node tests/underworks.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';
import { prologueHelpers } from './prologue-helpers.mjs';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const url = new URL(BASE);
url.searchParams.set('scene', 'underworks');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

// A fresh page on the Underworks, stepped by hand. `seen`: the cerberus.introSeen flag set before the game starts.
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
    g.cinematic.t = 0; // the browser loop ran a few frames before stop()
    const T = (window.T = { done: [], cine: [], boot: [], wake: [], objectives: [], checkpoints: [], triggers: [], complete: 0, failed: 0, hurt: 0, mortal: false });
    T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) { if (!T.mortal) g.player.health = 100; engine.step(1 / 60); } };
    T.press = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); };
    engine.events.on('intro:done', (e) => T.done.push({ ...e, t: engine.time }));
    engine.events.on('intro:start', () => T.boot.push(engine.time));
    engine.events.on('cinematic:done', (e) => T.cine.push({ ...e, t: engine.time }));
    engine.events.on('cinematic:wake', () => T.wake.push(g.cinematic.t));
    engine.events.on('mission:objective', (e) => T.objectives.push(e.id));
    engine.events.on('mission:complete', () => T.complete++);
    engine.events.on('mission:failed', () => T.failed++);
    engine.events.on('checkpoint:reached', (e) => T.checkpoints.push(e.id));
    engine.events.on('trigger:fired', (e) => T.triggers.push(e.id));
    engine.events.on('player:hurt', () => T.hurt++);
  });
  await p.evaluate(prologueHelpers);
  await p.evaluate(() => {
    // the shared helpers know the Prologue's groups by number; here groups are names
    T.awake = () => [...new Set(window.game.enemies.all.filter((e) => e.alive && e.awake && e.squad != null).map((e) => e.squad))].sort();
  });
  return { p, errors };
}

const CHAIN = 'junction,hunters,cistern-gate,cistern,exit';

// ---- 1: unseen run: the wake-up cinematic (dormant slump, surge), then the boot overlay and lock, intro:done within 11 s, the first line ----
{
  const { p, errors } = await open(false);
  const r = await p.evaluate(() => {
    const g = window.game;
    const { engine } = g;
    const out = {};
    out.title = g.level.title;
    out.spawn = [g.player.pos.x, g.player.pos.y, g.player.pos.z];
    out.loadout = g.level.loadout;
    out.noNext = g.level.next === undefined && g.level.debrief === undefined;
    T.step(1 / 60);
    out.cine = { active: g.cinematic.active, skippable: g.cinematic.skippable, duration: g.cinematic.duration, boot: g.boot.active, locked: g.controls.locked, dormant: g.player.view.dormant, script: !!g.camRig.script };
    T.step(2);
    out.dark = { woke: g.cinematic.woke, dormant: g.player.view.dormant, boost: g.post.boost };
    for (let i = 0; i < 20 * 60 && !T.cine.length; i++) T.step(1 / 60);
    out.wake = T.wake.slice();
    out.cineDone = T.cine.map((c) => c.skipped);
    out.afterCine = { dormant: g.player.view.dormant, woke: g.cinematic.woke };
    T.step(1 / 60);
    out.start = { active: g.boot.active, locked: g.controls.locked, shown: !document.getElementById('boot').hidden, duration: g.boot.duration, canSkip: g.boot.canSkip, started: T.boot.length, lines: [...g.boot.lines] };
    out.objectiveAtStart = { head: document.getElementById('obj-head').textContent, current: g.mission.current?.oid, state: g.mission.state };
    const p0 = g.player.pos.clone();
    engine.input.keys.add('KeyW');
    T.step(2);
    engine.input.keys.delete('KeyW');
    out.lockedMove = g.player.pos.distanceTo(p0);
    out.logBefore = g.log.entries.length;
    T.step(5);
    out.hive = document.querySelector('#boot .hive')?.textContent ?? null;
    out.stillActive = g.boot.active;
    T.step(4.5);
    out.done = T.done.slice();
    out.doneAt = (T.done[0]?.t ?? 0) - T.boot[0];
    out.activeAfter = g.boot.active;
    T.step(4);
    out.log = g.log.entries.map((e) => e.text);
    const p1 = g.player.pos.clone();
    engine.input.keys.add('KeyW');
    T.step(1);
    engine.input.keys.delete('KeyW');
    out.freeMove = g.player.pos.distanceTo(p1);
    // the pistol and nothing else: keys 1-6 reach only it
    const seen = new Set();
    const gun = () => g.weapon.pending ?? g.weapon.current;
    seen.add(gun());
    for (let d = 1; d <= 6; d++) { engine.input.keys.add(`Digit${d}`); engine.input.pressed.add(`Digit${d}`); T.step(1 / 60); engine.input.keys.delete(`Digit${d}`); T.step(0.6); seen.add(gun()); }
    out.owned = [...g.weapon.owned];
    out.seenGuns = [...seen];
    out.slots = [...document.querySelectorAll('.slots span')].filter((s) => s.style.display !== 'none').map((s) => s.id);
    out.reserve = document.getElementById('reserve').textContent;
    out.gunPickups = g.pickups.items.filter((i) => i.gun).length;
    return out;
  });
  expect('?scene=underworks opens "UNDERWORKS: SEWER LINE" on the scrap pile in the fall chamber, no `next` (the end of what exists)', r.title === 'UNDERWORKS: SEWER LINE' && Math.abs(r.spawn[0]) < 0.3 && Math.abs(r.spawn[2] + 4) < 0.3 && r.noNext, JSON.stringify(r));
  expect('the wake-up cinematic plays first (not seen: no skip) with STEM-00 slumped and dark, input locked, the boot waits for it', r.cine.active && !r.cine.skippable && r.cine.duration > 8 && !r.cine.boot && r.cine.locked && r.cine.dormant > 0.9 && r.cine.script, JSON.stringify(r.cine));
  expect('  before the surge: still slumped, nothing woke, the exposure is down', !r.dark.woke && r.dark.dormant > 0.9 && r.dark.boost < 0.6, JSON.stringify(r.dark));
  expect('  the surge fires cinematic:wake once, mid-cinematic; STEM-00 is up when it ends; cinematic:done not skipped', r.wake.length === 1 && r.wake[0] > 3 && r.wake[0] < 6 && r.afterCine.woke && r.afterCine.dormant < 0.05 && r.cineDone.join() === 'false', JSON.stringify([r.wake, r.afterCine, r.cineDone]));
  expect('boot overlay follows the cinematic: reboot lines (11 s, no skip: not seen), input locked', r.start.active && r.start.shown && r.start.locked && r.start.duration === 11 && !r.start.canSkip && r.start.started === 1 && r.start.lines[0] === '> REBOOT SEQ 0x01' && r.start.lines.includes('WEAPON: KP-12 ONLY') && r.start.lines.includes('DIRECTIVE: DESTROY HIVEMIND'), JSON.stringify(r.start));
  expect('  the severed link line flickers like the lost one (.hive span)', r.hive === 'HIVEMIND LINK: SEVERED', String(r.hive));
  expect('  W for 2 s does not move the player; intro:done fires within the duration, not skipped, overlay gone', r.lockedMove < 0.01 && r.stillActive && r.done.length === 1 && r.done[0].skipped === false && r.doneAt > 10.5 && r.doneAt <= 11.1 && !r.activeAfter, JSON.stringify([r.lockedMove, r.done, r.doneAt]));
  expect('  movement works after intro:done', r.freeMove > 2, String(r.freeMove));
  expect('first log line appears after intro:done, not before', r.logBefore === 0 && r.log[0] === '> DIRECTIVE: UNCHANGED. ROUTE: UP.', JSON.stringify([r.logBefore, r.log]));
  expect('  the first objective FIRST JUNCTION is current at start and shown in the HUD', r.objectiveAtStart.state === 'active' && r.objectiveAtStart.current === 'junction' && r.objectiveAtStart.head.startsWith('FIRST JUNCTION'), JSON.stringify(r.objectiveAtStart));
  expect('pistol only (loadout ["pistol"]): keys 1-6 reach only the KP-12, its HUD slot shows the infinite reserve, no gun lies in the level', r.loadout.join() === 'pistol' && r.owned.join() === 'pistol' && r.seenGuns.join() === 'pistol' && r.slots.join() === 'slot-pistol' && r.reserve === '∞' && r.gunPickups === 0, JSON.stringify([r.owned, r.seenGuns, r.slots, r.reserve, r.gunPickups]));
  expect('no page or console errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 2: seen flag: a fire press skips the cinematic, then the boot ----
{
  const { p } = await open(true);
  const r = await p.evaluate(() => {
    const g = window.game;
    T.step(1 / 60);
    const before = { skippable: g.cinematic.skippable };
    T.step(0.5);
    T.press('Mouse0');
    T.step(1 / 60);
    const cine = { active: g.cinematic.active, done: T.cine.map((c) => c.skipped).join(), wake: T.wake.length, dormant: g.player.view.dormant };
    T.step(0.5);
    T.press('Mouse0');
    T.step(1 / 60);
    return { before, cine, boot: g.boot.active, done: T.done.map((d) => d.skipped), locked: g.controls.locked };
  });
  expect('seen: a fire press skips the cinematic (the surge still fires, STEM-00 stands), the next skips the boot (intro:done skipped), control returns', r.before.skippable && !r.cine.active && r.cine.done === 'true' && r.cine.wake === 1 && r.cine.dormant < 0.05 && !r.boot && r.done.join() === 'true' && !r.locked, JSON.stringify(r));
  await p.close();
}

// ---- 3: sectors, dormant groups culled until woken, the drone hall's ceiling ----
{
  const { p, errors } = await open(true);
  const r = await p.evaluate(() => {
    const g = window.game;
    T.skipIntro();
    const out = {};
    out.sectors = { active: g.world.sectors.active, names: g.world.sectors.list.map((s) => s.name).join() };
    const all = g.enemies.all;
    out.kinds = all.map((e) => `${e.squad}:${e.kind}:${e.dormant ? 'dormant' : 'live'}`).sort().join();
    out.hidden = all.every((e) => e.culled && !(e.group ?? e.root).visible);
    out.lights = g.world.lights.length;
    out.current = g.mission.current?.oid;
    T.step(20);
    out.after = { awake: T.awake(), hidden: all.every((e) => e.culled), hurt: T.hurt, current: g.mission.current?.oid };
    // a culled enemy still takes hits
    const kills = g.enemies.kills;
    const d = all.find((e) => e.kind === 'trooper');
    T.kill(d);
    out.culledHit = !d.alive && g.enemies.kills === kills + 1;
    return out;
  });
  expect('eight sectors (the fall chamber, three culverts, the junction, the hall, the cistern, the shaft) are active', r.sectors.active && r.sectors.names === 'c0,t1,j,t2a,t2b,t3,cistern,exit', JSON.stringify(r.sectors));
  expect('  six enemies, all dormant: two drones in the hall, three troopers and a drone in the cistern', r.kinds === 'cistern-troop:drone:dormant,cistern-troop:trooper:dormant,cistern-troop:trooper:dormant,cistern-troop:trooper:dormant,sewer-drones:drone:dormant,sewer-drones:drone:dormant', r.kinds);
  expect('  from the fall chamber every one is culled (hidden and asleep); 20 s later none woke, no hit, the mission still waits at the junction, and a culled one takes hits', r.hidden && r.after.awake.length === 0 && r.after.hidden && r.after.hurt === 0 && r.after.current === 'junction' && r.culledHit, JSON.stringify([r.hidden, r.after, r.culledHit]));
  expect('  the level is lit by a handful of lamps (the light pool picks the nearest)', r.lights >= 15 && r.lights <= 40, String(r.lights));
  expect('no page or console errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4: the whole chain in order, each stage waking only its own group; checkpoints, the repair station, the debrief ----
{
  const { p, errors } = await open(true);
  const r = await p.evaluate(() => {
    const g = window.game;
    const { weapon, player, engine } = g;
    T.skipIntro();
    const out = { snaps: {} };
    const snap = (k) => (out.snaps[k] = { cur: T.cur(), awake: T.awake() });
    out.chain = g.mission.objectives.map((o) => o.oid).join();
    out.orders = g.mission.objectives.map((o) => o.order ?? o.params?.order).join();
    snap('start');
    // the junction
    T.put(14, 0, -40, 0.2); // the checkpoint before the hall (out of order: it still counts)
    out.cpHall = T.checkpoints.includes('cp-hall');
    T.put(0, 0, -40, 0.2);
    snap('junction done');
    T.step(4);
    out.line2 = g.log.entries.map((e) => e.text);
    // the hall: the trigger wakes the two drones, nothing else
    T.put(14, 0, -40, 0.2);
    snap('before the hall');
    T.put(20.5, 0, -40, 0.2);
    out.trigger = T.triggers.includes('drones-wake');
    snap('hall entered');
    // the drones fly under the roof (6.5 m) and inside their hall for 12 s
    let minY = 99;
    let maxY = 0;
    let inside = true;
    for (let i = 0; i < 12; i++) {
      T.step(1);
      for (const e of g.enemies.all.filter((e) => e.squad === 'sewer-drones' && e.alive)) {
        const y = e.pos.y + e.alt;
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        if (e.pos.x < 18 || e.pos.x > 42 || e.pos.z < -47 || e.pos.z > -33) inside = false;
      }
    }
    out.flight = { minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), inside, alive: g.enemies.all.filter((e) => e.squad === 'sewer-drones' && e.alive).length };
    T.finish();
    snap('hunters done');
    T.step(4);
    out.line3 = g.log.entries.map((e) => e.text);
    // before the cistern: checkpoint and repair station
    T.put(36, 0, -69, 0.2);
    out.cpCistern = T.checkpoints.includes('cp-cistern');
    T.mortal = true;
    player.health = 40;
    player.shields = 0;
    T.put(38.65, 0, -66, 0.2);
    out.prompt = g.pickups.supplyPrompt(player)?.label ?? null;
    T.press('KeyG');
    out.repaired = { health: player.health, shields: player.shields, max: [player.t.maxHealth, player.t.maxShields] };
    T.mortal = false;
    // the cistern: the troop wakes when the stage becomes current
    snap('before the cistern');
    T.finish(); // cistern-gate
    snap('cistern');
    out.troop = g.enemies.all.filter((e) => e.squad === 'cistern-troop').map((e) => `${e.kind}:${e.awake}`).sort().join();
    T.step(6);
    out.cisternHurt = T.hurt;
    T.finish();
    snap('cistern done');
    T.step(4);
    out.line4 = g.log.entries.map((e) => e.text);
    T.finish();
    out.complete = { state: g.mission.state, n: T.complete, failed: T.failed };
    T.step(1.2);
    T.step(1.5);
    const el = document.getElementById('summary');
    out.screen = { shown: !el.hidden, head: el.querySelector('.head')?.textContent, buttons: [...el.querySelectorAll('button')].map((x) => x.textContent) };
    out.objectives = T.objectives.join();
    out.owned = [...weapon.owned].join();
    return out;
  });
  expect('the chain is junction, hunters, cistern-gate, cistern, exit, in that order (orders 10..50)', r.chain === CHAIN && r.orders === '10,20,30,40,50', r.chain + ' / ' + r.orders);
  expect('  the junction ends the first stage; nothing is awake (the drones sleep until the trigger)', r.snaps.start.cur === 'junction' && r.snaps.start.awake.length === 0 && r.snaps['junction done'].cur === 'hunters' && r.snaps['junction done'].awake.length === 0 && r.snaps['before the hall'].awake.length === 0, JSON.stringify(r.snaps));
  expect('  checkpoint cp-hall; the weapons line follows the junction', r.cpHall && r.line2.includes('> WEAPONS LOST: 2. WEAPONS KEPT: 1. QUERY: ENOUGH?'), JSON.stringify(r.line2));
  expect('  entering the hall fires drones-wake: exactly the sewer drones wake', r.trigger && r.snaps['hall entered'].awake.join() === 'sewer-drones', JSON.stringify(r.snaps['hall entered']));
  expect('  the drones hunt 12 s between 3 m and under the 6.5 m roof, inside the hall', r.flight.inside && r.flight.minY > 3 && r.flight.maxY < 6.2 && r.flight.alive === 2, JSON.stringify(r.flight));
  expect('  killing them ends the hunt (cistern-gate next, nothing awake) and the drone line follows', r.snaps['hunters done'].cur === 'cistern-gate' && r.snaps['hunters done'].awake.length === 0 && r.line3.includes('> DRONES DESTROYED: 2. SEARCH TARGET: STEM-00. QUERY: WHO SENT THEM?'), JSON.stringify([r.snaps['hunters done'], r.line3]));
  expect('  checkpoint cp-cistern before the fight; the repair station prompts REPAIR and restores health and shields', r.cpCistern && r.prompt === 'REPAIR' && r.repaired.health === r.repaired.max[0] && r.repaired.shields === r.repaired.max[1], JSON.stringify([r.cpCistern, r.prompt, r.repaired]));
  expect('  the cistern: the troop (3 troopers + 1 drone) wakes with its stage and nobody else', r.snaps.cistern.cur === 'cistern' && r.snaps.cistern.awake.join() === 'cistern-troop' && r.troop === 'drone:true,trooper:true,trooper:true,trooper:true', JSON.stringify([r.snaps.cistern, r.troop]));
  expect('  the troop is killable with the pistol alone (the only gun owned); the exit is next, the cistern line follows', r.owned === 'pistol' && r.snaps['cistern done'].cur === 'exit' && r.snaps['cistern done'].awake.length === 0 && r.line4.includes('> FELL: 1,140 M. CLIMBED: 0 M. ROUTE: UP.'), JSON.stringify([r.owned, r.snaps['cistern done'], r.line4]));
  expect('  FIND A WAY UP completes the mission once, no failure; the debrief opens with a RESTART button only (no next scene)', r.complete.state === 'complete' && r.complete.n === 1 && r.complete.failed === 0 && r.screen.shown && r.screen.buttons.length === 1 && /RESTART/i.test(r.screen.buttons[0]), JSON.stringify([r.complete, r.screen]));
  expect('  the objectives came up in order (the first was current from the load)', r.objectives === CHAIN.split(',').slice(1).join(), r.objectives);
  expect('no page or console errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
process.exit(fail.length ? 1 : 0);
