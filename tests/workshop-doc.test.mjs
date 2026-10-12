// node tests/workshop-doc.test.mjs — Workshop document model (workshop/doc.js): commands, undo / redo, dirty flag.
// Pure data, no browser. The save / parse round-trip uses the real Registry and io.js like tests/levelio.test.mjs.
import { registerHooks } from 'node:module';
import assert from 'node:assert/strict';

registerHooks({
  resolve: (spec, ctx, next) => {
    const res = next(spec, ctx);
    return res.url.endsWith('.json') ? { ...res, importAttributes: { type: 'json' } } : res;
  },
});

const { WorkshopDoc, zonesToPieces } = await import('../src/game/workshop/doc.js');
const { Registry } = await import('../src/game/registry.js');
const { WORLD_PIECES } = await import('../src/game/world/world.js');
const { ENEMY_PIECES } = await import('../src/game/actors/enemies.js');
const { PICKUP_PIECES } = await import('../src/game/world/pickups.js');
const { ENCOUNTER_PIECES } = await import('../src/game/world/encounter.js');
const { serializeLevel, parseLevel } = await import('../src/game/workshop/io.js');

const level = () => ({ version: 1, spawn: { pos: [0, 0, 0] }, pieces: [{ id: 'kit.wall', pos: [0, 0, 0] }, { id: 'enemy.trooper', pos: [3, 0, 3], name: 'bob' }] });
const snap = (v) => Math.round(v * 2) / 2;
const text = (d) => JSON.stringify(d.level);

// a scene stand-in: sync can refuse a build (the doc must then stay untouched)
let refuse = false;
const mk = () => new WorkshopDoc(level(), { snap, sync: () => { if (refuse) throw new Error('cannot build'); } });

let d = mk();
const start = text(d);
assert.equal(d.count, 2);
assert.equal(d.dirty, false);

// add / undo / redo
let i = d.add({ id: 'kit.crate', pos: [1, 0, 1] });
assert.equal(i, 2); assert.equal(d.count, 3); assert.equal(d.sel, 2); assert.equal(d.dirty, true);
assert.ok(d.undo()); assert.equal(text(d), start); assert.equal(d.sel, -1);
assert.ok(d.redo()); assert.equal(d.count, 3); assert.equal(d.level.pieces[2].id, 'kit.crate');
d.undo();

// move: snapped, no-op when nothing changes (no history entry), a mover's rail travels
d.move(0, [2.3, 0, -1.1]);
assert.deepEqual(d.level.pieces[0].pos, [2.5, 0, -1]);
const n = d.undoStack.length;
d.move(0, [2.5, 0, -1]);
assert.equal(d.undoStack.length, n);
d.add({ id: 'enemy.trooper', pos: [0, 0, 0], params: { to: [4, 0, 0], speed: 1 } });
d.move(2, [1, 0, 0]);
assert.deepEqual(d.level.pieces[2].params.to, [5, 0, 0]);
d.undo(); d.undo(); d.undo();
assert.equal(text(d), start);

// rotate: kit turns in quarters, lights do not
d.rotate(0, 1);
assert.equal(d.level.pieces[0].yaw, Math.PI / 2);
d.rotate(0, -1);
assert.equal(d.level.pieces[0].yaw, undefined);
d.add({ id: 'light.point', pos: [0, 3, 0] });
const h = d.undoStack.length;
d.rotate(2, 1);
assert.equal(d.undoStack.length, h);
d.undo(); d.undo(); d.undo();
assert.equal(text(d), start);

// setParams / setName: null removes, no params left means no key
d.setParams(0, { size: [2, 2, 2] });
assert.deepEqual(d.level.pieces[0].params, { size: [2, 2, 2] });
d.setParams(0, { size: null });
assert.equal('params' in d.level.pieces[0], false);
d.setName(0, 'w'); assert.equal(d.level.pieces[0].name, 'w');
d.setName(0, ''); assert.equal('name' in d.level.pieces[0], false);
d.undo(); d.undo(); d.undo(); d.undo();
assert.equal(text(d), start);

// duplicate: next to the original, without its name; delete; undo restores the order
i = d.duplicate(1);
assert.equal(i, 2); assert.equal(d.level.pieces[2].name, undefined); assert.deepEqual(d.level.pieces[2].pos, [4, 0, 3]);
assert.equal(d.remove(0), 2);
assert.equal(d.sel, -1);
d.undo(); d.undo();
assert.equal(text(d), start);

// undo past the start is a no-op; a new edit clears redo
while (d.undo());
assert.equal(d.undo(), false); assert.equal(d.undoStack.length, 0);
assert.equal(d.redo(), true); // there was history to redo
d.undo();
d.add({ id: 'kit.crate', pos: [0, 0, 0] });
assert.equal(d.redoStack.length, 0); assert.equal(d.redo(), false);

// a refused build leaves the doc, history and dirty flag alone
d = mk();
refuse = true;
assert.throws(() => d.add({ id: 'kit.crate', pos: [0, 0, 0] }), /cannot build/);
assert.equal(d.count, 2); assert.equal(d.undoStack.length, 0); assert.equal(d.dirty, false);
refuse = false;

// bad index
assert.throws(() => d.move(9, [0, 0, 0]), /no piece #9/);

// dirty: set by edits, cleared by markSaved and reset; reset(keepHistory) keeps the stacks
d.add({ id: 'kit.crate', pos: [0, 0, 0] });
assert.equal(d.dirty, true); d.markSaved(); assert.equal(d.dirty, false);
d.undo(); assert.equal(d.dirty, true);
d.reset(level(), true); assert.equal(d.redoStack.length, 1);
d.reset(level()); assert.equal(d.undoStack.length + d.redoStack.length, 0); assert.equal(d.dirty, false);

// zones: the older top-level form becomes pieces
const z = zonesToPieces({ pieces: [], interiorZones: [{ min: [0, 0, 0], max: [4, 3, 6] }] });
assert.deepEqual(z.pieces[0], { id: 'zone.interior', pos: [2, 0, 3], params: { size: [4, 3, 6] } });
assert.deepEqual(z.interiorZones, []);

// serialize round-trip through the real file format
const registry = new Registry().register('world', WORLD_PIECES).register('enemies', ENEMY_PIECES).register('pickups', PICKUP_PIECES).register('encounter', ENCOUNTER_PIECES);
d = WorkshopDoc.fromJSON(level(), { snap });
d.move(0, [1, 0, 2]); d.duplicate(1); d.rotate(0, 1);
const back = parseLevel(serializeLevel(d.toJSON()), registry);
assert.equal(serializeLevel(back), serializeLevel(d.toJSON())); // the file rounds to 4 decimals, so compare files
assert.equal(serializeLevel(WorkshopDoc.fromJSON(back).toJSON()), serializeLevel(back));
assert.notEqual(d.toJSON(), d.level); // a copy

console.log('ok   workshop doc model');
