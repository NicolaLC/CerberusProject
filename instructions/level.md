# Level & lighting

## Layout (`world.js #buildLevel`)
- Yard: x -50..50, z -62..50, perimeter walls 6m. Player spawn (0, 0, 38) facing north (-Z).
- Cover lines at z=25 (low), z=12 (high walls), z=0 / z=-14 (low), pillars at z=-20.
- West platform 1.6m with stairs and low parapets. East shooting range behind a firing bench (z=32).
- Building x -24..24, z -62..-30, walls 7m, doors at x=-12 and x=16, partition at x=8 with a door at z=-40.
  Main hall has a roof skylight (x -10..-2, z -50..-42). East room is the red, flickering one.

## Materials
- Prototype grid textures from `gridTexture()`: 1 tile = 2m, 1m checker, 25cm lines, optional label.
- Colors: orange = low cover, blue = high cover, light gray = walls, gray = floor; interior variants are dark.
- UVs are world-space (`applyWorldUVs`) so grids align everywhere; per-face materials via `faces()`.

## Lighting
- Sun: directional, shadow map 4096 over ±48m, follows the player (snapped to 2m). Direction `SUN_DIR`.
- Hemisphere fill, gradient sky dome shader, light fog. ACES tone mapping.
- Interior: dark albedo, cyan/white/red point lights, emissive strips, flicker via `pointLight(..., { strip })`.
- Exposure adaptation in `main.js`: 1.0 outside, 1.7 when the camera is inside an `interiorZones` box.
