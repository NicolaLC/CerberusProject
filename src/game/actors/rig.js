import * as THREE from 'three';
import { GAITS, RUN_AT, LEG_REST, ankleDown, sampleCyclic, amplitude, frequency } from './locomotion.js';

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
// state: { speed, run, air (jetpack burst), crouch 0..1, aimPitch, combat, recoil, lean, lookYaw, lower 0..1 }
// Layers: rest → hit spring → gait key poses (locomotion.js) → torso → arms (IK or run pump) → foot locks + kneel → feet IK.
// ---------------------------------------------------------------------------

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _pw = [0, 0, 0];
const _pr = [0, 0, 0];
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
const _hq = new THREE.Quaternion(); // slide aiming: hips rotation before the vault pose, and scratch
const _tq = new THREE.Quaternion();
const _uq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const SIDES = ['Left', 'Right'];
const CROUCH_DROP = 0.38; // m the hips sink when crouched
// [LeftUpLeg x, LeftLeg x, RightUpLeg x, RightLeg x], hips [pitch, roll, height], extra spine pitch per bone
const VAULT_POSE = {
  hop: { legs: [-1.25, 1.9, -0.75, 1.7], hips: [0.25, 0, 0.1], spine: 0.12 },
  slide: { legs: [-1.45, 0.2, -1.05, 1.15], hips: [-0.35, 0.45, -0.8], spine: 0.2 }, // hips down onto the top
};
// Jetpack burst pose: [LeftUpLeg x, LeftLeg x, RightUpLeg x, RightLeg x], hips pitch. Knees bent, hips forward a bit.
const AIR_POSE = { legs: [-0.35, 0.5, -0.2, 0.55], hips: 0.12 };
const FLIGHT = 0.1; // m the hips rise at the top of a running stride's flight (full run speed)
const FLIGHT_LEAD = 0.1; // cycle fraction before toe-off the rise starts (as the heel peels up)
const FLIGHT_TAIL = 0.04; // cycle fraction after heel strike it settles
const HIPS_SPRING = 40; // 1/s: hips height follows its target through a critically damped spring
const HUNCH = 0.55; // rad of forward spine bend moving along cover
const KNEEL_L = [-1.45, 1.45, 0]; // low cover kneel: thigh, knee, toes
const KNEEL_R = [0.15, 1.5, 0.9];

// Anime sprint style (`run` flag): torso lean, hip twist, arm pump. The legs come from the key poses.
const RUN = {
  lean: 0.42, // forward torso lean (rad)
  hipsLean: 0.14,
  twist: 0.22, // hips yaw, shoulders counter-rotate
  armPump: 1.15,
};
const HIP_YAW = 0.9; // rad: strafing turns the hips (and legs) toward the movement, the chest keeps facing
const LOCK_RELEASE = 0.45; // m: a planted foot this far from its pose (spinning on the spot, a shove) lets go

export class Animator {
  // ground(x, z, maxY) -> floor height; enables feet IK
  constructor(rig, { armed = true, ground = null } = {}) {
    this.rig = rig;
    this.armed = armed;
    this.ground = ground;
    this.phase = 0; // gait cycle 0..1 (left heel strike at 0)
    this.run = 0;
    this.gait = 0; // 0 walk .. 1 run
    this.dirX = 0; // smoothed local move direction (+X = character's left, +Z = forward)
    this.dirZ = 1;
    this.hipYaw = 0;
    this.legYaw = 0; // the rest of the turn, taken by the thighs: steps always go where the body moves
    this.drop = 0; // hips lowered so the supporting foot reaches the floor
    this.hipsY = 0; // smoothed hips height offset (m) and its velocity
    this.hipsYV = 0;
    this.weaponPitch = 0.4;
    this.spinePitch = 0;
    this.hipsOffset = 0;
    this.look = 0;
    this.gaitW = 0; // 0 standing .. 1 full gait, eased
    this.holdV = 0; // last moving speed (the cadence a stop winds down from)
    this.hunch = 0;
    this.air = 0; // jetpack burst pose weight 0..1
    this.hand = 1; // 1 = gun on the right shoulder, -1 = mirrored to the left (peeking a left corner)
    this.hit = new THREE.Vector2(); // spring-driven hit reaction (x: pitch, y: roll)
    this.hitVel = new THREE.Vector2();
    // thighs: yaw first, then swing (the swing plane turns with the step direction)
    for (const side of SIDES) rig.bones[side + 'UpLeg'].rotation.order = 'YXZ';
    const leg = () => ({ thigh: 0, knee: 0, pitch: 0, stance: 0, locked: false, released: false, lw: 0, lock: new THREE.Vector3() });
    this.legs = { Left: leg(), Right: leg() };
  }

  impulse(pitch, roll) {
    this.hitVel.x += pitch;
    this.hitVel.y += roll;
  }

  // s: { speed, run, crouch, aimPitch, combat, recoil, lean, lookYaw, lower, kickBack, kickClimb,
  //      vel (world velocity, optional), yaw (facing, with vel), leftHanded (mirror the gun hold) }
  update(dt, s) {
    const rig = this.rig;
    const B = rig.bones;
    rig.resetPose();

    // hit spring
    this.hitVel.x += (-120 * this.hit.x - 9 * this.hitVel.x) * dt;
    this.hitVel.y += (-120 * this.hit.y - 9 * this.hitVel.y) * dt;
    this.hit.x += this.hitVel.x * dt;
    this.hit.y += this.hitVel.y * dt;

    // ----- gait: key poses (locomotion.js) -----
    this.run = mix(this.run, s.run ? 1 : 0, 1 - Math.exp(-dt * 7));
    const r = this.run;
    const c = s.crouch;
    const v = s.speed;
    // gait weight eases out after a stop (the legs finish the step and settle) and in quickly on a start;
    // meanwhile the cycle keeps the last cadence, fading with it
    const gw = smoothstep(0.05, 0.6, v);
    this.gaitW = mix(this.gaitW, gw, 1 - Math.exp(-dt * (gw > this.gaitW ? 14 : 5)));
    if (v > 0.3) this.holdV = v;
    const ve = Math.max(v, this.holdV * this.gaitW); // the speed the legs act out
    this.hunch = mix(this.hunch, s.hunch ? 1 : 0, 1 - Math.exp(-dt * 8));
    const hu = this.hunch;
    if (s.vel && v > 0.3) {
      // which way the body moves relative to where it faces: strafing / backpedaling
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
    // crouched and moving (sliding along low cover): the gait keeps going with the hips down, IK bends the legs
    const mv = this.gaitW;
    const ck = c * (1 - mv); // kneel pose weight: only when crouched and still
    const cw = c * mv; // crouch-walk weight
    // crouched steps are shorter and quicker (the cadence rises so planted feet still keep pace with the ground)
    const short = 1 - 0.5 * cw;
    this.air = mix(this.air, s.air ? 1 : 0, 1 - Math.exp(-dt * 14));
    const aw = this.air;
    const m = mv * (1 - ck) * short * (1 - aw); // how much of the gait shows (0 = standing; none in the air)
    // strafing: the hips turn toward the movement (up to HIP_YAW); backpedaling plays the cycle in reverse
    const back = this.dirZ < -0.25;
    const dirYaw = back ? Math.atan2(-this.dirX, -this.dirZ) : Math.atan2(this.dirX, this.dirZ);
    const want = THREE.MathUtils.clamp(dirYaw, -HIP_YAW, HIP_YAW);
    const ease = 1 - Math.exp(-dt * 8);
    this.hipYaw = mix(this.hipYaw, want * m, ease);
    this.legYaw = mix(this.legYaw, (dirYaw - want) * m, ease);
    const W = GAITS.walk;
    const R = GAITS.run;
    // walk <-> run blend eased in time: a stop decelerates in a few frames, the poses must not swap that fast
    // crouched it stays a (quick) walk: the run's big kick and knee drive don't fit under low cover
    this.gait = mix(this.gait, Math.max(r, smoothstep(RUN_AT[0], RUN_AT[1], ve)) * (1 - Math.min(1, 2 * cw)), 1 - Math.exp(-dt * 6));
    const g = this.gait;
    const freq = ve > 0.01 ? mix(frequency(W, ve), frequency(R, ve), g) / short : 0;
    this.phase = (((this.phase + freq * dt * (back ? -1 : 1)) % 1) + 1) % 1;
    const duty = mix(W.duty, R.duty, g);
    const ampW = amplitude(W, ve);
    const ampR = amplitude(R, ve);
    let wSum = 0;
    let dSum = 0;
    for (const side of SIDES) {
      const u = side === 'Left' ? this.phase : (this.phase + 0.5) % 1;
      const L = this.legs[side];
      sampleCyclic(W.legs, u, _pw);
      sampleCyclic(R.legs, u, _pr);
      L.thigh = mix(_pw[0] * ampW, _pr[0] * ampR, g) * m;
      L.knee = mix(_pw[1] * mix(1, ampW, 0.5), _pr[1] * mix(1, ampR, 0.5), g) * m;
      L.pitch = mix(_pw[2] * ampW, _pr[2] * ampR, g) * m;
      setX(B[side + 'UpLeg'], L.thigh);
      B[side + 'UpLeg'].rotation.y = this.legYaw;
      setX(B[side + 'Leg'], L.knee);
      // stance weight: ramps in after heel strike and out before toe off
      L.stance = u < duty ? Math.min(1, u / 0.05) * Math.min(1, (duty - u) / 0.12) : 0;
      // how much shorter this leg is than straight: the hips sink by that on the supporting leg
      wSum += L.stance;
      // (less the heel lift: late in stance the foot is up on its toes, which carries the ankle higher)
      dSum += L.stance * (LEG_REST - ankleDown(L.thigh, L.knee) - FOOT * Math.sin(Math.max(0, L.pitch)));
    }
    if (wSum > 0.05) this.drop = mix(this.drop, dSum / wSum, 1 - Math.exp(-dt * 25));
    sampleCyclic(W.hips, (this.phase * 2) % 1, _pw);
    sampleCyclic(R.hips, (this.phase * 2) % 1, _pr);
    const bob = mix(_pw[0], _pr[0], g) * m;
    const hipsPitch = mix(_pw[1], _pr[1], g) * m;
    // left leg forward -> -1 (drives hips twist and the arm swing)
    const sw = -Math.cos(this.phase * Math.PI * 2);
    const amt = Math.min(1, ve / 4) * (1 - c);
    // flight (running: both feet off the ground between one toe-off and the next heel strike): the body rises
    // and falls on an arc instead of staying sunk on the last support leg
    // the rise starts as the back foot peels off (stance taper) and settles just after the next heel strike,
    // so it spans a good part of the step instead of popping up over the few frames of pure flight
    let arc = 0;
    if (duty < 0.5) {
      const from = duty - FLIGHT_LEAD;
      const fl = ((((this.phase % 0.5) - from) % 0.5) + 0.5) % 0.5 / (0.5 - from + FLIGHT_TAIL);
      if (fl < 1) arc = Math.sin(Math.PI * fl) ** 2 * FLIGHT * g * Math.min(1, ve / R.ref) * m;
    }
    // hips height through a critically damped spring: gait blends, starts, stops and crouching never step it
    const hy = -CROUCH_DROP * c - this.drop * m + bob + arc;
    const x = this.hipsY - hy;
    const e = Math.exp(-HIPS_SPRING * dt);
    const k = (this.hipsYV + HIPS_SPRING * x) * dt;
    this.hipsY = hy + (x + k) * e;
    this.hipsYV = (this.hipsYV - HIPS_SPRING * k) * e;
    B.Hips.position.y += this.hipsY;
    const twist = sw * mix(mix(W.twist, R.twist, g), RUN.twist, r) * m;
    B.Hips.rotation.set(hipsPitch + RUN.hipsLean * r * amt, this.hipYaw + twist, -sw * mix(W.roll, R.roll, g) * m);

    // ----- torso -----
    const kk = 1 - Math.exp(-dt * 14);
    const running = r * amt;
    const aim = s.combat ? s.aimPitch : mix(-0.5, -0.95, Math.max(r, hu));
    // hunch (moving along cover): chest folds forward over raised hips, the head stays up and looks ahead
    this.spinePitch = mix(this.spinePitch, -aim * 0.3 * (1 - running) + RUN.lean * running + 0.08 * g * amt * (1 - r) + c * 0.15 * (1 - hu) + HUNCH * hu, kk);
    this.weaponPitch = mix(this.weaponPitch, -aim * 0.7 - c * 0.15, 1 - Math.exp(-dt * 22));
    const lean = (s.lean ?? 0) * 0.33;
    const sp = this.spinePitch / 3 + this.hit.x / 3;
    // the chest keeps facing where the character aims (hips yaw undone); it leans with the hips unless aiming
    B.Spine.rotation.set(sp - (s.combat ? hipsPitch : 0), -twist * 0.5 - this.hipYaw, this.hit.y / 3 + lean);
    B.Spine1.rotation.set(sp, -twist * 0.9, this.hit.y / 3 + lean); // shoulders counter-rotate
    B.Spine2.rotation.set(sp - RUN.hipsLean * running + 0.15 * hu, -twist * 0.4, this.hit.y / 3 + lean); // shoulders roll down
    // head stays level and looks where it should (at the camera while in cover)
    this.look = mix(this.look, s.lookYaw ?? 0, kk * 0.6);
    B.Neck.rotation.set(-this.spinePitch * 0.55 - RUN.hipsLean * running, this.look * 0.4 + twist * 0.3, 0);
    B.Head.rotation.set(s.combat ? 0 : 0.08, this.look * 0.6, 0);

    // ----- arms -----
    if (this.armed) {
      // mirrored hold: the gun crosses to the left shoulder pocket and the hands swap grips
      this.hand = mix(this.hand, s.leftHanded ? -1 : 1, 1 - Math.exp(-dt * 16));
      const hs = this.hand < 0 ? -1 : 1;
      B.Weapon.position.x *= this.hand;
      B.Weapon.rotation.x = this.weaponPitch + (s.lower ?? 0) * 1.1; // lowered while switching guns
      B.Weapon.rotation.z = -(s.lean ?? 0) * 0.85; // a leaning torso keeps the gun nearly level
      B.Weapon.rotation.y = ((s.combat ? 0 : mix(0.35, 0.15, r)) + (s.lower ?? 0) * 0.4) * hs;
      // the carried gun rides the steps a little and sways with the shoulders (less while aiming)
      B.Weapon.position.y += bob * 0.5;
      const sway = sw * amt * (s.combat ? 0.3 : 1);
      B.Weapon.position.x += sway * 0.012;
      B.Weapon.rotation.y += sway * 0.035;
      if (s.recoil) {
        B.Weapon.position.z -= s.recoil * (s.kickBack ?? 0.06);
        B.Weapon.rotation.x -= s.recoil * (s.kickClimb ?? 0); // muzzle climbs
      }
      // support shoulder rolls forward so the support hand reaches the handguard
      B.LeftShoulder.rotation.y = hs > 0 ? -0.6 : -0.15;
      B.RightShoulder.rotation.y = hs > 0 ? 0.15 : 0.6;
      rig.root.updateMatrixWorld(true);
      const trigger = hs > 0 ? 'Right' : 'Left';
      const support = hs > 0 ? 'Left' : 'Right';
      if (rig.sockets.gripR) this.#armIK(trigger, rig.sockets.gripR, trigger === 'Right' ? -1 : 1);
      if (rig.sockets.gripL) this.#armIK(support, rig.sockets.gripL, support === 'Right' ? -1 : 1);
      // running: the left hand lets go of the gun and pumps, anime style
      const pump = r * amt * (s.combat ? 0 : 1) * (hs > 0 ? 1 : 0);
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

    // ----- legs: planted feet locked in place (IK), kneel blended over everything -----
    const rootQ = rig.root.getWorldQuaternion(_q2);
    const baseQ = _q3.setFromAxisAngle(_yAxis, this.hipYaw + this.legYaw).premultiply(rootQ); // where the legs walk
    const pole = _knee.set(0, 0.15, 1).applyQuaternion(baseQ); // knees forward
    const rootY = rig.root.getWorldPosition(_a).y;
    const lift = CROUCH_DROP * c * mv;
    for (const side of SIDES) {
      const L = this.legs[side];
      const foot = B[side + 'Foot'];
      const fk = foot.getWorldPosition(_b);
      const floor = this.ground ? this.ground(fk.x, fk.z, rootY + 0.6) : rootY;
      // lowered hips (crouch-walk): the feet follow the gait as if the hips were up, the knees fold to reach
      fk.y = Math.max(fk.y + lift, floor + ANKLE);
      if (L.stance <= 0 || m < 0.002) {
        L.locked = L.released = false;
        L.lw = 0;
        if (lift > 0.001 && m > 0.01) twoBone(B[side + 'UpLeg'], B[side + 'Leg'], foot, fk, pole);
        continue;
      }
      if (!L.locked && !L.released) {
        L.locked = true;
        L.lw = 1;
        L.lock.set(fk.x, floor, fk.z);
      }
      if (L.locked && Math.hypot(fk.x - L.lock.x, fk.z - L.lock.z) > LOCK_RELEASE) {
        L.locked = false;
        L.released = true; // re-plants next step
      }
      // the locks fade out with the gait on a stop (no snap when the last one lets go)
      const st = L.stance * Math.min(1, m / 0.25);
      if (!L.locked) L.lw = Math.max(0, L.lw - dt * 8); // a released lock lets go over ~0.12 s
      const w = L.lw * st;
      const heelUp = FOOT * Math.sin(Math.max(0, L.pitch)); // rolling onto the toes lifts the ankle
      _c.set(mix(fk.x, L.lock.x, w), mix(fk.y, floor + ANKLE + heelUp, st), mix(fk.z, L.lock.z, w));
      twoBone(B[side + 'UpLeg'], B[side + 'Leg'], foot, _c, pole);
    }
    if (ck > 0.001) {
      for (const side of SIDES) {
        const kneel = side === 'Left' ? KNEEL_L : KNEEL_R;
        blendTo(B[side + 'UpLeg'], kneel[0], 0, 0, ck);
        blendTo(B[side + 'Leg'], kneel[1], 0, 0, ck);
        setX(B[side + 'ToeBase'], kneel[2] * ck);
      }
    }
    // vault over low cover: a tucked jump, or a slide across the top on the hip (legs forward, leaning back)
    const vw = s.vault ? smoothstep(0, 0.22, s.vaultT) * (1 - smoothstep(0.78, 1, s.vaultT)) : 0;
    // slide aiming (s.slideAim, s.aimTwist): the chest ignores the hips' pose and turns by aimTwist toward the camera
    const sa = (this.slideAim = mix(this.slideAim ?? 0, s.slideAim ?? 0, kk));
    _hq.copy(B.Hips.quaternion);
    if (vw > 0.001) {
      const P = VAULT_POSE[s.vault];
      blendTo(B.LeftUpLeg, P.legs[0], 0, 0, vw);
      blendTo(B.LeftLeg, P.legs[1], 0, 0, vw);
      blendTo(B.RightUpLeg, P.legs[2], 0, 0, vw);
      blendTo(B.RightLeg, P.legs[3], 0, 0, vw);
      B.Hips.rotation.x += P.hips[0] * vw;
      B.Hips.rotation.z += P.hips[1] * vw;
      B.Hips.position.y += P.hips[2] * vw;
      B.Spine1.rotation.x += P.spine * vw * (1 - sa); // (the lean-back would tilt the gun)
      B.Spine2.rotation.x += P.spine * vw * (1 - sa);
    }
    if (sa > 0.001) {
      // Spine2 keeps the world rotation it had before the hips took the pose (so the gun follows aimPitch as in
      // normal combat) plus a yaw twist; the correction is shared over the three spine bones, the last one fixes
      // the small residual so the chest lands exactly on target.
      _tq.setFromAxisAngle(_yAxis, s.aimTwist ?? 0).multiply(_hq); // twist (about the root's up) * hips before the pose
      _uq.copy(B.Hips.quaternion).invert().multiply(_tq); // correction in the hips frame
      _tq.identity().slerp(_uq, sa);
      _wq.copy(B.Hips.quaternion).multiply(_tq).multiply(B.Spine.quaternion).multiply(B.Spine1.quaternion).multiply(B.Spine2.quaternion);
      _uq.identity().slerp(_tq, 1 / 3);
      B.Spine.quaternion.premultiply(_uq);
      B.Spine1.quaternion.premultiply(_uq);
      B.Spine2.quaternion.premultiply(_uq);
      B.Spine2.quaternion.copy(_tq.copy(B.Hips.quaternion).multiply(B.Spine.quaternion).multiply(B.Spine1.quaternion).invert().multiply(_wq));
    }
    // jetpack burst: knees bent, hips forward; the feet are not planted (no foot IK) while it shows
    if (aw > 0.001) {
      blendTo(B.LeftUpLeg, AIR_POSE.legs[0], 0, 0, aw);
      blendTo(B.LeftLeg, AIR_POSE.legs[1], 0, 0, aw);
      blendTo(B.RightUpLeg, AIR_POSE.legs[2], 0, 0, aw);
      blendTo(B.RightLeg, AIR_POSE.legs[3], 0, 0, aw);
      B.Hips.rotation.x += AIR_POSE.hips * aw;
    }
    rig.root.updateMatrixWorld(true);

    if (this.ground && vw < 0.05 && aw < 0.05) this.#feetIK(dt, ck);
    this.#orientFeet(baseQ, (1 - ck) * (1 - aw));
  }

  // Feet keep the pose's pitch relative to the hips' walking direction (flat when planted), not the shin's.
  #orientFeet(baseQ, w) {
    if (w <= 0.01) return;
    const B = this.rig.bones;
    for (const side of SIDES) {
      const foot = B[side + 'Foot'];
      _q.copy(foot.parent.getWorldQuaternion(_fq).invert()).multiply(baseQ);
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
    for (const side of SIDES) {
      const t = targets[side];
      const foot = B[side + 'Foot'];
      const now = foot.getWorldPosition(_b);
      const goal = _c.set(now.x, mix(now.y, t.ty, w), now.z);
      // bend in the plane the pose already bends in (a sprint's heel kick has the foot behind and above the knee:
      // forcing "knees forward" there swings the leg out sideways); a nearly straight leg: knees forward
      const hip = B[side + 'UpLeg'].getWorldPosition(_a);
      const axis = _e.copy(now).sub(hip).normalize();
      const pole = B[side + 'Leg'].getWorldPosition(_knee).sub(hip);
      pole.addScaledVector(axis, -pole.dot(axis));
      if (pole.lengthSq() < 0.03 * 0.03) pole.set(0, 0.15, 1).applyQuaternion(rootQ);
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
