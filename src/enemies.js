import * as THREE from 'three';
import { Rig, Animator, HIT_ZONE } from './rig.js';

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

const HIDE = -0.95; // rig lift when retracted behind low cover
const RESPAWN = 6;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _ray = new THREE.Raycaster();

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
    this.rig.attach('head', box(0.2, 0.06, 0.03, this.visor, 0, 0.14, 0.13));
    this.rig.attach('chest', box(0.22, 0.22, 0.02, targetMat(), 0, 0.12, 0.155)); // bullseye
    this.emitter = this.rig.socket('chest', 'emitter', 0, 0.15, 0.3);
    this.animator = new Animator(this.rig, { armed: false });
    this.group.add(this.rig.root);

    // post + base (not part of the rig)
    const steel = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.7, roughness: 0.35 });
    this.base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.08, 16), steel);
    this.base.position.y = 0.04;
    this.post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), steel);
    for (const m of [this.base, this.post]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    sys.scene.add(this.group);

    this.hitMeshes = [];
    this.rig.root.traverse((o) => {
      if (!o.isMesh) return;
      o.userData.enemy = this;
      o.userData.zone = HIT_ZONE[o.userData.bone] ?? 'limb';
      this.hitMeshes.push(o);
    });
  }

  damage(amount, point, dir, zone) {
    if (!this.alive) return false;
    this.health -= amount;
    this.flash = 0.08;
    // hit reaction: push away from the shot
    const local = _v.copy(dir).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);
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
    this.sys.audio.thud();
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
      const prev = this.pos.clone();
      this.pos.lerpVectors(this.home, this.to, s);
      speed = dt > 0 ? prev.distanceTo(this.pos) / dt : 0;
    }

    if (this.kind === 'shooter') this.#shooterAI(dt, player);
    else this.lift += (0 - this.lift) * (1 - Math.exp(-dt * 4));

    // flash on hit
    this.flash -= dt;
    const e = this.flash > 0 ? 0.9 : 0;
    this.mats.body.emissive.setScalar(e);
    this.mats.plate.emissive.setScalar(e);

    this.animator.update(dt, { speed: speed * 0.5, sprint: false, crouch: 0, aimPitch: 0, combat: false });
    this.group.position.copy(this.pos);
    this.rig.root.position.y = this.lift;
    this.rig.root.rotation.y = this.yaw;
    const postH = Math.max(0.05, 0.95 + this.lift - 0.08);
    this.post.scale.y = postH;
    this.post.position.y = 0.08 + postH / 2;
  }

  #shooterAI(dt, player) {
    const head = _v.copy(this.pos).setY(this.pos.y + 1.7);
    const target = player.chest(_w);
    const dist = head.distanceTo(target);
    const active = !player.dead && dist < 55;

    // turn to face the player
    const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * (1 - Math.exp(-dt * 4));

    this.timer -= dt;
    const upLift = 0;
    switch (this.state) {
      case 'hidden':
        this.lift += (HIDE - this.lift) * (1 - Math.exp(-dt * 8));
        if (this.timer <= 0 && active) {
          this.state = 'up';
          this.timer = 0.5;
        }
        break;
      case 'up':
        this.lift += (upLift - this.lift) * (1 - Math.exp(-dt * 10));
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
    const from = this.emitter.getWorldPosition(new THREE.Vector3());
    const dir = target.clone().sub(from);
    const len = dir.length();
    _ray.set(from, dir.normalize());
    _ray.far = len - 0.5;
    return _ray.intersectObjects(this.sys.world.meshes, false).length === 0;
  }

  #fire(target) {
    const from = this.emitter.getWorldPosition(new THREE.Vector3());
    const dist = from.distanceTo(target);
    const aim = target.clone();
    const spread = 0.25 + dist * 0.015;
    aim.x += (Math.random() - 0.5) * spread;
    aim.y += (Math.random() - 0.5) * spread;
    aim.z += (Math.random() - 0.5) * spread;
    this.sys.spawnBolt(from, aim.sub(from).normalize());
  }
}

export class Enemies {
  constructor({ scene, world, fx, audio, juice }) {
    Object.assign(this, { scene, world, fx, audio, juice });
    this.kills = 0;
    this.bolts = [];
    this.boltGeo = new THREE.CapsuleGeometry(0.06, 0.5, 4, 8).rotateX(Math.PI / 2);
    this.boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff6a2a).multiplyScalar(6) });
    this.boltGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0xff4010, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.puppets = SPAWNS.map((d) => new Puppet(this, d));
  }

  hitMeshes() {
    const out = [];
    for (const p of this.puppets) if (p.alive) out.push(...p.hitMeshes);
    return out;
  }

  spawnBolt(from, dir) {
    const m = new THREE.Mesh(this.boltGeo, this.boltMat);
    m.add(this.boltGlow.clone());
    m.position.copy(from);
    m.lookAt(from.clone().add(dir));
    this.scene.add(m);
    this.bolts.push({ obj: m, vel: dir.multiplyScalar(34), life: 3 });
    this.audio.zap(0.12);
  }

  update(dt, player, hud, rig) {
    for (const p of this.puppets) p.update(dt, player);

    const cap = player.dead ? null : player.capsule();
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= dt;
      const from = b.obj.position.clone();
      const step = b.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const to = from.clone().add(step);
      let done = b.life <= 0;

      if (!done && cap && segSegDist(from, to, cap.a, cap.b) < cap.r + 0.06) {
        player.damage(7);
        hud.damage(b.vel, rig);
        this.juice.hurt();
        this.audio.thud();
        done = true;
      }
      if (!done) {
        _ray.set(from, step.clone().normalize());
        _ray.far = len;
        const hit = _ray.intersectObjects(this.world.meshes, false)[0];
        if (hit) {
          const n = hit.face ? hit.face.normal.clone() : step.clone().negate().normalize();
          this.fx.impact(hit.point, n, 0xff6a2a, 10, true);
          done = true;
        }
      }
      if (done) {
        this.scene.remove(b.obj);
        this.bolts.splice(i, 1);
      } else {
        b.obj.position.copy(to);
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
  return _target;
}

// Closest distance between segments p1-q1 and p2-q2.
function segSegDist(p1, q1, p2, q2) {
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s;
  let t;
  if (a <= 1e-8 && e <= 1e-8) return p1.distanceTo(p2);
  if (a <= 1e-8) {
    s = 0;
    t = THREE.MathUtils.clamp(f / e, 0, 1);
  } else {
    const c = d1.dot(r);
    if (e <= 1e-8) {
      t = 0;
      s = THREE.MathUtils.clamp(-c / a, 0, 1);
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
