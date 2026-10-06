import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {Document,NodeIO} from '@gltf-transform/core';
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {geometry,assign} from './metro-import/source-volume.mjs';

// Complete CC0 commercial exteriors. Original geometry is never cut apart;
// palette regions become physical materials and windows remain opaque.
const folder=new URL('../public/models/neighborhood/',import.meta.url),io=new NodeIO(),records=[];
const page='https://kenney.nl/assets/city-kit-commercial';
for(const [kind,width,sourceName]of[['mart',14,'building-e'],['coffee',10.4,'building-b']]){
 const sourceFile=kind+'-source.glb',source=await io.read(new URL(sourceFile,folder).pathname),bounds=new T.Box3(),native=[];
 for(const node of source.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){const g=geometry(p);g.applyMatrix4(new T.Matrix4().fromArray(node.getWorldMatrix()));g.computeBoundingBox();bounds.union(g.boundingBox);native.push(g);}
 const scale=width/(bounds.max.x-bounds.min.x),centre=bounds.getCenter(new T.Vector3());
 const matrix=new T.Matrix4().makeScale(scale,scale,scale).multiply(new T.Matrix4().makeTranslation(-centre.x,-bounds.min.y,-centre.z));
 const groups=new Map(),sourceTriangles=native.reduce((n,g)=>n+g.attributes.position.count/3,0);
 const doc=new Document();doc.createBuffer();const scene=doc.createScene(),mesh=doc.createMesh();
 for(const g of native){const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
  for(let i=0;i<p.count;i+=3){const u=uv.getX(i),v=uv.getY(i),role=v<.5&&u>.6?'glazing':v>.5&&u>.4?'cladding':v<.5?'awning':u<.16?'roof':'trim';
   if(!groups.has(role))groups.set(role,{p:[],n:[],uv:[]});const a=groups.get(role);
   for(let j=0;j<3;j++){const at=i+j;a.p.push(p.getX(at),p.getY(at),p.getZ(at));a.n.push(n.getX(at),n.getY(at),n.getZ(at));a.uv.push(uv.getX(at),uv.getY(at));}
  }
 }
 function add(g,material,project=true){const positions=g.attributes.position;for(let i=0;i<positions.count;i++)if(Math.abs(positions.getY(i))<1e-6)positions.setY(i,0);if(project){const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));uv.setXY(i,(ny>nx&&ny>nz?p.getX(i):nx>nz?p.getZ(i):p.getX(i))/1.25,(ny>nx&&ny>nz?p.getZ(i):p.getY(i))/1.25);}}
  const primitive=doc.createPrimitive().setMaterial(material);assign(doc,primitive,g);mesh.addPrimitive(primitive);return g;
 }
 const palette={cladding:'#e6e3da',glazing:'#344b57',roof:'#6c7275',trim:'#ccd0cb',awning:kind==='mart'?'#147b65':'#685344'};
 for(const [role,a]of groups){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(a.p,3)).setAttribute('normal',new T.Float32BufferAttribute(a.n,3)).setAttribute('uv',new T.Float32BufferAttribute(a.uv,2));g.applyMatrix4(matrix);
  const c=new T.Color(palette[role]),material=doc.createMaterial(role).setBaseColorFactor([...c.toArray(),1]).setRoughnessFactor(role==='glazing'?.19:role==='awning'?.6:.83).setMetallicFactor(role==='glazing'?.48:role==='trim'?.4:.02).setAlphaMode('OPAQUE');
  if(role==='cladding'||role==='roof')material.setExtras({normal:'/textures/estate/travertine-normal.jpg',roughness:'/textures/estate/travertine-roughness.jpg'});
  add(g,material);
 }
 const depth=(bounds.max.z-bounds.min.z)*scale,signWidth=width*.86,signHeight=signWidth*240/2048;
 const signY=kind==='mart'?3.67:4.6,signZ=-depth/2-.04;
 const caseMaterial=doc.createMaterial('Extruded aluminum sign enclosure').setBaseColorFactor([.25,.28,.27,1]).setMetallicFactor(.65).setRoughnessFactor(.33);
 const signMaterial=doc.createMaterial('Complete branded exterior shop sign').setBaseColorTexture(doc.createTexture().setImage(await fs.readFile(new URL(`../../textures/neighborhood/${kind}-sign.png`,folder))).setMimeType('image/png')).setRoughnessFactor(.5).setEmissiveFactor([.13,.13,.13]);
 const box=new T.BoxGeometry(signWidth,signHeight,.14).toNonIndexed();box.translate(0,signY,signZ);
 const signs=box.groups.map(group=>{const g=new T.BufferGeometry();for(const name of['position','normal','uv']){const a=box.attributes[name];g.setAttribute(name,new T.BufferAttribute(a.array.slice(group.start*a.itemSize,(group.start+group.count)*a.itemSize),a.itemSize));}return{g,material:group.materialIndex===5?signMaterial:caseMaterial};});
 for(const material of[caseMaterial,signMaterial]){const g=mergeGeometries(signs.filter(s=>s.material===material).map(s=>s.g));if(material===signMaterial){const uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));}add(g,material,false);}
 // Close the source building's ground-floor arcade with an opaque storefront,
 // rather than leaving an open display diorama or a visible empty interior.
 let addedTriangles=12;
 if(kind==='coffee'){
  const wall=doc.createMaterial('Closed ground-floor ceramic walls').setBaseColorFactor([.68,.70,.68,1]).setRoughnessFactor(.85).setExtras({normal:'/textures/estate/travertine-normal.jpg',roughness:'/textures/estate/travertine-roughness.jpg'});
  const window=doc.createMaterial('Opaque reflective street-level glazing').setBaseColorFactor([.035,.075,.09,1]).setMetallicFactor(.48).setRoughnessFactor(.16);
  const frame=doc.createMaterial('Ground-floor aluminum mullions').setBaseColorFactor([.22,.25,.25,1]).setMetallicFactor(.7).setRoughnessFactor(.3);
  const pieces=new Map();const part=(w,h,d,x,y,z,m)=>{const g=new T.BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);if(!pieces.has(m))pieces.set(m,[]);pieces.get(m).push(g);addedTriangles+=12;};
  part(width-.8,4.05,depth-.8,0,2.025,0,wall);
  const front=-depth/2-.015;
  part(width-.55,.34,.18,0,.17,front,frame);part(width-.55,.24,.18,0,3.97,front,frame);
  for(const x of[-4.48,4.48])part(.16,3.9,.18,x,2.02,front,frame);
  for(const x of[-.95,.95])part(.11,3.68,.18,x,2.025,front,frame);
  for(const x of[-2.73,2.73])part(3.34,3.65,.045,x,2.025,front-.025,window);
  for(const x of[-.46,.46])part(.87,3.65,.045,x,2.025,front-.025,window);
  part(.07,3.65,.09,0,2.025,front-.06,frame);
  for(const x of[-.13,.13])part(.035,.6,.055,x,1.68,front-.105,frame);
  for(const [m,parts]of pieces){const g=mergeGeometries(parts);add(g,m);}
 }
 const sourceSha=crypto.createHash('sha256').update(await fs.readFile(new URL(sourceFile,folder))).digest('hex');
 scene.addChild(doc.createNode(`Complete closed ${kind} exterior`).setMesh(mesh).setExtras({downloadedSource:{page,author:'Kenney',license:'CC0-1.0',file:sourceName+'.glb',sha256:sourceSha},completeExterior:true,uniformScale:scale,sourceTriangleCount:sourceTriangles,opaqueWindows:true,originalSignDesign:true}));
 const fitted=new T.Box3();for(const primitive of mesh.listPrimitives()){const g=geometry(primitive);g.computeBoundingBox();fitted.union(g.boundingBox);}
 const file=kind+'-metric.glb';await io.write(new URL(file,folder).pathname,doc);
 records.push({file,sourceFile,page,author:'Kenney',license:'CC0-1.0',sha256:crypto.createHash('sha256').update(await fs.readFile(new URL(file,folder))).digest('hex'),sourceSha256:sourceSha,sourceTriangleCount:sourceTriangles,addedTriangles,uniformScale:scale,bounds:[fitted.min.toArray(),fitted.max.toArray()],completeExterior:true,opaqueWindows:true});
 console.log(file,sourceTriangles,fitted.min.toArray(),fitted.max.toArray());
}
const old=JSON.parse(await fs.readFile(new URL('sources.json',folder),'utf8'));
await fs.writeFile(new URL('sources.json',folder),JSON.stringify({version:2,files:[...records,...old.files.filter(f=>f.file==='fox.glb')]},null,2)+'\n');
