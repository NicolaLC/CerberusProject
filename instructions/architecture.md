# Architecture

Two layers. `src/engine/` is game-agnostic and must never import from `src/game/`.
`src/game/` builds the shooter on top of it. `src/main.js` only boots `Game`.

```
src/
  main.js                 boot (?debug → window.game, ?scene=<name> → first scene)
  engine/                 runtime, see instructions/engine.md
    engine.js             renderer, scene, camera, phased scheduler, fault isolation, loop
    events.js             pub/sub bus
    input.js              raw devices (keys, 'Mouse0..2', motion, wheel, pointer lock, gamepad 'Pad0..16' + sticks, rumble)
    actions.js            named actions -> device codes
    perf.js               frame timing, dynamic resolution, stats panel (F3)
    pool.js               object pools
    dispose.js            disposeTree: detach + free geometry / materials / skeletons / instance buffers
    batch.js              draw-call batching: static merge, rigid skinning, group merge
    math.js               damp, lerpAngle, wrapAngle, segSegDist (allocation-free)
    assets.js             glTF asset manager: cached by URL, ref-counted, SkeletonUtils instances (engine.md)
    storage.js            safe localStorage JSON
    random.js             seedable RNG streams
  game/
    game.js               COMPOSITION ROOT: builds systems, wires events, declares frame order, level lifecycle; loads `settings` once and injects it (Controls)
    scenes.js             scene list: name -> level file, ?scene= resolution (level.md); CAMPAIGN order + progress (`cerberus.progress`)
    registry.js           piece registry: stable string id -> how a piece is built from data (ids: level.md)
    controls.js           BINDINGS table + intents (move, look, aiming, running, firing, slots...)
    settings.js           player settings + start-panel bindings
    world/  world.js (builds env.* / light.* pieces, colliders, cover, sky, lights), arch.js (arch.* architectural dressing: coves, ribs, panelling, bulkheads, floor channels, coffers, catwalks; level.md), interior.js (`arch.corridor` interior kit: painted normal / roughness maps, corridor env map, the `World.interior` materials; level.md), sectors.js (`World.sectors`: rooms drawn / built / freed by portal visibility; level.md "Sectors"), textures.js, pickups.js (pickup.* pieces), encounter.js (marker.* / trigger.* / objective.* / log.line / intro.boot / intro.cinematic pieces: spawn, checkpoints, trigger volumes, reinforcements; workshop.md), mission.js (objective sequencing, `game.mission`; ticks inside encounter)
    actors/ rig.js (skeleton, animator, IK), parts.js (model building blocks, debris), soldier.js (player model),
            looks.js (trooper / puppet models),
            player.js (motor: intent -> movement, cover, jetpack, vault, health; never touches a mesh), player-view.js (`player.view`: model, rig, skin, animation, root pose; reads the motor's state; the motor forwards `root` / `rigModel` / `skin` / `animator` / `muzzle`),
            enemy.js (shared enemy body: hit zones, weak spots, flash, debris death; `sightRay` line of sight for every type),
            puppet.js (training puppets), trooper.js (cover-using soldiers), drone.js, spider.js (miniboss), cerberus.js (CERBERUS: three heads, never destroyed, `unkillable`),
            enemies.js (system: builds enemy.* / boss.* pieces, bolts, stands, target cache, squad alerts, `all` = every enemy)
    ai/     cover.js (cover spots from cover boxes, protection test, spot choice + detour route)
    combat/ guns.js (gun table), weapon.js (controller, hitscan, aim probe), ballistics.js (pure shot math)
    view/   camera.js, fx.js, hud.js (DOM HUD: objective panel, interact prompt, objective pin), log.js (STEM-00 log lines, `game.log`), boot.js (boot intro overlay + input lock, `game.boot`), cinematic.js (intro cinematic: scripted camera shots, STEM-00's wake, `game.cinematic`), summary.js (mission complete screen, `game.summary`; stats in `game/run-stats.js`, `game.stats`), audio.js (SFX, music; `Audio.ui(kind)` = menu UI sounds, see `ui:sfx`; `Audio.title(on)` = title music, from Shell), juice.js, post.js, shell.js (DOM shell: main menu / pause menu and sub-pages, pointer lock, scene buttons, keyboard / pad navigation, progress save for CONTINUE), menu-scene.js (the title's own 3D set, `MenuScene`), skyline.js (city material and glow points shared by the title and `env.backdrop`)   (presentation only)
```

`src/levels/` holds level files (plain JSON, see `level.md`); `scenes.js` lists them, `Game.loadScene(name)` hands one to the systems.

## Dependency rules
- Gameplay (`world`, `actors`, `combat`) never calls presentation (`view`). It emits events; view modules
  subscribe in their `listen(events)` method. Exception: the camera rig is gameplay state (aim ray, recoil).
- Systems get their direct dependencies through the constructor. Only `game.js` sees everything.
- Gameplay reads input only through `Controls` (no key codes outside `controls.js`).
- Levels are data, built through the piece registry: each system module exports a table of the pieces it owns
  (`WORLD_PIECES`, `ENEMY_PIECES`, `PICKUP_PIECES`, `ENCOUNTER_PIECES`: id -> builder run against that system); `game.js` registers the
  tables in a `Registry` and gives it to the systems, which build from a level file in `load(level)`. `registry.js` imports nothing, so
  gameplay modules never reach each other through it. Piece ids are a public contract (levels, saves, tools): never rename or reuse one.
- **Every per-level system must be disposable.** A system has a permanent part (built once in the constructor:
  shared materials and textures, sky, sun, pools, pooled geometry, event listeners) and a per-level part
  (`load(level)` builds it, `unload()` removes and frees it; `load` calls `unload` first). Today: `World` (boxes +
  merged batches, colliders, cover, point lights, interior zones), `Enemies` (actors incl. debris / rigs / skins /
  materials, stands, bolts in flight, cover map, kill count), `Pickups` (crates, dropped clips, gun stands), the debug
  skeleton helpers. Presentation and player state expose `reset()` (`FX` particles / decals / numbers, `Hud` boss bar
  and toast, `Log` line / queue / entries, `Juice` hitstop, `CameraRig` lock-on / shake / zoom, `Weapon` loadout (`reset(level.loadout)`: owned guns), `Player.place(spawn)`).
- `disposeTree` frees what a level owns; it never touches `World.mats` (kept in `world.keep`), materials flagged
  `userData.shared`, or textures (grid textures are cached across levels). Arrays other systems hold
  (`world.colliders`, `world.meshes`...) are cleared in place. Listeners stay permanent: never `events.on` per
  level; a new per-level system that must register one has to remove it in `unload()`.
- A new per-level object that is added to the scene needs its disposal in the owner's `unload()`; the
  `scenes.browser.mjs` leak check (geometries / textures / scene objects over arena→gym→library→workshop cycles) fails otherwise.
- The weapon tells the player it fired through `player.notifyShot()` (a direct call: the player is the weapon's constructor dependency, `weapon:shot` is for presentation).
- Enemies: actors (puppet, trooper, drone, boss) get a narrow `ctx` from `Enemies` (world, scene, events, debris bank, cover /
  player / time / all getters, spawnBolt, hurtPlayer, alertNear, separate, reportKill, markDirty, takeStand, setStand) and never
  write system fields. Shared helpers instead of inheritance: `sightRay` (enemy.js), `DebrisBank` (parts.js: death chunks are
  baked once per enemy kind at spawn and shared by every death, pooled chunk objects, geometry freed by `Enemies.unload`).
  Tool APIs: `freeze(on)`, `setBoss(actor)`, `pose(actor, { viewer })`.
- Cross-system reactions (puppet dies → pickup drop) are wired in `game.js` with `events.on`.

## Scenes
`game.loadScene(name)` (any time between frames, never inside a system update): validates the level file, unloads the
old level (enemies → pickups → world), loads the new one (world → enemies → pickups), puts the player at `level.spawn`
with full health, resets camera / weapon / fx / hud / juice. `?scene=<name>` picks the first scene (unknown → arena + console warning);
`window.game.loadScene` is there with `?debug`. A malformed file throws before anything is unloaded. Point lights are
the only thing three.js recompiles shaders for, so they come from a fixed pool owned by `World` (engine.md, Per-encounter budget): scene switches and the editor do not recompile.

## Frame order (declared in `game.js`)
| phase | systems | dt |
|---|---|---|
| pre | controls (+ hitstop time scale, aim assist, look, shoulder, debug keys), stats toggle | real |
| simulate (substeps ≤ 20 ms) | player → weapon → enemies → encounter (+ mission) → pickups | scaled |
| late | cinematic (intro: sets `camRig.script`; group `play`) → camera → aimProbe (what the crosshair is on) | scaled (shake uses real) |
| present | fx → world (lights, sun, player visibility, sector cull: camera layers, build ahead, free behind; enemies' dormant cull) → hud → log → boot (intro overlay, input lock; group `play`) → audio (MG spin) | scaled |
| render | post (exposure, grade, bloom) | real |

Paused (pause menu): only `whilePaused` systems run (controls, stats, camera, post).
Idle (`engine.idle`, the main menu and its sub-pages): only the `pre` phase runs (controls + shell: menu navigation, which also
renders the menu set); no game system is simulated or drawn. `?debug` skips the main menu and runs at once.

## Main menu and save (view/shell.js)
Title (launch, and QUIT TO MAIN MENU): CONTINUE (only with a save) / NEW GAME (with a save: "Overwrite progress?") / SETTINGS /
DEVELOPMENT (scene buttons `#scenes`, debug keys) / CREDITS (static HTML in index.html, kept in sync with `credits.md`) / QUIT TO
DESKTOP (desktop build, bottom-left; Esc / B on the title). Pause (Esc / pad Menu in play): RESUME (`#start`, re-locks the pointer)
/ SETTINGS / QUIT TO MAIN MENU / QUIT TO DESKTOP. Pages are `#overlay .page[data-page]`; items `data-go` (sub-page) or `data-act`.
Loading screen (`#loading`, `Shell #load`): NEW GAME / CONTINUE / a Development scene show it with the scene title, give it two
frames to paint, then run the synchronous `loadScene` and start play; menu input is ignored meanwhile. `?debug` loads without it.
Progress: `cerberus.progress` = { scene, checkpoint } (scenes.js), written when a campaign scene (`CAMPAIGN`) starts and on
`checkpoint:reached`. CONTINUE restarts the saved scene from its beginning: mission state (objectives, gates, pickups) is not
saved, so the checkpoint id is recorded but not resumed yet.
The main menu is its own scene: at launch (no `?debug`) no level is loaded, `?scene=` included; NEW GAME / CONTINUE / a
DEVELOPMENT pick call `game.loadScene`, QUIT TO MAIN MENU calls `game.unloadScene()` (sceneName / level null). `<body class="title">`
(set in index.html for the first paint, toggled by the shell) hides every game, editor and Gym panel; the editor ignores input
while paused. Backdrop: `view/menu-scene.js` (`MenuScene`), built on the first title and drawn by `Shell.update` with the game's
renderer only while idle, so it stops the moment play starts and resumes on QUIT TO MAIN MENU (kept, not disposed). It is a fixed
set, not a level: STEM-00 (Rig + soldier parts, `SEATED` pose in rig.js) seated on a roof edge, a procedural instanced skyline (weathered
`panelTexture`, shader windows, about half ruined), Spire Cathedrals, CERBERUS (a quadruped war mech standing on the horizon, three heads = a sensor
head and two shoulder gun pods, its own haze/rim shader, breathing violet eyes; towers in its sightline are capped), drones from `droneLook` (drone.js) instanced per material, roof dressing from the prop builders (props.js), haze veils,
smoke, searchlights. About 51 draws and 375k triangles; prefers-reduced-motion stops the camera drift and slows the rest. Menu sounds: `audio.ui(kind)`.
Cursor: while a controller is the device in use (`input.device === 'pad'`) the shell sets `body.pad` and style.css hides the mouse cursor everywhere (menus, canvas); a real mouse move (> 3 px, menus included) switches back to `kbm` and shows it.

Modes: a system may declare a `group` (`engine.add({ group: 'play' })`); the engine runs it only while `engine.mode` equals it
(`engine.setMode(name)`, default `'play'`), no group = always. `player`, `weapon`, `playerPose`, `encounter`, `pickups` and `camera`
are `'play'`; the Workshop editor sets `'edit'` while editing (`game.editing` is `engine.mode === 'edit'`, read-only). A system that does
something different in edit mode instead of nothing (`world`: sun follows the editor camera) has no group and branches on `game.editing`.
A new gameplay system gets `group: 'play'`; enemies are the other half (`enemies.freeze(on)`, the editor calls it).

## Events
Payload objects marked * are reused: copy what you keep. `src/types.js` holds JSDoc typedefs for these payloads and the engine `System` shape (editor hints only, keep in sync).
| event | payload | listeners |
|---|---|---|
| `weapon:shot` | *{ from, to, dir, right, heavy, gun, flash, mag } | fx (tracer, flash, casing), audio |
| `weapon:hit` | *{ point, normal, dir, zone, amount, crit, weak, killed, distance } | fx, hud hitmarker, juice, audio |
| `weapon:impact` | *{ point, normal } | fx |
| `weapon:reload` | 'start' \| 'done' \| 'good' \| 'perfect' \| 'jam' | audio, juice |
| `weapon:switch` / `weapon:dry` | gun id / – | audio |
| `weapon:discovered` | { gun } (first time a gun is owned in this level: `weapon.grant`) | hud toast `<NAME> ACQUIRED` |
| `weapon:armored` | enemy | – (no listener: the HUD shows no hint) |
| `boss:wake` / `boss:down` | boss | hud toast (both), audio (wake) |
| `blast` / `boss:leg` / `boss:dead` | *{ point, radius, kind } (blast kind: mortar, stomp, drone) | fx, juice, audio |
| `boss:step` | *{ point, big } | juice, audio |
| `boss:charge` / `boss:stomp` / `boss:mortar` | boss / boss / position | audio |
| `player:hurt` | *{ amount, dir } | hud (direction), juice, audio |
| `player:coverSlam` / `player:land` | – / 'vault' \| 'jet' | juice, audio (land) |
| `player:jet` | *{ point, dir } (nozzle, exhaust direction) | fx, audio, juice |
| `player:vault` | 'hop' \| 'slide' | Gym traversal tool |
| `player:coverRun` | *{ to, type, collider } (cover-to-cover run starts; ends with `player:coverSlam`) | – |
| `player:coverCorner` | *{ kind } ('outside' wrap / 'inside' turn; a corner move starts) | no listener yet (tests only) |
| `player:vaultRefused` | *{ collider, blocker } (landing spot blocked; a jet burst fires instead) | Gym traversal tool |
| `player:step` | *{ run, raised } (each heel strike; not in the air) | audio |
| `enemy:step` | position (trooper / moving puppet heel strike) | audio (fades out by 28 m from the camera) |
| `prop:retract` | { pos } (a `prop.arm` with `retractOn` starts folding up; Encounter, from `World.react`) | audio (positional, fades out by 20 m) |
| `puppet:down` | actor (any enemy type; emitted by `ctx.reportKill`, which also counts the kill and fires `arena:clear` on the last one) | pickups (drop), audio, mission (destroy) |
| `arena:clear` | – (emitted by `Enemies.#reportKill` when the kill count reaches `all.length`) | hud toast |
| `trigger:fired` | { id, event } (a `trigger.volume` was entered) | mission (reach with `trigger`) |
| `checkpoint:reached` | { id, pos, yaw } | hud toast, mission (reach with `trigger`) |
| `group:wake` / `group:spawn` | { group } / { group, count } | – / mission (destroy without `count`) |
| `encounter:wake` / `encounter:spawn` | group name (requests, listened by `Encounter`) | emitted by the mission (objective `wakeGroup` / `spawnGroup`) |
| `mission:objective` / `mission:objective:done` | { index, total, id, kind, text } (fresh object) | hud toast (done) |
| `gate:open` | { on } (a `kit.gate` waiting for that `on` key started opening; Encounter, via `world.react`) | – (no listener yet) |
| `log:say` | { text, priority } (a `log.line` piece fired, after its delay; Encounter) | log (`Log.say`) |
| `intro:start` | { lines, duration, skippable, pov } (a played level's `intro.boot`, first play frame; Encounter) | boot (`Boot.start`) |
| `intro:done` | { skipped } (the boot intro ended or was skipped; Boot) | encounter (`log.line` `on: intro:done`) |
| `cinematic:start` | { shots, wake, skippable } (a played level's `intro.cinematic`, first play frame; Encounter) | cinematic (`Cinematic.start`) |
| `cinematic:wake` | – (STEM-00's power surge at `wake.at`; emitted at the end instead if the cinematic is skipped before it; Cinematic) | encounter (`on: cinematic:wake`: a `prop.cradle` `releaseOn`, log lines, gates, alarms) |
| `cinematic:done` | { skipped } (the intro cinematic ended; Cinematic) | encounter (`on: cinematic:done`: an `intro.boot` `after`, log lines, gates, alarms) |
| `ui:type` | { end } (typed text advanced this frame: boot intro, STEM-00 log; `end` = a line just finished; one per frame) | audio (terminal tick, throttled 25 ms) |
| `ui:sfx` | { kind } (`move` / `select` / `back` / `open` / `deny` / `slider` / `start` / `warn`; any non-shell code wanting a menu sound) | audio (`Audio.ui(kind)`: the `ui-<kind>` sample if present, else synth; own UI bus, ignores pause / slow-mo; no-op before `init()`; `move` ≥ 40 ms apart, `slider` ≥ 30 ms) |
| `mission:complete` / `mission:failed` | { total } / { index, id, reason } | hud toast, run stats (freeze), summary (mission complete screen) |
| `bolt:fired` / `bolt:impact` | position / *{ point, normal } | audio / fx |
| `pickup:collected` / `pickup:full` | label ('LIGHT AMMO +n AR ...') / – (all guns of the class full) | hud toast, audio |
| `weapon:charge` | true (railgun charge started) / false (cancelled) | audio (the HUD ring reads `weapon.charging`) |
| `trooper:flank` | trooper | – (tests; no HUD message) |
| `engine:resize` | { width, height, pixelRatio } | post |
| `engine:systemFailed` | { name, error } | hud toast |
| `engine:contextLost` / `engine:contextRestored` | – / – (WebGL context lost / restored; the engine stops rendering while lost) | no listener yet |

## Adding things
- New system: a class with `update(dt, ...)`, registered in `game.js` with a name and phase.
- New feedback for something that already happens: subscribe to the event, don't touch gameplay code.
- New input: add a binding in `BINDINGS`, expose an intent on `Controls`.

## Rules
- World geometry is axis-aligned boxes only (`world.box`). Collision, cover normals and ground checks rely on it.
- Colors > 1.0 on emissive/basic materials are intentional: they feed bloom (threshold 0.92).
- Never add/remove lights from the scene (shader recompiles). Level point lights are records shown by a fixed pool in `World` (engine.md "Light pool"); toggle intensity instead (see muzzle flash).
- Tuning constants live in a `TUNING` object at the top of each module.
- Units: meters, seconds, radians. +Z south, -Z north (building), +Y up. Characters face +Z in local space.
