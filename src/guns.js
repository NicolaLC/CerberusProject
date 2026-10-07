import * as THREE from 'three';

// Weapon definitions: stats, hand/muzzle sockets on the `Weapon` bone, and the placeholder model.
// Models are authored from the stock (bone pivot, z = 0) forward along +Z.
// Grips must stay within arm reach: see instructions/animation.md.
export const GUNS = {
  rifle: {
    name: 'M-8 AVENGER',
    key: 'Digit1',
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
    spreadHip: 0.022,
    spreadAim: 0.004,
    bloomPerShot: 0.007,
    bloomMax: 0.05,
    bloomDecay: 0.12,
    recoilPitch: 0.012,
    recoilYaw: 0.004,
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
    key: 'Digit2',
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
    spreadHip: 0.034,
    spreadAim: 0.011,
    bloomPerShot: 0.004,
    bloomMax: 0.07,
    bloomDecay: 0.1,
    recoilPitch: 0.0075,
    recoilYaw: 0.011,
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
};

export const GUN_ORDER = ['rifle', 'mg'];
