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

## Frame order
look → player → camera → weapon → enemies → fx → world (lights, sun) → hud → exposure → render → `input.endFrame()`

## Rules
- World geometry is axis-aligned boxes only (`world.box`). Collision, cover normals and ground checks rely on it.
- Never add/remove lights at runtime (shader recompiles). Toggle intensity instead (see muzzle flash).
- Tuning constants live in a `TUNING` object at the top of each module.
- Units: meters, seconds, radians. +Z south, -Z north (building), +Y up. Characters face +Z in local space.
