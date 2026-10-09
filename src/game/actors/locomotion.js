// Locomotion from key poses (after David Rosen's GDC 2014 "An Indie Approach to Procedural Animation"):
// each gait is a handful of authored leg poses over one cycle, interpolated with a smooth cyclic spline,
// scaled by speed, and played at the rate that makes the planted foot travel exactly at ground speed.
// The Animator (rig.js) applies the pose by FK, then locks planted feet in place with IK.
//
// Units: radians. Leg keys are for the LEFT leg over one cycle, t in [0, 1), left heel strike at t = 0; the
// right leg plays the same keys half a cycle later.
//   thigh: UpLeg rotation.x (negative swings the leg forward)
//   knee:  Leg rotation.x (positive bends the knee)
//   foot:  foot pitch relative to the hips (0 flat, positive toes down)
// Hips keys cover one step (half a cycle): [t, height offset m, pitch].
// `ref`: speed (m/s) the keys are authored for; slower or faster scales the leg swing (sqrt, clamped).
// `duty`: share of the cycle a foot is on the ground (its stance ends at the toe-off key).

export const GAITS = {
  walk: {
    ref: 1.4,
    duty: 0.6,
    twist: 0.09, // hips yaw toward the leading leg
    roll: 0.05, // hips dip on the swing side
    legs: [
      [0.0, -0.42, 0.06, -0.3], // contact: heel strike, toes up
      [0.1, -0.32, 0.3, -0.02], // loading: knee gives a little
      [0.3, -0.02, 0.1, 0.0], // mid-stance: straight leg under the body
      [0.5, 0.3, 0.12, 0.3], // terminal stance: heel peels up
      [0.6, 0.32, 0.55, 0.65], // toe off
      [0.72, 0.1, 1.05, 0.35], // initial swing: knee folds
      [0.85, -0.3, 0.75, 0.05], // mid swing: knee leads
      [0.95, -0.48, 0.15, -0.2], // terminal swing: leg reaches
    ],
    hips: [
      [0.0, -0.02, 0.03],
      [0.2, -0.035, 0.035], // loading: lowest
      [0.5, 0.01, 0.03], // passing: highest
      [0.8, 0.0, 0.03],
    ],
  },
  run: {
    ref: 4.2,
    duty: 0.34,
    twist: 0.14,
    roll: 0.04,
    legs: [
      [0.0, -0.5, 0.35, -0.05], // contact under the body, knee soft
      [0.1, -0.2, 0.7, 0.0], // compression
      [0.25, 0.3, 0.4, 0.35], // push
      [0.34, 0.48, 0.35, 0.7], // toe off: long trailing leg
      [0.45, 0.35, 1.55, 0.6], // follow-through: heel kicks up
      [0.6, -0.35, 2.05, 0.45], // tuck: heel under the seat
      [0.75, -0.95, 1.6, 0.15], // knee drive
      [0.88, -0.85, 0.7, -0.05], // shin swings out
      [0.95, -0.62, 0.4, -0.08], // reach, pawing back for contact
    ],
    // heights stay small: the bent support leg already sinks the hips, and the flight arc (rig.js) lifts them
    hips: [
      [0.0, 0.0, 0.08],
      [0.2, -0.015, 0.09], // compression: lowest
      [0.5, 0.0, 0.08],
      [0.75, 0.0, 0.07],
    ],
  },
};

export const RUN_AT = [2.0, 3.2]; // m/s: walk -> run blend (a sprint forces run)
const THIGH = 0.42; // rig leg lengths (rig.js BONES)
const SHIN = 0.4;
export const LEG_REST = THIGH + SHIN; // hip joint to ankle, straight

// Ankle position relative to the hip joint for a leg pose: forward (z) and down (positive).
export function ankleZ(thigh, knee) {
  return -THIGH * Math.sin(thigh) - SHIN * Math.sin(thigh + knee);
}
export function ankleDown(thigh, knee) {
  return THIGH * Math.cos(thigh) + SHIN * Math.cos(thigh + knee);
}

// Cyclic Catmull-Rom through keys [t, ...values] at time t in [0, 1). Writes values into out[0..n).
export function sampleCyclic(keys, t, out) {
  const n = keys.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    if (keys[k][0] > t) {
      i = k - 1;
      break;
    }
  }
  if (i < 0) i = n - 1;
  const k0 = keys[(i - 1 + n) % n];
  const k1 = keys[i];
  const k2 = keys[(i + 1) % n];
  const k3 = keys[(i + 2) % n];
  const t1 = k1[0];
  let t2 = k2[0];
  if (t2 <= t1) t2 += 1;
  let tt = t;
  if (tt < t1) tt += 1;
  const u = (tt - t1) / (t2 - t1);
  const u2 = u * u;
  const u3 = u2 * u;
  for (let j = 1; j < k1.length; j++) {
    const p0 = k0[j];
    const p1 = k1[j];
    const p2 = k2[j];
    const p3 = k3[j];
    out[j - 1] = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
  }
  return out;
}

// Stance travel (how far back the planted ankle moves, m) of each gait at its authored size.
const _s = [0, 0, 0];
for (const g of Object.values(GAITS)) {
  sampleCyclic(g.legs, 0, _s);
  const a = ankleZ(_s[0], _s[1]);
  sampleCyclic(g.legs, g.duty, _s);
  g.travel = a - ankleZ(_s[0], _s[1]);
}

// Leg swing scale at a speed: smaller steps when slow, bigger when fast.
export function amplitude(gait, speed) {
  return Math.min(1.25, Math.max(0.3, Math.sqrt(speed / gait.ref)));
}

// Cycles per second so the planted foot moves back exactly at `speed`: travel × amp per duty × cycle.
export function frequency(gait, speed) {
  return (speed * gait.duty) / (gait.travel * amplitude(gait, speed));
}
