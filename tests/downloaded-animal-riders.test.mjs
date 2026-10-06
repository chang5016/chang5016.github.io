import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {fitScooterRider} from '../app/riding-pose.ts';
import {metroDisplayRoute} from '../app/metro-display-layout.ts';
globalThis.ProgressEvent??=class{constructor(type,data){Object.assign(this,data);}};
async function loadCharacter(kind){
 const bytes=await fs.readFile(new URL(`../public/models/animal-riders/${kind}.glb`,import.meta.url)),length=bytes.readUInt32LE(12),data=JSON.parse(bytes.toString('utf8',20,20+length));
 // Collision/pose verification uses real vertex and skin buffers; native GPU
 // verification separately decodes the original embedded texture pixels.
 data.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+length).toString('base64');delete data.images;delete data.textures;delete data.materials;
 for(const mesh of data.meshes)for(const p of mesh.primitives)delete p.material;
 return (await new GLTFLoader().parseAsync(JSON.stringify(data),'')).scene;
}
for(const kind of ['bear','bunny','pig'])test(`new downloaded ${kind} has independent articulated riding poses at the original capybara scale`,async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('../public/models/animal-riders/sources.json',import.meta.url),'utf8')),record=manifest.files.find(f=>f.file===kind+'.glb');
 assert.ok(record.originalVertices>7000,'Use the complete new rounded character, not the old 500-triangle farm animal');
 assert.match(record.source.page,/juggypuggy\.itch\.io/);
 const bytes=await fs.readFile(new URL('../public/models/animal-riders/'+record.file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256);
 const template=await loadCharacter(kind),a=clone(template),b=clone(template),parent=new T.Group(),otherParent=new T.Group();parent.add(a,otherParent);otherParent.add(b);otherParent.position.x=6;otherParent.rotation.y=.74;a.rotation.y=b.rotation.y=kind==='bunny'?Math.PI:0;
 const hip=new T.Vector3(0,.84,.16),hand=s=>new T.Vector3(s*.31,.96,-.43),foot=s=>new T.Vector3(s*.24,.43,.14);
 fitScooterRider(a,{hip,hand,foot,riderHeight:1.52,spineDirection:new T.Vector3(0,1,-.14)});
 fitScooterRider(b,{hip,hand,foot,riderHeight:1.52,spineDirection:new T.Vector3(0,1,-.14)});
 const bHip=b.getObjectByName('Hips').getWorldPosition(new T.Vector3());assert.ok(bHip.distanceTo(otherParent.localToWorld(hip.clone()))<.001,'Repeated poses must retarget correctly under another vehicle heading');
 const bone=name=>a.getObjectByName(T.PropertyBinding.sanitizeNodeName(name));
 assert.ok(bone('Hips').getWorldPosition(new T.Vector3()).distanceTo(hip)<.001);
 for(const [side,sign]of [['L',1],['R',-1]])for(const [prefix,target]of [['Front',hand(sign)],['Back',foot(sign)]])assert.ok(bone(`${prefix}LowLeg.${side}_end`).getWorldPosition(new T.Vector3()).distanceTo(target)<.025,'Hands and feet reach the real motorcycle contact points');
 const bounds=new T.Box3().setFromObject(a,true);assert.ok(Math.abs(bounds.max.y-hip.y-1.52)<.02,'Seat-to-crown height stays consistent across species');
 assert.notEqual(bone('Hips'),b.getObjectByName('Hips'));assert.ok(b.getObjectByName('Hips').getWorldPosition(new T.Vector3()).x>5,'A posed copy cannot move the other rider');
 const meshes=[];a.traverse(o=>{if(o.isSkinnedMesh)meshes.push(o);});assert.ok(meshes.length>0);for(const mesh of meshes){assert.ok(mesh.geometry.attributes.skinWeight&&mesh.geometry.attributes.normal);let owner=mesh;while(owner&&!owner.userData.downloadedSource)owner=owner.parent;assert.match(owner.userData.downloadedSource.sha256,/^[a-f0-9]{64}$/);}
});
test('westbound route reads in travel order and its animated marker advances toward the actual next station',()=>{
 const from=metroDisplayRoute(3,2,1,0),moving=metroDisplayRoute(3,2,1,.75),arriving=metroDisplayRoute(3,2,1,1);
 assert.deepEqual(from.stops,[2,1,0]);assert.equal(from.terminus,0);assert.equal(from.marker,0);assert.equal(moving.marker,.75);assert.equal(arriving.marker,1);
 const east=metroDisplayRoute(3,0,1,.25);assert.deepEqual(east.stops,[0,1,2]);assert.equal(east.terminus,2);
});
