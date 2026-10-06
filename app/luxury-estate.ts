import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
export type EstateMaterials={stone:THREE.Material;dark:THREE.Material;wood:THREE.Material;glass:THREE.Material;lawn:THREE.Material;water:THREE.Material;glow:THREE.Material};
/** A planned 76×62m estate around an intact architect-authored residence. */
export function createLuxuryEstate(residence:THREE.Object3D,materials:EstateMaterials) {
  const root=new THREE.Group();root.name='Grand mountain residence · complete architect model and landscaped estate';
  root.userData.parcelWidth=76;root.userData.parcelDepth=62;root.userData.completeResidence=true;
  const parts=new Map<THREE.Material,THREE.BufferGeometry[]>();
  const add=(geometry:THREE.BufferGeometry,material:THREE.Material)=>{const list=parts.get(material)??[];list.push(geometry);parts.set(material,list);};
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,material:THREE.Material)=>{
    const g=new THREE.BoxGeometry(w,h,d),p=g.getAttribute('position'),n=g.getAttribute('normal'),uv=g.getAttribute('uv');
    for(let i=0;i<p.count;i++) {
      const ax=Math.abs(n.getX(i)),ay=Math.abs(n.getY(i));
      uv.setXY(i,(ax>.5?p.getZ(i):p.getX(i))/2,(ay>.5?p.getZ(i):p.getY(i))/2);
    }
    g.translate(x,y,z);add(g,material);
  };
  // Terraced podium: the pool is a real recess, not water laid on an uncut floor.
  box(-16,-.17,-23,44,.34,16,materials.stone);
  box(34,-.17,-23,8,.34,16,materials.stone);
  box(0,-.17,8,76,.34,46,materials.stone);
  box(18,-.17,-30,24,.34,2,materials.stone);
  box(18,-.17,-15.5,24,.34,1,materials.stone);
  residence.position.set(0,.02,11.4);residence.scale.setScalar(1.35);residence.name='Intact Zigurat architectural luxury residence';root.add(residence);
  // Reception court and continuous entry lane, with intentional joints and drain channels.
  box(0,.006,-19,8.8,.012,24,materials.dark);
  box(0,.014,-7,15,.028,16,materials.dark);
  for(const x of [-5,5])box(x,.025,-23,.12,.05,16,materials.dark);
  for(const x of [-9,9])box(x,.1,-9,.38,.2,4,materials.stone);
  // The complete downloaded 28.5 x 35.3 m mansion owns all architectural volumes.
  // Side gardens remain open and landscaped instead of attaching unrelated box pavilions.
  for(const x of [-25,25])box(x,.055,10,14,.11,31,materials.lawn);
  // 24m infinity pool with submerged tiled floor, coping, and descending entry steps.
  box(18,-1.44,-22,24,.18,12,materials.stone);
  for(const x of [5.85,30.15])box(x,-.69,-22,.3,1.42,12.6,materials.stone);
  for(const z of [-28.15,-15.85])box(18,-.69,z,24.6,1.42,.3,materials.stone);
  for(const x of [5.7,30.3])box(x,.03,-22,.65,.12,13,materials.stone);
  for(const z of [-28.3,-15.7])box(18,.03,z,25.3,.12,.65,materials.stone);
  for(let i=0;i<4;i++)box(8.2,-.26-i*.24,-17.2-i*.65,3.5,.22,.75,materials.stone);
  const water=new THREE.Mesh(new THREE.PlaneGeometry(23.7,11.7),materials.water);water.rotation.x=-Math.PI/2;water.position.set(18,-.14,-22);water.name='Recessed infinity-pool water and visible submerged basin';root.add(water);
  // Boundary walls and an actual ten-metre entrance opening.
  for(const x of [-37.6,37.6])box(x,.75,0,.5,1.6,62,materials.stone);
  box(0,.75,30.6,76,1.6,.5,materials.stone);
  for(const x of [-21.5,21.5])box(x,.75,-30.6,32.4,1.6,.5,materials.stone);
  for(const x of [-5.3,5.3]) {
    box(x,1.35,-30.7,.65,2.8,.8,materials.dark);
    box(x,1.7,-31.15,.16,.8,.025,materials.glow);
  }
  // Set-back planting beds, not vegetation intersecting the drive or pool.
  for(const x of [-35,35])box(x,.08,6,3,.16,38,materials.lawn);
  box(-21,.08,-22,22,.16,11,materials.lawn);
  for(const [material,geometries] of parts) {
    const geometry=mergeGeometries(geometries,false);for(const g of geometries)g.dispose();
    if(!geometry)continue;geometry.computeBoundingSphere();const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='Metric-UV coordinated estate architecture';root.add(mesh);
  }
  return root;
}
