import * as THREE from 'three';
import { gridTexture, applyWorldUVs } from './textures.js';
import { mergeStatic } from '../../engine/batch.js';

// Static level: axis-aligned boxes only (collision, cover and shadows depend on that).
// Coordinates: x = east, z = south, y = up. Floor is y = 0.
// The layout lives in the level file (src/levels/*.json, instructions/level.md); this module builds its
// environment pieces (env.*, light.*) through the piece registry. Sky, sun, fog and materials stay in code.

export const SUN_DIR = new THREE.Vector3(0.45, 0.78, 0.43).normalize();

// Per-face material array for BoxGeometry (order: +x, -x, +y, -y, +z, -z).
function faces(def, { px, nx, py, ny, pz, nz } = {}) {
  return [px ?? def, nx ?? def, py ?? def, ny ?? def, pz ?? def, nz ?? def];
}

// Environment pieces (registry ids, a public contract: instructions/level.md). Builders run against the World.
// data: { id, pos, name?, params }. `pos` is the box center x/z and its bottom y.
export const WORLD_PIECES = {
  // params: size [w, h, d], mat (key of World.mats), faces? { px|nx|py|ny|pz|nz: mat key } (overrides one side),
  // cover? 'low' | 'high' | 'wall', collide? (default true), shadow? (default true)
  'env.box': (world, d) => {
    const { size, cover, collide, shadow } = d.params;
    const opts = { cover: cover ?? null, collide: collide ?? true, shadow: shadow ?? true };
    return world.box(d.pos[0], d.pos[1], d.pos[2], ...size, world.material(d.params), opts);
  },
  // emissive, non-colliding, non-shadowing box. params: size, mat, ownMaterial? (clone the material, e.g. to flicker alone)
  'env.strip': (world, d) => {
    const m = world.strip(d.pos[0], d.pos[1], d.pos[2], ...d.params.size, world.material(d.params, d.params.ownMaterial));
    if (d.name) world.named.set(d.name, m);
    return m;
  },
  // params: color '#rrggbb', intensity, distance, flicker? { strip: name of an earlier env.strip }
  'light.point': (world, d) => {
    const { color, intensity, distance, flicker } = d.params;
    let f = null;
    if (flicker) {
      const strip = flicker.strip == null ? undefined : world.named.get(flicker.strip);
      if (flicker.strip != null && !strip) throw new Error(`light.point: flicker strip "${flicker.strip}" must be defined before the light`);
      f = { strip };
    }
    return world.pointLight(d.pos[0], d.pos[1], d.pos[2], color, intensity, distance, f);
  },
};

export class World {
  // level: parsed level file; registry: Registry holding WORLD_PIECES. Construction is split in small steps
  // (materials, sky, lights, level) so a later dispose() can mirror them.
  constructor(scene, { level, registry }) {
    this.scene = scene;
    this.named = new Map(); // piece name -> mesh (for references between pieces, e.g. a light flickering a strip)
    this.colliders = []; // { box: Box3, mesh, cover: 'low' | 'high' | null }
    this.meshes = []; // raycast targets for bullets / camera / LOS
    this.coverMeshes = [];
    this.interiorZones = [];
    this.flickerLights = [];
    this.staticMeshes = []; // every level box; merged per material for rendering, kept as raycast proxies

    this.mats = this.#makeMaterials();
    this.#buildSky();
    this.#buildLights();
    this.#buildLevel(level, registry);
    // ~60 boxes x up to 6 face materials -> one draw per material (+ shadow pass)
    this.batches = mergeStatic(this.staticMeshes, scene);
  }

  // Material of a piece: params.mat names an entry of this.mats, params.faces overrides single box sides.
  material({ mat, faces: f }, clone = false) {
    const base = this.mats[mat];
    if (!base) throw new Error(`level: unknown material "${mat}"`);
    if (f) return faces(base, Object.fromEntries(Object.entries(f).map(([side, name]) => [side, this.mats[name]])));
    return clone ? base.clone() : base;
  }

  #makeMaterials() {
    const std = (tex, opts = {}) =>
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.0, ...opts });
    return {
      floor: std(gridTexture({ base: '#7d8187', label: '2m' })),
      wall: std(gridTexture({ base: '#b9bcc1', alt: 'rgba(0,0,0,0.05)' })),
      low: std(gridTexture({ base: '#e07a2e', major: 'rgba(255,255,255,0.35)', label: 'LOW' })),
      high: std(gridTexture({ base: '#4f7fb8', major: 'rgba(255,255,255,0.3)', label: 'HIGH' })),
      platform: std(gridTexture({ base: '#9a9ea4' })),
      inFloor: std(gridTexture({ base: '#4a4f57', minor: 'rgba(255,255,255,0.06)', major: 'rgba(255,255,255,0.12)', label: 'B1', labelColor: 'rgba(255,255,255,0.15)' })),
      inWall: std(gridTexture({ base: '#565c66', minor: 'rgba(255,255,255,0.04)', major: 'rgba(255,255,255,0.10)' })),
      inLow: std(gridTexture({ base: '#a8581f', major: 'rgba(255,255,255,0.18)', label: 'LOW', labelColor: 'rgba(255,255,255,0.2)' })),
      inHigh: std(gridTexture({ base: '#34587f', major: 'rgba(255,255,255,0.15)', label: 'HIGH', labelColor: 'rgba(255,255,255,0.2)' })),
      roof: std(gridTexture({ base: '#5a5e65' })),
      stripCyan: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d8ff, emissiveIntensity: 2.5 }),
      stripRed: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a2a, emissiveIntensity: 2.0 }),
      stripWhite: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xfff2d8, emissiveIntensity: 2.0 }),
    };
  }

  #buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#2f6fd1') },
        horizon: { value: new THREE.Color('#cfe4f7') },
        ground: { value: new THREE.Color('#9a8a78') },
        sunDir: { value: SUN_DIR },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, pow(-h, 0.4));
          float s = max(dot(d, sunDir), 0.0);
          col += vec3(1.0, 0.92, 0.75) * (pow(s, 900.0) * 30.0 + pow(s, 24.0) * 0.45);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0xcfe4f7, 70, 320);
  }

  #buildLights() {
    const hemi = new THREE.HemisphereLight(0xc4dcff, 0x6e5b48, 1.1);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff1dc, 3.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -48; s.right = 48; s.top = 48; s.bottom = -48;
    s.near = 1; s.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  // Keep the shadow frustum centered on the player.
  updateSun(focus) {
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(SUN_DIR, 110);
  }

  update(t) {
    for (const f of this.flickerLights) {
      const n = Math.sin(t * 23.0 + f.seed) * Math.sin(t * 7.3 + f.seed * 2.0);
      const off = n > 0.82 || (Math.sin(t * 1.3 + f.seed) > 0.97);
      f.light.intensity = off ? f.base * 0.08 : f.base * (0.85 + 0.15 * Math.sin(t * 40));
      if (f.strip) f.strip.material.emissiveIntensity = off ? 0.2 : 2.0;
    }
  }

  isInterior(p) {
    return this.interiorZones.some((z) => z.containsPoint(p));
  }

  // Highest walkable top under (x,z) that is at or below maxY.
  groundAt(x, z, maxY, radius = 0) {
    let g = 0;
    for (const c of this.colliders) {
      const b = c.box;
      if (b.max.y > maxY) continue;
      if (x < b.min.x - radius || x > b.max.x + radius || z < b.min.z - radius || z > b.max.z + radius) continue;
      if (b.max.y > g) g = b.max.y;
    }
    return g;
  }

  // Pushes a standing body (feet at pos.y, radius r, height h) out of every collider it overlaps.
  // Boxes lower than `step` above the feet are stepped over (stairs, curbs).
  collideCircle(pos, r, h, step) {
    const feet = pos.y;
    const top = feet + h;
    for (let iter = 0; iter < 2; iter++) {
      for (const c of this.colliders) {
        const b = c.box;
        if (b.max.y <= feet + step || b.min.y >= top) continue;
        const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (r - d);
          pos.z += (dz / d) * (r - d);
        } else {
          // center inside the box: push out on the shallowest axis
          const px0 = pos.x - b.min.x + r;
          const px1 = b.max.x - pos.x + r;
          const pz0 = pos.z - b.min.z + r;
          const pz1 = b.max.z - pos.z + r;
          const m = Math.min(px0, px1, pz0, pz1);
          if (m === px0) pos.x -= px0;
          else if (m === px1) pos.x += px1;
          else if (m === pz0) pos.z -= pz0;
          else pos.z += pz1;
        }
      }
    }
  }

  // Can a body of radius r walk the straight line a -> b (xz) at feet height a.y without touching a box?
  // 2D slab test against every collider in the body's vertical band. Cheap: no raycasts.
  segmentClear(a, b, r, step = 0.45, h = 1.6) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    for (const c of this.colliders) {
      const bx = c.box;
      if (bx.max.y <= a.y + step || bx.min.y >= a.y + h) continue;
      let t0 = 0;
      let t1 = 1;
      const slab = (p, d, lo, hi) => {
        if (Math.abs(d) < 1e-9) return p > lo && p < hi;
        let ta = (lo - p) / d;
        let tb = (hi - p) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        return t0 < t1;
      };
      if (slab(a.x, dx, bx.min.x - r, bx.max.x + r) && slab(a.z, dz, bx.min.z - r, bx.max.z + r)) return false;
    }
    return true;
  }

  // Box from min corner style args: center x/z, bottom y, size w/h/d.
  box(cx, y, cz, w, h, d, mat, { cover = null, collide = true, shadow = true } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const center = new THREE.Vector3(cx, y + h / 2, cz);
    applyWorldUVs(geo, center);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
    if (collide) {
      const box = new THREE.Box3(
        new THREE.Vector3(cx - w / 2, y, cz - d / 2),
        new THREE.Vector3(cx + w / 2, y + h, cz + d / 2),
      );
      const col = { box, mesh, cover };
      mesh.userData.collider = col;
      this.colliders.push(col);
      this.meshes.push(mesh);
      if (cover) this.coverMeshes.push(mesh);
    }
    return mesh;
  }

  strip(cx, y, cz, w, h, d, mat) {
    return this.box(cx, y, cz, w, h, d, mat, { collide: false, shadow: false });
  }

  pointLight(x, y, z, color, intensity, distance, flicker = null) {
    const l = new THREE.PointLight(color, intensity, distance, 2);
    l.position.set(x, y, z);
    this.scene.add(l);
    if (flicker) this.flickerLights.push({ light: l, base: intensity, seed: Math.random() * 100, strip: flicker.strip });
    return l;
  }

  #buildLevel(level, registry) {
    registry.check(level);
    for (const z of level.interiorZones ?? []) this.interiorZones.push(new THREE.Box3(new THREE.Vector3(...z.min), new THREE.Vector3(...z.max)));
    for (const piece of registry.piecesOf(level, 'world')) registry.build('world', this, piece);
  }
}
