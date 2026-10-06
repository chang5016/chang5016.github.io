import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
export async function readModelHierarchy(path) {
  // Geometry fixtures do not reinterpret optional PBR shader extensions.
  // GLTFLoader handles those in the game; the uncompressed buffers read here
  // are complete without the offline-authoring extension package.
  const document=await new NodeIO().read(path),materials=new Map();
  const visit=node=>{
    const group=new THREE.Group();group.name=node.getName();group.userData={...node.getExtras()};
    group.position.fromArray(node.getTranslation());group.quaternion.fromArray(node.getRotation());group.scale.fromArray(node.getScale());
    for(const primitive of node.getMesh()?.listPrimitives()??[]) {
      const geometry=new THREE.BufferGeometry();
      for(const [semantic,name] of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv']]){const a=primitive.getAttribute(semantic);if(a)geometry.setAttribute(name,new THREE.BufferAttribute(a.getArray().slice(),a.getElementSize()));}
      if(primitive.getIndices())geometry.setIndex(new THREE.BufferAttribute(primitive.getIndices().getArray().slice(),1));
      const source=primitive.getMaterial();
      if(!materials.has(source)){const m=new THREE.MeshStandardMaterial();if(source){m.name=source.getName();m.color.fromArray(source.getBaseColorFactor());m.roughness=source.getRoughnessFactor();m.metalness=source.getMetallicFactor();m.emissive.fromArray(source.getEmissiveFactor());}materials.set(source,m);}
      const mesh=new THREE.Mesh(geometry,materials.get(source));mesh.name=node.getName()+'_mesh';mesh.userData={...node.getExtras()};group.add(mesh);
    }
    for(const child of node.listChildren())group.add(visit(child));return group;
  };
  const group=new THREE.Group();for(const node of document.getRoot().listScenes()[0].listChildren())group.add(visit(node));group.updateMatrixWorld(true);
  return{document,group};
}
export async function readModelGeometry(path) {
  const document=await new NodeIO().read(path),group=new THREE.Group(),materials=new Map();
  for(const node of document.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
    const geometry=new THREE.BufferGeometry();
    for(const [semantic,name] of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv'],['COLOR_0','color']]){const a=primitive.getAttribute(semantic);if(a)geometry.setAttribute(name,new THREE.BufferAttribute(a.getArray().slice(),a.getElementSize()));}
    const index=primitive.getIndices();if(index)geometry.setIndex(new THREE.BufferAttribute(index.getArray().slice(),1));
    const source=primitive.getMaterial();if(!materials.has(source))materials.set(source,new THREE.MeshStandardMaterial());
    const mesh=new THREE.Mesh(geometry,materials.get(source));mesh.name=node.getName();mesh.matrix.fromArray(node.getWorldMatrix());mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);group.add(mesh);
  }
  return {document,group};
}
