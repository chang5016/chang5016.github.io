import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import * as T from 'three';
import {geometry,assign,carve} from './source-volume.mjs';

// Refit downloaded architecture, retaining its original roof planes, lining,
// closed floor panels and licence. No primitive or replacement vertex shell.
const folder=new URL('../../public/models/metro/downloaded/',import.meta.url),io=new NodeIO();
const manifest=JSON.parse(await fs.readFile(new URL('sources.json',folder),'utf8'));
async function save(name,doc,adaptation,original) {
  const source=manifest.files.find(f=>f.file===original+'.glb').source;
  const bounds=new T.Box3();let triangles=0;
  for(const node of doc.getRoot().listNodes()) {
    node.setExtras({...node.getExtras(),downloadedSource:source,adaptation});
    for(const p of node.getMesh()?.listPrimitives()??[]) {
      const g=geometry(p);g.computeBoundingBox();bounds.union(g.boundingBox);triangles+=g.attributes.position.count/3;
    }
  }
  await io.write(new URL(name+'.glb',folder).pathname,doc);
  const bytes=await fs.readFile(new URL(name+'.glb',folder));
  manifest.files=manifest.files.filter(f=>f.file!==name+'.glb');
  manifest.files.push({file:name+'.glb',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),source,adaptation,triangles,bounds:[bounds.min.toArray(),bounds.max.toArray()]});
}
for(const upper of [false,true]) {
  const roof=await io.read(new URL('civic-roof.glb',folder).pathname);
  for(const mesh of roof.getRoot().listMeshes())for(const p of mesh.listPrimitives()) {
    let g=geometry(p);
    // These are two disconnected original roof volumes, not one canopy. Give
    // each its own correct metric span and a complete supporting envelope.
    g=carve(g,upper?[[[-100,-1,-100],[100,4,100]]]:[[[-100,4,-100],[100,20,100]]]);
    g.applyMatrix4(new T.Matrix4().makeScale(upper?18.8/11.873:47/9.8224,1,upper?30.8/10.852:111/33.237));
    if(upper)g.translate(0,-6.4565,0);
    else g=carve(g,[[[-8.01,-1,-13.41],[8.01,5,13.41]]]);
    // Preserve physical roof/wood texture scale after metric fitting.
    const pos=g.attributes.position,uv=g.attributes.uv;
    for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)/2,pos.getZ(i)/2);
    assign(roof,p,g);
  }
  await save(upper?'atrium-lantern-roof':'atrium-main-roof',roof,upper
    ?'Complete original raised roof and timber lining, independently fitted to an 18.8 by 30.8 m glazed roof lantern. Its original separate base now has a fully supported curtain wall and structural transfer frame.'
    :'Complete original lower pitched roof and timber lining fitted to a 47 by 111 m hall, with a real 16.02 by 26.82 m central daylight opening. Original source triangles are clipped only around this opening; roof and wood finishes use metric UVs.','civic-roof');
}
const tile=await io.read(new URL('boarding-threshold.glb',folder).pathname);
for(const mesh of tile.getRoot().listMeshes())for(const p of mesh.listPrimitives()) {
  const g=geometry(p);g.applyMatrix4(new T.Matrix4().makeScale(.59175/3.05,.008/.025,.558/.40));g.translate(0,.012,0);
  const pos=g.attributes.position,uv=g.attributes.uv;
  // Sample one complete photographed terrazzo tile, keeping its fine aggregate
  // at a consistent size. The actual mesh owns the external 2 mm grout joint.
  for(let i=0;i<pos.count;i++)uv.setXY(i,pos.getX(i)/(.59175*4.12)+.625,pos.getZ(i)/(.558*4.12)+.625);
  assign(tile,p,g);
}
for(const m of tile.getRoot().listMaterials())m.setName('Metro terrazzo / 600 mm module').setBaseColorFactor([.84,.87,.87,1]).setMetallicFactor(0).setRoughnessFactor(.88).setExtras({map:'/models/metro/downloaded/textures/terrazzo-diff.jpg',normal:'/models/metro/downloaded/textures/terrazzo-nor_gl.jpg',roughness:'/models/metro/downloaded/textures/terrazzo-rough.jpg',downloadedTexture:{page:'https://polyhaven.com/a/terrazzo_tiles',author:'Amal Kumar',license:'CC0',sourceDimensionsMetres:[2,2]}});
await save('station-paving',tile,'Closed original downloaded Ceiling panel retained as a 591.75 by 558 mm terrazzo paving module, with 2 mm joints, 8 mm physical thickness and downloaded photographic Poly Haven CC0 terrazzo albedo, OpenGL normals and roughness. No new primitive geometry.','boarding-threshold');
manifest.version=6;manifest.stationArchitecture='supported civic atrium with enclosed daylight lantern and physical metric stone platforms';
await fs.writeFile(new URL('sources.json',folder),JSON.stringify(manifest,null,2)+'\n');
