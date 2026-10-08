import * as THREE from 'three';
import { Pool } from '../../engine/pool.js';
import { segSegDist } from '../../engine/math.js';
import { Puppet } from './puppet.js';
import { Trooper } from './trooper.js';
import { CoverMap } from '../ai/cover.js';

// The enemy system: spawns every enemy (training puppets and troopers, one list), owns enemy projectiles,
// the cover map, the instanced puppet stands and the cached raycast target list.

const SPAWNS = [
  // outdoor shooters behind the z=-14 low cover line, facing the spawn
  { kind: 'shooter', pos: [-16, 0, -15.3] },
  { kind: 'shooter', pos: [2, 0, -15.3] },
  { kind: 'shooter', pos: [18, 0, -15.3] },
  { kind: 'shooter', pos: [-34, 1.6, -4] },
  // outdoor statics
  { kind: 'static', pos: [-10, 0, 18], yaw: 0 },
  { kind: 'static', pos: [10, 0, 18], yaw: 0 },
  { kind: 'static', pos: [-6, 0, -24], yaw: 0 },
  { kind: 'static', pos: [6, 0, -26], yaw: 0 },
  // range
  { kind: 'static', pos: [34, 0, 20], yaw: 0 },
  { kind: 'static', pos: [38, 0, 10], yaw: 0 },
  { kind: 'static', pos: [42, 0, 0], yaw: 0 },
  { kind: 'static', pos: [46, 0, -10], yaw: 0 },
  { kind: 'mover', pos: [33, 0, 8], to: [47, 0, 8], speed: 3, yaw: 0 },
  { kind: 'mover', pos: [47, 0, -4], to: [33, 0, -4], speed: 5, yaw: 0 },
  // interior
  { kind: 'shooter', pos: [-6, 0, -55.3] },
  { kind: 'shooter', pos: [3.3, 0, -44] },
  { kind: 'static', pos: [-10, 0, -48], yaw: 0 },
  { kind: 'shooter', pos: [13, 0, -55.3] },
  { kind: 'static', pos: [20, 0, -36], yaw: -1.2 },
  { kind: 'mover', pos: [12, 0, -42], to: [21, 0, -42], speed: 2.2, yaw: 0 },
  // troopers: move between cover and shoot back (actors/trooper.js)
  { kind: 'trooper', pos: [-3, 0, -27], yaw: 0 },
  { kind: 'trooper', pos: [14, 0, -27], yaw: 0 },
  { kind: 'trooper', pos: [22, 0, -6], yaw: 0 },
  { kind: 'trooper', pos: [-12, 0, -44], yaw: 0 },
  { kind: 'trooper', pos: [16, 0, -50], yaw: 0 },
];

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
  constructor({ scene, world, events }) {
    Object.assign(this, { scene, world, events });
    this.cover = new CoverMap(world);
    this.flankCooldown = FLANK.firstAfter;
    this._engaged = [];
    this.player = null; // set on update
    this.kills = 0;
    this.time = 0;
    this.bolts = [];
    this.dirty = true; // hit-mesh list needs a rebuild
    this.targets = [];
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
    // pneumatic stands (puppets only): one instanced draw for all bases, one for all posts
    const steel = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.7, roughness: 0.35 });
    const stand = (geo, count) => {
      const m = new THREE.InstancedMesh(geo, steel, count);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false; // instances spread over the whole arena
      this.scene.add(m);
      return m;
    };
    const stands = SPAWNS.filter((d) => d.kind !== 'trooper').length;
    this.bases = stand(new THREE.CylinderGeometry(0.35, 0.4, 0.08, 16), stands);
    this.posts = stand(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), stands);
    // every enemy (puppets and troopers) lives in this one list
    this.puppets = SPAWNS.map((d) => (d.kind === 'trooper' ? new Trooper(this, d) : new Puppet(this, d)));
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
      if (!out[n]) out[n] = new THREE.Vector3();
      p.rig.bones.Spine2.getWorldPosition(out[n++]);
    }
    out.length = n;
    return out;
  }

  spawnBolt(from, dir) {
    const b = this.boltPool.acquire();
    b.obj.position.copy(from);
    b.obj.lookAt(_v.copy(from).add(dir));
    b.obj.visible = true;
    b.vel.copy(dir).multiplyScalar(BOLT.speed);
    b.life = BOLT.life;
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
    this.#flankDirector(dt, player);
    for (const p of this.puppets) p.update(dt, player);

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
        HURT.amount = player.damage(BOLT.damage);
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
