import * as THREE from "three";

export function refreshChunkBounds(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  for (let i = 0; i < (geometry.index?.count ?? position.count); i++) {
    bounds.expandByPoint(point.fromBufferAttribute(position, geometry.index ? geometry.index.getX(i) : i));
  }
  geometry.boundingBox = bounds;
  geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
}

/** Partition static triangle indices, retaining all original vertex attributes. */
export function partitionCityMesh(mesh: THREE.Mesh, cellSize = 160, minimumIndices = 6000, minimumCells = 2) {
  const source = mesh.geometry;
  const position = source.getAttribute("position");
  if (!position || source.groups.length || Array.isArray(mesh.material)) return null;
  const count = source.index?.count ?? position.count;
  if (count < minimumIndices) return null;
  const buckets = new Map<string, number[]>();
  const indexAt = (i: number) => source.index ? source.index.getX(i) : i;
  for (let i = 0; i < count; i += 3) {
    const a = indexAt(i), b = indexAt(i + 1), c = indexAt(i + 2);
    const x = (position.getX(a) + position.getX(b) + position.getX(c)) / 3;
    const z = (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3;
    const key = `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(a, b, c); buckets.set(key, bucket);
  }
  if (buckets.size < minimumCells) return null;
  const group = new THREE.Group();
  group.name = mesh.name;
  group.position.copy(mesh.position); group.quaternion.copy(mesh.quaternion); group.scale.copy(mesh.scale);
  for (const [key, indices] of buckets) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(indices);
    geometry.userData.terrainSource = source;
    refreshChunkBounds(geometry);
    const chunk = new THREE.Mesh(geometry, mesh.material);
    chunk.name = `${mesh.name} / ${key}`;
    chunk.castShadow = mesh.castShadow; chunk.receiveShadow = mesh.receiveShadow;
    group.add(chunk);
  }
  group.userData.originalTriangles = count / 3;
  group.userData.spatialChunks = buckets.size;
  return group;
}
