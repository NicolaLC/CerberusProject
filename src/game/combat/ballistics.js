import * as THREE from 'three';

// Pure shot math (no scene access), unit-testable in node.

const _u = new THREE.Vector3();

// Direction inside a cone of half-angle `angle` (rad) around `forward`, uniform over the cone's disc.
// right/forward must be orthonormal. r1, r2 in [0, 1) (Math.random in game, fixed in tests).
export function coneDir(out, forward, right, angle, r1 = Math.random(), r2 = Math.random()) {
  if (angle <= 0) return out.copy(forward);
  const up = _u.crossVectors(right, forward); // camera up
  const r = Math.tan(angle) * Math.sqrt(r1);
  const a = r2 * Math.PI * 2;
  return out
    .copy(forward)
    .addScaledVector(right, Math.cos(a) * r)
    .addScaledVector(up, Math.sin(a) * r)
    .normalize();
}

// Recoil kick of the i-th shot of a burst: the gun's fixed pattern (learnable) plus a little jitter.
// Past the end of the pattern the last `loop` entries repeat. Returns [pitch, yaw] in radians.
export function recoilKick(recoil, i, out = [0, 0], r1 = Math.random(), r2 = Math.random()) {
  const p = recoil.pattern;
  const loop = Math.min(recoil.loop ?? 4, p.length);
  const k = i < p.length ? i : p.length - loop + ((i - p.length) % loop);
  const j = recoil.jitter ?? 0;
  out[0] = p[k][0] * (1 + (r1 - 0.5) * 2 * j);
  out[1] = p[k][1] + (r2 - 0.5) * 2 * j * Math.abs(p[k][0]);
  return out;
}

// Damage multiplier at distance d: 1 until `start`, linear to `min` at `end`.
export function falloff(f, d) {
  if (!f || d <= f.start) return 1;
  if (d >= f.end) return f.min;
  return 1 + ((d - f.start) / (f.end - f.start)) * (f.min - 1);
}

// Builds a recoil pattern from a per-shot function (i -> [pitch, yaw]) so guns read as data.
export function pattern(n, fn) {
  return Array.from({ length: n }, (_, i) => fn(i));
}
