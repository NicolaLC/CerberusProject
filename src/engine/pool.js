// Object pool: reuse instead of allocate in hot paths (particles, projectiles, DOM labels).
// create() builds a new item when the pool is empty; reset(item) runs on release.
// `max` caps how many idle items are kept; beyond that, released items are dropped (dispose hook).
export class Pool {
  constructor(create, { reset = null, dispose = null, max = 512 } = {}) {
    this.create = create;
    this.reset = reset;
    this.dispose = dispose;
    this.max = max;
    this.free = [];
  }

  acquire() {
    return this.free.pop() ?? this.create();
  }

  release(item) {
    this.reset?.(item);
    if (this.free.length < this.max) this.free.push(item);
    else this.dispose?.(item);
  }

  // Pre-build items so the first burst doesn't allocate (and doesn't compile shaders mid-fight).
  warm(n) {
    while (this.free.length < n) this.free.push(this.create());
    return this;
  }
}
