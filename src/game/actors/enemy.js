import * as THREE from 'three';
import { Rig, Animator, HIT_ZONE } from './rig.js';
import { RigidSkin } from '../../engine/batch.js';
import { disposeTree } from '../../engine/dispose.js';

// Shared body of every enemy (training puppets, troopers): rig + animator, hit zones, glowing weak spots,
// hit flash and the break-apart death. Subclasses add their look in their constructor (visual-only `look()`
// groups from parts.js, built with this.mats and this.visor), then call finishBody(), and implement
// think(dt, player) for behavior. Destroyed enemies stay destroyed (debris fades away).
// Gameplay hitboxes are the rig's dummy boxes, kept invisible: the look never changes hit zones or weak spots.
//
// Actors get a narrow `ctx` from the Enemies system (world, scene, events, debris bank, cover, player, time, all,
// spawnBolt, hurtPlayer, alertNear, separate, reportKill, markDirty, takeStand, setStand): they never touch the system.
//
// Interface used by the Enemies system and the rest of the game:
//   kind, alive, pos, lift, rig, skin, hitMeshes, damage(), update(dt, player)

export const VISOR_REST = 1.2; // sensor emissiveIntensity at rest (shot telegraphs flare it above)
export const VISOR = 0x8c3cff; // HiveMind sensor violet (#C04BFF family, bluer so it never reads as the magenta weak spots), dimmer
export const PROJECTILE = { core: 0xe6dcff, glow: 0x8a46ff, ring: 0xa060ff }; // HiveMind shots: violet-white, never amber
const WEAK_BONES = ['Spine2', 'Spine1', 'Hips', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];
const DEBRIS_DIR = new THREE.Vector3();
const DEBRIS_OPT = { dir: DEBRIS_DIR, push: [5, 5], spread: 3, up: [2, 3], spin: 12, life: 5 }; // see DebrisBank.burst
const HITBOX_MAT = new THREE.MeshBasicMaterial(); // never drawn
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _sRay = new THREE.Raycaster();
const _sHits = [];
const _sDir = new THREE.Vector3();

// Line of sight shared by every enemy type: true if nothing in `meshes` (the world) blocks the straight line from
// `from` to `to`, ignoring the last `slack` m (so the target's own cover box does not count). Throttling and eye
// heights stay with the caller.
export function sightRay(from, to, meshes, slack = 0.5) {
  const d = _sDir.subVectors(to, from);
  const len = d.length();
  _sRay.set(from, d.divideScalar(len));
  _sRay.far = Math.max(0.01, len - slack);
  _sHits.length = 0;
  return _sRay.intersectObjects(meshes, false, _sHits).length === 0;
}

const _inv = new THREE.Matrix4();
const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

// Enemy outline: a faint violet rim (fresnel) in the emissive, so a dark robot reads against a dark room (art-style.md: violet =
// HiveMind). Chained after a material's own onBeforeCompile (the far LOD's), one program per material kind (shared cache key).
// No extra draws. Weak spots and sensors stay the brightest glows (the rim peaks at RIM.strength, edge-on only).
const RIM = { color: new THREE.Color(VISOR), strength: 0.1, power: 8 };
const RIM_GLSL = `{ float rimK = 1.0 - saturate(dot(normalize(vViewPosition), normal)); totalEmissiveRadiance += vec3(${RIM.color.toArray().map((c) => (c * RIM.strength).toFixed(4)).join(', ')}) * pow(rimK, ${RIM.power.toFixed(1)}); }`;
export function rim(materials) {
  for (const m of materials) {
    if (!m || m.userData.rim) continue;
    m.userData.rim = true;
    const prev = m.onBeforeCompile;
    const key = m.customProgramCacheKey();
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${RIM_GLSL}`);
    };
    m.customProgramCacheKey = () => `${key}|enemy-rim`;
  }
}

export class EnemyBody {
  // mats: the look's materials (all flash on a hit); visor: color of the glowing sensors (telegraphs shots). Sensors are
  // violet and the magenta weak spots stay the brightest thing on the body (art-style.md: if it glows violet, shoot it).
  constructor(ctx, { kind, pos, yaw = 0, health, mats, visor = VISOR, armed = false, weakSpots = 2, weakBones = WEAK_BONES }) {
    this.ctx = ctx;
    this.kind = kind;
    this.debrisKind = kind; // the debris bank's key (parts.js): a variant with other pieces on its bones needs its own
    this.pos = new THREE.Vector3(...pos);
    this.yaw = yaw;
    this.maxHealth = this.health = health;
    this.alive = true;
    this.lift = 0; // vertical offset of the rig (puppets retract behind cover)
    this.flash = 0;
    this.debris = [];
    this.shed = []; // chunks knocked off while alive (a trooper's plates), tumbling with the debris
    this.weakCount = weakSpots;
    this.weakBones = weakBones; // bones a weak spot may sit on (troopers: the chest)

    this.mats = mats;
    this.visor = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: visor, emissiveIntensity: VISOR_REST });
    this.weakMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2bd6, emissiveIntensity: 3 });
    this.weakMat.userData.lodGlow = 5; // far LOD drops the halo: a brighter core keeps weak spots readable
    this.haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(1.5), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });

    this.group = new THREE.Group();
    this.rig = new Rig({ materials: { body: HITBOX_MAT } });
    for (const p of Object.values(this.rig.parts)) p.visible = false; // hitboxes only: not baked, still raycast
    this.animator = new Animator(this.rig, { armed, ground: armed ? (x, z, maxY) => ctx.world.groundAt(x, z, maxY) : null });
    // pose state for the animator, filled by think() every substep; Enemies.animate poses the rig once per frame
    this.animState = { speed: 0, run: false, crouch: 0, aimPitch: 0, combat: false, recoil: 0, vel: null, yaw: 0 };
    this.animDt = 0; // time since the last pose (rigs far away or off screen pose every few frames)
    this.animator.onStep = () => this.alive && ctx.events.emit('enemy:step', this.pos);
    this.group.add(this.rig.root);
    ctx.scene.add(this.group);
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
    this.skin = new RigidSkin(this.rig.root, this.rig.skeleton, { lod: true, exclude: (o) => o.userData.dropped });
    rim([...Object.values(this.mats), this.skin.lodMaterial]);
    this.group.updateMatrixWorld(true);
    this.ctx.debris.prime(this.debrisKind, this.skin); // death debris of this type is baked now, not during the hitstop
  }

  // Glowing weak spots on random body parts (front face): an exposed power cell, a glowing core in a ring housing of the frame
  // material (no extra draw), with a round halo. Only the core is a hit mesh: hits there deal weakMult damage.
  #placeWeakSpots() {
    const pool = [...this.weakBones];
    const housing = this.mats.frame ?? Object.values(this.mats)[0];
    for (let i = 0; i < this.weakCount; i++) {
      const bone = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      const part = this.rig.parts[bone];
      const [w, h, d] = part.userData.size;
      const r = THREE.MathUtils.clamp(Math.min(w, h) * 0.3, 0.04, 0.055);
      const spot = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.04, 16).rotateX(Math.PI / 2), this.weakMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.12, r * 0.26, 6, 18), housing);
      ring.position.z = 0.012;
      ring.raycast = () => {}; // visual only: the core is the target
      spot.add(ring);
      for (const a of [0.785, 2.356, 3.927, 5.498]) {
        // four clamp bolts on the ring
        const bolt = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 0.32, 0.03), housing);
        bolt.position.set(Math.cos(a) * r * 1.45, Math.sin(a) * r * 1.45, 0.008);
        bolt.rotation.z = a;
        bolt.raycast = () => {};
        spot.add(bolt);
      }
      const halo = new THREE.Mesh(new THREE.CircleGeometry(r * 1.7, 20), this.haloMat);
      halo.position.z = 0; // behind the ring: the housing reads dark against the glow
      halo.raycast = () => {}; // visual only
      spot.add(halo);
      spot.position.copy(part.position);
      spot.position.z += d / 2 + 0.02;
      if (bone === 'Spine2' && this.weakBones === WEAK_BONES) spot.position.x += Math.random() < 0.5 ? 0.17 : -0.17; // beside the chest plate
      // flush on the look's surface (not the hitbox's or the bone's max z): ray from in front into the look pieces, the
      // spot sits on the hit point and follows its normal
      const host = this.rig.bones[bone];
      host.updateWorldMatrix(true, true);
      _ray.set(host.localToWorld(_o.set(spot.position.x, spot.position.y, 0.8)), _d.set(0, 0, -1).transformDirection(host.matrixWorld));
      const hit = _ray.intersectObjects(host.children.filter((c) => c.userData.noHit), true)[0];
      if (hit) {
        spot.position.copy(host.worldToLocal(hit.point.clone()));
        spot.position.z -= 0.005; // front face just proud of the surface
        if (hit.face) spot.quaternion.setFromUnitVectors(_o.set(0, 0, 1), _d.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).transformDirection(_inv.copy(host.matrixWorld).invert()));
      }
      spot.userData = { enemy: this, zone: 'weak', bone };
      this.rig.bones[bone].add(spot);
      this.weakSpots.push(spot);
      this.hitMeshes.push(spot);
    }
    this.ctx.markDirty();
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
    this.onDeath?.();
    this.ctx.reportKill(this);
    this.group.updateMatrixWorld(true);
    // break apart: every piece on a bone (look, weak spot, gun) becomes a debris chunk (baked once per type)
    DEBRIS_DIR.copy(dir);
    this.ctx.debris.burst(this.debrisKind, this.skin, this.ctx.scene, this.debris, DEBRIS_OPT);
    this.debris.push(...this.shed);
    this.shed.length = 0;
    this.rig.root.visible = false;
  }

  // Removes the enemy from the scene and frees everything it owns (rig, baked skin + LOD, own materials, debris).
  dispose() {
    this.ctx.debris.releaseAll(this.debris);
    this.ctx.debris.releaseAll(this.shed);
    disposeTree(this.group);
    for (const m of [...Object.values(this.mats), this.visor, this.weakMat, this.haloMat, this.skin?.lodMaterial]) m?.dispose();
  }

  update(dt, player) {
    if (!this.alive) {
      this.#updateDebris(dt);
      return;
    }
    this.think(dt, player);
    if (this.shed.length) this.ctx.debris.step(this.shed, dt, this.ctx.world);
    // hit flash + weak spot pulse
    this.flash -= dt;
    const e = this.flash > 0 ? 0.9 : 0;
    for (const k in this.mats) this.mats[k].emissive.setScalar(e);
    this.skin.lodMaterial.emissive.setScalar(e);
    this.weakMat.emissiveIntensity = 2.8 + Math.sin(this.ctx.time * 8) * 1.0; // never dimmer than a sensor at rest
  }

  #updateDebris(dt) {
    if (!this.debris.length) return; // destroyed for good
    this.ctx.debris.step(this.debris, dt, this.ctx.world);
    if (!this.debris.length) this.onDebrisCleared?.();
  }
}

export function box(w, h, d, m, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  return mesh;
}
