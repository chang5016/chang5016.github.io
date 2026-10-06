import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHeadlessDocument } from './headless-document.mjs';

// Real geometry from the shipped files. Only image decoding is omitted in
// collision-only tests; a separate native WebGPU run decodes actual textures.
export async function withDownloadedMetroFiles(callback) {
  const load = GLTFLoader.prototype.loadAsync, texture = THREE.TextureLoader.prototype.loadAsync, previousDocument = globalThis.document;
  globalThis.document = createHeadlessDocument();
  GLTFLoader.prototype.loadAsync = async function (url) {
    url = url.split('?')[0];
    assert.match(url, /^\/models\/metro\/downloaded\/[a-z0-9-]+\.glb$/);
    const bytes = await fs.readFile(new URL('../public' + url, import.meta.url));
    return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  };
  THREE.TextureLoader.prototype.loadAsync = async function (url) {
    url = url.split('?')[0];
    const bytes = await fs.readFile(new URL('../public' + url, import.meta.url)); assert.ok(bytes.length > 20 && (bytes.subarray(0,4).toString() === 'RIFF' || bytes.subarray(1,4).toString() === 'PNG' || (bytes[0]===0xff&&bytes[1]===0xd8)), 'A valid source image must decode');
    return new THREE.DataTexture(new Uint8Array([130, 130, 130, 255]), 1, 1);
  };
  try { return await callback(); }
  finally { GLTFLoader.prototype.loadAsync = load; THREE.TextureLoader.prototype.loadAsync = texture; if (previousDocument) globalThis.document = previousDocument; else delete globalThis.document; }
}
