import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { partitionCityMesh } from "../app/city-render-chunks.ts";
import { completeDriverTrip, driverRank } from "../app/driver-career.ts";
import { RealWorldMap } from "../app/real-world-map.ts";
import { partitionInstances } from "../app/instance-chunks.ts";

test("local vegetation batches retain all instances and cull off-screen work", () => {
  const source = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial(), 10000);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < source.count; i++) source.setMatrixAt(i, matrix.makeTranslation((i % 100) * 12, 0, Math.floor(i / 100) * 12));
  assert.ok(partitionInstances(source) > 50);
  assert.equal(source.geometry.drawRange.count, 0);
  assert.equal(source.children.reduce((sum, child) => sum + child.count, 0), 10000);
  const nearbyView = new THREE.Box3(new THREE.Vector3(-10, -10, -10), new THREE.Vector3(130, 10, 130));
  const submitted = source.children.filter(child => nearbyView.intersectsBox(child.boundingBox)).reduce((sum, child) => sum + child.count, 0);
  assert.ok(submitted <= 400, `nearby view submitted ${submitted} of 10000 instances`);
  for (const child of source.children) assert.equal(child.geometry, source.children[0].geometry);
});

test("spatial building chunks retain every triangle with tight local bounds", () => {
  const geometry = new THREE.PlaneGeometry(2000, 2000, 80, 80);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const result = partitionCityMesh(mesh);
  assert.ok(result.children.length > 20);
  assert.equal(result.children.reduce((sum, chunk) => sum + chunk.geometry.index.count, 0), geometry.index.count);
  for (const chunk of result.children) {
    assert.equal(chunk.geometry.attributes.position, geometry.attributes.position);
    assert.ok(chunk.geometry.boundingSphere.radius < 180);
  }
});

test("spatial collision index includes large-building edges and avoids city-wide candidates", () => {
  const map = Object.create(RealWorldMap.prototype);
  map.buildings = Array.from({ length: 10000 }, (_, i) => ({ x: i * 20, z: 0, halfWidth: 4, halfDepth: 4 }));
  map.buildings.push({ x: 200, z: 200, halfWidth: 180, halfDepth: 20 });
  map.bridgePierGrid = { occupiedCellCount: 0 }; map.bridgePierColliders = [];
  assert.ok(map.nearbyStaticObstacles({ x: 25, z: 200 }, 10).some(b => b.halfWidth === 180));
  assert.ok(map.nearbyStaticObstacles({ x: 25, z: 0 }, 42).length < 10);
});

test("safe on-time trips build a bounded bonus; late or uncomfortable trips reset it", () => {
  assert.deepEqual(completeDriverTrip(90, 10, 2), { streak: 3, bonus: 55, grade: "S" });
  assert.equal(completeDriverTrip(100, 0, 8).bonus, 0);
  assert.equal(completeDriverTrip(50, 15, 8).streak, 0);
  assert.equal(completeDriverTrip(100, 10, 100).bonus, 75);
  assert.equal(driverRank(20), "海灣王牌");
});
