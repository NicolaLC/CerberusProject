import * as THREE from 'three';
import { Rig, Animator } from '../actors/rig.js';
import { buildSoldier } from '../actors/soldier.js';
import { droneMaterials, droneLook, ROTORS } from '../actors/drone.js';
import { GUNS, gunMaterials } from '../combat/guns.js';
import { RigidSkin, mergeGroup } from '../../engine/batch.js';
import { panelTexture, applyWorldUVs } from '../world/textures.js';
import { propMaterials, PROP_PIECES } from '../world/props.js';
import { cyl, part, group, rb, rbox } from '../actors/parts.js';
import { Rng } from '../../engine/random.js';

// Main menu backdrop (instructions/architecture.md "Main menu and save"): a self-contained set, not a game level. STEM-00
// sits on the edge of a skyscraper roof, legs over the drop, looking over IO's city (gdd 2.1, 2.9) toward the
// HiveMind's guardian CERBERUS: a colossal three-headed quadruped war mech standing on the horizon, sunk in the haze, sensed more
// than seen (violet sensor eyes breathing). The skyline is about half in ruin (broken tops, girders, leaning towers, rubble,
// smoke, a few Rejects fires), with Spire Cathedrals, transit rails and cyan beacons; VIGIL drones patrol with searchlights.
// Reuses: the player rig, soldier parts and SEATED pose, the rifle, the drone look, the prop builders and materials, the
// weathered panel texture. Shell renders it with the game's renderer only while the title is up: no game system runs.
// Budget: about 51 draws and 375k triangles, the skyline and the drones instanced, the roof merged, no shadows.
const ROOF = -0.3; // top of the hero tower's body (the roof slab sits on it, its top at y = 0)
const GROUND = -420; // city floor
const FOG = new THREE.Color(0x2e6f78); // art-style haze
const FOG_DENSITY = 0.0012;
const ZENITH = new THREE.Color(0x0b1118);
const SUN = new THREE.Vector3(0.2, 0.16, -1).normalize(); // cold white smear behind the HiveMind
const CYAN = new THREE.Color(0x3fe0ff);
const VIOLET = new THREE.Color(0x8c3cff); // sensors (art-style 5: VISOR)
const FIRE = new THREE.Color(0xff7a1a); // Rejects sodium orange
const TOWER = { x: [-0.8, 27.2], z: [-2, 26] }; // the hero tower's footprint
const STEM = new THREE.Vector3(TOWER.x[0] + 0.3, 0, TOWER.z[0] + 1.6); // STEM-00's root: seated on the roof's left edge, knees at the edge
const HIVE = new THREE.Vector3(620, GROUND, -3400); // CERBERUS's feet, mid screen
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
const _yUp = new THREE.Vector3(0, 1, 0);
const _size = new THREE.Vector2();
const ZERO = new THREE.Vector2();
const set3 = (a, i, x, y, z) => {
  a[i * 3] = x;
  a[i * 3 + 1] = y;
  a[i * 3 + 2] = z;
};

// the sky's colour by view direction: haze at the horizon, dark overhead, the sun smeared sideways through the haze
const SKY_UNIFORMS = { horizon: { value: FOG }, zenith: { value: ZENITH }, sun: { value: SUN } };
const SKY_GLSL = /* glsl */ `
  uniform vec3 horizon, zenith, sun;
  vec3 sky(vec3 d) {
    vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.6, d.y));
    float s = max(dot(d, sun), 0.0);
    float smear = exp(-abs(d.y - sun.y) * 30.0) * pow(s, 6.0);
    return c + vec3(0.85, 0.95, 1.0) * (pow(s, 40.0) * 0.4 + pow(s, 6.0) * 0.12 + smear * 0.3);
  }`;

// soft glow points: additive lights (beacons, fires, sensors) or smoke (normal blend); size in metres, fogged like the scene
function pointsMaterial(additive) {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, scale: { value: 800 }, fogColor: { value: FOG }, fogDensity: { value: FOG_DENSITY } },
    vertexShader: /* glsl */ `
      attribute float size; attribute vec4 tint; attribute vec2 anim;
      uniform float time, scale, fogDensity;
      varying vec4 vTint; varying float vVis;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(size * scale / -mv.z, 256.0);
        float d = length(mv.xyz);
        vVis = exp(-fogDensity * fogDensity * d * d);
        float k = 1.0;
        if (anim.x > 3.5) k = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(time * 0.45 + anim.y * 6.28), 3.0); // the HiveMind breathing
        else if (anim.x > 2.5) k = 0.75 + 0.25 * sin(time * 2.0 + anim.y * 6.28); // sensor
        else if (anim.x > 1.5) k = 0.55 + 0.25 * sin(time * 9.0 + anim.y * 40.0) + 0.2 * sin(time * 23.0 + anim.y * 17.0); // fire flicker
        else if (anim.x > 0.5) k = 0.08 + step(0.86, fract(time * 0.55 + anim.y)); // beacon blink
        vTint = vec4(tint.rgb, tint.a * k);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 fogColor;
      varying vec4 vTint; varying float vVis;
      void main() {
        float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
        ${additive
          ? 'gl_FragColor = vec4(vTint.rgb * vTint.a * a * a * vVis, 1.0);'
          : 'gl_FragColor = vec4(mix(fogColor, vTint.rgb, vVis), vTint.a * a);'}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

// Points with per-point size, tint (rgb, alpha) and anim (mode 0 steady / 1 blink / 2 flicker / 3 pulse / 4 breathe, phase)
function makePoints(n, additive) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  g.setAttribute('anim', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const p = new THREE.Points(g, pointsMaterial(additive));
  p.frustumCulled = false;
  p.count = 0;
  p.put = (x, y, z, size, color, alpha, mode = 0, phase = Math.random()) => {
    const i = p.count++;
    g.attributes.position.array.set([x, y, z], i * 3);
    g.attributes.size.array[i] = size;
    g.attributes.tint.array.set([color.r, color.g, color.b, alpha], i * 4);
    g.attributes.anim.array.set([mode, phase], i * 2);
    return i;
  };
  return p;
}

// The weathered wall panels (world.js skin) on world-space UVs, 4 m per tile, plus lit windows from world position (walls
// only, a 3.2 x 3.6 m cell grid, per-instance `aLit`), faded to their average where a cell gets smaller than a pixel so
// the skyline does not shimmer while the camera drifts.
function cityMaterial() {
  const m = new THREE.MeshLambertMaterial({ map: panelTexture({ tint: '#787f82', grime: 0.6 }) });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 wp = vec4(transformed, 1.0); vec3 wn = objectNormal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
        #endif
        vWPos = (modelMatrix * wp).xyz; vWN = normalize(mat3(modelMatrix) * wn); vLit = aLit;
        vMapUv = (abs(vWN.y) > 0.6 ? vWPos.xz : vec2(abs(vWN.x) > abs(vWN.z) ? vWPos.z : vWPos.x, vWPos.y)) / 4.0;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLit;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 n = normalize(vWN);
          float wall = 1.0 - step(0.6, abs(n.y));
          vec2 cell = vec2((abs(n.x) > abs(n.z) ? vWPos.z : vWPos.x) / 3.2, vWPos.y / 3.6);
          vec2 id = floor(cell), f = fract(cell);
          float win = step(0.2, f.x) * step(f.x, 0.7) * step(0.3, f.y) * step(f.y, 0.75);
          float h = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
          float lit = step(0.87, h) * win;
          float px = max(length(fwidth(cell)), 1e-4);
          lit = mix(lit, 0.034, smoothstep(0.35, 0.9, px));
          vec3 wc = mix(vec3(0.62, 0.78, 0.82), vec3(0.2, 0.75, 0.95), step(0.96, h));
          totalEmissiveRadiance += wc * lit * wall * vLit * 1.6;
        }`);
  };
  m.customProgramCacheKey = () => 'menu-city';
  return m;
}

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

  // Skyline: one InstancedMesh of unit boxes (base at y 0). Lots in a wedge ahead of the camera; a noise field marks the ruined
  // half: shorter towers with a slumped top chunk, bare girders, leaning towers, rubble, gaps. Spire Cathedrals on the horizon.
  #city(scene, rng) {
    const parts = []; // [x, y, z, w, h, d, rx, rz, ry, color, lit]
    const strips = []; // network-cyan lines: [x, y, z, w, h, d]
    const add = (x, y, z, w, h, d, color, lit, rx = 0, rz = 0, ry = 0) => parts.push([x, y, z, w, h, d, rx, rz, ry, color, lit]);
    const R = () => rng.next();
    const [x0, x1] = TOWER.x;
    const [z0, z1] = TOWER.z;
    add((x0 + x1) / 2, GROUND, (z0 + z1) / 2, x1 - x0, ROOF - GROUND, z1 - z0, 0x30383d, 0.5); // the hero tower
    const ruinAt = (x, z) => Math.sin(x * 0.0042 + 1.3) * Math.cos(z * 0.0051 - 0.7) + 0.55 * Math.sin(x * 0.011 + z * 0.0083) + 0.2;
    const STEP = 38;
    for (let z = 20; z > -2300; z -= STEP) {
      for (let x = -2000; x < 2000; x += STEP) {
        if (Math.abs(x) > 80 + (20 - z) * 1.05) continue; // outside the view wedge
        if (x > -50 && x < 60 && z > -40) continue; // the hero tower's lot
        if (R() < 0.12) continue; // plazas, rails
        const w = 12 + R() * 16;
        const d = 12 + R() * 16;
        const px = x + (R() - 0.5) * (STEP - w) * 0.8;
        const pz = z + (R() - 0.5) * (STEP - d) * 0.8;
        let h = 40 + 320 * R() ** 2.4 + (R() < 0.04 ? 260 : 0);
        if (Math.hypot(px, pz) < 160) h = Math.min(h, 330); // the hero tower stands above its block
        // a sightline to CERBERUS: towers in its corridor stay below it, so the hound reads whole against the sky
        const along = (px * HIVE.x + pz * HIVE.z) / HIVE_DIST;
        if (along > 0 && Math.abs(px * HIVE.z - pz * HIVE.x) / HIVE_DIST < 60 + along * 0.13) h = Math.min(h, Math.max(30, -GROUND - 0.1 * along));
        const tone = 0.32 + R() * 0.14;
        const ruined = ruinAt(px, pz) > 0;
        if (!ruined) {
          const c = new THREE.Color(tone * 0.85, tone, tone * 1.08);
          add(px, GROUND, pz, w, h, d, c, R() < 0.25 ? 0.25 : 1);
          if (R() < 0.5) add(px + (R() - 0.5) * w * 0.4, GROUND + h, pz + (R() - 0.5) * d * 0.4, w * (0.3 + R() * 0.3), 3 + R() * 10, d * (0.3 + R() * 0.3), c, 0.6); // roof plant
          if (h > 200 && R() < 0.45) this.beacons.push([px, GROUND + h + 6, pz]);
          if (h > 180 && R() < 0.3) strips.push([px, GROUND + h * 0.5, pz + d / 2 + 0.3, 0.6, h, 0.2]);
          continue;
        }
        const c = new THREE.Color(tone * 0.9, tone * 0.82, tone * 0.72).lerp(new THREE.Color(0x5a3422), R() * 0.35); // soot, rust
        const roll = R();
        if (roll < 0.22) {
          // collapsed: a rubble mound
          for (let i = 0; i < 4; i++) add(px + (R() - 0.5) * w, GROUND, pz + (R() - 0.5) * d, w * (0.4 + R() * 0.5), 4 + R() * 12, d * (0.4 + R() * 0.5), c, 0, (R() - 0.5) * 0.5, (R() - 0.5) * 0.5, R() * 3);
          continue;
        }
        const lean = roll > 0.8 ? (R() - 0.5) * 0.3 : 0; // leaning towers
        const leanX = R() < 0.5;
        h *= 0.35 + R() * 0.45;
        add(px, GROUND, pz, w, h, d, c, R() < 0.15 ? 0.15 : 0, leanX ? lean : 0, leanX ? 0 : lean);
        if (lean) continue;
        const top = GROUND + h;
        // broken top: a slumped slab chunk and bare girders
        add(px + (R() - 0.5) * w * 0.3, top - 2, pz + (R() - 0.5) * d * 0.3, w * (0.5 + R() * 0.3), 4 + R() * 10, d * (0.4 + R() * 0.3), c, 0, (R() - 0.5) * 0.7, (R() - 0.5) * 0.7);
        const girders = 2 + Math.floor(R() * 4);
        for (let i = 0; i < girders; i++) add(px + (R() - 0.5) * w * 0.9, top, pz + (R() - 0.5) * d * 0.9, 0.7, 6 + R() * 18, 0.7, 0x1c1f22, 0, (R() - 0.5) * 0.6, (R() - 0.5) * 0.6);
        if (R() < 0.07) this.fires.push([px, top + 3, pz, 6 + R() * 8]);
      }
    }
    // Spire Cathedrals (gdd 2.6): server towers on the horizon, stacked tapering tiers, buttress fins, a needle, cyan strips
    for (const [sx, sz, sh] of [[700, -1300, 1150], [-1000, -1600, 900], [1400, -1850, 820]]) {
      const c = new THREE.Color(0x2a3338);
      let y = GROUND;
      let w = 110;
      for (let i = 0; i < 6; i++) {
        const th = sh * (0.24 - i * 0.025);
        add(sx, y, sz, w, th, w, c, 0.35);
        for (const [fx, fz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) add(sx + (fx * w) / 2, y, sz + (fz * w) / 2, fx ? 6 : w * 0.18, th * 0.9, fz ? 6 : w * 0.18, c, 0, fz * 0.08, -fx * 0.08);
        for (const o of [-0.3, 0, 0.3]) strips.push([sx + o * w, y + th / 2, sz + w / 2 + 0.6, 1.2, th * 0.85, 0.4]);
        y += th;
        w *= 0.74;
      }
      add(sx, y, sz, 4, sh * 0.22, 4, c, 0);
      this.beacons.push([sx, y + sh * 0.22, sz]);
    }
    // transit rails: long elevated cyan lines across the city (the lattice of rails)
    for (let i = 0; i < 9; i++) strips.push([(R() - 0.5) * 600, GROUND + 25 + R() * 50, -200 - i * 220, 4000, 0.5, 0.8]);
    for (let i = 0; i < 6; i++) strips.push([-1400 + i * 520 + R() * 100, GROUND + 25 + R() * 40, -1100, 0.8, 0.5, 2200]);

    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const city = new THREE.InstancedMesh(geo, cityMaterial(), parts.length);
    const lit = new Float32Array(parts.length);
    const col = new THREE.Color();
    parts.forEach(([x, y, z, w, h, d, rx, rz, ry, color, l], i) => {
      city.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(w, h, d)));
      city.setColorAt(i, color instanceof THREE.Color ? color : col.set(color));
      lit[i] = l;
    });
    geo.setAttribute('aLit', new THREE.InstancedBufferAttribute(lit, 1));
    city.frustumCulled = false; // spans the whole view
    scene.add(city);

    const strip = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: CYAN.clone().multiplyScalar(1.6) }), strips.length);
    strips.forEach(([x, y, z, w, h, d], i) => strip.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q.identity(), _s.set(w, h, d))));
    strip.frustumCulled = false;
    scene.add(strip);
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
    // mech space: units (x 76 m), +Z = where it faces, y up from its feet
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const OCT = new THREE.CylinderGeometry(1, 1, 1, 8).rotateY(Math.PI / 8).scale(1 / Math.cos(Math.PI / 8), 1, 1 / Math.cos(Math.PI / 8));
    // a chamfered block (an octagonal prism, axis Y): w x h x d
    const block = (m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const o = part(OCT, m, x, y, z, rx, ry, rz);
      o.scale.set(w / 2, h, d / 2);
      return o;
    };
    // a rod from a to b (radius r, s sides)
    const rod = (m, a, b, r, s = 8) => {
      const o = part(new THREE.CylinderGeometry(r, r, 1, s), m);
      _d.subVectors(b, a);
      o.scale.y = _d.length();
      o.position.addVectors(a, b).multiplyScalar(0.5);
      o.quaternion.setFromUnitVectors(_yUp, _d.normalize());
      return o;
    };
    const disc = (m, r, t, x, y, z, s = 16) => cyl(m, r, r, t, x, y, z, 0, 0, Math.PI / 2, s); // axis X
    const tube = (m, r, len, x, y, z, s = 12) => cyl(m, r, r, len, x, y, z, Math.PI / 2, 0, 0, s); // axis Z
    // a claw from the origin along +Z, tapering to its tip, dipping to the ground
    const claw = (len) => new THREE.CylinderGeometry(0.08, 0.3, len, 4).translate(0, len / 2, 0).rotateX(Math.PI / 2 + 0.12);
    // a rounded shell: a sphere scaled to (sx, sy, sz) at (x, y, z), tilted rx
    const SPH = new THREE.SphereGeometry(1, 20, 12);
    const shell = (m, sx, sy, sz, x, y, z, rx = 0) => {
      const o = part(SPH, m, x, y, z, rx);
      o.scale.set(sx, sy, sz);
      return o;
    };
    // a capsule shell from a to b (radius r), flattened across X by f
    const pod = (m, a, b, r, f = 1) => {
      const l = a.distanceTo(b);
      const o = rod(m, a, b, 1);
      o.geometry = new THREE.CapsuleGeometry(r, Math.max(l - 2 * r, 0.01), 4, 14);
      o.scale.set(f, 1, 1);
      return o;
    };
    // a rounded slab from a to b: w across X, d across the limb, corner radius r
    const slab = (m, a, b, w, d, r) => {
      const o = rod(m, a, b, 1);
      o.geometry = rbox(w, a.distanceTo(b), d, r);
      o.scale.set(1, 1, 1);
      return o;
    };
    const legs = [];
    for (const sx of [1, -1]) {
      const x = sx * 3.15;
      // [hip, knee, ankle, foot] in (z, y): the forelegs' knees ahead, the hind legs' hocks behind
      for (const [H, K, A, F] of [
        [[2.4, 5.0], [3.1, 2.9], [2.45, 0.95], [2.7, 0.3]],
        [[-2.5, 5.0], [-1.55, 3.05], [-3.0, 1.05], [-2.75, 0.3]],
      ]) {
        const [h, k, an] = [V(x, H[1], H[0]), V(x, K[1], K[0]), V(x, A[1], A[0])];
        const back = Math.sign(K[0] - A[0]);
        legs.push(
          slab(P, h, k, 0.95, 1.9, 0.4), // thigh shell
          disc(D, 0.72, 1.45, x, K[1], K[0]), // knee
          disc(P, 0.42, 1.65, x, K[1], K[0], 10),
          slab(P, k, an, 0.7, 1.0, 0.3), // shin shell
          rod(D, V(x - sx * 0.05, K[1] + 0.1, K[0] - back * 0.5), V(x - sx * 0.05, A[1] + 0.2, A[0] - back * 0.4), 0.09), // piston
          disc(D, 0.32, 0.8, x, A[1], A[0], 10), // ankle
          rod(D, an, V(x, F[1], F[0]), 0.17), // pastern
          block(D, 0.9, 0.32, 0.9, x, F[1], F[0]), // foot hub
          rb(P, 0.75, 0.3, 1.1, 0.12, x, F[1] + 0.25, F[0] + 0.1), // its cap
        );
        for (const [yaw, len] of [[0.5, 1.2], [0, 1.35], [-0.5, 1.2], [Math.PI, 0.8]]) legs.push(part(claw(len), P, x, F[1] - 0.1, F[0], 0, yaw + sx * 0.12, 0));
      }
    }

    // the hull: a pill (a lathe around Z, flattened) banded by dark seam rings, under a domed carapace
    const pill = new THREE.LatheGeometry([[0, -3.9], [1.2, -3.8], [1.9, -3.35], [2.2, -2.5], [2.25, 1.0], [2.1, 2.6], [1.6, 3.5], [0.9, 3.85], [0, 3.95]].map(([r, z]) => new THREE.Vector2(r, z)), 20).rotateX(Math.PI / 2);
    const body = group(part(pill, P), ...[-1.4, 0.4, 2.2].map((z) => part(new THREE.TorusGeometry(z > 2 ? 2.13 : 2.25, 0.07, 6, 28), D, 0, 0, z)));
    body.position.y = 5.15;
    body.scale.y = 0.62;
    const hull = [
      body,
      rb(P, 4.7, 1.3, 6.4, 0.5, 0, 6.2, -0.3), // carapace
      rb(P, 2.8, 1.8, 1.2, 0.45, 0, 4.9, 3.3, 0.3), // chest
      ...[1, -1].flatMap((s) => [
        rb(P, 1.6, 1.9, 2.4, 0.55, s * 2.45, 5.6, 2.3, -0.15, 0, s * 0.12), // shoulder pauldron
        rb(P, 1.6, 2.0, 2.6, 0.55, s * 2.4, 5.45, -2.45, 0.15, 0, s * 0.12), // haunch
      ]),
      ...[-0.9, 0.9].map((x) => tube(D, 0.4, 0.8, x, 5.35, -3.7)), // exhausts
      // the launcher: a long tube on a cradle, a rounded breech, dark bands, its muzzle forward; an ammunition pod beside it
      tube(P, 0.8, 4.6, -0.6, 7.55, -0.8, 18),
      shell(P, 0.8, 0.8, 0.5, -0.6, 7.55, -3.1),
      ...[1.2, -2.2].map((z) => part(new THREE.TorusGeometry(0.8, 0.13, 6, 20), D, -0.6, 7.55, z)),
      tube(D, 0.55, 0.4, -0.6, 7.55, 1.6, 14),
      block(D, 1.0, 1.0, 2.8, -0.6, 6.85, -0.9, Math.PI / 2),
      pod(P, V(1.25, 7.05, -2.6), V(1.25, 7.05, -0.3), 0.42),
      rod(D, V(0, 5.4, 3.0), V(0, 6.0, 4.0), 0.4), // VIGIL's neck
    ];

    // the heads: groups around their pivots, so they can turn. [pivot, eyes [x, y, z, size]...]
    const vigil = group(
      rb(P, 1.5, 1.0, 2.0, 0.4, 0, 0.1, 0.7, 0.1), // skull
      rb(P, 1.0, 0.6, 1.4, 0.25, 0, -0.35, 1.4, 0.1), // muzzle
      rb(D, 1.2, 0.3, 0.5, 0.12, 0, 0.3, 1.65, -0.5), // visor
      ...[1, -1].map((s) => rb(D, 0.2, 0.5, 0.8, 0.08, s * 0.78, 0, 0.6)), // cheek vents
      tube(D, 0.14, 2.2, 0, -0.55, 2.4, 8), // gun barrel
      tube(D, 0.24, 0.5, 0, -0.55, 3.55, 8), // muzzle brake
    );
    // LEGION and COLOSSUS: sleek gun pods on short arms
    const turret = (s) =>
      group(
        block(D, 0.4, 0.7, 0.5, 0, -0.3, 0.3), // arm
        pod(P, V(0, 0.15, -0.5), V(0, 0.15, 1.55), 0.42, 0.85),
        tube(D, 0.1, 1.8, 0, 0.05, 2.2, 8), // barrel
        tube(D, 0.17, 0.35, 0, 0.05, 3.1, 8),
        shell(D, 0.16, 0.16, 0.16, -s * 0.3, 0.32, 1.2), // sensor
      );
    const HEADS = [
      { g: turret(1), at: V(1.95, 7.0, 1.4), eyes: [[-0.32, 0.36, 1.3, 0.55]] }, // LEGION, the right shoulder
      { g: vigil, at: V(0, 6.0, 4.0), eyes: [[0.25, 0.32, 1.92, 0.55], [-0.25, 0.32, 1.92, 0.55], [0, 0.38, 1.93, 0.4]] }, // VIGIL, the Eye
      { g: turret(-1), at: V(-1.95, 7.0, 1.4), eyes: [[0.32, 0.36, 1.3, 0.55]] }, // COLOSSUS, the left shoulder
    ];
    const mech = mergeGroup(group(...legs));
    const torso = mergeGroup(group(...hull)); // shifts its weight over the planted legs
    mech.add(torso);
    this.heads = HEADS.map(({ g, at }) => {
      mergeGroup(g).position.copy(at);
      torso.add(g);
      return g;
    });
    this.torso = torso;
    mech.position.copy(HIVE);
    mech.scale.setScalar(76);
    mech.rotation.y = Math.atan2(-HIVE.x, -HIVE.z) + 0.7; // three quarters toward the city and STEM-00, its right flank to the camera
    scene.add(mech);
    // sensor eyes; their own light fog (the haze is in the shade already)
    const lights = (this.hiveLights = makePoints(8, true));
    lights.material.uniforms.fogDensity.value = 0.00028;
    this.hiveSensors = [];
    HEADS.forEach(({ g, eyes }, i) => {
      for (const [x, y, z, size] of eyes) this.hiveSensors.push([g, new THREE.Vector3(x, y, z), lights.put(0, 0, 0, size * 76, VIOLET, 2.6, 4, i * 0.33)]);
    });
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
    // static lights: beacons and fires; smoke columns from the nearest fires
    const lights = (this.lights = makePoints(this.beacons.length + this.fires.length + DRONES + FORMATION + 4, true));
    for (const [x, y, z] of this.beacons) lights.put(x, y, z, 7, CYAN, 3, 1);
    for (const [x, y, z, s] of this.fires) lights.put(x, y, z, s * 2.2, FIRE, 1.4, 2);
    scene.add(lights);
    const sources = this.fires.slice().sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2])).slice(0, 9);
    const smoke = (this.smoke = makePoints(sources.length * SMOKE_PER, false));
    this.smokeSrc = sources;
    const tone = new THREE.Color(0x1a1c1d);
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
    this.torso.position.set(sway * 0.06, Math.abs(sway) * -0.04, 0);
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
