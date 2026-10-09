# Architecture

Two layers. `src/engine/` is game-agnostic and must never import from `src/game/`.
`src/game/` builds the shooter on top of it. `src/main.js` only boots `Game`.

```
src/
  main.js                 boot (?debug → window.game)
  engine/                 runtime, see instructions/engine.md
    engine.js             renderer, scene, camera, phased scheduler, fault isolation, loop
    events.js             pub/sub bus
    input.js              raw devices (keys, 'Mouse0..2', motion, wheel, pointer lock, gamepad 'Pad0..16' + sticks, rumble)
    actions.js            named actions -> device codes
    perf.js               frame timing, dynamic resolution, stats panel (F3)
    pool.js               object pools
    batch.js              draw-call batching: static merge, rigid skinning, group merge
    math.js               damp, lerpAngle, wrapAngle, segSegDist (allocation-free)
    storage.js            safe localStorage JSON
    random.js             seedable RNG streams
  game/
    game.js               COMPOSITION ROOT: builds systems, wires events, declares frame order, start/pause shell
    controls.js           BINDINGS table + intents (move, look, aiming, running, firing, slots...)
    settings.js           player settings + start-panel bindings
    world/  world.js (level boxes, colliders, cover, sky, lights), textures.js, pickups.js
    actors/ rig.js (skeleton, animator, IK), soldier.js (player model), player.js,
            enemy.js (shared enemy body: hit zones, weak spots, flash, debris death),
            puppet.js (training puppets), trooper.js (cover-using soldiers),
            enemies.js (system: spawn list, bolts, stands, target cache, squad alerts)
    ai/     cover.js (cover spots from cover boxes, protection test, spot choice + detour route)
    combat/ guns.js (gun table), weapon.js (controller, hitscan, aim probe), ballistics.js (pure shot math)
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
- Never add/remove lights at runtime (shader recompiles). Toggle intensity instead (see muzzle flash).
- Tuning constants live in a `TUNING` object at the top of each module.
- Units: meters, seconds, radians. +Z south, -Z north (building), +Y up. Characters face +Z in local space.
