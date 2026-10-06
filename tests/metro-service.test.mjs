import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicle, EMPTY_INPUT, intersectsBuilding, stepVehicle } from '../app/game-core.ts';
import { MetroSystem, METRO_FLOOR, METRO_HALF_WIDTH, METRO_DOORS, metroConcourse, metroPlatform } from '../app/metro-system.ts';

test('removed ETC barriers leave every platform distribution lane free',()=>{
  const system=new MetroSystem(); assert.equal(system.gates.length,0);
  for(let station=0;station<3;station++)for(let track=0;track<2;track++){ const p=metroPlatform(station,track);for(const dx of [17,21.5,26,30.5])assert.equal(intersectsBuilding({x:p.x+dx,z:p.z},system.obstaclesAt(p,METRO_FLOOR),.4),false);}
});

test('concourses retain normal controls, platforms reduce to 25 km/h and carriages have no phantom seat colliders',()=>{
  const system=new MetroSystem();
  for(let station=0;station<3;station++){
    assert.equal(system.speedLimitAt(metroConcourse(station),0),Infinity);
    for(let track=0;track<2;track++)assert.equal(system.speedLimitAt(metroPlatform(station,track),METRO_FLOOR)*3.6,25);
  }
  const train=system.trains[0];
  const rider={...createVehicle(),x:train.x+METRO_DOORS[1].x,z:train.z,heading:0};
  system.endStep(rider,METRO_FLOOR);assert.equal(system.capacity(0),15);
  for(const z of [-METRO_HALF_WIDTH+2,METRO_HALF_WIDTH-2])assert.equal(intersectsBuilding({...rider,z:train.z+z},system.obstaclesAt(rider,METRO_FLOOR),.48),false);
  assert.equal(system.speedLimitAt(rider,METRO_FLOOR),3.2,'Only the carrier interior has a safety governor');
});

test('both displayed arrivals match the real asymmetric shuttle timetable and terminal reversal',()=>{
  const step=.04;
  for(const elapsed of [0,37,104,192])for(const track of [0,1])for(const station of [0,1,2]){
    const system=new MetroSystem(),away={...createVehicle(),x:0,z:0};
    for(let i=0;i<elapsed/step;i++)system.beginStep(away,0,step);
    const train=system.trains[track],predicted=[system.arrivalSeconds(train,station),system.followingArrivalSeconds(train,station)],actual=[];
    if(train.station===station&&train.phase!=='running')actual.push(0);
    const origin=system.seconds;
    let guard=0;
    while(actual.length<2&&guard++<24000){
      const before=train.phase;system.beginStep(away,0,step);
      if(before==='running'&&train.phase==='opening'&&train.station===station)actual.push(system.seconds-origin);
    }
    assert.ok(guard<24000);
    for(let i=0;i<2;i++)assert.ok(Math.abs(actual[i]-predicted[i])<.25,JSON.stringify({elapsed,track,station,predicted,actual}));
    assert.ok(predicted[1]>predicted[0]);
  }
});
