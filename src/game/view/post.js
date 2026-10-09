import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Post stack: scene (MSAA, HDR) -> bloom -> grade (vignette, CA, grain, damage/kill flashes) -> output (ACES + sRGB).
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    aberration: { value: 0.0015 },
    vignette: { value: 0.35 },
    grain: { value: 0.035 },
    saturation: { value: 1.08 },
    contrast: { value: 1.06 },
    tint: { value: new THREE.Color(1.0, 0.98, 0.95) },
    damage: { value: 0 },
    lowHealth: { value: 0 },
    flash: { value: 0 },
    aim: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time, aberration, vignette, grain, saturation, contrast, damage, lowHealth, flash, aim;
    uniform vec3 tint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time * 61.0) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      float ca = aberration + damage * 0.012 + lowHealth * 0.004;
      vec2 off = c * ca * (0.5 + r2 * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;

      // grade
      col *= tint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation * (1.0 - lowHealth * 0.75));
      col = (col - 0.18) * contrast + 0.18;
      col = max(col, 0.0);

      // vignette (stronger while aiming / hurt)
      float v = smoothstep(0.85, 0.15, r2 * (1.6 + aim * 0.8));
      col *= mix(1.0 - vignette, 1.0, v);
      col = mix(col, col * vec3(1.6, 0.25, 0.2), (1.0 - v) * clamp(damage + lowHealth * 0.6, 0.0, 1.0));

      // kill / hit flash
      col += vec3(1.0, 0.95, 0.85) * flash * 0.35;

      // grain
      col += (hash(vUv * 1000.0) - 0.5) * grain * (0.6 + l);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Post stack + auto exposure. Follows the engine's dynamic resolution through 'engine:resize'.
const EXPOSURE = { outside: 1.0, inside: 1.9, rate: 1.2 };

export class Post {
  constructor(renderer, scene, camera, events) {
    this.renderer = renderer;
    this.exposure = EXPOSURE.outside;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.maxSamples = renderer.capabilities.maxSamples;
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.45, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.u = this.grade.uniforms;
    this.flash = 0;
    this.damage = 0;
    events.on('engine:resize', ({ width, height, pixelRatio }) => this.setSize(width, height, pixelRatio));
  }

  hit(amount = 1) {
    this.damage = Math.min(1, this.damage + 0.5 * amount);
  }

  kill() {
    this.flash = 1;
  }

  // Graphics quality: MSAA samples of the HDR scene target (0 = off) and bloom on/off.
  setQuality({ msaa, bloom }) {
    const samples = Math.min(msaa, this.maxSamples);
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples === samples) continue;
      rt.samples = samples;
      rt.dispose(); // reallocated with the new sample count on the next render
    }
    this.bloom.enabled = bloom;
  }

  setSize(w, h, pixelRatio = this.renderer.getPixelRatio()) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt, { player, inside }) {
    // eyes open up indoors, clamp down in the sun
    this.exposure += ((inside ? EXPOSURE.inside : EXPOSURE.outside) - this.exposure) * (1 - Math.exp(-dt * EXPOSURE.rate));
    this.renderer.toneMappingExposure = this.exposure;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.damage = Math.max(0, this.damage - dt * 2.2);
    const u = this.u;
    u.time.value = (u.time.value + dt) % 100;
    u.flash.value = this.flash;
    u.damage.value = this.damage;
    u.lowHealth.value += ((player.shields <= 0 && !player.dead ? 1 - player.health / 100 + 0.3 : player.dead ? 1 : 0) - u.lowHealth.value) * Math.min(1, dt * 4);
    u.aim.value += ((player.aiming ? 1 : 0) - u.aim.value) * Math.min(1, dt * 10);
    // cooler grade indoors, warm in the sun
    const t = inside ? [0.92, 0.98, 1.08] : [1.04, 1.0, 0.94];
    u.tint.value.r += (t[0] - u.tint.value.r) * dt * 2;
    u.tint.value.g += (t[1] - u.tint.value.g) * dt * 2;
    u.tint.value.b += (t[2] - u.tint.value.b) * dt * 2;
    this.bloom.strength = inside ? 0.7 : 0.4;
    this.composer.render(dt);
  }
}
