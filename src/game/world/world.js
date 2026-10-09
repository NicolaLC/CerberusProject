import * as THREE from 'three';
import { gridTexture, applyWorldUVs } from './textures.js';
import { mergeStatic } from '../../engine/batch.js';

// Static level: axis-aligned boxes only (collision, cover and shadows depend on that).
// Coordinates: x = east, z = south, y = up. Floor is y = 0.

export const SUN_DIR = new THREE.Vector3(0.45, 0.78, 0.43).normalize();

// Per-face material array for BoxGeometry (order: +x, -x, +y, -y, +z, -z).
function faces(def, { px, nx, py, ny, pz, nz } = {}) {
  return [px ?? def, nx ?? def, py ?? def, ny ?? def, pz ?? def, nz ?? def];
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = []; // { box: Box3, mesh, cover: 'low' | 'high' | null }
    this.meshes = []; // raycast targets for bullets / camera / LOS
    this.coverMeshes = [];
    this.interiorZones = [];
    this.flickerLights = [];
    this.staticMeshes = []; // every level box; merged per material for rendering, kept as raycast proxies

    this.mats = this.#makeMaterials();
    this.#buildSky();
    this.#buildLights();
    this.#buildLevel();
    // ~60 boxes x up to 6 face materials -> one draw per material (+ shadow pass)
    this.batches = mergeStatic(this.staticMeshes, scene);
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

  #buildLevel() {
    const m = this.mats;
    const LOW = 1.1;
    const HIGH = 2.8;

    // ---------- Outdoor ground + perimeter ----------
    this.box(0, -1, -6, 104, 1, 116, m.floor, { shadow: false });
    this.box(0, 0, 50.5, 102, 6, 1, m.wall); // south
    this.box(-50.5, 0, -6, 1, 6, 114, m.wall); // west
    this.box(50.5, 0, -6, 1, 6, 114, m.wall); // east
    this.box(-37.5, 0, -62.5, 26, 8, 1, m.wall); // north, west of building
    this.box(37.5, 0, -62.5, 26, 8, 1, m.wall); // north, east of building
    this.box(0, 0, -62.5, 49, 8, 1, faces(m.wall, { pz: m.inWall })); // building back wall

    // ---------- Spawn / first cover line ----------
    for (const x of [-20, -8, 6, 18]) this.box(x, 0, 25, 3, LOW, 1, m.low, { cover: 'low' });
    this.box(-14, 0, 12, 1, HIGH, 5, m.high, { cover: 'high' });
    this.box(14, 0, 12, 1, HIGH, 5, m.high, { cover: 'high' });
    this.box(0, 0, 12, 6, HIGH, 1, m.high, { cover: 'high' });

    // ---------- Mid field ----------
    for (const x of [-24, -6, 10, 26]) this.box(x, 0, 0, 4, LOW, 1, m.low, { cover: 'low' });
    for (const x of [-16, 2, 18]) this.box(x, 0, -14, 3, LOW, 1, m.low, { cover: 'low' });
    this.box(-8, 0, -20, 1.2, HIGH, 1.2, m.high, { cover: 'high' });
    this.box(10, 0, -20, 1.2, HIGH, 1.2, m.high, { cover: 'high' });
    this.box(-2, 0, 4, 1, LOW, 3, m.low, { cover: 'low' });

    // ---------- West platform with stairs ----------
    const PH = 1.6;
    this.box(-40, 0, 0, 16, PH, 22, m.platform);
    // three 0.4 m steps down from the platform (a fourth would be 0 m tall: a flat box z-fighting the floor)
    for (let i = 0; i < 3; i++) this.box(-31.5 + i, 0, 0, 1, PH - (i + 1) * 0.4, 4, m.platform);
    this.box(-32.4, PH, -7, 0.6, LOW, 7, m.low, { cover: 'low' });
    this.box(-32.4, PH, 7, 0.6, LOW, 7, m.low, { cover: 'low' });
    this.box(-40, PH, -10.7, 8, LOW, 0.6, m.low, { cover: 'low' });

    // ---------- East shooting range ----------
    this.box(40, 0, 32, 18, LOW, 1, m.low, { cover: 'low' }); // firing line bench
    this.box(31, 0, 9, 0.6, 2.2, 42, m.wall, { cover: 'wall' }); // lane separator wall
    for (const z of [26, 14, 2, -10]) this.strip(40, 0.01, z, 18, 0.02, 0.15, m.stripWhite);

    // ---------- North-east arena: the spider mech (actors/spider.js ARENA) ----------
    // fenced off from the range by a wall with a gate; freestanding concrete walls to hide behind
    const AW = 3.2;
    this.box(34, 0, -14, 6, AW, 0.6, m.wall, { cover: 'wall' }); // x 31..37
    this.box(46.25, 0, -14, 7.5, AW, 0.6, m.wall, { cover: 'wall' }); // x 42.5..50
    for (const [x, z, w, d] of [
      [34, -23, 6, 0.6],
      [45, -29, 0.6, 5],
      [29.5, -36, 5, 0.6],
      [42, -42, 6.5, 0.6],
      [33, -52, 0.6, 5],
      [44.5, -55, 5, 0.6],
    ]) this.box(x, 0, z, w, AW, d, m.wall, { cover: 'wall' });
    this.box(39, 0, -33, 3, LOW, 1, m.low, { cover: 'low' });
    this.box(27.5, 0, -28, 1, LOW, 3, m.low, { cover: 'low' });
    this.box(37, 0, -58, 3, LOW, 1, m.low, { cover: 'low' });
    this.strip(39.75, AW, -14, 5.5, 0.12, 0.7, m.stripWhite); // gate lintel light (x 37..42.5)

    // ---------- Building (dark interior) ----------
    // footprint x -24..24, z -62..-30, wall height 7, roof at 7..7.5
    const WH = 7;
    const zS = -30;
    const wallT = 0.6;
    // south wall with two doors: A at x=-12, B at x=16 (4m wide, 4m tall)
    const southSegs = [[-24, -14], [-10, 14], [18, 24]];
    const southMat = faces(m.wall, { nz: m.inWall });
    for (const [a, b] of southSegs) this.box((a + b) / 2, 0, zS, b - a, WH, wallT, southMat, { cover: 'wall' });
    for (const x of [-12, 16]) this.box(x, 4, zS, 4, WH - 4, wallT, southMat);
    this.box(-24, 0, -46, wallT, WH, 32, faces(m.wall, { px: m.inWall }), { cover: 'wall' }); // west
    this.box(24, 0, -46, wallT, WH, 32, faces(m.wall, { nx: m.inWall }), { cover: 'wall' }); // east
    // interior floor
    this.box(0, 0, -46, 47.4, 0.02, 31.4, m.inFloor, { shadow: false });
    // inner partition at x = 8 with doorway at z=-40
    this.box(8, 0, -34.15, 0.5, WH, 7.7, m.inWall, { cover: 'wall' });
    this.box(8, 0, -52, 0.5, WH, 20, m.inWall, { cover: 'wall' });
    this.box(8, 3.5, -40, 0.5, WH - 3.5, 4, m.inWall);
    // roof with skylight over main hall (x -10..-2, z -50..-42)
    const RY = WH;
    const RT = 0.5;
    const roofMat = faces(m.roof, { ny: m.inWall });
    this.box(-17, RY, -46, 14, RT, 32.6, roofMat);
    this.box(11, RY, -46, 26, RT, 32.6, roofMat);
    this.box(-6, RY, -56.15, 8, RT, 12.3, roofMat);
    this.box(-6, RY, -36.15, 8, RT, 12.3, roofMat);
    this.interiorZones.push(new THREE.Box3(new THREE.Vector3(-24, 0, -62), new THREE.Vector3(24, 7, -30.3)));

    // main hall cover
    this.box(-16, 0, -37, 3, LOW, 1, m.inLow, { cover: 'low' });
    this.box(-4, 0, -36, 3, LOW, 1, m.inLow, { cover: 'low' });
    this.box(2, 0, -44, 1, LOW, 3, m.inLow, { cover: 'low' });
    this.box(-18, 0, -50, 1.2, HIGH, 1.2, m.inHigh, { cover: 'high' });
    this.box(-6, 0, -54, 4, LOW, 1, m.inLow, { cover: 'low' });
    this.box(-14, 0, -58, 1.2, HIGH, 1.2, m.inHigh, { cover: 'high' });
    // east room cover
    this.box(14, 0, -36, 3, LOW, 1, m.inLow, { cover: 'low' });
    this.box(18, 0, -46, 1.2, HIGH, 1.2, m.inHigh, { cover: 'high' });
    this.box(13, 0, -54, 4, LOW, 1, m.inLow, { cover: 'low' });

    // interior lights + emissive strips
    for (const z of [-34, -44, -54]) this.strip(-23.55, 5.5, z, 0.08, 0.12, 4, m.stripCyan);
    this.strip(7.7, 5.5, -50, 0.08, 0.12, 6, m.stripCyan);
    this.pointLight(-18, 5.5, -36, 0x38d8ff, 40, 22);
    this.pointLight(-16, 5.5, -56, 0x38d8ff, 32, 20);
    this.pointLight(2, 5.0, -56, 0xfff2d8, 30, 18);
    this.pointLight(-6, 6.2, -46, 0xfff4e6, 30, 22); // hall fill under the skylight
    this.pointLight(0, 5.5, -35, 0x9fe8ff, 24, 18);
    const red = this.strip(23.55, 5.0, -46, 0.08, 0.15, 8, m.stripRed.clone());
    this.pointLight(20, 5.0, -46, 0xff2a2a, 45, 20, { strip: red });
    this.pointLight(13, 4.0, -36, 0xff7a5a, 18, 14);
    this.pointLight(15, 5.5, -55, 0xffd8c8, 16, 14); // east room fill, keeps it readable during flicker
    // light strip above doors
    for (const x of [-12, 16]) this.strip(x, 4.1, -29.65, 4, 0.12, 0.08, m.stripWhite);
  }
}
