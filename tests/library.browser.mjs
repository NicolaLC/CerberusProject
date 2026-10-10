// Library (`?scene=library`, #68): every registered piece id is spawnable from its `example` meta (or with no
// params) and shown in the showroom (from the file, or by the tool's auto aisle), the captions carry id + label meta,
// the wake key (V) makes the nearest enemy exhibit fight and a second press calms it, the panel names the nearest
// exhibit, and a piece registered later shows up by itself without leaks.
// Needs the dev server: `npm run dev`, then `node tests/library.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const withScene = (scene) => {
  const u = new URL(BASE);
  u.searchParams.set('scene', scene);
  return u.href;
};
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(withScene('library'));
await p.waitForFunction(() => window.game?.engine);

const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

await p.evaluate(() => {
  const g = window.game;
  const { engine } = g;
  engine.stop();
  engine.headless = true;
  const T = (window.T = {});
  T.step = (s) => { for (let i = 0; i < Math.round(s * 60); i++) engine.step(1 / 60); };
  T.bolts = 0;
  engine.events.on('bolt:fired', () => T.bolts++);
  T.key = (code) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  // renders everything once (no culling) and reports what the GPU holds
  T.mem = () => {
    const culled = [];
    engine.scene.traverse((o) => { if (o.frustumCulled) culled.push(o); o.frustumCulled = false; });
    for (const far of [true, false]) {
      for (const e of g.enemies.puppets) e.skin?.setFar(far);
      engine.renderer.render(engine.scene, engine.camera);
    }
    for (const o of culled) o.frustumCulled = true;
    let objects = 0;
    engine.scene.traverse(() => objects++);
    const m = engine.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures, objects };
  };
});

// ---- 1. every id spawns from its example, and with no params ----
const spawn = await p.evaluate((NEEDS_PARAMS) => {
  const g = window.game;
  const { registry, world, enemies, pickups } = g;
  const out = [];
  for (const id of registry.ids()) {
    const m = registry.meta(id);
    const owner = registry.owner(id);
    for (const mode of ['example', 'bare']) {
      // pieces that are nothing without params (size, text, gun...) are only spawned from their example
      if (NEEDS_PARAMS.includes(id) && mode === 'bare') continue;
      if (NEEDS_PARAMS.includes(id) && !m.example) {
        out.push({ id, mode, skipped: true });
        continue;
      }
      const data = { id, pos: [0, 0, 60], yaw: m.example?.yaw, params: mode === 'example' ? (m.example?.params ?? {}) : {} };
      try {
        let thing;
        if (owner === 'world') thing = world.spawn(data);
        else if (owner === 'enemies') thing = enemies.spawn(data);
        else thing = registry.build('pickups', pickups, data);
        window.T.step(0.2);
        if (owner === 'world') world.despawn(thing);
        else if (owner === 'enemies') enemies.despawn(thing);
        else pickups.despawn(thing);
        out.push({ id, mode, ok: true });
      } catch (e) {
        out.push({ id, mode, ok: false, error: e.message });
      }
    }
  }
  return out;
}, ['env.box', 'env.strip', 'env.label', 'light.point', 'prop.gun']);
const bad = spawn.filter((s) => s.ok === false);
expect(`${spawn.filter((s) => s.ok).length} spawns (every id, example and bare) without errors`, bad.length === 0, JSON.stringify(bad));
expect('  every id that needs params carries an example (skipped: ' + spawn.filter((s) => s.skipped).map((s) => s.id).join(' ') + ')', true);

// ---- 2. every id is in the Library; captions carry id and label ----
const GUN_NAMES = await p.evaluate(async () => Object.fromEntries(Object.entries((await import('/src/game/combat/guns.js')).GUNS).map(([k, v]) => [k, v.name])));
const lib = await p.evaluate((GUN_NAMES) => {
  const g = window.game;
  const { registry, level, tool } = g;
  const inFile = new Set(level.pieces.map((x) => x.id));
  const auto = new Set(tool.auto.map((e) => e.id));
  const missing = registry.ids().filter((id) => !inFile.has(id) && !auto.has(id));
  const labels = level.pieces.filter((x) => x.id === 'env.label').map((x) => x.params.text);
  const uncaptioned = [];
  for (const x of level.pieces.filter((q) => q.name?.startsWith('ex:'))) {
    const meta = registry.meta(x.id);
    const owner = registry.owner(x.id);
    const must = [x.id];
    if (x.id === 'prop.gun') must.push(GUN_NAMES[x.params.gun]);
    else if (owner !== 'world' && meta.label) must.push(meta.label);
    if (!labels.some((t) => must.every((m) => t.includes(m)))) uncaptioned.push(`${x.id} ${JSON.stringify(x.params ?? {})}`);
  }
  const guns = level.pieces.filter((x) => x.id === 'prop.gun').map((x) => x.params.gun);
  return { missing, uncaptioned, guns, failed: tool.failed, labelsWorld: g.world.labels.length, hasMeta: registry.ids().filter((id) => ['enemies', 'pickups'].includes(registry.owner(id))).every((id) => registry.meta(id).label && registry.meta(id).example) };
}, GUN_NAMES);
expect('every registered id is in the Library (file or auto aisle)', lib.missing.length === 0, lib.missing.join(', '));
expect('  the tool could spawn every auto-aisle id', lib.failed.length === 0, lib.failed.join(', '));
expect('every exhibit has a caption with its id and label meta', lib.uncaptioned.length === 0, lib.uncaptioned.join(' | '));
expect('every enemy and pickup entry has label and example meta', lib.hasMeta);
const gunIds = Object.keys(GUN_NAMES);
expect('one prop.gun per gun', JSON.stringify([...lib.guns].sort()) === JSON.stringify([...gunIds].sort()), JSON.stringify(lib.guns));

// ---- 3. wake key ----
const wake = await p.evaluate(() => {
  const { game: g, T } = window;
  const { player, enemies, tool } = g;
  const tr = enemies.puppets.find((e) => e.kind === 'trooper');
  player.pos.set(tr.pos.x, 0, tr.pos.z + 6);
  T.step(3);
  const calmBolts = T.bolts;
  const calm = !tr.alerted && enemies.puppets.every((e) => !e.awake);
  T.key('KeyV');
  const ex = tool.exhibits.find((e) => e.actor === tr);
  const flagged = tr.hostile === true && ex.awake;
  T.step(6);
  const fought = tr.alerted || T.bolts > calmBolts;
  const others = enemies.puppets.filter((e) => e !== tr && (e.awake || e.alerted)).length;
  T.key('KeyV');
  const fresh = ex.actor !== tr && !ex.actor.hostile && !ex.awake && enemies.puppets.includes(ex.actor) && !enemies.puppets.includes(tr);
  T.step(2);
  return { calm, calmBolts, flagged, fought, others, fresh, freshCalm: !ex.actor.alerted, count: enemies.puppets.length, pieces: g.registry.piecesOf(g.level, 'enemies').length + tool.spawned.enemies };
});
expect('before V: 3 s next to a trooper, nothing wakes, no bolts', wake.calm && wake.calmBolts === 0, JSON.stringify(wake));
expect('V wakes the nearest enemy exhibit and it fights', wake.flagged && wake.fought, JSON.stringify(wake));
expect('  the others stay exhibits', wake.others === 0, JSON.stringify(wake));
expect('V again swaps in a calm copy, enemy count unchanged', wake.fresh && wake.freshCalm && wake.count === wake.pieces, JSON.stringify(wake));

// ---- 4. panel ----
const panel = await p.evaluate(() => {
  const { game: g, T } = window;
  const gun = g.level.pieces.find((x) => x.id === 'prop.gun' && x.params.gun === 'sniper');
  g.player.pos.set(gun.pos[0], 0, gun.pos[2] + 3);
  T.step(0.5);
  return g.tool.panel.textContent;
});
expect('panel names the nearest exhibit (id, owner, label)', /prop\.gun/.test(panel) && /world/.test(panel) && /FARSIGHT/.test(panel), panel);
const keys = await p.evaluate(() => [...document.getElementById('keyhints').querySelectorAll('b')].map((x) => x.textContent));
expect('key bar lists V', keys.includes('V'), keys.join(' '));

// ---- 5. a piece registered later appears in the auto aisle, and nothing leaks ----
const aisle = await p.evaluate(() => {
  const { game: g, T } = window;
  g.loadScene('arena');
  T.step(2);
  const base = T.mem();
  g.registry.register('world', {
    'test.auto': { example: { params: {} }, label: 'a unit cube for the auto aisle test', build: (w, d) => w.box(d.pos[0], d.pos[1], d.pos[2], 1, 1, 1, w.mats.low) },
  });
  g.registry.register('pickups', { 'test.crate': { example: { params: {} }, label: 'test crate', build: (pk, d) => pk.addCrate(d.pos, 'light') } });
  g.loadScene('library');
  T.step(2);
  const inLib = g.tool.auto.map((e) => e.id);
  const cube = g.world.colliders.length;
  const withExtra = T.mem();
  g.loadScene('arena');
  T.step(2);
  const back = T.mem();
  return { inLib, base, back, withExtra, cube, items: g.pickups.items.length };
});
expect('a newly registered world piece and pickup land in the auto aisle', aisle.inLib.includes('test.auto') && aisle.inLib.includes('test.crate'), JSON.stringify(aisle.inLib));
expect('  leaving the Library frees them (geometries, textures, scene objects back to the arena baseline)',
  aisle.base.geometries === aisle.back.geometries && aisle.base.textures === aisle.back.textures && aisle.base.objects === aisle.back.objects, JSON.stringify(aisle));

if (process.env.SHOT) {
  await p.evaluate(() => {
    const { game: g } = window;
    g.engine.headless = false;
    g.loadScene('library');
    g.player.pos.set(0, 0, 33);
    window.T.step(1);
    g.engine.renderer.render(g.engine.scene, g.engine.camera);
  });
  await p.setViewportSize({ width: 1280, height: 720 });
  await p.screenshot({ path: process.env.SHOT });
}

expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
process.exit(fail.length ? 1 : 0);
