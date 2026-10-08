# Game feel & post

Tuning lives in `TUNING` at the top of `game/view/camera.js`, `juice.js` and the uniforms in `post.js`.
All of it reacts to gameplay events (see the events table in architecture.md); gameplay never calls it.

## Camera (`camera.js`)
- Trauma shake: `addTrauma(0..1)`, shake = trauma², sum-of-sines noise on position, pitch, yaw, roll; decays 1.6/s. Visual only (aim uses the unshaken forward).
- Shoulder offset 0.85m (0.95m aiming).
- Smoothed follow of the head pivot (XZ stiffness 22, Y 10) so cover snaps and vaults glide.
- FOV punch per shot (+0.9°) and on kills (+3°). FOV / distance: 70° 3.4m, aim 50° 1.9m, sprint 78° 3.9m.
- Recoil: per-gun pattern applied through a fast spring; most of it is recovered after the burst unless you
  pulled against it yourself (details in gameplay.md, Gunplay). The gun model kicks back and climbs (`kick`).
- Strafe roll, head bob (walk 0.015, sprint 0.05), landing/cover dip spring (`dip()`).

## Feedback per event (`juice.js`, `fx.js`, `audio.js`)
| Event | Feedback |
| --- | --- |
| shot | trauma 0.06, FOV punch, muzzle flash + light (×`flash` per gun), smoke, tracer, brass casing; layered sound (crack, body, room tail; MG action clack); rising click in the last 20% of the mag |
| hit | hitmarker pops by damage; tick (body), double ping (head), sparkle (weak spot) |
| MG spin-up | barrel whine follows `weapon.spin` |
| headshot | 25ms hitstop |
| kill | 70ms hitstop at 0.08× time, trauma 0.22, white flash, cyan shockwave ring, spark burst, kill chime, big red hitmarker |
| hurt | trauma 0.38, red chromatic aberration pulse |
| reload jam / perfect | trauma 0.15 / FOV punch + white flash |
| cover / vault landing | trauma + camera dip |

## Post (`post.js`)
Bloom 0.4 outside / 0.7 inside. Grade: warm tint outside, cool inside; vignette tightens while aiming; desaturates and reddens at low health.
