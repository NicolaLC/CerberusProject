# Level & lighting

## Level file (`src/levels/*.json`, listed in `scenes.js`)
Plain JSON (an editor can write it), imported by `scenes.js`, validated by `Registry.check`. Layout, enemies and
pickups are data; sky, sun, fog and materials stay in code (`world.js`).
```
{ name, title, tool?, demo?, skin?, loadout?, spawn: { pos, yaw }, interiorZones: [{ min, max }] (older form, may be []; new levels use `zone.interior` pieces),
  pieces: [ { id, pos: [x, y, z], yaw?, params?, name? }, ... ] }
```
- `pieces` is one ordered list; each system builds the ones it owns, in file order. Order matters: boxes are merged
  per material in file order (draw calls, `render.browser.mjs`), enemies fill stands in order.
- `title`: shown in the HUD zone label (outdoors; indoors it reads INTERIOR) and in the panel's scene buttons (top of the start / pause panel).
- `demo: true` (Library): enemies are exhibits: they idle and take hits but never wake, aim, fire or flank
  (`Enemies` hands them a view of the player that reads `dead`).
- `tool`: a Gym room helper from `src/game/gym/tools.js` (`traversal` / `range` / `ai` / `stress` / `library` / `workshop`): readouts, overlays, keys.
  Created after the level loads, disposed before it unloads, `update(dt)` each unpaused frame (system `gymTool`).
- `skin`: a key of `World.skins` (`weathered`), swaps every material key for that skin's material of the same role (same keys,
  same draw calls). Absent = the grid prototype textures. The Gym rooms, Library and Workshop keep the grids (metrics read off
  them); "real" scenes (arena, later the Prologue) use `weathered`. Unknown skin throws.
- `loadout`: the gun ids (keys of `GUNS`) the player owns at the start, e.g. `["pistol"]`. `[]` = unarmed: no gun, no weapon HUD or crosshair, nothing to fire or aim until a `pickup.gun` or an objective `grantGun` (the Prologue). Absent = all six
  (arena, Gym, Library, Workshop). The pistol is always owned even if left out, except for `[]` (unarmed). The rifle is raised if owned, else the first
  owned gun in `GUN_ORDER`; unowned guns start with a full magazine and an empty reserve. Unknown ids fail `Registry.check`.
  Other guns are discovered in play with `pickup.gun` (gameplay.md, Owned guns).
- `spawn.yaw` is the player's initial facing (3.14159 = north, -Z). A `marker.spawn` piece replaces `spawn` as the start (`levelSpawn(level)` in `world/encounter.js`). The boss arena bounds are data of `boss.spider`.
- Add a piece: append `{ "id": ..., "pos": [...], "params": {...} }`. Add a new kind: put a builder in the owning
  module's table (`WORLD_PIECES` / `ENEMY_PIECES` / `PICKUP_PIECES` / `ENCOUNTER_PIECES`) and document the id here. Never rename an id.
- `name` lets a later piece refer to an earlier one (`light.point` `flicker.strip`).

### Piece ids (public contract)
| id | owner | params |
|---|---|---|
| `env.box` | world | `size [w,h,d]`, `mat` (key of `World.mats`), `faces?` `{px,nx,py,ny,pz,nz: mat}`, `cover?` `'low'\|'high'\|'wall'`, `collide?` `shadow?` (default true). `pos` = center x, bottom y, center z. Axis-aligned: no rotation |
| `env.strip` | world | `size`, `mat`, `ownMaterial?` (clone the material; needed to flicker one strip alone). Emissive, no collision, no shadow |
| `env.label` | world | `text` (`\n` for lines; input tokens `{jump}` `{aim}` `{fire}` `{sprint}` `{interact}` `{reload}` show the key / button of the active device, e.g. SPACE / A, repainted only when the device changes, unknown token throws at load), `size?` letter height (0.6), `yaw?` (0 = readable from +Z), `flat?` (on the floor), `color?`, `bg?`. Unlit sign, no collision; own canvas texture, freed on unload |
| `prop.gun` | world | `gun` (key of `GUNS`), `hideOn?` (an `on` form: the model disappears when it happens, e.g. `objective:armoury:done` for a rack that was emptied). The gun's own display model (its `build`, merged to one mesh per material), stock at `pos`, barrel along +Z turned by `yaw`. No collision; freed on unload |
| `prop.console` | world | diagnostic console (props.js): pedestal + angled screen with a scrolling, flickering cyan readout (one shared emissive material, scrolled by texture offset in `World.update`), front +Z at yaw 0. No params. Collision 0.8 x 0.6 x 1.35 (pedestal), not cover. `yaw` in quarter turns |
| `prop.crate` | world | `size` `'small'` (0.8 cube) \| `'medium'` (1.6 x 1.1 x 1.1, flagged `cover: 'low'`, a hop) \| `'large'` (1.6 cube); stencil band front and back, corner posts and rims. Collision = the crate; only medium is cover (cover is 1.1 or 2.8, metrics.md). `yaw` in quarter turns |
| `prop.cables` | world | floor cable bundle from `pos` to `pos + to` (`to` `[dx,dy,dz]` is an OFFSET, not turned by yaw; the editor moves it with the piece), `count` (3, 1..6); ends above the floor sag onto it. No collision |
| `prop.pipes` | world | run of parallel pipes along +X: `length` (4), `count` (3, 1..4), `mount` `'ceiling'` (side by side along Z, hanger rods up `hang` m, 0.4) or `'wall'` (stacked up from `pos.y`, wall face at `pos`, pipes toward +Z), `valves` (1, 0..3, ochre wheels). `pos` = centre of the run at the lowest pipe. No collision: keep it above head height or flush to a wall. Any yaw |
| `prop.puppetRack` | world | storage frame with `count` (3, 3..4) hanging inert puppets (static, puppet ochre / black, no glow), front +Z. Footprint (count x 0.8 + 0.4) x 0.9, 2.8 high: one collision box, not cover. `yaw` in quarter turns |
| `prop.arm` | world | ceiling maintenance arm: `pos` = floor point under the mount, `mount` (5.85) = ceiling height above it; base, two segments, tool head reaching 1.7 m toward -Z (tool ~2.9 below the mount). `retractOn?` (an `on` form): folds up against the ceiling in 2 s when it happens (once; a reload rebuilds it lowered). Moving parts are their own 4 draws, no shadow. No collision. Any yaw |
| `prop.cradle` | world | calibration cradle: a heavy docking frame a unit is stored and serviced in. `pos` = the unit's feet, the unit faces +Z at yaw 0, the frame stands behind it (-Z): sill, uprights, header, a spine with a back rest and a status readout, shoulder clamps, a head brace, three umbilicals plugged into the unit's back, foot clamps. `releaseOn?` (an `on` form, e.g. `cinematic:wake`): the umbilicals drop away, the clamps swing open and the brace pulls back into the spine in 1.4 s (once; a reload rebuilds it closed). `open?` (false): built released and empty (cables hanging). Collision 1.5 x 0.32 x 2.8 behind the unit (local z -0.44..-0.76), not cover; moving parts none. Only a closed cradle with `releaseOn` keeps its moving parts apart (6 draws, no shadow); otherwise it all goes into the batches. `yaw` in quarter turns |
| `prop.gunRack` | world | weapon rack (props.js): a low cabinet whose top (0.95) is the shelf `pickup.gun` pieces with `rack: true` lie on (pos y = rack y + 0.95, yaw = rack yaw + 90 degrees), back board with pegs, a glowing class band along the shelf edge: `ammo` `'light'` (cyan) / `'heavy'` (amber), the ammo cases' colours. `slots` (3, 1..6), 0.95 m each. Collision (slots x 0.95 + 0.34) x 0.54 x 0.95, not cover. Front +Z, quarter-turn yaw |
| `supply.ammo` | world | ammo supply point (props.js, used by `Pickups`): a cabinet (stencil header, cyan screen, class band) with a shelf of ammo cases. The player in reach (1.4 m of the spot 0.95 m in front) gets the HUD interact prompt (`prompt`, default `RESUPPLY AMMUNITION` / `LIGHT ROUNDS` / `HEAVY ROUNDS`); interact refills the owned guns of `ammo` (`'all'` default, `'light'`, `'heavy'`) to their max reserve (`weapon.refill`, toast + pickup sound; all full = AMMO FULL). Unlimited uses (1.2 s apart). Collision 1.36 x 0.8 x 2.4, not cover. Back to a wall, front +Z, quarter-turn yaw |
| `supply.repair` | world | repair station (props.js, used by `Pickups`): the same cabinet with a service arm, umbilicals and a cold white band; interact restores health and shields to full (toast `REPAIRED +n`, pickup sound; full = SYSTEMS NOMINAL). `prompt` (default `REPAIR`). Collision 1.36 x 0.8 x 2.4, not cover. Quarter-turn yaw |
| `prop.bench` | world | workbench with spare parts (steel top, shelf, vice, a spare puppet head and forearm, tool tray, parts bins, coiled cable), front +Z at yaw 0. No params. Collision 1.6 x 0.7 x 0.95, not cover. `yaw` in quarter turns |
| `prop.hazard` | world | floor warning stripes, ochre / dark diagonals (1 m pattern): `size [w,d]` (4 x 1). Flat on `pos.y`, no collision, any yaw |
| `prop.panel` | world | wall warning panel: `text` (stencil caps, `\n` for lines; one material per distinct text, kept for good), `width` (1.4; height follows the text). `pos` = bottom centre on the wall face, faces +Z at yaw 0 (like `env.label`). No collision, no emissive. Any yaw |
| `arch.cove` | world | 45° chamfer strip in a corner (arch.js): `length` (4), `size` leg (0.7), `corner` `'ceiling'` (pos = the wall face at the ceiling, pos.y = ceiling underside, room toward +Z, runs along X) \| `'wall'` (pos = a vertical room corner at the floor, room in the +X / +Z quarter, rises `length`), `light` `'cyan'` \| `'white'` \| `'none'` (a recessed emissive line down the middle). No collision |
| `arch.rib` | world | structural rib / pilaster on a wall face: `height` (6), `width` (0.5), `depth` (0.35); pos = bottom centre on the face, sticking out toward +Z. Plinth, band on the 2.6 trim line, dark slot. Collides as one box flush to the wall, not cover. A rib under the ceiling is a ledge: keep its top out of jet reach (1.9 + the surface jetted from) or run it to the ceiling |
| `arch.panelling` | world | layered wall panelling: `length` (4) along X, `height` (4.6, min 2.8); pos = bottom centre on the wall face, toward +Z. Dark kick band (0.32), inset lower panels with dark seams, metal trim rail at 2.46..2.6, larger upper panels, cap. 0.11 deep, no collision (wall props sit 0.12 off the face) |
| `arch.bulkhead` | world | octagonal surround for a `kit.doorway` (same pos / yaw): `width` (4) / `height` (4) of the opening, `thickness` (0.5) of the wall, `frame` (0.6). On both faces, outside the gate trim and lamp (from width / 2 + 0.3, up from height + 0.32), corner diamonds chamfer the opening and the outline, ochre edges, access plates, a 0.025 sill. 0.14 proud, no collision |
| `arch.floorChannel` | world | flush floor channel / grate (top 0.02, no collision): `size [x, z]` (4 x 0.5), `light` (`'cyan'`: a recessed strip under the bars; `'none'`: a plain grate, e.g. a 1.2 x 1.2 maintenance hatch) |
| `arch.coffers` | world | ceiling beam grid: pos = centre x / z, pos.y = the ceiling underside; `size [x, z]` (8 x 8), `cells [nx, nz]` (2 x 2, whole: beams between cells, none on the edges), `depth` (0.45). Keep the beams off the light fixtures. No collision |
| `arch.catwalk` | world | catwalk on wall brackets: pos = the wall face at the floor, walkway toward +Z, `length` (6) along X, `width` (1.2), deck top `height` (3.4). Grating, railing on the open sides, struts, cyan line under the lip. Scenery, no collision: keep it out of jet reach from decks and props |
| `arch.corridor` | world | interior kit (interior.js) dressing a corridor or room shell the level builds (walls at x = +-width/2 outside, a roof at `height`): pos = floor centre of the entrance, runs `length` (24) toward -Z at yaw 0, `width` (6), `height` (5, min 4.2), bays of about `bay` (3) between rib frames. Wall bays: kick plinth, quilted padding behind a lattice, ochre bumper rail, a machine panel (vent / fan / hatch with a readout, picked per bay from `seed`), plated upper zone in tall rooms, a leaning upper panel, a 45° cornice with a three-tube fixture and halo; ribs (pilaster, knee brace, ceiling beam); ceiling truss + twin ribbed pipes; deck plates with a centre grate; cyan markers. One-offs per bay from `seed` (never tiling): turbine housing, maintenance arm, hoses from the ceiling pipe, and with `props: true` floor crates / a console (real `prop.*` pieces: they collide, crates are cover). `steps` (0) of `rise` (0.25, max 0.45) and `run` (0.6) from `stepAt` (4) m up to a raised deck. `door` [w, h]: panels the end wall around an opening (pair with `kit.doorway` + `arch.bulkhead` at pos.z - length - thickness / 2, y = steps x rise), puts a lamp over it and a light-pool wash on it; `end: true`: a closed panelled end wall with a lamp. `sides` (`both` / `left` / `right` / `none`, looking down the run), `ceiling`, `floor` (true) switch parts; `collide` (true): one box per side 0.45 deep (false where the level's colliders must not change, e.g. the Prologue). Steps / raised deck always collide. ~12-14 draws, ~30-50k triangles for 24 m. Quarter-turn yaw |
| `arch.wall` | world | one wall of the interior kit for rooms, a drop-in for `arch.panelling` (same pos = bottom centre on the wall face, `length` along X, room toward +Z, `height` 4.4): bays of about `bay` (2.6) between thin pilasters. `slim` (true): stays inside the panelling envelope (<= 0.12 off the wall below 2.6 m, <= 0.05 above, where `prop.panel` signs hang at 0.06 and wall props at 0.12), so it swaps for panelling on walls the player hugs or takes cover on; no one-offs. `slim: false`: full corridor depth (0.45) with one-offs. `seed`: panel kinds. No collision. Quarter-turn yaw |
| `arch.ceiling` | world | interior-kit ceiling for a room that already has its ceiling (fits under `arch.coffers`, `arch.cove`, light boxes): pos = centre at the ceiling underside (like `arch.coffers`), `size` [w, l] (l along Z at yaw 0). Everything hangs in one band `drop` (0.58, clears 0.45 coffers and their nodes) to drop + `depth` (0.3) under the ceiling: `pipes` (1, 0..3) ribbed pipes per side with ochre collars `inset` (1.1, clear of 0.7 coves) from the long edges, a centre truss (chords, laced faces, cross ties, X bracing, hanger rods, sagging cable runs), tube fixtures under it (`fixtures`, seeded gaps; they reach ~1 m under the ceiling: off where a jet reaches). `caps`: the pipes end in junction boxes (a run that stops short of a wall, a pipe rack or a hanging prop); otherwise they run 20 cm into the end walls. `seed`. No collision. ~2 draws, ~16k triangles for 9.5 x 18.6 m. Quarter-turn yaw |
| `prop.beacon` | world | rotating alarm beacon on a wall bracket (props.js): `on`? (an `on` form; absent = always running), `off`? (an `on` form). pos = the bracket's foot on the wall face, out toward +Z at yaw 0, lamp ~0.4 out and 0.3 up. Running: the amber lens (`#ff9a2a`, env.alarm's colour) glows and pulses and two additive beam cones turn round (0.9 rev/s); dark and still before. Own meshes / materials in `world.props` (freed with the level), no point light, no collision, any yaw |
| `light.point` | world | `color '#rrggbb'`, `intensity`, `distance`, `flicker?: { strip: name }` (flickers the light, and the named earlier strip). Any number per level; the nearest N by quality tier (4 / 8 / 12) are live, swaps fade (engine.md "Light pool") |
| `kit.floor` | world | `size [w,d]` (4 x 4), `thickness` (0.2), `flush?` (top at `pos.y`, hangs below), `mat` |
| `kit.wall` | world | `length` (4), `height` (7, min 2.0), `thickness` (0.5), `mat`. Cover `wall` |
| `kit.doorway` | world | wall segment with a lintel: opening `width` (4, clamped up to 2.0) and `height` (4, clamped up to 1.8), `length` (width + 6; each wall end >= 0.9), `wallHeight` (7), `thickness`, `mat`. Opening centered on `pos` |
| `kit.gate` | world | a sealed gate for a `kit.doorway` (same `pos` / `yaw`): `closeOn?` (an `on` form: after it, the gate shuts again for good once the player is through; workshop.md "Gates"), `on` (required, an `on` form: `objective:<id>:done`, `trigger:<id>`, `checkpoint:<id>`, `discovered:<gun>`, `start`, `mission:complete`...), `width` (4, up to 2.0), `height` (4, up to 1.8), `thickness` (0.3), `slide` (`up` into the lintel, or `down` into the floor), `time` (1.2 s), `mat` (`high`). A slab with collision, bullets and sight blocked until `on` happens (once per run), then it slides open (`gate:open` { on }) and its collider is parked. Not merged into the static batches. Looks like a door (dark metal, ochre chevron bands, seams, frame trim sized for a 0.5 wall, lamp red -> cyan on open; art-style.md). Inert in the editor and the Library (ghost of its travel). Details: workshop.md "Gates" |
| `kit.stairs` | world | `width` (4), `height` (target top, 1.6), `rise` (0.4; above 0.45 throws), `run` (1.0, min 0.6), `mat`. Climbs toward -Z at yaw 0; `pos` = footprint center. Real rise = height / ceil(height / rise) |
| `kit.ramp` | world | stairs with a fine rise (the code has no slopes: `groundAt` reads box tops): `width`, `height` (1.6), `length` (8, horizontal), `rise` (0.1, max 0.25), `mat` |
| `kit.cover.low` | world | 1.1 high, 1.0 thick; `length` (3, min 1.6, below throws), `mat` (`low`) |
| `kit.cover.high` | world | 2.8 high, 0.6 thick; `length` (2.4, min 1.2, below throws), `mat` (`high`) |
| `kit.pillar` | world | 1.2 x 1.2 x 2.8 high cover; `mat` (`high`) |
| `kit.platform` | world | solid deck, `size [w,d]` (8 x 8), `height` (1.6), `stairs?` `'n'\|'s'\|'e'\|'w'` (attached outside that side, `stairsWidth` 4), `parapets?` `true` or a list of sides (low 1.1 x 0.6, open at the stairs), `mat`, `coverMat` (parapets) |
| `enemy.static` / `enemy.mover` / `enemy.shooter` | enemies | puppets on a stand. `yaw?`; mover: `to [x,y,z]`, `speed`; static / mover `armored?` (bare dark plate steel: only heavy rounds hurt it, light rounds and the pistol spark off, `weapon:armored`) |
| `enemy.trooper` | enemies | cover-using soldier. `yaw?` |
| `enemy.drone` | enemies | `pos` = the ground under it |
| `boss.spider` | enemies | `yaw?`, `arena: { minX, maxX, minZ, maxZ }` (the boss stays inside; wakes when the player enters) |
| `pickup.light` / `pickup.heavy` | pickups | respawning ammo crate of that class |
| `pickup.gun` | pickups | `gun` (key of `GUNS`), `ammo?` (rounds into the reserve; default the gun's crate refill). The gun's display model on a waist-high stand (`yaw` turns it), slow pulsing ring; `rack: true`: no stand and no ring, the gun lies at `pos` (a `prop.gunRack` shelf). Walking within 1.1 m: an unowned gun is discovered (`weapon.grant`, `weapon:discovered`, the gun is raised); an owned one only takes the ammo (stays while that gun is full). Never respawns; the gun model is freed with the item |
| `marker.spawn` | encounter | the player start (`yaw` = facing). Overrides `level.spawn` (first one in the file wins; `spawn` stays required) |
| `marker.checkpoint` | encounter | respawn point after a death once the player has been within 2 m; `name` shows up in `checkpoint:reached` |
| `marker.entry` | encounter | reinforcement entry: `group` (string), `enemies` (list of `enemy.*` / `boss.*` ids) built here when `group` is spawned |
| `zone.interior` | encounter | `size [w,h,d]` (8,4,8). `pos` = centre x / bottom y / centre z. An interior zone (camera exposure, HUD INTERIOR, drones); logic only in play, the Workshop draws a gizmo |
| `zone.sector` | encounter | `size [w,h,d]`, `name`. A sector (room) of the level: see "Sectors" below. Logic only; the Workshop draws a gizmo |
| `zone.portal` | encounter | `size [w,h,d]` (world axes, any yaw ignored). An always-open opening between sectors that is not a `kit.doorway` (a door cut in plain boxes): see "Sectors" |
| `trigger.volume` | encounter | `size [w,h,d]` (4,3,4), `event` ('trigger'), `once` (true), `wakeGroup?`, `spawnGroup?`, `loadout?` (gun ids: entering takes back every other gun, `weapon.setLoadout`: unowned again, full magazine, empty reserve; the pistol stays unless `[]`). `pos` = centre x / bottom y / centre z. Fires `trigger:fired { id, event }` when the player enters (`id` = `name`, else `trigger<n>`) |
| `objective.reach` | encounter | mission objective: `size [w,h,d]` (4,3,4), `trigger?` (a `trigger:fired` / `checkpoint:reached` id that completes it instead of the box). `pos` = centre x / bottom y / centre z |
| `objective.destroy` | encounter | mission objective: `group?` (enemy squad; absent = any enemy), `count?` (absent = all matching alive when it becomes current, plus reinforcements) |
| `objective.survive` | encounter | mission objective: `time` (30 s, above 0) |
| `objective.action` | encounter | mission objective: `action` (required: `jet`, `cover`, `vault` = hop, `slide` = slide vault, `coverRun`, `fire` = a round fired; `ammo?` `'light'` / `'heavy'` only counts guns of that class, never the infinite pistol), `count?` (1, whole, at least 1), `size?` `[w,h,d]` (absent = anywhere; else the move counts only with the player inside, `pos` = centre x / bottom y / centre z). Counts moves made while it is current |
| `objective.interact` | encounter | mission objective: `radius` (2 m, above 0), `prompt?` (text of the HUD interact prompt shown in reach, after the interact key cap, e.g. `TAKE KP-12 EMBER`; default `INTERACT`), `promptAt?` [x,y,z] (world point the prompt floats over, e.g. the gun on its rack; default 1.3 m above `pos`): the player alive within it (2.5 m vertical) presses interact (G) |
| `log.line` | encounter | a STEM-00 log line (#40): `text`, `on` (start, `intro:done`, `cinematic:wake`, `cinematic:done`, `trigger:<id>`, `checkpoint:<id>`, `objective:<id>`, `objective:<id>:done`, `discovered:<gun>`, `mission:complete`, `cut:<name>`, `cut:<name>:done`, `cue:<name>`), `priority?` ('normal' / 'high'), `once?` (true), `voice?` ('stem' / 'announcer'), `delay?` (s, 0). STEM-00's lines are never shown in a fight (wait 3 s out of combat); an `announcer` line (the HiveMind PA) is shown at once, replaces the line on screen and is styled apart. Logic only in play; the Workshop draws an amber screen gizmo. Writing rules: narrative.md |
| `env.alarm` | encounter | the alarm lighting state (#14): `on` (same forms as `log.line`), `off?` (same forms), `duration?` (s; absent = until `off` or the level unloads), `color?` ('#ff9a2a', amber), `strength?` (0.4, mix 0..1), `siren?` (true). When `on` happens the light (haze, fog, hemisphere, sun, point lights) fades to `color` and pulses, and a siren loops (low horn, `alarm-siren.mp3`); ends at `off` / `duration` / unload. Once per run. Logic only in play; inert in the editor and the Library (gizmo: a beacon on a post). Rules: workshop.md "Alarm" |
| `intro.boot` | encounter | the boot intro (#13): `lines` (list of diagnostic strings, at least one), `duration?` (s, 12, above 0, at most 20), `skippable?` (true), `after?` (an `on` form, e.g. `cinematic:done`: the boot waits for it). At play start (or `after`) a full-screen overlay (black, static, scanlines, typed lines, `HIVEMIND LINK: LOST` flickers violet-magenta, then a fade-in with an exposure ramp) locks the input and ends with `intro:done`. Skip only after it was seen once. The first one in a file plays. Inert in the editor and the Library (gizmo: a monitor on a post). Rules: workshop.md "Boot intro" |
| `cinematic.cut` | encounter | a mid-level cut: `on` (an `on` form), `shots` (as `intro.cinematic`, plus per shot `cue?` (fires `cue:<name>`) and `wakeGroup?`), `place?` { pos, yaw? }, `skippable?` (true). Camera only, input locked, enemies hold fire, HUD hidden but the log; fires `cut:<name>` / `cut:<name>:done`; an `objective.reach` with `trigger: <name>` completes at its end. Rules: workshop.md "Mid-level cut" |
| `intro.cinematic` | encounter | the intro cinematic: `shots` [{ `from`, `to?`, `look`, `lookTo?`, `time`, `ease?` (linear / inOut), `fov?`, `shake?` }] (world-space camera anchors), `wake?` { `at`, `rise`, `shake` } (STEM-00's surge and rise from the dormant slump), `skippable?` (false). Plays at play start, locks input, ends with `cinematic:done` (pair it with an `intro.boot` `after: cinematic:done`). The first one in a file plays. Inert in the editor and the Library (gizmo: a camera and its path). Rules: workshop.md "Intro cinematic" |

Every `objective.*` also takes `text` (HUD objective panel header), `detail?` (the panel's instruction; input tokens like `env.label`), `order?` (mission order; absent = position among the objectives), `limit?` (s to finish it, else the mission fails), `wakeGroup?`, `spawnGroup?` (run when it becomes current). Rules: workshop.md "Missions".

Encounter pieces are logic only in a played level (no geometry, no collision); the Workshop draws gizmos for them (workshop.md, Encounters).
Every enemy piece also takes `params.group` (string): enemies of one group wake together. `params.dormant` (bool, default false; needs a `group`): the enemy never wakes itself and a shooter never fires, but it takes hits; only `wakeGroup` wakes it. `params.dropGun` (+ `dropAmmo?`, `dropOnce?` true): it leaves that gun as a pickup when destroyed unless the player owns it (workshop.md, Spawn groups). Objectives also take `grantGun` / `grantAmmo` / `skipOn` (workshop.md, Missions).

**Prop rules** (`world/props.js`, art-style.md "Props"): primitives in the permanent `World.dressing` materials; each piece is merged per
material (`mergeGroup`) and its meshes go into `World.staticMeshes`, so a level's props cost one draw per material in its batches (no extra
shadow draw). Collision is a hidden `World.box` kept in `world.props` (freed on unload / despawn); pieces with one take quarter-turn `yaw`
(`rotationKind` 'quarter' in the Workshop), the rest any yaw. `prop.arm` and `prop.cradle` are the only moving props (`world.props`, `animateProps`; `world.react` starts them).
**Consoles** face their operator: the screen side is where an operator stands, and the operator looks over the console toward what it monitors (in a cell: the cell; in the calibration bay: the rack). Never a screen facing a wall the operator would stare at.

**Arch rules** (`world/arch.js`, `world/interior.js`; art-style.md "Architecture", "Interiors"): `arch.*` break the box silhouette of kit rooms without changing their collision.
Every part is baked to world space with world UVs (panel textures line up with the walls) and merged per material in the materials the level
already draws (skin `roof` / `inWall`, the props' `metal` / `dark` / `ochre`, `stripCyan` / `stripWhite`); nothing casts a shadow (interiors are
roofed), so the props' materials get one non-casting bucket each per chunk. Decorative parts may take any angle (45 degree chamfers); `arch.rib` is
the only collider (axis-aligned, flush to the wall). Every `arch.*` takes `yaw` in quarter turns (`rotationKind` 'quarter'). Light lines are emissive
strips, never new point lights.
**No coplanar faces** (props, arch, kit trims, decals): two visible faces in one plane, facing the same way, z-fight (saw-tooth flicker), and a gap under ~2 mm still does at range (24-bit depth, near 0.05: ~1 mm resolution at 30 m). A part laid on, in or against another sits >= 1 cm off it (decals up, plates out) or stops >= 1 cm inside it (beam ends, rails between posts, beds under rims); a different material in the same plane is the worst case. Same material with world UVs (kit / env / arch) shades identically and cannot show; props map their own UVs, so it can.

**Kit rules** (`world/kit.js`, sizes from `metrics.md`, frozen): boxes only, built through `world.box`. `yaw` must be a
multiple of 90 degrees (else a clear error), so every piece stays axis-aligned. Bad params throw `kit.x: ...`. One material
key per role (floor / wall / low / high / platform), overridable per piece with `params.mat` (a key of `World.mats`):
the hook for region skins.

### Piece meta (Library convention)
A registry table entry may be `{ build, ...meta }` (read with `registry.meta(id)`). Three metas feed the Library and the Workshop:
- `example: { params, yaw? }`: what the Library spawns for the id (it must build with just these and `pos`).
- `label`: one short line of key stats (HP, ranges, respawn...), read from the owner's `TUNING` where there is one.
- `fields` (Workshop inspector, workshop.md): the editable params, `[{ key, type, label?, options?, min?, optional?, def? }]`. `type`: `number`, `vec2` / `vec3`
  (typed "a, b, c"), `text`, `bool` (checkbox; `def` = value when absent), `enum` (`options` list, or `'mats'` = keys of `World.mats`; a fixed `options` list is also checked by `Registry.check`), `list` (comma separated strings; `sep: '|'` changes the separator, for texts that contain commas: `intro.boot` `lines`).
  `optional: true` = empty removes the key. `check(params, registry)` (optional): returns a problem string or null; `Registry.check` throws it for every piece of that id in a level (`log.line`, `intro.boot`). `min` is a generic floor (the builder's own checks still win and surface as a toast). `key` is a top-level `params` key.
  Shared fields live next to the owner (`MAT` in `kit.js`, `GROUP` in `enemies.js`). Pieces without `fields` (or whose params are not listed) show only `name`.
Every entry has `example` and `label` (enemies, pickups, `kit.*`, `env.*`, `light.point`, `prop.*`); new entries must too. A new id with an `example` shows up in the Library's kit aisle by itself
(`tool: library`, gym.md); `tests/library.browser.mjs` spawns every id from its example.

Interior zones (camera exposure) are `zone.interior` pieces. The top-level `interiorZones: [{ min, max }]` of older files (arena) is still read by `World`; the Workshop converts it to pieces on open. Dropped clips are runtime, not data.

## Sectors (`src/game/world/sectors.js`)
Rooms are drawn only when the camera can see into them, built when the player comes near and freed when far behind. Opt in per level: a level
without `zone.sector` pieces builds everything at load and draws exactly as before (one implicit sector, chunking unchanged).
- **Data**: `zone.sector` boxes (pos = centre x / bottom y / centre z). **Run each box to the centre line of its walls** (adjacent rooms touch on the
  shared wall's centre, an exterior wall's outer face is outside the box) and from below the floor into the roof slab. Space in no box is OUTSIDE.
  Portals: every `kit.doorway` (gated by the `kit.gate` on the same pos: open while opening / open / closing) and `zone.portal` boxes (always open).
  A portal joins the sectors 0.3 m off its two faces along its thin axis. At most 29 sectors (three.js layers).
- **Drawn**: roots = the sectors of the camera and of the player; then portal culling: through every open portal whose screen rectangle overlaps the
  rectangle its sector is seen through (narrowing door after door). Static batches are merged per material per **sector mask** (every box a mesh reaches
  into, plus OUTSIDE when a point off one of its faces is in no box: exterior walls, roofs) and put on three.js layers (0 = always, 1 = OUTSIDE,
  i + 2 = sector i); the camera's layers = 0 + the visible set, so the colour and the shadow pass skip hidden rooms with no per-object work. Props,
  labels, gate dressing and lamps, level pickups are tagged the same way at load (raycast targets stay on layer 0); a shut gate slab is shown while
  one of its rooms is. Dormant enemies in hidden sectors are hidden and asleep (enemies.js `cull`). No occlusion inside a sector.
- **Built on approach**: pieces whose registry meta `defer(params)` is true (render-only: `arch.*` dressing, `arch.corridor` without `props`,
  `prop.pipes` / `cables` / `hazard` / `panel`) and whose pos lies in exactly one sector box are built with their sector, not at load. Load builds the
  spawn's sector and its neighbours; then each frame up to 3 ms of building goes to sectors one portal from a root (shut gates count: the next rooms
  are ready before their gate opens; `arch.corridor` builds in 250-part steps, `meta.steps`), and the merged sources are dropped (the level data
  rebuilds them). A visible sector not built yet is built at once (never missing). A sector more than 2 portals away, or cut off by a gate closed
  for good (`kit.gate` `closeOn`), is freed (batches, pieces, their colliders). Everything else (colliders, cover, lights, enemies) is built at load.
  The shader warm-up compiles every permanent material (`World.warmMeshes`), so a late sector compiles nothing.
- The Prologue: 11 sectors (`c1`..`c6`, `range`, `drill-hall`, `pen`, `building`, `transit`), three `zone.portal` (hall exit, the building's two doors); the
  apron, field, forecourt and boss arena are OUTSIDE (the open-topped arena is seen over its walls). Edited by script (`serializeLevel`).

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
- Test: `tests/levelio.test.mjs` (`bun run test`) round-trips every `src/levels/*.json` with the real `Registry` and piece tables.

## Scenes (`src/game/scenes.js`)
| name | file | content |
|---|---|---|
| `arena` | `arena.json` | the training arena (tests open it with `?scene=arena`) |
| `gym` | `gym.json` | Gym: traversal and cover room (#64) |
| `gym-range` | `gym-range.json` | Gym: weapon range room (#65) |
| `gym-ai` | `gym-ai.json` | Gym: enemy behaviour rooms (#66) |
| `gym-stress` | `gym-stress.json` | Gym: performance stress room (#67) |
| `library` | `library.json` | the Library (#68), `demo` + `tool: library`: aisles of enemies, guns, cover / environment, pickups, light presets and the kit aisle (gym.md, Library) |
| `prologue` | `prologue.json` | PROVING GROUNDS (#2), the default scene (no `?scene` = this; a new game opens the boot intro): the arena layout and metrics, `loadout: []` (unarmed: the KP-12 Ember waits on the bench in cell 1), `marker.spawn` on a calibration rack (`kit.platform` + `env.label` CALIBRATION / UNIT 00 beside the cradle) facing the yard, `intro.cinematic` (`wake-up`, STEM-00 powers up) then `intro.boot` (`after: cinematic:done`), two `log.line`s, a `trigger.volume` (`bay-exit`) and the calibration chain C1-C6, the **weapons range** (west of C6, x -71.5..-51, z 20.5..41.5, sector `range`, `range-kit` corridor dressing: two `prop.gunRack`s lending all five non-pistol guns, cyan / amber `supply.ammo` crates, seven `range` puppets of which three `armored`, a firing counter; objectives `range-light` / `range-heavy` (fire a light / a heavy gun), out through `range-exit-gate` onto the hall landing where the `range-return` trigger takes the guns back; the old bay door stays sealed), the objective LEAVE CALIBRATION BAY, then the purge (#14): a chain of ordered objectives (explicit `order` 10..110) that wakes the dormant groups `purge-1`..`purge-6` one stage at a time, four `marker.checkpoint`s, an `env.alarm`, an announcer line and two STEM-00 lines. Yard (#5) is the **drill hall** (level-design.md section 5): a roofed sunken lane x -50..-32, z 29.5..-20.5 (landing 0, upper tier -0.8, lower tier -1.6, roof 7.4; floors below 0 need `World.groundAt`'s any-height ground) with the `purge-cut` cut, three `prop.beacon`s, the pen gate and the troop `purge-1`; the old open field is walled off, an outdoor apron along the facade leads to the hall doors and the gate. The Warden armoury (#93): `armoury` (`order` 60, interact at a rack against the west wall of the hall, optional via `skipOn`) sits between `purge-hall` (50) and `purge-troopers-hall` (80); the drill hall troopers (`purge-1`) and the `purge-4` troopers carry `dropGun: rifle` as the fallback. The late armoury step (95), the sealed `exit-gate` in the arena's north wall and the last objective REACH TRANSIT NODE (120, `requiresGun: rifle`) end the mission (#15). Chain table: workshop.md "Prologue purge". Calibration bay dressing (`prop.*` pieces at the end of the file, along walls and corners, clear of every station and gate): the `bay-arm` over the rack (`retractOn: intro:done`), STEM-00 in `cradle-00` (`prop.cradle`, `releaseOn: cinematic:wake`) on a worn deck patch, `rack-01` (a 0.4 m deck on the east side) with the empty open `cradle-01` and its CALIBRATION UNIT 01 plate (Sable's, gdd.md 2), an operator station of three consoles north of the rack facing north (the operator looks south over them at the cradle), a workbench in the north-west corner, a gantry (two `env.box` beams and a hoist) under the roof, consoles in every cell facing their operator, cables, a puppet rack on the east wall of cell 0, crates (medium none: no extra cover), ceiling / wall pipes per cell, warning panels, hazard stripes at every gate threshold; no lights added. Architecture (`arch.*`, after the props): every room has lit ceiling coves (cyan), 45 degree corner chamfers, panelling on every wall face, ceiling coffers between the light fixtures, ribs every 3-4 m along walls (none in the station spaces; two deep ones frame the cell 2 console as an operator niche with a header and down light), bulkheads on all six bay doorways, lit floor channels flanking the gate path in every cell, the C5 lane and the exit, four floor hatches, and a catwalk along the north wall of cell 0 (3.4 m, decor). Calibration rooms C1-C6 wear the full interior kit (`c1-kit`..`c6-kit`, `arch.corridor` with `collide: false`, so colliders and metrics are unchanged): each runs from its entry wall to its exit wall (C1-C3, C5, C6 toward -X, C4 toward -Z) with the pipe-truss ceiling, a lit end wall (`door` around the exit, `end` where the exit is in a side wall) and, except C1, the decked floor with its centre grate; deep wall bays only on walls with nothing on them (C2 / C3 south, C5 north and C6 south between x -34.25 and -43.7 via the extra `c5-kit-north` / `c6-kit-south` pieces); walls with signs, props, crowded cover, doors, and all of C1 (cradle / console area) keep the slim `arch.wall`. The coffers, ceiling coves, ceiling pipes and floor channels they replaced are gone; hazard stripes in decked rooms sit at y 0.04, signs on the new end walls stand 0.12 (door wall) / 0.2 (closed wall) off the wall. Re-dress by script: load the JSON, edit `pieces`, write with `serializeLevel`. Edited in the Workshop from now on |
| `workshop` | `workshop.json` | the level editor (`tool: workshop`, workshop.md): a small starter level, floor, three cover boxes, a static puppet and an ammo crate (Workshop epic #60) |

- `prologue.json` is the Workshop's output (`serializeLevel`, byte-identical: `levelio.test.mjs`): change it in the Workshop and save, never by hand.
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
  Main hall has a roof skylight (x -10..-2, z -50..-42). East room has a failing, flickering cyan strip (red light only
  where a story beat calls for it: a Rejects or alarm room).
- North-east boss arena x 24.3..50, z -62..-14 (spider mech): fenced from the range by a 3.2 m wall at z=-14 with a
  gate at x 37..42.5 (lit lintel strip), open to the west lane along the building. Six freestanding 3.2 m concrete
  walls and three low blocks as cover, ammo crates at the gate (28, -17) and at the back (47, -60).
- Walls flagged `{ cover: 'wall' }`: building outer walls and partition, range separator, arena walls.

## Materials
- Prototype grid textures from `gridTexture()`: 1 tile = 2m, 1m checker, 25cm lines, optional label.
- Colors: orange = low cover, blue = high cover, light gray = walls, gray = floor; interior variants are dark.
- Weathered skin (`skin: "weathered"`, arena): `panelTexture()` metal panels per 2 m tile (1 m seams, rivets, oil streaks,
  soot, scratches), one tint per role: low cover a warm barrier khaki, high cover a grey-green (painted hues the blue-grey floor and walls never use, so cover reads as cover), interiors darker.
- UVs are world-space (`applyWorldUVs`) so grids and panels align everywhere; per-face materials via `faces()`.

## Lighting
- Sun: directional, shadow map 4096 over ±48m, follows the player (snapped to 2m). Direction `SUN_DIR`.
- Sky (art-style.md): teal-cyan haze, gradient dome shader with the sun a cold smear, heavy fog of the haze colour (22..210 m),
  cold sun and teal hemisphere fill. Shared by every scene. ACES tone mapping.
- Point lights: any number of `light.point` records; a fixed pool of N real lights in `World` (N by quality tier) shows the best N for the camera, so the light count never changes (engine.md "Light pool").
- Interior: darker albedo than outside (but readable), 8 point lights incl. fills; cold white and cyan only (red is for story
  beats), emissive strips, flicker via `pointLight(..., { strip })`.
- Exposure adaptation in `game/view/post.js`: 1.0 outside, 1.9 when the camera is inside an `interiorZones` box.
