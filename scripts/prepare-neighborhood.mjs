import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import * as T from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {geometry,assign} from './metro-import/source-volume.mjs';
const folder=new URL('../public/models/neighborhood/',import.meta.url),io=new NodeIO(),records=[];
for(const [name,page]of[['shop01','https://poly.pizza/m/5w9AIhTCLMS'],['shop02','https://poly.pizza/m/1d-_8bnyobk']]){
 const doc=await io.read(new URL(name+'.glb',folder).pathname),b=new T.Box3(),groups=new Map();let triangles=0;
 for(const node of doc.getRoot().listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){const g=geometry(p);g.applyMatrix4(new T.Matrix4().fromArray(node.getWorldMatrix()));g.computeBoundingBox();b.union(g.boundingBox);triangles+=g.attributes.position.count/3;const m=p.getMaterial();if(!groups.has(m))groups.set(m,[]);groups.get(m).push(g);}
 const scale=7.8/(b.max.z-b.min.z),centre=b.getCenter(new T.Vector3());
 const matrix=new T.Matrix4().makeRotationY(Math.PI/2).multiply(new T.Matrix4().makeScale(scale,scale,scale)).multiply(new T.Matrix4().makeTranslation(-centre.x,-b.min.y,-centre.z));
 const scene=doc.getRoot().listScenes()[0];for(const child of scene.listChildren())scene.removeChild(child);
 const mesh=doc.createMesh(),fitted=new T.Box3();
 for(const [material,geometries]of groups){const g=mergeGeometries(geometries);g.applyMatrix4(matrix);const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv??new T.Float32BufferAttribute(new Float32Array(p.count*2),2);g.setAttribute('uv',uv);
  for(let i=0;i<p.count;i++){const nx=Math.abs(n.getX(i)),ny=Math.abs(n.getY(i)),nz=Math.abs(n.getZ(i));uv.setXY(i,ny>nx&&ny>nz?p.getX(i)/1.4:nx>nz?p.getZ(i)/1.4:p.getX(i)/1.4,ny>nx&&ny>nz?p.getZ(i)/1.4:p.getY(i)/1.4);}
  const mname=material.getName();material.setRoughnessFactor(.78).setMetallicFactor(.02);
  if(['mat15','mat21','mat18','mat19','mat20'].includes(mname)){const kind=['mat15','mat21'].includes(mname)?'travertine':'wood';material.setExtras({map:`/textures/estate/${kind}-color.jpg`,normal:`/textures/estate/${kind}-normal.jpg`,roughness:`/textures/estate/${kind}-roughness.jpg`});material.setBaseColorFactor(mname==='mat15'?[.75,.79,.78,1]:mname==='mat21'?[.93,.92,.86,1]:mname==='mat18'?[.95,.9,.77,1]:[.56,.47,.37,1]);}
  if(material.getBaseColorFactor()[3]<1)material.setBaseColorFactor([.64,.81,.87,.32]).setRoughnessFactor(.17).setMetallicFactor(.12).setAlphaMode('BLEND');
  const primitive=doc.createPrimitive().setMaterial(material);assign(doc,primitive,g);mesh.addPrimitive(primitive);g.computeBoundingBox();fitted.union(g.boundingBox);
 }
 scene.addChild(doc.createNode(name+' complete metric source').setMesh(mesh).setExtras({downloadedSource:{page,author:'sugamo',license:'CC-BY-3.0'},uniformScale:scale,completeSource:true}));
 await io.write(new URL(name+'-metric.glb',folder).pathname,doc);
 const hash=async file=>crypto.createHash('sha256').update(await fs.readFile(new URL(file,folder))).digest('hex');
 records.push({file:name+'-metric.glb',sourceFile:name+'.glb',page,author:'sugamo',license:'CC-BY-3.0',sha256:await hash(name+'-metric.glb'),sourceSha256:await hash(name+'.glb'),sourceTriangleCount:triangles,uniformScale:scale,bounds:[fitted.min.toArray(),fitted.max.toArray()]});console.log(name,triangles,fitted.min.toArray(),fitted.max.toArray());
}
records.push({file:'fox.glb',page:'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox',geometryAuthor:'PixelMannen',geometryLicense:'CC0',animationAuthor:'tomkranis',animationLicense:'CC-BY-4.0',sha256:crypto.createHash('sha256').update(await fs.readFile(new URL('fox.glb',folder))).digest('hex'),clips:['Survey','Walk','Run']});
await fs.writeFile(new URL('sources.json',folder),JSON.stringify({version:1,files:records},null,2)+'\n');
