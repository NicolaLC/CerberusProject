# Gameplay

## Player (`game/actors/player.js` TUNING)
- Walk 4.6, sprint 7.4 (hold Shift, moving forward; plays the anime run), aim walk 2.6 m/s.
  No sprint while aiming, in cover or within 0.4s of a shot; pulling the trigger ends a sprint.
- Shields 100 (regen 45/s after 3.5s), health 100 (regen 12/s after 6s). Death → respawn at spawn after 3s.

## Input (bindings: `BINDINGS` in `game/controls.js`)
- Aim (zoom): hold RMB. Sprint: Shift. Jump / vault: Space. Fire: LMB or F. Arrow keys look. F3: performance stats.
- Trackpad mode: two-finger swipe (wheel events) looks; E toggles aim (right click and LT always aim only while held); aim assist
  stronger (1.6 vs 0.8). E does nothing outside trackpad mode.
- Aim assist (`camRig.assist`): within ~4-8° of a visible puppet's chest the look slows (friction) and eases toward it.
- Look sensitivity multiplier lives in settings.
- Controller (standard mapping, Xbox names): L stick move (analog: partial tilt walks slower), R stick look,
  LT aim, RT fire, X reload, A jump / vault, LB swap shoulder, Y or RB next gun, d-pad ← ↑ → ↓ = AR / MG / SR / pistol,
  L3 click sprints until the stick is released or pulled back, View = stats, Menu = pause (A or Menu deploys from
  the start panel, no pointer lock needed). Look: 15% radial dead zone, response curve ^2.2, ×1.7 turn boost after
  0.25 s at the rim (`PAD_LOOK`), optional invert Y. Aim assist uses the stronger trackpad profile (friction + pull).
  Rumble on shots (sniper hardest), hits taken, nearby blasts and boss footsteps.

## Jump = jetpack burst (`JET` in player.js)
- Space / A on the ground (not in a snap, dead, or within the cooldown) fires a short burst, not a real jump. Order on
  press: low cover pushing into it → vault; running fast at low cover within 2.2 m → vault; else the burst (leaves cover).
- Thrust 0.22 s lifts vy linearly to 5.5 m/s (gravity off meanwhile), then gravity ×0.8 (17.6 m/s²): peak ~1.5 m above
  take-off, ~0.95 s airtime, enough to land on low cover (1.1 m). +1.5 m/s along the move input at take-off; air
  control eases at 4 (ground 14); no sprinting in the air (momentum is kept); aiming and firing work.
- Cooldown 0.9 s counted from take-off (and the player must be grounded). `player.airborne` from take-off until landed,
  `player.jetting` = seconds of thrust left. Events: `player:jet` { point (nozzle: +1.2 m up, 0.25 m behind), dir },
  `player:land`.
- Ceiling: a rising head stops under a collider box (roof, ceiling), vy and thrust zeroed. Landing on a box top works
  because `groundAt` / `collideCircle` use feet + step height; walking off its edge falls normally.
- Animator `air`: knees bent (0.5 rad), hips pitched forward, no foot locks / feet IK while it shows.

## Ammo
- Two classes (`ammo` field per gun in `GUNS`): light = AR, MG, BR, pistol; heavy = SR, RG. A pickup refills only its own
  class, each gun by its own `pickup.crate` / `pickup.drop` amounts (AR 96/32, MG 135/45, SR 10/3, RG 8/2...).
  Light is the cyan glow (small case, one band), heavy the orange/amber glow (taller case, two bands, brighter).
- Cases at fixed `SPOTS` in `game/world/pickups.js` (7 light, 3 heavy: range, interior west, boss arena back) respawn after 15s.
- Broken puppets drop a clip 45% of the time (25% of drops are heavy; vanishes after 25s, blinks at the end).
- Walk within 1.1m to collect; toast "LIGHT AMMO +n AR ..." / "HEAVY AMMO +n SR ...". If every gun of that class is
  full the pickup stays ("AMMO FULL").

## Cover
- Automatic: from free, grounded movement, pushing into a cover face snaps to it (`TUNING.autoCoverReach` 0.35 m beyond
  the body radius, wish within ~53° of the face normal: walking along or grazing a wall never snaps; never while
  airborne). A sprint at low cover leaves room for the run-in vault (no snap until touching it); at high cover it slams in.
- Exit, no button: move away (wish·normal > 0.5, so a diagonal backward push counts), push along the cover past its end
  (stopped at the edge and still pushing for `coverEdgeExit` 0.15 s, not while aiming: that peeks), vault, or jump.
  After any exit auto cover waits `autoCoverCooldown` 0.4 s (the timer runs only out of cover) and needs a push
  into the face again, so neither exit snaps straight back.
- No on-screen hints or button prompts: the HUD shows state (ammo, health, boss bar, warnings), never instructions.
- Cover type from height above feet: < 1.7m = low, else high. Boxes are cover only if created with `{ cover }`:
  `'low'` / `'high'` cover blocks, or `'wall'` for walls (building walls, the range separator, the boss arena's
  walls). Walls behave as high cover: peek at their ends and doorways.
- Slide along the face with A/D (camera relative); stops 0.2m before an edge. Moving away from the cover exits.
  Moving along cover (not shooting, `player.coverMoving()`) the character turns into the move and runs hunched
  (Animator `hunch`: chest folded forward, shoulders down, head up looking ahead, gun low); behind low cover
  the hips come half up (crouch 0.45) and it is a quick short-step walk with the feet IK'd to the floor.
  Stopping turns the back to the wall again.
- Low: crouched; aim or fire pops up (fire waits until standing). `Space` + W (pushing into it) vaults over.
- Vault (`VAULT` in player.js): a block up to 1.2 m deep (its short side) is jumped (tucked hop, 0.5 s); a deeper
  one (its long side) is slid across on the hip (0.3 s + depth / 5.5 m/s, linear, keeps momentum). Running
  (> 3.5 m/s) straight at low cover within 2.2 m and pressing `Space` vaults without stopping. Heights come
  from the take-off and landing floors (the floor under the arc is the block's top). Event `player:vault`.
  During the slide only (`player.isSliding()`, not the hop or the cover-entry snap) aiming and shooting work as usual
  (spread, recoil, probe, crosshair; reload and weapon switch too) and firing never ends the slide. The hips keep the
  slide yaw, the chest twists toward the camera yaw (clamped ±1.2 rad, `VAULT.twist`). `player.sliding` (0..1, eased
  at 20/s) drives the camera FOV. Slide timing is unchanged.
- Out of combat the character turns its back to the wall and looks at the camera.
- High: standing; aiming at an edge peeks: the feet stay behind cover (0.2 m weight shift, `PEEK` in player.js), the torso
  leans out 0.6 rad so head and gun clear the edge, at a left edge the gun hold mirrors to the left shoulder
  (`leftHanded` → Animator `hand`), and the camera moves to that side
  only for the peek (`camRig.peekSide`); the player's own shoulder (`camRig.shoulder`) comes back afterwards. Away from the ends
  (no edge within 0.45 m) there is no line of fire: aiming and shooting are blocked (`player.pinned`).

## Weapons (`game/combat/guns.js`, controller in `weapon.js`)
- Reload (R) is an active reload: a bar with a marker sweeps across `activeReload` zones (fractions of reload time).
  R again inside `perfect` = instant + ×1.25 damage for that magazine (ammo counter glows); inside `good` = instant;
  outside = jam, +1s, and the bar disappears (nothing left to read: the reload just runs on). One try per reload. The magazine auto-reloads when it hits 0 (also after switching to an empty gun).
- 1–6 (AR, MG, SR, BR burst, RG railgun, PS pistol) or mouse wheel switches (0.45s lower/raise, model swaps at the bottom). Ammo is tracked per gun.
- The ammo counter turns red at 25% of the magazine or less (`LOW_AMMO` in hud.js, at least the last round): AR ≤ 8, MG ≤ 22, SR / RG ≤ 1, pistol ≤ 3.
- KR-7 Warden (AR): 540 rpm, mag 32, reserve 192/384, reload 1.8s, 18 dmg, head ×2.5, weak ×3, limbs ×0.8.
  Spread hip 0.022 / aim 0.004 + bloom 0.007 per shot.
- KM-90 Bulwark (MG): 780 rpm after a 0.4s spin-up (starts at 35%), mag 90, reserve 270/450, reload 3.0s,
  13 dmg, head ×2, weak ×3. Wider spread, more sideways recoil and shake; walking slows to 2.2 m/s while firing.
- KS-5 Farsight (SR, precision): semi-auto (`semi: true`: one round per click; a click within 0.25 s before the bolt
  is back is buffered), 70 rpm, mag 5, reserve 25/40, reload 2.4s, 110 dmg (no falloff), head ×3: body shot destroys
  a puppet, headshot a trooper. Aimed spread 0, hip 0.045, moving +0.03. One big kick per shot, 95% recovered after
  0.18 s (`recoil.hold`). Scope: `zoom` { fov 24, dist 1.5, sens ×0.45 } replaces the aim FOV/distance/sensitivity
  (CameraRig.zoom, set by Weapon on switch); a vignette overlay follows the zoom; the crosshair dims while cycling.
- KB-3 Tribune (BR, precision mid-range): `burst: 3` rounds at 900 rpm per pull, `burstDelay` 0.3 s between
  bursts (holding repeats), mag 24, 24 dmg, aim spread 0.0015, tiny bloom; the recoil pattern restarts every burst.
  A started burst finishes even if the trigger is released (`weapon.burstLeft`).
- KX-9 Halberd (RG, railgun): semi; a pull starts a 0.45 s `charge` (`weapon.charging`, event `weapon:charge`),
  then the slug fires. A ring around the crosshair (`#charge`) fills over the charge and disappears when it fires or
  cancels. `pierce: true` (Spartan-laser style): the slug hits EVERY enemy on its line (no limit, drones, puppets,
  troopers, spider legs), each once, with the best zone (highest damage multiplier) the line crosses on that enemy,
  and stops at the first wall, cover box or armored part (boss hull / turret / closed shutters: it can't reach the
  core through the shell). The trail is drawn to where it stops. The slug follows the muzzle-to-crosshair line past the aim point. 100 dmg, mag 4, no falloff, light zoom without scope overlay (`zoom.scope` only on the sniper).
  `beam: true` draws a thick lingering trail. Charge cancels on reload/switch/sprint.
- KP-12 Ember (PS, sidearm): semi, 330 rpm, mag 12, reload 1.2 s, 32 dmg, aim spread 0.002. Held out front.
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
- Armor: the hull, turret and closed shutters take no damage (`armor()` returns 0: sparks only, the crosshair
  doesn't turn red; `weapon:armored` is emitted but nothing shows a hint). Legs take damage (limb ×0.8), the glowing knee joints are weak spots (×3).
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
- No protected spot within 28 m of the player: accept one up to 34 m (the retreat limit) rather than stand in the
  open; later relocations work closer.
- Cover is re-checked continuously: a trooper hiding in a spot that stops protecting it moves at once, and one
  running to a spot re-picks every 0.5 s if the player has moved round it.
- Faces narrower than 0.8 m get no spots (a wall's end beside a doorway is for peeking, not hiding: the
  protection test would only graze it).
- Cover spots: 0.65 m off every face of every cover box (low: every 1.2 m; high: near the ends only).
- Squad tactics:
  - Spread: a spot on the same bearing from the player as a squadmate (within 25°) costs +5 m, so a squad
    fans out around the player instead of stacking behind one box.
  - Flanking (`Enemies` flank director): with 2+ troopers engaged within 35 m, one is sent to flank 5 s
    after contact and then every 9 s (retry every 2.5 s if no route). The flank spot must protect the
    flanker, see the player from its firing position, and lie outside ~70° of the player's front: the
    direction their cover box faces (away from it) if in cover, else where they face. The trooper already
    most to the side goes first. Flankers sprint (5.4 m/s, up to 30 m) and open fire on arrival; the rest
    keep the player pinned.
