# City rendering and transport verification

The current renderer remains WebGL. This release reduces rendering submissions and redundant updates while preserving existing texture resolution, shading, geometry and shadow settings.

## Exact city submissions

`PackedCityBatches` takes the same sphere-frustum-visible spatial ranges as the native city `BatchedMesh` and packs their original indices into a contiguous draw for each material. Positions, normals, UVs and custom facade attributes share the original BufferAttribute objects. No geometry simplification or texture replacement occurs. Color and shadow views select independent ranges. Index buffers upload only when the selected ranges or source geometry revision changes; opaque ranges are ordered front to back when repacked. Existing custom material shaders remain in use.

The native batches remain available for lifecycle restoration. Shadow classification explicitly keeps those sources hidden after the packed replacements take over, avoiding duplicate geometry and shadows. Original static depth caching remains active. Station screens, elevator leaves and stopped train wheels also skip unchanged matrix-buffer uploads. Packed material variants are precompiled before the initial game frame.

## Headless audit, 2026-10-02

The actual authored city and production metro GLBs were loaded in Node. Browser-only streamed city GLBs, GPU rendering and texture sampling were not part of this audit. Perspective: 60° vertical FOV, 16:9 aspect, 1,100 m far plane. These counts cover the city material batches, not every mesh in the final game.

| Camera view | Native visible spatial ranges | Packed ordinary material draws | Triangles before | Triangles after |
| --- | ---: | ---: | ---: | ---: |
| Spawn | 484 | 25 | 200,724 | 200,724 |
| Ring interchange | 482 | 27 | 193,244 | 193,244 |
| M02 station | 36 | 17 | 18,233 | 18,233 |
| River | 532 | 29 | 239,675 | 239,675 |

On a WebGL implementation without `WEBGL_multi_draw`, these ranges formerly required separate fallback draw calls. With the extension, the native path already groups API calls; the new path still removes range draw dispatch and batching indirection, but GPU benefit must be measured on the target device.

At the spawn view, after 60 warm-up frames, packing 299 moving camera frames took **0.222 ms median / 0.284 ms p95** on this execution host. This is CPU time, not frame time or FPS. Initial city/metro construction still took about 8.49 seconds in this headless run; reducing scene construction/loading remains a separate opportunity. A prior 1,080-sample warmed simulation audit measured traffic at 0.140 ms median / 0.256 ms p95, collision queries at 0.002 / 0.004 ms, elevation at 0.003 / 0.006 ms, and metro at 0.003 / 0.007 ms.

`tests/packed-city.test.mjs` additionally compares exact index multisets with native visibility, verifies shared attribute/material identity, independent shadow selection, unchanged-view upload caching, source terrain refits and lifecycle restoration. `tests/continuous-shadows.test.mjs` covers classified source replacement without restoring duplicate casters.

The managed preview service was unavailable in this session. No cloud-browser acceptance, GPU timing, guaranteed 60 FPS or measured FPS increase is claimed.

## WebGPU compatibility

Three.js's [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html) supports a WebGPU backend and a WebGL2 fallback. However, [Material.onBeforeCompile](https://threejs.org/docs/pages/Material.html) is supported only by WebGLRenderer; Three.js recommends node materials/TSL for the WebGPU renderer.

This game's sky ShaderMaterial, scooter deformation/lamps, terrain/river/tunnel clipping, facade-glass masks, triplanar concrete, instanced traffic lamps and native depth-copy shadow cache need compatible equivalents before a renderer migration can preserve the current result. Switching the renderer alone would not preserve those effects. An eventual migration should port these effects, verify ordinary/instanced/skinned assets and shadows on both backends, then compare frame-time percentiles on actual devices before selecting a default.
