# Gameplay

## Player (`player.js` TUNING)
- Walk 4.6, sprint 7.4 (Shift + forward, not while aiming/firing), aim walk 2.6 m/s
- Shields 100 (regen 45/s after 3.5s), health 100 (regen 12/s after 6s). Death → respawn at spawn after 3s.

## Input
- Aim: hold RMB, or E toggles (in trackpad mode a click toggles too). Fire: LMB or F. Arrow keys look.
- Trackpad mode: two-finger swipe (wheel events) looks; aim is a toggle; aim assist stronger (1.6 vs 0.8).
- Aim assist (`camRig.assist`): within ~4-8° of a visible puppet's chest the look slows (friction) and eases toward it.
- Look sensitivity multiplier lives in settings.

## Ammo
- Pickups fill every gun at once (`pickup.crate` / `pickup.drop` per gun: AR 96/32, MG 135/45). Cases at fixed `SPOTS`
  in `pickups.js` respawn after 15s.
- Broken puppets drop a clip 45% of the time (vanishes after 25s, blinks at the end).
- Walk within 1.1m to collect; a full reserve leaves it there ("AMMO FULL").

## Cover
- `Space` near a cover box (reach 2.2m, move dir or camera forward, then 8 directions) snaps to it.
- Cover type from height above feet: < 1.7m = low, else high. Boxes are cover only if created with `{ cover }`.
- Slide along the face with A/D (camera relative); stops 0.2m before an edge. Moving away from the cover exits.
- Low: crouched; aim or fire pops up (fire waits until standing). `Space` + W vaults over.
- Out of combat the character turns its back to the wall and looks at the camera.
- High: standing; aiming at an edge peeks 0.8m sideways and swaps shoulder to that side.

## Weapons (`guns.js`, controller in `weapon.js`)
- 1 / 2 or mouse wheel switches (0.45s lower/raise, model swaps at the bottom). Ammo is tracked per gun.
- M-8 Avenger (AR): 540 rpm, mag 32, reserve 192/384, reload 1.8s, 18 dmg, head ×2.5, weak ×3, limbs ×0.8.
  Spread hip 0.022 / aim 0.004 + bloom 0.007 per shot.
- M-76 Revenant (MG): 780 rpm after a 0.4s spin-up (starts at 35%), mag 90, reserve 270/450, reload 3.0s,
  13 dmg, head ×2, weak ×3. Wider spread, more sideways recoil and shake; walking slows to 2.2 m/s while firing.
- Add a gun: new entry in `GUNS` (stats, sockets, `build()` model) and its id in `GUN_ORDER`.
- Hit = camera ray (starts at player distance), then re-cast from muzzle; muzzle hit wins.

## Puppets (`enemies.js`)
- static 100hp, mover 100hp (rail), shooter 120hp: hidden → up → telegraph (visor glow 0.45s) → 3 bolts → hide.
- Weak spots: 2 random body parts per spawn get a pulsing magenta patch (zone `weak`, ×3 damage). Re-rolled on respawn.
- Bolts: 34 m/s, 7 dmg, collide with world and the player capsule.
- Death breaks the rig parts into debris; respawn after 6s. Spawn list: `SPAWNS` at top of the file.
