import * as THREE from 'three';
import { Rig, Animator, HIT_ZONE } from './rig.js';
import { RigidSkin } from '../../engine/batch.js';

// Shared body of every enemy (training puppets, troopers): rig + animator, hit zones, glowing weak spots,
// hit flash and the break-apart death. Subclasses add parts in their constructor, then call finishBody(),
// and implement think(dt, player) for behavior. Destroyed enemies stay destroyed (debris fades away).
//
// Interface used by the Enemies system and the rest of the game:
//   kind, alive, pos, lift, rig, skin, hitMeshes, damage(), update(dt, player)

const WEAK_BONES = ['Spine2', 'Spine1', 'Hips', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];
const DEBRIS_LIFE = 5; // s
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class EnemyBody {
  constructor(sys, { kind, pos, yaw = 0, health, colors, armed = false, weakSpots = 2 }) {
    this.sys = sys;
    this.kind = kind;
    this.pos = new THREE.Vector3(...pos);
    this.yaw = yaw;
    this.maxHealth = this.health = health;
    this.alive = true;
    this.lift = 0; // vertical offset of the rig (puppets retract behind cover)
    this.flash = 0;
    this.deadTime = 0;
    this.debris = [];
    this.weakCount = weakSpots;

    this.mats = {
      body: new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.6, metalness: 0.1 }),
      plate: new THREE.MeshStandardMaterial({ color: colors.plate ?? 0x24262b, roughness: 0.5, metalness: 0.4 }),
    };
    this.visor = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: colors.visor ?? 0xff3020, emissiveIntensity: 1.5 });
    this.weakMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 });
    this.weakMat.userData.lodGlow = 5; // far LOD drops the halo: a brighter core keeps weak spots readable
    this.haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(1.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });

    this.group = new THREE.Group();
    this.rig = new Rig({ materials: this.mats });
    this.rig.attach('Head', box(0.2, 0.06, 0.03, this.visor, 0, 0.14, 0.13));
    this.animator = new Animator(this.rig, { armed, ground: armed ? (x, z, maxY) => sys.world.groundAt(x, z, maxY) : null });
    this.group.add(this.rig.root);
    sys.scene.add(this.group);
  }

  // After the subclass attached its parts: hit zones, weak spots, render batch.
  finishBody() {
    this.hitMeshes = [];
    const walk = (o) => {
      if (o.userData.noHit) return; // e.g. a carried gun
      if (o.isMesh) {
        o.userData.enemy = this;
        o.userData.zone = HIT_ZONE[o.userData.bone] ?? 'limb';
        this.hitMeshes.push(o);
      }
      for (const c of o.children) walk(c);
    };
    walk(this.rig.root);
    this.weakSpots = [];
    this.#placeWeakSpots();
    // all parts -> one skinned draw per material; far away one draw with baked colors (see game.js LOD)
    this.skin = new RigidSkin(this.rig.root, this.rig.skeleton, { lod: true });
  }

  // Glowing weak spots on random body parts (front face). Hits there deal weakMult damage.
  #placeWeakSpots() {
    const pool = [...WEAK_BONES];
    for (let i = 0; i < this.weakCount; i++) {
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
      if (bone === 'Spine2') spot.position.x += Math.random() < 0.5 ? 0.17 : -0.17; // beside the chest plate
      spot.userData = { enemy: this, zone: 'weak', bone };
      this.rig.bones[bone].add(spot);
      this.weakSpots.push(spot);
      this.hitMeshes.push(spot);
    }
    this.sys.dirty = true;
  }

  // Returns true if this hit destroyed it.
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
    this.onHit?.(amount, dir, zone);
    return false;
  }

  #die(dir) {
    this.alive = false;
    this.deadTime = 0;
    this.sys.kills++;
    this.sys.dirty = true;
    this.onDeath?.();
    this.sys.events.emit('puppet:down', this);
    if (this.sys.kills === this.sys.puppets.length) this.sys.events.emit('arena:clear');
    this.group.updateMatrixWorld(true);
    // break apart: every hit mesh becomes a debris chunk
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

  update(dt, player) {
    if (!this.alive) {
      this.#updateDebris(dt);
      return;
    }
    this.think(dt, player);
    // hit flash + weak spot pulse
    this.flash -= dt;
    const e = this.flash > 0 ? 0.9 : 0;
    this.mats.body.emissive.setScalar(e);
    this.mats.plate.emissive.setScalar(e);
    this.skin.lodMaterial.emissive.setScalar(e);
    this.weakMat.emissiveIntensity = 2.4 + Math.sin(this.sys.time * 8) * 1.4;
  }

  #updateDebris(dt) {
    if (!this.debris.length) return; // destroyed for good
    this.deadTime += dt;
    const world = this.sys.world;
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
      if (this.deadTime > DEBRIS_LIFE - 1) d.obj.scale.multiplyScalar(1 - dt * 3);
    }
    if (this.deadTime > DEBRIS_LIFE) {
      for (const d of this.debris) this.sys.scene.remove(d.obj);
      this.debris.length = 0;
      this.onDebrisCleared?.();
    }
  }
}

export function box(w, h, d, m, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
