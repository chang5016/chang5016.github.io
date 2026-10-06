import * as THREE from 'three';
import type { BuildingBounds, Coordinates } from './game-core';

// Complete licensed eight-storey model; its proportions are fixed in metres.
export const STOCK_OFFICE = { width: 27.560421889533398, depth: 12.424054412591747, height: 28.8 };
export const BUILDING_MODELS = {
 'urban-office': {...STOCK_OFFICE,uses:['office']},
 'grand-residence': {width:28,depth:18.01,height:35.865,uses:['office','residential_tower']},
 'civic-tower': {width:28,depth:18,height:46.4,uses:['office','residential_tower']},
 'harbor-tower': {width:24,depth:16,height:56.3,uses:['office','residential_tower']},
} as const;
export type StockBuildingKind=keyof typeof BUILDING_MODELS;
type Candidate = { bounds: BuildingBounds; archetype: string; name: string; height: number; distance: number };
type Street = { a: Coordinates; b: Coordinates; width: number };
export type StockBuildingPlacement = Coordinates & {kind:StockBuildingKind;originalHeight:number;y:number;angle:number;scale:number;bounds:BuildingBounds;sidewalkZ:number};

/** Replace only compatible unnamed offices. Protected landmarks and supplied
 * Taiwanese low-rise streets keep their existing complete models and textures. */
export function planStockBuildings<T extends Candidate>(candidates: T[], streets: Street[], ground: (p: Coordinates) => number) {
  const selected = new Map<T, StockBuildingPlacement>();
  for (const candidate of candidates) {
    const b = candidate.bounds;
    if(!['office','residential_tower'].includes(candidate.archetype)||candidate.name||candidate.distance>720||candidate.height<27)continue;
    if([...selected.values()].some(p=>Math.hypot(p.x-b.x,p.z-b.z)<62))continue;
    const options=(Object.entries(BUILDING_MODELS) as Array<[StockBuildingKind,typeof BUILDING_MODELS[StockBuildingKind]]>)
      .filter(([,m])=>(m.uses as readonly string[]).includes(candidate.archetype))
      .map(([kind,model])=>{const scale=Math.min(1.07,Math.max(.94,candidate.height/model.height),(b.halfWidth*2-2)/model.width,(b.halfDepth*2-2)/model.depth);return{kind,model,scale,mismatch:Math.abs(model.height*scale/candidate.height-1)};})
      .filter(o=>o.scale>=.94&&o.mismatch<=.13).sort((a,c)=>a.mismatch-c.mismatch);
    const option=(candidate.height<=34?options.find(o=>o.kind==='urban-office'):undefined)??options[0];if(!option)continue;
    const {kind,model,scale}=option;
    const nearest = streets.filter(s => Math.abs(s.b.z-s.a.z) < .01 && b.x > Math.min(s.a.x,s.b.x)+4 && b.x < Math.max(s.a.x,s.b.x)-4)
      .sort((a,c) => Math.abs(a.a.z-b.z)-Math.abs(c.a.z-b.z))[0];
    if (!nearest || Math.abs(nearest.a.z-b.z) > 32) continue;
    const side = nearest.a.z < b.z ? -1 : 1;
    const halfWidth=model.width*scale/2,halfDepth=model.depth*scale/2;
    const x = b.x, z = b.z + side * (b.halfDepth-halfDepth-1);
    const outline = [[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]].map(([a,c]) => ({x:x+a*halfWidth,z:z+c*halfDepth}));
    const heights = outline.map(ground);
    if (Math.max(...heights)-Math.min(...heights) > .14) continue;
    const sidewalkZ = nearest.a.z - side*(nearest.width/2+.3);
    selected.set(candidate, {kind,originalHeight:candidate.height,x,z,y:Math.max(...heights)-ground({x,z})+.135,angle:side===-1?0:Math.PI,scale,bounds:{x,z,halfWidth,halfDepth,outline},sidewalkZ});
    if(selected.size===20)break;
  }
  return selected;
}

/** One original geometry/atlas shared by spatial batches. No animated LOD,
 * per-building texture clones, rescaled windows or duplicate facade overlays. */
export function createStockBuildingInstances(templates:Map<StockBuildingKind,THREE.Object3D>,placements:StockBuildingPlacement[],ground:(p:Coordinates)=>number) {
  const group = new THREE.Group(); group.name = 'Complete stock PBR office buildings'; group.userData.stockBuildingBatch = true;
  const cells = new Map<string, StockBuildingPlacement[]>();
  for(const p of placements){if(!templates.has(p.kind))continue;const key=`${p.kind}:${Math.floor(p.x/256)}:${Math.floor(p.z/256)}`;const list=cells.get(key)??[];list.push(p);cells.set(key,list);}
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(),up=new THREE.Vector3(0,1,0);
  for(const [key,entries] of cells) templates.get(entries[0].kind)!.traverse(object=>{
    const source=object as THREE.Mesh;if(!source.isMesh)return;
    const batch=new THREE.InstancedMesh(source.geometry,source.material,entries.length);batch.name=`Complete urban offices ${key}`;
    entries.forEach((p,i)=>{position.set(p.x,ground(p)+p.y,p.z);rotation.setFromAxisAngle(up,p.angle);scale.setScalar(p.scale);matrix.compose(position,rotation,scale);batch.setMatrixAt(i,matrix);});
    batch.userData.terrainInstances=entries;batch.userData.sharedStockBuildingAsset=true;
    batch.castShadow=batch.receiveShadow=true;batch.computeBoundingBox();batch.computeBoundingSphere();group.add(batch);
  });
  group.userData.buildingCount=placements.length;group.userData.drawCalls=group.children.length;
  return group;
}
