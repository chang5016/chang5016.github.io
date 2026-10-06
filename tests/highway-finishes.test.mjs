import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {RealWorldMap,authoredExpresswayPlan} from '../app/real-world-map.ts';
import {coordinatesFromLocation} from '../app/game-core.ts';
import {createHeadlessDocument} from './headless-document.mjs';

function inside(point,outline,margin=0){
  const centre=outline.reduce((p,q)=>({x:p.x+q.x/outline.length,z:p.z+q.z/outline.length}),{x:0,z:0});
  return outline.every((a,i)=>{
    const b=outline[(i+1)%outline.length],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz)||1;
    const sign=Math.sign((centre.x-a.x)*-dz+(centre.z-a.z)*dx)||1;
    return sign*((point.x-a.x)*-dz+(point.z-a.z)*dx)/length>=margin;
  });
}
function designHeight(road,point){
  const dx=road.b.x-road.a.x,dz=road.b.z-road.a.z,t=Math.max(0,Math.min(1,((point.x-road.a.x)*dx+(point.z-road.a.z)*dz)/(dx*dx+dz*dz||1)));
  return road.startHeight+(road.endHeight-road.startHeight)*t;
}

test('all ramp ends join the whole receiving deck at one height; lane paint and barriers clear the merge',()=>{
  const document=globalThis.document;globalThis.document=createHeadlessDocument();
  const scene=new THREE.Scene(),world=new RealWorldMap(scene,1);
  try{
    scene.updateMatrixWorld(true);
    const roads=world.elevatedSegments,pavement=scene.getObjectByName('Real elevated roads and bridge decks');assert.ok(pavement);
    let endpoints=0;
    for(const feature of Object.values(authoredExpresswayPlan()).flat().filter(f=>f.properties.ramp_direction)){
      const p=feature.properties,points=feature.geometry.coordinates.map(([longitude,latitude])=>coordinatesFromLocation({longitude,latitude}));
      const owned=roads.filter(road=>road.roadOwner===p.name);assert.ok(owned.length>0);
      for(const first of [true,false]){
        const direction=p.ramp_direction,base=Number(p.base_elevated_height??0);
        if(first&&direction==='up'&&!base||!first&&direction==='down'&&!base)continue;
        const end=first?points[0]:points.at(-1),near=first?points[1]:points.at(-2);
        const dx=end.x-near.x,dz=end.z-near.z,length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length;
        const terminal=first?owned[0]:owned.at(-1),width=first?terminal.startWidth:terminal.endWidth;
        if(p.mainline_connector)assert.equal(width,16,'Mainline terminals preserve every through lane');
        for(const lateral of [-.45,0,.45]){
          const point={x:end.x+dx/length*.12+nx*width*lateral,z:end.z+dz/length*.12+nz*width*lateral};
          const receiver=roads.find(road=>road.roadOwner!==p.name&&(road.roadPriority??0)>=(terminal.roadPriority??0)&&road.footprint&&inside(point,road.footprint)&&Math.abs(designHeight(road,point)-designHeight(terminal,end))<.065);
          assert.ok(receiver,p.name+' full-width terminal lacks receiving pavement: '+JSON.stringify({first,lateral,point,width}));
          const heading=Math.atan2(dx,-dz),surface=world.elevationAt(point,heading,1000);
          const hits=new THREE.Raycaster(new THREE.Vector3(point.x,surface+.18,point.z),new THREE.Vector3(0,-1,0),0,.30).intersectObject(pavement);
          const levels=[...new Set(hits.map(hit=>Math.round(hit.point.y*1000)))];
          assert.equal(levels.length,1,p.name+' visible seam has missing or stacked asphalt: '+JSON.stringify({first,lateral,point,surface,levels}));
          assert.ok(Math.abs(hits[0].point.y-surface-.082)<.07,'Collision height follows the receiving road surface');
        }
        endpoints++;
      }
    }
    assert.ok(endpoints>=16);
    const checkTriangles=(mesh,callback)=>{
      const geometry=mesh.geometry,positions=geometry.getAttribute('position'),heights=geometry.getAttribute('terrainBaseY');
      for(let triangle=0;triangle<(geometry.index?.count??positions.count);triangle+=3){
        const ids=[0,1,2].map(i=>geometry.index?geometry.index.getX(triangle+i):triangle+i);
        const point={x:ids.reduce((sum,i)=>sum+positions.getX(i)/3,0),z:ids.reduce((sum,i)=>sum+positions.getZ(i)/3,0)};
        const height=ids.reduce((sum,i)=>sum+heights.getX(i)/3,0);callback(point,height);
      }
    };
    const yellow=scene.getObjectByName('Double yellow centre lines on two-way city approach ramps');assert.ok(yellow);
    checkTriangles(yellow,(point,height)=>{
      const crossing=world.elevatedSegmentGrid.queryAround(point,3).find(road=>road.roadPriority===3&&road.footprint&&inside(point,road.footprint,.025)&&Math.abs(designHeight(road,point)-height)<.06);
      assert.equal(crossing,undefined,'Ramp double yellow lines cannot extend across mainline lanes');
    });
    const rail=scene.getObjectByName('Solid elevated-road bridge parapets');assert.ok(rail);
    checkTriangles(rail,(point,height)=>{
      const crossing=world.elevatedSegmentGrid.queryAround(point,3).find(road=>road.footprint&&inside(point,road.footprint,.085)&&height>designHeight(road,point)+.03&&height<designHeight(road,point)+3.2);
      assert.equal(crossing,undefined,'No upright barrier fragment may protrude inside the carriageway: '+JSON.stringify({point,height,road:crossing?.roadOwner}));
    });
  }finally{world.dispose();if(document)globalThis.document=document;else delete globalThis.document;}
});
