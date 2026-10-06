import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as T from 'three';
import {withDownloadedMetroFiles} from './downloaded-metro-loader.mjs';
import {MetroScene} from '../app/metro-scene.ts';
import {MetroSystem,METRO_FLOOR,metroPlatform} from '../app/metro-system.ts';

test('non-floor platform surfaces use complete shared PBR finishes on the actual imported canopy, frames, walls and furniture',async()=>withDownloadedMetroFiles(async()=>{
  const scene=new T.Scene(),system=new MetroSystem(()=>0),visuals=new MetroScene(scene,system,()=>0);await visuals.ready;
  try {
    scene.updateMatrixWorld(true);
    const roles=new Map(),textures=new Map();
    visuals.root.traverse(o=>{
      if(!o.isMesh)return;
      for(const m of Array.isArray(o.material)?o.material:[o.material]) {
        const finish=m.userData.stationFinish;if(!finish)continue;
        assert.ok(m.map&&m.normalMap&&m.roughnessMap,finish.role+' has all three real PBR channels');
        assert.equal(m.map.colorSpace,T.SRGBColorSpace);assert.equal(m.normalMap.colorSpace,T.NoColorSpace);assert.equal(m.roughnessMap.colorSpace,T.NoColorSpace);
        assert.equal(m.map.anisotropy,8);assert.equal(m.normalMap.anisotropy,8);
        const existing=textures.get(finish.family);if(existing)assert.equal(m.map,existing,'Repeated stations share texture allocations');else textures.set(finish.family,m.map);
        roles.set(finish.role,m);
      }
    });
    for(const role of ['platform fascia','grounded concrete support','painted canopy structure','weatherproof metal roof','oak canopy soffit','oak bench slats','brushed metal fitting','platform door frame','recessed pocket infill','recessed pocket frame','recessed light housing'])assert.ok(roles.has(role),role+' is present on rendered meshes');
    assert.equal(textures.size,4);
    // Inspect real triangles at every station, rather than accepting a surface
    // manifest that could claim the finish while leaving the old mesh in place.
    for(let station=0;station<3;station++)for(let track=0;track<2;track++) {
      const p=metroPlatform(station,track);
      const overhead=new T.Raycaster(new T.Vector3(p.x+10,METRO_FLOOR+3,p.z+1.2),new T.Vector3(0,1,0),0,6).intersectObject(visuals.root,true);
      assert.ok(overhead.some(h=>h.object.material?.userData?.stationFinish?.role==='oak canopy soffit'),'The real canopy underside is finished above both boarding platforms');
      const wall=new T.Raycaster(new T.Vector3(p.x+10,METRO_FLOOR-.9,p.z+8),new T.Vector3(0,0,-1),0,6).intersectObject(visuals.root,true);
      assert.ok(wall.some(h=>h.object.material?.userData?.stationFinish?.role==='platform fascia'),'The actual vertical platform edge is concrete, not a stretched old wall colour');
    }
    assert.equal(visuals.root.userData.downloadedGeometryAudit.generatedVisiblePrimitives,0);
  }finally{visuals.dispose();}
}));

test('imported concrete support textures retain their physical pitch after large vertical fitting',async()=>withDownloadedMetroFiles(async()=>{
  const scene=new T.Scene(),visuals=new MetroScene(scene,new MetroSystem(()=>0),()=>0);await visuals.ready;
  try {
    const model=visuals.assets.sized('pier',.7,25,.7,0,25,0);model.updateWorldMatrix(true);
    let measured=0;
    model.traverse(o=>{
      if(!o.isMesh)return;
      const p=o.geometry.attributes.position,uv=o.geometry.attributes.uv,w=new T.Vector3(),v=new T.Vector3();
      for(let i=0;i<p.count;i+=3)for(let j=1;j<3;j++) {
        w.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld);v.fromBufferAttribute(p,i+j).applyMatrix4(o.matrixWorld);
        if(Math.abs(w.x-v.x)+Math.abs(w.z-v.z)>.0001||Math.abs(w.y-v.y)<1)continue;
        const repeat=Math.hypot(uv.getX(i)-uv.getX(i+j),uv.getY(i)-uv.getY(i+j));
        assert.ok(Math.abs(repeat*1.805-Math.abs(w.y-v.y))<.0001,'A metre of concrete retains a metre of photographic texture');measured++;
      }
    });
    assert.ok(measured>0,'The test measures actual long original support faces');
  }finally{visuals.dispose();}
}));

test('all new platform finish bytes retain their exact public source and redistribution licence',async()=>{
  const root=new URL('../public/models/metro/downloaded/',import.meta.url);
  const ph=JSON.parse(await fs.readFile(new URL('platform-finish-sources.json',root),'utf8'));
  const aluminium=JSON.parse(await fs.readFile(new URL('aluminium-source.json',root),'utf8'));
  assert.equal(ph.assets.length,3);
  for(const source of [...ph.assets,aluminium]) {
    assert.equal(source.license,'CC0');assert.equal(source.files.length,3);
    assert.match(source.page,/^https:\/\/(polyhaven\.com\/a\/|ambientcg\.com\/view\?id=)/);
    for(const file of source.files) {
      const bytes=await fs.readFile(new URL(file.file,root));assert.equal(bytes.length,file.bytes);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256);
    }
  }
});
