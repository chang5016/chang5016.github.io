import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {ENGINE_LAYERS,stepEngineSound} from '../app/scooter-engine-sound.ts';
import {ScooterAudio} from '../app/driving-effects.ts';
import {streetPropFootprint,streetPropFits,planStreetProps,combineStreetPropMeshes,createStreetPropInstances} from '../app/street-props.ts';
import {RealWorldMap} from '../app/real-world-map.ts';
import {GridForgeCityGrid} from '../app/gridforge-city-grid.ts';

const root=new URL('../',import.meta.url);
test('recorded loops have continuous seams, audible headroom and no clipping',async()=>{
  const report=JSON.parse(await readFile(new URL('public/audio/scooter-recordings.json',root),'utf8'));
  let total=0;
  for(const {name:kind} of ENGINE_LAYERS){
    const wav=await readFile(new URL(`public/audio/scooter-${kind}.wav`,root));total+=wav.length;
    assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt32LE(24),44100);assert.equal(wav.readUInt16LE(34),16);
    let square=0,peak=0;for(let offset=44;offset<wav.length;offset+=2){const sample=wav.readInt16LE(offset)/32768;square+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
    assert.ok(peak<.9&&peak>.4);assert.ok(Math.sqrt(square/((wav.length-44)/2))>.1);
    assert.ok(Math.abs(wav.readInt16LE(44)-wav.readInt16LE(wav.length-2))/32768<.001);
    assert.equal(createHash('sha256').update(wav).digest('hex'),report.loops[kind].sha256);
  }
  assert.ok(total<8000000);
  for(const layer of Object.values(report.loops)){assert.ok(layer.seconds>16);assert.ok(layer.envelopeVariation<.08, 'Recorded throttle swells must not repeat inside a sustain loop');}
  assert.equal(new Set(Object.values(report.loops).map(x=>x.seconds)).size,4);
});

test('CVT engine responds to load smoothly at different render rates, with quiet coasting',()=>{
  const simulate=hz=>{let s={rpm:1700,load:0};for(let i=0;i<hz;i++)s=stepEngineSound(s,12,1,false,1/hz);return s;};
  const a=simulate(30),b=simulate(120);assert.ok(Math.abs(a.rpm-b.rpm)<1e-6);assert.ok(a.rpm>4500);
  const immediate=stepEngineSound({rpm:1700,load:0},0,1,false,1/60);assert.ok(immediate.rpm<2000);
  const idle=stepEngineSound({rpm:1700,load:0},0,0,false,1/60);assert.equal(idle.windGain,0);assert.equal(idle.tyreGain,0);
  let coast=a;for(let i=0;i<120;i++)coast=stepEngineSound(coast,0,0,false,1/60);assert.ok(coast.rpm<1720&&coast.load<.001);
  assert.ok(coast.layers[0].gain>.38&&coast.layers[3].gain<.01);assert.ok(a.layers.every(layer=>layer.rate<2)&&a.windGain<.017);
  for(const rpm of [3000,4000,5000,6000]){const s=stepEngineSound({rpm,load:1},12,1,false,0);assert.ok(s.layers.filter(x=>x.gain>.08).length>=2,'Acceleration must crossfade real timbres, not only pitch one recording');assert.ok(Math.abs(Math.hypot(...s.layers.map(x=>x.gain))-.72)<1e-8);}
  const coastSame=stepEngineSound({rpm:4700,load:0},12,0,false,0),pullSame=stepEngineSound({rpm:4700,load:1},12,1,false,0);
  assert.ok(pullSame.layers[2].gain/coastSame.layers[2].gain>2,'Exhaust timbre changes with load independently of speed');
  assert.ok(stepEngineSound({rpm:1700,load:0},30,1,true,50).rpm<4000);
});

class Param {value=0;cancelScheduledValues(){}setTargetAtTime(v){this.value=v;}setValueAtTime(v){this.value=v;}exponentialRampToValueAtTime(v){this.value=v;}}
class AudioNode {gain=new Param();frequency=new Param();Q=new Param();playbackRate=new Param();threshold=new Param();knee=new Param();ratio=new Param();attack=new Param();release=new Param();positionX=new Param();positionY=new Param();positionZ=new Param();connect(){return this;}disconnect(){}start(){this.started=true;}stop(){this.stopped=true;}}
class Context {
  state='running';currentTime=0;sampleRate=44100;destination=new AudioNode();listener={};sources=[];oscillators=0;
  createBufferSource(){const n=new AudioNode();this.sources.push(n);return n;}
  createGain(){return new AudioNode();}createBiquadFilter(){return new AudioNode();}createPanner(){return new AudioNode();}createDynamicsCompressor(){return new AudioNode();}
  createOscillator(){this.oscillators++;return new AudioNode();}createBuffer(c,length){const data=new Float32Array(length);return {length,getChannelData:()=>data};}
  async decodeAudioData(){return {duration:3};}async resume(){this.state='running';}async close(){this.state='closed';}
}

test('audio starts recorded layers once, changes pitch with load and disposes all loops',async()=>{
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch;let requests=0;globalThis.window={AudioContext:Context};globalThis.fetch=async()=>{requests++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
  const audio=new ScooterAudio();
  try{
    audio.start();const ctx=audio.context;audio.start();await audio.loading;
    assert.equal(requests,7);assert.equal(ctx.oscillators,0);assert.equal(ctx.sources.length,6);assert.ok(ctx.sources.every(s=>s.started));
    const before=audio.voices[2].source.playbackRate.value;for(let i=0;i<90;i++){ctx.currentTime+=1/60;audio.update(15,1,false);}
    assert.ok(audio.voices[2].source.playbackRate.value>before);assert.ok(audio.voices.filter(voice=>voice.gain.gain.value>.15).length>=2);
    assert.equal(ctx.sources.length,7,'Held acceleration triggers one attack only');
    const loops=audio.voices.map(v=>v.source),first=ctx.sources.at(-1);
    ctx.currentTime+=.1;audio.update(15,0,false);assert.ok(first.stopped);
    ctx.currentTime+=.5;audio.update(15,1,false);const second=ctx.sources.at(-1);
    assert.notEqual(first.buffer,second.buffer,'Consecutive presses use different actual takes');
    assert.deepEqual(audio.voices.map(v=>v.source),loops,'Sustain loops never restart');
    const count=ctx.sources.length;for(let i=0;i<180;i++){ctx.currentTime+=1/60;audio.update(15,1,false);}assert.equal(ctx.sources.length,count,'Holding acceleration cannot repeat the transient');
    audio.dispose();assert.ok(ctx.sources.every(s=>s.stopped));assert.equal(ctx.state,'closed');
  }finally{audio.dispose();globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});

test('late recording downloads cannot restart audio after leaving the game',async()=>{
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch,resolvers=[];globalThis.window={AudioContext:Context};globalThis.fetch=()=>new Promise(resolve=>resolvers.push(resolve));
  const audio=new ScooterAudio();
  try{audio.start();const ctx=audio.context,task=audio.loading;audio.dispose();resolvers.forEach(resolve=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}));await task;assert.equal(ctx.sources.length,1);assert.ok(ctx.sources[0].stopped);assert.equal(audio.voices.length,0);}
  finally{globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});

async function assetScene(kind){
  const doc=await new NodeIO().read(new URL(`public/models/street-props/${kind}.glb`,root).pathname),group=new THREE.Group(),materials=new Map();
  for(const node of doc.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
    const geometry=new THREE.BufferGeometry();
    for(const [semantic,name] of [['POSITION','position'],['NORMAL','normal'],['TEXCOORD_0','uv']]){const a=primitive.getAttribute(semantic);if(a)geometry.setAttribute(name,new THREE.BufferAttribute(a.getArray().slice(),a.getElementSize()));}
    const index=primitive.getIndices();if(index)geometry.setIndex(new THREE.BufferAttribute(index.getArray().slice(),1));
    const sourceMaterial=primitive.getMaterial();if(!materials.has(sourceMaterial))materials.set(sourceMaterial,new THREE.MeshStandardMaterial());
    const mesh=new THREE.Mesh(geometry,materials.get(sourceMaterial));mesh.matrix.fromArray(node.getWorldMatrix());mesh.matrix.decompose(mesh.position,mesh.quaternion,mesh.scale);group.add(mesh);
  }
  return {doc,group};
}

test('complete stock assets preserve geometry and PBR maps, and instances share original detail',async()=>{
  const audit=JSON.parse(await readFile(new URL('public/models/street-props/integrity.json',root),'utf8'));
  for(const kind of ['bench','hydrant','pot','plant']){
    const {doc,group}=await assetScene(kind);const before=new THREE.Box3().setFromObject(group);assert.ok(Math.abs(before.min.y)<1e-5);
    const expected=audit[kind];assert.ok(before.min.distanceTo(new THREE.Vector3(...expected.bounds.min))<1e-5);assert.ok(before.max.distanceTo(new THREE.Vector3(...expected.bounds.max))<1e-5);
    for(const m of doc.getRoot().listMaterials()){assert.ok(m.getBaseColorTexture());assert.ok(m.getNormalTexture());assert.ok(m.getMetallicRoughnessTexture());}
    assert.ok(expected.textureDimensions.every(d=>d[0]===2048&&d[1]===2048));
    const merged=combineStreetPropMeshes(group);let triangles=0;merged.traverse(o=>{if(o.isMesh)triangles+=o.geometry.index.count/3;});assert.equal(triangles,expected.triangles);
    if(kind==='hydrant')assert.equal(merged.children.length,1);
    const props=[{kind:'bench',x:10,z:20,y:.135,angle:0},{kind:'bench',x:300,z:20,y:.135,angle:0}];
    const batches=createStreetPropInstances(new Map([['bench',merged]]),props,()=>2);
    assert.equal(batches.children.length,2*merged.children.length);const matrix=new THREE.Matrix4();batches.children[0].getMatrixAt(0,matrix);assert.ok(Math.abs(matrix.elements[13]-2.135)<1e-5);
    assert.equal(batches.children[0].geometry,batches.children[merged.children.length].geometry);
  }
});

test('furniture avoids roads, walls, crossings and steep ground while keeping paired shop plants',()=>{
  const streets=[{a:{x:-90,z:0},b:{x:90,z:0},width:10},{a:{x:0,z:-90},b:{x:0,z:90},width:10}];
  const buildings=[{x:40,z:14,halfWidth:20,halfDepth:5}];
  const props=planStreetProps(streets,buildings,[],()=>0,()=>false);assert.ok(props.length>0);
  for(let i=0;i<props.length;i++)assert.ok(streetPropFits(props[i],streets,buildings,[],props.slice(0,i),()=>0,()=>false));
  assert.equal(streetPropFits({kind:'bench',x:40,z:14,angle:0,y:.135},streets,buildings,[],[],()=>0,()=>false),false);
  assert.equal(streetPropFits({kind:'bench',x:40,z:5.57,angle:0,y:.135},streets,[],[],[],p=>p.x*.2,()=>false),false);
  const plant=props.find(p=>p.kind==='planter');assert.ok(plant);assert.ok(streetPropFootprint(plant,0,true).halfWidth<streetPropFootprint(plant).halfWidth);
});

test('street prop collision stays at ground level and uses the tight solid footprint',()=>{
  const map=Object.create(RealWorldMap.prototype),p={kind:'bench',x:0,z:0,y:.135,angle:Math.PI/4};
  Object.assign(map,{buildings:[],waterChannels:[],bridgePierColliders:[],bridgePierGrid:new GridForgeCityGrid(64),streetPropColliders:[{...streetPropFootprint(p,0,true),base:.135,height:1.11}]});
  const ground=map.elevationAt(p);assert.equal(map.nearbyStaticObstacles(p,10,ground).length,1);assert.equal(map.nearbyStaticObstacles(p,10,ground+6.4).length,0);assert.equal(map.nearbyStaticObstacles(p,10,ground-4).length,0);
  assert.equal(map.nearbyStaticObstacles({x:100,z:100},10,ground).length,0);
});


test('ignition off before late recordings and during a throttle attack silences only the scooter engine',async()=>{
  const oldWindow=globalThis.window,oldFetch=globalThis.fetch,resolvers=[];
  globalThis.window={AudioContext:Context};globalThis.fetch=()=>new Promise(resolve=>resolvers.push(resolve));
  const audio=new ScooterAudio();
  try{
    audio.setIgnition(false);audio.start();const ctx=audio.context,task=audio.loading;
    resolvers.forEach(resolve=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)}));await task;
    assert.ok(audio.voices.every(v=>v.gain.gain.value===0));
    const camera=new THREE.PerspectiveCamera();ctx.currentTime+=.1;
    audio.update(12,1,true,{source:new THREE.Vector3(),listener:camera,trafficSource:new THREE.Vector3(0,0,-4)},false);
    assert.ok(audio.voices.every(v=>v.gain.gain.value===0));assert.ok(audio.tyreGain.gain.value>0);assert.ok(audio.trafficGain.gain.value>0);assert.equal(audio.activeAttack,null);
    ctx.currentTime+=.6;audio.update(12,1,false,undefined,true);assert.ok(audio.activeAttack);assert.ok(audio.voices.some(v=>v.gain.gain.value>0));
    audio.setIgnition(false);assert.equal(audio.activeAttack,null);assert.ok(audio.voices.every(v=>v.gain.gain.value===0));
  }finally{audio.dispose();globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});
