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
- `engine.stop()` + `engine.step(dt)` run exact frames without the browser loop (deterministic tests).
- `random.js`: seedable `Rng` streams; give each gameplay system its own.
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

## Draw calls (`batch.js`)
WebGL frames are CPU-bound on draw calls (one per mesh per material per pass, and the sun shadow pass
repeats every caster). Budget: ≤ 140 calls per frame at the spawn view, ≤ 25 of them in the shadow pass
(`tests/render.browser.mjs`; history: ~1200 → 240 batching → 187 shadows → ~108 puppet LOD).
- Pattern: originals stay in the scene as invisible PROXIES (raycasts, hit zones, colliders, userData keep
  working: three's Raycaster ignores `visible`); merged meshes render and have raycast disabled.
- `mergeStatic(meshes, parent)`: the level (World.staticMeshes) → one mesh per material + shadow flags.
  Changing a level material (e.g. flickering strip) still works: the merged mesh shares the material object.
- `RigidSkin(root, skeleton, { exclude })`: every mesh on a rig's bones → one SkinnedMesh per material,
  vertices fully weighted to their bone. Bound at the current pose. Adding/removing parts later needs
  `skin.rebuild()` (puppet weak spots do this on respawn). Culling uses one padded sphere per rig.
- `mergeGroup(group)`: rigid sub-models (guns) → one mesh per material inside the group.
- Instancing for many copies of one thing: puppet stands, sparks (per-instance HDR color), casings, decals.
- New per-object visuals: prefer adding to an existing batch/instanced mesh over new Mesh objects.

## Distance LOD (`RigidSkin` with `lod: true`, switched by the `lod` system in `game.js`)
- Far detail = ONE SkinnedMesh for the whole rig: every opaque part merged, its material's color baked as a
  vertex color and its glow as a `lodEmissive` vertex attribute (shader patch on one shared program).
  Transparent parts (halos) are dropped; textured materials give `userData.lodColor`, glows can be boosted
  with `userData.lodGlow` (puppet weak spots: 5, to stay readable without the halo).
- Each rig has its own LOD material instance, so per-rig effects still work (hit flash sets its `emissive`).
- Puppets switch to far detail beyond 32 m from the camera (back under 28 m). Hitboxes never change:
  far puppets are hit exactly like near ones (tested).

## Shadows
- Every batch (level, each rig) builds ONE shadow-only mesh: all opaque casters merged, depth only. Color
  meshes don't cast. Transparent parts (halos) never cast.
- Shadow-only meshes stay `visible = false`; `installShadowOnly(renderer)` (done by Engine) shows them only
  while shadow maps render, so the color pass never lists them. Layers can't do this: three's shadow pass
  tests object layers against the main camera.
- Shadow LOD (`game.js`, `LOD.shadow`): puppets farther than 34 m from the camera stop casting (back on
  under 30 m). `RigidSkin.setCastShadow(on)` toggles a rig's shadow draw.
- The sun's shadow frustum (±48 m, 4096²) follows the player in 2 m snaps (`world.updateSun`).

## Input
- `Input` stores raw codes: `KeyW`, `ShiftLeft`, `Mouse0` (left), `Mouse2` (right), wheel deltas and notches.
- `Actions` maps names to codes; the game's table is `BINDINGS` in `game/controls.js`.
