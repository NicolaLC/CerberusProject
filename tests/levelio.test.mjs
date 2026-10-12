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
  const lvl = { name: 'enc', spawn: { pos: [0, 0, 0], yaw: 0 }, interiorZones: [], pieces: [
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
