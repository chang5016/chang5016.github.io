import type { Coordinates } from "./game-core";
import * as THREE from "three";

// Measurements are from the complete supplied street_2(1).glb in Y-up world space.
// Uniform scaling and rigid transforms only: no vertex/triangle cropping.
export const SHOPPING_STREET = {
  center: { x: -422.5, z: 540 },
  scale: 0.02,
  roadDatum: 4.94320821762085,
  sourceMinX: -1243.24267578125,
  sourceCenterZ: (-2408.462158203125 + 2284.17822265625) / 2,
  // Reach the actual asphalt edges of all four surrounding city streets.
  parcel: { left: -476.5, right: -367.35, back: 463.5, front: 613.4 },
  boulevardHalfWidth: 18.55,
  terrainPadding: 56,
  terrainBlend: 32,
};

export function insideShoppingStreet(point: Coordinates, margin = 0) {
  const r = SHOPPING_STREET.parcel;
  return point.x > r.left - margin && point.x < r.right + margin
    && point.z > r.back - margin && point.z < r.front + margin;
}

export function shoppingStreetPlacement(side: -1 | 1) {
  const s = SHOPPING_STREET;
  return {
    rotation: -side * Math.PI / 2,
    x: s.center.x + side * s.sourceCenterZ * s.scale,
    z: s.center.z + side * (0.4 - s.sourceMinX * s.scale),
    yOffset: 0.082 - s.roadDatum * s.scale,
  };
}

export function shoppingStreetPoint(x: number, z: number, side: -1 | 1) {
  const p = shoppingStreetPlacement(side), scale = SHOPPING_STREET.scale;
  return { x: p.x - side * z * scale, z: p.z + side * x * scale };
}

// Same plateau for visual terrain, rigid buildings, road and vehicle physics.
// Smooth transition outside the parcel, rather than lifting the model off a slope.
export function shoppingTerrainElevation(point: Coordinates, raw: number, datum: number) {
  const r = SHOPPING_STREET.parcel;
  // Include neighboring road cross-sections and the corners of the coarse
  // background terrain cells. Otherwise interpolated terrain can pierce a slab
  // even when every slab vertex and the vehicle height function are correct.
  const outside = Math.max(r.left - point.x, point.x - r.right, r.back - point.z, point.z - r.front, 0);
  const t = Math.max(0, Math.min(1, (outside - SHOPPING_STREET.terrainPadding) / SHOPPING_STREET.terrainBlend));
  const blend = t * t * (3 - 2 * t);
  return datum * (1 - blend) + raw * blend;
}

export function isShoppingStreetSpine(a: Coordinates, b: Coordinates) {
  return Math.abs(a.z - 540) < 0.05 && Math.abs(b.z - 540) < 0.05
    && Math.min(a.x, b.x) >= -480.05 && Math.max(a.x, b.x) <= -364.95;
}

export function createShoppingStreetInstances(template: THREE.Object3D, elevation: number, asphalt?: THREE.Material) {
  const group = new THREE.Group();
  group.name = "Two complete opposing Taiwanese shopping-street rows";
  group.position.y = elevation;
  group.userData.terrainAnchor = SHOPPING_STREET.center;
  group.userData.terrainOffset = 0;
  group.userData.completeSourceTrianglesPerRow = 826904;
  template.updateMatrixWorld(true);
  const transforms = ([-1, 1] as const).map((side) => {
    const p = shoppingStreetPlacement(side);
    return new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.yOffset, p.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation),
      new THREE.Vector3().setScalar(SHOPPING_STREET.scale));
  });
  template.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    // One draw call per original surface for both rows; never cut or simplify
    // the authored mesh just to reduce download size or per-frame work.
    const isAsphalt = asphalt && !Array.isArray(mesh.material) && mesh.material.name === "Blacktop_New_1";
    const geometry = isAsphalt ? mesh.geometry.clone() : mesh.geometry;
    if (isAsphalt) {
      // Change only asphalt UVs/material, never positions, indices or building
      // surfaces. Both supplied asphalt and connecting asphalt use 4 m repeats.
      const positions = geometry.getAttribute("position");
      const uv = new Float32Array(positions.count * 2);
      const point = new THREE.Vector3();
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        uv[i * 2] = point.x * SHOPPING_STREET.scale / 4;
        uv[i * 2 + 1] = point.z * SHOPPING_STREET.scale / 4;
      }
      geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    }
    const instances = new THREE.InstancedMesh(geometry, isAsphalt ? asphalt : mesh.material, 2);
    instances.name = `Complete paired street surface: ${mesh.name}`;
    transforms.forEach((matrix, index) => instances.setMatrixAt(index, matrix.clone().multiply(mesh.matrixWorld)));
    instances.instanceMatrix.needsUpdate = true;
    instances.computeBoundingBox();
    instances.computeBoundingSphere();
    instances.castShadow = false;
    instances.receiveShadow = true;
    group.add(instances);
  });
  return group;
}
