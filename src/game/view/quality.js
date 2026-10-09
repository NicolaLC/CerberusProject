import { setAnisotropy } from '../world/textures.js';

// Graphics quality presets. The engine's dynamic resolution still runs under every preset: `scale`
// only caps the render pixel ratio it may climb to (Ultra supersamples on 1x displays).
export const QUALITY = {
  low: { label: 'Low', scale: 1, msaa: 0, bloom: false, shadow: 2048, aniso: 4 },
  high: { label: 'High', scale: 2, msaa: 4, bloom: true, shadow: 4096, aniso: 8 },
  ultra: { label: 'Ultra', scale: 2, superSample: 1.5, msaa: 8, /* WebGPU: 4 */ bloom: true, shadow: 4096, aniso: 16 },
};

export function applyQuality(name, { engine, post, world }) {
  const q = QUALITY[name] ?? QUALITY.high;
  const { renderer, perf } = engine;
  perf.maxScale = Math.min(devicePixelRatio * (q.superSample ?? 1), q.scale);
  perf.scale = perf.maxScale; // restart from the top; the scaler steps down again if frames run long
  post.setQuality(q);
  setAnisotropy(Math.min(q.aniso, renderer.getMaxAnisotropy()));
  world.sun.shadow.mapSize.set(q.shadow, q.shadow); // the shadow node resizes its map on the next shadow pass
  engine.resize();
  return q;
}
