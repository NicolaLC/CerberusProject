// Scene switcher: every scene opens through ?scene=, and switching scenes at runtime unloads the old level
// completely (no leaked geometry, textures or scene objects), puts the player at the new spawn and resets
// per-level state (boss bar, kill counter, lock-on).
// Needs the dev server: `npm run dev`, then `node tests/scenes.browser.mjs` (Playwright + Chromium).
// Unlike the other suites this one RENDERS a few frames per scene: renderer.info.memory only counts what was
// uploaded to the GPU, which is what a leak would pile up.
import { chromium } from 'playwright';

const BASE = process.env.URL ?? 'http://localhost:5173/?debug';
const withScene = (scene) => {
  const u = new URL(BASE);
  if (scene != null) u.searchParams.set('scene', scene);
  return u.href;
};
const SCENES = ['arena', 'gym', 'library', 'workshop'];
const CYCLES = 3;

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'] });
const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };

// What the page reports about the loaded scene. Steps `frames` rendered frames first.
const probe = (frames) => {
  const g = window.game;
  const { engine } = g;
  engine.stop();
  for (let i = 0; i < frames; i++) engine.step(1 / 60);
  // Upload everything drawable, whatever the camera sees right now: three uploads lazily, so the counts would
  // otherwise move with culling and LOD (enemies wander in and out of view). Both LOD variants, no culling.
  const culled = [];
  engine.scene.traverse((o) => {
    if (o.frustumCulled) culled.push(o);
    o.frustumCulled = false;
  });
  for (const far of [true, false]) {
    for (const e of g.enemies.puppets) e.skin?.setFar(far);
    engine.renderer.render(engine.scene, engine.camera);
  }
  for (const o of culled) o.frustumCulled = true;
  let objects = 0;
  engine.scene.traverse(() => objects++);
  const pieces = (owner) => g.registry.piecesOf(g.level, owner).length;
  return {
    scene: g.sceneName,
    levelName: g.level.name,
    spawn: g.level.spawn.pos,
    pos: [g.player.pos.x, g.player.pos.y, g.player.pos.z],
    facing: g.player.facing,
    enemies: g.enemies.puppets.length,
    enemyPieces: pieces('enemies'),
    pickups: g.pickups.items.length,
    pickupPieces: pieces('pickups'),
    colliders: g.world.colliders.length,
    geometries: engine.renderer.info.memory.geometries,
    textures: engine.renderer.info.memory.textures,
    objects,
    children: engine.scene.children.length,
  };
};

// ---- 1. each scene opens through the URL flag ----
for (const name of SCENES) {
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(withScene(name));
  await p.waitForFunction(() => window.game?.engine);
  const r = await p.evaluate(probe, 2);
  expect(`?scene=${name} opens "${name}"`, r.scene === name && r.levelName === name);
  expect(`  player at the spawn ${JSON.stringify(r.spawn)}`, Math.hypot(r.pos[0] - r.spawn[0], r.pos[2] - r.spawn[2]) < 0.2 && Math.abs(r.pos[1] - r.spawn[1]) < 0.05, JSON.stringify(r.pos));
  expect('  enemy and pickup counts match the level file', r.enemies === r.enemyPieces && r.pickups === r.pickupPieces && r.colliders > 0, JSON.stringify(r));
  expect('  no page or console errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// no flag: the arena; unknown name: the arena plus a console warning
{
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  const errors = [];
  const warnings = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  await p.goto(withScene(null));
  await p.waitForFunction(() => window.game?.engine);
  expect('no ?scene opens the arena', (await p.evaluate(() => window.game.sceneName)) === 'arena');
  expect('  without a warning', !warnings.some((w) => w.includes('scene')));
  await p.goto(withScene('nope'));
  await p.waitForFunction(() => window.game?.engine);
  expect('unknown ?scene falls back to the arena', (await p.evaluate(() => window.game.sceneName)) === 'arena');
  expect('  with a console warning', warnings.some((w) => w.includes('"nope"')), warnings.join(' | '));
  const bad = await p.evaluate(() => {
    const g = window.game;
    g.loadScene('also-nope');
    return g.sceneName;
  });
  expect('loadScene with an unknown name also falls back to the arena', bad === 'arena');
  expect('  no errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 2. switching at runtime: arena -> gym -> library -> workshop -> arena, several cycles ----
{
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(withScene(null));
  await p.waitForFunction(() => window.game?.engine);
  const first = await p.evaluate(probe, 3);

  const cycles = [];
  for (let c = 0; c < CYCLES; c++) {
    const visits = [];
    for (const name of [...SCENES.slice(1), 'arena']) {
      await p.evaluate((n) => window.game.loadScene(n), name);
      const atLoad = await p.evaluate(() => {
        const g = window.game;
        return [g.player.pos.x, g.player.pos.y, g.player.pos.z];
      });
      const r = await p.evaluate(probe, 3);
      visits.push({ name, atLoad, ...r });
    }
    cycles.push(visits);
  }
  const SAME = (a, b2) => a.geometries === b2.geometries && a.textures === b2.textures && a.objects === b2.objects && a.children === b2.children;

  // every visit: right scene, player at its spawn, enemy count from the file
  const bad = cycles.flat().filter((v) => v.scene !== v.name || v.enemies !== v.enemyPieces || v.pickups !== v.pickupPieces
    || Math.hypot(v.atLoad[0] - v.spawn[0], v.atLoad[2] - v.spawn[2]) > 1e-6 || Math.hypot(v.pos[0] - v.spawn[0], v.pos[2] - v.spawn[2]) > 0.5);
  expect(`${CYCLES} cycles: right scene, player at its spawn, enemy/pickup counts match the level files`, bad.length === 0, JSON.stringify(bad.slice(0, 2)));

  // leak check: back in the arena after each cycle = same GPU memory and scene size as the first arena
  console.log('arena at start      ', JSON.stringify({ geometries: first.geometries, textures: first.textures, objects: first.objects }));
  cycles.forEach((visits, i) => {
    const a = visits[visits.length - 1];
    console.log(`arena after cycle ${i + 1}`, JSON.stringify({ geometries: a.geometries, textures: a.textures, objects: a.objects }));
    expect(`cycle ${i + 1}: geometries, textures and scene objects are back to the first arena's`, SAME(a, first), JSON.stringify({ first, a }));
  });
  // and the same scene reads the same on every cycle
  for (const name of SCENES.slice(1)) {
    const per = cycles.map((v) => v.find((x) => x.name === name));
    expect(`${name}: same geometries / textures / objects on every cycle`, per.every((x) => SAME(x, per[0])), JSON.stringify(per.map((x) => [x.geometries, x.textures, x.objects])));
  }
  expect('  no page or console errors while switching', errors.length === 0, errors.join(' | '));

  // ---- 3. per-level state is reset ----
  const s = await p.evaluate(() => {
    const g = window.game;
    const { engine, player, enemies, camRig, hud } = g;
    engine.headless = true;
    const step = (n) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
    const boss = enemies.boss;
    const out = {};
    // wake the boss (the player walks into its arena), hurt the player, kill a puppet, change gun
    player.pos.set((boss.arena.minX + boss.arena.maxX) / 2, 0, (boss.arena.minZ + boss.arena.maxZ) / 2);
    const pup = enemies.puppets.find((x) => x.kind === 'static');
    pup.damage(999, pup.pos.clone(), pup.pos.clone().set(0, 0, 1), 'torso');
    player.damage(40);
    g.weapon.current = 'sniper';
    g.weapon.state.sniper.ammo = 1;
    step(40);
    out.bossAwake = boss.awake;
    out.barOn = document.getElementById('boss').classList.contains('on');
    out.killsBefore = enemies.kills;
    g.loadScene('gym');
    step(3);
    out.barOff = !document.getElementById('boss').classList.contains('on');
    out.killsText = document.getElementById('kills').textContent;
    out.noFocus = camRig.focus === null && camRig.focusBlend === 0;
    out.bossGone = enemies.boss === null && enemies.kills === 0 && enemies.bolts.length === 0;
    out.full = player.health === 100 && player.shields === player.t.maxShields && !player.dead;
    out.weapon = g.weapon.current === 'rifle' && g.weapon.state.sniper.ammo > 1;
    out.noSkeletons = g.helpers.length === 0;
    return out;
  });
  expect('arena: the boss woke and its bar showed', s.bossAwake && s.barOn && s.killsBefore === 1, JSON.stringify(s));
  expect('after switching: boss bar hidden, no lock-on, no boss', s.barOff && s.noFocus && s.bossGone, JSON.stringify(s));
  expect('  kill counter reads 0 / 0 for the empty gym', s.killsText === '0 / 0', s.killsText);
  expect('  player at full health, weapon reset to a fresh rifle loadout', s.full && s.weapon, JSON.stringify(s));
  expect('  skeleton helpers of the old enemies are gone', s.noSkeletons);
  expect('  no page or console errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

// ---- 4. HUD title, demo (Library) enemies are harmless exhibits, scene picker in the panel ----
{
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(withScene(null));
  await p.waitForFunction(() => window.game?.engine);
  const r = await p.evaluate((names) => {
    const g = window.game;
    const { engine, player, enemies } = g;
    engine.stop();
    engine.headless = true;
    const step = (n) => { for (let i = 0; i < n; i++) engine.step(1 / 60); };
    const out = { zones: {} };
    for (const n of names) {
      g.loadScene(n);
      step(2);
      out.zones[n] = [document.getElementById('zone').textContent, g.level.title];
    }
    // Library: stand in front of the exhibit row (every enemy in range and in sight) for 10 s
    g.loadScene('library');
    player.pos.set(0, 0, -4);
    player.facing = Math.PI;
    let maxBolts = 0;
    for (let i = 0; i < 600; i++) {
      engine.step(1 / 60);
      maxBolts = Math.max(maxBolts, enemies.bolts.length);
    }
    out.demo = enemies.demo;
    out.maxBolts = maxBolts;
    out.unhurt = player.health === 100 && player.shields === player.t.maxShields && !player.dead;
    out.awake = enemies.puppets.filter((x) => x.awake).map((x) => x.kind);
    // exhibits still take hits
    const pup = enemies.puppets.find((x) => x.kind === 'static');
    pup.damage(999, pup.pos.clone(), pup.pos.clone().set(0, 0, 1), 'torso');
    step(2);
    out.hitWorks = enemies.kills === 1;
    // picker: one option per scene, follows loadScene, and switching through it updates the URL
    const picker = document.getElementById('scene');
    out.options = [...picker.options].map((o) => o.value);
    out.pickerFollows = picker.value === 'library';
    picker.value = 'gym';
    picker.dispatchEvent(new Event('change'));
    out.pickedScene = g.sceneName;
    out.url = new URL(location.href).searchParams.get('scene');
    g.loadScene('arena');
    out.arenaHostile = !enemies.demo;
    return out;
  }, SCENES);
  for (const n of SCENES) {
    const [shown, title] = r.zones[n];
    expect(`HUD zone label in "${n}" is its title "${title}"`, !!title && shown === title, shown);
  }
  expect('library is a demo level: 10 s in front of every enemy, no bolts, no damage', r.demo && r.maxBolts === 0 && r.unhurt, JSON.stringify(r));
  expect('  no exhibit woke up (drones, boss)', r.awake.length === 0, JSON.stringify(r.awake));
  expect('  exhibits still take hits', r.hitWorks);
  expect('scene picker lists every scene', JSON.stringify(r.options) === JSON.stringify(SCENES), JSON.stringify(r.options));
  expect('  it follows loadScene, switches the scene and updates ?scene=', r.pickerFollows && r.pickedScene === 'gym' && r.url === 'gym', JSON.stringify(r));
  expect('arena is not a demo level', r.arenaHostile);
  expect('  no page or console errors', errors.length === 0, errors.join(' | '));
  await p.close();
}

await b.close();
process.exit(fail.length ? 1 : 0);
