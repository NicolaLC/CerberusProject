import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Procedural sci-fi soldier: armored parts built around each rig bone (the bone is the pivot).
// Bone-local axes: +Z forward, +X the character's left, limbs hang along -Y.
// Swap any part for a modeled one with rig.setPart(bone, object). See instructions/animation.md.

export function soldierMaterials() {
  const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    suit: std(0x363b44, 0.85, 0.05), // undersuit fabric
    armor: std(0x6a7380, 0.45, 0.25), // gunmetal plates (low metalness: there is no env map)
    accent: std(0xd3d6db, 0.45, 0.1), // light ceramic plates
    trim: std(0x262a31, 0.6, 0.2),
    stripe: std(0xb3232a, 0.5, 0.15),
    visor: std(0x0a1418, 0.08, 0.9, { emissive: 0x1e8fc8, emissiveIntensity: 0.55 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d8ff, emissiveIntensity: 2.2 }),
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

  P(
    'Hips',
    rb(M.suit, 0.34, 0.18, 0.23, 0.06, 0, -0.03, 0),
    rb(M.trim, 0.38, 0.06, 0.27, 0.025, 0, 0.04, 0), // belt
    rb(M.armor, 0.06, 0.04, 0.02, 0.01, 0, 0.04, 0.14), // buckle
    rb(M.glow, 0.03, 0.012, 0.01, 0.004, 0, 0.04, 0.152),
    rb(M.armor, 0.15, 0.13, 0.04, 0.02, 0, -0.06, 0.12, -0.12), // front plate
    rb(M.accent, 0.04, 0.17, 0.17, 0.02, 0.2, -0.07, 0, 0, 0, 0.12), // tassets
    rb(M.accent, 0.04, 0.17, 0.17, 0.02, -0.2, -0.07, 0, 0, 0, -0.12),
    rb(M.armor, 0.09, 0.08, 0.06, 0.02, 0.12, 0.02, -0.14), // pouches
    rb(M.armor, 0.09, 0.08, 0.06, 0.02, -0.12, 0.02, -0.14),
  );
  P(
    'Spine',
    rb(M.suit, 0.31, 0.15, 0.2, 0.06, 0, 0.06, 0),
    rb(M.armor, 0.2, 0.05, 0.04, 0.015, 0, 0.03, 0.1, 0.1), // ab bands
    rb(M.armor, 0.22, 0.05, 0.04, 0.015, 0, 0.09, 0.1, 0.05),
  );
  P(
    'Spine1',
    rb(M.suit, 0.37, 0.16, 0.23, 0.07, 0, 0.07, 0),
    rb(M.armor, 0.3, 0.1, 0.05, 0.02, 0, 0.08, 0.11, -0.1),
  );
  P(
    'Spine2',
    rb(M.armor, 0.46, 0.3, 0.28, 0.08, 0, 0.12, -0.01), // chest shell
    rb(M.accent, 0.19, 0.15, 0.06, 0.03, 0.1, 0.16, 0.13, -0.18, 0.12, 0), // pectoral plates
    rb(M.accent, 0.19, 0.15, 0.06, 0.03, -0.1, 0.16, 0.13, -0.18, -0.12, 0),
    rb(M.trim, 0.05, 0.12, 0.05, 0.015, 0, 0.13, 0.15), // sternum
    rb(M.glow, 0.012, 0.08, 0.01, 0.004, 0, 0.13, 0.177),
    rb(M.stripe, 0.04, 0.24, 0.02, 0.01, 0.17, 0.11, 0.13, -0.1, 0.25, 0), // red stripe + white edge
    rb(M.accent, 0.012, 0.24, 0.02, 0.005, 0.2, 0.11, 0.125, -0.1, 0.25, 0),
    rb(M.trim, 0.28, 0.08, 0.22, 0.035, 0, 0.27, -0.02), // collar
    rb(M.armor, 0.14, 0.08, 0.12, 0.03, 0.17, 0.25, -0.02, 0, 0, -0.35), // trapezius plates
    rb(M.armor, 0.14, 0.08, 0.12, 0.03, -0.17, 0.25, -0.02, 0, 0, 0.35),
  );
  // backpack: power cell, vents, antenna
  rig.attach(
    'Spine2',
    group(
      rb(M.armor, 0.34, 0.34, 0.12, 0.04, 0, 0.1, -0.2),
      rb(M.trim, 0.26, 0.24, 0.06, 0.02, 0, 0.1, -0.27),
      rb(M.glow, 0.022, 0.18, 0.012, 0.006, 0.07, 0.1, -0.3),
      rb(M.glow, 0.022, 0.18, 0.012, 0.006, -0.07, 0.1, -0.3),
      cyl(M.trim, 0.045, 0.055, 0.08, 0.1, -0.1, -0.22),
      cyl(M.trim, 0.045, 0.055, 0.08, -0.1, -0.1, -0.22),
      cyl(M.glow, 0.03, 0.03, 0.01, 0.1, -0.145, -0.22),
      cyl(M.glow, 0.03, 0.03, 0.01, -0.1, -0.145, -0.22),
      cyl(M.trim, 0.008, 0.008, 0.26, -0.13, 0.36, -0.24, 0, 0, 0, 6),
      cyl(M.glowRed, 0.014, 0.014, 0.02, -0.13, 0.49, -0.24, 0, 0, 0, 8),
    ),
  );
  P('Neck', cyl(M.suit, 0.06, 0.07, 0.12, 0, 0.03, 0), cyl(M.trim, 0.075, 0.08, 0.04, 0, -0.01, 0));
  P(
    'Head',
    rb(M.armor, 0.25, 0.27, 0.28, 0.1, 0, 0.13, -0.005), // helmet shell
    rb(M.accent, 0.05, 0.05, 0.26, 0.02, 0, 0.27, -0.01), // crest
    rb(M.trim, 0.23, 0.13, 0.08, 0.04, 0, 0.12, 0.11), // face frame
    rb(M.visor, 0.21, 0.08, 0.05, 0.025, 0, 0.15, 0.14), // visor glass
    rb(M.glow, 0.17, 0.008, 0.01, 0.004, 0, 0.12, 0.163),
    rb(M.armor, 0.16, 0.06, 0.07, 0.025, 0, 0.04, 0.12, 0.25), // chin guard
    rb(M.glow, 0.008, 0.03, 0.008, 0.003, 0.04, 0.04, 0.158, 0.25),
    rb(M.glow, 0.008, 0.03, 0.008, 0.003, -0.04, 0.04, 0.158, 0.25),
    cyl(M.trim, 0.05, 0.05, 0.03, 0.135, 0.12, 0, 0, 0, Math.PI / 2), // ear pods
    cyl(M.trim, 0.05, 0.05, 0.03, -0.135, 0.12, 0, 0, 0, Math.PI / 2),
    cyl(M.glow, 0.025, 0.025, 0.006, 0.152, 0.12, 0, 0, 0, Math.PI / 2),
    cyl(M.trim, 0.006, 0.006, 0.12, -0.15, 0.2, -0.03, -0.3, 0, 0, 5), // comm antenna
  );

  for (const [side, s] of [['Left', 1], ['Right', -1]]) {
    P(
      side + 'Arm',
      cap(M.suit, 0.058, 0.18, 0, -0.15, 0),
      rb(M.armor, 0.18, 0.13, 0.21, 0.05, 0.035 * s, 0.0, 0, 0, 0, 0.25 * s), // pauldron
      rb(M.accent, 0.13, 0.05, 0.19, 0.02, 0.07 * s, 0.07, 0, 0, 0, 0.4 * s),
      ...(s < 0 ? [rb(M.stripe, 0.02, 0.1, 0.17, 0.008, -0.12, -0.02, 0, 0, 0, 0.25 * s)] : []),
      rb(M.armor, 0.05, 0.16, 0.1, 0.02, 0.05 * s, -0.17, 0), // bicep plate
    );
    P(
      side + 'ForeArm',
      cap(M.suit, 0.05, 0.16, 0, -0.14, 0),
      rb(M.armor, 0.115, 0.2, 0.12, 0.035, 0, -0.15, 0), // gauntlet
      rb(M.trim, 0.12, 0.03, 0.125, 0.01, 0, -0.05, 0),
      ...(s > 0
        ? [rb(M.glow, 0.012, 0.13, 0.04, 0.004, 0.059, -0.15, 0), rb(M.glow, 0.02, 0.02, 0.008, 0.006, 0.0, -0.12, 0.062)] // wrist computer
        : [rb(M.accent, 0.06, 0.14, 0.012, 0.004, 0, -0.15, 0.062)]),
    );
    P(
      side + 'Hand',
      rb(M.suit, 0.075, 0.1, 0.08, 0.025, 0, -0.045, 0),
      rb(M.armor, 0.08, 0.05, 0.03, 0.012, 0, -0.03, 0.035), // knuckle plate
      rb(M.suit, 0.03, 0.06, 0.03, 0.012, 0.035 * s, -0.04, 0.035, 0, 0, 0.3 * s), // thumb
    );
    P(
      side + 'UpLeg',
      cap(M.suit, 0.085, 0.26, 0, -0.21, 0),
      rb(M.armor, 0.16, 0.25, 0.07, 0.03, 0, -0.2, 0.065), // thigh plate
      rb(M.accent, 0.06, 0.22, 0.14, 0.025, 0.07 * s, -0.19, 0), // outer plate
      rb(M.armor, 0.06, 0.09, 0.1, 0.02, 0.1 * s, -0.27, -0.02), // holster pouch
    );
    P(
      side + 'Leg',
      cap(M.suit, 0.07, 0.26, 0, -0.2, -0.01),
      rb(M.accent, 0.13, 0.11, 0.09, 0.035, 0, -0.01, 0.07), // knee pad
      rb(M.armor, 0.12, 0.27, 0.07, 0.03, 0, -0.2, 0.06), // shin guard
      rb(M.trim, 0.02, 0.18, 0.01, 0.005, 0, -0.2, 0.097),
      rb(M.armor, 0.12, 0.16, 0.07, 0.03, 0, -0.24, -0.05), // calf
    );
    P(
      side + 'Foot',
      rb(M.armor, 0.14, 0.1, 0.19, 0.03, 0, -0.03, 0.02), // boot
      rb(M.trim, 0.15, 0.025, 0.21, 0.01, 0, -0.07, 0.02), // sole
      rb(M.trim, 0.15, 0.04, 0.15, 0.015, 0, 0.03, -0.005), // ankle cuff
    );
    P(
      side + 'ToeBase',
      rb(M.armor, 0.13, 0.05, 0.1, 0.02, 0, 0.005, 0.04),
      rb(M.trim, 0.14, 0.022, 0.11, 0.008, 0, -0.015, 0.04),
    );
  }
  return M;
}
