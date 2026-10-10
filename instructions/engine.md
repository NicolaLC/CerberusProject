# Engine (`src/engine/`)

Goal: hold 60 fps, never freeze on a bug, scale to a much bigger game.

## Loop and scheduler (`engine.js`)
- Systems: `{ name, phase, update(dt, engine), whilePaused }` added with `engine.add()`. Phases run in order
  `pre → simulate → late → present → render`.
- Frame dt is clamped to 0.1 s. `simulate` is split into equal substeps of ≤ 20 ms (max 4, then the game
  slows down instead of spiralling). Scaled by `engine.timeScale` (hitstop, owned by Juice).
- Edge presses (`input.wasPressed`) are only visible in the first substep: a press is consumed once.
- `engine.headless`: simulate without drawing (tests); `scene.updateMatrixWorld()` replaces the render phase.
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
  < 0.8× budget for 4 s → +0.1 (up to `perf.maxScale`). Emits `engine:resize`; post follows.
- Graphics presets (`game/view/quality.js`, setting `quality`, panel "Graphics", applied live):
  | preset | max pixel ratio | MSAA | bloom | sun shadow map | anisotropy |
  |---|---|---|---|---|---|
  | low | min(dpr, 1) | off | off | 2048 | 4 |
  | high (default) | min(dpr, 2) | 4× | on | 4096 | 8 |
  | ultra | min(dpr × 1.5, 2) (supersamples at 1x) | 8× (capped by GPU) | on | 4096 | 16 (capped) |
  Dynamic resolution keeps running under every preset; the preset only caps how high it climbs.
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

## Per-encounter budget
Measured in `?scene=gym-stress` (`tests/gym-stress.browser.mjs`, instructions/gym.md). Draw calls and triangles are hardware independent
(the numbers below are asserted linear in the test); frame times in SwiftShader are not GPU times and are not used.
Costs are WORST CASE per unit: in view, near LOD, sun shadow pass included (draws and triangles are counted over the whole frame).

| unit | draws (near) | tris (near) | geometries | draws / tris far (> 32 m) | when destroyed |
|---|---|---|---|---|---|
| puppet (`enemy.static`) | 7 | 15.3k | 8 | 1 / 7.5k | + 22 draws for 5 s (debris, was 75 before #75), then the stand sinks |
| trooper (`enemy.trooper`) | 9 | 47.4k | 10 | 1 / 23.7k | + 23 draws for 5 s (was 119) |
| drone (`enemy.drone`) | 4 | 9.2k | 5 | 1 / 9.2k (shadow stays) | + 2 (falls in one piece) |
| point light (`light.point`) | 0 | 0 | 0 | | cost is per lit fragment, not per draw; adding / removing one recompiles shaders |
| effect burst (`blast`: sparks, smoke, ring) | 3 | 0.4k | 0 | | sparks capped at 256 (16 bursts); lives 0.3-0.6 s |

Triangles are doubled by the shadow pass (a trooper is ~23.7k triangles drawn twice). The empty room (floor, 16 cover boxes, the
player, post) is 45 draws / 66k tris. Debris was the surprise (#75): every chunk was one shadow-casting mesh per material, so a destroyed trooper cost
119 draws. Chunks are now baked to one vertex-coloured mesh each and cast no shadow: ~22 draws per destroyed body for 5 s,
still 2-3 times a live one, so mass kills cost something but no longer spike.

**Current budget.** `tests/render.browser.mjs`: <= 140 draws at the arena spawn view (128 today), <= 25 in the shadow pass (14 today).
Quality tiers (`quality.js`) do not change geometry draws, only pixels: low 84 draws, high and ultra 97 at the same view (bloom adds ~13
post draws; MSAA, shadow map size 2048 / 4096 and resolution scale are fill-rate costs).

**Proposed caps** per encounter (enemies alive at once, near; far ones count 1 draw each, so up to 3x as many beyond 32 m).
Assumptions, stated plainly:
- the frame is CPU / draw-call bound: total draws <= 180 (low), 240 (high), 300 (ultra); ~60 are the level, player and post, the rest
  is the encounter (120 / 180 / 240);
- triangles <= 0.8M / 1.5M / 2.5M per frame incl. shadows (guesses for integrated / mid / high-end GPUs, not measured on hardware; the
  caps below stay well under them, draws are what binds);
- the encounter's draws are split 40% troopers, 20% puppets, 25% drones, 15% effects; a different mix is fine while
  `9 T + 7 P + 4 D + 3 B + debris <= encounter draws` (T troopers, P puppets, D drones, B bursts alive);
- lights have no draw cost, so their cap is a fragment-cost guess (each forward point light loops in every lit material) and must be checked on hardware.

| tier | troopers | puppets | drones | point lights (level + dynamic) | effect bursts alive | destroyed puppets / troopers with live debris |
|---|---|---|---|---|---|---|
| low | 5 | 3 | 7 | 4 | 6 | 5 |
| high | 8 | 5 | 11 | 8 | 9 | 10 |
| ultra | 10 | 6 | 15 | 12 | 12 | 15 |

If kills must get denser still: merge a whole body's chunks into one moving batch, or shorten `DEBRIS_LIFE`.
**Rule: never add or remove lights during play.** three.js recompiles every lit material when the light count changes (a
hitch). Lights belong to the level (built on load); a dynamic light stays in the scene and is switched with its intensity,
like the muzzle flash light in `fx.js`. The light cap counts the level's lights.

**Frame-time budgets must be confirmed by running `?scene=gym-stress` on the target hardware** (press P: the sweep prints avg / p95 ms,
draws and triangles for 0-64 of each kind); the caps above are draw and triangle derived, not GPU measured.

## Input
- `Input` stores raw codes: `KeyW`, `ShiftLeft`, `Mouse0` (left), `Mouse2` (right), wheel deltas and notches.
- `Actions` maps names to codes; the game's table is `BINDINGS` in `game/controls.js`.

## Renderer: WebGL 2 (WebGPU evaluated 2026-10, not shipped)
A full port to three.js `WebGPURenderer` (auto WebGPU, WebGL 2 fallback) is in history: commit `222ce04`
(TSL post stack and sky, node LOD material, shadow-only meshes via `renderer.setRenderObjectFunction`, engine
driven by `renderer.setAnimationLoop` with `nodeFrame.update()` in `step()`). All suites passed on both
backends, visuals matched. Measured with `tests/bench.browser.mjs` (JS ms per frame, light view):
classic WebGLRenderer 4.0, WebGPU 5.8-6.2, WebGPURenderer's WebGL 2 fallback 6.9. No gain for this
content (≈125 draws, no compute), and the fallback (Linux Electron, older browsers) is slower than today.
Revive it when GPU compute pays: GPU particles / debris, many dynamic lights, GPU-driven culling.
Gotchas found: three's WebGPU build must be the only three instance (alias `three` → `three/webgpu`);
`<canvas id="game">` makes `window.game` truthy before the game exists (tests wait for `window.game?.engine`);
headless WebGPU needs `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
--use-webgpu-adapter=swiftshader` and a secure origin (localhost); WebGPU MSAA is 1 or 4 samples only.
