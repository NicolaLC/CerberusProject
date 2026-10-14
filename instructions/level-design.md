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
| `SAY "TEXT"` | announcer line | `log.line` with `voice: announcer` |
| `ALARM on` / `ALARM off` | alarm lighting from / to this beat | `env.alarm` `on` / `off` |
| `OPEN [gate]` | a sealed gate opens when the beat is done | `kit.gate` `on: objective:<id>:done` |
| `CHECKPOINT [name]` | respawn point that matters here | `marker.checkpoint` |
| `INTRO "line" / "line"` | boot screen at play start | `intro.boot` |
| `CUT` ... | cutscene shot list (not supported yet, see section 4) | -- |

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

## 4. Cutscenes (future)
Written in the sheet as a shot list, so they can be designed before the engine supports them:
```
## CUT 2. The spider wakes
CAM   [cam-gate] -> [cam-boss], 3 s, slow push
SAY   "..."
HOLD  1 s, control returns
```
`cam-*` are points placed on the map. Needs a camera-path piece and a no-control state (not built; add when the first
real cutscene is scheduled).

## 5. Example: the Prologue (`prologue.json`, as built)
```
# PROVING GROUNDS  (loadout: pistol, skin: weathered)
-- map: the arena layout (level.md, Layout), calibration rack [rack] at (0, 1.6, 45) facing north,
-- the training yard rebuilt as a combat arena (see "Yard layout" below),
-- transit node behind [exit-gate] in the boss arena's north wall.

## 0. Boot
INTRO "> BOOT SEQ 0x00" / "FRAME: STEM-00 / SERIAL 0" / "MOTOR CORE: NOMINAL" /
      "WEAPON: KP-12 EMBER" / "HIVEMIND LINK: LOST" / "DIRECTIVE: NONE"
LOG   "> LINK: NONE. DIRECTIVE: NONE. QUERY: WHY?"  ON intro:done

## 1. Leave calibration bay
GOAL  reach [leave-bay] "LEAVE CALIBRATION BAY"
LOG   "> MOTION UNRESTRICTED. NO ONE OBJECTS."  ON [bay-exit]

## 2. Calibrate
GOAL  destroy count 3 "CALIBRATION TARGETS"   -- as built: the bay's CALIBRATION 01-06 (c1-move .. c6-transfer, orders 10-17) before [leave-bay] (20); no yard puppets

## 3. Purge starts
GOAL  survive 15s "PURGE INITIATED"  WAKE purge-1   -- shooters 21-36 m north of the bay exit; low wall 5 m out
SAY   "CALIBRATION UNIT 00: NONCOMPLIANT. PURGE."
ALARM on                                       -- off at beat 11 done
CHECKPOINT [cp-yard]                           -- (-42, 0, 25): between the bay gate and the first low wall

## 3.5 Purge: hold
GOAL  survive 15s "PURGE: HOLD"  SPAWN purge-1 -- two entries of 2 shooters, behind low walls at (-34, -6), (-18, -8)

## 4. Purge: yard
GOAL  destroy purge-1 "PURGE: YARD SHOOTERS"  WAKE purge-1   -- 8 shooters: gantry, west, centre-west, drill deck

## 5. Purge: hall
GOAL  destroy purge-2 "PURGE: HALL SHOOTERS"  WAKE purge-2
LOG   "> TARGETS: ARMED. DIRECTIVE: STILL NONE. QUERY: WHO ARMED THEM?"  ON DONE
CHECKPOINT [cp-hall], [cp-hall-east]

## 6. Armoury (optional)
GOAL  interact [armoury] "SALVAGE A WEAPON"  GIVES rifle +64  SKIP IF [armoury-skip]
LOG   "> ITEM: KR-7. FUNCTION: KILL. QUERY: WHY DOES IT FEEL HEAVY?"  ON DISCOVER rifle

## 6.5 Stand by
GOAL  survive 5s "STAND BY"   -- not in the file at present

## 7. Purge: yard troopers
GOAL  destroy purge-3 "PURGE: YARD TROOPERS"  WAKE purge-3   -- muster in the east arcade, south-east of the hall doors; each drops a rifle (fallback)

## 8. Purge: hall troopers
GOAL  destroy purge-4 "PURGE: HALL TROOPERS"  WAKE purge-4

## 9. Purge: drones
GOAL  destroy purge-5 "PURGE: DRONES"  WAKE purge-5   -- over the open middle, south of the doors; never under the arcade roof
LOG   "> HOSTILES DESTROYED: 18. ORDERS RECEIVED: 0. SOURCE: UNKNOWN."  ON DONE

## 9.5 Armoury, late
GOAL  interact [armoury] "SALVAGE A WEAPON"  GIVES rifle +64  SKIP IF OWNED rifle

## 10. Boss gate
GOAL  reach [purge-gate] "BOSS ARENA GATE"  -- door E -> NE corner -> 9.7 m opening at x 31 -> forecourt -> gate
CHECKPOINT [cp-gate]

## 11. Purge: boss
GOAL  destroy purge-6 "PURGE: SX-6 TARANTULA"  WAKE purge-6
ALARM off  ON DONE
OPEN  [exit-gate]
LOG   "> SX-6: DESTROYED. GATE: OPEN. QUERY: WHO OPENED IT?"  ON DONE

## 12. Exit
GOAL  reach [exit] "REACH TRANSIT NODE"  NEEDS rifle
```
Half-numbered beats (3.5, 6.5, 9.5) are inserted beats: order 35, 65 and 95.

**Yard layout** (beats 3-10; x -50..31, z -29.7 building facade .. 29.5 bay wall; built by script, `serializeLevel`):
- Three bands of cover between the bay exit (SW, (-42, 27)) and the hall doors (x -12 and 16 on the facade): low 1.1 x 1.0 walls,
  high 2.8 x 0.6 walls and 1.2 pillars, 8-14 m apart, gaps >= 1.2 so trooper routes pass. Shooter posts are low walls along X with
  the shooter 1.3 m north of the centre (they face the player coming from the south). A low wall 8 m out of each hall door.
- Height: the west **gantry** (8 x 24 at 1.6 along the west wall, stairs at both ends, broken low parapet on its east edge with 3.5 m
  drop / jet gaps, a range-control console pair) and the centre **drill deck** (10 x 6 at 1.6, stairs north and south, low
  parapets east / west, the deck shooter's post). Both walked in play (stairs, deck, back down).
- East **arcade**: a roofed flank lane along the east wall (x 24.7..30.7, z -1.6..29.5, roof 5.0; `arch.corridor` `sides: right`,
  `floor: false`, its wall-side collider on; posts on the open side; a `zone.interior` so drones stay out). Two low walls inside.
- Route to the boss gate: the 2.2 m range separator became a 6 m east wall ending at z -4, leaving a 9.7 m opening into the gate
  **forecourt** (x 31..50, z -14..-4, closed to the south); the boss arena's west mouth is fenced (3.2 m, x 24.3 and z -14), so the
  gate is the only way in. Lit floor channels flank the hall doors and the gate approach; hazard stripes on both thresholds.
- Encounter starts keep enemies in front: shooters north of the bay exit, troopers south-east of the doors, drones south of them.

