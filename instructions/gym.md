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

(to be written)

---

## Enemy behaviour (`?scene=gym-ai`, #66)

(to be written)

---

## Performance stress (`?scene=gym-stress`, #67)

(to be written)
