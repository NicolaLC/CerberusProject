import * as THREE from 'three';

// Grid pathing for walkers (the SX-6's pursuit, a trooper's hunt). No navmesh: a `cell` m grid over a box, a cell free where a
// collision circle of `radius` fits at `feet` (colliders whose top is within `climb` of the feet are stepped over, like
// collideCircle; colliders starting above `height` pass overhead), then breadth-first from the walker to the reachable cell
// nearest the goal. One floor level only.

// The grid over `bounds` ({ minX, minZ, maxX, maxZ }, the circle's centre stays inside it).
export function navGrid(world, bounds, { radius, cell, feet, climb, height }) {
  const x0 = bounds.minX + radius;
  const z0 = bounds.minZ + radius;
  const nx = Math.max(1, Math.floor((bounds.maxX - radius - x0) / cell) + 1);
  const nz = Math.max(1, Math.floor((bounds.maxZ - radius - z0) / cell) + 1);
  const free = new Uint8Array(nx * nz);
  const fit = (radius + 0.05) ** 2; // the collision circle and a hair: a squeeze the circle can't pass is no passage
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      const z = z0 + k * cell;
      let ok = 1;
      for (const { box: b } of world.nearColliders(x - radius, z - radius, x + radius, z + radius)) {
        if (b.max.y <= feet + climb || b.min.y >= feet + height) continue;
        const ddx = x - Math.max(b.min.x, Math.min(x, b.max.x));
        const ddz = z - Math.max(b.min.z, Math.min(z, b.max.z));
        if (ddx * ddx + ddz * ddz < fit) {
          ok = 0;
          break;
        }
      }
      free[k * nx + i] = ok;
    }
  }
  const n = nx * nz;
  return { x0, z0, nx, nz, cell, free, prev: new Int32Array(n), queue: new Int32Array(n) };
}

// Breadth-first from `from` to the reachable cell nearest `goal`; returns `out` set to the path cell `ahead` cells on (y = from.y),
// or null (already as near as it gets).
export function navStep(N, from, goal, ahead, out) {
  const { x0, z0, nx, nz, cell, free, prev, queue } = N;
  const i = THREE.MathUtils.clamp(Math.round((from.x - x0) / cell), 0, nx - 1);
  const k = THREE.MathUtils.clamp(Math.round((from.z - z0) / cell), 0, nz - 1);
  const start = k * nx + i;
  prev.fill(-2);
  prev[start] = -1;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  let best = start;
  let bestD = Infinity;
  while (head < tail) {
    const c = queue[head++];
    const cx = c % nx;
    const cz = (c - cx) / nx;
    const d = (x0 + cx * cell - goal.x) ** 2 + (z0 + cz * cell - goal.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        const x = cx + ox;
        const z = cz + oz;
        if ((!ox && !oz) || x < 0 || z < 0 || x >= nx || z >= nz) continue;
        const n = z * nx + x;
        if (prev[n] !== -2 || !free[n]) continue;
        if (ox && oz && (!free[cz * nx + x] || !free[z * nx + cx])) continue; // no corner cutting
        prev[n] = c;
        queue[tail++] = n;
      }
    }
  }
  if (best === start) return null;
  // walk back from the best cell to the one `ahead` steps from the start
  let len = 0;
  for (let c = best; c !== start; c = prev[c]) len++;
  let c = best;
  for (let s = len - Math.min(len, ahead); s > 0; s--) c = prev[c];
  const cx = c % nx;
  return out.set(x0 + cx * cell, from.y, z0 + ((c - cx) / nx) * cell);
}
