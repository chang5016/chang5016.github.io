import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
type EstateMaterials={stone:THREE.Material;dark:THREE.Material;wood:THREE.Material;glass:THREE.Material;lawn:THREE.Material;water:THREE.Material;glow:THREE.Material};
/** A terraced, landscaped parcel around a complete downloaded architectural residence. */
export function createHillsideEstate(m:EstateMaterials,groundAt:(x:number,z:number)=>number){
  const root=new THREE.Group();root.name='Planned terraced parcel / intact downloaded villa';
  const residence=new THREE.Group();residence.name='Intact architectural villa';residence.position.set(0,.025,3.65);residence.scale.setScalar(.76);root.add(residence);root.userData.residence=residence;
  const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material)=>{
    const g=new THREE.BoxGeometry(w,h,d),p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
    for(let i=0;i<p.count;i++)uv.setXY(i,(Math.abs(n.getX(i))>.5?p.getZ(i)+z:p.getX(i)+x)/2,(Math.abs(n.getY(i))>.5?p.getZ(i)+z:p.getY(i)+y)/2);
    g.translate(x,y,z);const list=batches.get(material)??[];list.push(g);batches.set(material,list);
  };
  // One level foundation, with a genuine recess for a pool outside the original house footprint.
  box(-5.5,-.22,0,23,.44,30,m.stone);box(14.5,-.22,0,5,.44,30,m.stone);
  box(10,-.22,4.75,6,.44,20.5,m.stone);box(10,-.22,-14.25,6,.44,1.5,m.stone);
  box(10,-1.35,-10.4,8,.18,5.2,m.stone);
  for(const x of[5.9,14.1])box(x,-.65,-10.4,.25,1.45,5.7,m.stone);
  for(const z of[-13.05,-7.75])box(10,-.65,z,8.45,1.45,.25,m.stone);
  box(10,-.16,-10.4,7.7,.025,5.0,m.water);
  for(const x of[5.85,14.15])box(x,.045,-10.4,.55,.09,5.8,m.stone);
  for(const z of[-13.1,-7.7])box(10,.045,z,8.6,.09,.55,m.stone);
  box(0,.01,-10.55,8.8,.02,8.9,m.dark);
  for(const x of[-16.4,16.4])box(x,.70,0,.35,1.4,30,m.stone);
  box(0,.70,14.6,32.8,1.4,.35,m.stone);
  for(const x of[-11,11])box(x,.7,-14.6,10.8,1.4,.35,m.stone);
  for(const x of[-5.6,5.6]){box(x,1.2,-14.6,.55,2.4,.7,m.stone);box(x,1.3,-15,.12,.6,.05,m.glow);}
  for(const x of[-14.5,14.5])box(x,.04,4.5,2.4,.08,17,m.lawn);
  box(-11,.04,-10.5,7,.08,7,m.lawn);
  // Cut/fill retaining walls and individually terrain-seated supports belong to the plot.
  for(const x of[-16.3,16.3])for(let z=-13;z<=13;z+=2){const bottom=Math.min(-.5,groundAt(x,z)-.2);box(x,(bottom-.22)/2,z,.6,-.22-bottom,2.04,m.stone);}
  for(const x of[-12,0,12])for(const z of[-12,0,12]){const bottom=Math.min(-.5,groundAt(x,z)-.25);box(x,(bottom-.3)/2,z,.75,-.3-bottom,.75,m.stone);box(x,bottom+.1,z,1.4,.2,1.4,m.stone);}
  for(const[material,parts]of batches){const g=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());if(g){const mesh=new THREE.Mesh(g,material);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);}}
  root.userData.completeDownloadedResidence=true;return root;
}
