# City scene and rendering update

The city now has continuous two-sided street frontages and connected paved
forecourts. Protected parks, the school, the authored river and the complete
user-supplied shopping street remain excluded from the new paving. Courtyard
gardens use the existing botanical models. New surfaces meet sidewalk edges
with a 7 mm drainage fall; asphalt and intersections are never covered.

Original Taiwanese diffuse atlases remain unchanged. Measured office and
residential window openings have shallow connected reveals at street level
and separate glass/masonry roughness within one material family. Extra glass
boxes no longer cover those photographic windows.

Large merged surfaces use native Three.js BatchedMesh with independent color
and shadow frustum culling. Exact positions, normals, UVs and authored
attributes survive compaction. An archival CPU source remains available for
terrain refitting without uploading its duplicate vertex buffer.

Repeated stationary details use ordinary hardware instancing. Visible cells
are packed into one draw per family, separately for the view and the shadow
camera. Unchanged cell selections do not re-upload instance buffers. Geometry,
maps, matrices, instance colors and structural support metadata are retained.
This path does not require the multi-draw browser extension. The complete
native shadow fallback includes the dedicated stationary shadow layer.

## Structural audit

Fixed camera: perspective 68 degrees, aspect 16:9, near 0.08 m, far 2500 m;
position (-114, 8, -110), target (-60, 4, -110). Headless color-pass count,
before optional GLB streaming. These numbers are not GPU frame measurements.

| Measure | Previous source | Updated source |
| --- | ---: | ---: |
| Building colliders | 518 | 596 |
| Draw submissions with multi-draw support | 1,985 | 702 |
| Draw submissions without multi-draw support | 1,985 | 1,880 |
| Submitted triangles | 2,554,597 | 2,223,842 |
| Connected paved parcels | 0 | 698 |
| Planned garden courts | 0 | 114 |

The updated spatial audit checked 596 buildings, 762 ground-road segments,
2,827 elevated segments and 559 bridge piers: zero road/building,
elevated/building or pier/building intersections.

Regression checks cover complete expressway surface/shoulder continuity,
stock-building proportions, original scooter wheels and suspension, seated
animal riders, traffic queues, render interpolation, physics cadence and
static/dynamic shadow fallback. New checks cover exact batched attributes,
independent shadow visibility, terrain refitting, paving exclusions and
hardware instance buffer reuse.

The managed 3D preview service was unavailable during this update. The
production build and internal checks were used; browser playability, final
visual composition and device-specific frame rates were not measured here.
