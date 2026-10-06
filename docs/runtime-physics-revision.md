# Runtime, physical handling and outdoor lighting revision

## Steering follow-up

The user reported that the grip-limited steering was too difficult to turn. Restored the previous speed-response curve, drift turning assistance, lean limits and handlebar/wheel animation. Fixed-step simulation, interpolation, wet braking and the performance improvements remain. A regression checks useful left/right turning displacement at urban and highway speeds.

## Initial revision scope

Keep the original 501,424-triangle player GLB, the complete supplied street, the landmark suspension bridge, five hillside estates and the 500 m mountain tunnel. This revision does not dynamically reduce render resolution, remove model triangles or disable shadow casters when frame rate falls.

The simulation now advances at 60 Hz with interpolated display positions. A bounded catch-up period prevents a browser stall from creating a large physics jump. Steering uses wheelbase and a speed-dependent lateral acceleration limit; braking, throttle and reverse no longer conflict. Rain reduces grip and increases stopping distance. AI traffic updates every display frame, with route-height interpolation and oriented collision footprints that respect bridge levels.

Static scenery retains its transforms instead of recomputing them every frame. Terrain construction caches exact coordinates; broad-phase bounds reject unrelated road/building pairs before polygon work. Suspension springs retain their mesh and deform through local transforms instead of rebuilding vertex normals every frame. Only vegetation instances are split into spatial batches; each instance retains its full geometry, material, colour and transform. Road, terrain, bridge and player meshes are not partitioned by this new batching path.

Outdoor reflections follow the sky and sun with cached PMREM environments for each weather mode. AgX tone mapping, non-metallic concrete/asphalt, a more focused shadow map and restored physical water transmission improve material response. These changes require visual verification on an actual GPU before visual quality can be considered accepted.

## Construction and CPU measurements

Measurements used the same headless canvas stubs and authored city construction. They measure JavaScript/geometry work, not GPU rendering or browser frame rate.

| Measurement | Before | After |
| --- | ---: | ---: |
| Complete city construction | 43,591.5 ms | 5,325.8 ms |
| Elevated road construction | about 10,500 ms | 2,638.2 ms |
| Hillside construction | 13,450 ms | 348.4 ms |
| Building construction | 8,260 ms | 666.9 ms |
| Spatial layout audit | 7,420 ms | 67.9 ms |
| 600 traffic updates on the authored terrain | 82.61 ms | 40.47 ms |
| Terrain queries for those traffic updates | 39,600 | 1,721 |

The construction baseline above already included the exact-coordinate cache; the subsequent improvement comes from bounds rejection and cached bridge clipping planes. A flat-ground traffic microbenchmark did not show a CPU improvement, because its terrain callback was trivial. The full-city result is the relevant expensive-terrain workload. Timings vary between machines and runs.

## Regression coverage and remaining limits

Checks cover equivalent 30/60/144 Hz display schedules, bounded stall recovery, wet/dry braking, traffic collision height separation, static/dynamic transforms, unchanged spring buffers and complete instance preservation. The 10,000-instance fixture keeps all instances and selects 196 for a local test view. Bridge clipping was compared against the previous implementation across 24 tapered/sloped fixtures and 147,864 ray samples, with matching coverage.

Estate driveway collision surfaces use the same absolute endpoint heights as their rendered surfaces. Private entrance courts use their actual rectangular footprint for overlap auditing, rather than oversized round-ended highway buffers; public-road clearances remain unchanged. Full-city layout and traversable entrance checks pass.

The managed preview service was unavailable. Internal geometry, physics, asset integrity and production-build checks do not establish visual parity with GTA, stable 60 FPS on a user's device, or complete browser acceptance. No such claim is made.
