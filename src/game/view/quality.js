import { setAnisotropy } from '../world/textures.js';

// Graphics quality presets. The engine's dynamic resolution still runs under every preset: `scale`
// only caps the render pixel ratio it may climb to (Ultra supersamples on 1x displays). `lights` is the point-light cap
// (instructions/engine.md) and the size of World's light pool.
export const QUALITY = {
  low: { label: 'Low', scale: 1, msaa: 0, bloom: false, shadow: 2048, aniso: 4, lights: 4 },
  high: { label: 'High', scale: 2, msaa: 4, bloom: true, shadow: 4096, aniso: 8, lights: 8 },
  ultra: { label: 'Ultra', scale: 2, superSample: 1.5, msaa: 8, bloom: true, shadow: 4096, aniso: 16, lights: 12 },
};

export function applyQuality(name, { engine, post, world }) {
  const q = QUALITY[name] ?? QUALITY.high;
  const { renderer, perf } = engine;
  perf.maxScale = Math.min(devicePixelRatio * (q.superSample ?? 1), q.scale);
  perf.scale = perf.maxScale; // restart from the top; the scaler steps down again if frames run long
  post.setQuality(q);
  setAnisotropy(Math.min(q.aniso, renderer.capabilities.getMaxAnisotropy()));
  world.setLightPool(q.lights); // a settings action: the one place the light count (and the shaders) may change
  const sun = world.sun;
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    sun.shadow.map?.dispose();
    sun.shadow.map = null; // reallocated at the new size on the next shadow pass
  }
  engine.resize();
  return q;
}
