# WebGPU and intact-scene rendering · v83

## Implementation

- Active gameplay and the 360° rider viewer use asynchronous WebGPURenderer initialization. Device loss, compilation failures and render failures keep the ready state false and display a recovery message.
- Original facade/PBR materials, sky grading, terrain excavation, concrete piers and rider/lamp animation use native TSL node graphs. The active rendering path has no WebGL-only shader injection.
- Cached static and continuously updated actor shadows are combined as native shadow nodes. Static depth maps update for scene revisions and snapped light-space movement; moving vehicles and transport remain continuous. No WebGL framebuffer copy is required.
- `ExactStaticMeshes` bakes only frozen opaque ordinary meshes by original material identity, render state and attribute formats. Every triangle and attribute is retained, with world-space transforms baked at float32 precision. Animated, transparent, mirrored and callback-controlled meshes remain independent. Replaced or hidden streamed sources invalidate their corresponding baked family.
- `PackedCityBatches` shares the exact attribute buffers and packs only visible spatial indices for independent color/shadow passes. Native BundleGroup records stable draw commands. Index uploads and command recording occur only on changed visibility, geometry, material version or environment texture.
- Original image resolutions, mesh details, AgX exposure, pixel-ratio cap and 768/1024 shadow sizes remain. The original high-detail rider file is unchanged. No dynamic quality downgrade or mesh decimation was used.

## Internal native measurements

Native Three.js WebGPU execution used Dawn and a Vulkan SwiftShader software adapter at 960 × 600, with the complete existing local city/vehicle/metro assets and original textures. Both comparisons used the same city-spawn camera, scene, lighting and asset loaders.

| Measure | Before frozen-prop batching | After |
| --- | ---: | ---: |
| Total city-spawn draw submissions (including refreshed shadows) | 1,097 | 618 |
| Default-name individual mesh submissions | 730 | 225 |
| Additional frozen objects placed into exact material families | 0 | 1,492 |
| Additional exact material families | 0 | 51 |

This is a 43.7% decrease in total submissions and 69.2% fewer default-name mesh submissions. The post-batching visible/static-shadow pass contained slightly more triangles because conservative spatial cell bounds retain whole original triangles; geometry was not removed to get the reduction. The additional merged geometry retained 167,038 original triangles.

For the post-batching scene, two alternating 9-frame command-bundle benchmark blocks discarded two warmup samples per block. Median synchronous CPU submission times were:

| Block | Native command bundles off | On |
| --- | ---: | ---: |
| 1 | 32.24 ms | 24.03 ms |
| 2 | 32.83 ms | 30.95 ms |

These numbers measure synchronous CPU submission in the native software test environment. They vary between blocks and do not imply an equivalent hardware FPS gain. Software GPU execution is not representative of a user's discrete/integrated graphics card.

The native test compiled actual WGSL and rendered the metro exterior, platforms, carriage interior, concourse and full original city/rider. No WebGPU validation errors were reported. Static-shadow audit recorded two initial passes, then remained unchanged at a stationary camera while moving shadows continued every frame. Source-replacement, original UV/normal/triangle preservation and unchanged-buffer behavior have separate automated tests.

## Practical limits

The supervised cloud-preview service was unavailable, so no browser-based end-to-end result is claimed. WebGPU requires support from the user's browser/device; unsupported environments use the same node materials through the renderer's WebGL2 compatibility path. A verified 60 FPS result requires representative real hardware. New view-dependent shader combinations can still have an initial compilation cost; steady draw reduction is distinct from loading time.
