// Shrinks the deployable static build without touching the source assets in public/.
//
// Usage: node scripts/optimize-pages.mjs dist-pages
//
// - GLB geometry: EXT_meshopt_compression in lossless mode (no reorder, no quantize),
//   so vertex order and values stay bit-identical for rigs, wheel masks and poses.
//   Only the listed photo-scanned street props are simplified (see SIMPLIFY).
//   Draco files are left as they are.
// - GLB textures: capped at 2048 px and re-encoded to WebP when that is smaller.
// - Loose textures: capped at 2048 px and re-encoded in their own format when smaller.
// The runtime registers MeshoptDecoder on every GLTFLoader (see web/main.tsx).
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import { simplify, weld } from "@gltf-transform/functions";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, EXTTextureWebP } from "@gltf-transform/extensions";

const MAX_TEXTURE = 2048;
// Photo-scanned street props carry far more triangles than they cover on screen.
// Error is relative to each model's size (0.002 of an 80 cm hydrant is under 2 mm).
// Rigged and vertex-indexed models (the capybara, riders) are never simplified.
const SIMPLIFY = {
  "models/street-props/hydrant.glb": 0.002,
  "models/street-props/plant.glb": 0.002,
  "models/street-props/pot.glb": 0.002,
};
const root = path.resolve(process.argv[2] ?? "dist-pages");

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

async function encodeImage(input, format, { normal = false } = {}) {
  const image = sharp(input, { failOn: "none" });
  const meta = await image.metadata();
  if (meta.width > MAX_TEXTURE || meta.height > MAX_TEXTURE) {
    image.resize({ width: MAX_TEXTURE, height: MAX_TEXTURE, fit: "inside" });
  }
  if (format === "webp") image.webp({ quality: normal ? 92 : 86, effort: 5, smartSubsample: true });
  else if (format === "jpeg") image.jpeg({ quality: normal ? 92 : 86, mozjpeg: true });
  else if (format === "png") image.png({ compressionLevel: 9, palette: false });
  return image.toBuffer();
}

// Normal, roughness and ORM maps carry data rather than colour, so they get a higher quality.
const isNormal = (name = "") => /nor(mal)?(_?gl)?|_n\b|rough|orm|metal/i.test(name);

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

let before = 0;
let after = 0;
const files = await walk(root);

for (const file of files.filter((f) => f.endsWith(".glb"))) {
  const original = await fs.readFile(file);
  const jsonLength = original.readUInt32LE(12);
  const json = JSON.parse(original.subarray(20, 20 + jsonLength).toString());
  const used = json.extensionsUsed ?? [];
  if (used.includes("KHR_draco_mesh_compression") || used.includes("EXT_meshopt_compression")) continue;
  // Small kit models that reference shared external textures stay untouched.
  if ((json.images ?? []).some((image) => image.uri)) continue;

  const doc = await io.readBinary(new Uint8Array(original));
  const simplifyError = SIMPLIFY[path.relative(root, file).split(path.sep).join("/")];
  if (simplifyError) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: simplifyError, lockBorder: true }));
  let webp = false;
  for (const texture of doc.getRoot().listTextures()) {
    const data = texture.getImage();
    if (!data) continue;
    const slots = doc.getGraph().listParentEdges(texture).map((edge) => edge.getName()).join(" ");
    const encoded = await encodeImage(Buffer.from(data), "webp", { normal: /normal/i.test(slots) || isNormal(texture.getName()) });
    if (encoded.length < data.byteLength) {
      texture.setImage(new Uint8Array(encoded)).setMimeType("image/webp");
      if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.(png|jpe?g)$/i, ".webp"));
      webp = true;
    }
  }
  if (webp) doc.createExtension(EXTTextureWebP).setRequired(true);
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  const optimized = Buffer.from(await io.writeBinary(doc));
  before += original.length;
  if (optimized.length < original.length) {
    await fs.writeFile(file, optimized);
    after += optimized.length;
    console.log(`glb  ${(original.length / 1e6).toFixed(2)} -> ${(optimized.length / 1e6).toFixed(2)} MB  ${path.relative(root, file)}`);
  } else after += original.length;
}

const formats = { ".jpg": "jpeg", ".jpeg": "jpeg", ".webp": "webp", ".png": "png" };
for (const file of files.filter((f) => /\/(models|textures)\//.test(f) && formats[path.extname(f).toLowerCase()])) {
  const original = await fs.readFile(file);
  if (original.length < 200_000) continue;
  const encoded = await encodeImage(original, formats[path.extname(file).toLowerCase()], { normal: isNormal(path.basename(file)) });
  before += original.length;
  if (encoded.length < original.length * 0.95) {
    await fs.writeFile(file, encoded);
    after += encoded.length;
    console.log(`img  ${(original.length / 1e6).toFixed(2)} -> ${(encoded.length / 1e6).toFixed(2)} MB  ${path.relative(root, file)}`);
  } else after += original.length;
}

console.log(`\nOptimized assets: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
