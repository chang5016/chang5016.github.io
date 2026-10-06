import * as THREE from "three";

/** Preserve source transforms and appearance; let the camera cull local batches. */
export function partitionInstances(source: THREE.InstancedMesh, cellSize = 120) {
  if (source.count < 64 || source.userData.spatialPartitioned) return 0;
  const buckets = new Map<string, number[]>();
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < source.count; i++) {
    source.getMatrixAt(i, matrix);
    const key = `${Math.floor(matrix.elements[12] / cellSize)},${Math.floor(matrix.elements[14] / cellSize)}`;
    const entries = buckets.get(key) ?? []; entries.push(i); buckets.set(key, entries);
  }
  if (buckets.size < 2) return 0;
  const geometry = source.geometry;
  const color = new THREE.Color();
  for (const [key, entries] of buckets) {
    const chunk = new THREE.InstancedMesh(geometry, source.material, entries.length);
    chunk.name = `${source.name} / cell ${key}`;
    chunk.castShadow = source.castShadow; chunk.receiveShadow = source.receiveShadow;
    chunk.userData.spatialPartitioned = true;
    if (source.userData.terrainInstances) chunk.userData.terrainInstances = entries.map(i => source.userData.terrainInstances[i]);
    entries.forEach((index, local) => {
      source.getMatrixAt(index, matrix); chunk.setMatrixAt(local, matrix);
      if (source.instanceColor) { source.getColorAt(index, color); chunk.setColorAt(local, color); }
    });
    chunk.computeBoundingBox(); chunk.computeBoundingSphere();
    source.add(chunk);
  }
  // Retain the source as a transform/metadata container for terrain and audits.
  source.geometry = geometry.clone(); source.geometry.setDrawRange(0, 0);
  source.userData.spatialPartitioned = true;
  return buckets.size;
}
