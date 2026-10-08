# Gameplay

## Player (`game/actors/player.js` TUNING)
- Walk 4.6, sprint 7.4 (hold Shift, moving forward; plays the anime run), aim walk 2.6 m/s.
  No sprint while aiming, in cover or within 0.4s of a shot; pulling the trigger ends a sprint.
- Shields 100 (regen 45/s after 3.5s), health 100 (regen 12/s after 6s). Death → respawn at spawn after 3s.

## Input (bindings: `BINDINGS` in `game/controls.js`)
- Aim (zoom): hold RMB. Sprint: Shift. Fire: LMB or F. Arrow keys look. F3: performance stats.
- Trackpad mode: two-finger swipe (wheel events) looks; E (or a two-finger click) toggles aim; aim assist
  stronger (1.6 vs 0.8). E does nothing outside trackpad mode.
- Aim assist (`camRig.assist`): within ~4-8° of a visible puppet's chest the look slows (friction) and eases toward it.
- Look sensitivity multiplier lives in settings.

## Ammo
- Pickups fill every gun at once (`pickup.crate` / `pickup.drop` per gun: AR 96/32, MG 135/45). Cases at fixed `SPOTS`
  in `game/world/pickups.js` respawn after 15s.
- Broken puppets drop a clip 45% of the time (vanishes after 25s, blinks at the end).
- Walk within 1.1m to collect; a full reserve leaves it there ("AMMO FULL").

## Cover
- `Space` near a cover box (reach 2.2m, move dir or camera forward, then 8 directions) snaps to it.
- Cover type from height above feet: < 1.7m = low, else high. Boxes are cover only if created with `{ cover }`:
  `'low'` / `'high'` cover blocks, or `'wall'` for walls (building walls, the range separator, the boss arena's
  walls). Walls behave as high cover: peek at their ends and doorways.
- Slide along the face with A/D (camera relative); stops 0.2m before an edge. Moving away from the cover exits.
- Low: crouched; aim or fire pops up (fire waits until standing). `Space` + W vaults over.
- Out of combat the character turns its back to the wall and looks at the camera.
- High: standing; aiming at an edge peeks 0.8m sideways and swaps shoulder to that side.

## Weapons (`game/combat/guns.js`, controller in `weapon.js`)
- Reload (R) is an active reload: a bar with a marker sweeps across `activeReload` zones (fractions of reload time).
  R again inside `perfect` = instant + ×1.25 damage for that magazine (ammo counter glows); inside `good` = instant;
  outside = jam, +1s, and the bar disappears (nothing left to read: the reload just runs on). One try per reload. The magazine auto-reloads when it hits 0 (also after switching to an empty gun).
- 1 / 2 / 3 or mouse wheel switches (0.45s lower/raise, model swaps at the bottom). Ammo is tracked per gun.
- M-8 Avenger (AR): 540 rpm, mag 32, reserve 192/384, reload 1.8s, 18 dmg, head ×2.5, weak ×3, limbs ×0.8.
  Spread hip 0.022 / aim 0.004 + bloom 0.007 per shot.
- M-76 Revenant (MG): 780 rpm after a 0.4s spin-up (starts at 35%), mag 90, reserve 270/450, reload 3.0s,
  13 dmg, head ×2, weak ×3. Wider spread, more sideways recoil and shake; walking slows to 2.2 m/s while firing.
- M-29 Lance (SR, precision): semi-auto (`semi: true`: one round per click; a click within 0.25 s before the bolt
  is back is buffered), 70 rpm, mag 5, reserve 25/40, reload 2.4s, 110 dmg (no falloff), head ×3: body shot destroys
  a puppet, headshot a trooper. Aimed spread 0, hip 0.045, moving +0.03. One big kick per shot, 95% recovered after
  0.18 s (`recoil.hold`). Scope: `zoom` { fov 24, dist 1.5, sens ×0.45 } replaces the aim FOV/distance/sensitivity
  (CameraRig.zoom, set by Weapon on switch); a vignette overlay follows the zoom; the crosshair dims while cycling.
- Add a gun: new entry in `GUNS` (stats, sockets, `build()` model) and its id in `GUN_ORDER`.
- Hit = camera ray (starts at player distance), then re-cast from muzzle; muzzle hit wins.

## Gunplay (math in `combat/ballistics.js`, unit-tested by `npm test`)
- Spread is a cone half-angle; rounds are uniform over the cone's disc (`coneDir`). The crosshair gap draws
  exactly `weapon.spread()`.
- `spread = lerp(hip, aim, aimBlend) + spreadMove × speed/walk (×0.4 aimed) + bloom`. `aimBlend` follows the
  camera zoom (0 hip → 1 aimed), so aim-and-fire in the same instant isn't free accuracy.
- First-shot accuracy: after `firstShot.rest` s without firing the next round's spread is scaled
  (AR aimed ×0 = pin-point, hip ×0.5; MG aimed ×0.4, hip ×0.7). Tap or burst to stay accurate.
- Bloom grows per shot and decays only `bloomDelay` s after the last shot.
- Recoil is a fixed per-gun pattern (`recoil.pattern`, [pitch up, yaw right] per round, the last `loop` entries
  repeat) with ±`jitter`, ×`recoil.aim` while aimed. AR: 5-round hard climb then a gentle sway (~3.7° per
  10 rounds aimed). MG: lighter climb, wide left-right snake. Learnable: pull against it.
- Camera applies a kick through a spring (~0.1 s), then pulls back `recover` of it (AR 85%, MG 75%) once you
  stop firing; your own counter-pull is subtracted so it never overshoots. Pattern restarts after `recoil.reset` s.
- Damage falloff by muzzle distance (`falloff`): AR full to 35 m → ×0.65 at 80 m; MG 25 m → ×0.6 at 60 m.
- Each weapon has its own seeded RNG (`weapon.rng`): spread and jitter are reproducible per seed.
- Aim probe (every frame, after the camera): crosshair red over an enemy, magenta over a weak spot, grey when
  the muzzle is obstructed (e.g. crouched behind low cover) with a red ✕ where the round would really land.
- Aim assist: mouse = friction only, strongest at the target's center (your aim never moves on its own);
  trackpad = friction + pull.

## Puppets (`game/actors/enemies.js`)
- static 100hp, mover 100hp (rail), shooter 120hp: hidden → up → telegraph (visor glow 0.45s) → 3 bolts → hide.
- Weak spots: 2 random body parts per puppet get a pulsing magenta patch (zone `weak`, ×3 damage).
- Bolts: 34 m/s, 7 dmg, collide with world and the player capsule.
- Death breaks the rig parts into debris that fades after 5s. Destroyed puppets stay destroyed until the page
  is reloaded; the HUD counts `down / total` and shows ARENA CLEAR when all are down. Spawn list: `SPAWNS`.
- Shooters only engage a player within `ENGAGE_RANGE` (30 m) with line of sight.

## Drones (`game/actors/drone.js` TUNING)
- Quad-rotor drones hovering 3.5-5 m up (six: around the yard, the range, two escorting the boss arena).
  Wake on sight within 36 m (or when hit); then circle the player at 9-18 m, flipping direction every 2.5-5.5 s.
- Fire 2-bolt bursts (6 dmg) after a 0.45 s eye flare, cooldown 1.6-2.8 s, line of sight needed.
- 55 HP: eye = head (×2.5), the glowing core underneath = weak (×3). Hits knock them about. Shot down they tumble
  and burst on landing (`blast` kind 'drone', no damage). Never enter the building, stay in the yard, collide with
  walls at flight height. `pos` is the ground point under the drone (pickups drop there).

## Spider mech miniboss (`game/actors/spider.js` TUNING, arena `ARENA`)
- Six-legged walker in the north-east arena (x 25..49.5, z -61.5..-14.5). Dormant (crouched, eye dim) until the
  player enters the arena or comes within 28 m with line of sight, or shoots it. Boss bar: core health, leg pips.
- Armor: the hull, turret and closed shutters take no damage (`armor()` returns 0: sparks + an "ARMORED" hint, the
  crosshair doesn't turn red). Legs take damage (limb ×0.8), the glowing knee joints are weak spots (×3).
  Legs have 160 HP; a broken leg falls off and the body tilts toward the gap; it slows 12% per lost leg.
- Every second leg lost (and the 5th) collapses it for 7 s (forever with none left): the back shutters open and the
  core (900 HP, weak ×3) can be shot. Destroying the core kills it.
- Attacks: cannon bursts (0.7 s eye charge, 6 bolts × 9 dmg, cooldown 2.2-3.4 s, needs line of sight);
  plasma mortar every 6-8.5 s (×1.8 faster while the player is in cover) lobbed at the player's position with a ground
  ring telegraph, 3.6 m blast, 34 dmg; stomp when the player is within 6.5 m (0.75 s rear-up, 7 m blast, 24 dmg).
- Movement: keeps 11-20 m, circles the player, turns round when blocked; collision radius 3.6 m (the whole leg
  span, so legs don't reach into walls), walks over low cover, not through walls. A foot whose spot is behind or on
  a wall is pulled in toward the body. Legs: tripod gait, IK (femur 2.4, tibia 3.8, knees up), a foot steps when 1.3 m from home.

## Troopers (`game/actors/trooper.js`, cover in `game/ai/cover.js`)
- Armed soldiers (150 hp, 1 weak spot, rifle). Idle until they see the player (32 m + line of sight), get
  shot, or a squadmate within 22 m alerts them.
- Take cover: pick a free spot whose box is between them and the player (threat within ~50° behind the box),
  6-28 m from the player (34 m when retreating: never out of the fight), ideally ~15 m, reachable in a straight line or around the spot's own box (one corner
  waypoint; no general pathfinding, same floor level only). Spots are reserved, one trooper each.
- Low cover: crouch, stand up to shoot over it. High cover: hide at an end, step 0.8 m out to shoot.
- Cycle: cover 1-2.2 s → peek → aim (visor flares 0.5 s) → 3-4 bolts → cover. No line of sight twice →
  mark the spot bad for 6 s and move.
- Relocate when flanked (spot stops protecting), the player is within 5 m, after 2-4 bursts, or once below
  40% health (retreat farther). Hit while exposed: 50% chance to duck back early. No cover reachable: fight
  in the open and keep looking.
- Cover spots: 0.65 m off every face of every cover box (low: every 1.2 m; high: near the ends only).
- Squad tactics:
  - Spread: a spot on the same bearing from the player as a squadmate (within 25°) costs +5 m, so a squad
    fans out around the player instead of stacking behind one box.
  - Flanking (`Enemies` flank director): with 2+ troopers engaged within 35 m, one is sent to flank 5 s
    after contact and then every 9 s (retry every 2.5 s if no route). The flank spot must protect the
    flanker, see the player from its firing position, and lie outside ~70° of the player's front: the
    direction their cover box faces (away from it) if in cover, else where they face. The trooper already
    most to the side goes first. Flankers sprint (5.4 m/s, up to 30 m) and open fire on arrival; the rest
    keep the player pinned. HUD: "⚠ ENEMY FLANKING".
