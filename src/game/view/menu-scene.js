import * as THREE from 'three';
import { Rig, Animator } from '../actors/rig.js';
import { buildSoldier } from '../actors/soldier.js';
import { buildCerberus } from '../actors/cerberus-model.js';
import { droneMaterials, droneLook, ROTORS } from '../actors/drone.js';
import { GUNS, gunMaterials } from '../combat/guns.js';
import { RigidSkin, mergeGroup } from '../../engine/batch.js';
import { panelTexture, applyWorldUVs } from '../world/textures.js';
import { propMaterials, PROP_PIECES } from '../world/props.js';
import { cyl, group } from '../actors/parts.js';
import { Rng } from '../../engine/random.js';
import { cityMaterial, makePoints as skylinePoints } from './skyline.js';

// Main menu backdrop (instructions/architecture.md "Main menu and save"): a self-contained set, not a game level. STEM-00
// sits on the edge of a service block's roof, legs over the drop, looking over IO's machine lattice (art-style "World: machine-first",
// gdd 2.1, 2.9) toward the HiveMind's guardian CERBERUS: a colossal three-headed quadruped war mech standing on the horizon, sunk in the
// haze, sensed more than seen (violet sensor eyes breathing). The lattice is what world/backdrop.js builds in game: stacked blocks
// (foundries glow low), sealed server spires with setback collars, collector masts holding canopy arrays, cooling stacks breathing
// steam, gantry cranes, joined by transit rails with identical pods that never stop; a few units are derelict (a slumped tier, a
// snapped mast: broken machinery). Beacons blink in one wave; VIGIL drones patrol with searchlights.
// Reuses: the player rig, soldier parts and SEATED pose, the rifle, the drone look, the prop builders and materials, the
// weathered panel texture. Shell renders it with the game's renderer only while the title is up: no game system runs.
// Budget: about 52 draws and 375k triangles, the lattice and the drones instanced, the roof merged, no shadows.
const ROOF = -0.3; // top of the hero tower's body (the roof slab sits on it, its top at y = 0)
const GROUND = -420; // city floor
const FOG = new THREE.Color(0x2e6f78); // art-style haze
const FOG_DENSITY = 0.0012;
const ZENITH = new THREE.Color(0x0b1118);
const SUN = new THREE.Vector3(0.2, 0.16, -1).normalize(); // cold white smear behind the HiveMind
const CYAN = new THREE.Color(0x3fe0ff);
const WHITE = new THREE.Color(0xeaf6fa); // work lamps (pods)
const VIOLET = new THREE.Color(0x8c3cff); // sensors (art-style 5: VISOR)
const FIRE = new THREE.Color(0x8a3a1c); // foundry heat: a dull ember (art-style World: machine-first)
const TOWER = { x: [-0.8, 27.2], z: [-2, 26] }; // the hero tower's footprint
const STEM = new THREE.Vector3(TOWER.x[0] + 0.3, 0, TOWER.z[0] + 1.6); // STEM-00's root: seated on the roof's left edge, knees at the edge
const HIVE = new THREE.Vector3(620, GROUND, -3400); // CERBERUS's feet, mid screen
const HIVE_SCALE = 46; // the 14 m model as a ~640 m colossus on the horizon
const HIVE_DIST = Math.hypot(HIVE.x, HIVE.z);
const FACING = -2.17; // STEM-00's body: out over the left edge, turned toward the city ahead (a side view from the camera)
const GAZE = Math.atan2(HIVE.x - STEM.x, HIVE.z - STEM.z); // where its head turns: the HiveMind
// the camera floats off the tower's left face, behind STEM-00: STEM-00 on the right third, the drop and the city on the left
const CAM = { dist: 7.5, height: 1.6, yaw: -0.08, pitch: -0.1, offset: -0.3, fov: 38 };
const DRONES = 44;
const FORMATION = 7; // a wedge crossing the skyline
const SMOKE_PER = 18;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _size = new THREE.Vector2();
const ZERO = new THREE.Vector2();
const set3 = (a, i, x, y, z) => {
  a[i * 3] = x;
  a[i * 3 + 1] = y;
  a[i * 3 + 2] = z;
};

// the sky's colour by view direction: haze at the horizon, dark overhead, the sun smeared sideways through the haze
const makePoints = (n, additive) => skylinePoints(n, additive, { fog: FOG, density: FOG_DENSITY, scale: 800 }); // shared with the in-game backdrop (skyline.js)
const SKY_UNIFORMS = { horizon: { value: FOG }, zenith: { value: ZENITH }, sun: { value: SUN } };
const SKY_GLSL = /* glsl */ `
  uniform vec3 horizon, zenith, sun;
  vec3 sky(vec3 d) {
    vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.6, d.y));
    float s = max(dot(d, sun), 0.0);
    float smear = exp(-abs(d.y - sun.y) * 30.0) * pow(s, 6.0);
    return c + vec3(0.85, 0.95, 1.0) * (pow(s, 40.0) * 0.4 + pow(s, 6.0) * 0.12 + smear * 0.3);
  }`;

// haze band texture: soft blobs, opaque at the bottom fading to nothing at the top, tiles horizontally
function hazeTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 90; i++) {
    const x = rng.next() * 512;
    const y = 40 + rng.next() * 100;
    const r = 30 + rng.next() * 70;
    for (const dx of [-512, 0, 512]) {
      const grd = g.createRadialGradient(x + dx, y, 0, x + dx, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x + dx - r, y - r, r * 2, r * 2);
    }
  }
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.55, 'rgba(0,0,0,0.6)');
  v.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = v;
  g.fillRect(0, 0, 512, 128);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a stand-in World for the prop builders (props.js): they bake into `scene` (the roof group); colliders are dropped
function propWorld(scene) {
  const w = { scene, dressing: propMaterials(), staticMeshes: [], props: [], consoles: [], keep: new Set(), mats: {} };
  w.box = () => {
    const m = new THREE.Mesh();
    w.staticMeshes.push(m);
    return m;
  };
  return w;
}

export class MenuScene {
  static frames = 0; // frames rendered, all instances (menu smoke test)
  static view = null; // debug / screenshot scripts: { pos: [x, y, z], at: [x, y, z] } replaces the menu camera

  constructor(renderer) {
    this.renderer = renderer;
    this.t = 0;
    this.mouse = new THREE.Vector2();
    this.look = new THREE.Vector2(); // damped mouse parallax
    addEventListener('pointermove', (e) => this.mouse.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1));
    const rng = new Rng(7);
    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.FogExp2(FOG, FOG_DENSITY);
    this.camera = new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 5000);

    scene.add(new THREE.HemisphereLight(0x5f8f98, 0x0b1118, 1.4));
    const sun = new THREE.DirectionalLight(0xeaf6fa, 2.2); // from the haze ahead: STEM-00 rim-lit, a silhouette
    sun.position.copy(SUN).multiplyScalar(100);
    scene.add(sun);
    const core = new THREE.PointLight(0xffb347, 3, 3, 2); // STEM-00's core spilling on its knees and the ledge
    core.position.set(STEM.x + Math.sin(FACING) * 0.4, 0.5, STEM.z + Math.cos(FACING) * 0.4);
    scene.add(core);

    this.beacons = [];
    this.fires = [];
    this.#sky(scene);
    this.#city(scene, rng);
    this.#hive(scene);
    this.#roof(scene);
    this.#stem(scene);
    this.#haze(scene, rng);
    this.#drones(scene, rng);
    this.#fit();
  }

  #sky(scene) {
    const mat = new THREE.ShaderMaterial({
      uniforms: SKY_UNIFORMS,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        ${SKY_GLSL}
        varying vec3 vDir;
        void main() {
          gl_FragColor = vec4(sky(normalize(vDir)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), mat);
    this.sky.renderOrder = -1;
    scene.add(this.sky);
  }

  // The machine lattice (art-style "World: machine-first", same pieces as world/backdrop.js): one InstancedMesh of unit boxes (base
  // at y 0) plus one of cooling stacks, in a wedge ahead of the camera. Lots on a regular grid each hold a job: stacked lattice
  // blocks (foundries glow low), sealed server spires with setback collars and a needle, collector masts holding canopy arrays,
  // cooling stacks breathing steam, gantry cranes; a few units are derelict (a tier slumped, a mast snapped: broken machinery).
  // Rails join neighbours at a shared height and identical pods run along them without end; beacons blink in one sync wave.
  // Server spires stand on the horizon (gdd 2.6). `aLit` = job + light (skyline.js cityMaterial).
  #city(scene, rng) {
    const parts = []; // [x, y, z, w, h, d, rx, rz, ry, color, aLit]
    const stacks = []; // cooling stacks: [x, y, z, r, h, color, aLit]
    const strips = []; // network-cyan rail lines: [x, y, z, w, h, d, ry]
    const vents = []; // steam sources: [x, y, z]
    const rows = []; // rail anchors per grid row: [x, z, top]
    const ANY = 0;
    const COMPUTE = 1;
    const FOUNDRY = 2;
    const NONE = 3;
    const col = new THREE.Color();
    const tint = (t) => new THREE.Color(t * 0.85, t, t * 1.08);
    const add = (x, y, z, w, h, d, color, lit, rx = 0, rz = 0, ry = 0) => parts.push([x, y, z, w, h, d, rx, rz, ry, color, lit]);
    const R = () => rng.next();
    const [x0, x1] = TOWER.x;
    const [z0, z1] = TOWER.z;
    add((x0 + x1) / 2, GROUND, (z0 + z1) / 2, x1 - x0, ROOF - GROUND, z1 - z0, 0x30383d, NONE + 0.5); // the hero tower: a sealed service block
    const STEP = 56;
    for (let z = 20; z > -2300; z -= STEP) {
      const row = [];
      for (let x = -2000; x < 2000; x += STEP) {
        if (Math.abs(x) > 80 + (20 - z) * 1.05) continue; // outside the view wedge
        if (x > -50 && x < 60 && z > -40) continue; // the hero tower's lot
        if (R() < 0.1) continue; // a gap in the lattice (a pit, a lane)
        const px = x + (R() - 0.5) * 8;
        const pz = z + (R() - 0.5) * 8;
        // heights stay under CERBERUS in its sightline, so the hound reads whole against the sky
        let cap = Math.hypot(px, pz) < 160 ? 330 : 1e9;
        const along = (px * HIVE.x + pz * HIVE.z) / HIVE_DIST;
        if (along > 0 && Math.abs(px * HIVE.z - pz * HIVE.x) / HIVE_DIST < 60 + along * 0.13) cap = Math.min(cap, Math.max(30, -GROUND - 0.1 * along));
        const t = 0.32 + R() * 0.14;
        const c = tint(t);
        const k = R();
        const derelict = R() < 0.1;
        let top;
        if (k < 0.44) {
          // lattice block: stacked tiers, each narrower; foundries glow low and vent
          const job = R() < 0.4 ? FOUNDRY : ANY;
          let w = 56 + R() * 34;
          let d = 50 + R() * 30;
          let y = GROUND;
          const tiers = 3 + Math.floor(R() * 3);
          const budget = Math.min(cap, 60 + 150 * R() ** 1.6);
          for (let i = 0; i < tiers; i++) {
            const h = (budget / tiers) * (0.7 + R() * 0.6) * (i ? 1 : 1.3);
            const slump = derelict && i === tiers - 1;
            add(px, y, pz, w, slump ? h * 0.5 : h, d, c, (i ? ANY : job) + 0.5, slump ? 0.22 : 0, slump ? 0.18 : 0);
            y += h;
            w *= 0.62 + R() * 0.2;
            d *= 0.62 + R() * 0.2;
          }
          if (derelict) for (let i = 0; i < 3; i++) add(px + (R() - 0.5) * w * 2, y - 8, pz + (R() - 0.5) * d * 2, 0.8, 10 + R() * 18, 0.8, 0x1c1f22, NONE, (R() - 0.5) * 0.6, (R() - 0.5) * 0.6); // bare struts
          if (job === FOUNDRY) {
            vents.push([px, y + 4, pz]);
            if (R() < 0.5) this.fires.push([px, y * 0.5 + GROUND * 0.5, pz, 3 + R() * 3]); // ember seam
          }
          top = y;
        } else if (k < 0.62) {
          // server spire: a sealed core, setback collars, a needle; data lines climb it
          const h = Math.min(cap, 140 + 260 * R() ** 1.6 + (R() < 0.04 ? 260 : 0));
          const w = 14 + R() * 10;
          add(px, GROUND, pz, w, h, w, c, COMPUTE + 0.9);
          for (let i = 1; i <= 3; i++) add(px, GROUND + (h * i) / 4, pz, w * 1.7, 5 + R() * 5, w * 1.7, tint(t * 0.8), NONE);
          add(px, GROUND + h, pz, 2.5, Math.min(cap, h * 1.18) - h + 4, 2.5, c, NONE);
          top = GROUND + h;
          if (h > 200 && R() < 0.5) this.beacons.push([px, top + h * 0.18 + 4, pz]);
        } else if (k < 0.76) {
          // collector mast: a thin pylon holding a canopy array up into the dark
          const h = Math.min(cap, 160 + R() * 160);
          const cw = 60 + R() * 50;
          const snapped = derelict;
          add(px, GROUND, pz, 5, snapped ? h * 0.6 : h, 5, c, NONE, 0, snapped ? 0.05 : 0);
          if (!snapped) {
            for (const s of [-1, 1]) add(px + s * cw * 0.2, GROUND + h * 0.62, pz, 1.8, h * 0.38, 1.8, c, NONE, 0, s * 0.3);
            add(px, GROUND + h, pz, cw, 2.2, cw * (0.6 + R() * 0.3), tint(t * 0.7), ANY + 0.3, (R() - 0.5) * 0.1);
            if (R() < 0.6) this.beacons.push([px, GROUND + h + 5, pz]);
          }
          top = GROUND + h * 0.62;
        } else if (k < 0.9) {
          // cooling stacks: two or three, steam rising
          const h = Math.min(cap, 80 + R() * 90);
          const n = 2 + Math.floor(R() * 2);
          for (let i = 0; i < n; i++) {
            const sx = px + (i - (n - 1) / 2) * 34;
            const r = 11 + R() * 6;
            stacks.push([sx, GROUND, pz, r, h, c, ANY + 0.4]);
            if (!derelict) vents.push([sx, GROUND + h + 3, pz]);
          }
          top = GROUND + h * 0.6;
        } else {
          // gantry crane: two legs and a long arm over the lattice
          const h = Math.min(cap, 70 + R() * 70);
          const span = 100 + R() * 90;
          for (const s of [-1, 1]) add(px + s * span * 0.3, GROUND, pz, 6, h, 6, c, NONE);
          add(px, GROUND + h, pz, span, 6, 8, c, NONE, 0, derelict ? 0.12 : 0);
          add(px + span * (R() - 0.5) * 0.6, GROUND + h - 18, pz, 12, 20, 12, tint(t * 0.8), ANY + 0.3); // trolley
          top = GROUND + h;
          if (R() < 0.5) this.beacons.push([px + span * 0.5, top + 7, pz]);
        }
        row.push([px, pz, top]);
      }
      rows.push(row);
    }
    // server spires on the horizon (gdd 2.6): stacked tapering tiers with fins and a needle
    for (const [sx, sz, sh] of [[700, -1300, 1150], [-1000, -1600, 900], [1400, -1850, 820]]) {
      const c = tint(0.24);
      let y = GROUND;
      let w = 110;
      for (let i = 0; i < 6; i++) {
        const th = sh * (0.24 - i * 0.025);
        add(sx, y, sz, w, th, w, c, COMPUTE + 0.9);
        add(sx, y + th, sz, w * 1.35, 9, w * 1.35, c, NONE); // setback collar
        for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(sx + (fx * w) / 2, y, sz + (fz * w) / 2, fx ? 6 : w * 0.18, th * 0.9, fz ? 6 : w * 0.18, c, NONE, fz * 0.08, -fx * 0.08);
        y += th;
        w *= 0.74;
      }
      add(sx, y, sz, 4, sh * 0.22, 4, c, NONE);
      this.beacons.push([sx, y + sh * 0.22, sz]);
    }
    // transit rails: neighbours in a row, and the row behind, joined at a shared height; identical pods run along them
    this.pods = [];
    const join = (s, t) => {
      const y = Math.min(s[2], t[2], GROUND + 260) - 12 - R() * 25;
      const len = Math.hypot(t[0] - s[0], t[1] - s[1]);
      if (y < GROUND + 30 || len > 200) return;
      const ry = Math.atan2(t[0] - s[0], t[1] - s[1]);
      const mx = (s[0] + t[0]) / 2;
      const mz = (s[1] + t[1]) / 2;
      add(mx, y, mz, 5, 3.5, len, 0x14181a, NONE, 0, 0, ry);
      strips.push([mx, y + 3.5, mz, 1, 0.5, len, ry]);
      const rail = { from: new THREE.Vector3(s[0], y + 6, s[1]), to: new THREE.Vector3(t[0], y + 6, t[1]), len };
      for (let j = 0; j < 4; j++) this.pods.push({ rail, off: j / 4 });
    };
    rows.forEach((row, i) => {
      for (let j = 1; j < row.length; j++) if (R() < 0.8) join(row[j - 1], row[j]);
      if (i) for (const s of row) if (R() < 0.45) { const t = rows[i - 1][Math.floor(R() * rows[i - 1].length)]; if (t) join(s, t); }
    });

    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const city = new THREE.InstancedMesh(geo, (this.cityMat = cityMaterial()), parts.length);
    const lit = new Float32Array(parts.length);
    parts.forEach(([x, y, z, w, h, d, rx, rz, ry, color, l], i) => {
      city.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(w, h, d)));
      city.setColorAt(i, color instanceof THREE.Color ? color : col.set(color));
      lit[i] = l;
    });
    geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
    city.frustumCulled = false; // spans the whole view
    scene.add(city);

    const cyl = new THREE.CylinderGeometry(0.82, 1, 1, 20, 1, true).translate(0, 0.5, 0); // a cooling stack: slight taper, open top
    const tubes = new THREE.InstancedMesh(cyl, this.cityMat, Math.max(1, stacks.length));
    const tubeLit = new Float32Array(Math.max(1, stacks.length));
    stacks.forEach(([x, y, z, r, h, color, l], i) => {
      tubes.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, h, r)));
      tubes.setColorAt(i, color);
      tubeLit[i] = l;
    });
    tubes.count = stacks.length;
    cyl.setAttribute('aLit', new THREE.InstancedBufferAttribute(tubeLit, 1));
    tubes.frustumCulled = false;
    scene.add(tubes);

    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.6) }), Math.max(1, strips.length));
    strips.forEach(([x, y, z, w, h, d, ry], i) => strip.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(w, h, d))));
    strip.count = strips.length;
    strip.frustumCulled = false;
    scene.add(strip);
    this.vents = vents;
  }

  // CERBERUS, the HiveMind's guardian (gdd 2.2): a colossal quadruped war mech standing on the horizon past the spires, three
  // quarters toward the city, sunk in the haze (art-style 5). A low wide pill hull banded by seam rings under rounded armour shells (carapace, pauldrons, haunches), a
  // launcher tube on its back, four digitigrade legs (rounded thigh and shin shells, joint discs, pistons, splayed claws) and its
  // three heads: VIGIL, the sensor head with the gun jutting forward, LEGION and COLOSSUS, the sleek gun pods on its shoulders.
  // Shaded by its own material: a tone darker than the sky (lighter on top), backlit by the sun's rim, faded into the haze
  // toward its feet. Violet sensor eyes breathe; the heads scan, the hull shifts its weight. Nine draws.
  #hive(scene) {
    const shade = (tone, rim) =>
      new THREE.ShaderMaterial({
        uniforms: { ...SKY_UNIFORMS, tone: { value: new THREE.Color(tone) }, rim: { value: rim }, base: { value: GROUND + 60 }, top: { value: GROUND + 520 } },
        vertexShader: /* glsl */ `
          varying vec3 vW; varying vec3 vN;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          ${SKY_GLSL}
          uniform vec3 tone; uniform float rim, base, top;
          varying vec3 vW; varying vec3 vN;
          void main() {
            vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
            vec3 c = tone * (0.6 + 0.55 * (n.y * 0.5 + 0.5) + 0.25 * max(dot(n, vec3(-0.6, 0.2, 0.75)), 0.0)); // sky above, the city's glow on the left
            float edge = pow(1.0 - max(dot(n, v), 0.0), 2.5);
            c += vec3(0.75, 0.9, 0.95) * rim * edge * max(dot(n, sun) + 0.45, 0.0); // backlit rim from the sun behind it
            float k = smoothstep(base, top, vW.y); // the haze swallows it toward its feet
            gl_FragColor = vec4(mix(sky(-v), c, 0.62 + 0.3 * k), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
    const P = shade(0x1e2b31, 1.4); // armour plates
    const D = shade(0x05090b, 0.35); // frame, joints, pistons, barrels
    // the shared body (cerberus-model.js) in the haze shades: plates P, everything else D (its lenses are the point lights below)
    const model = buildCerberus({ shell: P, frame: D, trim: D, eye: D, heads: [P, P, P], weak: [D, D, D] });
    for (const g of model.looks) mergeGroup(g);
    const mech = model.root;
    mech.position.copy(HIVE);
    mech.scale.setScalar(HIVE_SCALE);
    mech.rotation.y = Math.atan2(-HIVE.x, -HIVE.z) + 0.7; // three quarters toward the city and STEM-00, its right flank to the camera
    scene.add(mech);
    this.torso = model.body; // shifts its weight over the planted legs
    this.torsoY = model.body.position.y;
    const [vigil, legion, colossus] = model.heads.map((h) => h.bone);
    this.heads = [legion, vigil, colossus];
    // sensor eyes and joint rings; their own light fog (the haze is in the shade already)
    const lights = (this.hiveLights = makePoints(model.sensors.length, true));
    lights.material.uniforms.fogDensity.value = 0.00028;
    this.hiveSensors = model.sensors.map((x) => [x.obj, x.pos, lights.put(0, 0, 0, x.size * HIVE_SCALE * 0.45, VIOLET, x.head < 0 ? 1.4 : 2.6, 4, Math.max(0, x.head) * 0.33)]);
    scene.add(lights);
  }

  // The hero tower's roof: slab and parapet in the weathered panels, an antenna mast (parts.js primitives in the prop
  // materials), and set dressing from the prop builders (props.js): crates as AC units, a console, pipes, cables, hazard
  // stripes at the broken corner. Merged into one mesh per material.
  #roof(scene) {
    const roof = new THREE.Group();
    const W = propWorld(roof);
    const M = W.dressing;
    const wall = new THREE.MeshStandardMaterial({ map: panelTexture({ tint: '#787f82', grime: 0.6 }), roughness: 0.82, metalness: 0.25 });
    const floor = new THREE.MeshStandardMaterial({ map: panelTexture({ tint: '#5a5f62', grime: 0.8 }), roughness: 0.7, metalness: 0.25 });
    const slab = (mat, w, h, d, x, y, z, rz = 0) => {
      const g = new THREE.BoxGeometry(w, h, d);
      applyWorldUVs(g, _p.set(x, y, z));
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, y, z);
      m.rotation.z = rz;
      roof.add(m);
    };
    const [x0, x1] = TOWER.x;
    const [z0, z1] = TOWER.z;
    slab(floor, x1 - x0, 0.3, z1 - z0, (x0 + x1) / 2, -0.15, (z0 + z1) / 2);
    // parapet: broken away at STEM-00's corner, stubs, then the run along the front; a low lip on the left face
    slab(wall, 0.9, 0.3, 0.3, 2.0, 0.12, z0 + 0.15, 0.25);
    slab(wall, x1 - 3.4, 0.6, 0.3, (3.4 + x1) / 2, 0.3, z0 + 0.15);
    slab(wall, 0.3, 0.6, z1 - z0 - 6, x1 - 0.15, 0.3, (z0 + z1 + 6) / 2);
    slab(wall, 0.25, 0.12, z1 - z0 - 3, x0 + 0.12, 0.06, (z0 + z1 + 3) / 2);
    slab(wall, 0.5, 0.25, 0.4, 1.6, 0.12, -0.6, 0.6); // debris from the parapet
    slab(wall, 0.35, 0.2, 0.3, 2.6, 0.1, -0.9, 0.3);
    slab(wall, 0.3, 0.15, 0.3, 0.1, 0.08, 0.6, 0.2);
    // antenna mast with cross bars and stays
    const ax = 5.2;
    const az = -0.7;
    roof.add(
      cyl(M.dark, 0.1, 0.14, 22, ax, 11, az, 0, 0, 0, 6),
      cyl(M.metal, 0.03, 0.03, 1.8, ax, 6, az, 0, 0, Math.PI / 2, 4),
      cyl(M.metal, 0.03, 0.03, 1.3, ax, 12, az, 0, 0, Math.PI / 2, 4),
      cyl(M.metal, 0.03, 0.03, 0.9, ax, 17, az, 0, 0, Math.PI / 2, 4),
      cyl(M.dark, 0.02, 0.02, 11, ax + 0.8, 5.4, az, 0, 0, 0.16, 4),
      cyl(M.dark, 0.02, 0.02, 11, ax, 5.4, az + 0.9, -0.16, 0, 0, 4),
      cyl(M.metal, 0.8, 0.15, 0.3, ax + 0.4, 9, az + 0.2, 0.9, 0, -0.4, 14), // dish
    );
    this.beacons.push([ax, 22.3, az]);
    // set dressing through the prop builders
    const P = (id, pos, yaw = 0, params = {}) => PROP_PIECES[id].build(W, { id, pos, yaw, params });
    P('prop.crate', [5.0, 0, 2.6], 0, { size: 'large' }); // AC units and stores
    P('prop.crate', [6.9, 0, 2.6], 0, { size: 'large' });
    P('prop.crate', [6.2, 0, 4.7], Math.PI / 2, { size: 'medium' });
    P('prop.crate', [3.4, 0, 6.5], 0, { size: 'small' });
    P('prop.console', [3.2, 0, 1.0], Math.PI / 2);
    P('prop.pipes', [10, 0.35, -1.55], 0, { length: 12, count: 2, mount: 'wall', valves: 2 });
    P('prop.cables', [3.2, 0, 1.4], 0, { to: [1.6, 0, -2.4], count: 3 });
    P('prop.hazard', [2.4, 0, -1.45], 0, { size: [2.4, 0.6] });
    scene.add(mergeGroup(roof));
  }

  // STEM-00: the real player model (rig + soldier parts, batched like PlayerView) in the rig's SEATED pose on the roof's edge,
  // legs over the drop, its rifle laid down beside it. Life on top: breathing, a slow look around, the core pulsing.
  #stem(scene) {
    const rig = new Rig({ dummy: false });
    const M = buildSoldier(rig);
    this.skin = new RigidSkin(rig.root, rig.skeleton);
    rig.root.position.copy(STEM);
    rig.root.rotation.y = FACING;
    scene.add(rig.root);
    this.rig = rig;
    this.core = M.core;
    this.animator = new Animator(rig, { armed: false });
    this.pose = { speed: 0, run: false, crouch: 0, aimPitch: 0, combat: false, recoil: 0, lean: 0, lookYaw: 0, lower: 0, dormant: 0, seated: 1 };
    const gun = mergeGroup(GUNS.rifle.build(gunMaterials({ plate: M.armor, glow: M.glow })));
    gun.position.set(STEM.x + 0.9, 0.05, STEM.z + 0.5);
    gun.rotation.set(0, 2.4, Math.PI / 2); // on its side, muzzle toward the edge
    scene.add(gun);
  }

  // Haze bands: soft vertical veils between the rows of towers (one in front of the HiveMind), the fog's colour, drifting.
  #haze(scene, rng) {
    const tex = hazeTexture(rng);
    this.veils = [];
    for (const [dist, h, a] of [[260, 220, 0.6], [480, 300, 0.6], [780, 380, 0.55], [1150, 460, 0.5], [2100, 1100, 0.7], [2700, 1700, 0.45]]) {
      const t = tex.clone();
      t.repeat.x = 3;
      t.offset.x = rng.next();
      const m = new THREE.Mesh(new THREE.PlaneGeometry(dist * 3.2, h), new THREE.MeshBasicMaterial({ color: FOG, map: t, transparent: true, opacity: a, depthWrite: false, fog: false }));
      m.position.set(-Math.sin(CAM.yaw) * dist, GROUND + h / 2 - 5, -Math.cos(CAM.yaw) * dist);
      m.rotation.y = CAM.yaw;
      m.userData.speed = 0.004 + rng.next() * 0.004;
      scene.add(m);
      this.veils.push(m);
    }
    // static lights: beacons, foundry embers, pods; steam columns from the nearest vents
    const lights = (this.lights = makePoints(this.beacons.length + this.fires.length + this.pods.length + DRONES + FORMATION + 4, true));
    for (const [x, y, z] of this.beacons) lights.put(x, y, z, 5, CYAN, 3, 1, (x * 0.6 + z * 0.8) / 1400); // one sync wave
    for (const [x, y, z, s] of this.fires) lights.put(x, y, z, s * 2.2, FIRE, 0.9, 2);
    for (const pd of this.pods) pd.k = lights.put(0, 0, 0, 5, WHITE, 2.2, 0);
    scene.add(lights);
    const sources = this.vents.slice().sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2])).slice(0, 9);
    const smoke = (this.smoke = makePoints(sources.length * SMOKE_PER, false));
    this.smokeSrc = sources;
    const tone = new THREE.Color(0x2a3a3e); // steam
    for (const [x, y, z] of sources) for (let i = 0; i < SMOKE_PER; i++) smoke.put(x, y, z, 10, tone, 0, 0);
    scene.add(smoke);
  }

  // VIGIL drones (the game's drone look, drone.js, merged and instanced: one draw per material for all of them) patrolling
  // slow loops over the city (some nearly straight lanes), a few close to the roof, some with searchlights, and a wedge
  // crossing the skyline now and then. The far ones are scaled up so they read at range.
  #drones(scene, rng) {
    const R = () => rng.next();
    // near (the four by the roof and the wedge): the full model; far: its hull and core only (a few pixels at range)
    const M = droneMaterials();
    const L = droneLook(M);
    const near = group(...L.body);
    for (const [x, z] of ROTORS) {
      const b = L.blades();
      b.position.set(x, 0.12, z);
      near.add(b);
    }
    const lod = droneLook(M).body;
    const instanced = (model, n) =>
      mergeGroup(model).children.map((m) => {
        const im = new THREE.InstancedMesh(m.geometry, m.material, n);
        im.frustumCulled = false;
        scene.add(im);
        return im;
      });
    this.nearMeshes = instanced(near, 4 + FORMATION);
    this.farMeshes = instanced(group(lod[0], lod[3]), DRONES - 4);
    this.drones = [];
    for (let i = 0; i < DRONES; i++) {
      const close = i < 4;
      const dist = close ? 30 + i * 20 : 120 + R() * 1100;
      const ang = (R() - 0.5) * 1.3 + CAM.yaw;
      this.drones.push({
        cx: -Math.sin(ang) * dist,
        cz: -Math.cos(ang) * dist,
        y: close ? 3 + R() * 12 : GROUND + 90 + R() * 300,
        rx: close ? 25 + R() * 20 : 40 + R() * 220,
        rz: close ? 8 + R() * 10 : R() < 0.3 ? 5 : 30 + R() * 160,
        w: (0.04 + R() * 0.08) * (R() < 0.5 ? -1 : 1) * (close ? 0.6 : 1),
        ph: R() * 6.28,
        bob: R() * 6.28,
        size: close ? 1 : 3,
        cone: !close && i < 16,
      });
    }
    for (const d of this.drones) d.light = this.lights.put(0, 0, 0, d.size * 0.9, VIOLET, 3, 3);
    this.wedge = [];
    for (let i = 0; i < FORMATION; i++) this.wedge.push({ dx: Math.ceil(i / 2) * 14, dz: (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 10, light: this.lights.put(0, 0, 0, 3, VIOLET, 3, 3) });

    // searchlight cones: apex at the origin, opening down -Y, unit length and radius; faded along the beam and at the rim
    const coneGeo = new THREE.ConeGeometry(1, 1, 20, 1, true).translate(0, -0.5, 0);
    const coneMat = new THREE.ShaderMaterial({
      uniforms: { fogDensity: { value: FOG_DENSITY } },
      vertexShader: /* glsl */ `
        uniform float fogDensity;
        varying float vV; varying float vRim; varying float vVis;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          vec3 n = normalize(mat3(modelViewMatrix) * mat3(instanceMatrix) * normal);
          vRim = abs(dot(n, normalize(-mv.xyz)));
          vV = uv.y;
          float d = length(mv.xyz);
          vVis = exp(-fogDensity * fogDensity * d * d * 0.6);
        }`,
      fragmentShader: /* glsl */ `
        varying float vV; varying float vRim; varying float vVis;
        void main() {
          float a = (0.02 + 0.22 * pow(vV, 4.0)) * vRim * vRim * vVis;
          gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.coneUsers = this.drones.filter((d) => d.cone);
    this.cones = new THREE.InstancedMesh(coneGeo, coneMat, this.coneUsers.length + 1);
    this.cones.frustumCulled = false;
    scene.add(this.cones);
  }

  // camera framing: STEM-00 on the right third whatever the aspect (narrow screens turn the camera toward it)
  #fit() {
    this.renderer.getSize(_size);
    const aspect = _size.x / Math.max(1, _size.y);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.aspect = aspect;
    this.offset = CAM.offset * Math.min(1, aspect / 1.6); // narrow screens bring STEM-00 toward the centre
    this.tilt = Math.min(0, aspect - 1.6) * 0.1; // ...and look lower, so CERBERUS rises above the centred logo
    const scale = _size.y / 2 / Math.tan(THREE.MathUtils.degToRad(CAM.fov / 2));
    for (const p of [this.lights, this.smoke, this.hiveLights]) p.material.uniforms.scale.value = scale;
  }

  // One frame of the backdrop (Shell, while the title is up): animate, then draw straight to the canvas.
  render(dt) {
    const r = this.renderer;
    r.getSize(_size);
    if (Math.abs(_size.x / Math.max(1, _size.y) - this.aspect) > 1e-3) this.#fit();
    const still = reduce.matches;
    const t = (this.t += dt * (still ? 0.35 : 1));
    this.#animate(dt, t, still);
    r.toneMappingExposure = 1;
    r.info.reset();
    r.render(this.scene, this.camera);
    MenuScene.frames++;
  }

  #animate(dt, t, still) {
    // camera: slow dolly and sway, a little mouse parallax (none with reduced motion)
    const cam = this.camera;
    this.look.lerp(still ? ZERO : this.mouse, 1 - Math.exp(-dt * 2));
    const yaw = CAM.yaw + (still ? 0 : Math.sin(t * 0.05) * 0.02) - this.look.x * 0.02;
    const pitch = CAM.pitch + this.tilt + (still ? 0 : Math.sin(t * 0.07 + 1) * 0.008) - this.look.y * 0.012;
    const dist = CAM.dist + (still ? 0 : Math.sin(t * 0.04) * 0.4);
    const toStem = yaw + this.offset;
    cam.position.set(STEM.x + Math.sin(toStem) * dist + this.look.x * 0.2, CAM.height + (still ? 0 : Math.sin(t * 0.09) * 0.06), STEM.z + Math.cos(toStem) * dist);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    const V = MenuScene.view;
    if (V) {
      cam.position.fromArray(V.pos);
      cam.lookAt(_p.fromArray(V.at));
    }

    // STEM-00: seated, breathing, now and then a slow look along the skyline; the core pulses faintly
    const P = this.pose;
    const turn = THREE.MathUtils.euclideanModulo(GAZE - FACING + Math.PI, Math.PI * 2) - Math.PI; // to CERBERUS
    P.lookYaw = THREE.MathUtils.clamp(turn * 0.75, -0.9, 0.9) + Math.sin(t * 0.11) * 0.1 + Math.sin(t * 0.37) * 0.03;
    this.animator.update(dt, P);
    const B = this.rig.bones;
    const breath = Math.sin(t * 1.5);
    B.Spine1.rotation.x -= breath * 0.014;
    B.Spine2.rotation.x -= breath * 0.02;
    B.Spine1.rotation.y += turn * 0.12; // the shoulders turn a little with the head
    B.Spine2.rotation.y += turn * 0.12;
    this.core.emissiveIntensity = 2.6 + Math.sin(t * 0.8) * 0.6;

    // CERBERUS: the heads scan the city, out of step (VIGIL slow and wide, the turrets twitchier); the hull shifts its weight
    const hp = this.hiveLights.geometry.attributes.position;
    const H = this.heads;
    H[0].rotation.y = Math.sin(t * 0.07) * 0.35 + Math.sin(t * 0.23) * 0.05;
    H[1].rotation.set(Math.sin(t * 0.05 + 2) * 0.05, Math.sin(t * 0.04) * 0.3, 0, 'YXZ');
    H[2].rotation.y = Math.sin(t * 0.06 + 1.5) * 0.35 - Math.sin(t * 0.19) * 0.05;
    const sway = still ? 0 : Math.sin(t * 0.09);
    this.torso.position.set(sway * 0.12, this.torsoY + Math.abs(sway) * -0.08, 0);
    this.torso.rotation.z = sway * -0.012;
    for (const [h, local, i] of this.hiveSensors) {
      h.updateMatrixWorld(true);
      _p.copy(local).applyMatrix4(h.matrixWorld);
      set3(hp.array, i, _p.x, _p.y, _p.z);
    }
    hp.needsUpdate = true;
    this.hiveLights.material.uniforms.time.value = t;

    // drones
    for (let i = 0; i < this.drones.length; i++) {
      const d = this.drones[i];
      const a = d.ph + t * d.w;
      _p.set(d.cx + Math.cos(a) * d.rx, d.y + Math.sin(t * 0.6 + d.bob) * 1.2, d.cz + Math.sin(a) * d.rz);
      const heading = Math.atan2(-Math.sin(a) * d.rx * d.w, Math.cos(a) * d.rz * d.w);
      _q.setFromEuler(_e.set(0.12, heading, Math.sin(t * 0.8 + d.bob) * 0.05, 'YXZ'));
      if (i < 4) this.#place(this.nearMeshes, i, d.light, d.size);
      else this.#place(this.farMeshes, i - 4, d.light, d.size);
      d.x = _p.x;
      d.yy = _p.y;
      d.z = _p.z;
    }
    // the wedge: crosses left to right high over the city, then waits off screen
    const wx = -1400 + (((t + 20) % 120) / 120) * 2800;
    _q.setFromEuler(_e.set(0.1, Math.PI / 2, 0, 'YXZ'));
    for (let j = 0; j < this.wedge.length; j++) {
      const w = this.wedge[j];
      _p.set(wx - w.dx * 3, -40 + Math.sin(t * 0.5 + j) * 2, -620 + w.dz * 3);
      this.#place(this.nearMeshes, 4 + j, w.light, 4);
    }
    for (const im of this.nearMeshes) im.instanceMatrix.needsUpdate = true;
    for (const im of this.farMeshes) im.instanceMatrix.needsUpdate = true;
    this.lights.geometry.attributes.position.needsUpdate = true;
    this.lights.material.uniforms.time.value = t;
    this.cityMat.userData.time.value = t;
    // pods: identical, evenly spaced, 14 m/s on every rail, never stopping
    const lp = this.lights.geometry.attributes.position;
    for (const pd of this.pods) {
      _d.lerpVectors(pd.rail.from, pd.rail.to, (pd.off + (t * 14) / pd.rail.len) % 1);
      set3(lp.array, pd.k, _d.x, _d.y, _d.z);
    }

    // searchlights sweep the streets
    const users = this.coneUsers;
    for (let i = 0; i < users.length; i++) {
      const d = users[i];
      this.#beam(i, d.x, d.yy - 0.6, d.z, Math.sin(t * 0.21 + d.ph) * 0.45, Math.cos(t * 0.17 + d.bob) * 0.45);
    }
    this.#beam(users.length, wx, -44, -620, Math.sin(t * 0.25) * 0.3, 0.2);
    this.cones.instanceMatrix.needsUpdate = true;

    // smoke: puffs rise, widen, drift with the wind and fade
    const sp = this.smoke.geometry.attributes;
    for (let s = 0; s < this.smokeSrc.length; s++) {
      const [x, y, z] = this.smokeSrc[s];
      for (let i = 0; i < SMOKE_PER; i++) {
        const j = s * SMOKE_PER + i;
        const age = (t * 0.018 + i / SMOKE_PER + s * 0.37) % 1;
        const rise = age * 420;
        set3(sp.position.array, j, x + rise * 0.55 + Math.sin(i * 7.1 + s) * 4, y + rise, z + Math.cos(i * 3.3) * 4);
        sp.size.array[j] = 18 + age * 130;
        sp.tint.array[j * 4 + 3] = Math.sin(age * Math.PI) * 0.55;
      }
    }
    sp.position.needsUpdate = sp.size.needsUpdate = sp.tint.needsUpdate = true;

    for (const v of this.veils) v.material.map.offset.x += dt * v.userData.speed * (still ? 0.3 : 1);
    this.sky.position.copy(cam.position);
  }

  // a drone at _p / _q: its instance in `meshes` and its sensor glow
  #place(meshes, i, light, size) {
    _m.compose(_p, _q, _s.setScalar(size));
    for (const im of meshes) im.setMatrixAt(i, _m);
    _d.set(0, 0.02, 0.45 * size).applyQuaternion(_q).add(_p);
    set3(this.lights.geometry.attributes.position.array, light, _d.x, _d.y, _d.z);
  }

  // searchlight cone i from (x, y, z) toward the street along (sx, -1, sz)
  #beam(i, x, y, z, sx, sz) {
    _d.set(sx, -1, sz).normalize();
    const len = (y - GROUND) / -_d.y;
    _q.setFromUnitVectors(_down, _d);
    this.cones.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.set(len * 0.12, len, len * 0.12)));
  }
}
