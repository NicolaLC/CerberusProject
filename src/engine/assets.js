import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { disposeTree } from './dispose.js';

// Async glTF manager: cache by URL, reference-counted. Every load() takes one reference, every release() gives it back;
// at zero the cached gltf's GPU resources are freed. Not here (YAGNI): streaming, LRU budgets, worker decoding.
export class Assets {
  constructor(renderer) {
    this.loader = new GLTFLoader();
    // Compressed content plugs in here: this.loader.setKTX2Loader(ktx2.detectSupport(renderer)), setMeshoptDecoder(...),
    // setDRACOLoader(...). Their decoder / transcoder files must ship with the build (public/).
    this.renderer = renderer;
    this.entries = new Map(); // url -> { promise, gltf, refs }
  }

  // Resolves to the gltf ({ scene, animations, ... }); the same object for the same URL. A failed load rejects with the URL
  // in the message and leaves no cache entry, so it can be retried.
  load(url) {
    let e = this.entries.get(url);
    if (!e) {
      e = { gltf: null, refs: 0, promise: null };
      e.promise = this.loader.loadAsync(url).then(
        (gltf) => (e.gltf = gltf),
        (err) => {
          if (this.entries.get(url) === e) this.entries.delete(url);
          throw new Error(`Assets: failed to load ${url}: ${err?.message ?? err}`);
        },
      );
      this.entries.set(url, e);
    }
    e.refs++;
    return e.promise;
  }

  preload(urls) {
    return Promise.all(urls.map((u) => this.load(u)));
  }

  // A clone of the loaded scene to place in the world (skinned meshes cloned correctly). Geometries, materials and
  // textures stay SHARED with the cached original: never dispose an instance's resources, only remove it from the scene.
  // The URL must be loaded already.
  instance(url) {
    const gltf = this.entries.get(url)?.gltf;
    if (!gltf) throw new Error(`Assets: instance() before load finished: ${url}`);
    return clone(gltf.scene);
  }

  release(url) {
    const e = this.entries.get(url);
    if (!e || --e.refs > 0) return;
    this.entries.delete(url);
    if (!e.gltf) return; // still loading: nobody holds it, the result is dropped with the entry
    const root = e.gltf.scene;
    const mats = new Set();
    root.traverse((o) => { for (const m of [o.material].flat()) if (m) mats.add(m); });
    for (const m of mats) for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
    disposeTree(root);
  }
}
