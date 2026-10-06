// Offline asset build. Install @gltf-transform/{core,extensions,functions}@4.4.2,
// draco3dgltf and sharp in STREET_ASSET_TOOLS (or this project) before running.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(`${process.env.STREET_ASSET_TOOLS || process.cwd()}/package.json`);
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const { dedup, prune, draco, textureCompress } = require("@gltf-transform/functions");
const draco3d = require("draco3dgltf");
const sharp = require("sharp");
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/prepare-intact-street.mjs SOURCE.glb OUTPUT.glb");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.encoder": await draco3d.createEncoderModule(),
  "draco3d.decoder": await draco3d.createDecoderModule(),
});
const document = await io.read(input);
const inspect = (doc) => {
  let triangles = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const surfaces = [];
  for (const node of doc.getRoot().listNodes()) {
    const matrix = node.getWorldMatrix();
    for (const primitive of node.getMesh()?.listPrimitives() || []) {
      if (primitive.getMode() !== 4) continue;
      const positions = primitive.getAttribute("POSITION");
      const count = (primitive.getIndices()?.getCount() || positions.getCount()) / 3;
      triangles += count;
      surfaces.push({ name: node.getName(), triangles: count });
      const p = [];
      for (let i = 0; i < positions.getCount(); i++) {
        positions.getElement(i, p);
        for (let axis = 0; axis < 3; axis++) {
          const value = matrix[axis] * p[0] + matrix[axis + 4] * p[1] + matrix[axis + 8] * p[2] + matrix[axis + 12];
          min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
        }
      }
    }
  }
  return { triangles, min, max, surfaces };
};
const before = inspect(document);
let removedLinePrimitives = 0;
for (const mesh of document.getRoot().listMeshes()) {
  for (const primitive of [...mesh.listPrimitives()]) {
    // SketchUp edge overlays only: never discard a wall, roof, pavement or triangle.
    if (primitive.getMode() === 1) { mesh.removePrimitive(primitive); removedLinePrimitives++; }
    else assert.equal(primitive.getMode(), 4);
  }
}
await document.transform(dedup(), prune(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 90 }),
  draco({ method: "sequential", quantizePosition: 20, quantizeNormal: 12, quantizeTexcoord: 16 }));
await io.write(output, document);
const after = inspect(await io.read(output));
assert.equal(after.triangles, before.triangles, "Every original surface triangle must survive compression");
assert.deepEqual(after.surfaces, before.surfaces, "Every authored material surface must remain complete");
for (let axis = 0; axis < 3; axis++) {
  assert.ok(Math.abs(after.min[axis] - before.min[axis]) < 0.02);
  assert.ok(Math.abs(after.max[axis] - before.max[axis]) < 0.02);
}
const source = await readFile(input), result = await readFile(output);
const report = { sourceSha256: createHash("sha256").update(source).digest("hex"), outputSha256: createHash("sha256").update(result).digest("hex"),
  sourceBytes: source.length, outputBytes: result.length, removedLinePrimitives, spatialCropping: false, simplified: false, before, after };
await writeFile(output.replace(/\.glb$/, ".integrity.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ triangles: after.triangles, sourceBytes: source.length, outputBytes: result.length, removedLinePrimitives }));
