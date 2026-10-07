import * as THREE from 'three';

// Humanoid skeleton shared by every character.
// - Bones are THREE.Bone with no rest rotation; character faces +Z, right hand is -X.
// - Limb bones point along local -Y (child offset), so rotation.x < 0 swings a leg forward.
// - The "dummy" is one placeholder box per bone. Modeled parts replace it via rig.setPart().
// See instructions/animation.md.

export const BONES = {
  pelvis: { parent: null, pos: [0, 0.95, 0] },
  spine: { parent: 'pelvis', pos: [0, 0.12, 0] },
  chest: { parent: 'spine', pos: [0, 0.22, 0] },
  neck: { parent: 'chest', pos: [0, 0.26, 0] },
  head: { parent: 'neck', pos: [0, 0.07, 0] },
  clavicleL: { parent: 'chest', pos: [0.08, 0.19, 0] },
  upperArmL: { parent: 'clavicleL', pos: [0.13, 0, 0] },
  foreArmL: { parent: 'upperArmL', pos: [0, -0.28, 0] },
  handL: { parent: 'foreArmL', pos: [0, -0.26, 0] },
  clavicleR: { parent: 'chest', pos: [-0.08, 0.19, 0] },
  upperArmR: { parent: 'clavicleR', pos: [-0.13, 0, 0] },
  foreArmR: { parent: 'upperArmR', pos: [0, -0.28, 0] },
  handR: { parent: 'foreArmR', pos: [0, -0.26, 0] },
  weapon: { parent: 'chest', pos: [-0.13, 0.11, 0.2] },
  thighL: { parent: 'pelvis', pos: [0.11, -0.05, 0] },
  shinL: { parent: 'thighL', pos: [0, -0.44, 0] },
  footL: { parent: 'shinL', pos: [0, -0.44, 0] },
  thighR: { parent: 'pelvis', pos: [-0.11, -0.05, 0] },
  shinR: { parent: 'thighR', pos: [0, -0.44, 0] },
  footR: { parent: 'shinR', pos: [0, -0.44, 0] },
};

// Placeholder part per bone: [w, h, d, offsetX, offsetY, offsetZ, materialSlot]
const DUMMY = {
  pelvis: [0.36, 0.2, 0.24, 0, 0, 0, 'body'],
  spine: [0.34, 0.24, 0.22, 0, 0.11, 0, 'body'],
  chest: [0.48, 0.32, 0.3, 0, 0.13, 0, 'plate'],
  neck: [0.1, 0.08, 0.1, 0, 0.03, 0, 'body'],
  head: [0.24, 0.28, 0.26, 0, 0.13, 0, 'body'],
  upperArmL: [0.11, 0.28, 0.11, 0, -0.14, 0, 'body'],
  foreArmL: [0.1, 0.26, 0.1, 0, -0.13, 0, 'plate'],
  handL: [0.08, 0.1, 0.08, 0, -0.04, 0, 'body'],
  upperArmR: [0.11, 0.28, 0.11, 0, -0.14, 0, 'body'],
  foreArmR: [0.1, 0.26, 0.1, 0, -0.13, 0, 'plate'],
  handR: [0.08, 0.1, 0.08, 0, -0.04, 0, 'body'],
  thighL: [0.17, 0.44, 0.19, 0, -0.22, 0, 'body'],
  shinL: [0.15, 0.44, 0.17, 0, -0.22, 0, 'plate'],
  footL: [0.14, 0.07, 0.26, 0, -0.01, 0.05, 'body'],
  thighR: [0.17, 0.44, 0.19, 0, -0.22, 0, 'body'],
  shinR: [0.15, 0.44, 0.17, 0, -0.22, 0, 'plate'],
  footR: [0.14, 0.07, 0.26, 0, -0.01, 0.05, 'body'],
};

export const HIT_ZONE = { head: 'head', neck: 'head', chest: 'torso', spine: 'torso', pelvis: 'torso' };

export class Rig {
  constructor({ materials, dummy = true } = {}) {
    this.root = new THREE.Group(); // positioned at the feet, yaw = facing
    this.bones = {};
    for (const [name, def] of Object.entries(BONES)) {
      const b = new THREE.Bone();
      b.name = name;
      b.position.fromArray(def.pos);
      b.userData.rest = b.position.clone();
      this.bones[name] = b;
      (def.parent ? this.bones[def.parent] : this.root).add(b);
    }
    this.skeleton = new THREE.Skeleton(Object.values(this.bones));
    this.parts = {}; // boneName -> Object3D
    this.sockets = {};
    if (dummy && materials) this.buildDummy(materials);
  }

  // Placeholder mannequin. Each part is parented to its bone (the bone is the pivot).
  buildDummy(materials) {
    for (const [bone, [w, h, d, x, y, z, slot]] of Object.entries(DUMMY)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[slot] ?? materials.body);
      mesh.position.set(x, y, z);
      this.setPart(bone, mesh);
    }
  }

  // Swap the visual for a bone (e.g. a modeled GLTF piece authored around the bone origin).
  setPart(bone, object) {
    const old = this.parts[bone];
    if (old) old.removeFromParent();
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.bone = bone;
      }
    });
    this.bones[bone].add(object);
    this.parts[bone] = object;
    return object;
  }

  // Extra attachment (helmet visor, weapon mesh...) that is not the bone's main part.
  attach(bone, object) {
    object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.userData.bone = bone;
      }
    });
    this.bones[bone].add(object);
    return object;
  }

  socket(bone, name, x, y, z) {
    const s = new THREE.Object3D();
    s.position.set(x, y, z);
    this.bones[bone].add(s);
    this.sockets[name] = s;
    return s;
  }

  resetPose() {
    for (const b of Object.values(this.bones)) {
      b.position.copy(b.userData.rest);
      b.quaternion.identity();
    }
  }

  helper() {
    if (!this._helper) {
      this._helper = new THREE.SkeletonHelper(this.root);
      this._helper.material.depthTest = false;
      this._helper.material.transparent = true;
    }
    return this._helper;
  }
}

// ---------------------------------------------------------------------------
// Procedural animation layers. Character state in, bone transforms out.
// state: { speed, sprint, crouch(0..1), kneel(bool), aimPitch, combat, hop(0..1), lean }
// ---------------------------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pole = new THREE.Vector3();

export class Animator {
  constructor(rig, { armed = true } = {}) {
    this.rig = rig;
    this.armed = armed;
    this.phase = 0;
    this.weaponPitch = 0.4;
    this.spinePitch = 0;
    this.hit = new THREE.Vector2(); // spring-driven hit reaction (x: pitch, y: roll)
    this.hitVel = new THREE.Vector2();
  }

  impulse(pitch, roll) {
    this.hitVel.x += pitch;
    this.hitVel.y += roll;
  }

  update(dt, s) {
    const rig = this.rig;
    const B = rig.bones;
    rig.resetPose();

    // hit spring
    const k = 120;
    const damp = 9;
    this.hitVel.x += (-k * this.hit.x - damp * this.hitVel.x) * dt;
    this.hitVel.y += (-k * this.hit.y - damp * this.hitVel.y) * dt;
    this.hit.x += this.hitVel.x * dt;
    this.hit.y += this.hitVel.y * dt;

    // ----- locomotion (legs + pelvis) -----
    const run = s.sprint ? 1 : 0;
    const stride = run ? 2.6 : 2.1;
    this.phase += s.speed * dt * stride;
    const amt = Math.min(1, s.speed / 4) * (1 - s.crouch);
    const sw = Math.sin(this.phase);
    const swing = (0.55 + 0.25 * run) * amt;
    const c = s.crouch;

    B.pelvis.position.y += -0.42 * c + Math.abs(Math.cos(this.phase)) * 0.05 * amt;
    setX(B.thighL, mix(sw * swing, -1.45, c));
    setX(B.shinL, mix(Math.max(0, -Math.sin(this.phase - 0.6)) * (1.0 + 0.4 * run) * amt, 1.45, c));
    setX(B.footL, mix(0, 0.0, c));
    setX(B.thighR, mix(-sw * swing, 0.15, c));
    setX(B.shinR, mix(Math.max(0, Math.sin(this.phase - 0.6)) * (1.0 + 0.4 * run) * amt, 1.5, c));
    setX(B.footR, mix(0, 0.9, c));
    B.pelvis.rotation.y = sw * 0.08 * amt;

    // ----- upper body -----
    const kk = 1 - Math.exp(-dt * 14);
    const aim = s.combat ? s.aimPitch : s.sprint ? -0.95 : -0.5;
    this.spinePitch = mix(this.spinePitch, -aim * 0.3 + (s.sprint ? 0.22 : 0) + c * 0.15, kk);
    this.weaponPitch = mix(this.weaponPitch, -aim * 0.7 - c * 0.15, 1 - Math.exp(-dt * 22));
    B.spine.rotation.set(this.spinePitch * 0.5 + this.hit.x * 0.5, -B.pelvis.rotation.y, this.hit.y * 0.5 + (s.lean ?? 0) * 0.5);
    B.chest.rotation.set(this.spinePitch * 0.5 + this.hit.x * 0.5, 0, this.hit.y * 0.5 + (s.lean ?? 0) * 0.5);
    B.neck.rotation.x = -(this.spinePitch) * 0.4;
    B.head.rotation.x = s.combat ? 0 : 0.1;

    if (this.armed) {
      B.weapon.rotation.x = this.weaponPitch;
      B.weapon.rotation.y = s.combat ? 0 : 0.35;
      if (s.recoil) B.weapon.position.z -= s.recoil * 0.06;
      rig.root.updateMatrixWorld(true);
      // hands to weapon grips (two-bone IK), elbows out/down
      if (rig.sockets.gripR) this.#ik('R', rig.sockets.gripR, -1);
      if (rig.sockets.gripL) this.#ik('L', rig.sockets.gripL, 1);
    } else {
      // unarmed / puppet: arms hang and swing
      setX(B.upperArmL, -sw * 0.5 * amt + this.hit.x * 0.8);
      setX(B.upperArmR, sw * 0.5 * amt + this.hit.x * 0.8);
      B.upperArmL.rotation.z = 0.12 + Math.abs(this.hit.y) * 0.6;
      B.upperArmR.rotation.z = -0.12 - Math.abs(this.hit.y) * 0.6;
      setX(B.foreArmL, -0.2);
      setX(B.foreArmR, -0.2);
    }
    rig.root.updateMatrixWorld(true);
  }

  #ik(side, target, out) {
    const B = this.rig.bones;
    const upper = B['upperArm' + side];
    const lower = B['foreArm' + side];
    const end = B['hand' + side];
    const l1 = lower.position.length();
    const l2 = end.position.length();
    const a = upper.getWorldPosition(_a);
    const t = target.getWorldPosition(_b);
    const toT = _c.copy(t).sub(a);
    const dist = THREE.MathUtils.clamp(toT.length(), 0.05, l1 + l2 - 1e-3);
    toT.normalize();
    const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    // pole: elbow out to the side and down, in character space
    _pole.set(out * 0.6, -0.8, -0.2).transformDirection(this.rig.root.matrixWorld);
    _pole.addScaledVector(toT, -_pole.dot(toT)).normalize();
    const elbow = _d.copy(a).addScaledVector(toT, l1 * cosA).addScaledVector(_pole, l1 * sinA);
    aimBone(upper, elbow);
    const wrist = _c.copy(a).addScaledVector(toT, dist);
    aimBone(lower, wrist);
    end.quaternion.identity();
  }
}

// Rotate bone so its child axis (rest offset of its first bone child) points at a world target.
function aimBone(bone, worldTarget) {
  const child = bone.children.find((o) => o.isBone);
  const rest = _q;
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  const p = bone.getWorldPosition(new THREE.Vector3());
  const dir = worldTarget.clone().sub(p).normalize().applyQuaternion(parentQ.invert());
  const restDir = child.position.clone().normalize();
  rest.setFromUnitVectors(restDir, dir);
  bone.quaternion.copy(rest);
  bone.updateMatrixWorld(true);
}

function setX(bone, x) {
  bone.rotation.x = x;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}
