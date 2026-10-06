import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import type {BuildingBounds,Coordinates} from './game-core';
import {freezeStaticScene,invalidateShadowScene} from './static-scene';

// Separate street parcels, each with its own sidewalk-facing frontage.
export const SHOP_SITES=[
 {x:-710,z:-94,roadZ:-110,roadWidth:13.3,angle:0,kind:'mart'},
 {x:-545,z:-126,roadZ:-110,roadWidth:13.3,angle:Math.PI,kind:'coffee'},
 {x:-192,z:-94,roadZ:-110,roadWidth:13.3,angle:0,kind:'mart'},
 {x:177,z:-126,roadZ:-110,roadWidth:13.3,angle:Math.PI,kind:'coffee'},
 {x:401,z:104,roadZ:90,roadWidth:7.1,angle:0,kind:'mart'},
 {x:828,z:76,roadZ:90,roadWidth:7.1,angle:Math.PI,kind:'coffee'},
 {x:-704,z:286,roadZ:270,roadWidth:13.3,angle:0,kind:'mart'},
 {x:-304,z:254,roadZ:270,roadWidth:13.3,angle:Math.PI,kind:'coffee'},
 {x:167,z:286,roadZ:270,roadWidth:13.3,angle:0,kind:'mart'},
 {x:1006,z:476,roadZ:460,roadWidth:7.1,angle:0,kind:'coffee'},
 {x:-588,z:604,roadZ:620,roadWidth:13.3,angle:Math.PI,kind:'mart'},
 {x:402,z:636,roadZ:620,roadWidth:13.3,angle:0,kind:'coffee'},
];
export function shopBounds(site:typeof SHOP_SITES[number]):BuildingBounds {
 const halfDepth=site.kind==='mart'?4.412:5.187,halfWidth=site.kind==='mart'?7:5.2;
 return{x:site.x,z:site.z,halfWidth,halfDepth,outline:[{x:site.x-halfWidth,z:site.z-halfDepth},{x:site.x+halfWidth,z:site.z-halfDepth},{x:site.x+halfWidth,z:site.z+halfDepth},{x:site.x-halfWidth,z:site.z+halfDepth}]};
}
export const SHOP_RESERVATIONS=SHOP_SITES.map(site=>{const b=shopBounds(site),side=Math.sign(site.z-site.roadZ),sidewalk=site.roadZ+side*(site.roadWidth/2+2.6);return{left:site.x-b.halfWidth-.7,right:site.x+b.halfWidth+.7,back:side>0?sidewalk:site.z-b.halfDepth-.35,front:side>0?site.z+b.halfDepth+.35:sidewalk};});
const SHOP_GRADES=SHOP_SITES.map(site=>shopBounds(site));
export function shopParcelElevation(point:Coordinates,raw:number,design:(p:Coordinates)=>number){
 if(point.x<-722||point.x>1017||point.z<-136||point.z>646)return raw;
 for(const box of SHOP_GRADES){const dx=Math.max(0,Math.abs(point.x-box.x)-box.halfWidth-.35),dz=Math.max(0,Math.abs(point.z-box.z)-box.halfDepth-.35),distance=Math.hypot(dx,dz);if(distance>=3)continue;const t=distance/3,blend=t*t*(3-2*t);return design(box)*(1-blend)+raw*blend;}
 return raw;
}
export type AnimalPath={a:Coordinates;b:Coordinates;speed:number;phase:number};
export function planSidewalkAnimals(streets:{a:Coordinates;b:Coordinates;width:number}[],buildings:BuildingBounds[],blocked:(p:Coordinates)=>boolean=()=>false):AnimalPath[]{
 const paths:AnimalPath[]=[];
 const candidates=streets.filter(s=>s.width>=8&&Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z)>48&&Math.hypot((s.a.x+s.b.x)/2,(s.a.z+s.b.z)/2)<530).sort((a,b)=>Math.hypot((a.a.x+a.b.x)/2+150,(a.a.z+a.b.z)/2+110)-Math.hypot((b.a.x+b.b.x)/2+150,(b.a.z+b.b.z)/2+110));
 for(const s of candidates)for(const side of [-1,1]){
  const length=Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z),dx=(s.b.x-s.a.x)/length,dz=(s.b.z-s.a.z)/length,offset=side*(s.width/2+1.28);
  const a={x:s.a.x+dx*17-dz*offset,z:s.a.z+dz*17+dx*offset},b={x:s.b.x-dx*17-dz*offset,z:s.b.z-dz*17+dx*offset},span=length-34;
  let clear=true;for(let d=0;d<=span;d+=1.25){const p={x:a.x+dx*d,z:a.z+dz*d};if(blocked(p)||buildings.some(box=>Math.abs(p.x-box.x)<box.halfWidth+.65&&Math.abs(p.z-box.z)<box.halfDepth+.65)){clear=false;break;}}
  if(!clear||paths.some(p=>Math.hypot((p.a.x+p.b.x-a.x-b.x)/2,(p.a.z+p.b.z-a.z-b.z)/2)<22))continue;
  paths.push({a,b,speed:.65+paths.length%4*.065,phase:paths.length*.173%1});if(paths.length===14)return paths;
 }
 return paths;
}
type Walker={root:THREE.Group;mixer:THREE.AnimationMixer;walk:THREE.AnimationAction;idle:THREE.AnimationAction;path:AnimalPath;progress:number;direction:number;speed:number;pause:number;moving:boolean};
export class NeighborhoodLife {
 readonly root=new THREE.Group();readonly ready:Promise<void>;readonly walkers:Walker[]=[];
 private geometry=new Set<THREE.BufferGeometry>();private materials=new Set<THREE.Material>();private textures=new Set<THREE.Texture>();private disposed=false;
 constructor(private parent:THREE.Group,private ground:(p:Coordinates)=>number,private paths:AnimalPath[],private blocked:(p:Coordinates)=>boolean=()=>false){this.root.name='Complete PBR neighborhood shops and animated sidewalk animals';parent.add(this.root);this.ready=this.load();}
 private async load(){
  const loader=new GLTFLoader(),[one,two,fox]=await Promise.all(['mart-metric','coffee-metric','fox'].map(name=>loader.loadAsync(`/models/neighborhood/${name}.glb`)));
  const texturePool=new Map<string,Promise<THREE.Texture>>(),pending:Promise<unknown>[]=[];
  for(const asset of [one,two,fox])asset.scene.traverse(object=>{const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;this.geometry.add(mesh.geometry);mesh.castShadow=mesh.receiveShadow=true;for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
   this.materials.add(m);const pbr=m as THREE.MeshStandardMaterial;for(const v of Object.values(m))if(v instanceof THREE.Texture)this.textures.add(v);
   for(const [key,property]of [['map','map'],['normal','normalMap'],['roughness','roughnessMap']] as const){const url=m.userData[key] as string|undefined;if(!url)continue;if(!texturePool.has(url))texturePool.set(url,new THREE.TextureLoader().loadAsync(url).then(t=>{t.colorSpace=key==='map'?THREE.SRGBColorSpace:THREE.NoColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;this.textures.add(t);return t;}));pending.push(texturePool.get(url)!.then(t=>{pbr[property]=t;pbr.normalScale?.set(.07,.07);pbr.envMapIntensity=.65;pbr.needsUpdate=true;}));}
   if(pbr.transparent)pbr.depthWrite=false;
  }});
  await Promise.all(pending);if(this.disposed){this.releaseAssets();return;}
  for(const [kind,asset]of [['mart',one],['coffee',two]] as const){asset.scene.updateWorldMatrix(true,true);const sites=SHOP_SITES.filter(s=>s.kind===kind);asset.scene.traverse(object=>{const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;const instances=new THREE.InstancedMesh(mesh.geometry,mesh.material,sites.length);instances.name=`Complete closed ${kind} exterior / shared native component`;instances.castShadow=instances.receiveShadow=true;for(const [i,site]of sites.entries()){const matrix=new THREE.Matrix4().compose(new THREE.Vector3(site.x,this.ground(site)+.134,site.z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),site.angle),new THREE.Vector3(1,1,1)).multiply(mesh.matrixWorld);instances.setMatrixAt(i,matrix);}instances.computeBoundingBox();instances.computeBoundingSphere();this.root.add(instances);});}
  for(const [index,path]of this.paths.entries()){
   const root=new THREE.Group();root.name='Downloaded Fox / authored Walk and Survey animations';root.userData.dynamicWorldObject=true;const model=clone(fox.scene),bounds=new THREE.Box3().setFromObject(model),scale=(.64+index%3*.035)/(bounds.max.y-bounds.min.y);model.scale.setScalar(scale);model.position.y=-bounds.min.y*scale;root.add(model);this.root.add(root);
   const mixer=new THREE.AnimationMixer(model),walkClip=fox.animations.find(c=>c.name==='Walk'),idleClip=fox.animations.find(c=>c.name==='Survey');if(!walkClip||!idleClip)throw new Error('Missing source animal animations');
   const walk=mixer.clipAction(walkClip).play(),idle=mixer.clipAction(idleClip).play();idle.setEffectiveWeight(0);const span=Math.hypot(path.b.x-path.a.x,path.b.z-path.a.z),progress=path.phase*span;root.position.set(path.a.x+(path.b.x-path.a.x)*path.phase,0,path.a.z+(path.b.z-path.a.z)*path.phase);root.position.y=this.ground(root.position)+.135;root.rotation.y=Math.atan2(path.b.x-path.a.x,path.b.z-path.a.z);
   this.walkers.push({root,mixer,walk,idle,path,progress,direction:1,speed:path.speed,pause:0,moving:true});
  }
  this.root.userData.neighborhoodAudit={shops:SHOP_SITES.length,frontageMetres:[14,10.4],uniformScale:true,closedExteriors:true,walkers:this.walkers.length,authoredWalkAnimation:true};freezeStaticScene(this.root);invalidateShadowScene(this.parent,false);
 }
 update(dt:number,rider:Coordinates,camera:Coordinates){
  for(const w of this.walkers){const dx=w.path.b.x-w.path.a.x,dz=w.path.b.z-w.path.a.z,length=Math.hypot(dx,dz),near=Math.hypot(w.root.position.x-rider.x,w.root.position.z-rider.z)<1.8;
   w.pause=Math.max(0,w.pause-dt);const probe={x:w.root.position.x+dx/length*w.direction*.65,z:w.root.position.z+dz/length*w.direction*.65};const target=near||w.pause>0||this.blocked(probe)?0:w.path.speed;w.speed+=(target-w.speed)*(1-Math.exp(-5*dt));
   w.progress+=w.speed*w.direction*dt;if(w.progress>=length||w.progress<=0){w.progress=Math.max(0,Math.min(length,w.progress));w.direction*=-1;w.pause=2.4+w.path.phase*3;}
   w.root.position.set(w.path.a.x+dx*w.progress/length,0,w.path.a.z+dz*w.progress/length);w.root.position.y=this.ground(w.root.position)+.135;const heading=Math.atan2(dx*w.direction,dz*w.direction),delta=Math.atan2(Math.sin(heading-w.root.rotation.y),Math.cos(heading-w.root.rotation.y));w.root.rotation.y+=delta*(1-Math.exp(-6*dt));
   const moving=w.speed>.08;if(moving!==w.moving){(moving?w.idle:w.walk).fadeOut(.25);(moving?w.walk:w.idle).reset().setEffectiveWeight(1).fadeIn(.25).play();w.moving=moving;}w.walk.timeScale=w.speed/.72;if(Math.hypot(w.root.position.x-camera.x,w.root.position.z-camera.z)<500)w.mixer.update(dt);
  }
 }
 private releaseAssets(){for(const g of this.geometry)g.dispose();for(const m of this.materials)m.dispose();for(const t of this.textures)t.dispose();}
 dispose(){this.disposed=true;this.walkers.forEach(w=>w.mixer.stopAllAction());this.root.traverse(o=>{if((o as THREE.InstancedMesh).isInstancedMesh)(o as THREE.InstancedMesh).dispose();});this.root.removeFromParent();this.releaseAssets();}
}
