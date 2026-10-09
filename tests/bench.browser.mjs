import { chromium } from 'playwright';

// Renderer CPU benchmark (not pass/fail): main-thread JavaScript ms per frame, from a CPU profile, with idle time
// left out. A tiny canvas and shadow map keep the software GPU's work small, so the number is the renderer's own
// cost (scene traversal, state, uniforms, draw submission) plus the game systems.
// Caveat: SwiftShader WebGL calls can block when its GPU falls behind (seen as uniformMatrix4fv time), so compare
// renderers on a light view (TURN=1: facing the yard) and read heavy-view WebGL numbers as upper bounds.
// Usage: [TURN=1] [HEADED=1 xvfb-run -a] node tests/bench.browser.mjs   (BASE=http://localhost:5174 for another build)
const BASE = process.env.BASE ?? 'http://localhost:5173';
const b = await chromium.launch({
  headless: !process.env.HEADED,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'],
});
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto(`${BASE}/?debug${process.argv[2] ?? ''}`);
await p.waitForFunction(() => window.game?.engine);
await p.evaluate(async (turn) => {
  const g = window.game;
  const e = g.engine;
  e.stop();
  e.perf.enabled = false;
  const sh = g.world.sun.shadow;
  sh.mapSize.set(64, 64);
  if (sh.map) {
    sh.map.dispose();
    sh.map = null;
  }
  e.perf.scale = e.perf.maxScale = 0.1;
  e.resize();
  if (turn) g.camRig.yaw += Math.PI;
  for (let i = 0; i < 30; i++) e.step(1 / 60); // warm up
  await new Promise((r) => setTimeout(r, 500));
}, !!process.env.TURN);
const cdp = await p.context().newCDPSession(p);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
const FRAMES = 60;
const info = await p.evaluate((n) => {
  const e = window.game.engine;
  for (let i = 0; i < n; i++) e.step(1 / 60);
  return { backend: e.backend, draws: e.drawCalls };
}, FRAMES);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
let total = 0;
let idle = 0;
profile.samples.forEach((id, i) => {
  const t = profile.timeDeltas[i] || 0;
  total += t;
  if (/^\((program|idle|garbage collector)\)$/.test(byId.get(id).callFrame.functionName)) idle += t;
});
console.log(JSON.stringify({ ...info, view: process.env.TURN ? 'yard' : 'spawn', jsMsPerFrame: +((total - idle) / 1000 / FRAMES).toFixed(2) }));
await b.close();
