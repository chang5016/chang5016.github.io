import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { Document, NodeIO } from "@gltf-transform/core";
import sharp from "sharp";

const root = process.cwd();
const referencePath = path.join(root, "public", "character-reference.png");
const outputDir = path.join(root, "public", "models");
await mkdir(outputDir, { recursive: true });

const sourceImage = await readFile(referencePath);
const furTexture = await sharp(sourceImage)
  .extract({ left: 116, top: 250, width: 72, height: 72 })
  .resize(256, 256, { kernel: "lanczos3" })
  .modulate({ brightness: 1.08, saturation: 0.74 })
  .blur(0.55)
  .png()
  .toBuffer();

const doc = new Document();
const buffer = doc.createBuffer("capybara-reference-baked-mesh");
const scene = doc.createScene("Capybara scooter — reference sculpt");
doc.getRoot().setExtras({
  source: "User-supplied eight-view capybara scooter character sheet",
  authoring: "Reference-based sculpted PBR character and retro scooter",
  units: "meters",
});

const furMap = doc.createTexture("reference-fur-surface").setImage(furTexture).setMimeType("image/png");
const definitions = {
  fur: { color: 0xd4a16f, roughness: 0.93, texture: furMap },
  furShade: { color: 0xb88558, roughness: 0.96 },
  muzzle: { color: 0xc59469, roughness: 0.93 },
  nose: { color: 0x604a3b, roughness: 0.81 },
  paw: { color: 0x59443b, roughness: 0.91 },
  olive: { color: 0x697247, roughness: 0.34, metalness: 0.17 },
  oliveLight: { color: 0x858c58, roughness: 0.32, metalness: 0.13 },
  oliveDark: { color: 0x414a31, roughness: 0.51, metalness: 0.15 },
  cream: { color: 0xe9debd, roughness: 0.48, metalness: 0.03 },
  leather: { color: 0x594940, roughness: 0.84 },
  leatherLight: { color: 0x786256, roughness: 0.76 },
  rubber: { color: 0x262724, roughness: 0.98 },
  tread: { color: 0x41423e, roughness: 0.93 },
  chrome: { color: 0xb8bab7, roughness: 0.2, metalness: 0.9 },
  steel: { color: 0x777671, roughness: 0.41, metalness: 0.75 },
  brass: { color: 0xbd975a, roughness: 0.32, metalness: 0.73 },
  glass: { color: 0xa9d4dc, roughness: 0.15, metalness: 0.18, alpha: 0.7 },
  white: { color: 0xf6efdf, roughness: 0.58 },
  pupil: { color: 0x24211e, roughness: 0.29 },
  tongue: { color: 0xe97677, roughness: 0.64 },
  red: { color: 0xcf514b, roughness: 0.38 },
  amber: { color: 0xe8ad53, roughness: 0.36 },
  lamp: { color: 0xfff1ca, roughness: 0.23, emissive: 0xffe0a1 },
};

const materialCache = new Map();
for (const [key, definition] of Object.entries(definitions)) {
  const linear = new THREE.Color(definition.color);
  const material = doc.createMaterial(key)
    .setBaseColorFactor([linear.r, linear.g, linear.b, definition.alpha ?? 1])
    .setRoughnessFactor(definition.roughness)
    .setMetallicFactor(definition.metalness ?? 0.02)
    .setDoubleSided(true);
  if (definition.texture) material.setBaseColorTexture(definition.texture);
  if (definition.alpha) material.setAlphaMode("BLEND");
  if (definition.emissive) {
    const glow = new THREE.Color(definition.emissive);
    material.setEmissiveFactor([glow.r * 0.62, glow.g * 0.62, glow.b * 0.62]);
  }
  materialCache.set(key, material);
}

const buckets = new Map();
const tempQuaternion = new THREE.Quaternion();

function push(geometry, material, { x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, group = "vehicle" } = {}) {
  const clone = geometry.clone();
  const transform = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  clone.applyMatrix4(transform);
  clone.computeVertexNormals();
  const flat = clone.index ? clone.toNonIndexed() : clone;
  const key = `${group}/${material}`;
  if (!buckets.has(key)) buckets.set(key, { group, material, positions: [], normals: [], uvs: [] });
  const entry = buckets.get(key);
  entry.positions.push(flat.getAttribute("position").array);
  entry.normals.push(flat.getAttribute("normal").array);
  const uv = flat.getAttribute("uv");
  entry.uvs.push(uv ? uv.array : new Float32Array((flat.getAttribute("position").array.length / 3) * 2));
}

const rounded = (w, h, d, radius = 0.1, segments = 5) => new RoundedBoxGeometry(w, h, d, segments, radius);
const sphere = (radius = 1, segments = 36) => new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.7));
const tube = (points, radius, segments = 36) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((point) => new THREE.Vector3(...point))), segments, radius, 10, false);

function capsule(a, b, radius, material, options = {}) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const delta = end.clone().sub(start);
  const length = delta.length();
  const geometry = new THREE.CapsuleGeometry(radius, Math.max(length - radius * 2, 0.01), 8, 16);
  tempQuaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  const euler = new THREE.Euler().setFromQuaternion(tempQuaternion);
  const mid = start.add(end).multiplyScalar(0.5);
  push(geometry, material, { x: mid.x, y: mid.y, z: mid.z, rx: euler.x, ry: euler.y, rz: euler.z, ...options });
}

function shapeFrom(points, depth, bevel = 0.07) {
  const shape = new THREE.Shape();
  shape.moveTo(...points[0]);
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (point.length === 6) shape.bezierCurveTo(...point);
    else shape.lineTo(...point);
  }
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 4, steps: 1, bevelSize: bevel, bevelThickness: bevel, curveSegments: 26 });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// Retro scooter: continuous curved body panels, rolled shield, stitched saddle and mechanical details.
push(rounded(1.3, 0.34, 3.65, 0.16, 7), "oliveDark", { y: 0.81, z: -0.12 });
push(rounded(1.17, 0.1, 2.24, 0.05, 5), "rubber", { y: 1.02, z: 0.18 });
for (let ridge = -0.41; ridge <= 0.41; ridge += 0.14) push(rounded(0.026, 0.03, 1.93, 0.01, 3), "tread", { x: ridge, y: 1.085, z: 0.09 });

const rearShell = sphere(1, 46);
push(rearShell, "olive", { y: 1.06, z: -1.15, sx: 0.94, sy: 0.59, sz: 1.34 });
push(rounded(1.73, 0.42, 1.64, 0.21, 7), "olive", { y: 1.29, z: -1.14 });
for (const side of [-1, 1]) {
  push(shapeFrom([[-0.7, -0.31], [-0.65, 0.12, -0.4, 0.36, 0.14, 0.35], [0.7, 0.34], [0.72, -0.2], [0.36, -0.35], [-0.7, -0.31]], 0.075, 0.045), "cream", { x: side * 0.885, y: 1.09, z: -1.17, ry: Math.PI / 2, sx: side });
  for (let vent = 0; vent < 7; vent++) push(rounded(0.024, 0.15, 0.024, 0.007, 3), "oliveDark", { x: side * 0.947, y: 1.11 + Math.sin(vent) * 0.01, z: -1.36 + vent * 0.075 });
}

const shield = shapeFrom([
  [-0.72, -0.86], [-0.81, -0.24, -0.78, 0.43, -0.56, 0.74],
  [-0.37, 0.99, 0.37, 0.99, 0.56, 0.74], [0.78, 0.43, 0.81, -0.24, 0.72, -0.86],
  [0.34, -1.01, -0.34, -1.01, -0.72, -0.86],
], 0.2, 0.075);
push(shield, "oliveLight", { y: 1.53, z: 1.23 });
push(shapeFrom([
  [-0.49, -0.64], [-0.56, -0.19, -0.48, 0.52, -0.3, 0.67],
  [-0.17, 0.79, 0.17, 0.79, 0.3, 0.67], [0.48, 0.52, 0.56, -0.19, 0.49, -0.64],
  [0.22, -0.75, -0.22, -0.75, -0.49, -0.64],
], 0.047, 0.036), "cream", { y: 1.48, z: 1.384 });

const saddle = rounded(1.19, 0.36, 2.26, 0.17, 8);
push(saddle, "leather", { y: 1.58, z: -0.76 });
push(rounded(1.03, 0.05, 2.03, 0.026, 5), "leatherLight", { y: 1.78, z: -0.77 });
for (let index = 0; index < 10; index++) {
  push(tube([[-0.51, 1.811, -1.68 + index * 0.2], [0, 1.822, -1.68 + index * 0.2], [0.51, 1.811, -1.68 + index * 0.2]], 0.012, 16), "leather");
}

// Wheels, radial hubs, spokes and individual tread strips.
for (const z of [-1.63, 1.33]) {
  push(new THREE.TorusGeometry(0.51, 0.17, 14, 46), "rubber", { y: 0.57, z, ry: Math.PI / 2, group: "wheels" });
  push(new THREE.CylinderGeometry(0.38, 0.38, 0.39, 38), "steel", { y: 0.57, z, rz: Math.PI / 2, group: "wheels" });
  push(new THREE.CylinderGeometry(0.12, 0.12, 0.44, 28), "chrome", { y: 0.57, z, rz: Math.PI / 2, group: "wheels" });
  for (let spoke = 0; spoke < 12; spoke++) {
    const angle = spoke * Math.PI / 6;
    capsule([-0.205, 0.57, z], [-0.21, 0.57 + Math.sin(angle) * 0.31, z + Math.cos(angle) * 0.31], 0.016, "chrome", { group: "wheels" });
  }
  for (let tread = 0; tread < 18; tread++) {
    const angle = tread * Math.PI / 9;
    push(rounded(0.045, 0.035, 0.26, 0.012, 4), "tread", { y: 0.57 + Math.sin(angle) * 0.65, z: z + Math.cos(angle) * 0.65, rx: angle, group: "wheels" });
  }
}

push(new THREE.TorusGeometry(0.68, 0.095, 10, 34, Math.PI), "oliveLight", { y: 0.58, z: 1.33, ry: Math.PI / 2, rz: Math.PI / 2 });
capsule([0, 1.13, 1.14], [0, 2.35, 1.13], 0.105, "oliveDark");
push(tube([[-1.02, 2.35, 1.08], [-0.51, 2.4, 1.11], [0, 2.36, 1.12], [0.51, 2.4, 1.11], [1.02, 2.35, 1.08]], 0.07, 42), "chrome");
for (const side of [-1, 1]) {
  push(rounded(0.36, 0.135, 0.16, 0.06, 5), "rubber", { x: side * 1.01, y: 2.35, z: 1.08 });
  capsule([side * 0.94, 2.41, 1.06], [side * 1.17, 2.98, 1.06], 0.032, "chrome");
  push(sphere(1, 28), "chrome", { x: side * 1.2, y: 3.02, z: 1.08, sx: 0.22, sy: 0.16, sz: 0.075 });
  push(sphere(1, 24), "glass", { x: side * 1.2, y: 3.02, z: 1.16, sx: 0.18, sy: 0.12, sz: 0.028 });
  push(sphere(1, 22), "amber", { x: side * 0.59, y: 1.05, z: 1.445, sx: 0.15, sy: 0.2, sz: 0.068 });
}
push(new THREE.CylinderGeometry(0.37, 0.4, 0.26, 36), "chrome", { y: 2.18, z: 1.4, rx: Math.PI / 2 });
push(new THREE.CylinderGeometry(0.335, 0.335, 0.06, 36), "lamp", { y: 2.18, z: 1.558, rx: Math.PI / 2 });
push(rounded(0.62, 0.34, 0.15, 0.13, 6), "red", { y: 1.08, z: -2.05 });
push(rounded(0.71, 0.33, 0.06, 0.04, 4), "cream", { y: 0.69, z: -2.09 });
capsule([-0.7, 0.57, -1.86], [0.7, 0.57, -1.86], 0.04, "chrome");

// Driver: rounded anatomy and the exact olive aviator helmet / goggles / tongue motifs from the eight-view sheet.
push(sphere(1, 54), "fur", { y: 2.07, z: -0.29, sx: 0.95, sy: 1.03, sz: 0.86, group: "capybara" });
push(sphere(1, 50), "furShade", { y: 1.92, z: -0.12, sx: 0.77, sy: 0.9, sz: 0.75, group: "capybara" });
push(sphere(1, 56), "fur", { y: 2.85, z: 0.42, sx: 0.79, sy: 0.65, sz: 0.74, group: "capybara" });
push(sphere(1, 48), "muzzle", { y: 2.65, z: 1.02, sx: 0.62, sy: 0.4, sz: 0.49, group: "capybara" });
push(sphere(1, 40), "furShade", { y: 2.53, z: 1.16, sx: 0.49, sy: 0.22, sz: 0.23, group: "capybara" });

for (const side of [-1, 1]) {
  capsule([side * 0.72, 2.42, 0.1], [side * 0.92, 2.4, 1.04], 0.19, "fur", { group: "capybara" });
  push(sphere(1, 31), "paw", { x: side * 0.97, y: 2.39, z: 1.06, sx: 0.22, sy: 0.14, sz: 0.23, group: "capybara" });
  for (let finger = -1; finger <= 1; finger++) capsule([side * 0.92 + finger * 0.045, 2.39, 1.23], [side * 0.92 + finger * 0.045, 2.34, 1.3], 0.018, "paw", { group: "capybara" });
  push(sphere(1, 27), "paw", { x: side * 0.46, y: 1.39, z: 0.25, sx: 0.32, sy: 0.16, sz: 0.31, group: "capybara" });
  push(sphere(1, 29), "furShade", { x: side * 0.57, y: 3.51, z: 0.17, sx: 0.19, sy: 0.2, sz: 0.105, group: "capybara" });
  push(sphere(1, 20), "muzzle", { x: side * 0.57, y: 3.51, z: 0.27, sx: 0.11, sy: 0.13, sz: 0.035, group: "capybara" });
  push(sphere(1, 28), "white", { x: side * 0.28, y: 2.94, z: 1.015, sx: 0.18, sy: 0.115, sz: 0.052, group: "capybara" });
  push(sphere(1, 24), "pupil", { x: side * 0.28, y: 2.927, z: 1.075, sx: 0.064, sy: 0.074, sz: 0.034, group: "capybara" });
  push(rounded(0.32, 0.045, 0.04, 0.018, 4), "furShade", { x: side * 0.28, y: 3.065, z: 1.078, rz: side * -0.09, group: "capybara" });
  push(sphere(1, 18), "nose", { x: side * 0.095, y: 2.7, z: 1.48, sx: 0.055, sy: 0.036, sz: 0.024, group: "capybara" });
}
push(sphere(1, 26), "tongue", { x: 0.07, y: 2.37, z: 1.35, sx: 0.135, sy: 0.23, sz: 0.075, group: "capybara" });
push(tube([[-0.24, 2.45, 1.38], [0, 2.39, 1.41], [0.25, 2.45, 1.38]], 0.015, 18), "nose", { group: "capybara" });

const helmetShell = new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.61);
push(helmetShell, "oliveLight", { y: 2.91, z: 0.4, sx: 0.87, sy: 0.75, sz: 0.8, group: "helmet" });
for (const side of [-1, 1]) push(rounded(0.17, 0.66, 0.54, 0.08, 6), "olive", { x: side * 0.79, y: 2.91, z: 0.29, group: "helmet" });
push(tube([[-0.79, 2.72, 0.97], [-0.44, 2.63, 1.15], [0, 2.59, 1.18], [0.44, 2.63, 1.15], [0.79, 2.72, 0.97]], 0.032, 38), "leather", { group: "helmet" });
push(tube([[-0.82, 3.16, 0.62], [-0.43, 3.19, 1.08], [0, 3.2, 1.16], [0.43, 3.19, 1.08], [0.82, 3.16, 0.62]], 0.06, 44), "leather", { group: "helmet" });
for (const side of [-1, 1]) {
  push(new THREE.TorusGeometry(0.245, 0.048, 11, 40), "brass", { x: side * 0.285, y: 3.27, z: 1.19, group: "helmet" });
  push(sphere(1, 34), "glass", { x: side * 0.285, y: 3.27, z: 1.225, sx: 0.204, sy: 0.18, sz: 0.035, group: "helmet" });
  push(new THREE.TorusGeometry(0.19, 0.014, 8, 35), "chrome", { x: side * 0.285, y: 3.27, z: 1.247, group: "helmet" });
}
push(rounded(0.13, 0.09, 0.055, 0.022, 4), "brass", { y: 3.27, z: 1.255, group: "helmet" });

function concatenate(arrays) {
  const length = arrays.reduce((count, array) => count + array.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const array of arrays) { merged.set(array, offset); offset += array.length; }
  return merged;
}

const groupNodes = new Map();
for (const [key, entry] of buckets) {
  if (!groupNodes.has(entry.group)) {
    const node = doc.createNode(entry.group);
    scene.addChild(node);
    groupNodes.set(entry.group, node);
  }
  const bakedGeometry = new THREE.BufferGeometry();
  bakedGeometry.setAttribute("position", new THREE.BufferAttribute(concatenate(entry.positions), 3));
  bakedGeometry.setAttribute("normal", new THREE.BufferAttribute(concatenate(entry.normals), 3));
  bakedGeometry.setAttribute("uv", new THREE.BufferAttribute(concatenate(entry.uvs), 2));
  const indexedGeometry = mergeVertices(bakedGeometry, 0.0001);
  const positionAccessor = doc.createAccessor(`${key}-positions`, buffer).setType("VEC3").setArray(indexedGeometry.getAttribute("position").array);
  const normalAccessor = doc.createAccessor(`${key}-normals`, buffer).setType("VEC3").setArray(indexedGeometry.getAttribute("normal").array);
  const uvAccessor = doc.createAccessor(`${key}-uvs`, buffer).setType("VEC2").setArray(indexedGeometry.getAttribute("uv").array);
  const indexAccessor = doc.createAccessor(`${key}-indices`, buffer).setType("SCALAR").setArray(indexedGeometry.getIndex().array);
  const primitive = doc.createPrimitive()
    .setAttribute("POSITION", positionAccessor)
    .setAttribute("NORMAL", normalAccessor)
    .setAttribute("TEXCOORD_0", uvAccessor)
    .setIndices(indexAccessor)
    .setMaterial(materialCache.get(entry.material));
  const mesh = doc.createMesh(`${key}-sculpted-surface`).addPrimitive(primitive);
  const node = doc.createNode(`${entry.material}-surface`).setMesh(mesh);
  groupNodes.get(entry.group).addChild(node);
}

const outputPath = path.join(outputDir, "capybara-scooter-reference.glb");
await new NodeIO().write(outputPath, doc);
let triangles = 0;
for (const entry of buckets.values()) {
  for (const positions of entry.positions) triangles += positions.length / 9;
}
console.log(JSON.stringify({ output: outputPath, materials: materialCache.size, groups: groupNodes.size, triangles: Math.round(triangles), reference: referencePath }));
