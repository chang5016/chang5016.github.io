import * as THREE from "three";

export function invalidateShadowScene(object:THREE.Object3D,staticChanged=true) {
  let root=object;while(root.parent)root=root.parent;
  const key=staticChanged?'staticShadowRevision':'shadowActorsRevision';
  root.userData[key]=(root.userData[key]??0)+1;
}

/** Keep every mesh; only eliminate recomputing unchanged transforms. */
export function freezeStaticScene(root: THREE.Object3D) {
  const objects: THREE.Object3D[] = [];
  const visit = (object: THREE.Object3D) => {
    if (object.userData.dynamicWorldObject || (object as THREE.Light).isLight ||
        (object as THREE.SkinnedMesh).isSkinnedMesh || (object as THREE.Bone).isBone) return;
    object.updateMatrix();
    object.matrixWorldAutoUpdate = true;
    objects.push(object);
    for (const child of object.children) visit(child);
  };
  // The owner remains live so later streamed children inherit its transform.
  for (const child of root.children) visit(child);
  root.updateWorldMatrix(true, true);
  for (const object of objects) {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
  }
  invalidateShadowScene(root);
  return objects.length;
}
