# Animation & rig

All characters use `Rig` from `src/game/actors/rig.js`.
Rendering: parts are baked into one SkinnedMesh per material (`RigidSkin`, see engine.md); the part meshes
remain as invisible hitboxes. Attach parts before the bake, or call `skin.rebuild()` after changing them.

## Skeleton (Mixamo layout)
- Bone keys are Mixamo names without the prefix: Hips, Spine, Spine1, Spine2, Neck, Head,
  Left/Right Shoulder, Arm, ForeArm, Hand, Left/Right UpLeg, Leg, Foot, ToeBase. `Bone.name` is
  `mixamorig` + key, matching what three.js produces when it loads a Mixamo model (':' stripped).
- Extra prop bone `Weapon` on Spine2 (not Mixamo): the gun stock, in the right shoulder pocket.
- No rest rotations (Mixamo is a T-pose; ours hangs arms down). Character faces +Z, its left is +X.
  Limb bones extend along local -Y, so `rotation.x < 0` swings a limb forward. Imported Mixamo clips will
  need retargeting for the rest-pose difference; names already match.
- Ankle (Foot bone) sits 0.08 above the floor at rest. Leg lengths: thigh 0.42, shin 0.40; arm 0.30 + 0.28.
- `rig.root` is the character origin at the feet; set its position and `rotation.y` (facing).
- `H` in game toggles `SkeletonHelper`s.

## Player model (`src/game/actors/soldier.js`)
- `buildSoldier(rig)` builds a procedural military combat robot (mood reference: olive drab plate carrier and
  pads over an exposed mechanical frame): rounded boxes / cylinders / capsules per bone. Palette: dark mesh
  fabric, olive drab hard plates, grey-green padded cordura (pouches, shoulder and knee pads), black metal frame
  (waist actuator, neck pistons, shin hydraulics), yellow hazard rings, amber HDR LEDs; a boxy sensor head with
  a big lens; radio backpack attached to Spine2. Every detail is a child of a bone part, so it follows the body;
  RigidSkin batches it to one draw per material (keep to the 8 materials in `soldierMaterials`). The player rig is created with `dummy: false`; puppets keep the dummy.
- Same contract as the dummy: each bone's group is its part, so `rig.setPart` swaps in a modeled piece.

## Enemy looks (same style as the player)
- Shared helpers in `parts.js` (`rb` rounded box, `cyl`, `cap`, `ring`, `group`; geometry cached by size), used by
  `soldier.js` and every enemy. `look(...)` makes a visual-only group (`userData.noHit`).
- Gameplay never depends on the look: humanoid enemies keep the rig's dummy boxes as invisible hitboxes (hit zones,
  weak-spot placement), drone and spider keep their old boxes invisible (`HITBOX_MAT`); only weak parts (spider
  knees and core) are drawn as their own hitbox. Looks are baked by RigidSkin like the player's parts.
- `looks.js`: troopers (`buildTrooper`: gunmetal frame, slate armor, red faction plates, visor slit, power pack;
  the visor material also lights the LEDs, so they flare with the aim telegraph) and puppets (`buildPuppet`:
  crash-test mannequin in the kind's shell color, black hinge drums; chest front stays behind the bullseye at
  z 0.155). Keep limb fronts near the dummy boxes' front faces: weak spots are placed there.
- `drone.js`: armored pod, orange spine plate, lens cluster (eye material), slung cannon, core in a housing
  underneath, ducted rotors (blades on the spinning rotor bones). `spider.js`: hull in pieces, hazard chevrons,
  skirts with hip drums, turret with spider-eye cluster, twin barrels, mortar tube; legs with rams, shin guards,
  foot pads. Leg bones twist arbitrarily (IK), so leg looks stay round-ish.
- Death debris: `debrisCopy(piece)` merges the baked proxies of each piece on a bone (one chunk per look group,
  weak spot or gun, one mesh per material); `disposeDebris` frees it. Split a look into several groups if it
  should break into more chunks.
- Each enemy owns its materials (hit flash is per enemy): keep to 3-4 look materials plus the glow.

## Dummy parts (pivots for modeled parts)
- `rig.buildDummy(materials)` puts one placeholder box per bone (`DUMMY` table), material slots `body` / `plate`.
  Each dummy mesh stores its box size in `userData.size`.
- Replace a piece with a modeled one: `rig.setPart('Head', mesh)`. Author the mesh with its origin at the
  bone pivot, +Y up toward the parent joint, facing +Z. Meshes get shadows and `userData.bone` automatically.
- Extra pieces that are not the main part: `rig.attach(bone, object)`.
- Sockets (`rig.socket(bone, name, x, y, z)`; calling again moves it): `gripR`, `gripL`, `muzzle` on `Weapon`
  (set per gun from `guns.js`), `emitter` on puppets' Spine2.
- Hit zones come from bone names (`HIT_ZONE`): Head/Neck → head, Hips/Spine* → torso, rest → limb.
  Puppet weak spots are extra meshes with zone `weak`.

## Guns on the rig
- Gun models are authored from the stock (z = 0) forward along +Z and hang on `Weapon`; only the equipped one is visible.
- Grips must stay within arm reach: gripR ~0.36m from the right shoulder, gripL ~0.57m from the left one
  (the left shoulder rolls forward while armed). Too close folds the elbow; too far straightens the arm.

## Animator (procedural)
`new Animator(rig, { armed, ground })`, then each frame `animator.update(dt, state)` with
`{ speed, run, crouch 0..1, aimPitch, combat, recoil, lean, lookYaw, lower, vel, yaw }`.
- Layers: reset to rest → hit spring → gait key poses (FK legs, hips) → torso → arms → foot locks (IK) + kneel → feet IK (terrain) → foot pitch.
- Gait = key poses (`locomotion.js`, after David Rosen's GDC 2014 "An Indie Approach to Procedural Animation"):
  per gait (walk, run) 8-9 authored LEFT-leg poses over one cycle (thigh, knee, foot pitch; heel strike at t=0)
  plus hips height/pitch keys per step; the right leg plays half a cycle later. Keys are interpolated with a cyclic
  Catmull-Rom spline. Walk ↔ run blend by speed (2.0-3.2 m/s, sprint forces run), phase-synced.
  - Speed: the swing scales with sqrt(speed / authored speed) (clamped), and the cycle rate is set so the planted
    ankle travels back exactly at ground speed (stance travel measured from the keys at load).
  - Hips sink by how much the supporting leg is bent (weighted by stance), so a straight leg vaults the body and
    a bent one lowers it: the bob comes from the poses, not a sine.
    The heel lift late in stance (foot on its toes) counts too, so toe-off doesn't sink the body.
    The foot lock fades out over the last 0.12 of the cycle before toe-off (the sprint stride is longer than the
    leg can reach from that height: locked to the end, the foot would slip).
  - Flight (run: duty < 0.5): the hips rise on a sin² arc, `FLIGHT` 0.1 m at the top (scaled by run blend and
    speed up to the run's ref), from `FLIGHT_LEAD` (0.1 cycle) before toe-off to `FLIGHT_TAIL` (0.04) after the next
    heel strike, so it spans most of the step instead of popping up over the few frames of pure flight.
    The run's hips keys only add a 1.5 cm dip at compression.
  - The final hips height goes through a critically damped spring (`HIPS_SPRING` 40/s): gait blends, starts,
    stops and crouching never step it. Sprint hips ~0.87-0.92 m (standing 0.95). `tests/animation.browser.mjs`
    fails if the hips' vertical speed changes by more than 25 mm in a frame (the old pop measured ~80).
  - Foot lock: when a foot's stance starts its world position is latched; while it carries weight the leg is IK'd
    to it (blend in after heel strike, out before toe off), y on the floor plus the heel roll. A lock more than
    0.45 m off its pose (spinning on the spot) lets go until the next step. Planted feet slip < 1 mm/frame
    (`tests/animation.browser.mjs`).
  - Direction: pass `vel` and `yaw`. The hips turn toward the movement (up to 0.9 rad), the thighs take the rest
    (UpLeg rotation order YXZ: yaw, then swing), the spine undoes the hips' yaw so the chest keeps facing.
    Backpedaling plays the cycle in reverse.
  - Tuning = editing key numbers; check side views (walk, jog 4.6, sprint 7.4, strafe, backpedal).
- Sprint style (`run`: player sprinting, blended in over ~0.15s), deliberately anime: `RUN` table — 0.42 rad forward
  lean, hips twist with shoulders counter-rotating, extra heel kick, head kept level. The left hand lets go of the
  gun and pumps; the right hand carries it low. Unarmed rigs swing their arms against the legs (more when running).
- Jetpack burst (`air`, eased in ~0.1 s): gait off, knees bent 0.5 rad, hips forward, foot locks and feet IK skipped.
- Kneel (low cover) blends over everything with `crouch`.
- Arms: two-bone IK to the grip sockets, elbows down and slightly out. `lower` (weapon switch) drops the gun.
- Feet IK (when `ground(x, z, maxY)` is given; the player has it, hanging puppets don't): hips drop to the
  lowest foot's floor, each leg is IK'd to its floor plus its animated lift, the knee kept in the plane the pose
  bends it in ("knees forward" only for a near-straight leg: forced on a sprint's heel kick it swung the leg out
  sideways), planted feet kept flat.
- `lookYaw` turns neck + head (used in cover: back to the wall, head toward the camera).
- `animator.impulse(pitch, roll)` kicks the hit-reaction spring.
- Check pose changes from the side and front (see project.md testing), not only from behind.

## Spider mech (`src/game/actors/spider.js`)
- Not the humanoid rig: its own bones (body, turret, two shutters, femur + tibia per leg) baked with `RigidSkin`.
- Leg bones are children of the root, posed in root space each frame by `placeBone` (+Y along the segment);
  a broken leg's bones are scaled to ~0 (hides the skinned parts without a rebake).
- Stops and starts: the gait weight (`gaitW`) eases in fast and out over ~0.3 s while the cycle keeps the last
  cadence (`holdV`), so a stop finishes the step instead of snapping to idle; the walk/run blend is eased in time
  (a stop drops the speed in a few frames), and foot locks fade out (`lw`) rather than letting go in one frame.
- Crouch-walk: hips lowered by `CROUCH_DROP × crouch`; every foot is IK'd to its standing-gait position (raised by
  that drop, never below the floor), with shorter quicker steps (`short`) and walk keys only.
- Vault poses (`VAULT_POSE`): `hop` tucks both legs, `slide` puts the legs forward and the hips down onto the
  block's top, rolled onto one side; weight eases in/out over the vault, foot IK is off meanwhile.
- Slide aiming (`slideAim` 0/1 + `aimTwist` rad in the state, set by the player while sliding and aiming or having shot
  within 0.6 s, plus 0.25 s after so the twist unwinds as the body turns to the camera): after the vault pose, Spine /
  Spine1 / Spine2 get the correction that restores Spine2's pre-pose world rotation plus a yaw twist (a third each, the
  last bone fixes the residual). The hips and legs keep the slide pose; the gun follows `aimPitch` as in normal combat.
  The pose's own spine lean-back is dropped meanwhile (it would tilt the gun). Arm IK is solved before the vault pose;
  the arms hang off Spine2, so the grips stay valid. The twist is clamped to ±1.2 rad by the player.

