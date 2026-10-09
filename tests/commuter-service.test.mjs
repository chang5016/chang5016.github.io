import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RealWorldMap} from '../app/real-world-map.ts';
import {MetroScene} from '../app/metro-scene.ts';
import {MetroSystem,METRO_FLOOR,METRO_DOORS,METRO_HALF_WIDTH,LIFT_HALF} from '../app/metro-system.ts';
import {createVehicle} from '../app/game-core.ts';
import {sampleTrafficRoute} from '../app/traffic-path.ts';
import {tunnelFloorAt} from '../app/mountain-tunnel.ts';
import {withDownloadedMetroFiles} from './downloaded-metro-loader.mjs';

test('six persistent commuters complete return trips at all stations, while two intercity riders continue to highway and mountain roads',async()=>withDownloadedMetroFiles(async()=>{
 const scene=new THREE.Scene(),world=new RealWorldMap(scene,4),system=new MetroSystem(p=>world.elevationAt(p),(p,r)=>world.transportSupportClears(p,r)),visual=new MetroScene(scene,system,p=>world.elevationAt(p));await visual.ready;
 try{
  world.enableMetroCommuters(system);const all=world.trafficVehicles.filter(v=>v.commuter),vehicles=all.filter(v=>!v.commuter.recurring),local=all.filter(v=>v.commuter.recurring),hero={...createVehicle(),x:-2000,z:-2000};assert.equal(vehicles.length,2);assert.equal(local.length,6);assert.equal(world.trafficVehicles.length,42);
  for(let station=0;station<3;station++)assert.equal(local.filter(v=>v.commuter.origin===station).length,2,'Actual initial riders at every station');
  let highway=false,tunnel=false,valley=false,maxStep=0;const handoffs=new Set();
  // Two shuttles serve the whole six-station line, so the original stations see a train in each
  // direction about half as often as on the old three-station line.
  for(let frame=0;frame<3600*30;frame++){
   const dt=1/30,moved=system.beginStep(hero,0,dt);system.endStep(moved.rider,0);
   const previous=all.map(v=>({x:v.group.position.x,y:v.group.position.y,z:v.group.position.z,mode:v.commuter.mode}));world.updateRoadTraffic(frame/30,dt,hero,0);
   for(const [i,v]of all.entries()){const p=previous[i];if(p.mode!=='road')maxStep=Math.max(maxStep,Math.hypot(v.group.position.x-p.x,v.group.position.y-p.y,v.group.position.z-p.z));}
   for(const [i,v]of vehicles.entries()){
    const c=v.commuter,p=previous[all.indexOf(v)];
    if(p.mode!=='road'&&c.mode==='road'){const expected=sampleTrafficRoute(c.road,8,1);assert.ok(Math.hypot(c.state.x-expected.x,c.state.z-expected.z)<.06);handoffs.add(c.id);}
    if(c.origin===2&&v.route.district==='highway'&&v.group.position.y>world.elevationAt(v.group.position)+1)highway=true;
    if(c.origin===0&&c.mode==='road'&&v.group.position.x>1690&&v.group.position.x<2160&&Math.abs(v.group.position.z-510)<4.8){tunnel=true;assert.ok(Math.abs(v.group.position.y-tunnelFloorAt(v.group.position.x))<.2);}
    if(c.origin===0&&c.mode==='road'&&v.group.position.x>2200&&v.group.position.z>600)valley=true;
   }
   if(highway&&tunnel&&valley&&local.every(v=>v.commuter.completedTrips>=2))break;
  }
  assert.ok(maxStep<1,'Continuous movement on shared physical carriers');assert.equal(handoffs.size,2);assert.ok(highway,'Actual highway merge');assert.ok(tunnel,'Actual driveable tunnel');assert.ok(valley,'Actual mountain valley road');
  for(const v of vehicles){assert.equal(v.commuter.mode,'road');assert.deepEqual(v.commuter.history,['lift-up','to-platform','waiting','boarding','riding','alighting','call-down','enter-down','lift-down','ground-exit','road']);assert.equal(system.participantCarrier(v.commuter.id),null);}
  for(const v of local){assert.ok(v.commuter.completedTrips>=2,`${v.commuter.id} must keep using metro after its first trip`);for(const stage of['call-up','enter-up','lift-up','waiting','boarding','riding','alighting','lift-down','ground-exit','street-loop'])assert.ok(v.commuter.history.includes(stage),stage);assert.notEqual(v.commuter.mode,'road');}
  assert.equal(system.participants.size,6);assert.equal(world.group.userData.spatialAudit.passed,true);
 }finally{visual.dispose();world.dispose();}
}));

test('NPCs share door safety sensors and capacity without changing the player carrier',()=>{
 const system=new MetroSystem(),train=system.trains[0],hero={...createVehicle(),x:-2000,z:-2000};
 let npc={...createVehicle(),x:train.x+METRO_DOORS[5].x,z:train.z+METRO_HALF_WIDTH};system.registerParticipant('npc',npc,METRO_FLOOR);train.elapsed=24;system.beginStep(hero,0,1/60);assert.equal(train.blocked,true);assert.notEqual(train.phase,'running');
 npc={...npc,z:train.z};system.finishParticipant('npc',npc,METRO_FLOOR);assert.equal(system.capacity(0),15);assert.equal(system.carrier,null);system.removeParticipant('npc');assert.equal(system.capacity(0),16);
 system.endStep({...hero,x:train.x-4,z:train.z},METRO_FLOOR);assert.equal(system.carrier?.kind,'train');
 for(let i=0;i<15;i++){const rider={...createVehicle(),x:train.x-29+(i%5)*5,z:train.z+(Math.floor(i/5)-1)*1.7,heading:Math.PI/2};system.registerParticipant('full-'+i,rider,METRO_FLOOR);system.finishParticipant('full-'+i,rider,METRO_FLOOR);}
 assert.equal(system.capacity(0),0);const extra={...createVehicle(),x:train.x-12,z:train.z};system.registerParticipant('extra',extra,METRO_FLOOR);system.finishParticipant('extra',extra,METRO_FLOOR);assert.equal(system.participantCarrier('extra'),null);assert.equal(system.carrier?.kind,'train');
});

test('an NPC at another landing cannot summon a lift occupied by the player',()=>{
 const system=new MetroSystem(),lift=system.lifts[0],hero={...createVehicle(),x:lift.x,z:lift.z};system.endStep(hero,lift.lower);const npc={...createVehicle(),x:lift.x,z:lift.z-LIFT_HALF-1.6};system.registerParticipant('waiting',npc,METRO_FLOOR);assert.match(system.operateParticipant('waiting',npc,METRO_FLOOR),/乘客/);assert.equal(lift.phase,'idle');assert.equal(lift.height,lift.lower);assert.deepEqual(system.carrier,{kind:'lift',id:0});
});
