import * as THREE from 'three';
import {clone} from 'three/addons/utils/SkeletonUtils.js';

export const MOTORCYCLE_RIDER_URL='/models/motorcycle-rider/bear-riding.glb?v=rounded-riding-limbs-2';

const riderGeometries=new WeakMap<THREE.BufferGeometry,THREE.BufferGeometry>();

function riderGeometry(source:THREE.BufferGeometry) {
  let geometry=riderGeometries.get(source);
  if(geometry)return geometry;
  geometry=source.clone();
  const indices=source.getAttribute('skinIndex');
  if(indices) {
    // glTF packs the byte-sized joints and normalized vertex colors into one
    // interleaved buffer. A WebGPU shadow pass promotes the joint buffer to
    // uint32, also changing its color view into the invalid unorm32x4 format.
    // Give joints their own native GPU buffer before the first shadow upload.
    // Preserve all authored vertices, colors, UVs, normals and skin weights.
    const joints=new Uint32Array(indices.count*indices.itemSize);
    for(let vertex=0;vertex<indices.count;vertex++)for(let component=0;component<indices.itemSize;component++)
      joints[vertex*indices.itemSize+component]=indices.getComponent(vertex,component);
    geometry.setAttribute('skinIndex',new THREE.Uint32BufferAttribute(joints,indices.itemSize));
  }
  riderGeometries.set(source,geometry);
  return geometry;
}

/** The downloaded biped is posed offline in the motorcycle's native coordinates.
 * Keep that pose and its uniform authoring scale; generic height fitting would
 * move the hands off the bars and require stretching the legs again. */
export function createMotorcycleRider(template:THREE.Object3D,index:number) {
  const model=clone(template),materials:THREE.Material[]=[];
  const tint=['#ffffff','#d5e6de','#e7d3be','#d2dcea'][index%4];
  const copies=new Map<THREE.Material,THREE.Material>();
  model.name='Downloaded rounded bear with native two-arm motorcycle riding rig';
  model.userData.dedicatedMotorcyclePose=true;
  model.traverse(object=>{
    const mesh=object as THREE.SkinnedMesh;if(!mesh.isMesh)return;
    if(mesh.isSkinnedMesh)mesh.geometry=riderGeometry(mesh.geometry);
    mesh.castShadow=mesh.receiveShadow=true;mesh.userData.sharedTrafficAsset=true;
    const material=(source:THREE.Material)=>{
      let copy=copies.get(source);
      if(!copy){copy=source.clone();copies.set(source,copy);materials.push(copy);
        if((copy as THREE.MeshStandardMaterial).isMeshStandardMaterial)(copy as THREE.MeshStandardMaterial).color.multiply(new THREE.Color(tint));
      }
      return copy;
    };
    mesh.material=Array.isArray(mesh.material)?mesh.material.map(material):material(mesh.material);
  });
  model.updateMatrixWorld(true);
  model.traverse(object=>{
    const mesh=object as THREE.SkinnedMesh;if(!mesh.isSkinnedMesh)return;
    mesh.skeleton.update();mesh.computeBoundingBox();mesh.computeBoundingSphere();
    if(mesh.boundingSphere)mesh.boundingSphere.radius+=.08;
  });
  return{model,materials};
}
