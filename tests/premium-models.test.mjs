import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import * as THREE from 'three';
import {readModelGeometry} from './model-fixture.mjs';
import {BUILDING_MODELS,planStockBuildings} from '../app/stock-buildings.ts';
import {createScooterSuspension} from '../app/scooter-suspension.ts';import {createRigidScooterWheels} from '../app/rigid-scooter-wheels.ts';import {SCOOTER_WHEEL,scooterSteeringYaw} from '../app/scooter-wheel-layout.ts';

test('the actual aligned hero front wheel points toward the physical left/right turn at every heading',async()=>{
 const {group:model}=await readModelGeometry(new URL('../public/models/capybara-premium-original.glb',import.meta.url).pathname);
 model.rotation.y=Math.PI*1.5;
 const hero=new THREE.Group();hero.add(model);
 const update=createRigidScooterWheels(model.children[0],model),fork=createScooterSuspension(model);
 const front=model.getObjectByName('Independent front wheel axle'),rear=model.getObjectByName('Independent rear wheel axle');
 for(const heading of [0,Math.PI/2,Math.PI,-.63])for(const steering of [-.6,0,.6]){
  hero.rotation.y=-heading;const yaw=scooterSteeringYaw(steering);update(7.3,yaw,.02,.01);fork(.02,.01,yaw);hero.updateMatrixWorld(true);
  const forward=new THREE.Vector3(Math.sin(heading),0,-Math.cos(heading)),right=new THREE.Vector3(Math.cos(heading),0,Math.sin(heading));
  const direction=new THREE.Vector3(-1,0,0).applyQuaternion(front.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(direction.dot(forward)>.95,'The steered wheel still points forward');
  if(steering)assert.ok(direction.dot(right)*steering>0,'Steering must point to the same side as the actual riding physics');
  else assert.ok(Math.abs(direction.dot(right))<1e-8);
  assert.ok(new THREE.Vector3(-1,0,0).applyQuaternion(rear.getWorldQuaternion(new THREE.Quaternion())).distanceTo(forward)<1e-8,'The rear axle stays aligned to the scooter');
 }
});
test('complete premium exteriors preserve metric storeys and share full PBR materials',async()=>{
 const path=new URL('../public/models/buildings/premium-towers.glb',import.meta.url).pathname,{document,group}=await readModelGeometry(path),report=JSON.parse(await readFile(new URL('../public/models/buildings/premium-towers.integrity.json',import.meta.url),'utf8'));
 assert.equal(report.sha256,createHash('sha256').update(await readFile(path)).digest('hex'));assert.equal(group.children.length,3);assert.equal(document.getRoot().listMaterials().length,1);assert.equal(document.getRoot().listTextures().length,3);assert.ok(report.bytes<6000000);
 const material=document.getRoot().listMaterials()[0];assert.ok(material.getBaseColorTexture()&&material.getNormalTexture()&&material.getMetallicRoughnessTexture()&&material.getOcclusionTexture());
 for(const model of group.children){const spec=BUILDING_MODELS[model.name],bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
  for(const[axis,key]of[['x','width'],['y','height'],['z','depth']])assert.ok(Math.abs(size[axis]-spec[key])<1e-4);assert.ok(Math.abs(bounds.min.y)<1e-5);assert.ok(model.geometry.index.count/3<20000);assert.ok(report.models[model.name].floorHeight>=3.2&&report.models[model.name].floorHeight<=3.4);
  for(const d of [new THREE.Vector3(1,0,0),new THREE.Vector3(-1,0,0),new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,-1)]){const ray=new THREE.Raycaster(d.clone().multiplyScalar(40).add(new THREE.Vector3(0,12,0)),d.clone().negate());assert.ok(ray.intersectObject(model).length>0,'All four elevations have real geometry');}
 }
});
test('model choice fits original skyline without stretching windows or shrinking tall towers',()=>{
 const candidates=[29,36,46,56,90].map((height,i)=>({archetype:'office',name:'',height,distance:i*80,bounds:{x:i*80,z:20,halfWidth:20,halfDepth:12}}));
 const plan=planStockBuildings(candidates,[{a:{x:-40,z:0},b:{x:850,z:0},width:10}],()=>0);assert.equal(plan.size,4);assert.equal(new Set([...plan.values()].map(p=>p.kind)).size,4);assert.ok(!plan.has(candidates[4]));
 for(const[c,p]of plan){assert.ok(p.scale>=.94&&p.scale<=1.07);assert.ok(Math.abs(BUILDING_MODELS[p.kind].height*p.scale/c.height-1)<=.13);}
});
test('bilateral front sliders clear tyre and follow the actual -X front axle in all poses',()=>{
 const root=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(1,.8,.2),new THREE.MeshStandardMaterial());
 const wheels=createRigidScooterWheels(body,root),suspension=createScooterSuspension(root),forks=root.children.filter(o=>o.userData.frontFork),wheel=root.getObjectByName('Independent front wheel axle'),axle=root.getObjectByName('Front axle with bilateral fork mounts');
 assert.equal(forks.length,2);assert.ok(SCOOTER_WHEEL.front.x<0&&SCOOTER_WHEEL.rear.x>0);assert.deepEqual(forks.map(f=>f.userData.axleSide),[-1,1]);assert.ok(SCOOTER_WHEEL.forkOffset-SCOOTER_WHEEL.forkRadius>SCOOTER_WHEEL.tireHalfWidth+.005);
 for(const steering of [-.45,0,.45])for(const travel of [0,.02,.045,.08]){wheels(1.3,steering,travel,0);suspension(travel,0,steering);root.updateMatrixWorld(true);assert.ok(wheel.position.distanceTo(axle.position)<1e-8);
  for(const fork of forks){const local=wheel.worldToLocal(fork.getWorldPosition(new THREE.Vector3()));assert.ok(Math.abs(local.x)<1e-8&&Math.abs(local.y)<1e-8);assert.ok(Math.abs(local.z-fork.userData.axleSide*SCOOTER_WHEEL.forkOffset)<1e-8);assert.ok(new THREE.Box3().setFromObject(fork).max.y>.28&&new THREE.Box3().setFromObject(fork).max.y<.31);}
 }
});
test('wheel cleanup matches the intact source and preserves all non-wheel geometry',async()=>{
 const {group}=await readModelGeometry(new URL('../public/models/capybara-premium-original.glb',import.meta.url).pathname);
 const mask=JSON.parse(await readFile(new URL('../app/scooter-wheel-mask.json',import.meta.url),'utf8')),body=group.children[0],original=body.geometry,index=original.index.array,positions=original.getAttribute('position');
 assert.equal(mask.indexSha256,createHash('sha256').update(Buffer.from(index.buffer)).digest('hex'));
 assert.ok(mask.preservedPaintTriangles>10000,'Retain the painted original wheel housing');
 let removed=0,previous=0;
 for(const[start,end]of mask.removedRanges){assert.ok(start>=previous&&end>start);previous=end;for(let f=start;f<end;f++){
   let x=0,y=0,z=0;for(let k=0;k<3;k++){const id=index[f*3+k];x+=positions.getX(id)/3;y+=positions.getY(id)/3;z+=positions.getZ(id)/3;}
   assert.ok(y<.27&&Math.abs(z)<.10,'Never cut the rider, body, handlebars or lights');
   assert.ok(Math.hypot(x+.385,y-.103)<.196||Math.hypot(x-.31,y-.102)<.134);removed++;
 }}
 const update=createRigidScooterWheels(body,new THREE.Group());update(0,0,0,0);
 assert.equal(original.index.count,mask.indexCount,'Source geometry stays intact');
 assert.equal(body.geometry.index.count,mask.indexCount-removed*3);assert.equal(body.userData.replacedWheelTriangles,mask.removedTriangles);
});
test('throttle attacks are different short non-clipped recordings with silent joins',async()=>{
 const report=JSON.parse(await readFile(new URL('../public/audio/scooter-attacks.json',import.meta.url),'utf8'));assert.equal(Object.keys(report.takes).length,3);assert.equal(new Set(Object.values(report.takes).map(t=>t.sha256)).size,3);
 for(const[i,take]of Object.entries(report.takes)){const wav=await readFile(new URL(`../public/audio/scooter-attack-${i}.wav`,import.meta.url));assert.equal(createHash('sha256').update(wav).digest('hex'),take.sha256);assert.ok(take.seconds>=.85&&take.seconds<=1.2);assert.ok(Math.abs(wav.readInt16LE(44))<8&&Math.abs(wav.readInt16LE(wav.length-2))<8);let peak=0;for(let n=44;n<wav.length;n+=2)peak=Math.max(peak,Math.abs(wav.readInt16LE(n))/32768);assert.ok(peak<.8&&peak>.2);}
});
