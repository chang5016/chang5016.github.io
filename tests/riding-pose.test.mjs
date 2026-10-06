import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fitScooterRider } from '../app/riding-pose.ts';
globalThis.ProgressEvent ??= class { constructor(type, values) { Object.assign(this, values); } };
for (const kind of ['pig', 'pug', 'sheep', 'llama']) test(`${kind} actual skeleton sits on the scooter without standing animation`, async () => {
  const bytes = fs.readFileSync(new URL(`../public/models/traffic/${kind}.glb`, import.meta.url));
  const length = bytes.readUInt32LE(12);
  const data = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  data.buffers[0].uri = 'data:application/octet-stream;base64,' + bytes.subarray(28 + length).toString('base64');
  delete data.images; delete data.textures; delete data.materials;
  for (const mesh of data.meshes) for (const p of mesh.primitives) delete p.material;
  const { scene: animal } = await new GLTFLoader().parseAsync(JSON.stringify(data), '');
  const parent = new T.Group(); parent.add(animal); animal.rotation.y = Math.PI;
  fitScooterRider(animal);
  const position = name => animal.getObjectByName(T.PropertyBinding.sanitizeNodeName(name)).getWorldPosition(new T.Vector3());
  assert.ok(position('Hips').distanceTo(new T.Vector3(0, .86, .05)) < .001);
  for (const [side, sign] of [['L', 1], ['R', -1]]) {
    const error = position(`FrontLowLeg.${side}_end`).distanceTo(new T.Vector3(sign * .27, 1.08, -.5));
    assert.ok(error < .2, `hand contact error ${error}`);
  }
});
