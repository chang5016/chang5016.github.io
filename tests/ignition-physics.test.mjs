import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createVehicle,EMPTY_INPUT} from '../app/game-core.ts';
import {ScooterIgnition,stepIgnitedVehicle} from '../app/scooter-ignition.ts';
import {stepEngineSound} from '../app/scooter-engine-sound.ts';
import {ScooterExhaust} from '../app/driving-effects.ts';
import {StreetPropPhysics} from '../app/street-prop-physics.ts';
import {combineStreetPropMeshes,createStreetPropInstances} from '../app/street-props.ts';
import {readModelGeometry} from './model-fixture.mjs';
import {createHeadlessDocument} from './headless-document.mjs';

test('ignition removes torque and boost, keeps braking/steering/gravity and has a cancellable restart',()=>{
  const ignition=new ScooterIgnition();assert.equal(ignition.running,true);assert.equal(ignition.toggle(),'off');
  const input={...EMPTY_INPUT,forward:true,left:true};
  let state={...createVehicle(),speed:12,throttle:1,boost:2};
  for(let i=0;i<60;i++)state=stepIgnitedVehicle(state,input,ignition.running,1/60);
  assert.ok(state.speed<12&&state.speed>0);assert.ok(state.heading<0);assert.equal(state.throttle,0);assert.equal(state.boost,0);
  let stopped=createVehicle();for(let i=0;i<120;i++)stopped=stepIgnitedVehicle(stopped,input,false,1/60);
  assert.equal(stopped.speed,0);assert.equal(stopped.x,0);assert.equal(stopped.z,0);
  let slope=createVehicle();for(let i=0;i<60;i++)slope=stepIgnitedVehicle(slope,EMPTY_INPUT,false,1/60,[],0,-.12);
  assert.ok(slope.speed>.3,'An unpowered scooter can roll downhill');
  let coast={...createVehicle(),speed:8};for(let i=0;i<60;i++)coast=stepIgnitedVehicle(coast,{...EMPTY_INPUT,reverse:true},false,1/60);
  assert.ok(coast.speed>=0&&coast.speed<1);
  assert.equal(ignition.toggle(),'starting');for(let i=0;i<20;i++)ignition.step(1/60);assert.equal(ignition.running,false);
  assert.equal(ignition.toggle(),'off');assert.equal(ignition.toggle(),'starting');for(let i=0;i<33;i++)ignition.step(1/60);
  assert.equal(ignition.running,true);
  assert.ok(stepIgnitedVehicle(createVehicle(),input,true,1/60).speed>0);
});

test('engine-off silences engine layers but keeps rolling sound and lets existing exhaust dissipate',()=>{
  const sound=stepEngineSound({rpm:6000,load:1},15,1,true,.02,false);
  assert.ok(sound.layers.every(x=>x.gain===0&&Number.isFinite(x.rate)));assert.ok(sound.rpm<6000);assert.ok(sound.tyreGain>0);
  const previous=globalThis.document;globalThis.document=createHeadlessDocument();const exhaust=new ScooterExhaust(new THREE.Scene());
  try {
    const vehicle={...createVehicle(),throttle:1};exhaust.update(vehicle,0,.1,false);
    assert.ok(exhaust.particles.some(p=>p.age<p.life));
    for(let i=0;i<120;i++)exhaust.update(vehicle,0,1/60,false,undefined,undefined,false);
    assert.ok(exhaust.particles.every(p=>p.age>=p.life));
    exhaust.update(vehicle,0,.1,false,undefined,undefined,true);assert.ok(exhaust.particles.some(p=>p.age<p.life));
  } finally {exhaust.dispose();if(previous)globalThis.document=previous;else delete globalThis.document;}
});

export async function streetTemplates(){
  const templates=new Map();
  for(const kind of ['bench','hydrant']){const {group}=await readModelGeometry(new URL(`../public/models/street-props/${kind}.glb`,import.meta.url).pathname);templates.set(kind,combineStreetPropMeshes(group));}
  const pot=(await readModelGeometry(new URL('../public/models/street-props/pot.glb',import.meta.url).pathname)).group;
  const plant=(await readModelGeometry(new URL('../public/models/street-props/plant.glb',import.meta.url).pathname)).group;
  plant.position.y=.345;const model=new THREE.Group();model.add(pot,plant);templates.set('planter',combineStreetPropMeshes(model));return templates;
}

test('actual stock plant/bench instances tip, slide, settle, sleep, reawaken and respect road height and nearby walls',async()=>{
  const templates=await streetTemplates();
  const placements=[{kind:'planter',x:0,z:0,y:.135,angle:0},{kind:'bench',x:5,z:0,y:.135,angle:0},{kind:'hydrant',x:10,z:0,y:.135,angle:0}];
  const batches=createStreetPropInstances(templates,placements,()=>0),physics=new StreetPropPhysics(batches,templates,()=>0);
  const vehicle=(x,z,speed=8)=>({...createVehicle(),x,z,speed});
  try {
    await physics.ready;assert.equal(physics.props.length,3);
    assert.equal(physics.step(vehicle(0,2),vehicle(0,1.5),6.4,6.4,1/60),null,'Ground pots cannot collide with a scooter on an overpass');
    assert.equal(physics.step(vehicle(0,2),vehicle(0,1.5),.135,.135,1/60)?.kind,'planter');
    const prop=physics.props[0],initial=prop.position.clone(),rotation=prop.rotation.clone(),matrixBefore=new THREE.Matrix4();
    prop.slots[0].mesh.getMatrixAt(prop.slots[0].index,matrixBefore);
    for(let i=0;i<420;i++){physics.step(vehicle(30,30,0),vehicle(30,30,0),.135,.135,1/60);physics.render(.5);}
    assert.ok(prop.position.distanceTo(initial)>.2);assert.ok(prop.rotation.angleTo(rotation)>.1);assert.ok(prop.body.isSleeping());
    assert.ok(prop.position.y>-.02,'The model cannot fall through the street');
    const after=new THREE.Matrix4();prop.slots[0].mesh.getMatrixAt(prop.slots[0].index,after);
    assert.ok(Math.hypot(...after.elements.map((x,i)=>x-matrixBefore.elements[i]))>.2);
    for(const slot of prop.slots)assert.ok([...templates.get('planter').children].some(source=>source.geometry===slot.mesh.geometry),'Physics retains every original shared model surface');
    const rehit=physics.step(vehicle(prop.position.x,prop.position.z+2),vehicle(prop.position.x,prop.position.z+1.3),.135,.135,1/60);
    assert.ok(rehit);assert.equal(prop.body.isSleeping(),false);
    assert.equal(physics.step(vehicle(10,2,1.5),vehicle(10,1.5,1.5),.135,.135,1/60),null,'Low-speed contact does not tear out anchored plumbing');
    assert.equal(physics.brokenHydrants.size,0);
    assert.equal(physics.step(vehicle(10,2),vehicle(10,1.2),.135,.135,1/60)?.kind,'hydrant');
    assert.ok(physics.brokenHydrants.has(placements[2]));assert.equal(physics.spray.jets.length,1);
    for(let i=0;i<60;i++){physics.step(vehicle(20,20,0),vehicle(20,20,0),.135,.135,1/60);physics.render(.5);}
    assert.ok(physics.spray.jets[0].y<.25,'Water comes from the broken pipe at ground level');
    assert.ok(physics.spray.root.visible);
    assert.equal(physics.step(vehicle(5,2),vehicle(5,1.5),.135,.135,1/60)?.kind,'bench');
  } finally {physics.dispose();}
  const bounded=createStreetPropInstances(templates,[placements[0]],()=>0);
  const walls=new StreetPropPhysics(bounded,templates,()=>0,()=>[{x:0,z:-1,halfWidth:2,halfDepth:.1}]);
  try {
    await walls.ready;walls.step(vehicle(0,2),vehicle(0,1.5),.135,.135,1/60);
    for(let i=0;i<300;i++)walls.step(vehicle(30,30,0),vehicle(30,30,0),.135,.135,1/60);
    assert.ok(walls.props[0].position.z>-.9,'A struck pot cannot pass through the adjacent building wall');
  } finally {walls.dispose();templates.forEach(template=>template.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}}));}
});
