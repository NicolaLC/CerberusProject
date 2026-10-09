import { chromium } from 'playwright';

// Renderer benchmark (not a pass/fail test): main-thread ms per frame at the spawn view and in a fight view,
// for the URL given (default WebGL). SwiftShader numbers only compare renderers relative to each other.
// Usage: [CPU=1] [W=.. H=..] node tests/bench.browser.mjs [url-suffix]   e.g. '&renderer=webgl'
const URL = `http://localhost:5173/?debug${process.argv[2] ?? ''}`;
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const p = await b.newPage({ viewport: { width: +(process.env.W ?? 1280), height: +(process.env.H ?? 720) } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(URL);
await p.waitForFunction(() => window.game?.engine);
const r = await p.evaluate(async (cpu) => {
  const g = window.game;
  const e = g.engine;
  e.stop();
  e.perf.enabled = false; // fixed resolution
  // CPU mode: a tiny canvas and shadow map make the (software) GPU work negligible, leaving the renderer's
  // main-thread cost per frame: scene traversal, state, uniforms, draw submission.
  if (cpu) {
    g.world.sun.shadow.mapSize.set(64, 64);
    e.perf.scale = e.perf.maxScale = 0.1;
    e.resize();
  }
  const run = async (n) => {
    for (let i = 0; i < 20; i++) e.step(1 / 60); // warm up (pipelines, uploads)
    await new Promise((r) => setTimeout(r, 500));
    const t0 = performance.now();
    let draws = 0;
    for (let i = 0; i < n; i++) {
      e.step(1 / 60);
      draws = e.drawCalls;
    }
    const top = Object.entries(e.timings).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ');
    return { ms: +((performance.now() - t0) / n).toFixed(2), draws, top, render: +Object.entries(e.timings).filter(([k]) => /render|post/.test(k)).reduce((a, [, v]) => a + v, 0).toFixed(2) };
  };
  const spawn = await run(120);
  // turn toward the yard full of puppets
  g.camRig.yaw += Math.PI;
  const turned = await run(120);
  return { backend: e.backend, spawn, turned };
}, !!process.env.CPU);
console.log(JSON.stringify({ url: URL, ...r, errors: errors.slice(0, 3) }));
await b.close();
