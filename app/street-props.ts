import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BuildingBounds, Coordinates } from './game-core';

export type StreetPropKind = 'bench' | 'hydrant' | 'planter';
export type StreetPropPlacement = Coordinates & { kind: StreetPropKind; angle: number; y: number };
type Street = { a: Coordinates; b: Coordinates; width: number };
type Occupied = Coordinates & { radius: number };
const dimensions = { bench: [1.45, .62], hydrant: [.28, .32], planter: [.84, .8] };

export function streetPropFootprint(prop: StreetPropPlacement, margin = 0, collision = false): BuildingBounds {
  const [width, depth] = collision && prop.kind === 'planter' ? [.504, .5] : dimensions[prop.kind];
  const c = Math.cos(prop.angle), s = Math.sin(prop.angle);
  const outline = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z]) => ({
    x: prop.x+c*x*(width/2+margin)+s*z*(depth/2+margin),
    z: prop.z-s*x*(width/2+margin)+c*z*(depth/2+margin),
  }));
  return { x: prop.x, z: prop.z, halfWidth: Math.max(...outline.map(p=>Math.abs(p.x-prop.x))), halfDepth: Math.max(...outline.map(p=>Math.abs(p.z-prop.z))), outline };
}

function segmentDistance(point: Coordinates, road: Street) {
  const dx=road.b.x-road.a.x, dz=road.b.z-road.a.z, square=dx*dx+dz*dz;
  const t=square ? Math.max(0,Math.min(1,((point.x-road.a.x)*dx+(point.z-road.a.z)*dz)/square)) : 0;
  return Math.hypot(point.x-road.a.x-dx*t,point.z-road.a.z-dz*t);
}

export function streetPropFits(prop: StreetPropPlacement, streets: Street[], buildings: BuildingBounds[], occupied: Occupied[], placed: StreetPropPlacement[], ground: (point: Coordinates)=>number, blocked: (point: Coordinates)=>boolean) {
  const box=streetPropFootprint(prop,.07), points=[prop,...box.outline!];
  if (points.some(blocked)) return false;
  if (points.some(point=>streets.some(road=>segmentDistance(point,road)<road.width/2+.12))) return false;
  if (buildings.some(b=>Math.abs(b.x-box.x)<b.halfWidth+box.halfWidth+.15 && Math.abs(b.z-box.z)<b.halfDepth+box.halfDepth+.15)) return false;
  const radius=Math.hypot(box.halfWidth,box.halfDepth);
  if (occupied.some(other=>Math.hypot(prop.x-other.x,prop.z-other.z)<radius+other.radius+.18)) return false;
  if (placed.some(other=>{
    const b=streetPropFootprint(other,.12);
    return Math.abs(b.x-box.x)<b.halfWidth+box.halfWidth && Math.abs(b.z-box.z)<b.halfDepth+box.halfDepth;
  })) return false;
  const heights=points.map(ground);
  return Math.max(...heights)-Math.min(...heights)<.045;
}

/** Furnishing strip beside the curb, with open pedestrian space and paired shop plants. */
export function planStreetProps(streets: Street[], buildings: BuildingBounds[], occupied: Occupied[], ground: (point: Coordinates)=>number, blocked: (point: Coordinates)=>boolean) {
  const placed: StreetPropPlacement[]=[], counts={bench:0,hydrant:0,planter:0};
  const candidates=streets.filter(s=>s.width>=8 && Math.hypot(s.b.x-s.a.x,s.b.z-s.a.z)>28)
    .sort((a,b)=>Math.hypot((a.a.x+a.b.x)/2,(a.a.z+a.b.z)/2)-Math.hypot((b.a.x+b.b.x)/2,(b.a.z+b.b.z)/2));
  const add=(prop:StreetPropPlacement)=>{
    const spacing=prop.kind==='planter'?2.2:24;
    if(placed.some(p=>p.kind===prop.kind&&Math.hypot(p.x-prop.x,p.z-prop.z)<spacing))return false;
    if(!streetPropFits(prop,streets,buildings,occupied,placed,ground,blocked))return false;
    placed.push(prop);counts[prop.kind]++;return true;
  };
  for(const street of candidates){
    const dx=street.b.x-street.a.x,dz=street.b.z-street.a.z,length=Math.hypot(dx,dz),tx=dx/length,tz=dz/length;
    for(const fraction of [.4,.64,.24,.8])for(const side of [-1,1]){
      const nx=-tz*side,nz=tx*side;
      const x=street.a.x+dx*fraction+nx*(street.width/2+.57),z=street.a.z+dz*fraction+nz*(street.width/2+.57);
      if(Math.hypot(x,z)>1000 || Math.min(fraction,1-fraction)*length<8)continue;
      const base={x,z,angle:Math.atan2(-nx,-nz),y:.135};
      if(counts.bench<36)add({...base,kind:'bench'});
      if(counts.hydrant<24)add({...base,x:x-tx*5.4,z:z-tz*5.4,kind:'hydrant'});
      // Only place a pair where a real building frontage faces this pavement.
      const frontage=buildings.some(b=>{
        const vx=b.x-x,vz=b.z-z,normal=vx*nx+vz*nz,along=Math.abs(vx*tx+vz*tz);
        const facadeHalfWidth=Math.abs(tx)*b.halfWidth+Math.abs(tz)*b.halfDepth;
        const facadeDepth=Math.abs(nx)*b.halfWidth+Math.abs(nz)*b.halfDepth;
        return normal>facadeDepth && normal<facadeDepth+12 && along<facadeHalfWidth-1;
      });
      if(frontage&&counts.planter<24){
        const pair=[-2.1,2.1].map(offset=>({...base,x:x+tx*offset+nx*.18,z:z+tz*offset+nz*.18,kind:'planter' as const}));
        if(pair.every(p=>streetPropFits(p,streets,buildings,occupied,placed,ground,blocked)) && pair.every(p=>!placed.some(q=>q.kind==='planter'&&Math.hypot(q.x-p.x,q.z-p.z)<2.2))){
          pair.forEach(p=>{placed.push(p);counts.planter++;});
        }
      }
    }
    if(counts.bench===36&&counts.hydrant===24&&counts.planter>=24)break;
  }
  return placed;
}

/** Bake transforms and combine surfaces sharing a material, retaining every source triangle. */
export function combineStreetPropMeshes(source: THREE.Object3D) {
  source.updateMatrixWorld(true);
  const materials=new Map<THREE.Material,THREE.BufferGeometry[]>(), originals=new Set<THREE.BufferGeometry>();
  source.traverse(object=>{
    const mesh=object as THREE.Mesh;
    if(!mesh.isMesh || Array.isArray(mesh.material))return;
    const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const list=materials.get(mesh.material)??[];list.push(geometry);materials.set(mesh.material,list);originals.add(mesh.geometry);
  });
  const group=new THREE.Group();
  for(const [material,geometries] of materials){
    const combined=mergeGeometries(geometries,false);
    if(combined){group.add(new THREE.Mesh(combined,material));geometries.forEach(g=>g.dispose());}
    else geometries.forEach(g=>group.add(new THREE.Mesh(g,material)));
  }
  originals.forEach(g=>g.dispose());
  return group;
}

/** Spatial instancing keeps original model quality while allowing frustum/shadow culling. */
export function createStreetPropInstances(templates: Map<StreetPropKind,THREE.Object3D>, placements: StreetPropPlacement[], ground:(point:Coordinates)=>number) {
  const group=new THREE.Group();group.name='Grounded CC0 PBR street furnishings';
  group.userData.streetPropBatch=true;
  const cells=new Map<string,StreetPropPlacement[]>();
  for(const p of placements){if(!templates.has(p.kind))continue;const key=`${p.kind}:${Math.floor(p.x/128)}:${Math.floor(p.z/128)}`;const list=cells.get(key)??[];list.push(p);cells.set(key,list);}
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),yaw=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),normal=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1);
  for(const [key,entries] of cells){
    templates.get(entries[0].kind)!.traverse(object=>{
      const source=object as THREE.Mesh;if(!source.isMesh)return;
      const batch=new THREE.InstancedMesh(source.geometry,source.material,entries.length);batch.name=`PBR ${key}`;
      entries.forEach((p,i)=>{
        normal.set((ground({x:p.x-.4,z:p.z})-ground({x:p.x+.4,z:p.z}))/.8,1,(ground({x:p.x,z:p.z-.4})-ground({x:p.x,z:p.z+.4}))/.8).normalize();
        rotation.setFromUnitVectors(up,normal);yaw.setFromAxisAngle(up,p.angle);rotation.multiply(yaw);
        position.set(p.x,ground(p)+p.y,p.z);matrix.compose(position,rotation,scale);batch.setMatrixAt(i,matrix);
      });
      batch.userData.terrainInstances=entries;
      batch.userData.sharedStreetPropAsset=true;
      batch.castShadow=true;batch.receiveShadow=true;batch.instanceMatrix.needsUpdate=true;
      batch.computeBoundingBox();batch.computeBoundingSphere();group.add(batch);
    });
  }
  return group;
}
