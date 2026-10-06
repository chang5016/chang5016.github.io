# Motorcycle rider

“Cubed Bear” by CubedBear:
https://sketchfab.com/3d-models/cubed-bear-26647ba33a564a7da57a6b166152f4bc

The artist lists this bear under Creative Commons Attribution 4.0:
https://creativecommons.org/licenses/by/4.0/

The native FBX is supplied by the same artist at
https://cubedbear.itch.io/low-poly-interior
and contains the same 176-vertex, 296-triangle bear with its native biped rig.
The licence above applies to the bear, not the unrelated interior pack.

Adaptations: rounded source surfaces with separate facial parts retained,
original colour palette restored, and a seated motorcycle pose authored using
the native two-arm/two-leg skeleton. Bone lengths are preserved. The downloaded
character is a biped; its motorcycle pose is a game adaptation, not an animation
or motorcycle advertised in the original download.

The complete motorcycle and rider share one uniform display scale. Actual
world-space hand/foot contacts, crown height and independent skin instances
are verified by `tests/motorcycle-rider.test.mjs`. File hashes, mesh counts and
pose results are recorded in `sources.json`.

Rebuild with Blender bpy: `python scripts/prepare-motorcycle-rider.py`, then
`node --import tsx scripts/pose-motorcycle-rider.mjs bear`.
