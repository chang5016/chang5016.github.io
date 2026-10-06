import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RealWorldMap} from '../app/real-world-map.ts';
import {createTrafficMotion} from '../app/traffic-dynamics.ts';
import {sampleTrafficRoute,trafficStations} from '../app/traffic-path.ts';

function world(routes) {
  const map=Object.create(RealWorldMap.prototype);
  Object.assign(map,{trafficRoutes:routes,trafficVehicles:[],trafficIntersections:[{key:'crossing',position:{x:0,z:0},heading:Math.PI/2,width:10,offset:0,heads:[]}],signalMaterials:null,elevationAt:()=>0,trafficHeadRotation:new THREE.Quaternion(),trafficHeadAxis:new THREE.Vector3(0,1,0)});
  return map;
}
const road=(x1,z1,x2,z2)=>({points:[{x:x1,z:z1},{x:x2,z:z2}],width:10,length:Math.hypot(x2-x1,z2-z1)});
function car(map,route,progress,direction=1) {
  const group=new THREE.Group(),motion=createTrafficMotion();
  const vehicle={group,visual:new THREE.Group(),route,progress,direction,speed:0,cruise:8,modelKind:'car',motion,wheels:[],frontWheels:[],brakeLights:[],rearIndicators:[]};
  map.trafficVehicles.push(vehicle);return vehicle;
}
test('red-light queues continue through connected road sections when green returns',()=>{
  const west=road(-90,0,0,0),east=road(0,0,130,0),map=world([west,east]);
  const queue=[70,62,54,46].map(p=>car(map,west,p));
  for(let frame=0;frame<24*60;frame++)map.updateRoadTraffic(24+frame/60,1/60,{x:-30,z:20},0);
  assert.ok(queue[0].group.position.x<-7,'Front bumper must stop before the junction during red');
  for(let frame=0;frame<18*60;frame++)map.updateRoadTraffic(48+frame/60,1/60,{x:-30,z:20},0);
  assert.ok(queue.every(v=>v.group.position.x>12),'Every queued vehicle must pass the green light, not stop forever at the old route endpoint');
  const order=[...queue].sort((a,b)=>a.group.position.x-b.group.position.x);
  for(let i=1;i<order.length;i++)assert.ok(order[i].group.position.x-order[i-1].group.position.x>=5,'Cars retain a physical following gap');
});
test('surface traffic lights do not stop vehicles passing on the elevated roadway',()=>{
  const route=road(-90,0,130,0),map=world([route]);route.heightAt=()=>6.4;map.elevationAt=()=>6.4;
  const vehicle=car(map,route,70);vehicle.group.position.y=6.4;
  for(let frame=0;frame<8*60;frame++)map.updateRoadTraffic(24+frame/60,1/60,{x:-30,z:20},0);
  assert.ok(vehicle.group.position.x>12,'The signal belongs to the ground road below the expressway');
});
test('queue perception is independent of vehicle iteration order across multiple phases',()=>{
  const simulate=reverse=>{
    const route=road(-100,0,500,0),map=world([route]);
    const cars=[80,72,64,56].map(p=>car(map,route,p));if(reverse)map.trafficVehicles.reverse();
    for(let i=0;i<120*30;i++)map.updateRoadTraffic(24+i/30,1/30,{x:0,z:30},0);
    return cars.map(v=>[v.progress,v.speed]);
  };
  assert.deepEqual(simulate(false),simulate(true));
});
test('long expressway routes use bounded station lookups and continuous closed seams',()=>{
  let reads=0;
  const points=Array.from({length:4001},(_,i)=>({x:200*Math.cos(i/4000*Math.PI*2),z:200*Math.sin(i/4000*Math.PI*2)}));
  const proxied=new Proxy(points,{get(a,k){if(typeof k==='string'&&/^\d+$/.test(k))reads++;return a[k];}});
  const route={points:proxied,width:16,length:points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.z-points[i].z),0)};
  trafficStations(route);sampleTrafficRoute(route,0,1);reads=0;
  for(let i=0;i<1000;i++)sampleTrafficRoute(route,route.length*i/1000,1);
  assert.ok(reads<=3000,`1000 queries read ${reads} stations instead of scanning 4000 each time`);
  const a=sampleTrafficRoute(route,route.length-.01,1),b=sampleTrafficRoute(route,.01,1);
  assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.03);
  assert.ok(Math.abs(Math.atan2(Math.sin(a.heading-b.heading),Math.cos(a.heading-b.heading)))<.001);
});
