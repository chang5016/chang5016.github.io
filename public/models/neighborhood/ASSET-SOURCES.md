# Complete neighborhood assets

## Active closed exterior stores

City Kit (Commercial) 2.1 by Kenney, CC0 1.0:
- https://kenney.nl/assets/city-kit-commercial
- https://creativecommons.org/publicdomain/zero/1.0/

Complete `building-e.glb` and `building-b.glb` are retained in `mart-source.glb` and `coffee-source.glb`, including their original palette texture. The game uses `mart-metric.glb` and `coffee-metric.glb`. Original triangles are retained at uniform metric scales: 14.0 m and 10.4 m frontage. Palette regions receive physical cladding, opaque reflective windows, roof and metal finishes. Exterior sign enclosures and original CAPY MART / MORI COFFEE graphics are added; the coffee-shop arcade is closed with an opaque storefront. Windows do not expose interiors. Source hashes, retained triangle counts, added component counts and fitted bounds are in `sources.json`.

Wall normals and roughness reuse the existing estate PBR assets; their original attribution is in `public/models/estate/ASSET-SOURCES.md`. The sign graphics are original; DejaVu Sans is used to bake lettering into raster textures, with no font software distributed in this asset folder.

Rebuild exterior models from the bundled complete source files:
`python3 scripts/prepare-shop-signs.py`, then `node scripts/prepare-closed-shops.mjs`.

## Archived v90 display shops

The old open display shops are retained for source history but are no longer used by the game. Shop 01 and Shop 02 by sugamo, Creative Commons Attribution 3.0:
- https://poly.pizza/m/5w9AIhTCLMS
- https://poly.pizza/m/1d-_8bnyobk
- https://creativecommons.org/licenses/by/3.0/

Their complete source geometry and original v90 fitted files remain intact. City facade textures are unchanged.

## Animated sidewalk fox

Fox: https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Fox
Original model by PixelMannen, CC0. Rig and Survey / Walk / Run animations by tomkranis, CC BY 4.0. glTF conversion by AsoboStudio and scurest.
https://creativecommons.org/licenses/by/4.0/
The complete skinned animal and original texture are retained. Uniform metric sizing, independently mixed authored animations and clear sidewalk routes are adapted for the game.
