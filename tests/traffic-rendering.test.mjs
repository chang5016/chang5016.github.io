import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readModelHierarchy} from './model-fixture.mjs';
import {createTrafficRig,updateTrafficRig} from '../app/traffic-rig.ts';
import {createTrafficMotion} from '../app/traffic-dynamics.ts';
import {TrafficRenderBatches} from '../app/traffic-render-batches.ts';
import {MOVING_SHADOW_LAYER} from '../app/continuous-shadows.ts';

test('a visible fleet retains all authored vertices and moving wheels with fewer submissions',async()=>{
  const {group:template}=await readModelHierarchy(new URL('../public/models/traffic-real/tesla.glb',import.meta.url).pathname);
  const scene=new THREE.Scene(),batches=new TrafficRenderBatches();scene.add(batches.group);
  const rigs=[];
  for(let i=0;i<12;i++){
    const owner=new THREE.Group(),rig=createTrafficRig(template,i%2?'car':'taxi',i),motion=createTrafficMotion();
    owner.position.set((i%3)*6-6,0,-Math.floor(i/3)*8);owner.add(rig.root);scene.add(owner);
    motion.distance=-i*10;motion.steer=.2;motion.acceleration=i%2?-2:1;updateTrafficRig(rig,motion,'car',1);
    batches.register(owner,rig);rigs.push(rig);
  }
  const camera=new THREE.PerspectiveCamera(70,1,.1,250);camera.position.set(0,12,18);camera.lookAt(0,0,-12);
  const lightCamera=new THREE.OrthographicCamera(-50,50,50,-50,.1,150);lightCamera.position.set(0,80,0);lightCamera.up.set(0,0,-1);lightCamera.lookAt(0,0,0);
  batches.update(camera,lightCamera);
  const audit=batches.group.userData.renderAudit;
  assert.equal(audit.vehicles,12);assert.ok(audit.drawCalls<=audit.sourceCalls/8,JSON.stringify(audit));
  assert.equal(audit.geometrySimplified,false);
  assert.equal(audit.shadowVehicles,12);
  for(const batch of batches.group.children.filter(o=>o.layers.mask===1)) {
    assert.deepEqual(batch.instanceMatrix.updateRanges,[{start:0,count:batch.count*16}],'Upload only the live matrix prefix, not all 256 reserved slots');
    assert.deepEqual(batch.instanceColor.updateRanges,[{start:0,count:batch.count*3}]);
  }
  const sourceMeshes=[];rigs.forEach(r=>r.root.traverse(o=>{if(o.isMesh)sourceMeshes.push(o);}));
  const triangles=sourceMeshes.reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
  assert.equal(audit.triangles,triangles,'Every original triangle remains in the submitted fleet');
  assert.equal(audit.shadowTriangles,triangles,'Native shadow casters preserve the same complete meshes');
  for(const batch of batches.group.children.filter(o=>o.layers.isEnabled(MOVING_SHADOW_LAYER))) {
    assert.deepEqual(batch.instanceMatrix.updateRanges,[{start:0,count:batch.count*16}]);
  }
  assert.ok(audit.uploadedMatrixFloats<audit.drawCalls*256*16*.1,'Both passes together upload under 10% of the old full-capacity matrix buffers');
  const matrix=new THREE.Matrix4();
  for(const wheel of rigs[1].wheels){
    const mesh=wheel.roll.children.find(o=>o.isMesh)??wheel.roll.getObjectByProperty('isMesh',true);
    const batch=batches.group.children.find(o=>o.name===mesh.name+' / shared traffic');assert.ok(batch);
    let matched=false;for(let i=0;i<batch.count;i++){batch.getMatrixAt(i,matrix);if(matrix.elements.every((x,j)=>Math.abs(x-mesh.matrixWorld.elements[j])<1e-5))matched=true;}
    assert.ok(matched,'Instanced wheels keep their actual animated axle transform');
  }
  const lamps=batches.group.children.filter(o=>o.geometry.getAttribute('trafficEmission'));
  assert.ok(lamps.some(o=>Array.from(o.geometry.getAttribute('trafficEmission').array).some(n=>n>2)));
  for(const batch of batches.group.children)assert.ok(sourceMeshes.some(m=>m.geometry.attributes.position===batch.geometry.attributes.position),'Original vertex buffers are shared, not simplified');
  assert.ok(sourceMeshes.every(m=>m.visible),'Hiding a submitted part must not hide rider children');
  batches.dispose();assert.ok(sourceMeshes.every(m=>m.layers.mask===1));
  console.log('Fleet submission audit:',JSON.stringify(audit));
});
test('offscreen vehicles cast native shadows without entering the expensive color pass',()=>{
  const batches=new TrafficRenderBatches(),geometry=new THREE.BoxGeometry(2,2,4),material=new THREE.MeshStandardMaterial();
  for(const z of [-20,40,1000]){const owner=new THREE.Group(),root=new THREE.Group(),mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;root.add(mesh);owner.position.z=z;owner.add(root);batches.register(owner,{root});}
  const camera=new THREE.PerspectiveCamera(60,1,.1,100);camera.lookAt(0,0,-20);
  const lightCamera=new THREE.OrthographicCamera(-50,50,50,-50,.1,150);lightCamera.position.set(0,80,0);lightCamera.up.set(0,0,-1);lightCamera.lookAt(0,0,0);
  batches.update(camera,lightCamera);
  const audit=batches.group.userData.renderAudit;
  assert.equal(audit.vehicles,1);assert.equal(audit.shadowVehicles,2);
  const color=batches.group.children.find(o=>o.layers.mask===1),shadow=batches.group.children.find(o=>o.layers.isEnabled(MOVING_SHADOW_LAYER));
  assert.equal(color.count,1);assert.equal(shadow.count,2);assert.equal(color.castShadow,false);assert.equal(shadow.castShadow,true);
  assert.equal(shadow.geometry,color.geometry,'Separate passes share the complete original mesh');
  assert.notEqual(shadow.instanceMatrix,color.instanceMatrix,'Shadow and color draws cannot overwrite each other within a frame');
  batches.dispose();
});
