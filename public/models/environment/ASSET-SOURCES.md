# Environment asset sources

- `park-facilities-optimized.glb` is an optimized web build of the user-supplied `park_facility_asset.glb`.
- `taiwan-street-intact.glb` is the complete user-supplied `street_2(1).glb`, compressed for the web. All 826,904 source surface triangles, roofs, sides, arcades and roads are retained. Only 24 SketchUp line-overlay primitives are omitted. No spatial crop or geometry simplification is applied.
- The original source files were supplied by the site owner. Their original licensing terms remain applicable.

The park retains its existing optimized build. The street uses 1024 px maximum WebP textures (quality 90) and 20-bit position Draco compression. Its 18.35 MB payload replaces the destructive cropped asset. Both rows share geometry and materials in two-instance GPU batches (one draw per original surface, not two); duplicate shadow-map rendering is disabled. No dynamic resolution reduction is introduced.

`taiwan-street-intact.integrity.json` records source/output hashes, decoded surface counts and bounds. Rebuild with `scripts/prepare-intact-street.mjs SOURCE.glb OUTPUT.glb`; offline dependencies are documented at the top of the script. Ground alignment uses the authored asphalt datum (4.943208 source units), not the lowest foundation vertex. Runtime placement uses rigid opposing rotations and a uniform 0.02 scale.
