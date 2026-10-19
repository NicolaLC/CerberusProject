// Art-review screenshot set: the same angles every run, for before/after comparisons (issue #87, book/screenshots).
// Needs the dev server (`bun run dev`) and Playwright + Chromium (like the browser suites).
//   node scripts/screenshots.mjs [outDir] [name ...]     default outDir: shots/, default: every shot
// Each shot opens a scene, places the player, steps the engine, optionally moves the camera off the rig,
// renders one frame through the post stack and saves the canvas (no DOM HUD) as a PNG.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.env.URL ?? 'http://localhost:5173/';
const OUT = process.argv[2] ?? 'shots';
const ONLY = process.argv.slice(3);
const W = 960;
const H = 540;

// player: [x, y, z], facing (rad, PI = north); cam: free camera { pos, look } (else the game's over-the-shoulder view)
const SHOTS = [
  { name: '01-stem00-front', scene: 'arena', player: [0, 0, 38], facing: Math.PI, cam: { pos: [0.8, 1.45, 35.6], look: [0, 1.05, 38] } },
  { name: '02-arachne-spider-mech', scene: 'library', player: [26, 0, 40], facing: Math.PI, yaw: -0.05 },
  { name: '03-interior-hall', scene: 'arena', player: [0, 0, -34], facing: Math.PI },
  { name: '04-arena-overview', scene: 'arena', player: [-2, 0, 30], facing: Math.PI, cam: { pos: [1.4, 1.7, 26.4], look: [-1.6, 1.0, 30] } },
  { name: '05-library-units', scene: 'library', player: [0, 0, 34], facing: Math.PI },
  { name: '06-stem00-closeup', scene: 'library', player: [0, 0, 20], facing: Math.PI - 0.5, cam: { pos: [-0.5, 1.4, 18.4], look: [0, 1.0, 20] } },
  { name: '07-trooper-and-drone', scene: 'library', player: [10, 0, 34], facing: Math.PI, cam: { pos: [10, 1.9, 33], look: [9.5, 1.4, 26] } },
  { name: '08-puppets', scene: 'library', player: [-12, 0, 36], facing: Math.PI, cam: { pos: [-13, 2.0, 35], look: [-13, 0.9, 26] } },
  // focus: frame the nearest enemy of that kind to `near` from `offset` (m from its model origin), looking at origin + look
  { name: '09-trooper-closeup', scene: 'library', player: [-27, 0, 56], facing: 0, focus: { kind: 'trooper', near: [-26.7, 0, 46], offset: [0.7, 1.45, 2.0], look: [0, 1.1, 0] } },
  { name: '10-drone-closeup', scene: 'library', player: [14, 0, 36], facing: Math.PI, focus: { kind: 'drone', near: [14, 0, 26], offset: [1.0, 0.5, 2.2], look: [0, 0, 0] } },
  { name: '11-spider-closeup', scene: 'library', player: [28, 0, 38], facing: Math.PI, focus: { kind: 'boss', near: [28, 0, 22], offset: [2.5, 1.3, 8.5], look: [0, 2.6, 0] } },
  { name: '11b-spider-front', scene: 'library', player: [28, 0, 38], facing: Math.PI, focus: { kind: 'boss', near: [28, 0, 22], offset: [0, 1.6, 11], look: [0, 3.0, 0] } },
  { name: '12-puppets-closeup', scene: 'library', player: [-18, 0, 36], facing: Math.PI, focus: { kind: 'static', near: [-22, 0, 26], offset: [-0.9, 1.5, 2.4], look: [0, 1.1, 0] } },
  { name: '13-guns', scene: 'library', player: [-18, 0, 20], facing: Math.PI, cam: { pos: [-22.4, 1.45, 11.5], look: [-22.4, 0.98, 10] } },
  { name: '14-gym-ai', scene: 'gym-ai', player: [-3, 0, 3], facing: Math.PI },
  // gun display models (Library aisle 2), side on
  { name: '15-gun-rifle', scene: 'library', player: [-23, 0, 20], facing: Math.PI, cam: { pos: [-22.58, 1.12, 10.78], look: [-22.58, 0.96, 10] } },
  { name: '16-gun-mg', scene: 'library', player: [-14, 0, 20], facing: Math.PI, cam: { pos: [-13.45, 1.12, 10.90], look: [-13.45, 0.96, 10] } },
  { name: '17-gun-sniper', scene: 'library', player: [-5, 0, 20], facing: Math.PI, cam: { pos: [-4.40, 1.12, 10.97], look: [-4.40, 0.96, 10] } },
  { name: '18-gun-burst', scene: 'library', player: [4, 0, 20], facing: Math.PI, cam: { pos: [4.45, 1.12, 10.80], look: [4.45, 0.96, 10] } },
  { name: '19-gun-rail', scene: 'library', player: [13, 0, 20], facing: Math.PI, cam: { pos: [13.60, 1.12, 10.93], look: [13.60, 0.96, 10] } },
  { name: '20-gun-pistol', scene: 'library', player: [22, 0, 20], facing: Math.PI, cam: { pos: [22.45, 1.12, 10.53], look: [22.45, 0.96, 10] } },
];

mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
let scene = null;
for (const s of SHOTS) {
  if (ONLY.length && !ONLY.includes(s.name)) continue;
  if (s.scene !== scene) {
    await p.goto(`${URL}?debug&scene=${s.scene}`);
    await p.waitForFunction(() => window.game);
    await p.evaluate(() => window.game.engine.stop());
    scene = s.scene;
  }
  const png = await p.evaluate((s) => {
    const g = window.game;
    const { player, camRig, engine, post } = g;
    player.pos.set(...s.player);
    player.facing = s.facing;
    player.vel?.set(0, 0, 0);
    camRig.reset(s.facing);
    if (s.yaw != null) camRig.yaw += s.yaw;
    engine.headless = true; // settle without drawing: idle pose, camera follow (SwiftShader draws at a few fps)
    for (let i = 0; i < 40; i++) engine.step(1 / 30);
    engine.headless = false;
    engine.step(1 / 30); // one drawn frame: lazy uploads, exposure
    const cam = engine.camera;
    let view = s.cam;
    if (s.focus) {
      const f = s.focus;
      const all = g.enemies.all.filter((e) => e.kind === f.kind && e.alive);
      const d = (e) => Math.hypot(e.pos.x - f.near[0], e.pos.z - f.near[2]);
      const e = all.sort((a, b) => d(a) - d(b))[0];
      const o = (e.root ?? e.group ?? e.rig.root).getWorldPosition(cam.position.clone());
      view = { pos: [o.x + f.offset[0], o.y + f.offset[1], o.z + f.offset[2]], look: [o.x + f.look[0], o.y + f.look[1], o.z + f.look[2]] };
    }
    if (view) {
      cam.position.set(...view.pos);
      cam.lookAt(...view.look);
      cam.updateMatrixWorld();
      player.root.visible = true;
    }
    post.composer.render(0);
    return engine.renderer.domElement.toDataURL('image/png');
  }, s);
  writeFileSync(join(OUT, `${s.name}.png`), Buffer.from(png.split(',')[1], 'base64'));
  console.log('saved', s.name);
}
await b.close();
if (errors.length) {
  console.error(errors);
  process.exit(1);
}
