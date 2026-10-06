import * as THREE from "three";
import { SCOOTER_WHEEL } from "./scooter-wheel-layout";

/** Telescopic front fork and rear coil-over in the original scooter's coordinates. */
export function createScooterSuspension(parent: THREE.Object3D) {
  const chrome = new THREE.MeshStandardMaterial({ color: "#bbc2c3", metalness: 0.85, roughness: 0.22 });
  const housing = new THREE.MeshStandardMaterial({ color: "#434947", metalness: 0.55, roughness: 0.36 });
  const seals = new THREE.MeshStandardMaterial({ color: "#222622", roughness: .86 });
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const axis = new THREE.Vector3(0, 1, 0);
  const dampers = [
    ...[-1,1].map(side=>({top:new THREE.Vector3(-.278,.292,side*SCOOTER_WHEEL.forkOffset),bottom:new THREE.Vector3(SCOOTER_WHEEL.front.x,SCOOTER_WHEEL.front.y,side*SCOOTER_WHEEL.forkOffset),front:true})),
    { top: new THREE.Vector3(.285, .195, .045), bottom: new THREE.Vector3(SCOOTER_WHEEL.rear.x, SCOOTER_WHEEL.rear.y, .045), front: false },
  ].map(definition => {
    const group = new THREE.Group();
    group.name = definition.front ? `Telescopic scooter front fork ${definition.bottom.z<0?'left':'right'}` : "Rear coil-over shock absorber";
    group.userData.frontFork=definition.front;group.userData.axleSide=Math.sign(definition.bottom.z);
    const shaft = new THREE.Mesh(cylinder, chrome);
    const sleeve = new THREE.Mesh(cylinder, housing);
    shaft.scale.set(.005, 1, .005);
    const sleeveLength=definition.front ? .084 : .043;
    sleeve.scale.set(definition.front?SCOOTER_WHEEL.forkRadius:.009, sleeveLength, definition.front?SCOOTER_WHEEL.forkRadius:.009);
    sleeve.position.y = sleeveLength/2;
    group.add(shaft, sleeve);
    if(definition.front){const seal=new THREE.Mesh(cylinder,seals);seal.scale.set(.0086,.004,.0086);seal.position.y=sleeveLength;group.add(seal);}
    let spring: THREE.Mesh | undefined;
    const restLength = definition.top.distanceTo(definition.bottom);
    if (!definition.front) {
      const points = Array.from({ length: 97 }, (_, i) => {
        const t = i / 96, angle = t * Math.PI * 16;
        return new THREE.Vector3(Math.cos(angle) * .011, t * restLength, Math.sin(angle) * .011);
      });
      const curve = new THREE.CatmullRomCurve3(points);
      spring = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, .0028, 6, false), housing);
      group.add(spring);
    }
    group.traverse(object => { if ((object as THREE.Mesh).isMesh) object.castShadow = true; });
    // The upper sliders continue inside the original shield/wheel housing.
    group.visible = true;
    parent.add(group);
    return { ...definition, group, shaft, sleeve, spring, restLength };
  });
  const direction = new THREE.Vector3();
  const bottom = new THREE.Vector3();
  const top = new THREE.Vector3();
  const steeringPivot = new THREE.Vector3(SCOOTER_WHEEL.front.x,SCOOTER_WHEEL.front.y,0);
  const axle=new THREE.Group();axle.name='Front axle with bilateral fork mounts';
  const pin=new THREE.Mesh(cylinder,chrome);pin.rotation.x=Math.PI/2;pin.scale.set(.009,SCOOTER_WHEEL.forkOffset*2,.009);axle.add(pin);
  for(const side of [-1,1]){const cap=new THREE.Mesh(cylinder,housing);cap.rotation.x=Math.PI/2;cap.scale.set(.011,.007,.011);cap.position.z=side*SCOOTER_WHEEL.forkOffset;cap.name=side<0?'Left front axle nut':'Right front axle nut';axle.add(cap);}
  axle.traverse(object=>{if((object as THREE.Mesh).isMesh)object.castShadow=true;});parent.add(axle);
  return (frontTravel: number, rearTravel: number, steering = 0) => {
    axle.position.copy(steeringPivot);axle.position.y+=THREE.MathUtils.clamp(frontTravel,0,SCOOTER_WHEEL.maxTravel);axle.rotation.y=steering;
    for (const damper of dampers) {
      bottom.copy(damper.bottom); bottom.y += THREE.MathUtils.clamp(damper.front ? frontTravel : rearTravel,0,SCOOTER_WHEEL.maxTravel);
      top.copy(damper.top);
      if (damper.front) {
        bottom.sub(steeringPivot).applyAxisAngle(axis, steering).add(steeringPivot);
        top.sub(steeringPivot).applyAxisAngle(axis, steering).add(steeringPivot);
      }
      direction.subVectors(top, bottom);
      const length = direction.length();
      damper.group.position.copy(bottom);
      damper.group.quaternion.setFromUnitVectors(axis, direction.normalize());
      damper.shaft.scale.y = length; damper.shaft.position.y = length / 2;
      // Object-space compression keeps the full coil mesh on the GPU. Its normal
      // matrix and transformed bounds follow automatically, without buffer uploads.
      if (damper.spring) damper.spring.scale.y = length / damper.restLength;
    }
  };
}
