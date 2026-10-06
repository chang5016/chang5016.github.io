import * as THREE from "three";
type SeatedPose={position:THREE.Vector3;scale:THREE.Vector3;rotation:THREE.Quaternion;bones:Map<string,{rotation:THREE.Quaternion;scale:THREE.Vector3}>};
const seatedPoses=new Map<string,SeatedPose>();

/** Fit a cloned skeleton to the scooter seat and hand/foot contact points. */
export function fitScooterRider(animal: THREE.Object3D,contacts?:{hip:THREE.Vector3;hand:(side:number)=>THREE.Vector3;foot:(side:number)=>THREE.Vector3;riderHeight?:number;spineDirection?:THREE.Vector3}) {
  const find = (name: string) => animal.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)) as THREE.Bone | undefined;
  const hips = find("Hips"), shoulders = find("Shoulders");
  if (!hips || !shoulders || !animal.parent) return;
  const parent = animal.parent;
  parent.updateWorldMatrix(true, true);
  let source:string|undefined;animal.traverse(object=>{source??=object.userData.downloadedSource?.sha256;});
  const up=new THREE.Vector3(0,1,0).applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
  const values=(v:THREE.Vector3)=>v.toArray().map(n=>Math.round(n*1e6)/1e6);
  const key=source&&contacts?.riderHeight?JSON.stringify([source,values(animal.scale),values(animal.position),animal.quaternion.toArray(),values(up),values(parent.getWorldScale(new THREE.Vector3())),values(contacts.hip),[-1,1].map(s=>values(contacts.hand(s))),[-1,1].map(s=>values(contacts.foot(s))),contacts.riderHeight,contacts.spineDirection?.toArray()]):undefined;
  const finish=()=>{
    parent.updateMatrixWorld(true);
    animal.traverse(object=>{const mesh=object as THREE.SkinnedMesh;if(mesh.isSkinnedMesh){mesh.skeleton.update();mesh.computeBoundingBox();mesh.computeBoundingSphere();}});
    animal.userData.ridingContactPose=true;animal.userData.seatedHeight=contacts?.riderHeight;
  };
  const cached=key?seatedPoses.get(key):undefined;
  if(cached){
    animal.position.copy(cached.position);animal.scale.copy(cached.scale);animal.quaternion.copy(cached.rotation);
    animal.traverse(object=>{if(!(object as THREE.Bone).isBone)return;const pose=cached.bones.get(object.name);if(pose){object.quaternion.copy(pose.rotation);object.scale.copy(pose.scale);}});
    finish();return;
  }
  const local = (bone: THREE.Object3D) => parent.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  const spine = local(shoulders).sub(local(hips));
  animal.scale.multiplyScalar(0.45 / Math.max(spine.length(), 0.01));
  const axis = spine.normalize();
  animal.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(axis, (contacts?.spineDirection?.clone()??new THREE.Vector3(0, 0.75, -0.65)).normalize()));
  parent.updateWorldMatrix(true, true);
  animal.position.add((contacts?.hip.clone()??new THREE.Vector3(0, 0.86, 0.05)).sub(local(hips)));
  parent.updateWorldMatrix(true, true);
  // The long-eared source rabbit leans its ears back while riding, allowing
  // its head/body to retain the capybara's scale instead of shrinking its torso.
  for(const name of ['LongEarA','LongEarB']){
    const ear=find(name),tip=find(name+'_end');if(!ear||!tip)continue;
    const from=tip.getWorldPosition(new THREE.Vector3()).sub(ear.getWorldPosition(new THREE.Vector3())).normalize();
    const to=new THREE.Vector3(Math.sign(from.x)*.10,.55,.83).normalize().applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()));
    const rotation=ear.parent!.getWorldQuaternion(new THREE.Quaternion()),delta=new THREE.Quaternion().setFromUnitVectors(from,to);
    ear.quaternion.premultiply(rotation.clone().invert().multiply(delta).multiply(rotation));ear.updateWorldMatrix(false,true);
  }
  const solve = (prefix: string, side: string, target: THREE.Vector3) => {
    const upper = find(`${prefix}UpLeg.${side}`), lower = find(`${prefix}LowLeg.${side}`), root = find(`${prefix}Leg.${side}`);
    const tip = find(`${prefix}LowLeg.${side}_end`);
    if (!upper || !lower || !tip) return;
    const worldTarget = parent.localToWorld(target.clone());
    if(contacts?.riderHeight){
      const chain=root?[root,upper,lower,tip]:[upper,lower,tip];
      const points=chain.map(joint=>joint.getWorldPosition(new THREE.Vector3()));
      const reach=points.slice(1).reduce((sum,p,i)=>sum+p.distanceTo(points[i]),0),distance=points[0].distanceTo(worldTarget);
      // Retarget short source forearms/shins to the capybara-sized contact
      // layout. Only bone length changes; the downloaded surface stays intact.
      if(distance>reach-.005){const lowerLength=points.at(-1)!.distanceTo(points.at(-2)!);lower.scale.y*=1+(distance-reach+.01)/Math.max(.001,lowerLength);lower.updateWorldMatrix(false,true);}
    }
    for (let i = 0; i < 36; i++) {
      for (const joint of root ? [lower, upper, root] : [lower, upper]) {
        const origin = joint.getWorldPosition(new THREE.Vector3());
        const from = tip.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
        const to = worldTarget.clone().sub(origin).normalize();
        const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
        const rotation = joint.parent!.getWorldQuaternion(new THREE.Quaternion());
        joint.quaternion.premultiply(rotation.clone().invert().multiply(delta).multiply(rotation));
        joint.updateWorldMatrix(false, true);
      }
    }
  };
  const sit=()=>{for (const [side, sign] of [["L", 1], ["R", -1]] as const) {
    solve("Front", side, contacts?.hand(sign)??new THREE.Vector3(sign * 0.27, 1.08, -0.5));
    solve("Back", side, contacts?.foot(sign)??new THREE.Vector3(sign * 0.24, 0.4, 0.05));
  }};
  sit();
  if(contacts?.riderHeight)for(let pass=0;pass<6;pass++) {
    parent.updateMatrixWorld(true);
    animal.traverse(object=>{const mesh=object as THREE.SkinnedMesh;if(mesh.isSkinnedMesh)mesh.skeleton.update();});
    // Compare posed anatomy with the original capybara's seat-to-crown size,
    // rather than the quadruped's standing height or its differently sized legs.
    const bounds=new THREE.Box3().setFromObject(animal,true),hip=hips.getWorldPosition(new THREE.Vector3());
    const worldScale=parent.getWorldScale(new THREE.Vector3()).y;
    animal.scale.multiplyScalar(contacts.riderHeight*worldScale/Math.max(.01,bounds.max.y-hip.y));
    parent.updateWorldMatrix(true,true);animal.position.add(contacts.hip.clone().sub(local(hips)));parent.updateWorldMatrix(true,true);sit();
  }
  finish();
  if(key){
    const bones:SeatedPose['bones']=new Map();animal.traverse(object=>{if((object as THREE.Bone).isBone)bones.set(object.name,{rotation:object.quaternion.clone(),scale:object.scale.clone()});});
    if(seatedPoses.size>=32)seatedPoses.delete(seatedPoses.keys().next().value!);
    seatedPoses.set(key,{position:animal.position.clone(),scale:animal.scale.clone(),rotation:animal.quaternion.clone(),bones});
  }
}
