import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { DownloadedMetroAssets } from '../app/metro-assets.ts';
import { createDownloadedMetroCar } from '../app/metro-model.ts';
import { METRO_CAR_LENGTH, METRO_DOOR_WIDTH, METRO_HALF_WIDTH, METRO_LOCAL_DOORS } from '../app/metro-system.ts';
import { withDownloadedMetroFiles } from './downloaded-metro-loader.mjs';

test('every shipped metro part has a downloadable source, immutable file hash and preserved licence notice', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../public/models/metro/downloaded/sources.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.length >= 27);
  for (const item of manifest.files) {
    const bytes = await fs.readFile(new URL('../public/models/metro/downloaded/' + item.file, import.meta.url));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), item.sha256);
    assert.match(item.source.sha256, /^[a-f0-9]{64}$/); assert.ok(item.source.repository || item.source.page);
    assert.ok(item.triangles > 0 && item.adaptation.length > 30);
  }
  for (const file of ['Libre-Resources-LICENSE.txt', 'Libre-JFR1-LICENSE.txt', 'CadNav-NOTICE.txt']) assert.ok((await fs.readFile(new URL('../public/models/metro/downloaded/' + file, import.meta.url))).length > 100);
});

test('the actual downloaded JFR1 geometry has rideable apertures, opposite-side interlocks and a continuously supported full-size cabin', async () => withDownloadedMetroFiles(async () => {
  const assets = new DownloadedMetroAssets(); await assets.load();
  try {
    for (const orientation of [-1, 1]) for (const side of [-1, 1]) {
      const car = createDownloadedMetroCar(assets, orientation, side, 'test');
      car.animate(0); car.root.updateMatrixWorld(true);
      const size = new THREE.Box3().setFromObject(car.root).getSize(new THREE.Vector3());
      assert.ok(Math.abs(size.x - METRO_CAR_LENGTH) < .1);
      assert.ok(size.z >= METRO_HALF_WIDTH * 2 && size.z < METRO_HALF_WIDTH * 2 + .2);
      const ray = (at, offset, height, face = side) => new THREE.Raycaster(new THREE.Vector3((at + offset) * orientation, height, face * 4), new THREE.Vector3(0, 0, -face), 0, 2);
      for (const at of METRO_LOCAL_DOORS) assert.ok(ray(at, .2, 1.1).intersectObject(car.root, true).length > 0, 'Closed door covers the actual opening');
      car.animate(1); car.root.updateMatrixWorld(true);
      for (const at of METRO_LOCAL_DOORS) {
        for (const offset of [-.63, 0, .63]) for (const height of [.25, 1.1, 2.95]) assert.equal(ray(at, offset, height).intersectObject(car.root, true).length, 0, `A full scooter crosses downloaded geometry: ${at}, ${height}`);
        assert.ok(ray(at, .2, 1.1, -side).intersectObject(car.root, true).length > 0, 'Only the platform face opens');
        for (const z of [-2.8, 0, 2.8]) {
          const floor = new THREE.Raycaster(new THREE.Vector3(at * orientation, .3, z), new THREE.Vector3(0, -1, 0), 0, .5).intersectObject(car.root, true)[0];
          assert.ok(floor); assert.ok(Math.abs(floor.point.y) < .03);
        }
      }
      for (const lateral of [-2.5, -.97, -.89, 0, .89, .97, 2.5]) for (const height of [.25, 1.1, 2.95]) {
        const cabin = new THREE.Raycaster(new THREE.Vector3(-13.35 * orientation, height, lateral), new THREE.Vector3(orientation, 0, 0), 0, 25.0);
        assert.equal(cabin.intersectObject(car.root, true).length, 0, 'Imported interior faces cannot protrude into the motorcycle cabin');
      }
      const importedShell = car.root.children.find(part => part.name === 'Downloaded metro / jfr1-motorcycle-car');
      assert.ok(importedShell);
      for (const at of [-15, -9]) for (const face of [-1, 1]) for (const height of [3.3, 3.45]) {
        const shoulder = new THREE.Raycaster(new THREE.Vector3(at * orientation, height, 0), new THREE.Vector3(0, 0, face), 0, 3.3).intersectObject(importedShell, true)[0];
        assert.ok(shoulder && Math.abs(shoulder.point.z) > 2.8, 'The original curved roof shoulder remains closed above the passenger cabin');
      }
      assert.equal(car.boards.length, 6);
      assert.ok(car.boards.every(board => board.screens.length > 0));
      assert.equal(new Set(car.boards.map(board => board.texture)).size, 1, 'All door boards share one live pixel buffer');
      for(const board of car.boards){
        const centre=board.root.getWorldPosition(new THREE.Vector3()),inward=new THREE.Vector3(-Math.sign(board.root.position.x),0,0).applyQuaternion(car.root.getWorldQuaternion(new THREE.Quaternion()));
        const ray=new THREE.Raycaster(centre.clone().addScaledVector(inward,1.3),inward.clone().negate(),0,1.5);
        const hits=ray.intersectObject(car.root,true);
        assert.ok(hits.length&&board.screens.includes(hits[0].object),'The live door LCD must be visible from the cabin, below the original curved roof');
        const displayBounds=new THREE.Box3().setFromObject(board.root);assert.ok(displayBounds.min.y>3.68&&displayBounds.max.y<4.22,'The complete display clears the 2.95 m rider and fits below the curved roof shoulder');
        const enclosure=assets.getBounds('door-display').getSize(new THREE.Vector3()).multiply(board.root.scale);
        assert.ok(enclosure.z>=2.99&&enclosure.z<=METRO_DOOR_WIDTH&&enclosure.x<.05,'LCD housing fits the real door opening and is thin and flush with the header');
        assert.ok(car.root.getObjectByProperty('uuid',board.root.userData.wallMountedDisplay.header),'Every display mounts to an actual downloaded interior header');
        const fonts=[];const context=board.canvas.getContext('2d'),fill=context.fillText;
        context.fillText=function(...args){fonts.push({text:args[0],font:this.font});return fill.apply(this,args);};
        assets.paintTrain(board,{names:['南港生活區','晴川南站','東河門戶'],english:['Nangang','Qingchuan','East River'],current:0,next:1,phase:'running',seconds:57,capacity:16,total:16});context.fillText=fill;
        if(fonts.length){const dominant=fonts.find(row=>row.text==='晴川南站');assert.ok(parseFloat(dominant.font.split(' ')[1])>=board.canvas.height*.26,'Next station stays prominent on the physical LCD');for(const station of['南港生活區','晴川南站','東河門戶'])assert.ok(fonts.some(row=>row.text===station),'The full line remains visible');assert.ok(fonts.some(row=>row.text==='下一站 NEXT STATION'));assert.ok(fonts.some(row=>row.text==='上一站 LAST STATION'));}
      }
      car.root.traverse(mesh => { if (mesh.isMesh) assert.match(mesh.userData.downloadedSource.sha256, /^[a-f0-9]{64}$/); });
    }
  } finally { assets.dispose(); }
}));
