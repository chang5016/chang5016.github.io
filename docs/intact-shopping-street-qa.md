# Intact shopping street — 2026-09-01

## Implementation

- Replaced the centroid-cropped street fragment with the full uploaded street_2(1).glb.
- Retained all 826,904 original surface triangles, including roofs, side/rear walls, arcades and roads. Removed only 24 line-overlay primitives; no spatial crop or simplification.
- Compression reduced 70,962,632 bytes to 18,350,360 bytes. Decoded surface counts, per-node counts, full bounds and hashes are recorded beside the model.
- Two opposing rows use uniform scale 0.02 and rigid rotations. GPU instancing shares each original surface between the rows.
- Center: x=-422.5, z=540, between 市場路 and the neighboring north-city alley. Terrain is level over the complete block and transitions smoothly to adjacent roads.
- Grounding uses the original asphalt datum rather than the lowest underground foundation. Vehicle physics uses the same leveled terrain.
- Suppressed the procedural road/curb overlay on the central segment, provided clear tapered asphalt approaches, excluded grass and street furniture from the supplied block, and added body-only building colliders with open arcades.

## Verification

- Production build: passed.
- Full test suite: 65 passed, zero failed (rendered HTML, gameplay, assets).
- New checks cover full model integrity, opposing orientation, complete footprint on the level parcel, uniform scale, shared instanced geometry/materials, asphalt datum, smooth approach elevations and clear road collision space.
- Full existing district audit checks generated building separation from roads, elevated decks and piers.
- Offline raster inspections: source model front, decoded optimized model front, and full opposing-row placement. Complete side/rear walls and roofs are visible; no cut-away facade replacement remains.
- ESLint: no errors, nine existing warnings; changed helper/scripts/tests also checked separately without errors.

## Limits

- Cloud browser connected, but supervised Sites preview was unavailable (missing preview service mailbox). No browser driving/rendering acceptance or measured 60 FPS claim is made.
- Standalone TypeScript checking still reports errors in existing scene background/fog narrowing, readonly outline parameter types, bridge support nullable narrowing, and Cloudflare runtime declarations. Production bundling and tests pass; this change does not assert a clean project-wide typecheck.
- Public deployment awaits explicit confirmation under the Sites hosting workflow.
