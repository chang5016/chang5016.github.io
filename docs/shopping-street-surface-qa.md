# Shopping-street surface correction

## Reproduced defect

The old connecting asphalt was one boundary-only ShapeGeometry crossing the 8 m terrain transition. A downward ray test against its actual triangles measured relative heights from -0.342017 m to +0.348380 m inside the nominally level street, instead of the intended +0.044 m. Its raised triangles occluded the supplied asphalt (+0.082 m), producing the dark triangular wedges in the user's screenshot. The old parcel also stopped short of the neighboring roads.

## Correction

- Extended the paved parcel to the measured asphalt edges of all four surrounding streets, filling the previously exposed grassy margins.
- Leveled the adjoining road cross-sections and the coarse background-terrain cell corners, with a smooth 32 m outer transition. Physics and rendered scenery continue to use the same elevation function.
- Replaced the large polygon with 2 m sampled rectangular surfaces. The full 37.1 m boulevard mouths reach both neighboring roads; side aprons finish the imported street junctions.
- Junction clearance now uses the full boulevard width. Existing city sidewalks and curbs stop before the widened openings; street lamps are excluded from the finished parcel.
- Supplied Blacktop_New_1 surfaces and connecting asphalt share one material and consistent 4 m UV scale. Only asphalt UVs/material are changed; all original model positions and triangle indices remain intact. Buildings keep their original materials.
- Retained the two-row GPU instancing and all 826,904 source triangles per row. No dynamic resolution reduction added.

## Verification

- Production build passed; ESLint reports zero errors and nine existing warnings.
- Full suite: 68 tests passed, zero failed.
- More than 800 actual mesh-ray samples confirm the connecting road remains at +0.044 m across its entire width, safely below the original +0.082 m asphalt.
- Paved coverage is checked beside all four surrounding roads. Tests also raycast a reconstruction of the original 52 m background grid to ensure grass terrain cannot protrude through the slab.
- The complete city test checks both widened mouths for leftover physical curb and sidewalk meshes, in addition to existing building/road/bridge-pier spatial checks.
- Shared asphalt tests verify original source positions and indices are unchanged and UV edits do not mutate the supplied mesh.

## Limit

Supervised cloud preview could not start because its service mailbox is unavailable. No browser-rendering, in-browser driving, or measured FPS acceptance is claimed. The new tests explicitly cover rendered geometry, which the earlier height-function-only checks missed.
