// Run stats (#15): what the debrief screen (view/summary.js) reports. Pure counters fed by events; no scene objects, nothing to
// dispose, and no knowledge of the screen. Reset by Game.resetRun (scene load, Workshop play / restart), frozen by `mission:complete`.
//
//  time           simulated seconds of play since the run began (not while paused, in the boot intro or in the editor; scaled by hitstop like all game time)
//  shots / hits   `weapon:shot` / `weapon:hit` events. A shot that hits armor glances off and is a miss; a piercing slug that crosses
//                 several enemies counts several hits, so `accuracy` is capped at 1
//  headshots      hits in the `head` zone (weak spots are `weakHits`, listed apart)
//  perfectReloads `weapon:reload` 'perfect'
//  kills          `puppet:down` (every enemy type)
//  salvage        placeholder, always 0 until Progression (#7) lands; the screen shows it as a dash
export class RunStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.time = 0;
    this.shots = 0;
    this.hits = 0;
    this.headshots = 0;
    this.weakHits = 0;
    this.perfectReloads = 0;
    this.kills = 0;
    this.salvage = 0;
    this.frozen = false;
  }

  // Hit rate 0..1 (0 before the first shot).
  get accuracy() {
    return this.shots ? Math.min(1, this.hits / this.shots) : 0;
  }

  // Permanent listeners (never per level): they count while the stats are not frozen.
  listen(events) {
    const live = (f) => (a) => !this.frozen && f(a);
    events.on('weapon:shot', live(() => this.shots++));
    events.on('weapon:hit', live((h) => {
      this.hits++;
      if (h.zone === 'head') this.headshots++;
      else if (h.weak) this.weakHits++;
    }));
    events.on('weapon:reload', live((kind) => kind === 'perfect' && this.perfectReloads++));
    events.on('puppet:down', live(() => this.kills++));
    events.on('mission:complete', () => (this.frozen = true));
    return this;
  }

  // Simulated seconds of play (the 'play' group's dt).
  update(dt) {
    if (!this.frozen) this.time += dt;
  }

  // A plain copy for the screen and tests.
  snapshot() {
    const { time, shots, hits, headshots, weakHits, perfectReloads, kills, salvage, accuracy } = this;
    return { time, shots, hits, accuracy, headshots, weakHits, perfectReloads, kills, salvage };
  }
}
