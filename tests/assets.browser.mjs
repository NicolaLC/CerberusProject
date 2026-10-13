// Assets (engine/assets.js): cache, shared in-flight loads, instancing, refcounted release, failed-load retry.
// Fixture: tests/fixtures/tri.gltf (hand-written triangle). Needs the dev server: `bun run dev`, then
// `URL='http://localhost:5173/?debug&scene=arena' node tests/assets.browser.mjs`.
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug&scene=arena';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 160, height: 90 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
await p.goto(BASE);
await p.waitForFunction(() => window.game?.engine);

const r = await p.evaluate(async () => {
  const { engine } = window.game;
  engine.stop();
  const { Assets } = await import('/src/engine/assets.js');
  const gl = engine.renderer;
  const res = [];
  const ok = (name, pass, extra = '') => res.push({ name, pass: !!pass, extra: pass ? '' : String(extra) });
  const U = '/tests/fixtures/tri.gltf';
  const assets = new Assets(gl);
  const base = gl.info.memory.geometries;

  const [p1, p2] = [assets.load(U), assets.load(U)];
  ok('concurrent loads share one promise', p1 === p2);
  const g1 = await p1;
  ok('load resolves to a gltf with a scene', !!g1.scene);
  ok('second load returns the same cached object', (await assets.load(U)) === g1);

  const a = assets.instance(U);
  const c = assets.instance(U);
  const geo = (o) => { let g; o.traverse((m) => { if (m.isMesh) g = m.geometry; }); return g; };
  ok('instances are new objects', a !== c && a !== g1.scene);
  ok('instance shares geometry with the original', geo(a) === geo(g1.scene) && geo(c) === geo(a));

  const scene = engine.scene;
  scene.add(a);
  gl.render(scene, engine.camera);
  ok('rendering uploads the geometry', gl.info.memory.geometries === base + 1, gl.info.memory.geometries - base);
  scene.remove(a);

  assets.release(U);
  assets.release(U);
  ok('geometry survives while a reference is held', gl.info.memory.geometries === base + 1);
  assets.release(U);
  ok('last release disposes back to the baseline', gl.info.memory.geometries === base, gl.info.memory.geometries - base);
  ok('released url is dropped from the cache', !assets.entries.has(U));

  const bad = '/tests/fixtures/missing.gltf';
  let msg = '';
  await assets.load(bad).catch((e) => { msg = e.message; });
  ok('bad url rejects naming the url', msg.includes(bad), msg);
  ok('failed load leaves no cache entry', !assets.entries.has(bad));
  ok('preload resolves all', (await assets.preload([U])).length === 1);
  assets.release(U);
  return res;
});

let bad = 0;
for (const x of r) {
  if (!x.pass) bad++;
  console.log(`${x.pass ? 'ok  ' : 'FAIL'} ${x.name}${x.pass ? '' : ' ' + x.extra}`);
}
if (errors.length) { console.log('page errors:', errors); bad++; }
console.log(`${r.length - r.filter((x) => !x.pass).length}/${r.length} passed`);
await b.close();
process.exit(bad ? 1 : 0);
