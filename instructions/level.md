# Level & lighting

## Level file (`src/levels/*.json`, listed in `scenes.js`)
Plain JSON (an editor can write it), imported by `scenes.js`, validated by `Registry.check`. Layout, enemies and
pickups are data; sky, sun, fog and materials stay in code (`world.js`).
```
{ name, title, tool?, demo?, spawn: { pos, yaw }, interiorZones: [{ min, max }],
  pieces: [ { id, pos: [x, y, z], yaw?, params?, name? }, ... ] }
```
- `pieces` is one ordered list; each system builds the ones it owns, in file order. Order matters: boxes are merged
  per material in file order (draw calls, `render.browser.mjs`), enemies fill stands in order.
- `title`: shown in the HUD zone label (outdoors; indoors it reads INTERIOR) and in the panel's scene picker.
- `demo: true` (Library): enemies are exhibits: they idle and take hits but never wake, aim, fire or flank
  (`Enemies` hands them a view of the player that reads `dead`).
- `tool`: a Gym room helper from `src/game/gym/tools.js` (`traversal` / `range` / `ai` / `stress` / `library`): readouts, overlays, keys.
  Created after the level loads, disposed before it unloads, `update(dt)` each unpaused frame (system `gymTool`).
- `spawn.yaw` is the player's initial facing (3.14159 = north, -Z). The boss arena bounds are data of `boss.spider`.
- Add a piece: append `{ "id": ..., "pos": [...], "params": {...} }`. Add a new kind: put a builder in the owning
  module's table (`WORLD_PIECES` / `ENEMY_PIECES` / `PICKUP_PIECES`) and document the id here. Never rename an id.
- `name` lets a later piece refer to an earlier one (`light.point` `flicker.strip`).

### Piece ids (public contract)
| id | owner | params |
|---|---|---|
| `env.box` | world | `size [w,h,d]`, `mat` (key of `World.mats`), `faces?` `{px,nx,py,ny,pz,nz: mat}`, `cover?` `'low'\|'high'\|'wall'`, `collide?` `shadow?` (default true). `pos` = center x, bottom y, center z. Axis-aligned: no rotation |
| `env.strip` | world | `size`, `mat`, `ownMaterial?` (clone the material; needed to flicker one strip alone). Emissive, no collision, no shadow |
| `env.label` | world | `text` (`\n` for lines), `size?` letter height (0.6), `yaw?` (0 = readable from +Z), `flat?` (on the floor), `color?`, `bg?`. Unlit sign, no collision; own canvas texture, freed on unload |
| `prop.gun` | world | `gun` (key of `GUNS`). The gun's own display model (its `build`, merged to one mesh per material), stock at `pos`, barrel along +Z turned by `yaw`. No collision; freed on unload |
| `light.point` | world | `color '#rrggbb'`, `intensity`, `distance`, `flicker?: { strip: name }` (flickers the light, and the named earlier strip) |
| `kit.floor` | world | `size [w,d]` (4 x 4), `thickness` (0.2), `flush?` (top at `pos.y`, hangs below), `mat` |
| `kit.wall` | world | `length` (4), `height` (7, min 2.0), `thickness` (0.5), `mat`. Cover `wall` |
| `kit.doorway` | world | wall segment with a lintel: opening `width` (4, clamped up to 2.0) and `height` (4, clamped up to 1.8), `length` (width + 6; each wall end >= 0.9), `wallHeight` (7), `thickness`, `mat`. Opening centered on `pos` |
| `kit.stairs` | world | `width` (4), `height` (target top, 1.6), `rise` (0.4; above 0.45 throws), `run` (1.0, min 0.6), `mat`. Climbs toward -Z at yaw 0; `pos` = footprint center. Real rise = height / ceil(height / rise) |
| `kit.ramp` | world | stairs with a fine rise (the code has no slopes: `groundAt` reads box tops): `width`, `height` (1.6), `length` (8, horizontal), `rise` (0.1, max 0.25), `mat` |
| `kit.cover.low` | world | 1.1 high, 1.0 thick; `length` (3, min 1.6, below throws), `mat` (`low`) |
| `kit.cover.high` | world | 2.8 high, 0.6 thick; `length` (2.4, min 1.2, below throws), `mat` (`high`) |
| `kit.pillar` | world | 1.2 x 1.2 x 2.8 high cover; `mat` (`high`) |
| `kit.platform` | world | solid deck, `size [w,d]` (8 x 8), `height` (1.6), `stairs?` `'n'\|'s'\|'e'\|'w'` (attached outside that side, `stairsWidth` 4), `parapets?` `true` or a list of sides (low 1.1 x 0.6, open at the stairs), `mat`, `coverMat` (parapets) |
| `enemy.static` / `enemy.mover` / `enemy.shooter` | enemies | puppets on a stand. `yaw?`; mover: `to [x,y,z]`, `speed` |
| `enemy.trooper` | enemies | cover-using soldier. `yaw?` |
| `enemy.drone` | enemies | `pos` = the ground under it |
| `boss.spider` | enemies | `yaw?`, `arena: { minX, maxX, minZ, maxZ }` (the boss stays inside; wakes when the player enters) |
| `pickup.light` / `pickup.heavy` | pickups | respawning ammo crate of that class |

**Kit rules** (`world/kit.js`, sizes from `metrics.md`, frozen): boxes only, built through `world.box`. `yaw` must be a
multiple of 90 degrees (else a clear error), so every piece stays axis-aligned. Bad params throw `kit.x: ...`. One material
key per role (floor / wall / low / high / platform), overridable per piece with `params.mat` (a key of `World.mats`):
the hook for region skins.

### Piece meta (Library convention)
A registry table entry may be `{ build, ...meta }` (read with `registry.meta(id)`). Two metas feed the Library:
- `example: { params, yaw? }`: what the Library spawns for the id (it must build with just these and `pos`).
- `label`: one short line of key stats (HP, ranges, respawn...), read from the owner's `TUNING` where there is one.
Every entry has both (enemies, pickups, `kit.*`, `env.*`, `light.point`, `prop.gun`); new entries must too. A new id with an `example` shows up in the Library's kit aisle by itself
(`tool: library`, gym.md); `tests/library.browser.mjs` spawns every id from its example.

Interior zones (camera exposure) are `interiorZones` boxes, not pieces. Dropped clips are runtime, not data.

## Save and load (`src/game/workshop/io.js`, #72)
The editor (#70) calls four functions plus `levelNames()`; the level is the plain object of the format above.
- `serializeLevel(level)` -> text. Top-level keys one per line in this order: `name`, `title`, `tool`, `demo`, `spawn`,
  `interiorZones`, any other keys (as given), then `pieces`. Each piece is one line of compact JSON (no spaces) with keys
  `id`, `name`, `pos`, `yaw`, `params` (unknown keys after). Numbers are rounded to 4 decimals (no float noise, `-0` -> `0`),
  NaN / Infinity throw. Ends with a newline. Same level in, same bytes out (idempotent), so a git diff shows only real edits.
  Nested values (`spawn`, `rooms`, `params`) stay compact on their line, as in the `gym-*` files. Existing level files are
  not rewritten: they re-serialize to this shape the first time the editor saves them.
- `parseLevel(text, registry)`: `JSON.parse` + `registry.check`. Errors name the problem: `level file is not valid JSON (line N)`,
  `piece #i has unknown id "x"`, `needs pos`, `"pieces" must be an array`.
- `saveLevel(level)` -> `{ where: 'repo' | 'dialog' | 'download', path? }`. `level.name` must match `[a-z0-9-]+` (it is the file name).
  Desktop: writes `src/levels/<name>.json` (`repo`); a packaged app has no repo folder and shows a save dialog (`dialog`).
  Web: downloads `<name>.json` (`download`). Cancelling a dialog rejects with an `AbortError`.
- `openLevel(registry)`: file picker (web) or open dialog (desktop) -> parsed, checked level; rejects with a readable error
  (`AbortError` on cancel).
- `levelNames()`: names of the bundled scenes (`scenes.js`), arena included. To edit one, take `SCENES[name]` (deep-copy it first).
- Saving to `src/levels` does not list the level: a new scene still needs its import in `scenes.js` (Scenes, below).
- Test: `tests/levelio.test.mjs` (`npm test`) round-trips every `src/levels/*.json` with the real `Registry` and piece tables.

## Scenes (`src/game/scenes.js`)
| name | file | content |
|---|---|---|
| `arena` | `arena.json` | the training arena, default; no `?scene` = this |
| `gym` | `gym.json` | Gym: traversal and cover room (#64) |
| `gym-range` | `gym-range.json` | Gym: weapon range room (#65) |
| `gym-ai` | `gym-ai.json` | Gym: enemy behaviour rooms (#66) |
| `gym-stress` | `gym-stress.json` | Gym: performance stress room (#67) |
| `library` | `library.json` | the Library (#68), `demo` + `tool: library`: aisles of enemies, guns, cover / environment, pickups, light presets and the kit aisle (gym.md, Library) |
| `workshop` | `workshop.json` | placeholder: floor and three cover boxes (Workshop epic #60) |

- Players pick a scene in the start / pause panel (Scene list; it also sets `?scene=` so a reload stays there).
- `?scene=<name>` (works with `?debug`) opens one; unknown → arena + `console.warn`. At runtime: `game.loadScene('gym')`
  (`window.game` exists with `?debug`). Switching frees the old level completely (architecture.md, Scenes).
- Add a scene: write `src/levels/<name>.json` (title, spawn, `interiorZones` (may be `[]`), pieces), import it and list it in
  `SCENES` in `scenes.js`. Nothing else: `scenes.browser.mjs` loads every listed scene via `?scene=` (add it to its `SCENES` list too
  if you want it in the switching cycles).

## Layout (the arena file; was `world.js #buildLevel`)
- Yard: x -50..50, z -62..50, perimeter walls 6m. Player spawn (0, 0, 38) facing north (-Z).
- Cover lines at z=25 (low), z=12 (high walls), z=0 / z=-14 (low), pillars at z=-20.
- West platform 1.6m with stairs and low parapets. East shooting range behind a firing bench (z=32).
- Building x -24..24, z -62..-30, walls 7m, doors at x=-12 and x=16, partition at x=8 with a door at z=-40.
  Main hall has a roof skylight (x -10..-2, z -50..-42). East room is the red, flickering one.
- North-east boss arena x 24.3..50, z -62..-14 (spider mech): fenced from the range by a 3.2 m wall at z=-14 with a
  gate at x 37..42.5 (lit lintel strip), open to the west lane along the building. Six freestanding 3.2 m concrete
  walls and three low blocks as cover, ammo crates at the gate (28, -17) and at the back (47, -60).
- Walls flagged `{ cover: 'wall' }`: building outer walls and partition, range separator, arena walls.

## Materials
- Prototype grid textures from `gridTexture()`: 1 tile = 2m, 1m checker, 25cm lines, optional label.
- Colors: orange = low cover, blue = high cover, light gray = walls, gray = floor; interior variants are dark.
- UVs are world-space (`applyWorldUVs`) so grids align everywhere; per-face materials via `faces()`.

## Lighting
- Sun: directional, shadow map 4096 over ±48m, follows the player (snapped to 2m). Direction `SUN_DIR`.
- Hemisphere fill, gradient sky dome shader, light fog. ACES tone mapping.
- Interior: darker albedo than outside (but readable), 8 point lights incl. fills; cyan/white/red, emissive strips, flicker via `pointLight(..., { strip })`.
- Exposure adaptation in `game/view/post.js`: 1.0 outside, 1.9 when the camera is inside an `interiorZones` box.
