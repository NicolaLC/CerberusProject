# Gym

Four scenes, one per room (Gym epic #58). Each room is a level file plus a tool (`src/game/gym/<tool>.js`, level
field `tool`) for its readouts, overlays and keys, and a browser suite that uses the room as its fixture.
Measured values go into `instructions/metrics.md` (section 8); this file says what each room contains and how to use it.

## Traversal and cover (`?scene=gym`, #64)

One long bare-grid course (floor x -75..75, z 35..-335, no enemies). Spawn (0, 0, 18) facing north; the rows run north
in the order of metrics.md section 8, each approached from the south (+Z) so a 3 m run-up and 6-8 m of landing space
are clear. Every item has a flat floor label with its value (readable walking north) and every station a floating
sign (yellow). Item boxes carry a piece `name` (`cover-h:1.3`, `vault-d:1.2`, `jet-h:1.6`, `gap-p:3`, `corr-wall:2.4`,
`bay:3.4`, `lintel:2.2`, `len-high:1.8`, `lane:1.0`, `land:0.9`, `stair-rise:0.45`, `std-platform`, ...) which the
suite reads back from `game.level.pieces`: rename a piece and the suite must follow. Materials floor, wall, low, high and platform only, axis-aligned
boxes (metrics.md); cover flags follow the class (`low` under 1.7, `high` from).

| Station (zf = south face z) | What | Items |
|---|---|---|
| spawn z 18 | index sign | |
| 1 cover height, zf -6 | 13 blocks 0.8..2.0 (0.1 steps), 3 wide x 1 deep, x -24..24 pitch 4; also the vault-height ramp for 1.0..1.6 | 1, 8, 19 |
| 2 vault depth, zf -24 | low 1.1 blocks 3 wide, depth 0.6 1.0 1.1 1.2 1.3 1.6 2.4, x -15..15 pitch 5 | 11, 10 |
| 2b vault height, zf -44 | blocks 1.0 1.2 1.4 1.5 1.6 high, depth 1 | 1 |
| 3 jet height, zf -62 | 11 platform blocks 1.0..2.0, 3 x 3 | 2 |
| 4 jet gaps, z -86 | 12 platforms 4 x 6 at 1.6, gaps 2.0..7.0 (0.5 steps), x -58..40, 4 steps up at the west end (jet east) | 3 |
| 5 corridors, zf -100 | widths 1.6 1.8 2.0 2.4 3.0 4.0, walls 7 high, 14 long | 4 |
| 6 ceilings, zf -128 | 8 x 8 slabs at 2.4 2.8 3.2 3.4 4.0 5.0, x -25..25 pitch 10 | 5 |
| 7 lintels, zf -150 | 4 m doors in a 7 m wall, header at 1.7 1.8 2.2 3.4 4.0 | 6 |
| 8 cover length, zf -166 low / -182 high | low 0.8 1.0 1.6 3.0 (1.1 high), high 0.9 1.2 1.8 3.0 (2.8 high, 0.6 thick) | 7 |
| 9 run-up lanes, zf -200 | low block, back wall 0.5 1.0 2.0 3.0 m from the face (start pressed against it) | 9 |
| 10 landing, zf -218 | low block, wall 0.6 0.9 1.2 1.4 m behind the far face | 10 |
| 11 stairs, zf -238 / -258 | rise 0.30 0.40 0.45 0.50 (run 1.0); run 0.6 and 1.2 (rise 0.4); 4 steps, 4 wide | 12 |
| 12 standard stair, zf -278 | 0.4 / 1.0 / 4 wide up to an 8 x 8 platform at 1.6, low parapets on three sides, west edge open for jet-ons | 20 |
| 13 peek tests, zf -304 | 4 x 4 door in a 7 m wall, high and low L corners, wall end, 1.2 pillar | peek |

The labels are the main draw-call cost (one each, 109 in this room); the boxes merge per material.

Tool (`gym/traversal.js`, `game.tool`): panel top-left (T hides it): feet y, ground under the feet, speed, cover (type, edge
L/R, PINNED), last vault (hop / slide / refused), jet state with the last jet (peak, distance, landing y), camera
distance to the pivot against the distance it wants (PULLED IN when a wall or ceiling is in the way), and the low block
ahead with its depth and whether its landing is clear. G teleports to the next station (`STATIONS` in the tool, same
order as the rows) with a clean player and the camera behind it; `tool.goto(i)`, `tool.camPull()`, `tool.state()` are for
tests. Only T and G are used. "Refused" is inferred (a jet burst right after a blocked low block was ahead while
running at it or in its cover), the game raises no event for it.

Suite `tests/gym-traversal.browser.mjs` drives the player through every station with the engine stopped (deterministic,
no rendering) and prints the section 8 values it measures (`item ...` blocks); the asserts are the intended behaviour.
Not measurable here: visual clipping of the hop and slide (item 1, 11), AI spot counts (item 7, 14), enemy bolts over cover
(item 8), shadows or LOD. Measured numbers live in metrics.md section 8, not here.

---

## Weapon range (`?scene=gym-range`, #65)

A 126 m lane for the guns: damage falloff, spread, recoil and long sight lines. Level `gym-range.json`, tool
`gym/range.js`, suite `tests/gym-range.browser.mjs`.

**Layout** (z = 0 is the firing line, the lane runs north to z = -110; x -7..7, walls 7 m):
- Firing line: cyan strip at z = 0, spawn at (1.5, 0, 0.5). Floor labels "5 m" .. "100 m" on both edges plus a
  cross line every 5 m; banners over the lane at 25 / 50 / 75 / 100 m (bigger with distance). 47 labels in all
  (each is one draw call: keep it under about 60).
- 13 static dummies at 5 10 15 20 25 30 35 40 50 60 70 80 100 m, facing the line. Their x is scattered (-2..6.2)
  so that from some stance on the line every dummy has a clear shot, at least 1.7 m from every nearer one
  (the suite asserts 1.2). Strafe along the line to line one up.
- Bench (low cover 1.1, x -7..-2, z 1) with a light and a heavy ammo crate next to it, and a recoil wall (flat,
  5 x 4 m, face at z = -10, x -7..-2) straight ahead of the bench; stand at x = -4.5 to shoot it.
- Cover bay at 30-34 m on the east side: low cover (1.1) at z -30.5 and high cover (2.8) at z -34.2, x 5, with
  room behind for a trooper (metric item 16).

**Tool (`RangeTool`)**
- Panel (top left): gun name, falloff start / end / min, spread (hip, aim, current) and the cone diameter at 10 m,
  and the last hit with its distance, damage dealt and the damage guns.js predicts (zone multiplier x falloff), zone, crit.
- The last damage number stays over every dummy (yellow = head, magenta = weak spot) until M.
- Falloff markers: a green floor strip at the gun's falloff start and a red one at its end, measured from the firing
  line (the muzzle stands about 1.2-1.6 m ahead of the player's position, so shots read that much shorter than the
  floor distance). No strips for the sniper and the railgun (no falloff).
- Recoil wall dots: every impact on the wall stays as a dot, coloured yellow to red by its place in the burst.
- Keys: **B** clears the dots, **N** hides / shows the readouts, **M** resets the dummy readouts. Other rooms use
  other letters.
- The dummies never die: the tool wraps each dummy's `damage()` (runs the real one with unlimited health, then
  restores it), because a single sniper or railgun round exceeds a dummy's 100 hp and could not be undone after
  the fact. No change to the enemy code; the wrapper goes away with the tool.

**Using it as a fixture**: the suite stands at `D` metres in front of a dummy (on a clear line), aims at the chest
and fires; the muzzle-to-hit distance in the `weapon:hit` event and the zone give the expected damage
(`damage x zone multiplier x falloff`), which must equal the dealt damage. It reads the spread of every gun at hip
and aimed, checks that the markers follow the gun, that a burst on the recoil wall leaves one dot per impact, and
runs the trooper sight-line probe (it prints, asserts only the deterministic parts).

**Measured (metric item 16, long sight lines)**: a trooper in the open or in the cover bay, the player in the
lane, 12 s of game time. Troopers notice only below 32 m (idle at 32, 34, 40 m), a trooper noticing at 30 m does
not shoot (the shoot range is a strict < 30): shots started from at most 28.7 m. A trooper noticed at 26-30 m
runs to cover 12-14 m from the player and fires from there. So 30 m is the longest effective trooper range and
32 m the longest they notice; the 30-34 m bay is a safe distance for the player.

---

## Enemy behaviour (`?scene=gym-ai`, #66)

(to be written)

---

## Performance stress (`?scene=gym-stress`, #67)

Measures what content costs, so encounters can be budgeted (numbers: `engine.md`, "Per-encounter budget").
- **Room**: 80 x 80 m floor, a ring of 16 cover boxes at r = 26 (alternating low 1.1 and high 2.8, so cover and shadows are drawn too),
  a few labels. Spawn (0, 0, 36) facing the centre. Axis-aligned boxes and the existing materials only.
- **Tool** (`gym/stress.js`, `StressTool`): a DOM panel (top-left) with a slider per kind: puppets (`enemy.static`), troopers
  (`enemy.trooper`), drones (`enemy.drone`), point lights (`light.point`), effect bursts per second (a `blast` event: 16 sparks,
  smoke, shockwave ring; sparks are capped at 256 by `fx.js`). Units are built through the registry (same builders as a level file)
  on concentric rings around the centre (`ringSlot`), so a count always costs the same. Buttons: Destroy (kills every spawned enemy:
  debris cost), Clear, Sweep.
- **Keys**: click a row to select it, `[` / `]` step its count down / up (Shift: 4 at a time), `P` runs the sweep: for every kind
  0, 4, 8, 16, 32, 64 units, 0.6 s settle + 1.2 s sampled, a table in the console (`console.table`) and in `tool.results`.
- **Readout**: frame ms (avg and p95 of the last 120 frames, wall time between frames), draws, triangles, geometries, textures, lights
  (`renderer.info`, whole frame incl. shadow and post passes). The frame time is only meaningful on target hardware.
- **Enemies don't fight**: the tool sets `enemies.demo` (they see a dead player), so only rendering and update cost is measured.
  Killing puppets still drops ammo clips (Pickups, 45%, gone after 25 s).
- **Runtime spawning**: `Enemies.spawn(piece)` / `Enemies.despawn(actor)` (stand slots are reused, the stand buffers grow on demand).
  Lights are built with the `light.point` builder and freed by the tool (`disposeTree`); `dispose()` frees everything it spawned.
- **Test** (`tests/gym-stress.browser.mjs`): per-unit draws / triangles / geometries are asserted linear and stable (0..32 of each
  kind, worst case: all in view, near LOD, culling off); frame time only printed. Also: far LOD cost, debris cost, enemies never
  fire, keys and sweep, clearing returns geometries / textures / scene objects to the baseline, scene switches with 80 units spawned
  leave no leak. `SHOT=/path.png` saves a screenshot with a crowd; `ONLY=fx` runs the cost table of one kind.
- Gotchas: adding / removing point lights recompiles shaders (a hitch, not a leak; the sweep's `settle` skips it). The fx pools
  create hidden meshes on demand, so the scene object count grows up to the most particles ever alive at once, then stays.
