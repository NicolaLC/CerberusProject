import * as THREE from 'three';
import { rb, cyl, cap, ring, look } from './parts.js';
import { wornMaterial } from '../world/textures.js';

// Humanoid enemy looks, in the player soldier's style (soldier.js): rounded plates, cylinders and capsules per
// bone over a mechanical frame, a few HDR glows. Visual only (`look`): hits use the rig's invisible dummy boxes.
// Bone-local axes: +Z forward, +X the character's left, limbs hang along -Y. Weak spots sit on the dummy boxes'
// front faces, so keep limb fronts roughly within them (see EnemyBody).

const R = Math.PI / 2;
const SIDES = [['Left', 1], ['Right', -1]];

// ---------------- trooper: HiveMind assault robot (pale worn grey plates over a black frame, violet joint rings) ----------------
// art-style.md: the HiveMind livery after CERBERUS (cerberus-model.js): a slim humanoid, a few big plates (chest, shoulders,
// thighs, shins, helmet) leaving the black frame bare at the waist and joints, violet rings at the shoulders and hips.

// armored: the plated trooper (trooper.js `armored`): its bolted-on plates are bare dark plate steel.
export function trooperMaterials(armored = false) {
  return {
    frame: wornMaterial(0x1d1f23, { roughness: 0.55, metalness: 0.55, wear: 'metal' }), // black frame, joints, pistons
    armor: wornMaterial(0xa9aca7, { roughness: 0.78, metalness: 0.2 }), // pale worn grey plates
    plate: armored
      ? wornMaterial(0x50565c, { roughness: 0.5, metalness: 0.6, wear: 'metal' }) // bare plate steel (also the rifle's furniture)
      : wornMaterial(0x34383c, { roughness: 0.6, metalness: 0.55, wear: 'metal' }), // dark grey trim (also the rifle's furniture)
  };
}

// visor: the glowing material (optics, joint rings) that flares as the trooper aims.
// armored: bolted-on heavy plates over every body part (same materials: no extra draw calls), returned as
// { [plate group]: [look group] } (trooper.js PLATE_OF): a heavy round knocks a group off, the trooper drops the objects.
export function buildTrooper(rig, M, visor, armored = false) {
  const L = (bone, ...children) => rig.attach(bone, look(...children));
  const jointRing = (x, y, z, r) => ring(visor, r, 0.008, x, y, z, 0, R, 0); // axis X, on a joint's outer face

  L(
    'Hips',
    rb(M.frame, 0.3, 0.16, 0.2, 0.05, 0, -0.03, 0), // pelvis frame
    rb(M.armor, 0.2, 0.12, 0.06, 0.03, 0, -0.05, 0.1, -0.12), // groin plate
    rb(M.frame, 0.18, 0.09, 0.08, 0.02, 0, -0.01, -0.13), // rear power cell
  );
  L('Spine', cyl(M.frame, 0.1, 0.12, 0.16, 0, 0.06, 0)); // bare waist actuator
  L('Spine1', rb(M.frame, 0.3, 0.15, 0.2, 0.06, 0, 0.07, 0), rb(M.armor, 0.24, 0.08, 0.06, 0.03, 0, 0.1, 0.1)); // ab plate
  L(
    'Spine2',
    rb(M.frame, 0.38, 0.28, 0.22, 0.07, 0, 0.11, -0.01), // torso frame
    rb(M.armor, 0.42, 0.28, 0.1, 0.05, 0, 0.14, 0.1, -0.08), // chest plate
    rb(M.plate, 0.43, 0.02, 0.03, 0.008, 0, 0.1, 0.152, -0.08), // groove
    rb(M.armor, 0.4, 0.26, 0.08, 0.04, 0, 0.13, -0.13), // back plate
    rb(M.frame, 0.24, 0.2, 0.08, 0.03, 0, 0.12, -0.2), // power pack
    cyl(M.frame, 0.006, 0.006, 0.2, 0.1, 0.31, -0.2, -0.2, 0, 0, 5), // antenna
  );
  L('Neck', cyl(M.frame, 0.045, 0.055, 0.12, 0, 0.03, 0));
  // head: a rounded pale helmet over a dark face plate with a small uneven violet sensor cluster (never a face)
  L(
    'Head',
    rb(M.armor, 0.2, 0.2, 0.22, 0.08, 0, 0.13, -0.01), // helmet
    rb(M.frame, 0.15, 0.1, 0.04, 0.02, 0, 0.12, 0.1), // face plate
    rb(visor, 0.03, 0.022, 0.012, 0.005, 0.035, 0.14, 0.122),
    rb(visor, 0.018, 0.016, 0.012, 0.004, 0.0, 0.128, 0.122),
    rb(visor, 0.014, 0.014, 0.012, 0.004, -0.035, 0.15, 0.122),
    rb(M.plate, 0.02, 0.06, 0.16, 0.008, 0, 0.235, -0.02), // crest
  );

  for (const [side, s] of SIDES) {
    L(
      side + 'Arm',
      cap(M.frame, 0.05, 0.18, 0, -0.15, 0),
      rb(M.armor, 0.17, 0.13, 0.2, 0.06, 0.04 * s, 0.01, 0, 0, 0, 0.3 * s), // shoulder plate
      jointRing(0.105 * s, -0.02, 0, 0.045),
      cyl(M.frame, 0.045, 0.045, 0.1, 0, -0.29, 0, 0, 0, R), // elbow
    );
    L(side + 'ForeArm', cap(M.frame, 0.044, 0.16, 0, -0.14, 0), rb(M.armor, 0.1, 0.17, 0.1, 0.04, 0, -0.13, 0)); // forearm plate
    L(side + 'Hand', rb(M.frame, 0.075, 0.1, 0.08, 0.02, 0, -0.045, 0), rb(M.frame, 0.028, 0.06, 0.028, 0.01, 0.035 * s, -0.04, 0.035, 0, 0, 0.3 * s));
    L(
      side + 'UpLeg',
      cap(M.frame, 0.07, 0.26, 0, -0.21, 0),
      rb(M.armor, 0.16, 0.26, 0.15, 0.06, 0.01 * s, -0.17, 0.02), // thigh plate
      jointRing(0.085 * s, -0.03, 0, 0.05), // hip ring
    );
    L(
      side + 'Leg',
      cyl(M.frame, 0.05, 0.05, 0.1, 0, 0, 0, 0, 0, R), // knee
      rb(M.frame, 0.08, 0.36, 0.08, 0.025, 0, -0.2, -0.01), // shin frame
      rb(M.armor, 0.12, 0.28, 0.07, 0.035, 0, -0.2, 0.045), // shin plate
    );
    L(side + 'Foot', cyl(M.frame, 0.04, 0.04, 0.12, 0, 0, 0, 0, 0, R), rb(M.armor, 0.14, 0.09, 0.21, 0.035, 0, -0.035, 0.02), rb(M.frame, 0.15, 0.03, 0.22, 0.008, 0, -0.07, 0.02));
    L(side + 'ToeBase', rb(M.armor, 0.13, 0.055, 0.1, 0.025, 0, 0.005, 0.04), rb(M.frame, 0.14, 0.022, 0.11, 0.008, 0, -0.015, 0.04));
  }
  if (!armored) return null;

  // heavy plates (bare dark plate steel over the pale livery, the plated look): bulky, bolted on, the sensors left clear
  const plates = {};
  const P = (group, bone, ...children) => (plates[group] ??= []).push(L(bone, ...children));
  const bolts = (w, y, z) => [-1, 1].map((k) => cyl(M.frame, 0.012, 0.012, 0.012, k * w, y, z, R, 0, 0, 6));
  P('head', 'Head', rb(M.plate, 0.25, 0.09, 0.27, 0.04, 0, 0.21, -0.015), ...bolts(0.1, 0.2, 0.123)); // helmet shell over the dome
  P('torso', 'Spine2', rb(M.plate, 0.46, 0.3, 0.07, 0.03, 0, 0.13, 0.17, -0.08), ...bolts(0.19, 0.24, 0.2)); // chest plate
  P('torso', 'Spine1', rb(M.plate, 0.34, 0.13, 0.06, 0.02, 0, 0.08, 0.145)); // belly plate
  for (const [side, s] of SIDES) {
    const arm = side === 'Left' ? 'armL' : 'armR';
    const leg = side === 'Left' ? 'legL' : 'legR';
    P(arm, side + 'Arm', rb(M.plate, 0.27, 0.16, 0.3, 0.06, 0.07 * s, 0.04, 0, 0, 0, 0.35 * s)); // oversized pauldron
    P(arm, side + 'ForeArm', rb(M.plate, 0.13, 0.17, 0.13, 0.03, 0, -0.13, 0)); // vambrace shell
    P(leg, side + 'UpLeg', rb(M.plate, 0.18, 0.26, 0.07, 0.03, 0, -0.17, 0.085), ...bolts(0.06, -0.06, 0.12)); // thigh plate
    P(leg, side + 'Leg', rb(M.plate, 0.14, 0.27, 0.07, 0.03, 0, -0.21, 0.08)); // shin guard
  }
  return plates;
}

// ---------------- training puppet: crash-test mannequin robot on a pneumatic post ----------------

// color: the kind's shell color (calibration-frame ochre targets, darker ochre shooters): matte, scuffed paint.
export function puppetMaterials(color, armored = false) {
  return {
    shell: armored ? wornMaterial(color, { roughness: 0.5, metalness: 0.6, wear: 'metal' }) : wornMaterial(color, { roughness: 0.88, metalness: 0.08 }), // painted shell (armored: bare plate steel)
    frame: wornMaterial(0x2a2c31, { roughness: 0.55, metalness: 0.5, wear: 'metal' }), // black joints and frame
  };
}

// The bullseye hangs on the chest at z ~0.155 (puppet.js): the chest front stays behind it.
export function buildPuppet(rig, M, visor) {
  const L = (bone, ...children) => rig.attach(bone, look(...children));
  const joint = (r, x, y, z) => cyl(M.frame, r, r, r * 2.2, x, y, z, 0, 0, R, 10); // hinge drum, axis X

  L(
    'Hips',
    rb(M.shell, 0.32, 0.17, 0.21, 0.07, 0, -0.02, 0),
    rb(M.frame, 0.34, 0.03, 0.23, 0.01, 0, 0.05, 0), // waistband
    joint(0.06, 0.1, -0.1, 0), // hip drums
    joint(0.06, -0.1, -0.1, 0),
  );
  L('Spine', cyl(M.frame, 0.09, 0.1, 0.13, 0, 0.06, 0), cyl(M.shell, 0.102, 0.102, 0.02, 0, 0.06, 0));
  L('Spine1', rb(M.shell, 0.34, 0.14, 0.22, 0.06, 0, 0.07, 0), rb(M.frame, 0.35, 0.02, 0.23, 0.008, 0, 0.13, 0));
  L(
    'Spine2',
    rb(M.shell, 0.44, 0.3, 0.27, 0.08, 0, 0.12, 0), // chest shell
    rb(M.frame, 0.3, 0.26, 0.02, 0.02, 0, 0.12, 0.13), // target mount
    rb(M.frame, 0.03, 0.2, 0.02, 0.01, 0.2, 0.12, 0.13), // calibration ticks
    rb(M.frame, 0.03, 0.2, 0.02, 0.01, -0.2, 0.12, 0.13),
    rb(M.frame, 0.12, 0.06, 0.12, 0.02, 0, 0.28, 0), // neck mount
    rb(visor, 0.04, 0.012, 0.006, 0.003, 0.15, 0.03, 0.136), // status LED
  );
  L('Neck', cyl(M.frame, 0.035, 0.04, 0.12, 0, 0.03, 0, 0, 0, 0, 10));
  // head: a smooth helmet with a dark visor band, a few small sensors and hinge discs at the sides
  L(
    'Head',
    rb(M.shell, 0.21, 0.25, 0.23, 0.09, 0, 0.13, 0),
    rb(M.frame, 0.2, 0.075, 0.1, 0.03, 0, 0.14, 0.07), // visor band
    rb(visor, 0.03, 0.02, 0.01, 0.005, 0.04, 0.142, 0.12), // calibration sensors (small, uneven: no face)
    rb(visor, 0.018, 0.018, 0.01, 0.004, -0.005, 0.135, 0.12),
    rb(visor, 0.014, 0.014, 0.01, 0.004, -0.045, 0.145, 0.12),
    cyl(M.frame, 0.05, 0.05, 0.02, 0.105, 0.13, 0, 0, 0, R, 14), // hinge discs
    cyl(M.frame, 0.05, 0.05, 0.02, -0.105, 0.13, 0, 0, 0, R, 14),
    cyl(M.shell, 0.025, 0.025, 0.022, 0.106, 0.13, 0, 0, 0, R, 10),
    cyl(M.shell, 0.025, 0.025, 0.022, -0.106, 0.13, 0, 0, 0, R, 10),
  );

  for (const [side, s] of SIDES) {
    L(
      side + 'Arm',
      joint(0.065, 0.01 * s, -0.01, 0), // shoulder drum
      cyl(M.shell, 0.05, 0.045, 0.22, 0, -0.15, 0, 0, 0, 0, 12),
      joint(0.045, 0, -0.29, 0), // elbow
    );
    L(side + 'ForeArm', cyl(M.shell, 0.045, 0.04, 0.24, 0, -0.13, 0, 0, 0, 0, 12), cyl(M.frame, 0.047, 0.047, 0.02, 0, -0.04, 0, 0, 0, 0, 12));
    L(side + 'Hand', rb(M.frame, 0.07, 0.1, 0.075, 0.025, 0, -0.045, 0));
    L(
      side + 'UpLeg',
      cyl(M.shell, 0.075, 0.065, 0.34, 0, -0.2, 0, 0, 0, 0, 12),
      cyl(M.frame, 0.077, 0.077, 0.02, 0, -0.1, 0, 0, 0, 0, 12),
    );
    L(
      side + 'Leg',
      joint(0.055, 0, 0, 0), // knee
      rb(M.shell, 0.08, 0.08, 0.04, 0.02, 0, -0.01, 0.06), // kneecap
      cyl(M.shell, 0.06, 0.05, 0.32, 0, -0.2, 0, 0, 0, 0, 12),
    );
    L(side + 'Foot', rb(M.frame, 0.12, 0.08, 0.19, 0.03, 0, -0.04, 0.02));
    L(side + 'ToeBase', rb(M.frame, 0.12, 0.05, 0.09, 0.02, 0, 0, 0.04));
  }
}
