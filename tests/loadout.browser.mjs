// Owned guns and weapon discovery (#91, #93): a level's `loadout`, switching only reaches owned guns (keys, wheel, pad),
// `pickup.gun` discovers a gun once (event, auto-switch, toast) and gives ammo after that, levels without `loadout` keep
// all six, and bad ids fail validation. Built in the Workshop and played in place (the Prologue's path).
// Needs the dev server: `bun run dev`, then `node tests/loadout.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const url = new URL(BASE);
url.searchParams.set('scene', 'workshop');
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
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
  // a simulated standard gamepad, like the gamepad suite
  const pad = { id: 'Test Pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  window.__pad = pad;
  navigator.getGamepads = () => [pad];
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
  // a clean doc with `extra` top-level fields and the given pieces ([id, pos, params?]), then play it in place
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
    T.step(0.6);
  };
  T.key = (code) => { engine.input.keys.add(code); engine.input.pressed.add(code); T.step(1 / 60); engine.input.keys.delete(code); T.step(0.6); };
  T.wheel = () => { engine.input.wheelSteps = 1; T.step(1 / 60); T.step(0.6); };
  T.pad = (i) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; T.step(2 / 60); window.__pad.buttons[i] = { pressed: false, value: 0 }; T.step(0.6); };
  T.gun = () => g.weapon.pending ?? g.weapon.current;
  window.DISC = [];
  engine.events.on('weapon:discovered', (e) => window.DISC.push(e.gun));
});

// ---- 1. pistol-only loadout ----
{
  const r = await ev(() => {
    T.play({ loadout: ['pistol'] }, []);
    const w = window.game.weapon;
    const seen = new Set([T.gun()]);
    for (let d = 1; d <= 6; d++) { T.key(`Digit${d}`); seen.add(T.gun()); }
    T.wheel(); seen.add(T.gun());
    T.pad(3); seen.add(T.gun()); // Y: next gun
    T.pad(12); seen.add(T.gun()); // d-pad up: MG slot
    const slots = [...document.querySelectorAll('.slots span')].filter((s) => s.style.display !== 'none').map((s) => s.id);
    const rs = document.getElementById('reserve');
    const rg = document.createRange();
    rg.selectNodeContents(rs);
    const font = getComputedStyle(rs).fontFamily;
    return { owned: [...w.owned], seen: [...seen], reserve: rs.textContent, slots, glyphW: rg.getBoundingClientRect().width, font };
  });
  expect('pistol-only loadout owns only the pistol', r.owned.join() === 'pistol', JSON.stringify(r));
  expect('  keys 1-6, wheel and pad reach nothing else', r.seen.join() === 'pistol', JSON.stringify(r));
  expect('  HUD reserve shows ∞ and only the pistol slot', r.reserve === '∞' && r.slots.join() === 'slot-pistol', JSON.stringify(r));
  // #105: Space Nova draws U+221E as an empty glyph; the infinite reserve must use the main font and take width
  expect('  the ∞ is visible: non-zero width, not set in Space Nova', r.glyphW > 0 && !/^\W*Space Nova/.test(r.font), JSON.stringify(r));
}

// ---- 2. pickup.gun: discovery, then ammo ----
{
  const r = await ev(() => {
    T.play({ loadout: ['pistol'] }, [['pickup.gun', [3, 0, 0], { gun: 'rifle' }], ['pickup.gun', [8, 0, 0], { gun: 'rifle', ammo: 40 }]]);
    const g = window.game;
    const w = g.weapon;
    window.DISC.length = 0;
    const items0 = g.pickups.items.length;
    g.player.pos.set(3, 0, 0);
    T.step(0.1);
    const toast = document.getElementById('toast').textContent;
    T.step(0.6);
    const after1 = { owned: [...w.owned], gun: w.current, disc: [...window.DISC], items: g.pickups.items.length, reserve: w.state.rifle.reserve };
    g.player.pos.set(8, 0, 0);
    T.step(0.1);
    const toast2 = document.getElementById('toast').textContent;
    const after2 = { disc: [...window.DISC], items: g.pickups.items.length, reserve: w.state.rifle.reserve };
    // the rifle is now reachable by key and by cycling
    T.key('Digit6');
    const toPistol = T.gun();
    T.key('Digit1');
    const toRifle = T.gun();
    return { items0, toast, after1, toast2, after2, toPistol, toRifle };
  });
  expect('walking onto pickup.gun discovers the rifle', r.after1.owned.includes('rifle') && r.after1.disc.join() === 'rifle' && r.after1.items === r.items0 - 1, JSON.stringify(r));
  expect('  it switches to the rifle and starts with the crate refill', r.after1.gun === 'rifle' && r.after1.reserve === 96, JSON.stringify(r));
  expect('  toast KR-7 WARDEN ACQUIRED', r.toast === 'KR-7 WARDEN ACQUIRED', r.toast);
  expect('  a second rifle pickup adds ammo, no second event', r.after2.disc.length === 1 && r.after2.reserve === 136 && r.after2.items === r.after1.items - 1 && /AR AMMO/.test(r.toast2), JSON.stringify(r));
  expect('  owned rifle is selectable by key', r.toPistol === 'pistol' && r.toRifle === 'rifle', JSON.stringify(r));
}

// ---- 3. no loadout: all six (regression), in the Workshop and the arena ----
{
  const r = await ev(() => {
    T.play({}, []);
    const ws = [...window.game.weapon.owned].sort().join();
    // control for section 1: the same inputs do switch when the guns are owned
    const moves = [];
    T.pad(3); moves.push(T.gun());
    T.wheel(); moves.push(T.gun());
    T.key('Digit5'); moves.push(T.gun());
    window.game.tool.edit();
    window.game.loadScene('arena');
    T.step(0.2);
    const w = window.game.weapon;
    return { ws, moves, arena: [...w.owned].sort().join(), current: w.current, rifleReserve: w.state.rifle.reserve };
  });
  const all = 'burst,mg,pistol,rail,rifle,sniper';
  expect('a level without loadout owns all six', r.ws === all && r.moves.join() === 'mg,sniper,rail' && r.arena === all && r.current === 'rifle' && r.rifleReserve === 192, JSON.stringify(r));
}

// ---- 4. validation ----
{
  const r = await ev(() => {
    const g = window.game;
    const lvl = (extra) => ({ name: 't', spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [], ...extra });
    const err = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    return {
      loadout: err(() => g.registry.check(lvl({ loadout: ['pistol', 'laser'] }))),
      shape: err(() => g.registry.check(lvl({ loadout: 'rifle' }))),
      piece: err(() => g.registry.check(lvl({ pieces: [{ id: 'pickup.gun', pos: [0, 0, 0], params: { gun: 'laser' } }] }))),
      ok: err(() => g.registry.check(lvl({ loadout: ['rifle'], pieces: [{ id: 'pickup.gun', pos: [0, 0, 0], params: { gun: 'sniper' } }] }))),
      build: err(() => g.registry.build('pickups', g.pickups, { id: 'pickup.gun', pos: [0, 0, 0], params: { gun: 'laser' } })),
    };
  });
  expect('bad loadout id: clear error', /loadout.*unknown gun "laser"/.test(r.loadout) && /loadout/.test(r.shape), JSON.stringify(r));
  expect('bad pickup.gun gun: clear error', /pickup\.gun.*gun "laser"/.test(r.piece) && /pickup\.gun: unknown gun "laser"/.test(r.build) && r.ok === null, JSON.stringify(r));
}

// ---- 5. enemy gun drops (dropGun / dropAmmo / dropOnce, #93) ----
{
  const r = await ev(() => {
    const g = window.game;
    if (!g.tool) g.loadScene('workshop');
    const kill = (e) => { for (let i = 0; i < 80 && e.alive; i++) e.damage(100, e.pos.clone().setY(1), new e.pos.constructor(0, 0, -1), 'body'); T.step(0.1); };
    const guns = () => g.pickups.items.filter((i) => i.gun);
    const statics = (extra) => [20, 22, 24].map((x) => ['enemy.static', [x, 0, 20], extra]);
    const out = {};
    // pistol-only: the first kill drops one Warden, the second drops nothing, the player walks over it
    T.play({ loadout: ['pistol'] }, statics({ dropGun: 'rifle', dropAmmo: 40 }));
    window.DISC.length = 0;
    const [a, b, c] = g.enemies.all;
    out.before = guns().length;
    kill(a);
    out.first = guns().map((i) => ({ gun: i.gun, ammo: i.ammo, x: i.pos.x, stand: !!i.model.children[0].children.find((m) => m.geometry?.type === 'BoxGeometry') }));
    kill(b);
    out.second = guns().length;
    g.player.pos.set(a.pos.x, 0, a.pos.z);
    T.step(0.3);
    out.owned = [...g.weapon.owned].join();
    out.reserve = g.weapon.state.rifle.reserve;
    out.disc = [...window.DISC];
    out.gone = guns().length;
    kill(c);
    out.third = guns().length; // owned now: nothing more
    // a gun that is already owned: no drop
    T.play({ loadout: ['rifle'] }, statics({ dropGun: 'rifle' }));
    kill(g.enemies.all[0]);
    out.ownedNoDrop = guns().length;
    // dropOnce false: every kill drops while the gun is not owned
    T.play({ loadout: ['pistol'] }, statics({ dropGun: 'rifle', dropOnce: false }));
    kill(g.enemies.all[0]); kill(g.enemies.all[1]);
    out.repeat = guns().length;
    out.defaultAmmo = guns()[0]?.ammo;
    // a reload of the level forgets that a gun was dropped
    T.play({ loadout: ['pistol'] }, statics({ dropGun: 'rifle' }));
    kill(g.enemies.all[0]);
    out.fresh = guns().length;
    // validation
    const lvl = (params) => ({ name: 't', spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [{ id: 'enemy.trooper', pos: [0, 0, 0], params }] });
    const err = (params) => { try { g.registry.check(lvl(params)); return null; } catch (e) { return e.message; } };
    out.errs = { gun: err({ dropGun: 'laser' }), ammo: err({ dropGun: 'rifle', dropAmmo: -1 }), orphan: err({ dropAmmo: 5 }), once: err({ dropGun: 'rifle', dropOnce: 'yes' }), ok: err({ dropGun: 'rifle', dropAmmo: 10, dropOnce: false }) };
    out.fields = g.registry.meta('enemy.trooper').fields.map((f) => f.key).join();
    return out;
  });
  expect('enemy drop: nothing before a kill, the first kill leaves one Warden pickup with dropAmmo, bare on the floor (no stand)', r.before === 0 && r.first.length === 1 && r.first[0].gun === 'rifle' && r.first[0].ammo === 40 && !r.first[0].stand, JSON.stringify(r));
  expect('  a second death drops nothing (dropOnce)', r.second === 1, JSON.stringify(r));
  expect('  picking it up discovers the Warden once, with the ammo (a random clip may add to it); the pickup is gone', r.owned === 'pistol,rifle' && r.reserve >= 40 && r.disc.join() === 'rifle' && r.gone === 0, JSON.stringify(r));
  expect('  once owned, a further death drops nothing', r.third === 0, JSON.stringify(r));
  expect('a gun the player owns is never dropped', r.ownedNoDrop === 0, JSON.stringify(r));
  expect('dropOnce false: every death drops while the gun is not owned; the default ammo is the gun\'s drop size', r.repeat === 2 && r.defaultAmmo === 32, JSON.stringify(r));
  expect('a fresh level drops again', r.fresh === 1, JSON.stringify(r));
  expect('drop params are validated and shown as inspector fields', /dropGun "laser"/.test(r.errs.gun) && /dropAmmo/.test(r.errs.ammo) && /no dropGun/.test(r.errs.orphan) && /dropOnce/.test(r.errs.once) && r.errs.ok === null && /dropGun,dropAmmo,dropOnce/.test(r.fields), JSON.stringify([r.errs, r.fields]));
}

// ---- 6. objective grantGun / skipOn (#93): an optional objective ----
{
  const r = await ev(() => {
    const g = window.game;
    if (!g.tool) g.loadScene('workshop');
    const G = () => { g.engine.input.keys.add('KeyG'); g.engine.input.pressed.add('KeyG'); T.step(1 / 60); g.engine.input.keys.delete('KeyG'); T.step(0.1); };
    const pieces = [
      ['trigger.volume', [30, 0, 0], { size: [4, 3, 4], event: 'trigger', once: false }, 'rackskip'],
      ['objective.interact', [10, 0, 0], { text: 'SALVAGE', radius: 2, grantGun: 'rifle', grantAmmo: 64, skipOn: 'rackskip' }],
      ['objective.survive', [0, 0, 0], { time: 100 }],
    ];
    const out = {};
    const grants = [];
    g.engine.events.on('mission:grant', (e) => grants.push(e.gun));
    const run = (name, fn) => {
      T.play({ loadout: ['pistol'] }, pieces);
      grants.length = 0; window.DISC.length = 0;
      out[name] = fn();
    };
    const state = () => ({ cur: g.mission.current?.oid ?? g.mission.state, owned: [...g.weapon.owned].join(), reserve: g.weapon.state.rifle.reserve, mag: g.weapon.state.rifle.ammo, disc: [...window.DISC], grants: [...grants], gun: g.weapon.pending ?? g.weapon.current });
    run('take', () => {
      g.player.pos.set(0, 0, 0); G(); const far = state();
      g.player.pos.set(10, 0, 0); T.step(0.2); const near = state(); G();
      return { far, near, after: state(), objective: g.mission.index };
    });
    run('skip', () => {
      g.player.pos.set(30, 0, 0); T.step(0.2);
      return { after: state(), index: g.mission.index };
    });
    const lvl = (params) => ({ name: 't', spawn: { pos: [0, 0, 0], yaw: 0 }, pieces: [{ id: 'objective.interact', pos: [0, 0, 0], params }] });
    const err = (params) => { try { g.registry.check(lvl(params)); return null; } catch (e) { return e.message; } };
    out.errs = { gun: err({ grantGun: 'laser' }), ammo: err({ grantAmmo: 5 }), neg: err({ grantGun: 'rifle', grantAmmo: -1 }), skip: err({ skipOn: '' }), ok: err({ grantGun: 'rifle', grantAmmo: 5, skipOn: 'x' }) };
    return out;
  });
  expect('objective grantGun: out of range or without G nothing is granted', r.take.far.owned === 'pistol' && r.take.near.owned === 'pistol', JSON.stringify(r.take));
  expect('  G at the rack grants the Warden: full magazine, the ammo, selected, discovered once, objective done', r.take.after.owned === 'pistol,rifle' && r.take.after.reserve === 64 && r.take.after.mag === 32 && r.take.after.disc.join() === 'rifle' && r.take.after.grants.join() === 'rifle' && r.take.after.gun === 'rifle' && r.take.objective === 1, JSON.stringify(r.take));
  expect('  skipOn: reaching the trigger completes it without a gun (no grant, no discovery) and the next objective starts', r.skip.after.owned === 'pistol' && !r.skip.after.grants.length && !r.skip.after.disc.length && r.skip.index === 1, JSON.stringify(r.skip));
  expect('  validation: unknown gun, ammo without gun, negative ammo, empty skipOn', /grantGun "laser"/.test(r.errs.gun) && /grantAmmo needs grantGun/.test(r.errs.ammo) && /grantAmmo must be/.test(r.errs.neg) && /skipOn/.test(r.errs.skip) && r.errs.ok === null, JSON.stringify(r.errs));
}

// ---- interact never fires: a gun raised by a pickup ignores a held trigger (keyboard and pad), G / B never shoot ----
{
  const r = await ev(() => {
    const g = window.game;
    const { engine, weapon } = g;
    let shots = 0;
    const off = engine.events.on('weapon:shot', () => shots++);
    const out = {};
    // trigger held (LMB, pad RT) while walking onto a gun: raised, no shot until the trigger is pressed again
    for (const [label, hold, release] of [
      ['mouse', () => engine.input.keys.add('Mouse0'), () => engine.input.keys.delete('Mouse0')],
      ['pad', () => (window.__pad.buttons[7] = { pressed: true, value: 1 }), () => (window.__pad.buttons[7] = { pressed: false, value: 0 })],
    ]) {
      T.play({ loadout: ['pistol'] }, [['pickup.gun', [3, 0, 0], { gun: 'rifle' }]]);
      hold();
      T.step(0.1); // the press itself may fire the pistol in hand: that one is fine
      shots = 0;
      g.player.pos.set(3, 0, 0);
      T.step(1.2);
      const held = { gun: weapon.current, shots };
      release();
      T.step(0.1);
      hold();
      T.step(0.3);
      release();
      out[label] = { held, again: shots };
    }
    // G and pad B alone, and G pressed in the same frame as a click: nothing fires
    T.play({ loadout: ['pistol'] }, []);
    T.step(0.6);
    shots = 0;
    T.key('KeyG');
    T.pad(1);
    for (const code of ['Mouse0', 'KeyG']) { engine.input.keys.add(code); engine.input.pressed.add(code); }
    T.step(1 / 60);
    for (const code of ['Mouse0', 'KeyG']) engine.input.keys.delete(code);
    T.step(0.5);
    out.interact = shots;
    off?.();
    return out;
  });
  expect('a gun raised by a pickup with the trigger held does not fire until pressed again (mouse, pad RT)', ['mouse', 'pad'].every((k) => r[k].held.gun === 'rifle' && r[k].held.shots === 0 && r[k].again > 0), JSON.stringify(r));
  expect('  interact (G, pad B) never fires, not even with a click in the same frame', r.interact === 0, JSON.stringify(r));
}

expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
process.exit(fail.length ? 1 : 0);
