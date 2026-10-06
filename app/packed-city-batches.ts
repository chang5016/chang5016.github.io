import * as THREE from 'three';
import { STATIC_SHADOW_LAYER } from './continuous-shadows';

type Range = { id: number; geometry: THREE.BufferGeometry };
type Cell = { indices: Uint16Array | Uint32Array; sphere: THREE.Sphere };
type Pass = { mesh: THREE.Mesh; key: string; indices: Uint32Array };
type Family = { source: THREE.BatchedMesh; layers: number; cells: Cell[]; color: Pass; shadow: Pass; revision: number; materialKey: string };

/** All city ranges have identity instance transforms. Pack their exact indices
 * into one ordinary draw per material, including on GPUs without multi-draw.
 * Original positions, UVs, normals and material shaders are shared unchanged. */
export class PackedCityBatches {
  readonly group = new THREE.Group();
  private families = new Map<THREE.BatchedMesh, Family>();
  private revision = -1;
  private environmentKey = '';
  private projection = new THREE.Matrix4();
  private frustum = new THREE.Frustum();
  private sphere = new THREE.Sphere();
  readonly audit = { families: 0, colorDraws: 0, previousColorDraws: 0, triangles: 0, indexUploads: 0, geometrySimplified: false };
  constructor(private scene: THREE.Scene) {
    this.group.name = 'Exact visible city triangles / one draw per material';
    // Keep the exact packed geometry, but let the renderer refresh camera,
    // fog and cached-shadow node bindings on every draw. A render bundle can
    // otherwise replay old bindings while its visibility set stays unchanged.
    scene.add(this.group); scene.userData.packedCityAudit = this.audit;
  }
  private cells(source: THREE.BatchedMesh) {
    const ranges = source.userData.cityMultidraw.ranges as Range[];
    return ranges.map(range => {
      const info = source.getGeometryRangeAt(range.id, { start: 0, count: 0, vertexStart: 0, vertexCount: 0, reservedVertexCount: 0, indexStart: 0, indexCount: 0, reservedIndexCount: 0 })!;
      const indices = source.geometry.index!.array as Uint16Array | Uint32Array;
      return { indices: indices.subarray(info.start, info.start + info.count), sphere: range.geometry.boundingSphere!.clone() };
    });
  }
  private register(source: THREE.BatchedMesh) {
    const make = (shadow: boolean): Pass => {
      const geometry = new THREE.BufferGeometry();
      for (const [key, attribute] of Object.entries(source.geometry.attributes)) geometry.setAttribute(key, attribute);
      const indices = new Uint32Array(source.userData.cityMultidraw.triangles * 3);
      geometry.setIndex(new THREE.BufferAttribute(indices, 1).setUsage(THREE.DynamicDrawUsage));
      geometry.setDrawRange(0, 0);
      const mesh = new THREE.Mesh(geometry, source.material);
      mesh.name = source.name + (shadow ? ' / packed static shadows' : ' / packed visible triangles');
      mesh.frustumCulled = false; mesh.receiveShadow = source.receiveShadow; mesh.castShadow = shadow && source.castShadow;
      mesh.renderOrder = source.renderOrder;
      if (shadow) mesh.layers.set(STATIC_SHADOW_LAYER); else mesh.layers.mask = source.layers.mask;
      source.updateWorldMatrix(true, false); mesh.matrix.copy(source.matrixWorld); mesh.matrixWorld.copy(source.matrixWorld);
      mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false;
      this.group.add(mesh); return { mesh, key: '', indices };
    };
    const color = make(false), shadow = make(true);
    const family = { source, layers: source.layers.mask, color, shadow, cells: this.cells(source), revision: source.userData.cityMultidraw.revision ?? 0, materialKey: '' };
    source.userData.packedCitySource = true;
    source.layers.disableAll(); this.families.set(source, family);
  }
  private sync() {
    const revision = this.scene.userData.staticShadowRevision ?? 0;
    if (revision === this.revision) return;
    const current = new Set<THREE.BatchedMesh>();
    this.scene.traverse(object => { if (object.userData.cityMultidraw && (object as THREE.BatchedMesh).isBatchedMesh) current.add(object as THREE.BatchedMesh); });
    for (const source of current) if (!this.families.has(source)) this.register(source);
    for (const [source, family] of this.families) if (!current.has(source)) {
      for (const pass of [family.color, family.shadow]) { pass.mesh.removeFromParent(); pass.mesh.geometry.dispose(); }
      source.layers.mask = family.layers; delete source.userData.packedCitySource;
      this.families.delete(source);
    }
    this.revision = revision;
  }
  private pack(family: Family, pass: Pass, camera: THREE.Camera) {
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projection, camera.coordinateSystem);
    const visible: number[] = [];
    family.cells.forEach((cell, id) => { if (this.frustum.intersectsSphere(this.sphere.copy(cell.sphere).applyMatrix4(family.source.matrixWorld))) visible.push(id); });
    // Stable front-to-back order saves fragment work without altering opaque surfaces.
    const key = family.revision + ':' + visible.join(',');
    if (key === pass.key) return visible.length;
    visible.sort((a, b) => family.cells[a].sphere.center.distanceToSquared(camera.position) - family.cells[b].sphere.center.distanceToSquared(camera.position));
    let count = 0;
    for (const id of visible) { pass.indices.set(family.cells[id].indices, count); count += family.cells[id].indices.length; }
    pass.mesh.geometry.setDrawRange(0, count); pass.mesh.visible = count > 0;
    if (count) { const index = pass.mesh.geometry.index!; index.clearUpdateRanges(); index.addUpdateRange(0, count); index.needsUpdate = true; this.audit.indexUploads++; }
    pass.key = key; return visible.length;
  }
  update(camera: THREE.Camera, shadowCamera: THREE.Camera) {
    this.sync(); camera.updateMatrixWorld(); shadowCamera.updateMatrixWorld();
    const environmentKey = this.scene.environment?.uuid ?? '';
    if (environmentKey !== this.environmentKey) this.environmentKey = environmentKey;
    this.audit.colorDraws = this.audit.previousColorDraws = this.audit.triangles = 0;
    for (const family of this.families.values()) {
      const materials = Array.isArray(family.source.material) ? family.source.material : [family.source.material];
      const materialKey = materials.map(material => `${material.uuid}:${material.version}`).join(',');
      if (materialKey !== family.materialKey) family.materialKey = materialKey;
      const revision = family.source.userData.cityMultidraw.revision ?? 0;
      if (family.revision !== revision) { family.cells = this.cells(family.source); family.revision = revision; family.color.key = family.shadow.key = ''; }
      const draws = this.pack(family, family.color, camera); this.pack(family, family.shadow, shadowCamera);
      if (draws) this.audit.colorDraws++;
      this.audit.previousColorDraws += draws; this.audit.triangles += family.color.mesh.geometry.drawRange.count / 3;
    }
    this.audit.families = this.families.size;
  }
  dispose() {
    for (const family of this.families.values()) { family.source.layers.mask = family.layers; delete family.source.userData.packedCitySource; family.color.mesh.geometry.dispose(); family.shadow.mesh.geometry.dispose(); }
    this.families.clear(); this.group.removeFromParent();
  }
}
