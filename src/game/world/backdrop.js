import * as THREE from 'three';
import { cityMaterial, makePoints } from '../view/skyline.js';
import { Rng } from '../../engine/random.js';

// `env.backdrop` (level.md): the machine lattice around an open-sky space, far outside the playable bounds (art-style "World:
// machine-first": nothing here is built for living, every shape does one of the HiveMind's jobs). A ring of structures round
// `pos`: low stacked lattice blocks (foundries, hubs), sealed server spires with setback collars, collector masts holding canopy
// arrays up into the dark, cooling stacks breathing steam, gantry cranes. Transit rails join neighbours, pods run along them
// without end; drones patrol (violet sensors), searchlights sweep the haze, the HiveMind's eyes breathe low in the north sky.
// The beacons blink in one wave that crosses the lattice, and the material's cyan lights ride the same kind of wave (one mind).
// No collision, no shadows, no fog (it stands past the fog's far end: a black mass against the dark sky). A deferred piece
// (sectors.js): built with the sector its pos lies in and drawn only with it; its objects are `live` (own draws, animated by
// World.update via animateProps). pos.y lowers the whole lattice for a space high above it (the Skyway: -500); the HiveMind's
// eyes stay in the sky.
// Cost: 6 draws (boxes and stacks instanced, beams instanced, lights and steam point sets).
const LOOK = { fog: new THREE.Color(0x0b1215), density: 0.00045, scale: 600 };
const STEAM = { fog: new THREE.Color(0x0b1215), density: 0.00045, scale: 600 };
const VIOLET = new THREE.Color(0x8c3cff);
const CYAN = new THREE.Color(0x3fe0ff);
const WHITE = new THREE.Color(0xeaf6fa);
const VAPOUR = new THREE.Color(0x2a3a3e);
const JOB = { any: 0, compute: 1, foundry: 2, none: 3 }; // aLit's whole part (skyline.js cityMaterial)
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
let latticeMat = null; // permanent (world.keep), shared by every backdrop: its program and texture are made once

export function buildBackdrop(world, d) {
  const p = d.params ?? {};
  const rng = new Rng(p.seed ?? 1);
  const R = () => rng.next();
  const [near, far] = p.radius ?? [260, 650];
  const n = p.towers ?? 70; // structures
  const [cx, cy, cz] = d.pos; // pos.y: the lattice floor (structures stand from cy - 40); very negative = far below the deck
  const base = cy - 40;
  const root = new THREE.Group();
  root.userData.live = true;

  if (!latticeMat) {
    latticeMat = cityMaterial({ fog: false, light: 0.06 });
    world.keep.add(latticeMat);
  }
  const boxes = []; // [x, y, z, w, h, d, rx, ry, rz, tone, aLit]
  const stacks = []; // [x, y, z, r, h, tone, aLit]
  const beacons = []; // [x, y, z, size]
  const vents = []; // steam sources [x, y, z, r]
  const sites = []; // [x, z, a, top]: rail anchors, by angle
  const box = (x, y, z, w, h, dd, job, light, tone, ry = 0, rx = 0, rz = 0) => boxes.push([x, y, z, w, h, dd, rx, ry, rz, tone, job + light]);

  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.08;
    const r = near + (far - near) * R();
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.cos(a) * r;
    const big = (r / near) ** 0.6; // far structures taller, so the ring reads as a mass rising into the haze
    const tone = 0.09 + R() * 0.07;
    const ry = a + (R() < 0.5 ? 0 : Math.PI / 2); // aligned to the ring: a grid bent round pos, not scattered boxes
    const k = R();
    let top;
    if (k < 0.36) {
      // lattice block: stacked tiers, each narrower; foundries glow low
      const job = R() < 0.4 ? JOB.foundry : JOB.any;
      let w = 60 + R() * 70;
      let dd = 40 + R() * 50;
      let y = base;
      for (let t = 0, tiers = 2 + Math.floor(R() * 3); t < tiers; t++) {
        const h = (24 + R() * 30) * big + (t ? 0 : 40);
        box(x, y, z, w, h, dd, t ? JOB.any : job, 0.5, tone, ry);
        y += h;
        w *= 0.55 + R() * 0.25;
        dd *= 0.55 + R() * 0.25;
      }
      if (job === JOB.foundry) vents.push([x, y + 6, z, 10]);
      top = y;
    } else if (k < 0.56) {
      // server spire: a sealed core, setback collars, a needle; data lines climb it
      const h = (220 + R() * 220) * big;
      const w = 16 + R() * 12;
      box(x, base, z, w, h + 40, w, JOB.compute, 0.9, tone, ry);
      for (let c = 1; c <= 3; c++) box(x, base + ((h + 40) * c) / 4, z, w * 1.7, 8 + R() * 6, w * 1.7, JOB.none, 0, tone * 0.8, ry);
      box(x, base + h + 40, z, 2.5, h * 0.18, 2.5, JOB.none, 0, tone, ry);
      top = base + h * 1.18 + 40;
      beacons.push([x, top + 4, z, 10]);
    } else if (k < 0.71) {
      // collector mast: a thin pylon holding a canopy array up into the dark (it drinks the light before it reaches the ground)
      const h = (240 + R() * 140) * big;
      const cw = 90 + R() * 60;
      box(x, base, z, 6, h + 40, 6, JOB.none, 0, tone, ry);
      for (const s of [-1, 1]) box(x + Math.cos(ry) * s * cw * 0.25, base + h * 0.7, z - Math.sin(ry) * s * cw * 0.25, 2, h * 0.36, 2, JOB.none, 0, tone, ry, 0, s * 0.35); // struts
      box(x, base + h + 40, z, cw, 2.5, cw * (0.6 + R() * 0.3), JOB.any, 0.3, tone * 0.7, ry, (R() - 0.5) * 0.12);
      top = base + h + 40;
      beacons.push([x, top - 3, z, 7]);
    } else if (k < 0.86) {
      // cooling stacks: a pair or three, steam rising
      const h = (110 + R() * 90) * big;
      for (let c = 0, m = 2 + Math.floor(R() * 2); c < m; c++) {
        const sx = x + Math.cos(ry) * (c - (m - 1) / 2) * 50;
        const sz = z - Math.sin(ry) * (c - (m - 1) / 2) * 50;
        const sr = 16 + R() * 10;
        stacks.push([sx, base, sz, sr, h + 40, tone, JOB.any + 0.4]);
        vents.push([sx, base + h + 44, sz, sr]);
      }
      top = base + h * 0.6;
    } else {
      // gantry crane: two legs and a long arm over the lattice
      const h = (90 + R() * 60) * big;
      const span = 160 + R() * 160;
      for (const s of [-1, 1]) box(x + Math.cos(ry) * s * span * 0.3, base, z - Math.sin(ry) * s * span * 0.3, 7, h + 40, 7, JOB.none, 0, tone, ry);
      box(x, base + h + 40, z, span, 7, 9, JOB.none, 0, tone, ry);
      box(x + Math.cos(ry) * span * (R() - 0.5) * 0.6, base + h + 18, z, 14, 22, 14, JOB.any, 0.3, tone * 0.8, ry); // trolley
      top = base + h + 40;
      beacons.push([x + Math.cos(ry) * span * 0.5, top + 8, z - Math.sin(ry) * span * 0.5, 6]);
    }
    sites.push([x, z, a, top]);
  }

  // transit rails: neighbours on the ring joined by a span at a shared height, plus a few chords across it; pods run along them
  const rails = [];
  sites.sort((s, t) => s[2] - t[2]);
  const join = (s, t) => {
    const y = Math.min(s[3], t[3], base + 160) - 20 - R() * 40;
    if (y < base + 50) return;
    const len = Math.hypot(t[0] - s[0], t[1] - s[1]);
    if (len > 420) return;
    const ry = Math.atan2(t[0] - s[0], t[1] - s[1]);
    box((s[0] + t[0]) / 2, y, (s[1] + t[1]) / 2, 5, 3.5, len, JOB.none, 0, 0.08, ry);
    rails.push({ from: new THREE.Vector3(s[0], y + 4, s[1]), to: new THREE.Vector3(t[0], y + 4, t[1]), len });
  };
  for (let i = 0; i < sites.length; i++) if (R() < 0.6) join(sites[i], sites[(i + 1) % sites.length]);
  for (let i = 0; i < (p.rails ?? 8); i++) join(sites[Math.floor(R() * sites.length)], sites[Math.floor(R() * sites.length)]);

  const col = new THREE.Color();
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const blocks = new THREE.InstancedMesh(geo, latticeMat, boxes.length);
  const lit = new Float32Array(boxes.length);
  boxes.forEach(([x, y, z, w, h, dd, rx, ry, rz, tone, l], i) => {
    blocks.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(w, h, dd)));
    blocks.setColorAt(i, col.setRGB(tone * 0.85, tone, tone * 1.1));
    lit[i] = l;
  });
  geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
  blocks.frustumCulled = false;
  root.add(blocks);

  const cyl = new THREE.CylinderGeometry(0.82, 1, 1, 20, 1, true).translate(0, 0.5, 0); // a cooling stack: slight taper, open top
  const tubes = new THREE.InstancedMesh(cyl, latticeMat, Math.max(1, stacks.length));
  const tubeLit = new Float32Array(Math.max(1, stacks.length));
  stacks.forEach(([x, y, z, r, h, tone, l], i) => {
    tubes.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, h, r)));
    tubes.setColorAt(i, col.setRGB(tone * 0.85, tone, tone * 1.1));
    tubeLit[i] = l;
  });
  tubes.count = stacks.length;
  cyl.setAttribute('aLit', new THREE.InstancedBufferAttribute(tubeLit, 1));
  tubes.frustumCulled = false;
  root.add(tubes);

  // lights: beacons in one sweeping wave (phase from position along the wave), the HiveMind's eyes, drones and pods (moved per frame)
  const drones = p.drones ?? 7;
  const PODS = 4;
  const pts = makePoints(beacons.length + 7 + drones + rails.length * PODS, true, LOOK);
  for (const [x, y, z, size] of beacons) pts.put(x, y, z, size, CYAN, 0.9, 1, ((x - cx) * 0.6 + (z - cz) * 0.8) / 1400);
  const hive = [cx + 300, 260, cz - 1500];
  for (let i = 0; i < 7; i++) pts.put(hive[0] + (R() - 0.5) * 220, hive[1] + (R() - 0.5) * 60, hive[2] + (R() - 0.5) * 80, i ? 30 + R() * 30 : 520, VIOLET, i ? 0.8 : 0.35, 4, R());
  const patrol = [];
  for (let i = 0; i < drones; i++) {
    const k = pts.put(0, 0, 0, 5, VIOLET, 1, 3);
    patrol.push({ k, r: 150 + R() * 220, y: 45 + R() * 70, a: R() * 6.28, w: (R() < 0.5 ? -1 : 1) * (0.03 + R() * 0.04) });
  }
  // pods: identical, evenly spaced, one speed: they never stop and never vary
  const pods = [];
  for (const rail of rails) for (let j = 0; j < PODS; j++) pods.push({ k: pts.put(0, 0, 0, 4, WHITE, 0.7, 0), rail, off: j / PODS });
  pts.geometry.setDrawRange(0, pts.count);
  root.add(pts);

  // steam over the stacks and foundries: slow, rising, fading
  const PUFFS = 5;
  const steam = makePoints(Math.max(1, vents.length * PUFFS), false, STEAM);
  const puffs = [];
  for (const [x, y, z, r] of vents) for (let j = 0; j < PUFFS; j++) puffs.push({ k: steam.put(x, y, z, r * 2.2, VAPOUR, 0.5), x, y, z, r, off: j / PUFFS });
  steam.geometry.setDrawRange(0, steam.count);
  root.add(steam);

  // searchlights: thin additive cones from a few spires and masts, sweeping the haze
  const beams = p.searchlights ?? 3;
  const cone = new THREE.ConeGeometry(22, 300, 20, 1, true).translate(0, -150, 0).rotateX(-Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe9f5), transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const sweep = new THREE.InstancedMesh(cone, beamMat, beams);
  sweep.frustumCulled = false;
  const lamps = beacons.slice(-beams).map(([x, y, z], i) => ({ at: new THREE.Vector3(x, y, z), phase: i * 2.1 + R() }));
  root.add(sweep);

  const pos = pts.geometry.attributes.position;
  const spos = steam.geometry.attributes.position;
  const stint = steam.geometry.attributes.tint;
  const time = latticeMat.userData.time;
  root.userData.backdrop = (t) => {
    pts.material.uniforms.time.value = t;
    time.value = t;
    for (const dr of patrol) pos.setXYZ(dr.k, cx + Math.sin(dr.a + t * dr.w) * dr.r, cy + dr.y + Math.sin(t * 0.3 + dr.a) * 6, cz + Math.cos(dr.a + t * dr.w) * dr.r);
    for (const pd of pods) {
      const f = (pd.off + (t * 14) / pd.rail.len) % 1; // 14 m/s on every rail
      _a.lerpVectors(pd.rail.from, pd.rail.to, f);
      pos.setXYZ(pd.k, _a.x, _a.y, _a.z);
    }
    pos.needsUpdate = true;
    for (const pf of puffs) {
      const f = (pf.off + t * 0.05) % 1;
      spos.setXYZ(pf.k, pf.x + f * pf.r * 1.5, pf.y + f * pf.r * 6, pf.z);
      stint.array[pf.k * 4 + 3] = 0.45 * Math.sin(f * Math.PI);
    }
    spos.needsUpdate = true;
    stint.needsUpdate = true;
    lamps.forEach((l, i) => {
      _e.set(-0.35 - 0.25 * Math.sin(t * 0.21 + l.phase), t * 0.17 + l.phase, 0, 'YXZ');
      sweep.setMatrixAt(i, _m.compose(l.at, _q.setFromEuler(_e), _s.set(1, 1, 1)));
    });
    sweep.instanceMatrix.needsUpdate = true;
  };
  root.userData.backdrop(0);
  world.scene.add(root);
  world.props.push(root); // freed with the level / its handle; animateProps runs userData.backdrop
  return root;
}
