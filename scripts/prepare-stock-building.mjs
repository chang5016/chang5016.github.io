// Retain every source triangle, physical proportions and UV island; consolidate
// the complete licensed model into one material draw with a packed PBR atlas.
import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
import sharp from 'sharp';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [input,output]=process.argv.slice(2);
await mkdir(output,{recursive:true});
const io=new NodeIO(),doc=await io.read(input),root=doc.getRoot();
const box=new THREE.Box3(),point=new THREE.Vector3();
for(const node of root.listNodes())for(const p of node.getMesh()?.listPrimitives()??[]){const matrix=new THREE.Matrix4().fromArray(node.getWorldMatrix()),a=p.getAttribute('POSITION'),v=[];for(let i=0;i<a.getCount();i++){a.getElement(i,v);box.expandByPoint(point.fromArray(v).applyMatrix4(matrix));}}
const size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),scale=28.8/size.y;
const normalize=new THREE.Matrix4().makeScale(scale,scale,scale);normalize.setPosition(-center.x*scale,-box.min.y*scale,-center.z*scale);
const slots={Mat_Building:[0,0,2048],Mat_Columns:[2048,0,1024],Mat_Entrance:[3072,0,1024],Mat_Windows:[2048,1024,1024],Mat_BuildingFrame:[3072,1024,512],Mat_Frames:[3584,1024,512]};
const colorTiles=[],ormTiles=[],atlasWidth=4096,atlasHeight=2048,padding=8;
for(const material of root.listMaterials()){
  const [left,top,side]=slots[material.getName()],inner=side-2*padding;
  const color=await sharp(material.getBaseColorTexture().getImage()).removeAlpha().resize(inner,inner).extend({top:padding,bottom:padding,left:padding,right:padding,extendWith:'copy'}).png().toBuffer();
  const orm=await sharp(material.getMetallicRoughnessTexture().getImage()).removeAlpha().resize(inner,inner).linear([1,material.getRoughnessFactor(),material.getMetallicFactor()],[0,0,0]).extend({top:padding,bottom:padding,left:padding,right:padding,extendWith:'copy'}).png().toBuffer();
  colorTiles.push({input:color,left,top});ormTiles.push({input:orm,left,top});
}
const colorBytes=await sharp({create:{width:atlasWidth,height:atlasHeight,channels:3,background:'#383c39'}}).composite(colorTiles).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
const ormBytes=await sharp({create:{width:atlasWidth,height:atlasHeight,channels:3,background:{r:255,g:230,b:0}}}).composite(ormTiles).png().toBuffer();
// A new document avoids orphaned buffers, nodes and duplicate texture allocations.
const {Document}=await import('@gltf-transform/core');const out=new Document(),buffer=out.createBuffer();
const albedo=out.createTexture('Complete building color atlas').setImage(colorBytes).setMimeType('image/jpeg');
const orm=out.createTexture('Complete building AO roughness metal atlas').setImage(ormBytes).setMimeType('image/png');
const material=out.createMaterial('Stock building PBR').setBaseColorTexture(albedo).setMetallicRoughnessTexture(orm).setOcclusionTexture(orm).setRoughnessFactor(1).setMetallicFactor(1).setDoubleSided(true);
const positions=[],normals=[],uvs=[],indices=[];let sourceDraws=0;
for(const node of root.listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
  sourceDraws++;const p=primitive.getAttribute('POSITION'),n=primitive.getAttribute('NORMAL'),uv=primitive.getAttribute('TEXCOORD_0');
  const transform=normalize.clone().multiply(new THREE.Matrix4().fromArray(node.getWorldMatrix())),normal=new THREE.Matrix3().getNormalMatrix(transform);
  const [left,top,side]=slots[primitive.getMaterial().getName()],inner=side-2*padding,v=[],base=positions.length/3;
  for(let i=0;i<p.getCount();i++){
    p.getElement(i,v);positions.push(...point.fromArray(v).applyMatrix4(transform).toArray());
    n.getElement(i,v);normals.push(...point.fromArray(v).applyMatrix3(normal).normalize().toArray());
    uv.getElement(i,v);if(v.slice(0,2).some(k=>k<-.001||k>1.001))throw Error('UV repeat requires separate handling');
    uvs.push((left+padding+v[0]*inner)/atlasWidth,(top+padding+v[1]*inner)/atlasHeight);
  }
  for(const index of primitive.getIndices().getArray())indices.push(base+index);
}
const accessor=(name,type,array)=>out.createAccessor(name).setType(type).setArray(array).setBuffer(buffer);
const primitive=out.createPrimitive().setAttribute('POSITION',accessor('position','VEC3',new Float32Array(positions))).setAttribute('NORMAL',accessor('normal','VEC3',new Float32Array(normals))).setAttribute('TEXCOORD_0',accessor('uv','VEC2',new Float32Array(uvs))).setIndices(accessor('indices','SCALAR',new Uint32Array(indices))).setMaterial(material);
out.createScene().addChild(out.createNode('Complete PBR urban office').setMesh(out.createMesh().addPrimitive(primitive)));
const path=`${output}/urban-office.glb`;await io.write(path,out);const bytes=await readFile(path);
const report={source:'https://opengameart.org/content/pbr-textured-building',original:'https://sketchfab.com/models/94fe67ee5aeb435d8ecfdb5bb29b9847',author:'volkanongun',license:'CC-BY-4.0',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,triangles:indices.length/3,sourceDraws,drawsPerBatch:1,width:size.x*scale,height:28.8,depth:size.z*scale,atlas:[atlasWidth,atlasHeight],sourceTextureTexels:12*2048*2048,packedTextureTexels:2*atlasWidth*atlasHeight,processing:'Uniform scale and ground pivot; complete uncut geometry; one combined material and PBR atlas. Main wall retains 2K tile, small fittings packed according to physical size; no runtime quality changes.'};
await writeFile(`${output}/integrity.json`,JSON.stringify(report,null,2)+'\n');console.log(report);
