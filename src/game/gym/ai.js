import * as THREE from 'three';
import { disposeTree } from '../../engine/dispose.js';
import { ENGAGE_RANGE } from '../actors/puppet.js';

// Gym tool: Enemy behaviour rooms (#66, instructions/gym.md).
// Keys (this scene only, own listener):  J respawn the enemies  K freeze the AI  L player invisible  O overlays.
// Overlays (only with `?debug`, game.debug), all owned and freed here: range rings on the floor, a vision line to the
// player where there is line of sight, a state text over each enemy, trooper -> cover spot (and route waypoint) lines,
// and every cover spot of the trooper room as a floor marker (reserved ones in another colour).
// A small panel top-left lists the keys and toggle states (always shown, it is the room's help).

const COLORS = {
  notice: 0x38d8ff, // trooper notices / drone wakes (cyan)
  engage: 0xff9b2f, // shooting range (orange)
  wake: 0xff2bd6, // wake ranges of the drone and the spider (magenta)
  body: 0xff4a3a, // spider collision and stomp
  orbit: 0xffe14a, // drone circling band around the player
  vision: 0x4dff7a, // line of sight, in range
  seen: 0xffe14a, // line of sight, out of range
  toCover: 0xff9b2f,
  route: 0xff2bd6,
  low: 0x39ff88,
  high: 0x4aa8ff,
  reserved: 0xff3b3b,
  bad: 0x777777,
};
const RING_Y = 0.06;
const LABEL_RANGE = 70; // m: state texts farther than this are hidden
const PANEL_EVERY = 0.25; // s

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _m = new THREE.Matrix4();
const _col = new THREE.Color();
const _white = new THREE.Color(1, 1, 1);

export class AiTool {
  constructor(game, level) {
    this.game = game;
    this.level = level;
    this.enemies = game.enemies;
    this.rooms = level.rooms ?? {};
    this.overlaysOn = game.debug;
    this.panelTimer = 0;

    this.panel = document.createElement('div');
    Object.assign(this.panel.style, {
      position: 'fixed', left: '8px', top: '8px', zIndex: 50, padding: '6px 10px', font: '11px/1.5 monospace', whiteSpace: 'pre',
      color: '#9fe8ff', background: 'rgba(0,0,0,0.55)', pointerEvents: 'none',
    });
    document.body.appendChild(this.panel);

    this.onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName ?? '')) return;
      if (e.code === 'KeyJ') this.respawn();
      else if (e.code === 'KeyK') this.toggleFreeze();
      else if (e.code === 'KeyL') this.toggleInvisible();
      else if (e.code === 'KeyO') this.toggleOverlays();
    };
    addEventListener('keydown', this.onKey);

    // overlays: one group, one dynamic line batch, shared ring geometry, one instanced marker batch
    this.group = null;
    this.rings = []; // { enemy, mesh, radius() }
    this.tags = []; // { enemy, el, text }
    this.lines = null;
    this.markers = null;
    this.spots = [];
    this.snapshot = [];
    if (game.debug) this.#buildOverlays();
    this.#refreshPanel();
  }

  // ---------------- keys ----------------

  // Fresh enemies from the level file; everything else (player, pickups, position, toggles) stays as it is.
  respawn() {
    const { game, enemies } = this;
    const hidden = this.invisible;
    enemies.load(this.level);
    enemies.demo = hidden; // load() resets it from the level
    // the skeleton helpers (H) belong to the old rigs: rebuild them like Game.loadScene does
    for (const h of game.helpers) disposeTree(h);
    game.helpers = enemies.puppets.filter((p) => p.rig).map((p) => {
      const h = p.rig.helper();
      h.visible = game.skeletons;
      game.engine.scene.add(h);
      return h;
    });
    this.#rebuildEnemyOverlays();
    this.#refreshPanel();
  }

  get frozen() {
    return this.enemies.frozen;
  }

  get invisible() {
    return !!this.enemies.demo;
  }

  toggleFreeze() {
    this.enemies.frozen = !this.enemies.frozen;
    this.#refreshPanel();
  }

  // The Library trick: enemies get a view of the player that reads `dead`, so they stand down.
  toggleInvisible() {
    this.enemies.demo = !this.enemies.demo;
    this.#refreshPanel();
  }

  toggleOverlays() {
    this.overlaysOn = !this.overlaysOn;
    this.#applyVisibility();
    this.#refreshPanel();
  }

  // ---------------- overlays ----------------

  #buildOverlays() {
    this.group = new THREE.Group();
    this.group.name = 'gym-ai overlays';
    this.game.engine.scene.add(this.group);
    this.ringGeo = new THREE.RingGeometry(0.992, 1, 128).rotateX(-Math.PI / 2);
    this.ringMats = {};
    this.layer = document.createElement('div');
    Object.assign(this.layer.style, { position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 40 });
    document.body.appendChild(this.layer);

    // dynamic lines (vision, cover, route, arena bounds): vertex colours, drawRange set every frame
    const cap = 8 * this.enemies.puppets.length + 64;
    this.linePos = new Float32Array(cap * 6);
    this.lineCol = new Float32Array(cap * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.lineCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.lineCap = cap;
    this.group.add(this.lines);

    this.#rebuildEnemyOverlays();
    this.#applyVisibility();
  }

  // Cover spots of the trooper room: flat discs, one instanced draw. Rebuilt with the enemies: a new cover map each load.
  #buildMarkers() {
    if (this.markers) disposeTree(this.markers);
    this.markers = null;
    const room = this.rooms.troopers;
    const inRoom = (p) => !room || (p.x > room.minX - 0.5 && p.x < room.maxX + 0.5 && p.z > room.minZ - 0.5 && p.z < room.maxZ + 0.5);
    this.spots = (this.enemies.cover?.spots ?? []).filter((s) => inRoom(s.pos));
    if (!this.spots.length) return;
    const geo = new THREE.CircleGeometry(0.22, 12).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.markers = new THREE.InstancedMesh(geo, mat, this.spots.length);
    this.markers.frustumCulled = false;
    this.markerKey = new Int8Array(this.spots.length).fill(-1);
    this.spots.forEach((s, i) => {
      this.markers.setMatrixAt(i, _m.makeTranslation(s.pos.x, s.pos.y + 0.05, s.pos.z));
      this.markers.setColorAt(i, _white);
    });
    this.group.add(this.markers);
  }

  ringMat(color) {
    return (this.ringMats[color] ??= new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
  }

  // Rings and state texts follow the enemy list (rebuilt after a respawn).
  #rebuildEnemyOverlays() {
    if (!this.group) return;
    for (const r of this.rings) r.mesh.removeFromParent(); // geometry and materials are shared, freed in dispose
    for (const m of this.orbit ?? []) m.removeFromParent();
    for (const t of this.tags) t.el.remove();
    this.rings.length = 0;
    this.tags.length = 0;
    this.snapshot = [...this.enemies.puppets];
    this.#buildMarkers();
    const ring = (enemy, color, radius) => {
      const mesh = new THREE.Mesh(this.ringGeo, this.ringMat(color));
      mesh.renderOrder = 9;
      this.group.add(mesh);
      this.rings.push({ enemy, mesh, radius });
    };
    for (const e of this.enemies.puppets) {
      if (e.kind === 'trooper') {
        ring(e, COLORS.notice, () => e.t.sight);
        ring(e, COLORS.engage, () => e.t.engage);
      } else if (e.kind === 'shooter') ring(e, COLORS.engage, () => ENGAGE_RANGE);
      else if (e.kind === 'drone') ring(e, COLORS.wake, () => e.t.sight);
      else if (e.kind === 'boss') {
        ring(e, COLORS.wake, () => e.t.wakeRange);
        ring(e, COLORS.body, () => e.t.stomp.range);
        ring(e, COLORS.body, () => e.t.radius);
      }
      const el = document.createElement('div');
      Object.assign(el.style, {
        position: 'absolute', left: 0, top: 0, padding: '1px 5px', font: '700 11px monospace', whiteSpace: 'nowrap', color: '#fff',
        background: 'rgba(0,0,0,0.6)', willChange: 'transform', display: 'none',
      });
      this.layer.appendChild(el);
      this.tags.push({ enemy: e, el, text: '' });
    }
    // the drone's circling band is around the player: two rings that follow it
    this.orbit = this.enemies.puppets.some((e) => e.kind === 'drone') ? [9, 18].map((r) => {
      const mesh = new THREE.Mesh(this.ringGeo, this.ringMat(COLORS.orbit));
      mesh.scale.setScalar(r);
      this.group.add(mesh);
      return mesh;
    }) : [];
    this.#applyVisibility();
  }

  #applyVisibility() {
    if (!this.group) return;
    this.group.visible = this.overlaysOn;
    this.layer.style.display = this.overlaysOn ? '' : 'none';
  }

  // Eye of an enemy (where its sight line starts), or null if it has no vision.
  #eye(e, out) {
    switch (e.kind) {
      case 'trooper': return out.copy(e.pos).setY(e.pos.y + (e.crouch > 0.5 ? 1.0 : 1.6));
      case 'shooter': return out.copy(e.pos).setY(e.pos.y + 1.7 + e.lift);
      case 'drone': return e.body.getWorldPosition(out);
      case 'boss': return e.muzzle.getWorldPosition(out);
      default: return null;
    }
  }

  #range(e) {
    return e.kind === 'trooper' ? e.t.sight : e.kind === 'shooter' ? ENGAGE_RANGE : e.kind === 'drone' ? e.t.sight : e.t.wakeRange;
  }

  #sees(from, to) {
    const len = _d.subVectors(to, from).length();
    _ray.set(from, _d.divideScalar(len));
    _ray.far = Math.max(0.01, len - 0.4);
    return _ray.intersectObjects(this.game.world.meshes, false).length === 0;
  }

  static describe(e) {
    switch (e.kind) {
      case 'trooper': return `trooper ${e.state}${e.flanking ? ' FLANK' : ''}${e.alerted && !e.spot ? ' (no cover)' : ''}`;
      case 'shooter': return `shooter ${e.state}`;
      case 'mover': return 'mover';
      case 'static': return 'static';
      case 'drone': return e.falling ? 'drone down' : e.awake ? `drone ${e.gun.state}` : 'drone dormant';
      case 'boss': return !e.awake ? 'spider dormant' : e.down > 0 ? 'spider DOWN' : `spider ${e.stomp.state !== 'idle' ? `stomp ${e.stomp.state}` : e.gun.state}`;
      default: return e.kind;
    }
  }

  update(dt) {
    this.panelTimer -= dt;
    if (this.panelTimer <= 0) {
      this.panelTimer = PANEL_EVERY;
      this.#refreshPanel();
    }
    if (!this.group) return;
    // the enemy list can change under us (a scene reload keeps the tool, a test can call enemies.load)
    const list = this.enemies.puppets;
    if (list.length !== this.snapshot.length || list.some((e, i) => e !== this.snapshot[i])) this.#rebuildEnemyOverlays();
    if (!this.overlaysOn) return;
    const { player, engine } = this.game;
    const camera = engine.camera;
    camera.updateMatrixWorld();
    const eyeP = player.chest(_b);

    for (const r of this.rings) {
      const e = r.enemy;
      r.mesh.visible = e.alive;
      r.mesh.scale.setScalar(r.radius());
      r.mesh.position.set(e.pos.x, e.pos.y + RING_Y, e.pos.z);
    }
    const drones = this.enemies.puppets.some((e) => e.kind === 'drone' && e.alive && e.awake);
    for (const m of this.orbit) {
      m.visible = drones;
      m.position.set(player.pos.x, player.pos.y + RING_Y, player.pos.z);
    }

    // lines
    let n = 0;
    const seg = (a, b, color) => {
      if (n >= this.lineCap) return;
      _col.set(color);
      a.toArray(this.linePos, n * 6);
      b.toArray(this.linePos, n * 6 + 3);
      for (let k = 0; k < 2; k++) _col.toArray(this.lineCol, n * 6 + k * 3);
      n++;
    };
    for (const e of this.enemies.puppets) {
      if (!e.alive) continue;
      const eye = this.#eye(e, _a);
      if (eye && !player.dead && eye.distanceTo(eyeP) < 90 && this.#sees(eye, eyeP)) {
        seg(eye, eyeP, eye.distanceTo(eyeP) < this.#range(e) ? COLORS.vision : COLORS.seen);
      }
      if (e.kind === 'trooper' && e.spot && e.alerted) {
        const from = _a.copy(e.pos).setY(e.pos.y + 0.15);
        if (e.state === 'move' && e.path.length) {
          let prev = from;
          for (const w of e.path) {
            const p = _c.copy(w).setY(w.y + 0.15);
            seg(prev, p, COLORS.route);
            prev = _d.copy(p);
          }
          seg(prev, _c.copy(e.spot.pos).setY(e.spot.pos.y + 0.15), COLORS.route);
        } else seg(from, _c.copy(e.spot.pos).setY(e.spot.pos.y + 0.15), COLORS.toCover);
      }
      if (e.kind === 'boss') { // arena bounds
        const A = e.arena;
        const y = 0.2;
        const q = [[A.minX, A.minZ], [A.maxX, A.minZ], [A.maxX, A.maxZ], [A.minX, A.maxZ]];
        for (let i = 0; i < 4; i++) seg(_a.set(q[i][0], y, q[i][1]), _c.set(q[(i + 1) % 4][0], y, q[(i + 1) % 4][1]), COLORS.wake);
      }
    }
    this.lines.geometry.setDrawRange(0, n * 2);
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;

    // cover spots
    if (this.markers) {
      const now = this.enemies.time;
      let dirty = false;
      this.spots.forEach((s, i) => {
        const key = s.owner ? 2 : s.badUntil > now ? 3 : s.type === 'low' ? 0 : 1;
        if (key === this.markerKey[i]) return;
        this.markerKey[i] = key;
        this.markers.setColorAt(i, _col.set([COLORS.low, COLORS.high, COLORS.reserved, COLORS.bad][key]));
        dirty = true;
      });
      if (dirty) this.markers.instanceColor.needsUpdate = true;
    }

    // state texts, projected to the screen
    const w = innerWidth;
    const h = innerHeight;
    for (const t of this.tags) {
      const e = t.enemy;
      const up = e.kind === 'boss' ? 5.2 : e.kind === 'drone' ? 1.2 : 2.3;
      _a.set(e.pos.x, e.pos.y + up + (e.kind === 'drone' ? e.alt : 0), e.pos.z);
      const dist = _a.distanceTo(camera.position);
      let show = e.alive && dist < LABEL_RANGE && this.#sees(camera.position, _a); // not through walls
      _a.project(camera);
      show = show && _a.z < 1 && Math.abs(_a.x) < 1.1 && Math.abs(_a.y) < 1.1;
      if (!show) {
        if (t.el.style.display !== 'none') t.el.style.display = 'none';
        continue;
      }
      const text = AiTool.describe(e);
      if (text !== t.text) {
        t.text = text;
        t.el.textContent = text;
      }
      t.el.style.display = '';
      t.el.style.transform = `translate(${((_a.x + 1) / 2) * w}px, ${((1 - _a.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }

  // ---------------- panel ----------------

  #roomOf(p) {
    for (const [name, r] of Object.entries(this.rooms)) if (p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ) return name;
    return 'hub / corridor';
  }

  #refreshPanel() {
    const on = (v) => (v ? 'ON ' : 'off');
    const { enemies, game } = this;
    const live = enemies.puppets.filter((e) => e.alive);
    const awake = live.filter((e) => e.awake || (e.kind === 'trooper' && e.alerted)).length;
    const lines = [
      'GYM · ENEMIES',
      `J  respawn enemies`,
      `K  freeze AI       ${on(enemies.frozen)}`,
      `L  player hidden   ${on(enemies.demo)}`,
      `O  overlays        ${game.debug ? on(this.overlaysOn) : 'needs ?debug'}`,
      `room ${this.#roomOf(game.player.pos)} · enemies ${live.length}/${enemies.puppets.length} · awake ${awake}`,
    ];
    const text = lines.join('\n');
    if (text !== this.text) this.panel.textContent = this.text = text;
  }

  // ---------------- free everything ----------------

  dispose() {
    removeEventListener('keydown', this.onKey);
    this.panel.remove();
    this.layer?.remove();
    this.tags.length = 0;
    this.rings.length = 0;
    if (this.group) {
      disposeTree(this.group); // lines, markers, rings: geometries, materials, instance buffers
      this.ringGeo.dispose();
      for (const m of Object.values(this.ringMats)) m.dispose();
      this.group = null;
    }
    this.enemies.frozen = false;
    this.enemies.demo = !!this.level.demo;
  }
}
