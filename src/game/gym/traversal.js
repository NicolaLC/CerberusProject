import * as THREE from 'three';

// Gym tool: Traversal and cover room (#64, level src/levels/gym.json, notes in instructions/gym.md).
// A readout panel (T) for what the room measures: feet / ground height, speed, cover, vault, jet, and how far the
// camera is pulled in. G cycles the player through the stations. It only reads gameplay state (events and fields),
// it changes nothing but the player's position on a teleport.
const REACH = 2.2; // VAULT.runInReach: how far ahead the run-in vault looks
const HOP_DEPTH = 1.2; // VAULT.hopDepth
const RUN_IN = 3.5; // VAULT.runIn: speed that starts a run-in vault
const PULL_EPS = 0.03; // m the camera may sit closer than wanted before it counts as pulled in

// Where G puts the player: the start of each row, facing the way the row is walked (yaw like Player.facing:
// PI = north, PI / 2 = east). Same order as the rows of the level file, from the spawn northwards.
export const STATIONS = [
  { name: 'spawn', pos: [0, 0, 18], yaw: Math.PI },
  { name: 'cover height 0.8-2.0 (items 1, 8, 19)', pos: [0, 0, 1], yaw: Math.PI },
  { name: 'vault depth 0.6-2.4 (items 10, 11)', pos: [0, 0, -17], yaw: Math.PI },
  { name: 'vault height 1.0-1.6 (item 1)', pos: [0, 0, -37], yaw: Math.PI },
  { name: 'jet height 1.0-2.0 (item 2)', pos: [0, 0, -55], yaw: Math.PI },
  { name: 'jet gaps 2.0-7.0 (item 3)', pos: [-66, 0, -86], yaw: Math.PI / 2 },
  { name: 'corridors 1.6-4.0 (item 4)', pos: [0, 0, -94], yaw: Math.PI },
  { name: 'ceilings 2.4-5.0 (item 5)', pos: [0, 0, -123], yaw: Math.PI },
  { name: 'lintels 1.7-4.0 (item 6)', pos: [0, 0, -144], yaw: Math.PI },
  { name: 'cover length (item 7)', pos: [0, 0, -160], yaw: Math.PI },
  { name: 'run-up lanes 0.5-3.0 (item 9)', pos: [0, 0, -190], yaw: Math.PI },
  { name: 'landing space 0.6-1.4 (item 10)', pos: [0, 0, -211], yaw: Math.PI },
  { name: 'stairs rise and run (item 12)', pos: [0, 0, -231], yaw: Math.PI },
  { name: 'standard stair + platform (item 20)', pos: [-10, 0, -271], yaw: Math.PI },
  { name: 'peek tests', pos: [0, 0, -297], yaw: Math.PI },
];

const PANEL_STYLE = [
  'position:fixed', 'left:16px', 'top:64px', 'z-index:40', 'padding:6px 10px', 'pointer-events:none', 'white-space:pre',
  'font:11px/1.45 var(--font-main, monospace)', 'color:#9fe8ff', 'background:rgba(0,0,0,0.6)', 'border-left:2px solid #38d8ff',
].join(';');

const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _to = new THREE.Vector3();
const fix = (n, p = 2) => n.toFixed(p);

export class TraversalTool {
  // shown in the key bar (view/keyhints.js) whatever the panel's state
  static KEYS = [['T', 'readout panel'], ['G', 'next station']];

  constructor(game, level) {
    this.game = game;
    this.level = level;
    this.stations = STATIONS;
    this.station = 0;
    this.visible = true;
    this.vault = { kind: null, age: 99 }; // last vault: 'hop' | 'slide' | 'refused'
    this.ahead = null; // low cover in the run-in reach and its landing, see #probeAhead
    this.jet = { active: false, from: new THREE.Vector3(), peak: 0, last: null }; // last: { peak, dist, y }
    this.acc = 1; // seconds since the panel text was rewritten (every 0.1 s)

    this.el = document.createElement('div');
    this.el.style.cssText = PANEL_STYLE;
    this.el.id = 'gym-traversal';
    document.body.appendChild(this.el);

    const events = game.engine.events;
    this.off = [
      events.on('player:vault', (kind) => (this.vault = { kind, age: 0 })),
      events.on('player:vaultRefused', () => (this.vault = { kind: 'refused', age: 0 })),
      events.on('player:jet', () => this.#onJet()),
    ];
    this.onKey = (e) => {
      if (e.repeat || e.target?.closest?.('select, input, textarea')) return;
      if (e.code === 'KeyT') this.toggle();
      else if (e.code === 'KeyG') this.next();
    };
    addEventListener('keydown', this.onKey);
  }

  toggle(on = !this.visible) {
    this.visible = on;
    this.el.style.display = on ? '' : 'none';
  }

  // Teleports to station i (wraps): a clean player (no cover, no velocity) at the row start, camera behind it.
  goto(i) {
    this.station = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length;
    const s = STATIONS[this.station];
    const { player, camRig } = this.game;
    player.place({ pos: s.pos, yaw: s.yaw });
    camRig.reset(player.facing);
    this.jet.active = false;
    this.ahead = null;
    this.acc = 1;
    return s;
  }

  next() {
    return this.goto(this.station + 1);
  }

  // Camera distance to the pivot against the distance it wants (CameraRig.update): pulled in when a wall or ceiling
  // is in the ray from the pivot. wanted = side + back + the 0.15 lift, the same sum the camera uses.
  camPull() {
    const { camRig, engine } = this.game;
    _to.copy(camRig.right).multiplyScalar(camRig.side).addScaledVector(camRig.forward, -camRig.dist);
    _to.y += 0.15;
    const wanted = _to.length();
    const actual = engine.camera.position.distanceTo(camRig.pivot);
    return { wanted, actual, pulled: actual < wanted - PULL_EPS };
  }

  // Highest walkable top under the feet (what the player stands on).
  groundUnder() {
    const { player, world } = this.game;
    return world.groundAt(player.pos.x, player.pos.z, player.pos.y + player.t.stepHeight, player.t.radius * 0.5);
  }

  // Snapshot of every readout (the panel prints it, the test reads it).
  state() {
    const { player } = this.game;
    const c = player.cover;
    return {
      feetY: player.pos.y,
      ground: this.groundUnder(),
      speed: Math.hypot(player.vel.x, player.vel.z),
      cover: c ? c.type : null,
      edgeL: !!c?.edgeL,
      edgeR: !!c?.edgeR,
      pinned: !!player.pinned,
      vault: this.vault.kind,
      vaultAge: this.vault.age,
      airborne: player.airborne,
      jetting: player.jetting > 0,
      jetCooldown: player.jetTimer,
      lastJet: this.jet.last,
      cam: this.camPull(),
      ahead: this.ahead,
    };
  }

  #onJet() {
    const { player } = this.game;
    this.jet.active = true;
    this.jet.from.copy(player.pos);
    this.jet.peak = 0;
  }

  // Low cover straight ahead (the way we move, else the camera's) within the run-in reach, and whether its landing is
  // free: the same test as Player.#tryVault (a collider taller than the step and lower than the head touching the
  // r = 0.4 circle 0.65 behind the far face refuses the vault). Reads; never moves anything.
  #probeAhead() {
    const { player, world, camRig } = this.game;
    this.ahead = null;
    const sp = Math.hypot(player.vel.x, player.vel.z);
    if (sp > 0.5) _d.set(player.vel.x / sp, 0, player.vel.z / sp);
    else camRig.flatForward(_d);
    _ray.set(_o.set(player.pos.x, player.pos.y + 0.5, player.pos.z), _d);
    _ray.far = REACH;
    const hit = _ray.intersectObjects(world.coverMeshes, false)[0];
    if (!hit?.face || Math.abs(hit.face.normal.y) > 0.3 || hit.face.normal.dot(_d) > -0.5) return;
    const col = hit.object.userData.collider;
    const b = col.box;
    if (b.max.y - player.pos.y >= 1.7) return;
    const n = hit.face.normal;
    const depth = Math.abs(n.x) > 0.5 ? b.max.x - b.min.x : b.max.z - b.min.z;
    const dist = _to.subVectors(player.pos, hit.point).dot(n);
    const r = player.t.radius;
    _to.copy(player.pos).addScaledVector(n, -(dist + depth + r + 0.25));
    let blocked = false;
    for (const c of world.colliders) {
      const bb = c.box;
      if (bb.max.y <= player.pos.y + player.t.stepHeight || bb.min.y > player.pos.y + 1.8) continue;
      if (_to.x > bb.min.x - r && _to.x < bb.max.x + r && _to.z > bb.min.z - r && _to.z < bb.max.z + r) blocked = true;
    }
    const intent = sp > RUN_IN || player.cover?.type === 'low';
    this.ahead = { top: b.max.y - player.pos.y, depth, dist, hop: depth <= HOP_DEPTH, blocked, intent };
  }

  update(dt) {
    const { player } = this.game;
    this.vault.age += dt;
    if (this.jet.active) {
      this.jet.peak = Math.max(this.jet.peak, player.pos.y - this.jet.from.y);
      if (!player.airborne) {
        this.jet.active = false;
        this.jet.last = { peak: this.jet.peak, dist: Math.hypot(player.pos.x - this.jet.from.x, player.pos.z - this.jet.from.z), y: player.pos.y };
      }
    }
    this.#probeAhead();
    this.acc += dt;
    if (this.acc < 0.1 || !this.visible) return;
    this.acc = 0;
    this.el.textContent = this.#text();
  }

  #text() {
    const s = this.state();
    const j = s.lastJet;
    const a = s.ahead;
    const cover = s.cover ? `${s.cover}${s.edgeL ? ' edge-L' : ''}${s.edgeR ? ' edge-R' : ''}${s.pinned ? ' PINNED' : ''}` : 'none';
    const vault = s.vault ? `${s.vault} (${s.vaultAge.toFixed(1)} s ago)` : '-';
    const jet = s.airborne ? (s.jetting ? 'thrust' : 'airborne') : s.jetCooldown > 0 ? `cooldown ${s.jetCooldown.toFixed(1)} s` : 'ready';
    return [
      `GYM · TRAVERSAL   T panel   G next station`,
      `station ${this.station}: ${STATIONS[this.station].name}`,
      `feet y ${fix(s.feetY)}   ground ${fix(s.ground)}   speed ${fix(s.speed, 1)} m/s`,
      `cover  ${cover}`,
      `vault  ${vault}`,
      a ? `ahead low ${fix(a.top)} high, depth ${fix(a.depth)} (${a.hop ? 'hop' : 'slide'}), ${fix(a.dist)} m away, landing ${a.blocked ? 'BLOCKED' : 'clear'}` : 'ahead no low cover in reach',
      `jet    ${jet}${j ? `   last: peak ${fix(j.peak)}, ${fix(j.dist, 1)} m, landed y ${fix(j.y)}` : ''}`,
      `camera ${fix(s.cam.actual)} m of ${fix(s.cam.wanted)} m${s.cam.pulled ? `   PULLED IN ${fix(s.cam.wanted - s.cam.actual)}` : ''}`,
    ].join('\n');
  }

  dispose() {
    removeEventListener('keydown', this.onKey);
    for (const off of this.off) off();
    this.el.remove();
  }
}
