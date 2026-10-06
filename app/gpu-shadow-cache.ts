import * as THREE from 'three';
import { shadow, min, vec3 } from 'three/tsl';
import type Node from 'three/src/nodes/core/Node.js';
import type NodeFrame from 'three/src/nodes/core/NodeFrame.js';
type NativeShadowNode = ReturnType<typeof shadow> & { renderShadow: (frame: NodeFrame) => void };
import { STATIC_SHADOW_LAYER, MOVING_SHADOW_LAYER } from './continuous-shadows';

/** Two native GPU depth maps: cached scenery and continuous animated actors.
 * Compose their visibility in the light shader, without WebGL depth copies. */
export class GpuShadowCache {
  private staticLight: THREE.DirectionalLight;
  private movingLight: THREE.DirectionalLight;
  private staticNode: NativeShadowNode;
  private movingNode: NativeShadowNode;
  private originalLayers = new Map<THREE.Object3D, number>();
  private revision = '';
  private key = '';
  private dirty = true;
  private basis = new THREE.Matrix4().lookAt(new THREE.Vector3(-45,78,-36), new THREE.Vector3(), new THREE.Vector3(0,1,0));
  private axes = [0,1,2].map(column => new THREE.Vector3().setFromMatrixColumn(this.basis, column));
  private center = new THREE.Vector3();
  private anchor = new THREE.Vector3();
  private offset = new THREE.Vector3(-45,78,-36);
  readonly audit = { staticPasses: 0, movingPasses: 0, cacheCopies: 0, backend: 'native-node-shadows', geometrySimplified: false };

  constructor(private scene: THREE.Scene, private sun: THREE.DirectionalLight) {
    this.staticLight = sun.clone(); this.movingLight = sun.clone();
    this.staticLight.name = 'Cached intact city shadows'; this.movingLight.name = 'Continuous vehicle and metro shadows';
    this.staticLight.shadow.autoUpdate = false; this.movingLight.shadow.autoUpdate = true;
    this.staticLight.shadow.camera.layers.set(STATIC_SHADOW_LAYER);
    this.movingLight.shadow.camera.layers.set(MOVING_SHADOW_LAYER);
    this.staticNode = shadow(this.staticLight) as NativeShadowNode; this.movingNode = shadow(this.movingLight) as NativeShadowNode;
    const staticPass = this.staticNode.renderShadow.bind(this.staticNode), movingPass = this.movingNode.renderShadow.bind(this.movingNode);
    this.staticNode.renderShadow = frame => { staticPass(frame); this.audit.staticPasses++; };
    this.movingNode.renderShadow = frame => { movingPass(frame); this.audit.movingPasses++; };
    sun.shadow.shadowNode = min(vec3(this.staticNode as unknown as Node<'vec3'>), vec3(this.movingNode as unknown as Node<'vec3'>));
    scene.userData.continuousShadowAudit = this.audit;
  }

  invalidate() { this.dirty = true; this.staticLight.shadow.needsUpdate = true; }

  private classify() {
    const current = new Set<THREE.Object3D>();
    const visit = (object: THREE.Object3D, moving: boolean) => {
      moving ||= !!object.userData.dynamicWorldObject || (object as THREE.SkinnedMesh).isSkinnedMesh === true;
      if (object.castShadow && !object.userData.packedCitySource && !object.userData.packedStaticSource && (object.layers.mask & 1)) {
        current.add(object);
        if (!this.originalLayers.has(object)) this.originalLayers.set(object, object.layers.mask);
        object.layers.disable(STATIC_SHADOW_LAYER); object.layers.disable(MOVING_SHADOW_LAYER);
        object.layers.enable(moving ? MOVING_SHADOW_LAYER : STATIC_SHADOW_LAYER);
      }
      for (const child of object.children) visit(child, moving);
    };
    visit(this.scene, false);
    for (const [object, layers] of this.originalLayers) if (!current.has(object)) {
      if (!object.userData.packedCitySource && !object.userData.packedStaticSource) object.layers.mask = layers;
      this.originalLayers.delete(object);
    }
  }

  follow(x: number, y: number, z: number) {
    this.center.set(x,y,z); this.anchor.set(0,0,0);
    const camera = this.sun.shadow.camera, cell = (camera.right-camera.left) / this.sun.shadow.mapSize.x * 64;
    for (const axis of this.axes) this.anchor.addScaledVector(axis, Math.round(this.center.dot(axis)/cell)*cell);
    this.sun.target.position.copy(this.anchor); this.sun.position.copy(this.anchor).add(this.offset);
    this.sun.updateWorldMatrix(true, false); this.sun.target.updateWorldMatrix(true, false);
    this.sun.shadow.updateMatrices(this.sun);
    const revision = `${this.scene.userData.staticShadowRevision ?? 0}:${this.scene.userData.shadowActorsRevision ?? 0}`;
    if (revision !== this.revision || this.dirty) { this.classify(); this.revision = revision; }
    for (const light of [this.staticLight, this.movingLight]) {
      light.position.copy(this.sun.position); light.target.position.copy(this.sun.target.position);
      light.updateWorldMatrix(true, false); light.target.updateWorldMatrix(true, false);
      light.shadow.updateMatrices(light);
    }
    const key = `${revision}:${this.anchor.x},${this.anchor.y},${this.anchor.z}`;
    if (key !== this.key || this.dirty) { this.staticLight.shadow.needsUpdate = true; this.key = key; }
    this.dirty = false;
  }

  dispose() {
    delete this.sun.shadow.shadowNode;
    this.staticNode.dispose(); this.movingNode.dispose();
    for (const [object, layers] of this.originalLayers) if (!object.userData.packedCitySource && !object.userData.packedStaticSource) object.layers.mask = layers;
    this.originalLayers.clear();
  }
}
