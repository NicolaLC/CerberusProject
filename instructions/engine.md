# Engine (`src/engine/`)

Goal: hold 60 fps, never freeze on a bug, scale to a much bigger game.

## Loop and scheduler (`engine.js`)
- Systems: `{ name, phase, update(dt, engine), whilePaused }` added with `engine.add()`. Phases run in order
  `pre → simulate → late → present → render`.
- Frame dt is clamped to 0.1 s. `simulate` is split into equal substeps of ≤ 20 ms (max 4, then the game
  slows down instead of spiralling). Scaled by `engine.timeScale` (hitstop, owned by Juice).
- Edge presses (`input.wasPressed`) are only visible in the first substep: a press is consumed once.
- Every system call is wrapped: an exception is logged, the frame continues. 10 failures in a row disable the
  system and emit `engine:systemFailed` (the HUD shows SYSTEM FAULT). Event listeners are isolated the same way.
- WebGL context loss pauses rendering until restore. `engine.timings[name]` = smoothed ms per system.

## Performance rules
- No allocations in per-frame code: module-level scratch vectors (`_v`), reused arrays, reused event payloads.
  `new THREE.*` / `.clone()` / array literals in an update path are bugs unless rare (death, spawn, cover found).
- Spawned visuals come from `Pool`s and are hidden, not removed (fx particles, tracers, casings, bolts, damage
  numbers). Decals are a fixed ring buffer. Warm pools at load so the first fight doesn't compile shaders.
- Raycast target lists are cached (`enemies.hitMeshes()` rebuilds only when puppets die / respawn).
- DOM HUD writes go through `text()` / `css()`, which skip unchanged values.
- Dynamic resolution (`perf.js`): average frame time > 1.12× budget for 0.75 s → pixel ratio −0.1 (min 0.5);
  < 0.8× budget for 4 s → +0.1 (max devicePixelRatio, 2). Emits `engine:resize`; post follows.
- Draw calls and triangles: F3 (or `?debug`) shows fps, ms, resolution %, draws, tris and the slowest systems.
  Renderer info is accumulated over the whole frame (all post passes).

## Input
- `Input` stores raw codes: `KeyW`, `ShiftLeft`, `Mouse0` (left), `Mouse2` (right), wheel deltas and notches.
- `Actions` maps names to codes; the game's table is `BINDINGS` in `game/controls.js`.
