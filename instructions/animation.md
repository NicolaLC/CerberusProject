# Animation & rig

All characters use `Rig` from `src/rig.js`.

## Skeleton
- Bones (`BONES` table): pelvis, spine, chest, neck, head, clavicle/upperArm/foreArm/hand L+R,
  thigh/shin/foot L+R, plus `weapon` (on chest) for the held gun.
- No rest rotations. Character faces +Z; right side is -X. Limb bones extend along local -Y,
  so `rotation.x < 0` swings a limb forward.
- `rig.root` is the character origin at the feet; set its position and `rotation.y` (facing).
- `H` in game toggles `SkeletonHelper`s.

## Dummy parts (pivots for modeled parts)
- `rig.buildDummy(materials)` puts one placeholder box per bone (`DUMMY` table), material slots `body` / `plate`.
- Replace a piece with a modeled one: `rig.setPart('head', mesh)`. Author the mesh with its origin at the
  bone pivot, +Y up toward the parent joint, facing +Z. Meshes get shadows and `userData.bone` automatically.
- Extra pieces that are not the main part: `rig.attach(bone, object)`.
- Sockets (`rig.socket(bone, name, x, y, z)`): `gripR`, `gripL`, `muzzle` on `weapon`; `emitter` on puppets' chest.
- Hit zones come from bone names (`HIT_ZONE`): head/neck → head, pelvis/spine/chest → torso, rest → limb.

## Animator (procedural)
`new Animator(rig, { armed })`, then each frame `animator.update(dt, state)` with
`{ speed, sprint, crouch 0..1, aimPitch, combat, recoil, lean }`.
- Layers: reset to rest → hit spring → legs (walk/run cycle blended with kneel) → spine/chest aim share
  → weapon bone pitch → two-bone arm IK to grip sockets (armed) or swinging arms (unarmed).
- `animator.impulse(pitch, roll)` kicks the hit-reaction spring.
- To add a clip, add a layer in `Animator.update`; keep it a pure function of `state` + time.
