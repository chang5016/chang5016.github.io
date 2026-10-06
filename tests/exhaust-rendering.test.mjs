import test from 'node:test';import assert from 'node:assert/strict';import * as T from 'three';
import {ScooterExhaust} from '../app/driving-effects.ts';import {createVehicle} from '../app/game-core.ts';import {freezeStaticScene} from '../app/static-scene.ts';import {createHeadlessDocument} from './headless-document.mjs';
import {readModelGeometry} from './model-fixture.mjs';import {SCOOTER_EXHAUST_OUTLET} from '../app/scooter-wheel-layout.ts';

test('smoke starts at the original model tailpipe through heading, lean, pitch and interpolated height',async()=>{
 const {group:model}=await readModelGeometry(new URL('../public/models/capybara-premium-original.glb',import.meta.url).pathname);
 const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3()),centre=bounds.getCenter(new T.Vector3()),scale=3.45/Math.max(size.x,size.z);
 model.scale.setScalar(scale);model.rotation.y=Math.PI*1.5;centre.applyAxisAngle(new T.Vector3(0,1,0),model.rotation.y);model.position.set(-centre.x*scale,-bounds.min.y*scale+.035,-centre.z*scale);
 const hero=new T.Group();hero.add(model);const camera=new T.PerspectiveCamera(),previous=globalThis.document;globalThis.document=createHeadlessDocument();
 try{for(const heading of [0,Math.PI/2,-1.7]){
  hero.position.set(83,8.6,-72);hero.rotation.set(.06,-heading,-.09);hero.updateMatrixWorld(true);
  const outlet=model.localToWorld(new T.Vector3(SCOOTER_EXHAUST_OUTLET.x,SCOOTER_EXHAUST_OUTLET.y,SCOOTER_EXHAUST_OUTLET.z));
  const scene=new T.Scene(),exhaust=new ScooterExhaust(scene),rider={...createVehicle(),x:83,z:-72,heading,throttle:1};
  for(let i=0;i<5;i++)exhaust.update(rider,8.6,1/60,false,camera,outlet);
  const puffs=scene.getObjectByName('Animated scooter exhaust particles'),matrix=new T.Matrix4();puffs.getMatrixAt(0,matrix);
  const emitted=new T.Vector3().setFromMatrixPosition(matrix);assert.ok(Math.abs(matrix.determinant())>1e-8);
  assert.ok(emitted.distanceTo(outlet)<.09,'World-space emission follows the actual tailpipe instead of the scooter centre');
  const backward=new T.Vector3(-Math.sin(heading),0,Math.cos(heading));assert.ok(outlet.clone().sub(hero.position).dot(backward)>.9,'The exhaust outlet is behind the scooter');
  exhaust.dispose();
 }}finally{if(previous)globalThis.document=previous;else delete globalThis.document;}
});
test('world-sized exhaust remains live after static freezing and follows the camera and rear outlet',()=>{
 const previous=globalThis.document;globalThis.document=createHeadlessDocument();const scene=new T.Scene(),exhaust=new ScooterExhaust(scene);
 try{const camera=new T.PerspectiveCamera();camera.rotation.y=.7;const rider={...createVehicle(),x:12,z:8,heading:Math.PI/2,throttle:1};freezeStaticScene(scene);exhaust.update(rider,6,.08,false,camera);
 const puffs=scene.getObjectByName('Animated scooter exhaust particles');assert.ok(puffs.isInstancedMesh&&puffs.userData.dynamicWorldObject);let visible=0;
 const check=()=>{const m=new T.Matrix4(),p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();let count=0;for(let i=0;i<puffs.count;i++){puffs.getMatrixAt(i,m);if(Math.abs(m.determinant())<1e-8)continue;m.decompose(p,q,s);count++;assert.ok(s.x>.1&&s.x<.25,'Subtle tailpipe smoke must not cover the scooter');assert.ok(p.y>6.4&&p.y<6.8);assert.ok(p.x<rider.x-1.4);assert.ok(q.angleTo(camera.quaternion)<.001);}assert.ok(count>0);return count;};
 visible=check();assert.ok(visible>0);camera.rotation.y=-.5;exhaust.update(rider,6,.01,false,camera);check();
 }finally{exhaust.dispose();if(previous)globalThis.document=previous;else delete globalThis.document;}
});
