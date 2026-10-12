// Owned guns and weapon discovery (#91, #93): a level's `loadout`, switching only reaches owned guns (keys, wheel, pad),
// `pickup.gun` discovers a gun once (event, auto-switch, toast) and gives ammo after that, levels without `loadout` keep
// all six, and bad ids fail validation. Built in the Workshop and played in place (the Prologue's path).
// Needs the dev server: `npm run dev`, then `node tests/loadout.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
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
    for (const [id, pos, params] of pieces) t.place(id, pos, params);
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
    return { owned: [...w.owned], seen: [...seen], reserve: document.getElementById('reserve').textContent, slots };
  });
  expect('pistol-only loadout owns only the pistol', r.owned.join() === 'pistol', JSON.stringify(r));
  expect('  keys 1-6, wheel and pad reach nothing else', r.seen.join() === 'pistol', JSON.stringify(r));
  expect('  HUD reserve shows ∞ and only the pistol slot', r.reserve === '∞' && r.slots.join() === 'slot-pistol', JSON.stringify(r));
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

expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
console.log(fail.length ? `\n${fail.length} FAILED` : '\nall passed');
process.exit(fail.length ? 1 : 0);
