import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Structural envelope around the existing single 16 m carriageway. No second deck. */
export function createRiverLandmark(ground: number) {
  const group=new THREE.Group();group.name='Twin pearl arches over the continuous river boulevard';
  const ribs:THREE.BufferGeometry[]=[], rods:THREE.BufferGeometry[]=[], details:THREE.BufferGeometry[]=[];
  const beam=(a:THREE.Vector3,b:THREE.Vector3,r:number,list:THREE.BufferGeometry[])=>{
    const g=new THREE.CylinderGeometry(r,r,a.distanceTo(b),8);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));
    const c=a.clone().add(b).multiplyScalar(.5);g.translate(c.x,c.y,c.z);list.push(g);
  };
  const deck=ground+5.78;
  for(const side of [-1,1]) {
    const z=-300+side*9.25;
    const points=Array.from({length:81},(_,i)=>new THREE.Vector3(475+i/80*290,deck+.1+32*Math.sin(Math.PI*i/80),z));
    ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),128,.58,10,false));
    for(let i=1;i<29;i++) {
      const x=475+i*10, height=32*Math.sin(Math.PI*i/29);
      beam(new THREE.Vector3(x,deck,z),new THREE.Vector3(x,deck+.1+height,z),.06,rods);
      beam(new THREE.Vector3(x,deck-.25,-300+side*7.75),new THREE.Vector3(x,deck-.25,z),.16,ribs);
    }
    beam(new THREE.Vector3(475,deck+1,z),new THREE.Vector3(765,deck+1,z),.045,details);
    for(const x of [475,765]) {
      const g=new THREE.BoxGeometry(5,deck-ground+1,3.2);g.translate(x,ground+(deck-ground-1)/2,z);ribs.push(g);
    }
  }
  // High cross-bracing stays well above all traffic, away from the travel lanes.
  for(const t of [.25,.5,.75]) {
    const y=deck+.1+32*Math.sin(Math.PI*t),x=475+t*290;
    beam(new THREE.Vector3(x,y,-309.25),new THREE.Vector3(x,y,-290.75),.18,rods);
  }
  const finishes=[new THREE.MeshStandardMaterial({color:'#e4dfd1',metalness:.45,roughness:.36}),new THREE.MeshStandardMaterial({color:'#78858a',metalness:.8,roughness:.3}),new THREE.MeshStandardMaterial({color:'#ffe7ba',emissive:'#ffcb81',emissiveIntensity:1.6})];
  [ribs,rods,details].forEach((list,i)=>{const g=mergeGeometries(list,false);list.forEach(x=>x.dispose());if(g){const mesh=new THREE.Mesh(g,finishes[i]);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}});
  return group;
}
