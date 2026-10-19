import * as THREE from 'three';
import { panelTexture } from '../world/textures.js';

// Skyline pieces shared by the title backdrop (view/menu-scene.js) and the in-game distant backdrop (world/backdrop.js, `env.backdrop`):
// glow points (beacons, sensors, the HiveMind's breathing eyes, smoke) and the lattice material (weathered panels lit by the work, no windows).
// soft glow points: additive lights (beacons, fires, sensors) or smoke (normal blend); size in metres, fogged like the scene
export function pointsMaterial(additive, { fog = new THREE.Color(0x2e6f78), density = 0.0012, scale = 800 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, scale: { value: scale }, fogColor: { value: fog }, fogDensity: { value: density } },
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
export function makePoints(n, additive, look) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
  g.setAttribute('anim', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const p = new THREE.Points(g, pointsMaterial(additive, look));
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

// The lattice material (art-style "World: machine-first"): the weathered wall panels (world.js skin) on world-space UVs,
// 4 m per tile, and no windows: the light leaks from the work. Vent bands every 22 m (segments lit by a hash), cyan data
// lines climbing the walls of compute structures, dull ember heat seams low on foundry blocks, a 24 m conduit grid on the
// roofs. `aLit` = job + light: the whole part is the job (0: from a hash of the instance origin, 1 compute, 2 foundry,
// 3 none), the fraction (< 1) scales the light. Every cyan
// light rides one sync wave that sweeps the whole lattice (the HiveMind is one mind). Thin features fade to their
// average where they get smaller than a pixel, so the skyline does not shimmer while the camera drifts.
// light: share of vent segments lit (the title 0.13; the in-game backdrop sparser). `material.userData.time` drives the pulses.
export function cityMaterial({ fog = true, light = 0.13 } = {}) {
  const m = new THREE.MeshLambertMaterial({ map: panelTexture({ tint: '#787f82', grime: 0.6 }), fog });
  const time = (m.userData.time = { value: 0 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;\nvarying float vSeed;\nvarying float vBase;\nvarying float vJob;\nvarying vec3 vWPos;\nvarying vec3 vWN;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vec4 wp = vec4(transformed, 1.0); vec3 wn = objectNormal; vSeed = 0.5; vBase = 0.0;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp; wn = mat3(instanceMatrix) * wn;
          vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453); vBase = instanceMatrix[3].y;
        #endif
        vWPos = (modelMatrix * wp).xyz; vWN = normalize(mat3(modelMatrix) * wn); vLit = fract(aLit); vJob = floor(aLit);
        vMapUv = (abs(vWN.y) > 0.6 ? vWPos.xz : vec2(abs(vWN.x) > abs(vWN.z) ? vWPos.z : vWPos.x, vWPos.y)) / 4.0;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying float vLit; varying float vSeed; varying float vBase; varying float vJob; varying vec3 vWPos; varying vec3 vWN;
        float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        // a line of width w every period p along x; px = metres per pixel: the line fades to its average coverage when thin
        float lines(float x, float p, float w, float px) {
          float f = abs(fract(x / p + 0.5) - 0.5) * p;
          return mix(1.0 - smoothstep(w * 0.5, w * 0.5 + px, f), w / p, smoothstep(w * 0.4, w * 1.5, px));
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 n = normalize(vWN);
          float wall = 1.0 - step(0.6, abs(n.y));
          float roof = step(0.6, n.y);
          float u = abs(n.x) > abs(n.z) ? vWPos.z : vWPos.x;
          float px = max(length(fwidth(vWPos)), 1e-3);
          float compute = vJob > 0.5 ? step(vJob, 1.5) : step(vSeed, 0.33);
          float foundry = vJob > 0.5 ? step(1.5, vJob) * step(vJob, 2.5) : step(0.86, vSeed);
          float sync = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * 0.5 - dot(vWPos.xz, vec2(0.004, 0.003))), 2.0);
          vec3 cyan = vec3(0.2, 0.75, 0.9), teal = vec3(0.3, 0.6, 0.62), ember = vec3(0.55, 0.16, 0.05);
          // vent bands: a 0.7 m seam every 22 m, cut into 9 m segments, a share of them lit
          float seg = step(${(1 - light).toFixed(3)}, hash2(vec2(floor(u / 9.0), floor(vWPos.y / 22.0)) + vSeed));
          vec3 e = teal * lines(vWPos.y, 22.0, 0.7, px) * mix(seg, ${light.toFixed(3)}, smoothstep(2.0, 9.0, px)) * wall * 1.4;
          // compute (a third of the structures): data lines every 7 m, a pulse climbing them in step everywhere
          float climb = pow(fract(vWPos.y / 140.0 - uTime * 0.22), 40.0);
          e += cyan * lines(u, 7.0, 0.35, px) * (0.12 + 0.9 * climb) * compute * wall;
          // foundries: ember heat seams low on the walls, a slow uneven glow
          float heat = 0.6 + 0.4 * sin(uTime * 0.7 + vSeed * 40.0 + u * 0.05);
          e += ember * 0.6 * lines(vWPos.y, 12.0, 0.5, px) * foundry * (1.0 - smoothstep(30.0, 50.0, vWPos.y - vBase)) * wall * heat;
          // roofs: the conduit grid
          e += cyan * max(lines(vWPos.x, 24.0, 0.6, px), lines(vWPos.z, 24.0, 0.6, px)) * roof * 0.5;
          totalEmissiveRadiance += e * sync * vLit;
        }`);
  };
  m.customProgramCacheKey = () => `lattice-${fog}-${light}`;
  return m;
}
