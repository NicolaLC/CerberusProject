import * as THREE from 'three';
import { rb, cyl, cap, look } from './parts.js';

// Humanoid enemy looks, in the player soldier's style (soldier.js): rounded plates, cylinders and capsules per
// bone over a mechanical frame, a few HDR glows. Visual only (`look`): hits use the rig's invisible dummy boxes.
// Bone-local axes: +Z forward, +X the character's left, limbs hang along -Y. Weak spots sit on the dummy boxes'
// front faces, so keep limb fronts roughly within them (see EnemyBody).

const std = (color, roughness, metalness) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const R = Math.PI / 2;
const SIDES = [['Left', 1], ['Right', -1]];

// ---------------- trooper: hostile assault robot (gunmetal frame, slate armor, red faction plates) ----------------

export function trooperMaterials() {
  return {
    frame: std(0x24272d, 0.5, 0.55), // dark gunmetal frame, joints, pistons
    armor: std(0x4a5260, 0.5, 0.35), // slate armor plates
    plate: std(0x8f2a24, 0.5, 0.3), // red faction plates and stripes (also the rifle's furniture)
  };
}

// visor: the glowing material (optics, LEDs) that flares as the trooper aims.
export function buildTrooper(rig, M, visor) {
  const L = (bone, ...children) => rig.attach(bone, look(...children));

  L(
    'Hips',
    rb(M.frame, 0.3, 0.16, 0.2, 0.05, 0, -0.03, 0), // pelvis frame
    rb(M.armor, 0.36, 0.05, 0.25, 0.02, 0, 0.04, 0), // belt ring
    rb(M.plate, 0.15, 0.14, 0.05, 0.02, 0, -0.06, 0.105, -0.12), // groin plate
    rb(M.frame, 0.1, 0.015, 0.01, 0.005, 0, -0.02, 0.132, -0.12),
    rb(M.armor, 0.06, 0.2, 0.17, 0.025, 0.19, -0.07, 0, 0, 0, 0.12), // tassets
    rb(M.armor, 0.06, 0.2, 0.17, 0.025, -0.19, -0.07, 0, 0, 0, -0.12),
    rb(M.frame, 0.18, 0.09, 0.08, 0.02, 0, -0.01, -0.13), // rear power cell
  );
  L(
    'Spine',
    cyl(M.frame, 0.11, 0.12, 0.15, 0, 0.06, 0), // waist actuator
    cyl(M.plate, 0.122, 0.122, 0.015, 0, 0.0, 0),
    cyl(M.frame, 0.018, 0.018, 0.16, 0.13, 0.06, 0.02, 0, 0, 0, 8), // side pistons
    cyl(M.frame, 0.018, 0.018, 0.16, -0.13, 0.06, 0.02, 0, 0, 0, 8),
    rb(M.armor, 0.2, 0.07, 0.05, 0.02, 0, 0.05, 0.1), // ab plate
  );
  L(
    'Spine1',
    rb(M.frame, 0.33, 0.15, 0.22, 0.06, 0, 0.07, 0),
    rb(M.armor, 0.26, 0.06, 0.06, 0.02, 0, 0.04, 0.11), // segmented ab plates
    rb(M.armor, 0.3, 0.06, 0.06, 0.02, 0, 0.11, 0.115),
    rb(M.armor, 0.36, 0.1, 0.2, 0.03, 0, 0.08, -0.03), // flank armor
  );
  L(
    'Spine2',
    rb(M.frame, 0.4, 0.28, 0.24, 0.07, 0, 0.11, -0.01), // torso frame
    rb(M.armor, 0.42, 0.27, 0.08, 0.035, 0, 0.13, 0.11, -0.08), // breastplate
    rb(M.plate, 0.05, 0.16, 0.012, 0.005, 0.07, 0.13, 0.155, -0.08, 0, 0.45), // red chevron
    rb(M.plate, 0.05, 0.16, 0.012, 0.005, -0.07, 0.13, 0.155, -0.08, 0, -0.45),
    rb(M.frame, 0.12, 0.05, 0.02, 0.01, 0, 0.03, 0.153), // chest vent
    rb(visor, 0.08, 0.012, 0.006, 0.003, 0, 0.03, 0.165),
    rb(M.armor, 0.32, 0.07, 0.22, 0.025, 0, 0.27, -0.01), // collar
    rb(M.armor, 0.4, 0.28, 0.07, 0.03, 0, 0.12, -0.14), // back plate
  );
  // back: power pack with twin exhausts and a stub antenna
  rig.attach(
    'Spine2',
    look(
      rb(M.frame, 0.28, 0.24, 0.1, 0.03, 0, 0.13, -0.21),
      rb(M.plate, 0.29, 0.04, 0.11, 0.01, 0, 0.21, -0.21),
      cyl(M.frame, 0.035, 0.03, 0.18, 0.09, 0.05, -0.27, 0, 0, 0, 10), // exhausts
      cyl(M.frame, 0.035, 0.03, 0.18, -0.09, 0.05, -0.27, 0, 0, 0, 10),
      cyl(visor, 0.024, 0.024, 0.005, 0.09, -0.037, -0.27, 0, 0, 0, 10),
      cyl(visor, 0.024, 0.024, 0.005, -0.09, -0.037, -0.27, 0, 0, 0, 10),
      cyl(M.frame, 0.006, 0.006, 0.2, 0.1, 0.33, -0.22, -0.2, 0, 0, 5),
    ),
  );
  L(
    'Neck',
    cyl(M.frame, 0.045, 0.05, 0.12, 0, 0.03, 0), // armored neck
    cyl(M.armor, 0.055, 0.055, 0.02, 0, 0.0, 0),
    cyl(M.frame, 0.07, 0.075, 0.04, 0, -0.06, 0), // neck ring
  );
  // head: an angular helmet with a red visor slit, brow ridge and a crest
  L(
    'Head',
    rb(M.armor, 0.21, 0.19, 0.23, 0.05, 0, 0.13, 0), // dome
    rb(M.frame, 0.2, 0.06, 0.06, 0.015, 0, 0.13, 0.1), // visor recess
    rb(visor, 0.18, 0.026, 0.012, 0.006, 0, 0.135, 0.128), // visor slit
    rb(M.plate, 0.22, 0.035, 0.07, 0.012, 0, 0.175, 0.09, 0.25), // brow ridge
    rb(M.armor, 0.15, 0.07, 0.08, 0.02, 0, 0.055, 0.09, -0.3), // jaw guard
    rb(M.frame, 0.1, 0.012, 0.01, 0.004, 0, 0.05, 0.135, -0.3), // grille
    rb(M.frame, 0.1, 0.012, 0.01, 0.004, 0, 0.07, 0.13, -0.3),
    cyl(M.frame, 0.045, 0.045, 0.03, 0.11, 0.12, -0.01, 0, 0, R), // ear actuators
    cyl(M.frame, 0.045, 0.045, 0.03, -0.11, 0.12, -0.01, 0, 0, R),
    cyl(visor, 0.012, 0.012, 0.006, 0.127, 0.12, -0.01, 0, 0, R),
    rb(M.plate, 0.025, 0.05, 0.17, 0.01, 0, 0.235, -0.02), // crest
  );

  for (const [side, s] of SIDES) {
    L(
      side + 'Arm',
      cap(M.frame, 0.052, 0.18, 0, -0.15, 0),
      rb(M.armor, 0.19, 0.13, 0.24, 0.05, 0.05 * s, 0.01, 0, 0, 0, 0.35 * s), // pauldron
      rb(M.plate, 0.2, 0.025, 0.25, 0.01, 0.055 * s, 0.07, 0, 0, 0, 0.35 * s), // red rim
      rb(M.armor, 0.11, 0.1, 0.12, 0.03, 0.02 * s, -0.17, 0), // bicep plate
      cyl(M.frame, 0.045, 0.045, 0.1, 0, -0.29, 0, 0, 0, R), // elbow joint
    );
    L(
      side + 'ForeArm',
      cap(M.frame, 0.046, 0.16, 0, -0.14, 0),
      rb(M.armor, 0.105, 0.18, 0.105, 0.03, 0, -0.13, 0), // vambrace
      rb(M.plate, 0.112, 0.025, 0.112, 0.008, 0, -0.06, 0), // red cuff
      rb(M.frame, 0.11, 0.02, 0.11, 0.006, 0, -0.21, 0),
    );
    L(
      side + 'Hand',
      rb(M.frame, 0.075, 0.1, 0.08, 0.02, 0, -0.045, 0),
      rb(M.armor, 0.08, 0.04, 0.03, 0.01, 0, -0.03, 0.035), // knuckle plate
      rb(M.frame, 0.028, 0.06, 0.028, 0.01, 0.035 * s, -0.04, 0.035, 0, 0, 0.3 * s),
    );
    L(
      side + 'UpLeg',
      cap(M.frame, 0.075, 0.26, 0, -0.21, 0),
      rb(M.armor, 0.15, 0.24, 0.06, 0.025, 0, -0.17, 0.065), // thigh plate
      rb(M.plate, 0.012, 0.18, 0.062, 0.004, 0.06 * s, -0.17, 0.067), // side stripe
      rb(M.armor, 0.06, 0.2, 0.14, 0.02, 0.08 * s, -0.16, -0.01), // outer plate
    );
    L(
      side + 'Leg',
      rb(M.plate, 0.12, 0.11, 0.09, 0.035, 0, -0.01, 0.065), // knee cap
      rb(M.frame, 0.09, 0.36, 0.09, 0.025, 0, -0.2, -0.01), // shin frame
      cyl(M.frame, 0.02, 0.02, 0.24, 0.055 * s, -0.22, -0.01, 0, 0, 0, 8), // hydraulic rod
      cyl(M.plate, 0.024, 0.024, 0.012, 0.055 * s, -0.16, -0.01, 0, 0, 0, 8),
      rb(M.armor, 0.12, 0.25, 0.05, 0.025, 0, -0.21, 0.055), // greave
      rb(M.armor, 0.11, 0.16, 0.06, 0.025, 0, -0.17, -0.06), // calf plate
    );
    L(
      side + 'Foot',
      cyl(M.frame, 0.04, 0.04, 0.12, 0, 0, 0, 0, 0, R), // ankle joint
      rb(M.armor, 0.15, 0.09, 0.21, 0.025, 0, -0.035, 0.02), // boot
      rb(M.frame, 0.16, 0.03, 0.22, 0.008, 0, -0.07, 0.02), // sole
      rb(M.plate, 0.05, 0.05, 0.05, 0.01, 0, -0.04, -0.09), // heel spur
    );
    L(
      side + 'ToeBase',
      rb(M.armor, 0.14, 0.055, 0.1, 0.02, 0, 0.005, 0.04),
      rb(M.frame, 0.15, 0.022, 0.11, 0.008, 0, -0.015, 0.04),
    );
  }
}

// ---------------- training puppet: crash-test mannequin robot on a pneumatic post ----------------

// color: the kind's shell color (yellow targets, red-orange shooters).
export function puppetMaterials(color) {
  return {
    shell: std(color, 0.55, 0.1), // painted shell
    frame: std(0x2a2c31, 0.5, 0.5), // black joints and frame
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
  // head: a smooth helmet with a dark visor band and hinge discs at the sides
  L(
    'Head',
    rb(M.shell, 0.21, 0.25, 0.23, 0.09, 0, 0.13, 0),
    rb(M.frame, 0.2, 0.075, 0.1, 0.03, 0, 0.14, 0.07), // visor band
    rb(visor, 0.16, 0.022, 0.01, 0.005, 0, 0.14, 0.12), // visor glow
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
