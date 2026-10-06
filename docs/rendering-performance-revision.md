# Rendering and art revision

## Visibility recovery after the live v53 report

The user supplied a screenshot with missing opaque scenery despite a 64 FPS counter. The previous offline checks did not validate the GPU render. Disable v53's global terrain/road partitioning and nested instance batches, returning these to the v52 render structure. Restore the full original driving model and physical water/glass transmission, and retain the traffic-signal spatial index, terrain UV scale and scooter controls. The scene-wide partitioning and simplified driving model described below are historical and are no longer enabled. This is a regression rollback, not a confirmed GPU root-cause diagnosis. The preview service is still unavailable; do not interpret a build or geometry test as visual acceptance.

## Measured offline changes

- Driving model: 501,424 to 175,496 triangles (65% reduction), constrained simplification with reported normalized error 0.00024029. All vertex attributes and three original texture images are preserved byte-for-byte. The showroom retains the original model. This is an offline asset change, not dynamic resolution scaling.
- A deterministic 10,000-instance scene retains every instance while a local 140 m test view intersects only 400 instances. Static vegetation batches share geometry and materials, retain terrain transforms, and have individual culling bounds.
- Opaque city geometry, including road details, is spatially partitioned rather than only facade and roof meshes.
- Glass and water use transparent blending and existing reflection/normal maps instead of full-scene transmission passes. Refraction is intentionally absent; actual submerged geometry, water depth and opacity remain.
- Traffic-light searches use a spatial index instead of scanning every intersection for every vehicle.

## Art changes

Outer districts use lower shop/apartment silhouettes; building heights align to 3.3 m floors. Ground texture coordinates use world-space scale instead of stretching over a 5 km plane. The chase camera is closer, distant haze is stronger, shadow-camera movement snaps to texels, and the player's hard circular ground shadow has a feathered edge.

## Verification and limitations

Player scooter lighting now illuminates existing textured lens regions, with brake intensity and synchronized 90/min turn signals (Q/R, X hazards). Completed turns cancel indicators after steering returns to center. The headlight beam follows chassis pitch/lean and steering. Wheel rotation uses the source wheel radius multiplied by the model's display scale. No Blender executable is available in this environment; this revision uses glTF processing and runtime animation. Lamp placement remains subject to visual acceptance because GPU preview is unavailable.

Production build passed. All 78 gameplay, asset preservation, riding pose, optimization and scooter-system regression tests passed together. The instance test confirms structural culling, not measured GPU FPS.

The reference game was opened in the cloud browser but its renderer failed with a null graphics context (`getSupportedExtensions`). Its author write-up was read at https://leocoout.medium.com/how-i-made-25k-in-15-days-with-a-game-built-entirely-by-claude-code-94b3b817f0ce . The local Sites preview service was unavailable. No visual parity, stable 60 FPS, or full end-to-end browser acceptance is claimed.
