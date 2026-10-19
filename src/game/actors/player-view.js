import * as THREE from 'three';
import { Rig, Animator } from './rig.js';
import { GUNS, gunMaterials } from '../combat/guns.js';
import { buildSoldier, CORE } from './soldier.js';
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
    this.dormant = 0; // 0..1 powered-down slump (Animator layer), set by the wake-up cinematic (view/cinematic.js)
    this.animState = { // pose input of the last substep (reused)
      speed: 0, run: false, crouch: 0, aimPitch: 0, combat: false, recoil: 0, kickBack: 0, kickClimb: 0, lean: 0, leftHanded: false,
      lookYaw: 0, hunch: 0, air: 0, vault: null, vaultT: 0, lower: 0, reload: null, slideAim: 0, aimTwist: 0, vel: player.vel, yaw: 0,
    };

    const rig = new Rig({ dummy: false });
    const M = buildSoldier(rig);
    this.soldierMats = M;

    // every gun model hangs on the Weapon bone; only the equipped one is visible. Furniture: STEM-00's olive (guns.js)
    const gunMats = gunMaterials({ plate: M.armor, glow: M.glow });
    this.gunModels = {};
    for (const [id, def] of Object.entries(GUNS)) {
      const raw = def.build(gunMats);
      const mags = []; // the detachable magazine stays out of the merge: the reload layer moves it (guns.js `M`)
      raw.traverse((o) => o.userData.mag && mags.push(o));
      for (const o of mags) o.removeFromParent();
      const g = mergeGroup(raw); // one draw per material per gun
      if (mags.length) {
        const mg = new THREE.Group();
        mg.add(...mags);
        g.add(mg);
        const box = new THREE.Box3().setFromObject(mg);
        const hand = mg.clone(); // the fresh one carried by the left hand (shared geometry and materials)
        hand.visible = false;
        g.add(hand);
        g.userData.mags = { gun: mg, hand, base: new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2) };
      }
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

  // STEM-00's amber core (art-style.md): 0 = a faint ember, 1 = full will. Story progress drives it (#49).
  setCore(level) {
    const t = THREE.MathUtils.clamp(level, 0, 1);
    this.soldierMats.core.emissiveIntensity = CORE.min + (CORE.max - CORE.min) * t;
  }

  // Show the gun and move hand/muzzle sockets to it.
  // id null = unarmed: no model, no muzzle, the animator swings the arms.
  setGun(id) {
    for (const [k, g] of Object.entries(this.gunModels)) g.visible = k === id;
    this.animator.armed = !!id;
    this.animator.gun = id;
    this.animator.rl.on = false; // a reload cut short by the switch: every mag back in its gun
    for (const g of Object.values(this.gunModels)) {
      const m = g.userData.mags;
      if (m) m.gun.position.set(0, 0, 0), m.gun.rotation.set(0, 0, 0), (m.gun.visible = true), (m.hand.visible = false);
    }
    this.animator.mag = id ? this.gunModels[id].userData.mags ?? null : null;
    if (!id) {
      this.muzzle = null;
      return;
    }
    const def = GUNS[id];
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
    this.animState.dormant = this.dormant;
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
    st.aimPitch = p.aimPitch ?? camRig.pitch; // a scripted cut aims at its target
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
    st.reload = p.weapon?.reloadAnim() ?? null;
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
