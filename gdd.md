# Cerberus: Game Design Document

Status: prototype. Source of truth for numbers is the code (`TUNING` / `GUNS` tables); this document
summarises it for designers and collaborators. Implementation details live in `instructions/*.md` (see section 13).
Anything not decided in the sources is listed only in section 12.

## 1. Overview

### Pitch
Cerberus is a third-person sci-fi cover shooter with a Mass Effect-like feel. The prototype is a single
training arena that exists to prove five things: aiming, shooting, cover, enemies and lighting. You deploy into
a yard with low and high cover lines, an east shooting range, an interior building and a walled boss arena,
and fight training puppets, cover-using troopers, hovering drones and a six-legged spider mech miniboss with six
weapons. Art is prototype-grade (procedural geometry, grid textures, synthesized audio plus recorded weapon sounds).

### Platforms
- **Web:** Vite build, runs from any folder or sub-path; keyboard + mouse, trackpad or gamepad; also a single-file page.
- **Desktop:** the same build in Electron (Windows NSIS, macOS dmg, Linux AppImage / deb / tar.gz), fullscreen, adds
  QUIT TO DESKTOP on the start panel. Unsigned, default icon.

### Design pillars
1. **Readable, learnable gunplay.** Spread is a cone, the crosshair gap draws exactly that cone, recoil is a fixed per-gun
   pattern you can pull against, first-shot accuracy rewards tapping, falloff is explicit. Hit results are
   deterministic enough to be unit-tested.
2. **Fluid, automatic cover.** No cover button. Walk into a face to take cover, move away to leave, slide along it,
   vault low cover on the run. Cover should never fight the player (cooldowns stop exit/enter flicker).
3. **Juicy feedback.** Every shot, hit, kill, hurt and landing has layered camera, FX, audio and rumble
   response (hitstop on kills, trauma shake, FOV punch, chromatic aberration).
4. **The HUD shows state, never instructions.** No button prompts or hints on screen. Ammo, health, crosshair
   state and boss bar tell you what is happening; the player learns the rest by playing.
5. **Enemies that use the same space as the player.** Troopers pick cover, relocate when flanked and flank the
   player; the boss punishes sitting in cover (faster mortars). Cover is a contest, not a safe zone.

## 2. Player

| Property | Value |
|---|---|
| Walk | 4.6 m/s |
| Sprint | 7.4 m/s (plays the "anime run") |
| Aimed walk | 2.6 m/s |
| Cover slide | 3.2 m/s (2.6 m/s while aiming) |
| Weapon-limited movement while firing | KM-90 Bulwark 2.2 m/s, KX-9 Halberd 1.6 m/s (applies for 0.25 s after each shot) |
| Body | radius 0.4 m, height 1.8 m standing, 1.05 m crouched, step height 0.45 m |
| Shields | 100, regen 45/s after 3.5 s without damage |
| Health | 100, regen 12/s after 6 s without damage |
| Death | "SHIELDS DOWN, RESPAWNING" overlay, respawn at the spawn point (0, 0, 38) after 3 s |

Sprint rules: hold Shift while moving forward (controller: L3 click sprints until the stick is released or pulled
back). Not allowed while aiming, in cover, airborne, within 0.4 s of a shot, or while the trigger is held; pulling
the trigger ends a sprint. Controller sticks are analog (partial tilt walks slower).

Damage model: shields absorb first, overflow goes to health; both regenerate after a delay, which rewards
breaking line of sight. Damage direction is shown by a rotating indicator, a red vignette and a red chromatic
pulse; at low health the screen desaturates and reddens.

Enemy damage sources: puppet and trooper bolts 7, drone bolts 6, boss cannon bolts 9, mortar 34 (3.6 m blast), stomp 24 (7 m blast).

## 3. Controls

| Keyboard / mouse | Controller (standard mapping) | Action |
|---|---|---|
| WASD | Left stick | Move |
| Mouse | Right stick | Look |
| Arrow keys | | Look (keyboard) |
| Shift (hold, moving forward) | L3 click | Sprint |
| RMB (hold) | LT | Aim (zoom). Also pops up / peeks from cover |
| LMB or F | RT | Fire |
| R | X | Reload. Press again in the white zone for a perfect reload |
| 1 / 2 / 3 / 4 / 5 / 6 | d-pad left / up / right / (none) / (none) / down | AR / MG / SR / BR / RG / pistol (pad reaches AR, MG, SR, pistol only) |
| Mouse wheel | Y or RB | Next weapon |
| Space | A | Jetpack jump; into low cover: vault |
| Q | LB | Swap shoulder |
| H | | Skeleton debug |
| F3 (also backquote) | View | Performance stats |
| Esc | Menu | Pause (A or Menu deploys from the start panel) |

Settings on the start panel: look sensitivity (0.3x to 3x), trackpad mode, aim assist on/off, graphics
(Low / High / Ultra), invert look Y (controller).

**Controller look:** 15% radial dead zone, response curve ^2.2, x1.7 turn boost after 0.25 s held at the rim.

**Trackpad mode:** two-finger swipe (wheel events) looks, so the wheel no longer switches weapons; E toggles aim
(right click and LT still aim only while held). E does nothing outside trackpad mode.

**Aim assist** (only while aiming, only toward visible puppet chests within 70 m):

| Input | Strength | Behaviour |
|---|---|---|
| Mouse | 0.8 | Friction only: look slows near a target (up to 45% at its center); the aim never moves by itself. Capture cone about 4 degrees |
| Trackpad or controller | 1.6 | Friction plus a gentle pull toward the target. Cone about 8 degrees |

Pointer lock requests raw mouse input (no OS acceleration); without pointer lock the game falls back to free-mouse
look with arrow keys.

## 4. Cover and movement

### Entering and leaving (automatic)
- **Enter:** from free, grounded movement, push into a cover face (within 0.35 m beyond the body radius, wish
  direction within about 53 degrees of the face normal). Walking along or grazing a wall never snaps. Never while
  airborne. A sprint at low cover leaves room for the run-in vault (no snap until touching); at high cover the
  player slams in (small trauma + camera dip).
- **Exit (no button):** move away from the face; push along the cover past its end; vault; or jump.
- **Cooldown:** after any exit, auto cover waits 0.4 s and needs a fresh push into the face, so exits never
  snap straight back.
- **No prompts:** nothing on screen explains cover.

### Cover types
Cover type comes from height: under 1.7 m is low, otherwise high. Walls (building walls, range separator, boss
arena walls) behave as high cover. Colour code in the arena: orange = low, blue = high, light grey = walls.

Low cover: crouched; aiming or firing pops up (fire waits until standing); can be vaulted or jumped onto.
High cover and walls: standing; shooting is blocked away from edges (pinned); peek at ends and doorways.

### Sliding along cover
A/D slide (camera-relative); the player stops 0.2 m before an edge. While moving along cover (not shooting) the
character turns into the move and runs hunched; behind low cover the hips come half up (crouch 0.45). Stopping turns
the back to the wall again. Out of combat the character turns to the wall and looks at the camera.

### Peeking and the pinned rule
- Aiming at a high-cover edge peeks: feet stay behind cover (0.2 m weight shift), torso leans out 0.6 rad, and at
  a left edge the gun mirrors to the left shoulder. The camera switches to that side only for the peek (offset 1.05 m)
  and returns to the player's shoulder afterwards.
- **Pinned:** away from the ends (no edge within 0.45 m) there is no line of fire, so aiming and shooting are
  blocked. The only way to shoot from high cover is to go to an edge.

### Vaulting low cover
| | Hop | Slide |
|---|---|---|
| Used when | Block is up to 1.2 m deep (short side) | Block is deeper than 1.2 m (long side) |
| Duration | 0.5 s (tucked hop) | 0.3 s + depth / 5.5 m/s, keeps momentum |
| Shooting | No | Yes |

Triggers: Space (or A) while pushing into low cover, or Space while running faster than 3.5 m/s straight at low
cover within 2.2 m (vaults without stopping).

### Slide shooting
During the hip slide only, aiming, shooting, reload and weapon switching work as normal (spread, recoil, probe and
crosshair included) and firing never ends the slide. Hips keep the slide direction; the chest twists toward the
camera, clamped to 1.2 rad. The camera widens its FOV by +8 degrees for speed (not while aiming: the aim or scope
FOV wins).

### Jetpack jump (a burst, not a real jump)
| Property | Value |
|---|---|
| Thrust | 0.22 s, lifts vertical speed to 5.5 m/s (gravity off meanwhile) |
| After thrust | Gravity x0.8 (floaty) |
| Peak | About 1.5 m above take-off, about 0.95 s airtime: enough to land on low cover (1.1 m) |
| Take-off boost | +1.5 m/s along move input |
| Air control | Eases at 4 (ground 14) |
| Cooldown | 0.9 s from take-off; must be grounded |
| In the air | No sprint (momentum kept); aiming and firing work; a rising head stops under a ceiling |

Order of resolution on Space: low cover pushed into, vault; running fast at low cover within 2.2 m, vault; else
the burst (which also leaves cover).

## 5. Weapons

Six guns, switched with 1-6 or the wheel (0.45 s lower/raise). Ammo is tracked per gun. Every gun has a hip and an
aimed spread, a fixed recoil pattern and its own seeded RNG.

### 5.1 Stats

| Gun | Slot | Role | Fire mode | RPM | Mag | Reserve (start / max) | Reload | Ammo class |
|---|---|---|---|---|---|---|---|---|
| KR-7 Warden | 1 AR | All-rounder assault rifle | Auto | 540 | 32 | 192 / 384 | 1.8 s | Light |
| KM-90 Bulwark | 2 MG | Suppression | Auto, 0.4 s spin-up (starts at 35% rpm) | 780 | 90 | 270 / 450 | 3.0 s | Light |
| KS-5 Farsight | 3 SR | Precision, long range | Semi (click buffered 0.25 s before the bolt is back) | 70 | 5 | 25 / 40 | 2.4 s | Heavy |
| KB-3 Tribune | 4 BR | Precision mid-range | 3-round burst per pull, 0.3 s between bursts (holding repeats; a started burst always finishes) | 900 in burst | 24 | 144 / 288 | 1.9 s | Light |
| KX-9 Halberd | 5 RG | Railgun, piercing | Semi, 0.45 s charge | 55 | 4 | 16 / 24 | 2.6 s | Heavy |
| KP-12 Ember | 6 PS | Sidearm | Semi | 330 | 12 | 72 / 120 | 1.2 s | Light |

| Gun | Damage | Head | Limb | Weak spot | Falloff (full to start, end, min mult) | Range |
|---|---|---|---|---|---|---|
| KR-7 Warden | 18 | x2.5 | x0.8 | x3 | 35 m to 80 m, min x0.65 | 250 |
| KM-90 Bulwark | 13 | x2 | x0.8 | x3 | 25 m to 60 m, min x0.6 | 250 |
| KS-5 Farsight | 110 | x3 | x0.7 | x3 | none | 300 |
| KB-3 Tribune | 24 | x2.5 | x0.8 | x3 | 45 m to 100 m, min x0.7 | 250 |
| KX-9 Halberd | 100 | x2 | x0.8 | x2.5 | none | 300 |
| KP-12 Ember | 32 | x2.5 | x0.8 | x3 | 20 m to 50 m, min x0.6 | 200 |

| Gun | Spread hip | Spread aimed | Moving adds | First-shot scale (hip / aimed) | Bloom per shot (max) | Recoil recovered | Camera kick trauma |
|---|---|---|---|---|---|---|---|
| KR-7 Warden | 0.022 | 0.004 | 0.012 | x0.5 / x0 (after 0.3 s rest) | 0.007 (0.05) | 85% | 0.06 |
| KM-90 Bulwark | 0.034 | 0.011 | 0.020 | x0.7 / x0.4 (0.4 s) | 0.004 (0.07) | 75% | 0.045 |
| KS-5 Farsight | 0.045 | 0 | 0.030 | none | none | 95% | 0.14 |
| KB-3 Tribune | 0.016 | 0.0015 | 0.010 | x0.6 / x0 (0.25 s) | 0.0015 (0.008) | 90% | 0.05 |
| KX-9 Halberd | 0.020 | 0 | 0.020 | none | none | 90% | 0.20 |
| KP-12 Ember | 0.012 | 0.002 | 0.008 | x0.6 / x0 (0.3 s) | 0.004 (0.02) | 92% | 0.05 |

Spread values are cone half-angles in radians. "Moving adds" applies at full walk speed (x0.4 when aimed).

### 5.2 Per-gun notes
- **KR-7 Warden:** recoil is a hard 5-round climb, then a gentle right-left sway (about 3.7 degrees per 10 rounds
  aimed).
- **KM-90 Bulwark:** wider spread, more sideways recoil and shake, a lighter climb with a wide left-right "snake";
  barrel spin sound follows spin-up. Walking slows to 2.2 m/s while firing.
- **KS-5 Farsight:** a body shot destroys a puppet (100 HP), a headshot drops a trooper (150 HP). Aiming zooms to
  FOV 24 at 1.5 m with look sensitivity x0.45 and a scope overlay; crosshair dims while the bolt cycles. One big kick
  per shot, 95% recovered after 0.18 s.
- **KX-9 Halberd:** see 5.4. Light zoom (FOV 42, 1.9 m, sensitivity x0.65), no scope overlay. Walking slows to 1.6 m/s
  after a shot. Thick lingering beam trail.
- **KP-12 Ember:** held out front in both hands; quick reload (1.2 s).

### 5.3 Gunplay rules
- **Spread:** `lerp(hip, aimed, aimBlend) + moveSpread x speed/walk (x0.4 aimed) + bloom`. `aimBlend` follows the
  camera zoom, so pressing aim and firing in the same instant gets no free accuracy. Rounds are uniform over the
  cone's disc. The crosshair gap draws exactly the current spread.
- **Bloom:** grows per shot; decays only after a short delay (0.08 to 0.15 s) following the last shot.
- **First-shot accuracy:** after resting (0.25 to 0.4 s without firing) the next round's spread is scaled down; the
  AR is pin-point when aimed. Tap or burst to stay accurate.
- **Recoil:** a fixed per-gun pattern of [pitch up, yaw right] per round with small random jitter (10 to 30%),
  multiplied by 0.55 to 0.75 while aimed. The camera applies a kick through a ~0.1 s spring, then pulls back a
  fraction (above) once firing stops; your own counter-pull is subtracted so it never overshoots. The pattern
  restarts after 0.25 to 0.6 s idle. It is meant to be learned and pulled against.
- **Falloff:** damage scales by muzzle distance per the table; sniper and railgun have none.
- **Hit resolution:** camera ray first, then re-cast from the muzzle; the muzzle hit wins.
- **Active reload:** R starts a reload with a sweeping marker bar. R again inside the `perfect` window = instant
  reload plus x1.25 damage for that magazine (ammo counter glows). Inside `good` = instant reload. Outside = jam,
  +1 s and the bar disappears. One try per reload. A magazine auto-reloads at 0 (also on switching to an empty gun).

| Gun | Good window | Perfect window (fraction of reload time) |
|---|---|---|
| KR-7 Warden | 0.32 to 0.58 | 0.40 to 0.48 |
| KM-90 Bulwark | 0.42 to 0.62 | 0.50 to 0.555 |
| KS-5 Farsight | 0.36 to 0.56 | 0.43 to 0.49 |
| KB-3 Tribune | 0.34 to 0.58 | 0.42 to 0.50 |
| KX-9 Halberd | 0.38 to 0.58 | 0.45 to 0.51 |
| KP-12 Ember | 0.30 to 0.60 | 0.40 to 0.50 |

- **Aim probe (every frame):** crosshair turns red over an enemy, magenta over a weak spot, grey when the muzzle is
  obstructed (e.g. crouched behind low cover) with a red X where the round would really land.
- **Weak spots:** pulsing magenta patches on enemies, x3 damage with most guns (x2.5 railgun).
- **Aim assist:** see section 3.

### 5.4 Railgun charge and pierce
A pull starts a 0.45 s charge (a ring fills around the crosshair); letting go still fires it. Charge cancels on
reload, weapon switch or sprint. The slug follows the muzzle-to-crosshair line past the aim point and hits **every
enemy on its line** (no limit: drones, puppets, troopers, spider legs), once each, using the best damage zone the
line crosses on that enemy. It stops at the first wall, cover box or armored part (boss hull, turret, closed
shutters), so the shell protects the core. The trail is drawn to where it stops.

## 6. Ammo and pickups

| | Light (cyan glow, small case, one band) | Heavy (orange glow, tall case, two bands) |
|---|---|---|
| Used by | AR, MG, BR, pistol | Sniper, railgun |
| Crate refill | AR 96, MG 135, BR 72, PS 36 | SR 10, RG 8 |
| Drop refill | AR 32, MG 45, BR 24, PS 12 | SR 3, RG 2 |
| Fixed crates | 7 | 3 (range, interior, boss arena back) |

- A pickup refills only its own class, each gun by its own amount, capped at that gun's max reserve.
- Crates sit at 10 fixed spots (yard, west platform, range, interior, boss arena gate at (28, -17) and back), respawn
  after 15 s.
- Destroyed puppets drop a clip 45% of the time; 25% of drops are heavy. A drop vanishes after 25 s and blinks for
  the last 4 s.
- Walk within 1.1 m to collect. Toast: "LIGHT AMMO +n AR ..." or "HEAVY AMMO +n SR ...". If every gun of the class is
  full the pickup stays and "AMMO FULL" shows.

## 7. Enemies

All enemies share one body system: hit zones (head, torso, limb), glowing weak spots, a hit flash and a breakup
into debris on death. The HUD counts every enemy down (32 total, boss included); ARENA CLEAR shows when all are
down. Destroyed enemies stay destroyed until the page is reloaded.

| Enemy | Count | HP | Role |
|---|---|---|---|
| Static puppet | 10 | 100 | Target practice |
| Mover puppet | 3 | 100 | Moving target on a rail (speed 2.2 to 5 m/s) |
| Shooter puppet | 7 | 120 | Pops up from a stand and fires |
| Trooper | 5 | 150 | Cover-using soldier |
| Drone | 6 | 55 | Hovering flyer |
| Spider mech (SX-6 Tarantula) | 1 | core 900, legs 160 each | Miniboss |

### 7.1 Puppets
- Look: crash-test mannequin robots on a pneumatic post, yellow (static, mover) or red-orange (shooter), bullseye
  on the chest.
- Static and mover puppets never attack. Each puppet gets 2 random body parts marked as weak spots (x3).
- **Shooter cycle:** hidden, up, telegraph (visor glow 0.45 s), 3 bolts, hide. Only engages a player within 30 m
  with line of sight.
- **Bolts:** 34 m/s, 7 damage, collide with the world and the player.

### 7.2 Troopers
Armed assault robots (gunmetal frame, slate armor, red faction plates, red visor slit), 150 HP, 1 weak spot.
They are the cover-versus-cover test.

| Property | Value |
|---|---|
| Notice | Player within 32 m with line of sight, when shot, or when a squadmate within 22 m is alerted |
| Engage range | 30 m |
| Move speed | 4.6 m/s (flankers 5.4 m/s) |
| Cycle | Cover 1 to 2.2 s, peek 0.4 s, aim 0.5 s (visor flare), 3 to 4 bolts 0.14 s apart, back to cover |
| Bursts per spot | 2 to 4, then relocate |

**Cover AI:**
- Picks a free spot whose box is between it and the player (threat within about 50 degrees behind the box), 6 to
  28 m from the player (34 m when retreating; ideally about 15 m), reachable in a straight line or around its own
  box (one corner waypoint; no general pathfinding). Spots are reserved one trooper each.
- Low cover: crouch, stand up to shoot. High cover: hide at an end, step 0.8 m out to shoot.
- If there is no line of sight twice, the spot is marked bad for 6 s and the trooper moves.
- Relocates when flanked (spot stops protecting), the player comes within 5 m, after 2 to 4 bursts, or below 40%
  health (retreats farther). Hit while exposed: 50% chance to duck back early. No cover reachable: fights in the
  open.
- Cover is re-checked continuously, including while running to a spot.
- Faces narrower than 0.8 m get no spots (wall ends are for peeking, not hiding).

**Squad tactics:**
- **Spread:** a spot on the same bearing as a squadmate (within 25 degrees) costs +5 m, so the squad fans out.
- **Flanking:** with 2 or more troopers engaged within 35 m, one is sent to flank 5 s after contact, then every 9 s
  (retry every 2.5 s if no route). The flank spot must protect the flanker, see the player, and lie outside about
  70 degrees of the player's front. The trooper already most to the side goes first. Flankers sprint (up to 30 m)
  and open fire on arrival while the rest keep the player pinned. **The HUD gives no flank warning** (the
  `trooper:flank` event has no listener on screen); the player has to notice it.

### 7.3 Drones
- Ducted quad-rotors (armored pod, orange spine plate, red lens cluster, slung cannon) hovering 3.5 to 5 m up: four in the yard / range, two escorting the boss arena.
- Wake on sight within 36 m with line of sight, or when hit. Then circle the player at 9 to 18 m (speed 5.5 m/s),
  flipping direction every 2.5 to 5.5 s.
- Fire 2-bolt bursts (6 damage, 0.16 s apart) after a 0.45 s eye flare; cooldown 1.6 to 2.8 s.
- 55 HP: the eye is the head (x2.5), the glowing core underneath is the weak spot (x3). Hits knock them about. Shot
  down they tumble and burst on landing (no damage). They stay in the yard and never enter the building.

### 7.4 Spider mech miniboss (SX-6 Tarantula)
Located in the north-east arena. Dormant (crouched, eye dim) until the player enters the arena, comes within 28 m
with line of sight, or shoots it. On wake: toast "(warning sign) SX-6 TARANTULA" and the boss bar appears.

**Armor, legs, core:**
| Part | Rule |
|---|---|
| Hull, turret, closed shutters | Take no damage (sparks; the crosshair does not turn red). Block the railgun line |
| Legs (6) | 160 HP each, limb x0.8; glowing knee joints are weak spots (x3). A broken leg falls off, the body tilts toward the gap, speed drops 12% per lost leg (base 2.4 m/s) |
| Core | 900 HP, weak x3. Reachable only when the mech is collapsed (back shutters open). Destroying it kills the mech |

**Phases (driven by leg loss):**
1. **Standing:** armored, all attacks active, shoot the legs.
2. **Collapsed:** every second leg lost (and the 5th) collapses it for 7 s; with none left it stays down. Shutters
   open, the core can be shot.
3. **Recovered:** after 7 s it stands again, slower and tilted.

**Attacks:**
| Attack | Telegraph | Numbers |
|---|---|---|
| Cannon burst | 0.7 s eye charge | 6 bolts x 9 damage, 0.11 s apart, cooldown 2.2 to 3.4 s, needs line of sight |
| Plasma mortar | Ground ring at the player's position, 1.5 s flight | Every 6 to 8.5 s (x1.8 faster while the player is in cover; min range 8 m), 3.6 m blast, 34 damage |
| Stomp | 0.75 s rear-up | When the player is within 6.5 m; 7 m blast, 24 damage, cooldown 3 s |

**Movement:** keeps 11 to 20 m from the player and circles, turns round when blocked; collision radius 3.6 m (the
whole leg span); walks over low cover, not through walls. Legs walk a tripod gait with IK.

**Camera lock-on:** while the boss is awake, alive and within 40 m, the camera drifts toward it when the player is
not steering (0.35 to 0.9 s of no look input) and not aiming, pulling back +1.1 m and +5 degrees FOV. Looking around
overrides it; aiming is always free. A diamond marker sits on the boss. Footsteps and blasts shake the camera by
distance.

## 8. Level: the training arena

Coordinates in metres; +Z south, -Z north. Spawn at (0, 0, 38) facing north.

| Zone | Layout |
|---|---|
| Yard | x -50 to 50, z -62 to 50, perimeter walls 6 m. HUD zone label: TRAINING YARD |
| Cover lines | Low at z=25, high walls at z=12, low at z=0 and z=-14, pillars at z=-20 |
| West platform | 1.6 m high with stairs and low parapets |
| East shooting range | Behind a firing bench at z=32; static and mover targets, one heavy ammo crate |
| Building (interior) | x -24 to 24, z -62 to -30, walls 7 m. Doors at x=-12 and x=16, partition at x=8 with a door at z=-40. Main hall has a roof skylight; the east room is the red, flickering one. HUD zone label: INTERIOR |
| Boss arena | North-east, x 24.3 to 50, z -62 to -14. Fenced from the range by a 3.2 m wall at z=-14 with a gate at x 37 to 42.5 (lit lintel); open to the west lane along the building. Six freestanding 3.2 m concrete walls and three low blocks as cover; ammo crates at the gate and at the back |

**Look:** prototype grid textures (1 tile = 2 m, 1 m checker, 25 cm lines). Orange low cover, blue high cover, light
grey walls, grey floor; interior variants are darker.

**Lighting:**
- Outside: directional sun with a 4096 shadow map (plus/minus 48 m, follows the player), hemisphere fill, gradient
  sky dome, light fog, ACES tone mapping.
- Inside: darker albedo (still readable), 8 point lights (cyan, white, red; emissive strips, some flickering).
- Exposure adapts: 1.0 outside, 1.9 when the camera is inside the building.

Graphics presets (Low / High / Ultra) change resolution cap, MSAA, bloom, shadow-map size and texture anisotropy; dynamic
resolution keeps running under all of them (target 60 fps). See `instructions/engine.md`.

## 9. Feel and game juice

### Camera
| Property | Value |
|---|---|
| FOV / distance | Normal 70 degrees, 3.4 m. Aim 50 degrees, 1.9 m. Sprint 78 degrees, 3.9 m. Slide +8 degrees. Sniper scope 24 degrees, 1.5 m. Railgun 42 degrees, 1.9 m |
| Shoulder offset | 0.85 m (0.95 m aiming, 1.05 m while peeking); Q swaps shoulders |
| Follow | Smoothed (XZ stiffness 22, Y 10) so cover snaps and vaults glide |
| FOV punch | +0.9 degrees per shot, +3 degrees on kills, +2.5 degrees on a perfect reload |
| Trauma shake | Shake = trauma squared; position, pitch, yaw and roll; decays at 1.6/s. Visual only (aim uses the unshaken forward) |
| Extras | Strafe roll, head bob (walk 0.015, sprint 0.05), landing / cover dip spring |

### Feedback per event
| Event | Feedback |
|---|---|
| Shot | Trauma (per gun), FOV punch, muzzle flash and light, smoke, tracer, brass; layered sound; rising click in the last 20% of the magazine |
| Hit | Hitmarker scaled by damage; tick (body), double ping (head), sparkle (weak spot) |
| Headshot | 25 ms hitstop |
| Kill | 70 ms hitstop at 0.08x time, trauma 0.22, white flash, cyan shockwave ring, spark burst, kill chime, big red hitmarker |
| Hurt | Trauma 0.38, red chromatic aberration pulse |
| Perfect reload | FOV punch, white flash, trauma 0.1 (jam: trauma 0.15) |
| Cover slam | Trauma 0.16, camera dip |
| Vault landing | Trauma 0.2, dip 1.4 |
| Jet take-off | Trauma 0.05, camera dips; orange flames, smoke, dust ring; whoosh + thump |
| Jet landing | Trauma 0.06, dip 0.7, soft thud |
| Boss | Leg break: hitstop and trauma; death: 0.15 s hitstop, big trauma, kill flash; footsteps and blasts shake by distance |

### Post-processing
Bloom 0.4 outside, 0.7 inside (threshold 0.92, so emissive colours above 1.0 glow on purpose). Grade: warm tint
outside, cool inside; vignette tightens while aiming; screen desaturates and reddens at low health. Chromatic
aberration and grain, damage and kill flashes, then ACES tone mapping.

### Rumble (controller, only while the pad is in use)
Shots 0.12 (MG 0.3, sniper and railgun 0.7), hits taken 0.6, jet 0.2, nearby blasts and boss footsteps by distance.

## 10. UI / HUD

| Element | Behaviour |
|---|---|
| Crosshair | Four ticks plus a dot; gap equals current spread. States: aim, enemy (red), weak spot (magenta), blocked (grey, with a red X at the real impact point), cycling (dimmed during a scoped bolt cycle) |
| Hitmarker | Pops in proportion to damage; kills are bigger and red |
| Charge ring | Fills around the crosshair during the railgun charge; changes when nearly full |
| Scope overlay | Sniper only, follows the zoom |
| Status bars | Shield and health bars bottom left; damage direction indicator; red vignette |
| Weapon block | Gun name, six slot labels (1 AR, 2 MG, 3 SR, 4 BR, 5 RG, 6 PS) with the current one lit, ammo / reserve, RELOADING label |
| Ammo counter | Turns red at 25% of the magazine or less, at least the last round: AR 8, MG 22, BR 6, SR 1, RG 1, PS 3. Glows after a perfect reload |
| Active reload bar | Good and perfect zones with a sweeping cursor and an "R" label; disappears on a jam; shows PERFECT / GOOD |
| Top bar | Zone name (TRAINING YARD / INTERIOR), "TARGETS DOWN n / 32" |
| Boss bar | Name, core health fill, six leg pips (grey out when destroyed), state text "CORE EXPOSED" / "DESTROYED"; shown only while the boss is awake |
| Toasts | ammo pickups, AMMO FULL, ARENA CLEAR (6 s), boss name on wake, CORE EXPOSED, MECH DESTROYED, SYSTEM FAULT (engine fault isolation) |
| Death | "SHIELDS DOWN, RESPAWNING" |
| Lock-on | Diamond marker on the awake boss |

Principle: state only, never instructions (pillar 4). The HUD gives no cover prompts and no flank warning. Start panel
shows the control table and settings once.

**Fonts:** Chakra Petch (OFL) is the main UI font; Space Nova (demo, non-commercial) is used for numbers (ammo,
damage numbers, counters). Space Nova is under evaluation (section 12; `before-shipping.md`).

## 11. Audio

Weapon sounds are recorded samples (ElevenLabs Sound Effects, generated by the owner, in `src/assets/sfx/`); everything
else is synthesized at runtime with WebAudio. Master volume 0.35. Each sample gets a random pitch (up to about ±10%) and
volume (±12%) per play so repeats do not sound like a loop. Each sample has a synth fallback that plays until it is decoded or if
loading fails.

- **Recorded:** one shot per gun (all six), sniper bolt cycle (0.22 s after each shot), railgun charge (cut if the
  charge is cancelled), MG barrel spin (a loop whose pitch and volume follow the spin), dry fire, weapon switch,
  reload (MG has its own, every other gun shares the rifle one; cut short by a good/perfect active reload, a jam or
  a switch), perfect reload, reload jam.
- **Synth:** low-magazine rising click, hit tick / head double ping / weak-spot sparkle, kill chime, boom (blasts,
  boss legs and death), zap (enemy bolts, mortar), boss charge (also stomp and wake), thud (puppet down, hurt, boss
  steps), jet whoosh + thump, landing thud, pickup, good-reload click.

There is no music and no voice.

## 12. Open questions and ideas

Items marked **(docs)** are listed as open in the project docs. Items marked **(gap)** are noticed while writing this
document. **Nothing here is decided.**

- **(docs)** Space Nova font: buy a commercial licence or drop it for a free font (Chakra Petch is already used).
  Blocks any public release; the demo font also lacks glyphs (warning sign and arrows fall back).
- **(docs)** ElevenLabs sound licence: confirm the plan used grants commercial use.
- **(docs)** App icon, code signing (Windows certificate, Apple notarization) and Steam integration are not done.
- **(docs)** Revisit Tauri 3 (bundled Chromium) once stable if a Rust backend is wanted.
- **(docs)** Linux portable builds (AppImage, tar.gz) need `--no-sandbox` on Ubuntu 24.04+; the .deb is the recommended install (`instructions/desktop.md`).
- **(gap)** The project name "Cerberus" is also a faction in Mass Effect. The owner is moving away from Mass Effect
  naming; the game title, `CERBERUS` start panel and product name, and the "Mass Effect-like feel" wording in
  `instructions/project.md` may need to change. Not decided.
- **(gap)** Controller cannot reach the burst rifle or railgun directly (d-pad has four slots; BR and RG only via
  next-gun). Not decided whether to add a radial/second layer or remap.
- **(gap)** No on-screen cue for an armored hit beyond sparks and a non-red crosshair (`weapon:armored` is emitted,
  nothing listens). Add one, or keep it learn-by-playing per pillar 4: not decided.
- **(gap)** No flank warning for troopers; deliberate per current HUD rules. Whether to add an audio cue is not decided.
- **(gap)** Only weapon sounds are recorded; whether to record the rest (hits, enemies, boss, movement), and whether
  to add music or enemy voice, is not decided.
- **(gap)** Only one boss, one arena and no progression; there is no win state beyond ARENA CLEAR and no restart
  short of reloading the page (destroyed enemies stay destroyed).
- **(gap)** Prototype art only; direction for final art, and settings for audio volume, FOV or screen shake, are not decided.
- **(gap)** Railgun and sniper share the heavy ammo class and low reserves (24 and 40 max); balance versus the pierce
  power of the railgun is untested.

## 13. Pointers

| File | Covers |
|---|---|
| `CLAUDE.md` | Rules for working in the repo; index of instructions |
| `instructions/project.md` | Goal, stack, run / build commands, testing suites and the `?debug` flag |
| `instructions/architecture.md` | Layers, modules, frame order, event table, conventions |
| `instructions/engine.md` | Runtime loop, fault isolation, performance rules, graphics presets, batching and LOD |
| `instructions/gameplay.md` | Controls, mechanics and tuning tables (the detailed source for sections 2 to 7) |
| `instructions/animation.md` | Skeleton, dummy parts, procedural animator, swapping in modeled parts |
| `instructions/level.md` | Arena layout, lighting, grid textures |
| `instructions/desktop.md` | Electron shell, packaging, releases, why Electron rather than Tauri |
| `instructions/feel.md` | Camera juice, hitstop, post-processing |
| `credits.md` | Third-party assets: fonts, the ElevenLabs weapon sounds, libraries (three.js 0.180.0, Electron 44.7.0) |
| `before-shipping.md` | Release blockers: Space Nova licence, replacing the demo font file, ElevenLabs plan, credits check |

Code is the source of truth for numbers: `src/game/combat/guns.js`, `src/game/actors/player.js` (TUNING, VAULT, JET,
PEEK), `src/game/view/camera.js`, `src/game/view/juice.js`, `src/game/actors/{trooper,drone,spider,enemies}.js`,
`src/game/world/pickups.js`.
