import * as THREE from 'three';

// Over-the-shoulder third-person camera: collision, aim zoom and "juice"
// (smoothed follow, trauma shake, FOV punch, strafe roll, recoil recovery, landing dip, sprint bob).
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _q = new THREE.Quaternion();

const TUNING = {
  sens: 0.0022,
  aimSens: 0.0013,
  followXZ: 22, // pivot follow stiffness (higher = tighter)
  followY: 10,
  maxShakeYaw: 0.05,
  maxShakePitch: 0.04,
  maxShakeRoll: 0.06,
  maxShakePos: 0.12,
  traumaDecay: 1.6,
  recoilRecover: 0.9, // fraction of recoil pitch given back
  recoilRecoverRate: 5,
  dist: { normal: 3.4, aim: 1.9, sprint: 3.9 },
  fov: { normal: 70, aim: 50, sprint: 78 },
  bob: { walk: 0.015, sprint: 0.05 },
};

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.t = TUNING;
    this.yaw = 0;
    this.pitch = -0.08;
    this.shoulder = 1; // 1 = right shoulder, -1 = left
    this.side = 0.85;
    this.dist = 3.4;
    this.height = 1.6;
    this.fov = 70;
    this.pivot = new THREE.Vector3();
    this.smoothPivot = null;
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.trauma = 0;
    this.time = 0;
    this.fovKick = 0;
    this.roll = 0;
    this.recoilDebt = 0;
    this.dipY = 0;
    this.dipV = 0;
    this.bob = 0;
  }

  addTrauma(a) {
    this.trauma = Math.min(1, this.trauma + a);
  }

  punch(fov) {
    this.fovKick = Math.min(8, this.fovKick + fov);
  }

  dip(v) {
    this.dipV -= v;
  }

  look(dx, dy, aiming) {
    const sens = aiming ? this.t.aimSens : this.t.sens;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    // player pulling down counts as recoil compensation
    if (dy > 0) this.recoilDebt = Math.max(0, this.recoilDebt - dy * sens);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.25, 1.1);
  }

  // Aim assist: slows the look near a target (friction) and eases toward it (magnetism).
  // targets: world points (puppet chest/head). Returns the friction multiplier for this frame's look.
  assist(dt, targets, strength) {
    const camPos = this.camera.position;
    let best = null;
    let bestAng = 0.09 * strength;
    for (const p of targets) {
      const d = _dir.copy(p).sub(camPos);
      const dist = d.length();
      if (dist > 70) continue;
      const ang = d.divideScalar(dist).angleTo(this.forward);
      if (ang < bestAng) {
        bestAng = ang;
        best = p;
      }
    }
    if (!best) return 1;
    const d = _dir.copy(best).sub(camPos).normalize();
    const wantYaw = Math.atan2(-d.x, -d.z);
    const wantPitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    let dy = wantYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const pull = 1 - Math.exp(-dt * 2.5 * strength);
    this.yaw += dy * pull;
    this.pitch += (wantPitch - this.pitch) * pull;
    return 1 - 0.45 * Math.min(1, strength);
  }

  kick(pitch, yaw, trauma = 0.06) {
    this.pitch = Math.min(1.1, this.pitch + pitch);
    this.yaw += yaw;
    this.recoilDebt += pitch * this.t.recoilRecover;
    this.addTrauma(trauma);
    this.punch(0.9);
  }

  update(dt, player, realDt = dt) {
    const t = this.t;
    const aiming = player.aiming;
    this.time += realDt;
    const k = 1 - Math.exp(-dt * 12);

    // recoil recovery
    if (this.recoilDebt > 0 && player.lastShot > 0.08) {
      const r = Math.min(this.recoilDebt, this.recoilDebt * t.recoilRecoverRate * dt + 0.0005);
      this.pitch -= r;
      this.recoilDebt -= r;
    }

    const targetSide = (aiming ? 0.95 : 0.85) * this.shoulder;
    this.side += (targetSide - this.side) * k;
    const mode = aiming ? 'aim' : player.sprinting ? 'sprint' : 'normal';
    this.dist += (t.dist[mode] - this.dist) * k;
    this.height += (player.eyeHeight() - this.height) * k;
    this.fovKick = Math.max(0, this.fovKick - dt * 30);
    this.fov += (t.fov[mode] - this.fov) * (1 - Math.exp(-dt * 8));

    // strafe roll + sprint bob
    const v = player.vel;
    const strafe = v.x * Math.cos(this.yaw) - v.z * Math.sin(this.yaw);
    this.roll += (-strafe * 0.004 - this.roll) * (1 - Math.exp(-dt * 6));
    const speed = Math.hypot(v.x, v.z);
    this.bob += dt * speed * 2.2;
    const bobAmt = player.sprinting ? t.bob.sprint : speed > 0.5 && !aiming ? t.bob.walk : 0;

    // landing dip spring
    this.dipV += (-this.dipY * 140 - this.dipV * 14) * dt;
    this.dipY += this.dipV * dt;

    _euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(_euler);
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    // smoothed pivot (target is the player's head)
    const target = _v.copy(player.visualPos());
    target.y += this.height;
    if (!this.smoothPivot || this.smoothPivot.distanceTo(target) > 6) this.smoothPivot = target.clone();
    const kx = 1 - Math.exp(-dt * t.followXZ);
    const ky = 1 - Math.exp(-dt * t.followY);
    this.smoothPivot.x += (target.x - this.smoothPivot.x) * kx;
    this.smoothPivot.z += (target.z - this.smoothPivot.z) * kx;
    this.smoothPivot.y += (target.y - this.smoothPivot.y) * ky;
    this.pivot.copy(this.smoothPivot);
    this.pivot.y += this.dipY + Math.abs(Math.sin(this.bob)) * bobAmt;

    const desired = _v.copy(this.pivot).addScaledVector(this.right, this.side);
    desired.y += 0.15;
    desired.addScaledVector(this.forward, -this.dist);

    // pull in on collision
    _dir.copy(desired).sub(this.pivot);
    const len = _dir.length();
    _dir.divideScalar(len);
    _ray.set(this.pivot, _dir);
    _ray.far = len + 0.25;
    const hit = _ray.intersectObjects(this.world.meshes, false)[0];
    if (hit) desired.copy(this.pivot).addScaledVector(_dir, Math.max(0.2, hit.distance - 0.25));
    this.camera.position.copy(desired);

    // trauma shake (visual only: aim uses this.forward computed above)
    this.trauma = Math.max(0, this.trauma - dt * t.traumaDecay);
    const s = this.trauma * this.trauma;
    const n = (f, o) => Math.sin(this.time * f + o) * 0.6 + Math.sin(this.time * f * 2.3 + o * 1.7) * 0.4;
    if (s > 0) {
      this.camera.position.addScaledVector(this.right, n(31, 1) * s * t.maxShakePos);
      this.camera.position.y += n(29, 4) * s * t.maxShakePos;
    }
    _euler.set(n(37, 2) * s * t.maxShakePitch, n(33, 7) * s * t.maxShakeYaw, n(23, 3) * s * t.maxShakeRoll + this.roll);
    this.camera.quaternion.multiply(_q.setFromEuler(_euler));

    const fov = this.fov + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  flatForward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  flatRight(out) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
}
