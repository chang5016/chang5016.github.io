# Complete realistic road traffic

## Tesla Model 3 — sedan and yellow taxi
David_Holiday, CC BY 4.0.
Original: https://sketchfab.com/3d-models/tesla-model-3-123c10f376ec4f18b93c73afc382808b
Distributed source: https://github.com/digitalfairy/3D-Car-Showcase/blob/main/public/models/model3_scene.glb
Modifications: removed unrelated demo debris, retained the complete vehicle; uniform metric scaling, straightened original wheel assemblies, native lamp control, web material batching and paint variants.

## BMW X6 M Competition — SUV
vecarz / heynic, CC BY 4.0 (embedded in the source model).
Original: https://sketchfab.com/3d-models/bmw-x6m-competition-assetto-wwwvecarzcom-3979a908081948e0971f5a5380b60a0f
Distributed source: https://github.com/Vivekkk-1/3D-Models/blob/main/Cars/bmw_x6m.glb
Modifications: uniform metric scale, offline geometry simplification, complete wheel-assembly face partitioning, stationary brake calipers, retained source texture maps and interior, native lights and material batching. A stray disconnected source triangle was excluded.

## Ferrari 458 Italia — occasional sports car
vicent091036, CC BY 4.0, as attributed by the three.js car demo.
Original: https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6
Distributed source: https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/ferrari.glb
Modifications: offline mesh simplification, metric scaling, independent original wheel pivots, native rear-lens control and material batching. The Ferrari Spider game variant removes the original upper hardtop and side glazing while retaining the native windshield, dashboard, seats, rear engine cover and original wheel geometry; it includes a downloaded articulated animal driver.

## Detailed motorcycle
Distributed by Nik Lever in threejs-primer under the repository's GNU GPL v3 license; no separate permissive asset license is claimed.
Source: https://github.com/niklever/threejs-primer/blob/main/assets/motorcycle.glb
Unmodified corresponding source is included as [motorcycle-source.glb](motorcycle-source.glb).
License: [GPL-3.0.txt](GPL-3.0.txt).
Modifications: metric normalization, offline web simplification, native front/rear wheel and steering assemblies, source fork/shock geometry retained, native headlamp and tail lens, material consolidation.
The conversion sources are available at [prepare-real-traffic.py](prepare-real-traffic.py) and [decode-traffic.mjs](decode-traffic.mjs); they use Blender 4.3 and glTF Transform 4.4 / Draco 1.5.7.

## Animal riders
The existing rigged Quaternius CC0 pug, pig, sheep and llama models are preserved.
Their original source credits remain at [/models/traffic/ASSET-SOURCES.md](/models/traffic/ASSET-SOURCES.md).

Shared model geometry and textures are reused across the fleet. Per-instance paint and lamps are independent. Original complete car bodies, interiors, rims, tyres and source light lenses are retained; placeholder box cars and added floating lamp blocks are not rendered.

CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
