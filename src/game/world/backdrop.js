import * as THREE from 'three';
import { cityMaterial, makePoints } from '../view/skyline.js';
import { Rng } from '../../engine/random.js';

// `env.backdrop` (level.md): the dark city around an open-sky space, far outside the playable bounds. Ruined skyscraper silhouettes
// with sparse lit windows (the title's city material, view/skyline.js), drones patrolling in the distance (violet sensor lights), a few
// searchlight beams sweeping the haze and the HiveMind's faint presence in the sky (breathing violet eyes). No collision, no shadows,
// no fog (it stands past the fog's far end: it reads as a silhouette against the dark sky). A deferred piece (sectors.js): built with
// the sector its pos lies in and drawn only with it; its objects are `live` (their own draws, animated by World.update via animateProps).
// Cost: 4 draws (towers instanced, beams instanced, two point sets).
const LOOK = { fog: new THREE.Color(0x0b1215), density: 0.00045, scale: 600 };
const VIOLET = new THREE.Color(0x8c3cff);
const CYAN = new THREE.Color(0x3fe0ff);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
let towerMat = null; // permanent (world.keep), shared by every backdrop: its program and texture are made once

export function buildBackdrop(world, d) {
  const p = d.params ?? {};
  const rng = new Rng(p.seed ?? 1);
  const R = () => rng.next();
  const [near, far] = p.radius ?? [260, 650];
  const n = p.towers ?? 70;
  const [cx, , cz] = d.pos;
  const root = new THREE.Group();
  root.userData.live = true;

  if (!towerMat) {
    towerMat = cityMaterial({ fog: false, windows: 0.045 });
    world.keep.add(towerMat);
  }
  // towers: a ring around pos; about half in ruin (shorter, leaning, a broken slab on top)
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.08;
    const r = near + (far - near) * R();
    const x = cx + Math.sin(a) * r;
    const z = cz + Math.cos(a) * r;
    const w = 18 + R() * 26;
    const dd = 18 + R() * 26;
    let h = (70 + 260 * R() ** 1.8) * (r / near) ** 0.6;
    const tone = 0.1 + R() * 0.08;
    const ruined = R() < 0.5;
    if (ruined) h *= 0.45 + R() * 0.35;
    const lean = ruined && R() < 0.3 ? (R() - 0.5) * 0.25 : 0;
    parts.push([x, -40, z, w, h + 40, dd, lean, R() * 0.6, tone, ruined ? 0.08 : 0.4]); // window light: sparse
    if (ruined && !lean) parts.push([x + (R() - 0.5) * w * 0.3, h - 6, z + (R() - 0.5) * dd * 0.3, w * 0.6, 10 + R() * 12, dd * 0.5, (R() - 0.5) * 0.6, R(), tone * 0.8, 0]);
  }
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const towers = new THREE.InstancedMesh(geo, towerMat, parts.length);
  const lit = new Float32Array(parts.length);
  const col = new THREE.Color();
  parts.forEach(([x, y, z, w, h, dd, lean, ry, tone, l], i) => {
    towers.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(lean, ry, lean * 0.5)), _s.set(w, h, dd)));
    towers.setColorAt(i, col.setRGB(tone * 0.85, tone, tone * 1.1));
    lit[i] = l;
  });
  geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
  towers.frustumCulled = false;
  root.add(towers);

  // lights: beacons on the tall towers, the HiveMind's eyes low in the sky to the north, drone sensors (moved every frame)
  const drones = p.drones ?? 7;
  const tall = parts.filter((t) => t[4] > 200 && t[9] > 0.3).slice(0, 8);
  const pts = makePoints(tall.length + 7 + drones, true, LOOK);
  for (const t of tall) pts.put(t[0], t[1] + t[4] + 4, t[2], 10, CYAN, 0.9, 1);
  const hive = [cx + 300, 260, cz - 1500];
  for (let i = 0; i < 7; i++) pts.put(hive[0] + (R() - 0.5) * 220, hive[1] + (R() - 0.5) * 60, hive[2] + (R() - 0.5) * 80, i ? 30 + R() * 30 : 520, VIOLET, i ? 0.8 : 0.35, 4, R());
  const patrol = [];
  for (let i = 0; i < drones; i++) {
    const k = pts.put(0, 0, 0, 5, VIOLET, 1, 3);
    patrol.push({ k, r: 150 + R() * 220, y: 45 + R() * 70, a: R() * 6.28, w: (R() < 0.5 ? -1 : 1) * (0.03 + R() * 0.04) });
  }
  pts.geometry.setDrawRange(0, pts.count);
  root.add(pts);

  // searchlights: thin additive cones from a few towers, sweeping the haze
  const beams = p.searchlights ?? 3;
  const cone = new THREE.ConeGeometry(22, 300, 20, 1, true).translate(0, -150, 0).rotateX(-Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xbfe9f5), transparent: true, opacity: 0.028, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const sweep = new THREE.InstancedMesh(cone, beamMat, beams);
  sweep.frustumCulled = false;
  const lamps = parts.filter((t) => t[9] > 0.3).slice(-beams).map((t, i) => ({ at: new THREE.Vector3(t[0], t[1] + t[4], t[2]), phase: i * 2.1 + R() }));
  root.add(sweep);

  const pos = pts.geometry.attributes.position;
  root.userData.backdrop = (t) => {
    pts.material.uniforms.time.value = t;
    for (const dr of patrol) pos.setXYZ(dr.k, cx + Math.sin(dr.a + t * dr.w) * dr.r, dr.y + Math.sin(t * 0.3 + dr.a) * 6, cz + Math.cos(dr.a + t * dr.w) * dr.r);
    pos.needsUpdate = true;
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
