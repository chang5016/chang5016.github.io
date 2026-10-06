# Downloaded metro conversion

Run with the existing project dependencies:

```sh
python scripts/metro-import/prepare-textures.py /absolute/path/to/metro-source
node --import tsx scripts/metro-import/convert.mjs /absolute/path/to/metro-source
```

The source folder must contain:

- `libre-tree.json`: GitHub recursive tree for Libre-TrainSim revision `1e22e0eefe3d7e7dea8f21b695cc55e659ef4ccb`.
- `libre-source/src/`: the original OBJ/MTL files listed in the public manifest, the referenced `Resources/Materials/*.tres`, original textures and both resource licence files from that same revision.
- `maglev-unpacked/cadnav.com_model/Model_C0818132/C0818132.3DS` and the accompanying `readme.txt`, from the ordinary public CadNav download page linked in `public/models/metro/ASSET-SOURCES.md`.

The converter uses only downloaded vertices, normals and faces. It converts material groups, source UVs and Godot material definitions, fits dimensions, removes presentation-only exploded pieces, clips passenger/landing apertures, and writes source hashes and adaptation descriptions into every GLB. No primitive geometry is constructed. The paired train doors, platforms, roofs, rails, lifts, piers and screen enclosures all remain traceable to the original source files.

Textures are losslessly encoded to WebP; the preparation step compares every decoded RGBA byte with the original image. Identical pixel payloads share one file. The original texture SHA and decoded pixel hash are retained in GLB material extras. The original source packs are not packaged as standalone downloads.

Screens use the original imported enclosure, rods and display-face geometry. Canvas pixels contain only operating information, with a local, renamed SIL-OFL Noto Sans TC character subset. They do not create a new screen surface.

## Current complete JFR1 / station repair

Starting from the shipped source assets, download the original CC0 files from the pinned Libre-TrainSim revision:
`Trains/JFR1/Wagon_1_WithDriverStand.obj/.mtl`, `Wagon_WithDriverStand_Red.tres`, its original albedo and AMR textures, `Door.obj/.mtl`; `Resources/Objects/TrainStationBuilding2`, `Lift-Subway`, `Ceiling`, and `Resources/RailTypes/Rail_Beton_1`, plus their MTL/material/texture dependencies. Keep the original licences already bundled in the public manifest.

```sh
python scripts/metro-import/prepare-textures.py /absolute/path/to/metro-source --repair
node --import tsx scripts/metro-import/repair-transport.mjs /absolute/path/to/metro-source
```

The repair keeps the complete JFR1 source body at uniform scale 2.15, native floor and original PBR livery. Seat/grab rail components and integrated source pedestal faces are removed whole; no replacement body or floor is generated. Source AMR channels are rearranged to ORM losslessly. The full station building uses its original roof/windows/envelope; portals are adapted to a planned scooter route. Elevator adaptation removes source transverse slabs from the entire carrier travel volume. Rail axis and steel datum are corrected before spatial instancing. Legacy maglev sources remain attributed and archived, but are no longer active train assets.
