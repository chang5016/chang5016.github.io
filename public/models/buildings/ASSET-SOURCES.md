# Complete stock urban office

PBR Textured Building by **volkanongun** (https://sketchfab.com/volkanongun).

- Original: https://sketchfab.com/models/94fe67ee5aeb435d8ecfdb5bb29b9847
- Licensed distribution: https://opengameart.org/content/pbr-textured-building
- License: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

Adaptations: uniform scale to 28.8 m height, centered ground pivot, transformed original normals/positions, complete 9,654 triangles retained, six materials packed into a single PBR atlas. Main wall uses a 2K tile, windows/columns/entrance 1K, small frames 512 px with 8 px filtering gutters. AO and material roughness factors are retained. No runtime resolution reduction. Repeated buildings share geometry and textures in spatial instances. No additional license restrictions are applied to this adapted asset. Attribution is accessible in the in-game phone and /credits.html.

Rebuild: node scripts/prepare-stock-building.mjs downloaded/scene.gltf public/models/buildings

## Authored architectural collection

`premium-towers.glb` contains three complete newly authored exteriors: Grand Residence (35.865 m), Civic Tower (46.4 m), Harbor Tower (56.3 m). These are custom complete models, not downloaded stock models. Their stone finish reuses the site's existing estate color, normal and roughness maps. Ground-level lobby and doors, independent window bays, structural mullions, balcony rails, setback roofs and equipment screens are modelled in 3D. One shared 2048×1024 base color / normal / AO-roughness-metal atlas; repeated geometry is indexed, then spatially instanced. Original Taiwanese low-rise textures, supplied street model and named landmarks are retained. Rebuild with `node scripts/build-premium-towers.mjs`. Dimensions and checksums: `premium-towers.integrity.json`.
