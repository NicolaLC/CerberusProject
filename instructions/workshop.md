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
  plays the doc (play in place) reloads the scene from it instead of reusing these objects (see Play in place).
- **Commands**: every edit is `{ index, before, after }` (piece snapshots; before null = insert, after null = delete,
  both = rebuild in place) on `undoStack` / `redoStack`. Undo / redo restore the exact piece JSON at the exact index, so
  docs compare equal as JSON. A drag is one command (committed on release). Opening a file (`load`) forgets the history.
- Encounter pieces (`marker.*`, `trigger.volume`, owner `encounter`) have a gizmo as their handle (`{ owner: 'encounter', thing: record }`,
  `thing.gizmo`); see Encounters (#73).
- Placing appends; duplicate inserts right after the original (+1 m in x, grid-snapped, without `name`).
- Snap: horizontal only (x, z), 0.5 m by default (metrics.md); G cycles 0.5 / 0.25 / 1 / off. Y is the surface height
  the piece stands on (floor 0, top of the box under the cursor) and is not snapped; PgUp / PgDn move it in 0.1 m.
- Rotation (`rotationKind`, `fitYaw`, `turned` are exported pure functions):
  - `kit.*`: 90 degree steps on `yaw`. A free yaw given to `place` is fitted to 90 (kit.js throws otherwise).
  - `env.box`, `env.strip`: 90 degree steps swap width and depth (and turn `faces`); no `yaw` is stored (builders ignore it).
  - `trigger.volume`: like `env.box` (a quarter turn swaps width and depth of `size`). `marker.*`: 15 degree steps on `yaw`.
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
| P | play in place / back to edit (see below) |
| T | while playing: restart the encounter |
| Esc | in an inspector field: revert + blur; otherwise disarm, then deselect, then pause (the start panel has the scene buttons) |

## Play in place (#71)
`P` toggles edit and play (`play()`, `edit()`, `togglePlay()`, `restart()`, `playing`); `editing` is false while playing, so
`game.editing` is false and the player, weapon, pickups and camera systems run as in the normal game.
- **Play**: the doc is deep-copied to `snapshot`; a copy of it is loaded as a normal level (`world.load` with every piece so boxes are
  merged, `enemies.load` with a real `CoverMap`, `pickups.load`), enemies unfrozen, HUD back, palette / status panel hidden,
  pointer lock requested (`input.lock()`; Esc then pauses like the game, the start button resumes). The editor's own piece handles are
  dropped without despawning (the level load frees them).
- **Spawn** (`spawnAt()`): the ground under the camera (highest collider top at or below the camera, and nothing solid at body height
  there), facing the way the camera looks; otherwise `levelSpawn(doc)` (a `marker.spawn` piece, else `doc.spawn`). The doc itself is never changed by playing.
- **Restart** (`T`, only while playing): reloads the play level from the snapshot (all enemies and pickups new, player at the spawn
  with full health). `Game.resetRun(level)` is the shared "start a run" (player, camera rig, weapon, fx, hud, juice).
- **Back to edit**: `doc = clone(snapshot)`, the editor scene is rebuilt from it (`#populate`: same path as opening the scene), the
  camera position / fov come back, the player is parked at the spawn, panels return. Destroyed enemies and pieces are restored because
  the whole scene is rebuilt. The doc is JSON-identical to before play; **undo / redo history and the selection are kept** (commands
  act on piece snapshots at indices, and the doc is unchanged).
- Loading another scene while playing disposes the tool normally (nothing of the editor is left in the scene).

## Panels and helpers
- **Palette** (left, `#workshop-palette`): every `registry.ids()` entry as a `button[data-id]`, grouped by owner and prefix
  (`world kit.*`, `world env.*`, `enemies enemy.*`, `pickups pickup.*`...), with its `label` meta. Picking one arms its
  `example` params; picking it again, or Esc, disarms. A new registry id shows up by itself.
- **Ghost**: a translucent green box (the measured bounds of the armed piece, turned by its yaw) under the cursor, on the
  floor or on top of the box under it. While dragging, it shows where the piece will land.
- **Inspector** (right, `#workshop-inspector`, below the status panel): shown while one piece is selected in edit mode. One control per
  entry of the piece's registry meta `fields` (level.md, Piece meta) plus a `name` text field for every piece: text input (number, vec,
  list, text), checkbox (bool), select (enum; `options: 'mats'` = keys of `World.mats`). Built from data, so a new `fields` entry shows up by itself;
  rebuilt only when the selected id changes, otherwise values are refreshed in place after every command / undo / redo.
  - **Commit** on Enter or `change` (blur, select, checkbox), never per keystroke, through `setParams(i, { key: value })` (or `setName`):
    one undoable command each, validated by the builder first. A bad value (`parseField` error, or the builder throws) is a toast and the field shows the doc value again.
    An optional field left empty removes its key (`setParams` patch value `null` = delete key; no params left = no `params`); `setName('')` removes `name`.
  - **Focus rules**: the field's own `keydown` / `keyup` stop propagation, so no editor shortcut, engine input or game debug key (H, F3, `) sees typing;
    the editor's `#active` also ignores events whose target is an input / select. Because a field swallows the keyup of a key held when it got focus, a field's `focus` clears the editor's held keys and `input.releaseAll()` (edge presses stay). Esc in a field reverts its text and blurs it (selection kept);
    a click on the canvas blurs it. Entering play blurs it and hides the whole right column.
  - Fields by piece: `env.box` size, mat, cover, collide, shadow; `env.strip` size, mat; `env.label` text, size, flat; `light.point` color, intensity, distance;
    `prop.gun` gun; every `kit.*` its size params + mat (`kit.platform`: size, height, stairs, parapets, mat, coverMat); enemies `group` (`enemy.mover` also `to`, `speed`);
    `marker.entry` group, enemies (comma list); `zone.interior` size; `trigger.volume` size, event, once, wakeGroup, spawnGroup. Markers (`marker.spawn`, `marker.checkpoint`), pickups and `boss.spider`'s arena have only `name` / `group`.
  - Not in the UI: `faces`, `ownMaterial`, `flicker`, `env.label` colors, `boss.spider` arena, `kit.*` `yaw` (use R).
- **Selection**: a `Box3Helper` tinted by cover class (wall white, high blue, low orange, none yellow) and the status
  panel (right): count, snap, undo / redo depth, the piece's id, pos, yaw, size and cover flags.
- All helpers, panels, listeners, the HUD state and every piece handle are freed in `dispose()`.

## Test hooks (`game.tool`)
`place(id, pos, params?, yaw?)` (returns the index; snaps x / z and yaw), `select(i)`, `move(i, pos)`, `rotate(i, steps = 1)`,
`remove(i)`, `duplicate(i)` (returns the copy's index), `setParams(i, patch)` (null value removes the key), `setName(i, name)`, `undo()`, `redo()`, `load(level)`, `arm(id | null)`,
`play()`, `edit()`, `togglePlay()`, `restart()`, `spawnAt()`, `playing`, `doc`, `items`, `sel`, `armed`, `grid`, `count`, `ghostPos`, `toastText`, `coverOf(i)`, `surface()`, `pick()` (cursor ray),
and `verify()`: `{ ok, problems }` checks one handle per piece, enemy and pickup counts, and that every world collider
belongs to a handle. `suite tests/workshop.browser.mjs` covers: one of each owner, all ids, scene = doc, snapping,
rotation rules, encounter tools (section 12), inspector (section 13: fields per piece, type + Enter edits, undo identity, invalid values, focus / shortcuts, play, leaks), undo / redo JSON identity, delete frees (colliders, scene objects), no leak over place / delete cycles and
over leaving the scene (measured in a quiet scene: the arena's own gameplay makes geometry counts vary), palette, key
bar, real mouse placing / selecting / dragging, cover tint, `load`, play in place (spawn, awake enemies, kill, restart, edit
returns the identical doc and history, no leak over play / edit cycles).

## Encounters (#73)
Code: `src/game/world/encounter.js` (`Encounter` system, `ENCOUNTER_PIECES`, `levelSpawn`). Registry owner `encounter`, so the five pieces show up
in the palette (`encounter marker.*`, `encounter zone.*`, `encounter trigger.*`) and follow the doc / command / undo rules like any piece. Params are edited
in the inspector (see Panels and helpers) or with `setParams`.
| id | params | gizmo (edit mode only) |
|---|---|---|
| `marker.spawn` | – (`yaw` = facing) | green box + arrow. **The player start**: `levelSpawn(level)` = first `marker.spawn` piece, else `level.spawn` (stays required in the file) |
| `marker.checkpoint` | – (`yaw` = facing on respawn, `name` = id in events) | cyan flag + ring of its 2 m reach |
| `marker.entry` | `group`, `enemies: [enemy.* ids]` | orange pad, arrow, one block per listed enemy |
| `zone.interior` | `size [w,h,d]` (8,4,8). `pos` = centre x / bottom y / centre z. **An interior zone** (below) | blue translucent box |
| `trigger.volume` | `size [w,h,d]` (4,3,4), `event` ('trigger'), `once` (true), `wakeGroup?`, `spawnGroup?`. `pos` = centre x / bottom y / centre z | magenta translucent box |
- **Gizmos** exist only in edit mode: `Encounter.spawn(data, { gizmo: true })` builds them (shared permanent geometry / materials, nothing to
  free per piece) and marks the record inert. In play (and in any normal level) `Encounter.load(level)` builds logic only: no objects, no
  colliders (`encounter.items[i].gizmo === null`). Not raycast by weapons; the editor picks them by bounds. A trigger volume is picked only
  when nothing else is under the cursor (it often surrounds other pieces). The Library shows them as gizmo exhibits.
- **Spawn groups**: an enemy piece takes `params.group` (any string; stored on the actor as `squad`). `Enemies` wakes the whole group once any
  member is awake (trooper alerted, drone / boss awake; `group:wake { group }` once per group), or on `wakeGroup(group)`. Only actors with
  `wake()` take part (trooper, drone, boss); puppets are always on. The editor's enemies are frozen, so nothing wakes in edit mode.
- **Triggers**: fire on the frame the player's feet enter the box (starting inside counts); `once: true` fires one time per run. Fire =
  `events.emit('trigger:fired', { id, event })` with `id` = the piece `name`, else `trigger<n>` (n = order among triggers in the file),
  then `wakeGroup` / `spawnGroup`. **The mission / objective framework (#12) does not exist**: objectives will subscribe to `trigger:fired`
  (and `checkpoint:reached`, `group:wake`, `group:spawn`) and may request `encounter:wake` / `encounter:spawn` (payload: group name).
  Nothing else consumes them yet.
- **Reinforcements**: `spawnGroup(group)` (trigger action or `encounter:spawn`) builds every `marker.entry` of that group's listed enemies
  side by side (1.5 m) at the marker, facing its yaw, through `enemies.spawn` with `params.group`, and wakes them. Repeats on each call; `group:spawn { group, count }`.
- **Checkpoints**: in play, the player within 2 m (horizontal, 2.5 m vertical) of a checkpoint records it (`checkpoint:reached { id, pos, yaw }`, HUD
  toast; the last one reached wins). Death flow is the existing one (`game.js` player system): after 3 s `player.respawn(encounter.checkpoint)` -
  at the checkpoint and its yaw with full health, else the level spawn. Enemies, pickups and triggers are NOT reset on a respawn. T / reload forgets it.
- Hooks: `game.encounter` (`items`, `checkpoint`, `spawnGroup(g)`, `wakeGroup(g)`), `T.tool().items[i].thing.gizmo`.
- Suite section 12 of `tests/workshop.browser.mjs`: placing each piece (gizmo, no colliders), undo / redo identity, params errors, save -> load roundtrip,
  gizmos only in edit, picking vs trigger volumes, group wake (+ control), trigger once / repeat / wake, reinforcements (trigger, event, restart, inert in edit),
  `marker.spawn` (camera spawn kept, restart, normal load), checkpoint respawn, no leaks over play / edit cycles.

- **Interior zones** are what `world.isInterior(p)` tests: post exposure 1.0 -> 1.9 and grade when the camera is inside, the HUD zone label reads INTERIOR when the player is,
  drones (`drone.js`). They are `zone.interior` pieces (`Encounter.add('zone')`): in play the record pushes a `Box3` into `world.interiorZones` (removed again on unload /
  despawn), in edit / Library (gizmo mode, inert) it is only the gizmo, so the editor's own exposure does not change. Move, resize (inspector `size`), rotate (quarter turn swaps w / d),
  name, undo and duplicate are the generic piece commands. A picked zone loses to any other piece under the cursor, like a trigger volume.
  The older top-level `interiorZones: [{ min, max }]` still loads and plays (`world.load`); the editor converts it on open / `load` (`zonesToPieces`: `zone.interior` pieces appended,
  `interiorZones` emptied), so saving rewrites the file in the piece form. Suite section 14: place / move / resize / rotate, undo / redo identity, save -> load, legacy file, play (isInterior, HUD label, no gizmos, restart), picking, leaks.

- **Lights**: `light.point` pieces take a light from `World`'s fixed pool, sized by the quality tier (4 / 8 / 12, engine.md), so placing, editing, deleting, undoing and playing never change the scene's
  light count and never recompile shaders (suite section 15: equal `renderer.info.programs`, measured +5 per light before). A light piece has no scene object of its own
  (its handle's `objects` is empty; the editor's bounds use the 0.5 m stand-in). Placing more lights than the tier pool works but adds a temporary light and a console warning.

## Not yet
Faces / flicker / label colours / boss arena in the inspector.
