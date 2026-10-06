import { NodeIO } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import { writeFile } from 'node:fs/promises';

await MeshoptSimplifier.ready;
const io = new NodeIO();
const doc = await io.read('public/models/capybara-premium-original.glb');
const report = [];
for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
  const positions = primitive.getAttribute('POSITION').getArray();
  const uv = primitive.getAttribute('TEXCOORD_0').getArray();
  const normals = primitive.getAttribute('NORMAL').getArray();
  const attributes = new Float32Array(positions.length / 3 * 5);
  for (let i = 0; i < positions.length / 3; i++) attributes.set([uv[i*2], uv[i*2+1], normals[i*3], normals[i*3+1], normals[i*3+2]], i*5);
  const original = Uint32Array.from(primitive.getIndices().getArray());
  const [indices, error] = MeshoptSimplifier.simplifyWithAttributes(original, positions, 3, attributes, 5, [.5, .5, .1, .1, .1], null, Math.floor(original.length * .35 / 3) * 3, .001, ['LockBorder']);
  primitive.getIndices().setArray(indices);
  report.push({ originalTriangles: original.length / 3, drivingTriangles: indices.length / 3, normalizedError: error, textureChanges: false });
}
await io.write('public/models/capybara-driving.glb', doc);
await writeFile('public/models/capybara-driving.audit.json', JSON.stringify(report, null, 2));
console.log(report);
