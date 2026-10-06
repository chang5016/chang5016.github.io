import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SimulationClock, interpolateAngle } from '../app/simulation-clock.ts';
import { createVehicle, stepVehicle, EMPTY_INPUT, intersectsBuilding } from '../app/game-core.ts';
import { TrafficHeightCache } from '../app/traffic-height-cache.ts';
import { freezeStaticScene } from '../app/static-scene.ts';
import { createScooterSuspension } from '../app/scooter-suspension.ts';
import { RealWorldMap } from '../app/real-world-map.ts';
import { createVegetationBatches } from '../app/vegetation-batches.ts';
import { TerrainBuildCache } from '../app/terrain-build-cache.ts';

test('30, 60 and 144 Hz renders produce the same 600 physics steps and final pose', () => {
  const drive = hz => {
    const clock = new SimulationClock(); let state = createVehicle(), steps = 0;
    for (let frame=0;frame<hz*10;frame++) clock.advance(1/hz,dt=>{
      state=stepVehicle(state,{...EMPTY_INPUT,forward:steps<400,right:steps>=120&&steps<260,brake:steps>=400},dt);
      steps++;
    });
    assert.equal(steps,600); return state;
  };
  assert.deepEqual(drive(30),drive(60)); assert.deepEqual(drive(144),drive(60));
});

test('a suspended tab cannot create an unbounded catch-up or an interpolation spin', () => {
  const clock=new SimulationClock(); let steps=0;
  clock.advance(30,()=>steps++); assert.equal(steps,6);
  clock.reset(); clock.advance(1/120,()=>steps++); assert.equal(steps,6);
  assert.ok(Math.abs(interpolateAngle(Math.PI-.02,-Math.PI+.02,.5)-Math.PI)<1e-10);
});

test('restored steering stays responsive at road and highway speeds in both directions', () => {
  for (const speed of [12, 20, 28]) for (const direction of [-1, 1]) {
    let state = {...createVehicle(), speed};
    for (let i=0;i<60;i++) state=stepVehicle(state,{...EMPTY_INPUT,forward:true,left:direction<0,right:direction>0},1/60);
    const turn=state.heading*direction;
    assert.ok(turn>.6 && turn<1, `speed ${speed}: one-second turn ${turn} radians`);
    assert.ok(state.x*direction>3, 'steering must move the scooter into the turn');
    assert.ok(Math.abs(state.lean)<=.23, 'restore the previous normal-riding lean');
  }
});

test('rain still increases stopping distance after restoring the steering feel', () => {
  const stoppingDistance=grip=>{
    let state={...createVehicle(),speed:20};
    for(let i=0;i<600&&state.speed>0;i++)state=stepVehicle(state,{...EMPTY_INPUT,brake:true},1/60,[],0,0,grip);
    assert.equal(state.speed,0);return -state.z;
  };
  const dry=stoppingDistance(1),wet=stoppingDistance(.62);
  assert.ok(dry>15&&dry<24,`dry stopping distance ${dry}`);
  assert.ok(wet>dry*1.4,`dry ${dry}, wet ${wet}`);
});

test('cached traffic heights retain a smooth road profile with bounded terrain queries', () => {
  const cache=new TrafficHeightCache(1000);let evaluations=0,maxError=0;
  const terrain=x=>2*Math.sin(x/40)+x*.02;
  for(let frame=0;frame<600;frame++){
    const x=frame/6, result=cache.sample(x,d=>{evaluations++;return terrain(d);});
    maxError=Math.max(maxError,Math.abs(result.height-terrain(x)));
  }
  assert.ok(evaluations<=102,`600 height/grade updates used ${evaluations} queries`);
  assert.ok(maxError<.0002,`height interpolation error ${maxError}m`);
  assert.ok(Number.isFinite(cache.sample(1000,terrain).grade));
});

test('frozen scenery retains transforms while vehicles, lights and newly streamed meshes update', () => {
  const scene=new THREE.Scene(),world=new THREE.Group();scene.add(world);
  const house=new THREE.Group();house.position.set(20,5,10);
  const wall=new THREE.Mesh(new THREE.BoxGeometry(3,4,1),new THREE.MeshStandardMaterial());wall.position.x=4;house.add(wall);world.add(house);
  const traffic=new THREE.Group();traffic.userData.dynamicWorldObject=true;world.add(traffic);
  const lamp=new THREE.PointLight();house.add(lamp);
  scene.updateMatrixWorld(true);const before=wall.matrixWorld.clone();
  assert.equal(freezeStaticScene(world),2);
  let recomputes=0;wall.updateMatrix=()=>{recomputes++;};
  traffic.position.x=8;lamp.position.y=3;scene.updateMatrixWorld();
  assert.deepEqual(wall.matrixWorld.elements,before.elements);assert.equal(recomputes,0);
  assert.equal(traffic.getWorldPosition(new THREE.Vector3()).x,8);
  assert.equal(lamp.getWorldPosition(new THREE.Vector3()).y,8);
  const streamed=new THREE.Group();streamed.position.z=7;world.add(streamed);freezeStaticScene(world);
  assert.equal(streamed.getWorldPosition(new THREE.Vector3()).z,7);
  wall.geometry.dispose();wall.material.dispose();
});

test('suspension keeps its full coil geometry without per-frame vertex uploads', () => {
  const root=new THREE.Group(),update=createScooterSuspension(root);
  const coil=root.children.find(o=>o.name.includes('coil-over')).children.find(o=>o.geometry?.type==='TubeGeometry');
  const position=coil.geometry.attributes.position,normal=coil.geometry.attributes.normal;
  const p=position.version,n=normal.version,rest=coil.geometry.index.count;
  for(let frame=0;frame<240;frame++)update(.02+.015*Math.sin(frame/20),.02+.015*Math.cos(frame/20),.2);
  assert.equal(position.version,p);assert.equal(normal.version,n);assert.equal(coil.geometry.index.count,rest);
  assert.ok(coil.scale.y>0&&coil.scale.y<1);
});

test('traffic collision and audio queries separate bridge levels and use oriented footprints', () => {
  const map=Object.create(RealWorldMap.prototype),car=new THREE.Group();car.position.set(0,6,0);car.rotation.y=Math.PI/4;
  map.trafficVehicles=[{group:car,modelKind:'car'}];
  assert.equal(map.nearbyTraffic({x:0,z:0},0).length,0);
  assert.equal(map.nearestTrafficPosition({x:0,z:0},0,new THREE.Vector3()),false);
  const bounds=map.nearbyTraffic({x:0,z:0},6);assert.equal(bounds.length,1);
  assert.equal(intersectsBuilding({x:1.9,z:1.9},bounds,.1),false,'Empty rotated AABB corners must not collide with the oriented car');
  assert.equal(intersectsBuilding({x:0,z:0},bounds,.1),true);
});

test('vegetation batches retain every matrix and colour without changing any source geometry', () => {
  const source=new THREE.InstancedMesh(new THREE.BoxGeometry(1,4,1),new THREE.MeshStandardMaterial(),10000);
  const matrix=new THREE.Matrix4(),color=new THREE.Color();
  source.position.set(7,0,-3);source.rotation.y=.2;
  for(let i=0;i<source.count;i++){
    matrix.makeTranslation(i%100*12,0,Math.floor(i/100)*12);source.setMatrixAt(i,matrix);
    source.setColorAt(i,color.setRGB((i%7)/7,.4,.2));
  }
  const range={...source.geometry.drawRange},group=createVegetationBatches(source);
  assert.equal(group.userData.instanceCount,10000);
  assert.equal(group.children.reduce((sum,child)=>sum+child.count,0),10000);
  assert.deepEqual(source.geometry.drawRange,range);
  const found=new Map();let submitted=0;
  const view=new THREE.Box3(new THREE.Vector3(-10,-10,-10),new THREE.Vector3(140,10,140));
  for(const batch of group.children){
    assert.equal(batch.geometry,source.geometry);assert.equal(batch.material,source.material);
    if(view.intersectsBox(batch.boundingBox))submitted+=batch.count;
    for(let i=0;i<batch.count;i++){batch.getMatrixAt(i,matrix);batch.getColorAt(i,color);found.set(`${matrix.elements[12]},${matrix.elements[14]}`,color.r);}
  }
  for(let i=0;i<source.count;i++)assert.ok(Math.abs(found.get(`${i%100*12},${Math.floor(i/100)*12}`)-(i%7)/7)<1e-6);
  assert.ok(submitted<300,`local view submitted ${submitted}/10000 instances`);
  source.updateMatrixWorld(true);group.updateMatrixWorld(true);
  assert.deepEqual(group.matrixWorld.elements,source.matrixWorld.elements);
});

test('terrain construction cache preserves exact heights and supports parcel invalidation', () => {
  const cache=new TerrainBuildCache();let samples=0;
  const ground=p=>{samples++;return Math.sin(p.x*.15)+p.z*.07;};
  for(let i=0;i<20;i++)assert.equal(cache.sample({x:1.00001,z:9.1},ground),Math.sin(1.00001*.15)+9.1*.07);
  assert.equal(samples,1);
  assert.notEqual(cache.sample({x:1.00002,z:9.1},ground),cache.sample({x:1.00001,z:9.1},ground));
  cache.clear();cache.sample({x:1.00001,z:9.1},ground);assert.equal(samples,3);
});
