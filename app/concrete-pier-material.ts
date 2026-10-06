import * as THREE from "three";
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { concreteAggregateNode } from './gpu-materials';

/** Reusable aggregate texture, sampled in metres so tall piers do not stretch it. */
export function createConcretePierMaterial() {
  const size = 256, pixels = new Uint8Array(size * size * 4);
  let seed = 19327;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const pore = random(), grain = random();
    const cloud = Math.sin(x * Math.PI / 32) * Math.cos(y * Math.PI / 64) * 4 + Math.cos((x + y) * Math.PI / 64) * 3;
    const value = Math.round(190 + cloud + (grain - .5) * 13 - (pore > .987 ? 38 : 0));
    const i = (y * size + x) * 4;
    pixels[i] = value; pixels[i + 1] = value - 2; pixels[i + 2] = value - 6; pixels[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
  const material = new MeshStandardNodeMaterial({ color: '#ffffff', roughness: .94, metalness: 0, envMapIntensity: .18 });
  material.colorNode = concreteAggregateNode(texture);
  material.addEventListener('dispose', () => texture.dispose());
  return material;
}
