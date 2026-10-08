// Render budget regression: draw calls per frame (color + shadow + post) and batching invariants.
// Needs the dev server: `npm run dev`, then `node tests/render.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:5173/?debug';
const BUDGET = 140; // draw calls at the spawn view (~1200 before batching, ~240 before shadow batching, ~187 before puppet LOD)
const SHADOW_BUDGET = 25; // of which the sun shadow pass (was ~60 before shadow-only meshes)
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
  const calls = info.calls;
  g.world.sun.castShadow = false;
  g.engine.step(1 / 60);
  const shadowCalls = calls - info.calls;
  g.world.sun.castShadow = true;
  g.engine.step(1 / 60);
  const far = g.enemies.puppets.filter((pp) => pp.pos.distanceTo(g.engine.camera.position) > 40);
  const lodFar = g.enemies.puppets.filter((pp) => pp.pos.distanceTo(g.engine.camera.position) > 34);
  const lodOk = lodFar.every((pp) => pp.skin.far && pp.skin.lodMesh.visible && pp.skin.meshes.every((m) => !m.visible));
  // a far (LOD) puppet must still be hittable: its hitboxes are untouched proxies.
  // Many far puppets are legitimately behind walls from the spawn, so any one in sight must read as an enemy.
  let hittable = false;
  for (const target of lodFar) {
    if (!target.alive) continue;
    for (let i = 0; i < 20; i++) {
      const c = g.engine.camera.position;
      const t = target.rig.bones.Spine2.getWorldPosition(c.clone());
      g.camRig.yaw = Math.atan2(-(t.x - c.x), -(t.z - c.z));
      g.camRig.pitch = Math.atan2(t.y - c.y, Math.hypot(t.x - c.x, t.z - c.z));
      g.engine.step(1 / 60);
    }
    if (g.weapon.aim.enemy && target.skin.far) {
      hittable = true;
      break;
    }
  }
  const skins = [g.player.skin, ...g.enemies.puppets.map((pp) => pp.skin)];
  return {
    calls,
    lodOk,
    lodCount: lodFar.length,
    hittable,
    shadowCalls,
    farCasting: far.filter((pp) => pp.skin.castShadow).length,
    shadowOnlyHidden: skins.every((s) => !s.shadow || !s.shadow.visible),
    minCullRadius: Math.min(...skins.flatMap((s) => s.meshes.map((m) => m.boundingSphere.radius))),
    proxiesHidden: g.world.meshes.every((m) => !m.visible),
    hitMeshesHidden: g.enemies.puppets.every((pp) => pp.hitMeshes.every((m) => !m.visible)),
  };
});
console.log(r);
const fail = [];
const expect = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fail.push(name); };
expect(`draw calls within budget (${r.calls} <= ${BUDGET})`, r.calls <= BUDGET);
expect(`shadow pass within budget (${r.shadowCalls} <= ${SHADOW_BUDGET})`, r.shadowCalls > 0 && r.shadowCalls <= SHADOW_BUDGET);
expect('far puppets do not cast', r.farCasting === 0);
expect(`far puppets use the one-draw LOD (${r.lodCount})`, r.lodOk && r.lodCount > 0);
expect('a far LOD puppet is still hittable', r.hittable);
expect('shadow-only meshes never drawn in the color pass', r.shadowOnlyHidden);
expect('skinned meshes have a real culling sphere', r.minCullRadius > 0.5);
expect('world and hitbox proxies are not drawn', r.proxiesHidden && r.hitMeshesHidden);
expect('no page errors', errors.length === 0);
await b.close();
process.exit(fail.length ? 1 : 0);
