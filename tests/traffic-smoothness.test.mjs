import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RealWorldMap} from '../app/real-world-map.ts';
import {createTrafficMotion} from '../app/traffic-dynamics.ts';
import {sampleTrafficRoute,advanceTrafficProgress,findTrafficConnection} from '../app/traffic-path.ts';
import {smoothTrafficPoints} from '../app/traffic-route.ts';
import {TrafficPresentation} from '../app/traffic-presentation.ts';
import {SimulationClock} from '../app/simulation-clock.ts';

function road(points,width=10) {
  return {points,width,length:points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.z-points[i].z),0),heightAt:()=>0};
}
function world(routes) {
  const map=Object.create(RealWorldMap.prototype);
  Object.assign(map,{trafficRoutes:routes,trafficVehicles:[],trafficIntersections:[],signalMaterials:null});
  return map;
}
function car(map,route,progress,direction=1) {
  const group=new THREE.Group(),visual=new THREE.Group(),motion=createTrafficMotion();group.add(visual);
  const p=sampleTrafficRoute(route,progress,direction);group.position.set(p.x,.028,p.z);group.rotation.y=-p.heading;
  motion.speed=8;
  const vehicle={group,visual,route,progress,direction,speed:8,cruise:8,modelKind:'car',motion,previousSignal:''};
  map.trafficVehicles.push(vehicle);return vehicle;
}
const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));

test('physical lane distance stays uniform through inside and outside corners',()=>{
  const route=road(smoothTrafficPoints([{x:-100,z:0},{x:0,z:0},{x:0,z:-100}],10));
  for(const direction of [1,-1]) {
    let progress=direction===1?80:route.length-80,previous=sampleTrafficRoute(route,progress,direction);
    const dt=1/240,speed=5;
    for(let tick=0;tick<8*240;tick++) {
      progress=advanceTrafficProgress(route,progress,direction,speed*dt);
      const p=sampleTrafficRoute(route,progress,direction),actual=Math.hypot(p.x-previous.x,p.z-previous.z)/dt;
      assert.ok(Math.abs(actual-speed)<.002,`A ${speed} m/s vehicle moved at ${actual} m/s in lane ${direction}`);
      const heading=Math.atan2(p.x-previous.x,-(p.z-previous.z));
      assert.ok(Math.abs(angle(p.heading,heading))<.015,'The chassis faces the direction of its actual displacement');previous=p;
    }
  }
});

test('route transfers retain exact lane position and tangent in both travel directions',()=>{
  for(const reversed of [false,true]) {
    const source=road(reversed?[{x:0,z:0},{x:-100,z:0}]:[{x:-100,z:0},{x:0,z:0}]);
    const target=road(reversed?[{x:0,z:-100},{x:0,z:0}]:[{x:0,z:0},{x:0,z:-100}]);
    const dir=reversed?-1:1,c=findTrafficConnection(source,dir,[source,target],()=>0);
    assert.ok(c,'The adjoining road has a continuous lane connector');
    const destination=c.route.destination;
    for(const [a,b] of [[sampleTrafficRoute(source,c.startAt,dir),sampleTrafficRoute(c.route,0,1)],
      [sampleTrafficRoute(c.route,c.route.length,1),sampleTrafficRoute(target,destination.progress,destination.direction)]]) {
      assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-8);assert.ok(Math.abs(angle(a.heading,b.heading))<1e-8);
    }
  }
});

test('connected road heights follow refreshed terrain instead of retaining an old joining level',()=>{
  let datum=0;
  const west=road([{x:-100,z:0},{x:0,z:0}]),east=road([{x:0,z:0},{x:100,z:0}]);
  west.heightAt=d=>datum+.01*(d-100);east.heightAt=d=>datum+.01*d;
  const map=world([west,east]),connection=map.trafficConnection(west,1),mid=connection.route.length/2;
  assert.ok(Math.abs(map.trafficSurface(connection.route,mid,1).height)<1e-8);
  datum=4;map.trafficHeights=new WeakMap();
  assert.ok(Math.abs(map.trafficSurface(connection.route,mid,1).height-4)<1e-8,'A refreshed elevation raster cannot leave an old dip at a connector');
});

test('drivers brake before tight corners and retain bounded speed and yaw changes',()=>{
  const route=road(smoothTrafficPoints([{x:-300,z:0},{x:0,z:0},{x:0,z:-300}],10));
  for(const dir of [1,-1]) {
    const map=world([route]),vehicle=car(map,route,dir===1?265:route.length-265,dir);
    let speed=vehicle.speed,heading=-vehicle.group.rotation.y,minSpeed=8;
    for(let tick=0;tick<18*60;tick++) {
      map.updateRoadTraffic(tick/60,1/60,{x:1000,z:1000},0);
      const next=-vehicle.group.rotation.y,lateral=Math.abs(angle(next,heading))*vehicle.speed*60;
      assert.ok(lateral<2.3,`Unanticipated corner produces ${lateral} m/s² lateral acceleration`);
      assert.ok(Math.abs(vehicle.speed-speed)<.13,'No abrupt speed reset on an unobstructed route');
      minSpeed=Math.min(minSpeed,vehicle.speed);speed=vehicle.speed;heading=next;
    }
    assert.ok(minSpeed>1,'A through road must not force a hard stop at a corner');
  }
});

test('traffic queues and route handoffs produce identical physics at different frame cadences',()=>{
  const simulate=(frames,count)=>{
    const west=road([{x:-300,z:0},{x:0,z:0}]),north=road([{x:0,z:0},{x:0,z:-300}]);
    const map=world([west,north]),cars=[240,231,222].map(p=>car(map,west,p)),clock=new SimulationClock();let ticks=0;
    for(let frame=0;frame<count;frame++) {
      const alpha=clock.advance(frames[frame%frames.length],dt=>map.updateRoadTraffic(++ticks/60,dt,{x:1000,z:1000},0));
      map.interpolateRoadTraffic(alpha,ticks/60+alpha*clock.step);
    }
    assert.equal(ticks,1800);
    assert.ok(cars.every(v=>v.route===north),'Each follower continues through the corner connector');
    return cars.map(v=>[v.progress,v.speed,v.motion.distance,...v.group.position.toArray()]);
  };
  const baseline=simulate([1/60],1800);
  assert.deepEqual(simulate([1/30],900),baseline);
  assert.deepEqual(simulate([1/144],4320),baseline);
  assert.deepEqual(simulate([1/120,1/40,1/80,1/48],1800),baseline);
});

test('144 Hz rendering interpolates translation and tyre travel without moving collision poses',()=>{
  const root=new THREE.Group(),visual=new THREE.Group();root.add(visual);
  const motion=createTrafficMotion(),pose=new TrafficPresentation(root,visual,motion),clock=new SimulationClock();
  let lastPosition,lastDistance;
  for(let frame=0;frame<144;frame++) {
    const alpha=clock.advance(1/144,dt=>{pose.capture(motion);root.position.x+=6*dt;motion.distance-=6*dt;});
    const physics=root.position.x,rendered=pose.apply(alpha,motion),position=visual.getWorldPosition(new THREE.Vector3()).x;
    assert.equal(root.position.x,physics,'Visual interpolation cannot change collision coordinates');
    if(frame>3) {
      assert.ok(Math.abs(position-lastPosition-6/144)<1e-9,'No frozen render frames between 60 Hz physics ticks');
      assert.ok(Math.abs(rendered.motion.distance-lastDistance+6/144)<1e-9,'Wheel rotation follows the same interpolated travel as the body');
    }
    lastPosition=position;lastDistance=rendered.motion.distance;
  }
});

test('chassis interpolation follows the short rotation arc and resets after a teleport',()=>{
  const root=new THREE.Group(),visual=new THREE.Group(),motion=createTrafficMotion();root.add(visual);
  root.rotation.y=Math.PI-.01;const pose=new TrafficPresentation(root,visual,motion);pose.capture(motion);
  root.rotation.y=-Math.PI+.01;root.position.set(1,2,3);pose.apply(.5,motion);
  const q=visual.getWorldQuaternion(new THREE.Quaternion());
  assert.ok(q.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI))<1e-8);
  assert.ok(visual.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3(.5,1,1.5))<1e-9);
  root.position.x=500;pose.reset(motion);pose.apply(.2,motion);
  assert.equal(visual.getWorldPosition(new THREE.Vector3()).x,500,'Offscreen recycling cannot sweep a rendered car across the district');
});
