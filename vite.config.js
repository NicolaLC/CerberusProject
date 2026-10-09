import { defineConfig } from 'vite';

// One three.js build for the whole app: the WebGPU build (WebGPURenderer, node materials, TSL). It renders with
// WebGPU where available and falls back to its own WebGL 2 backend. Aliasing the bare 'three' import keeps
// addons and our code on the same module instance (no duplicate three.js core).
export default defineConfig({
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
  },
});
