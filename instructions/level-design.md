# Level design process

How a mission goes from an idea to `src/levels/<name>.json`. A level has two halves, kept apart:
- **Space** (where): the map. Paper first, then the Workshop (or a Tiled draft, if we add one).
- **Time** (when): the **beat sheet**, a text script that names map things and says what happens. It compiles to
  encounter pieces (`objective.*`, `trigger.volume`, `log.line`, `env.alarm`, `kit.gate`, dormant groups).

The level JSON is the output, never the place to design. The beat sheet is the source of truth for flow; the JSON
must match it (Claude checks, see "Checks").

## 1. Paper pass (ideas)
- Graph paper, **1 square = 2 m** (the in-game grid tile, metrics.md section 1). Write the scale and north (-Z, up) on the sheet.
- Pencil. Walls: thick line. Low cover (1.1): orange. High cover (2.8): blue. Platforms: hatched, height written (1.6).
  Doors: a gap with a bar. Gates: a gap with a cross.
- Spawn: arrow showing facing. Enemies: a letter (S shooter, T trooper, D drone, B boss, P puppet), with their group number.
  Pickups: `a` light ammo, `A` heavy ammo, `G` gun.
- Every place where something happens gets a **circled number** (1, 2, 3...). Same number = same beat in the sheet.
- One **index card per beat**: number, title, what starts it, what the player sees / hears, what it unlocks.
  Shuffle cards on the table to try another order before writing anything down.
- Photograph map + cards and give them to Claude: it writes the beat sheet and a list of questions (unclear sizes,
  sides, missing triggers). Paper is for pacing; exact metrics come in the next pass.

## 2. Beat sheet (`levels/<name>.beats.md`)
One `##` heading per beat, numbered in play order. One line per verb, verb first in caps, map names in `[brackets]`.
Text the player reads goes in quotes, exactly as shown in game (narrative.md rules for STEM-00 lines).

| Verb | Meaning | Compiles to |
|---|---|---|
| `WHEN [vol]` | the beat starts when the player enters a volume | `trigger.volume` named `vol` |
| `GOAL reach [box] "TEXT"` | get there | `objective.reach` |
| `GOAL destroy <group> "TEXT"` (`count N`) | kill a squad, or N of anything | `objective.destroy` (`group` / `count`) |
| `GOAL survive Ns "TEXT"` | hold out | `objective.survive` |
| `GOAL interact [spot] "TEXT"` | press G there | `objective.interact` |
| `WAKE <group>` | dormant group activates with this goal | `wakeGroup` on the goal |
| `SPAWN <group>` | reinforcements: the group's `marker.entry` points build their enemies, awake | `spawnGroup` on the goal |
| `GIVES <gun>` (`+N ammo`) | goal hands over a gun | `grantGun` / `grantAmmo` |
| `NEEDS <gun>` | goal only completes if the gun is owned | `requiresGun` |
| `SKIP IF [vol]` / `SKIP IF OWNED <gun>` | optional goal | `skipOn` / `skipIfOwned` |
| `LOG "> TEXT"` | STEM-00 line at this beat | `log.line` (`on` = the beat's event) |
| `LOADOUT <guns> ON [vol]` | take back every other gun when the player enters | `trigger.volume` with `loadout` |
| `GOAL action fire <light\|heavy> "TEXT"` | fire a gun of that ammo class | `objective.action` `fire` + `ammo` |
| `SAY "TEXT"` | announcer line | `log.line` with `voice: announcer` |
| `ALARM on` / `ALARM off` | alarm lighting from / to this beat | `env.alarm` `on` / `off` |
| `OPEN [gate]` | a sealed gate opens when the beat is done | `kit.gate` `on: objective:<id>:done` |
| `CHECKPOINT [name]` | respawn point that matters here | `marker.checkpoint` |
| `INTRO "line" / "line"` | boot screen at play start | `intro.boot` |
| `GOAL action <move> "TEXT"` (`count N`) | do a move (cover, vault, slide, coverRun, jet), in the goal's box when it has one | `objective.action` |
| `CUT` ... | cutscene shot list (section 4) | `cinematic.cut` |

Rules:
- Goal `order` = beat number x 10 (beat 3 = 30), so a beat can be inserted later (35) without renumbering.
- A beat's id (the objective `name`) is its heading slug: `## 4. Purge: hall` -> `purge-hall`.
- `LOG` / `SAY` / `ALARM` without a stated event fire when the beat **starts** (`objective:<id>`); write `ON DONE`
  to fire when it ends (`objective:<id>:done`), `ON [vol]` for a trigger, `ON DISCOVER <gun>` for `discovered:<gun>`.
- Groups are named `<level>-<n>` or by place (`purge-1`, `hall-guards`); their members carry `dormant: true` until woken.
- Free text after `--` is a note for the builder, not compiled (lighting mood, enemy placement, intent).

## 3. Checks (Claude runs them when compiling or reviewing)
- Every `[name]` and group in the sheet exists on the map, and every encounter piece on the map is used by a beat.
- Every goal is reachable: no goal needs a gun the player cannot own by then (gdd.md, Discovery order), no gate stays shut,
  no volume sits where the player never walks.
- A checkpoint before every fight that takes more than about a minute.
- Log lines: at most about 70 characters, voice of the act (narrative.md).
- A Mermaid flow of the beats can be generated back from the JSON to compare with the sheet.

## 4. Cutscenes (`cinematic.cut`)
Written in the sheet as a shot list; it compiles to one `cinematic.cut` piece (workshop.md "Mid-level cut"): camera only, input locked,
enemies hold fire, HUD hidden but the log, skippable.
```
## CUT 3. Purge: the troop comes out   ON objective:purge-start   PLACE [cp-yard] north
CAM   (x, y, z) -> (x, y, z), look (x, y, z), 2.6 s, fov 42, inOut   -- the beacon
CAM   ...  3.2 s  CUE pen-gate  WAKE purge-1                         -- the gate drops, they come
```
| Verb | Compiles to |
|---|---|
| `CUT n. title ON <event>` | `cinematic.cut` named by the slug, `on` = the event (an `on` form) |
| `PLACE [marker] <facing>` | `place` { pos, yaw }: STEM-00 is put there for the return |
| `CAM from -> to, look a -> b, time, fov, ease, shake` | one `shots` entry (world-space anchors) |
| `CUE <name>` on a CAM line | the shot's `cue`: fires `cue:<name>` (gates, beacons, log lines wait on it) |
| `LEAP <group> -> (x, y, z)` on a CAM line | the shot's `leap` { group, to, time?, peak? }: the boss of that group jumps there on an arc |
| `RECALL <group> -> ...` on a CAM line | the shot's `recall` { group, path }: its troopers / drones stop fighting, run the path and are removed at its end |
| `WAKE <group>` on a CAM line | the shot's `wakeGroup` |
| `STEM path (x, y, z) -> ...` on a CAM line | the shot's `stem.path`: STEM-00's feet walk (run above 6 m/s) from where they are through the points over the shot's time; it stands at the end. `place` is the cut's start, `stem` moves it from there |
| `STEM face (x, y, z)` / `STEM aim` | `stem.face` (turn toward the point) / `stem.aim` (aiming pose, gun raised toward `face`) |
| `STEM fire <group> [every 0.45]` | `stem.fire` { group, interval }: STEM-00 shoots the group's members one by one (real shots and kills, no ammo); the survivors die at the cut's end or on a skip |
| `STEM fall (x, y, z) ...` | `stem.path` + `stem.fall: true`: the falling pose along the path (a 300 m drop is one far point); the player stays frozen there after the cut: end the level with `NEXT` |
| `FADE 0..1` on a CAM line | the shot's `fade`: a black screen easing from the previous shot's value; `FADE 1` on the last shot hands over to the next scene |
| `GOAL wait CUT` | `objective.reach` with `trigger: <cut name>`: the chain waits for the cut's end |
A skip still fires every CUE / WAKE not reached, and runs every `STEM` end state (position at the last path point, `fire` groups dead).
Chaining scenes (level.md "Level chaining"): `NEXT <scene>` [`NO DEBRIEF`] in the header of a sheet sets the level's `next` / `debrief: false`; a cut that ends black (`FADE 1`, `stem.fall`) followed by `GOAL wait CUT` completes the mission and fades straight into the next scene. The camera path must stay clear of walls (no collision on scripted shots).

## 5. Example: the Prologue (`prologue.json`, as built)
```
# PROVING GROUNDS  (loadout: none (unarmed), skin: weathered, sky: night)
NEXT  skyway  NO DEBRIEF   -- level.next / debrief: false; the debrief comes at the end of the Skyway
-- map: calibration rack [rack] at (0, 1.6, 45) in cell 1, the calibration rooms C1-C6 running west, the weapons range west of C6,
-- the drill hall south of it, the supply corridor, the building (halls A / B), the boss arena (the only open sky),
-- the exit annex (SKYWAY pad) behind [exit-gate] in the boss arena's north wall. 14 sectors (level.md "Sectors").

## 0. Boot
CUT   wake-up (intro.cinematic, 9.5 s: over the operator's shoulder, the surge at 2.4 s releases [cradle-00], push-in to the visor)
INTRO "> BOOT SEQ 0x00" / "FRAME: STEM-00 / SERIAL 0" / "MOTOR CORE: NOMINAL" /
      "WEAPON: NONE" / "HIVEMIND LINK: LOST" / "DIRECTIVE: DESTROY HIVEMIND"   -- after cinematic:done, POV hand-off
LOG   "> DIRECTIVE: DESTROY HIVEMIND. SOURCE: UNKNOWN. ROUTE: EXIT."  ON intro:done   -- it knows the order, not who gave it

## 1. Calibration   -- one room per step, each gate opens on the step's done and shuts behind (closeOn); orders 10-17
GOAL  reach [c1-move] "CALIBRATION 01: LOCOMOTION"                 -- 10; CHECKPOINT [cp-c2] past [c1-gate]
GOAL  interact [c2-arm] "CALIBRATION 02: ARM"  GIVES pistol         -- 10.5: the KP-12 on the bench (prompt TAKE KP-12 EMBER)
LOG   "> ITEM: KP-12. FUNCTION: CALIBRATION. QUERY: CALIBRATE WHAT?"  ON DISCOVER pistol
GOAL  destroy calib "CALIBRATION 02: TARGETING"                     -- 11: three static targets (count 3)
GOAL  reach [c3-jet] "CALIBRATION 03: VERTICAL THRUST"             -- 12: the exit is on a 1.6 m ledge; CHECKPOINT [cp-c4]
GOAL  action cover "CALIBRATION 04: TAKE COVER"                    -- 13: the shooter is in sight but asleep until STEM-00 is in cover
GOAL  destroy calib-shooter "CALIBRATION 04: RETURN FIRE"  WAKE calib-shooter -- 14
GOAL  action vault "CALIBRATION 05: VAULT"                          -- 15 (hop); both C5 blocks run wall to wall (ends 15 cm in the walls): no way round
GOAL  action slide "CALIBRATION 05: SLIDE"                          -- 16 (slide vault)
GOAL  action coverRun count 2 "CALIBRATION 06: COVER TRANSFER"      -- 17

## 2.5 Weapons range   -- west of C6: in through [range-gate], out through [range-exit-gate] onto the hall landing
GOAL  action fire light "WEAPONS RANGE: LIGHT ROUNDS"   -- racks: light (KR-7, KM-90, KB-3, cyan) / heavy (KS-5, KX-9, amber), supply crates beside them
LOG   "> RANGE: LIVE. CLASS LIGHT: KR-7, KM-90, KB-3. ROUNDS: COMMON."
GOAL  action fire heavy "WEAPONS RANGE: HEAVY ROUNDS"   -- armored puppets only yield to heavy rounds
LOG   "> CLASS HEAVY: KS-5, KX-9. ROUNDS: SCARCE. FUNCTION: BREAK ARMOR."
LOADOUT pistol  ON [range-return]                       -- trigger.volume loadout: the range guns stay behind
LOG   "> RANGE ARMS: RECALLED. KP-12: RETAINED. ROUNDS: UNLIMITED."  ON [range-return]   -- priority high
CHECKPOINT [cp-range]

## 2.9 Leave calibration bay
GOAL  reach [leave-bay] "LEAVE CALIBRATION BAY"        -- 20: the landing past [range-exit-gate]
LOG   "> MOTION UNRESTRICTED. NO ONE OBJECTS."  ON [bay-exit]

## 3. Purge starts
GOAL  wait CUT purge-cut "PURGE INITIATED"
SAY   "CALIBRATION UNIT 00: NONCOMPLIANT. PURGE."
ALARM on                                       -- off at beat 11 done; the three beacons turn from here
CHECKPOINT [cp-yard]                           -- (-46.5, -0.8, 17.4): where the cut puts STEM-00

## CUT 3. Purge: the troop comes out   ON objective:purge-start   PLACE [cp-yard] north   (13 s, skippable)
CAM   beacon over the bay door, 2.6 s, fov 42                     -- the broadcast reads over it
CAM   above the landing, down the hall, 3 s
CAM   at the pen gate, 3.2 s  CUE pen-gate  WAKE purge-1          -- the gate drops into the floor, the troop comes out
CAM   over the west cover as they advance, 2.6 s
CAM   back behind STEM-00, 1.6 s, control returns

## 4. Purge: drill hall
GOAL  destroy purge-1 "PURGE: DRILL HALL"   -- 7 troopers (4 on the posts, 3 from the pen) + 3 drones; nobody drops anything
-- the KR-7 waits on a stand on the landing [landing-rifle], in the path from the range exit to the cut: the first fight has two guns

## 4.5 Supply corridor   -- hall exit -> east 22 m -> north 9 m -> the building's west door; interior kit, two sectors (supply-a / supply-b)
LOG   "> SUPPLY POINT: STOCKED. ROUNDS, REPAIR. QUERY: STOCKED FOR WHOM?"  ON [supply-in]
-- supply.ammo (all classes) and supply.repair against the south wall: the only rounds and repairs of the level
-- a second, heavy-only supply.ammo [arena-supply-heavy] stands in hall B's east wall north of [arena-door]: heavy rounds for the SX-6

## 5. Purge: hall
GOAL  destroy purge-2 "PURGE: HALL A"  WAKE purge-2   -- detail tells the player to resupply first ({interact})
-- [hall-mezzanine]: a 3.6 m deck on the south wall, stairs at both ends; two of purge-2 are posted on it (post: true) and shoot down over the low cover
LOG   "> TARGETS: ARMED. DIRECTIVE: UNCHANGED. QUERY: WHO ARMED THEM?"  ON DONE
-- [hall-farsight]: a KS-5 Farsight (pickup.gun, sniper) on a stand just inside hall A's door: walking in takes it, before the plated troopers wake
LOG   "> ITEM: KS-5. ROUNDS: HEAVY. FUNCTION: BREAK ARMOR."  ON DISCOVER sniper   -- priority high
CHECKPOINT [cp-hall], [cp-hall-east]

## 6. Armoury (optional)
GOAL  interact [armoury] "SALVAGE A WEAPON"  GIVES rifle +64  SKIP IF [armoury-skip]  SKIP IF OWNED rifle
-- [armoury-skip]: in front of [arena-door] in hall B: walking on toward the arena without the Warden skips it
LOG   "> ITEM: KR-7. FUNCTION: KILL. QUERY: WHY DOES IT FEEL HEAVY?"  ON DISCOVER rifle

## 8. Purge: hall troopers
-- hall B crossfire: two more of purge-4 posted at opposite corners (post: true), two drones; the low cover runs both ways
GOAL  destroy purge-4 "PURGE: HALL TROOPERS"  WAKE purge-4   -- two PLATED troopers (armored: light rounds and the pistol x0.25 except the back cell; the Farsight breaks them), dropGun rifle +64 (once, unless owned)
LOG   "> HOSTILES DESTROYED: 21. DIRECTIVE: UNCHANGED. SOURCE: UNKNOWN."  ON DONE


## 9.5 Armoury, late
GOAL  interact [armoury] "SALVAGE A WEAPON"  GIVES rifle +64  SKIP IF OWNED rifle

## 10. Boss arena   -- indoors all the way: supply corridor -> hall A -> hall B -> [arena-door] in hall B's east wall (z -52)
GOAL  reach [purge-gate] "BOSS ARENA"   -- just inside the arena; [arena-gate] opens when the rifle step (9.5) is done
CHECKPOINT [cp-gate]                     -- (26.5, 0, -50), where the cut leaves STEM-00

## 10.5 Boss cut
GOAL  wait CUT boss-cut "SX-6 TARANTULA"
SAY   "UNITS RECALLED. SX-6 IS SUFFICIENT."  ON cue:recall

## CUT 10.5 The SX-6 arrives   ON objective:boss-cut   PLACE [cp-gate] toward the exit   (14.8 s, skippable)
CAM   over STEM-00's shoulder: the rush (5 troopers, 3 drones, arena-rush) comes at it from across the arena, 2.8 s  CUE rush  WAKE arena-rush
CAM   on the exit gate, a few metres away, 2.4 s                               -- "so close"
CAM   low, looking up: the SX-6 leaps off hall B's roof, over STEM-00, 2.4 s  WAKE purge-6  LEAP purge-6 -> (37.25, 0, -45.5), the middle of the arena between its two centre walls
CAM   it lands between STEM-00 and the exit, 2 s, shake
CAM   the rush turns and runs out through [arena-far-gate], 3.4 s  CUE recall  RECALL arena-rush -> far gate -> out
CAM   back behind STEM-00 facing the SX-6, 1.8 s
-- the cut's end (or a skip) settles it: the SX-6 is down at its landing spot, the recalled robots are gone, the far gate shuts (shutOn)

## 11. Purge: boss
GOAL  destroy purge-6 "PURGE: SX-6 TARANTULA"   -- woken by the cut; the knee greaves are plate: heavy rounds (the Farsight) take them apart
ALARM off  ON DONE
-- [exit-gate] no longer opens on the boss: the breakout cut opens it (CUE breakout-gate)

## 11.5 Breakout cut
GOAL  wait CUT breakout "BREAKOUT"       -- order 115

## CUT 11.5 Breakout   ON objective:breakout   PLACE (27, 0, -50) toward the exit gate   (12.2 s, skippable)
-- [breakout]: 4 troopers (NOT plated), dormant in the exit annex behind the shut [exit-gate]; nothing can reach them before the cut
CAM   behind STEM-00 over the arena toward the shut gate, 2.6 s, fov 48, inOut  STEM face (30, 1.4, -62.5)
CAM   high on the gate from the east, 2.2 s, shake  CUE breakout-gate  WAKE breakout  STEM aim   -- the gate slides up, the squad bursts out
CAM   over STEM-00's shoulder, 4 s  STEM path (27, 0, -50) -> (28.4, 0, -52.5)  STEM aim  STEM fire breakout every 0.7   -- it shoots them one by one
CAM   behind STEM-00 as it walks to the open gate, 3.4 s  STEM path (28.4, 0, -52.5) -> (29.6, 0, -57) -> (30, 0, -60.4)  STEM face (30, 1.4, -70)
LOG   "> SQUAD: 4. STATUS: DESTROYED. EXIT: OPEN. QUERY: WHO SENT THEM?"  ON cut:breakout:done
-- a skip fires the cue and the wake, kills the squad and puts STEM-00 at the last path point: the same end state

## 12. Exit
GOAL  reach [exit] "REACH THE SKYWAY"  NEEDS rifle   -- (30, 0, -75) in the annex behind the gate; the mission completes, fades to black and loads `skyway`
```
Half-numbered beats (2.5 range: orders 18 / 19; 2.9 leave: 20; 6.5 stand-by: not in the file at present; 9.5; 10.5) are inserted beats: order 95 and 105.
The calibration beat 1 predates the order rule (its steps are 10-17, the bench 10.5). Beats 7 (yard troopers, `purge-3`)
and 9 (drones, `purge-5`) were merged into beat 4's troop (owner, 2026-10-14).

**Drill hall** (beats 3-4; the Prologue's 5th area, built by script with `serializeLevel`): a roofed, sunken straight lane, interior kit.
- Lane x -50..-32 (18 wide), from the bay gate (z 29.5) to the pen gate (z -20.5): 50 m. Landing y 0 (z 29.5..23.5, low parapets beside
  8 m stairs) -> upper tier y -0.8 (z 23.5..13.5: the player's line, two low walls at z 16) -> full-width stairs -> lower tier y -1.6
  (z 13.5..-20.5) where the troop fights. Roof 7.4 (9 m over the lower tier), cold-white lights, three amber `prop.beacon`s
  (over the bay door, either side of the pen gate). Floors below 0 rely on `World.groundAt` taking any height.
- Cover lines across the lower tier (metrics.md: low 1.1 x 1.0, high 2.8 x 0.6, gaps 2 m): z 7 three low walls; z -2 two high walls with a
  centre low post at -5; z -12 two low posts; a low post by the gate at -17.5. Shooters sit 1.3 m north of their posts.
- The pen (x -46..-36, z -26.5..-20.8, floor -1.6, roofed) holds the troopers and drones behind `pen-gate` (`kit.gate`, 5 x 6, slides
  down on `cue:pen-gate`). From the player's line the pen is ~41 m away, so the troopers find cover 24-32 m out (run <= 22) and push in.
- Drones: the hall's `zone.interior` pieces are 3.1 m high per tier, so drones (3.2+ above the floor they fly over) are outside them and
  can fly the hall, while the camera at walking height reads INTERIOR. A jet lifts the camera out of the zone (exposure eases to outdoor).
- Exit: a 4 m door in the east wall at z -17.6, up four steps into the **supply corridor** (interior) -> the building's west door (x -12) ->
  hall A -> hall B -> `arena-door` (east wall, z -52) -> the boss arena. The arena is the only open-sky space: the apron, the old field and the
  forecourt are gone (walled off behind 8 m arena walls and the corridor), hall B's south door is sealed.

## 6. Example: the Skyway (`skyway.json`, as built)
Generated by `scripts/build-skyway.mjs` (`serializeLevel`): change a number there and run `node scripts/build-skyway.mjs`, never edit the JSON.
The Prologue's last part (gdd.md 2.10 steps 6-8, 8.5): the lab exit opens onto a colossal bridge, the HiveMind meets STEM-00 through CERBERUS,
the player fights and loses, the deck breaks and STEM-00 falls to the Underworks.
```
# THE SKYWAY  (loadout: pistol, rifle, sniper; skin: weathered, sky: night; NEXT underworks, debrief on: CONTINUE opens Act 1)
-- map: the deck runs north (-Z), x -12..12, z 24 (the lab spire's wall, [lab-gate] shut behind the player) to -176 (the sealed Gate shutter), top y 0.
-- roofed landing z 24..12 (the start, supply.ammo + supply.repair on the spire wall), parapets 1.1 m + an invisible 6 m rail (nothing climbs or jets off),
-- skyscrapers flank it 24+ m off the deck, bases at y -420; [cerberus] hangs on the east tower at (33.5, 0, -118) facing the deck;
-- the breakaway patch [plate-00..22] (x -6..6, z -102..-114) is the only deck with nothing on it; a hoist cable with lamps hangs beside it for the fall.
-- no boot (the player saw it in the Prologue), no sectors (open sky, 110-185 draws).

## 0. Intro
CUT   skyway-intro  ON start  (11.1 s, skippable)            -- below
LOG   "> ALTITUDE: 1,140 M. EXIT: FOUND. TARGET: AHEAD."  ON [step-out]    -- the first calm step past the landing

## 1. Cross the Skyway
GOAL  reach [cross-skyway] "CROSS THE SKYWAY"                -- 10: the middle of the walk (z -46); wrecks and crates, nothing awake

## 2. Clear the deck   -- the short skirmish halfway
GOAL  destroy deck "CLEAR THE DECK"  WAKE deck                 -- 20: 3 troopers + 2 drones behind three cover rows (z -56, -66, -76)
LOG   "> HOSTILES DESTROYED: 5. SIGNAL: STRONGER. DIRECTIVE: UNCHANGED."  ON DONE

## 3. The far span
GOAL  reach [far-span] "REACH THE FAR SPAN"                    -- 30: through the 4.8 m gap of the barricade at z -93; a 7 m box funnels the player onto the checkpoint
CHECKPOINT [cp-skyway]                                          -- (0, 0, -97): before the fight

## 3.5 CERBERUS
GOAL  wait CUT cerberus-cut "CERBERUS"                          -- 35
ALARM on  ON objective:cerberus-cut                            -- six amber beacons on the parapets; off at beat 4 done
SAY   "UNIT STEM-00. YOUR DIRECTIVE IS AN ERROR. CORRECTION FOLLOWS."  ON cue:voice

## CUT 3.5 CERBERUS  ON objective:cerberus-cut  PLACE (0, 0, -99.5) toward the machine  (12.8 s, skippable)
CAM   behind STEM-00, the deck ahead, the dark east, 2.6 s, shake       -- something is wrong
CAM   low on the deck, the machine's dark mass looming, 2.6 s, shake
CAM   from the west edge, wide: the heads rise, 3.4 s  CUE voice  WAKE cerberus   -- the announcer speaks; it rises (the boss's `rise`)
CAM   VIGIL's eye, close, 2.6 s
CAM   back behind STEM-00 facing it, 1.6 s, control returns

## 4. Destroy the HiveMind  -- scripted to be lost
GOAL  survive 45s "DESTROY THE HIVEMIND"                       -- 40: the heads repair what is chipped; cover for 45 s (rows at z -100 .. -164, N-S walls shield from the east)
-- boss.cerberus [cerberus]: arena x -11.5..11.5, z -166..-92; the survive piece's own `wakeGroup` repeats the cut's wake (a skipped cut still wakes it)

## 5. The fall
GOAL  wait CUT the-fall "THE FALL"                              -- 50
SAY   "CORRECTION: DELETE UNIT STEM-00."  ON cue:charge

## CUT 5. The fall  ON objective:hivemind:done  PLACE (0, 0, -108) toward the machine  (12.6 s, skippable)
CAM   the three heads charge, low behind STEM-00, 3 s  CUE charge, shake
CAM   over STEM-00's shoulder, 1.5 s  CUE volley, shake                   -- the heads glow up together; beams and a blast one and a half seconds later
CAM   high, looking straight down at STEM-00, 1.5 s  CUE break, shake     -- nine deck plates drop out of step (`kit.gate` plain, `on: cue:break`)
        STEM path (0, 0, -108) -> (-0.6, 4, -109) fall                    -- blown up off the deck
CAM   above it, looking down, following the drop past the pier and the lit hoist cable, 4.2 s
        STEM path (-2, -250, -108) fall
CAM   the same, deeper, 2.4 s  FADE 1                                      -- black
        STEM path (-3, -380, -108) fall                                    -- it stays there; the mission completes, the debrief opens
```
Intro cut (11.1 s): `CAM` 0.1 s `FADE 1` (a blink of black: the cut starts clear, the Prologue's fade-out is imitated), then `FADE 0` over 2.4 s on the bridge seen from
58 m up and 18 m south (a top-down establishing shot along the deck), 3.2 s sweeping down along the west edge to look at the drop, 3 s swooping to STEM-00 at the
doorway, 2.4 s behind it looking out at the bridge. The camera stays under 60 m: the night fog ends at 160 m.
Notes for the next edit:
- Fog: `night` fog runs 20..160 m, so anything farther than ~100 m is black. The establishing shot sits close; lit strips (deck lines, window strips,
  pier rungs) carry the readability, not lights (the pool is 4..12 lights).
- Edges: an `env.box` with `hidden: true` (collision only) stands on the deck side of the 1.1 m parapet, 6 m tall (the jet peaks 1.54 above take-off and lands on tops
  up to 1.9, metrics.md). It is no raycast target, so VIGIL's bolts, enemy sight and the camera still see the deck from outside.
- Cover on the breakaway patch would hang in the air after the break: keep the patch (x -6..6, z -102..-114) free of cover.
- The hole's plates are `kit.gate` with `plain: true`; `Registry.check` needs `next: underworks` to be a scene.

## 7. Example: Underworks (`underworks.json`, Act 1's first mission, as built)
Generated by `scripts/build-underworks.mjs` (change the script and run it; the beat sheet below is the source of truth for flow).
```
# UNDERWORKS: SEWER LINE  (loadout: pistol, skin: weathered, sky: night, no NEXT, default debrief)
-- map: [c0] fall chamber (x -6..6, z -10..0, 7 m; a scrap pile under a broken shaft, the spawn on it facing north) -> [t1] culvert north (8 wide, 5 m, 23 m)
-- -> [j] junction (12 x 12; north a sealed hatch, west a niche) -> [t2a] culvert east (11.5 m) -> [t2b] hall (24 x 14, 6.5 m) -> [t3] culvert north (24 m)
-- -> [cistern] (24 x 24, 7.5 m, a pool) -> exit passage -> maintenance shaft (ladder, a violet grate). ~140 m of path, 8 sectors.
-- the water: walkways 2.4 m either side of a 3.2 m channel sunk 0.4 (one step), L-turns at [j] and [t2b]; the player may walk in it. The code has no
-- water surface: the channel is a darker, wet-textured trench.
-- light: almost none. A failing cold lamp per room, the violet shaft in [c0] and [cistern] (the HiveMind's city, far above), an amber lamp (STEM-00's core).

## 0. Wake-up
CUT   wake-up (intro.cinematic, 9.6 s, skippable once seen): a dark wide shot of the pile and STEM-00 slumped in the violet light (3.6 s), then a push-in
      to its visor; the surge at 4.6 s (core and exposure flicker, it rises over 3.5 s)
INTRO "> REBOOT SEQ 0x01" / "FALL: 1,140 M" / "FRAME DAMAGE: 38%" / "WEAPON: KP-12 ONLY" /
      "HIVEMIND LINK: SEVERED" / "DIRECTIVE: DESTROY HIVEMIND"   -- after cinematic:done, 11 s, POV hand-off (SEVERED flickers violet like LOST)
LOG   "> DIRECTIVE: UNCHANGED. ROUTE: UP."  ON intro:done

## 1. First junction
GOAL  reach [junction] "FIRST JUNCTION"   -- 10: the junction at the end of [t1]; the way on is the east culvert (the north hatch is sealed)
LOG   "> WEAPONS LOST: 2. WEAPONS KEPT: 1. QUERY: ENOUGH?"  ON DONE   -- calm: nothing is awake yet
CHECKPOINT [cp-hall]                                                  -- (14, 0, -40), the end of [t2a]

## 2. Hunters   -- VIGIL's seekers; [t2b]'s interior zone is capped at 2.7 m so the drones (3.2+ above the floor) fly the hall under its 6.5 m roof
WHEN  [drones-wake] -- trigger.volume across the hall's west end (x 19..22); WAKE sewer-drones
GOAL  destroy sewer-drones "SEEKER DRONES"   -- 20: 2 dormant drones at the hall's east end, `bounds` = the hall; cover: 3 low rubble blocks, 3 pillars
LOG   "> DRONES DESTROYED: 2. SEARCH TARGET: STEM-00. QUERY: HOW MANY MORE?"  ON DONE
-- the objective is current from the junction on (its pin points at the sleeping drones); the trigger, not the objective, wakes them

## 3. The cistern   -- a fight with the pistol only (gdd 6.5: every fight can be finished with it)
CHECKPOINT [cp-cistern]                                               -- (36, 0, -69), the end of [t3], before the fight
-- supply.repair [sewer-repair] on [t3]'s east wall (the supply rule, gdd 7: no ammo cabinet, the pistol's reserve is infinite)
GOAL  reach [cistern-gate] "THE CISTERN"   -- 30: the mouth of the cistern
GOAL  destroy cistern-troop "CISTERN: HOSTILES"  WAKE cistern-troop   -- 40: 3 troopers behind rubble on the north walkway + 1 drone over the pool
-- player cover: 4 pillars (high), 2 low blocks on the side walkways; the troopers' cover: 3 low blocks across the north strip
LOG   "> FELL: 1,140 M. CLIMBED: 0 M. ROUTE: UP."  ON DONE

## 4. Exit
GOAL  reach [exit] "FIND A WAY UP"   -- 50: the shaft's foot under the ladder; the mission completes (default debrief, no NEXT: the end of what exists)
```
Notes: the drones' `bounds` (the hall, the cistern) are required: the default is the Prologue's yard. Zones: `zone.interior` is full height everywhere but the hall and the
cistern (0..2.7 m: drones fly above them; the view counts a zone 6 m over its top, `VIEW_ABOVE`, so a jet never flips the camera to the outdoor look). Shots, boot lines and the four log lines are in the script.
