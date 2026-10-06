// The Pages build ships EXT_meshopt_compression GLBs (scripts/optimize-pages.mjs).
// Give every GLTFLoader the decoder so game code can keep using `new GLTFLoader()`.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const parse = GLTFLoader.prototype.parse;
GLTFLoader.prototype.parse = function (...args: Parameters<typeof parse>) {
  if (!this.meshoptDecoder) this.setMeshoptDecoder(MeshoptDecoder);
  return parse.apply(this, args);
};
