// Uniform XZ grid hash: items (axis-aligned footprints) are bucketed per cell, a query returns the items in the
// cells a rectangle covers. Used for static colliders (world.js) and per-substep enemy buckets (enemies.js).
// Results are deduplicated with a stamp on the item (no Set) and sorted by insertion order, so a consumer that is
// order dependent (collideCircle pushes sequentially) behaves exactly like a linear scan of the same list.
// No allocation per query: the returned array is the grid's own and is valid until the next query on that grid.

const OFF = 512; // cell coordinates are clamped to +-OFF (edge cells absorb anything farther out)
const WIDE = 64; // an item covering more cells than this lives in `wide` and is returned by every query
let stamp = 0;

export class Grid {
  constructor(cell) {
    this.inv = 1 / cell;
    this.cells = new Map(); // key -> items
    this.wide = [];
    this.out = [];
    this.n = 0;
  }

  #c(v) {
    const i = Math.floor(v * this.inv);
    return i < -OFF ? -OFF : i > OFF ? OFF : i;
  }

  // Empties the grid but keeps the cell arrays (dynamic use: refill every substep).
  clear() {
    for (const a of this.cells.values()) a.length = 0;
    this.wide.length = 0;
    this.n = 0;
  }

  insert(item, x0, z0, x1, z1) {
    item._gi = this.n++;
    const ix0 = this.#c(x0), ix1 = this.#c(x1), iz0 = this.#c(z0), iz1 = this.#c(z1);
    if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > WIDE) {
      this.wide.push(item);
      return;
    }
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const k = (ix + OFF) * 2048 + iz + OFF;
        let a = this.cells.get(k);
        if (!a) this.cells.set(k, (a = []));
        a.push(item);
      }
    }
  }

  // Candidates whose cells overlap the rectangle: a superset of the items overlapping it, in insertion order.
  query(x0, z0, x1, z1) {
    const out = this.out;
    out.length = 0;
    const s = ++stamp;
    const ix0 = this.#c(x0), ix1 = this.#c(x1), iz0 = this.#c(z0), iz1 = this.#c(z1);
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const a = this.cells.get((ix + OFF) * 2048 + iz + OFF);
        if (!a) continue;
        for (let i = 0; i < a.length; i++) {
          const it = a[i];
          if (it._gs !== s) {
            it._gs = s;
            out.push(it);
          }
        }
      }
    }
    for (let i = 0; i < this.wide.length; i++) out.push(this.wide[i]);
    // insertion sort by insertion index (arrays are short)
    for (let i = 1; i < out.length; i++) {
      const it = out[i];
      let j = i - 1;
      while (j >= 0 && out[j]._gi > it._gi) {
        out[j + 1] = out[j];
        j--;
      }
      out[j + 1] = it;
    }
    return out;
  }
}
