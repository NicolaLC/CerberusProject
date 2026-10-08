import * as THREE from 'three';

// Humanoid skeleton shared by every character, named after the Mixamo rig.
// - Keys are Mixamo bone names without the prefix; Bone.name gets the `mixamorig` prefix, which is how
//   three.js names Mixamo bones after loading (the ':' is stripped), so clips and models bind by name.
// - Bones have no rest rotation (unlike Mixamo's T-pose): character faces +Z, its left is +X.
//   Limb bones point along local -Y (child offset), so rotation.x < 0 swings a limb forward.
// - `Weapon` is an extra prop bone (not Mixamo) on Spine2 holding the gun by its stock.
// - The "dummy" is one placeholder box per bone; modeled parts replace it via rig.setPart().
// See instructions/animation.md.

export const PREFIX = 'mixamorig';

export const BONES = {
  Hips: { parent: null, pos: [0, 0.95, 0] },
  Spine: { parent: 'Hips', pos: [0, 0.1, 0] },
  Spine1: { parent: 'Spine', pos: [0, 0.12, 0] },
  Spine2: { parent: 'Spine1', pos: [0, 0.12, 0] },
  Neck: { parent: 'Spine2', pos: [0, 0.24, 0] },
  Head: { parent: 'Neck', pos: [0, 0.08, 0] },
  LeftShoulder: { parent: 'Spine2', pos: [0.08, 0.19, 0] },
  LeftArm: { parent: 'LeftShoulder', pos: [0.13, 0, 0] },
  LeftForeArm: { parent: 'LeftArm', pos: [0, -0.3, 0] },
  LeftHand: { parent: 'LeftForeArm', pos: [0, -0.28, 0] },
  RightShoulder: { parent: 'Spine2', pos: [-0.08, 0.19, 0] },
  RightArm: { parent: 'RightShoulder', pos: [-0.13, 0, 0] },
  RightForeArm: { parent: 'RightArm', pos: [0, -0.3, 0] },
  RightHand: { parent: 'RightForeArm', pos: [0, -0.28, 0] },
  Weapon: { parent: 'Spine2', pos: [-0.12, 0.15, 0.1] }, // gun stock pivot, right shoulder pocket
  LeftUpLeg: { parent: 'Hips', pos: [0.11, -0.05, 0] },
  LeftLeg: { parent: 'LeftUpLeg', pos: [0, -0.42, 0] },
  LeftFoot: { parent: 'LeftLeg', pos: [0, -0.4, 0] }, // ankle, 0.08 above the floor at rest
  LeftToeBase: { parent: 'LeftFoot', pos: [0, -0.06, 0.13] },
  RightUpLeg: { parent: 'Hips', pos: [-0.11, -0.05, 0] },
  RightLeg: { parent: 'RightUpLeg', pos: [0, -0.42, 0] },
  RightFoot: { parent: 'RightLeg', pos: [0, -0.4, 0] },
  RightToeBase: { parent: 'RightFoot', pos: [0, -0.06, 0.13] },
};

const ANKLE = 0.08;

// Placeholder part per bone: [w, h, d, offsetX, offsetY, offsetZ, materialSlot]
const DUMMY = {
  Hips: [0.36, 0.2, 0.24, 0, 0, 0, 'body'],
  Spine: [0.34, 0.12, 0.22, 0, 0.06, 0, 'body'],
  Spine1: [0.4, 0.14, 0.25, 0, 0.07, 0, 'body'],
  Spine2: [0.48, 0.3, 0.3, 0, 0.12, 0, 'plate'],
  Neck: [0.1, 0.08, 0.1, 0, 0.03, 0, 'body'],
  Head: [0.24, 0.28, 0.26, 0, 0.13, 0, 'body'],
  LeftArm: [0.11, 0.3, 0.11, 0, -0.15, 0, 'body'],
  LeftForeArm: [0.1, 0.28, 0.1, 0, -0.14, 0, 'plate'],
  LeftHand: [0.08, 0.1, 0.08, 0, -0.04, 0, 'body'],
  RightArm: [0.11, 0.3, 0.11, 0, -0.15, 0, 'body'],
  RightForeArm: [0.1, 0.28, 0.1, 0, -0.14, 0, 'plate'],
  RightHand: [0.08, 0.1, 0.08, 0, -0.04, 0, 'body'],
  LeftUpLeg: [0.17, 0.42, 0.19, 0, -0.21, 0, 'body'],
  LeftLeg: [0.15, 0.4, 0.17, 0, -0.2, 0, 'plate'],
  LeftFoot: [0.14, 0.08, 0.17, 0, -0.04, 0, 'body'],
  LeftToeBase: [0.13, 0.05, 0.1, 0, 0, 0.04, 'plate'],
  RightUpLeg: [0.17, 0.42, 0.19, 0, -0.21, 0, 'body'],
  RightLeg: [0.15, 0.4, 0.17, 0, -0.2, 0, 'plate'],
  RightFoot: [0.14, 0.08, 0.17, 0, -0.04, 0, 'body'],
  RightToeBase: [0.13, 0.05, 0.1, 0, 0, 0.04, 'plate'],
};

export const HIT_ZONE = { Head: 'head', Neck: 'head', Spine2: 'torso', Spine1: 'torso', Spine: 'torso', Hips: 'torso' };

export class Rig {
  constructor({ materials, dummy = true } = {}) {
    this.root = new THREE.Group(); // positioned at the feet, yaw = facing
    this.bones = {};
    for (const [name, def] of Object.entries(BONES)) {
      const b = new THREE.Bone();
      b.name = PREFIX + name;
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
      mesh.userData.size = [w, h, d];
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

  // Named attachment point; calling again with the same name moves it.
  socket(bone, name, x, y, z) {
    const s = this.sockets[name] ?? new THREE.Object3D();
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
// Procedural animation. Character state in, bone transforms out.
// state: { speed, run, crouch 0..1, aimPitch, combat, recoil, lean, lookYaw, lower 0..1 }
// Layers: rest → hit spring → legs (walk / anime run / kneel) → torso → arms (IK or run pump) → feet IK.
// ---------------------------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pole = new THREE.Vector3();
const _euler = new THREE.Euler();
// IK scratch (the animator runs for every rig every frame: no allocations below)
const _fp = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _joint = new THREE.Vector3();
const _reach = new THREE.Vector3();
const _bp = new THREE.Vector3();
const _bdir = new THREE.Vector3();
const _bq = new THREE.Quaternion();
const _fq = new THREE.Quaternion();
const SIDES = ['Left', 'Right'];

const RUN = {
  lean: 0.42, // forward torso lean (rad)
  hipsLean: 0.14,
  thighForward: 1.25, // high knees
  thighBack: 0.8,
  heelKick: 2.1, // knee bend during the swing
  bounce: 0.09, // hang-time bob
  twist: 0.22, // hips yaw, shoulders counter-rotate
  armPump: 1.15,
};

export class Animator {
  // ground(x, z, maxY) -> floor height; enables feet IK
  constructor(rig, { armed = true, ground = null } = {}) {
    this.rig = rig;
    this.armed = armed;
    this.ground = ground;
    this.phase = 0;
    this.run = 0;
    this.weaponPitch = 0.4;
    this.spinePitch = 0;
    this.hipsOffset = 0;
    this.look = 0;
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
    this.hitVel.x += (-120 * this.hit.x - 9 * this.hitVel.x) * dt;
    this.hitVel.y += (-120 * this.hit.y - 9 * this.hitVel.y) * dt;
    this.hit.x += this.hitVel.x * dt;
    this.hit.y += this.hitVel.y * dt;

    // ----- legs -----
    this.run = mix(this.run, s.run ? 1 : 0, 1 - Math.exp(-dt * 7));
    const r = this.run;
    const c = s.crouch;
    this.phase += s.speed * dt * mix(2.1, 2.75, r);
    const amt = Math.min(1, s.speed / 4) * (1 - c);
    const ph = this.phase;

    const leg = (side, p) => {
      const sp = Math.sin(p);
      // walk: pendulum thigh, knee bends while the leg swings back
      const wThigh = sp * 0.55;
      const wShin = Math.max(0, -Math.sin(p - 0.6)) * 1.0;
      // anime run: big forward reach, high knee, heel kicks up behind
      const rThigh = sp < 0 ? sp * RUN.thighForward : sp * RUN.thighBack;
      const rShin = 0.25 + RUN.heelKick * Math.pow(Math.max(0, Math.cos(p + 0.5)), 1.4);
      const rFoot = 0.5 * Math.max(0, Math.cos(p)); // toes point during the swing
      const thigh = mix(wThigh, rThigh, r) * amt;
      const shin = mix(wShin, rShin, r) * amt;
      const kneel = side === 'Left' ? [-1.45, 1.45, 0] : [0.15, 1.5, 0.9];
      setX(B[side + 'UpLeg'], mix(thigh, kneel[0], c));
      setX(B[side + 'Leg'], mix(shin, kneel[1], c));
      setX(B[side + 'Foot'], mix(rFoot * r * amt, 0, c));
      setX(B[side + 'ToeBase'], mix(0, kneel[2], c));
    };
    // left leg leads when sin(phase) < 0
    leg('Left', ph);
    leg('Right', ph + Math.PI);

    const bob = mix(Math.abs(Math.cos(ph)) * 0.05, Math.pow(Math.abs(Math.sin(ph)), 0.7) * RUN.bounce - 0.07, r);
    B.Hips.position.y += -0.38 * c + bob * amt;
    const twist = Math.sin(ph) * mix(0.08, RUN.twist, r) * amt;
    B.Hips.rotation.set(RUN.hipsLean * r * amt, twist, Math.cos(ph) * 0.05 * amt);

    // ----- torso -----
    const kk = 1 - Math.exp(-dt * 14);
    const running = r * amt;
    const aim = s.combat ? s.aimPitch : mix(-0.5, -0.95, r);
    this.spinePitch = mix(this.spinePitch, -aim * 0.3 * (1 - running) + RUN.lean * running + c * 0.15, kk);
    this.weaponPitch = mix(this.weaponPitch, -aim * 0.7 - c * 0.15, 1 - Math.exp(-dt * 22));
    const lean = (s.lean ?? 0) * 0.33;
    const sp = this.spinePitch / 3 + this.hit.x / 3;
    B.Spine.rotation.set(sp, -twist * 0.5, this.hit.y / 3 + lean);
    B.Spine1.rotation.set(sp, -twist * 0.9, this.hit.y / 3 + lean); // shoulders counter-rotate
    B.Spine2.rotation.set(sp - RUN.hipsLean * running, -twist * 0.4, this.hit.y / 3 + lean);
    // head stays level and looks where it should (at the camera while in cover)
    this.look = mix(this.look, s.lookYaw ?? 0, kk * 0.6);
    B.Neck.rotation.set(-this.spinePitch * 0.55 - RUN.hipsLean * running, this.look * 0.4 + twist * 0.3, 0);
    B.Head.rotation.set(s.combat ? 0 : 0.08, this.look * 0.6, 0);

    // ----- arms -----
    if (this.armed) {
      B.Weapon.rotation.x = this.weaponPitch + (s.lower ?? 0) * 1.1; // lowered while switching guns
      B.Weapon.rotation.y = (s.combat ? 0 : mix(0.35, 0.15, r)) + (s.lower ?? 0) * 0.4;
      if (s.recoil) {
        B.Weapon.position.z -= s.recoil * (s.kickBack ?? 0.06);
        B.Weapon.rotation.x -= s.recoil * (s.kickClimb ?? 0); // muzzle climbs
      }
      B.LeftShoulder.rotation.y = -0.6; // support shoulder rolls forward so the left hand reaches the handguard
      B.RightShoulder.rotation.y = 0.15;
      rig.root.updateMatrixWorld(true);
      if (rig.sockets.gripR) this.#armIK('Right', rig.sockets.gripR, -1);
      if (rig.sockets.gripL) this.#armIK('Left', rig.sockets.gripL, 1);
      // running: the left hand lets go of the gun and pumps, anime style
      const pump = r * amt * (s.combat ? 0 : 1);
      if (pump > 0.01) {
        const ls = Math.sin(ph);
        blendTo(B.LeftShoulder, 0, 0, 0, pump);
        blendTo(B.LeftArm, ls * RUN.armPump - 0.25, 0, 0.25, pump);
        blendTo(B.LeftForeArm, -1.5 - 0.4 * Math.max(0, -ls), 0, 0, pump);
        blendTo(B.LeftHand, 0, 0, 0, pump);
      }
    } else {
      // puppet: arms hang and swing
      const sw = Math.sin(ph);
      setX(B.LeftArm, -sw * 0.5 * amt + this.hit.x * 0.8);
      setX(B.RightArm, sw * 0.5 * amt + this.hit.x * 0.8);
      B.LeftArm.rotation.z = 0.12 + Math.abs(this.hit.y) * 0.6;
      B.RightArm.rotation.z = -0.12 - Math.abs(this.hit.y) * 0.6;
      setX(B.LeftForeArm, -0.2);
      setX(B.RightForeArm, -0.2);
    }
    rig.root.updateMatrixWorld(true);

    if (this.ground) this.#feetIK(dt, c);
  }

  // Plant feet on uneven ground: lower the hips to the lowest foot, then IK each leg to its floor.
  #feetIK(dt, crouch) {
    const rig = this.rig;
    const B = rig.bones;
    const rootY = rig.root.getWorldPosition(_a).y;
    const targets = (this.feet ??= { Left: { ty: 0, lift: 0 }, Right: { ty: 0, lift: 0 } });
    let lowest = 0;
    for (const side of SIDES) {
      const p = B[side + 'Foot'].getWorldPosition(_fp);
      const lift = Math.max(0, p.y - rootY - ANKLE); // animated lift above a flat floor
      const g = this.ground(p.x, p.z, rootY + 0.6);
      const ty = g + ANKLE + lift;
      targets[side].ty = ty;
      targets[side].lift = lift;
      lowest = Math.min(lowest, ty - p.y);
    }
    this.hipsOffset = mix(this.hipsOffset, Math.max(-0.4, lowest), 1 - Math.exp(-dt * 18));
    B.Hips.position.y += this.hipsOffset;
    rig.root.updateMatrixWorld(true);

    const w = 1 - crouch;
    if (w <= 0.01) return;
    const rootQ = rig.root.getWorldQuaternion(_q2);
    const pole = _knee.set(0, 0.15, 1).applyQuaternion(rootQ); // knees forward
    for (const side of SIDES) {
      const t = targets[side];
      const foot = B[side + 'Foot'];
      const now = foot.getWorldPosition(_b);
      const goal = _c.set(now.x, mix(now.y, t.ty, w), now.z);
      twoBone(B[side + 'UpLeg'], B[side + 'Leg'], foot, goal, pole);
      // planted feet stay flat on the floor
      if (t.lift < 0.06) {
        const pq = foot.parent.getWorldQuaternion(_fq).invert();
        _q.copy(pq).multiply(rootQ);
        foot.quaternion.slerp(_q, w * (1 - t.lift / 0.06));
        foot.updateMatrixWorld(true);
      }
    }
  }

  #armIK(side, target, out) {
    const pole = _pole.set(out * 0.35, -1, 0.05).transformDirection(this.rig.root.matrixWorld); // elbows down, slightly out
    const B = this.rig.bones;
    twoBone(B[side + 'Arm'], B[side + 'ForeArm'], B[side + 'Hand'], target.getWorldPosition(_d), pole);
    B[side + 'Hand'].quaternion.identity();
  }
}

// Analytic two-bone IK: bends upper/lower so `end` reaches `target`, bending toward `pole` (world dir).
function twoBone(upper, lower, end, target, pole) {
  const l1 = lower.position.length();
  const l2 = end.position.length();
  const a = upper.getWorldPosition(_a);
  const dir = _e.copy(target).sub(a);
  const dist = THREE.MathUtils.clamp(dir.length(), 0.05, l1 + l2 - 1e-3);
  dir.normalize();
  const cosA = THREE.MathUtils.clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bend = _bend.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  const joint = _joint.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(bend, l1 * sinA);
  const reach = _reach.copy(a).addScaledVector(dir, dist);
  aimBone(upper, joint);
  aimBone(lower, reach);
}

// Rotate bone so its child axis (rest offset of its first bone child) points at a world target.
function aimBone(bone, worldTarget) {
  const ud = bone.userData;
  if (!ud.aimAxis) ud.aimAxis = bone.children.find((o) => o.isBone).position.clone().normalize();
  const parentQ = bone.parent.getWorldQuaternion(_bq);
  const p = bone.getWorldPosition(_bp);
  const dir = _bdir.copy(worldTarget).sub(p).normalize().applyQuaternion(parentQ.invert());
  bone.quaternion.setFromUnitVectors(ud.aimAxis, dir);
  bone.updateMatrixWorld(true);
}

// Blend a bone from its current (IK) rotation toward an FK euler pose.
function blendTo(bone, x, y, z, w) {
  _q.setFromEuler(_euler.set(x, y, z));
  bone.quaternion.slerp(_q, w);
}

function setX(bone, x) {
  bone.rotation.x = x;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}
