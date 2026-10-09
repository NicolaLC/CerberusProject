# Level metrics

**Status: DRAFT (not frozen).** Awaiting owner approval; do not build kit pieces or levels on it yet. Once approved, change
this line to `FROZEN <date>` and apply section 9. Code wins over docs on every number; this file only collects them.
All units metres, +Y up, floor y = 0. Source column: `file:SYMBOL` (paths under `src/game/`). Tags: **code** = read from
code, **derived** = computed from code numbers (formula given), **proposed** = recommendation for the owner to approve,
**gym** = open, listed in section 8.

## 1. Grid
| Item | Value | Source |
|---|---|---|
| Visual grid | 1 tile = 2 m, 1 m checker, 25 cm lines, world-space UVs | `world/textures.js:gridTexture`, `world.js:applyWorldUVs` |
| Geometry | Axis-aligned boxes only (collision, cover, shadows depend on it); no slopes, no rotated boxes | `world.js:World` header, `groundAt` |
| Horizontal snap (proposed) | 0.5 m for positions and sizes; 0.1 m for thicknesses (existing: walls 0.5 / 0.6, blocks 1.0 / 1.2) | -- |
| Vertical snap (proposed) | 0.1 m; the named heights below are fixed and override the snap | -- |
| Named heights (code) | LOW 1.1, HIGH 2.8, step 0.4, platform 1.6, door 4.0, building wall 7.0, perimeter 6.0 / 8.0 | `world.js:#buildLevel` (`LOW`, `HIGH`, `PH`, `WH`) |

## 2. Player
| Item | Value | Source |
|---|---|---|
| Capsule radius | 0.4 (body 0.8 wide) | `actors/player.js:TUNING.radius` |
| Height | stand 1.8, crouch 1.05 (collision always uses 1.8) | `TUNING.standHeight/crouchHeight`, `#collide` |
| Eye height | stand 1.62, crouch 1.08 | `Player.eyeHeight` |
| Chest / shoulder aim point | 0.7 x height = 1.26 stand | `Player.chest` |
| Step height | 0.45 (a box whose top is <= feet + 0.45 is walked over) | `TUNING.stepHeight`, `world.js:collideCircle` |
| Speeds | walk 4.6, sprint 7.4, aim walk 2.6, cover slide 3.2; MG firing 2.2, railgun firing 1.6 | `TUNING`, `guns.js:fireMoveSpeed` |
| Camera distance | normal 3.4, aim 1.9, sprint 3.9, scope 1.5, railgun 1.9, boss framing +1.1 | `view/camera.js:TUNING.dist`, `guns.js:zoom` |
| Camera side offset | 0.85 (aim 0.95, peek 1.05), pivot = eye height, camera +0.15 up | `camera.js:update` |
| FOV | normal 70, aim 50, sprint 78, slide +8, scope 24, railgun 42 | `camera.js:TUNING.fov` |
| Pitch limits | -1.25 (look down) .. +1.1 rad | `camera.js:look` |
| Camera collision | ray pivot -> camera against all level boxes, pulled in to hit - 0.25 (min 0.2 from the pivot) | `camera.js:update` |
| Jetpack burst | thrust 0.22 s to 5.5 m/s, then gravity 17.6; peak 1.46 above take-off; airtime 0.94 s; cooldown 0.9 s | `player.js:JET`, `TUNING.gravity` |
| Jet horizontal distance | stand-still ~3.6, walking ~4.7, from a sprint ~5.4 (momentum eases to walk speed at 4/s) | derived (simulation of `JET.boost/airAccel`) |
| Jet landing height | on a box with top <= apex + step, theory ~1.9; **intended reach 1.6** (owner decision: low cover 1.1 and the 1.6 platform) | derived, **gym** |
| Ceiling during jet | rising head stops under any box; needs 1.8 + 1.46 = 3.3 free for a full burst | `player.js:#ceiling` |

Camera clearances (derived from the table above):
- Camera height above feet = eye + 0.15 + dist x sin(-pitch). Default pitch -0.08: ~1.9 stand. Looking straight down (-1.25): ~5.0 normal, ~5.5 sprint.
- Behind the player: 3.4 + 0.25 = 3.65 free for the full normal camera (aim 2.15, sprint 4.15). Less is fine, the camera pulls in, but gets tight on the head.
- Sideways: 0.85 + 0.25 = 1.1 each side of the centre line (peek 1.3) before the camera is pulled in by a wall.

## 3. Cover
| Item | Value | Source |
|---|---|---|
| Class by height above the player's feet | < 1.7 low, else high; `{ cover: 'wall' }` behaves as high | `player.js:#castCover`, `world.js:box` |
| Cover only if flagged | `box(..., { cover: 'low'\|'high'\|'wall' })`; unflagged boxes block but give no cover | `world.js:box` |
| Low cover height | **1.1** (code); behind it crouch 1.05, so 0.05 margin | `world.js:LOW`, `TUNING.crouchHeight` |
| High cover height | **2.8** (code); walls 2.2 (range separator), 3.2 (boss arena), 7 (building) | `world.js:HIGH`, `#buildLevel` |
| Fixed cover heights (owner decision) | cover is **1.1 (low) or 2.8 (high)**, nothing in between: 1.2-1.69 counts as low but hides nobody standing; 1.7-2.0 hides a 1.8 m trooper's head only barely. Height-adaptive cover is a later idea (backlog), not a current rule | derived |
| Auto cover reach | 0.35 beyond body radius (0.75 from centre), push within ~53 deg of the face normal | `TUNING.autoCoverReach` |
| Cover slide | A/D; stops 0.2 before an edge | `player.js:#updateCover` (`margin` 0.2) |
| Edge / peek clearance | edge flagged when no cover face 0.45 along the tangent; peek = 0.2 weight shift + 0.6 rad lean | `#updateCover`, `PEEK` |
| Pinned | high cover with no edge within 0.45: no aiming or shooting | `player.js` (`pinned`) |
| Run-in vault reach | 2.2 | `TUNING.coverReach`, `VAULT.runInReach` |
| Min length, high cover (derived) | center positions run from 0.2 to L - 0.2 from the ends; a pinned spot needs one > 0.45 from both ends so L >= 0.9; both ends peekable always; **proposed minimum 1.2** (existing pillars 1.2 x 1.2) | derived |
| Min length, low cover (proposed) | 1.6 (two-body wide: 0.8 + 0.8). Existing: 3-4 m, 1 m posts only as part of a row | proposed |
| Recommended length | low 3-4, walls 4-6 (existing); beyond ~8 m add a gap or end so there is a place to peek / flank | proposed |
| Thickness | low 1.0 (hop, see 4); walls 0.5-0.6; pillars 1.2 | `world.js:#buildLevel` |
| AI spots | 0.65 off every face >= 0.8 wide; low: every 1.2 along; high / wall: only within 0.45 of an end; spot must stand on the box's floor and be free (1.6 m high, r 0.4) | `ai/cover.js:TUNING`, `MIN_FACE`, `#addBox` |
| AI peek | 0.8 m sideways step from high cover to shoot | `cover.js:TUNING.peekStep` |
| Enemy-cover range | spot 6-28 m from the player (34 retreat), ideal 15, run <= 22 | `cover.js:TUNING` |

Cover for AI needs the same floor level only (no stairs): a cover box on a platform is used only by troopers on that platform (`cover.js:find`, `|dy| <= 0.5`).

## 4. Vault
| Item | Value | Source |
|---|---|---|
| Hop vs slide | block depth (short side along the vault) <= 1.2 hop (0.5 s), > 1.2 slide (0.3 s + depth / 5.5 m/s) | `player.js:VAULT.hopDepth`, `#tryVault` |
| Max vaultable height | only "low" (< 1.7 above feet) is checked in code; tested and authored: 1.1 | `#castCover`, `#tryVault`, **gym** |
| Hop arc | top + 0.3; slide: top + 0.08 | `#tryVault` |
| Run-up speed | > 3.5 m/s (walk 4.6 already qualifies), within 2.2 of the face, heading within ~45 deg of the normal (`-wish.n > 0.7`) | `VAULT.runIn`, `runInReach`, `update` |
| Run-up distance | walk reaches 3.5 m/s after ~0.23 m (accel 14); keep 2.2 m of straight, flat approach clear in front of vaultable cover; **proposed 3 m** | derived (`TUNING.accel`), proposed |
| Landing | landing point is 0.25 + 0.4 = 0.65 behind the far face; no collider (taller than step, lower than 1.8) may touch the r = 0.4 circle there, else the vault is **refused** (a jet burst fires instead). Keep **>= 1.1 m clear** behind the far face | `#tryVault` (loop over colliders) |
| Slide | aiming / shooting allowed during the slide; FOV +8 | `VAULT.twist`, `camera.js` |
| Pushed from cover | Space while pushing into low cover vaults it | `player.js:update` |

## 5. Spaces
Legend: *hard min* = engine or camera breaks below it; *rec* = the standard to build with. **Owner decision: the prototype
arena's scale is the standard** — rec values are the arena's own sizes.
| Item | Hard min | Rec | Why / source |
|---|---|---|---|
| Corridor width | 1.6 | **4.0** (same as the arena doorways) | 2 bodies x 0.8; camera side 1.1 per side; derived. No corridor exists yet |
| Door width | 1.2 | **4.0** (arena doors at x -12, 16) | player 0.8 + peek lean; wall ends beside doors act as high-cover edges (peek) so keep the wall >= 0.9 wide there |
| Door / lintel height | 1.8 (head box; `collideCircle` ignores boxes whose bottom >= feet + 1.8) | **4.0** (arena doors) | `world.js:collideCircle`; jet needs 3.3 |
| Ceiling (rooms) | 2.5 (camera pulls to the head) | **7.0** (arena building walls) | camera height ~3.4 at pitch -0.5 and 3.4 normal; derived |
| Ceiling for jet | 3.3 | 7.0 | 1.8 + 1.46 (`JET`) |
| Stairs | rise <= 0.45 | **rise 0.4, run 1.0, 4 wide** (arena stairs, 3 steps) | `player.js:TUNING.stepHeight`; `world.js:#buildLevel` stairs; AI uses the same 0.45 |
| Ramps | -- | none: `groundAt` uses box tops, a ramp must be a stair of 0.4 m boxes | `world.js:groundAt` |
| Raised floors | -- | 1.6 platform: stairs; parapets on it are LOW 1.1 x 0.6 thick; AI cover only works on the same level | `world.js` platform |
| Tallest jumpable | -- | boxes up to **1.6** are jet-reachable **by design** (owner decision: the 1.6 platform may be jetted onto); > 1.9 not jettable | derived, **gym** (confirm 1.6 is reliable) |
| Room width / depth | 4 x 4 | 8 x 8+ for a fight (cover spots need >= 6 m to the player) | `cover.js:minRange`; derived |
| Open sky for drones | -- | flight band 3.5-5 + 0.6 radius: no roof below ~5.6 above a drone area; drones never enter `interiorZones` | `drone.js:TUNING`, `update` bounds |
| Arena size | -- | see 7 | -- |

## 6. Combat ranges
Guns (`combat/guns.js`): falloff = damage x1.0 up to `start`, linearly to `min` at `end`, `min` beyond.
| Gun | Falloff start / end | Min mult. | Max range | Zoom | Ideal range (proposed) |
|---|---|---|---|---|---|
| KR-7 Warden AR | 35 / 80 | x0.65 | 250 | 50 FOV | 10-35 |
| KM-90 Bulwark MG | 25 / 60 | x0.6 | 250 | 50 | 8-25 |
| KS-5 Farsight SR | none | 1.0 | 300 | scope 24 FOV | 30+ |
| KB-3 Tribune BR | 45 / 100 | x0.7 | 250 | 50 | 20-45 |
| KX-9 Halberd RG | none | 1.0 | 300 | 42 FOV | any, pierces lines |
| KP-12 Ember PS | 20 / 50 | x0.6 | 200 | 50 | 3-20 |

Enemies:
| Enemy | Engage / notice | Distance kept | Other | Source |
|---|---|---|---|---|
| Puppet shooter | engages within 30 (LOS) | fixed post behind low cover, 0.8 behind its face | pops up 0.95 | `puppet.js:ENGAGE_RANGE`, `HIDE`, `enemies.js:SPAWNS` |
| Trooper | notices 32, shoots within 30, squad alert 22 | cover 6-28 from the player, ideal 15, retreat 34; leaves a spot when the player is within 5; runs <= 22, flanker <= 30 | aim error +-(0.15 + 0.006 x dist) per axis, bolts 34 m/s | `trooper.js:TUNING`, `cover.js:TUNING` |
| Drone | wakes at 36 (LOS) | circles at 9-18, flight 3.5-5 above ground, speed 5.5 | hits from above: angle 12-30 deg | `drone.js:TUNING` |
| Spider mech | wakes in arena or within 28 (LOS) | keeps 11-20; mortar min 8, stomp within 6.5 (7 blast) | cannon, mortar 3.6 blast | `spider.js:TUNING` |

Encounter sizes (proposed from the above):
- **Close 6-15 m**: pistol/MG ideal; the trooper's minimum is 6 (it relocates under 5), mortar min 8, stomp 6.5. Troopers pick no cover spot closer than 6. Rooms: ~8 x 8 to 15 x 15.
- **Mid 15-30 m**: trooper ideal 15, every enemy and gun at full effect; AR/MG at full damage up to 25-35. Default outdoor fight (existing mid field is 12-25 m between cover lines).
- **Long 30-60 m**: beyond trooper / puppet engage (30) and notice (32): only drones (36), boss (28 wake), snipers, and mortars act. Treat as sniper / approach lanes; hit damage drops for AR/MG/pistol. >60 only for the sniper and railgun.
- Rule: a sight line of more than ~34 m is free of trooper fire; put cover every <= 12 m on routes crossing mid range (existing rows are 12-14 m apart).

## 7. Enemy space needs
| Enemy | Footprint | Notes | Source |
|---|---|---|---|
| Trooper | r 0.4, 1.8 high, step 0.45 (same as the player) | spots 0.65 off a face; needs >= 0.8 faces; flank route over 30 m, one corner waypoint, same floor only, bodies move at 4.6 / 5.4 | `trooper.js:TUNING`, `cover.js` |
| Trooper route clearance | segment test r 0.35, band 0.45-1.6 | a 1.0 m gap passes, 0.7 does not | `world.js:segmentClear`, `cover.js:route` |
| Puppet | stand on a post, human scale; hides 0.95 behind low cover | 100 / 120 hp | `puppet.js` |
| Drone | r 0.6, flies at ground + 3.5-5; bounds is the yard | blocked by walls at flight height; stays outside interior zones | `drone.js:TUNING` |
| Spider mech | collision r 3.6 (7.2 m span), body 2.6 high (1.4 dormant, 0.85 down), legs reach 6.2 | steps over boxes up to 1.3; cannot pass doors (7.2 m); gait step 1.3 | `spider.js:TUNING`, `LEG`, `collideCircle(..., 1.3)` |
| Boss arena | x 25-49.5, z -61.5 to -14.5 (24.5 x 47); wall 3.2; gate 5.5 wide; 6 freestanding walls 3.2 + 3 low blocks | clamp keeps the centre r 3.6 inside; lanes between walls should be >= 7.2 for the mech, narrower ones are player-only | `spider.js:ARENA`, `world.js:#buildLevel` |

## 8. To measure in the Gym (feeds #64-#67)
Each item: value, how the Gym measures it.
1. **Max vaultable height** (code allows < 1.7): ramp of blocks 1.0..1.6 in 0.1 steps, run-in vault each (walk and sprint); record success and visual clipping.
2. **Jet landing reach**: blocks 1.0-2.0 in 0.1 steps, standing and walking jet; record the highest top that can be landed on.
3. **Jet distance** (derived ~3.6 / 4.7 / 5.4): gap course 2.0-7.0 in 0.5 steps, stand / walk / sprint start; record reliable and max clear gap; gap width recommendation.
4. **Minimum corridor / door width** at which the camera stays usable (no near-clip, no pop): corridors 1.6-4.0 in 0.2 steps, walk, aim, sprint, peek, both shoulders.
5. **Minimum ceiling** for camera and jet: low ceilings 2.4-5.0 in 0.2 steps; look straight down / up; check the camera inside the head or near plane.
6. **Door header** minimum: lintel height 1.8-4.0 (collision band) incl. jet under it.
7. **Minimum cover length**: low cover 0.8-3.0 and high cover 0.9-3.0 in 0.2 steps; check cover snap, slide stops, pinned, both edges peekable, AI spot count.
8. **Cover height dead zone** 1.1-2.0 in 0.1 steps: crouch pose against the block, aim probe obstruction, enemy bolts over it.
9. **Run-up distance** for the run-in vault from standing: lanes of 0.5-3.0 m before a low block.
10. **Landing space after vault** (code refuses when blocked): obstacles 0.6-1.4 m behind the far face; record when the vault is refused.
11. **Hop vs slide depth edge**: blocks of depth 1.0-1.6 in 0.1 steps; check animation fit and landing.
12. **Stair geometry**: rise 0.3-0.45, run 0.6-1.2; foot-IK and camera dip (walk and sprint); ramp-by-steps feel; width 1-4.
13. **Trooper route clearance**: gaps 0.6-1.5 between boxes; does it route / get stuck (one waypoint only).
14. **Cover spot availability**: for a test layout (rows of low / high boxes) print spot count, reserved spots, and the chosen distance; derive the minimum number of boxes per encounter and spacing.
15. **Drone ceiling / wall interaction**: walls 2.8-5.0 near a drone's orbit; check flight over 3.2 m walls, drone shots at cover from 3.5-5 m (how deep is the safe zone behind low and high cover).
16. **Long sight lines**: 30 / 40 / 60 m lanes: trooper fire at 30-34, readability of enemies at 60 m with fog (70-320) and quality LODs.
17. **Spider space**: arena lane widths 5-9 m; wall-on-leg clipping; stomp / mortar blast against cover (3.6 and 7 radius).
18. **Visual readability at 1 m / 2 m grid**: size reference props (player, trooper, door, stairs) at the camera distances above, to confirm that sizes read.
19. **Camera against low cover when crouched**: camera height 1.23 over 1.1 cover, ray from pivot; check pop through cover on the shoulder swap.
20. **Platform jet-ons** (decided: intended): confirm a jet reliably lands on the 1.6 platform from stand and walk.

## 9. Change rule
Once frozen, a metric changes only through an issue that lists: (a) the old and new value with the source symbol, (b) every kit
piece and level that uses it (search by the named height or size), (c) the code constants to edit. Kit pieces and levels are
updated or re-verified in the Gym in the same change. Gameplay code changes to `TUNING`, `VAULT`, `JET`, `PEEK`, cover.js,
guns.js falloff or the enemy tunings count as metric changes. See `instructions/production.md` (not in this tree at the time of writing).
