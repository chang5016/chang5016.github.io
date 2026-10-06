import * as THREE from 'three';
import {ackermannSteering,VEHICLE_SPECS,type TrafficMotion,type VehicleClass} from './traffic-dynamics';
import {TRAFFIC_MOTORCYCLE_SCALE} from './vehicle-scale';
export type TrafficRig={root:THREE.Group;body:THREE.Object3D;wheels:Array<{pivot:THREE.Object3D;roll:THREE.Object3D;front:boolean;side:number;radius:number;y:number;z:number}>;brakes:THREE.MeshStandardMaterial[];indicators:Array<{material:THREE.MeshStandardMaterial;side:number}>};
/** Geometry, textures and unchanging materials are shared; only animated lamps/paint vary. */
export function createTrafficRig(template:THREE.Object3D,kind:VehicleClass,index:number):TrafficRig {
  const root=template.clone(true) as THREE.Group,body=root.getObjectByName('Chassis')??root;
  const displayScale=kind==='motorcycle'?TRAFFIC_MOTORCYCLE_SCALE:1;
  root.scale.multiplyScalar(displayScale);
  const wheels:TrafficRig['wheels']=[],brakes:TrafficRig['brakes']=[],indicators:TrafficRig['indicators']=[];
  const palette=['#e0e5e8','#48535c','#b93433','#182732','#8d969c','#d6d1c2'];
  const clones=new Map<THREE.Material,THREE.Material>();
  root.traverse(object=>{
    if(/^Wheel_[FR](?:[LR])?$/.test(object.name)) {
      const roll=object.children.find(c=>c.name.startsWith('Roll_'));
      if(roll)wheels.push({pivot:object,roll,front:!!object.userData.front,side:object.userData.side??0,radius:object.userData.radius!==undefined?object.userData.radius*displayScale:VEHICLE_SPECS[kind].radius,y:object.position.y,z:object.position.z});
    }
    const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
    mesh.castShadow=true;mesh.receiveShadow=true;
    const convert=(m:THREE.Material)=>{
      const name=m.name.toLowerCase(),brake=name.startsWith('brake'),indicator=name.startsWith('indicator'),paint=name==='paint';
      if(!brake&&!indicator&&!paint)return m;
      // Separate indicator sides must not share a mutable emissive material.
      let result=indicator?undefined:clones.get(m);
      if(!result){result=m.clone();if(!indicator)clones.set(m,result);}
      result.userData.trafficSourceMaterial=m.uuid;
      const standard=result as THREE.MeshStandardMaterial;
      if(paint)standard.color.set(kind==='taxi'?'#f5c51d':kind==='motorcycle'?'#f2f3f4':palette[index%palette.length]);
      if(brake&&!brakes.includes(standard)){standard.emissive.set('#ff1b08');brakes.push(standard);}
      if(indicator){standard.emissive.set('#ff8b12');indicators.push({material:standard,side:object.userData.side??(name.includes('left')?-1:1)});}
      return result;
    };
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(convert):convert(mesh.material);
  });
  root.userData.completeTrafficModel=wheels.length===(kind==='motorcycle'?2:4);
  return {root,body,wheels,brakes,indicators};
}
export function updateTrafficRig(rig:TrafficRig,motion:TrafficMotion,kind:VehicleClass,seconds:number,axleResidual=0) {
  const displayScale=kind==='motorcycle'?TRAFFIC_MOTORCYCLE_SCALE:1;
  rig.body.rotation.x=motion.pitch;rig.body.rotation.z=kind==='motorcycle'?0:motion.roll;rig.body.position.y=motion.heave/displayScale;
  const s=VEHICLE_SPECS[kind];
  for(const wheel of rig.wheels) {
    wheel.pivot.rotation.y=wheel.front?ackermannSteering(motion.steer,wheel.side,kind):0;
    wheel.pivot.position.y=wheel.y+Math.max(-s.travel,Math.min(s.travel,(wheel.front?1:-1)*axleResidual))/displayScale;
    wheel.roll.rotation.x=motion.distance/wheel.radius;
  }
  for(const lamp of rig.brakes)lamp.emissiveIntensity=motion.acceleration<-.45||motion.speed<.1?2.7:.28;
  const blink=Math.floor(seconds/.38)%2===0,side=Math.sign(motion.steer);
  for(const lamp of rig.indicators)lamp.material.emissiveIntensity=blink&&Math.abs(motion.steer)>.10&&lamp.side===side?2.2:.04;
}
