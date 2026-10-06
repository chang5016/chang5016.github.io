import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {withDownloadedMetroFiles} from './downloaded-metro-loader.mjs';
import {MetroScene} from '../app/metro-scene.ts';
import {MetroSystem,METRO_FLOOR,METRO_DOORS,METRO_HALF_WIDTH,METRO_TRACKS} from '../app/metro-system.ts';
import {createVehicle,EMPTY_INPUT,intersectsBuilding,stepVehicle} from '../app/game-core.ts';

test('all imported screen doors clear the full scooter opening, while closed native leaves actually block it',async()=>withDownloadedMetroFiles(async()=>{
 const scene=new THREE.Scene(),system=new MetroSystem(),visuals=new MetroScene(scene,system,()=>0);await visuals.ready;
 try{
  for(const train of system.trains){train.door=train.previousDoor=1;train.phase='dwell';}
  visuals.render(1);scene.updateMatrixWorld(true);
  for(const train of system.trains)for(const door of METRO_DOORS)for(const dx of[-.65,0,.65])for(const dy of[.25,1.1,3.05]){
   const side=METRO_TRACKS[train.track].side;
   const ray=new THREE.Raycaster(new THREE.Vector3(train.x+door.x+dx,METRO_FLOOR+dy,train.z+side*(METRO_HALF_WIDTH+1)),new THREE.Vector3(0,0,-side),0,1.8);
   const hits=ray.intersectObject(visuals.root,true);
   assert.equal(hits.length,0,'Opened downloaded door must have no remaining glass, fixed panel or rail '+JSON.stringify({train:train.id,door:door.x,dx,dy,hits:hits.map(h=>({name:h.object.name,point:h.point.toArray()}))}));
  }
  for(const train of system.trains){train.door=train.previousDoor=0;}
  visuals.render(1);scene.updateMatrixWorld(true);
  const train=system.trains[0],door=METRO_DOORS[1];
  const hits=new THREE.Raycaster(new THREE.Vector3(train.x+door.x,METRO_FLOOR+1.1,train.z+METRO_HALF_WIDTH+1),new THREE.Vector3(0,0,-1),0,1.8).intersectObject(visuals.root,true);
  assert.ok(hits.some(h=>h.object.isInstancedMesh&&h.object.userData.downloadedSource),'Closed doors retain genuine imported 3D frame and glass geometry');
  for(const station of visuals.stations)assert.equal(station.boards.length,4,'Two live physical boards per platform');
 }finally{visuals.dispose();}
}));

test('the true imported rear vestibules and gangway form a floored, open passage through both carriages',async()=>withDownloadedMetroFiles(async()=>{
 const scene=new THREE.Scene(),system=new MetroSystem(),visuals=new MetroScene(scene,system,()=>0);await visuals.ready;
 try{
  const train=system.trains[0];train.door=train.previousDoor=0;visuals.render(1);scene.updateMatrixWorld(true);
  const actualTrain=visuals.trains[0].group;
  for(const dz of[-1.35,-1,-.65,0,.65,1,1.35])for(const dy of[.1,.25,.5,.75,1.1,1.5,2,2.5,3.05,3.35,3.55]){
   const hits=new THREE.Raycaster(new THREE.Vector3(train.x-8,METRO_FLOOR+dy,train.z+dz),new THREE.Vector3(1,0,0),0,16).intersectObject(actualTrain,true);
   assert.equal(hits.length,0,'No rear wall, flange or original glass may occupy the through passage '+JSON.stringify({dz,dy,hits:hits.map(h=>({name:h.object.name,point:h.point.toArray()}))}));
  }
  for(let x=-7;x<=7;x+=.2)for(const z of[-.65,0,.65]){
   const hits=new THREE.Raycaster(new THREE.Vector3(train.x+x,METRO_FLOOR+.15,train.z+z),new THREE.Vector3(0,-1,0),0,.25).intersectObject(actualTrain,true);
   assert.ok(hits.length>0,'No visual floor hole at the inter-car join: '+JSON.stringify({x,z}));
   assert.ok(Math.abs(hits[0].point.y-METRO_FLOOR)<.05,'Both native floors and the gangway threshold share one datum');
  }
  let rider={...createVehicle(),x:train.x-7,z:train.z,heading:Math.PI/2};system.carrier={kind:'train',id:train.id,car:0};train.phase='running';train.elapsed=10;
  let visited=new Set();
  for(let i=0;i<350;i++){
   const moved=system.beginStep(rider,METRO_FLOOR,1/60);rider=moved.rider;
   const obstacles=system.obstaclesAt(rider,METRO_FLOOR);assert.equal(intersectsBuilding(rider,obstacles,.45),false,'Rider fits through the physical gangway');
   rider=stepVehicle(rider,{...EMPTY_INPUT,forward:true},1/60,obstacles,0,0,1,.40);rider.speed=Math.min(3.2,rider.speed);rider=system.endStep(rider,METRO_FLOOR);
   assert.equal(system.surfaceAt(rider,METRO_FLOOR),METRO_FLOOR);assert.equal(system.carrier?.kind,'train');visited.add(system.carrier.car);
  }
  assert.deepEqual([...visited].sort(),[0,1]);assert.ok(rider.x-train.x>5,'A moving train permits riding from the first car into the second');
  const camera=new THREE.Vector3(train.x,METRO_FLOOR+4.1,train.z+3);
  visuals.constrainCamera(camera,{...rider,x:train.x+8},METRO_FLOOR,1);
  assert.ok(Math.abs(camera.z-train.z)<=1.4&&camera.y<=METRO_FLOOR+3.6,'The chase camera remains inside the narrower, lower physical gangway');
 }finally{visuals.dispose();}
}));
