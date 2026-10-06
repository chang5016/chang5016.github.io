import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import * as T from 'three';
import {geometry,assign,clip,carve} from './source-volume.mjs';
const folder=new URL('../../public/models/metro/downloaded/',import.meta.url),io=new NodeIO();
const manifest=JSON.parse(await fs.readFile(new URL('sources.json',folder),'utf8'));
async function save(name,doc,adaptation,sourceName=name){
 const source=manifest.files.find(f=>f.file===sourceName+'.glb').source;let triangles=0;const bounds=new T.Box3();
 for(const node of doc.getRoot().listNodes()){node.setExtras({...node.getExtras(),downloadedSource:source,adaptation});for(const p of node.getMesh()?.listPrimitives()??[]){const g=geometry(p);if(!g.attributes.position.count)continue;triangles+=g.attributes.position.count/3;g.computeBoundingBox();bounds.union(g.boundingBox);}}
 await io.write(new URL(name+'.glb',folder).pathname,doc);const bytes=await fs.readFile(new URL(name+'.glb',folder));
 manifest.files=manifest.files.filter(f=>f.file!==name+'.glb');manifest.files.push({file:name+'.glb',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),source,adaptation,triangles,bounds:[bounds.min.toArray(),bounds.max.toArray()]});console.log(name,triangles);
}
try{await fs.access(new URL('gangway-source.glb',folder));}catch{await fs.copyFile(new URL('gangway-shell.glb',folder),new URL('gangway-source.glb',folder));}
await save('gangway-source',await io.read(new URL('gangway-source.glb',folder).pathname),'Unmodified v89 source-derived rear vestibule casing retained for reproducible adaptation.','gangway-shell');
const car=await io.read(new URL('jfr1-motorcycle-car.glb',folder).pathname);
for(const mesh of car.getRoot().listMeshes())for(const p of [...mesh.listPrimitives()]){const g=carve(geometry(p),[[[-1.72,.035,-18],[1.72,3.72,-10.5]]]);if(!g.attributes.position.count){mesh.removePrimitive(p);continue;}assign(car,p,g);}
await save('jfr1-motorcycle-car',car,'Complete original PBR car retained. Continuous 3.44 m by 3.72 m rear vestibule clearance includes the original internal brace; native floor and underframe preserved.');
const pocket=await io.read(new URL('platform-door.glb',folder).pathname);
for(const mesh of pocket.getRoot().listMeshes())for(const p of mesh.listPrimitives()){const g=geometry(p);g.applyMatrix4(new T.Matrix4().makeScale(1.72/1.525,1,.105/.085));assign(pocket,p,g);}
for(const m of pocket.getRoot().listMaterials())m.setName('PSD recessed aluminium pocket').setAlphaMode('OPAQUE').setBaseColorFactor([.48,.54,.57,1]).setMetallicFactor(.72).setRoughnessFactor(.38);
await save('platform-pocket',pocket,'Opaque recessed enclosure adapted from the downloaded framed door, paired around sliding platform leaves. Native beveled geometry retained.','platform-door');
const shell=await io.read(new URL('gangway-source.glb',folder).pathname);
for(const mesh of shell.getRoot().listMeshes())for(const p of mesh.listPrimitives()){
 const g=geometry(p),pos=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,out={p:[],n:[],uv:[]};
 for(let i=0;i<pos.count;i+=3)for(let band=0;band<40;band++){
  let poly=[0,1,2].map(j=>({p:[pos.getX(i+j),pos.getY(i+j),pos.getZ(i+j)],n:[n.getX(i+j),n.getY(i+j),n.getZ(i+j)],uv:[uv.getX(i+j),uv.getY(i+j)]}));
  poly=clip(clip(poly,2,-2.05+band*4.1/40,true),2,-2.05+(band+1)*4.1/40,false);
  for(let j=1;j<poly.length-1;j++)for(const v of [poly[0],poly[j],poly[j+1]]){let[x,y,z]=v.p;const rib=(1-Math.cos((z+2.05)/4.1*20*Math.PI))*.5;if(Math.abs(x)>1.72)x=Math.sign(x)*(1.72+(Math.abs(x)-1.72)*(.2+.1*rib));if(y>3.72)y=3.72+(y-3.72)*(.24+.14*rib);out.p.push(x,y,z);out.n.push(...v.n);out.uv.push(...v.uv);}
 }
 const result=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(out.p,3)).setAttribute('normal',new T.Float32BufferAttribute(out.n,3)).setAttribute('uv',new T.Float32BufferAttribute(out.uv,2));result.computeVertexNormals();assign(shell,p,result);
}
for(const m of shell.getRoot().listMaterials())m.setName('Downloaded vestibule / rounded flexible bellows').setBaseColorFactor([.16,.18,.19,1]).setMetallicFactor(.02).setRoughnessFactor(.78).setAlphaMode('OPAQUE').setExtras({map:'/models/metro/downloaded/textures/Plastic.webp'});
await save('gangway-shell',shell,'Downloaded rear vestibule source triangles subdivided into rounded flexible folds, preserving 3.44 m clear width and 3.72 m height. Continuous 4.10 m inter-car enclosure.','gangway-source');
const collar=await io.read(new URL('gangway-source.glb',folder).pathname);
for(const mesh of collar.getRoot().listMeshes())for(const p of mesh.listPrimitives()){const g=geometry(p),a=g.attributes.position;for(let i=0;i<a.count;i++){const x=a.getX(i),y=a.getY(i);a.setXYZ(i,Math.abs(x)>1.72?Math.sign(x)*(1.72+(Math.abs(x)-1.72)*.25):x,y>3.72?3.72+(y-3.72)*.3:y,a.getZ(i)*.12/4.1);}g.computeVertexNormals();assign(collar,p,g);}
for(const m of collar.getRoot().listMaterials())m.setName('Downloaded vestibule / aluminium connection collar').setBaseColorFactor([.54,.6,.64,1]).setMetallicFactor(.7).setRoughnessFactor(.32).setAlphaMode('OPAQUE').setExtras({});
await save('gangway-collar',collar,'Thin fitted aluminium end collars derived entirely from downloaded JFR1 rear vestibule geometry.','gangway-source');
manifest.version=5;manifest.platformDoorPocket={clearGap:.32,leafWidth:1.525,pocketWidth:1.72};await fs.writeFile(new URL('sources.json',folder),JSON.stringify(manifest,null,2)+'\n');
