# Game feel & post

Tuning lives in `TUNING` at the top of `camera.js`, `juice.js` and the uniforms in `post.js`.

## Camera (`camera.js`)
- Trauma shake: `addTrauma(0..1)`, shake = trauma², sum-of-sines noise on position, pitch, yaw, roll; decays 1.6/s. Visual only (aim uses the unshaken forward).
- Shoulder offset 0.85m (0.95m aiming).
- Smoothed follow of the head pivot (XZ stiffness 22, Y 10) so cover snaps and vaults glide.
- FOV punch per shot (+0.9°) and on kills (+3°), sprint FOV 78, aim FOV 50.
- Recoil: each shot kicks pitch; 90% is recovered after you stop firing unless you pulled down yourself.
- Strafe roll, sprint head bob, landing/cover dip spring (`dip()`).

## Events (`juice.js`)
| Event | Feedback |
| --- | --- |
| shot | trauma 0.06, FOV punch, muzzle flash + light, smoke, tracer, brass casing |
| headshot | 25ms hitstop |
| kill | 70ms hitstop at 0.08× time, trauma 0.22, white flash, cyan shockwave ring, spark burst |
| hurt | trauma 0.38, red chromatic aberration pulse |
| cover / vault landing | trauma + camera dip |

## Post (`post.js`)
Bloom 0.4 outside / 0.7 inside. Grade: warm tint outside, cool inside; vignette tightens while aiming; desaturates and reddens at low health.
