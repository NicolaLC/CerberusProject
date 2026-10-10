import { GUNS } from '../combat/guns.js';

// Library tool (#68, instructions/gym.md "Library"): the showroom's helper. It does three things.
//  1. Auto aisle: every registered piece id that the level file does not show is spawned at load in the kit aisle
//     (`level.kitAisle`), from its `example` meta, with a caption, so a new piece appears without editing library.json.
//     Spawned through the owning system (world.spawn / enemies.spawn / registry.build) and freed in dispose().
//  2. Wake one (V): the nearest enemy exhibit sees the real player and fights (`hostile`); V again puts a fresh,
//     calm copy in its place. Every other exhibit stays a harmless demo enemy (`level.demo`).
//  3. Panel: id, owner and label of the exhibit nearest to the player.
// An exhibit is a level piece named "ex:<id>".

const TUNING = {
  near: 14, // m: farthest exhibit the panel names
  refresh: 0.2, // s between panel updates
  wrap: 30, // characters per caption line in the auto aisle
};
const AISLE = { x: -28, z: -46, dx: 7, cols: 9, dz: 10 }; // used when the level has no `kitAisle`

export function gunLabel(id) {
  const g = GUNS[id];
  if (!g) return '';
  const f = g.falloff ? `${g.falloff.start}-${g.falloff.end} m x${g.falloff.min}` : 'none';
  return `${g.name} | DMG ${g.damage} MAG ${g.mag} FALLOFF ${f}`;
}

function wrap(text, n) {
  const lines = [];
  let line = '';
  for (const w of String(text).split(' ')) {
    if (line && line.length + 1 + w.length > n) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export class LibraryTool {
  // shown in the key bar (view/keyhints.js) whatever the panel's state
  static KEYS = [['V', 'wake / calm the nearest enemy']];

  constructor(game, level) {
    this.game = game;
    this.level = level;
    const { registry, enemies, pickups, world } = game;
    this.exhibits = []; // { id, owner, data, pos: [x, y, z], label, actor?, awake?, auto }
    this.auto = []; // the auto aisle's exhibits (subset of exhibits)
    this.handles = []; // what the tool spawned, to free: { owner, thing }
    this.spawned = { world: 0, enemies: 0, pickups: 0 };
    this.failed = [];
    this.panelT = 0;

    // exhibits of the file: enemy actors were built in file order by Enemies.load
    const actors = enemies.puppets.slice();
    let n = 0;
    for (const data of level.pieces) {
      const owner = registry.owner(data.id);
      const actor = owner === 'enemies' ? actors[n++] : undefined;
      if (!data.name?.startsWith('ex:')) continue;
      this.exhibits.push(this.#exhibit(data, owner, false, actor));
    }

    // auto aisle: ids the file does not show
    const shown = new Set(level.pieces.map((p) => p.id));
    const a = level.kitAisle ?? AISLE;
    let i = 0;
    for (const id of registry.ids()) {
      if (shown.has(id) || id === 'env.label') continue;
      const m = registry.meta(id);
      const x = a.x + (i % a.cols) * a.dx;
      const z = a.z - Math.floor(i / a.cols) * a.dz;
      i++;
      const data = { id, pos: [x, 0, z], yaw: m.example?.yaw, params: m.example?.params ?? {} };
      const owner = registry.owner(id);
      try {
        const ex = this.#exhibit(data, owner, true, this.#spawn(owner, data));
        this.exhibits.push(ex);
        this.auto.push(ex);
        this.spawned[owner]++;
        this.#caption(ex);
      } catch (err) {
        this.failed.push(id);
        console.error(`library: could not spawn "${id}": ${err.message}`);
      }
    }

    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'fixed', left: '8px', top: '8px', zIndex: 50, padding: '6px 10px', font: '11px/1.5 monospace', whiteSpace: 'pre',
      color: '#ffe14a', background: 'rgba(0,0,0,0.55)', pointerEvents: 'none', maxWidth: '46ch',
    });
    document.body.appendChild(this.panel);
    this.onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName ?? '')) return;
      if (e.code === 'KeyV') this.toggleWake();
    };
    addEventListener('keydown', this.onKey);
    this.#refreshPanel();
  }

  #exhibit(data, owner, auto, thing) {
    const m = this.game.registry.meta(data.id);
    const label = data.id === 'prop.gun' ? gunLabel(data.params?.gun) : (m.label ?? '');
    const ex = { id: data.id, owner, data, pos: data.pos, label, auto, awake: false };
    if (owner === 'enemies') ex.actor = thing;
    return ex;
  }

  // Builds one piece in its owning system and remembers how to free it.
  #spawn(owner, data) {
    const { world, enemies, pickups, registry } = this.game;
    if (owner === 'world') {
      const h = world.spawn(data);
      this.handles.push({ owner, thing: h });
      return h;
    }
    if (owner === 'enemies') {
      const a = enemies.spawn(data);
      this.handles.push({ owner, thing: a });
      return a;
    }
    const item = registry.build('pickups', pickups, data);
    this.handles.push({ owner, thing: item });
    return item;
  }

  #caption(ex) {
    const [x, , z] = ex.pos;
    const text = `${ex.id}\n${wrap(ex.label, TUNING.wrap)}`.trim();
    const h = this.game.world.spawn({ id: 'env.label', pos: [x, 0, z + 3.2], params: { text, size: 0.22, flat: true } });
    this.handles.push({ owner: 'world', thing: h });
  }

  // ---- keys ----

  nearest(ofOwner = null, from = this.game.player.pos) {
    let best = null;
    let bd = Infinity;
    for (const e of this.exhibits) {
      if (ofOwner && e.owner !== ofOwner) continue;
      const d = Math.hypot(e.pos[0] - from.x, e.pos[2] - from.z);
      if (d < bd) [best, bd] = [e, d];
    }
    return best && { exhibit: best, distance: bd };
  }

  // The nearest enemy exhibit fights, or (if it already does) is replaced by a calm copy. Returns it.
  toggleWake() {
    const hit = this.nearest('enemies');
    if (!hit) return null;
    const ex = hit.exhibit;
    const { enemies } = this.game;
    if (!ex.awake) {
      ex.actor.hostile = true;
      ex.awake = true;
    } else {
      const h = this.handles.find((x) => x.thing === ex.actor);
      enemies.despawn(ex.actor);
      ex.actor = enemies.spawn(ex.data);
      ex.awake = false;
      if (h) h.thing = ex.actor;
      if (ex.actor.kind === 'boss') enemies.boss = ex.actor;
    }
    this.#refreshPanel();
    return ex;
  }

  // ---- panel ----

  update(dt) {
    this.panelT -= dt;
    if (this.panelT <= 0) {
      this.panelT = TUNING.refresh;
      this.#refreshPanel();
    }
  }

  #refreshPanel() {
    const hit = this.nearest();
    const ex = hit && hit.distance < TUNING.near ? hit.exhibit : null;
    const lines = ['LIBRARY   V wake / calm the nearest enemy'];
    if (!ex) lines.push('no exhibit nearby');
    else {
      lines.push(`${ex.id}  (${ex.owner})${ex.owner === 'enemies' ? (ex.awake ? '  AWAKE' : '  idle') : ''}`);
      if (ex.label) lines.push(ex.label);
    }
    const awake = this.exhibits.filter((e) => e.awake).length;
    lines.push(`${this.exhibits.length} exhibits, ${this.auto.length} in the kit aisle, ${awake} awake`);
    const text = lines.join('\n');
    if (text !== this.panelText) this.panel.textContent = this.panelText = text;
    this.shown = ex;
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    this.panel.remove();
    const { world, enemies, pickups } = this.game;
    for (const { owner, thing } of this.handles.reverse()) {
      if (owner === 'world') world.despawn(thing);
      else if (owner === 'enemies') enemies.despawn(thing);
      else pickups.despawn(thing);
    }
    this.handles.length = 0;
  }
}
