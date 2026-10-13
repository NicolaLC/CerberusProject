# Workshop editor (#70)

`?scene=workshop` is a level editor: `src/levels/workshop.json` has `"tool": "workshop"`, the tool is
`src/game/workshop/editor.js` (`WorkshopEditor`, registered in `gym/tools.js`), suite `tests/workshop.browser.mjs`.
The document and its undo / redo are `workshop/doc.js` (`WorkshopDoc`: pure data, no three.js / DOM; `tests/workshop-doc.test.mjs`). Save / load files are `workshop/io.js` (#72). The editor only runs in the scene named `workshop`; the same tool in any
other level is inert (`tool.editing === false`).

## Doc model
- `tool.doc` is a plain level object (format: level.md), a deep copy of the loaded level, held by `tool.model` (a `WorkshopDoc`: commands `add / move / rotate / setParams / setName / remove / duplicate`, `undo / redo` stacks, `sel`, `dirty`, `toJSON / fromJSON`). The editor's methods of those names delegate to it. The model calls the editor's `#sync(cmd, reverse)` before changing `doc.pieces` (the hook builds / frees the live handle and may throw, leaving the doc untouched) and `changed()` after. `doc.pieces` is the only state.
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
  - `kit.*`, `arch.*` and the props with collision (`prop.console`, `prop.crate`, `prop.puppetRack`): 90 degree steps on `yaw`. A free yaw given to `place` is fitted to 90 (kit.js / props.js throw otherwise). Other `prop.*`: 15 degree steps.
  - `env.box`, `env.strip`: 90 degree steps swap width and depth (and turn `faces`); no `yaw` is stored (builders ignore it).
  - `trigger.volume`, `objective.reach`: like `env.box` (a quarter turn swaps width and depth of `size`). `marker.*`: 15 degree steps on `yaw`.
  - `env.label`: 15 degree steps on `params.yaw`. `light.point`: does not turn.
  - enemies, pickups, `prop.gun`: 15 degree steps on `yaw`.
- A mover's rail (`params.to`) and a boss arena (`params.arena`) move with the piece (`prop.cables` `to` is an offset: it moves by itself).
- Editor enemies are frozen (`enemies.freeze(true)`, the previous state is restored on dispose), posed once after spawning (`enemies.pose(actor, { viewer })`, the viewer is a dead `Absent` stand-in so nothing wakes) and the boss is set with `enemies.setBoss`.

## Edit mode
Free-fly camera; the editor sets engine mode `'edit'` (`engine.setMode`), so the `'play'` group systems (player, weapon, pickups,
encounter, camera rig) do not run (`game.editing` reads the mode), the HUD (`#hud`) is hidden, and the player model is hidden. The sun's shadow window follows the editor camera
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
| Esc | in an inspector field: revert + blur; otherwise disarm, then deselect, then pause (scene buttons: QUIT TO MAIN MENU, then DEVELOPMENT) |

## Play in place (#71)
`P` toggles edit and play (`play()`, `edit()`, `togglePlay()`, `restart()`, `playing`); `editing` is false while playing, so
the mode is `'play'` (`game.editing` false) and the player, weapon, pickups and camera systems run as in the normal game.
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
    `prop.gun` gun, hideOn; every `kit.*` its size params + mat (`kit.platform`: size, height, stairs, parapets, mat, coverMat); enemies `group`, `dormant` (`enemy.mover` also `to`, `speed`);
    `marker.entry` group, enemies (comma list); `zone.interior` size; `trigger.volume` size, event, once, wakeGroup, spawnGroup; `objective.*` text, detail, order, limit, wakeGroup, spawnGroup + their own (Missions). `pickup.gun` gun, ammo; `log.line` text, on, priority, once, delay (Log lines); `intro.boot` lines (separated by `|`), duration, skippable, after (Boot intro); `intro.cinematic` skippable only (its `shots` / `wake` are edited in the file, Intro cinematic). Markers (`marker.spawn`, `marker.checkpoint`), ammo pickups and `boss.spider`'s arena have only `name` / `group`.
  - Not in the UI: `faces`, `ownMaterial`, `flicker`, `env.label` colors, `boss.spider` arena, `kit.*` `yaw` (use R).
- **Selection**: a `Box3Helper` tinted by cover class (wall white, high blue, low orange, none yellow) and the status
  panel (right): count, snap, undo / redo depth, the piece's id, pos, yaw, size and cover flags.
- All helpers, panels, listeners, the HUD state and every piece handle are freed in `dispose()`.

## Test hooks (`game.tool`)
The suite refuses `requestPointerLock` (init script, game falls back to free-mouse mode): headless Chromium can end up swallowing every real mouse event after interleaved lock requests, which made the real-DOM inspector sections flaky. Real mouse/keyboard sections need that.
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
  `wake()` take part (trooper, drone, boss, dormant puppets); other puppets are always on and never count as awake.
  `params.dropGun` (every enemy; gun id) / `dropAmmo?` (rounds in the pickup, default the gun's `pickup.drop`) / `dropOnce?` (true): when it is destroyed it leaves that gun on the floor as a bare `pickup.gun` (`Pickups.dropGun`, wired in `game.js` on `puppet:down`), **unless the player already owns the gun**. With `dropOnce` only the first death of the level drops it (the set of dropped guns is cleared with the level), so a squad all carrying `dropGun: 'rifle'` yields one Warden; `dropOnce: false` drops on every death while the gun is not owned. Validation (meta `check`, `dropProblem`): known gun, `dropAmmo` >= 0, `dropAmmo` / `dropOnce` need `dropGun`. Inspector fields: dropGun, dropAmmo, dropOnce. Test: `tests/loadout.browser.mjs` section 5.
  `params.dormant: true` (every enemy, needs a `group`, else `Registry.check` errors): never wakes itself (no sight, hearing, arena entry or damage wake; a shooter never pops up or fires), still takes hits and dies; only `wakeGroup` / `encounter:wake` wakes it, then it behaves normally. Restart and reload rebuild it from the level data. The editor's enemies are frozen, so nothing wakes in edit mode.
- **Triggers**: fire on the frame the player's feet enter the box (starting inside counts); `once: true` fires one time per run. Fire =
  `events.emit('trigger:fired', { id, event })` with `id` = the piece `name`, else `trigger<n>` (n = order among triggers in the file),
  then `wakeGroup` / `spawnGroup`.
  Objectives (#12, Missions below) subscribe to `trigger:fired` / `checkpoint:reached` / `group:spawn`.
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

## Missions (#12)
Code: `src/game/world/mission.js` (`Mission`, `game.mission`), objective records in `encounter.js`. `Encounter.load` hands the non-inert `objective.*` records to
`Mission.start`, `unload` calls `stop` (so `Game.loadScene` and the editor's play / restart / edit are covered), and `Encounter.update` ticks `Mission.update(dt, player, interact)`
after the checkpoint / trigger scan, also while the player is dead (timers run on). Logic only: no scene objects. In edit mode and the Library the records are inert gizmos, the mission stays `none`.
| id | params | completes when | gizmo (yellow) |
|---|---|---|---|
| `objective.reach` | `size` (4,3,4), `trigger?` | the player's feet are in the box (as `trigger.volume`); with `trigger` instead on `trigger:fired` / `checkpoint:reached` with that `id` (box ignored) | translucent box |
| `objective.destroy` | `group?`, `count?` | `puppet:down` of an enemy of `group` (any if absent) from the moment it is current, `count` times, or all that were alive then; `group:spawn` adds its count to an absent `count` target; 0 targets completes at once | pad + block |
| `objective.survive` | `time` (30) | `time` s of simulated time | pole + rings |
| `objective.action` | `action` (`jet` / `cover` / `vault` hop / `slide` / `coverRun`), `count?` (1), `size?` | `player:jet` / `player:coverSlam` / `player:vault` (payload `'hop'` / `'slide'`) / `player:coverRun` matching `action`, `count` times from the moment it is current; with `size` only when the player's feet are in the box at that moment | box (`size`) or pad |
| `objective.interact` | `radius` (2) | player alive within `radius` (2.5 m vertical) and the `interact` intent (G / pad B) pressed | ring + terminal block |
All: `text` (HUD panel header, default per kind), `detail?` (the panel's instruction in plain words; input tokens `{jump} {aim} {fire} {sprint} {interact} {reload}` as in `env.label`, drawn as key caps of `controls.scheme`; rebuilt only when the objective or scheme changes; a string), `order?`, `limit?`, `wakeGroup?`, `spawnGroup?`, `grantGun?`, `grantAmmo?`, `skipOn?`, `requiresGun?`, `skipIfOwned?`; bad values throw `objective.x: ...` (inspector fields: text, order, limit, group fields, grant / skip fields, then the kind's own).
- **Reward** (`grantGun`, `grantAmmo?` rounds into its reserve, needs `grantGun`): when the objective is *done* (not skipped) the Mission emits `mission:grant { gun, ammo }` right after `mission:objective:done` (so the discovery toast replaces OBJECTIVE COMPLETE); `game.js` calls `weapon.grant` (first time: `weapon:discovered`, toast, `log.line on: discovered:<gun>`) and raises the gun. Same path as picking up a `pickup.gun`, driven by an objective (an armoury rack: interact, G).
- **Optional objective** (`skipOn` = a `trigger.volume` name or `marker.checkpoint` name): while the objective is current, `trigger:fired` / `checkpoint:reached` with that id completes it as *skipped* (`mission:objective:done { skipped: true }`, no toast, no `grantGun`), so the chain moves on and later waves never wait for it. Use a trigger with `once: false` (a `once` trigger may already have fired earlier).
- **Gun conditions** (#93, #15; `Mission` asks `owns(gun)`, game.js passes `weapon.owned`): `skipIfOwned: <gun>` completes the objective as *skipped* (silent, no grant) when it comes up if the gun is owned, or the moment it becomes owned while it is current: a "find it if you have not" step. `requiresGun: <gun>`: the objective's own condition may be met (zone reached, targets destroyed, terminal used) but it only completes once the gun is owned (`mission.held` while it waits; the HUD line adds `<GUN NAME>: NOT FOUND`). Together they make a mission that cannot end without a gun and cannot soft-lock: a `skipIfOwned` step in front, with its own way to obtain the gun (the Prologue: "Weapon requirement" below).
- **Order**: sorted by `order`, absent = position among the objective pieces in the file; ties keep file order. Id in events = piece `name`, else `objective<n>` (n = file position).
- **Becoming current**: elapsed / progress reset, destroy target set, then `wakeGroup` / `spawnGroup` (`encounter:wake` / `encounter:spawn`), then `mission:objective`.
- **Events**: `mission:objective` and `mission:objective:done` `{ index, total, id, kind, text, skipped }`, `mission:grant` `{ gun, ammo }`, `mission:complete` `{ total }`, `mission:failed` `{ index, id, reason: 'time' }` (`limit` s after it became current; nothing updates afterwards).
- **State**: `mission.state` `'none'` (no objectives) / `'active'` / `'complete'` / `'failed'`, `current`, `index`, `elapsed`, `progress`, `target`, `hudText()`.
- **HUD** (`#objective`, under the top bar, hidden when `hudText()` is null): `TEXT  n / N` (destroy; action with `count` > 1), `TEXT  m:ss` remaining (survive; `limit` on the others), `MISSION COMPLETE`, `MISSION FAILED`. State only; toasts OBJECTIVE COMPLETE / MISSION COMPLETE / MISSION FAILED.
- Input: `interact` binding (`controls.js`: G, pad B). The editor ignores G while playing (it snaps the grid in edit mode only).
- Suite `tests/mission.browser.mjs`: pieces and gizmos, a full mission (reach, destroy, survive, interact), `order`, reinforcement targets, zero targets, trigger / checkpoint reach, `limit` and a dead player, restart / edit / scene switch, bad params.

## Log lines (#40)
`log.line` pieces (encounter.js, owner `encounter`) put STEM-00's log lines in a level as data. Fields: `text`, `on`, `priority` ((none) = normal / high), `once` (true), `voice` ((none) = stem / announcer), `delay` (s).
Gizmo: an amber screen on a post; inert in edit mode and the Library (like objectives). Writing rules: `instructions/narrative.md`.
- **`on`** (matched against existing events; ids as in those events): `start` (the encounter loads in play: scene load, Workshop play / restart), `trigger:<id>` (`trigger:fired`),
  `checkpoint:<id>` (`checkpoint:reached`), `objective:<id>` (`mission:objective`, it becomes current), `objective:<id>:done` (`mission:objective:done`),
  `discovered:<gun>` (`weapon:discovered`, gun = a `GUNS` key), `mission:complete`, `intro:done` (the boot intro ended or was skipped; the line then plays once calm), `cinematic:wake` (the intro cinematic's power surge, `cinematic:wake`), `cinematic:done` (the intro cinematic ended). Anything else, an empty `text`, a bad priority / once / delay: `Registry.check` throws
  `level: piece #i ("log.line") ...` (meta `check`, `logLineProblem`), the builder throws `<id>: ...` (inspector toast).
- **Voice**: `stem` (default) is STEM-00's terminal. `announcer` is the HiveMind PA (the purge's `CALIBRATION UNIT 00: NONCOMPLIANT. PURGE.`): it does not wait for calm, defaults to `priority: high` (replaces the line on screen), and the Log view styles it apart (`#log.announcer`: cold white with a network-cyan glow, wide tracking, upper screen, no cursor; its `log.entries` row carries `voice: 'announcer'`). No `> ` prefix; wording rules in narrative.md.
- **Never in a fight** (STEM-00 lines): a queued line waits while STEM-00 is in combat: an awake enemy alive within 30 m (`TUNING.combatRange`), or a `weapon:shot` / `player:hurt`. It plays once
  none of that has happened for 3 s (`TUNING.calm`, `encounter.calm`; a run starts calm). `delay` counts from then.
- **Firing**: `Encounter` queues the matching records (`once` = one time per run), and emits `log:say { text, priority }` from its update once calm and `delay` have passed (the first `start` line shows
  on the first play frame, after `resetRun`). Pending lines are dropped on unload.
- **Log view** (`src/game/view/log.js`, `game.log`, `#log` in the HUD): one line at a time, bottom centre, amber monospace typed at 40 chars/s with a blinking cursor, held
  `max(2.5 s, 0.06 s per char)`, faded 0.5 s. `say(text, { priority })`: `high` replaces the current line, `normal` waits (more than 4 waiting: the oldest is dropped).
  Every shown line goes to `log.entries` `{ text, t }` (t = s since the run began) for the pause-menu Log (not built). `Game.resetRun` clears it all (`log.reset()`).
- Suite `tests/log.browser.mjs`: start / restart / once, trigger, objective done, delay, waiting for calm (shot, awake enemy), `discovered:rifle`, priority queue and entries, validation, the announcer voice, `env.alarm` (below).

## Alarm (#14)
`env.alarm` (encounter.js, owner `encounter`, reusable: any level can raise an alarm). Fields: `on`, `off` (optional), `duration` (s, optional), `color` ('#ff9a2a', amber: a full-screen red tint read as low health), `strength` (0.4), `siren` (true).
Gizmo: a red beacon on a post; inert in edit mode and the Library. Validation: meta `check` (`alarmProblem`): `on` / `off` one of the `log.line` `on` forms, `duration` above 0, `color` `#rrggbb`, `strength` in (0, 1], `siren` a boolean.
- **Start / end**: `Encounter` queues the alarm when its `on` happens (same events as log lines, once per run) and starts it at the next update: `alarm:on { id, color, strength, siren }`. It ends on `off`, after `duration` s of play, or when the level unloads: `alarm:off { id, active }` (`active` = alarms still running), `alarm:clear` (unload, scene load, Workshop play / restart / edit).
- **Light** (`World.setAlarm(color, strength, instant)`, `world.alarm`): `level` fades 0..1 at 1.6 per second toward `target`; the haze (sky horizon and fog), hemisphere, sun and every level point light are mixed toward `color` by `level * strength` with a slow pulse (3.2 rad/s, +-15%), the hemisphere dims up to 35%. Normal colours are kept (`world.base`, a light's `userData.base`), so ending the alarm restores them exactly. Permanent state of the World, not part of a level; the light count never changes (engine.md).
- **Siren** (`Audio.siren(on)`): the recorded loop `alarm-siren.mp3` (a low muffled horn blast every ~3 s with silence between, 8 s loop); synth fallback until it decodes: a sawtooth swept 460-940 Hz by a 0.9 Hz triangle LFO through a lowpass, 0.4 s fade in, fade out on stop; waits for the first user gesture like all audio. Recorded replacement prompt: sfx-prompts.md.
- Two alarms keep the light and siren until both ended. Art: red light is for story beats and alarms only (art-style.md).
- Tests: `tests/log.browser.mjs` section 6 (validation, start / end, duration, off, clear, inert gizmos), `tests/prologue-purge.browser.mjs` (in the Prologue).

## Prologue purge (#14)
`src/levels/prologue.json` chains ordered objectives (explicit `order`; ids are the piece names). Each stage wakes its dormant group when it becomes current (`wakeGroup`), and a stage whose group is already dead passes at once (destroy counts the living members when it starts), so kills in any order never soft-lock. Pistol ammo is infinite, so every stage can be finished.
| order | id | kind | wakes | notes |
|---|---|---|---|---|
| 10 | `leave-bay` | reach | - | the opening |
| 20 | `calibrate` | destroy, `count` 3, no group | - | the first three kills of any target |
| 30 | `purge-start` | survive 4 s | - | alarm (`purge-alarm`, `env.alarm`), red light, announcer line; nothing awake yet |
| 40 / 50 | `purge-yard` / `purge-hall` | destroy | `purge-1` / `purge-2` | shooters: yard line + platform, then interior |
| **60** | `armoury` | `objective.interact` (SALVAGE A WEAPON), `grantGun: rifle`, `grantAmmo` 64, `skipOn: armoury-skip` | - | the rack in the west end of the hall (-21.5, 0, -37; `env.box` `armoury-rack` + `prop.gun` + `env.label`). G: the Warden is owned and raised (toast KR-7 WARDEN ACQUIRED, `weapon:discovered`, the STEM-00 line) |
| 65 | `purge-standby` | survive 5 s (STAND BY) | - | the pause: nothing is awake, so the queued STEM-00 lines (hall shooters, Warden) get their 3 s of calm before the troopers |
| 70 / 80 | `purge-troopers-yard` / `purge-troopers-hall` | destroy | `purge-3` / `purge-4` | |
| 90 | `purge-drones` | destroy | `purge-5` | |
| **95** | `armoury-late` | `objective.interact` (SALVAGE A WEAPON) at the same rack, `grantGun: rifle`, `grantAmmo` 64, `skipIfOwned: rifle` | - | the "find it" step (#93): silent skip when the Warden is owned (taken at the rack, or picked up from the trooper drop), otherwise it waits here until the player takes it |
| 100 | `purge-gate` | reach (boss arena gate, (39.75, 0, -17)) | - | the spider sleeps until its stage |
| 110 | `purge-boss` | destroy | `purge-6` | the climax; its end (`objective:purge-boss:done`) ends the alarm |
| **120** | `exit` | `objective.reach` REACH TRANSIT NODE (39.75, 0, -75), `requiresGun: rifle` | - | beyond the sealed `exit-gate`; completing it completes the mission (#15) |
Checkpoints: `cp-yard` (0, 0, 20), `cp-hall` (-9, 0, -36), `cp-hall-east` (16, 0, -33), `cp-gate` (39.75, 0, -10). Log lines: the announcer on `objective:purge-start`; STEM-00 on `objective:purge-hall:done` and `objective:purge-drones:done` (they wait for calm).
**Weapon discovery (#93).** The armoury is optional: `trigger.volume` `armoury-skip` (`once: false`, 32 x 3.5 m, just outside the hall's two doors on the yard side, z -30 to -26.5) is its `skipOn`, so leaving the hall without taking the Warden skips it (no toast, no grant) and the chain goes on to the stand-by and the troopers. Fallback: every trooper of `purge-3` / `purge-4` has `dropGun: rifle`, `dropAmmo: 64` (`dropOnce` default), so the first one destroyed leaves a Warden pickup where it fell unless it is owned (see Spawn groups); the pistol alone still beats every wave, the Warden is never required. Three `pickup.light` crates ((-13, 0, -26), (8, 0, -25), (21, 0, -13)) refill it along the yard route. The STEM-00 line `> ITEM: KR-7. FUNCTION: KILL. QUERY: WHY DOES IT FEEL HEAVY?` (`on: discovered:rifle`, so it plays after either way of finding the gun, once, when calm).
**Exit (#15).** The arena's north wall (z -62.5) holds a `kit.doorway` (`exit-door`, x 39.75, opening 4 x 4 in an 8 high wall) closed by `kit.gate` `exit-gate` (`on: objective:purge-boss:done`, slides up into the lintel in 1.5 s), so the gate opens the moment the spider dies. Behind it a roofed annex (`transit-zone` interior, cold strips, a node pad with `env.label` TRANSIT NODE). One STEM-00 line on `objective:purge-boss:done` (`> SX-6: DESTROYED. GATE: OPEN. QUERY: WHO OPENED IT?`). The empty rack: `prop.gun` `hideOn: discovered:rifle`.
**Weapon requirement (no soft-lock).** The Prologue cannot end without a Warden and never needs one to survive. Two things enforce it: `armoury-late` (95, `skipIfOwned`) stops the chain before the arena gate until the Warden is owned, and `exit` has `requiresGun: rifle` as a second lock. Ways to own it, all always available: take it at the rack (G; the rack objective is re-asked by `armoury-late`, it is never consumed), or pick up the trooper drop (a bare `pickup.gun` that never expires, `dropOnce` only limits how many are made) which completes `armoury-late` by itself. Both are exercised in `tests/prologue-warden.browser.mjs`.

## Mission complete screen (#15)
`mission:complete` -> `Summary` (`view/summary.js`, `game.summary`, `#summary`): slow motion (`juice.hold(0.25)`) for 2.2 real s, then the report: `RunStats` figures (`run-stats.js`, `game.stats`): TIME (play seconds, not the boot intro or pause), ACCURACY (hits / shots; piercing slugs cap it at 100%, armor glances count as misses), HEADSHOTS (zone `head`), PERFECT RELOADS, SALVAGE COLLECTED (a dash until Progression #7), HOSTILES DESTROYED. Time is held at 2% (`juice.hold(0.02)`), `controls.locked`, the pointer is released (`padPlay`) for the RESTART button (click, Enter, pad A; ignored for 1 s). RESTART calls `loadScene(sceneName)` (the Workshop's `tool.restart()` while playing there). `Game.resetRun` calls `stats.reset()` and `summary.reset()` (overlay emptied, key listener removed, time and input free). Look: blue-black, scanlines, monospace, amber head and button, cold-white figures, no red (art-style.md). Event `restart` binding in `controls.js`.
Respawn: after 3 s a death respawns at the last `marker.checkpoint` reached (else the spawn); tested in the Prologue by `tests/prologue-exit.browser.mjs`.

Suites `tests/prologue-warden.browser.mjs` (fresh pistol-only run, armoury take, toast / event / line, pause, skip, drop once, owned = no drop, pistol-only completion) and `tests/prologue-purge.browser.mjs`: start (alarm, light, announcer), each stage and only its group awake, spider and completion (alarm ends), checkpoints, out-of-order kills, scene reload clears the alarm.

## Gates and reactions (#15)
`kit.gate` (kit.js, owner `world`, a reusable piece) seals a doorway until a level event. Fields: `on` (required), `width`, `height`, `thickness` (0.3: thinner than the 0.5 wall, so the retracted slab hides inside the lintel without touching its faces), `slide` (`up` or `down`), `time` (1.2 s), `mat`. Build the frame with `kit.doorway` (`wallHeight` at least twice the opening height for `slide: up`) and put the gate on the same `pos` / `yaw`.
- **`on`** takes the `log.line` forms (`start`, `trigger:<id>`, `checkpoint:<id>`, `objective:<id>`, `objective:<id>:done`, `discovered:<gun>`, `mission:complete`, `intro:done`). `Encounter` dispatches every one of those keys to `world.react(key)` (the same place log lines and alarms hook in), which starts the matching gates (`gate:open` { on } is emitted once per key) and hides the `prop.gun` pieces whose `hideOn` equals the key. Opens once; a level load, restart or the editor's play / edit rebuilds it shut.
- **Runtime** (`World.addGate`, `World.update`): the gate leaves the static batches (it moves) but keeps its collider and raycast entry; it moves linearly over `time`, its collider follows (so it blocks while it is still low). Fully open: the collider is parked below the floor (x / z stay, the collider grid stays valid), the mesh is hidden and no longer a raycast target.
- **Look**: `kit.js gateMats` (shared, in `world.keep`): dark slab (unless `mat`), chevron bands and seams as children of the slab, static jamb / lintel frame, and a lamp mesh (out of the batches) whose material swaps red -> cyan in `react()`: no per-frame work.
- **Gizmo** (`world.spawn(data, { gizmo: true })`, used by the editor and the Library): the gate stays shut whatever happens and a translucent cyan ghost shows the space it slides into. Despawn frees it with the handle.
- **Validation**: meta `check` (`onProblem`, shared with `log.line` / `env.alarm`) rejects a missing or malformed `on`, an unknown gun in `discovered:<gun>` and a bad `slide`; the builder rejects `time` at or below 0.
- `prop.gun` `hideOn` (same forms) hides the model when it happens; the Prologue rack uses `objective:armoury:done`.
- Tests: `tests/kit.browser.mjs` (shut / half open / open, collision, ground, inert gizmo, despawn, validation, `hideOn`), `tests/prologue-exit.browser.mjs` (the Prologue's exit).

## Boot intro (#13)
`intro.boot` (encounter.js, owner `encounter`, a reusable piece, not Prologue-only code). Fields: `lines` (typed with `|` between lines), `duration` (s, 12, above 0, at most 20), `skippable` (true), `after` (optional, an `on` form: the boot waits for it, e.g. `cinematic:done`; default the first play frame), `pov` (optional, false: `true` or `{ release, timeout, blend }`; the inspector has it as a checkbox, which writes a plain boolean).
Gizmo: a monitor with text bars on a post; inert in edit mode and the Library. Validation: meta `check` (`introBootProblem`): `lines` a non-empty list of non-empty strings, `duration` a number in (0, 20], `skippable` a boolean.
- **Start**: the first `intro.boot` of a played level emits `intro:start { lines, duration, skippable }` at the first play frame (after `resetRun`), so a scene load, Workshop play and restart all start it. Pending until then; dropped on unload. With `after` it starts when that key happens instead (synchronously, inside the event: after `cinematic:done` its black overlay covers the cut back to the gameplay camera).
- **View** (`src/game/view/boot.js`, `game.boot`, `#boot`): black, then static and scanlines, then the lines typed in (cold white `#EAF6FA`, monospace, pace set so all of them are typed before the last `fade` (1.6 s, at most 30% of the duration) and a short hold; at least 14 characters/s), a line containing `HIVEMIND LINK: LOST` flickers `#C04BFF` with a `#FF3DCB` glow. The end fades the overlay out while `post.boost` (an exposure factor on the auto exposure, 2.4 down to 1) settles.
- **Time**: `Boot.update(dt)` runs in the `present` phase (group `play`) on the scaled game dt, so pause freezes it and headless `engine.step` drives it. `duration` is the total, `intro:done` fires when `t >= duration`.
- **Input lock**: `controls.locked` (move, look, aim, run, fire, jump, reload, interact, shoulder, weapon slots and cycle read idle; `pause`, `stats`, `skeleton` still work). At the end `controls.ease` ramps 0 to 1 over 0.6 s and scales move and look, so control returns smoothly and the camera never snaps. `boot.inputLocked` mirrors `controls.locked`.
- **Skip**: fire, jump, interact or pad A (the game passes the press), only when `skippable` and the intro was seen once (`localStorage` `cerberus.introSeen` = true, read at every start, every access in try/catch), and not in the first 0.3 s. A small "skip" hint shows then. Completing or skipping sets the flag.
- **End**: emits `intro:done { skipped }` (also on skip). `Game.resetRun` (`boot.reset()`: scene load, Workshop play / restart / edit) clears the overlay, the lock and `post.boost` without the event.
- **POV hand-off** (`pov`): control returns in STEM-00's own view, continuing the boot text. `Boot.start` calls `camRig.holdPov(pov)` (weight 1: the camera at the head pivot + 0.12 m forward, normal look; game.js hides the model while `camRig.povW` > 0.6); the end arms it; once the player is `release` m (1.2) from where it was armed, or after `timeout` s (none by default: an idle pull-back inside the cradle ends against its frame, in the head), it eases (smoothstep) to the normal rig over `blend` s (1.2), between the eye and the collision-capped rig position. Defaults in camera.js `TUNING.pov`. Validation: `pov` a boolean or an object whose given fields are numbers above 0. The Prologue's `intro.boot` has `pov: true`.
- State for tests: `boot.active`, `boot.t`, `boot.duration`, `boot.inputLocked`, `boot.canSkip`, `boot.seen`, `boot.lines`, `boot.fade`.
- Suite `tests/intro.browser.mjs`: overlay and lock at start, typed lines and the HIVEMIND span, no movement / fire / look / switch while locked, `intro:done` within the duration and the eased return, `log.line` on `intro:done`, pacing, skip (only once seen; fire / jump / interact / pad A; `skippable: false`; blocked storage), pause, restart / edit / scene load, validation.

## Intro cinematic
`intro.cinematic` (encounter.js, owner `encounter`, reusable). STEM-00 wakes up before the boot intro: a dark bay, a power surge, a push-in to its visor, then the boot overlay.
Params: `shots` [{ `from` [x,y,z], `to`? (= from), `look` [x,y,z], `lookTo`? (= look), `time` (s, above 0), `ease`? ('linear' / 'inOut', linear), `fov`? (10..120, 55), `shake`? (0..1, trauma at the shot's start) }] in world coordinates (the camera anchors, #99), all shots together at most 30 s;
`wake`? { `at` (s, 0: the surge), `rise` (s, 2: slumped to normal), `shake` (0.45) }; `skippable`? (false). Only `skippable` is in the inspector; edit `shots` / `wake` in the file.
Gizmo: a camera on a post plus a line through every shot's from -> to (its own geometry, freed with the gizmo); inert in edit mode and the Library (the Library's example path is in world space, so it points away from the aisle). Validation: meta `check` (`cinematicProblem`).
- **Start**: the first `intro.cinematic` of a played level emits `cinematic:start { shots, wake, skippable }` at the first play frame (after `resetRun`).
- **View** (`src/game/view/cinematic.js`, `game.cinematic`, system `cinematic`, phase `late` before `camera`, group `play`, scaled dt): sets `camRig.script` { pos, look, fov } each frame (CameraRig places the camera there, trauma shake still applies; the gameplay yaw / pitch are untouched). Before `wake.at`: exposure `post.boost` 0.22, STEM-00 dormant (animation.md), core dark. At `wake.at`: trauma, a flash, 0.8 s of exposure flicker, then the exposure settles to 1 and the core comes up over 0.6 s; `player.view.dormant` eases 1 to 0 over `wake.rise`. Tuning: `TUNING` in cinematic.js.
- **Input**: `controls.locked` while it plays. Skip (fire / jump / interact, after 0.3 s) only when `skippable` and the intro was seen once (the boot's `cerberus.introSeen` flag, read at start; the cinematic sets it after emitting `cinematic:done`, so a boot it starts still reads "not seen" on a first run). The Prologue sets `skippable` on both intro pieces: the first run plays in full, later runs can skip.
- **Surge event**: `cinematic:wake` at `wake.at` (an `on` form: the Prologue's `cradle-00` `releaseOn` opens its clamps as STEM-00 straightens). A skip before the surge emits it at the end, just before `cinematic:done`, so what waits for it still happens.
- **End**: camera, pose, core and exposure restored, `cinematic:done { skipped }`; an `intro.boot` with `after: cinematic:done` takes the lock in the same call, otherwise the input is freed at once (no ease). `Game.resetRun` (`cinematic.reset()`) clears it without the event. Not run time (`RunStats`).
- State for tests: `cinematic.active`, `t`, `duration`, `shot`, `woke`; `camRig.script`, `player.view.dormant`.
- Prologue: `wake-up` (before `intro.boot`, which has `after: cinematic:done`): a 3.5 s wide hold over the shoulder of the operator station (camera (3.2, 1.9, 32.8) drifting to (2.95, 1.95, 33.2) behind the three consoles, their readouts in the bottom of the frame, fov 46) on STEM-00 locked in `cradle-00` on the rack; surge at 2.4 s (the cradle releases); then a 6 s eased push-in to (-0.3, 3.2, 43.7) at the visor; 9.5 s, then the 12 s boot. The path stays inside x -5.5..7.5, z 30.5..49.5, y 0.5..5.5 and clear of the consoles, the stairs and the hoist.

- `src/levels/prologue.json` (the Prologue, #2) is authored in the Workshop from now on: open it (`levelNames()`), edit, save over the file. Its `purge-*` enemy groups are dormant on purpose and are woken only by the purge objective chain ("Prologue purge"). Every enemy of a `purge-*` group is `dormant`.

## Not yet
Faces / flicker / label colours / boss arena in the inspector.

HUD objective panel (`#objective`: `#obj-head` text, `#obj-detail` detail, `#obj-prog` progress; `Mission.hudPanel()`, `Hud` `#objective`): top left, hides `#kills-wrap` (the "TARGETS DOWN" counter, still shown without a mission). OBJECTIVE COMPLETE stays the existing toast.
