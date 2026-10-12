import * as THREE from 'three';
import { Rig, Animator } from './rig.js';
import { GUNS } from '../combat/guns.js';
import { buildSoldier } from './soldier.js';
import { damp, wrapAngle } from '../../engine/math.js';
import { RigidSkin, mergeGroup } from '../../engine/batch.js';

const STEP = { run: false, raised: false }; // player:step payload (reused)

// The player's presentation: model (skeleton, soldier parts, guns, skin), animation and the pose of the root.
// Reads the motor's public state (pos, vel, facing, cover, snap...); the motor never touches a mesh.
// `tune`: { vault: VAULT, peek: PEEK } from player.js (slide twist / tail, peek shift / lean).
export class PlayerView {
  constructor({ scene, world, events, player, tune }) {
    this.player = player;
    this.tune = tune;
    this.recoil = 0; // visual gun kick 0..1 (camera recoil is separate)
    this.kickDef = null;
    this.muzzle = null;
    this.animDt = 0; // time of the substeps since the last pose(), see pose()
    this.animState = { // pose input of the last substep (reused)
      speed: 0, run: false, crouch: 0, aimPitch: 0, combat: false, recoil: 0, kickBack: 0, kickClimb: 0, lean: 0, leftHanded: false,
      lookYaw: 0, hunch: 0, air: 0, vault: null, vaultT: 0, lower: 0, slideAim: 0, aimTwist: 0, vel: player.vel, yaw: 0,
    };

    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const rig = new Rig({ dummy: false });
    const M = buildSoldier(rig);
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.6, roughness: 0.4 });

    // every gun model hangs on the Weapon bone; only the equipped one is visible
    const gunMats = { gun: gunMat, plate: M.armor, glow: M.glow, glowHot: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a2a, emissiveIntensity: 2.5 }) };
    this.gunModels = {};
    for (const [id, def] of Object.entries(GUNS)) {
      const g = mergeGroup(def.build(gunMats, box)); // one draw per material per gun
      g.visible = false;
      g.userData.gun = true;
      rig.attach('Weapon', g);
      this.gunModels[id] = g;
    }
    // ~100 soldier parts -> one skinned draw per material; guns stay separate (visibility per gun)
    this.skin = new RigidSkin(rig.root, rig.skeleton, { exclude: (o) => o.userData.gun });

    scene.add(rig.root);
    this.rigModel = rig;
    this.root = rig.root;
    this.animator = new Animator(rig, { armed: true, ground: (x, z, maxY) => world.groundAt(x, z, maxY) });
    this.animator.onStep = () => {
      if (player.airborne || player.dead) return;
      STEP.run = player.sprinting;
      STEP.raised = player.pos.y > 0.1; // on the platform, its stairs or a block (the floor is at 0)
      events.emit('player:step', STEP);
    };
  }

  // Show the gun and move hand/muzzle sockets to it.
  setGun(id) {
    const def = GUNS[id];
    for (const [k, g] of Object.entries(this.gunModels)) g.visible = k === id;
    const s = def.sockets;
    this.rigModel.socket('Weapon', 'gripR', ...s.gripR);
    this.rigModel.socket('Weapon', 'gripL', ...s.gripL);
    this.muzzle = this.rigModel.socket('Weapon', 'muzzle', ...s.muzzle);
  }

  // Visual gun kick on the model (per-gun back / climb); camera recoil is separate.
  kick(def) {
    this.recoil = 1;
    this.kickDef = def;
  }

  reset() {
    this.recoil = 0;
  }

  // Poses the rig once per frame (late phase) with the time of all the substeps since the last pose.
  pose() {
    if (this.animDt <= 0) return;
    this.animator.update(this.animDt, this.animState);
    this.animDt = 0;
  }

  // Once per simulation substep, after the motor moved: records the pose input and places the root.
  // camRig: the camera rig (yaw / pitch / peekSide / shoulder / camera); alive: 0 / 1; weaponLower: 0..1 while switching guns.
  sample(dt, camRig, alive, weaponLower = 0) {
    const p = this.player;
    const { vault: V, peek: PEEK } = this.tune;
    const moving = p.coverMoving();
    const combat = p.aiming || p.lastShot < 0.6;
    this.recoil = Math.max(0, this.recoil - dt * 11);
    // in cover with the back to the wall, the head turns to the camera
    let lookYaw = 0;
    if (p.cover && !combat && !moving && alive) {
      const c = camRig.camera.position;
      const a = Math.atan2(c.x - p.pos.x, c.z - p.pos.z) - p.facing;
      lookYaw = THREE.MathUtils.clamp(wrapAngle(a), -1.2, 1.2);
    }
    // sliding over cover and shooting: hips stay on the slide yaw, the chest turns toward where the camera aims
    const slideAim = combat && alive && (p.isSliding() || p.slideTail < V.tail);
    const aimTwist = slideAim ? THREE.MathUtils.clamp(wrapAngle(camRig.yaw + Math.PI - p.facing), -V.twist, V.twist) : 0;
    this.animDt += dt; // posed once per frame by pose() (late phase), from the state of the last substep
    const st = this.animState;
    st.speed = alive ? Math.hypot(p.vel.x, p.vel.z) : 0;
    st.run = p.sprinting && alive; // sprint plays the anime run
    st.crouch = p.crouchBlend;
    st.aimPitch = camRig.pitch;
    st.combat = combat && alive;
    st.recoil = this.recoil * this.recoil; // eased: sharp snap back, quick settle
    st.kickBack = this.kickDef?.back;
    st.kickClimb = this.kickDef?.climb;
    st.lean = (camRig.peekSide || camRig.shoulder) * PEEK.lean * Math.min(1, p.peek.length() / PEEK.shift);
    st.leftHanded = camRig.peekSide < 0 && alive; // peeking a left corner: the gun comes around on the left
    st.lookYaw = lookYaw;
    st.hunch = moving && alive ? 1 : 0; // head ahead, shoulders down, gun low
    st.air = p.airborne && alive ? 1 : 0;
    st.vault = p.snap?.vault ?? null;
    st.vaultT = p.snap?.t ?? 0;
    st.lower = weaponLower;
    st.slideAim = slideAim ? 1 : 0;
    st.aimTwist = aimTwist;
    st.yaw = p.facing;

    this.root.position.copy(p.visualPos());
    if (alive) {
      this.root.rotation.set(0, p.facing, 0);
    } else {
      this.root.rotation.z = THREE.MathUtils.lerp(this.root.rotation.z, Math.PI / 2, damp(12, dt) * 0.5);
      this.root.position.y += 0.25;
    }
    this.root.updateMatrixWorld(true);
  }
}
