import * as THREE from 'three';

// Over-the-shoulder third-person camera with collision and aim zoom.
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _ray = new THREE.Raycaster();

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = 0;
    this.pitch = -0.08;
    this.shoulder = 1; // 1 = right shoulder, -1 = left
    this.side = 0.65;
    this.dist = 3.4;
    this.height = 1.6;
    this.fov = 70;
    this.pivot = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.shake = 0;
  }

  look(dx, dy, aiming) {
    const sens = aiming ? 0.0013 : 0.0022;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.25, 1.1);
  }

  kick(pitch, yaw) {
    this.pitch = Math.min(1.1, this.pitch + pitch);
    this.yaw += yaw;
  }

  update(dt, player) {
    const aiming = player.aiming;
    const k = 1 - Math.exp(-dt * 12);
    const targetSide = (aiming ? 0.75 : 0.65) * this.shoulder;
    this.side += (targetSide - this.side) * k;
    this.dist += ((aiming ? 1.9 : player.sprinting ? 3.9 : 3.4) - this.dist) * k;
    this.height += (player.eyeHeight() - this.height) * k;
    this.fov += ((aiming ? 50 : player.sprinting ? 76 : 70) - this.fov) * k;

    _euler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(_euler);
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);

    this.pivot.copy(player.visualPos()).y += this.height;

    // desired = pivot + right*side + up*0.15 - forward*dist
    const desired = _v.copy(this.pivot).addScaledVector(this.right, this.side);
    desired.y += 0.15;
    desired.addScaledVector(this.forward, -this.dist);

    // pull in on collision
    const dir = desired.clone().sub(this.pivot);
    const len = dir.length();
    dir.divideScalar(len);
    _ray.set(this.pivot, dir);
    _ray.far = len + 0.25;
    const hit = _ray.intersectObjects(this.world.meshes, false)[0];
    if (hit) desired.copy(this.pivot).addScaledVector(dir, Math.max(0.2, hit.distance - 0.25));

    this.camera.position.copy(desired);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 0.6);
    }
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // Flattened forward/right for movement.
  flatForward(out) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  flatRight(out) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }
}
