# Persistent metro traffic, closed stores and route displays

The v90 metro AI consisted of two one-trip riders starting inside distant end-station lifts. After leaving the train they entered the highway or mountain-road network permanently. It did not provide ongoing local station activity.

Six existing road motorcycles now provide persistent metro trips across all three stations. Three begin waiting on platforms; three approach along the actual ground entrance. They call and enter shared lifts, wait for the right train direction and capacity, board through a downloaded door aperture, ride on the physical carrier, alight, descend, ride a local street loop and return. Existing intercity riders still continue to the highway, tunnel and hillside roads. Total traffic stays at 42 vehicles, with the same downloaded motorcycle and animal rigs and render interpolation.

Upper-landing waiting positions clear the full scooter footprint rather than stopping in the elevator door sensor. A separate outer platform aisle prevents stationary waiting riders from blocking through traffic. Local boarding and alighting use opposite sides of a real 3.05 m door opening. Lift occupancy, train capacity, player interaction and door interlocks remain shared.

The former two rows of open display shops are replaced by 12 separate sidewalk-facing parcels. Complete CC0 Kenney commercial-building geometry is retained with uniform dimensions, physical materials, opaque windows and original extruded shop signs. The coffee arcade is closed with an exterior storefront. Bases sit on locally graded parcels that feather into the original terrain and paving. Forecourts meet existing sidewalks; the supplied shopping street, city facade textures and original bridge remain intact.

Existing downloaded train display enclosures show previous/current station, next station, countdown, bike-space availability and all three numbered stations together. The complete 3.0 m × 0.60 m LCD fits below the train's curved roof shoulder and above the rider; the previous higher placement let the roof hide its top labels. The route arrow reverses with the actual train direction. All door LCDs in a train share one live pixel buffer.

## Verification

- 179 tests passed, including repeated AI trips with the actual downloaded station collision fixtures, continuous train/lift carrier motion, two highway/mountain handoffs, shared safety sensors, full store geometry, placement, graded contact and route text.
- Internal native Three WebGPURenderer / Dawn Vulkan render checks decoded the shipped original texture pixels, used the shipped Chinese display font, and produced nine focused scene captures without renderer errors. Sign texture orientation was corrected after inspecting these captures. This was internal GPU rendering, not browser acceptance or a hardware FPS benchmark.
- The type checker reports only the existing Cloudflare ambient declarations (`cloudflare:workers`, `Fetcher`, `D1Database`), with no errors in the changed application files.
- Source and all public assets are included in the complete downloadable project export; generated dependencies and cache directories are excluded.
