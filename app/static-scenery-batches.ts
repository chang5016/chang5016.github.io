import * as THREE from 'three';
import { DRAW_DISTANCE, cameraWorldPosition, withinDistance } from './draw-distance';
import {STATIC_SHADOW_LAYER} from './continuous-shadows';

type Cell={indices:number[];sphere:THREE.Sphere};
type Batch={limit:number;source:THREE.InstancedMesh;color:THREE.InstancedMesh;shadow:THREE.InstancedMesh;layers:number;cells:Cell[];matrices:Float32Array;colors?:Float32Array;colorKey:string;shadowKey:string};

/** Compact visible spatial cells into ordinary hardware instancing. This works
 * without multi-draw extensions and never simplifies source meshes or textures. */
export class StaticSceneryBatches {
  readonly group=new THREE.Group();
  private batches:Batch[]=[];
  private revision=0;
  private inverse=new THREE.Matrix4();
  private matrix=new THREE.Matrix4();
  private instance=new THREE.Matrix4();
  private sphere=new THREE.Sphere();
  private box=new THREE.Box3();
  private projection=new THREE.Matrix4();
  private colorFrustum=new THREE.Frustum();
  private shadowFrustum=new THREE.Frustum();
  constructor(){this.group.name='Full-detail scenery in visible hardware instances';this.group.userData.staticSceneryBatch=true;}
  register(source:THREE.InstancedMesh) {
    if(source.count<128||Array.isArray(source.material)||source.material.transparent||this.batches.some(b=>b.source===source))return false;
    const make=()=>{const mesh=new THREE.InstancedMesh(source.geometry,source.material,source.count);mesh.count=0;
      mesh.frustumCulled=false;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.userData.staticSceneryBatch=true;
      if(source.instanceColor){mesh.setColorAt(0,new THREE.Color());mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);}return mesh;};
    const color=make(),shadow=make();color.name=source.name+' / visible instances';color.receiveShadow=source.receiveShadow;
    shadow.name=source.name+' / stationary shadow instances';shadow.castShadow=source.castShadow;shadow.layers.set(STATIC_SHADOW_LAYER);
    // Small furniture (grass, posts, reflectors) stops at a short draw distance; large scenery runs to the fog limit.
    source.geometry.computeBoundingSphere();source.getMatrixAt(0,this.instance);
    const extent=(source.geometry.boundingSphere?.radius??0)*this.instance.getMaxScaleOnAxis();
    const batch:Batch={limit:extent<2?DRAW_DISTANCE.smallScenery:Infinity,source,color,shadow,layers:source.layers.mask,cells:[],matrices:new Float32Array(source.count*16),
      colors:source.instanceColor?new Float32Array(source.count*3):undefined,colorKey:'',shadowKey:''};
    this.rebuild(batch);
    if(batch.cells.length<2){color.dispose();shadow.dispose();return false;}
    source.layers.disableAll();this.batches.push(batch);this.group.add(color,shadow);return true;
  }
  private rebuild(batch:Batch) {
    const {source}=batch;source.updateWorldMatrix(true,false);this.group.updateWorldMatrix(true,false);
    this.inverse.copy(this.group.matrixWorld).invert();this.matrix.multiplyMatrices(this.inverse,source.matrixWorld);
    if(!source.geometry.boundingSphere)source.geometry.computeBoundingSphere();
    const cells=new Map<string,{indices:number[];bounds:THREE.Box3}>();
    for(let i=0;i<source.count;i++) {
      source.getMatrixAt(i,this.instance);this.instance.premultiply(this.matrix);this.instance.toArray(batch.matrices,i*16);
      this.sphere.copy(source.geometry.boundingSphere!).applyMatrix4(this.instance);
      const key=`${Math.floor(this.sphere.center.x/160)},${Math.floor(this.sphere.center.z/160)}`;
      let cell=cells.get(key);if(!cell){cell={indices:[],bounds:new THREE.Box3()};cells.set(key,cell);}
      cell.indices.push(i);this.sphere.getBoundingBox(this.box);cell.bounds.union(this.box);
      if(batch.colors&&source.instanceColor)for(let c=0;c<3;c++)batch.colors[i*3+c]=source.instanceColor.getComponent(i,c);
    }
    batch.cells=[...cells.values()].map(c=>({indices:c.indices,sphere:c.bounds.getBoundingSphere(new THREE.Sphere())}));
    batch.colorKey='';batch.shadowKey='';
  }
  invalidate(){this.revision++;for(const batch of this.batches)this.rebuild(batch);}
  private pack(batch:Batch,shadow:boolean) {
    const mesh=shadow?batch.shadow:batch.color,frustum=shadow?this.shadowFrustum:this.colorFrustum;
    const selected:number[]=[],limit=shadow?Infinity:Math.min(batch.limit,this.farLimit);
    batch.cells.forEach((cell,i)=>{if(frustum.intersectsSphere(this.sphere.copy(cell.sphere).applyMatrix4(this.group.matrixWorld))&&withinDistance(this.sphere,this.eye,limit))selected.push(i);});
    const key=this.revision+':'+selected.join(',');
    if(key===(shadow?batch.shadowKey:batch.colorKey))return;
    let count=0;
    for(const id of selected)for(const index of batch.cells[id].indices){
      mesh.instanceMatrix.array.set(batch.matrices.subarray(index*16,index*16+16),count*16);
      if(batch.colors&&mesh.instanceColor)mesh.instanceColor.array.set(batch.colors.subarray(index*3,index*3+3),count*3);
      count++;
    }
    mesh.count=count;mesh.visible=count>0;
    mesh.instanceMatrix.clearUpdateRanges();if(count)mesh.instanceMatrix.addUpdateRange(0,count*16);mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor){mesh.instanceColor.clearUpdateRanges();if(count)mesh.instanceColor.addUpdateRange(0,count*3);mesh.instanceColor.needsUpdate=true;}
    if(shadow)batch.shadowKey=key;else batch.colorKey=key;
  }
  private eye=new THREE.Vector3();
  private farLimit=Infinity;
  update(camera:THREE.Camera,shadowCamera?:THREE.Camera,farLimit=Infinity) {
    camera.updateMatrixWorld();this.eye.copy(cameraWorldPosition(camera));this.farLimit=farLimit;this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.colorFrustum.setFromProjectionMatrix(this.projection,camera.coordinateSystem);
    if(shadowCamera){shadowCamera.updateMatrixWorld();this.projection.multiplyMatrices(shadowCamera.projectionMatrix,shadowCamera.matrixWorldInverse);this.shadowFrustum.setFromProjectionMatrix(this.projection,shadowCamera.coordinateSystem);}
    let calls=0,triangles=0,instances=0;
    for(const batch of this.batches){this.pack(batch,false);if(shadowCamera)this.pack(batch,true);else{batch.shadow.count=0;batch.shadow.visible=false;batch.shadowKey='';}
      if(batch.color.count){calls++;instances+=batch.color.count;triangles+=(batch.source.geometry.index?.count??batch.source.geometry.attributes.position.count)/3*batch.color.count;}}
    this.group.userData.renderAudit={families:this.batches.length,calls,triangles,instances,geometrySimplified:false};
  }
  clear(){for(const batch of this.batches){batch.source.layers.mask=batch.layers;batch.color.dispose();batch.shadow.dispose();}this.batches=[];this.group.clear();}
}
