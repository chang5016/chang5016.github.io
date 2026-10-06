import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { WebGPURenderer, MeshStandardNodeMaterial } from 'three/webgpu';
import { createGpuSky, createRiderGpuMotion, standardNodeMaterial, terrainVisibilityNode } from '../app/gpu-materials.ts';
import { createConcretePierMaterial } from '../app/concrete-pier-material.ts';
import { configureFacadeMaterial } from '../app/facade-relief.ts';
import { GpuShadowCache } from '../app/gpu-shadow-cache.ts';
import { MOVING_SHADOW_LAYER, STATIC_SHADOW_LAYER } from '../app/continuous-shadows.ts';

test('sky, intact atlas facades, metre-scale concrete, terrain excavation and animated rider generate native WGSL',()=>{
  const canvas={width:1,height:1,style:{},addEventListener(){},removeEventListener(){}};
  const renderer=new WebGPURenderer({canvas});
  renderer.hasFeature=()=>false;
  renderer.backend.hasFeature=()=>false;renderer.backend.hasCompatibility=()=>true;
  const source=new THREE.MeshStandardMaterial({color:'#658471',roughness:.46,metalness:.24});
  const geometry=new THREE.BoxGeometry();geometry.setAttribute('facadeGlass',new THREE.Float32BufferAttribute(Array(24).fill(.5),1));
  const rider=standardNodeMaterial(source), motion=createRiderGpuMotion(.86);rider.positionNode=motion.positionNode;rider.emissiveNode=motion.emissiveNode;
  const terrain=new MeshStandardNodeMaterial({color:'#9da195'});terrain.maskNode=terrainVisibilityNode();
  const meshes=[createGpuSky(),new THREE.Mesh(geometry,configureFacadeMaterial(source)),new THREE.Mesh(geometry,createConcretePierMaterial()),new THREE.Mesh(geometry,rider),new THREE.Mesh(geometry,terrain)];
  const outputs=meshes.map(mesh=>{
    const builder=renderer.backend.createNodeBuilder(mesh,renderer);builder.camera=new THREE.PerspectiveCamera();builder.scene=new THREE.Scene();builder.build();
    assert.match(builder.vertexShader,/@vertex/);assert.match(builder.fragmentShader,/@fragment/);
    assert.doesNotMatch(builder.fragmentShader,/varying vec|gl_FragColor|#include/);
    return {vertex:builder.vertexShader,fragment:builder.fragmentShader};
  });
  assert.match(outputs[1].vertex,/facadeGlass/);assert.match(outputs[2].fragment,/textureSample/);
  assert.match(outputs[3].vertex,/smoothstep/);assert.match(outputs[4].fragment,/discard/);
  assert.equal(rider.roughness,source.roughness);assert.equal(rider.metalness,source.metalness);assert.deepEqual(rider.color,source.color);
  meshes.forEach(mesh=>{if(mesh.geometry!==geometry)mesh.geometry.dispose();mesh.material.dispose();});geometry.dispose();source.dispose();
});

test('native shadow cache separates exact static and moving casters and invalidates for scenery revisions and anchor movement',()=>{
  const scene=new THREE.Scene(),sun=new THREE.DirectionalLight();sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-42;sun.shadow.camera.right=42;scene.add(sun,sun.target);
  const staticMesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());staticMesh.castShadow=true;scene.add(staticMesh);
  const actor=new THREE.Group();actor.userData.dynamicWorldObject=true;const vehicle=staticMesh.clone();actor.add(vehicle);scene.add(actor);
  const cache=new GpuShadowCache(scene,sun);cache.follow(0,0,0);
  assert.ok(staticMesh.layers.isEnabled(STATIC_SHADOW_LAYER));assert.ok(!staticMesh.layers.isEnabled(MOVING_SHADOW_LAYER));
  assert.ok(vehicle.layers.isEnabled(MOVING_SHADOW_LAYER));assert.ok(!vehicle.layers.isEnabled(STATIC_SHADOW_LAYER));
  assert.ok(sun.shadow.shadowNode.isNode);assert.equal(cache.staticLight.shadow.autoUpdate,false);assert.equal(cache.movingLight.shadow.autoUpdate,true);
  cache.staticLight.shadow.needsUpdate=false;cache.follow(.01,0,.01);assert.equal(cache.staticLight.shadow.needsUpdate,false);
  cache.follow(40,0,0);assert.equal(cache.staticLight.shadow.needsUpdate,true);
  cache.staticLight.shadow.needsUpdate=false;scene.userData.staticShadowRevision=1;cache.follow(40,0,0);assert.equal(cache.staticLight.shadow.needsUpdate,true);
  cache.dispose();assert.equal(staticMesh.layers.mask,1);assert.equal(vehicle.layers.mask,1);assert.equal(sun.shadow.shadowNode,undefined);
  staticMesh.geometry.dispose();staticMesh.material.dispose();
});

test('the actual game and showroom await WebGPU initialization, compile shaders and cannot report ready after initialization failure',async()=>{
  const source=await fs.readFile(new URL('../app/CommercialTaxiGame.tsx',import.meta.url),'utf8');
  assert.equal((source.match(/new WebGPURenderer\(/g)??[]).length,2);
  assert.equal((source.match(/await renderer.init\(\)/g)??[]).length,2);
  assert.doesNotMatch(source,/new THREE\.WebGLRenderer|onBeforeCompile|new THREE\.ShaderMaterial/);
  assert.match(source,/backend\.isWebGPUBackend/);assert.match(source,/nativeDeviceLost\(info\)/);
  assert.match(source,/await renderer\.compileAsync\(scene, camera\)/);
  assert.match(source,/!engineDisposed && !gpuFailed/);assert.doesNotMatch(source,/\.finally\(\(\) => \{[^}]*scenePrepared = true/s);
});
