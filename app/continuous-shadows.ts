import * as THREE from 'three';

export const STATIC_SHADOW_LAYER=28;
export const MOVING_SHADOW_LAYER=29;

/** Native PCF shadows, with an exact depth cache for unchanged scenery. */
export class ContinuousShadows {
  private staticCamera=new THREE.Camera();
  private movingCamera=new THREE.Camera();
  private fallbackCamera=new THREE.Camera();
  private cache?:THREE.WebGLRenderTarget;
  private originalLayers=new Map<THREE.Object3D,number>();
  private nativeRender:THREE.WebGLRenderer['shadowMap']['render'];
  private nativeMatrices:THREE.DirectionalLight['shadow']['updateMatrices'];
  private restoreDepth=false;
  private failed=false;
  private verifiedGpu=false;
  private key='';
  private actorsRevision=-1;
  private basis=new THREE.Matrix4().lookAt(new THREE.Vector3(-45,78,-36),new THREE.Vector3(),new THREE.Vector3(0,1,0));
  private axisX=new THREE.Vector3().setFromMatrixColumn(this.basis,0);
  private axisY=new THREE.Vector3().setFromMatrixColumn(this.basis,1);
  private axisZ=new THREE.Vector3().setFromMatrixColumn(this.basis,2);
  private center=new THREE.Vector3();
  private anchor=new THREE.Vector3();
  private lightOffset=new THREE.Vector3(-45,78,-36);
  readonly audit={staticPasses:0,movingPasses:0,cacheCopies:0,fallback:false};

  constructor(private renderer:THREE.WebGLRenderer,private scene:THREE.Scene,private sun:THREE.DirectionalLight) {
    this.staticCamera.layers.set(STATIC_SHADOW_LAYER);this.movingCamera.layers.set(MOVING_SHADOW_LAYER);
    this.nativeRender=renderer.shadowMap.render;
    this.nativeMatrices=sun.shadow.updateMatrices;
    sun.shadow.updateMatrices=(light)=>{
      this.nativeMatrices.call(sun.shadow,light);
      if(this.restoreDepth&&this.cache&&sun.shadow.map?.depthTexture) {
        renderer.copyTextureToTexture(this.cache.depthTexture!,sun.shadow.map.depthTexture);
        renderer.setRenderTarget(sun.shadow.map as THREE.WebGLRenderTarget);
        this.audit.cacheCopies++;
        this.checkFirstCopy();
      }
    };
    renderer.shadowMap.render=(lights,scene,camera)=>{
      if(scene!==this.scene||!lights.includes(this.sun)||!renderer.shadowMap.enabled){this.nativeRender.call(renderer.shadowMap,lights,scene,camera);return;}
      this.render(lights,scene,camera);
    };
    scene.userData.continuousShadowAudit=this.audit;
  }

  /** Snap in light space, so cached texels stay aligned while the camera follows the rider. */
  follow(x:number,y:number,z:number) {
    this.center.set(x,y,z);
    const camera=this.sun.shadow.camera,cell=(camera.right-camera.left)/this.sun.shadow.mapSize.x*64;
    this.anchor.copy(this.axisX).multiplyScalar(Math.round(this.center.dot(this.axisX)/cell)*cell)
      .addScaledVector(this.axisY,Math.round(this.center.dot(this.axisY)/cell)*cell)
      .addScaledVector(this.axisZ,Math.round(this.center.dot(this.axisZ)/cell)*cell);
    this.sun.target.position.copy(this.anchor);this.sun.position.copy(this.anchor).add(this.lightOffset);
    this.sun.updateWorldMatrix(true,false);this.sun.target.updateWorldMatrix(true,false);
    this.sun.shadow.updateMatrices(this.sun);
  }

  private classify(camera:THREE.Camera) {
    const current=new Set<THREE.Object3D>();
    const visit=(object:THREE.Object3D,moving:boolean)=>{
      moving=moving||!!object.userData.dynamicWorldObject||(object as THREE.SkinnedMesh).isSkinnedMesh===true;
      if(object.castShadow&&!object.userData.packedCitySource&&object.layers.test(camera.layers)) {
        current.add(object);
        if(!this.originalLayers.has(object))this.originalLayers.set(object,object.layers.mask);
        object.layers.disable(STATIC_SHADOW_LAYER);object.layers.disable(MOVING_SHADOW_LAYER);
        object.layers.enable(moving?MOVING_SHADOW_LAYER:STATIC_SHADOW_LAYER);
      }
      for(const child of object.children)visit(child,moving);
    };
    visit(this.scene,false);
    for(const [object,layers] of this.originalLayers)if(!current.has(object)){if(!object.userData.packedCitySource)object.layers.mask=layers;this.originalLayers.delete(object);}
  }

  private checkFirstCopy() {
    if(this.verifiedGpu)return;
    const gl=this.renderer.getContext();
    if(gl.getError()!==gl.NO_ERROR)throw new Error('Shadow depth copy was rejected by the graphics context');
  }

  private pass(lights:THREE.Light[],scene:THREE.Scene,camera:THREE.Camera) {
    this.renderer.shadowMap.needsUpdate=true;this.sun.shadow.needsUpdate=true;
    this.nativeRender.call(this.renderer.shadowMap,lights,scene,camera);
  }

  private render(lights:THREE.Light[],scene:THREE.Scene,camera:THREE.Camera) {
    const target=this.renderer.getRenderTarget(),face=this.renderer.getActiveCubeFace(),mip=this.renderer.getActiveMipmapLevel();
    const shadow=this.sun.shadow,requested=this.renderer.shadowMap.needsUpdate;
    const key=[scene.userData.staticShadowRevision??0,...this.sun.matrixWorld.elements,...this.sun.target.matrixWorld.elements,
      shadow.mapSize.x,shadow.mapSize.y,shadow.camera.left,shadow.camera.right,shadow.camera.top,shadow.camera.bottom].join(',');
    const actors=scene.userData.shadowActorsRevision??0;
    try {
      if(this.failed)throw new Error('Use native full-scene shadows');
      if(key!==this.key||actors!==this.actorsRevision||requested){this.classify(camera);this.actorsRevision=actors;}
      if(!this.cache||key!==this.key||requested) {
        this.restoreDepth=false;this.pass([this.sun],scene,this.staticCamera);this.audit.staticPasses++;
        const map=shadow.map;
        if(!map?.depthTexture)throw new Error('A native depth shadow map is required');
        if(!this.cache||this.cache.width!==map.width||this.cache.height!==map.height) {
          this.cache?.depthTexture?.dispose();this.cache?.dispose();
          this.cache=new THREE.WebGLRenderTarget(map.width,map.height,{depthTexture:map.depthTexture.clone(),generateMipmaps:false});
          this.renderer.initRenderTarget(this.cache);
        }
        const target=this.renderer.getRenderTarget(),face=this.renderer.getActiveCubeFace(),mip=this.renderer.getActiveMipmapLevel();
        this.renderer.copyTextureToTexture(map.depthTexture,this.cache.depthTexture!);
        this.renderer.setRenderTarget(target,face,mip);this.audit.cacheCopies++;
        this.checkFirstCopy();this.key=key;
      }
      this.restoreDepth=true;this.pass([this.sun],scene,this.movingCamera);this.audit.movingPasses++;
      this.restoreDepth=false;this.verifiedGpu=true;
      if(lights.length>1)this.pass(lights.filter(light=>light!==this.sun),scene,camera);
    } catch(error) {
      this.restoreDepth=false;this.failed=true;this.audit.fallback=true;
      scene.userData.shadowCacheError=error instanceof Error?error.message:String(error);
      this.fallbackCamera.layers.mask=camera.layers.mask;this.fallbackCamera.layers.enable(MOVING_SHADOW_LAYER);
      this.fallbackCamera.layers.enable(STATIC_SHADOW_LAYER);
      this.pass(lights,scene,this.fallbackCamera);
    } finally {this.restoreDepth=false;this.renderer.setRenderTarget(target,face,mip);}
  }

  dispose() {
    this.renderer.shadowMap.render=this.nativeRender;this.sun.shadow.updateMatrices=this.nativeMatrices;
    for(const [object,layers] of this.originalLayers)object.layers.mask=layers;
    this.originalLayers.clear();this.cache?.depthTexture?.dispose();this.cache?.dispose();
  }
}
