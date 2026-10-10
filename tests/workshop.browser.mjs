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

expect('no page or console errors', errors.length === 0, errors.join(' | '));
await b.close();
process.exit(fail.length ? 1 : 0);
