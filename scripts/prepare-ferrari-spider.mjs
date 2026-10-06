import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),source='public/models/traffic-real/ferrari.glb';
const doc=await io.read(source),buffer=doc.getRoot().listBuffers()[0];let removed=0;
for(const node of doc.getRoot().listNodes()){
 if(!node.getMesh()||node.getName().startsWith('Roll_')||node.getName().startsWith('Wheel_'))continue;
 for(const primitive of node.getMesh().listPrimitives()){
  const position=primitive.getAttribute('POSITION'),index=primitive.getIndices();if(!index)continue;
  const keep=[],point=[];
  for(let i=0;i<index.getCount();i+=3){
   const ids=[0,1,2].map(k=>index.getScalar(i+k));let y=0,z=0,x=0;
   for(const id of ids){position.getElement(id,point);x+=point[0]/3;y+=point[1]/3;z+=point[2]/3;}
   // Remove the native detachable hard-top and upper side glazing only.
   // Keep the windshield, A pillars, dashboard, seats and rear engine cover.
   const bodyTrim=['Paint','Glass','Interior_dark','Interior_light','metal_gray','plastic_gray'].includes(primitive.getMaterial()?.getName());
   const top=bodyTrim&&y>1.015&&z>-.51&&z<1.10&&Math.abs(x)<.99;
   const sideGlass=primitive.getMaterial()?.getName()==='Glass'&&y>.78&&z>-.44&&z<.63&&Math.abs(x)>.65;
   if(top||sideGlass)removed++;else keep.push(...ids);
  }
  primitive.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(keep)).setBuffer(buffer));
 }
}
if(removed<200)throw new Error('Native Ferrari roof selection is incomplete');
const attribution={page:'https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6',author:'vicent091036',license:'CC BY 4.0',sha256:createHash('sha256').update(await fs.readFile(source)).digest('hex')};
doc.getRoot().listScenes()[0].setExtras({...doc.getRoot().listScenes()[0].getExtras(),convertible:true,downloadedSource:attribution});
await io.write('public/models/traffic-real/ferrari-spider.glb',doc);
console.log(JSON.stringify({removedRoofTriangles:removed,source:attribution}));
