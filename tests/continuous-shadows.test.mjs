import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {ContinuousShadows,MOVING_SHADOW_LAYER,STATIC_SHADOW_LAYER} from '../app/continuous-shadows.ts';
import {invalidateShadowScene} from '../app/static-scene.ts';

// The native pass is represented by a tiny depth buffer. This checks pass
// scheduling, exact depth preservation and ghost removal; it is not GPU timing.
function fixture() {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),sun=new THREE.DirectionalLight();scene.add(sun,sun.target);
  sun.castShadow=true;sun.shadow.mapSize.set(16,16);
  const staticMesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());staticMesh.castShadow=true;staticMesh.userData.pixel=0;scene.add(staticMesh);
  const actor=new THREE.Group();actor.userData.dynamicWorldObject=true;scene.add(actor);
  const car=new THREE.Mesh(staticMesh.geometry,staticMesh.material);car.castShadow=true;car.userData.pixel=1;actor.add(car);
  const passes=[];let target=null,failCopy=false;
  const renderer={
    getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget:t=>{target=t;},
    getContext:()=>({NO_ERROR:0,getError:()=>0}),initRenderTarget:()=>{},
    copyTextureToTexture:(src,dst)=>{if(failCopy)throw new Error('Test depth-copy failure');dst.userData.depth=[...src.userData.depth];},
    shadowMap:{enabled:true,autoUpdate:false,needsUpdate:true,render(lights,world,view){
      if(!this.enabled||(!this.autoUpdate&&!this.needsUpdate))return;
      const previous=target;
      for(const light of lights) {
        if(!light.shadow.map)light.shadow.map=new THREE.WebGLRenderTarget(16,16,{depthTexture:new THREE.DepthTexture(16,16)});
        target=light.shadow.map;target.depthTexture.userData.depth=[1,1,1,1];
        light.shadow.updateMatrices(light);
        const rendered=[];
        world.traverse(o=>{if(o.isMesh&&o.castShadow&&o.visible&&o.layers.test(view.layers)){target.depthTexture.userData.depth[o.userData.pixel]=.25;rendered.push(o);}});
        passes.push(rendered);light.shadow.needsUpdate=false;
      }
      this.needsUpdate=false;target=previous;
    }},
  };
  const native=renderer.shadowMap.render,shadows=new ContinuousShadows(renderer,scene,sun);
  const frame=(x=0)=>{shadows.follow(x,0,0);scene.updateMatrixWorld(true);renderer.shadowMap.render([sun],scene,camera);};
  return {scene,camera,sun,staticMesh,actor,car,renderer,shadows,passes,native,frame,fail:()=>{failCopy=true;}};
}

test('moving shadows update on all 60 frames while unchanged scenery is rendered once',()=>{
  const f=fixture();
  for(let frame=0;frame<60;frame++) {
    f.car.userData.pixel=1+frame%3;f.frame();
    const depth=f.sun.shadow.map.depthTexture.userData.depth;
    assert.equal(depth[0],.25,'Cached building depth survives each native clear');
    for(let pixel=1;pixel<4;pixel++)assert.equal(depth[pixel],pixel===f.car.userData.pixel?.25:1,'Old moving shadows never remain in the cache');
    assert.equal(f.renderer.getRenderTarget(),null,'The main scene still renders to the screen');
  }
  assert.equal(f.shadows.audit.staticPasses,1);assert.equal(f.shadows.audit.movingPasses,60);
  assert.equal(f.passes.filter(p=>p.includes(f.staticMesh)).length,1);
  assert.equal(f.passes.filter(p=>p.includes(f.car)).length,60);
  assert.equal(f.scene.overrideMaterial,null,'Native alpha-cutout and custom depth materials remain in use');
  f.shadows.dispose();assert.equal(f.renderer.shadowMap.render,f.native);assert.equal(f.car.layers.mask,1);assert.equal(f.staticMesh.layers.mask,1);
});

test('new actors refresh shadow membership without rebaking stationary buildings',()=>{
  const f=fixture();f.frame();
  const car=f.car.clone();car.userData.pixel=2;f.actor.add(car);invalidateShadowScene(f.actor,false);f.frame();
  assert.equal(f.shadows.audit.staticPasses,1);assert.ok(f.passes.at(-1).includes(car));
  f.staticMesh.userData.pixel=3;invalidateShadowScene(f.staticMesh);f.frame();
  assert.equal(f.shadows.audit.staticPasses,2);assert.equal(f.sun.shadow.map.depthTexture.userData.depth[0],1);
  assert.equal(f.sun.shadow.map.depthTexture.userData.depth[3],.25);f.shadows.dispose();
});

test('a changed shadow view rebuilds its depth cache and shadow-only traffic remains eligible',()=>{
  const f=fixture(),shadowOnly=f.car.clone();shadowOnly.layers.set(MOVING_SHADOW_LAYER);shadowOnly.userData.pixel=2;f.scene.add(shadowOnly);
  f.frame();f.frame(200);assert.equal(f.shadows.audit.staticPasses,2);
  assert.ok(f.passes.at(-1).includes(shadowOnly));assert.equal(shadowOnly.layers.isEnabled(0),false);
  f.shadows.dispose();
});

test('unsupported depth copying falls back to complete native shadows and restores the screen target',()=>{
  const f=fixture();f.fail();f.frame();
  assert.equal(f.shadows.audit.fallback,true);assert.equal(f.renderer.getRenderTarget(),null);
  assert.ok(f.passes.at(-1).includes(f.car));assert.ok(f.passes.at(-1).includes(f.staticMesh));
  f.frame();assert.equal(f.renderer.getRenderTarget(),null);f.shadows.dispose();
});

test('complete native fallback includes stationary instances that only belong to the shadow layer',()=>{
  const f=fixture(),scenery=f.staticMesh.clone();scenery.layers.set(STATIC_SHADOW_LAYER);scenery.userData.pixel=2;f.scene.add(scenery);
  f.fail();f.frame();assert.ok(f.passes.at(-1).includes(scenery));assert.equal(f.sun.shadow.map.depthTexture.userData.depth[2],.25);f.shadows.dispose();
});

test('replacing a classified city batch never restores the hidden source or doubles its shadows',()=>{
  const f=fixture();f.frame();
  f.staticMesh.userData.packedCitySource=true;f.staticMesh.layers.disableAll();
  const packed=f.staticMesh.clone();delete packed.userData.packedCitySource;packed.layers.set(STATIC_SHADOW_LAYER);f.scene.add(packed);
  invalidateShadowScene(packed);f.frame();
  assert.equal(f.staticMesh.layers.mask,0);
  assert.ok(f.passes.at(-2).includes(packed));assert.equal(f.passes.at(-2).includes(f.staticMesh),false);
  f.shadows.dispose();assert.equal(f.staticMesh.layers.mask,0);
});
