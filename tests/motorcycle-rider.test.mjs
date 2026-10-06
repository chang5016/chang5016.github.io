import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createMotorcycleRider} from '../app/motorcycle-rider.ts';
import {createTrafficRig,updateTrafficRig} from '../app/traffic-rig.ts';
import {createTrafficMotion} from '../app/traffic-dynamics.ts';
import {readModelHierarchy} from './model-fixture.mjs';
import WebGPUAttributeUtils from 'three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js';
import {TrafficRenderBatches} from '../app/traffic-render-batches.ts';
import {freezeStaticScene} from '../app/static-scene.ts';
import {GpuShadowCache} from '../app/gpu-shadow-cache.ts';
import {ExactStaticMeshes} from '../app/exact-static-meshes.ts';
import {PackedCityBatches} from '../app/packed-city-batches.ts';

globalThis.ProgressEvent??=class{constructor(type,data){Object.assign(this,data);}};
const directory=new URL('../public/models/motorcycle-rider/',import.meta.url);
async function riderTemplate(){
  const bytes=await fs.readFile(new URL('bear-riding.glb',directory)),length=bytes.readUInt32LE(12);
  const data=JSON.parse(bytes.toString('utf8',20,20+length));
  data.buffers[0].uri='data:application/octet-stream;base64,'+bytes.subarray(28+length).toString('base64');
  delete data.images;delete data.textures;
  for(const material of data.materials)delete material.pbrMetallicRoughness.baseColorTexture;
  return(await new GLTFLoader().parseAsync(JSON.stringify(data),'')).scene;
}
function update(root){root.updateMatrixWorld(true);root.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.update();});}
const bone=(model,name)=>model.getObjectByName(T.PropertyBinding.sanitizeNodeName(name));

test('new biped rider keeps its natural bone lengths and reaches the enlarged real motorcycle',async()=>{
  const template=await riderTemplate(),{group:bike}=await readModelHierarchy(new URL('../public/models/traffic-real/motorcycle.glb',import.meta.url).pathname);
  const rig=createTrafficRig(bike,'motorcycle',0),{model}=createMotorcycleRider(template,0);rig.body.add(model);
  update(rig.root);
  const seat=bone(model,'Tailbone').getWorldPosition(new T.Vector3());
  assert.ok(seat.distanceTo(rig.body.localToWorld(new T.Vector3(0,.84,.08)))<.002,'Seat stays aligned with the authored bike coordinates');
  for(const [side,sign]of [['L',-1],['R',1]]){
    const hand=bone(model,`Forearm.${side}_end`).getWorldPosition(new T.Vector3());
    const foot=bone(model,`Foot.${side}`).getWorldPosition(new T.Vector3());
    assert.ok(hand.distanceTo(rig.body.localToWorld(new T.Vector3(sign*.31,.96,-.43)))<.006,'Native arms reach both grips');
    assert.ok(foot.distanceTo(rig.body.localToWorld(new T.Vector3(sign*.24,.43,.14)))<.006,'Native legs reach both footrests');
  }
  let bones=0,vertices=0;
  model.traverse(o=>{
    if(o.isBone){bones++;for(const value of o.scale.toArray())assert.ok(Math.abs(value-1)<.00005,'No limb can be elongated to hide a proportion mismatch');}
    if(o.isSkinnedMesh){vertices+=o.geometry.attributes.position.count;const weights=o.geometry.attributes.skinWeight;
      for(let i=0;i<weights.count;i++)assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<.00001,'Every rounded surface vertex has valid skin weights');
    }
  });
  assert.equal(bones,18);assert.ok(vertices<8500,'Rounded biped uses fewer skin vertices than the previous bear');
  const bounds=new T.Box3().setFromObject(model,true);assert.ok(Math.abs(bounds.max.y-seat.y-1.52)<.01,'Crown height matches the original player scale');
  const motion=createTrafficMotion();motion.pitch=.035;motion.heave=.04;motion.steer=.25;motion.distance=-20;
  updateTrafficRig(rig,motion,'motorcycle',1);update(rig.root);
  const leftHand=bone(model,'Forearm.L_end').getWorldPosition(new T.Vector3());
  assert.ok(leftHand.distanceTo(rig.body.localToWorld(new T.Vector3(-.31,.96,-.43)))<.006,'Suspension and chassis pitch cannot separate the hands from the handlebars');
});

test('rider instances animate independently while sharing complete mesh and texture buffers',async()=>{
  const template=await riderTemplate(),a=createMotorcycleRider(template,0),b=createMotorcycleRider(template,1);
  const world=new T.Group();world.add(a.model,b.model);b.model.position.set(6,0,0);b.model.rotation.y=.7;update(world);
  const original=bone(b.model,'Head').quaternion.clone();bone(a.model,'Head').rotation.y+=.1;update(world);
  assert.ok(bone(b.model,'Head').quaternion.equals(original));assert.notEqual(bone(a.model,'Head'),bone(b.model,'Head'));
  const first=[],second=[];a.model.traverse(o=>{if(o.isSkinnedMesh)first.push(o);});b.model.traverse(o=>{if(o.isSkinnedMesh)second.push(o);});
  assert.equal(first.length,1,'One rounded skin draw per rider');
  first.forEach((mesh,i)=>{assert.equal(mesh.geometry,second[i].geometry);assert.notEqual(mesh.skeleton,second[i].skeleton);assert.notEqual(mesh.material,second[i].material);assert.ok(mesh.boundingSphere.radius>0);});
});

test('native WebGPU shadow uploads cannot corrupt the rider vertex color format',async()=>{
  const template=await riderTemplate(),original=template.getObjectByName('Rounded_native_bear_skin');
  // This is the actual exported layout, which previously failed after the
  // shadow pass uploaded joints before the color pass uploaded vertex colors.
  assert.equal(original.geometry.attributes.skinIndex.data,original.geometry.attributes.color.data);
  const {model}=createMotorcycleRider(template,0),skin=model.getObjectByName('Rounded_native_bear_skin');
  const a=skin.geometry.attributes,attributes=['position','normal','skinIndex','skinWeight','color','uv'].map(name=>a[name]);
  const colorBytes=a.color.array.slice(),nativeAttributes=original.geometry.attributes;
  const buffers=new WeakMap();
  const backend={
    get(attribute){if(!buffers.has(attribute))buffers.set(attribute,{});return buffers.get(attribute);},
    device:{createBuffer(descriptor){const memory=new ArrayBuffer(descriptor.size);return{getMappedRange:()=>memory,unmap(){}};}}
  };
  globalThis.GPUBufferUsage??={INDEX:16,VERTEX:32};
  const gpu=new WebGPUAttributeUtils(backend);
  for(const name of ['position','skinIndex','skinWeight'])gpu.createAttribute(a[name],GPUBufferUsage.VERTEX);
  for(const attribute of attributes)gpu.createAttribute(attribute,GPUBufferUsage.VERTEX);
  const layouts=gpu.createShaderVertexBuffers({getAttributes:()=>attributes});
  const binding=slot=>layouts.flatMap(layout=>layout.attributes).find(attribute=>attribute.shaderLocation===slot);
  assert.equal(binding(2).format,'uint32x4','Joints upload to a separate integer buffer');
  assert.equal(binding(4).format,'unorm8x4','Colors retain a supported normalized GPU format after shadow upload');
  assert.deepEqual(a.color.array,colorBytes,'The shadow pass cannot change vertex colors');
  for(const name of ['position','normal','skinIndex','skinWeight','color','uv']){
    const actual=a[name],expected=nativeAttributes[name];
    assert.equal(actual.count,expected.count);
    for(let vertex=0;vertex<actual.count;vertex++)for(let component=0;component<actual.itemSize;component++)
      assert.equal(actual.getComponent(vertex,component),expected.getComponent(vertex,component),`${name} remains intact`);
  }
  assert.deepEqual(skin.geometry.index.array,original.geometry.index.array,'All authored triangles remain intact');
});

test('riders remain visible with real traffic batches, frozen scenery and metro height transforms',async()=>{
  const template=await riderTemplate(),{group:bike}=await readModelHierarchy(new URL('../public/models/traffic-real/motorcycle.glb',import.meta.url).pathname);
  const scene=new T.Scene(),world=new T.Group(),owner=new T.Group(),visual=new T.Group();
  owner.userData.dynamicWorldObject=true;scene.add(world);world.add(owner);owner.add(visual);
  const rig=createTrafficRig(bike,'motorcycle',0),{model}=createMotorcycleRider(template,0);visual.add(rig.root);rig.body.add(model);
  const skin=model.getObjectByName('Rounded_native_bear_skin'),sun=new T.DirectionalLight();scene.add(sun,sun.target);
  const shadows=new GpuShadowCache(scene,sun),batches=new TrafficRenderBatches(),exact=new ExactStaticMeshes(scene),packed=new PackedCityBatches(scene);
  world.add(batches.group);batches.register(owner,rig);freezeStaticScene(world);
  const camera=new T.PerspectiveCamera(60,16/9,.1,1600),frustum=new T.Frustum(),projection=new T.Matrix4();
  for(const [x,height,z,heading]of [[-72,0,-112,0],[-72,30,-794,.7],[600,30,-794,Math.PI], [1830,61,510,-Math.PI/2]]){
    owner.position.set(x,height,z);owner.rotation.y=heading;camera.position.set(x+4,height+3,z-8);camera.lookAt(x,height+1.5,z);camera.updateMatrixWorld();
    shadows.follow(x,height,z);batches.update(camera,sun.shadow.camera);exact.update();packed.update(camera,sun.shadow.camera);update(scene);
    frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),camera.coordinateSystem);
    assert.ok(skin.layers.test(camera.layers),'The rider stays on the main color layer');
    assert.ok(frustum.intersectsObject(skin),'A visible motorcycle has a visible rider bounding volume');
    for(let ancestor=skin;ancestor;ancestor=ancestor.parent)assert.equal(ancestor.visible,true);
    const bounds=new T.Box3().setFromObject(model,true),seat=bone(model,'Tailbone').getWorldPosition(new T.Vector3());
    assert.ok(Math.abs(bounds.max.y-seat.y-1.52)<.01,'Skin stays on the seat on roads and raised platforms');
    assert.ok(!skin.userData.packedStaticSource,'Animated skin is not hidden by static geometry packing');
  }
  packed.dispose();exact.dispose();batches.dispose();shadows.dispose();
});

test('published rider has traceable downloaded source and retains its native biped skeleton',async()=>{
  const metadata=JSON.parse(await fs.readFile(new URL('sources.json',directory),'utf8'));
  const source=await fs.readFile(new URL(metadata.sourceFile,directory)),asset=await fs.readFile(new URL(metadata.file,directory));
  assert.equal(createHash('sha256').update(source).digest('hex'),metadata.sourceSha256);
  assert.equal(createHash('sha256').update(asset).digest('hex'),metadata.sha256);
  assert.match(metadata.page,/sketchfab\.com\/3d-models\/cubed-bear-/);assert.equal(metadata.author,'CubedBear');
  assert.equal(metadata.sourceVertices,176);assert.equal(metadata.sourceTriangles,296);
  assert.ok(metadata.pose.maxContactError<.006);assert.ok(metadata.pose.largestBoneScale<1.00005);
});
