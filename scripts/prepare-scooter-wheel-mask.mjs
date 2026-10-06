// Keep the supplied GLB byte-for-byte. Identify only its baked wheel surfaces,
// using both the original material atlas and the wheel's spatial envelope.
import {NodeIO} from '@gltf-transform/core';
import sharp from 'sharp';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const doc=await new NodeIO().read('public/models/capybara-premium-original.glb');
const p=doc.getRoot().listMeshes()[0].listPrimitives()[0],pos=p.getAttribute('POSITION'),uv=p.getAttribute('TEXCOORD_0'),index=p.getIndices();
const {data,info}=await sharp(p.getMaterial().getBaseColorTexture().getImage()).raw().toBuffer({resolveWithObject:true});
const painted=new Uint8Array(pos.getCount());
for(let i=0;i<painted.length;i++){
 const [u,v]=uv.getElement(i,[]),pixel=(Math.min(info.height-1,Math.max(0,Math.floor(v*info.height)))*info.width+Math.min(info.width-1,Math.max(0,Math.floor(u*info.width))))*info.channels;
 const [r,g,b]=data.subarray(pixel,pixel+3);
 // Bodywork's green paint and warm cream panels; rubber and hubs are neutral.
 painted[i]=((g>r*1.04&&g>b*1.32&&g-b>12)||(r>105&&g>85&&r>=g*.97&&r>b*1.5))?1:0;
}
const removed=[],ids=[];let preservedPaint=0;
for(let f=0;f<index.getCount()/3;f++){
 for(let k=0;k<3;k++)ids[k]=index.getScalar(f*3+k);
 const c=[0,0,0];for(const id of ids){const v=pos.getElement(id,[]);for(let k=0;k<3;k++)c[k]+=v[k]/3;}
 const [x,y,z]=c,front=Math.hypot(x+.385,y-.103),rear=Math.hypot(x-.31,y-.102);
 // The leg-shield begins at x=-.295. Its dark seams are bodywork, not rubber.
 const envelope=Math.abs(z)<.097&&((front<.195&&x<-.295&&y<.269)||(rear<.133&&y<.2));
 const paint=ids.some(id=>painted[id]);
 if(envelope&&!paint)removed.push(f);else if(envelope&&paint)preservedPaint++;
}
const ranges=[];for(const f of removed){const last=ranges[ranges.length-1];if(last&&last[1]===f)last[1]++;else ranges.push([f,f+1]);}
const result={positionCount:pos.getCount(),indexCount:index.getCount(),indexSha256:createHash('sha256').update(Buffer.from(index.getArray().buffer)).digest('hex'),removedTriangles:removed.length,preservedPaintTriangles:preservedPaint,removedRanges:ranges};
await writeFile('app/scooter-wheel-mask.json',JSON.stringify(result)+'\n');console.log({removed:removed.length,paint:preservedPaint,ranges:ranges.length});
