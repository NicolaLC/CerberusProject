# Gym

Four scenes, one per room (Gym epic #58). Each room is a level file plus a tool (`src/game/gym/<tool>.js`, level
field `tool`) for its readouts, overlays and keys, and a browser suite that uses the room as its fixture.
Measured values go into `instructions/metrics.md` (section 8); this file says what each room contains and how to use it.

**Key bar** (`view/keyhints.js`, top centre): every shortcut that works right now: the global debug keys (H skeletons, F3 / `
stats) with `?debug`, plus the room's keys in any scene with a tool, whether its panel is open or hidden. The list comes from
each tool's `static KEYS`; `scenes.browser.mjs` fails if a tool handles a key (`e.code === ...`) that its KEYS doesn't list.

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
| 14 KIT, z 48 / 70 (south of the spawn) | one of each `kit.*` piece with its example params, a floor extension (z 35..90), `env.label` under each (#69); the suite `tests/kit.browser.mjs` also spawns every id with edge params, climbs the stairs, ramp and platform stairs and walks the doorway | kit |

The labels are the main draw-call cost (one each, 109 in this room); the boxes merge per material.

Tool (`gym/traversal.js`, `game.tool`): panel top-left (T hides it): feet y, ground under the feet, speed, cover (type, edge
L/R, PINNED), last vault (hop / slide / refused), jet state with the last jet (peak, distance, landing y), camera
distance to the pivot against the distance it wants (PULLED IN when a wall or ceiling is in the way), and the low block
ahead with its depth and whether its landing is clear. G teleports to the next station (`STATIONS` in the tool, same
order as the rows) with a clean player and the camera behind it; `tool.goto(i)`, `tool.camPull()`, `tool.state()` are for
tests. Only T and G are used. "Refused" comes from the `player:vaultRefused` event.

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

### Surprises found
- Fixed (#75): troopers stalled 0.9 m behind a squadmate in the same lane (`separate`) until the move timer ran out (0-3 per 125 s);
  they now step round it sideways and give up on a goal after 1 s without progress (`STALL_TIME`): 0 stalls since.
- Fixed (#75): the drone's flight height followed wall tops (up to wall + alt after crossing); boxes narrower than 2 m
  (`TUNING.floorMin`) no longer lift it, platforms still do.
- `Enemies.demo` (L) does not recall bolts or bursts already started.

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

---

## Library (`?scene=library`, #68)

The showroom: a walkable bare-grid floor (x -40..40, z 60..-100) with labelled aisles. Spawn (0, 0, 34) facing north; aisles run
west-east, one per row, signs (yellow) at the west end. Level `library.json` (`demo: true`, `tool: "library"`), tool `gym/library.js`,
suite `tests/library.browser.mjs`.

| Aisle | z | Content |
| --- | --- | --- |
| 1 Enemies | 26 | static, mover (rail 4 m), shooter (behind a low block), trooper, drone; `boss.spider` on its own pen (x 28, arena 19..37 / 10..34) |
| 2 Guns | 10 | one `prop.gun` per gun on a low stand (0.8 m), caption: name, damage, mag, falloff |
| 3 Cover and environment | -6 | `env.box` low / high / wall / platform / faces, `env.strip`, `env.label` |
| 4 Pickups | -20 | `pickup.light`, `pickup.heavy` |
| 5 Light presets | -30 | four `light.point` over pedestals: cyan, warm white, red, flicker (with its strip) |
| 6 Kit aisle | -46 | empty in the file on purpose; the tool fills it |

- **Exhibit** = a level piece named `ex:<id>`. Each has a flat floor caption (readable walking north): its id and the entry's `label`
  meta (guns: name, damage, mag, falloff). Enemy and pickup captions in the file must equal their meta (the suite checks it); the
  env / light ones are hand-written. Edit `library.json` by hand; keep that rule.
- **Auto aisle**: at load the tool spawns every registered id that the file does not show, from `meta.example`, on the grid
  `level.kitAisle` ({ x, z, dx, cols, dz }), each with a caption (id + wrapped label). So new pieces (the `kit.*` ids) appear
  without touching the file. World pieces go through `world.spawn(piece)` (returns a handle; `world.despawn(handle)` frees boxes,
  labels, lights, props and colliders), enemies through `enemies.spawn`, pickups through `registry.build` / `pickups.despawn`.
  `tool.spawned` counts what it added per owner (`scenes.browser.mjs` adds it to the file's piece counts); `tool.failed` lists ids
  whose spawn threw (also a console error). `dispose()` frees all of it.
- **Wake one**: key **V** (`KEYS`) makes the nearest enemy exhibit `hostile`: `Enemies.update` hands it the real player instead
  of the demo stand-in, so it fights; the rest stay harmless. V next to it again replaces it with a fresh, calm copy.
- **Panel** (top-left): id, owner and label of the exhibit within 14 m, awake / idle, exhibit counts.
- Keys in use elsewhere (do not reuse): controls W A S D E F R Q H 1-6, Gym tools T G B N M J K L O P [ ].
- `prop.gun` frees its merged geometry in `World.unload()` (own list `world.props`); its materials are permanent.
- Gotchas fixed on the way: a `mover` with speed 0 or no `to` went NaN (division by a zero rail length); `boss.spider` without an
  `arena` now gets a 20 m box around its position.
