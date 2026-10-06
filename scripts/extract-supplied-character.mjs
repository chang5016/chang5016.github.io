import { readFile } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";

const [, , sourcePath, outputPath] = process.argv;

if (!sourcePath || !outputPath) {
  throw new Error("Usage: node scripts/extract-supplied-character.mjs <source.glb> <output.glb>");
}

const sourceBytes = await readFile(sourcePath);
const sourceMetadata = JSON.parse(sourceBytes.toString("utf8", 20, 20 + sourceBytes.readUInt32LE(12)));
const document = await new NodeIO().read(sourcePath);
const root = document.getRoot();
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];

if (!primitive || root.listMeshes().length !== 1 || sourceMetadata.asset.generator !== "Tripo") {
  throw new Error("Expected the supplied single-mesh, eight-view Tripo GLB.");
}

const originalPositions = primitive.getAttribute("POSITION");
const originalNormals = primitive.getAttribute("NORMAL");
const originalUvs = primitive.getAttribute("TEXCOORD_0");
const originalIndices = primitive.getIndices();

if (!originalPositions || !originalNormals || !originalUvs || !originalIndices) {
  throw new Error("The supplied character must contain indexed positions, normals, and texture coordinates.");
}

const positions = originalPositions.getArray();
const normals = originalNormals.getArray();
const uvs = originalUvs.getArray();
const indices = originalIndices.getArray();
const vertexCount = originalPositions.getCount();
const parents = new Uint32Array(vertexCount);
const componentSizes = new Uint32Array(vertexCount);

for (let index = 0; index < vertexCount; index++) {
  parents[index] = index;
  componentSizes[index] = 1;
}

function find(vertex) {
  while (parents[vertex] !== vertex) {
    parents[vertex] = parents[parents[vertex]];
    vertex = parents[vertex];
  }
  return vertex;
}

function connect(left, right) {
  let leftRoot = find(left);
  let rightRoot = find(right);
  if (leftRoot === rightRoot) return;

  if (componentSizes[leftRoot] < componentSizes[rightRoot]) {
    [leftRoot, rightRoot] = [rightRoot, leftRoot];
  }

  parents[rightRoot] = leftRoot;
  componentSizes[leftRoot] += componentSizes[rightRoot];
}

for (let index = 0; index < indices.length; index += 3) {
  connect(indices[index], indices[index + 1]);
  connect(indices[index], indices[index + 2]);
}

const components = new Map();

for (let vertex = 0; vertex < vertexCount; vertex++) {
  const identity = find(vertex);
  let component = components.get(identity);

  if (!component) {
    component = { vertices: 0, x: 0, y: 0, z: 0 };
    components.set(identity, component);
  }

  component.vertices++;
  component.x += positions[vertex * 3];
  component.y += positions[vertex * 3 + 1];
  component.z += positions[vertex * 3 + 2];
}

// The source contains four columns and two rows of complete 3D riders.
// Keep the lower row's third, front-three-quarter rider. Select entire
// connected surfaces rather than clipping triangles at an arbitrary plane.
const selectedComponents = new Set();

for (const [identity, component] of components) {
  const centerX = component.x / component.vertices;
  const centerZ = component.z / component.vertices;

  if (centerZ > 0 && centerX >= 0 && centerX < 0.31) {
    selectedComponents.add(identity);
  }
}

const selectedVertices = [...Array(vertexCount).keys()].filter((vertex) => selectedComponents.has(find(vertex)));
const selectedIndices = [];

for (let index = 0; index < indices.length; index += 3) {
  if (selectedComponents.has(find(indices[index]))) selectedIndices.push(indices[index], indices[index + 1], indices[index + 2]);
}

if (selectedVertices.length < 25000 || selectedVertices.length > 50000) {
  throw new Error(`Expected one intact rider; extracted ${selectedVertices.length} vertices instead.`);
}

let minX = Infinity;
let maxX = -Infinity;
let minY = Infinity;
let minZ = Infinity;
let maxZ = -Infinity;

for (const vertex of selectedVertices) {
  minX = Math.min(minX, positions[vertex * 3]);
  maxX = Math.max(maxX, positions[vertex * 3]);
  minY = Math.min(minY, positions[vertex * 3 + 1]);
  minZ = Math.min(minZ, positions[vertex * 3 + 2]);
  maxZ = Math.max(maxZ, positions[vertex * 3 + 2]);
}

const centerX = (minX + maxX) / 2;
const centerZ = (minZ + maxZ) / 2;
const buffer = root.listBuffers()[0];
const material = primitive.getMaterial();
const container = root.listNodes()[0];
const partNodes = {};
const roles = {
  static: { pivot: [0, 0, 0], components: new Set(), indices: [] },
  frontWheel: { pivot: [-0.069, 0.062, 0.136], components: new Set(), indices: [] },
  rearWheel: { pivot: [0.043, 0.058, -0.139], components: new Set(), indices: [] },
};

function transformedCenter(component) {
  const sourceX = component.x / component.vertices;
  const sourceY = component.y / component.vertices;
  const sourceZ = component.z / component.vertices;
  return [-(sourceZ - centerZ), sourceY - minY, sourceX - centerX];
}

function componentRole(identity) {
  const component = components.get(identity);
  const [x, y, z] = transformedCenter(component);
  if (component.vertices >= 600 && z > 0.11 && y < 0.09 && Math.hypot(x + 0.069, y - 0.062) < 0.04) return "frontWheel";
  if (component.vertices >= 550 && z < -0.12 && y < 0.09 && Math.hypot(x - 0.043, y - 0.058) < 0.04) return "rearWheel";
  return "static";
}

for (const identity of selectedComponents) {
  roles[componentRole(identity)].components.add(identity);
}

for (let index = 0; index < indices.length; index += 3) {
  const identity = find(indices[index]);
  if (!selectedComponents.has(identity)) continue;
  roles[componentRole(identity)].indices.push(indices[index], indices[index + 1], indices[index + 2]);
}

function createAnimatedPart(role, definition) {
  const remapped = new Map();
  const partVertices = [];
  const partIndices = [];

  for (const originalVertex of definition.indices) {
    let mappedVertex = remapped.get(originalVertex);
    if (mappedVertex === undefined) {
      mappedVertex = partVertices.length;
      remapped.set(originalVertex, mappedVertex);
      partVertices.push(originalVertex);
    }
    partIndices.push(mappedVertex);
  }

  const partPositions = new Float32Array(partVertices.length * 3);
  const partNormals = new Float32Array(partVertices.length * 3);
  const partUvs = new Float32Array(partVertices.length * 2);

  for (let index = 0; index < partVertices.length; index++) {
    const original = partVertices[index];
    const transformed = [
      -(positions[original * 3 + 2] - centerZ),
      positions[original * 3 + 1] - minY,
      positions[original * 3] - centerX,
    ];

    partPositions[index * 3] = transformed[0] - definition.pivot[0];
    partPositions[index * 3 + 1] = transformed[1] - definition.pivot[1];
    partPositions[index * 3 + 2] = transformed[2] - definition.pivot[2];
    partNormals[index * 3] = -normals[original * 3 + 2];
    partNormals[index * 3 + 1] = normals[original * 3 + 1];
    partNormals[index * 3 + 2] = normals[original * 3];
    partUvs[index * 2] = uvs[original * 2];
    partUvs[index * 2 + 1] = uvs[original * 2 + 1];
  }

  const typedIndices = partVertices.length < 65536 ? Uint16Array.from(partIndices) : Uint32Array.from(partIndices);
  const partPrimitive = document.createPrimitive()
    .setMaterial(material)
    .setAttribute("POSITION", document.createAccessor(`${role}-position`).setType("VEC3").setArray(partPositions).setBuffer(buffer))
    .setAttribute("NORMAL", document.createAccessor(`${role}-normal`).setType("VEC3").setArray(partNormals).setBuffer(buffer))
    .setAttribute("TEXCOORD_0", document.createAccessor(`${role}-uv`).setType("VEC2").setArray(partUvs).setBuffer(buffer))
    .setIndices(document.createAccessor(`${role}-indices`).setType("SCALAR").setArray(typedIndices).setBuffer(buffer));
  const partMesh = document.createMesh(`capy-${role}-mesh`).addPrimitive(partPrimitive);
  const partNode = document.createNode(`capy-${role}-animation`).setMesh(partMesh).setTranslation(definition.pivot);
  partNode.setExtras({ animationRole: role, componentCount: definition.components.size, vertexCount: partVertices.length, triangleCount: partIndices.length / 3 });
  container.addChild(partNode);
  partNodes[role] = partNode;
  return { role, components: definition.components.size, vertices: partVertices.length, triangles: partIndices.length / 3 };
}

container.setMesh(null).setName("capybara-scooter-animation-root").setTranslation([0, 0, 0]);
const animatedParts = Object.entries(roles).map(([role, definition]) => createAnimatedPart(role, definition));
mesh.dispose();

function animationAccessor(name, type, values) {
  return document.createAccessor(name).setType(type).setArray(new Float32Array(values)).setBuffer(buffer);
}

function addAnimationChannel(animation, name, targetNode, targetPath, input, output) {
  const sampler = document.createAnimationSampler(`${name}-sampler`).setInput(input).setOutput(output).setInterpolation("LINEAR");
  const channel = document.createAnimationChannel(name).setTargetNode(targetNode).setTargetPath(targetPath).setSampler(sampler);
  animation.addSampler(sampler).addChannel(channel);
}

const driveLoop = document.createAnimation("Drive_Loop");
const wheelTimes = animationAccessor("drive-loop-times", "SCALAR", [0, 0.25, 0.5, 0.75, 1]);
const wheelRotations = animationAccessor("drive-loop-wheel-rotations", "VEC4", [
  0, 0, 0, 1,
  Math.SQRT1_2, 0, 0, Math.SQRT1_2,
  1, 0, 0, 0,
  Math.SQRT1_2, 0, 0, -Math.SQRT1_2,
  0, 0, 0, -1,
]);
addAnimationChannel(driveLoop, "front-wheel-spin", partNodes.frontWheel, "rotation", wheelTimes, wheelRotations);
addAnimationChannel(driveLoop, "rear-wheel-spin", partNodes.rearWheel, "rotation", wheelTimes, wheelRotations);

const idleLoop = document.createAnimation("Idle_Breathe");
const idleTimes = animationAccessor("idle-times", "SCALAR", [0, 1, 2]);
const idleTranslation = animationAccessor("idle-translation", "VEC3", [0, 0, 0, 0, 0.0025, 0, 0, 0, 0]);
addAnimationChannel(idleLoop, "idle-body-rise", container, "translation", idleTimes, idleTranslation);

const turnPreview = document.createAnimation("Turn_Preview");
const turnTimes = animationAccessor("turn-times", "SCALAR", [0, 0.7, 1.4]);
const turnRotations = animationAccessor("turn-rotations", "VEC4", [
  0, -0.2182, 0, 0.9759,
  0, 0.2182, 0, 0.9759,
  0, -0.2182, 0, 0.9759,
]);
addAnimationChannel(turnPreview, "front-wheel-steering", partNodes.frontWheel, "rotation", turnTimes, turnRotations);

for (const accessor of [originalPositions, originalNormals, originalUvs, originalIndices]) {
  if (!accessor.isDisposed()) accessor.dispose();
}

root.getAsset().generator = "Tripo";
root.setExtras({
  sourceViewCount: 8,
  selectedView: "front-three-quarter",
  selectedRow: 1,
  selectedColumn: 2,
  sourceVertices: vertexCount,
  extractedVertices: selectedVertices.length,
  extractedTriangles: selectedIndices.length / 3,
  animationParts: animatedParts,
  animationClips: root.listAnimations().map((animation) => animation.getName()),
});

await new NodeIO().write(outputPath, document);

console.log(JSON.stringify({
  sourceViews: 8,
  sourceComponents: components.size,
  selectedComponents: selectedComponents.size,
  sourceVertices: vertexCount,
  selectedVertices: selectedVertices.length,
  selectedTriangles: selectedIndices.length / 3,
  animatedParts,
  animationClips: root.listAnimations().map((animation) => animation.getName()),
  preservedTextures: root.listTextures().map((texture) => texture.getName()),
}, null, 2));
