import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ExactStaticMeshes } from '../app/exact-static-meshes.ts';
import { PackedCityBatches } from '../app/packed-city-batches.ts';
import { GpuShadowCache } from '../app/gpu-shadow-cache.ts';
import { freezeStaticScene, invalidateShadowScene } from '../app/static-scene.ts';

function parcel() {
  const scene=new THREE.Scene(),root=new THREE.Group(),material=new THREE.MeshStandardMaterial(),sources=[];
  material.map=new THREE.Texture();scene.add(root);
  for(let i=0;i<5;i++) {
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(3,8,4),material);
    mesh.position.set(i*180,4,-i*40);mesh.rotation.y=i*.2;mesh.scale.set(1+i*.1,1,1);
    mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);sources.push(mesh);
  }
  freezeStaticScene(root);return {scene,root,material,sources};
}

function triangleAttributes(mesh,worldMatrix) {
  const {geometry}=mesh,p=geometry.attributes.position,n=geometry.attributes.normal,uv=geometry.attributes.uv;
  const normalMatrix=new THREE.Matrix3().getNormalMatrix(worldMatrix),point=new THREE.Vector3(),normal=new THREE.Vector3(),triangles=[];
  for(let t=0;t<geometry.index.count;t+=3) {
    const vertices=[];
    for(let v=0;v<3;v++) {
      const id=geometry.index.getX(t+v);point.fromBufferAttribute(p,id).applyMatrix4(worldMatrix);normal.fromBufferAttribute(n,id).applyNormalMatrix(normalMatrix);
      vertices.push([...point,...normal,uv.getX(id),uv.getY(id)]);
    }
    triangles.push(vertices.flat());
  }
  return triangles;
}

test('frozen prop batching retains the same world-space triangles, normals, original material and unstretched UVs',()=>{
  const {scene,material,sources}=parcel(),expected=sources.flatMap(mesh=>triangleAttributes(mesh,mesh.matrixWorld));
  const exact=new ExactStaticMeshes(scene);exact.update();
  assert.equal(exact.audit.sources,5);assert.equal(exact.audit.families,1);assert.equal(exact.audit.triangles,60);assert.equal(exact.audit.geometrySimplified,false);
  const batch=exact.group.children[0];assert.equal(batch.material,material);assert.equal(batch.material.map,material.map);
  const actual=triangleAttributes({geometry:batch.userData.cityMultidraw.source},new THREE.Matrix4());assert.equal(actual.length,expected.length);
  for(let t=0;t<expected.length;t++)for(let c=0;c<24;c++) {
    const tolerance=c%8<3?1e-4:1e-6;
    assert.ok(Math.abs(actual[t][c]-expected[t][c])<tolerance,`Triangle ${t} component ${c} keeps its authored position/normal/UV to float32 precision`);
  }
  assert.ok(sources.every(mesh=>mesh.layers.mask===0));
  const revision=scene.userData.staticShadowRevision;for(let i=0;i<100;i++)exact.update();assert.equal(scene.userData.staticShadowRevision,revision);assert.equal(exact.group.children[0],batch);
  exact.dispose();assert.ok(sources.every(mesh=>mesh.layers.mask===1&&!mesh.userData.packedStaticSource));
});

test('replacing or hiding streamed props removes their exact packed copies without reviving hidden originals in shadow classification',()=>{
  const {scene,root,sources}=parcel(),sun=new THREE.DirectionalLight();scene.add(sun,sun.target);
  const cache=new GpuShadowCache(scene,sun);cache.follow(0,0,0);
  const exact=new ExactStaticMeshes(scene),packed=new PackedCityBatches(scene);exact.update();cache.follow(0,0,0);
  assert.ok(sources.every(mesh=>mesh.layers.mask===0));
  const camera=new THREE.PerspectiveCamera(60,1,.1,1500);camera.position.set(0,50,40);camera.lookAt(300,0,-60);camera.updateMatrixWorld(true);packed.update(camera,sun.shadow.camera);
  const first=exact.group.children[0];sources[0].removeFromParent();invalidateShadowScene(scene);exact.update();packed.update(camera,sun.shadow.camera);cache.follow(0,0,0);
  assert.equal(first.parent,null);assert.equal(exact.audit.sources,4);assert.equal(packed.audit.families,1);assert.equal(exact.audit.triangles,48);
  assert.equal(exact.group.children[0].userData.cityMultidraw.source.attributes.position.count,4*24);
  root.visible=false;invalidateShadowScene(scene);exact.update();packed.update(camera,sun.shadow.camera);assert.equal(packed.audit.families,0);assert.equal(exact.audit.sources,0);
  root.visible=true;invalidateShadowScene(scene);exact.update();packed.update(camera,sun.shadow.camera);assert.equal(packed.audit.families,1);
  packed.dispose();exact.dispose();cache.dispose();assert.ok(sources.every(mesh=>mesh.layers.isEnabled(0)));
});

test('animated, mirrored, custom-shader, transparent and callback-controlled objects retain their independent rendering',()=>{
  const {scene,root,material,sources}=parcel();
  const exclusions=[];
  function add(m=material){const mesh=new THREE.Mesh(new THREE.BoxGeometry(),m);root.add(mesh);mesh.updateWorldMatrix(true,false);mesh.matrixAutoUpdate=false;mesh.matrixWorldAutoUpdate=false;exclusions.push(mesh);return mesh;}
  const dynamic=new THREE.Group();dynamic.userData.dynamicWorldObject=true;scene.add(dynamic);const moving=add();dynamic.add(moving);
  add(new THREE.MeshStandardMaterial({transparent:true,opacity:.5}));
  add(new THREE.ShaderMaterial());
  add().onBeforeRender=()=>{};
  add().matrixAutoUpdate=true;
  const mirrored=add();mirrored.scale.x=-1;mirrored.updateMatrix();mirrored.updateWorldMatrix(true,false);
  add().geometry.morphAttributes.position=[new THREE.Float32BufferAttribute(Array(24*3).fill(0),3)];
  const exact=new ExactStaticMeshes(scene);exact.update();assert.equal(exact.audit.sources,sources.length);assert.ok(exclusions.every(mesh=>mesh.layers.mask===1));exact.dispose();
});
