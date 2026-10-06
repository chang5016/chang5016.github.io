# 海灣機車捷運 · WebGPU 版本

The original city, buildings, highways, scooter and animal passengers remain. Three scooter stations share a dedicated elevated double-track railway. MB01 南港生活區 (x -750), MB02 晴川南站 (x 120), MB03 東河門戶 (x 960).

## Playable route

Street → signed road-like concourse → original scooter elevator → platform circulation and four ETC lanes → numbered waiting lanes → stopped train with open doors → full-size scooter bay.

All six original 6.4 m elevator cabins and 4.8 m entrances retain their original design and T controls. A stationary scooter must fit completely inside before travel. Empty elevators can be called from either landing. North and south approaches are separated, graded to their actual station datum and checked against road and highway footprints. The north approach bypasses the other shaft. Station street entrances connect at z -802; elevated train/platform floor is 21.6 m.

Concourses and platforms retain normal road controls with no automatic speed governor. Moving carriers retain a 3.2 m/s safety governor. Elevator walls, shaft gates, ETC posts, platform edges and other physical fixtures remain height-aware collision objects.

## Vehicle and platform dimensions

Two double-ended trains shuttle independently at z -837 and -848. Each train has two 17.74 m cars, 6.2 m nominal interior width and 3.5 m headroom. Each car has three 3.2 m side doors and eight 1.42 × 3.5 m scooter bays (16 per train). Platforms are 11.2 m deep; the two-track railway deck is 20.8 m wide. Couplers, bogies, roof and cab geometry use these dimensions rather than stretching the old shell. The original CC0 wheel geometry is reused with a 3.2 m gauge; the body and interior are independently authored. All five source GLBs and their licenses remain included. See `public/models/metro/ASSET-SOURCES.md` and `sources.json`.

The complete original rider is uniformly normalized to a 3.45 m display length and is no longer shrunk to fit the old carriage. Transit door and lift interlocks use its oriented 3.45 × 1.26 m footprint. Platform, boarding plates, doorway floor and interior floor meet at one level. Thin painted markings remain above the floor; structural thresholds do not leave a gap. Rider camera height is clamped inside the 3.5 m cabin roof.

## Signs, tickets and service

Each platform has four physical scooter ETC gates: 24 across the line. Automatic validation records one passage, raises its barrier with continuous motion and keeps it open until the sensed vehicle clears. Sensors adapt to incoming speed; gates on another floor cannot trigger. The current game uses a free trial ticket, without fictitious wallet deductions. Posts and closed barriers have matching physical collision bounds.

Large bilingual directions identify station code/name, A/B platforms, route color, elevators and exits. Floors carry route-colored guide bands and arrows. Route diagrams highlight the current station. Six numbered waiting lanes align with the six train doors; stop lines, tactile edges and safety signs explain boarding. Red/amber/green lamps synchronize with actual train position and door phase. Boarding plates and screens open only at a stopped train with fully open doors. A scooter obstructing a train doorway delays or reopens the doors.

Departure boards show actual next and following arrivals, route direction, available bays and carriage guidance. Times are projected from both trains' current phase, leg duration and reversals; they are not decorative countdowns. Boards refresh once per second or on a service-state change. Validation sounds, arrival chimes, closing-door cues and rail ambience begin after a user gesture.

Trains use quintic travel curves with continuous acceleration/braking. Opening/closing each take 1.5 seconds and dwell is normally 24 seconds. Phase transitions preserve timestep overflow so the timetable cannot drift with frame rate. The existing fixed-step clock advances trains, lifts and scooter together; render interpolation uses the same fraction. Hiding the page or opening an overlay pauses transport and resets interpolation. Mission countdown pauses during the existing platform/carrier transfer states.

## Rendering and quality

The actual game and 360° showroom initialize Three.js WebGPURenderer. GPU-compatible node materials retain original PBR maps, authored facade atlases, UV transforms, concrete aggregate, rider animation, lamp masks, terrain excavation and reflections. Unsupported WebGPU devices use the renderer's same-material WebGL2 compatibility backend. The HUD reports the backend in use.

Architecture is baked by material. Exact visible triangle batches retain original indices, UVs, normals and other attributes, with independent color/shadow culling. Frozen props and signs share spatial material batches; removed streamed originals remove their baked copies too. Native WebGPU command bundles reuse stable city submissions. Unchanged cells, static transforms and platform signals avoid buffer uploads. Moving train/lift roots remain separate from cached static shadows. No adaptive texture downgrade or triangle simplification is introduced.

## Verification

`tests/metro-system.test.mjs`, `metro-service.test.mjs`, `metro-city.test.mjs` and `metro-model.test.mjs` cover both service directions/reversals, exact arrival forecasts, all 24 ETC actuators, normal concourse controls, full-size boarding/disembarking, door obstruction/reopening, six complete elevator return journeys against actual city collisions, street grading, pier/road separation, floor continuity, cabin headroom, 30/60/144 Hz equivalence and disposal.

`tests/webgpu-rendering.test.mjs`, `packed-city.test.mjs` and `exact-static-meshes.test.mjs` cover native WGSL graphs, intact attributes, steady buffer/bundle reuse, shadow classification and streamed-source replacement. Native Dawn/SwiftShader renders additionally compiled and rendered the complete original city assets, rider and metro through the real WebGPU backend with no GPU validation errors.

The supervised cloud preview is unavailable in this session. Internal rendering used a software graphics adapter, so it verifies shaders/geometry and CPU submission work, not hardware FPS or a browser journey. See `docs/performance-v83.md` for measurements and limits.
