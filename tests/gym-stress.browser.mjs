// Gym stress room (?scene=gym-stress): the StressTool spawns N of each kind through the registry and reports what it
// costs. Draw calls, triangles and geometries do not depend on the hardware, so they are asserted (linear in N,
// stable between runs); frame time is only printed (SwiftShader timings are not GPU timings).
// Worst case is measured on purpose: the player stands in the middle of the units (all in the near LOD, within the
// shadow frustum) and frustum culling is switched off, so every unit counts as visible.
// Needs the dev server: `npx vite --port 5204 --strictPort`, then `URL='http://localhost:5204/?debug' node tests/gym-stress.browser.mjs`.
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const scene = (name) => {
  const u = new URL(BASE);
  u.searchParams.set('scene', name);
  return u.href;
};
const COUNTS = [0, 4, 8, 16, 32];
const KINDS = ['puppets', 'troopers', 'drones', 'lights', 'fx'];
const ONLY = process.env.ONLY?.split(','); // quick runs: ONLY=fx runs just the cost table of those kinds

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const fail = [];
const expect = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`);
  if (!ok) fail.push(name);
};

await p.goto(scene('gym-stress'));
await p.waitForFunction(() => window.game?.engine && window.game.tool);

// Page helpers: stepping, measuring, the leak probe (same idea as scenes.browser.mjs).
await p.evaluate(() => {
  const g = window.game;
  const e = g.engine;
  e.stop();
  e.perf.enabled = false;
  const step = (n) => {
    for (let i = 0; i < n; i++) e.step(1 / 60);
  };
  // scene objects, geometries and textures once everything drawable was uploaded (both LOD variants, no culling)
  const probe = () => {
    step(2);
    const culled = [];
    e.scene.traverse((o) => {
      if (o.frustumCulled) culled.push(o);
      o.frustumCulled = false;
    });
    for (const far of [true, false]) {
      for (const en of g.enemies.puppets) en.skin?.setFar(far);
      e.renderer.render(e.scene, e.camera);
    }
    for (const o of culled) o.frustumCulled = true;
    let objects = 0;
    e.scene.traverse(() => objects++);
    const m = e.renderer.info.memory;
    return { geometries: m.geometries, textures: m.textures, objects, lights: g.world.lights.length, puppets: g.enemies.puppets.length };
  };
  // one frame's renderer totals with culling off
  const frame = () => {
    step(3);
    const culled = [];
    e.scene.traverse((o) => {
      if (o.frustumCulled) culled.push(o);
      o.frustumCulled = false;
    });
    step(1);
    for (const o of culled) o.frustumCulled = true;
    const r = e.renderer.info.render;
    let pointLights = 0;
    e.scene.traverse((o) => o.isPointLight && o.visible && pointLights++);
    return { calls: r.calls, tris: r.triangles, pointLights };
  };
  // simulate without drawing (SwiftShader draws 100 units slowly); particles, pools and debris still run
  const quiet = (n) => {
    e.headless = true;
    step(n);
    e.headless = false;
  };
  window.__t = { step, quiet, probe, frame };
  // player in the middle of the units, as if the camera were above them
  g.player.place({ pos: [0, 0, 0], yaw: 0 });
  step(2);
});

// ---- 1. per-unit costs ----
const table = {}; // kind -> [{ n, calls, tris, geometries, ms }]
for (const kind of KINDS) {
  if (ONLY && !ONLY.includes(kind)) continue;
  table[kind] = [];
  // warm-up spawn: shared caches (debris geometry, textures) are created on first use, outside the measure
  await p.evaluate((k) => {
    const t = window.game.tool;
    t.setCount(k, 4);
    window.__t.probe();
    t.clear();
  }, kind);
  for (const n of COUNTS) {
    const r = await p.evaluate(
      ({ k, n }) => {
        const g = window.game;
        const t = g.tool;
        t.clear();
        window.__t.step(2);
        t.setCount(k, n);
        const t0 = performance.now();
        const f = window.__t.frame();
        const ms = (performance.now() - t0) / 4;
        // the fx kind only lives for a few frames, so geometry is read right away as well
        const m = window.__t.probe();
        t.clear();
        return { n, ...f, ...m, ms };
      },
      { k: kind, n },
    );
    table[kind].push(r);
  }
}

// least-squares slope and the worst deviation of the points from the fitted line
const fit = (rows, key) => {
  const xs = rows.map((r) => r.n);
  const ys = rows.map((r) => r[key]);
  const mx = xs.reduce((a, c) => a + c, 0) / xs.length;
  const my = ys.reduce((a, c) => a + c, 0) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const dev = Math.max(...xs.map((x, i) => Math.abs(ys[i] - (my + slope * (x - mx)))));
  return { slope, dev, range: Math.max(...ys) - Math.min(...ys) };
};

console.log('\nper unit (least-squares slope over 0, 4, 8, 16, 32), worst case: all units in view, near LOD');
console.log('kind      draws/unit  tris/unit  geometries/unit  ms/frame at 0 -> 32 (SwiftShader, informational)');
const per = {};
for (const kind of KINDS) {
  if (!table[kind]) continue;
  const rows = table[kind];
  const d = fit(rows, 'calls');
  // sparks are capped (fx.js MAX_SPARKS = 256, 16 per burst): triangles saturate at 16+ bursts, so fit up to there
  const t = fit(kind === 'fx' ? rows.filter((r) => r.n <= 16) : rows, 'tris');
  const g = fit(rows, 'geometries');
  console.log(rows.map((r) => `${r.n}: ${r.calls} draws ${r.tris} tris ${r.geometries} geos`).join(' | '));
  per[kind] = { draws: d.slope, tris: t.slope, geos: g.slope };
  const ms = rows.map((r) => r.ms.toFixed(0)).join(' ');
  console.log(`${kind.padEnd(9)} ${d.slope.toFixed(2).padStart(10)} ${t.slope.toFixed(0).padStart(10)} ${g.slope.toFixed(2).padStart(16)}   ${ms}`);
  // linear: no point further from the fitted line than 5% of the span (or 2 units for tiny spans)
  expect(`${kind}: draw calls linear in N (dev ${d.dev.toFixed(1)} of ${d.range})`, d.dev <= Math.max(2, 0.05 * d.range));
  expect(`${kind}: triangles linear in N (dev ${t.dev.toFixed(0)} of ${t.range})`, t.dev <= Math.max(50, 0.05 * t.range));
  expect(`${kind}: geometries linear in N (dev ${g.dev.toFixed(1)} of ${g.range})`, g.dev <= Math.max(2, 0.05 * g.range));
}
const at0 = table.puppets?.[0];
if (at0) expect(`baseline room is cheap (${at0.calls} draws)`, at0.calls > 0 && at0.calls < 60, JSON.stringify(at0));
expect('puppets cost draw calls and triangles', per.puppets.draws > 0 && per.puppets.tris > 0);
expect('troopers cost draw calls and triangles', per.troopers.draws > 0 && per.troopers.tris > 0);
expect('drones cost draw calls and triangles', per.drones.draws > 0 && per.drones.tris > 0);
expect('a point light costs no draw call and no triangle', Math.abs(per.lights.draws) < 0.1 && Math.abs(per.lights.tris) < 1);
expect('the renderer sees every spawned point light', table.lights.every((r) => r.pointLights === r.n + 1), JSON.stringify(table.lights.map((r) => r.pointLights))); // +1: the permanent muzzle light
expect('effect bursts are draw calls (rings, smoke), no new geometry', per.fx.draws > 0 && Math.abs(per.fx.geos) < 0.1);

// far LOD: the same units seen from beyond the switch distance (32 m): one draw per rig, no shadow casting
if (!ONLY) {
  const far = await p.evaluate(() => {
    const g = window.game;
    const t = g.tool;
    g.player.place({ pos: [0, 0, 62], yaw: 0 });
    window.__t.step(3);
    const out = {};
    for (const k of ['puppets', 'troopers', 'drones']) {
      out[k] = [];
      for (const n of [0, 16, 32]) {
        t.clear();
        t.setCount(k, n);
        const f = window.__t.frame();
        out[k].push({ n, ...f });
      }
    }
    t.clear();
    g.player.place({ pos: [0, 0, 0], yaw: 0 });
    window.__t.step(3);
    return out;
  });
  console.log('\nper unit, far LOD (camera 40+ m away)');
  for (const k of ['puppets', 'troopers', 'drones']) {
    const d = fit(far[k], 'calls');
    const tr = fit(far[k], 'tris');
    per[`${k}Far`] = { draws: d.slope, tris: tr.slope };
    console.log(`${k.padEnd(9)} ${d.slope.toFixed(2).padStart(10)} draws ${tr.slope.toFixed(0).padStart(8)} tris`);
    expect(`${k}: far LOD is cheaper than near (${d.slope.toFixed(1)} < ${per[k].draws.toFixed(1)} draws)`, d.slope > 0 && d.slope < per[k].draws && tr.slope <= per[k].tris); // drones keep their shadow, so equal triangles
  }
}

// stable: the same spawn twice costs the same
{
  const run = () =>
    p.evaluate(() => {
      const t = window.game.tool;
      t.clear();
      t.setCount('puppets', 8);
      t.setCount('troopers', 8);
      t.setCount('drones', 8);
      const f = window.__t.frame();
      t.clear();
      return f;
    });
  const a = await run();
  const c = await run();
  expect(`same spawn, same cost (${a.calls} / ${c.calls} draws, ${a.tris} / ${c.tris} tris)`, a.calls === c.calls && a.tris === c.tris);
}

// ---- 2. debris: destroyed units cost more draw calls until the debris is gone ----
for (const kind of ['puppets', 'troopers', 'drones']) {
  const r = await p.evaluate((k) => {
    const g = window.game;
    const t = g.tool;
    t.clear();
    t.setCount(k, 8);
    const alive = window.__t.frame();
    const killed = t.destroyAll();
    const rubble = window.__t.frame();
    // the debris lifetime and more, without drawing (quick)
    window.__t.quiet(60 * 8);
    const gone = window.__t.frame();
    t.clear();
    return { alive, rubble, gone, killed };
  }, kind);
  console.log(`debris, 8 ${kind}: alive ${r.alive.calls} draws / ${r.alive.tris} tris, just destroyed ${r.rubble.calls} / ${r.rubble.tris}, debris expired ${r.gone.calls} / ${r.gone.tris}`);
  per[`${kind}Debris`] = { draws: (r.rubble.calls - r.alive.calls) / 8, tris: (r.rubble.tris - r.alive.tris) / 8 };
  expect(`${kind}: destroyAll destroys all 8`, r.killed === 8);
  expect(`${kind}: debris costs draw calls while it flies`, r.rubble.calls > r.alive.calls);
  expect(`${kind}: expired debris leaves less than the live units`, r.gone.calls < r.alive.calls);
}

// ---- 3. spawned enemies stand still and never fight ----
{
  const r = await p.evaluate(() => {
    const g = window.game;
    const t = g.tool;
    t.clear();
    for (const k of ['puppets', 'troopers', 'drones']) t.setCount(k, 8);
    g.engine.headless = true;
    const hp = g.player.health;
    let bolts = 0;
    let awake = 0;
    for (let i = 0; i < 60 * 12; i++) {
      g.engine.step(1 / 60);
      bolts = Math.max(bolts, g.enemies.bolts.length);
    }
    for (const e of g.enemies.puppets) if (e.alerted || e.awake) awake++;
    const out = { bolts, awake, hurt: g.player.health < hp, count: g.enemies.puppets.length };
    g.engine.headless = false;
    t.clear();
    return out;
  });
  expect(`24 enemies around the player for 12 s: no bolts, none awake, no damage (${JSON.stringify(r)})`, r.count === 24 && r.bolts === 0 && r.awake === 0 && !r.hurt);
}

// ---- 4. keys, panel, sweep ----
{
  const r = await p.evaluate(() => {
    const g = window.game;
    const t = g.tool;
    t.clear();
    const press = (code, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, ...extra }));
    const panel = !!document.getElementById('stress-panel');
    press('BracketRight');
    press('BracketRight');
    press('BracketLeft');
    const one = t.counts.puppets; // selected kind starts at puppets
    press('BracketRight', { shiftKey: true });
    const five = t.counts.puppets;
    const spawned = g.enemies.puppets.length;
    t.clear();
    // sweep: stepped headless
    g.engine.headless = true;
    press('KeyP');
    const started = !!t.sweep;
    let frames = 0;
    while (t.sweep && frames++ < 60 * 200) g.engine.step(1 / 60);
    g.engine.headless = false;
    return { panel, one, five, spawned, started, frames, rows: t.results.length, kinds: [...new Set(t.results.map((x) => x.kind))], left: g.enemies.puppets.length + g.world.lights.length, done: !t.sweep };
  });
  expect('the panel exists', r.panel);
  expect('[ and ] step the selected count', r.one === 1 && r.five === 5 && r.spawned === 5, JSON.stringify(r));
  expect(`P runs the sweep to the end (${r.rows} rows in ${r.frames} frames) and clears the room`, r.started && r.done && r.rows === 5 * 6 && r.kinds.length === 5 && r.left === 0, JSON.stringify(r));
}

// ---- 5. nothing leaks ----
{
  const r = await p.evaluate(() => {
    const g = window.game;
    const t = g.tool;
    t.clear();
    window.__t.quiet(2);
    // One full round: everything at 32, destroyed while the debris still flies, cleared, particles and clips gone.
    // The effect pools create their hidden meshes on demand (up to the most that were ever alive at once), so one
    // round runs first to reach that high-water mark; the baseline is read after it and every later round must match.
    const round = () => {
      for (const k of ['puppets', 'troopers', 'drones', 'lights', 'fx']) t.setCount(k, 32);
      window.__t.quiet(70);
      window.__t.probe();
      t.destroyAll();
      window.__t.quiet(30);
      t.clear();
      window.__t.quiet(60 * 26); // dropped ammo clips (45% of kills) time out after 25 s: Pickups, not the tool
      return window.__t.probe();
    };
    round();
    const base = window.__t.probe();
    const rounds = [round(), round(), round()];
    return { base, rounds };
  });
  const same = (a) => a.geometries === r.base.geometries && a.textures === r.base.textures && a.objects === r.base.objects && a.lights === 0 && a.puppets === 0;
  expect(`clearing returns geometries, textures and scene objects to the baseline ${JSON.stringify(r.base)}`, r.rounds.every(same), JSON.stringify(r.rounds));
}

// ---- 6. the scene switch leak check still holds ----
{
  const r = await p.evaluate(() => {
    const g = window.game;
    const read = () => {
      g.engine.headless = false;
      const m = window.__t.probe();
      return { geometries: m.geometries, textures: m.textures, objects: m.objects };
    };
    g.loadScene('arena');
    window.__t.step(2);
    const first = read();
    const arena = [];
    let listenerLeak = false;
    for (let i = 0; i < 3; i++) {
      g.loadScene('gym-stress');
      const tool = g.tool;
      for (const k of ['puppets', 'troopers', 'drones', 'lights', 'fx']) tool.setCount(k, 16);
      window.__t.step(4);
      g.loadScene('arena'); // switches away with 80 units spawned: the tool frees them
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketRight' })); // the old tool must not hear it
      const stray = g.enemies.puppets.length - g.registry.piecesOf(g.level, 'enemies').length;
      listenerLeak ||= stray !== 0 || !!document.getElementById('stress-panel') || g.enemies.demo === true;
      window.__t.step(2);
      arena.push(read());
    }
    return { first, arena, listenerLeak };
  });
  expect(`arena -> gym-stress (80 units) -> arena x3: geometries / textures / objects identical (${JSON.stringify(r.arena[0])})`, r.arena.every((a) => a.geometries === r.arena[0].geometries && a.textures === r.arena[0].textures && a.objects === r.arena[0].objects), JSON.stringify(r.arena));
  expect('switching away removes the panel, the key listener and the demo flag', !r.listenerLeak);
}

// ---- 7. screenshot with a crowd ----
if (process.env.SHOT) {
  await p.setViewportSize({ width: 1280, height: 720 });
  const shot = await p.evaluate(() => {
    const g = window.game;
    g.loadScene('gym-stress');
    g.engine.perf.enabled = false;
    const t = g.tool;
    t.setCount('puppets', 24);
    t.setCount('troopers', 24);
    t.setCount('drones', 16);
    t.setCount('lights', 8);
    t.setCount('fx', 4);
    g.player.place({ pos: [0, 0, 34], yaw: Math.PI });
    for (let i = 0; i < 30; i++) g.engine.step(1 / 60);
    return g.engine.canvas.toDataURL('image/png'); // same task as the last render: the drawing buffer is still there
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.SHOT, Buffer.from(shot.split(',')[1], 'base64'));
}

expect('no page or console errors', errors.length === 0, errors.join(' | '));
console.log('\nJSON', JSON.stringify(per));
await b.close();
process.exit(fail.length ? 1 : 0);
