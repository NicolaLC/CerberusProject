# Workshop editor (#70)

`?scene=workshop` is a level editor: `src/levels/workshop.json` has `"tool": "workshop"`, the tool is
`src/game/workshop/editor.js` (`WorkshopEditor`, registered in `gym/tools.js`), suite `tests/workshop.browser.mjs`.
Save / load files are `workshop/io.js` (#72). The editor only runs in the scene named `workshop`; the same tool in any
other level is inert (`tool.editing === false`).

## Doc model
- `tool.doc` is a plain level object (format: level.md), a deep copy of the loaded level. `doc.pieces` is the only state.
- `tool.items[i]` is the live handle of `doc.pieces[i]`: `{ owner, thing }` (a `world.spawn` handle, an enemy actor, a
  pickup item). **The scene always equals the doc**: every edit rebuilds only the affected piece, despawn the old handle,
  spawn the new one, through the owner's runtime path (`world.spawn`, `enemies.spawn`, `registry.build('pickups', ...)`).
  A piece that cannot be built throws before the doc changes, so a bad edit never leaves doc and scene apart.
- At start the level's world pieces are rebuilt one by one (`world.load` with the world pieces left out, then
  `world.spawn` each) because the loaded boxes are merged into batches and have no handle. Enemies and pickups are
  adopted in file order. Consequences: in the editor boxes are individual meshes (more draw calls than the played level),
  and the enemies' `CoverMap` still describes the level as loaded (they are frozen, so nothing reads it). Anything that
  plays the doc (play in place) must reload the scene from it instead of reusing these objects.
- **Commands**: every edit is `{ index, before, after }` (piece snapshots; before null = insert, after null = delete,
  both = rebuild in place) on `undoStack` / `redoStack`. Undo / redo restore the exact piece JSON at the exact index, so
  docs compare equal as JSON. A drag is one command (committed on release). Opening a file (`load`) forgets the history.
- Placing appends; duplicate inserts right after the original (+1 m in x, grid-snapped, without `name`).
- Snap: horizontal only (x, z), 0.5 m by default (metrics.md); G cycles 0.5 / 0.25 / 1 / off. Y is the surface height
  the piece stands on (floor 0, top of the box under the cursor) and is not snapped; PgUp / PgDn move it in 0.1 m.
- Rotation (`rotationKind`, `fitYaw`, `turned` are exported pure functions):
  - `kit.*`: 90 degree steps on `yaw`. A free yaw given to `place` is fitted to 90 (kit.js throws otherwise).
  - `env.box`, `env.strip`: 90 degree steps swap width and depth (and turn `faces`); no `yaw` is stored (builders ignore it).
  - `env.label`: 15 degree steps on `params.yaw`. `light.point`: does not turn.
  - enemies, pickups, `prop.gun`: 15 degree steps on `yaw`.
- A mover's rail (`params.to`) and a boss arena (`params.arena`) move with the piece.
- Editor enemies are frozen (`enemies.frozen`) and posed once after spawning (`actor.update(1e-3, stillView)`).

## Edit mode
Free-fly camera; the player, weapon, pickup and camera-rig systems are inert (`game.editing`, one guard line each in
`game.js`), the HUD (`#hud`) is hidden, and the player model is hidden. The sun's shadow window follows the editor camera
(`world.updateSun`, one line in `game.js`); the player stays at the spawn. The start button runs without pointer lock (the editor needs the cursor).

Keys (the key bar shows them; `static KEYS` is the source and the suite checks it against every key literal in
`editor.js`). Game debug keys H, F3 and ` are left alone.

| Key | Action |
|---|---|
| W A S D, Q / E, Shift | fly, down / up, fast |
| RMB (hold) + mouse | look |
| LMB | placing: put the piece at the ghost; otherwise select the piece under the cursor (empty space deselects); drag a piece to move it on the ground plane |
| R, Shift+R | rotate the armed piece or the selection one step, forward / back |
| G | snap 0.5 / 0.25 / 1 / off |
| Arrows | nudge the selection one grid step (0.1 m with snap off) along the axes the camera looks along |
| PgUp / PgDn | raise / lower the selection by 0.1 m |
| Ctrl+D | duplicate |
| Del / Backspace | delete |
| Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z | undo, redo |
| Ctrl+S / Ctrl+O | `saveLevel(doc)` / `openLevel(registry)` from io.js; a failure ("not implemented" until #72) is a toast |
| Esc | disarm, then deselect, then pause (the start panel has the scene buttons) |

## Panels and helpers
- **Palette** (left, `#workshop-palette`): every `registry.ids()` entry as a `button[data-id]`, grouped by owner and prefix
  (`world kit.*`, `world env.*`, `enemies enemy.*`, `pickups pickup.*`...), with its `label` meta. Picking one arms its
  `example` params; picking it again, or Esc, disarms. A new registry id shows up by itself.
- **Ghost**: a translucent green box (the measured bounds of the armed piece, turned by its yaw) under the cursor, on the
  floor or on top of the box under it. While dragging, it shows where the piece will land.
- **Selection**: a `Box3Helper` tinted by cover class (wall white, high blue, low orange, none yellow) and the status
  panel (right): count, snap, undo / redo depth, the piece's id, pos, yaw, size and cover flags.
- All helpers, panels, listeners, the HUD state and every piece handle are freed in `dispose()`.

## Test hooks (`game.tool`)
`place(id, pos, params?, yaw?)` (returns the index; snaps x / z and yaw), `select(i)`, `move(i, pos)`, `rotate(i, steps = 1)`,
`remove(i)`, `duplicate(i)` (returns the copy's index), `setParams(i, patch)`, `undo()`, `redo()`, `load(level)`, `arm(id | null)`,
`doc`, `items`, `sel`, `armed`, `grid`, `count`, `ghostPos`, `toastText`, `coverOf(i)`, `surface()`, `pick()` (cursor ray),
and `verify()`: `{ ok, problems }` checks one handle per piece, enemy and pickup counts, and that every world collider
belongs to a handle. `suite tests/workshop.browser.mjs` covers: one of each owner, all ids, scene = doc, snapping,
rotation rules, undo / redo JSON identity, delete frees (colliders, scene objects), no leak over place / delete cycles and
over leaving the scene (measured in a quiet scene: the arena's own gameplay makes geometry counts vary), palette, key
bar, real mouse placing / selecting / dragging, cover tint, `load`.

## Not yet
Editing params in the UI (size, material, cover), play in place, spawn point and interior zones editing, light-placement
hitch (adding a point light recompiles shaders once).
