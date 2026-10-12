// Art style rules that keep the game readable (instructions/art-style.md, art pass #87):
// on every enemy kind the magenta weak spots stay brighter than any other glow at rest (sensors included), enemy glows
// are violet / magenta only (never red, orange or amber: amber is STEM-00's), STEM-00's glows are amber only and its
// core follows Player.setCore, the arena wears the weathered skin while the Library keeps the grids, an unknown skin
// throws, and no point light in the arena is red. Pure simulation (engine stopped, headless). Needs the dev server:
// `npm run dev`, then `node tests/art.browser.mjs`.
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const PAGE = (() => { const u = new URL(BASE); u.searchParams.set('scene', 'library'); return u.href; })();
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 160, height: 90 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(PAGE);
await p.waitForFunction(() => window.game?.engine && window.game.level);

const r = await p.evaluate(() => {
  const g = window.game;
  const { engine, player, world } = g;
  engine.stop();
  engine.headless = true;
  const step = (n = 1) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
  const res = [];
  const ok = (name, pass, extra = '') => res.push({ name, pass: !!pass, extra: pass ? '' : String(extra) });

  // glow of a material: luminance of emissive x intensity, and its hue in degrees (null if it doesn't glow)
  const lum = (m) => (m.emissive ? (0.2126 * m.emissive.r + 0.7152 * m.emissive.g + 0.0722 * m.emissive.b) * (m.emissiveIntensity ?? 1) : 0);
  // hue in sRGB degrees (colours are stored linear), null for greys
  const hue = (c) => {
    const hsl = c.getHSL({}, 'srgb');
    return hsl.s < 0.05 ? null : hsl.h * 360;
  };
  const materialsUnder = (root) => {
    const out = new Set();
    root.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) out.add(m);
    });
    return [...out];
  };

  // ---- Library: every enemy kind, demo (never fires). Drone and spider are set awake: their sensors are at the
  // brighter "awake" rest level. Sample a second so the weak-spot pulse goes through its minimum.
  const enemies = g.enemies.puppets;
  const kinds = [...new Set(enemies.map((e) => e.kind))].sort();
  ok('library has every enemy kind', ['boss', 'drone', 'mover', 'shooter', 'static', 'trooper'].every((k) => kinds.includes(k)), kinds.join());
  for (const e of enemies) if (e.kind === 'drone' || e.kind === 'boss') e.awake = true;
  const stats = new Map(); // enemy -> { weakMin, otherMax, worst }
  for (let f = 0; f < 60; f++) {
    step(1);
    for (const e of enemies) {
      const root = e.root ?? e.group;
      const weak = new Set([e.weakMat, e.mats?.weak].filter(Boolean));
      const halo = e.haloMat; // additive halo around the weak spots: adds to them, not a glow of its own
      const s = stats.get(e) ?? { weakMin: Infinity, otherMax: 0, worst: '' };
      for (const m of materialsUnder(root)) {
        const l = lum(m);
        if (m === halo) continue;
        if (weak.has(m)) s.weakMin = Math.min(s.weakMin, l);
        else if (l > s.otherMax) { s.otherMax = l; s.worst = m.emissive.getHexString() + ' x' + m.emissiveIntensity.toFixed(2); }
      }
      stats.set(e, s);
    }
  }
  for (const kind of kinds) {
    const list = enemies.filter((e) => e.kind === kind);
    const bad = list.map((e) => stats.get(e)).find((s) => !(s.weakMin > s.otherMax));
    ok(`${kind}: weak spots stay brighter than every other glow at rest`, !bad, bad && JSON.stringify(bad));
  }
  // enemy glows: violet to magenta only (hue 250..330)
  const offHue = [];
  for (const e of enemies) {
    for (const m of materialsUnder(e.root ?? e.group)) {
      if (lum(m) <= 0) continue;
      const h = hue(m.emissive);
      if (h == null || h < 250 || h > 330) offHue.push(`${e.kind} #${m.emissive.getHexString()}`);
    }
  }
  ok('enemy glows are violet or magenta only', offHue.length === 0, [...new Set(offHue)].join(' '));

  // ---- STEM-00: amber glows only (hue 15..50), the core follows setCore
  const pm = player.soldierMats;
  const playerGlows = materialsUnder(player.root).filter((m) => lum(m) > 0);
  const notAmber = playerGlows.filter((m) => { const h = hue(m.emissive); return h == null || h < 15 || h > 50; });
  ok('STEM-00 glows are amber only (no red)', playerGlows.length > 0 && notAmber.length === 0, notAmber.map((m) => m.emissive.getHexString()).join());
  ok('STEM-00 has its amber core on the body', !!pm.core && playerGlows.includes(pm.core));
  player.setCore(0);
  const lo = pm.core.emissiveIntensity;
  player.setCore(1);
  const hi = pm.core.emissiveIntensity;
  player.setCore(7);
  const clampHi = pm.core.emissiveIntensity;
  player.setCore(-3);
  const clampLo = pm.core.emissiveIntensity;
  ok('setCore: 0 is a faint ember, 1 the full core, clamped', lo > 0 && hi > lo * 5 && clampHi === hi && clampLo === lo, [lo, hi, clampHi, clampLo].join());
  player.setCore(0.5);

  // ---- skins: the Library keeps the grid prototype materials, the arena wears weathered metal
  ok('library: no skin (grid textures, metrics read off them)', world.skin === null && world.material({ mat: 'floor' }) === world.mats.floor);
  g.loadScene('arena');
  step(2);
  ok('arena: weathered skin', world.skin === 'weathered' && world.material({ mat: 'low' }) === world.skins.weathered.low && world.material({ mat: 'low' }) !== world.mats.low);
  const merged = new Set(world.batches.flatMap((m) => (Array.isArray(m.material) ? m.material : [m.material])));
  ok('arena: no grid material is drawn', ![...Object.values(world.mats)].some((m) => m.map && merged.has(m)), [...merged].map((m) => m.map?.image?.width).join());
  const red = world.lights.filter((l) => l.intensity > 0).filter((l) => { const h = hue(l.color); return h != null && (h < 15 || h > 340); });
  ok('arena: no red point light (red is for story beats)', red.length === 0, red.map((l) => l.color.getHexString()).join());
  let threw = '';
  try {
    world.load({ ...g.level, skin: 'nope' }, g.registry);
  } catch (err) {
    threw = err.message;
  }
  ok('an unknown skin throws a clear error', /unknown skin "nope"/.test(threw), threw);
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
