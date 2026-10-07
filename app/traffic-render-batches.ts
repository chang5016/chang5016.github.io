import * as THREE from 'three';
import { DRAW_DISTANCE, cameraWorldPosition, withinDistance } from './draw-distance';
import type {TrafficRig} from './traffic-rig';
import { standardNodeMaterial } from './gpu-materials';
import { attribute, materialEmissive } from 'three/tsl';
import {MOVING_SHADOW_LAYER} from './continuous-shadows';

type Member={owner:THREE.Object3D;source:THREE.Mesh;material:THREE.MeshStandardMaterial;layers:number};
type Batch={mesh:THREE.InstancedMesh;shadow:THREE.InstancedMesh;members:Member[];visible:Member[];casters:Member[];lamp:boolean;paint:boolean;emission?:THREE.InstancedBufferAttribute};
/** Submit intact authored parts together; wheel/bone transforms remain independent. */
export class TrafficRenderBatches {
  readonly group=new THREE.Group();
  private batches=new Map<string,Batch>();
  private owners=new Map<THREE.Object3D,{distance:number;visible:boolean;shadow:boolean}>();
  private frustum=new THREE.Frustum();
  private shadowFrustum=new THREE.Frustum();
  private projection=new THREE.Matrix4();
  private inverse=new THREE.Matrix4();
  private matrix=new THREE.Matrix4();
  private sphere=new THREE.Sphere(new THREE.Vector3(),3.6);
  private color=new THREE.Color(1,1,1);
  constructor(){this.group.name='Intact animated traffic submitted in shared GPU batches';this.group.userData.dynamicWorldObject=true;}
  register(owner:THREE.Object3D,rig:TrafficRig) {
    if(this.owners.has(owner))return;this.owners.set(owner,{distance:0,visible:false,shadow:false});
    rig.root.traverse(object=>{
      const source=object as THREE.Mesh;
      if(!source.isMesh||(source as THREE.SkinnedMesh).isSkinnedMesh||Array.isArray(source.material)||!source.visible)return;
      source.updateWorldMatrix(true,false);
      if(source.matrixWorld.determinant()<0)return;
      const material=source.material as THREE.MeshStandardMaterial;
      const key=source.geometry.uuid+'/'+(material.userData.trafficSourceMaterial??material.uuid);
      let batch=this.batches.get(key);
      if(!batch){
        const name=material.name.toLowerCase(),lamp=name.startsWith('brake')||name.startsWith('indicator'),paint=name==='paint';
        const combined=standardNodeMaterial(material);if(paint)combined.color.setRGB(1,1,1);
        const geometry=new THREE.BufferGeometry();
        for(const [name,attribute] of Object.entries(source.geometry.attributes))geometry.setAttribute(name,attribute);
        geometry.setIndex(source.geometry.index);geometry.groups=source.geometry.groups.map(g=>({...g}));geometry.boundingSphere=source.geometry.boundingSphere?.clone()??null;
        const mesh=new THREE.InstancedMesh(geometry,combined,256);mesh.count=0;
        mesh.name=source.name+' / shared traffic';mesh.castShadow=false;mesh.receiveShadow=source.receiveShadow;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.userData.sharedTrafficAsset=true;
        // Allocate color before the shader is compiled; the shader layout never changes on approach.
        mesh.setColorAt(0,this.color);mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        const shadow=new THREE.InstancedMesh(geometry,combined,256);shadow.count=0;shadow.name=source.name+' / traffic shadow casters';
        shadow.layers.set(MOVING_SHADOW_LAYER);shadow.castShadow=source.castShadow;shadow.frustumCulled=false;
        shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);shadow.userData.sharedTrafficAsset=true;
        batch={mesh,shadow,members:[],visible:[],casters:[],lamp,paint};
        if(lamp){
          combined.emissiveIntensity=1;
          batch.emission=new THREE.InstancedBufferAttribute(new Float32Array(256),1);batch.emission.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('trafficEmission',batch.emission);
          combined.emissiveNode = materialEmissive.mul(attribute('trafficEmission', 'float'));
        }
        this.batches.set(key,batch);this.group.add(mesh,shadow);
      }
      batch.members.push({owner,source,material,layers:source.layers.mask});source.layers.disableAll();
    });
  }
  update(camera:THREE.Camera,shadowCamera?:THREE.Camera) {
    camera.updateMatrixWorld();this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projection,camera.coordinateSystem);
    if(shadowCamera){shadowCamera.updateMatrixWorld();this.projection.multiplyMatrices(shadowCamera.projectionMatrix,shadowCamera.matrixWorldInverse);this.shadowFrustum.setFromProjectionMatrix(this.projection,shadowCamera.coordinateSystem);}
    this.group.updateWorldMatrix(true,false);this.inverse.copy(this.group.matrixWorld).invert();
    let vehicles=0,shadowVehicles=0;const eye=cameraWorldPosition(camera);
    for(const [owner,state] of this.owners){
      owner.updateWorldMatrix(true,false);this.sphere.center.setFromMatrixPosition(owner.matrixWorld);this.sphere.center.y+=1;
      state.visible=this.frustum.intersectsSphere(this.sphere)&&withinDistance(this.sphere,eye,DRAW_DISTANCE.traffic);state.shadow=!!shadowCamera&&this.shadowFrustum.intersectsSphere(this.sphere);
      if(state.visible)vehicles++;if(state.shadow)shadowVehicles++;
      if(!state.visible&&!state.shadow)continue;
      owner.updateWorldMatrix(false,true);state.distance=this.sphere.center.distanceToSquared(camera.position);
    }
    let sourceCalls=0,drawCalls=0,triangles=0,shadowDrawCalls=0,shadowTriangles=0,uploadedMatrixFloats=0;
    for(const batch of this.batches.values()) {
      const members=batch.visible,casters=batch.casters;members.length=0;casters.length=0;
      for(const member of batch.members){const state=this.owners.get(member.owner)!;if(state.visible)members.push(member);if(state.shadow)casters.push(member);}
      if((batch.mesh.material as THREE.Material).transparent)members.sort((a,b)=>this.owners.get(b.owner)!.distance-this.owners.get(a.owner)!.distance);
      batch.mesh.count=members.length;
      batch.mesh.visible=members.length>0;batch.shadow.count=casters.length;batch.shadow.visible=casters.length>0;
      members.forEach((member,index)=>{
        this.matrix.multiplyMatrices(this.inverse,member.source.matrixWorld);batch.mesh.setMatrixAt(index,this.matrix);
        batch.mesh.setColorAt(index,batch.paint?member.material.color:this.color);
        if(batch.emission)batch.emission.setX(index,member.material.emissiveIntensity);
      });
      if(members.length){
        batch.mesh.instanceMatrix.clearUpdateRanges();batch.mesh.instanceMatrix.addUpdateRange(0,members.length*16);
        batch.mesh.instanceColor!.clearUpdateRanges();batch.mesh.instanceColor!.addUpdateRange(0,members.length*3);
        if(batch.emission){batch.emission.clearUpdateRanges();batch.emission.addUpdateRange(0,members.length);}
        batch.mesh.instanceMatrix.needsUpdate=true;if(batch.mesh.instanceColor)batch.mesh.instanceColor.needsUpdate=true;if(batch.emission)batch.emission.needsUpdate=true;
        sourceCalls+=members.length;drawCalls++;triangles+=(batch.mesh.geometry.index?.count??batch.mesh.geometry.attributes.position.count)/3*members.length;
        uploadedMatrixFloats+=members.length*16;
      }
      casters.forEach((member,index)=>{this.matrix.multiplyMatrices(this.inverse,member.source.matrixWorld);batch.shadow.setMatrixAt(index,this.matrix);});
      if(casters.length){batch.shadow.instanceMatrix.clearUpdateRanges();batch.shadow.instanceMatrix.addUpdateRange(0,casters.length*16);batch.shadow.instanceMatrix.needsUpdate=true;shadowDrawCalls++;shadowTriangles+=(batch.shadow.geometry.index?.count??batch.shadow.geometry.attributes.position.count)/3*casters.length;uploadedMatrixFloats+=casters.length*16;}
    }
    this.group.userData.renderAudit={vehicles,shadowVehicles,sourceCalls,drawCalls,triangles,shadowDrawCalls,shadowTriangles,uploadedMatrixFloats,geometrySimplified:false};
  }
  dispose(){for(const b of this.batches.values()){for(const m of b.members)m.source.layers.mask=m.layers;b.mesh.dispose();b.shadow.dispose();b.mesh.geometry.dispose();(b.mesh.material as THREE.Material).dispose();}this.batches.clear();this.owners.clear();this.group.clear();}
}
