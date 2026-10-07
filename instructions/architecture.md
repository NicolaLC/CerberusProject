# Architecture

`src/`
- `main.js` — renderer, frame loop, exposure adaptation, debug hooks
- `input.js` — keys/mouse, pointer lock; `wasPressed` is edge-triggered and cleared in `endFrame()`
- `world.js` — level boxes, colliders, cover meshes, sky, sun, interior lights/zones
- `textures.js` — procedural grid textures + world-space UVs
- `camera.js` — over-the-shoulder rig (`yaw`, `pitch`, `shoulder`, collision)
- `player.js` — movement, collision, cover state machine, health, drives the rig animator
- `rig.js` — humanoid skeleton, dummy parts, procedural animator, two-bone IK
- `weapon.js` — hitscan rifle (camera ray, validated from muzzle)
- `enemies.js` — puppets (static / mover / shooter) and enemy bolts
- `fx.js` — tracers, sparks, decals, muzzle flash, damage numbers
- `hud.js` — DOM HUD (markup in `index.html`, styles in `src/style.css`)
- `audio.js` — synthesized SFX
- `post.js` — post stack: MSAA HDR render → bloom → grade (vignette, chromatic aberration, grain, damage/kill flashes) → output
- `juice.js` — game-feel hub: gameplay reports events (`kill`, `hurt`, `coverSlam`, `land`), it drives hitstop, camera trauma, FOV punch and post flashes

## Frame order
juice (time scale) → look → player → camera → weapon → enemies → fx → world (lights, sun) → hud → exposure → post render → `input.endFrame()`

Game systems get `dt = realDt * juice.timeScale` (hitstop); camera shake time and post use real dt.

## Rules
- World geometry is axis-aligned boxes only (`world.box`). Collision, cover normals and ground checks rely on it.
- Colors > 1.0 on emissive/basic materials are intentional: they feed bloom (threshold 0.92).
- Never add/remove lights at runtime (shader recompiles). Toggle intensity instead (see muzzle flash).
- Tuning constants live in a `TUNING` object at the top of each module.
- Units: meters, seconds, radians. +Z south, -Z north (building), +Y up. Characters face +Z in local space.
