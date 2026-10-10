import * as THREE from 'three';
import { Pool } from '../../engine/pool.js';
import { segSegDist } from '../../engine/math.js';
import { Puppet } from './puppet.js';
import { Trooper } from './trooper.js';
import { SpiderMech } from './spider.js';
import { Drone } from './drone.js';
import { CoverMap } from '../ai/cover.js';

// The enemy system: spawns every enemy (training puppets and troopers, one list), owns enemy projectiles,
// the cover map, the instanced puppet stands and the cached raycast target list.

// Enemy pieces (registry ids, a public contract: instructions/level.md). Data: { id, pos, yaw?, params? }.
// The spawn list lives in the level file; builders run against this system and return the actor.
// params: mover { to: [x, y, z], speed }, drone: pos = the ground under it, boss.spider { arena: { minX, maxX, minZ, maxZ } }.
// `stand`: puppets on a pneumatic stand (one instanced base + post each).
const def = (kind, d) => ({ kind, pos: d.pos, yaw: d.yaw, ...d.params });
export const ENEMY_PIECES = {
  'enemy.static': { stand: true, build: (sys, d) => new Puppet(sys, def('static', d)) },
  'enemy.mover': { stand: true, build: (sys, d) => new Puppet(sys, def('mover', d)) },
  'enemy.shooter': { stand: true, build: (sys, d) => new Puppet(sys, def('shooter', d)) },
  'enemy.trooper': (sys, d) => new Trooper(sys, def('trooper', d)), // moves between cover and shoots back
  'enemy.drone': (sys, d) => new Drone(sys, def('drone', d)), // hovers and strafes, short bursts
  'boss.spider': (sys, d) => new SpiderMech(sys, def('boss', d)), // miniboss
};

// Flank director: with 2+ troopers engaged, every FLANK_EVERY s one of them is sent around the player.
const FLANK = { every: 9, firstAfter: 5, retry: 2.5, engagedRange: 35 };

const _v = new THREE.Vector3();
const _front = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _w = new THREE.Vector3();
const _step = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _ray = new THREE.Raycaster();
// reused event payloads: listeners must copy what they keep
const HURT = { amount: 0, dir: new THREE.Vector3() };
const BOLT_HIT = { point: null, normal: new THREE.Vector3() };

const BOLT = { speed: 34, life: 3, damage: 7, radius: 0.06 };

export class Enemies {
  // Permanent: bolt pool, stand geometry and material. Per level (load / unload): the spawn list, stands, cover map.
  constructor({ scene, world, events, registry }) {
    Object.assign(this, { scene, world, events, registry });
    this.cover = null; // CoverMap of the loaded level
    this.flankCooldown = FLANK.firstAfter;
    this._engaged = [];
    this.player = null; // set on update
    this.frozen = false; // Gym AI room (K): enemies stop thinking and moving, bolts in flight still fly
    this.kills = 0;
    this.time = 0;
    this.bolts = [];
    this.dirty = true; // hit-mesh list needs a rebuild
    this.targets = [];
    this.puppets = [];
    this.boss = null;
    this.bases = this.posts = null;
    const geo = new THREE.CapsuleGeometry(0.06, 0.5, 4, 8).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a2a).multiplyScalar(6) });
    const glowGeo = new THREE.SphereGeometry(0.22, 12, 8);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff4010, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
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
    // every enemy (puppets and troopers) lives in this one list
    this.puppets = spawns.map((d) => registry.build('enemies', this, d));
    this.boss = this.puppets.find((p) => p.kind === 'boss') ?? null;
    return this;
  }

  // Frees every enemy of the level: actors (debris, rigs, skins, materials), stands, bolts in flight, squad state.
  unload() {
    for (const p of this.puppets) p.dispose();
    this.puppets = [];
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
    this.flankCooldown = FLANK.firstAfter;
    this._engaged.length = 0;
    this.targets.length = 0;
    this.dirty = true;
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
    const actor = this.registry.build('enemies', this, data);
    if (stand) {
      this.standCount = Math.max(used, slot + 1);
      this.bases.count = this.posts.count = this.standCount;
    }
    this.puppets.push(actor);
    this.dirty = true;
    return actor;
  }

  // Removes and frees one enemy built by spawn() (or by load).
  despawn(actor) {
    const i = this.puppets.indexOf(actor);
    if (i < 0) return;
    this.puppets.splice(i, 1);
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
      for (const p of this.puppets) if (p.alive) for (const m of p.hitMeshes) this.targets.push(m);
    }
    return this.targets;
  }

  // Chest points of exposed puppets for aim assist. Fills and returns `out` (array of reusable vectors).
  aimPoints(out) {
    let n = 0;
    for (const p of this.puppets) {
      if (!p.alive || p.lift <= -0.3) continue;
      if (p.aimPoints) {
        n = p.aimPoints(out, n);
        continue;
      }
      if (!out[n]) out[n] = new THREE.Vector3();
      p.rig.bones.Spine2.getWorldPosition(out[n++]);
    }
    out.length = n;
    return out;
  }

  // Damages the player from a point (direction for the HUD indicator) and announces it.
  hurtPlayer(amount, from) {
    const p = this.player;
    if (!p || p.dead) return;
    HURT.amount = p.damage(amount);
    HURT.dir.subVectors(p.pos, from).setY(0);
    if (HURT.dir.lengthSq() < 1e-6) HURT.dir.set(0, 0, 1);
    HURT.dir.normalize();
    this.events.emit('player:hurt', HURT);
  }

  spawnBolt(from, dir, damage = BOLT.damage) {
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
  alertNear(from, radius) {
    for (const e of this.puppets) {
      if (e !== from && e.alive && e.kind === 'trooper' && !e.alerted && e.pos.distanceTo(from.pos) < radius) e.alert();
    }
  }

  // Keeps moving troopers from walking through each other.
  separate(self, minDist) {
    for (const e of this.puppets) {
      if (e === self || !e.alive || e.kind !== 'trooper') continue;
      const dx = self.pos.x - e.pos.x;
      const dz = self.pos.z - e.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minDist * minDist || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      self.pos.x += (dx / d) * (minDist - d) * 0.5;
      self.pos.z += (dz / d) * (minDist - d) * 0.5;
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
    for (const e of this.puppets) {
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

  update(dt, player) {
    this.time += dt;
    this.player = player;
    // Demo level (`"demo": true`, e.g. the Library): enemies are exhibits. Every enemy already stands down while
    // the player is dead, so they get a read-only view of the player that reports `dead`: no waking, aiming,
    // firing or flanking, while they still idle, animate and take hits.
    const target = this.demo ? (this.ghost ??= Object.create(player, { dead: { value: true } })) : player;
    if (!this.frozen) {
      this.#flankDirector(dt, target);
      for (const p of this.puppets) p.update(dt, target);
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

      if (!done && cap && segSegDist(from, to, cap.a, cap.b) < cap.r + BOLT.radius) {
        HURT.amount = player.damage(b.damage);
        HURT.dir.copy(b.vel).normalize();
        this.events.emit('player:hurt', HURT);
        done = true;
      }
      if (!done) {
        _ray.set(from, step.divideScalar(len || 1));
        _ray.far = len;
        const hit = _ray.intersectObjects(this.world.meshes, false)[0];
        if (hit) {
          BOLT_HIT.point = hit.point;
          if (hit.face) BOLT_HIT.normal.copy(hit.face.normal);
          else BOLT_HIT.normal.copy(step).negate();
          this.events.emit('bolt:impact', BOLT_HIT);
          done = true;
        }
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
