# Gym

Four scenes, one per room (Gym epic #58). Each room is a level file plus a tool (`src/game/gym/<tool>.js`, level
field `tool`) for its readouts, overlays and keys, and a browser suite that uses the room as its fixture.
Measured values go into `instructions/metrics.md` (section 8); this file says what each room contains and how to use it.

## Traversal and cover (`?scene=gym`, #64)

(to be written)

---

## Weapon range (`?scene=gym-range`, #65)

A 126 m lane for the guns: damage falloff, spread, recoil and long sight lines. Level `gym-range.json`, tool
`gym/range.js`, suite `tests/gym-range.browser.mjs`.

**Layout** (z = 0 is the firing line, the lane runs north to z = -110; x -7..7, walls 7 m):
- Firing line: cyan strip at z = 0, spawn at (1.5, 0, 0.5). Floor labels "5 m" .. "100 m" on both edges plus a
  cross line every 5 m; banners over the lane at 25 / 50 / 75 / 100 m (bigger with distance). 47 labels in all
  (each is one draw call: keep it under about 60).
- 13 static dummies at 5 10 15 20 25 30 35 40 50 60 70 80 100 m, facing the line. Their x is scattered (-2..6.2)
  so that from some stance on the line every dummy has a clear shot, at least 1.7 m from every nearer one
  (the suite asserts 1.2). Strafe along the line to line one up.
- Bench (low cover 1.1, x -7..-2, z 1) with a light and a heavy ammo crate next to it, and a recoil wall (flat,
  5 x 4 m, face at z = -10, x -7..-2) straight ahead of the bench; stand at x = -4.5 to shoot it.
- Cover bay at 30-34 m on the east side: low cover (1.1) at z -30.5 and high cover (2.8) at z -34.2, x 5, with
  room behind for a trooper (metric item 16).

**Tool (`RangeTool`)**
- Panel (top left): gun name, falloff start / end / min, spread (hip, aim, current) and the cone diameter at 10 m,
  and the last hit with its distance, damage dealt and the damage guns.js predicts (zone multiplier x falloff), zone, crit.
- The last damage number stays over every dummy (yellow = head, magenta = weak spot) until M.
- Falloff markers: a green floor strip at the gun's falloff start and a red one at its end, measured from the firing
  line (the muzzle stands about 1.2-1.6 m ahead of the player's position, so shots read that much shorter than the
  floor distance). No strips for the sniper and the railgun (no falloff).
- Recoil wall dots: every impact on the wall stays as a dot, coloured yellow to red by its place in the burst.
- Keys: **B** clears the dots, **N** hides / shows the readouts, **M** resets the dummy readouts. Other rooms use
  other letters.
- The dummies never die: the tool wraps each dummy's `damage()` (runs the real one with unlimited health, then
  restores it), because a single sniper or railgun round exceeds a dummy's 100 hp and could not be undone after
  the fact. No change to the enemy code; the wrapper goes away with the tool.

**Using it as a fixture**: the suite stands at `D` metres in front of a dummy (on a clear line), aims at the chest
and fires; the muzzle-to-hit distance in the `weapon:hit` event and the zone give the expected damage
(`damage x zone multiplier x falloff`), which must equal the dealt damage. It reads the spread of every gun at hip
and aimed, checks that the markers follow the gun, that a burst on the recoil wall leaves one dot per impact, and
runs the trooper sight-line probe (it prints, asserts only the deterministic parts).

**Measured (metric item 16, long sight lines)**: a trooper in the open or in the cover bay, the player in the
lane, 12 s of game time. Troopers notice only below 32 m (idle at 32, 34, 40 m), a trooper noticing at 30 m does
not shoot (the shoot range is a strict < 30): shots started from at most 28.7 m. A trooper noticed at 26-30 m
runs to cover 12-14 m from the player and fires from there. So 30 m is the longest effective trooper range and
32 m the longest they notice; the 30-34 m bay is a safe distance for the player.

---

## Enemy behaviour (`?scene=gym-ai`, #66)

(to be written)

---

## Performance stress (`?scene=gym-stress`, #67)

(to be written)
