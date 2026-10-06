import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {NodeIO} from '@gltf-transform/core';
import {TRAFFIC_MOTORCYCLE_SCALE} from '../app/vehicle-scale.ts';
globalThis.ProgressEvent??=class{constructor(type,data){Object.assign(this,data);}};
const dir=new URL('../.sites-runtime/motorcycle-rider/',import.meta.url).pathname;
await fs.mkdir(dir,{recursive:true});
const definitions={rabbit:{file:'Platformer_Bunny.gltf',hip:'Hips',spine:'Neck',arm:s=>[`UpperArm.${s}`,`LowerArm.${s}`,`Fist.${s}`],leg:s=>[`UpperLeg.${s}`,`LowerLeg.${s}`,`Foot.${s}`]},bear:{file:'Cubed_Bear.glb',hip:'Tailbone',spine:'Chest',arm:s=>[`Arm.${s}`,`Forearm.${s}`,`Forearm.${s}_end`],leg:s=>[`UpperLeg.${s}`,`LowerLeg.${s}`,`Foot.${s}`]}};
function node(object,name){const found=object.getObjectByName(T.PropertyBinding.sanitizeNodeName(name));if(!found)throw Error('Missing '+name);return found;}
function update(root){root.updateMatrixWorld(true);root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});}
function rotateDirection(joint,from,to){
 const worldParent=joint.parent.getWorldQuaternion(new T.Quaternion());
 const delta=new T.Quaternion().setFromUnitVectors(from.clone().normalize(),to.clone().normalize());
 joint.quaternion.premultiply(worldParent.clone().invert().multiply(delta).multiply(worldParent));joint.updateWorldMatrix(false,true);
}
function solve(upper,lower,tip,target,pole){
 const a=upper.getWorldPosition(new T.Vector3()),b=lower.getWorldPosition(new T.Vector3()),c=tip.getWorldPosition(new T.Vector3());
 const first=a.distanceTo(b),second=b.distanceTo(c),direction=target.clone().sub(a),distance=direction.length();direction.normalize();
 const reach=Math.min(first+second-1e-7,Math.max(Math.abs(first-second)+1e-7,distance));
 const along=(first*first-second*second+reach*reach)/(2*reach),rise=Math.sqrt(Math.max(0,first*first-along*along));
 const outward=pole.clone().sub(a);outward.addScaledVector(direction,-outward.dot(direction)).normalize();
 const elbow=a.clone().addScaledVector(direction,along).addScaledVector(outward,rise);
 rotateDirection(upper,b.clone().sub(a),elbow.sub(a));
 const pivot=lower.getWorldPosition(new T.Vector3()),end=tip.getWorldPosition(new T.Vector3());
 rotateDirection(lower,end.sub(pivot),target.clone().sub(pivot));
 return tip.getWorldPosition(new T.Vector3()).distanceTo(target);
}
function fit(template,def,lean,seatZ){
 const actor=clone(template),parent=new T.Group();parent.scale.setScalar(TRAFFIC_MOTORCYCLE_SCALE);parent.add(actor);actor.rotation.y=Math.PI;update(parent);
 const hip=node(actor,def.hip),spine=node(actor,def.spine),head=node(actor,'Head');
 const uprightHead=head.getWorldQuaternion(new T.Quaternion());
 const footOrientations=['L','R'].map(s=>node(actor,`Foot.${s}`).getWorldQuaternion(new T.Quaternion()));
 const from=spine.getWorldPosition(new T.Vector3()).sub(hip.getWorldPosition(new T.Vector3())).normalize();
 actor.quaternion.premultiply(new T.Quaternion().setFromUnitVectors(from,new T.Vector3(0,1,-lean).normalize()));update(parent);
 const currentHead=head.getWorldQuaternion(new T.Quaternion()).slerp(uprightHead,.85);
 head.quaternion.copy(head.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(currentHead));update(parent);
 for(const side of ['L','R']){
  const ear=actor.getObjectByName(T.PropertyBinding.sanitizeNodeName(`Ear1.${side}`)),next=actor.getObjectByName(T.PropertyBinding.sanitizeNodeName(`Ear2.${side}`));
  if(ear&&next)rotateDirection(ear,next.getWorldPosition(new T.Vector3()).sub(ear.getWorldPosition(new T.Vector3())),new T.Vector3(side==='L'?.08:-.08,.50,.86));
 }
 update(parent);
 const limbs=['L','R'].map((side,i)=>{
  const sign=i===0?-1:1,arm=def.arm(side).map(n=>node(actor,n)),[upper,lower,foot]=def.leg(side).map(n=>node(actor,n));
  let tip=foot,independent=foot.parent!==lower;
  if(independent){tip=new T.Object3D();tip.position.copy(lower.worldToLocal(foot.getWorldPosition(new T.Vector3())));lower.add(tip);}
  return{sign,arm,leg:[upper,lower,tip],foot,independent,footOrientation:footOrientations[i]};
 });
 const hipTarget=new T.Vector3(0,.84,seatZ);
 for(let pass=0;pass<8;pass++){
  update(parent);const box=new T.Box3().setFromObject(actor,true),height=box.max.y-hip.getWorldPosition(new T.Vector3()).y;
  actor.scale.multiplyScalar(1.52/height);update(parent);
  actor.position.add(hipTarget.clone().sub(parent.worldToLocal(hip.getWorldPosition(new T.Vector3()))));update(parent);
  for(const limb of limbs){
   const hand=parent.localToWorld(new T.Vector3(limb.sign*.31,.96,-.43));
   const foot=parent.localToWorld(new T.Vector3(limb.sign*.24,.43,.14));
   solve(...limb.arm,hand,parent.localToWorld(new T.Vector3(limb.sign*.72,.69,-.12)));
   solve(...limb.leg,foot,parent.localToWorld(new T.Vector3(limb.sign*.42,.84,-.55)));
   if(limb.independent)limb.foot.position.copy(limb.foot.parent.worldToLocal(foot.clone()));
   limb.foot.quaternion.copy(limb.foot.parent.getWorldQuaternion(new T.Quaternion()).invert().multiply(limb.footOrientation));
  }
 }
 update(parent);
 const errors=limbs.flatMap(l=>[l.arm[2].getWorldPosition(new T.Vector3()).distanceTo(parent.localToWorld(new T.Vector3(l.sign*.31,.96,-.43))),l.leg[2].getWorldPosition(new T.Vector3()).distanceTo(parent.localToWorld(new T.Vector3(l.sign*.24,.43,.14)))]);
 let largestScale=1;actor.traverse(o=>{if(o.isBone)largestScale=Math.max(largestScale,o.scale.x,o.scale.y,o.scale.z);});
 const box=new T.Box3().setFromObject(actor,true),height=box.max.y-hip.getWorldPosition(new T.Vector3()).y;
 return{actor,parent,metrics:{lean,seatZ,contactErrors:errors,maxContactError:Math.max(...errors),largestBoneScale:largestScale,seatToCrown:height,size:box.getSize(new T.Vector3()).toArray()}};
}
for(const kind of process.argv.slice(2).length?process.argv.slice(2):['bear']){
 const def=definitions[kind],bytes=await fs.readFile(dir+'/'+def.file);let data;
 if(def.file.endsWith('.glb')){const length=bytes.readUInt32LE(12);data=JSON.parse(bytes.toString('utf8',20,20+length));data.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+length).toString('base64');}else data=JSON.parse(bytes.toString());
 delete data.images;delete data.textures;delete data.materials;for(const m of data.meshes)for(const p of m.primitives)delete p.material;
 const parsed=await new GLTFLoader().parseAsync(JSON.stringify(data),'');parsed.scene.traverse(o=>{const a=parsed.parser.associations.get(o);if(a?.nodes!==undefined)o.userData.sourceNodeIndex=a.nodes;});
 let best;
 for(const lean of [.14,.25,.40,.55,.70])for(const seatZ of [-.12,-.08,-.04,0,.04,.08,.12,.16]){
  const candidate=fit(parsed.scene,def,lean,seatZ);
  const cost=Math.max(0,candidate.metrics.maxContactError-.005)*100+lean*.015+Math.abs(seatZ-.04)*.001;
  if(!best||cost<best.cost)best={...candidate,cost};
 }
 console.log(kind,JSON.stringify(best.metrics));
 if(best.metrics.maxContactError>.006||best.metrics.largestBoneScale>1.00005||Math.abs(best.metrics.seatToCrown-1.52)>.01)throw Error('Rider proportion/contact gate failed: '+kind);
 const io=new NodeIO(),document=await io.read(dir+'/'+def.file),nodes=document.getRoot().listNodes();
 best.actor.traverse(o=>{const i=o.userData.sourceNodeIndex;if(i===undefined)return;const n=nodes[i];n.setTranslation(o.position.toArray());n.setRotation(o.quaternion.toArray());n.setScale(o.scale.toArray());});
 for(const animation of document.getRoot().listAnimations())animation.dispose();
 const scene=document.getRoot().listScenes()[0],wrapper=document.createNode('Motorcycle riding pose').setTranslation(best.actor.position.toArray()).setRotation(best.actor.quaternion.toArray()).setScale(best.actor.scale.toArray());
 for(const child of [...scene.listChildren()]){scene.removeChild(child);wrapper.addChild(child);}scene.addChild(wrapper);
 wrapper.setExtras({motorcycleRider:{kind,sourceSha256:createHash('sha256').update(bytes).digest('hex'),bodyHeight:1.52,metrics:best.metrics,boneLengthsPreserved:true}});
 await io.write(dir+'/'+kind+'-riding.glb',document);
 const exported=await fs.readFile(dir+'/'+kind+'-riding.glb');
 const publicDirectory=new URL('../public/models/motorcycle-rider/',import.meta.url);
 await fs.writeFile(new URL('bear-riding.glb',publicDirectory),exported);
 const metadata=JSON.parse(await fs.readFile(new URL('sources.json',publicDirectory),'utf8'));
 metadata.sha256=createHash('sha256').update(exported).digest('hex');metadata.bytes=exported.length;
 metadata.vertices=document.getRoot().listMeshes().reduce((sum,mesh)=>sum+mesh.listPrimitives().reduce((sum,p)=>sum+p.getAttribute('POSITION').getCount(),0),0);
 metadata.triangles=document.getRoot().listMeshes().reduce((sum,mesh)=>sum+mesh.listPrimitives().reduce((sum,p)=>sum+p.getIndices().getCount()/3,0),0);
 metadata.pose=best.metrics;
 await fs.writeFile(new URL('sources.json',publicDirectory),JSON.stringify(metadata,null,2)+'\n');
 await fs.writeFile(dir+'/'+kind+'-pose-audit.json',JSON.stringify(best.metrics,null,2)+'\n');
}
