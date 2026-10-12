import { defineConfig } from 'vite';

// Relative asset URLs: the build runs from any folder or sub-path (static hosting, the desktop app's app://).
// optimizeDeps: modules only imported lazily (engine/assets.js) are pre-bundled up front, so a fresh dev server
// doesn't re-optimize and reload the page mid-test the first time they are imported.
export default defineConfig({
  base: './',
  optimizeDeps: {
    include: ['three/examples/jsm/loaders/GLTFLoader.js', 'three/examples/jsm/utils/SkeletonUtils.js'],
  },
});
