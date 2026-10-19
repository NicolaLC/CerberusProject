import * as THREE from 'three';
import { Pool } from '../../engine/pool.js';
import { segSegDist } from '../../engine/math.js';
import { Puppet, HEALTH, ENGAGE_RANGE } from './puppet.js';
import { Trooper, TUNING as TROOPER } from './trooper.js';
import { SpiderMech, spiderLooks, TUNING as SPIDER } from './spider.js';
import { Cerberus, TUNING as CERBERUS } from './cerberus.js';
import { cerberusLooks } from './cerberus-model.js';
import { Drone, droneLooks, TUNING as DRONE } from './drone.js';
import { CoverMap } from '../ai/cover.js';
import { Grid } from '../world/grid.js';
import { DebrisBank } from './parts.js';
import { PROJECTILE } from './enemy.js';
import { GUNS } from '../combat/guns.js';

// The enemy system: spawns every enemy (training puppets, troopers, drones, the boss: one list, `all`), owns enemy
// projectiles, the cover map, the instanced puppet stands, the death-debris bank and the cached raycast target list.
// Actors do not get the system but `ctx`, a narrow view of it (see EnemyBody): they read cover / player / time / all,
// call spawnBolt / hurtPlayer / alertNear / separate / reportKill / markDirty / takeStand / setStand, and write nothing.
// Tool APIs: freeze(on), setBoss(actor), pose(actor, opts) (the Workshop editor uses them).

// Enemy pieces (registry ids, a public contract: instructions/level.md). Data: { id, pos, yaw?, params? }.
// The spawn list lives in the level file; builders run against this system and return the actor.
// params (all enemies): group (spawn group name, see wakeGroup), dormant (bool, needs a group: only wakeGroup wakes it); mover { to: [x, y, z], speed }, drone: pos = the ground under it, boss.spider { arena: { minX, maxX, minZ, maxZ } }, every enemy `look` (variant, see `look` below); boss.cerberus { arena, floor (0..1, the share of each head's health it never drops below), repair (of a head's health per second) }.
// `stand`: puppets on a pneumatic stand (one instanced base + post each).
// Inspector fields (level.md, piece meta): every enemy takes a spawn group.
const GROUP = { key: 'group', type: 'text', optional: true };
// `dormant` (every enemy): never wakes itself (no sight, hearing, arena entry or damage wake; a shooter never pops up or
// fires) but still takes hits and dies; only wakeGroup(its group) wakes it. Needs a group, or it could never wake.
const DORMANT = { key: 'dormant', type: 'bool', def: false };
// `hidden` (with `dormant`): not drawn and not a target until its group wakes (a later stage's squad that must not stand asleep in
// sight of an earlier fight, e.g. the Prologue's plated troopers in hall A while the hall A troopers fight).
const HIDDEN = { key: 'hidden', type: 'bool', def: false };
const POST = { key: 'post', type: 'bool', def: false }; // trooper: holds its spawn spot (trooper.js)
const ARMORED = { key: 'armored', type: 'bool', def: false }; // puppets: only heavy rounds hurt it (puppet.js armor); trooper: light rounds do x0.25 (trooper.js armor)
const dormantCheck = (p) =>
  p.dormant && (typeof p.group !== 'string' || !p.group) ? 'is dormant but has no group: nothing could ever wake it (set "group")' : p.hidden && !p.dormant ? 'is hidden but not dormant: only a dormant enemy waits hidden for its group' : null;
// `dropGun` (every enemy): the gun id it leaves on the floor when destroyed (a pickup, Pickups.dropGun), unless the player owns it already.
// `dropAmmo`: rounds in that pickup (default the gun's drop size). `dropOnce` (true): only the first destroyed enemy of the level drops that gun.
const DROP = [{ key: 'dropGun', type: 'enum', options: Object.keys(GUNS), optional: true }, { key: 'dropAmmo', type: 'number', min: 0, optional: true }, { key: 'dropOnce', type: 'bool', def: true }];
export function dropProblem(p, guns = null) {
  if (p.dropGun == null) return p.dropAmmo != null || p.dropOnce != null ? 'has dropAmmo / dropOnce but no dropGun' : null;
  if (typeof p.dropGun !== 'string' || !GUNS[p.dropGun] || (guns && !guns.includes(p.dropGun))) return `dropGun ${JSON.stringify(p.dropGun)} is not a known gun`;
  if (p.dropAmmo != null && !(typeof p.dropAmmo === 'number' && p.dropAmmo >= 0)) return 'dropAmmo must be a number, at least 0 (rounds)';
  if (p.dropOnce != null && typeof p.dropOnce !== 'boolean') return 'dropOnce must be true or false';
  return null;
}
// `look` (every enemy, optional, default 'default'): the variant of the kind's skeleton (animation.md, Every enemy has a skeleton).
// Humanoids: 'default' | 'plated' (plated = the `armored` param; `look` wins if both are given). The others: their looks table.
const look = (looks) => ({ key: 'look', type: 'enum', options: Object.keys(looks), optional: true });
const HUMANOID = look({ default: 0, plated: 0 });
const enemyCheck = (p, registry) => dormantCheck(p) ?? dropProblem(p, registry.guns);
const def = (kind, d) => ({ kind, pos: d.pos, yaw: d.yaw, ...d.params });
// `example` ({ params, yaw? }) is what the Library spawns; `label` is its one-line stat sheet (level.md, meta convention).
export const ENEMY_PIECES = {
  // `armored` (static / mover): plate steel, only heavy rounds hurt it (the range's heavy-weapon targets)
  'enemy.static': { stand: true, example: { params: {} }, label: `HP ${HEALTH.default} | stands, takes hits | look default / plated`, check: enemyCheck, fields: [GROUP, DORMANT, HIDDEN, ARMORED, HUMANOID, ...DROP], build: (sys, d) => new Puppet(sys.ctx, def('static', d)) },
  'enemy.mover': { stand: true, example: { params: { speed: 0 } }, label: `HP ${HEALTH.default} | slides on a rail | look default / plated`, check: enemyCheck, fields: [GROUP, DORMANT, HIDDEN, ARMORED, { key: 'to', type: 'vec3', optional: true }, { key: 'speed', type: 'number', min: 0 }, HUMANOID, ...DROP], build: (sys, d) => new Puppet(sys.ctx, def('mover', d)) },
  'enemy.shooter': { stand: true, example: { params: {} }, label: `HP ${HEALTH.shooter} | pops up and fires within ${ENGAGE_RANGE} m | look default / plated`, check: enemyCheck, fields: [GROUP, DORMANT, HIDDEN, HUMANOID, ...DROP], build: (sys, d) => new Puppet(sys.ctx, def('shooter', d)) },
  // moves between cover and shoots back
  'enemy.trooper': { example: { params: {} }, label: `HP ${TROOPER.health} | notices ${TROOPER.sight} m, shoots ${TROOPER.engage} m | look default / plated`, check: enemyCheck, fields: [GROUP, DORMANT, HIDDEN, ARMORED, POST, HUMANOID, ...DROP], build: (sys, d) => new Trooper(sys.ctx, def('trooper', d)) },
  // hovers and strafes, short bursts
  'enemy.drone': { example: { params: {} }, label: `HP ${DRONE.health} | wakes at ${DRONE.sight} m, hovers ${DRONE.hover[0]}-${DRONE.hover[1]} m | look ${Object.keys(droneLooks).join(" / ")}`, check: enemyCheck, fields: [GROUP, DORMANT, HIDDEN, look(droneLooks), ...DROP], build: (sys, d) => new Drone(sys.ctx, def('drone', d)) },
  // miniboss
  // CERBERUS (the Prologue's scripted loss): three heads, never destroyed, never counted (`unkillable`: kills / arena:clear / destroy objectives skip it).
  // `arena` (not in the inspector, like the spider's): where the player can be; wakes when they enter it, or by wakeGroup.
  'boss.cerberus': { example: { params: {} }, label: `3 heads x ${CERBERUS.head} HP | never destroyed, repairs to full above ${Math.round(CERBERUS.floor * 100)}%, hull is armor | look ${Object.keys(cerberusLooks).join(" / ")}`, check: enemyCheck, fields: [GROUP, DORMANT, HIDDEN, { key: 'floor', type: 'number', min: 0, max: 1, optional: true }, { key: 'repair', type: 'number', min: 0, optional: true }, look(cerberusLooks)], build: (sys, d) => new Cerberus(sys.ctx, def('boss', d)) },
  'boss.spider': { example: { params: {} }, label: `HP ${SPIDER.core} core | wakes at ${SPIDER.wakeRange} m or in its arena | look ${Object.keys(spiderLooks).join(" / ")}`, check: enemyCheck, fields: [GROUP, DORMANT, HIDDEN, look(spiderLooks), ...DROP], build: (sys, d) => new SpiderMech(sys.ctx, def('boss', d)) },
};

// Flank director: with 2+ troopers engaged, every FLANK_EVERY s one of them is sent around the player.
const FLANK = { every: 9, firstAfter: 5, retry: 2.5, engagedRange: 35 };

const _v = new THREE.Vector3();
const _front = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _w = new THREE.Vector3();
const _step = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _ray = new THREE.Raycaster();
const _hits = [];
const SEP_REACH = 3; // separate(): neighbours are looked up within this many minDist (positions move a little during the substep)
const _sep = new Grid(4); // living troopers, refilled every update (see separate)
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _sphere = new THREE.Sphere(undefined, 1.6);
const SLOW_EVERY = 3; // rigs far away or off screen pose every Nth frame
// reused event payloads: listeners must copy what they keep
const HURT = { amount: 0, dir: new THREE.Vector3() };
const BOLT_HIT = { point: null, normal: new THREE.Vector3() };

const BOLT = { speed: 44, life: 3, damage: 7, radius: 0.06 };

export class Enemies {
  // Permanent: bolt pool, stand geometry and material. Per level (load / unload): the spawn list, stands, cover map.
  constructor({ scene, world, events, registry }) {
    Object.assign(this, { scene, world, events, registry });
    const self = this;
    this.cover = null; // CoverMap of the loaded level
    this.flankCooldown = FLANK.firstAfter;
    this._engaged = [];
    this.player = null; // set on update
    this.frozen = false; // Gym AI room (K): enemies stop thinking and moving, bolts in flight still fly
    this.holdFire = false; // a cinematic runs (game.js): enemies move and aim but fire nothing and hurt nobody
    this.kills = 0;
    this.time = 0;
    this.woken = new Set(); // groups already woken (this level)
    this.bolts = [];
    this.dirty = true; // hit-mesh list needs a rebuild
    this.targets = [];
    this.all = []; // every enemy of every type
    this.boss = null;
    this.bases = this.posts = null;
    this.debris = new DebrisBank();
    this.ctx = {
      scene, world, events, debris: this.debris,
      get cover() { return self.cover; },
      get player() { return self.player; },
      get time() { return self.time; },
      get all() { return self.all; },
      get holdFire() { return self.holdFire; },
      spawn: (data) => this.spawn(data),
      spawnBolt: (from, dir, damage) => this.spawnBolt(from, dir, damage),
      hurtPlayer: (amount, from) => this.hurtPlayer(amount, from),
      alertNear: (from, radius) => this.alertNear(from, radius),
      separate: (who, minDist) => this.separate(who, minDist),
      reportKill: (actor) => this.#reportKill(actor),
      markDirty: () => (this.dirty = true),
      takeStand: () => this.standCount++,
      setStand: (i, pos, postH) => this.setStand(i, pos, postH),
    };
    // HiveMind bolts: a laser streak, a thin violet-white core in a long violet sheath (art-style.md 5): never orange or amber,
    // which is STEM-00's. The tip sits at the bolt's position (lookAt points +Z along the flight), the streak trails behind it.
    const geo = new THREE.CylinderGeometry(0.022, 0.022, 1.4, 6, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.7);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PROJECTILE.core).multiplyScalar(6) });
    const glowGeo = new THREE.CylinderGeometry(0.07, 0.03, 1.9, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.95);
    const glowMat = new THREE.MeshBasicMaterial({ color: PROJECTILE.glow, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false });
    this.boltPool = new Pool(
      () => {
        const m = new THREE.Mesh(geo, mat);
        m.add(new THREE.Mesh(glowGeo, glowMat));
        m.visible = false;
        this.scene.add(m);
        return { obj: m, vel: new THREE.Vector3(), life: 0 };
      },
      { reset: (b) => (b.obj.visible = false) },
    ).warm(16);
    this.standCount = 0;
    this.freeStands = []; // stand slots of despawned puppets, reused by spawn()
    // pneumatic stands (puppets only): one instanced draw for all bases, one for all posts
    this.standMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.7, roughness: 0.35 });
    this.standGeo = {
      base: new THREE.CylinderGeometry(0.35, 0.4, 0.08, 16),
      post: new THREE.CylinderGeometry(0.05, 0.05, 1, 8),
    };
  }

  // Builds the enemies of a level file (registry pieces owned by 'enemies'). Unloads the current ones first.
  load(level) {
    this.unload();
    const { registry } = this;
    this.demo = !!level.demo;
    this.cover = new CoverMap(this.world);
    const spawns = registry.piecesOf(level, 'enemies');
    const stands = spawns.filter((d) => registry.meta(d.id).stand).length;
    const stand = (geo) => {
      const m = new THREE.InstancedMesh(geo, this.standMat, stands);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false; // instances spread over the whole arena
      this.scene.add(m);
      return m;
    };
    this.bases = stand(this.standGeo.base);
    this.posts = stand(this.standGeo.post);
    // every enemy kind lives in this one list
    this.all = spawns.map((d) => this.#make(d));
    this.boss = this.all.find((p) => p.kind === 'boss') ?? null;
    return this;
  }

  // Frees every enemy of the level: actors (debris, rigs, skins, materials), stands, bolts in flight, squad state.
  unload() {
    for (const p of this.all) p.dispose();
    this.all = [];
    this.debris.dispose(); // baked chunk geometry of every enemy type (actors released their chunks above)
    this.boss = null;
    for (const b of this.bolts) this.boltPool.release(b); // pool meshes are permanent, just hidden
    this.bolts.length = 0;
    for (const m of [this.bases, this.posts]) {
      m?.removeFromParent();
      m?.dispose(); // instance buffer only: geometry and material are permanent
    }
    this.bases = this.posts = null;
    this.cover = null;
    this.standCount = 0;
    this.freeStands.length = 0;
    this.kills = 0;
    this.time = 0;
    this.woken.clear();
    this.flankCooldown = FLANK.firstAfter;
    this._engaged.length = 0;
    this.targets.length = 0;
    this.dirty = true;
  }


  // Death bookkeeping for every actor type: the kill counts, the hit-mesh list is rebuilt, listeners hear it,
  // and the last enemy down clears the arena.
  #reportKill(actor) {
    this.kills++;
    this.dirty = true;
    this.events.emit('puppet:down', actor);
    // an awake unkillable boss (CERBERUS) is still a fight: no ARENA CLEAR (and no combat music cut) while it is up
    if (this.kills === this.killable && !this.all.some((e) => e.unkillable && e.alive && e.awake)) this.events.emit('arena:clear');
  }

  // Enemies that can be destroyed (everything but `unkillable` ones, i.e. CERBERUS): what `kills` is counted against.
  get killable() {
    let n = 0;
    for (const e of this.all) if (!e.unkillable) n++;
    return n;
  }

  // Tool APIs (Workshop, Gym): the boss the HUD bar and camera follow, the AI freeze (K in the Gym AI room: enemies stop
  // thinking, moving and posing; bolts in flight still fly; returns the previous state), and pose(): one tiny update so a
  // frozen enemy stands at its piece position (a rail mover starts at its home); `viewer` is the player view it sees.
  setBoss(actor) {
    this.boss = actor;
  }

  freeze(on) {
    const was = this.frozen;
    this.frozen = on;
    return was;
  }

  pose(actor, { viewer, dt = 1e-3 }) {
    if ('moveT' in actor) actor.moveT = 0;
    actor.update(dt, viewer);
  }

  // Runtime spawn (tools, tests): builds one piece after load, same registry builders as the level file.
  // Puppets get a stand slot; the instance buffers grow when full (load sizes them for the level's own puppets).
  spawn(data) {
    const stand = this.registry.meta(data.id).stand;
    const used = this.standCount;
    let slot = 0;
    if (stand) {
      slot = this.freeStands.pop() ?? used;
      if (slot >= this.bases.instanceMatrix.count) this.#growStands(Math.max(16, slot * 2));
      this.standCount = slot; // the Puppet constructor takes standCount++ as its slot
    }
    const actor = this.#make(data);
    if (stand) {
      this.standCount = Math.max(used, slot + 1);
      this.bases.count = this.posts.count = this.standCount;
    }
    this.all.push(actor);
    this.dirty = true;
    return actor;
  }

  // Builds one enemy piece; `params.group` (a name) puts it in a spawn group (see wakeGroup); `params.dormant` makes
  // it wait for wakeGroup (actors read `dormant` before every self-wake). Always rebuilt from the level data.
  #make(data) {
    const actor = this.registry.build('enemies', this, data);
    actor.squad = data.params?.group ?? null;
    actor.dormant = !!data.params?.dormant;
    actor.hiddenAsleep = !!data.params?.hidden; // see HIDDEN: with dormant, not drawn nor a target until woken
    const { dropGun, dropAmmo, dropOnce } = data.params ?? {};
    actor.dropGun = dropGun ? { gun: dropGun, ammo: dropAmmo, once: dropOnce ?? true } : null; // see DROP
    return actor;
  }

  // Spawn groups (#73): enemies with the same `params.group` wake together. When any member is awake (a trooper is
  // alerted, a drone or boss is awake) the rest are woken too, once per group; a trigger or the `encounter:wake` event
  // can wake a group directly. Only actors with a `wake()` take part (troopers, drones, the boss, dormant puppets); other
  // puppets are always on. A dormant enemy is woken by nothing else.
  wakeGroup(group) {
    if (group == null) return 0;
    let n = 0;
    for (const e of this.all) {
      if (e.squad === group && e.alive && e.wake && !e.awake) {
        if (e.wake() !== false) n++;
      }
    }
    this.dirty = true; // a hidden sleeper is a target now
    if (!this.woken.has(group)) {
      this.woken.add(group);
      this.events.emit('group:wake', { group });
    }
    return n;
  }

  // A level with several bosses (the SX-6, then CERBERUS): the bar and the camera follow the one that is engaged. Only moves on
  // when the current one is not (asleep, or dead and gone), so a boss set by hand (Library, Workshop) stays.
  #followBoss() {
    const b = this.boss;
    if (b && b.awake && (b.alive || b.debris.length > 0)) return;
    for (const e of this.all) {
      if (e !== b && e.kind === 'boss' && e.awake && (e.alive || e.debris.length > 0)) {
        this.boss = e;
        return;
      }
    }
  }

  #groupWake() {
    for (const e of this.all) {
      if (e.squad != null && e.alive && e.awake && !this.woken.has(e.squad)) this.wakeGroup(e.squad);
    }
  }

  // Scripted moves (a cinematic.cut shot's `leap` / `recall`, encounter.js). leap: every member of `group` that can (the boss) leaps to
  // `to` ({ time, peak }). recall: every trooper / drone of `group` stops fighting and runs along `path` ([[x, y, z], ...]); at its
  // end it is removed (not a kill). settle(): what a cut started ends now (a skip, or the cut's end): leaps land, recalled ones go.
  leap(group, to, opts) {
    for (const e of this.all) if (e.squad === group && e.alive && e.leap) e.leap(to, opts);
  }

  recall(group, path) {
    const pts = path.map((p) => new THREE.Vector3(...p));
    for (const e of this.all) if (e.squad === group && e.alive && e.recall) e.recall(pts);
  }

  // A cut's scripted kills (view/cinematic.js, a shot's `stem.fire`). liveOf(group): the members still alive, in file order.
  // scriptKill(actor): destroys one through its normal death (debris, kill event and count, objectives); `holdFire` does not stop it.
  liveOf(group) {
    return this.all.filter((e) => e.squad === group && e.alive);
  }

  scriptKill(actor, from) {
    if (!actor.alive) return false;
    const point = actor.pos.clone().setY(actor.pos.y + 1); // (rare: allocation is fine)
    const dir = new THREE.Vector3().subVectors(point, from).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    return actor.damage(1e6, point, dir, 'body');
  }

  settle() {
    for (const e of this.all) e.settle?.();
    for (const e of this.all.filter((a) => a.alive && a.recallPath)) this.despawn(e);
  }

  // Removes and frees one enemy built by spawn() (or by load).
  despawn(actor) {
    const i = this.all.indexOf(actor);
    if (i < 0) return;
    this.all.splice(i, 1);
    if (this.bases && actor.index !== undefined) {
      _m.makeScale(0, 0, 0);
      this.bases.setMatrixAt(actor.index, _m);
      this.posts.setMatrixAt(actor.index, _m);
      this.bases.instanceMatrix.needsUpdate = this.posts.instanceMatrix.needsUpdate = true;
      this.freeStands.push(actor.index);
    }
    if (!actor.alive && actor.kind !== 'boss') this.kills = Math.max(0, this.kills - 1);
    actor.dispose();
    this.dirty = true;
  }

  #growStands(capacity) {
    for (const key of ['bases', 'posts']) {
      const old = this[key];
      const m = new THREE.InstancedMesh(old.geometry, this.standMat, capacity);
      m.instanceMatrix.array.set(old.instanceMatrix.array);
      m.count = old.count;
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false;
      this.scene.add(m);
      old.removeFromParent();
      old.dispose();
      this[key] = m;
    }
  }

  setStand(i, pos, postH) {
    _m.makeTranslation(pos.x, pos.y + 0.04, pos.z);
    this.bases.setMatrixAt(i, _m);
    _m.makeScale(1, postH, 1).setPosition(pos.x, pos.y + 0.08 + postH / 2, pos.z);
    this.posts.setMatrixAt(i, _m);
    this.bases.instanceMatrix.needsUpdate = this.posts.instanceMatrix.needsUpdate = true;
  }

  // Raycast targets of the living puppets (cached; rebuilt only when a puppet dies).
  hitMeshes() {
    if (this.dirty) {
      this.dirty = false;
      this.targets.length = 0;
      for (const p of this.all) if (p.alive && !(p.dormant && p.hiddenAsleep)) for (const m of p.hitMeshes) this.targets.push(m);
    }
    return this.targets;
  }

  // Chest points of exposed puppets for aim assist. Fills `out` (a high-water array of reusable vectors, never
  // truncated so nothing is reallocated) and returns how many entries are valid.
  aimPoints(out) {
    let n = 0;
    for (const p of this.all) {
      if (!p.alive || p.lift <= -0.3) continue;
      if (p.aimPoints) {
        n = p.aimPoints(out, n);
        continue;
      }
      if (!out[n]) out[n] = new THREE.Vector3();
      p.rig.bones.Spine2.getWorldPosition(out[n++]);
    }
    return n;
  }

  // Damages the player from a point (direction for the HUD indicator) and announces it.
  hurtPlayer(amount, from) {
    const p = this.player;
    if (!p || p.dead || this.holdFire) return;
    HURT.amount = p.damage(amount);
    HURT.dir.subVectors(p.pos, from).setY(0);
    if (HURT.dir.lengthSq() < 1e-6) HURT.dir.set(0, 0, 1);
    HURT.dir.normalize();
    this.events.emit('player:hurt', HURT);
  }

  spawnBolt(from, dir, damage = BOLT.damage) {
    if (this.holdFire) return;
    const b = this.boltPool.acquire();
    b.obj.position.copy(from);
    b.obj.lookAt(_v.copy(from).add(dir));
    b.obj.visible = true;
    b.vel.copy(dir).multiplyScalar(BOLT.speed);
    b.life = BOLT.life;
    b.damage = damage;
    this.bolts.push(b);
    this.events.emit('bolt:fired', b.obj.position);
  }

  // A trooper spotted the player: squadmates in earshot join in.
  // A Library exhibit woken with V (`hostile`) fights alone: its neighbours on the pad stay exhibits.
  alertNear(from, radius) {
    if (from.hostile) return;
    for (const e of this.all) {
      if (e !== from && e.alive && e.kind === 'trooper' && !e.alerted && e.pos.distanceTo(from.pos) < radius) e.alert();
    }
  }

  // Keeps moving troopers from walking through each other.
  separate(self, minDist) {
    // per-substep bucket of troopers (filled in update): only the ones near `self`, in `all` order
    const reach = minDist * SEP_REACH;
    const list = this.sepReady ? _sep.query(self.pos.x - reach, self.pos.z - reach, self.pos.x + reach, self.pos.z + reach) : this.all;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e === self || !e.alive || e.kind !== 'trooper') continue;
      const dx = self.pos.x - e.pos.x;
      const dz = self.pos.z - e.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (minDist - d) * 0.5;
      self.pos.x += (dx / d) * push;
      self.pos.z += (dz / d) * push;
      // a squadmate standing in the way (ahead of our velocity): a straight push only holds us behind it until the
      // move timer runs out, so also step sideways round it, on the side we are already offset to
      const vx = self.vel?.x ?? 0;
      const vz = self.vel?.z ?? 0;
      const v = Math.hypot(vx, vz);
      if (v > 0.5 && -(dx * vx + dz * vz) / (d * v) > 0.5) {
        const side = dx * vz - dz * vx >= 0 ? 1 : -1;
        self.pos.x += (vz / v) * side * push * 2;
        self.pos.z += (-vx / v) * side * push * 2;
      }
    }
  }

  // One flanker at a time: picks the engaged trooper already farthest round the player's side and asks it
  // to take a flank spot. The others keep shooting from cover meanwhile (they pin the player down).
  #flankDirector(dt, player) {
    this.flankCooldown -= dt;
    if (this.flankCooldown > 0 || player.dead) return;
    this.flankCooldown = FLANK.retry;
    const engaged = this._engaged;
    engaged.length = 0;
    for (const e of this.all) {
      if (e.kind !== 'trooper' || !e.alive || !e.alerted) continue;
      if (e.flanking) return; // a flank is already under way
      if (e.pos.distanceTo(player.pos) < FLANK.engagedRange) engaged.push(e);
    }
    if (engaged.length < 2) return;
    // the side the player defends: away from their cover box, else where they face
    if (player.cover) _front.copy(player.cover.normal).negate();
    else _front.set(Math.sin(player.facing), 0, Math.cos(player.facing));
    player.chest(_eye);
    // whoever is already most to the side has the shortest way round
    const side = (e) => ((e.pos.x - player.pos.x) * _front.x + (e.pos.z - player.pos.z) * _front.z) / (e.pos.distanceTo(player.pos) || 1);
    engaged.sort((a, b) => side(a) - side(b));
    for (const e of engaged) {
      if (e.flank(_front, _eye)) {
        this.flankCooldown = FLANK.every;
        this.events.emit('trooper:flank', e);
        return;
      }
    }
  }

  // Dormant (never woken) and hidden (HIDDEN) or in a sector the camera cannot see into (world/sectors.js; never in a level without
  // sectors): such an enemy skips its AI update and its pose, and is not drawn (cull). It still takes hits (not a hidden one: no
  // target) and wakes with its group.
  #asleep(p) {
    return p.dormant && p.alive && (p.hiddenAsleep || !this.world.sectors.visibleAt(p.pos));
  }

  // After the world's sector visibility (game.js, present phase): hides the sleeping enemies, shows them again when they wake, die or
  // come into sight. Only touches what it hid itself.
  cull() {
    for (const p of this.all) {
      const top = p.group ?? p.root;
      const hide = this.#asleep(p);
      if (hide === !!p.culled) continue;
      p.culled = hide;
      top.visible = !hide;
    }
  }

  // Poses every living humanoid once per frame (late phase) with the dt of the whole frame, after the substeps moved the
  // bodies (think() only fills `animState`). Rigs beyond the far LOD or outside the view pose every SLOW_EVERY-th frame
  // (staggered by list index, dt accumulated) without terrain foot IK. Weak spots (raycast targets, frozen proxies)
  // get their world matrix here.
  animate(dt, camera) {
    if (this.frozen) return;
    this.animFrame = (this.animFrame ?? 0) + 1;
    camera.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const list = this.all;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.alive || !p.animator) continue;
      if (p.posed && this.#asleep(p)) continue; // dormant out of sight: its pose waits (see cull)
      p.posed = true;
      p.animDt += dt;
      _sphere.center.copy(p.pos).y += 1;
      const slow = p.skin.far || !_frustum.intersectsSphere(_sphere);
      if (slow && (this.animFrame + i) % SLOW_EVERY) continue;
      p.animator.lod = slow;
      p.group.updateWorldMatrix(false, false);
      p.animator.update(p.animDt, p.animState);
      p.animDt = 0;
      for (const w of p.weakSpots) p.skin.syncHit(w);
    }
  }

  update(dt, player) {
    this.time += dt;
    this.player = player;
    // Demo level (`"demo": true`, e.g. the Library): enemies are exhibits. Every enemy already stands down while
    // the player is dead, so they get a read-only view of the player that reports `dead`: no waking, aiming,
    // firing or flanking, while they still idle, animate and take hits.
    const target = this.demo ? (this.ghost ??= Object.create(player, { dead: { value: true } })) : player;
    if (!this.frozen) {
      this.#flankDirector(dt, target);
      _sep.clear();
      for (const e of this.all) if (e.alive && e.kind === 'trooper') _sep.insert(e, e.pos.x, e.pos.z, e.pos.x, e.pos.z);
      this.sepReady = true;
      // `hostile` (Library wake key): this exhibit sees the real player even in a demo level
      for (const p of this.all) {
        if (p.ticked && this.#asleep(p)) continue; // a dormant enemy out of sight thinks nothing (only wakeGroup wakes it)
        p.update(dt, p.hostile ? player : target);
        p.ticked = true;
      }
      this.sepReady = false;
      this.#groupWake();
      this.#followBoss();
      for (let i = this.all.length - 1; i >= 0; i--) if (this.all[i].recalled) this.despawn(this.all[i]); // a recall reached its end
    }

    const cap = player.dead ? null : player.capsule();
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      const from = b.obj.position;
      const step = _step.copy(b.vel).multiplyScalar(dt);
      const len = step.length();
      const to = _w.copy(from).add(step);
      let done = b.life <= 0;

      // walls first: the step is cut at the first world hit, so a player hugging the far side of a wall is never hit through it
      let wall = null;
      if (!done) {
        _ray.set(from, _dir.copy(step).divideScalar(len || 1));
        _ray.far = len;
        _hits.length = 0;
        wall = _ray.intersectObjects(this.world.meshes, false, _hits)[0] ?? null;
        if (wall) to.copy(wall.point);
      }
      if (!done && cap && segSegDist(from, to, cap.a, cap.b) < cap.r + BOLT.radius) {
        HURT.amount = player.damage(b.damage);
        HURT.dir.copy(b.vel).normalize();
        this.events.emit('player:hurt', HURT);
        done = true;
      } else if (wall) {
        BOLT_HIT.point = wall.point;
        if (wall.face) BOLT_HIT.normal.copy(wall.face.normal);
        else BOLT_HIT.normal.copy(step).negate().normalize();
        this.events.emit('bolt:impact', BOLT_HIT);
        done = true;
      }
      if (done) {
        this.boltPool.release(b);
        this.bolts[i] = this.bolts[this.bolts.length - 1];
        this.bolts.pop();
      } else {
        from.copy(to);
      }
    }
  }
}
