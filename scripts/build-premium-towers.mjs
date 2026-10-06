// Complete metric architectural exteriors, exported once for instanced rendering.
// Stone relief, glazing and metal use a single shared base/normal/ORM atlas.
import * as THREE from 'three';
import {Document,NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out='public/models/buildings',doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('Capy Cab architectural collection');
const W=2048,H=1024;
const tile=async channel=>sharp(await readFile(`public/textures/estate/travertine-${channel}.jpg`)).resize(1008,1008).removeAlpha().extend({top:8,bottom:8,left:8,right:8,extendWith:'copy'}).png().toBuffer();
const stoneColor=await tile('color'),stoneNormal=await tile('normal'),rough=await sharp(await tile('roughness')).raw().toBuffer(),ormPixels=new Uint8Array(1024*1024*3);
for(let i=0;i<1024*1024;i++)ormPixels.set([255,rough[i*3],0],i*3);
const stoneOrm=await sharp(ormPixels,{raw:{width:1024,height:1024,channels:3}}).png().toBuffer();
const chips={stone:{slot:0},glass:{slot:1,color:'#66868d',r:.17,m:.35},bronze:{slot:2,color:'#938064',r:.29,m:.86},dark:{slot:3,color:'#394048',r:.74,m:.04},silver:{slot:4,color:'#c1c9c8',r:.26,m:.82}};
async function atlas(channel,stone){
 const layers=[{input:stone,left:0,top:0}];
 for(const[key,c]of Object.entries(chips)){if(key==='stone')continue;
  const color=channel==='color'?c.color:channel==='normal'?{r:128,g:128,b:255}:{r:255,g:Math.round(c.r*255),b:Math.round(c.m*255)};
  layers.push({input:await sharp({create:{width:512,height:512,channels:3,background:color}}).png().toBuffer(),left:1024+((c.slot-1)%2)*512,top:Math.floor((c.slot-1)/2)*512});
 }
 const s=sharp({create:{width:W,height:H,channels:3,background:'#ffffff'}}).composite(layers);return channel==='orm'?s.png().toBuffer():s.jpeg({quality:94,chromaSubsampling:'4:4:4'}).toBuffer();
}
const albedo=doc.createTexture('Architectural base color').setImage(await atlas('color',stoneColor)).setMimeType('image/jpeg');
const normal=doc.createTexture('Architectural stone relief').setImage(await atlas('normal',stoneNormal)).setMimeType('image/jpeg');
const orm=doc.createTexture('Architectural AO roughness metallic').setImage(await atlas('orm',stoneOrm)).setMimeType('image/png');
const material=doc.createMaterial('Shared architectural PBR').setBaseColorTexture(albedo).setNormalTexture(normal).setNormalScale(.48).setMetallicRoughnessTexture(orm).setOcclusionTexture(orm).setMetallicFactor(1).setRoughnessFactor(1);
const report={models:{},atlas:[W,H],processing:'Complete authored exterior models, metric 3.2–3.3 m storeys, actual windows, reveals, balcony rails, ground-level doors and screened roof equipment. Existing stone finish retained; shared full PBR atlas. No non-uniform scaling or runtime quality changes.'};
function build(kind,label,floors,step,stone,glass,terrace=false){
 const positions=[],normals=[],uvs=[],colors=[];let parts=0;
 const width=kind==='harbor-tower'?24:28,depth=kind==='harbor-tower'?16:18,bw=width-2.2,bd=depth-2.2,base=4.6,top=base+floors*step;
 function box(w,h,d,x,y,z,finish='stone',color='#ffffff'){
  const tiled=finish==='stone',g=new THREE.BoxGeometry(w,h,d,tiled?Math.ceil(w/2.4):1,tiled?Math.ceil(h/2.4):1,tiled?Math.ceil(d/2.4):1).toNonIndexed();
  const p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv'),c=new THREE.Color(color),v=new THREE.Vector3(),chip=chips[finish];
  for(let q=0;q<p.count;q+=6){
   let u0=Infinity,v0=Infinity,u1=-Infinity,v1=-Infinity,us=1,vs=1;
   for(let j=q;j<q+6;j++){u0=Math.min(u0,uv.getX(j));u1=Math.max(u1,uv.getX(j));v0=Math.min(v0,uv.getY(j));v1=Math.max(v1,uv.getY(j));}
   if(tiled){const origin=new THREE.Vector3().fromBufferAttribute(p,q);for(let j=q+1;j<q+6;j++){const dist=origin.distanceTo(v.fromBufferAttribute(p,j));if(Math.abs(uv.getY(j)-uv.getY(q))<1e-6&&Math.abs(uv.getX(j)-uv.getX(q))>1e-6)us=Math.min(1,dist/2.4);if(Math.abs(uv.getX(j)-uv.getX(q))<1e-6&&Math.abs(uv.getY(j)-uv.getY(q))>1e-6)vs=Math.min(1,dist/2.4);}}
   for(let j=q;j<q+6;j++){positions.push(p.getX(j)+x,p.getY(j)+y,p.getZ(j)+z);normals.push(n.getX(j),n.getY(j),n.getZ(j));colors.push(c.r,c.g,c.b);
    if(tiled)uvs.push((8+(uv.getX(j)-u0)/(u1-u0)*1008*us)/W,(8+(uv.getY(j)-v0)/(v1-v0)*1008*vs)/H);
    else uvs.push((1280+((chip.slot-1)%2)*512)/W,(256+Math.floor((chip.slot-1)/2)*512)/H);
   }
  }parts++;g.dispose();
 }
 box(width,.18,depth,0,.09,0,'stone',stone);box(bw-.4,4.2,bd-.4,0,2.2,0,'glass',glass);
 for(const x of [-bw/2,-5,5,bw/2])for(const z of [-bd/2,bd/2])box(.48,4.4,.5,x,2.35,z,'stone',stone);
 for(const z of [-bd/2+.15,bd/2-.15]){
  for(const x of [-1.62,0,1.62])box(.07,3.25,.1,x,1.81,z,'bronze');box(3.32,.09,.12,0,3.42,z,'bronze');
  for(const x of [-.17,.17])box(.035,.7,.07,x,1.55,z+Math.sign(z)*.075,'silver');
  box(5.3,.20,1.5,0,3.64,z+Math.sign(z)*.45,'bronze');box(5.1,.06,1.46,0,3.76,z+Math.sign(z)*.45);
 }
 box(width-.6,.45,depth-.6,0,base-.225,0,'stone',stone);
 for(let level=0;level<floors;level++){
  const y=base+level*step,setback=level>=floors-(kind==='civic-tower'?4:2)?1.2:0,w=bw-setback*2,d=bd-setback*2;
  box(w-.24,step-.24,d-.24,0,y+(step-.24)/2,0,'glass',glass);box(w+.28,.24,d+.28,0,y+.12,0,'stone',stone);
  for(const side of [-1,1]){
   const z=side*(d/2+.03),bay=w/8;
   for(let i=0;i<8;i++){const x=-w/2+(i+.5)*bay,tint=new THREE.Color(glass).multiplyScalar(.84+((i*17+level*11)%9)*.016).getHexString();box(bay-.085,step-.76,.06,x,y+(step+.20)/2,z,'glass',`#${tint}`);box(bay,.42,.12,x,y+.44,z+.018*side,'dark');box(.075,step-.20,.19,x-bay/2,y+step/2,z+.055*side,'bronze');}
   if(terrace&&level<floors-2)for(const x of [-w/4,w/4]){
    const balcony=w*.34,bz=side*(d/2+.48);
    box(balcony,.20,1.25,x,y+.12,bz,'stone',stone);box(balcony-.05,.88,.065,x,y+.66,side*(d/2+1.04),'glass','#bed0cc');box(balcony+.05,.055,.09,x,y+1.12,side*(d/2+1.06),'bronze');
    for(const edge of [-1,1])box(.055,.95,1.14,x+edge*(balcony-.1)/2,y+.67,bz,'bronze');
   }
  }
  for(const side of [-1,1]){const x=side*(w/2+.03),bay=d/6;for(let i=0;i<=6;i++)box(.18,step-.20,.075,x,y+step/2,-d/2+i*bay,'bronze');box(.16,.42,d,x,y+.44,0,'dark');}
  if(terrace){for(const side of [-1,1]){for(const x of [-w/2+.5,0,w/2-.5])box(x===0?1.8:1,step,.38,x,y+step/2,side*(d/2+.08),'stone',stone);box(.38,step,2.2,side*(w/2+.08),y+step/2,0,'stone',stone);}}
  else for(const side of [-1,1])for(const x of [-8.8,-4.4,4.4,8.8])if(Math.abs(x)<w/2-.15)box(.18,step,.38,x,y+step/2,side*(d/2+.15),'bronze');
 }
 const rw=bw-2.4,rd=bd-2.4;box(rw,.3,rd,0,top+.15,0,'stone',stone);
 for(const side of [-1,1]){box(rw,.75,.20,0,top+.67,side*(rd/2-.1),'stone',stone);box(.20,.75,rd,side*(rw/2-.1),top+.67,0,'stone',stone);}
 box(7.6,1.7,4.6,0,top+1.15,1.3,'dark');for(let i=0;i<7;i++)box(7.9,.08,.14,0,top+.4+i*.23,-1.06,'bronze');box(8,.20,5,0,top+2.1,1.3,'stone',stone);
 if(terrace){for(const x of [-6,6])for(const z of [-3.4,-.8])box(.13,2.2,.13,x,top+1.25,z,'bronze');for(let i=0;i<9;i++)box(.12,.13,2.85,-6+i*1.5,top+2.4,-2.1,'bronze');}
 const unique=new Map(),packed={p:[],n:[],uv:[],c:[]},ids=[];
 for(let i=0;i<positions.length/3;i++){const values=[...positions.slice(i*3,i*3+3),...normals.slice(i*3,i*3+3),...uvs.slice(i*2,i*2+2),...colors.slice(i*3,i*3+3)],key=values.map(Math.fround).join(',');let id=unique.get(key);if(id===undefined){id=unique.size;unique.set(key,id);packed.p.push(...values.slice(0,3));packed.n.push(...values.slice(3,6));packed.uv.push(...values.slice(6,8));packed.c.push(...values.slice(8));}ids.push(id);}
 const a=(name,type,data)=>doc.createAccessor(name).setType(type).setArray(new Float32Array(data)).setBuffer(buffer);
 const indices=unique.size<65536?new Uint16Array(ids):new Uint32Array(ids);
 const primitive=doc.createPrimitive().setAttribute('POSITION',a('position','VEC3',packed.p)).setAttribute('NORMAL',a('normal','VEC3',packed.n)).setAttribute('TEXCOORD_0',a('uv','VEC2',packed.uv)).setAttribute('COLOR_0',a('color','VEC3',packed.c)).setIndices(doc.createAccessor('indices').setType('SCALAR').setArray(indices).setBuffer(buffer)).setMaterial(material);
 scene.addChild(doc.createNode(kind).setMesh(doc.createMesh(label).addPrimitive(primitive)));
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];positions.forEach((v,i)=>{min[i%3]=Math.min(min[i%3],v);max[i%3]=Math.max(max[i%3],v);});
 report.models[kind]={label,width:max[0]-min[0],height:max[1]-min[1],depth:max[2]-min[2],floorHeight:step,floors:floors+1,triangles:ids.length/3,parts,drawsPerBatch:1,bounds:{min,max}};
}
build('grand-residence','石材陽台住宅',9,3.2,'#faf3df','#d7e4df',true);
build('civic-tower','香檳金玻璃辦公樓',12,3.3,'#f6f2e5','#d6dfe4');
build('harbor-tower','深藍玻璃商務塔樓',15,3.3,'#edeff0','#adc5d0');
const path=`${out}/premium-towers.glb`;await new NodeIO().write(path,doc);const bytes=await readFile(path);report.bytes=bytes.length;report.sha256=createHash('sha256').update(bytes).digest('hex');await writeFile(`${out}/premium-towers.integrity.json`,JSON.stringify(report,null,2)+'\n');console.log(report);
