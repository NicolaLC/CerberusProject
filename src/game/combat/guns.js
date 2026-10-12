import * as THREE from 'three';
import { pattern } from './ballistics.js';
import { wornMaterial } from '../world/textures.js';
import { rb, cyl } from '../actors/parts.js';

// Model helpers (bevelled parts read as machined metal at HUD scale). Axes: +Z forward from the stock, +Y up.
const RZ = Math.PI / 2;
const bevel = (w, h, d) => Math.min(0.006, w * 0.2, h * 0.2, d * 0.2);
const B = (mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => rb(mat, w, h, d, bevel(w, h, d), x, y, z, rx, ry, rz); // box
const C = (mat, r, len, x, y, z, seg = 12) => cyl(mat, r, r, len, x, y, z, RZ, 0, 0, seg); // cylinder along Z
const Cn = (mat, rFront, rBack, len, x, y, z, seg = 12) => cyl(mat, rFront, rBack, len, x, y, z, RZ, 0, 0, seg); // cone along Z
const X = (mat, r, len, x, y, z, seg = 10) => cyl(mat, r, r, len, x, y, z, 0, 0, RZ, seg); // cylinder along X
const V = (mat, r, len, x, y, z, seg = 10) => cyl(mat, r, r, len, x, y, z, 0, 0, 0, seg); // cylinder along Y
const S = (mat, r, x, y, z) => cyl(mat, r, r, r * 1.6, x, y, z, 0, 0, RZ, 10); // knob
// n equal boxes spread along Z from z0 to z1 (vents, rail teeth, pips)
const ribs = (mat, w, h, d, x, y, z0, z1, n) => Array.from({ length: n }, (_, i) => B(mat, w, h, d, x, y, z0 + ((z1 - z0) * i) / Math.max(1, n - 1)));

// Gun looks (instructions/art-style.md 5): K-series guns are salvaged HiveMind hardware, a worn dark metal body with
// painted furniture (`plate`), scorched muzzles and amber/orange power glows (never violet: violet marks weak spots).
// STEM-00 repaints the furniture olive as it claims a gun (player models, Library props); in a trooper's hands the
// furniture keeps the HiveMind's worn ochre livery. Each model reads at HUD scale: receiver, magazine, heat shroud,
// plus the working detail (rails, optics, bolts, vents, bipods, capacitors). build(m) returns a Group in gun space.
// plate: the furniture material; glow: the amber power glow (STEM-00's power); unlit: no glows at all (an enemy's
// gun: sensors are the only saturated light on a HiveMind unit), the glow parts are plain gun metal.
export function gunMaterials({ plate, glow, unlit = false } = {}) {
  const gun = wornMaterial(0x2a2d31, { roughness: 0.5, metalness: 0.55, wear: 'metal' });
  return {
    gun,
    plate: plate ?? wornMaterial(0x5d6849, { roughness: 0.72, metalness: 0.2 }),
    scorch: wornMaterial(0x0f0d0c, { roughness: 0.95, metalness: 0.3, wear: 'metal' }), // soot-black muzzles and vents
    glow: unlit ? gun : (glow ?? new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa63a, emissiveIntensity: 2.2 })),
    glowHot: unlit ? gun : new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff8a2a, emissiveIntensity: 2.5 }),
  };
}

// Weapon definitions: stats, hand/muzzle sockets on the `Weapon` bone, and the placeholder model.
// Angles in radians. Spread values are cone half-angles. See instructions/gameplay.md (Gunplay).
// Models are authored from the stock (bone pivot, z = 0) forward along +Z.
// Grips must stay within arm reach: see instructions/animation.md.
export const GUNS = {
  rifle: {
    name: 'KR-7 WARDEN',
    short: 'AR',
    rpm: 540,
    spinUp: 0, // seconds to reach full rpm
    mag: 32,
    reserve: 192,
    maxReserve: 384,
    pickup: { crate: 96, drop: 32 },
    ammo: 'light', // pickup class: light (AR, MG, BR, PS) or heavy (SR, RG)
    reloadTime: 1.8,
    activeReload: { good: [0.32, 0.58], perfect: [0.4, 0.48] }, // fractions of the reload bar
    damage: 18,
    headMult: 2.5,
    limbMult: 0.8,
    weakMult: 3,
    range: 250,
    falloff: { start: 35, end: 80, min: 0.65 }, // damage multiplier by distance
    spreadHip: 0.022,
    spreadAim: 0.004,
    spreadMove: 0.012, // extra at full walk speed (×0.4 aimed)
    firstShot: { rest: 0.3, hip: 0.5, aim: 0 }, // after resting `rest` s the next shot's spread is scaled
    bloomPerShot: 0.007,
    bloomMax: 0.05,
    bloomDecay: 0.12, // per second, starts `bloomDelay` s after the last shot
    bloomDelay: 0.12,
    recoil: {
      // per shot [pitch up, yaw right]: a hard climb for 5 rounds, then a gentle right-left sway
      pattern: pattern(16, (i) => [i < 5 ? 0.013 : 0.0085, i < 5 ? 0.0012 : 0.0035 * Math.sin((i - 5) * 0.9)]),
      loop: 6,
      jitter: 0.12,
      aim: 0.6, // multiplier while aiming
      recover: 0.85, // fraction pulled back after the burst
      reset: 0.35, // idle seconds before the pattern restarts
    },
    kick: { back: 0.07, climb: 0.09 }, // gun model kick (m, rad)
    flash: 1,
    trauma: 0.06,
    fireMoveSpeed: null, // walk speed while firing (null = normal)
    sockets: { gripR: [0, -0.15, 0.22], gripL: [0, -0.07, 0.44], muzzle: [0, 0.02, 0.88] },
    // assault rifle: skeletal stock, two-part receiver with a top rail and a short optic, curved magazine,
    // ventilated olive heat shroud, gas block, slotted muzzle brake, amber power cell on the left
    build(m) {
      const g = new THREE.Group();
      g.add(
        B(m.plate, 0.05, 0.15, 0.03, 0, -0.02, -0.05), // butt pad
        C(m.gun, 0.017, 0.2, 0, 0.0, 0.06), // stock tube
        B(m.gun, 0.035, 0.03, 0.2, 0, 0.045, 0.06), // stock top bar
        B(m.gun, 0.03, 0.025, 0.2, 0, -0.07, 0.05, 0.22), // stock lower strut
        B(m.plate, 0.045, 0.035, 0.11, 0, 0.07, 0.03), // cheek riser
        B(m.gun, 0.07, 0.085, 0.32, 0, -0.03, 0.32), // lower receiver
        B(m.gun, 0.085, 0.075, 0.42, 0, 0.035, 0.37), // upper receiver
        B(m.scorch, 0.088, 0.028, 0.07, 0, 0.035, 0.38), // ejection port (both sides)
        B(m.gun, 0.03, 0.016, 0.035, 0, 0.078, 0.17), // charging handle
        B(m.gun, 0.032, 0.012, 0.36, 0, 0.078, 0.41), // top rail
        ...ribs(m.gun, 0.036, 0.008, 0.012, 0, 0.088, 0.26, 0.56, 9), // rail teeth
        B(m.gun, 0.02, 0.028, 0.02, 0, 0.098, 0.31), // optic mounts
        B(m.gun, 0.02, 0.028, 0.02, 0, 0.098, 0.41),
        C(m.gun, 0.026, 0.13, 0, 0.125, 0.36, 14), // optic tube
        C(m.gun, 0.032, 0.03, 0, 0.125, 0.43, 14), // objective bell
        C(m.glow, 0.024, 0.006, 0, 0.125, 0.447, 14), // amber lens
        C(m.scorch, 0.029, 0.02, 0, 0.125, 0.29, 14), // eyepiece
        B(m.gun, 0.045, 0.1, 0.075, 0, -0.11, 0.34, 0.12), // magazine, curved in two sections
        B(m.gun, 0.045, 0.09, 0.07, 0, -0.195, 0.357, 0.28),
        B(m.plate, 0.05, 0.016, 0.078, 0, -0.243, 0.372, 0.28), // magazine base plate
        B(m.gun, 0.046, 0.125, 0.06, 0, -0.13, 0.21, -0.3), // pistol grip
        B(m.gun, 0.012, 0.012, 0.085, 0, -0.105, 0.26), // trigger guard
        B(m.plate, 0.085, 0.09, 0.28, 0, 0.015, 0.63), // heat shroud
        ...ribs(m.scorch, 0.089, 0.045, 0.016, 0, 0.012, 0.53, 0.73, 5), // shroud vents (both sides)
        B(m.gun, 0.03, 0.03, 0.03, 0, -0.045, 0.5), // hand stop
        B(m.gun, 0.032, 0.034, 0.035, 0, 0.02, 0.78), // gas block
        C(m.gun, 0.015, 0.1, 0, 0.02, 0.8), // barrel
        B(m.scorch, 0.046, 0.046, 0.065, 0, 0.02, 0.848), // muzzle brake
        B(m.gun, 0.048, 0.01, 0.012, 0, 0.02, 0.835), // brake ports
        B(m.gun, 0.048, 0.01, 0.012, 0, 0.02, 0.86),
        B(m.glow, 0.006, 0.018, 0.22, -0.046, 0.035, 0.4), // power cell
        ...ribs(m.glow, 0.006, 0.008, 0.01, -0.037, -0.01, 0.26, 0.3, 3), // charge pips
      );
      return g;
    },
  },
  mg: {
    name: 'KM-90 BULWARK',
    short: 'MG',
    rpm: 780,
    spinUp: 0.4,
    mag: 90,
    reserve: 270,
    maxReserve: 450,
    pickup: { crate: 135, drop: 45 },
    ammo: 'light', // pickup class: light (AR, MG, BR, PS) or heavy (SR, RG)
    reloadTime: 3.0,
    activeReload: { good: [0.42, 0.62], perfect: [0.5, 0.555] },
    damage: 13,
    headMult: 2.0,
    limbMult: 0.8,
    weakMult: 3,
    range: 250,
    falloff: { start: 25, end: 60, min: 0.6 },
    spreadHip: 0.034,
    spreadAim: 0.011,
    spreadMove: 0.02,
    firstShot: { rest: 0.4, hip: 0.7, aim: 0.4 },
    bloomPerShot: 0.004,
    bloomMax: 0.07,
    bloomDecay: 0.1,
    bloomDelay: 0.15,
    recoil: {
      // lighter climb, wide learnable snake left-right
      pattern: pattern(24, (i) => [i < 3 ? 0.009 : 0.0055, 0.0015 + 0.006 * Math.sin(i * 0.55)]),
      loop: 12,
      jitter: 0.15,
      aim: 0.65,
      recover: 0.75,
      reset: 0.4,
    },
    kick: { back: 0.05, climb: 0.05 },
    flash: 1.3,
    trauma: 0.045,
    fireMoveSpeed: 2.2,
    sockets: { gripR: [0, -0.17, 0.24], gripL: [0, -0.11, 0.46], muzzle: [0, 0.03, 1.16] },
    // machine gun: heavy receiver with a hinged olive feed cover, ammo box with a feed chute, perforated
    // barrel shroud with cooling rings and a heat shield, carry handle, folded bipod, flash hider
    build(m) {
      const g = new THREE.Group();
      g.add(
        B(m.gun, 0.07, 0.13, 0.18, 0, -0.02, 0.06), // stock
        B(m.plate, 0.075, 0.15, 0.03, 0, -0.025, -0.04), // butt plate
        B(m.gun, 0.05, 0.03, 0.12, 0, -0.1, 0.04), // shoulder rest
        B(m.gun, 0.12, 0.16, 0.48, 0, 0, 0.4), // receiver
        ...ribs(m.scorch, 0.123, 0.12, 0.012, 0, -0.01, 0.2, 0.3, 3), // side cooling fins
        B(m.plate, 0.126, 0.03, 0.26, 0, 0.095, 0.29), // feed cover
        X(m.gun, 0.016, 0.13, 0, 0.095, 0.16), // cover hinge
        B(m.gun, 0.02, 0.05, 0.02, 0, 0.12, 0.3), // carry handle posts
        B(m.gun, 0.02, 0.05, 0.02, 0, 0.12, 0.47),
        B(m.gun, 0.026, 0.024, 0.21, 0, 0.152, 0.385), // carry handle
        B(m.plate, 0.16, 0.15, 0.18, -0.03, -0.17, 0.42), // ammo box
        B(m.gun, 0.165, 0.02, 0.185, -0.03, -0.09, 0.42), // box lid
        B(m.gun, 0.02, 0.05, 0.03, -0.115, -0.16, 0.42), // lid latch
        B(m.gun, 0.05, 0.06, 0.07, -0.05, -0.065, 0.42), // feed chute
        B(m.gun, 0.05, 0.13, 0.06, 0, -0.15, 0.24, -0.3), // pistol grip
        B(m.gun, 0.012, 0.012, 0.08, 0, -0.105, 0.29), // trigger guard
        C(m.gun, 0.046, 0.42, 0, 0.03, 0.85, 14), // barrel shroud
        ...[0.7, 0.79, 0.88, 0.97].map((z) => C(m.scorch, 0.052, 0.022, 0, 0.03, z, 14)), // cooling rings
        B(m.plate, 0.07, 0.012, 0.36, 0, 0.083, 0.85), // heat shield
        C(m.gun, 0.02, 0.1, 0, 0.03, 1.07), // barrel tip
        C(m.scorch, 0.03, 0.09, 0, 0.03, 1.115, 10), // flash hider
        C(m.gun, 0.01, 0.32, 0.03, -0.035, 0.84, 6), // folded bipod
        C(m.gun, 0.01, 0.32, -0.03, -0.035, 0.84, 6),
        B(m.gun, 0.08, 0.025, 0.04, 0, -0.035, 0.68), // bipod clamp
        B(m.glowHot, 0.006, 0.012, 0.36, -0.063, 0.045, 0.42), // heat strip
        B(m.glowHot, 0.13, 0.012, 0.014, 0, 0.1, 0.62), // heat band
      );
      return g;
    },
  },
  // Precision rifle: semi-auto (one round per click), a slow bolt cycle, pin-point when scoped,
  // poor from the hip. Body shot kills a puppet, headshot kills a trooper.
  sniper: {
    name: 'KS-5 FARSIGHT',
    short: 'SR',
    semi: true,
    rpm: 70, // bolt cycle ~0.86 s
    spinUp: 0,
    mag: 5,
    reserve: 25,
    maxReserve: 40,
    pickup: { crate: 10, drop: 3 },
    ammo: 'heavy', // pickup class: light (AR, MG, BR, PS) or heavy (SR, RG)
    reloadTime: 2.4,
    activeReload: { good: [0.36, 0.56], perfect: [0.43, 0.49] },
    damage: 110,
    headMult: 3,
    limbMult: 0.7,
    weakMult: 3,
    range: 300,
    falloff: null, // full damage at any range
    spreadHip: 0.045,
    spreadAim: 0,
    spreadMove: 0.03,
    firstShot: { rest: 0, hip: 1, aim: 1 },
    bloomPerShot: 0,
    bloomMax: 0,
    bloomDecay: 1,
    bloomDelay: 0,
    recoil: {
      // one big climb per shot, almost fully recovered before the bolt is back
      pattern: [[0.06, 0.006]],
      loop: 1,
      jitter: 0.2,
      aim: 0.7,
      recover: 0.95,
      reset: 0.5,
      hold: 0.18, // s before the aim settles back (not the whole bolt cycle)
    },
    kick: { back: 0.14, climb: 0.2 },
    flash: 1.6,
    trauma: 0.14,
    fireMoveSpeed: null,
    zoom: { fov: 24, dist: 1.5, sens: 0.45, scope: true }, // aimed view: scope magnification (+ overlay)
    sockets: { gripR: [0, -0.15, 0.24], gripL: [0, -0.08, 0.5], muzzle: [0, 0.02, 1.3] },
    // precision rifle: thumbhole stock with an olive cheek rest, round bolt action on a chassis, bolt handle,
    // long scope with turrets and an amber objective lens, olive heat shroud, fluted barrel, big brake, folded bipod
    build(m) {
      const g = new THREE.Group();
      g.add(
        B(m.gun, 0.05, 0.04, 0.27, 0, 0.03, 0.07), // stock top
        B(m.gun, 0.05, 0.04, 0.22, 0, -0.1, 0.05), // stock bottom
        B(m.gun, 0.05, 0.17, 0.04, 0, -0.035, -0.05), // butt
        B(m.plate, 0.056, 0.18, 0.025, 0, -0.035, -0.08), // butt pad
        B(m.plate, 0.04, 0.04, 0.15, 0, 0.065, 0.06), // cheek rest
        B(m.gun, 0.07, 0.07, 0.46, 0, -0.03, 0.42), // chassis
        C(m.gun, 0.034, 0.36, 0, 0.02, 0.4, 14), // action
        X(m.gun, 0.008, 0.07, 0.04, 0.025, 0.27), // bolt handle
        S(m.scorch, 0.016, 0.08, 0.025, 0.27), // bolt knob
        B(m.gun, 0.045, 0.115, 0.08, 0, -0.1, 0.38), // magazine
        B(m.plate, 0.05, 0.015, 0.085, 0, -0.16, 0.38), // magazine base
        B(m.gun, 0.045, 0.125, 0.06, 0, -0.13, 0.22, -0.3), // pistol grip
        B(m.gun, 0.012, 0.012, 0.08, 0, -0.1, 0.28), // trigger guard
        B(m.plate, 0.066, 0.075, 0.36, 0, -0.012, 0.8), // heat shroud
        ...ribs(m.scorch, 0.069, 0.03, 0.02, 0, -0.012, 0.68, 0.92, 5), // shroud vents
        C(m.gun, 0.019, 0.36, 0, 0.02, 1.06, 10), // fluted barrel
        ...[0, 1, 2].map((i) => B(m.scorch, 0.04, 0.006, 0.3, 0, 0.02, 1.06, 0, 0, (i * Math.PI) / 3)), // flutes
        B(m.scorch, 0.064, 0.052, 0.09, 0, 0.02, 1.255), // muzzle brake
        B(m.gun, 0.066, 0.012, 0.014, 0, 0.02, 1.235), // brake ports
        B(m.gun, 0.066, 0.012, 0.014, 0, 0.02, 1.27),
        B(m.gun, 0.02, 0.05, 0.03, 0, 0.083, 0.3), // scope rings
        B(m.gun, 0.02, 0.05, 0.03, 0, 0.083, 0.46),
        C(m.gun, 0.024, 0.34, 0, 0.12, 0.38, 14), // scope tube
        Cn(m.gun, 0.04, 0.024, 0.11, 0, 0.12, 0.6, 14), // objective bell
        C(m.glow, 0.036, 0.006, 0, 0.12, 0.658, 14), // amber lens
        Cn(m.gun, 0.024, 0.034, 0.07, 0, 0.12, 0.18, 14), // eyepiece
        C(m.scorch, 0.034, 0.012, 0, 0.12, 0.148, 14),
        V(m.gun, 0.016, 0.035, 0, 0.152, 0.38), // elevation turret
        X(m.gun, 0.016, 0.07, 0, 0.12, 0.38), // windage turret
        C(m.gun, 0.009, 0.3, 0.025, -0.06, 0.82, 6), // folded bipod
        C(m.gun, 0.009, 0.3, -0.025, -0.06, 0.82, 6),
        B(m.glow, 0.006, 0.02, 0.3, 0.036, -0.02, 0.42), // power strip
      );
      return g;
    },
  },
  // Burst rifle: one pull = 3 rounds at a high cyclic rate, then a short pause (holding repeats bursts).
  // Tight cone and a small, mostly vertical kick: the mid-range precision gun.
  burst: {
    name: 'KB-3 TRIBUNE',
    short: 'BR',
    burst: 3,
    burstDelay: 0.3, // s between bursts
    rpm: 900, // within a burst
    spinUp: 0,
    mag: 24,
    reserve: 144,
    maxReserve: 288,
    pickup: { crate: 72, drop: 24 },
    ammo: 'light', // pickup class: light (AR, MG, BR, PS) or heavy (SR, RG)
    reloadTime: 1.9,
    activeReload: { good: [0.34, 0.58], perfect: [0.42, 0.5] },
    damage: 24,
    headMult: 2.5,
    limbMult: 0.8,
    weakMult: 3,
    range: 250,
    falloff: { start: 45, end: 100, min: 0.7 },
    spreadHip: 0.016,
    spreadAim: 0.0015,
    spreadMove: 0.01,
    firstShot: { rest: 0.25, hip: 0.6, aim: 0 },
    bloomPerShot: 0.0015,
    bloomMax: 0.008,
    bloomDecay: 0.1,
    bloomDelay: 0.1,
    recoil: {
      // three small climbs; the pattern restarts every burst (reset < burstDelay)
      pattern: [[0.007, 0.0006], [0.008, -0.0008], [0.009, 0.001]],
      loop: 1,
      jitter: 0.1,
      aim: 0.55,
      recover: 0.9,
      reset: 0.25,
      hold: 0.12,
    },
    kick: { back: 0.06, climb: 0.07 },
    flash: 0.9,
    trauma: 0.05,
    fireMoveSpeed: null,
    sockets: { gripR: [0, -0.15, 0.22], gripL: [0, -0.08, 0.46], muzzle: [0, 0.02, 0.95] },
    // burst rifle: angular receiver with an olive side panel, holographic sight with an amber reticle, straight
    // magazine, vented olive handguard, burst-count pips, short barrel and brake
    build(m) {
      const g = new THREE.Group();
      g.add(
        B(m.gun, 0.055, 0.12, 0.2, 0, -0.02, 0.06), // stock
        B(m.plate, 0.06, 0.14, 0.03, 0, -0.025, -0.045), // butt pad
        B(m.scorch, 0.057, 0.05, 0.1, 0, -0.03, 0.06), // stock cut-out
        B(m.gun, 0.08, 0.13, 0.44, 0, 0, 0.38), // receiver
        B(m.gun, 0.07, 0.04, 0.3, 0, 0.075, 0.42, -0.08), // sloped top
        B(m.plate, 0.084, 0.06, 0.2, 0, -0.012, 0.33), // side panel
        B(m.scorch, 0.083, 0.025, 0.06, 0, 0.03, 0.42), // ejection port
        B(m.gun, 0.05, 0.03, 0.12, 0, 0.1, 0.33), // sight base
        B(m.gun, 0.008, 0.06, 0.01, 0.022, 0.14, 0.36), // sight frame
        B(m.gun, 0.008, 0.06, 0.01, -0.022, 0.14, 0.36),
        B(m.gun, 0.052, 0.01, 0.012, 0, 0.172, 0.36),
        B(m.glow, 0.034, 0.04, 0.003, 0, 0.14, 0.362), // reticle glass
        B(m.gun, 0.05, 0.15, 0.07, 0, -0.13, 0.34), // magazine
        B(m.plate, 0.054, 0.016, 0.074, 0, -0.205, 0.34), // magazine base
        B(m.gun, 0.045, 0.12, 0.06, 0, -0.12, 0.2, -0.28), // pistol grip
        B(m.gun, 0.012, 0.012, 0.075, 0, -0.095, 0.26), // trigger guard
        B(m.plate, 0.075, 0.08, 0.3, 0, -0.005, 0.7), // handguard
        ...ribs(m.scorch, 0.078, 0.012, 0.035, 0, 0.032, 0.6, 0.8, 4), // handguard vents
        C(m.gun, 0.016, 0.16, 0, 0.02, 0.85), // barrel
        B(m.scorch, 0.05, 0.05, 0.06, 0, 0.02, 0.92), // muzzle brake
        ...ribs(m.glow, 0.006, 0.012, 0.012, -0.042, 0.03, 0.29, 0.35, 3), // burst pips
        B(m.glow, 0.006, 0.02, 0.12, 0.042, 0, 0.46), // power strip
      );
      return g;
    },
  },
  // Railgun: the shot charges for a moment after the pull (let go and it still fires), then a slug crosses
  // the whole line, hitting every enemy on it until it meets a wall or armor. Light zoom, no scope.
  rail: {
    name: 'KX-9 HALBERD',
    short: 'RG',
    semi: true,
    charge: 0.45, // s from the pull to the shot
    pierce: true, // the slug passes through every enemy on its line (once each); stops at walls and armor
    rpm: 55,
    spinUp: 0,
    mag: 4,
    reserve: 16,
    maxReserve: 24,
    pickup: { crate: 8, drop: 2 },
    ammo: 'heavy', // pickup class: light (AR, MG, BR, PS) or heavy (SR, RG)
    reloadTime: 2.6,
    activeReload: { good: [0.38, 0.58], perfect: [0.45, 0.51] },
    damage: 100, // a body shot destroys a puppet; a headshot drops a trooper
    headMult: 2,
    limbMult: 0.8,
    weakMult: 2.5,
    range: 300,
    falloff: null,
    spreadHip: 0.02,
    spreadAim: 0,
    spreadMove: 0.02,
    firstShot: { rest: 0, hip: 1, aim: 1 },
    bloomPerShot: 0,
    bloomMax: 0,
    bloomDecay: 1,
    bloomDelay: 0,
    recoil: {
      pattern: [[0.075, -0.008]],
      loop: 1,
      jitter: 0.25,
      aim: 0.75,
      recover: 0.9,
      reset: 0.6,
      hold: 0.22,
    },
    kick: { back: 0.18, climb: 0.16 },
    flash: 2,
    trauma: 0.2,
    fireMoveSpeed: 1.6,
    beam: true, // fx: thick lingering trail instead of a tracer
    zoom: { fov: 42, dist: 1.9, sens: 0.65 },
    sockets: { gripR: [0, -0.17, 0.24], gripL: [0, -0.12, 0.5], muzzle: [0, 0.0, 1.22] },
    // railgun: capacitor housing with an olive capacitor bank and coolant lines, twin rails braced by bands,
    // amber field between them, scorched tips, capacitor cell under the grip
    build(m) {
      const g = new THREE.Group();
      g.add(
        B(m.gun, 0.065, 0.15, 0.24, 0, -0.03, 0.06), // stock
        B(m.plate, 0.07, 0.16, 0.03, 0, -0.03, -0.065), // butt pad
        B(m.gun, 0.12, 0.16, 0.52, 0, 0, 0.42), // capacitor housing
        ...ribs(m.scorch, 0.123, 0.1, 0.012, 0, -0.01, 0.22, 0.34, 4), // side heat fins
        B(m.plate, 0.14, 0.05, 0.4, 0, 0.1, 0.44), // capacitor bank
        ...[0.3, 0.38, 0.46, 0.54].map((z) => X(m.gun, 0.024, 0.15, 0, 0.14, z)), // capacitor cans
        C(m.gun, 0.011, 0.44, 0.068, 0.065, 0.62, 6), // coolant lines
        C(m.gun, 0.011, 0.44, -0.068, 0.065, 0.62, 6),
        B(m.gun, 0.03, 0.12, 0.52, -0.045, 0, 0.94), // rails
        B(m.gun, 0.03, 0.12, 0.52, 0.045, 0, 0.94),
        ...[0.74, 0.94, 1.12].map((z) => B(m.gun, 0.135, 0.15, 0.03, 0, 0, z)), // bracing bands
        ...[0.74, 0.94, 1.12].map((z) => B(m.plate, 0.14, 0.02, 0.034, 0, 0.078, z)), // insulators
        B(m.glowHot, 0.03, 0.05, 0.5, 0, 0, 0.94), // field between the rails
        B(m.scorch, 0.035, 0.13, 0.05, -0.045, 0, 1.19), // scorched rail tips
        B(m.scorch, 0.035, 0.13, 0.05, 0.045, 0, 1.19),
        B(m.gun, 0.05, 0.135, 0.065, 0, -0.14, 0.24, -0.3), // pistol grip
        B(m.gun, 0.012, 0.012, 0.08, 0, -0.1, 0.29), // trigger guard
        B(m.plate, 0.08, 0.12, 0.12, 0, -0.14, 0.38), // capacitor cell
        B(m.glow, 0.082, 0.01, 0.06, 0, -0.1, 0.38), // cell charge band
        B(m.glow, 0.13, 0.02, 0.02, 0, 0.08, 0.3), // charge bars
        B(m.glow, 0.13, 0.02, 0.02, 0, 0.08, 0.5),
      );
      return g;
    },
  },
  // Sidearm: semi-auto, accurate, quick to reload. Held out in front with both hands.
  pistol: {
    name: 'KP-12 EMBER',
    short: 'PS',
    semi: true,
    rpm: 330,
    spinUp: 0,
    mag: 12,
    reserve: 72,
    maxReserve: 120,
    infinite: true, // reserve never runs out (magazine, reload and active reload still apply); ammo pickups skip it
    pickup: { crate: 36, drop: 12 },
    ammo: 'light', // pickup class: light (AR, MG, BR) or heavy (SR, RG); infinite guns never take ammo
    reloadTime: 1.2,
    activeReload: { good: [0.3, 0.6], perfect: [0.4, 0.5] },
    damage: 32,
    headMult: 2.5,
    limbMult: 0.8,
    weakMult: 3,
    range: 200,
    falloff: { start: 20, end: 50, min: 0.6 },
    spreadHip: 0.012,
    spreadAim: 0.002,
    spreadMove: 0.008,
    firstShot: { rest: 0.3, hip: 0.6, aim: 0 },
    bloomPerShot: 0.004,
    bloomMax: 0.02,
    bloomDecay: 0.08,
    bloomDelay: 0.08,
    recoil: {
      pattern: [[0.022, 0.002]],
      loop: 1,
      jitter: 0.3,
      aim: 0.6,
      recover: 0.92,
      reset: 0.3,
      hold: 0.09,
    },
    kick: { back: 0.05, climb: 0.22 },
    flash: 0.8,
    trauma: 0.05,
    fireMoveSpeed: null,
    sockets: { gripR: [0, -0.12, 0.33], gripL: [0.02, -0.13, 0.35], muzzle: [0, -0.02, 0.6] },
    // sidearm: serrated slide with sights and an ejection port, olive frame and grip panels, under-rail,
    // scorched compensator, amber power strip
    build(m) {
      const g = new THREE.Group();
      g.add(
        B(m.gun, 0.045, 0.055, 0.26, 0, -0.03, 0.46), // slide
        ...ribs(m.scorch, 0.047, 0.04, 0.006, 0, -0.03, 0.35, 0.39, 4), // rear serrations
        B(m.scorch, 0.047, 0.02, 0.05, 0, -0.012, 0.47), // ejection port
        B(m.gun, 0.008, 0.012, 0.012, 0, 0.003, 0.56), // front sight
        ...ribs(m.scorch, 0.02, 0.004, 0.03, 0, 0.0025, 0.43, 0.53, 3), // lightening cuts on top
        B(m.gun, 0.02, 0.03, 0.02, 0, -0.01, 0.325, 0.5), // hammer
        X(m.gun, 0.006, 0.05, 0, -0.07, 0.39), // slide release
        C(m.scorch, 0.014, 0.012, 0, -0.03, 0.602), // bore
        B(m.gun, 0.03, 0.012, 0.012, 0, 0.003, 0.345), // rear sight
        B(m.plate, 0.04, 0.035, 0.22, 0, -0.07, 0.45), // frame
        B(m.gun, 0.03, 0.012, 0.09, 0, -0.092, 0.5), // under-rail
        B(m.gun, 0.04, 0.12, 0.06, 0, -0.12, 0.34, -0.2), // grip
        B(m.plate, 0.044, 0.08, 0.045, 0, -0.125, 0.34, -0.2), // grip panels
        B(m.gun, 0.01, 0.012, 0.05, 0, -0.1, 0.4), // trigger guard
        B(m.plate, 0.046, 0.025, 0.066, 0, -0.19, 0.33), // magazine base
        B(m.scorch, 0.052, 0.068, 0.05, 0, -0.03, 0.575), // compensator
        B(m.glow, 0.006, 0.02, 0.18, 0.026, -0.03, 0.46), // power strip
      );
      return g;
    },
  },
};

export const GUN_ORDER = ['rifle', 'mg', 'sniper', 'burst', 'rail', 'pistol'];
