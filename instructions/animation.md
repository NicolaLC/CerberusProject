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
- `buildSoldier(rig)` builds a procedural armored sci-fi soldier: several rounded-box / capsule pieces per
  bone (undersuit, gunmetal plates, light ceramic accents, red stripe, cyan HDR glow strips that feed bloom),
  plus a backpack attached to Spine2. The player rig is created with `dummy: false`; puppets keep the dummy.
- Same contract as the dummy: each bone's group is its part, so `rig.setPart` swaps in a modeled piece.

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
- Layers: reset to rest → hit spring → gait (foot paths, hips) → torso → arms → leg IK + kneel → feet IK → foot pitch.
- Gait (`GAIT` table): legs are not swung by angle, each foot follows a path in the character's space and the leg
  is IK'd to it (`twoBone`, knees forward). In stance the foot moves back at exactly the ground speed, so planted
  feet don't slide (checked: ~1-3 mm/frame at 1.6-7.4 m/s). Cadence (cycles/s) and duty factor (share of the cycle
  a foot is planted) follow speed like a real gait: walk 0.6 duty (double support, hips vault over the planted leg),
  run ~0.3 (flight phase, hips compress at mid-stance). Walk → run blends by speed (2.0-3.2 m/s), the sprint flag
  forces run. Stride = duty × speed / cadence. Hips drop just enough for the planted foot to stay in reach.
  Walk: heel strike → roll → toe off; run: the foot leaves fast and folds under the hips (heel kick), toes point.
  Pass `vel` (world) and `yaw` (facing): feet step along the actual movement (strafe, backpedal). Foot pitch is
  applied last (`#orientFeet`), relative to the character, so planted feet stay flat.
- Sprint style (`run`: player sprinting, blended in over ~0.15s), deliberately anime: `RUN` table — 0.42 rad forward
  lean, hips twist with shoulders counter-rotating, extra heel kick, head kept level. The left hand lets go of the
  gun and pumps; the right hand carries it low. Unarmed rigs swing their arms against the legs (more when running).
- Kneel (low cover) blends over everything with `crouch`.
- Arms: two-bone IK to the grip sockets, elbows down and slightly out. `lower` (weapon switch) drops the gun.
- Feet IK (when `ground(x, z, maxY)` is given; the player has it, hanging puppets don't): hips drop to the
  lowest foot's floor, each leg is IK'd to its floor plus its animated lift, knees forward, planted feet kept flat.
- `lookYaw` turns neck + head (used in cover: back to the wall, head toward the camera).
- `animator.impulse(pitch, roll)` kicks the hit-reaction spring.
- Check pose changes from the side and front (see project.md testing), not only from behind.

## Spider mech (`src/game/actors/spider.js`)
- Not the humanoid rig: its own bones (body, turret, two shutters, femur + tibia per leg) baked with `RigidSkin`.
- Leg bones are children of the root, posed in root space each frame by `placeBone` (+Y along the segment);
  a broken leg's bones are scaled to ~0 (hides the skinned parts without a rebake).
