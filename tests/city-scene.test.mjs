import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {batchCityMesh,refreshCityBatch,disposeCityBatch} from '../app/city-multidraw.ts';
import {createReliefFacade,configureFacadeMaterial} from '../app/facade-relief.ts';
import {planUrbanBlocks,subtractUrbanRect,overlapsRect} from '../app/urban-blocks.ts';
import {StaticSceneryBatches} from '../app/static-scenery-batches.ts';
import {STATIC_SHADOW_LAYER} from '../app/continuous-shadows.ts';

test('stationary scenery uses one hardware draw per family with exact visible matrices and independent shadows',()=>{
  const scene=new THREE.Scene(),root=new THREE.Group(),source=new THREE.InstancedMesh(new THREE.BoxGeometry(1,4,2),new THREE.MeshStandardMaterial(),2500);
  scene.add(root);root.add(source);source.position.set(7,0,-3);source.castShadow=true;
  const matrix=new THREE.Matrix4(),color=new THREE.Color();
  for(let i=0;i<source.count;i++){source.setMatrixAt(i,matrix.makeTranslation(i%50*20,0,-Math.floor(i/50)*20));source.setColorAt(i,color.setRGB((i%7)/7,.4,.2));}
  const batches=new StaticSceneryBatches();root.add(batches.group);assert.ok(batches.register(source));assert.equal(source.layers.mask,0);
  const camera=new THREE.PerspectiveCamera(65,1,.1,180);camera.position.set(10,8,12);camera.lookAt(50,2,-100);camera.updateMatrixWorld(true);
  const shadow=new THREE.OrthographicCamera(-70,70,70,-70,.1,200);shadow.position.set(700,100,-700);shadow.lookAt(700,0,-700);shadow.updateMatrixWorld(true);
  batches.update(camera,shadow);
  const visible=batches.group.children.find(o=>o.name.includes('visible instances')),caster=batches.group.children.find(o=>o.name.includes('shadow instances'));
  assert.equal(visible.geometry,source.geometry);assert.equal(caster.geometry,source.geometry);assert.equal(visible.material,source.material);
  assert.ok(visible.count>0&&visible.count<source.count/4);assert.equal(batches.group.userData.renderAudit.calls,1);
  assert.ok(caster.layers.isEnabled(STATIC_SHADOW_LAYER));assert.equal(caster.layers.isEnabled(0),false);assert.ok(caster.count>0);
  const original=new Map();
  for(let i=0;i<source.count;i++){source.getMatrixAt(i,matrix);matrix.premultiply(source.matrixWorld);original.set(`${matrix.elements[12]},${matrix.elements[14]}`,i);}
  for(let i=0;i<visible.count;i++){visible.getMatrixAt(i,matrix);const id=original.get(`${matrix.elements[12]},${matrix.elements[14]}`);assert.notEqual(id,undefined);visible.getColorAt(i,color);assert.ok(Math.abs(color.r-(id%7)/7)<1e-6);}
  const version=visible.instanceMatrix.version;batches.update(camera,shadow);assert.equal(visible.instanceMatrix.version,version,'An unchanged visible-cell set must not upload buffers again');
  batches.update(camera);assert.equal(caster.count,0);batches.update(camera,shadow);assert.ok(caster.count>0);
  for(let i=0;i<source.count;i++){source.getMatrixAt(i,matrix);matrix.elements[13]=4;source.setMatrixAt(i,matrix);}
  batches.invalidate();batches.update(camera,shadow);visible.getMatrixAt(0,matrix);assert.equal(matrix.elements[13],4);
  batches.clear();assert.equal(source.layers.mask,1);assert.equal(batches.group.children.length,0);
});

test('native city batching retains all triangles, photographic UVs and material attributes',()=>{
  const geometry=new THREE.PlaneGeometry(2000,2000,60,60);geometry.rotateX(-Math.PI/2);
  geometry.setAttribute('facadeGlass',new THREE.Float32BufferAttribute(Array.from({length:geometry.attributes.position.count},(_,i)=>i%2),1));
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial());mesh.castShadow=true;
  const batch=batchCityMesh(mesh);assert.ok(batch?.isBatchedMesh);assert.equal(batch.material,mesh.material);
  let triangles=0;
  for(const range of batch.userData.cityMultidraw.ranges){
    triangles+=range.geometry.index.count/3;
    for(const name of ['position','normal','uv','facadeGlass']) {
      const src=geometry.getAttribute(name),dst=range.geometry.getAttribute(name);
      range.sourceIds.forEach((id,i)=>{for(let c=0;c<src.itemSize;c++)assert.equal(dst.getComponent(i,c),src.getComponent(id,c));});
    }
  }
  assert.equal(triangles,geometry.index.count/3);assert.ok(batch.castShadow);
  disposeCityBatch(batch);geometry.dispose();mesh.material.dispose();
});

test('native city batching independently culls view and shadow cameras and refits terrain',()=>{
  const geometry=new THREE.PlaneGeometry(2000,2000,80,80);geometry.rotateX(-Math.PI/2);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial()),batch=batchCityMesh(mesh);batch.updateMatrixWorld(true);
  const camera=new THREE.PerspectiveCamera(60,1,.1,220);camera.position.set(0,15,0);camera.lookAt(0,0,-150);camera.updateMatrixWorld(true);
  batch.onBeforeRender(null,null,camera,batch.geometry,batch.material);
  const viewCount=batch._multiDrawCount,viewIndices=Array.from(batch._indirectTexture.image.data.slice(0,viewCount));
  assert.ok(viewCount>0&&viewCount<batch.instanceCount/4);
  const shadow=new THREE.OrthographicCamera(-140,140,140,-140,.1,200);shadow.position.set(700,100,0);shadow.lookAt(700,0,0);shadow.updateMatrixWorld(true);
  batch.onBeforeShadow(null,null,camera,shadow,batch.geometry,new THREE.MeshDepthMaterial());
  const shadowIndices=Array.from(batch._indirectTexture.image.data.slice(0,batch._multiDrawCount));
  assert.ok(shadowIndices.length>0);assert.ok(shadowIndices.some(id=>!viewIndices.includes(id)));
  const src=geometry.attributes.position;
  for(let i=0;i<src.count;i++)src.setY(i,3+src.getX(i)*.002);
  geometry.computeVertexNormals();refreshCityBatch(batch);
  for(const r of batch.userData.cityMultidraw.ranges)for(let i=0;i<r.sourceIds.length;i++)assert.equal(r.geometry.attributes.position.getY(i),src.getY(r.sourceIds[i]));
  assert.ok(batch.boundingBox.min.y>=.99&&batch.boundingBox.max.y<=5.01);disposeCityBatch(batch);
});

test('facade recesses keep their texture layout, bounded reveals and native PBR shading',()=>{
  const outline=[{x:0,z:0},{x:28,z:0},{x:28,z:20},{x:0,z:20},{x:0,z:0}];
  for(const style of [0,1,2,3]){
    const geometry=createReliefFacade(outline,36,0,style,5.4);geometry.computeBoundingBox();
    assert.equal(geometry.boundingBox.min.y,0);assert.equal(geometry.boundingBox.max.y,36);
    assert.ok(geometry.boundingBox.min.x>=0&&geometry.boundingBox.max.x<=28);
    assert.ok(geometry.boundingBox.min.z>=0&&geometry.boundingBox.max.z<=20);
    for(const attr of Object.values(geometry.attributes))assert.ok(Array.from(attr.array).every(Number.isFinite));
    const panes=Array.from(geometry.attributes.facadeGlass.array).filter(v=>v===1).length;
    assert.equal(panes>0,style===1||style===3);
    if(panes)assert.ok(Array.from(geometry.attributes.position.array).some(v=>Math.abs(v-(style===1?.085:.19))<1e-5));
  }
  const map=new THREE.Texture(),material=configureFacadeMaterial(new THREE.MeshStandardMaterial({map}));
  assert.equal(material.map,map);assert.equal(material.isMeshStandardNodeMaterial,true);
  const attributes=[];material.roughnessNode.traverse(node=>{if(typeof node.getAttributeName==='function')attributes.push(node.getAttributeName());});
  assert.ok(attributes.includes('facadeGlass'),'Original glass geometry controls GPU PBR roughness');
  assert.ok(material.metalnessNode?.isNode);
});

test('connected paving preserves roads, sidewalks, parks and usable planted courtyards',()=>{
  const block={left:0,right:100,back:0,front:100},cut={left:30,right:60,back:20,front:80};
  const pieces=subtractUrbanRect(block,cut),area=r=>(r.right-r.left)*(r.front-r.back);
  assert.equal(pieces.reduce((s,r)=>s+area(r),0),area(block)-area(cut));
  for(let i=0;i<pieces.length;i++)for(let j=i+1;j<pieces.length;j++)assert.equal(overlapsRect(pieces[i],pieces[j]),false);
  const streets=[{a:{x:0,z:0},b:{x:100,z:0},width:10},{a:{x:0,z:100},b:{x:100,z:100},width:10},{a:{x:0,z:0},b:{x:0,z:100},width:10},{a:{x:100,z:0},b:{x:100,z:100},width:10}];
  const reserve={left:10,right:25,back:60,front:75};
  const plan=planUrbanBlocks([0,100],[0,100],streets,[reserve],[{x:35,z:20,halfWidth:10,halfDepth:10},{x:65,z:80,halfWidth:10,halfDepth:10}]);
  assert.ok(plan.paving.length);assert.equal(plan.gardens.length,1);
  for(const r of plan.paving){assert.ok(r.left>=7.05&&r.right<=92.95&&r.back>=7.05&&r.front<=92.95);assert.equal(overlapsRect(r,reserve),false);assert.equal(overlapsRect(r,plan.gardens[0]),false);}
});
