import * as THREE from "three";
import { PMREMGenerator, type WebGPURenderer } from "three/webgpu";

export type OutdoorMode = "day" | "dusk" | "night" | "rain";
const PALETTES = {
  day: { top: "#568aba", horizon: "#c5d8e1", ground: "#777b68", energy: 1, sun: 5 },
  dusk: { top: "#32465f", horizon: "#dfa978", ground: "#756657", energy: .65, sun: 3 },
  night: { top: "#102037", horizon: "#38475c", ground: "#272d32", energy: .2, sun: 0 },
  rain: { top: "#657783", horizon: "#acb6bb", ground: "#69716b", energy: .7, sun: .1 },
};

/** HDR sky/ground radiance. Built only when the weather changes, never per frame. */
export function createOutdoorEnvironment(renderer: WebGPURenderer, mode: OutdoorMode) {
  const palette = PALETTES[mode];
  const top = new THREE.Color(palette.top), horizon = new THREE.Color(palette.horizon), ground = new THREE.Color(palette.ground);
  const sun = new THREE.Vector3(-45, 78, -36).normalize();
  const width = 256, height = 128, pixels = new Float32Array(width * height * 4);
  const color = new THREE.Color();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const latitude = (y + .5) / height * Math.PI, longitude = ((x + .5) / width - .5) * Math.PI * 2;
    const dy = -Math.cos(latitude), dx = Math.sin(latitude) * Math.cos(longitude), dz = Math.sin(latitude) * Math.sin(longitude);
    color.copy(dy > 0 ? horizon : ground).lerp(dy > 0 ? top : horizon, dy > 0 ? Math.pow(dy, .55) : Math.pow(1 + dy, 8) * .35);
    const glow = Math.pow(Math.max(0, dx * sun.x + dy * sun.y + dz * sun.z), 128) * palette.sun;
    const i = (y * width + x) * 4;
    pixels[i] = color.r * palette.energy + glow;
    pixels[i + 1] = color.g * palette.energy + glow * .91;
    pixels[i + 2] = color.b * palette.energy + glow * .76;
    pixels[i + 3] = 1;
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.needsUpdate = true;
  const generator = new PMREMGenerator(renderer);
  try { return generator.fromEquirectangular(texture); }
  finally { texture.dispose(); generator.dispose(); }
}
