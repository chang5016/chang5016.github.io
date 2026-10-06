import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {readModelHierarchy} from './model-fixture.mjs';
import {createTrafficRig,updateTrafficRig} from '../app/traffic-rig.ts';
import {createTrafficMotion,advanceTrafficMotion,ackermannSteering,VEHICLE_SPECS} from '../app/traffic-dynamics.ts';
import {createLuxuryEstate} from '../app/luxury-estate.ts';
import {SCOOTER_DISPLAY_LENGTH,TRAFFIC_MOTORCYCLE_SCALE} from '../app/vehicle-scale.ts';
for(const [kind,file] of [['car','tesla'],['suv','bmw'],['sports','ferrari'],['motorcycle','motorcycle']])test(`complete ${kind} has grounded axle pivots, native lamps and shared intact geometry`,async()=>{
  const {group,document}=await readModelHierarchy(new URL(`../public/models/traffic-real/${file}.glb`,import.meta.url).pathname);
  const rig=createTrafficRig(group,kind,2),other=createTrafficRig(group,kind,3);
  assert.equal(rig.root.userData.completeTrafficModel,true);assert.equal(rig.wheels.length,kind==='motorcycle'?2:4);
  assert.ok(rig.brakes.length>0,'Use the native rear lens, not floating lamp-only objects');
  const size=new THREE.Box3().setFromObject(rig.root).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z-VEHICLE_SPECS[kind].length)<.12,`Actual model length ${size.z}`);
  assert.ok(size.y>.9&&size.x>(kind==='motorcycle'?.6:1.8),'Complete body, not wheels or lights alone');
  const originals=[],copies=[];rig.root.traverse(o=>{if(o.isMesh)originals.push(o);});other.root.traverse(o=>{if(o.isMesh)copies.push(o);});
  originals.forEach((mesh,i)=>assert.equal(mesh.geometry,copies[i].geometry,'Instances share geometry buffers'));
  const motion=createTrafficMotion();motion.speed=8;motion.distance=-120;motion.steer=.3;motion.acceleration=-2;
  updateTrafficRig(rig,motion,kind,1);
  for(const wheel of rig.wheels) {
    assert.ok(wheel.radius>.25&&wheel.radius<(kind==='motorcycle'?.55:.42));
    assert.ok(Math.abs(wheel.roll.rotation.x+120/wheel.radius)<1e-8,'Rolling angle follows distance / tyre radius');
    if(wheel.front)assert.ok(Math.abs(wheel.pivot.rotation.y)>.1);
    wheel.roll.updateWorldMatrix(true,true);const bounds=new THREE.Box3().setFromObject(wheel.roll),center=bounds.getCenter(new THREE.Vector3());
    assert.ok(center.distanceTo(wheel.pivot.getWorldPosition(new THREE.Vector3()))<.16,'Real wheel rotates about its axle, never orbits the car');
  }
  assert.ok(rig.brakes.every(m=>m.emissiveIntensity>2));
  assert.ok(document.getRoot().listMeshes().length<48,'Offline material batching bounds draw calls');
});
test('enlarged motorcycle preserves uniform component proportions and world-space wheel physics',async()=>{
  const {group}=await readModelHierarchy(new URL('../public/models/traffic-real/motorcycle.glb',import.meta.url).pathname);
  const nativeScale=group.scale.clone(),nativeBounds=new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  const rig=createTrafficRig(group,'motorcycle',0),bounds=new THREE.Box3().setFromObject(rig.root).getSize(new THREE.Vector3());
  assert.deepEqual(group.scale.toArray(),nativeScale.toArray(),'Shared source remains unchanged');
  for(const axis of ['x','y','z'])assert.ok(Math.abs(bounds[axis]/nativeBounds[axis]-TRAFFIC_MOTORCYCLE_SCALE)<1e-6,'Body, tyres, forks and lamps grow by the same factor');
  assert.ok(Math.abs(bounds.z-SCOOTER_DISPLAY_LENGTH)<.002);
  assert.ok(Math.abs(bounds.x-VEHICLE_SPECS.motorcycle.width)<.002,'Collision width matches the enlarged complete model');
  const motion=createTrafficMotion();motion.distance=2*Math.PI*rig.wheels[0].radius;motion.heave=.045;
  updateTrafficRig(rig,motion,'motorcycle',0,.025);rig.root.updateWorldMatrix(true,true);
  assert.ok(Math.abs(rig.body.getWorldPosition(new THREE.Vector3()).y-.045)<1e-6,'Heave remains in world metres after scaling');
  for(const wheel of rig.wheels){
    const native=group.getObjectByName(wheel.pivot.name);
    assert.ok(Math.abs(wheel.radius-native.userData.radius*TRAFFIC_MOTORCYCLE_SCALE)<1e-8);
    assert.ok(Math.abs(wheel.roll.rotation.x-motion.distance/wheel.radius)<1e-8);
    const travel=(wheel.pivot.position.y-wheel.y)*TRAFFIC_MOTORCYCLE_SCALE;
    assert.ok(Math.abs(travel-(wheel.front?.025:-.025))<1e-8,'Suspension displacement also remains in world metres');
  }
});
test('traffic acceleration remains smooth and frame-rate independent',()=>{
  const results=[];
  for(const hz of [30,60,144]){const s=createTrafficMotion();for(let i=0;i<hz*12;i++)advanceTrafficMotion(s,'car',1/hz,12,0);results.push(s);}
  assert.ok(Math.max(...results.map(s=>s.speed))-Math.min(...results.map(s=>s.speed))<.03);
  assert.ok(Math.max(...results.map(s=>s.distance))-Math.min(...results.map(s=>s.distance))<.1);
  assert.ok(results.every(s=>s.speed>10&&s.speed<12.01));
});
test('bumper-distance following stops safely without oversized collision halos',()=>{
  const motion=createTrafficMotion();motion.speed=12;let gap=35;
  for(let frame=0;frame<900;frame++){gap-=advanceTrafficMotion(motion,'car',1/60,12,0,gap,0);assert.ok(gap>=.44);}
  assert.ok(motion.speed<.1);assert.ok(gap<4&&gap>1,'A physical car gap, not an eight-metre invisible stopping zone');
});
test('curvature limits lateral acceleration and Ackermann gives different inner/outer wheel angles',()=>{
  const s=createTrafficMotion();s.speed=12;for(let i=0;i<600;i++)advanceTrafficMotion(s,'suv',1/60,12,.08);
  assert.ok(s.speed<5);assert.ok(Math.abs(s.roll)<=.045);assert.ok(s.heave<.01);
  assert.ok(Math.abs(ackermannSteering(.3,-1,'car'))>Math.abs(ackermannSteering(.3,1,'car')));
});
test('grand estate retains complete metric residence with an open gate and recessed pool',async()=>{
  const {group,document}=await readModelHierarchy(new URL('../public/models/estate/zigurat-residence.glb',import.meta.url).pathname);
  const before=new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  assert.ok(before.y>12&&before.y<13&&before.x>20&&before.z>25);
  const material=new THREE.MeshStandardMaterial(),materials=Object.fromEntries(['stone','dark','wood','glass','lawn','water','glow'].map(k=>[k,material]));
  const estate=createLuxuryEstate(group,materials);assert.equal(estate.userData.completeResidence,true);
  const triangles=document.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((sum,p)=>sum+p.getIndices().getCount()/3,0),0);
  assert.ok(triangles>13000,'Retain all complete source surfaces even when the FBX is a single authored mesh');assert.ok(estate.getObjectByName('Intact Zigurat architectural luxury residence'));
  const pool=estate.getObjectByName('Recessed infinity-pool water and visible submerged basin');assert.ok(pool.position.y<0);
  assert.equal(estate.userData.parcelWidth,76);assert.equal(estate.userData.parcelDepth,62);
});
