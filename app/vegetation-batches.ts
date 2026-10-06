import * as THREE from "three";

/** Local instance batches with identical geometry, textures, colours and matrices. */
export function createVegetationBatches(source: THREE.InstancedMesh, cellSize = 160) {
  if (source.count < 128) return null;
  const cells = new Map<string, number[]>(), matrix = new THREE.Matrix4();
  for (let index = 0; index < source.count; index++) {
    source.getMatrixAt(index, matrix);
    const key = `${Math.floor(matrix.elements[12] / cellSize)},${Math.floor(matrix.elements[14] / cellSize)}`;
    const cell = cells.get(key) ?? []; cell.push(index); cells.set(key, cell);
  }
  if (cells.size < 2) return null;
  const group = new THREE.Group();
  group.name = source.name;
  group.position.copy(source.position); group.quaternion.copy(source.quaternion); group.scale.copy(source.scale);
  group.userData = {...source.userData};
  group.userData.instanceCount = source.count;
  group.userData.spatialBatches = cells.size;
  const color = new THREE.Color();
  for (const [key, indices] of cells) {
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, indices.length);
    mesh.name = `${source.name} / ${key}`;
    mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow;
    mesh.layers.mask = source.layers.mask; mesh.renderOrder = source.renderOrder;
    mesh.userData = {...source.userData};
    if (source.userData.terrainInstances) mesh.userData.terrainInstances = indices.map(i=>source.userData.terrainInstances[i]);
    mesh.userData.expresswayAnchor = source.userData.expresswayAnchor;
    indices.forEach((index, local) => {
      source.getMatrixAt(index, matrix); mesh.setMatrixAt(local, matrix);
      if (source.instanceColor) { source.getColorAt(index, color); mesh.setColorAt(local, color); }
    });
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    group.add(mesh);
  }
  for (const child of [...source.children]) group.add(child);
  return group;
}
