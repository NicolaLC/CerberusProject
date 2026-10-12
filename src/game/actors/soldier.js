import * as THREE from 'three';
import { rb, cyl, cap, group } from './parts.js';
import { stencilTexture, wornMaterial } from '../world/textures.js';

// Procedural military combat robot STEM-00 (mood: olive drab plate carrier and pads over a mechanical frame).
// Every part hangs on a rig bone (the bone is the pivot), so it moves with the body; RigidSkin batches them.
// Bone-local axes: +Z forward, +X the character's left, limbs hang along -Y.
// Swap any part for a modeled one with rig.setPart(bone, object). See instructions/animation.md.

// Look (instructions/art-style.md): scratched olive drab over dark metal, stencilled serials, and one amber core on the
// chest, the only warm light on screen. No hazard yellow (yellow-ochre means enemy) and no red.
export const CORE = { min: 0.4, max: 5 }; // core emissiveIntensity from the faintest ember to full will (setCore)

export function soldierMaterials() {
  const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const marking = std(0xffffff, 0.6, 0.45, { map: stencilTexture('STEM-00') });
  marking.userData.lodColor = new THREE.Color(0x3a3d40);
  return {
    suit: wornMaterial(0x2b2d2a, { roughness: 0.95, metalness: 0.05, wear: 'fabric' }), // dark mesh fabric / sleeves
    armor: wornMaterial(0x5d6849, { roughness: 0.72, metalness: 0.2 }), // olive drab plates and hard cases, chipped
    accent: wornMaterial(0x6b7062, { roughness: 0.95, metalness: 0.0, wear: 'fabric' }), // padded cordura: pouches, pads
    trim: wornMaterial(0x18191b, { roughness: 0.5, metalness: 0.65, wear: 'metal' }), // black metal frame, pistons, straps, weld patches
    marking, // dark metal bands and tags, stencilled serial plates
    visor: std(0x050607, 0.05, 0.9, { emissive: 0x2a1404, emissiveIntensity: 0.5 }), // sensor lens
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa63a, emissiveIntensity: 2.2 }), // small amber status LEDs
    core: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb347, emissiveIntensity: 3 }), // the core: Player.setCore
  };
}

export function buildSoldier(rig, M = soldierMaterials()) {
  const P = (bone, ...children) => rig.setPart(bone, group(...children));
  const R = Math.PI / 2;

  P(
    'Hips',
    rb(M.trim, 0.3, 0.16, 0.2, 0.05, 0, -0.03, 0), // pelvis frame
    rb(M.trim, 0.38, 0.05, 0.27, 0.02, 0, 0.04, 0), // war belt
    rb(M.marking, 0.05, 0.03, 0.01, 0.005, 0, 0.04, 0.138), // buckle tag
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
    cyl(M.marking, 0.122, 0.122, 0.015, 0, 0.0, 0),
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
    rb(M.marking, 0.012, 0.05, 0.01, 0.004, 0.1, 0.22, 0.16), // rank tags
    rb(M.marking, 0.012, 0.05, 0.01, 0.004, 0.115, 0.22, 0.16),
    cyl(M.trim, 0.052, 0.058, 0.03, 0, 0.2, 0.165, Math.PI / 2, 0, 0, 14), // core housing
    cyl(M.core, 0.034, 0.034, 0.012, 0, 0.2, 0.182, Math.PI / 2, 0, 0, 14), // amber core
    rb(M.trim, 0.11, 0.07, 0.012, 0.004, 0.11, 0.17, -0.178, 0, 0, 0.15), // welded patch plate (back)
    cyl(M.trim, 0.004, 0.004, 0.12, 0.11, 0.135, -0.18, 0, 0, Math.PI / 2 + 0.15, 4), // weld bead
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
      rb(M.marking, 0.15, 0.038, 0.006, 0.002, -0.03, 0.06, -0.272), // serial plate: STEM-00
      cyl(M.trim, 0.04, 0.04, 0.22, 0, -0.02, -0.21, 0, 0, R), // battery
      cyl(M.marking, 0.042, 0.042, 0.015, 0.09, -0.02, -0.21, 0, 0, R),
      cyl(M.trim, 0.007, 0.007, 0.3, -0.1, 0.38, -0.24, -0.15, 0, 0, 6),
      cyl(M.glow, 0.012, 0.012, 0.02, -0.1, 0.53, -0.26, 0, 0, 0, 8),
    ),
  );
  // exposed robotic neck: two pistons with cables between them
  P(
    'Neck',
    cyl(M.trim, 0.018, 0.018, 0.2, 0.04, 0.04, 0, 0, 0, 0, 8),
    cyl(M.trim, 0.018, 0.018, 0.2, -0.04, 0.04, 0, 0, 0, 0, 8),
    cyl(M.marking, 0.022, 0.022, 0.012, 0.04, 0.0, 0, 0, 0, 0, 8),
    cyl(M.marking, 0.022, 0.022, 0.012, -0.04, 0.0, 0, 0, 0, 0, 8),
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
    cyl(M.marking, 0.03, 0.03, 0.006, 0.182, 0.13, 0.02, 0, 0, R),
    cyl(M.trim, 0.06, 0.065, 0.08, -0.03, 0.12, 0.15, R, 0, 0), // main lens barrel
    cyl(M.visor, 0.048, 0.048, 0.01, -0.03, 0.12, 0.19, R, 0, 0),
    cyl(M.glow, 0.012, 0.012, 0.004, -0.03, 0.12, 0.196, R, 0, 0),
    cyl(M.trim, 0.022, 0.022, 0.05, 0.06, 0.17, 0.13, R, 0, 0), // secondary sensor
    cyl(M.visor, 0.016, 0.016, 0.006, 0.06, 0.17, 0.157, R, 0, 0),
    rb(M.glow, 0.03, 0.008, 0.006, 0.003, 0.06, 0.08, 0.124),
    rb(M.armor, 0.12, 0.05, 0.06, 0.015, -0.03, 0.04, 0.13, 0.4), // chin guard
    cyl(M.trim, 0.005, 0.005, 0.12, -0.09, 0.26, -0.06, -0.3, 0, 0, 5), // whip antenna
    rb(M.trim, 0.008, 0.065, 0.09, 0.003, -0.102, 0.15, -0.04), // repaired side: welded patch
    cyl(M.trim, 0.004, 0.004, 0.1, -0.104, 0.115, -0.04, Math.PI / 2, 0, 0, 4), // weld bead
  );

  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    P(
      side + 'Arm',
      cap(M.suit, 0.055, 0.18, 0, -0.15, 0),
      rb(M.accent, 0.17, 0.12, 0.22, 0.05, 0.04 * s, 0.0, 0, 0, 0, 0.3 * s), // padded shoulder
      rb(M.accent, 0.13, 0.1, 0.2, 0.04, 0.07 * s, -0.08, 0, 0, 0, 0.15 * s),
      rb(M.trim, 0.14, 0.02, 0.21, 0.008, 0.055 * s, -0.035, 0, 0, 0, 0.25 * s), // pad strap
      ...(s < 0 ? [rb(M.marking, 0.012, 0.034, 0.12, 0.003, -0.137, -0.07, 0.01, 0, 0, 0.15 * s)] : []), // serial patch
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
      cyl(M.marking, 0.026, 0.026, 0.012, 0.055 * s, -0.18, 0.02, 0, 0, 0, 8),
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
