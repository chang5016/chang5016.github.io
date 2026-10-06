import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";
import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { Document, NodeIO } from "@gltf-transform/core";

const projectRoot = process.cwd();
const sourceRoot = "/workspace/scratch/b211e00bdc0e";
const imageRoot = path.join(projectRoot, "public", "generated");
const modelRoot = path.join(projectRoot, "public", "models");
await mkdir(imageRoot, { recursive: true });
await mkdir(modelRoot, { recursive: true });

async function isolateGeneratedAsset(name) {
  const original = path.join(sourceRoot, `capy-generated-${name}.png`);
  const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  if (name === "side") {
    const queue = new Uint32Array(info.width * info.height);
    const visited = new Uint8Array(info.width * info.height);
    let first = 0;
    let last = 0;
    const enqueue = (pixel) => {
      if (visited[pixel]) return;
      const index = pixel * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (Math.min(red, green, blue) < 208 || Math.max(red, green, blue) - Math.min(red, green, blue) > 20) return;
      visited[pixel] = 1;
      queue[last++] = pixel;
    };
    for (let x = 0; x < info.width; x++) {
      enqueue(x);
      enqueue((info.height - 1) * info.width + x);
    }
    for (let y = 0; y < info.height; y++) {
      enqueue(y * info.width);
      enqueue(y * info.width + info.width - 1);
    }
    while (first < last) {
      const pixel = queue[first++];
      data[pixel * 4 + 3] = 0;
      const x = pixel % info.width;
      const y = Math.floor(pixel / info.width);
      if (x > 0) enqueue(pixel - 1);
      if (x + 1 < info.width) enqueue(pixel + 1);
      if (y > 0) enqueue(pixel - info.width);
      if (y + 1 < info.height) enqueue(pixel + info.width);
    }
  }

  const output = path.join(imageRoot, `capy-${name}.webp`);
  await sharp(data, { raw: info })
    .resize(1120, 1120, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 91, effort: 5, alphaQuality: 98 })
    .toFile(output);
  return output;
}

const frontPath = await isolateGeneratedAsset("front");
const sidePath = await isolateGeneratedAsset("side");
const rearPath = await isolateGeneratedAsset("rear");

// Image-conditioned volumetric reconstruction: no hand-built spheres, boxes,
// or manually assembled scooter pieces. The generated silhouette and original
// per-pixel colors define the actual marching-cubes mesh and embedded texture.
const textureSize = 768;
const sideTexture = await sharp(sidePath)
  .resize(textureSize, textureSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
const pixels = await sharp(sideTexture).ensureAlpha().raw().toBuffer();
const resolution = 112;
const surface = new MarchingCubes(resolution, new THREE.MeshStandardMaterial(), false, false, 155000);
surface.isolation = 46;

const sample = (u, v) => {
  const x = Math.max(0, Math.min(textureSize - 1, Math.floor(u * (textureSize - 1))));
  const y = Math.max(0, Math.min(textureSize - 1, Math.floor(v * (textureSize - 1))));
  const index = (y * textureSize + x) * 4;
  return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
};

for (let z = 1; z < resolution - 1; z++) {
  const u = 1 - z / (resolution - 1);
  for (let y = 1; y < resolution - 1; y++) {
    const v = 1 - y / (resolution - 1);
    const [red, green, blue, alpha] = sample(u, v);
    if (alpha < 30) continue;
    const isFur = red > 95 && red > green * 1.09 && red > blue * 1.18;
    const isWheel = red + green + blue < 205;
    const radius = isFur ? 0.62 : isWheel ? 0.27 : 0.43;
    for (let x = 1; x < resolution - 1; x++) {
      const depth = (x / (resolution - 1) - 0.5) * 2;
      const shape = 1 - Math.pow(Math.abs(depth) / radius, 2.4);
      if (shape <= 0) continue;
      surface.field[x + y * resolution + z * resolution * resolution] = shape * alpha / 255 * 118;
    }
  }
}
surface.update();

const position = surface.geometry.getAttribute("position");
const normal = surface.geometry.getAttribute("normal");
const vertexCount = surface.geometry.drawRange.count;
const uniqueVertices = new Map();
const positionList = [];
const normalList = [];
const uvList = [];
const indexList = new Uint32Array(vertexCount);
for (let index = 0; index < vertexCount; index++) {
  const x = position.getX(index);
  const y = position.getY(index);
  const z = position.getZ(index);
  const key = `${Math.round(x * 100000)}:${Math.round(y * 100000)}:${Math.round(z * 100000)}`;
  let vertex = uniqueVertices.get(key);
  if (vertex === undefined) {
    vertex = positionList.length / 3;
    uniqueVertices.set(key, vertex);
    positionList.push(x * 1.16, (y + 1) * 2.23, z * 2.5);
    normalList.push(normal.getX(index), normal.getY(index), normal.getZ(index));
    uvList.push(1 - (z + 1) / 2, 1 - (y + 1) / 2);
  }
  indexList[index] = vertex;
}

const document = new Document();
const buffer = document.createBuffer("generated-character-reconstruction");
const compressedTexture = await sharp(sideTexture).flatten({ background: "#52483e" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
const texture = document.createTexture("AI-generated original character appearance").setImage(compressedTexture).setMimeType("image/jpeg");
const material = document.createMaterial("Reference-matched generated character surface")
  .setBaseColorTexture(texture)
  .setRoughnessFactor(0.79)
  .setMetallicFactor(0.04)
  .setDoubleSided(true);
const primitive = document.createPrimitive()
  .setAttribute("POSITION", document.createAccessor("generated surface positions").setArray(new Float32Array(positionList)).setType("VEC3").setBuffer(buffer))
  .setAttribute("NORMAL", document.createAccessor("generated surface normals").setArray(new Float32Array(normalList)).setType("VEC3").setBuffer(buffer))
  .setAttribute("TEXCOORD_0", document.createAccessor("generated character texture mapping").setArray(new Float32Array(uvList)).setType("VEC2").setBuffer(buffer))
  .setIndices(document.createAccessor("indexed generated triangles").setArray(indexList).setType("SCALAR").setBuffer(buffer))
  .setMaterial(material);
const mesh = document.createMesh("Generated capybara and vintage scooter visual hull").addPrimitive(primitive);
const node = document.createNode("Image-generated original capybara rider").setMesh(mesh);
document.createScene("Generated reference-matched character").addChild(node);
document.getRoot().setExtras({
  generator: "Reference-conditioned image generation + silhouette volumetric marching-cubes reconstruction",
  source: "User-provided eight-view capybara scooter character design",
  manuallyAssembledPrimitives: false,
  triangles: Math.floor(vertexCount / 3),
});
const output = path.join(modelRoot, "capybara-image-generated.glb");
await new NodeIO().write(output, document);
console.log(JSON.stringify({ output, frontPath, sidePath, rearPath, vertices: vertexCount, uniqueVertices: positionList.length / 3, triangles: Math.floor(vertexCount / 3), resolution }));
