// Workshop editor (`?scene=workshop`, tool "workshop", #70): the scene always equals the doc (counts, handles, colliders)
// through place / move / rotate / duplicate / delete and undo / redo, snapping and the rotation rules hold (kit stays
// axis-aligned), the palette lists every registry id, the key bar lists every key the editor handles, real mouse
// and key input work, edit mode is gated to the workshop scene, and nothing leaks (renderer memory + scene objects).
// Needs the dev server: `npm run dev`, then `node tests/workshop.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const withScene = (scene) => {
  const u = new URL(BASE);
  u.searchParams.set('scene', scene);
  return u.href;
};
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(withScene('workshop'));
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
  T.key = (code, extra = {}) => dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...extra }));
  T.tap = (code, extra = {}) => { T.key(code, extra); T.keyUp(code); };
  T.keyUp = (code) => dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
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
    const geos = new Set();
    engine.scene.traverse((o) => { objects++; if (o.geometry) geos.add(o.geometry); });
    const m = engine.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures, objects, inScene: geos.size };
  };
  T.tool = () => g.tool;
  T.doc = () => JSON.stringify(g.tool.doc);
  T.ok = () => g.tool.verify();
  T.step(2);
});
const ev = (fn, arg) => p.evaluate(fn, arg);

// ---- 1. gating: the editor only runs in the workshop scene ----
{
  const r = await ev(() => {
    const g = window.game;
    const t = g.tool;
    const out = {
      tool: t?.constructor.name, editing: t?.editing, gameEditing: g.editing,
      hudHidden: document.getElementById('hud').style.display === 'none', frozen: g.enemies.frozen,
      playerHidden: !g.player.root.visible, sameDoc: JSON.stringify(t.doc) === JSON.stringify(g.level), distinct: t.doc !== g.level && t.doc.pieces !== g.level.pieces,
      verify: t.verify(), palette: !!document.getElementById('workshop-palette'),
    };
    g.loadScene('arena');
    window.T.step(2);
    out.arena = { tool: g.tool, editing: g.editing, hud: document.getElementById('hud').style.display, palette: !!document.getElementById('workshop-palette'), frozen: g.enemies.frozen, visible: g.player.root.visible };
    g.loadScene('workshop');
    window.T.step(2);
    return out;
  });
  expect('workshop scene: tool "workshop" is up and editing', r.tool === 'WorkshopEditor' && r.editing && r.gameEditing, JSON.stringify(r));
  expect('  doc is a deep copy of the loaded level', r.sameDoc && r.distinct);
  expect('  scene = doc right after load', r.verify.ok, JSON.stringify(r.verify));
  expect('  HUD hidden, enemies frozen, player hidden', r.hudHidden && r.frozen && r.playerHidden, JSON.stringify(r));
  expect('  palette panel exists', r.palette);
  expect('arena: no editor, HUD back, enemies unfrozen, player visible', r.arena.tool === null && !r.arena.editing && r.arena.hud === '' && !r.arena.palette && !r.arena.frozen && r.arena.visible, JSON.stringify(r.arena));
}

// ---- 2. one of each owner kind: kit, env, enemy, pickup (scene matches doc) ----
{
  const r = await ev(() => {
    const t = T.tool();
    const { world, enemies, pickups } = window.game;
    const out = [];
    const base0 = JSON.parse(T.doc());
    for (const [id, pos] of [['kit.wall', [3, 0, 3]], ['env.box', [-3, 0, 3]], ['enemy.trooper', [6, 0, 6]], ['pickup.heavy', [-6, 0, 6]]]) {
      const c0 = world.colliders.length, e0 = enemies.puppets.length, k0 = pickups.items.length, n0 = t.count;
      const i = t.place(id, pos);
      T.step(1);
      const actor = enemies.puppets[enemies.puppets.length - 1];
      out.push({
        id, i, n: t.count - n0, colliders: world.colliders.length - c0, enemies: enemies.puppets.length - e0, pickups: pickups.items.length - k0,
        pos: t.doc.pieces[i].pos, verify: T.ok(),
        actorAt: id.startsWith('enemy') ? [actor.group.position.x, actor.group.position.z] : null,
      });
    }
    return { out, same: JSON.stringify(base0.pieces) === JSON.stringify(t.doc.pieces.slice(0, base0.pieces.length)) };
  });
  const by = Object.fromEntries(r.out.map((x) => [x.id, x]));
  expect('place kit.wall: +1 piece, +1 collider, scene = doc', by['kit.wall'].n === 1 && by['kit.wall'].colliders === 1 && by['kit.wall'].verify.ok, JSON.stringify(by['kit.wall']));
  expect('place env.box: +1 piece, +1 collider', by['env.box'].n === 1 && by['env.box'].colliders === 1 && by['env.box'].verify.ok, JSON.stringify(by['env.box']));
  expect('place enemy.trooper: +1 piece, +1 enemy, posed at its piece', by['enemy.trooper'].enemies === 1 && by['enemy.trooper'].colliders === 0 && by['enemy.trooper'].verify.ok && Math.hypot(by['enemy.trooper'].actorAt[0] - 6, by['enemy.trooper'].actorAt[1] - 6) < 0.05, JSON.stringify(by['enemy.trooper']));
  expect('place pickup.heavy: +1 piece, +1 crate', by['pickup.heavy'].pickups === 1 && by['pickup.heavy'].verify.ok, JSON.stringify(by['pickup.heavy']));
  expect('  placing appends and leaves the earlier pieces alone', r.same);
}

// ---- 3. every registry id places, scene = doc; undo all returns to the identical doc, redo all too ----
{
  const r = await ev(() => {
    const t = T.tool();
    const { registry } = window.game;
    t.undoStack.length = t.redoStack.length = 0;
    const start = T.doc();
    const failed = [];
    let x = -30;
    for (const id of registry.ids()) {
      try { t.place(id, [x, 0, -30]); } catch (err) { failed.push(`${id}: ${err.message}`); }
      x += 3;
    }
    T.step(2);
    const placed = T.doc();
    const v1 = T.ok();
    let undone = 0;
    while (t.undoStack.length) { t.undo(); undone++; }
    const v2 = T.ok();
    const back = T.doc();
    let redone = 0;
    while (t.redoStack.length) { t.redo(); redone++; }
    const v3 = T.ok();
    return { n: registry.ids().length, failed, start, placed, back, again: T.doc(), v1, v2, v3, undone, redone };
  });
  expect(`all ${r.n} registry ids place`, r.failed.length === 0, r.failed.join('; '));
  expect('  scene = doc with everything placed', r.v1.ok, JSON.stringify(r.v1));
  expect('undo x all returns the identical doc (JSON)', r.back === r.start && r.v2.ok, `${r.undone}`);
  expect('redo x all returns the identical doc (JSON)', r.again === r.placed && r.v3.ok && r.redone === r.undone, `${r.redone}`);
}

// ---- 4. snapping and rotation rules ----
{
  const r = await ev(() => {
    const t = T.tool();
    const out = {};
    const at = (id, pos, params, yaw) => t.doc.pieces[t.place(id, pos, params, yaw)];
    out.grid0 = t.grid;
    out.h = at('env.box', [1.3, 0.37, -2.2]).pos; // 0.5 m
    T.tap('KeyG'); out.grid1 = t.grid; out.q = at('env.box', [1.3, 0, 2.38]).pos; // 0.25
    T.tap('KeyG'); out.grid2 = t.grid; out.m = at('env.box', [1.3, 0, 2.6]).pos; // 1
    T.tap('KeyG'); out.grid3 = t.grid; out.off = at('env.box', [1.37, 0, 2.61]).pos; // off
    T.tap('KeyG'); out.grid4 = t.grid; // back to 0.5
    // kit: yaw always a multiple of 90 degrees
    const k = t.place('kit.wall', [20, 0, 20], undefined, 0.3);
    out.kitYaw0 = t.doc.pieces[k].yaw;
    const k2 = t.place('kit.wall', [20, 0, 24], undefined, 1.5);
    out.kitYawSnap = t.doc.pieces[k2].yaw;
    t.rotate(k, 1);
    T.step(1);
    const col = window.game.world.colliders.find((c) => c.mesh === t.items[k].thing.objects[0]);
    const sz = col.box.getSize(new window.game.camRig.pivot.constructor());
    out.kitTurned = { yaw: t.doc.pieces[k].yaw, size: [sz.x, sz.z] };
    t.rotate(k, -1); out.kitBack = t.doc.pieces[k].yaw;
    t.rotate(k, 4); out.kitFull = t.doc.pieces[k].yaw;
    out.kitErrors = [];
    out.kitYaws = [];
    for (const id of window.game.registry.ids().filter((x) => x.startsWith('kit.'))) {
      const i = t.place(id, [-40, 0, 20]);
      for (let s = 0; s < 5; s++) {
        try { t.rotate(i, 1); } catch (err) { out.kitErrors.push(`${id}: ${err.message}`); }
        const y = t.doc.pieces[i].yaw ?? 0;
        out.kitYaws.push(Math.abs(y / (Math.PI / 2) - Math.round(y / (Math.PI / 2))) < 1e-9);
      }
    }
    // env.box: a quarter turn swaps width and depth (the builder ignores yaw)
    const e = t.place('env.box', [30, 0, 30], { size: [4, 1, 2], mat: 'low', faces: { px: 'high' } });
    t.rotate(e, 1);
    out.box = { size: t.doc.pieces[e].params.size, yaw: t.doc.pieces[e].yaw, faces: t.doc.pieces[e].params.faces };
    t.rotate(e, -1);
    out.boxBack = t.doc.pieces[e].params.size;
    // enemy, pickup, prop: 15 degrees
    const en = t.place('enemy.trooper', [30, 0, 34]);
    t.rotate(en, 1);
    out.enemy = t.doc.pieces[en].yaw;
    t.rotate(en, 24);
    out.enemyFull = t.doc.pieces[en].yaw;
    const pk = t.place('pickup.light', [34, 0, 34]);
    t.rotate(pk, 3);
    out.pickup = t.doc.pieces[pk].yaw;
    const gun = t.place('prop.gun', [38, 0, 34]);
    t.rotate(gun, 1);
    out.prop = t.doc.pieces[gun].yaw;
    out.verify = T.ok();
    return out;
  });
  expect('snap: default 0.5 m horizontal; y is not snapped', r.grid0 === 0.5 && r.h[0] === 1.5 && r.h[2] === -2 && r.h[1] === 0.37, JSON.stringify(r.h));
  expect('  G cycles 0.25 / 1 / off / 0.5', r.grid1 === 0.25 && r.grid2 === 1 && r.grid3 === 0 && r.grid4 === 0.5 && r.q[0] === 1.25 && r.q[2] === 2.5 && r.m[0] === 1 && r.m[2] === 3 && r.off[0] === 1.37 && r.off[2] === 2.61, JSON.stringify([r.q, r.m, r.off]));
  expect('kit: a free yaw is fitted to 90 degrees on place', r.kitYaw0 === undefined && Math.abs(r.kitYawSnap - Math.PI / 2) < 1e-9, `${r.kitYaw0} ${r.kitYawSnap}`);
  expect('  rotate turns 90 degrees, the collider stays axis-aligned (length 4 now along z), full turn = no yaw', Math.abs(r.kitTurned.yaw - Math.PI / 2) < 1e-9 && Math.abs(r.kitTurned.size[0] - 0.5) < 1e-6 && Math.abs(r.kitTurned.size[1] - 4) < 1e-6 && r.kitBack === undefined && r.kitFull === undefined, JSON.stringify(r.kitTurned));
  expect('  every kit.* id rotates without error and keeps a multiple of 90 degrees', r.kitErrors.length === 0 && r.kitYaws.every(Boolean), r.kitErrors.join('; '));
  expect('env.box: a quarter turn swaps width and depth (faces follow), no yaw stored', JSON.stringify(r.box.size) === '[2,1,4]' && r.box.yaw === undefined && r.box.faces.nz === 'high' && JSON.stringify(r.boxBack) === '[4,1,2]', JSON.stringify(r.box));
  expect('enemy / pickup / prop: 15 degree steps', Math.abs(r.enemy - Math.PI / 12) < 1e-9 && r.enemyFull === Math.PI / 12 && Math.abs(r.pickup - Math.PI / 4) < 1e-9 && Math.abs(r.prop - Math.PI / 12) < 1e-9, JSON.stringify([r.enemy, r.enemyFull, r.pickup, r.prop]));
  expect('  scene = doc after all that', r.verify.ok, JSON.stringify(r.verify));
}

// ---- 5. move / duplicate / delete / undo of each; delete frees the piece ----
{
  const r = await ev(() => {
    const t = T.tool();
    const { world, enemies, pickups } = window.game;
    const out = {};
    const colliders = () => world.colliders.length;
    // move: collider follows, snapped
    const i = t.place('env.box', [10, 0, 10], { size: [2, 1, 2], mat: 'low', cover: 'low' });
    const col = () => world.colliders.find((c) => c.mesh === t.items[i].thing.objects[0]).box.getCenter(new world.colliders[0].box.min.constructor());
    t.move(i, [12.3, 0, 8.8]);
    out.moved = { pos: t.doc.pieces[i].pos, center: [col().x, col().z] };
    // a mover's rail and a boss's arena travel with it
    const m = t.place('enemy.mover', [0, 0, 20], { to: [4, 0, 20], speed: 1 });
    t.move(m, [2, 0, 22]);
    out.rail = t.doc.pieces[m].params.to;
    const bs = t.place('boss.spider', [50, 0, 50], { arena: { minX: 40, maxX: 60, minZ: 40, maxZ: 60 } });
    t.move(bs, [51, 0, 50]);
    out.arena = t.doc.pieces[bs].params.arena;
    T.step(1);
    out.mover = [enemies.puppets.find((a) => a.kind === 'mover').group.position.x];
    // duplicate: after the original, +1 m, no name
    const c0 = colliders(); const n0 = t.count;
    const d = t.duplicate(i);
    out.dup = { index: d, expect: i + 1, n: t.count - n0, colliders: colliders() - c0, pos: t.doc.pieces[d].pos, verify: T.ok() };
    // delete frees the piece
    T.step(1);
    const before = T.mem();
    const kinds = {};
    for (const id of ['kit.stairs', 'env.box', 'enemy.trooper', 'pickup.light', 'env.label', 'prop.gun', 'light.point']) {
      const c = colliders(); const e = enemies.puppets.length; const k = pickups.items.length;
      const idx = t.place(id, [0, 0, 40]);
      const added = { colliders: colliders() - c, enemies: enemies.puppets.length - e, pickups: pickups.items.length - k };
      const objs = id === 'enemy.trooper' || id === 'pickup.light' ? [] : t.items[idx].thing.objects.slice();
      t.remove(idx);
      kinds[id] = { added, freed: colliders() === c && enemies.puppets.length === e && pickups.items.length === k, detached: objs.every((o) => !o.parent), verify: T.ok().ok };
    }
    out.kinds = kinds;
    T.step(1);
    out.sameCount = t.count === n0 + 1;
    return out;
  });
  expect('move: snapped, collider follows', JSON.stringify(r.moved.pos) === '[12.5,0,9]' && Math.abs(r.moved.center[0] - 12.5) < 1e-6 && Math.abs(r.moved.center[1] - 9) < 1e-6, JSON.stringify(r.moved));
  expect('  a mover\'s rail and a boss arena move with it', JSON.stringify(r.rail) === '[6,0,22]' && r.arena.minX === 41 && r.arena.maxX === 61, JSON.stringify([r.rail, r.arena]));
  expect('duplicate: lands after the original, +1 m, scene = doc', r.dup.index === r.dup.expect && r.dup.n === 1 && r.dup.colliders === 1 && r.dup.pos[0] === 13.5 && r.dup.verify.ok, JSON.stringify(r.dup));
  for (const [id, k] of Object.entries(r.kinds)) expect(`delete frees ${id} (colliders, enemies, crates, scene objects)`, k.freed && k.detached && k.verify, JSON.stringify(k));
}

// ---- 6. leaks: place / delete cycles and leaving the scene ----
{
  const r = await ev(() => {
    const t = T.tool();
    const IDS = ['kit.stairs', 'kit.platform', 'env.box', 'env.label', 'prop.gun', 'enemy.trooper', 'enemy.static', 'enemy.drone', 'pickup.light', 'light.point'];
    const cycle = () => { for (const id of IDS) { const i = t.place(id, [0, 0, 60]); t.remove(i); } };
    // an undo / redo / move / rotate round trip counts too
    const churn = () => { const i = t.place('kit.wall', [5, 0, 60]); t.rotate(i, 1); t.move(i, [6, 0, 61]); t.duplicate(i); t.undo(); t.undo(); t.undo(); t.redo(); t.remove(i); t.undoStack.length = t.redoStack.length = 0; };
    cycle(); churn(); T.step(2);
    t.undoStack.length = t.redoStack.length = 0;
    const a = T.mem();
    for (let n = 0; n < 3; n++) { cycle(); churn(); }
    t.undoStack.length = t.redoStack.length = 0;
    T.step(2);
    const c = T.mem();
    return { a, c, ok: T.ok() };
  });
  expect('place / delete cycles (10 kinds x3) leave no geometry, texture or scene object behind', r.a.geometries === r.c.geometries && r.a.textures === r.c.textures && r.a.objects === r.c.objects, JSON.stringify(r));
  expect('  scene = doc', r.ok.ok, JSON.stringify(r.ok));
}
{
  // leaving the scene frees everything the editor made: a quiet scene (no enemies, so no random gameplay) before and after a long editing session
  const r = await ev(() => {
    const g = window.game;
    g.loadScene('gym'); T.step(3);
    const a = T.mem();
    g.loadScene('workshop'); T.step(2);
    const t = T.tool();
    for (const id of g.registry.ids()) t.place(id, [-30 + t.count % 20 * 3, 0, -30]);
    t.select(3); t.armedBefore = t.armed;
    t.arm('kit.wall'); T.step(2);
    t.undo(); t.undo(); t.redo();
    T.step(2);
    T.mem(); // upload everything the session built, so that leaving has something to free
    g.loadScene('gym'); T.step(3);
    const b2 = T.mem();
    g.loadScene('workshop'); T.step(2);
    g.loadScene('gym'); T.step(3);
    const c = T.mem();
    g.loadScene('workshop'); T.step(2);
    return { a, b2, c, dom: !!document.getElementById('workshop-palette'), n: document.querySelectorAll('#workshop-palette').length };
  });
  expect('leaving the scene after editing: gym memory and scene size are back', r.a.geometries === r.b2.geometries && r.a.textures === r.b2.textures && r.a.objects === r.b2.objects, JSON.stringify(r));
  expect('  and after a second visit', r.b2.geometries === r.c.geometries && r.b2.textures === r.c.textures && r.b2.objects === r.c.objects, JSON.stringify(r));
  expect('  one palette panel while editing, none leaked', r.dom && r.n === 1, JSON.stringify(r));
}

// ---- 7. palette: every registry id, grouped, with its label; picking arms the example ----
{
  const r = await ev(() => {
    const g = window.game;
    const ids = g.registry.ids();
    const buttons = [...document.querySelectorAll('#workshop-palette button[data-id]')];
    const listed = buttons.map((x) => x.dataset.id);
    const headers = [...document.querySelectorAll('#workshop-palette > div')].map((x) => x.textContent);
    const labels = buttons.every((x) => x.title === (g.registry.meta(x.dataset.id).label ?? '') && x.textContent.includes(x.dataset.id));
    const t = T.tool();
    const btn = buttons.find((x) => x.dataset.id === 'kit.platform');
    btn.click();
    const armed = { id: t.armed?.id, params: JSON.stringify(t.armed?.params) === JSON.stringify(g.registry.meta('kit.platform').example.params) };
    btn.click(); // again: disarms
    return { ids, listed, headers, labels, armed, disarmed: t.armed === null, owners: [...new Set(ids.map((i) => `${g.registry.owner(i)}  ${i.split('.')[0]}.*`))] };
  });
  expect(`palette lists every registry id once (${r.ids.length})`, r.listed.length === r.ids.length && r.ids.every((i) => r.listed.includes(i)) && new Set(r.listed).size === r.listed.length, `${r.listed.length} vs ${r.ids.length}`);
  expect('  grouped by owner and prefix, with the label meta', r.owners.every((o) => r.headers.includes(o)) && r.labels, JSON.stringify(r.headers));
  expect('  picking an entry arms its example params, picking it again disarms', r.armed.id === 'kit.platform' && r.armed.params && r.disarmed, JSON.stringify(r.armed));
}

// ---- 8. key bar: the editor's KEYS are shown, and every key the editor handles is in KEYS ----
{
  const r = await ev(() => {
    const bar = document.getElementById('keyhints');
    return { shown: !bar.hidden, keys: [...bar.querySelectorAll('b')].map((x) => x.textContent), tool: window.game.tool.constructor.KEYS.map(([k]) => k) };
  });
  expect('key bar shows every key of the editor', r.shown && r.tool.length > 8 && r.tool.every((k) => r.keys.includes(k)), JSON.stringify(r));
  const src = readFileSync(new URL('../src/game/workshop/editor.js', import.meta.url), 'utf8');
  const listed = new Set([...src.matchAll(/static KEYS = \[(.*)\];/g)].flatMap((m) => [...m[1].matchAll(/\['([^']+)'/g)].flatMap((x) => x[1].split(/[\s/+]+/))));
  const label = (code) => {
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Arrow')) return 'Arrows';
    if (code.startsWith('Shift')) return 'Shift';
    return { PageUp: 'PgUp', PageDown: 'PgDn', Delete: 'Del', Escape: 'Esc' }[code] ?? code;
  };
  const used = [...new Set([...src.matchAll(/'(Key[A-Z]|Arrow\w+|Page\w+|Delete|Backspace|Escape|Shift\w+)'/g)].map((m) => m[1]))].filter((c) => !/^(ControlLeft|MetaLeft)$/.test(c));
  const missing = used.filter((c) => !listed.has(label(c)));
  expect('every key the editor handles is listed in static KEYS', missing.length === 0, missing.join(', '));
  // and none of them is a key the game itself acts on while editing (controls.js debug keys)
  const clash = used.filter((c) => ['KeyH', 'F3', 'Backquote'].includes(c));
  expect('  none of them is a global debug key (H, F3, `)', clash.length === 0, clash.join(', '));
}

// ---- 9. real input: fly camera, key shortcuts, mouse placing, selecting and dragging ----
{
  await ev(() => { const t = T.tool(); t.arm(null); t.select(-1); t.undoStack.length = t.redoStack.length = 0; });
  // free-fly
  const fly = await ev(() => {
    const cam = window.game.engine.camera;
    const a = cam.position.clone();
    T.key('KeyW'); T.step(0.5); T.keyUp('KeyW');
    const b2 = cam.position.clone();
    T.key('KeyE'); T.step(0.5); T.keyUp('KeyE');
    const c = cam.position.clone();
    T.step(0.5);
    const d = cam.position.clone();
    T.key('ShiftLeft'); T.key('KeyD'); T.step(0.5); T.keyUp('KeyD'); T.keyUp('ShiftLeft');
    const e = cam.position.clone();
    return { fwd: b2.distanceTo(a), up: c.y - b2.y, rest: c.distanceTo(d), fast: e.distanceTo(d), playerHidden: !window.game.player.root.visible, hud: document.getElementById('hud').style.display };
  });
  expect('fly: W moves forward, E up, release stops, Shift is faster', fly.fwd > 2 && fly.up > 2 && fly.rest < 1e-9 && fly.fast > 10 && fly.playerHidden, JSON.stringify(fly));
  // player and weapon are inert: movement keys and fire do nothing
  const inert = await ev(() => {
    const g = window.game;
    const p0 = g.player.pos.clone();
    const ammo = g.weapon.mag ?? null;
    const shots = [];
    g.engine.events.on('weapon:shot', () => shots.push(1));
    T.key('KeyF'); T.key('Digit2'); T.step(0.3); T.keyUp('KeyF'); T.keyUp('Digit2');
    return { shots: shots.length };
  });
  expect('  weapon is inert (F fires nothing)', inert.shots === 0, JSON.stringify(inert));

  // keyboard shortcuts
  const k = await ev(() => {
    const t = T.tool();
    const n0 = t.count;
    const i = t.place('env.box', [0, 0, 20]);
    t.select(i);
    T.tap('ArrowRight');
    const moved = t.doc.pieces[i].pos.slice();
    T.tap('PageUp');
    const raised = t.doc.pieces[i].pos[1];
    T.tap('KeyR');
    const rotated = JSON.stringify(t.doc.pieces[i].params.size);
    T.tap('KeyD', { ctrlKey: true });
    const dup = t.count - n0;
    T.tap('Delete');
    const afterDel = t.count - n0;
    T.tap('KeyZ', { ctrlKey: true });
    const afterUndo = t.count - n0;
    T.tap('KeyZ', { ctrlKey: true, shiftKey: true });
    const afterRedo = t.count - n0;
    T.tap('KeyY', { ctrlKey: true });
    return { moved, raised, rotated, dup, afterDel, afterUndo, afterRedo, ok: T.ok().ok };
  });
  expect('keys: arrow nudges one grid step, PgUp 0.1 m, R turns, Ctrl+D duplicates, Del deletes, Ctrl+Z / Shift+Z / Y undo and redo',
    JSON.stringify(k.moved) === '[0.5,0,20]' && Math.abs(k.raised - 0.1) < 1e-9 && k.dup === 2 && k.afterDel === 1 && k.afterUndo === 2 && k.afterRedo === 1 && k.ok, JSON.stringify(k));

  // save / open call io.js; "not implemented" (or any failure) is a toast, never an error
  const io = await ev(async () => {
    const t = T.tool();
    t.toastText = '';
    const ev1 = new KeyboardEvent('keydown', { code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true });
    dispatchEvent(ev1);
    await new Promise((r) => setTimeout(r, 100));
    const save = t.toastText;
    return { save, prevented: ev1.defaultPrevented };
  });
  expect('Ctrl+S calls saveLevel; the result or error is a toast, the browser save dialog is suppressed', io.save !== '' && io.prevented, JSON.stringify(io));
  await ev(() => { T.tap('KeyO', { ctrlKey: true }); });
  await p.waitForTimeout(150);

  // mouse: arm from the palette, ghost follows the cursor, click places on the floor and on top of a box
  const view = await ev(() => {
    const g = window.game;
    const cam = g.engine.camera;
    cam.position.set(0, 10, 12);
    const t = T.tool();
    t.cam.yaw = 0; t.cam.pitch = -0.7;
    T.step(1);
    const proj = (x, y, z) => { const v = new cam.position.constructor(x, y, z).project(cam); const r = g.engine.canvas.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top]; };
    return { floor: proj(8, 0, 6), box: proj(-6, 1.1, -4), w: innerWidth, h: innerHeight };
  });
  await p.click('#workshop-palette button[data-id="kit.cover.low"]');
  await p.mouse.move(view.floor[0], view.floor[1]);
  await ev(() => T.step(1));
  const ghost = await ev(() => { const t = T.tool(); return { armed: t.armed?.id, pos: t.ghostPos, visible: t.ghost.visible }; });
  expect('mouse: the ghost follows the cursor onto the floor, snapped to 0.5 m', ghost.armed === 'kit.cover.low' && ghost.visible && ghost.pos && Math.abs(ghost.pos[1]) < 1e-6 && Math.abs(ghost.pos[0] * 2 - Math.round(ghost.pos[0] * 2)) < 1e-9, JSON.stringify(ghost));
  const n0 = await ev(() => T.tool().count);
  await p.mouse.down();
  await p.mouse.up();
  await ev(() => T.step(1));
  const placed = await ev((n) => { const t = T.tool(); return { n: t.count - n, last: t.doc.pieces[t.count - 1], ok: T.ok().ok }; }, n0);
  expect('  click places the armed piece at the ghost', placed.n === 1 && placed.last.id === 'kit.cover.low' && Math.abs(placed.last.pos[0] - ghost.pos[0]) < 1e-9 && placed.ok, JSON.stringify(placed));
  // on top of the low box at (-6, 0, -4), 1.1 m high
  await p.mouse.move(view.box[0], view.box[1]);
  await ev(() => T.step(1));
  const top = await ev(() => T.tool().ghostPos);
  expect('  over a box the ghost stands on top of it (y 1.1)', top && Math.abs(top[1] - 1.1) < 0.02, JSON.stringify(top));
  await p.keyboard.press('Escape');
  const disarmed = await ev(() => T.tool().armed === null);
  expect('  Esc disarms', disarmed);

  // select by click, then drag on the ground plane
  await ev(() => { const t = T.tool(); t.select(-1); });
  await p.mouse.move(view.floor[0], view.floor[1]);
  await ev(() => T.step(1));
  const sel = await ev(() => { const t = T.tool(); return { sel: t.sel, id: t.doc.pieces[t.sel]?.id }; });
  expect('select: nothing is selected until a click', sel.sel === -1);
  const target = await ev(() => {
    const g = window.game; const t = T.tool(); const cam = g.engine.camera;
    const i = t.count - 1; // the cover placed by the click
    const c = t.items[i].thing.objects[0].position;
    const proj = (x, y, z) => { const v = new cam.position.constructor(x, y, z).project(cam); const r = g.engine.canvas.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width + r.left, (1 - v.y) / 2 * r.height + r.top]; };
    return { i, from: proj(c.x, c.y, c.z), to: proj(c.x - 4, c.y, c.z), pos: t.doc.pieces[i].pos.slice() };
  });
  await p.mouse.move(target.from[0], target.from[1]);
  await p.mouse.down();
  await ev(() => T.step(1));
  const s2 = await ev(() => T.tool().sel);
  await p.mouse.move((target.from[0] + target.to[0]) / 2, (target.from[1] + target.to[1]) / 2, { steps: 4 });
  await p.mouse.move(target.to[0], target.to[1], { steps: 4 });
  await ev(() => T.step(2));
  const mid = await ev(() => { const t = T.tool(); return { ghost: t.ghost.visible, pos: t.doc.pieces[t.sel].pos.slice() }; });
  await p.mouse.up();
  await ev(() => T.step(1));
  const moved = await ev((i) => { const t = T.tool(); return { pos: t.doc.pieces[i].pos, ok: T.ok().ok, undo: t.undoStack.length }; }, target.i);
  expect('click selects the piece under the cursor', s2 === target.i, `${s2} vs ${target.i}`);
  expect('  dragging shows a ghost, the piece moves on release, snapped, as one undoable step', mid.ghost && JSON.stringify(mid.pos) === JSON.stringify(target.pos) && moved.pos[0] < target.pos[0] - 2 && Math.abs(moved.pos[0] * 2 - Math.round(moved.pos[0] * 2)) < 1e-9 && Math.abs(moved.pos[2] - target.pos[2]) < 0.6 && moved.ok, JSON.stringify({ mid, moved, target }));
  await ev(() => T.tool().undo());
  const undone = await ev((i) => T.tool().doc.pieces[i].pos, target.i);
  expect('  undo puts it back', JSON.stringify(undone) === JSON.stringify(target.pos), JSON.stringify(undone));
  // cover flags
  const cover = await ev(() => {
    const t = T.tool();
    const wall = t.doc.pieces.findIndex((x) => x.id === 'env.box' && x.params.cover === 'wall');
    const low = t.doc.pieces.findIndex((x) => x.id === 'env.box' && x.params.cover === 'low');
    t.select(wall); const a = { cover: t.coverOf(wall), color: t.helper.material.color.getHex(), vis: t.helper.visible, text: t.status.textContent.includes('cover wall') };
    t.select(low); const b2 = { cover: t.coverOf(low), color: t.helper.material.color.getHex() };
    t.select(0); const c = { cover: t.coverOf(0), color: t.helper.material.color.getHex() };
    t.select(-1);
    return { a, b2, c, hidden: !t.helper.visible };
  });
  expect('selection helper: box helper tinted by cover (wall / low / none), cover in the panel, hidden when nothing is selected', cover.a.cover[0] === 'wall' && cover.a.vis && cover.a.text && cover.b2.cover[0] === 'low' && cover.c.cover.length === 0 && new Set([cover.a.color, cover.b2.color, cover.c.color]).size === 3 && cover.hidden, JSON.stringify(cover));
}

// ---- 10. load replaces the doc; a bad piece never corrupts the doc ----
{
  const r = await ev(() => {
    const t = T.tool();
    const g = window.game;
    const lvl = { name: 'x', spawn: { pos: [0, 0, 0] }, interiorZones: [], pieces: [{ id: 'env.box', pos: [0, -1, 0], params: { size: [10, 1, 10], mat: 'floor' } }, { id: 'enemy.static', pos: [2, 0, 2] }, { id: 'pickup.heavy', pos: [-2, 0, 2] }] };
    t.load(lvl);
    T.step(1);
    const loaded = { n: t.count, ok: T.ok(), enemies: g.enemies.puppets.length, pickups: g.pickups.items.length, history: t.undoStack.length };
    const before = T.doc();
    let msg = null;
    try { t.place('kit.cover.low', [0, 0, 0], { length: 0.1 }); } catch (err) { msg = err.message; }
    let msg2 = null;
    try { t.place('nope.nothing', [0, 0, 0]); } catch (err) { msg2 = err.message; }
    let msg3 = null;
    try { t.load({ pieces: [{ id: 'nope', pos: [0, 0, 0] }], spawn: { pos: [0, 0, 0] } }); } catch (err) { msg3 = err.message; }
    return { loaded, msg, msg2, msg3, same: T.doc() === before, ok: T.ok(), hist: t.undoStack.length };
  });
  expect('load(level): replaces doc and scene, forgets the history', r.loaded.n === 3 && r.loaded.ok.ok && r.loaded.enemies === 1 && r.loaded.pickups === 1 && r.loaded.history === 0, JSON.stringify(r.loaded));
  expect('  a piece that cannot be built (bad params, unknown id, bad level) throws and leaves doc, scene and history untouched', /kit\.cover\.low/.test(r.msg ?? '') && /unknown/.test(r.msg2 ?? '') && r.msg3 && r.same && r.ok.ok && r.hist === 0, JSON.stringify(r));
}

// ---- 11. play in place (#71): P plays the doc, P again restores it exactly, T restarts, nothing leaks ----
{
  const setup = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load({ name: 'x', spawn: { pos: [0, 0, 20], yaw: 3.14159 }, interiorZones: [], pieces: [
      { id: 'env.box', pos: [0, -1, 0], params: { size: [60, 1, 60], mat: 'floor' } },
      { id: 'env.box', pos: [8, 0, 0], params: { size: [2, 3, 2], mat: 'wall', cover: 'wall' } },
      { id: 'enemy.trooper', pos: [0, 0, -8] },
      { id: 'enemy.static', pos: [-6, 0, -4] },
      { id: 'pickup.heavy', pos: [-4, 0, 6] },
    ] });
    t.place('kit.cover.low', [3, 0, 3]); // history to keep
    t.select(1);
    T.step(1);
    t.keys.clear();
    g.engine.camera.position.set(0, 6, 4);
    t.cam.yaw = 0.5; t.cam.pitch = -0.4;
    T.step(1);
    return { hist: [t.undoStack.length, t.redoStack.length], counts: { colliders: g.world.colliders.length, puppets: g.enemies.puppets.length, pickups: g.pickups.items.length } };
  });
  const before = await ev(() => ({ doc: T.doc(), cam: window.game.engine.camera.position.toArray(), fov: window.game.engine.camera.fov }));

  // keys: P enters play
  const inPlay = await ev(() => {
    const g = window.game;
    const t = T.tool();
    g.engine.input.keys.clear(); // keys stuck from the earlier key tests
    g.engine.input.pressed.clear();
    T.tap('KeyP');
    T.step(1);
    const tr = g.enemies.puppets.find((e) => e.kind === 'trooper');
    const out = {
      playing: t.playing, toolEditing: t.editing, gameEditing: g.editing, frozen: g.enemies.frozen,
      hud: document.getElementById('hud').style.display, palette: document.getElementById('workshop-palette').style.display,
      player: g.player.pos.toArray().map((v) => Math.round(v * 100) / 100), spawnYaw: t.playLevel.spawn.yaw, visible: g.player.root.visible,
      puppets: g.enemies.puppets.length, pickups: g.pickups.items.length, cover: !!g.enemies.cover, batches: g.world.batches.length,
      statics: g.world.staticMeshes.length, trooperState: tr.state,
    };
    return out;
  });
  expect('P: playing, editor inert (tool.editing / game.editing false), enemies unfrozen, HUD back, palette hidden', inPlay.playing && !inPlay.toolEditing && !inPlay.gameEditing && !inPlay.frozen && inPlay.hud === '' && inPlay.palette === 'none', JSON.stringify(inPlay));
  expect('  player stands on the ground under the camera, facing where it looked', Math.abs(inPlay.player[0]) < 0.01 && Math.abs(inPlay.player[1]) < 0.01 && Math.abs(inPlay.player[2] - 4) < 0.01 && Math.abs(inPlay.spawnYaw - (0.5 + Math.PI)) < 1e-6, JSON.stringify(inPlay.player));
  expect('  the doc is played as a real level: merged batches, a cover map, enemies and pickups built from it', inPlay.batches > 0 && inPlay.cover && inPlay.puppets === 2 && inPlay.pickups === 1, JSON.stringify(inPlay));
  const woke = await ev(() => {
    const g = window.game;
    T.step(4);
    const tr = g.enemies.puppets.find((e) => e.kind === 'trooper');
    return { state: tr.state, time: g.enemies.time };
  });
  expect('  enemies are awake: the trooper reacts to the player', woke.state !== 'idle', JSON.stringify(woke));

  // hurt the game: kill an enemy, take the pickup, move a lot
  const hurt = await ev(() => {
    const g = window.game;
    const st = g.enemies.puppets.find((e) => e.kind !== 'trooper');
    for (let i = 0; i < 40 && st.alive; i++) st.damage(50, st.pos.clone().setY(1), new st.pos.constructor(0, 0, -1), 'body');
    g.player.pos.set(-4, 0, 6);
    T.step(1);
    g.player.pos.set(1, 0, 4);
    g.player.damage(30);
    T.step(1);
    return { dead: !st.alive, kills: g.enemies.kills, crate: g.pickups.items.some((i) => !i.active) };
  });
  expect('  destroying an enemy and taking a crate works', hurt.dead && hurt.kills >= 1, JSON.stringify(hurt));

  // restart (T): everything new, player back at the spawn
  const rs = await ev(() => {
    const g = window.game;
    const t = T.tool();
    T.tap('KeyT');
    T.step(1);
    return { playing: t.playing, kills: g.enemies.kills, alive: g.enemies.puppets.every((e) => e.alive), n: g.enemies.puppets.length, pickups: g.pickups.items.every((i) => i.active), player: g.player.pos.toArray().map((v) => Math.round(v * 100) / 100), health: g.player.health, shields: g.player.shields };
  });
  expect('T restarts the encounter: enemies alive again, pickups back, player at the spawn with full health', rs.playing && rs.kills === 0 && rs.alive && rs.n === 2 && rs.pickups && Math.abs(rs.player[2] - 4) < 0.01 && rs.health >= 100, JSON.stringify(rs));

  // back to edit
  const back = await ev(() => {
    const g = window.game;
    const t = T.tool();
    const st = g.enemies.puppets.find((e) => e.kind !== 'trooper');
    for (let i = 0; i < 40 && st.alive; i++) st.damage(50, st.pos.clone().setY(1), new st.pos.constructor(0, 0, -1), 'body');
    T.step(1);
    T.tap('KeyT', { ctrlKey: true }); // not a restart key chord: nothing happens
    T.tap('KeyP');
    T.step(2);
    return {
      playing: t.playing, editing: t.editing, gameEditing: g.editing, doc: T.doc(), verify: t.verify(), frozen: g.enemies.frozen,
      hud: document.getElementById('hud').style.display, palette: document.getElementById('workshop-palette').style.display,
      cam: g.engine.camera.position.toArray(), fov: g.engine.camera.fov, hist: [t.undoStack.length, t.redoStack.length], sel: t.sel,
      counts: { colliders: g.world.colliders.length, puppets: g.enemies.puppets.length, pickups: g.pickups.items.length, alive: g.enemies.puppets.every((e) => e.alive), kills: g.enemies.kills },
      batches: g.world.batches.length, playerVisible: g.player.root.visible,
    };
  });
  expect('P again: back in edit mode, HUD hidden, palette back, enemies frozen, player hidden', back.editing && back.gameEditing && !back.playing && back.frozen && back.hud === 'none' && back.palette === '' && !back.playerVisible, JSON.stringify(back));
  expect('  doc JSON identical to before play, scene = doc (verify ok), destroyed enemy restored', back.doc === before.doc && back.verify.ok && back.counts.alive && back.counts.kills === 0 && back.counts.puppets === setup.counts.puppets && back.counts.pickups === setup.counts.pickups && back.batches === 0, JSON.stringify({ verify: back.verify, counts: back.counts, batches: back.batches }));
  expect('  collider count as before; camera position and fov restored; selection and undo / redo history kept', back.counts.colliders === setup.counts.colliders && JSON.stringify(back.cam) === JSON.stringify(before.cam) && back.fov === before.fov && JSON.stringify(back.hist) === JSON.stringify(setup.hist) && back.sel === 1, JSON.stringify({ back: back.cam, before: before.cam, hist: back.hist, sel: back.sel }));
  const edit = await ev(() => {
    const t = T.tool();
    t.undo();
    T.step(1);
    const a = t.verify().ok;
    t.redo();
    T.step(1);
    const i = t.place('env.box', [20, 0, 20]);
    return { a, b: t.verify().ok, i, restartOutside: t.restart() };
  });
  expect('  editing carries on: undo / redo work on the restored scene, restart outside play does nothing', edit.a && edit.b && edit.restartOutside === false, JSON.stringify(edit));

  // no ground under the camera -> the level's spawn
  const off = await ev(() => {
    const g = window.game;
    const t = T.tool();
    g.engine.camera.position.set(200, 6, 200);
    const s = t.spawnAt();
    g.engine.camera.position.set(8, 1.5, 0); // inside the wall box
    const w = t.spawnAt();
    return { s, w, doc: t.doc.spawn };
  });
  expect('play spawn: no ground (or inside a wall) under the camera = the level spawn', JSON.stringify(off.s.pos) === JSON.stringify(off.doc.pos) && JSON.stringify(off.w.pos) === JSON.stringify(off.doc.pos), JSON.stringify(off));

  // leaving the scene while playing frees everything
  const leave = await ev(() => {
    const g = window.game;
    const t = T.tool();
    g.engine.camera.position.set(0, 6, 4);
    T.tap('KeyP');
    T.step(1);
    g.loadScene('workshop');
    T.step(2);
    return { playing: T.tool().playing, ok: T.ok().ok, hud: document.getElementById('hud').style.display, palettes: document.querySelectorAll('#workshop-palette').length };
  });
  expect('loading a scene while playing: a fresh editor, one palette, scene = doc', !leave.playing && leave.ok && leave.hud === 'none' && leave.palettes === 1, JSON.stringify(leave));

  // toggle cycles do not leak: geometries, textures and scene objects after N cycles equal those after the first
  const leak = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load({ name: 'x', spawn: { pos: [0, 0, 20], yaw: 3.14159 }, interiorZones: [], pieces: [
      { id: 'env.box', pos: [0, -1, 0], params: { size: [60, 1, 60], mat: 'floor' } },
      { id: 'enemy.trooper', pos: [0, 0, -8] }, { id: 'enemy.static', pos: [-6, 0, -4] }, { id: 'enemy.drone', pos: [5, 3, -6] }, { id: 'pickup.heavy', pos: [-4, 0, 6] },
      { id: 'light.point', pos: [0, 3, 0], params: { color: 0xffffff, intensity: 1, distance: 10 } },
    ] });
    const doc0 = T.doc();
    g.engine.camera.position.set(0, 6, 4);
    const cycle = (kill) => {
      T.tap('KeyP');
      T.step(1);
      if (kill) for (const e of g.enemies.puppets) for (let i = 0; i < 80 && e.alive; i++) e.damage(100, e.pos.clone().setY(1), new e.pos.constructor(0, 0, -1), 'body');
      T.step(1);
      T.tap('KeyT');
      T.step(1);
      T.tap('KeyP');
      T.step(1);
    };
    cycle(true); // warms the lazily built pools (debris, fx)
    const first = T.mem();
    const readings = [];
    for (let i = 0; i < 4; i++) { cycle(i % 2 === 0); readings.push(T.mem()); }
    return { first, readings, same: T.doc() === doc0, ok: T.ok().ok, colliders: g.world.colliders.length };
  });
  const same = leak.readings.every((r) => r.geometries === leak.first.geometries && r.textures === leak.first.textures && r.objects === leak.first.objects);
  expect('4 play / edit cycles (with kills and restarts) leak nothing: geometries, textures and scene objects identical, doc unchanged', same && leak.same && leak.ok, JSON.stringify(leak));
}

// ---- 12. encounter tools (#73): spawn groups, triggers, reinforcement entries, player spawn, checkpoints, gizmos ----
{
  // shared helpers in the page
  await ev(() => {
    const g = window.game;
    const FLOOR = { id: 'env.box', pos: [0, -1, 0], params: { size: [300, 1, 300], mat: 'floor' } };
    T.level = (pieces, spawn = { pos: [0, 0, 20], yaw: 3.14159 }) => ({ name: 'x', spawn, interiorZones: [], pieces: [FLOOR, ...pieces] });
    // plays `level` from the camera at (0, 6, 4) (the player stands at 0, 0, 4)
    T.play = (level) => {
      const t = T.tool();
      if (t.playing) t.edit();
      t.load(level);
      T.step(0.2);
      g.engine.camera.position.set(0, 6, 4);
      t.cam.yaw = 0; t.cam.pitch = -0.4;
      g.engine.input.keys.clear(); g.engine.input.pressed.clear();
      T.tap('KeyP');
      T.step(0.2);
      return t.playing;
    };
    T.log = [];
    g.engine.events.on('trigger:fired', (e) => T.log.push(['trigger', e.id, e.event]));
    g.engine.events.on('group:wake', (e) => T.log.push(['wake', e.group]));
    g.engine.events.on('group:spawn', (e) => T.log.push(['spawn', e.group, e.count]));
    g.engine.events.on('checkpoint:reached', (e) => T.log.push(['checkpoint', e.id]));
    T.logOf = (k) => T.log.filter((x) => x[0] === k);
    // gizmo geometry in the scene
    T.gizmoMeshes = () => {
      let n = 0;
      g.engine.scene.traverse((o) => o.userData.gizmo && n++);
      return n;
    };
    const t = T.tool();
    if (t.playing) t.edit();
  });

  // -- pieces: place, gizmo in edit mode, no collision, undo / redo identity --
  const pieces = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load(T.level([]));
    T.step(0.5);
    const start = T.doc();
    const col0 = g.world.colliders.length;
    const ids = ['marker.spawn', 'marker.checkpoint', 'marker.entry', 'trigger.volume'];
    const out = {};
    ids.forEach((id, k) => {
      const i = t.place(id, [k * 6 - 9, 0, -4]);
      T.step(0.1);
      const r = t.items[i].thing;
      out[id] = { i, owner: g.registry.owner(id), gizmo: !!r.gizmo && r.gizmo.parent === g.engine.scene && r.gizmo.visible, ok: T.ok().ok, box: t.status ? t.pick !== undefined : false };
    });
    const placed = T.doc();
    // gizmos are selectable boxes
    t.select(ids.length); // floor is #0, so this is the 4th placed piece
    const sel = { vis: t.helper.visible, size: t.helper.box.getSize(new g.camRig.pivot.constructor()).toArray() };
    t.select(-1);
    const colliders = g.world.colliders.length - col0 - 0; // the floor was already counted by load
    let undone = 0;
    while (t.undoStack.length) { t.undo(); undone++; }
    const back = T.doc();
    const gone = T.gizmoMeshes();
    let redone = 0;
    while (t.redoStack.length) { t.redo(); redone++; }
    return { out, start, placed, back, again: T.doc(), undone, redone, colliders, sel, gone, shown: T.gizmoMeshes(), ok: T.ok(), n: g.encounter.items.length };
  });
  expect('encounter pieces place (marker.spawn / checkpoint / entry, trigger.volume): owner "encounter", a visible gizmo in the scene, scene = doc', Object.values(pieces.out).every((x) => x.owner === 'encounter' && x.gizmo && x.ok), JSON.stringify(pieces.out));
  expect('  gizmos add no colliders; a gizmo is selectable (selection box around it)', pieces.colliders === 0 && pieces.sel.vis && pieces.sel.size[0] > 0, JSON.stringify({ c: pieces.colliders, sel: pieces.sel }));
  expect('  undo x all returns the identical doc and frees every gizmo; redo x all brings them back', pieces.back === pieces.start && pieces.gone === 0 && pieces.again === pieces.placed && pieces.redone === pieces.undone && pieces.shown > 0 && pieces.ok.ok && pieces.n === 4, JSON.stringify({ gone: pieces.gone, shown: pieces.shown, n: pieces.n }));

  // -- params: setParams (undoable), bad params throw and leave the doc alone, rotate a trigger swaps w / d --
  const params = await ev(() => {
    const t = T.tool();
    const g = window.game;
    t.load(T.level([]));
    const e = t.place('marker.entry', [0, 0, 0]);
    const v = t.place('trigger.volume', [10, 0, 0], { size: [6, 3, 2], event: 'a', once: true });
    const before = T.doc();
    t.setParams(e, { group: 'z', enemies: ['enemy.drone'] });
    const set = JSON.stringify(t.doc.pieces[e].params);
    let m1 = null; try { t.setParams(e, { enemies: ['kit.wall'] }); } catch (err) { m1 = err.message; }
    let m2 = null; try { t.setParams(v, { size: [1, 0, 1] }); } catch (err) { m2 = err.message; }
    const same = JSON.stringify(t.doc.pieces[e].params) === set;
    t.rotate(v, 1);
    const size = t.doc.pieces[v].params.size;
    t.undo(); t.undo();
    return { set, m1, m2, same, size, undoOk: T.doc() === before, ok: T.ok().ok };
  });
  expect('setParams: entry list and group are kept; a non-enemy id or a bad size throws and changes nothing', /drone/.test(params.set) && /enemy/.test(params.m1 ?? '') && /size/.test(params.m2 ?? '') && params.same && params.undoOk && params.ok, JSON.stringify(params));
  expect('  rotating a trigger volume turns it a quarter (width and depth swap)', JSON.stringify(params.size) === JSON.stringify([2, 3, 6]), JSON.stringify(params.size));

  // -- save -> load roundtrip keeps them --
  const rt = await ev(async () => {
    const t = T.tool();
    const g = window.game;
    const { serializeLevel, parseLevel } = await import('/src/game/workshop/io.js');
    t.load(T.level([]));
    t.place('marker.spawn', [3, 0, -3], undefined, Math.PI / 2);
    t.place('marker.checkpoint', [-3, 0, -3]);
    const e = t.place('marker.entry', [0, 0, -12], { group: 'r', enemies: ['enemy.trooper', 'enemy.drone'] });
    t.place('enemy.trooper', [0, 0, -20], { group: 'a' });
    t.place('trigger.volume', [0, 0, 0], { size: [4, 3, 4], event: 'go', once: false, wakeGroup: 'a', spawnGroup: 'r' });
    const canon = (o) => JSON.stringify(o, (_, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v)); // io.js rounds to 4 decimals
    const text = serializeLevel(t.doc);
    const parsed = parseLevel(text, g.registry);
    const before = canon(t.doc);
    t.load(parsed);
    T.step(0.5);
    return { same: canon(t.doc) === before, again: serializeLevel(t.doc) === text, ok: T.ok(), items: g.encounter.items.length, e: t.doc.pieces[e + 1].params, lines: text.split('\n').filter((l) => /marker\.|trigger\./.test(l)).length };
  });
  expect('save -> load roundtrip keeps the encounter pieces and their params (serialize is idempotent), scene = doc', rt.same && rt.again && rt.ok.ok && rt.items === 4 && rt.lines === 4, JSON.stringify(rt));

  // -- gizmos: edit mode only --
  const giz = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load(T.level([{ id: 'marker.spawn', pos: [4, 0, 4] }, { id: 'marker.checkpoint', pos: [8, 0, 4] }, { id: 'marker.entry', pos: [12, 0, 4], params: { group: 'r', enemies: ['enemy.static'] } }, { id: 'trigger.volume', pos: [0, 0, -30], params: { size: [4, 3, 4] } }]));
    T.step(0.3);
    const col = g.world.colliders.length;
    const edit = { gizmos: g.encounter.items.filter((r) => r.gizmo && r.gizmo.visible && r.gizmo.parent).length, meshes: T.gizmoMeshes(), colliders: col };
    T.play(T.tool().doc);
    const play = { playing: t.playing, gizmos: g.encounter.items.filter((r) => r.gizmo).length, meshes: T.gizmoMeshes(), items: g.encounter.items.length, colliders: g.world.colliders.length };
    t.edit();
    T.step(0.3);
    const back = { gizmos: g.encounter.items.filter((r) => r.gizmo && r.gizmo.visible).length, meshes: T.gizmoMeshes(), colliders: g.world.colliders.length, verify: t.verify().ok };
    return { edit, play, back };
  });
  expect('gizmos: 4 visible in edit mode; none in play (no objects built, logic only, no colliders added); back again after edit', giz.edit.gizmos === 4 && giz.edit.meshes > 0 && giz.play.playing && giz.play.gizmos === 0 && giz.play.meshes === 0 && giz.play.items === 4 && giz.back.gizmos === 4 && giz.back.meshes === giz.edit.meshes && giz.back.verify, JSON.stringify(giz));

  // -- a trigger volume around a piece does not steal clicks; it is picked when nothing else is under the cursor --
  const pick = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load(T.level([{ id: 'env.box', pos: [0, 0, 0], params: { size: [2, 2, 2], mat: 'low' } }, { id: 'trigger.volume', pos: [0, 0, 0], params: { size: [10, 4, 10] } }]));
    T.step(0.3);
    t.mouse.x = 0; t.mouse.y = 0;
    g.engine.camera.position.set(0, 4, 8);
    t.cam.yaw = 0;
    t.cam.pitch = -0.4; T.step(0.1); t.surface(); const onBox = t.pick();
    t.cam.pitch = -0.8; T.step(0.1); t.surface(); const inVol = t.pick();
    return { onBox, inVol, box: t.doc.pieces.findIndex((p) => p.params?.mat === 'low'), vol: t.doc.pieces.findIndex((p) => p.id === 'trigger.volume') };
  });
  expect('picking: the box inside a trigger volume is picked first; an empty spot inside the volume picks the volume', pick.onBox === pick.box && pick.inVol === pick.vol, JSON.stringify(pick));

  // -- spawn groups: when one member wakes, the rest wake; an ungrouped enemy does not --
  const grp = await ev(() => {
    const g = window.game;
    const t = T.tool();
    const lvl = (groupB) => T.level([
      { id: 'enemy.trooper', pos: [0, 0, -10], params: { group: 'a' } }, // sees the player
      { id: 'enemy.trooper', pos: [60, 0, -40], params: groupB }, // far away (sight 32, squad alert 22)
      { id: 'enemy.trooper', pos: [-60, 0, -40] }, // no group
      { id: 'enemy.drone', pos: [0, 0, -50], params: { group: 'a' } },
    ]);
    T.log.length = 0;
    T.play(lvl({ group: 'a' }));
    T.step(4);
    const ts = g.enemies.puppets.filter((e) => e.kind === 'trooper');
    const dr = g.enemies.puppets.find((e) => e.kind === 'drone');
    const withGroup = { a: ts[0].alerted, b: ts[1].alerted, free: ts[2].alerted, drone: dr.awake, wakes: T.logOf('wake').length };
    T.play(lvl({}));
    T.step(4);
    const ts2 = g.enemies.puppets.filter((e) => e.kind === 'trooper');
    const without = { a: ts2[0].alerted, b: ts2[1].alerted };
    t.edit();
    return { withGroup, without };
  });
  expect('spawn group: one trooper sees the player, the whole group wakes (troopers and a drone), once; an ungrouped one stays idle', grp.withGroup.a && grp.withGroup.b && grp.withGroup.drone && !grp.withGroup.free && grp.withGroup.wakes === 1, JSON.stringify(grp.withGroup));
  expect('  control: the same far trooper without a group stays idle', grp.without.a && !grp.without.b, JSON.stringify(grp.without));

  // -- trigger volume: fires its event once; wakes a group --
  const trg = await ev(() => {
    const g = window.game;
    const t = T.tool();
    const lvl = (once) => T.level([
      { id: 'enemy.trooper', pos: [80, 0, -80], params: { group: 'g' } },
      { id: 'trigger.volume', pos: [0, 0, 4], name: 'door', params: { size: [4, 3, 4], event: 'door.open', once, wakeGroup: 'g' } },
      { id: 'trigger.volume', pos: [0, 0, -60], params: { size: [4, 3, 4], event: 'far' } },
    ]);
    T.log.length = 0;
    T.play(lvl(true));
    // the camera spawn is inside the volume: it fires on the first frame
    T.step(1);
    const first = T.logOf('trigger').map((x) => x.slice(1).join(':'));
    const woke = g.enemies.puppets[0].alerted;
    // leave and enter again: once = no second event
    g.player.pos.set(0, 0, 30); T.step(0.3);
    g.player.pos.set(0, 0, 4); T.step(0.3);
    const afterOnce = T.logOf('trigger').length;
    // the second volume has no name: trigger1
    g.player.pos.set(0, 0, -60); T.step(0.3);
    const second = T.logOf('trigger').map((x) => x.slice(1).join(':'));
    // once: false fires on every entry
    T.log.length = 0;
    T.play(lvl(false));
    T.step(0.5);
    g.player.pos.set(0, 0, 30); T.step(0.3);
    g.player.pos.set(0, 0, 4); T.step(0.3);
    g.player.pos.set(0, 0, 30); T.step(0.3);
    g.player.pos.set(0, 0, 4); T.step(0.3);
    const repeat = T.logOf('trigger').filter((x) => x[1] === 'door').length;
    // a trigger in edit mode never fires
    t.edit();
    T.log.length = 0;
    g.player.pos.set(0, 0, 4); T.step(1);
    return { first, woke, afterOnce, second, repeat, editFired: T.logOf('trigger').length };
  });
  expect('trigger volume: enters -> `trigger:fired` { id: name, event } once, and wakes its group', JSON.stringify(trg.first) === JSON.stringify(['door:door.open']) && trg.woke && trg.afterOnce === 1, JSON.stringify(trg));
  expect('  an unnamed trigger is "trigger<n>" in file order; once: false fires on every entry; nothing fires in edit mode', JSON.stringify(trg.second[1]) === JSON.stringify('trigger1:far') && trg.repeat === 3 && trg.editFired === 0, JSON.stringify(trg));

  // -- reinforcements: a trigger (or the event) builds the group's listed enemies at the entry marker --
  const rf = await ev(() => {
    const g = window.game;
    const t = T.tool();
    const n0 = (() => {
      T.log.length = 0;
      T.play(T.level([
        { id: 'enemy.static', pos: [-6, 0, -4] },
        { id: 'marker.entry', pos: [0, 0, -30], yaw: 0, params: { group: 'r', enemies: ['enemy.trooper', 'enemy.trooper'] } },
        { id: 'marker.entry', pos: [20, 0, -30], params: { group: 'other', enemies: ['enemy.static'] } },
        { id: 'trigger.volume', pos: [0, 0, 4], params: { size: [4, 3, 4], event: 'ambush', spawnGroup: 'r' } },
      ]));
      return 1;
    })();
    T.step(1);
    const made = g.enemies.puppets.filter((e) => e.squad === 'r');
    const first = {
      total: g.enemies.puppets.length, made: made.length, awake: made.every((e) => e.alerted),
      near: made.every((e) => Math.hypot(e.pos.x - 0, e.pos.z + 30) < 2), apart: made.length === 2 && Math.abs(made[0].pos.x - made[1].pos.x) > 1,
      log: T.logOf('spawn'), other: g.enemies.puppets.some((e) => e.squad === 'other'),
    };
    // by event
    g.engine.events.emit('encounter:spawn', 'r');
    T.step(0.2);
    const byEvent = g.enemies.puppets.filter((e) => e.squad === 'r').length;
    // restart: back to the initial enemies
    T.tap('KeyT');
    T.step(0.5);
    const afterRestart = g.enemies.puppets.filter((e) => e.squad === 'r').length;
    t.edit();
    // in edit mode the entry is inert
    const inert = g.encounter.spawnGroup('r');
    return { first, byEvent, afterRestart, inert, editTotal: g.enemies.puppets.length };
  });
  expect('reinforcements: the trigger builds the entry marker\'s listed enemies there, awake, in its group; other groups stay out', rf.first.total === 3 && rf.first.made === 2 && rf.first.awake && rf.first.near && rf.first.apart && !rf.first.other && JSON.stringify(rf.first.log) === JSON.stringify([['spawn', 'r', 2]]), JSON.stringify(rf.first));
  expect('  `encounter:spawn` does the same; restart reloads the level (the trigger fires again: 2, not 4); nothing spawns in edit mode', rf.byEvent === 4 && rf.afterRestart === 2 && rf.inert === 0 && rf.editTotal === 1, JSON.stringify(rf));

  // -- player spawn: marker.spawn --
  const sp = await ev(async () => {
    const g = window.game;
    const t = T.tool();
    const { levelSpawn } = await import('/src/game/world/encounter.js');
    const { SCENES } = await import('/src/game/scenes.js');
    const lvl = T.level([{ id: 'marker.spawn', pos: [5, 0, -10], yaw: Math.PI / 2 }, { id: 'marker.spawn', pos: [9, 0, -10] }]);
    const ls = levelSpawn(lvl);
    T.play(lvl);
    const camSpawn = g.player.pos.toArray();
    T.tap('KeyT');
    T.step(0.3);
    const restart = g.player.pos.toArray();
    const rYaw = g.player.facing;
    t.edit();
    T.step(0.3);
    const parked = g.player.pos.toArray();
    // a normal level load (no tool): the marker is the spawn, gizmos are not built
    SCENES.testenc = { ...lvl, name: 'testenc' };
    g.loadScene('testenc');
    T.step(0.3);
    const normal = { pos: g.player.pos.toArray(), tool: g.tool, gizmos: g.encounter.items.filter((r) => r.gizmo).length, items: g.encounter.items.length, meshes: T.gizmoMeshes() };
    g.loadScene('workshop');
    delete SCENES.testenc;
    T.step(0.3);
    // without a marker, level.spawn is used
    const plain = levelSpawn(T.level([]));
    return { ls, camSpawn, restart, rYaw, parked, normal, plain };
  });
  const near = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]) < 0.05;
  expect('marker.spawn: levelSpawn picks the first marker (else level.spawn); play in place still starts under the camera', sp.ls.pos[0] === 5 && Math.abs(sp.ls.yaw - Math.PI / 2) < 1e-9 && near(sp.camSpawn, [0, 0, 4]) && sp.plain.pos[2] === 20, JSON.stringify(sp));
  expect('  restart (T) and a normal level load put the player on the marker; back in edit parks the player there; no gizmos in a normal level', near(sp.restart, [5, 0, -10]) && Math.abs(sp.rYaw - Math.PI / 2) < 1e-6 && near(sp.parked, [5, 0, -10]) && near(sp.normal.pos, [5, 0, -10]) && sp.normal.tool === null && sp.normal.items === 2 && sp.normal.gizmos === 0 && sp.normal.meshes === 0, JSON.stringify(sp));

  // -- checkpoints: the last one reached is where the player respawns --
  const cp = await ev(() => {
    const g = window.game;
    const t = T.tool();
    T.log.length = 0;
    T.play(T.level([
      { id: 'marker.checkpoint', pos: [0, 0, -10], yaw: 1.5, name: 'cp1' },
      { id: 'marker.checkpoint', pos: [20, 0, -10], name: 'cp2' },
    ]));
    const die = () => { g.player.damage(1000); T.step(0.1); const dead = g.player.dead; T.step(3.6); return { dead, alive: !g.player.dead, health: g.player.health }; };
    T.step(0.3);
    const start = g.player.pos.toArray();
    const none = g.encounter.checkpoint;
    const d0 = die();
    const at0 = g.player.pos.toArray(); // no checkpoint yet: back where the run started
    g.player.pos.set(0.5, 0, -10); T.step(0.3);
    const c1 = g.encounter.checkpoint?.id;
    g.player.pos.set(20, 0, -10); T.step(0.3);
    const c2 = g.encounter.checkpoint?.id;
    g.player.pos.set(0, 0, -10); T.step(0.3); // back to cp1: the last one reached wins
    const c1b = g.encounter.checkpoint?.id;
    g.player.pos.set(30, 0, 30); T.step(0.3);
    const d1 = die();
    const at1 = g.player.pos.toArray();
    const yaw = g.player.facing;
    const events = T.logOf('checkpoint').map((x) => x[1]);
    T.tap('KeyT');
    T.step(0.3);
    const afterRestart = g.encounter.checkpoint;
    t.edit();
    return { start, none, d0, at0, c1, c2, c1b, d1, at1, yaw, events, afterRestart, editCp: g.encounter.checkpoint };
  });
  expect('checkpoint: none before one is reached; dying then respawns at the spawn; entering one records it (last reached wins), `checkpoint:reached` per change', cp.none === null && cp.d0.dead && cp.d0.alive && near(cp.at0, cp.start) && cp.c1 === 'cp1' && cp.c2 === 'cp2' && cp.c1b === 'cp1' && JSON.stringify(cp.events) === JSON.stringify(['cp1', 'cp2', 'cp1']), JSON.stringify(cp));
  expect('  after death the player respawns at the last checkpoint, facing its yaw, full health; restart forgets checkpoints', cp.d1.dead && cp.d1.alive && near(cp.at1, [0, 0, -10]) && Math.abs(cp.yaw - 1.5) < 1e-6 && cp.d1.health >= 100 && cp.afterRestart === null && cp.editCp === null, JSON.stringify(cp));

  // -- leaks: play / edit cycles with every encounter piece (reinforcements, wakes, checkpoints) --
  const leak = await ev(() => {
    const g = window.game;
    const t = T.tool();
    if (t.playing) t.edit();
    t.load(T.level([
      { id: 'marker.spawn', pos: [2, 0, 10] }, { id: 'marker.checkpoint', pos: [0, 0, 4] },
      { id: 'marker.entry', pos: [0, 0, -20], params: { group: 'r', enemies: ['enemy.trooper', 'enemy.drone'] } },
      { id: 'enemy.trooper', pos: [0, 0, -10], params: { group: 'a' } },
      { id: 'trigger.volume', pos: [0, 0, 4], params: { size: [4, 3, 4], event: 'x', wakeGroup: 'a', spawnGroup: 'r' } },
      { id: 'pickup.heavy', pos: [-4, 0, 6] },
    ]));
    const doc0 = T.doc();
    g.engine.camera.position.set(0, 6, 4);
    const cycle = () => {
      T.tap('KeyP');
      T.step(1);
      T.tap('KeyT');
      T.step(1);
      T.tap('KeyP');
      T.step(1);
    };
    cycle(); // warms the lazily built pools
    const first = T.mem();
    const readings = [];
    for (let i = 0; i < 4; i++) { cycle(); readings.push(T.mem()); }
    const out = { first, readings, same: T.doc() === doc0, ok: T.ok().ok, items: g.encounter.items.length };
    g.loadScene('workshop'); T.step(1);
    return out;
  });
  const same2 = leak.readings.every((r) => r.geometries === leak.first.geometries && r.textures === leak.first.textures && r.objects === leak.first.objects);
  expect('4 play / edit cycles with every encounter piece (reinforcements, wakes, checkpoint) leak nothing; doc unchanged', same2 && leak.same && leak.ok, JSON.stringify(leak));
}

// ---- 13. inspector: the selected piece's params as fields (registry meta `fields`), edited through the real DOM ----
{
  const INS = '#workshop-inspector';
  const field = (key) => `${INS} [data-key="${key}"]`;
  const typeIn = async (key, text) => { await p.click(field(key), { clickCount: 3 }); await (text === '' ? p.keyboard.press('Backspace') : p.keyboard.type(text)); await p.keyboard.press('Enter'); };
  // earlier sections leave pointer lock on (play): the real mouse needs the cursor
  await ev(() => { const t = T.tool(); if (t.playing) t.edit(); document.exitPointerLock(); window.game.engine.input.free = false; t.load(window.game.level); t.arm(null); });
  await p.waitForFunction(() => !document.pointerLockElement);
  const box = await ev(() => { const t = T.tool(); const i = t.place('env.box', [-20, 0, 40], { size: [3, 1.1, 1], mat: 'low', cover: 'low' }); t.select(i); return i; });
  const shown = await ev(() => ({
    vis: document.querySelector('#workshop-inspector').style.display !== 'none',
    keys: [...document.querySelectorAll('#workshop-inspector [data-key]')].map((e) => e.dataset.key),
    size: document.querySelector('#workshop-inspector [data-key="size"]').value,
    mat: document.querySelector('#workshop-inspector [data-key="mat"]').value,
    cover: document.querySelector('#workshop-inspector [data-key="cover"]').value,
    shadow: document.querySelector('#workshop-inspector [data-key="shadow"]').checked,
  }));
  expect('selecting a piece shows one field per `fields` entry (and its name)', shown.vis && JSON.stringify(shown.keys) === JSON.stringify(['name', 'size', 'mat', 'cover', 'collide', 'shadow']) && shown.size === '3, 1.1, 1' && shown.mat === 'low' && shown.cover === 'low' && shown.shadow === true, JSON.stringify(shown));
  // every field of every piece id comes from the registry: ids without fields show only the name
  const meta = await ev(() => { const g = window.game; return g.registry.ids().map((id) => [id, (g.registry.meta(id).fields ?? []).map((f) => f.key)]); });
  expect('  every registry id has well-formed fields (or none)', await ev(() => window.game.registry.ids().every((id) => (window.game.registry.meta(id).fields ?? []).every((f) => f.key && ['number', 'vec2', 'vec3', 'text', 'bool', 'enum', 'list'].includes(f.type) && (f.type !== 'enum' || f.options)))), JSON.stringify(meta));
  const mid = await ev(() => { const t = T.tool(); const g = window.game; const out = {}; for (const id of ['marker.spawn', 'marker.entry', 'trigger.volume', 'enemy.mover', 'kit.platform', 'pickup.light']) { const i = t.place(id, [-20, 0, 44]); t.select(i); out[id] = [...document.querySelectorAll('#workshop-inspector [data-key]')].map((e) => e.dataset.key).join(','); } for (let k = 0; k < 6; k++) t.undo(); t.select(-1); return out; });
  expect('  encounter, enemy, kit and pickup pieces show their own fields', mid['trigger.volume'] === 'name,size,event,once,wakeGroup,spawnGroup' && mid['marker.entry'] === 'name,group,enemies' && mid['enemy.mover'] === 'name,group,to,speed' && mid['marker.spawn'] === 'name' && mid['pickup.light'] === 'name' && mid['kit.platform'].startsWith('name,size,height,stairs,parapets,mat'), JSON.stringify(mid));
  expect('  nothing selected: inspector hidden', await ev(() => document.querySelector('#workshop-inspector').style.display === 'none'));

  // type + Enter: doc and scene change, one undo step
  await ev((i) => T.tool().select(i), box);
  const before = await ev(() => ({ doc: T.doc(), undo: T.tool().undoStack.length, h: T.tool().items.length }));
  await typeIn('size', '6, 2, 1.5');
  const a = await ev((i) => { const t = T.tool(); return { p: t.doc.pieces[i], undo: t.undoStack.length, ok: t.verify().ok, size: t.items[i].thing.objects[0].geometry.parameters, val: document.querySelector('#workshop-inspector [data-key="size"]').value }; }, box);
  expect('editing size (type + Enter) changes the doc and rebuilds the scene piece, as one command', JSON.stringify(a.p.params.size) === '[6,2,1.5]' && a.undo === before.undo + 1 && a.ok && a.size.width === 6 && a.size.height === 2 && a.size.depth === 1.5, JSON.stringify(a));
  expect('  the field shows the stored value', a.val === '6, 2, 1.5');
  await p.selectOption(field('mat'), 'high');
  await p.selectOption(field('cover'), '');
  await p.uncheck(field('shadow'));
  await typeIn('name', 'crate1');
  const b = await ev((i) => { const t = T.tool(); return { p: t.doc.pieces[i], cover: t.coverOf(i), ok: t.verify().ok }; }, box);
  expect('  mat (select), cover cleared (key removed), shadow (checkbox), name', b.p.params.mat === 'high' && !('cover' in b.p.params) && b.p.params.shadow === false && b.p.name === 'crate1' && b.cover.length === 0 && b.ok, JSON.stringify(b));
  // undo / redo restore the exact JSON
  const afterDoc = await ev(() => T.doc());
  const u = await ev(() => { const t = T.tool(); for (let k = 0; k < 5; k++) t.undo(); const d0 = T.doc(); for (let k = 0; k < 5; k++) t.redo(); return { d0, d1: T.doc(), ok: t.verify().ok, sel: t.sel }; });
  expect('  undo x5 returns the identical doc from before, redo x5 the edited one', u.d0 === before.doc && u.d1 === afterDoc && u.ok, JSON.stringify({ ok: u.ok, same0: u.d0 === before.doc, same1: u.d1 === afterDoc }));
  await ev((i) => T.tool().select(i), box);
  expect('  the inspector follows undo (field shows the doc)', await p.inputValue(field('size')) === '6, 2, 1.5');

  // invalid values: toast, doc untouched, field back to the doc value
  const docOk = await ev(() => T.doc());
  const undoN = await ev(() => T.tool().undoStack.length);
  const bad = {};
  for (const [key, text] of [['size', '1, 2'], ['size', 'a, b, c'], ['size', '0, 1, 1']]) {
    await typeIn(key, text);
    bad[`${key}=${text}`] = await ev(() => ({ toast: T.tool().toastText, doc: T.doc(), val: document.querySelector('#workshop-inspector [data-key="size"]').value }));
  }
  expect('invalid values (wrong count, not numbers, below min) toast and leave the doc and history alone; the field is reverted', Object.values(bad).every((r) => r.toast && r.doc === docOk && r.val === '6, 2, 1.5') && await ev(() => T.tool().undoStack.length) === undoN, JSON.stringify(bad));
  await p.selectOption(field('mat'), 'high');
  await ev(() => { const t = T.tool(); t.toastText = ''; });
  const trig = await ev(() => { const t = T.tool(); const i = t.place('trigger.volume', [-20, 0, 50]); t.select(i); return i; });
  await typeIn('size', '1, 1');
  expect('  a builder error (trigger size with 2 numbers) is a toast too, nothing changed', await ev((i) => T.tool().toastText !== '' && JSON.stringify(T.tool().doc.pieces[i].params.size) === '[4,3,4]', trig));

  // encounter params
  await typeIn('size', '8, 3, 6');
  await typeIn('event', 'door-open');
  await p.uncheck(field('once'));
  await typeIn('wakeGroup', 'alpha');
  await typeIn('spawnGroup', 'reinforce');
  await typeIn('name', 'gate');
  const tg = await ev((i) => { const t = T.tool(); return { p: t.doc.pieces[i], ok: t.verify().ok, rec: t.items[i].thing.data ?? null }; }, trig);
  expect('trigger.volume: size, event, once, wakeGroup, spawnGroup and name edit in the UI', JSON.stringify(tg.p.params) === JSON.stringify({ size: [8, 3, 6], event: 'door-open', once: false, wakeGroup: 'alpha', spawnGroup: 'reinforce' }) && tg.p.name === 'gate' && tg.ok, JSON.stringify(tg));
  await typeIn('wakeGroup', '');
  expect('  emptying an optional field removes the key', await ev((i) => !('wakeGroup' in T.tool().doc.pieces[i].params), trig));
  const ent = await ev(() => { const t = T.tool(); const i = t.place('marker.entry', [-20, 0, 56]); t.select(i); return i; });
  await typeIn('group', 'wave2');
  await typeIn('enemies', 'enemy.drone, enemy.trooper , enemy.trooper');
  expect('marker.entry: group and enemies (comma list)', await ev((i) => JSON.stringify(T.tool().doc.pieces[i].params) === JSON.stringify({ group: 'wave2', enemies: ['enemy.drone', 'enemy.trooper', 'enemy.trooper'] }) && T.tool().verify().ok, ent));
  await typeIn('enemies', 'kit.wall');
  expect('  a non-enemy id in the list is a toast, doc unchanged', await ev((i) => T.tool().doc.pieces[i].params.enemies.length === 3, ent));
  const en = await ev(() => { const t = T.tool(); const i = t.place('enemy.trooper', [-20, 0, 62]); t.select(i); return i; });
  await typeIn('group', 'alpha');
  expect('enemy group (trooper)', await ev((i) => T.tool().doc.pieces[i].params.group === 'alpha' && T.tool().items[i].thing.squad === 'alpha' && T.tool().verify().ok, en));
  const kt = await ev(() => { const t = T.tool(); const i = t.place('kit.platform', [-20, 0, 70]); t.select(i); return i; });
  await typeIn('size', '10, 6');
  await p.selectOption(field('stairs'), 'e');
  await typeIn('height', '2.4');
  expect('kit.platform: size (2 numbers), stairs (enum), height', await ev((i) => { const q = T.tool().doc.pieces[i].params; return JSON.stringify(q.size) === '[10,6]' && q.stairs === 'e' && q.height === 2.4 && T.tool().verify().ok; }, kt));

  // keyboard focus: typing in a field is the field's, never the editor's
  await ev((i) => { const t = T.tool(); t.select(i); T.step(0.1); window.__cam = t.game.engine.camera.position.toArray(); window.__n = t.count; window.__g = t.grid; window.__d = T.doc(); }, box);
  await p.click(field('name'), { clickCount: 3 });
  for (const k of ['d', 'w', 'r', 'g', 'h']) await p.keyboard.press(k);
  await p.keyboard.down('d'); await ev(() => T.step(0.5)); await p.keyboard.up('d');
  await p.keyboard.press('Delete'); await p.keyboard.press('Backspace'); await p.keyboard.press('Control+z'); await p.keyboard.press('PageUp'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('p');
  const typed = await ev(() => { const t = T.tool(); const el = document.querySelector('#workshop-inspector [data-key="name"]'); return { cam: t.game.engine.camera.position.toArray(), n: t.count, grid: t.grid, same: T.doc() === window.__d, playing: t.playing, keys: [...t.keys], focus: document.activeElement === el, val: el.value, camSame: JSON.stringify(t.game.engine.camera.position.toArray()) === JSON.stringify(window.__cam), skel: window.game.debug }; });
  expect('typing in a field (d w r g h, held D, Delete, Backspace, Ctrl+Z, PageUp, arrows, p) fires no editor shortcut: no fly, no delete/undo/nudge/play', typed.camSame && typed.n === (await ev(() => window.__n)) && typed.grid === (await ev(() => window.__g)) && !typed.playing && typed.keys.length === 0 && typed.focus, JSON.stringify(typed));
  expect('  the keys landed in the field', typed.val !== 'crate1' && /d/.test(typed.val), typed.val);
  await p.keyboard.press('Escape');
  const esc = await ev((i) => { const t = T.tool(); return { blurred: document.activeElement === document.body, sel: t.sel, val: document.querySelector('#workshop-inspector [data-key="name"]').value, doc: T.doc() === window.__d }; }, box);
  expect('Esc in a field blurs it, reverts the text, keeps the selection and the doc', esc.blurred && esc.sel === box && esc.val === 'crate1' && esc.doc, JSON.stringify(esc));
  // control: with the field blurred the same keys do act
  await p.keyboard.press('Delete');
  expect('  control: Delete after the field is blurred deletes the selection', await ev((n) => T.tool().count === n - 1, await ev(() => window.__n)));
  await ev(() => T.tool().undo());

  // a fly key held while a field gains focus and released inside it must not stay held (the field swallows its keyup)
  await ev((i) => { const t = T.tool(); t.select(i); document.activeElement?.blur?.(); window.game.engine.input.keys.clear(); t.keys.clear(); }, box);
  await p.keyboard.down('w');
  const held = await ev(() => { const t = T.tool(); const c0 = t.game.engine.camera.position.toArray(); T.step(0.3); return { c0, c1: t.game.engine.camera.position.toArray(), editor: t.keys.has('KeyW'), input: t.game.engine.input.keys.has('KeyW') }; });
  await p.focus(field('name'));
  await p.keyboard.up('w');
  const stuck = await ev(() => { const t = T.tool(); const c0 = t.game.engine.camera.position.toArray(); T.step(0.5); return { c0, c1: t.game.engine.camera.position.toArray(), editor: [...t.keys], input: [...t.game.engine.input.keys], pressed: [...t.game.engine.input.pressed] }; });
  await p.evaluate(() => document.activeElement.blur());
  const after = await ev(() => { const t = T.tool(); const c0 = t.game.engine.camera.position.toArray(); T.step(0.5); return { moved: JSON.stringify(c0) !== JSON.stringify(t.game.engine.camera.position.toArray()), editor: [...t.keys], input: [...t.game.engine.input.keys] }; });
  expect('control: W held with no field focused flies the camera', JSON.stringify(held.c0) !== JSON.stringify(held.c1) && held.editor && held.input, JSON.stringify(held));
  expect('W held when a field gets focus and released inside it: no key stays held (editor and engine input), the camera stays put after blur', JSON.stringify(stuck.c0) === JSON.stringify(stuck.c1) && stuck.editor.length === 0 && !stuck.input.includes('KeyW') && !after.moved && after.editor.length === 0 && !after.input.includes('KeyW'), JSON.stringify({ stuck, after }));
  expect('  focusing a field only clears held keys: pending edge presses are kept', await ev(() => { const e = T.tool().game.engine.input; e.pressed.add('KeyX'); const el = document.querySelector('#workshop-inspector [data-key="size"]'); el.focus(); const kept = e.pressed.has('KeyX'); el.blur(); e.pressed.delete('KeyX'); return kept; }));

  // play hides the panel and frees focus; edit brings it back
  await ev((i) => T.tool().select(i), box);
  await p.click(field('name'));
  await ev(() => T.tap('KeyP'));
  const pl = await ev(() => { const t = T.tool(); const playing = t.playing; return { playing, hidden: getComputedStyle(document.querySelector('#workshop-inspector')).display === 'none' || document.querySelector('#workshop-inspector').offsetParent === null, focus: document.activeElement.tagName }; });
  await ev(() => T.tap('KeyP'));
  const back = await ev(() => ({ playing: T.tool().playing, vis: document.querySelector('#workshop-inspector').offsetParent !== null, n: document.querySelectorAll('#workshop-inspector [data-key]').length }));
  expect('play hides the inspector and drops field focus; back to edit shows it again with the selection', pl.playing && pl.hidden && pl.focus === 'BODY' && !back.playing && back.vis && back.n === 6, JSON.stringify({ pl, back }));

  // leaks: select / deselect / play cycles, then leaving the scene
  const lk = await ev((i) => {
    const t = T.tool();
    const cycle = () => { for (const k of [i, i + 1, 0, -1, i]) { t.select(k); } T.tap('KeyP'); T.step(0.5); T.tap('KeyP'); T.step(0.2); };
    cycle();
    const a = { dom: document.body.querySelectorAll('*').length, mem: T.mem(), insp: document.querySelectorAll('#workshop-inspector').length };
    for (let n = 0; n < 4; n++) cycle();
    const c = { dom: document.body.querySelectorAll('*').length, mem: T.mem(), insp: document.querySelectorAll('#workshop-inspector').length };
    window.game.loadScene('arena'); T.step(2);
    const gone = { insp: document.querySelectorAll('#workshop-inspector').length, side: document.querySelectorAll('#workshop-palette').length };
    window.game.loadScene('workshop'); T.step(2);
    return { a, c, gone, back: document.querySelectorAll('#workshop-inspector').length };
  }, box);
  expect('select / deselect / play cycles leave no DOM nodes, geometry or textures behind; one inspector, none after leaving the scene', lk.a.dom === lk.c.dom && lk.a.mem.geometries === lk.c.mem.geometries && lk.a.mem.textures === lk.c.mem.textures && lk.a.insp === 1 && lk.c.insp === 1 && lk.gone.insp === 0 && lk.back === 1, JSON.stringify(lk));
}

// ---- 14. interior zones (`zone.interior`, encounter owner): edit, undo, save / load, legacy files, play, no leaks ----
{
  await ev(() => { const t = T.tool(); if (t.playing) t.edit(); document.exitPointerLock(); window.game.engine.input.free = false; window.game.engine.input.keys.clear(); });
  await p.waitForFunction(() => !document.pointerLockElement);
  const FLOORP = { id: 'env.box', pos: [0, -1, 0], params: { size: [300, 1, 300], mat: 'floor' } };
  await ev((FLOORP) => {
    const g = window.game;
    T.zlevel = (pieces) => ({ name: 'zones', title: 'ZONES', spawn: { pos: [0, 0, 20], yaw: 3.14159 }, interiorZones: [], pieces: [FLOORP, ...pieces] });
    T.zones = () => g.world.interiorZones.map((b) => [b.min.toArray(), b.max.toArray()]);
  }, FLOORP);

  // -- place, gizmo, no logic and no colliders in edit mode, palette entry, inspector field --
  const pl = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load(T.zlevel([]));
    T.step(0.3);
    const c0 = g.world.colliders.length;
    const gz0 = T.gizmoMeshes();
    const i = t.place('zone.interior', [4.2, 0, -3.1]);
    const rec = t.items[i].thing;
    t.select(i);
    return {
      i, piece: t.doc.pieces[i], owner: t.items[i].owner, gizmo: !!rec.gizmo?.parent && rec.gizmo.visible, meshes: T.gizmoMeshes() - gz0,
      colliders: g.world.colliders.length - c0, zones: T.zones().length, ok: t.verify().ok,
      palette: !!document.querySelector('#workshop-palette [data-id="zone.interior"]'),
      fields: [...document.querySelectorAll('#workshop-inspector [data-key]')].map((e) => e.dataset.key).join(','),
    };
  });
  expect('place zone.interior: a piece with the example size, a gizmo, no collider, not yet a world zone in edit mode; palette entry; inspector size field', pl.piece.id === 'zone.interior' && JSON.stringify(pl.piece.params.size) === '[8,4,8]' && JSON.stringify(pl.piece.pos) === '[4,0,-3]' && pl.owner === 'encounter' && pl.gizmo && pl.meshes > 0 && pl.colliders === 0 && pl.zones === 0 && pl.ok && pl.palette && pl.fields === 'name,size', JSON.stringify(pl));

  // -- move, resize (API and inspector), rotate, name; undo / redo give the identical JSON --
  const ed = await ev(() => {
    const t = T.tool();
    const i = t.doc.pieces.findIndex((q) => q.id === 'zone.interior');
    const d0 = T.doc();
    const hist0 = t.undoStack.length;
    t.move(i, [10.3, 0, 7.6]);
    t.setParams(i, { size: [12, 5, 6] });
    const bounds = () => { const g = t.items[i].thing.gizmo; const c = g.children[0]; const lo = [0, 1, 2].map((k) => g.position.getComponent(k) + c.position.getComponent(k) - c.scale.getComponent(k) / 2); const hi = [0, 1, 2].map((k) => g.position.getComponent(k) + c.position.getComponent(k) + c.scale.getComponent(k) / 2); return [lo, hi].map((a) => a.map((v) => Math.round(v * 1e3) / 1e3)); };
    const gz = bounds();
    t.rotate(i, 1);
    const turned = t.doc.pieces[i].params.size;
    t.setName(i, 'hall');
    const d1 = T.doc();
    let err = null;
    try { t.setParams(i, { size: [0, 1, 1] }); } catch (e) { err = e.message; }
    let err2 = null;
    try { t.setParams(i, { size: [1, 2] }); } catch (e) { err2 = e.message; }
    const unchanged = T.doc() === d1;
    const n = t.undoStack.length - hist0;
    for (let k = 0; k < n; k++) t.undo();
    const back = T.doc();
    for (let k = 0; k < n; k++) t.redo();
    return { i, gz, turned, n, err, err2, unchanged, undoIdentical: back === d0, redoIdentical: T.doc() === d1, ok: t.verify().ok, piece: t.doc.pieces[i] };
  });
  expect('move (snapped), resize and rotate (a quarter turn swaps w and d) rebuild the gizmo to the new box; name works', JSON.stringify(ed.piece.pos) === '[10.5,0,7.5]' && JSON.stringify(ed.turned) === '[6,5,12]' && ed.piece.name === 'hall' && JSON.stringify(ed.gz) === JSON.stringify([[4.5, 0, 4.5], [16.5, 5, 10.5]]) && ed.n === 4 && ed.ok, JSON.stringify(ed));
  expect('  bad sizes (zero, two numbers) throw and change nothing; undo x4 is the identical JSON, redo x4 too', !!ed.err && !!ed.err2 && ed.unchanged && ed.undoIdentical && ed.redoIdentical, JSON.stringify(ed));
  // resize through the real inspector field
  await ev((i) => T.tool().select(i), ed.i);
  await p.click('#workshop-inspector [data-key="size"]', { clickCount: 3 });
  await p.keyboard.type('5, 3, 9');
  await p.keyboard.press('Enter');
  const ui = await ev((i) => { const t = T.tool(); const q = t.doc.pieces[i]; t.undo(); const u = JSON.stringify(t.doc.pieces[i].params.size); t.redo(); return { size: q.params.size, undone: u, ok: t.verify().ok }; }, ed.i);
  expect('  the inspector size field resizes it (one undo step)', JSON.stringify(ui.size) === '[5,3,9]' && ui.undone === '[6,5,12]' && ui.ok, JSON.stringify(ui));

  // -- picking: a zone around a box does not steal the click; an empty spot inside picks the zone --
  const pk = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load(T.zlevel([{ id: 'env.box', pos: [0, 0, 0], params: { size: [2, 2, 2], mat: 'low' } }, { id: 'zone.interior', pos: [0, 0, 0], params: { size: [10, 4, 10] } }]));
    T.step(0.3);
    t.mouse.x = 0; t.mouse.y = 0;
    g.engine.camera.position.set(0, 4, 8);
    t.cam.yaw = 0;
    t.cam.pitch = -0.4; T.step(0.1); t.surface(); const onBox = t.pick();
    t.cam.pitch = -0.8; T.step(0.1); t.surface(); const inZone = t.pick();
    return { onBox, inZone, box: t.doc.pieces.findIndex((q) => q.params?.mat === 'low'), zone: t.doc.pieces.findIndex((q) => q.id === 'zone.interior') };
  });
  expect('picking: the box inside a zone is picked first; an empty spot inside the zone picks the zone', pk.onBox === pk.box && pk.inZone === pk.zone, JSON.stringify(pk));

  // -- save -> load roundtrip: bytes are stable, the loaded doc equals the saved one, zones are editable again --
  const rt = await ev(async () => {
    const g = window.game;
    const t = T.tool();
    const { serializeLevel, parseLevel } = await import('/src/game/workshop/io.js');
    t.load({ ...T.zlevel([]), spawn: { pos: [0, 0, 20], yaw: 3.1416 }, pieces: [...T.zlevel([]).pieces, { id: 'zone.interior', name: 'a', pos: [-8, 0, -20], params: { size: [16, 6, 12] } }, { id: 'zone.interior', pos: [20.5, 1, -20], params: { size: [4, 3, 4] } }] });
    t.setParams(2, { size: [4.5, 3, 7] });
    t.move(1, [-6, 0, -22]);
    const doc = T.doc();
    const text = serializeLevel(t.doc);
    const parsed = parseLevel(text, g.registry);
    t.load(parsed);
    T.step(0.3);
    return { same: T.doc() === doc, stable: serializeLevel(t.doc) === text, lines: text.split('\n').filter((l) => l.includes('zone.interior')).length, ok: t.verify().ok, zones: g.encounter.items.filter((r) => r.kind === 'zone').length };
  });
  expect('save -> load roundtrip: the zone pieces survive byte-for-byte (serialize is idempotent), the doc is identical, scene = doc', rt.same && rt.stable && rt.lines === 2 && rt.ok && rt.zones === 2, JSON.stringify(rt));

  // -- a level file with the older top-level `interiorZones` opens as editable pieces and plays the same --
  const leg = await ev(async () => {
    const g = window.game;
    const t = T.tool();
    const { SCENES } = await import('/src/game/scenes.js');
    const arena = SCENES.arena;
    const want = arena.interiorZones.map((z) => [z.min, z.max]);
    t.load({ ...arena, name: 'x' });
    T.step(0.3);
    const z = t.doc.pieces.filter((q) => q.id === 'zone.interior');
    const migrated = { n: z.length, size: z[0]?.params.size, pos: z[0]?.pos, top: t.doc.interiorZones, ok: t.verify().ok };
    // the same box in play
    g.engine.camera.position.set(0, 6, -40); t.cam.yaw = 0; t.cam.pitch = -0.4;
    t.play(); T.step(0.3);
    const box = T.zones();
    const inside = g.world.isInterior(g.player.pos);
    t.edit();
    return { want, migrated, box, inside };
  });
  const near3 = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 0.01);
  expect('legacy `interiorZones` (arena) become zone pieces in the editor (top-level emptied) and play builds the same box', leg.migrated.n === 1 && near3(leg.migrated.size, [48, 7, 31.7]) && near3(leg.migrated.pos, [0, 0, -46.15]) && leg.migrated.top.length === 0 && leg.migrated.ok && leg.box.length === 1 && near3(leg.box[0][0], leg.want[0][0]) && near3(leg.box[0][1], leg.want[0][1]) && leg.inside, JSON.stringify(leg));

  // -- play uses the zones: world.isInterior (camera exposure input), HUD label INTERIOR; gizmos gone; edit mode back to gizmos --
  const run = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load(T.zlevel([{ id: 'zone.interior', pos: [0, 0, 4], params: { size: [6, 4, 6] } }, { id: 'zone.interior', pos: [30, 0, 4], params: { size: [6, 4, 6] } }]));
    T.step(0.3);
    const doc0 = T.doc();
    const editGizmos = T.gizmoMeshes();
    g.engine.camera.position.set(0, 6, 4); t.cam.yaw = 0; t.cam.pitch = -0.4;
    g.engine.input.keys.clear();
    t.play(); T.step(0.4);
    const label = () => document.getElementById('zone')?.textContent;
    const inPlay = { zones: T.zones(), gizmos: T.gizmoMeshes(), inside: g.world.isInterior(g.player.pos), cam: g.world.isInterior(g.engine.camera.position), label: label(), colliders: g.world.colliders.length };
    g.player.pos.set(15, 0, 4); T.step(0.4);
    const outside = { inside: g.world.isInterior(g.player.pos), label: label() };
    g.player.pos.set(31, 0, 4); T.step(0.4);
    const second = { inside: g.world.isInterior(g.player.pos), label: label() };
    T.tap('KeyT'); T.step(0.4);
    const restarted = T.zones().length;
    t.edit(); T.step(0.3);
    return { editGizmos, inPlay, outside, second, restarted, back: { zones: T.zones().length, gizmos: T.gizmoMeshes(), same: T.doc() === doc0, ok: t.verify().ok } };
  });
  expect('play: the zone boxes are built (2, none from the gizmos), the player inside reads INTERIOR, outside the title, the second zone works; no gizmo objects', run.inPlay.zones.length === 2 && run.inPlay.gizmos === 0 && run.inPlay.inside && run.inPlay.label === 'INTERIOR' && !run.outside.inside && run.outside.label === 'ZONES' && run.second.inside && run.second.label === 'INTERIOR', JSON.stringify(run));
  expect('  restart keeps 2 zones (not 4); back in edit: no world zones, gizmos back, doc identical, scene = doc', run.restarted === 2 && run.back.zones === 0 && run.back.gizmos === run.editGizmos && run.back.same && run.back.ok, JSON.stringify(run));

  // -- a normal level load (no tool) builds the zone as logic only --
  const norm = await ev(async () => {
    const g = window.game;
    const { SCENES } = await import('/src/game/scenes.js');
    SCENES.testzone = T.zlevel([{ id: 'zone.interior', pos: [0, 0, 20], params: { size: [8, 4, 8] } }]);
    SCENES.testzone.name = 'testzone';
    g.loadScene('testzone'); T.step(0.4);
    const out = { zones: T.zones().length, inside: g.world.isInterior(g.player.pos), gizmos: T.gizmoMeshes(), label: document.getElementById('zone')?.textContent };
    g.loadScene('workshop');
    delete SCENES.testzone;
    T.step(0.3);
    out.after = T.zones().length;
    return out;
  });
  expect('a normal level load: the zone is logic only (no gizmo), the player spawns inside it; leaving frees it', norm.zones === 1 && norm.inside && norm.gizmos === 0 && norm.label === 'INTERIOR' && norm.after === 0, JSON.stringify(norm));

  // -- leaks: place / delete and play / edit cycles --
  const lk = await ev(() => {
    const g = window.game;
    const t = T.tool();
    t.load(T.zlevel([{ id: 'zone.interior', pos: [0, 0, 4], params: { size: [6, 4, 6] } }]));
    T.step(0.3);
    const cycle = () => {
      const i = t.place('zone.interior', [9, 0, 9], { size: [3, 3, 3] }); t.setParams(i, { size: [4, 4, 4] }); t.remove(i); t.undo(); t.undo(); t.undo(); t.redo(); t.redo(); t.redo();
      g.engine.camera.position.set(0, 6, 4); t.cam.yaw = 0; t.cam.pitch = -0.4;
      T.tap('KeyP'); T.step(0.3); T.tap('KeyT'); T.step(0.2); T.tap('KeyP'); T.step(0.2);
    };
    cycle();
    const a = { mem: T.mem(), zones: T.zones().length, gz: g.encounter.gizmos, n: t.count };
    for (let k = 0; k < 4; k++) cycle();
    const c = { mem: T.mem(), zones: T.zones().length, gz: g.encounter.gizmos, n: t.count };
    const res = !!g.encounter.res;
    g.loadScene('arena'); T.step(0.3);
    const left = { zones: T.zones().length, gz: g.encounter.gizmos, res: !!g.encounter.res };
    g.loadScene('workshop'); T.step(0.3);
    return { a, c, res, left };
  });
  const same = lk.a.mem.geometries === lk.c.mem.geometries && lk.a.mem.textures === lk.c.mem.textures && lk.a.mem.objects === lk.c.mem.objects;
  expect('place / delete / undo and play / edit / restart cycles leak nothing (geometries, textures, objects, gizmo count); no world zones in edit; leaving the scene frees the gizmo resources', same && lk.a.gz === lk.c.gz && lk.a.n === lk.c.n && lk.c.zones === 0 && lk.left.gz === 0 && !lk.left.res && lk.left.zones === 1, JSON.stringify(lk));
}

// ---- 15. lights: a fixed pool, so placing / removing a point light never recompiles shaders (three.js programs depend on the light count) ----
{
  await ev(() => { const t = T.tool(); if (t.playing) t.edit(); document.exitPointerLock(); window.game.engine.input.free = false; window.game.engine.input.keys.clear(); });
  const FLOORP = { id: 'env.box', pos: [0, -1, 0], params: { size: [300, 1, 300], mat: 'floor' } };
  const lv = await ev((FLOORP) => {
    const g = window.game;
    const t = T.tool();
    t.load({ name: 'lights', title: 'LIGHTS', spawn: { pos: [0, 0, 20], yaw: 3.14159 }, interiorZones: [], pieces: [FLOORP,
      { id: 'kit.wall', pos: [0, 0, -4], params: { length: 8, height: 3, mat: 'wall' } }, { id: 'enemy.static', pos: [3, 0, 0] }, { id: 'enemy.trooper', pos: [-3, 0, 0] }, { id: 'pickup.light', pos: [0, 0, 2] }] });
    g.engine.camera.position.set(0, 4, 8); t.cam.yaw = 0; t.cam.pitch = -0.35;
    // real frames (post stack, shadows, LOD) so every program the scene needs is compiled
    T.frames = (n) => { g.engine.headless = false; for (let i = 0; i < n; i++) g.engine.step(1 / 60); g.engine.headless = true; };
    T.programs = () => g.engine.renderer.info.programs.length;
    T.sceneLights = () => { let n = 0; g.engine.scene.traverse((o) => o.isPointLight && n++); return n; };
    t.select(1); T.frames(3); t.select(-1); // the selection helper's line material is compiled too
    T.frames(4);
    T.tap('KeyP'); T.frames(4); T.tap('KeyP'); T.frames(4); // play once: its materials (merged batches, LOD, shadow) are compiled too
    return { programs: T.programs(), lights: T.sceneLights(), pool: g.world.pool.length, inUse: g.world.lights.length };
  }, FLOORP);
  expect('the world owns a fixed pool of 12 point lights, all parked at intensity 0 in a level without lights', lv.pool === 12 && lv.inUse === 0 && lv.lights === 13, JSON.stringify(lv)); // 12 + the muzzle light
  const r = await ev(() => {
    const g = window.game;
    const t = T.tool();
    const P0 = T.programs();
    const L0 = T.sceneLights();
    const out = { P0, L0, steps: [] };
    const mark = (name) => { T.frames(3); out.steps.push([name, T.programs(), T.sceneLights()]); };
    const a = t.place('light.point', [0, 3, 3], { color: '#ff5030', intensity: 40, distance: 14 });
    mark('placed');
    const pl = g.world.lights[0];
    out.lit = { n: g.world.lights.length, intensity: pl.intensity, distance: pl.distance, color: pl.color.getHexString(), pos: pl.position.toArray() };
    for (let k = 0; k < 4; k++) t.place('light.point', [k * 2 - 3, 3, 1], { color: '#38d8ff', intensity: 20 + k, distance: 10 });
    mark('five');
    t.setParams(a, { intensity: 55, color: '#00ff00' });
    const green = g.world.lights.filter((l) => l.color.getHexString() === '00ff00');
    out.edited = { n: green.length, intensity: green[0]?.intensity, inUse: g.world.lights.length };
    mark('edited');
    t.remove(a); t.remove(t.count - 1);
    mark('removed');
    t.undo(); t.undo(); t.redo(); t.undo();
    mark('undo');
    out.afterUndo = g.world.lights.length;
    // duplicate + move
    const d = t.duplicate(t.count - 1); t.move(d, [5, 3, 5]);
    mark('dup');
    T.tap('KeyP'); T.frames(4);
    out.play = { programs: T.programs(), lights: T.sceneLights(), inUse: g.world.lights.length, lit: g.world.lights.filter((l) => l.intensity > 0).length };
    T.tap('KeyT'); T.frames(3);
    out.restart = { programs: T.programs(), inUse: g.world.lights.length };
    T.tap('KeyP'); T.frames(4);
    out.back = { programs: T.programs(), lights: T.sceneLights(), inUse: g.world.lights.length, lit: g.world.lights.filter((l) => l.intensity > 0).length, ok: t.verify().ok };
    // a scene without lights frees them all again
    for (let k = t.count - 1; k >= 0; k--) if (t.doc.pieces[k].id === 'light.point') t.remove(k);
    T.frames(2);
    out.cleared = { inUse: g.world.lights.length, lit: g.world.pool.filter((l) => l.intensity > 0).length, programs: T.programs(), lights: T.sceneLights() };
    return out;
  });
  const same = r.steps.every(([, pr, n]) => pr === r.P0 && n === r.L0);
  expect('placing, editing, removing, undoing, duplicating point lights in edit mode: renderer.info.programs and the scene light count never change', same, JSON.stringify(r.steps) + ` P0=${r.P0} L0=${r.L0}`);
  expect('  the placed light is a pool light set up from its piece (colour, intensity, distance, position); editing it rebuilds one light in the pool', r.lit.n === 1 && r.lit.intensity === 40 && r.lit.distance === 14 && r.lit.color === 'ff5030' && JSON.stringify(r.lit.pos) === '[0,3,3]' && r.edited.n === 1 && r.edited.intensity === 55 && r.edited.inUse === 5, JSON.stringify({ lit: r.lit, edited: r.edited }));
  expect('  play (and restart, and back to edit) with lights: same programs, same light count, the doc\'s lights lit', r.play.programs === r.P0 && r.restart.programs === r.P0 && r.back.programs === r.P0 && r.play.lights === r.L0 && r.back.lights === r.L0 && r.play.inUse === r.afterUndo + 1 && r.play.lit === r.play.inUse && r.back.inUse === r.play.inUse && r.back.ok, JSON.stringify({ play: r.play, restart: r.restart, back: r.back, afterUndo: r.afterUndo }));
  expect('  deleting every light parks the pool again (intensity 0, none in use)', r.cleared.inUse === 0 && r.cleared.lit === 0 && r.cleared.programs === r.P0 && r.cleared.lights === r.L0, JSON.stringify(r.cleared));

  // past the pool: extra lights are temporary (the count changes, with a warning) and leave nothing behind
  const over = await ev(() => {
    const g = window.game;
    const t = T.tool();
    const warns = [];
    const w0 = console.warn;
    console.warn = (...a) => warns.push(a.join(' '));
    const L0 = T.sceneLights();
    const n0 = t.count;
    for (let k = 0; k < 14; k++) t.place('light.point', [k - 7, 3, -8], { color: '#ffffff', intensity: 5, distance: 6 });
    const mid = { lights: T.sceneLights(), inUse: g.world.lights.length, pool: g.world.pool.length, ok: t.verify().ok };
    for (let k = 0; k < 14; k++) t.remove(t.count - 1);
    console.warn = w0;
    return { warned: warns.length, mid, end: { lights: T.sceneLights(), inUse: g.world.lights.length, n: t.count - n0, pool: g.world.pool.length, parked: g.world.pool.every((l) => l.intensity === 0) }, L0 };
  });
  expect('more than 12 lights: the extras are temporary scene lights (warned), all gone again after deleting them; the pool is untouched', over.warned >= 1 && over.mid.lights === over.L0 + 2 && over.mid.inUse === 14 && over.mid.pool === 12 && over.mid.ok && over.end.lights === over.L0 && over.end.inUse === 0 && over.end.n === 0 && over.end.pool === 12 && over.end.parked, JSON.stringify(over));
}

expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
process.exit(fail.length ? 1 : 0);
