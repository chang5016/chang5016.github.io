import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
const folder='public/models/metro/downloaded/',file='jfr1-motorcycle-car.glb',io=new NodeIO();
const doc=await io.read(folder+file),buffer=doc.getRoot().listBuffers()[0];let removed=0,total=0;
for(const mesh of doc.getRoot().listMeshes())for(const primitive of mesh.listPrimitives()){
 const index=primitive.getIndices(),p=primitive.getAttribute('POSITION');
 const keep=[],v=[];
 for(let i=0;i<(index?.getCount()??p.getCount());i+=3){
  const ids=[0,1,2].map(k=>index?index.getScalar(i+k):i+k);
  const handhold=mesh.getName().includes('Wagon_half_BAKED')&&ids.every(id=>{
   p.getElement(id,v);return Math.abs(v[0])>.70&&Math.abs(v[0])<1.10&&v[1]>2.10&&v[1]<4.60&&v[2]>-13&&v[2]<12.98;
  });
  if(handhold)removed++;else keep.push(...ids);
 }
 total+=keep.length/3;
 primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(buffer));
}
if(removed)await io.write(folder+file,doc);
const manifest=JSON.parse(await fs.readFile(folder+'sources.json','utf8')),entry=manifest.files.find(f=>f.file===file),bytes=await fs.readFile(folder+file);
entry.sha256=createHash('sha256').update(bytes).digest('hex');entry.bytes=bytes.length;entry.triangles=total;
if(!entry.adaptation.includes('overhead grab poles'))entry.adaptation+=' Original narrow overhead grab poles entering the 3 m motorcycle clearance envelope removed; downloaded roof, cab and all remaining interior faces retained.';
await fs.writeFile(folder+'sources.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({removedHangingPoleTriangles:removed,triangles:total}));
