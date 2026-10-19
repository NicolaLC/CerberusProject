import * as THREE from 'three';
import { part, rb, cyl, cap, ring, look } from './parts.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { wornMaterial } from '../world/textures.js';

// Humanoid enemy looks, in the player soldier's style (soldier.js): rounded plates, cylinders and capsules per
// bone over a mechanical frame, a few HDR glows. Visual only (`look`): hits use the rig's invisible dummy boxes.
// Bone-local axes: +Z forward, +X the character's left, limbs hang along -Y. Weak spots sit on the dummy boxes'
// front faces, so keep limb fronts roughly within them (see EnemyBody).

const R = Math.PI / 2;
const SIDES = [['Left', 1], ['Right', -1]];

// ---------------- trooper: HiveMind line droid (pale worn grey shells over a dark frame, violet joint rings) ----------------
// art-style.md: the HiveMind livery after CERBERUS (cerberus-model.js), on the human rig: a lean, predatory, mass-produced war
// droid. Dark strut limbs on round joint discs under faceted, chamfered pale shells (tapered blades with a sharp forward edge,
// a forward-raked chest wedge with a keel, a V pelvis with side hip actuators), shoulders hunched, a low wedge-nosed sensor
// housing carried forward under a brow (3 small uneven violet lenses), claw hands, bladed feet with a heel spur.
// Every shell is a convex hull of a few chamfered cross-sections (`hull`, cached): flat facets, no rounded boxes.
// Hits use the rig's invisible dummy boxes, not these shapes.

// armored: the plated trooper (trooper.js `armored`): its bolted-on plates are bare plate steel.
export function trooperMaterials(armored = false) {
  return {
    frame: wornMaterial(0x1d1f23, { roughness: 0.55, metalness: 0.55, wear: 'metal' }), // black frame, rods, joints
    armor: wornMaterial(0xa9aca7, { roughness: 0.78, metalness: 0.2, wear: 'shell' }), // pale worn grey shells
    plate: armored
      ? wornMaterial(0x6a7076, { roughness: 0.6, metalness: 0.2, wear: 'metal' }) // bare plate steel (also the rifle's furniture)
      : wornMaterial(0x34383c, { roughness: 0.6, metalness: 0.55, wear: 'metal' }), // dark grey trim (also the rifle's furniture)
  };
}

// Shapes parts.js does not have, cached by key like parts.js.
const shapeCache = new Map();
const shape = (key, make) => (shapeCache.has(key) ? shapeCache.get(key) : shapeCache.set(key, make()).get(key));
const bx = (m, w, h, d, x, y, z, rx, ry, rz) => part(shape(`x${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d)), m, x, y, z, rx, ry, rz);

// Planar UVs per face (the wear map's chips and streaks follow each shell's own edges), the hull has none.
function faceUV(g) {
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  const k = (a) => 1 / Math.max(max[a] - min[a], 1e-3);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [a, b] = ax > ay && ax > az ? ['z', 'y'] : ay > az ? ['x', 'z'] : ['x', 'y'];
    uv[2 * i] = (p['get' + a.toUpperCase()](i) - min[a]) * k(a);
    uv[2 * i + 1] = (p['get' + b.toUpperCase()](i) - min[b]) * k(b);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// A faceted shell: the convex hull of the points ([x, y, z] lists, mirrored sections included).
const hl = (m, pts, x, y, z, rx, ry, rz) =>
  part(shape(`h${pts.map((q) => q.join(',')).join('|')}`, () => faceUV(new ConvexGeometry(pts.map((q) => new THREE.Vector3(...q))))), m, x, y, z, rx, ry, rz);
// A chamfered cross-section at height y (8 points): half width hw, back z zb, front z zf, a narrow flat fw at the front
// (the leading edge), ox shifts the section sideways. Hull of two or three of them = a tapered, raked blade.
const S = (y, hw, zb, zf, fw = 0.006, ox = 0) => {
  const zs1 = zb + (zf - zb) * 0.22, zs2 = zb + (zf - zb) * 0.72;
  return [[hw * 0.8, zb], [hw, zs1], [hw * 0.92, zs2], [Math.max(fw, 0.003), zf]].flatMap(([x, z]) => [[ox + x, y, z], [ox - x, y, z]]);
};
// A chamfered cross-section along z (for heads, toes): half width hw, y0..y1, chamfer c.
const Z = (z, hw, y0, y1, c = 0.012) => [[hw - c, y1], [hw, y1 - c], [hw, y0 + c], [hw - c, y0]].flatMap(([x, y]) => [[x, y, z], [-x, y, z]]);

// visor: the glowing material (optics, joint rings) that flares as the trooper aims.
// armored: a few bolted bare-steel plates over the same droid (same materials: no extra draw calls), returned as
// { [plate group]: [look group] } (trooper.js PLATE_OF): a heavy round knocks a group off, the trooper drops the objects.
export function buildTrooper(rig, M, visor, armored = false) {
  const L = (bone, ...children) => rig.attach(bone, look(...children));
  // hit boxes follow the silhouette (head carried low and forward, antenna aside)
  rig.fit?.({
    Hips: [0.3, 0.22, 0.2, 0, -0.02, 0.01], Spine: [0.2, 0.12, 0.16, 0, 0.06, 0], Spine1: [0.22, 0.14, 0.17, 0, 0.07, 0.005],
    Spine2: [0.36, 0.27, 0.3, 0, 0.1, 0.02], Neck: [0.08, 0.1, 0.1, 0, -0.03, 0.03], Head: [0.14, 0.1, 0.24, 0, -0.04, 0.13],
    LeftUpLeg: [0.12, 0.4, 0.14, 0, -0.21, 0.02], RightUpLeg: [0.12, 0.4, 0.14, 0, -0.21, 0.02],
    LeftLeg: [0.1, 0.38, 0.14, 0, -0.2, 0.025], RightLeg: [0.1, 0.38, 0.14, 0, -0.2, 0.025],
    LeftFoot: [0.1, 0.08, 0.24, 0, -0.04, 0.03], RightFoot: [0.1, 0.08, 0.24, 0, -0.04, 0.03],
    LeftArm: [0.09, 0.3, 0.1, 0, -0.15, 0.01], RightArm: [0.09, 0.3, 0.1, 0, -0.15, 0.01],
    LeftForeArm: [0.08, 0.28, 0.09, 0, -0.14, 0.01], RightForeArm: [0.08, 0.28, 0.09, 0, -0.14, 0.01],
    LeftHand: [0.07, 0.1, 0.08, 0, -0.05, 0.02], RightHand: [0.07, 0.1, 0.08, 0, -0.05, 0.02],
  });
  const rod = (m, r, h, x, y, z, rx = 0, ry = 0, rz = 0) => cyl(m, r, r, h, x, y, z, rx, ry, rz, 8); // strut along the bone
  const disc = (r, len, x, y, z) => cyl(M.frame, r, r, len, x, y, z, 0, 0, R, 12); // joint disc, axis X
  const jointRing = (x, y, z, r) => ring(visor, r, 0.006, x, y, z, 0, R, 0); // axis X, on a joint disc's outer face
  // a claw finger: two tapered segments curling forward from (x, y, z) down the hand
  const finger = (x, y, z, l1, a1, l2, a2, r = 0.006) => {
    const d1 = [Math.sin(a1), -Math.cos(a1)], d2 = [Math.sin(a2), -Math.cos(a2)];
    const y1 = y + d1[1] * l1, z1 = z + d1[0] * l1;
    return [
      cyl(M.frame, r * 0.7, r, l1, x, y + (d1[1] * l1) / 2, z + (d1[0] * l1) / 2, -a1, 0, 0, 4),
      cyl(M.plate, r * 0.2, r * 0.7, l2, x, y1 + (d2[1] * l2) / 2, z1 + (d2[0] * l2) / 2, -a2, 0, 0, 4), // claw tip
    ];
  };

  // pelvis: a V wedge, wide at the top, tapering to a groin blade; a dark recessed seam between the iliac shell and the
  // groin plate; side hip actuators (sleeve on the pelvis, rod on the thigh) to the hip joint axle
  L(
    'Hips',
    hl(M.frame, [...S(0.07, 0.115, -0.07, 0.08, 0.07), ...S(-0.11, 0.035, -0.04, 0.06, 0.02)], 0, 0, 0), // dark core
    hl(M.armor, [...S(0.085, 0.15, -0.095, 0.095, 0.08), ...S(-0.02, 0.1, -0.075, 0.1, 0.04)], 0, 0, 0), // iliac shell, a V from the front
    hl(M.armor, [...S(-0.036, 0.075, -0.05, 0.1, 0.014), ...S(-0.16, 0.012, -0.01, 0.07, 0.004)], 0, 0, 0), // groin blade pointing down and forward
    hl(M.plate, [...S(0.09, 0.1, -0.1, -0.02, 0.1), ...S(0.035, 0.08, -0.095, -0.03, 0.08)], 0, 0, 0), // rear skirt, dark
    bx(M.frame, 0.235, 0.012, 0.01, 0, 0.032, 0.088, 0.12), // crisp panel line across the shell
    bx(M.frame, 0.012, 0.07, 0.01, 0, 0.0, 0.097, 0.1), // centre seam
    rod(M.frame, 0.02, 0.24, 0, -0.05, 0, 0, 0, R), // hip axle
    ...SIDES.flatMap(([, s]) => [
      rod(M.frame, 0.02, 0.1, 0.14 * s, 0.015, 0.03, 0.12, 0, 0.35 * s), // actuator sleeve
      rod(M.plate, 0.025, 0.026, 0.138 * s, 0.045, 0.03, 0.12, 0, 0.35 * s), // collar
    ]),
  );
  // waist: a bare strut through ribbed collars
  L('Spine', rod(M.frame, 0.032, 0.17, 0, 0.06, 0), hl(M.plate, [...S(0.085, 0.06, -0.05, 0.05, 0.03), ...S(0.07, 0.058, -0.05, 0.05, 0.03)], 0, 0, 0), hl(M.plate, [...S(0.03, 0.06, -0.05, 0.05, 0.03), ...S(0.015, 0.056, -0.05, 0.05, 0.03)], 0, 0, 0));
  L(
    'Spine1',
    hl(M.frame, [...S(0.1, 0.09, -0.065, 0.06, 0.04), ...S(-0.05, 0.062, -0.05, 0.055, 0.025)], 0, 0, 0), // abdomen, dark and tapered
    hl(M.plate, [...S(0.06, 0.075, -0.06, 0.07, 0.03), ...S(0.0, 0.058, -0.045, 0.06, 0.02)], 0, 0, 0), // trim plate on its front
    rod(M.frame, 0.008, 0.2, 0.05, 0.03, 0.07), // hydraulic lines
    rod(M.frame, 0.008, 0.2, -0.05, 0.03, 0.07),
    bx(M.frame, 0.1, 0.1, 0.06, 0, 0.06, -0.08),
  );
  // chest: a forward-raked wedge (broad at the upper chest, a sharp keel below), dark recessed vents, a hunched rear hump,
  // a back power unit
  L(
    'Spine2',
    hl(M.frame, [...S(0.2, 0.12, -0.11, 0.1, 0.07), ...S(-0.03, 0.06, -0.08, 0.08, 0.03)], 0, 0, 0), // dark core
    hl(M.armor, [...S(0.2, 0.15, -0.03, 0.125, 0.09), ...S(0.12, 0.175, -0.07, 0.15, 0.07), ...S(-0.01, 0.07, -0.05, 0.105, 0.008)], 0, 0, 0), // chest wedge
    hl(M.armor, [...S(0.24, 0.09, -0.11, -0.02, 0.04), ...S(0.14, 0.15, -0.11, 0.02, 0.04)], 0, 0, 0), // hunched rear hump
    ...[0.04, 0.075].map((y) => hl(M.frame, [...S(y + 0.012, 0.075, 0.115 + y * 0.27, 0.142 + y * 0.27, 0.07), ...S(y, 0.075, 0.12 + y * 0.27, 0.138 + y * 0.27, 0.07)], 0, 0, 0)), // vent slats
    bx(M.frame, 0.34, 0.01, 0.01, 0, 0.098, 0.139, 0.27), // crisp panel line under the upper chest
    hl(M.armor, [...S(0.25, 0.1, -0.2, -0.085, 0.07), ...S(0.04, 0.075, -0.15, -0.085, 0.05)], 0, 0, 0), // back unit shell
    bx(M.frame, 0.13, 0.17, 0.03, 0, 0.14, -0.215),
    ...[-1, 1].map((k) => rod(M.frame, 0.013, 0.2, 0.06 * k, 0.28, -0.2, -0.12)), // two exhaust tubes
    ...[-1, 1].map((k) => bx(M.plate, 0.05, 0.012, 0.012, 0.06 * k, 0.17, -0.216)), // oil-stained grille bars
  );
  // neck: two struts leaning forward to a low sensor housing, carried below the shoulder humps
  L('Neck', ...[-1, 1].map((k) => rod(M.frame, 0.014, 0.12, 0.028 * k, -0.07, 0.0, 0.5)), bx(M.plate, 0.1, 0.02, 0.05, 0, -0.14, -0.02));
  // head: dark sensor core under a pale wedge cowl whose tip overhangs the lens cluster; narrow, nose pointing forward and down
  const HY = -0.04, HZ = 0.09;
  L(
    'Head',
    hl(M.armor, [...Z(-0.085, 0.06, -0.035, 0.04, 0.014), ...Z(0.03, 0.066, -0.05, 0.002, 0.014), ...Z(0.17, 0.02, -0.04, -0.012, 0.006)], 0, HY, HZ, 0.1), // cowl
    hl(M.frame, [...Z(-0.07, 0.052, -0.1, -0.03, 0.01), ...Z(0.075, 0.052, -0.095, -0.045, 0.01), ...Z(0.108, 0.033, -0.082, -0.05, 0.008)], 0, HY, HZ, 0.1), // lens core
    bx(visor, 0.018, 0.012, 0.01, 0.016, HY - 0.054, HZ + 0.114, 0.1),
    bx(visor, 0.011, 0.011, 0.01, -0.004, HY - 0.068, HZ + 0.114, 0.1),
    bx(visor, 0.013, 0.011, 0.01, -0.02, HY - 0.052, HZ + 0.113, 0.1),
    ...[-1, 1].map((k) => bx(M.frame, 0.006, 0.014, 0.07, 0.066 * k, HY - 0.012, HZ + 0.02, 0.1)), // cheek vents
    rod(M.frame, 0.004, 0.18, -0.04, HY + 0.07, HZ - 0.07, -0.3), // antenna
  );

  for (const [side, s] of SIDES) {
    L(
      side + 'Arm',
      disc(0.05, 0.05, 0, 0, 0), // shoulder disc
      jointRing(0.027 * s, 0, 0, 0.038),
      hl(M.armor, [...S(0.05, 0.034, -0.04, 0.075, 0.01, 0.0), ...S(-0.035, 0.048, -0.05, 0.055, 0.008, 0.035 * s)], 0, 0, 0, 0, 0, -0.3 * s), // hunched pauldron blade
      rod(M.frame, 0.02, 0.3, 0, -0.15, 0),
      hl(M.armor, [...S(-0.06, 0.03, -0.015, 0.04, 0.008), ...S(-0.2, 0.026, -0.012, 0.034, 0.006)], 0, 0, 0), // upper arm blade
      disc(0.034, 0.05, 0, -0.3, 0), // elbow disc
    );
    L(
      side + 'ForeArm',
      rod(M.frame, 0.02, 0.26, 0, -0.14, 0),
      hl(M.armor, [...S(-0.03, 0.03, -0.015, 0.05, 0.008), ...S(-0.2, 0.021, -0.012, 0.03, 0.006)], 0, 0, 0), // bracer blade
      bx(M.plate, 0.052, 0.01, 0.012, 0, -0.06, 0.05, 0.2), // panel band
      disc(0.028, 0.045, 0, -0.28, 0), // wrist disc
    );
    L(
      side + 'Hand',
      hl(M.frame, [...S(-0.015, 0.024, -0.02, 0.028, 0.012), ...S(-0.062, 0.02, -0.014, 0.022, 0.01)], 0, 0, 0), // palm
      ...[-0.015, 0, 0.015].flatMap((x, i) => finger(x, -0.058, 0.014, 0.036 - i * 0.003, 0.5, 0.032, 1.15)), // 3 claw fingers
      ...finger(0.025 * s, -0.035, 0.004, 0.034, 0.8, 0.028, 1.4, 0.0065).map((m) => ((m.rotation.z = -0.5 * s), m)), // thumb
    );
    // legs: dark struts, a tapered blade shell with a sharp forward edge over the front half, rear hydraulic lines
    L(
      side + 'UpLeg',
      disc(0.045, 0.06, 0, 0, 0), // hip disc
      jointRing(0.032 * s, 0, 0, 0.034),
      rod(M.frame, 0.02, 0.07, 0.03 * s, 0.025, 0.0, 0, 0, 0.35 * s), // actuator rod into the pelvis sleeve
      rod(M.frame, 0.026, 0.4, 0, -0.21, 0),
      hl(M.armor, [...S(-0.07, 0.045, -0.012, 0.07, 0.014), ...S(-0.18, 0.047, -0.012, 0.1, 0.008), ...S(-0.35, 0.03, -0.012, 0.05, 0.006)], 0, 0, 0), // thigh blade
      rod(M.frame, 0.012, 0.22, 0, -0.2, -0.04), // rear piston
      bx(M.plate, 0.07, 0.01, 0.02, 0, -0.075, 0.066, 0.55), // panel band at the top of the blade
    );
    L(
      side + 'Leg',
      disc(0.046, 0.06, 0, 0, 0), // knee disc
      hl(M.armor, [...S(0.04, 0.032, 0.0, 0.085, 0.004), ...S(-0.03, 0.026, 0.0, 0.04, 0.004)], 0, 0, 0), // knee blade
      rod(M.frame, 0.024, 0.38, 0, -0.2, 0),
      hl(M.armor, [...S(-0.05, 0.04, -0.012, 0.07, 0.012), ...S(-0.14, 0.043, -0.012, 0.085, 0.008), ...S(-0.38, 0.026, -0.01, 0.03, 0.006)], 0, 0, 0), // shin blade, long
      rod(M.frame, 0.013, 0.3, 0, -0.2, -0.045), // rear piston
      bx(M.plate, 0.075, 0.01, 0.02, 0, -0.2, 0.072, 0.3), // panel band mid-shin
    );
    L(
      side + 'Foot',
      disc(0.032, 0.05, 0, 0, 0), // ankle disc
      hl(M.frame, [...S(-0.045, 0.046, -0.075, 0.12, 0.03), ...S(-0.08, 0.048, -0.08, 0.125, 0.03)], 0, 0, 0), // sole
      hl(M.armor, [...S(-0.025, 0.033, -0.05, 0.08, 0.02), ...S(-0.055, 0.044, -0.07, 0.115, 0.03)], 0, 0, 0), // instep blade
      hl(M.frame, [...S(-0.035, 0.015, -0.1, -0.04, 0.008), ...S(-0.078, 0.004, -0.125, -0.07, 0.004)], 0, 0, 0), // heel spur
    );
    L(side + 'ToeBase', hl(M.frame, [...Z(-0.01, 0.046, -0.02, 0.022, 0.01), ...Z(0.085, 0.02, -0.02, -0.004, 0.006)], 0, 0, 0)); // toe blade
  }
  if (!armored) return null;

  // bolted bare-steel plates over the same droid, angular and thin: chest, shoulders, vambraces, shin guards; each on its own
  // bone so it follows the limb
  const plates = {};
  const P = (group, bone, ...children) => (plates[group] ??= []).push(L(bone, ...children));
  const bolt = (x, y, z, rx = 0) => cyl(M.frame, 0.009, 0.009, 0.01, x, y, z, R + rx, 0, 0, 6);
  P('head', 'Head', hl(M.plate, [...Z(-0.07, 0.056, 0.048, 0.056, 0.012), ...Z(0.12, 0.016, 0.0, 0.008, 0.005)], 0, HY, HZ, 0.1), ...[-1, 1].map((k) => bx(M.plate, 0.01, 0.045, 0.1, 0.07 * k, HY - 0.01, HZ - 0.02, 0.1))); // cowl cap and side guards
  P('torso', 'Spine2', hl(M.plate, [...S(0.19, 0.125, 0.128, 0.152, 0.07), ...S(0.04, 0.062, 0.114, 0.134, 0.02)], 0, 0, 0), bolt(0.085, 0.16, 0.152, 0.2), bolt(-0.085, 0.16, 0.152, 0.2)); // chest plate
  P('torso', 'Hips', hl(M.plate, [...S(-0.03, 0.06, 0.1, 0.115, 0.02), ...S(-0.15, 0.01, 0.075, 0.085, 0.006)], 0, 0, 0), ...[-1, 1].map((k) => hl(M.plate, [...S(0.07, 0.01, -0.06, 0.07, 0.008), ...S(-0.03, 0.012, -0.05, 0.05, 0.008)], 0.155 * k, 0, 0))); // groin plate and hip side guards
  for (const [side, s] of SIDES) {
    const arm = side === 'Left' ? 'armL' : 'armR';
    const leg = side === 'Left' ? 'legL' : 'legR';
    P(arm, side + 'Arm', hl(M.plate, [...S(0.08, 0.052, -0.055, 0.1, 0.03, 0.025 * s), ...S(-0.04, 0.06, -0.055, 0.07, 0.015, 0.035 * s)], 0, 0, 0, 0, 0, -0.1 * s)); // shoulder plate
    P(arm, side + 'ForeArm', hl(M.plate, [...S(-0.04, 0.032, 0.045, 0.062, 0.01), ...S(-0.18, 0.024, 0.032, 0.044, 0.008)], 0, 0, 0)); // vambrace
    P(leg, side + 'UpLeg', hl(M.plate, [...S(-0.1, 0.04, 0.068, 0.086, 0.01), ...S(-0.28, 0.026, 0.044, 0.056, 0.008)], 0, 0, 0), bolt(0, -0.14, 0.092)); // thigh plate
    P(leg, side + 'Leg', hl(M.plate, [...S(-0.1, 0.038, 0.08, 0.1, 0.01), ...S(-0.32, 0.024, 0.026, 0.04, 0.008)], 0, 0, 0), hl(M.plate, [...S(0.03, 0.034, 0.08, 0.1, 0.006), ...S(-0.03, 0.028, 0.04, 0.05, 0.006)], 0, 0, 0)); // shin guard, knee guard
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
