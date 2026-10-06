import * as THREE from "three";
import { SCOOTER_WHEEL } from "./scooter-wheel-layout";
import wheelMask from "./scooter-wheel-mask.json";

export function createRigidScooterWheels(body: THREE.Mesh, parent: THREE.Object3D) {
  const geometry = body.geometry.clone();
  const positions = geometry.getAttribute("position");
  const index = geometry.index;
  const kept: number[] = [];
  const count = index?.count ?? positions.count;
  const originalModel = positions.count === wheelMask.positionCount && count === wheelMask.indexCount;
  let rangeIndex = 0;
  // Apply the offline material-aware mask to a clone. The original model and
  // every painted body panel remain intact; no texture reads happen per frame.
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map(k => index ? index.getX(i + k) : i + k);
    if (originalModel) {
      const face = i / 3;
      while (rangeIndex < wheelMask.removedRanges.length && face >= wheelMask.removedRanges[rangeIndex][1]) rangeIndex++;
      const range = wheelMask.removedRanges[rangeIndex];
      if (!range || face < range[0]) kept.push(...ids);
      continue;
    }
    const x = ids.reduce((sum, id) => sum + positions.getX(id), 0) / 3;
    const y = ids.reduce((sum, id) => sum + positions.getY(id), 0) / 3;
    const z = ids.reduce((sum, id) => sum + positions.getZ(id), 0) / 3;
    const wheel = Math.abs(z) < .084 && ((Math.hypot(x - SCOOTER_WHEEL.rear.x, y - SCOOTER_WHEEL.rear.y) < .127) || (Math.hypot(x - SCOOTER_WHEEL.front.x, y - SCOOTER_WHEEL.front.y) < .133));
    if (!wheel) kept.push(...ids);
  }
  geometry.setIndex(kept);
  geometry.computeBoundingSphere();
  body.geometry = geometry;
  body.userData.replacedWheelTriangles = (count - kept.length) / 3;
  const rubber = new THREE.MeshStandardMaterial({ color: "#202321", roughness: .94, metalness: 0 });
  const alloy = new THREE.MeshStandardMaterial({ color: "#b4b9b3", roughness: .28, metalness: .8 });
  const hubMaterial = new THREE.MeshStandardMaterial({ color: "#505650", roughness: .4, metalness: .65 });
  const tireGeometry = new THREE.TorusGeometry(.075, .027, 16, 64);
  tireGeometry.scale(1, 1, 1.4);
  const cylinder = (radius: number, depth: number) => {
    const result = new THREE.CylinderGeometry(radius, radius, depth, 40);
    result.rotateX(Math.PI / 2); return result;
  };
  const wheels = [SCOOTER_WHEEL.front, SCOOTER_WHEEL.rear].map((mount, wheelIndex) => {
    const axle = new THREE.Group(); axle.position.set(mount.x, mount.y, 0);
    axle.name = wheelIndex === 0 ? "Independent front wheel axle" : "Independent rear wheel axle";
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(tireGeometry, rubber);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.052, .007, 10, 48), alloy);
    const hub = new THREE.Mesh(cylinder(.017, .075), hubMaterial);
    const brake = new THREE.Mesh(cylinder(.041, .004), alloy); brake.position.z = .034;
    const spokes = new THREE.InstancedMesh(new THREE.BoxGeometry(.037, .007, .014), alloy, 8);
    const bolts = new THREE.InstancedMesh(cylinder(.0025, .004), hubMaterial, 8);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      matrix.makeRotationZ(angle); matrix.setPosition(Math.cos(angle) * .031, Math.sin(angle) * .031, 0); spokes.setMatrixAt(i, matrix);
      matrix.makeTranslation(Math.cos(angle) * .031, Math.sin(angle) * .031, .038); bolts.setMatrixAt(i, matrix);
    }
    spin.add(tire, rim, hub, brake, spokes, bolts); axle.add(spin); parent.add(axle);
    axle.traverse(object => { if ((object as THREE.Mesh).isMesh) { object.castShadow = true; object.receiveShadow = true; } });
    return { axle, spin, rest: axle.position.y };
  });
  return (angle: number, steering: number, frontTravel: number, rearTravel: number) => {
    wheels.forEach((wheel, index) => {
      // Native forward is -X; positive Z rotation rolls its contact patch backward.
      wheel.spin.rotation.z = angle;
      wheel.axle.rotation.y = index === 0 ? steering : 0;
      wheel.axle.position.y = wheel.rest + THREE.MathUtils.clamp(index === 0 ? frontTravel : rearTravel, 0, SCOOTER_WHEEL.maxTravel);
    });
  };
}
