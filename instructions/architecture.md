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
    storage.js            safe localStorage JSON
    random.js             seedable RNG streams
  game/
    game.js               COMPOSITION ROOT: builds systems, wires events, declares frame order, start/pause shell
    scenes.js             scene list: name -> level file, ?scene= resolution (level.md)
    registry.js           piece registry: stable string id -> how a piece is built from data (ids: level.md)
    controls.js           BINDINGS table + intents (move, look, aiming, running, firing, slots...)
    settings.js           player settings + start-panel bindings
    world/  world.js (builds env.* / light.* pieces, colliders, cover, sky, lights), textures.js, pickups.js (pickup.* pieces)
    actors/ rig.js (skeleton, animator, IK), parts.js (model building blocks, debris), soldier.js (player model),
            looks.js (trooper / puppet models), player.js,
            enemy.js (shared enemy body: hit zones, weak spots, flash, debris death),
            puppet.js (training puppets), trooper.js (cover-using soldiers), drone.js, spider.js (miniboss),
            enemies.js (system: builds enemy.* / boss.* pieces, bolts, stands, target cache, squad alerts)
    ai/     cover.js (cover spots from cover boxes, protection test, spot choice + detour route)
    combat/ guns.js (gun table), weapon.js (controller, hitscan, aim probe), ballistics.js (pure shot math)
    view/   camera.js, fx.js, hud.js, audio.js, juice.js, post.js   (presentation only)
```

`src/levels/` holds level files (plain JSON, see `level.md`); `scenes.js` lists them, `Game.loadScene(name)` hands one to the systems.

## Dependency rules
- Gameplay (`world`, `actors`, `combat`) never calls presentation (`view`). It emits events; view modules
  subscribe in their `listen(events)` method. Exception: the camera rig is gameplay state (aim ray, recoil).
- Systems get their direct dependencies through the constructor. Only `game.js` sees everything.
- Gameplay reads input only through `Controls` (no key codes outside `controls.js`).
- Levels are data, built through the piece registry: each system module exports a table of the pieces it owns
  (`WORLD_PIECES`, `ENEMY_PIECES`, `PICKUP_PIECES`: id -> builder run against that system); `game.js` registers the
  tables in a `Registry` and gives it to the systems, which build from a level file in `load(level)`. `registry.js` imports nothing, so
  gameplay modules never reach each other through it. Piece ids are a public contract (levels, saves, tools): never rename or reuse one.
- **Every per-level system must be disposable.** A system has a permanent part (built once in the constructor:
  shared materials and textures, sky, sun, pools, pooled geometry, event listeners) and a per-level part
  (`load(level)` builds it, `unload()` removes and frees it; `load` calls `unload` first). Today: `World` (boxes +
  merged batches, colliders, cover, point lights, interior zones), `Enemies` (actors incl. debris / rigs / skins /
  materials, stands, bolts in flight, cover map, kill count), `Pickups` (crates and dropped clips), the debug
  skeleton helpers. Presentation and player state expose `reset()` (`FX` particles / decals / numbers, `Hud` boss bar
  and toast, `Juice` hitstop, `CameraRig` lock-on / shake / zoom, `Weapon` loadout, `Player.place(spawn)`).
- `disposeTree` frees what a level owns; it never touches `World.mats` (kept in `world.keep`), materials flagged
  `userData.shared`, or textures (grid textures are cached across levels). Arrays other systems hold
  (`world.colliders`, `world.meshes`...) are cleared in place. Listeners stay permanent: never `events.on` per
  level; a new per-level system that must register one has to remove it in `unload()`.
- A new per-level object that is added to the scene needs its disposal in the owner's `unload()`; the
  `scenes.browser.mjs` leak check (geometries / textures / scene objects over arena→gym→library→workshop cycles) fails otherwise.
- Cross-system reactions (puppet dies → pickup drop) are wired in `game.js` with `events.on`.

## Scenes
`game.loadScene(name)` (any time between frames, never inside a system update): validates the level file, unloads the
old level (enemies → pickups → world), loads the new one (world → enemies → pickups), puts the player at `level.spawn`
with full health, resets camera / weapon / fx / hud / juice. `?scene=<name>` picks the first scene (unknown → arena + console warning);
`window.game.loadScene` is there with `?debug`. A malformed file throws before anything is unloaded. Point lights are
the only thing three.js recompiles shaders for: switching scenes hitches once (the "never add lights at runtime"
rule is about gameplay frames).

## Frame order (declared in `game.js`)
| phase | systems | dt |
|---|---|---|
| pre | controls (+ hitstop time scale, aim assist, look, shoulder, debug keys), stats toggle | real |
| simulate (substeps ≤ 20 ms) | player → weapon → enemies → pickups | scaled |
| late | camera → aimProbe (what the crosshair is on) | scaled (shake uses real) |
| present | fx → world (lights, sun, player visibility) → hud → audio (MG spin) | scaled |
| render | post (exposure, grade, bloom) | real |

Paused (start panel): only `whilePaused` systems run (controls, stats, camera, post).

## Events
Payload objects marked * are reused: copy what you keep.
| event | payload | listeners |
|---|---|---|
| `weapon:shot` | *{ from, to, dir, right, heavy, gun, flash, mag } | fx (tracer, flash, casing), audio |
| `weapon:hit` | *{ point, normal, dir, zone, amount, crit, weak, killed, distance } | fx, hud hitmarker, juice, audio |
| `weapon:impact` | *{ point, normal } | fx |
| `weapon:reload` | 'start' \| 'done' \| 'good' \| 'perfect' \| 'jam' | audio, juice |
| `weapon:switch` / `weapon:dry` | gun id / – | audio |
| `weapon:armored` | enemy | – (no listener: the HUD shows no hint) |
| `boss:wake` / `boss:down` | boss | hud toast, audio |
| `blast` / `boss:leg` / `boss:dead` | *{ point, radius, kind } (blast kind: mortar, stomp, drone) | fx, juice, audio |
| `boss:step` | *{ point, big } | juice, audio |
| `boss:charge` / `boss:stomp` / `boss:mortar` | boss / boss / position | audio |
| `player:hurt` | *{ amount, dir } | hud (direction), juice, audio |
| `player:coverSlam` / `player:land` | – / 'vault' \| 'jet' | juice, audio (land) |
| `player:jet` | *{ point, dir } (nozzle, exhaust direction) | fx, audio, juice |
| `player:vault` | 'hop' \| 'slide' | – |
| `player:step` | *{ run, raised } (each heel strike; not in the air) | audio |
| `enemy:step` | position (trooper / moving puppet heel strike) | audio (fades out by 28 m from the camera) |
| `puppet:down` | puppet | pickups (drop), audio |
| `bolt:fired` / `bolt:impact` | position / *{ point, normal } | audio / fx |
| `pickup:collected` / `pickup:full` | label ('LIGHT AMMO +n AR ...') / – (all guns of the class full) | hud toast, audio |
| `weapon:charge` | true (railgun charge started) / false (cancelled) | audio (the HUD ring reads `weapon.charging`) |
| `trooper:flank` | trooper | – (tests; no HUD message) |
| `engine:resize` | { width, height, pixelRatio } | post |
| `engine:systemFailed` | { name, error } | hud toast |

## Adding things
- New system: a class with `update(dt, ...)`, registered in `game.js` with a name and phase.
- New feedback for something that already happens: subscribe to the event, don't touch gameplay code.
- New input: add a binding in `BINDINGS`, expose an intent on `Controls`.

## Rules
- World geometry is axis-aligned boxes only (`world.box`). Collision, cover normals and ground checks rely on it.
- Colors > 1.0 on emissive/basic materials are intentional: they feed bloom (threshold 0.92).
- Never add/remove lights during play (shader recompiles). Toggle intensity instead (see muzzle flash). Only a scene load adds/removes a level's point lights.
- Tuning constants live in a `TUNING` object at the top of each module.
- Units: meters, seconds, radians. +Z south, -Z north (building), +Y up. Characters face +Z in local space.
