import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import {withDownloadedMetroFiles} from './downloaded-metro-loader.mjs';
import {readModelGeometry} from './model-fixture.mjs';
import {MetroScene} from '../app/metro-scene.ts';
import {MetroSystem,METRO_FLOOR,METRO_TRACKS,METRO_STATIONS,metroConcourse} from '../app/metro-system.ts';
import {DownloadedMetroAssets} from '../app/metro-assets.ts';
import {fallbackTerrainElevation} from '../app/world-terrain.ts';

test('each complete tall atrium encloses both original lift shafts and terminal buffers stay beyond the train berths',async()=>withDownloadedMetroFiles(async()=>{
 const scene=new T.Scene(),system=new MetroSystem(fallbackTerrainElevation),visuals=new MetroScene(scene,system,fallbackTerrainElevation),assets=new DownloadedMetroAssets();await Promise.all([visuals.ready,assets.load()]);
 try{scene.updateMatrixWorld(true);
  for(let station=0;station<3;station++){
   const hall=metroConcourse(station),floor=system.lifts[station*2].lower;
   for(const lift of system.lifts.filter(l=>l.station===station)){
    const shaft=assets.getBounds(`lift-shaft-${station}-${lift.track}`).translate(new T.Vector3(lift.x,lift.lower,lift.z));
    assert.ok(shaft.min.x>=hall.x-hall.halfWidth&&shaft.max.x<=hall.x+hall.halfWidth);
    assert.ok(shaft.min.z>=hall.z-hall.halfDepth&&shaft.max.z<=hall.z+hall.halfDepth);
    assert.ok(shaft.max.y<floor+31.4,'Entire lift machinery fits beneath the atrium roof');
   }
  }
  const buffers=[];visuals.root.traverse(o=>{if(o.name==='Downloaded metro / buffer-stop')buffers.push(o);});assert.equal(buffers.length,4);
  for(const model of buffers){const b=assets.getBounds('buffer-stop').applyMatrix4(model.matrixWorld),c=b.getCenter(new T.Vector3());
   assert.ok(b.max.x<METRO_STATIONS[0].x-36||b.min.x>METRO_STATIONS[2].x+36,'The original train nose never reaches a buffer stop during its terminal berth');
   assert.ok(METRO_TRACKS.some(t=>Math.abs(c.z-t.z)<.001));assert.ok(Math.abs(b.min.y-(METRO_FLOOR-2.613455))<.001,'Stop feet are grounded at the actual rail datum');
  }
  const lights=[];visuals.root.traverse(o=>{if(o.isPointLight)lights.push(o);});assert.equal(lights.length,3);
  const ids=lights.map(l=>l.uuid);visuals.updateInteriorLighting({x:system.trains[0].x,z:system.trains[0].z},METRO_FLOOR);
  assert.ok(lights.every(l=>l.intensity>0&&l.position.y<METRO_FLOOR+4.417));
  visuals.updateInteriorLighting({x:2000,z:2000},0);assert.ok(lights.every(l=>l.intensity===0));assert.deepEqual(lights.map(l=>l.uuid),ids,'Interior illumination reuses its lights and cannot trigger shader rebuilds');
 }finally{visuals.dispose();assets.dispose();}
}));

test('actual full scooter and rider have clear headroom through every lift over its entire travel',async()=>withDownloadedMetroFiles(async()=>{
 const {group:hero}=await readModelGeometry(new URL('../public/models/capybara-premium-original.glb',import.meta.url).pathname);
 const size=new T.Box3().setFromObject(hero).getSize(new T.Vector3()),scale=3.45/Math.max(size.x,size.z),height=size.y*scale+.035;
 assert.ok(height>2.9&&height<3.1,'Measure the shipped rider rather than assume human headroom');
 const scene=new T.Scene(),system=new MetroSystem(),visuals=new MetroScene(scene,system,()=>0);await visuals.ready;
 try {for(const lift of system.lifts)for(const t of [0,.15,.35,.55,.75,1]){
  lift.height=lift.previousHeight=lift.lower+(METRO_FLOOR-lift.lower)*t;lift.door=lift.previousDoor=1;visuals.render(1);scene.updateMatrixWorld(true);
  for(const heading of [0,Math.PI/2]){const hx=(heading===0?size.z:size.x)*scale/2,hz=(heading===0?size.x:size.z)*scale/2;
   for(let x=-hx;x<=hx+.001;x+=hx/2)for(let z=-hz;z<=hz+.001;z+=hz/2){
    const hits=new T.Raycaster(new T.Vector3(lift.x+x,lift.height+.03,lift.z+z),new T.Vector3(0,1,0),0,height+.15).intersectObject(visuals.root,true);
    assert.equal(hits.length,0,JSON.stringify({lift:lift.id,t,x,z,hits:hits.map(h=>[h.object.name,h.point.y-lift.height])}));
   }
  }
 }}finally{visuals.dispose();}
}));

test('actual rail heads align with native wheel datum and steel tiles join without missing segments',async()=>withDownloadedMetroFiles(async()=>{
 const scene=new T.Scene(),system=new MetroSystem(),visuals=new MetroScene(scene,system,()=>0);await visuals.ready;
 try{scene.updateMatrixWorld(true);const rails=[];visuals.root.traverse(x=>{if(x.isInstancedMesh&&x.material?.name==='Steel-Shiny')rails.push(x);});assert.ok(rails.length>10);
 const headY=METRO_FLOOR-2.613455;
 const track=METRO_TRACKS[0];let hitsAt=0;
 // Sample several tile seams along a non-station segment, finding the steel
 // gauge from original source geometry rather than an invented rail width.
 const sample=rails.find(x=>{x.computeBoundingBox();return x.boundingBox?.min.z>track.z-5&&x.boundingBox?.max.z<track.z+5;});assert.ok(sample);
 const p=sample.geometry.attributes.position,top=[];for(let i=0;i<p.count;i++)if(p.getY(i)>-.005)top.push(p.getX(i));const gauges=[Math.min(...top),Math.max(...top)];
 for(const x of [-500,-499.99,-499.01,-499,-498.99])for(const offset of gauges){const ray=new T.Raycaster(new T.Vector3(x,headY+.05,track.z-offset),new T.Vector3(0,-1,0),0,.08);const hits=ray.intersectObjects(rails,false);if(hits.length){assert.ok(Math.abs(hits[0].point.y-headY)<.005);hitsAt++;}}
 assert.equal(hitsAt,10,'Continuous visible steel at each one-metre joint');
 }finally{visuals.dispose();}
}));
