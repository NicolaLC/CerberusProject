import * as THREE from 'three';

// Cover spots for AI, generated once from the level's cover boxes (world.box(..., { cover })).
// Every vertical face of a cover box gets spots 0.65 m off the face:
//   low cover  -> spots along the face (crouch behind it, stand up to shoot over it)
//   high cover -> only spots near a face end (hide behind it, step sideways to the edge to shoot)
// A spot protects from a threat when the box lies between them (2D segment vs box test).

const TUNING = {
  offset: 0.65, // spot distance from the face
  spacing: 1.2, // between spots along a low face
  edgeReach: 0.9, // high-cover spots must be this close to a face end to peek
  peekStep: 0.8, // sideways step out of high cover to shoot
  bodyRadius: 0.4,
  maxTravel: 22, // m: how far an AI will run for a spot
  idealRange: 15, // m: preferred distance to the threat
  minRange: 6, // closer than this to the threat is not an option
};

const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const CORNER_PAD = 0.8; // detour corners sit this far outside the cover box

export class CoverMap {
  constructor(world) {
    this.world = world;
    this.t = TUNING;
    this.spots = [];
    for (const c of world.colliders) if (c.cover) this.#addBox(c);
  }

  #addBox(col) {
    const b = col.box;
    const t = this.t;
    const faces = [
      { n: [1, 0], at: b.max.x, axis: 'z', lo: b.min.z, hi: b.max.z },
      { n: [-1, 0], at: b.min.x, axis: 'z', lo: b.min.z, hi: b.max.z },
      { n: [0, 1], at: b.max.z, axis: 'x', lo: b.min.x, hi: b.max.x },
      { n: [0, -1], at: b.min.z, axis: 'x', lo: b.min.x, hi: b.max.x },
    ];
    for (const f of faces) {
      const len = f.hi - f.lo;
      const along = [];
      if (col.cover === 'high') {
        // ends only (peekable), unless the face is narrow: then the center reaches both edges
        if (len <= t.edgeReach * 2) along.push(f.lo + len / 2);
        else along.push(f.lo + 0.45, f.hi - 0.45);
      } else {
        const n = Math.max(1, Math.floor((len - 0.4) / t.spacing) + 1);
        for (let i = 0; i < n; i++) along.push(f.lo + (len * (i + 0.5)) / n);
      }
      for (const s of along) {
        const pos = new THREE.Vector3();
        if (f.axis === 'z') pos.set(f.at + f.n[0] * t.offset, b.min.y, s);
        else pos.set(s, b.min.y, f.at + f.n[1] * t.offset);
        // must stand on the box's floor and be free of other geometry
        const ground = this.world.groundAt(pos.x, pos.z, b.min.y + 0.3);
        if (Math.abs(ground - b.min.y) > 0.05) continue;
        pos.y = ground;
        _a.copy(pos);
        this.world.collideCircle(_a, t.bodyRadius, 1.6, 0.3);
        if (_a.distanceToSquared(pos) > 1e-4) continue;
        const normal = new THREE.Vector3(f.n[0], 0, f.n[1]); // from the box toward the spot
        const tangent = new THREE.Vector3(-normal.z, 0, normal.x);
        // high cover: step toward the nearer face end to shoot
        let peek = 0;
        if (col.cover === 'high') peek = s - f.lo < f.hi - s ? -1 : 1;
        if (f.axis === 'x') peek *= tangent.x >= 0 ? 1 : -1;
        else peek *= tangent.z >= 0 ? 1 : -1;
        this.spots.push({ pos, normal, tangent, type: col.cover, box: b, peek, owner: null, badUntil: 0 });
      }
    }
  }

  // Does the spot's box stand between the spot and the threat (on the ground plane)?
  protects(spot, threat) {
    const dx = threat.x - spot.pos.x;
    const dz = threat.z - spot.pos.z;
    // the threat must be roughly behind the box as seen from the spot (within ~50°), not grazing it
    if (dx * spot.normal.x + dz * spot.normal.z > -0.65 * Math.hypot(dx, dz)) return false;
    return segmentHitsBox(spot.pos, threat, spot.box, 0.05);
  }

  // Where an AI in this spot stands to shoot.
  firingPos(spot, out) {
    out.copy(spot.pos);
    if (spot.type === 'high') out.addScaledVector(spot.tangent, spot.peek * this.t.peekStep);
    return out;
  }

  // Route from -> spot: [] if the straight line is clear, [corner] for a detour around the spot's own box
  // (the usual case: getting behind cover means walking around it), null if neither works.
  // No general pathfinding: one waypoint is enough for this arena's isolated boxes.
  route(from, spot) {
    const w = this.world;
    if (w.segmentClear(from, spot.pos, 0.35)) return { path: [], length: from.distanceTo(spot.pos) };
    const b = spot.box;
    let best = null;
    for (const [x, z] of [[b.min.x, b.min.z], [b.min.x, b.max.z], [b.max.x, b.min.z], [b.max.x, b.max.z]]) {
      _c.set(x + Math.sign(x - (b.min.x + b.max.x) / 2) * CORNER_PAD, from.y, z + Math.sign(z - (b.min.z + b.max.z) / 2) * CORNER_PAD);
      if (!w.segmentClear(from, _c, 0.35) || !w.segmentClear(_c, spot.pos, 0.35)) continue;
      const length = from.distanceTo(_c) + _c.distanceTo(spot.pos);
      if (!best || length < best.length) best = { path: [_c.clone()], length };
    }
    return best;
  }

  // Best free spot for `ai` (at from) against `threat`: protected, reachable (straight or around its box),
  // at a useful range. Returns { spot, path } or null. opts.avoid: a spot not to pick again;
  // opts.retreat: prefer distance from the threat.
  find(ai, from, threat, now, opts = {}) {
    const t = this.t;
    let best = null;
    let bestScore = Infinity;
    for (const s of this.spots) {
      if ((s.owner && s.owner !== ai) || s === opts.avoid || s.badUntil > now) continue;
      if (Math.abs(s.pos.y - from.y) > 0.5) continue; // same floor level only (no pathfinding)
      if (s.pos.distanceTo(from) > t.maxTravel) continue;
      const range = s.pos.distanceTo(threat);
      if (range < t.minRange) continue;
      if (!this.protects(s, threat)) continue;
      const ideal = opts.retreat ? t.idealRange + 8 : t.idealRange;
      // cheap part of the score first: routing (several segment tests) only for candidates that can win
      const base = Math.abs(range - ideal) * 0.6 + Math.random() * 1.5;
      if (base + s.pos.distanceTo(from) >= bestScore) continue;
      const r = this.route(from, s);
      if (!r || r.length > t.maxTravel * 1.3) continue;
      const score = r.length + base;
      if (score < bestScore) {
        bestScore = score;
        best = { spot: s, path: r.path };
      }
    }
    return best;
  }

  claim(spot, ai) {
    spot.owner = ai;
  }

  release(spot, ai) {
    if (spot && spot.owner === ai) spot.owner = null;
  }
}

// 2D (xz) segment a -> b against an AABB grown by `pad`.
export function segmentHitsBox(a, b, box, pad = 0) {
  let t0 = 0;
  let t1 = 1;
  const axis = (p, d, lo, hi) => {
    if (Math.abs(d) < 1e-9) return p > lo && p < hi;
    let ta = (lo - p) / d;
    let tb = (hi - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    return t0 < t1;
  };
  return axis(a.x, b.x - a.x, box.min.x - pad, box.max.x + pad) && axis(a.z, b.z - a.z, box.min.z - pad, box.max.z + pad);
}
