// Seedable PRNG (mulberry32). Give each gameplay system its own stream so its randomness is
// reproducible (tests, replays) and doesn't shift when another system rolls more or fewer dice.
export class Rng {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.seed(seed);
  }

  seed(s) {
    this.s = s >>> 0;
    return this;
  }

  // [0, 1)
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
