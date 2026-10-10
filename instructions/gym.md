# Gym

Four scenes, one per room (Gym epic #58). Each room is a level file plus a tool (`src/game/gym/<tool>.js`, level
field `tool`) for its readouts, overlays and keys, and a browser suite that uses the room as its fixture.
Measured values go into `instructions/metrics.md` (section 8); this file says what each room contains and how to use it.

## Traversal and cover (`?scene=gym`, #64)

(to be written)

---

## Weapon range (`?scene=gym-range`, #65)

(to be written)

---

## Enemy behaviour (`?scene=gym-ai`, #66)

One walled room per enemy type off a hub, so a fight in one room never wakes another. Coordinates are world metres (x east, z south), walls
7 m (no roofs: open sky, drones fly), doors 4 x 4, corridors 4 wide. The player spawns in the hub at (-3, 0, 3) facing north, where nothing
is awake: every enemy is farther than its wake range from every hub point (trooper 32 / drone 36 / spider 28 / shooter 30) and walled off.
The level file has an extra top-level `rooms` field (inner bounds of each room); the tool and the suite read it, the game ignores it.

| Room (door from the hub) | Inner bounds (x, z) | Contents |
| --- | --- | --- |
| Hub | -6..6, -6..6 | spawn, signs; 4 doors; corridors 8 m (north, west, south), 16 m (east) |
| North: troopers | -17..17, -56..-14.5 | squad of 3 at z -44 (x -8, 0, 8). Rows 12 m apart: low z -26 (six 3 x 1 m boxes, gaps 0.6 0.8 1.0 1.2 1.5), high z -38 (six 2.4 x 0.6 m, 2.8 m tall, gaps 1.5 1.2 1.0 0.8 0.6), low z -50 (four 3 x 1 m, gaps 0.7 0.75 1.0). The 1.0 m gaps of the first two rows sit on x = 0: the sight line from the squad to the door |
| West: puppets | -42..-14.5, -14..14 | 3 statics (x -26), movers at x -20 (3 m/s) and -23 (5 m/s) on z +-11, 2 shooters at x -40 behind low blocks (face 0.8 in front of the post) |
| South: drone | -26..10, 14.5..46 | drone at (0, 44); six 6 m walls at z 32, x -23 .. 2 every 5 m, tops 2.8 3.2 3.6 4.0 4.4 5.0; low (-18, 21) and high (4, 21) cover for the safe-zone check |
| East: spider | 22.5..66, -30..30 | `boss.spider` at (52, -8), arena bounds 22.6..65.6 / -29.6..29.6. Six 8 m freestanding 3.2 m walls as three bands (z -16, 0, 16) of two lanes: 5 + 9, 6 + 8, 7 + 7.2 m. A low and a high block |

Layout rules the room needed (keep them when editing it):
- Enemies that move or hover must stay inside 28 m of the spawn camera, or well beyond 34 m: the LOD / shadow-caster switches (`game.js LOD`, 28-34 m
  with hysteresis) otherwise flip with their random phase and `scenes.browser.mjs` reads geometry counts off by one on alternate cycles.
- The east door is 16 m from the hub so the arena (30 m half depth) clears the trooper room, and the arena walls are the only walls in it.
- A wall shared by two rooms is one box (no coplanar duplicates).

### Tool (`src/game/gym/ai.js`, level field `tool: "ai"`)
Keys (own listener, this scene only, removed on leave): **J** respawn every enemy (`enemies.load(level)`; the player, pickups and the toggles
below stay, skeleton helpers are rebuilt) · **K** freeze the AI (`enemies.frozen`: no thinking or moving, rendering and bolts in flight go on) ·
**L** player invisible (`enemies.demo`, the Library's stand-in player that reads `dead`; bursts already started finish, then no bolts) ·
**O** overlays. A panel top-left lists the keys and toggle states, the player's room and the awake count; it always shows, the overlays only with `?debug`.

Overlays (`?debug`; one group, one dynamic line batch, one instanced marker draw, DOM state texts; everything is freed on leave):
cyan ring = trooper notice 32, orange = shoot range 30 (troopers, shooters), magenta = drone wake 36 / spider wake 28 (+ arena rectangle),
red = spider stomp 6.5 and collision 3.6, yellow = the drone's 9-18 m circling band around the player. Green line = enemy has line of sight
(yellow when out of range). State text above every enemy that the camera can see. Trooper to its cover spot: orange; with a route waypoint:
magenta. Floor markers for every cover spot of the trooper room: green low, blue high, red reserved by a trooper, grey = marked bad.

### Suite (`tests/gym-ai.browser.mjs`)
Asserts: hub quiet; walking into the trooper room wakes the squad (alert at z -12), each takes its own spot 6-34 m from the player that blocks the
player; K freezes every enemy exactly (position, yaw, state, timer) and releases; L stops bolts (troopers, shooters, drone) and releases; J respawns
and keeps player and toggles; puppet / drone / spider wake rules; overlays exist, toggle, and are freed on a scene switch (DOM and scene object counts
come back). Then it prints the measurements below. Only rules that follow from the code are asserted; the printed numbers vary a little between runs.

### Measured (feeds metrics.md section 8, items 13, 14, 15, 17; proposals, the owner decides)
**13 trooper route clearance (gaps 0.6-1.5).** `segmentClear` (r 0.35) accepts a straight crossing for gaps > 0.7 m (0.6 and 0.7 fail; 0.75 and up pass);
a trooper body (r 0.4) walks the centre line of every gap >= 0.75 without stalling. But the route to a spot *behind* the neighbouring boxes
(`cover.route`: straight, or one padded corner) exists from the front only for gaps >= 1.2 m: 0.8 and 1.0 m gaps give no route at all to the two
spots beside the gap, 1.2 and 1.5 m route through the gap. Sweep of 57 start points in front of the low row: 16 picked a spot behind the row
(5 through a 1.2 / 1.5 m gap, 11 round a row end), 31-33 picked end-face spots inside the 1.2 / 1.5 m gaps, 8-10 picked room-wall spots; all 57
walked there. End-face spots exist only in gaps >= 1.2 m (a 1.0 m gap leaves 0.35 < r 0.4 beside the spot). No stall ever happened at a gap.
Rule: design AI crossings with gaps >= 1.2 m; 0.75-1.0 m gaps are walkable but the AI does not plan through them; <= 0.7 m is a wall.

**14 cover spot availability.** Trooper room: 96 spots (68 low, 24 high, 4 on room walls). A 3 m low box gives 6.8 spots (3 per long face, plus end faces
in wide gaps), a 2.4 m high box 4 (two ends of each long face). For the player at five positions the room offers 16-35 viable spots (protect, 6-28 m),
4-11 distinct 25 degree bearings; the squad reserved 3 (one each) and picked 17-26 m from the player (7-19 m when the player stands between the
rows; ideal is 15, but the row positions fix the options); every pick was in 6-28 m. Guideline: a squad of N needs about 2N spots on the far side of
each row in the 6-28 m band (two 3 m low boxes or three 2.4 m high boxes per pair of troopers) and rows <= 12 m apart so the next row is in range
when the player advances.

**15 drone and walls (flight altitude is random, 3.5-5.0, per drone).** A wall stops a drone when its top > alt - 0.3 (the avoidance box is the drone's
body height band): flown over at alt 3.5 for 2.8 and 3.2 m, at 4.25 up to 3.6 m, at 5.0 up to 4.4 m; 5.0 m always blocks (stands 0.85 off the wall).
So 3.2 m walls never stop a drone, walls of 4.7 m or more always do, in between it depends on the drone's roll. Safe zone behind cover (chest hidden from
the muzzle, drone D m from the near face): low 1.1 m: standing chest (1.26) is never hidden; crouched 0.6-1.0 m behind the far face at D 6 (alt 5 / 3.5), 1.5-2.4 m
at D 15. High 2.8 m: hidden 4.3-5.8 m behind it at D 6 and alt 5, 15 to more than 24 m at alt 3.5: high cover is shelter, low cover only protects a crouch.

**17 spider.** Lanes under 7.2 m (5, 6, 7) are refused: the mech stalls at the mouth (centre never closer than 3.6 m to a wall); 7.2, 8 and 9 m are walked
through in 6-8 s. Leg tubes overlapped a wall by 0.16 m in the 9 m lane (none in 7.2 or 8 m); feet are never planted in walls (`segmentClear` pull-in).
Blasts ignore cover: the mortar lands on the player's position (6 of 6 hit a player hiding behind a 3.2 m wall, every one with the wall between impact and
player); only moving helps (it leads 0.5 s of velocity over a 1.5 s flight, so a straight run misses by about speed x 1 s: at 4.6 m/s the mean miss was 4.8 m, 0-1 of 6 hit, the hits right after a turn).
The stomp (radius 7) hit a player 4.5 m away behind a 3.2 m wall. Cover only helps against the cannon.

Not measured: drone shots against cover as bolts (spread, hit points); the spider's mortar against moving players beyond one back-and-forth pattern; fog
and LOD readability (item 16, not this room); leg clipping against the arena perimeter walls beyond the lane tests.

### Surprises found (not fixed, gameplay code)
- Troopers' routes ignore squadmates: a trooper walking along the back of a cover row stops 0.9 m behind a squadmate standing in the same lane (`separate`) until its
  move timer runs out (0-3 stalls per 125 s of fighting).
- The drone's altitude target follows the highest box top under it, so over a wall it rises to wall + alt (up to 10 m) after crossing; not measured, read from `drone.js`.
- `Enemies.demo` (L) does not recall bolts or bursts already started.

---

## Performance stress (`?scene=gym-stress`, #67)

(to be written)
