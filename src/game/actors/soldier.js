import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Procedural military combat robot (mood: olive drab plate carrier and pads over a mechanical frame).
// Every part hangs on a rig bone (the bone is the pivot), so it moves with the body; RigidSkin batches them.
// Bone-local axes: +Z forward, +X the character's left, limbs hang along -Y.
// Swap any part for a modeled one with rig.setPart(bone, object). See instructions/animation.md.

export function soldierMaterials() {
  const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    suit: std(0x2b2d2a, 0.9, 0.05), // dark mesh fabric / sleeves
    armor: std(0x5d6849, 0.6, 0.2), // olive drab plates and hard cases
    accent: std(0x737a66, 0.95, 0.0), // padded cordura: pouches, shoulder and knee pads
    trim: std(0x18191b, 0.45, 0.65), // black metal frame, pistons, straps
    stripe: std(0xd9a21c, 0.5, 0.2), // yellow hazard rings and tags
    visor: std(0x050607, 0.05, 0.9, { emissive: 0x2a1404, emissiveIntensity: 0.5 }), // sensor lens
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa63a, emissiveIntensity: 2.2 }),
    glowRed: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3b2a, emissiveIntensity: 2.5 }),
  };
}

const geoCache = new Map();
function rbox(w, h, d, r) {
  const key = `${w}|${h}|${d}|${r}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2) - 1e-4));
  return geoCache.get(key);
}

// part(geometry, material, x, y, z, rx, ry, rz)
function part(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}

const rb = (m, w, h, d, r, x, y, z, rx, ry, rz) => part(rbox(w, h, d, r), m, x, y, z, rx, ry, rz);
const cyl = (m, rt, rbot, h, x, y, z, rx, ry, rz, seg = 12) => part(new THREE.CylinderGeometry(rt, rbot, h, seg), m, x, y, z, rx, ry, rz);
const cap = (m, r, len, x, y, z) => part(new THREE.CapsuleGeometry(r, len, 4, 10), m, x, y, z);

const group = (...children) => {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
};

export function buildSoldier(rig, M = soldierMaterials()) {
  const P = (bone, ...children) => rig.setPart(bone, group(...children));
  const R = Math.PI / 2;

  P(
    'Hips',
    rb(M.trim, 0.3, 0.16, 0.2, 0.05, 0, -0.03, 0), // pelvis frame
    rb(M.trim, 0.38, 0.05, 0.27, 0.02, 0, 0.04, 0), // war belt
    rb(M.stripe, 0.05, 0.03, 0.01, 0.005, 0, 0.04, 0.138), // buckle tag
    rb(M.armor, 0.17, 0.15, 0.06, 0.02, 0, -0.07, 0.11, -0.1), // groin case
    rb(M.trim, 0.12, 0.012, 0.01, 0.004, 0, -0.03, 0.142, -0.1),
    rb(M.glow, 0.03, 0.01, 0.006, 0.003, 0.05, -0.1, 0.143, -0.1),
    rb(M.accent, 0.08, 0.1, 0.07, 0.025, 0.14, 0.0, 0.1), // belt pouches
    rb(M.accent, 0.08, 0.1, 0.07, 0.025, -0.14, 0.0, 0.1),
    rb(M.accent, 0.2, 0.11, 0.09, 0.03, 0, 0.0, -0.16), // butt pack
    rb(M.accent, 0.05, 0.22, 0.18, 0.03, 0.21, -0.08, 0, 0, 0, 0.1), // left hip pad
    rb(M.trim, 0.055, 0.03, 0.19, 0.01, 0.215, 0.0, 0, 0, 0, 0.1),
  );
  P(
    'Spine',
    cyl(M.trim, 0.11, 0.12, 0.15, 0, 0.06, 0), // waist actuator
    cyl(M.stripe, 0.122, 0.122, 0.015, 0, 0.0, 0),
    cyl(M.trim, 0.018, 0.018, 0.16, 0.13, 0.06, 0.02, 0, 0, 0, 8), // side pistons
    cyl(M.trim, 0.018, 0.018, 0.16, -0.13, 0.06, 0.02, 0, 0, 0, 8),
    cyl(M.armor, 0.012, 0.012, 0.1, 0.13, 0.06, 0.02, 0, 0, 0, 8),
    cyl(M.armor, 0.012, 0.012, 0.1, -0.13, 0.06, 0.02, 0, 0, 0, 8),
  );
  P(
    'Spine1',
    rb(M.suit, 0.33, 0.15, 0.22, 0.06, 0, 0.07, 0),
    rb(M.accent, 0.38, 0.11, 0.26, 0.04, 0, 0.07, 0), // cummerbund
    rb(M.trim, 0.39, 0.015, 0.27, 0.007, 0, 0.1, 0),
  );
  P(
    'Spine2',
    rb(M.suit, 0.4, 0.28, 0.24, 0.07, 0, 0.11, -0.01), // torso under the carrier
    rb(M.armor, 0.36, 0.3, 0.07, 0.03, 0, 0.12, 0.12), // front plate bag
    rb(M.armor, 0.36, 0.3, 0.07, 0.03, 0, 0.12, -0.14), // back plate bag
    rb(M.accent, 0.09, 0.13, 0.07, 0.02, -0.1, 0.03, 0.18), // triple mag pouch
    rb(M.accent, 0.09, 0.13, 0.07, 0.02, 0.0, 0.03, 0.18),
    rb(M.accent, 0.09, 0.13, 0.07, 0.02, 0.1, 0.03, 0.18),
    rb(M.armor, 0.095, 0.03, 0.075, 0.01, -0.1, 0.1, 0.18), // pouch flaps
    rb(M.armor, 0.095, 0.03, 0.075, 0.01, 0.0, 0.1, 0.18),
    rb(M.armor, 0.095, 0.03, 0.075, 0.01, 0.1, 0.1, 0.18),
    rb(M.stripe, 0.012, 0.05, 0.01, 0.004, 0.06, 0.22, 0.16), // rank tags
    rb(M.stripe, 0.012, 0.05, 0.01, 0.004, 0.075, 0.22, 0.16),
    rb(M.trim, 0.06, 0.08, 0.04, 0.01, -0.12, 0.21, 0.165), // radio handset
    rb(M.trim, 0.07, 0.04, 0.32, 0.015, 0.12, 0.29, -0.01), // shoulder straps
    rb(M.trim, 0.07, 0.04, 0.32, 0.015, -0.12, 0.29, -0.01),
    rb(M.accent, 0.4, 0.08, 0.06, 0.02, 0, -0.01, 0.12), // lower band
  );
  // backpack: radio case, battery, antenna
  rig.attach(
    'Spine2',
    group(
      rb(M.armor, 0.26, 0.26, 0.1, 0.03, 0, 0.12, -0.22),
      rb(M.trim, 0.2, 0.04, 0.11, 0.01, 0, 0.27, -0.22),
      rb(M.trim, 0.04, 0.2, 0.012, 0.006, 0.08, 0.12, -0.275),
      rb(M.glow, 0.02, 0.012, 0.008, 0.004, -0.08, 0.2, -0.275),
      cyl(M.trim, 0.04, 0.04, 0.22, 0, -0.02, -0.21, 0, 0, R), // battery
      cyl(M.stripe, 0.042, 0.042, 0.015, 0.09, -0.02, -0.21, 0, 0, R),
      cyl(M.trim, 0.007, 0.007, 0.3, -0.1, 0.38, -0.24, -0.15, 0, 0, 6),
      cyl(M.glowRed, 0.012, 0.012, 0.02, -0.1, 0.53, -0.26, 0, 0, 0, 8),
    ),
  );
  // exposed robotic neck: two pistons with cables between them
  P(
    'Neck',
    cyl(M.trim, 0.018, 0.018, 0.2, 0.04, 0.04, 0, 0, 0, 0, 8),
    cyl(M.trim, 0.018, 0.018, 0.2, -0.04, 0.04, 0, 0, 0, 0, 8),
    cyl(M.stripe, 0.022, 0.022, 0.012, 0.04, 0.0, 0, 0, 0, 0, 8),
    cyl(M.stripe, 0.022, 0.022, 0.012, -0.04, 0.0, 0, 0, 0, 0, 8),
    cyl(M.suit, 0.01, 0.01, 0.2, 0, 0.04, -0.02, 0.15, 0, 0, 6),
    cyl(M.trim, 0.06, 0.07, 0.04, 0, -0.06, 0), // neck ring
  );
  // head: a boxy sensor unit, big lens in front, side module and rail on top
  P(
    'Head',
    rb(M.armor, 0.2, 0.17, 0.22, 0.03, 0, 0.12, 0.01), // main case
    rb(M.trim, 0.21, 0.04, 0.23, 0.01, 0, 0.05, 0.01), // base frame
    rb(M.trim, 0.04, 0.03, 0.18, 0.008, 0, 0.215, 0), // top rail
    rb(M.accent, 0.06, 0.12, 0.16, 0.02, 0.13, 0.13, 0.0), // side module (left)
    cyl(M.trim, 0.04, 0.04, 0.03, 0.165, 0.13, 0.02, 0, 0, R), // module dial
    cyl(M.stripe, 0.03, 0.03, 0.006, 0.182, 0.13, 0.02, 0, 0, R),
    cyl(M.trim, 0.06, 0.065, 0.08, -0.03, 0.12, 0.15, R, 0, 0), // main lens barrel
    cyl(M.visor, 0.048, 0.048, 0.01, -0.03, 0.12, 0.19, R, 0, 0),
    cyl(M.glow, 0.012, 0.012, 0.004, -0.03, 0.12, 0.196, R, 0, 0),
    cyl(M.trim, 0.022, 0.022, 0.05, 0.06, 0.17, 0.13, R, 0, 0), // secondary sensor
    cyl(M.visor, 0.016, 0.016, 0.006, 0.06, 0.17, 0.157, R, 0, 0),
    rb(M.glow, 0.03, 0.008, 0.006, 0.003, 0.06, 0.08, 0.124),
    rb(M.armor, 0.12, 0.05, 0.06, 0.015, -0.03, 0.04, 0.13, 0.4), // chin guard
    cyl(M.trim, 0.005, 0.005, 0.12, -0.09, 0.26, -0.06, -0.3, 0, 0, 5), // whip antenna
  );

  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    P(
      side + 'Arm',
      cap(M.suit, 0.055, 0.18, 0, -0.15, 0),
      rb(M.accent, 0.17, 0.12, 0.22, 0.05, 0.04 * s, 0.0, 0, 0, 0, 0.3 * s), // padded shoulder
      rb(M.accent, 0.13, 0.1, 0.2, 0.04, 0.07 * s, -0.08, 0, 0, 0, 0.15 * s),
      rb(M.trim, 0.14, 0.02, 0.21, 0.008, 0.055 * s, -0.035, 0, 0, 0, 0.25 * s), // pad strap
      ...(s < 0 ? [rb(M.stripe, 0.015, 0.06, 0.06, 0.005, -0.135, -0.07, 0.02, 0, 0, 0.15 * s)] : []), // unit patch
      cyl(M.trim, 0.045, 0.045, 0.1, 0, -0.29, 0, 0, 0, R), // elbow joint
    );
    P(
      side + 'ForeArm',
      cap(M.suit, 0.048, 0.16, 0, -0.14, 0),
      rb(M.armor, 0.11, 0.18, 0.115, 0.03, 0, -0.14, 0), // gauntlet
      rb(M.trim, 0.12, 0.025, 0.125, 0.008, 0, -0.07, 0),
      rb(M.trim, 0.12, 0.025, 0.125, 0.008, 0, -0.22, 0),
      ...(s > 0 ? [rb(M.trim, 0.05, 0.08, 0.02, 0.006, 0, -0.15, 0.065), rb(M.glow, 0.03, 0.02, 0.005, 0.003, 0, -0.14, 0.077)] : []), // wrist panel
    );
    P(
      side + 'Hand',
      rb(M.trim, 0.075, 0.1, 0.08, 0.02, 0, -0.045, 0), // robotic glove
      rb(M.armor, 0.08, 0.04, 0.03, 0.01, 0, -0.03, 0.035),
      rb(M.trim, 0.028, 0.06, 0.028, 0.01, 0.035 * s, -0.04, 0.035, 0, 0, 0.3 * s),
    );
    P(
      side + 'UpLeg',
      cap(M.suit, 0.08, 0.26, 0, -0.21, 0),
      rb(M.accent, 0.15, 0.22, 0.07, 0.03, 0, -0.17, 0.06), // thigh pad
      rb(M.trim, 0.18, 0.025, 0.19, 0.008, 0, -0.12, 0), // thigh straps
      rb(M.trim, 0.18, 0.025, 0.19, 0.008, 0, -0.26, 0),
      ...(s < 0
        ? [rb(M.armor, 0.07, 0.17, 0.12, 0.02, -0.1, -0.2, 0), rb(M.trim, 0.04, 0.06, 0.05, 0.01, -0.1, -0.08, 0.02)] // drop holster
        : [rb(M.accent, 0.06, 0.1, 0.1, 0.02, 0.1, -0.24, -0.01)]), // leg pouch
    );
    P(
      side + 'Leg',
      rb(M.accent, 0.14, 0.13, 0.1, 0.04, 0, -0.01, 0.07), // knee pad
      rb(M.trim, 0.15, 0.02, 0.12, 0.006, 0, -0.03, 0.06),
      rb(M.trim, 0.09, 0.36, 0.09, 0.025, 0, -0.2, -0.01), // shin frame
      cyl(M.trim, 0.022, 0.022, 0.24, 0.055 * s, -0.22, 0.02, 0, 0, 0, 8), // hydraulic rod
      cyl(M.armor, 0.014, 0.014, 0.12, 0.055 * s, -0.12, 0.02, 0, 0, 0, 8),
      cyl(M.stripe, 0.026, 0.026, 0.012, 0.055 * s, -0.18, 0.02, 0, 0, 0, 8),
      rb(M.armor, 0.12, 0.24, 0.05, 0.025, 0, -0.22, 0.055), // shin plate
      rb(M.suit, 0.11, 0.16, 0.07, 0.03, 0, -0.17, -0.05), // calf mesh
    );
    P(
      side + 'Foot',
      cyl(M.trim, 0.04, 0.04, 0.12, 0, 0, 0, 0, 0, R), // ankle joint
      rb(M.armor, 0.15, 0.09, 0.2, 0.025, 0, -0.035, 0.02), // armored boot
      rb(M.trim, 0.16, 0.03, 0.22, 0.008, 0, -0.07, 0.02), // sole
      rb(M.trim, 0.05, 0.05, 0.05, 0.01, 0, -0.04, -0.09), // heel spur
    );
    P(
      side + 'ToeBase',
      rb(M.armor, 0.14, 0.055, 0.1, 0.02, 0, 0.005, 0.04),
      rb(M.trim, 0.15, 0.022, 0.11, 0.008, 0, -0.015, 0.04),
    );
  }
  return M;
}
