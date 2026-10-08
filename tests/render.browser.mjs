// Render budget regression: draw calls per frame (color + shadow + post) and batching invariants.
// Needs the dev server: `npm run dev`, then `node tests/render.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const BUDGET = 300; // draw calls at the spawn view (was ~1200 before batching)
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(URL);
await p.waitForFunction(() => window.game);
const r = await p.evaluate(() => {
  const g = window.game;
  g.engine.stop();
  for (let i = 0; i < 10; i++) g.engine.step(1 / 60);
  const info = g.engine.renderer.info.render;
  const skins = [g.player.skin, ...g.enemies.puppets.map((pp) => pp.skin)];
  return {
    calls: info.calls,
    minCullRadius: Math.min(...skins.flatMap((s) => s.meshes.map((m) => m.boundingSphere.radius))),
    proxiesHidden: g.world.meshes.every((m) => !m.visible),
    hitMeshesHidden: g.enemies.puppets.every((pp) => pp.hitMeshes.every((m) => !m.visible)),
  };
});
console.log(r);
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect(`draw calls within budget (${r.calls} <= ${BUDGET})`, r.calls <= BUDGET);
expect('skinned meshes have a real culling sphere', r.minCullRadius > 0.5);
expect('world and hitbox proxies are not drawn', r.proxiesHidden && r.hitMeshesHidden);
expect('no page errors', errors.length === 0);
await b.close();
process.exit(fail.length ? 1 : 0);
