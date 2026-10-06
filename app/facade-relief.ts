import * as THREE from 'three';
import type {Coordinates} from './game-core';
import {facadeBands} from './facade-layout';
import { standardNodeMaterial } from './gpu-materials';
import { attribute, materialMetalness, materialRoughness, mix } from 'three/tsl';

// Window openings measured from the original photographic atlases. The color
// artwork and its physical floor/bay proportions stay unchanged.
export const FACADE_OPENINGS:Record<number,Array<[number,number]>>={
  1:Array.from({length:19},(_,i)=>[(7+i*32.3)/627,(34+i*32.3)/627]),
  3:[[27,102],[147,222],[272,346],[393,467],[517,591]].map(([a,b])=>[a/627,b/627]),
};

export function createReliefFacade(outline:Coordinates[],top:number,base:number,style:number,groundHeight:number) {
  const positions:number[]=[],uvs:number[]=[],glazing:number[]=[];
  const center={x:outline.reduce((s,p)=>s+p.x,0)/outline.length,z:outline.reduce((s,p)=>s+p.z,0)/outline.length};
  let openings=0;
  for(let edge=0;edge<outline.length-1;edge++) {
    const a=outline[edge],b=outline[edge+1],length=Math.hypot(b.x-a.x,b.z-a.z);if(length<.25)continue;
    const dx=(b.x-a.x)/length,dz=(b.z-a.z)/length;
    let nx=-dz,nz=dx;if(nx*((a.x+b.x)/2-center.x)+nz*((a.z+b.z)/2-center.z)<0){nx=-nx;nz=-nz;}
    for(const band of facadeBands(base,top,groundHeight,style)) {
      const endU=length/band.width,span=band.upperV-band.lowerV;
      const add=(u:number,v:number,depth:number,glass:number)=>{
        const x=u*band.width,y=band.bottom+(v-band.lowerV)/span*(band.top-band.bottom);
        positions.push(a.x+dx*x+nx*depth,y,a.z+dz*x+nz*depth);uvs.push(u,v);glazing.push(glass);
      };
      const quad=(u0:number,u1:number,v0:number,v1:number,depth:number,glass=0)=>{
        add(u0,v0,depth,glass);add(u1,v0,depth,glass);add(u1,v1,depth,glass);
        add(u0,v0,depth,glass);add(u1,v1,depth,glass);add(u0,v1,depth,glass);
      };
      const windows=FACADE_OPENINGS[style];
      if(!windows||band.bottom<groundHeight-.001){quad(0,endU,band.lowerV,band.upperV,0);continue;}
      const lower=band.lowerV+span*(style===1?.12:.23),upper=band.lowerV+span*(style===1?.94:.80);
      const intervals:Array<[number,number]>=[];
      for(let repeat=0;repeat<Math.ceil(endU);repeat++)for(const [l,r] of windows) {
        const left=repeat+l,right=repeat+r;
        if(left>=.08/band.width&&right<=endU-.08/band.width)intervals.push([left,right]);
      }
      quad(0,endU,band.lowerV,lower,0);quad(0,endU,upper,band.upperV,0);
      let cursor=0;
      for(const [left,right] of intervals) {
        if(left>cursor)quad(cursor,left,lower,upper,0);
        const depth=band.bottom<groundHeight+13.2?(style===1?-.085:-.19):0;
        quad(left,right,lower,upper,depth,1);openings++;
        if(depth)for(const [u0,v0,u1,v1] of [[left,lower,right,lower],[right,lower,right,upper],[right,upper,left,upper],[left,upper,left,lower]]) {
          add(u0,v0,0,0);add(u1,v1,0,0);add(u1,v1,depth,0);
          add(u0,v0,0,0);add(u1,v1,depth,0);add(u0,v0,depth,0);
        }
        cursor=right;
      }
      if(cursor<endU)quad(cursor,endU,lower,upper,0);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('facadeGlass',new THREE.Float32BufferAttribute(glazing,1));
  geometry.computeVertexNormals();geometry.userData.authoredOpenings=openings;
  return geometry;
}

/** Glass and masonry share one draw and retain the original diffuse map. */
export function configureFacadeMaterial(source:THREE.MeshStandardMaterial) {
  const material = standardNodeMaterial(source);
  const glass = attribute<'float'>('facadeGlass', 'float').clamp(0, 1);
  material.roughnessNode = mix(materialRoughness, .22, glass);
  material.metalnessNode = mix(materialMetalness, .08, glass);
  material.envMapIntensity=.9;
  return material;
}
