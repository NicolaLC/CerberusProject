# Animation & rig

All characters use `Rig` from `src/rig.js`.

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
`{ speed, sprint, crouch 0..1, aimPitch, combat, recoil, lean, lookYaw, lower }`.
- Layers: reset to rest → hit spring → legs → torso → arms → feet IK.
- Walk: pendulum legs, small hip twist and bob.
- Run (sprint, blended in over ~0.15s), deliberately anime: `RUN` table — 0.42 rad forward lean, high knees
  (thigh forward 1.25), heel kick (knee 2.1), hang-time bounce, hips twist with shoulders counter-rotating,
  head kept level. The left hand lets go of the gun and pumps; the right hand carries it low.
- Kneel (low cover) blends over everything with `crouch`.
- Arms: two-bone IK to the grip sockets, elbows down and slightly out. `lower` (weapon switch) drops the gun.
- Feet IK (when `ground(x, z, maxY)` is given; the player has it, hanging puppets don't): hips drop to the
  lowest foot's floor, each leg is IK'd to its floor plus its animated lift, knees forward, planted feet kept flat.
- `lookYaw` turns neck + head (used in cover: back to the wall, head toward the camera).
- `animator.impulse(pitch, roll)` kicks the hit-reaction spring.
- Check pose changes from the side and front (see project.md testing), not only from behind.
