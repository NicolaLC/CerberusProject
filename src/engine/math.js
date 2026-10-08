import * as THREE from 'three';

// Allocation-free math helpers shared by engine and game code.

// Frame-rate independent smoothing factor: x += (target - x) * damp(rate, dt).
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

// Closest distance between segments p1-q1 and p2-q2.
export function segSegDist(p1, q1, p2, q2) {
  const d1 = _d1.subVectors(q1, p1);
  const d2 = _d2.subVectors(q2, p2);
  const r = _r.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const clamp = THREE.MathUtils.clamp;
  let s;
  let t;
  if (a <= 1e-8 && e <= 1e-8) return p1.distanceTo(p2);
  if (a <= 1e-8) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-8) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  _c1.copy(p1).addScaledVector(d1, s);
  _c2.copy(p2).addScaledVector(d2, t);
  return _c1.distanceTo(_c2);
}
