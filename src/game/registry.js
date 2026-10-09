// Piece registry: maps a stable string id ("enemy.trooper", "env.box", ...) to how that piece is built from data.
// Level files, saves and tools (Gym, Library, Workshop) refer to pieces by these ids, so ids are a public
// contract: never rename or reuse one (list and data shape: instructions/level.md).
//
// A piece is plain data: { id, pos: [x, y, z], yaw?: radians, params?: {...}, name?: string }.
// Each system module exports a table of the pieces it owns (WORLD_PIECES, ENEMY_PIECES, PICKUP_PIECES) and
// game.js registers them here. A builder is `(system, data) => piece` and runs against its owning system, so
// the registry itself imports nothing and gameplay modules never reach each other through it.
// Table entry: a builder function, or { build, ...meta } (meta, e.g. `stand: true`, is read through `meta(id)`).

export class Registry {
  #entries = new Map(); // id -> { owner, build, meta }

  // Registers every entry of `table` for the system called `owner` ('world' | 'enemies' | 'pickups').
  register(owner, table) {
    for (const [id, entry] of Object.entries(table)) {
      if (this.#entries.has(id)) throw new Error(`registry: duplicate piece id "${id}"`);
      const { build, ...meta } = typeof entry === 'function' ? { build: entry } : entry;
      this.#entries.set(id, { owner, build, meta });
    }
    return this;
  }

  has(id) {
    return this.#entries.has(id);
  }

  ids() {
    return [...this.#entries.keys()];
  }

  owner(id) {
    return this.#entries.get(id)?.owner ?? null;
  }

  meta(id) {
    return this.#entries.get(id)?.meta ?? {};
  }

  // Pieces of a level that `owner` builds, in file order (order matters: draw batching, enemy list).
  piecesOf(level, owner) {
    return level.pieces.filter((p) => this.owner(p.id) === owner);
  }

  // Builds one piece in its owning system. Returns whatever the builder returns.
  build(owner, system, data) {
    const e = this.#entries.get(data.id);
    if (!e) throw new Error(`registry: unknown piece id "${data.id}"`);
    if (e.owner !== owner) throw new Error(`registry: "${data.id}" is built by "${e.owner}", not "${owner}"`);
    return e.build(system, data);
  }

  // Throws a readable error for a malformed level (unknown ids, bad positions).
  check(level) {
    if (!Array.isArray(level.pieces)) throw new Error('level: "pieces" must be an array');
    if (!Array.isArray(level.spawn?.pos)) throw new Error('level: "spawn.pos" is required');
    level.pieces.forEach((p, i) => {
      if (!this.has(p.id)) throw new Error(`level: piece #${i} has unknown id "${p.id}"`);
      if (!Array.isArray(p.pos) || p.pos.length !== 3 || p.pos.some((n) => typeof n !== 'number')) {
        throw new Error(`level: piece #${i} ("${p.id}") needs pos: [x, y, z]`);
      }
    });
    return level;
  }
}
