import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { batchCityMesh, disposeCityBatch } from './city-multidraw';
import { invalidateShadowScene } from './static-scene';

type Source = { mesh: THREE.Mesh; layers: number; matrix: THREE.Matrix4; geometry: THREE.BufferGeometry; attributes: string };
type Family = { sources: Source[]; batch: THREE.BatchedMesh; geometry: THREE.BufferGeometry; material: THREE.Material };

/** Bake only frozen, opaque, ordinary meshes into spatial material batches.
 * This keeps every vertex attribute/triangle and the same material objects.
 * Animated, transparent, skinned, instanced and custom-callback objects stay live. */
export class ExactStaticMeshes {
  readonly group = new THREE.Group();
  readonly audit = { sources: 0, families: 0, triangles: 0, geometrySimplified: false };
  private revision = -1;
  private families: Family[] = [];
  private prototype = new THREE.Mesh();

  constructor(private scene: THREE.Scene) {
    this.group.name = 'Intact frozen props and signs / spatial material families';
    this.group.userData.exactStaticFamily = true;
    scene.add(this.group); scene.userData.exactStaticMeshAudit = this.audit;
  }

  private attributes(mesh: THREE.Mesh) {
    return Object.entries(mesh.geometry.attributes).map(([name,attribute]) =>
      `${name}:${'version' in attribute ? attribute.version : attribute.data.version}`).join(',') + ':' + mesh.geometry.index?.version;
  }

  private attachedAndVisible(object: THREE.Object3D) {
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (!parent.visible || parent.userData.dynamicWorldObject) return false;
      if (parent === this.scene) return true;
    }
    return false;
  }

  private release(family: Family) {
    for (const {mesh,layers} of family.sources) { mesh.layers.mask = layers; delete mesh.userData.packedStaticSource; }
    family.batch.removeFromParent(); disposeCityBatch(family.batch); family.geometry.dispose();
  }

  update() {
    const revision = this.scene.userData.staticShadowRevision ?? 0;
    if (revision === this.revision) return;
    let changed = false;
    // Streamed models can replace provisional geometry. Remove their baked
    // copies too; remaining siblings are collected again with their real transforms.
    this.families = this.families.filter(family => {
      const intact = family.sources.every(source => this.attachedAndVisible(source.mesh) &&
        source.mesh.material === family.material && source.mesh.geometry === source.geometry &&
        source.mesh.matrixWorld.equals(source.matrix) && this.attributes(source.mesh) === source.attributes);
      if (intact) return true;
      this.release(family); changed = true; return false;
    });
    const candidates = new Map<string, THREE.Mesh[]>();
    const visit = (object: THREE.Object3D) => {
      if (!object.visible || object.userData.dynamicWorldObject || object.userData.exactStaticFamily ||
          (object as THREE.SkinnedMesh).isSkinnedMesh || (object as THREE.Bone).isBone) return;
      const mesh = object as THREE.Mesh, material = mesh.material as THREE.Material;
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !(mesh as THREE.BatchedMesh).isBatchedMesh &&
          !mesh.userData.packedStaticSource && mesh.layers.isEnabled(0) && !mesh.matrixAutoUpdate && !mesh.matrixWorldAutoUpdate &&
          !Array.isArray(mesh.material) && !material.transparent && !(material as THREE.ShaderMaterial).isShaderMaterial &&
          !(material as THREE.MeshStandardMaterial & { positionNode?: unknown }).positionNode &&
          mesh.onBeforeRender === this.prototype.onBeforeRender && mesh.onBeforeShadow === this.prototype.onBeforeShadow &&
          mesh.geometry.getAttribute('position') &&
          mesh.geometry.drawRange.start === 0 && mesh.geometry.drawRange.count === Infinity &&
          Object.values(mesh.geometry.morphAttributes).every(attributes => !attributes.length) &&
          !Object.values(mesh.geometry.attributes).some(attribute => (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) &&
          mesh.matrixWorld.determinant() > 0) {
        const attributes = Object.entries(mesh.geometry.attributes).map(([name,attribute]) =>
          `${name}:${attribute.itemSize}:${attribute.normalized}:${attribute.array.constructor.name}`).sort().join(',');
        const key = `${material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}:${mesh.renderOrder}:${mesh.layers.mask}:${attributes}`;
        const family = candidates.get(key) ?? []; family.push(mesh); candidates.set(key,family);
      }
      for (const child of object.children) visit(child);
    };
    visit(this.scene);
    for (const sources of candidates.values()) {
      if (sources.length < 3) continue;
      const pieces = sources.map(mesh => {
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        if (!geometry.index) geometry.setIndex(Array.from({length:geometry.attributes.position.count},(_,index)=>index));
        return geometry;
      });
      const geometry = mergeGeometries(pieces,false); pieces.forEach(piece=>piece.dispose());
      if (!geometry) continue;
      const material = sources[0].material as THREE.Material;
      const mesh = new THREE.Mesh(geometry,material);
      mesh.castShadow = sources[0].castShadow; mesh.receiveShadow = sources[0].receiveShadow;
      mesh.layers.mask = sources[0].layers.mask; mesh.renderOrder = sources[0].renderOrder;
      mesh.name = `Intact static material family / ${material.name || material.type}`;
      const batch = batchCityMesh(mesh,160,0,1);
      if (!batch) { geometry.dispose(); continue; }
      this.group.add(batch);
      this.families.push({batch,geometry,material,sources:sources.map(mesh=>({mesh,layers:mesh.layers.mask,matrix:mesh.matrixWorld.clone(),geometry:mesh.geometry,attributes:this.attributes(mesh)}))});
      for (const source of sources) { source.layers.disableAll(); source.userData.packedStaticSource = true; }
      changed = true;
    }
    if (changed) invalidateShadowScene(this.scene);
    this.audit.families = this.families.length;
    this.audit.sources = this.families.reduce((sum,family)=>sum+family.sources.length,0);
    this.audit.triangles = this.families.reduce((sum,family)=>sum+family.geometry.index!.count/3,0);
    this.revision = this.scene.userData.staticShadowRevision ?? 0;
  }

  dispose() {
    for (const family of this.families) this.release(family);
    this.families = []; this.group.removeFromParent();
  }
}
