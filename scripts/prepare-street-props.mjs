// Convert complete CC0 variants to local GLBs. Preserve geometry and 2K PBR maps.
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: prepare-street-props.mjs downloaded-directory output-directory');
await mkdir(output, { recursive: true });
const io = new NodeIO(), audit = {};
const specs = [
  ['bench', 'painted_wooden_bench', 'Kirill Sannikov', 1.45, 'x'],
  ['hydrant', 'fire_hydrant', 'Gonçalo Felício', .78, 'y'],
  ['pot', 'planter_pot_clay', 'Amal Kumar', .42, 'y'],
  ['plant', 'pachira_aquatica_01', 'Rico Cilliers / Rob Tuytel', 1.3, 'y'],
];
for (const [kind, asset, author, dimension, axis] of specs) {
  const document = await io.read(path.join(input, kind, `${kind}.gltf`));
  const root = document.getRoot();
  for (const node of [...root.listNodes()]) {
    if ((kind === 'hydrant' && node.getName().includes('aged')) || (kind === 'plant' && !node.getName().endsWith('_a'))) node.dispose();
  }
  for (const mesh of root.listMeshes()) if (!root.listNodes().some(node => node.getMesh() === mesh)) mesh.dispose();
  for (const material of root.listMaterials()) if (!root.listMeshes().some(mesh => mesh.listPrimitives().some(p => p.getMaterial() === material))) material.dispose();
  for (const texture of root.listTextures()) if (texture.listParents().every(parent => parent === root)) texture.dispose();
  const usedAccessors = new Set(root.listMeshes().flatMap(mesh => mesh.listPrimitives().flatMap(p => [...p.listSemantics().map(s => p.getAttribute(s)), p.getIndices()].filter(Boolean))));
  for (const accessor of root.listAccessors()) if (!usedAccessors.has(accessor)) accessor.dispose();
  const bounds = new THREE.Box3(), positions = [], point = new THREE.Vector3();
  const geometryHash = createHash('sha256'); let triangles = 0;
  for (const node of root.listNodes()) {
    const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const attribute = primitive.getAttribute('POSITION');
      triangles += (primitive.getIndices()?.getCount() ?? attribute.getCount()) / 3;
      for (const semantic of primitive.listSemantics()) geometryHash.update(Buffer.from(primitive.getAttribute(semantic).getArray().buffer));
      if (primitive.getIndices()) geometryHash.update(Buffer.from(primitive.getIndices().getArray().buffer));
      const v = [];
      for (let i = 0; i < attribute.getCount(); i++) {
        attribute.getElement(i, v); point.fromArray(v).applyMatrix4(matrix); bounds.expandByPoint(point); positions.push(point.clone());
      }
    }
  }
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  if (kind === 'plant') {
    // Centre the trunk, not the asymmetric canopy, in the real clay pot.
    const stem = new THREE.Box3(); positions.filter(p => p.y < bounds.min.y + size.y*.045).forEach(p => stem.expandByPoint(p));
    const anchor = stem.getCenter(new THREE.Vector3()); center.x = anchor.x; center.z = anchor.z;
  }
  const scale = dimension / size[axis];
  const parent = document.createNode(`Grounded complete ${kind}`).setScale([scale, scale, scale]).setTranslation([-center.x*scale, -bounds.min.y*scale, -center.z*scale]);
  const scene = root.listScenes()[0];
  for (const node of [...scene.listChildren()]) parent.addChild(node);
  scene.addChild(parent);
  const textureDimensions = [];
  for (const texture of root.listTextures()) {
    const bytes = texture.getImage(); const meta = await sharp(bytes).metadata();
    textureDimensions.push([meta.width, meta.height]);
    // Preserve resolution, normal detail, and roughness; no dynamic quality scaling.
    texture.setImage(await sharp(bytes).jpeg({quality:93,chromaSubsampling:'4:4:4'}).toBuffer()).setMimeType('image/jpeg');
  }
  const filename = path.join(output, `${kind}.glb`); await io.write(filename, document);
  const bytes = await readFile(filename);
  audit[kind] = { source:`https://polyhaven.com/a/${asset}`, author, license:'CC0-1.0', triangles, geometrySha256:geometryHash.digest('hex'), bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), textureDimensions, bounds:{min:[(bounds.min.x-center.x)*scale,0,(bounds.min.z-center.z)*scale],max:[(bounds.max.x-center.x)*scale,size.y*scale,(bounds.max.z-center.z)*scale]} };
}
await writeFile(path.join(output,'integrity.json'), JSON.stringify(audit,null,2)+'\n');
await writeFile(path.join(output,'ASSET-SOURCES.md'), '# Complete stock street props\n\nAll models are CC0 1.0 from Poly Haven.\n\n'+specs.map(([kind,asset,author])=>`- ${kind}: https://polyhaven.com/a/${asset} — ${author}`).join('\n')+'\n\nOnly a complete clean hydrant variant and complete braided Pachira variant A are selected. Original mesh topology, normals and UVs are retained. Uniform scale and ground pivot only; 2048 px PBR maps stay 2048 px, encoded as JPEG quality 93 with 4:4:4 chroma. No geometry decimation or runtime resolution reductions.\n');
console.log(JSON.stringify(audit,null,2));
