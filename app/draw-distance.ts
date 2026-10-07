import * as THREE from "three";

/**
 * Draw-distance limits (metres from the camera to the nearest edge of an object's bounds).
 * Fog is fully opaque at its far distance, so city cells past it are pure fog colour;
 * street furniture and traffic are a few pixels tall long before their limits.
 */
export const DRAW_DISTANCE = { props: 170, traffic: 560, smallScenery: 220 } as const;

const cameraPosition = new THREE.Vector3();

export function cameraWorldPosition(camera: THREE.Camera) {
  return cameraPosition.setFromMatrixPosition(camera.matrixWorld);
}

export function fogLimit(scene: THREE.Scene | null | undefined) {
  const fog = scene?.fog as THREE.Fog | null | undefined;
  return fog && "far" in fog ? fog.far : Infinity;
}

export function withinDistance(sphere: THREE.Sphere, eye: THREE.Vector3, limit: number) {
  return sphere.center.distanceTo(eye) - sphere.radius < limit;
}
