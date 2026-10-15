// node tests/levelio.test.mjs — Workshop level save/load format (#72): serialize / parse, no browser needed.
// Uses the real Registry with the real piece tables (they import cleanly in node).
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';

// scenes.js imports the level files as JSON (Vite does that); node wants the import attribute spelled out
registerHooks({
  resolve: (spec, ctx, next) => {
    const res = next(spec, ctx);
    return res.url.endsWith('.json') ? { ...res, importAttributes: { type: 'json' } } : res;
  },
});

const { Registry } = await import('../src/game/registry.js');
const { WORLD_PIECES } = await import('../src/game/world/world.js');
const { ENEMY_PIECES } = await import('../src/game/actors/enemies.js');
const { PICKUP_PIECES } = await import('../src/game/world/pickups.js');
const { ENCOUNTER_PIECES } = await import('../src/game/world/encounter.js');
const { serializeLevel, parseLevel, levelNames } = await import('../src/game/workshop/io.js');
const { SCENES } = await import('../src/game/scenes.js');

let failed = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${info}`);
  if (!ok) failed++;
};
const throwsWith = (fn, re) => {
  try {
    fn();
  } catch (e) {
    return re.test(e.message) ? '' : `message was: ${e.message}`;
  }
  return 'did not throw';
};

const registry = new Registry().register('world', WORLD_PIECES).register('enemies', ENEMY_PIECES).register('pickups', PICKUP_PIECES).register('encounter', ENCOUNTER_PIECES);
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const roundAll = (v) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'number' ? r4(x) : x)));

// every bundled level file: round trip, idempotence, line structure
const dir = new URL('../src/levels/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
for (const f of files) {
  const level = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const text = serializeLevel(level);
  let back;
  try {
    back = parseLevel(text, registry);
  } catch (e) {
    check(`${f}: parses back`, false, e.message);
    continue;
  }
  let same = true;
  try {
    assert.deepStrictEqual(back, roundAll(level));
  } catch {
    same = false;
  }
  check(`${f}: parse(serialize(level)) equals the level`, same);
  check(`${f}: serialize is idempotent`, serializeLevel(back) === text);

  const lines = text.split('\n');
  const start = lines.indexOf('  "pieces": [');
  const pieceLines = lines.slice(start + 1, start + 1 + level.pieces.length);
  check(`${f}: one piece per line`, start > 0 && pieceLines.every((l) => /^ {4}\{.*\},?$/.test(l)) && lines[start + 1 + level.pieces.length] === '  ]');
  check(`${f}: ends with one newline`, text.endsWith('}\n') && !text.endsWith('\n\n'));
  const keyOrder = lines.slice(1, start).map((l) => /^ {2}"(\w+)"/.exec(l)?.[1]);
  const wanted = ['version', 'name', 'title', 'tool', 'demo', 'spawn', 'interiorZones'].filter((k) => k in level);
  check(`${f}: top-level keys one per line, name/title/tool/demo/spawn/interiorZones first`, wanted.every((k, i) => keyOrder[i] === k) && keyOrder.length === Object.keys(level).length - 1);
}
// prologue.json is edited in the Workshop from now on: the file on disk is exactly what the Workshop would save
{
  const text = readFileSync(new URL('prologue.json', dir), 'utf8');
  check('prologue.json is byte-identical to serializeLevel(its own level)', serializeLevel(JSON.parse(text)) === text);
  const lv = parseLevel(text, registry);
  // the purge (#14): purge-* groups are woken only by the ordered objective chain, never by a trigger or entry marker
  const logic = JSON.stringify(lv.pieces.filter((p) => /^(trigger|marker\.entry)/.test(p.id)));
  check('prologue.json: no trigger / entry references a purge-* group', !logic.includes('purge'));
  const chain = lv.pieces.filter((p) => p.id.startsWith('objective.')).sort((a, b) => a.params.order - b.params.order);
  check('prologue.json: every objective has an explicit, unique order', chain.every((o) => Number.isFinite(o.params.order)) && new Set(chain.map((o) => o.params.order)).size === chain.length);
  // the yard troopers (purge-3) and drones (purge-5) were merged into the drill hall troop (level-design.md section 5)
  const wakes = chain.filter((o) => /^purge-/.test(o.params.wakeGroup)).map((o) => o.params.wakeGroup);
  check('prologue.json: the purge groups are woken once each, in order (purge-1, 2, 4, 6)', wakes.join() === 'purge-1,purge-2,purge-4,purge-6', wakes.join());
  // the cuts: a chain step waits for each cinematic.cut, and the cut starts on that step (objective:<id>)
  const cuts = lv.pieces.filter((p) => p.id === 'cinematic.cut');
  check('prologue.json: purge-cut, boss-cut and breakout each start on the reach step that waits for them', cuts.map((c) => c.name).join() === 'purge-cut,boss-cut,breakout' && cuts.every((c) => chain.some((o) => o.params.trigger === c.name && c.params.on === `objective:${o.name}`)));
  // one-way gates: every closeOn / shutOn names something that happens in the file
  const names = new Set(lv.pieces.map((p) => p.name));
  const oneWay = lv.pieces.filter((p) => p.id === 'kit.gate' && (p.params.closeOn || p.params.shutOn));
  check('prologue.json: every one-way gate (closeOn / shutOn) names a piece of the file', oneWay.length >= 8 && oneWay.every((g) => names.has((g.params.closeOn || g.params.shutOn).split(':')[1])));
  // rounds and repairs come only from supply points: no loose ammo, the corridor has one of each
  check('prologue.json: no loose ammo, a supply.ammo and a supply.repair in the supply corridor', !lv.pieces.some((p) => /^pickup\.(light|heavy)$/.test(p.id)) && ['supply-ammo', 'supply-repair'].every((n) => names.has(n)));
  // the armoury (#93): order 60 between the shooters (purge-2) and the troopers (purge-4); a skip trigger that exists; the troopers carry the drop
  const arm = chain.find((o) => o.params.order === 60);
  const prev = chain.filter((o) => o.params.order < 60).at(-1);
  const next = chain.find((o) => o.params.order > 60 && o.params.wakeGroup);
  check('prologue.json: the armoury (order 60, interact, grants the rifle) sits between the shooters (purge-2) and the troopers (purge-4)', arm?.id === 'objective.interact' && arm.params.grantGun === 'rifle' && prev?.params.wakeGroup === 'purge-2' && next?.params.wakeGroup === 'purge-4');
  check('prologue.json: the armoury skipOn names a trigger.volume of the file', lv.pieces.some((p) => p.id === 'trigger.volume' && p.name === arm?.params.skipOn && p.params.once === false));
  check('prologue.json: every trooper of purge-3 / purge-4 drops the rifle', lv.pieces.filter((p) => p.id === 'enemy.trooper' && /^purge-[34]$/.test(p.params?.group)).every((p) => p.params.dropGun === 'rifle'));
  // the exit (#15): a gate opened by the breakout cut's cue, a last reach needing the rifle, the late armoury step before the arena gate
  const gate = lv.pieces.find((p) => p.id === 'kit.gate' && p.name === 'exit-gate');
  const breakout = cuts.find((c) => c.name === 'breakout');
  const gateCue = breakout?.params.shots.find((s) => s.cue)?.cue;
  check('prologue.json: the exit gate opens on the breakout cut\'s cue; the cut wakes the dormant breakout squad (not plated) and has STEM-00 fire at it', gate?.params.on === `cue:${gateCue}` && breakout.params.shots.some((s) => s.wakeGroup === 'breakout') && breakout.params.shots.some((s) => s.stem?.fire?.group === 'breakout') && lv.pieces.filter((p) => p.params?.group === 'breakout').length >= 3 && lv.pieces.filter((p) => p.params?.group === 'breakout').every((p) => p.id === 'enemy.trooper' && p.params.dormant && !p.params.armored));
  check('prologue.json: the boss objective is followed by the breakout wait step (order 115), then the exit', chain.find((o) => o.params.wakeGroup === 'purge-6')?.params.order === 110 && chain.find((o) => o.params.trigger === 'breakout')?.params.order === 115);
  check('prologue.json: chains to the skyway with no debrief; the hall troopers are plated; a Farsight stand and a heavy ammo cabinet exist', lv.next === 'skyway' && lv.debrief === false && lv.pieces.filter((p) => p.id === 'enemy.trooper' && p.params.group === 'purge-4').every((p) => p.params.armored === true) && lv.pieces.some((p) => p.id === 'pickup.gun' && p.params.gun === 'sniper' && !p.params.rack) && lv.pieces.some((p) => p.id === 'supply.ammo' && p.params.ammo === 'heavy' && p.pos[0] > 20));
  const last = chain.at(-1);
  check('prologue.json: the last objective is a reach beyond the gate (order 120) that requires the rifle', last?.id === 'objective.reach' && last.params.order === 120 && last.params.requiresGun === 'rifle' && last.pos[2] < gate.pos[2]);
  const late = chain.filter((o) => o.params.skipIfOwned === 'rifle').at(-1);
  const arenaGate = lv.pieces.find((p) => p.name === 'arena-gate');
  check('prologue.json: a late skipIfOwned rifle step sits after the troopers and before the arena (its done opens arena-gate) and can grant the rifle', late !== arm && late?.id === 'objective.interact' && late.params.grantGun === 'rifle' && late.params.order > 80 && late.params.order < 100 && arenaGate?.params.on === `objective:${late.name}:done`);
}
check('all bundled level files covered', files.length === Object.keys(SCENES).length && levelNames().join() === Object.keys(SCENES).join(), `${files.length} files`);

// format details on a small level
const small = {
  pieces: [
    { params: { size: [1.2000000000000028, 1, 0.5], mat: 'wall' }, pos: [0.1 + 0.2, -0, 3], yaw: 1.5707963267948966, name: 'a', id: 'env.box' },
    { id: 'pickup.light', pos: [1, 0, 2] },
  ],
  interiorZones: [],
  spawn: { yaw: 3.141592653589793, pos: [0, 0, 1] },
  extra: { z: 1, a: 2 },
  title: 'T',
  name: 'small',
};
const out = serializeLevel(small);
const L = out.split('\n');
check('top-level key order', L.slice(1, 8).map((l) => /"(\w+)"/.exec(l)[1]).join() === 'version,name,title,spawn,interiorZones,extra,pieces');
check('piece key order', L[8] === '    {"id":"env.box","name":"a","pos":[0.3,0,3],"yaw":1.5708,"params":{"size":[1.2,1,0.5],"mat":"wall"}},');
check('rounding: no float noise', !/00000|99999/.test(out) && out.includes('"size":[1.2,1,0.5]'));
check('negative zero is written as 0', !out.includes('-0'));
check('spawn yaw rounded', out.includes('"spawn": {"yaw":3.1416,"pos":[0,0,1]}'));
check('empty pieces', serializeLevel({ name: 'e', pieces: [] }).endsWith('  "pieces": []\n}\n'));
check('rejects NaN', throwsWith(() => serializeLevel({ name: 'n', pieces: [{ id: 'env.box', pos: [NaN, 0, 0] }] }), /cannot save/) === '');

// bad files give readable errors
const base = serializeLevel({ name: 'ok', spawn: { pos: [0, 0, 0] }, interiorZones: [], pieces: [{ id: 'env.box', pos: [0, 0, 0], params: { size: [1, 1, 1], mat: 'wall' } }] });
const e1 = throwsWith(() => parseLevel(base.replace('"interiorZones": [],', '"interiorZones": [,'), registry), /not valid JSON \(line 5\)/);
check('bad JSON names the line', e1 === '', e1);
check('empty file', throwsWith(() => parseLevel('', registry), /not valid JSON/) === '');
check('not an object', throwsWith(() => parseLevel('[1]', registry), /JSON object/) === '');
const e2 = throwsWith(() => parseLevel(base.replace('env.box', 'env.nope'), registry), /piece #0 has unknown id "env\.nope"/);
check('unknown piece id names piece and id', e2 === '', e2);
const e3 = throwsWith(() => parseLevel(base.replace('"pos":[0,0,0],"params"', '"pos":[0,0],"params"'), registry), /piece #0.*needs pos/);
check('bad pos is named', e3 === '', e3);
check('missing pieces', throwsWith(() => parseLevel('{"spawn":{"pos":[0,0,0]}}', registry), /"pieces" must be an array/) === '');
check('null piece', throwsWith(() => parseLevel('{"pieces":[null],"spawn":{"pos":[0,0,0]}}', registry), /piece #0 must be an object/) === '');
const v0 = parseLevel('{"pieces":[],"spawn":{"pos":[0,0,0]}}', registry);
check('missing version upgrades to current', v0.version === 1);
check('future version is rejected', throwsWith(() => parseLevel('{"version":99,"pieces":[],"spawn":{"pos":[0,0,0]}}', registry), /version 99 is newer/) === '');
check('saves carry the version', serializeLevel({ name: 'v', pieces: [] }).includes('"version": 1'));
check('no registry: JSON only', parseLevel('{"a":1}').a === 1);

// encounter pieces (#73) are ordinary pieces: they round-trip with their params
{
  const lvl = { version: 1, name: 'enc', spawn: { pos: [0, 0, 0], yaw: 0 }, interiorZones: [], pieces: [
    { id: 'marker.spawn', pos: [1, 0, 2], yaw: 3.1416 },
    { id: 'marker.checkpoint', pos: [0, 0, -5], name: 'cp1' },
    { id: 'marker.entry', pos: [4, 0, -9], params: { group: 'b', enemies: ['enemy.trooper'] } },
    { id: 'trigger.volume', pos: [0, 0, -3], params: { size: [4, 3, 4], event: 'go', once: true, wakeGroup: 'a', spawnGroup: 'b' } },
  ] };
  const text = serializeLevel(lvl);
  assert.deepEqual(parseLevel(text, registry), roundAll(lvl));
  check('encounter pieces round-trip', true);
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
