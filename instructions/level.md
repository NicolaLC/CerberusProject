# Level & lighting

## Layout (`world.js #buildLevel`)
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
