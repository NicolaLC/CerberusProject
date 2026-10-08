# Architecture

Two layers. `src/engine/` is game-agnostic and must never import from `src/game/`.
`src/game/` builds the shooter on top of it. `src/main.js` only boots `Game`.

```
src/
  main.js                 boot (?debug → window.game)
  engine/                 runtime, see instructions/engine.md
    engine.js             renderer, scene, camera, phased scheduler, fault isolation, loop
    events.js             pub/sub bus
    input.js              raw devices (keys, 'Mouse0..2', motion, wheel, pointer lock)
    actions.js            named actions -> device codes
    perf.js               frame timing, dynamic resolution, stats panel (F3)
    pool.js               object pools
    math.js               damp, lerpAngle, wrapAngle, segSegDist (allocation-free)
    storage.js            safe localStorage JSON
  game/
    game.js               COMPOSITION ROOT: builds systems, wires events, declares frame order, start/pause shell
    controls.js           BINDINGS table + intents (move, look, aiming, running, firing, slots...)
    settings.js           player settings + start-panel bindings
    world/  world.js (level boxes, colliders, cover, sky, lights), textures.js, pickups.js
    actors/ rig.js (skeleton, animator, IK), soldier.js (player model), player.js, enemies.js (puppets, bolts)
    combat/ guns.js (gun table), weapon.js (controller, hitscan)
    view/   camera.js, fx.js, hud.js, audio.js, juice.js, post.js   (presentation only)
```

## Dependency rules
- Gameplay (`world`, `actors`, `combat`) never calls presentation (`view`). It emits events; view modules
  subscribe in their `listen(events)` method. Exception: the camera rig is gameplay state (aim ray, recoil).
- Systems get their direct dependencies through the constructor. Only `game.js` sees everything.
- Gameplay reads input only through `Controls` (no key codes outside `controls.js`).
- Cross-system reactions (puppet dies → pickup drop) are wired in `game.js` with `events.on`.

## Frame order (declared in `game.js`)
| phase | systems | dt |
|---|---|---|
| pre | controls (+ hitstop time scale, aim assist, look, shoulder, debug keys), stats toggle | real |
| simulate (substeps ≤ 20 ms) | player → weapon → enemies → pickups | scaled |
| late | camera | scaled (shake uses real) |
| present | fx → world (lights, sun, player visibility) → hud | scaled |
| render | post (exposure, grade, bloom) | real |

Paused (start panel): only `whilePaused` systems run (controls, stats, camera, post).

## Events
Payload objects marked * are reused: copy what you keep.
| event | payload | listeners |
|---|---|---|
| `weapon:shot` | *{ from, to, dir, right, heavy } | fx (tracer, flash, casing), audio |
| `weapon:hit` | *{ point, normal, dir, zone, amount, crit, weak, killed } | fx, hud hitmarker, juice, audio |
| `weapon:impact` | *{ point, normal } | fx |
| `weapon:reload` | 'start' \| 'done' \| 'good' \| 'perfect' \| 'jam' | audio, juice |
| `weapon:switch` / `weapon:dry` | gun id / – | audio |
| `player:hurt` | *{ amount, dir } | hud (direction), juice, audio |
| `player:coverSlam` / `player:land` | – | juice |
| `puppet:down` | puppet | pickups (drop), audio |
| `bolt:fired` / `bolt:impact` | position / *{ point, normal } | audio / fx |
| `pickup:collected` / `pickup:full` | label / – | hud toast, audio |
| `engine:resize` | { width, height, pixelRatio } | post |
| `engine:systemFailed` | { name, error } | hud toast |

## Adding things
- New system: a class with `update(dt, ...)`, registered in `game.js` with a name and phase.
- New feedback for something that already happens: subscribe to the event, don't touch gameplay code.
- New input: add a binding in `BINDINGS`, expose an intent on `Controls`.

## Rules
- World geometry is axis-aligned boxes only (`world.box`). Collision, cover normals and ground checks rely on it.
- Colors > 1.0 on emissive/basic materials are intentional: they feed bloom (threshold 0.92).
- Never add/remove lights at runtime (shader recompiles). Toggle intensity instead (see muzzle flash).
- Tuning constants live in a `TUNING` object at the top of each module.
- Units: meters, seconds, radians. +Z south, -Z north (building), +Y up. Characters face +Z in local space.
