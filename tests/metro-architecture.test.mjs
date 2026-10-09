import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as T from 'three';
import {withDownloadedMetroFiles} from './downloaded-metro-loader.mjs';
import {MetroScene} from '../app/metro-scene.ts';
import {MetroSystem,METRO_FLOOR,metroConcourse,metroPlatform} from '../app/metro-system.ts';

test('all three real atrium roofs meet their facade supports and the raised roof has a glazed, open daylight volume',async()=>withDownloadedMetroFiles(async()=>{
  const scene=new T.Scene(),system=new MetroSystem(()=>0),visuals=new MetroScene(scene,system,()=>0);await visuals.ready;
  try {
    scene.updateMatrixWorld(true);
    const halls=[];visuals.root.traverse(o=>{if(o.userData.architecturalRoof)halls.push(o);});assert.equal(halls.length,3);
    const hits=(x,y,z,dx,dy,dz,distance)=>new T.Raycaster(new T.Vector3(x,y,z),new T.Vector3(dx,dy,dz),0,distance).intersectObject(visuals.root,true);
    for(let station=0;station<3;station++) {
      const hall=metroConcourse(station),floor=system.lifts[station*2].lower,structure=halls[station].userData.architecturalRoof;
      assert.ok(structure.perimeterSupports.length>=12);
      for(const post of structure.perimeterSupports) {
        // Sample the actual source geometry throughout the whole tall support,
        // including its foot. Metadata alone cannot hide a missing post.
        for(const height of [.15,4,12,22,30.2])assert.ok(hits(post.x-.8,floor+height,post.z,1,0,0,1.6).length,`Continuous grounded support at station ${station}, ${height} m`);
        const above=hits(post.x,post.top+.005,post.z,0,1,0,1.4);
        assert.ok(above.some(h=>h.object.material?.name?.includes('atrium structure')),'The post meets an actual imported transfer girder');
      }
      const upper=hits(hall.x-4,floor+31.0,hall.z+2,0,1,0,10);
      assert.ok(upper.length&&upper[0].point.y>floor+36.5&&upper[0].point.y<floor+40.2,'The daylight opening reaches the original pitched upper roof, with no old solid panel blocking it');
      const lower=hits(hall.x-18,floor+31.3,hall.z,0,1,0,3);
      assert.ok(lower.length&&lower[0].point.y>floor+31.75&&lower[0].point.y<floor+34,'The lower original pitch closes the envelope above its eave frame');
      for(const side of [-1,1])for(const height of [34.5,35.5]) {
        const glazing=hits(hall.x+side*14,floor+height,hall.z,-side,0,0,10);
        assert.ok(glazing.some(h=>h.object.material?.name==='Glass'||h.object.material?.name==='Frame'),'The raised canopy is enclosed by original framed glass rather than floating');
      }
    }
    assert.equal(visuals.root.userData.downloadedGeometryAudit.generatedVisiblePrimitives,0);
  }finally{visuals.dispose();}
}));

test('physical platform paving keeps supported joints, correct boarding height and shared PBR instances at every station',async()=>withDownloadedMetroFiles(async()=>{
  const scene=new T.Scene(),system=new MetroSystem(()=>0),visuals=new MetroScene(scene,system,()=>0);await visuals.ready;
  try {
    scene.updateMatrixWorld(true);const tiles=[];
    visuals.root.traverse(o=>{if(o.isInstancedMesh&&o.material?.name==='Metro terrazzo / 600 mm module')tiles.push(o);});
    assert.equal(tiles.length,12);assert.ok(tiles.every(t=>t.geometry===tiles[0].geometry&&t.material===tiles[0].material),'All twelve platforms share geometry and photographic material');
    const material=tiles[0].material;
    assert.ok(material.map&&material.normalMap&&material.roughnessMap);assert.equal(material.normalMap.colorSpace,T.NoColorSpace);assert.equal(material.roughnessMap.colorSpace,T.NoColorSpace);
    assert.equal(material.map.anisotropy,8);const versions=tiles.map(t=>t.instanceMatrix.version);
    for(let station=0;station<6;station++)for(let track=0;track<2;track++) {
      const p=metroPlatform(station,track);
      for(const xOffset of [.17,4.36,12.94,26.12])for(const zOffset of [-4.83,-1.17,2.64,4.33]) {
        const hit=new T.Raycaster(new T.Vector3(p.x+xOffset,METRO_FLOOR+.05,p.z+zOffset),new T.Vector3(0,-1,0),0,.051).intersectObject(visuals.root,true)[0];
        assert.ok(hit,'The tile or the closed original slab supports every paving sample');
        assert.ok(hit.point.y>=METRO_FLOOR-.001&&hit.point.y<=METRO_FLOOR+.013,'No paving step can catch a wheel or create a boarding gap');
      }
    }
    visuals.render(.25);visuals.render(.75);assert.deepEqual(tiles.map(t=>t.instanceMatrix.version),versions,'Moving trains do not regenerate or upload thousands of static paving transforms');
  }finally{visuals.dispose();}
}));

test('photographic terrazzo colour, OpenGL normal and roughness bytes retain their public CC0 source',async()=>{
  const root=new URL('../public/models/metro/downloaded/',import.meta.url),source=JSON.parse(await fs.readFile(new URL('terrazzo-source.json',root),'utf8'));
  assert.equal(source.license,'CC0');assert.equal(source.author,'Amal Kumar');assert.equal(source.files.length,3);
  for(const file of source.files) {
    const bytes=await fs.readFile(new URL(file.file,root));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);assert.equal(bytes.length,file.bytes);
    assert.match(file.url,/^https:\/\/dl\.polyhaven\.org\//);
  }
});
