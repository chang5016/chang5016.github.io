import * as T from 'three';
import {OBJLoader} from 'three/addons/loaders/OBJLoader.js';
import {MTLLoader} from 'three/addons/loaders/MTLLoader.js';
import {TDSLoader} from 'three/addons/loaders/TDSLoader.js';
import {Document,NodeIO} from '@gltf-transform/core';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export {T,fs};
export const inputRoot=path.resolve(process.argv[2]??'metro-source');
export const root=path.join(inputRoot,'libre-source/src/');
export const outputDir=fileURLToPath(new URL('../../public/models/metro/downloaded/',import.meta.url));
export const repository='https://github.com/Libre-TrainSim/Libre-TrainSim';
export const revision=JSON.parse(await fs.readFile(path.join(inputRoot,'libre-tree.json'),'utf8')).sha;
const tresNames={Beton:'Beton',Metal:'Metal',BlackMetal:'Metal_Black',Steel:'Metal',Floor:'PlasterStones',Pflasterstein:'PlasterStonesLight',Side:'Beton',Stripe:'Metal_White',Roof:'CorrugatedSteel',RoofInside:'White_Plastic',Plastic:'White_Plastic',Wood:'Wood',Gravel:'Gravel','Steel-Brown':'Metal_Brown','Steel-Shiny':'Metal-Rail',WhitePlastic:'White_Plastic',InnerWall:'White_Plastic',BlackPlastic:'Black_Plastic',GreyMetal:'Metal_Grey',LightBluePlastic:'LightBlue_Plastic',DarkBluePlastic:'Dark_Blue_Plastic',FabricCover:'Blue_Plastic',Metal1:'Metal',Metal2:'Metal',Metal3:'Metal',Door:'Metal_White',LED:'LEDLamp',Lamp:'LEDLamp',Glass:'GlassHalfInvisible'};
const textureBytes=new Map();
const losslessTextures=JSON.parse(await fs.readFile(path.join(inputRoot,'lossless-textures.json'),'utf8')); 
export async function loadObj(relative){
 const data=await fs.readFile(root+relative+'.obj','utf8'),mtl=new MTLLoader().parse(await fs.readFile(root+relative+'.mtl','utf8'),'');
 const group=new OBJLoader().setMaterials(mtl).parse(data.replace(/^l .*$/gm,''));
 group.userData.downloadedSource={repository,revision,path:relative+'.obj',license:relative.startsWith('Trains/')?'CC0 (Jean3219)':'CC0 (Jean28518)',sha256:crypto.createHash('sha256').update(data).digest('hex')};
 group.updateMatrixWorld(true);
 const result=new T.Group();result.userData={...group.userData};
 group.traverse(object=>{
  if(!object.isMesh)return;
  const geometry=object.geometry.index?object.geometry.toNonIndexed():object.geometry;
  const materials=Array.isArray(object.material)?object.material:[object.material];
  const groups=geometry.groups.length?geometry.groups:[{start:0,count:geometry.attributes.position.count,materialIndex:0}];
  for(const range of groups){
   const part=new T.BufferGeometry();for(const attr of ['position','normal','uv'])if(geometry.attributes[attr]){const a=geometry.attributes[attr];part.setAttribute(attr,new T.Float32BufferAttribute(a.array.slice(range.start*a.itemSize,(range.start+range.count)*a.itemSize),a.itemSize));}
   if(!part.attributes.uv)part.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(part.attributes.position.count*2),2));
   part.applyMatrix4(object.matrixWorld);const material=materials[range.materialIndex];const mesh=new T.Mesh(part,material);mesh.name=object.name+' / '+material.name;mesh.userData={...group.userData};result.add(mesh);
  }
 });return result;
}
export async function loadMaglev(meshName='Mesh07'){
 const file=path.join(inputRoot,'maglev-unpacked/cadnav.com_model/Model_C0818132/C0818132.3DS'),bytes=await fs.readFile(file);
 globalThis.document??={createElementNS(){return{addEventListener(){},removeEventListener(){},set src(_) {}};}};
 const group=new TDSLoader().parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 group.rotation.x=-Math.PI/2;group.updateMatrixWorld(true);
 const result=new T.Group();result.userData.downloadedSource={page:'https://www.cadnav.com/3d-models/model-36867.html',file:'C0818132.3DS',license:'CadNav non-commercial page and bundled modification/project-use notice',sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const source=group.children.find(o=>o.name===meshName);
 const geometry=source.geometry.index?source.geometry.toNonIndexed():source.geometry;
 const materials=Array.isArray(source.material)?source.material:[source.material];
 const groups=geometry.groups.length?geometry.groups:[{start:0,count:geometry.attributes.position.count,materialIndex:0}];
 for(const range of groups){const part=new T.BufferGeometry();for(const attr of ['position','normal','uv']){const a=geometry.attributes[attr];if(a)part.setAttribute(attr,new T.Float32BufferAttribute(a.array.slice(range.start*a.itemSize,(range.start+range.count)*a.itemSize),a.itemSize));}if(!part.attributes.uv)part.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(part.attributes.position.count*2),2));part.applyMatrix4(source.matrixWorld);const mesh=new T.Mesh(part,materials[range.materialIndex]);mesh.name='Shanghai maglev / '+meshName+' / '+mesh.material.name;mesh.userData={...result.userData};result.add(mesh);}
 return result;
}
export function bounds(group){group.updateMatrixWorld(true);return new T.Box3().setFromObject(group);}
export function transform(group,matrix){for(const mesh of group.children)mesh.geometry.applyMatrix4(matrix);return group;}
export function clone(group){const result=new T.Group();result.userData={...group.userData};for(const source of group.children){const mesh=source.clone();mesh.geometry=source.geometry.clone();result.add(mesh);}return result;}
export function fit(group,width,height,depth,bottom=0){const b=bounds(group),size=b.getSize(new T.Vector3()),centre=b.getCenter(new T.Vector3());transform(group,new T.Matrix4().makeTranslation(-centre.x,-b.min.y,-centre.z));transform(group,new T.Matrix4().makeScale(width/size.x,height/size.y,depth/size.z));return transform(group,new T.Matrix4().makeTranslation(0,bottom,0));}
function clipPolygon(vertices,axis,limit,positive){
 const result=[];for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],da=(a.p[axis]-limit)*(positive?1:-1),db=(b.p[axis]-limit)*(positive?1:-1),inside=da>=-1e-7;
  if(inside)result.push(a);if(inside!==(db>=-1e-7)){const t=da/(da-db);result.push({p:a.p.map((v,c)=>v+(b.p[c]-v)*t),n:a.n.map((v,c)=>v+(b.n[c]-v)*t),uv:a.uv.map((v,c)=>v+(b.uv[c]-v)*t)});}}
 return result;
}
export function subtractBoxes(geometry,boxes){
 const p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv,out={p:[],n:[],uv:[]};
 for(let i=0;i<p.count;i+=3){let polygons=[[0,1,2].map(j=>({p:[p.getX(i+j),p.getY(i+j),p.getZ(i+j)],n:[n.getX(i+j),n.getY(i+j),n.getZ(i+j)],uv:[uv.getX(i+j),uv.getY(i+j)]}))];
  for(const box of boxes){const next=[];for(let poly of polygons){if([0,1,2].some(axis=>poly.every(v=>v.p[axis]<=box[0][axis])||poly.every(v=>v.p[axis]>=box[1][axis]))){next.push(poly);continue;}let inside=poly;for(let axis=0;axis<3;axis++)for(const edge of [0,1]){if(inside.length<3)break;const limit=box[edge][axis],positive=edge===0,part=clipPolygon(inside,axis,limit,!positive);if(part.length>=3)next.push(part);inside=clipPolygon(inside,axis,limit,positive);}}polygons=next;}
  for(const poly of polygons)for(let j=1;j<poly.length-1;j++)for(const v of [poly[0],poly[j],poly[j+1]]){out.p.push(...v.p);const len=Math.hypot(...v.n)||1;out.n.push(...v.n.map(x=>x/len));out.uv.push(...v.uv);}
 }
 return new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(out.p,3)).setAttribute('normal',new T.Float32BufferAttribute(out.n,3)).setAttribute('uv',new T.Float32BufferAttribute(out.uv,2));
}
export function carve(group,boxes){for(const mesh of [...group.children]){const geometry=subtractBoxes(mesh.geometry,boxes);mesh.geometry.dispose();mesh.geometry=geometry;if(!geometry.attributes.position.count)group.remove(mesh);}return group;}
export function select(group,predicate){const result=clone(group);for(const mesh of [...result.children])if(!predicate(mesh))result.remove(mesh);return result;}
export function slice(group,minimum,maximum){return carve(group,[[[-1e4,-1e4,-1e4],[1e4,minimum,1e4]],[[-1e4,maximum,-1e4],[1e4,1e4,1e4]]]);}
async function material(doc,source,metadata,textureCache){
 const name=source.name;let color=source.color?.toArray()??[.65,.65,.65],roughness=.6,metallic=/metal|steel|frontcol/i.test(name)?.45:0;
 let mapPath=null,ormPath=null;const mapped=tresNames[name]??name;
 try {
  const train=/Wagon.*BAKED/.test(name), tres=await fs.readFile(root+(train?'Trains/JFR1/Wagon_WithDriverStand_Red.tres':'Resources/Materials/'+mapped+'.tres'),'utf8');
  const c=tres.match(/albedo_color = Color\( ([\d., ]+) \)/);if(c)color=c[1].split(',').map(Number).slice(0,3);else if(train)color=[1,1,1];
  roughness=Number(tres.match(/^roughness = ([\d.]+)/m)?.[1]??(train?1:roughness));metallic=Number(tres.match(/^metallic = ([\d.]+)/m)?.[1]??metallic);
  const ext=[...tres.matchAll(/ext_resource path="res:\/\/([^"]+)"[^\n]+id=(\d+)/g)];const id=tres.match(/^albedo_texture = ExtResource\( (\d+) \)/m)?.[1];mapPath=ext.find(x=>x[2]===id)?.[1];
  if(train)ormPath='/models/metro/downloaded/textures/JFR1-ORM.webp';
 }catch{}
 if(/glass|transluc/i.test(name)){color=[.22,.37,.43];roughness=.12;metallic=.2;}
 if(/display/i.test(name)){color=[.03,.05,.07];roughness=.35;metallic=.05;}
 if(metadata.page){if(/0039_dar/i.test(name))color=[.025,.16,.28];if(/0082_lig/i.test(name))color=[.12,.32,.40];if(/frontcol|color_00/i.test(name)){color=[.86,.9,.92];metallic=.65;roughness=.27;}if(/blinds_r/i.test(name)){color=[.65,.69,.70];mapPath='Resources/Textures/CorrugatedSteel.png';}}
 const output=doc.createMaterial(name).setBaseColorFactor([...color,/glass|transluc/i.test(name)?.24:1]).setRoughnessFactor(roughness).setMetallicFactor(metallic).setDoubleSided(true);
 if(/glass|transluc/i.test(name))output.setAlphaMode('BLEND');
 if(/lamp|led/i.test(name))output.setEmissiveFactor([.85,.8,.65]);
 if(mapPath){try{const bytes=textureBytes.get(mapPath)??await fs.readFile(root+mapPath);textureBytes.set(mapPath,bytes);const encoded=losslessTextures[mapPath],encodedBytes=encoded?await fs.readFile(path.join(inputRoot,encoded.path)):bytes,filename=encoded?path.basename(encoded.path):path.basename(mapPath);const destination=path.join(outputDir,'textures',filename);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,encodedBytes);output.setExtras({downloadedTexture:{repository,revision,path:mapPath,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),...(encoded?{losslessEncoding:{format:'webp',decodedRgbaSha256:encoded.decodedRgbaSha256,originalBytes:bytes.length,bytes:encodedBytes.length}}:{})},map:'/models/metro/downloaded/textures/'+filename});}catch{}}
 if(ormPath)output.setExtras({...output.getExtras(),orm:ormPath});
 return output;
}
export async function writeGLB(group,destination,adaptation){
 const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene(),mats=new Map(),textureCache=new Map();
 group.updateMatrixWorld(true);
 for(const object of group.children){const g=object.geometry;const p=g.attributes.position;if(!p?.count)continue;const mesh=doc.createMesh(object.name),primitive=doc.createPrimitive();
  for(const [attr,semantic] of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0']]){const source=g.attributes[attr];if(!source)continue;primitive.setAttribute(semantic,doc.createAccessor().setType(source.itemSize===2?'VEC2':'VEC3').setArray(new Float32Array(source.array)).setBuffer(buffer));}
  if(!mats.has(object.material))mats.set(object.material,await material(doc,object.material,group.userData.downloadedSource,textureCache));primitive.setMaterial(mats.get(object.material));mesh.addPrimitive(primitive);
  const node=doc.createNode(object.name).setMesh(mesh).setExtras({downloadedSource:group.userData.downloadedSource,adaptation});scene.addChild(node);
 }
 await fs.mkdir(path.dirname(destination),{recursive:true});await new NodeIO().write(destination,doc);const bytes=await fs.readFile(destination);
 return {file:path.basename(destination),bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),source:group.userData.downloadedSource,adaptation,triangles:group.children.reduce((s,m)=>s+(m.geometry.attributes.position?.count??0)/3,0),bounds:[bounds(group).min.toArray(),bounds(group).max.toArray()]};
}

/** Remove complete disconnected source components, retaining original UVs and
 * normals. Seats must be removed whole rather than clipped into fragments. */
export function removeComponents(group, predicate) {
 for(const mesh of [...group.children]) {
  const g=mesh.geometry,p=g.attributes.position,count=p.count/3,parent=Array.from({length:count},(_,i)=>i),vertices=new Map();
  const find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  for(let t=0;t<count;t++)for(let j=0;j<3;j++) {const i=t*3+j,key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(5)).join(':');if(vertices.has(key))parent[find(t)]=find(vertices.get(key));else vertices.set(key,t);}
  const parts=new Map();for(let t=0;t<count;t++){const key=find(t),part=parts.get(key)??{box:new T.Box3(),triangles:[]};part.triangles.push(t);for(let j=0;j<3;j++)part.box.expandByPoint(new T.Vector3().fromBufferAttribute(p,t*3+j));parts.set(key,part);}
  const keep=[];for(const part of parts.values())if(!predicate(part.box,mesh.material.name))keep.push(...part.triangles);
  keep.sort((a,b)=>a-b);const next=new T.BufferGeometry();for(const name of ['position','normal','uv']) {const attr=g.attributes[name];if(!attr)continue;const data=[];for(const t of keep)for(let j=0;j<3;j++)for(let c=0;c<attr.itemSize;c++)data.push(attr.getComponent(t*3+j,c));next.setAttribute(name,new T.Float32BufferAttribute(data,attr.itemSize));}
  mesh.geometry=next;g.dispose();if(!next.attributes.position.count)group.remove(mesh);
 }
 return group;
}
export function removeSourceFaces(group,predicate){
 for(const mesh of [...group.children]){const g=mesh.geometry,p=g.attributes.position,keep=[];for(let i=0;i<p.count;i+=3){const pts=[0,1,2].map(j=>[p.getX(i+j),p.getY(i+j),p.getZ(i+j)]);if(!predicate(pts,mesh.material.name))keep.push(i);}
 const next=new T.BufferGeometry();for(const name of ['position','normal','uv']){const a=g.attributes[name];if(!a)continue;const out=[];for(const i of keep)for(let j=0;j<3;j++)for(let c=0;c<a.itemSize;c++)out.push(a.getComponent(i+j,c));next.setAttribute(name,new T.Float32BufferAttribute(out,a.itemSize));}mesh.geometry=next;g.dispose();if(!next.attributes.position.count)group.remove(mesh);
 }return group;
}
