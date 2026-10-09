import * as THREE from 'three';
import { Fn, dot, fract, mix, pass, sin, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

// Post stack (node based, WebGPU or WebGL 2 backend):
// scene pass (MSAA, HDR half float) -> bloom -> grade (chromatic aberration, tint, saturation, contrast,
// vignette, damage/kill flashes, grain) -> output (ACES tone mapping + sRGB, applied by PostProcessing).
// Pass targets follow the renderer's size and pixel ratio by themselves (dynamic resolution needs nothing here).
const BLOOM = { strength: 0.45, radius: 0.55, threshold: 0.92 };
const EXPOSURE = { outside: 1.0, inside: 1.9, rate: 1.2 };

export class Post {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.exposure = EXPOSURE.outside;
    this.u = {
      time: uniform(0),
      aberration: uniform(0.0015),
      vignette: uniform(0.35),
      grain: uniform(0.035),
      saturation: uniform(1.08),
      contrast: uniform(1.06),
      tint: uniform(new THREE.Color(1.0, 0.98, 0.95)),
      damage: uniform(0),
      lowHealth: uniform(0),
      flash: uniform(0),
      aim: uniform(0),
    };
    this.pipeline = new THREE.PostProcessing(renderer);
    this.flash = 0;
    this.damage = 0;
    this.quality = { msaa: 4, bloom: true };
    this.#build();
  }

  // Graphics quality: MSAA samples of the scene pass (0 = off; WebGPU allows 1 or 4) and bloom on/off.
  setQuality({ msaa, bloom }) {
    const webgpu = this.renderer.backend.isWebGPUBackend;
    const samples = webgpu ? (msaa > 0 ? 4 : 0) : msaa;
    if (samples === this.quality.msaa && bloom === this.quality.bloom) return;
    this.quality = { msaa: samples, bloom };
    this.#build();
  }

  get samples() {
    return this.quality.msaa;
  }

  // (Re)builds the node graph: the scene pass owns its MSAA target, so a sample change means a new pass.
  #build() {
    this.scenePass?.dispose();
    this.bloom?.dispose();
    const u = this.u;
    this.scenePass = pass(this.scene, this.camera, { samples: this.quality.msaa });
    const sceneTex = this.scenePass.getTextureNode('output');
    this.bloom = this.quality.bloom ? bloom(sceneTex, BLOOM.strength, BLOOM.radius, BLOOM.threshold) : null;
    const bloomTex = this.bloom?.getTextureNode();
    const at = (p) => (bloomTex ? sceneTex.sample(p).add(bloomTex.sample(p)) : sceneTex.sample(p));
    const grade = Fn(() => {
      const p = uv();
      const c = p.sub(0.5);
      const r2 = dot(c, c);
      const ca = u.aberration.add(u.damage.mul(0.012)).add(u.lowHealth.mul(0.004));
      const off = c.mul(ca).mul(r2.mul(4).add(0.5));
      const col = vec3(at(p.add(off)).r, at(p).g, at(p.sub(off)).b).toVar();
      // grade
      col.mulAssign(u.tint);
      const l = dot(col, vec3(0.2126, 0.7152, 0.0722)).toVar();
      col.assign(mix(vec3(l), col, u.saturation.mul(u.lowHealth.mul(-0.75).add(1))));
      col.assign(col.sub(0.18).mul(u.contrast).add(0.18).max(0));
      // vignette (stronger while aiming / hurt)
      const v = smoothstep(0.15, 0.85, r2.mul(u.aim.mul(0.8).add(1.6))).oneMinus();
      col.mulAssign(mix(u.vignette.oneMinus(), 1, v));
      col.assign(mix(col, col.mul(vec3(1.6, 0.25, 0.2)), v.oneMinus().mul(u.damage.add(u.lowHealth.mul(0.6)).clamp(0, 1))));
      // kill / hit flash
      col.addAssign(vec3(1.0, 0.95, 0.85).mul(u.flash).mul(0.35));
      // grain
      const n = fract(sin(dot(p.mul(1000), vec2(12.9898, 78.233)).add(u.time.mul(61))).mul(43758.5453));
      col.addAssign(n.sub(0.5).mul(u.grain).mul(l.add(0.6)));
      return vec4(col, 1);
    });
    this.pipeline.outputNode = grade();
    this.pipeline.needsUpdate = true;
  }

  hit(amount = 1) {
    this.damage = Math.min(1, this.damage + 0.5 * amount);
  }

  kill() {
    this.flash = 1;
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
    if (this.bloom) this.bloom.strength.value = inside ? 0.7 : 0.4;
    this.pipeline.render();
  }
}
