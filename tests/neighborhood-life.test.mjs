import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {NeighborhoodLife,SHOP_SITES,SHOP_RESERVATIONS,shopBounds,planSidewalkAnimals} from '../app/neighborhood-life.ts';
import {RealWorldMap} from '../app/real-world-map.ts';
import {createHeadlessDocument} from './headless-document.mjs';
const folder=new URL('../public/models/neighborhood/',import.meta.url),io=new NodeIO();
const triangles=doc=>doc.getRoot().listScenes()[0].listChildren().reduce((sum,node)=>sum+count(node),0);
function count(node){return(node.getMesh()?.listPrimitives()??[]).reduce((sum,p)=>sum+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0)+node.listChildren().reduce((sum,n)=>sum+count(n),0);}
test('closed exterior stores retain whole native buildings and opaque windows, with measured PBR cladding and physical signage',async()=>{
 const manifest=JSON.parse(await fs.readFile(new URL('sources.json',folder),'utf8'));
 for(const [name,width]of [['mart',14],['coffee',10.4]]){const source=await io.read(new URL(name+'-source.glb',folder).pathname),fitted=await io.read(new URL(name+'-metric.glb',folder).pathname),record=manifest.files.find(f=>f.file===name+'-metric.glb');assert.equal(triangles(source),record.sourceTriangleCount);assert.equal(triangles(fitted),record.sourceTriangleCount+record.addedTriangles);const bytes=await fs.readFile(new URL(name+'-metric.glb',folder));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),record.sha256);assert.ok(Math.abs(record.bounds[1][0]-record.bounds[0][0]-width)<1e-5);assert.equal(record.bounds[0][1],0);assert.ok(record.uniformScale>0);assert.ok(fitted.getRoot().listMaterials().some(m=>m.getExtras().normal&&m.getExtras().roughness));assert.ok(fitted.getRoot().listMaterials().every(m=>m.getAlphaMode()==='OPAQUE'));}
});
test('all complete shops fit reserved street parcels and actual animated foxes walk clear sidewalks and yield to the player',async()=>{
 const previousDocument=globalThis.document,load=GLTFLoader.prototype.loadAsync,texture=THREE.TextureLoader.prototype.loadAsync;globalThis.document=createHeadlessDocument();
 GLTFLoader.prototype.loadAsync=async function(url){const doc=await io.read(new URL('../public'+url,import.meta.url).pathname);for(const t of doc.getRoot().listTextures())t.dispose();const bytes=await io.writeBinary(doc);return this.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');};
 THREE.TextureLoader.prototype.loadAsync=async function(url){assert.ok((await fs.readFile(new URL('../public'+url,import.meta.url))).length>100);return new THREE.DataTexture(new Uint8Array([120,120,120,255]),1,1);};
 let world,life;
 try{world=new RealWorldMap(new THREE.Scene(),4);const blocked=p=>world.nearbyStaticObstacles(p,2,world.elevationAt(p)).some(box=>Math.abs(p.x-box.x)<box.halfWidth+.65&&Math.abs(p.z-box.z)<box.halfDepth+.65),paths=planSidewalkAnimals(world.streetSegments,world.buildings,blocked);assert.equal(paths.length,14);life=new NeighborhoodLife(world.group,p=>world.elevationAt(p),paths,blocked);await life.ready;
  assert.equal(life.root.userData.neighborhoodAudit.shops,12);assert.equal(life.walkers.length,14);let draws=0;life.root.traverse(o=>{if(o.isInstancedMesh)draws++;});assert.ok(draws<32);
  for(const [i,site]of SHOP_SITES.entries()){const box=shopBounds(site),parcel=SHOP_RESERVATIONS[i];assert.ok(parcel.left<=site.x-box.halfWidth&&parcel.right>=site.x+box.halfWidth);const sidewalk=site.roadZ+Math.sign(site.z-site.roadZ)*(site.roadWidth/2+2.6);assert.ok(Math.min(Math.abs(parcel.back-sidewalk),Math.abs(parcel.front-sidewalk))<1e-6,'Each forecourt joins its street sidewalk');for(const s of world.streetSegments){const dx=s.b.x-s.a.x,dz=s.b.z-s.a.z,t=Math.max(0,Math.min(1,((site.x-s.a.x)*dx+(site.z-s.a.z)*dz)/(dx*dx+dz*dz)));assert.ok(Math.hypot(site.x-s.a.x-dx*t,site.z-s.a.z-dz*t)>s.width/2+Math.min(box.halfWidth,box.halfDepth));}for(const other of SHOP_SITES.slice(i+1))assert.ok(Math.hypot(other.x-site.x,other.z-site.z)>150,'Shops are distributed across separate blocks');}
  assert.ok(life.root.userData.neighborhoodAudit.closedExteriors);assert.equal(world.group.userData.spatialAudit.passed,true);
  for(const site of SHOP_SITES){const b=shopBounds(site),level=world.elevationAt(site);for(const x of[-b.halfWidth,b.halfWidth])for(const z of[-b.halfDepth,b.halfDepth])assert.ok(Math.abs(world.elevationAt({x:site.x+x,z:site.z+z})-level)<1e-6,'Complete store base meets a level graded parcel');}
  for(const p of paths){const length=Math.hypot(p.b.x-p.a.x,p.b.z-p.a.z);for(let d=0;d<=length;d+=.6)assert.equal(blocked({x:p.a.x+(p.b.x-p.a.x)*d/length,z:p.a.z+(p.b.z-p.a.z)*d/length}),false);}
  const actor=life.walkers[0],position=actor.root.position.clone(),bones=[];actor.root.traverse(o=>{if(o.isBone)bones.push({bone:o,before:o.quaternion.clone()});});for(let i=0;i<30;i++)life.update(1/60,{x:1000,z:1000},{x:0,z:0});assert.ok(actor.root.position.distanceTo(position)>.15);assert.ok(bones.some(b=>b.bone.quaternion.angleTo(b.before)>.02));assert.ok(Math.abs(actor.root.position.y-world.elevationAt(actor.root.position)-.135)<1e-6);
  for(let i=0;i<90;i++)life.update(1/60,actor.root.position,{x:0,z:0});assert.equal(actor.moving,false);assert.ok(actor.idle.getEffectiveWeight()>.9);
 }finally{life?.dispose();world?.dispose();GLTFLoader.prototype.loadAsync=load;THREE.TextureLoader.prototype.loadAsync=texture;if(previousDocument)globalThis.document=previousDocument;else delete globalThis.document;}
});
