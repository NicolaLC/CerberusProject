import * as THREE from 'three';
import { pattern } from './ballistics.js';

// Weapon definitions: stats, hand/muzzle sockets on the `Weapon` bone, and the placeholder model.
// Angles in radians. Spread values are cone half-angles. See instructions/gameplay.md (Gunplay).
// Models are authored from the stock (bone pivot, z = 0) forward along +Z.
// Grips must stay within arm reach: see instructions/animation.md.
export const GUNS = {
  rifle: {
    name: 'M-8 AVENGER',
    short: 'AR',
    rpm: 540,
    spinUp: 0, // seconds to reach full rpm
    mag: 32,
    reserve: 192,
    maxReserve: 384,
    pickup: { crate: 96, drop: 32 },
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
    build(m, box) {
      const g = new THREE.Group();
      g.add(box(0.06, 0.12, 0.2, m.gun, 0, -0.01, 0.05)); // stock
      g.add(box(0.08, 0.14, 0.44, m.gun, 0, 0, 0.36)); // receiver
      g.add(box(0.05, 0.05, 0.3, m.gun, 0, 0.02, 0.72)); // barrel
      g.add(box(0.06, 0.15, 0.07, m.gun, 0, -0.12, 0.22)); // pistol grip
      g.add(box(0.02, 0.03, 0.36, m.glow, -0.045, 0.03, 0.36));
      g.add(box(0.05, 0.05, 0.12, m.gun, 0, 0.1, 0.3)); // sight
      return g;
    },
  },
  mg: {
    name: 'M-76 REVENANT',
    short: 'MG',
    rpm: 780,
    spinUp: 0.4,
    mag: 90,
    reserve: 270,
    maxReserve: 450,
    pickup: { crate: 135, drop: 45 },
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
    build(m, box) {
      const g = new THREE.Group();
      g.add(box(0.08, 0.15, 0.22, m.gun, 0, -0.02, 0.06)); // stock
      g.add(box(0.12, 0.18, 0.5, m.gun, 0, 0, 0.4)); // receiver
      g.add(box(0.16, 0.16, 0.16, m.plate, -0.02, -0.17, 0.42)); // ammo box
      g.add(box(0.09, 0.09, 0.42, m.gun, 0, 0.02, 0.86)); // barrel shroud
      g.add(box(0.04, 0.04, 0.12, m.gun, 0, 0.03, 1.1)); // muzzle brake
      g.add(box(0.06, 0.16, 0.07, m.gun, 0, -0.14, 0.24)); // pistol grip
      g.add(box(0.05, 0.05, 0.22, m.gun, 0, 0.14, 0.38)); // carry handle
      g.add(box(0.02, 0.04, 0.5, m.glowHot, -0.065, 0.02, 0.42));
      g.add(box(0.13, 0.02, 0.02, m.glowHot, 0, 0.1, 0.62));
      return g;
    },
  },
  // Precision rifle: semi-auto (one round per click), a slow bolt cycle, pin-point when scoped,
  // poor from the hip. Body shot kills a puppet, headshot kills a trooper.
  sniper: {
    name: 'M-29 LANCE',
    short: 'SR',
    semi: true,
    rpm: 70, // bolt cycle ~0.86 s
    spinUp: 0,
    mag: 5,
    reserve: 25,
    maxReserve: 40,
    pickup: { crate: 10, drop: 3 },
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
    build(m, box) {
      const g = new THREE.Group();
      g.add(box(0.06, 0.15, 0.26, m.gun, 0, -0.03, 0.06)); // stock
      g.add(box(0.03, 0.05, 0.16, m.plate, 0, 0.05, 0.08)); // cheek rest
      g.add(box(0.08, 0.12, 0.5, m.gun, 0, 0, 0.42)); // receiver
      g.add(box(0.04, 0.04, 0.6, m.gun, 0, 0.02, 0.96)); // long barrel
      g.add(box(0.07, 0.07, 0.08, m.gun, 0, 0.02, 1.26)); // muzzle brake
      g.add(box(0.06, 0.15, 0.07, m.gun, 0, -0.12, 0.24)); // pistol grip
      g.add(box(0.06, 0.07, 0.34, m.gun, 0, 0.12, 0.36)); // scope
      g.add(box(0.05, 0.05, 0.02, m.glow, 0, 0.12, 0.535)); // scope lens
      g.add(box(0.02, 0.025, 0.42, m.glow, 0.045, 0.02, 0.4));
      return g;
    },
  },
  // Burst rifle: one pull = 3 rounds at a high cyclic rate, then a short pause (holding repeats bursts).
  // Tight cone and a small, mostly vertical kick: the mid-range precision gun.
  burst: {
    name: 'M-15 VINDICATOR',
    short: 'BR',
    burst: 3,
    burstDelay: 0.3, // s between bursts
    rpm: 900, // within a burst
    spinUp: 0,
    mag: 24,
    reserve: 144,
    maxReserve: 288,
    pickup: { crate: 72, drop: 24 },
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
    build(m, box) {
      const g = new THREE.Group();
      g.add(box(0.06, 0.13, 0.22, m.gun, 0, -0.02, 0.06)); // stock
      g.add(box(0.08, 0.13, 0.46, m.gun, 0, 0, 0.38)); // receiver
      g.add(box(0.07, 0.06, 0.3, m.plate, 0, -0.02, 0.7)); // handguard
      g.add(box(0.035, 0.035, 0.18, m.gun, 0, 0.02, 0.86)); // barrel
      g.add(box(0.05, 0.14, 0.07, m.gun, 0, -0.12, 0.22)); // pistol grip
      g.add(box(0.04, 0.12, 0.06, m.gun, 0, -0.12, 0.34)); // magazine
      g.add(box(0.05, 0.06, 0.16, m.gun, 0, 0.1, 0.32)); // optic
      g.add(box(0.04, 0.04, 0.02, m.glow, 0, 0.1, 0.405)); // optic lens
      g.add(box(0.015, 0.025, 0.12, m.glow, 0.045, 0, 0.3));
      g.add(box(0.015, 0.025, 0.12, m.glow, 0.045, 0, 0.46));
      return g;
    },
  },
  // Railgun: the shot charges for a moment after the pull (let go and it still fires), then a slug crosses
  // the whole line, piercing every enemy on it until it meets a wall or armor. Light zoom, no scope.
  rail: {
    name: 'ARC-9 TEMPEST',
    short: 'RG',
    semi: true,
    charge: 0.45, // s from the pull to the shot
    pierce: 4, // enemies one slug can pass through
    rpm: 55,
    spinUp: 0,
    mag: 4,
    reserve: 16,
    maxReserve: 24,
    pickup: { crate: 8, drop: 2 },
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
    build(m, box) {
      const g = new THREE.Group();
      g.add(box(0.07, 0.15, 0.24, m.gun, 0, -0.03, 0.06)); // stock
      g.add(box(0.12, 0.16, 0.52, m.gun, 0, 0, 0.42)); // capacitor housing
      g.add(box(0.14, 0.06, 0.4, m.plate, 0, 0.1, 0.44)); // top plate
      g.add(box(0.03, 0.12, 0.52, m.gun, -0.045, 0, 0.94)); // rail L
      g.add(box(0.03, 0.12, 0.52, m.gun, 0.045, 0, 0.94)); // rail R
      g.add(box(0.03, 0.05, 0.5, m.glowHot, 0, 0, 0.94)); // field between the rails
      g.add(box(0.06, 0.16, 0.07, m.gun, 0, -0.14, 0.24)); // pistol grip
      g.add(box(0.13, 0.02, 0.02, m.glow, 0, 0.08, 0.3));
      g.add(box(0.13, 0.02, 0.02, m.glow, 0, 0.08, 0.5));
      return g;
    },
  },
  // Sidearm: semi-auto, accurate, quick to reload. Held out in front with both hands.
  pistol: {
    name: 'M-6 PALADIN',
    short: 'PS',
    semi: true,
    rpm: 330,
    spinUp: 0,
    mag: 12,
    reserve: 72,
    maxReserve: 120,
    pickup: { crate: 36, drop: 12 },
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
    build(m, box) {
      const g = new THREE.Group();
      g.add(box(0.045, 0.06, 0.26, m.gun, 0, -0.03, 0.46)); // slide
      g.add(box(0.04, 0.04, 0.22, m.plate, 0, -0.07, 0.45)); // frame
      g.add(box(0.04, 0.12, 0.06, m.gun, 0, -0.12, 0.35)); // grip
      g.add(box(0.012, 0.02, 0.18, m.glow, 0.026, -0.03, 0.46));
      return g;
    },
  },
};

export const GUN_ORDER = ['rifle', 'mg', 'sniper', 'burst', 'rail', 'pistol'];
