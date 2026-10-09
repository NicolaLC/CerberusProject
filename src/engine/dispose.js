import { forgetShadowOnly } from './batch.js';

// Frees what an object tree owns on the GPU and detaches it from its parent: geometries, materials, skeleton
// bone textures, instance buffers, and the shadow-only registration of batch meshes (engine/batch.js).
// Leaves alone: materials in `keep` (a Set, e.g. a system's shared material table), materials flagged
// `userData.shared`, and every texture (textures are shared caches here: grid textures, soft sprites).
// Disposing something that is still referenced elsewhere is safe in three.js (it is re-uploaded on next use),
// only wasteful, so shared geometry caches (parts.js) may pass through here.
export function disposeTree(root, { keep = null } = {}) {
  root.removeFromParent();
  root.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
      forgetShadowOnly(o);
      o.geometry?.dispose();
      disposeMaterial(o.material, keep);
    }
    if (o.isInstancedMesh) o.dispose();
    if (o.isSkinnedMesh) o.skeleton?.dispose();
    if (o.isLight) o.dispose?.();
  });
}

export function disposeMaterial(material, keep = null) {
  if (!material) return;
  for (const m of Array.isArray(material) ? material : [material]) {
    if (keep?.has(m) || m.userData.shared) continue;
    m.dispose();
  }
}
