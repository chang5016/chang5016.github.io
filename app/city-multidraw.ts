import * as THREE from 'three';
import { partitionCityMesh } from './city-render-chunks';

type Range = { id:number; geometry:THREE.BufferGeometry; sourceIds:number[] };

/** Copy used vertices exactly, including UVs and every authored attribute. */
function compact(source:THREE.BufferGeometry) {
  const original=source.index,indices:number[]=[],sourceIds:number[]=[],lookup=new Map<number,number>();
  const start=source.drawRange.start,end=Math.min(original?.count??source.attributes.position.count,start+source.drawRange.count);
  for(let i=start;i<end;i++) {
    const sourceId=original?original.getX(i):i;
    let id=lookup.get(sourceId);
    if(id===undefined){id=sourceIds.length;lookup.set(sourceId,id);sourceIds.push(sourceId);}
    indices.push(id);
  }
  const geometry=new THREE.BufferGeometry();
  for(const [name,attribute] of Object.entries(source.attributes)) {
    const packed=new THREE.BufferAttribute(new (attribute.array.constructor as Float32ArrayConstructor)(sourceIds.length*attribute.itemSize),attribute.itemSize,attribute.normalized);
    for(let i=0;i<sourceIds.length;i++)for(let c=0;c<attribute.itemSize;c++)packed.setComponent(i,c,attribute.getComponent(sourceIds[i],c));
    geometry.setAttribute(name,packed);
  }
  geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return {geometry,sourceIds};
}

/** Native multi-draw with Three.js's non-extension fallback. Each original
 * spatial range remains independently culled for both color and shadows. */
export function batchCityMesh(source:THREE.Mesh,cellSize=160,minimumIndices=6000,minimumCells=2) {
  if(Array.isArray(source.material)||source.material.transparent)return null;
  const partition=partitionCityMesh(source,cellSize,minimumIndices,minimumCells);if(!partition)return null;
  const ranges=partition.children.map(child=>compact((child as THREE.Mesh).geometry));
  const vertices=ranges.reduce((sum,r)=>sum+r.geometry.attributes.position.count,0);
  const indices=ranges.reduce((sum,r)=>sum+r.geometry.index!.count,0);
  const batch=new THREE.BatchedMesh(ranges.length,vertices,indices,source.material);
  batch.name=source.name+' / native multi-draw';batch.castShadow=source.castShadow;batch.receiveShadow=source.receiveShadow;
  batch.layers.mask=source.layers.mask;batch.renderOrder=source.renderOrder;
  batch.perObjectFrustumCulled=true;batch.sortObjects=true;
  const identity=new THREE.Matrix4(),records:Range[]=[];
  for(const range of ranges) {
    const id=batch.addGeometry(range.geometry),instance=batch.addInstance(id);batch.setMatrixAt(instance,identity);
    records.push({id,...range});
  }
  batch.computeBoundingBox();batch.computeBoundingSphere();
  batch.userData.cityMultidraw={source:source.geometry,ranges:records,triangles:indices/3,sourceDraws:ranges.length};
  for(const child of partition.children)(child as THREE.Mesh).geometry.dispose();
  return batch;
}

export function refreshCityBatch(batch:THREE.BatchedMesh) {
  const data=batch.userData.cityMultidraw as {source:THREE.BufferGeometry;ranges:Range[]}|undefined;if(!data)return;
  for(const {id,geometry,sourceIds} of data.ranges) {
    for(const name of ['position','normal']) {
      const src=data.source.getAttribute(name),dst=geometry.getAttribute(name);if(!src||!dst)continue;
      for(let i=0;i<sourceIds.length;i++)for(let c=0;c<src.itemSize;c++)dst.setComponent(i,c,src.getComponent(sourceIds[i],c));
    }
    geometry.computeBoundingBox();geometry.computeBoundingSphere();batch.setGeometryAt(id,geometry);
  }
  batch.computeBoundingBox();batch.computeBoundingSphere();
  (data as typeof data & {revision?:number}).revision=((data as typeof data & {revision?:number}).revision??0)+1;
}

export function disposeCityBatch(batch:THREE.BatchedMesh) {
  const data=batch.userData.cityMultidraw as {ranges:Range[]}|undefined;
  data?.ranges.forEach(r=>r.geometry.dispose());batch.dispose();
}
