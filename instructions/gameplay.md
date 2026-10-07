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
- Mag 32, reserve starts 192, max 384. Cases at fixed `SPOTS` in `pickups.js` give 96 and respawn after 15s.
- Broken puppets drop a 32-round clip 45% of the time (vanishes after 25s, blinks at the end).
- Walk within 1.1m to collect; a full reserve leaves it there ("AMMO FULL").

## Cover
- `Space` near a cover box (reach 2.2m, move dir or camera forward, then 8 directions) snaps to it.
- Cover type from height above feet: < 1.7m = low, else high. Boxes are cover only if created with `{ cover }`.
- Slide along the face with A/D (camera relative); stops 0.2m before an edge. Moving away from the cover exits.
- Low: crouched; aim or fire pops up (fire waits until standing). `Space` + W vaults over.
- High: standing; aiming at an edge peeks 0.8m sideways and swaps shoulder to that side.

## Weapon (`weapon.js` TUNING)
- 540 rpm, mag 32, reserve 256, reload 1.8s, 18 dmg, head ×2.5, limbs ×0.8
- Spread: hip 0.022, aim 0.004 rad + bloom 0.007/shot (max 0.05, decays 0.12/s)
- Hit = camera ray (starts at player distance), then re-cast from muzzle; muzzle hit wins.

## Puppets (`enemies.js`)
- static 100hp, mover 100hp (rail), shooter 120hp: hidden → up → telegraph (visor glow 0.45s) → 3 bolts → hide.
- Bolts: 34 m/s, 7 dmg, collide with world and the player capsule.
- Death breaks the rig parts into debris; respawn after 6s. Spawn list: `SPAWNS` at top of the file.
