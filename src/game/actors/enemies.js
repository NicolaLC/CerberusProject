import * as THREE from 'three';
import { Rig, Animator, HIT_ZONE } from './rig.js';
import { Pool } from '../../engine/pool.js';
import { RigidSkin } from '../../engine/batch.js';
import { damp, wrapAngle, segSegDist } from '../../engine/math.js';

// Training puppets: the shared humanoid rig hung on a pneumatic post.
// kinds: 'static' (takes hits), 'mover' (slides on a rail), 'shooter' (pops up from cover and fires bolts).

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
];

const HIDE = -0.95;
const WEAK_COUNT = 2;
const WEAK_BONES = ['Spine2', 'Spine1', 'Hips', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']; // rig lift when retracted behind low cover
const RESPAWN = 6;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _step = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _ray = new THREE.Raycaster();
// reused event payloads: listeners must copy what they keep
const HURT = { amount: 0, dir: new THREE.Vector3() };
const BOLT_HIT = { point: null, normal: new THREE.Vector3() };

class Puppet {
  constructor(sys, def) {
    this.sys = sys;
    this.kind = def.kind;
    this.home = new THREE.Vector3(...def.pos);
    this.to = def.to ? new THREE.Vector3(...def.to) : null;
    this.speed = def.speed ?? 0;
    this.pos = this.home.clone();
    this.yaw = def.yaw ?? 0;
    this.maxHealth = this.kind === 'shooter' ? 120 : 100;
    this.health = this.maxHealth;
    this.alive = true;
    this.deadTime = 0;
    this.flash = 0;
    this.moveT = Math.random();
    this.lift = this.kind === 'shooter' ? HIDE : 0;
    this.state = 'hidden';
    this.timer = 1 + Math.random() * 2;
    this.shotsLeft = 0;
    this.debris = [];

    const mats = {
      body: new THREE.MeshStandardMaterial({ color: this.kind === 'shooter' ? 0xd04a2a : 0xe8c23a, roughness: 0.6, metalness: 0.1 }),
      plate: new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.4 }),
    };
    this.mats = mats;
    this.visor = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3020, emissiveIntensity: 1.5 });

    this.group = new THREE.Group();
    this.rig = new Rig({ materials: mats });
    this.rig.attach('Head', box(0.2, 0.06, 0.03, this.visor, 0, 0.14, 0.13));
    this.rig.attach('Spine2', box(0.22, 0.22, 0.02, targetMat(), 0, 0.12, 0.155)); // bullseye
    this.emitter = this.rig.socket('Spine2', 'emitter', 0, 0.15, 0.3);
    this.weakMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 });
    this.weakMat.userData.lodGlow = 5; // far LOD drops the halo: a brighter core keeps weak spots readable
    this.haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(1.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
    this.weakSpots = [];
    this.animator = new Animator(this.rig, { armed: false });
    this.group.add(this.rig.root);

    // post + base: instanced across all puppets (Enemies.stands), slot = this.index
    this.index = sys.puppetCount++;
    sys.scene.add(this.group);

    this.hitMeshes = [];
    this.rig.root.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.enemy = this;
      o.userData.zone = HIT_ZONE[o.userData.bone] ?? 'limb';
      this.hitMeshes.push(o);
    });
    this.#placeWeakSpots();
    // ~30 parts -> one skinned draw per material (body, plate, visor, target, weak spot, halo)
    // far away: one draw with baked colors (see game.js LOD)
    this.skin = new RigidSkin(this.rig.root, this.rig.skeleton, { lod: true });
  }

  // Glowing weak spots on random body parts (front face). Hits there deal weakMult damage.
  #placeWeakSpots() {
    for (const w of this.weakSpots) w.removeFromParent();
    this.hitMeshes = this.hitMeshes.filter((m) => !this.weakSpots.includes(m));
    this.weakSpots = [];
    const pool = [...WEAK_BONES];
    for (let i = 0; i < WEAK_COUNT; i++) {
      const bone = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const part = this.rig.parts[bone];
      const [w, h, d] = part.userData.size;
      const sw = Math.min(w, 0.16) * 0.95;
      const sh = Math.min(h, 0.2);
      const spot = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.03), this.weakMat);
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(sw * 2.2, sh * 2), this.haloMat);
      halo.position.z = 0.02;
      halo.raycast = () => {}; // visual only
      spot.add(halo);
      spot.position.copy(part.position);
      spot.position.z += d / 2 + 0.012;
      if (bone === 'Spine2') spot.position.x += Math.random() < 0.5 ? 0.17 : -0.17; // beside the bullseye
      spot.userData = { enemy: this, zone: 'weak', bone };
      this.rig.bones[bone].add(spot);
      this.weakSpots.push(spot);
      this.hitMeshes.push(spot);
    }
    this.sys.dirty = true;
    this.skin?.rebuild(); // new spots join the batch, removed ones leave it
  }

  damage(amount, point, dir, zone) {
    if (!this.alive) return false;
    this.health -= amount;
    this.flash = 0.08;
    // hit reaction: push away from the shot
    const local = _v.copy(dir).applyAxisAngle(_up, -this.yaw);
    this.animator.impulse(local.z * (zone === 'head' ? 9 : 6), -local.x * 6);
    if (this.health <= 0) {
      this.#die(dir);
      return true;
    }
    return false;
  }

  #die(dir) {
    this.alive = false;
    this.deadTime = 0;
    this.sys.kills++;
    this.sys.dirty = true;
    this.sys.events.emit('puppet:down', this);
    this.group.updateMatrixWorld(true);
    // break the dummy apart: every rig mesh becomes a debris chunk
    for (const m of this.hitMeshes) {
      const d = new THREE.Mesh(m.geometry, m.material);
      m.matrixWorld.decompose(d.position, d.quaternion, d.scale);
      d.castShadow = true;
      this.sys.scene.add(d);
      const v = dir.clone().multiplyScalar(5 + Math.random() * 5);
      v.x += (Math.random() - 0.5) * 3;
      v.y += 2 + Math.random() * 3;
      v.z += (Math.random() - 0.5) * 3;
      const av = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(12);
      this.debris.push({ obj: d, v, av });
    }
    this.rig.root.visible = false;
  }

  #respawn() {
    for (const d of this.debris) this.sys.scene.remove(d.obj);
    this.debris = [];
    this.alive = true;
    this.health = this.maxHealth;
    this.rig.root.visible = true;
    this.#placeWeakSpots(); // marks the target list dirty
    this.lift = this.kind === 'shooter' ? HIDE : -1.8;
    this.state = 'hidden';
    this.timer = 1.5;
  }

  update(dt, player) {
    const world = this.sys.world;
    if (!this.alive) {
      this.deadTime += dt;
      for (const d of this.debris) {
        d.v.y -= 18 * dt;
        d.obj.position.addScaledVector(d.v, dt);
        d.obj.rotation.x += d.av.x * dt;
        d.obj.rotation.y += d.av.y * dt;
        d.obj.rotation.z += d.av.z * dt;
        const g = world.groundAt(d.obj.position.x, d.obj.position.z, d.obj.position.y + 0.3) + 0.05;
        if (d.obj.position.y < g) {
          d.obj.position.y = g;
          d.v.y *= -0.3;
          d.v.x *= 0.6;
          d.v.z *= 0.6;
          d.av.multiplyScalar(0.6);
        }
        if (this.deadTime > RESPAWN - 1) d.obj.scale.multiplyScalar(1 - dt * 3);
      }
      if (this.deadTime > RESPAWN) this.#respawn();
      return;
    }

    let speed = 0;
    if (this.kind === 'mover') {
      this.moveT += (dt * this.speed) / this.home.distanceTo(this.to);
      const s = 0.5 - 0.5 * Math.cos(this.moveT * Math.PI);
      const prev = _u.copy(this.pos);
      this.pos.lerpVectors(this.home, this.to, s);
      speed = dt > 0 ? prev.distanceTo(this.pos) / dt : 0;
    }

    if (this.kind === 'shooter') this.#shooterAI(dt, player);
    else this.lift += (0 - this.lift) * damp(4, dt);

    // flash on hit
    this.flash -= dt;
    const e = this.flash > 0 ? 0.9 : 0;
    this.mats.body.emissive.setScalar(e);
    this.mats.plate.emissive.setScalar(e);
    this.skin.lodMaterial.emissive.setScalar(e);
    this.weakMat.emissiveIntensity = 2.4 + Math.sin(this.sys.time * 8) * 1.4; // pulse

    this.animator.update(dt, { speed: speed * 0.5, run: false, crouch: 0, aimPitch: 0, combat: false });
    this.group.position.copy(this.pos);
    this.rig.root.position.y = this.lift;
    this.rig.root.rotation.y = this.yaw;
    const postH = Math.max(0.05, 0.95 + this.lift - 0.08);
    this.sys.setStand(this.index, this.pos, postH);
  }

  #shooterAI(dt, player) {
    const head = _v.copy(this.pos).setY(this.pos.y + 1.7);
    const target = player.chest(_w);
    const dist = head.distanceTo(target);
    const active = !player.dead && dist < 55;

    // turn to face the player
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    this.yaw += wrapAngle(want - this.yaw) * damp(4, dt);

    this.timer -= dt;
    const upLift = 0;
    switch (this.state) {
      case 'hidden':
        this.lift += (HIDE - this.lift) * damp(8, dt);
        if (this.timer <= 0 && active) {
          this.state = 'up';
          this.timer = 0.5;
        }
        break;
      case 'up':
        this.lift += (upLift - this.lift) * damp(10, dt);
        if (this.timer <= 0) {
          if (this.#hasLOS(target)) {
            this.state = 'telegraph';
            this.timer = 0.45;
          } else {
            this.state = 'hidden';
            this.timer = 1 + Math.random();
          }
        }
        break;
      case 'telegraph':
        this.visor.emissiveIntensity = 1.5 + (0.45 - this.timer) * 18;
        if (this.timer <= 0) {
          this.state = 'fire';
          this.shotsLeft = 3;
          this.timer = 0;
        }
        break;
      case 'fire':
        if (this.timer <= 0) {
          this.#fire(target);
          this.shotsLeft--;
          this.timer = 0.16;
          if (this.shotsLeft <= 0) {
            this.state = 'hold';
            this.timer = 0.6;
            this.visor.emissiveIntensity = 1.5;
          }
        }
        break;
      case 'hold':
        if (this.timer <= 0) {
          this.state = 'hidden';
          this.timer = 1.6 + Math.random() * 1.6;
        }
        break;
    }
  }

  #hasLOS(target) {
    const from = this.emitter.getWorldPosition(_u);
    const dir = _step.subVectors(target, from);
    const len = dir.length();
    _ray.set(from, dir.normalize());
    _ray.far = len - 0.5;
    return _ray.intersectObjects(this.sys.world.meshes, false).length === 0;
  }

  #fire(target) {
    const from = this.emitter.getWorldPosition(_u);
    const spread = 0.25 + from.distanceTo(target) * 0.015;
    const dir = _step.copy(target);
    dir.x += (Math.random() - 0.5) * spread;
    dir.y += (Math.random() - 0.5) * spread;
    dir.z += (Math.random() - 0.5) * spread;
    this.sys.spawnBolt(from, dir.sub(from).normalize());
  }
}

const BOLT = { speed: 34, life: 3, damage: 7, radius: 0.06 };

export class Enemies {
  constructor({ scene, world, events }) {
    Object.assign(this, { scene, world, events });
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
    this.puppetCount = 0;
    // pneumatic stands: one instanced draw for all bases, one for all posts
    const steel = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.7, roughness: 0.35 });
    const stand = (geo) => {
      const m = new THREE.InstancedMesh(geo, steel, SPAWNS.length);
      m.castShadow = m.receiveShadow = true;
      m.frustumCulled = false; // instances spread over the whole arena
      this.scene.add(m);
      return m;
    };
    this.bases = stand(new THREE.CylinderGeometry(0.35, 0.4, 0.08, 16));
    this.posts = stand(new THREE.CylinderGeometry(0.05, 0.05, 1, 8));
    this.puppets = SPAWNS.map((d) => new Puppet(this, d));
  }

  setStand(i, pos, postH) {
    _m.makeTranslation(pos.x, pos.y + 0.04, pos.z);
    this.bases.setMatrixAt(i, _m);
    _m.makeScale(1, postH, 1).setPosition(pos.x, pos.y + 0.08 + postH / 2, pos.z);
    this.posts.setMatrixAt(i, _m);
    this.bases.instanceMatrix.needsUpdate = this.posts.instanceMatrix.needsUpdate = true;
  }

  // Raycast targets of the living puppets (cached; rebuilt only when a puppet dies, respawns or re-rolls weak spots).
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

  update(dt, player) {
    this.time += dt;
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

function box(w, h, d, m, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}

let _target;
function targetMat() {
  if (_target) return _target;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#d01818';
    g.beginPath();
    g.arc(32, 32, 32 - i * 8, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _target = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.6 });
  _target.userData.lodColor = new THREE.Color(0xd86a6a); // average of the red/white rings for the far LOD
  return _target;
}
