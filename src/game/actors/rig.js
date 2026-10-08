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
const FOOT = 0.14; // ankle to the ball of the foot (heel-up roll pivots there)

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
// Layers: rest → hit spring → gait (foot paths, hips) → torso → arms (IK or run pump) → leg IK + kneel → feet IK.
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
const KNEEL_L = [-1.45, 1.45, 0]; // low cover kneel: thigh, knee, toes
const KNEEL_R = [0.15, 1.5, 0.9];

// Anime sprint style (`run` flag): torso lean, hip twist, arm pump. The leg motion itself comes from GAIT.
const RUN = {
  lean: 0.42, // forward torso lean (rad)
  hipsLean: 0.14,
  twist: 0.22, // hips yaw, shoulders counter-rotate
  armPump: 1.15,
  heelKick: 0.12, // extra swing-foot lift (m)
};

// Gait: each foot follows a stance/swing path in the character's space and the leg is IK'd to it.
// In stance the foot moves back at exactly the ground speed, so planted feet never slide; cadence and duty
// factor change with speed like a real walk (double support) -> run (flight phase).
const GAIT = {
  walk: { cadence: [0.8, 0.18], duty: 0.6, lift: 0.1, bob: 0.022, width: 1 }, // cadence: cycles/s = a + b * speed
  // quicker, shorter steps than a real runner: our legs are short and a long stance reads as a crouch
  run: { cadence: [1.4, 0.1], duty: [0.38, 0.015], lift: 0.28, bob: -0.025, width: 0.75 }, // duty: a - b * speed
  runAt: [2.0, 3.2], // m/s: walk -> run blend (the sprint style forces run)
  legLen: 0.815, // hip joint to ankle with the knee barely bent: hips drop so a planted foot stays in reach
};

export class Animator {
  // ground(x, z, maxY) -> floor height; enables feet IK
  constructor(rig, { armed = true, ground = null } = {}) {
    this.rig = rig;
    this.armed = armed;
    this.ground = ground;
    this.phase = 0; // gait cycle 0..1 (left foot touches down at 0)
    this.run = 0;
    this.gait = 0; // 0 walk .. 1 run
    this.dirX = 0; // smoothed local move direction (+X = character's left, +Z = forward)
    this.dirZ = 1;
    this.weaponPitch = 0.4;
    this.spinePitch = 0;
    this.hipsOffset = 0;
    this.look = 0;
    this.hit = new THREE.Vector2(); // spring-driven hit reaction (x: pitch, y: roll)
    this.hitVel = new THREE.Vector2();
    this.legs = { Left: { pos: new THREE.Vector3(), pitch: 0 }, Right: { pos: new THREE.Vector3(), pitch: 0 } };
  }

  impulse(pitch, roll) {
    this.hitVel.x += pitch;
    this.hitVel.y += roll;
  }

  // s: { speed, run, crouch, aimPitch, combat, recoil, lean, lookYaw, lower, kickBack, kickClimb,
  //      vel (world velocity, optional), yaw (facing, with vel) }
  update(dt, s) {
    const rig = this.rig;
    const B = rig.bones;
    rig.resetPose();

    // hit spring
    this.hitVel.x += (-120 * this.hit.x - 9 * this.hitVel.x) * dt;
    this.hitVel.y += (-120 * this.hit.y - 9 * this.hitVel.y) * dt;
    this.hit.x += this.hitVel.x * dt;
    this.hit.y += this.hitVel.y * dt;

    // ----- gait -----
    this.run = mix(this.run, s.run ? 1 : 0, 1 - Math.exp(-dt * 7));
    const r = this.run;
    const c = s.crouch;
    const v = s.speed;
    const W = GAIT.walk;
    const R = GAIT.run;
    const g = (this.gait = Math.max(r, smoothstep(GAIT.runAt[0], GAIT.runAt[1], v)));
    const cadence = mix(W.cadence[0] + W.cadence[1] * v, R.cadence[0] + R.cadence[1] * v, g);
    const duty = mix(W.duty, THREE.MathUtils.clamp(R.duty[0] - R.duty[1] * v, 0.26, 0.36), g);
    this.phase = (this.phase + cadence * dt) % 1;
    const stride = (duty * v) / cadence; // distance a planted foot travels back
    if (s.vel && v > 0.3) {
      // which way the body moves relative to where it faces: strafing / backpedaling feet follow it
      const sn = Math.sin(s.yaw);
      const cs = Math.cos(s.yaw);
      const k = 1 - Math.exp(-dt * 10);
      this.dirX += ((s.vel.x * cs - s.vel.z * sn) / v - this.dirX) * k;
      this.dirZ += ((s.vel.x * sn + s.vel.z * cs) / v - this.dirZ) * k;
      const l = Math.hypot(this.dirX, this.dirZ) || 1;
      this.dirX /= l;
      this.dirZ /= l;
    } else if (!s.vel) {
      this.dirX = 0;
      this.dirZ = 1;
    }
    const step = Math.min(1, v / 1.2) * (1 - c); // feet lift only when actually moving
    const lift = mix(W.lift, R.lift + RUN.heelKick * r, g) * step;
    const width = 0.11 * mix(W.width, R.width, g) * (1 + 0.7 * Math.abs(this.dirX));
    // push-off: the heel peels up in the second half of stance (the foot rolls onto the toes), which keeps the
    // trailing leg long instead of folding both knees; only when moving forward (the roll is along the foot)
    const heel = mix(0.045, 0.08, g) * step * Math.max(0, this.dirZ);
    const L2 = GAIT.legLen * GAIT.legLen;
    let drop = 0;
    for (const side of SIDES) {
      const u = side === 'Left' ? this.phase : (this.phase + 0.5) % 1;
      const L = this.legs[side];
      let z;
      let y;
      let weight; // how much this foot carries the body (hips must drop to keep it in reach)
      if (u < duty) {
        // stance: heel strike (walk) / flat contact (run), roll over, heel up onto the toes
        const k = u / duty;
        z = stride * (0.5 - k);
        const roll = Math.max(0, (k - 0.45) / 0.55);
        y = heel * roll * roll;
        weight = 1;
        L.pitch = Math.asin(Math.min(1, y / FOOT)) - (1 - g) * 0.25 * Math.max(0, 1 - k / 0.2) * step;
      } else {
        // swing: forward with eased speed; the run lifts the heel early (kick) and points the toes
        const w = (u - duty) / (1 - duty);
        // run: the foot leaves the ground fast and folds up under the hips (heel toward the seat), not trailing behind
        const e = mix(0.5 - 0.5 * Math.cos(Math.PI * w), 1 - Math.pow(1 - w, 1.8), g);
        z = stride * (e - 0.5);
        y = lift * Math.sin(Math.PI * Math.pow(w, mix(0.9, 0.7, g))) + heel * (1 - w) * (1 - w);
        weight = 1 - Math.sin(Math.PI * w); // fades out after lift-off, back in for touch-down
        const toe = Math.asin(Math.min(1, heel / FOOT));
        L.pitch = mix(mix(toe + 0.15 * (1 - g), -0.25 * (1 - g), w), mix(toe, 0, w) + 0.45 * Math.sin(Math.PI * w), g) * step;
      }
      // hip height that keeps this foot in reach: sqrt(L^2 - z^2) above the ankle, plus the ankle's own lift
      const zz = Math.min(Math.abs(z), GAIT.legLen * 0.9);
      drop = Math.max(drop, weight * Math.max(0, GAIT.legLen - Math.sqrt(L2 - zz * zz) - y));
      const sx = side === 'Left' ? width : -width;
      L.pos.set(sx + this.dirX * z, ANKLE + y, this.dirZ * z);
    }
    // left foot forward -> -1 (drives hips twist and the arm swing)
    const sw = -Math.cos(this.phase * Math.PI * 2);
    const amt = Math.min(1, v / 4) * (1 - c);
    // walk vaults over the planted leg (highest at mid-stance); run compresses there and floats in flight
    const bob = Math.cos(Math.PI * 4 * (this.phase - duty / 2)) * mix(W.bob, R.bob, g) * step;
    B.Hips.position.y += -0.38 * c - drop * (1 - c) - 0.015 * g * step + bob;
    const twist = sw * mix(0.08, RUN.twist, r) * amt;
    B.Hips.rotation.set(RUN.hipsLean * r * amt, twist, -sw * 0.04 * amt);

    // ----- torso -----
    const kk = 1 - Math.exp(-dt * 14);
    const running = r * amt;
    const aim = s.combat ? s.aimPitch : mix(-0.5, -0.95, r);
    this.spinePitch = mix(this.spinePitch, -aim * 0.3 * (1 - running) + RUN.lean * running + 0.08 * g * amt * (1 - r) + c * 0.15, kk);
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
      // the carried gun rides the steps a little and sways with the shoulders (less while aiming)
      B.Weapon.position.y += bob * 0.5;
      const sway = sw * amt * (s.combat ? 0.3 : 1);
      B.Weapon.position.x += sway * 0.012;
      B.Weapon.rotation.y += sway * 0.035;
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
        blendTo(B.LeftShoulder, 0, 0, 0, pump);
        blendTo(B.LeftArm, sw * RUN.armPump - 0.25, 0, 0.25, pump);
        blendTo(B.LeftForeArm, -1.5 - 0.4 * Math.max(0, -sw), 0, 0, pump);
        blendTo(B.LeftHand, 0, 0, 0, pump);
      }
    } else {
      // unarmed: arms swing against the legs, more and with bent elbows when running
      const a = mix(0.35, 0.8, g) * amt;
      setX(B.LeftArm, sw * a + this.hit.x * 0.8);
      setX(B.RightArm, -sw * a + this.hit.x * 0.8);
      B.LeftArm.rotation.z = 0.12 + Math.abs(this.hit.y) * 0.6;
      B.RightArm.rotation.z = -0.12 - Math.abs(this.hit.y) * 0.6;
      setX(B.LeftForeArm, -0.2 - 1.1 * g * amt);
      setX(B.RightForeArm, -0.2 - 1.1 * g * amt);
    }
    rig.root.updateMatrixWorld(true);

    // ----- legs: IK to the gait targets, kneel blended over them -----
    const rootQ = rig.root.getWorldQuaternion(_q2);
    const pole = _knee.set(0, 0.15, 1).applyQuaternion(rootQ); // knees forward
    if (c < 0.999) {
      for (const side of SIDES) {
        const target = rig.root.localToWorld(_c.copy(this.legs[side].pos));
        twoBone(B[side + 'UpLeg'], B[side + 'Leg'], B[side + 'Foot'], target, pole);
      }
    }
    if (c > 0.001) {
      for (const side of SIDES) {
        const kneel = side === 'Left' ? KNEEL_L : KNEEL_R;
        blendTo(B[side + 'UpLeg'], kneel[0], 0, 0, c);
        blendTo(B[side + 'Leg'], kneel[1], 0, 0, c);
        setX(B[side + 'ToeBase'], kneel[2] * c);
      }
    }
    rig.root.updateMatrixWorld(true);

    if (this.ground) this.#feetIK(dt, c);
    this.#orientFeet(rootQ, 1 - c);
  }

  // Feet keep the gait's pitch relative to the character (flat on the floor when planted), not the shin's.
  #orientFeet(rootQ, w) {
    if (w <= 0.01) return;
    const B = this.rig.bones;
    for (const side of SIDES) {
      const foot = B[side + 'Foot'];
      _q.copy(foot.parent.getWorldQuaternion(_fq).invert()).multiply(rootQ);
      _fq.setFromEuler(_euler.set(this.legs[side].pitch, 0, 0));
      _q.multiply(_fq);
      foot.quaternion.slerp(_q, w);
      foot.updateMatrixWorld(true);
    }
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

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return a + (b - a) * t;
}
