import * as THREE from 'three';
import { panelTexture } from '../world/textures.js';

// Skyline pieces shared by the title backdrop (view/menu-scene.js) and the in-game distant backdrop (world/backdrop.js, `env.backdrop`):
// glow points (beacons, sensors, the HiveMind's breathing eyes, smoke) and the city material (weathered panels with sparse lit windows).
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

// The weathered wall panels (world.js skin) on world-space UVs, 4 m per tile, plus lit windows from world position (walls
// only, a 3.2 x 3.6 m cell grid, per-instance `aLit`), faded to their average where a cell gets smaller than a pixel so
// the skyline does not shimmer while the camera drifts.
// windows: share of window cells lit (the title 0.13; the in-game backdrop sparser)
export function cityMaterial({ fog = true, windows = 0.13 } = {}) {
  const m = new THREE.MeshLambertMaterial({ map: panelTexture({ tint: '#787f82', grime: 0.6 }), fog });
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
          float lit = step(${(1 - windows).toFixed(3)}, h) * win;
          float px = max(length(fwidth(cell)), 1e-4);
          lit = mix(lit, 0.034, smoothstep(0.35, 0.9, px));
          vec3 wc = mix(vec3(0.62, 0.78, 0.82), vec3(0.2, 0.75, 0.95), step(0.96, h));
          totalEmissiveRadiance += wc * lit * wall * vLit * 1.6;
        }`);
  };
  m.customProgramCacheKey = () => (fog && windows === 0.13 ? 'menu-city' : `menu-city-${fog}-${windows}`);
  return m;
}

