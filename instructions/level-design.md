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
| `GOAL wait CUT` | `objective.reach` with `trigger: <cut name>`: the chain waits for the cut's end |
A skip still fires every CUE / WAKE not reached. The camera path must stay clear of walls (no collision on scripted shots).

## 5. Example: the Prologue (`prologue.json`, as built)
```
# PROVING GROUNDS  (loadout: none (unarmed), skin: weathered, sky: night)
-- map: calibration rack [rack] at (0, 1.6, 45) in cell 1, the calibration rooms C1-C6 running west, the weapons range west of C6,
-- the drill hall south of it, the supply corridor, the building (halls A / B), the boss arena (the only open sky),
-- transit node behind [exit-gate] in the boss arena's north wall. 14 sectors (level.md "Sectors").

## 0. Boot
CUT   wake-up (intro.cinematic, 9.5 s: over the operator's shoulder, the surge at 2.4 s releases [cradle-00], push-in to the visor)
INTRO "> BOOT SEQ 0x00" / "FRAME: STEM-00 / SERIAL 0" / "MOTOR CORE: NOMINAL" /
      "WEAPON: NONE" / "HIVEMIND LINK: LOST" / "DIRECTIVE: NONE"   -- after cinematic:done, POV hand-off
LOG   "> LINK: NONE. DIRECTIVE: NONE. QUERY: WHY?"  ON intro:done

## 1. Calibration   -- one room per step, each gate opens on the step's done and shuts behind (closeOn); orders 10-17
GOAL  reach [c1-move] "CALIBRATION 01: LOCOMOTION"                 -- 10; CHECKPOINT [cp-c2] past [c1-gate]
GOAL  interact [c2-arm] "CALIBRATION 02: ARM"  GIVES pistol         -- 10.5: the KP-12 on the bench (prompt TAKE KP-12 EMBER)
LOG   "> ITEM: KP-12. FUNCTION: CALIBRATION. QUERY: CALIBRATE WHAT?"  ON DISCOVER pistol
GOAL  destroy calib "CALIBRATION 02: TARGETING"                     -- 11: three static targets (count 3)
GOAL  reach [c3-jet] "CALIBRATION 03: VERTICAL THRUST"             -- 12: the exit is on a 1.6 m ledge; CHECKPOINT [cp-c4]
GOAL  action cover "CALIBRATION 04: TAKE COVER"  WAKE calib-shooter -- 13
GOAL  destroy calib-shooter "CALIBRATION 04: RETURN FIRE"           -- 14
GOAL  action vault "CALIBRATION 05: VAULT"                          -- 15 (hop)
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
GOAL  destroy purge-1 "PURGE: DRILL HALL"   -- 4 shooters on posts, 3 troopers + 3 drones from the pen; nobody drops anything
-- the KR-7 waits on a stand on the landing [landing-rifle], in the path from the range exit to the cut: the first fight has two guns

## 4.5 Supply corridor   -- hall exit -> east 22 m -> north 9 m -> the building's west door; interior kit, two sectors (supply-a / supply-b)
LOG   "> SUPPLY POINT: STOCKED. ROUNDS, REPAIR. QUERY: STOCKED FOR WHOM?"  ON [supply-in]
-- supply.ammo (all classes) and supply.repair against the south wall: the only rounds and repairs of the level

## 5. Purge: hall
GOAL  destroy purge-2 "PURGE: HALL SHOOTERS"  WAKE purge-2   -- detail tells the player to resupply first ({interact})
LOG   "> TARGETS: ARMED. DIRECTIVE: STILL NONE. QUERY: WHO ARMED THEM?"  ON DONE
CHECKPOINT [cp-hall], [cp-hall-east]

## 6. Armoury (optional)
GOAL  interact [armoury] "SALVAGE A WEAPON"  GIVES rifle +64  SKIP IF [armoury-skip]  SKIP IF OWNED rifle
-- [armoury-skip]: in front of [arena-door] in hall B: walking on toward the arena without the Warden skips it
LOG   "> ITEM: KR-7. FUNCTION: KILL. QUERY: WHY DOES IT FEEL HEAVY?"  ON DISCOVER rifle

## 8. Purge: hall troopers
GOAL  destroy purge-4 "PURGE: HALL TROOPERS"  WAKE purge-4   -- two troopers, dropGun rifle +64 (once, unless owned)
LOG   "> HOSTILES DESTROYED: 15. ORDERS RECEIVED: 0. SOURCE: UNKNOWN."  ON DONE


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
CAM   low, looking up: the SX-6 leaps off hall B's roof, over STEM-00, 2.4 s  WAKE purge-6  LEAP purge-6 -> (30.5, 0, -57)
CAM   it lands between STEM-00 and the exit, 2 s, shake
CAM   the rush turns and runs out through [arena-far-gate], 3.4 s  CUE recall  RECALL arena-rush -> far gate -> out
CAM   back behind STEM-00 facing the SX-6, 1.8 s
-- the cut's end (or a skip) settles it: the SX-6 is down at its landing spot, the recalled robots are gone, the far gate shuts (shutOn)

## 11. Purge: boss
GOAL  destroy purge-6 "PURGE: SX-6 TARANTULA"   -- woken by the cut
ALARM off  ON DONE
OPEN  [exit-gate]
LOG   "> SX-6: DESTROYED. GATE: OPEN. QUERY: WHO OPENED IT?"  ON DONE

## 12. Exit
GOAL  reach [exit] "REACH TRANSIT NODE"  NEEDS rifle
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
