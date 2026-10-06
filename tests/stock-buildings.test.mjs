import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import sharp from 'sharp';import * as THREE from 'three';
import {readModelGeometry} from './model-fixture.mjs';
import {STOCK_OFFICE,BUILDING_MODELS,planStockBuildings,createStockBuildingInstances} from '../app/stock-buildings.ts';
const asset=new URL('../public/models/buildings/urban-office.glb',import.meta.url).pathname;
test('complete stock building retains original triangle count and proportions in one grounded material batch',async()=>{
 const report=JSON.parse(await readFile(new URL('../public/models/buildings/integrity.json',import.meta.url),'utf8'));
 const {document,group}=await readModelGeometry(asset),bounds=new THREE.Box3().setFromObject(group),size=bounds.getSize(new THREE.Vector3());
 assert.equal(group.children.length,1);assert.equal(group.children[0].geometry.index.count/3,9654);
 assert.ok(Math.abs(bounds.min.y)<1e-5);assert.ok(Math.abs(bounds.min.x+bounds.max.x)<1e-5);assert.ok(Math.abs(bounds.min.z+bounds.max.z)<1e-5);
 for(const [axis,key] of [['x','width'],['y','height'],['z','depth']])assert.ok(Math.abs(size[axis]-STOCK_OFFICE[key])<1e-5);
 assert.equal(document.getRoot().listMaterials().length,1);assert.equal(document.getRoot().listTextures().length,2);
 const material=document.getRoot().listMaterials()[0];assert.ok(material.getBaseColorTexture());assert.equal(material.getMetallicRoughnessTexture(),material.getOcclusionTexture());
 for(const texture of document.getRoot().listTextures()){const meta=await sharp(texture.getImage()).metadata();assert.deepEqual([meta.width,meta.height],[4096,2048]);}
 assert.equal(report.sha256,createHash('sha256').update(await readFile(asset)).digest('hex'));
 assert.ok(report.packedTextureTexels<=report.sourceTextureTexels/3);assert.ok(report.bytes<6000000);
});
test('planned offices retain uniform scale, fit original parcels and share cullable instances',async()=>{
 const candidates=Array.from({length:10},(_,i)=>({archetype:'office',name:'',height:29,distance:i*80,bounds:{x:i*80,z:20,halfWidth:19,halfDepth:12}}));
 candidates[0].name='Protected landmark';
 const streets=[{a:{x:-40,z:0},b:{x:850,z:0},width:10}],plan=planStockBuildings(candidates,streets,()=>0);
 assert.equal(plan.size,9);assert.ok(!plan.has(candidates[0]));
 for(const [candidate,p] of plan){assert.ok(Math.abs(p.x-candidate.bounds.x)+p.bounds.halfWidth<candidate.bounds.halfWidth);assert.ok(Math.abs(p.z-candidate.bounds.z)+p.bounds.halfDepth<candidate.bounds.halfDepth);assert.ok(p.sidewalkZ>5);assert.equal(p.angle,0);}
 const {group}=await readModelGeometry(asset);const batches=createStockBuildingInstances(new Map([['urban-office',group]]),[...plan.values()],()=>3);
 assert.ok(batches.children.length<=3);assert.equal(batches.children.reduce((n,b)=>n+b.count,0),9);
 for(const batch of batches.children){assert.equal(batch.geometry,group.children[0].geometry);assert.equal(batch.material,group.children[0].material);assert.ok(batch.frustumCulled);for(let i=0;i<batch.count;i++){const m=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(),q=new THREE.Quaternion();batch.getMatrixAt(i,m);m.decompose(position,q,scale);assert.ok(Math.abs(scale.x-scale.y)<1e-6&&Math.abs(scale.x-scale.z)<1e-6);assert.ok(Math.abs(position.y-3.135)<1e-5);}}
});
