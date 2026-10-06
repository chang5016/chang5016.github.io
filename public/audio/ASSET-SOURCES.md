# Scooter recordings

- Automatic Scooter Engine — Kang_Alpin, https://freesound.org/people/Kang_Alpin/sounds/676835/ — [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- Moto accelerating.WAV — ElementRS2, https://freesound.org/people/ElementRS2/sounds/343686/ — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Adapted to four engine sustain registers: selected non-clipped recording regions, bandpass, combustion-period alignment to RPM / 120, phase-aligned overlap grains, removal of the recorded rev-volume envelope, and seamless unequal-length loops. Mono 44.1 kHz PCM. Separate load and RPM blending; playback never resets when throttle changes. No synthetic continuous engine oscillator. Attribution is accessible in the in-game phone and /credits.html. Rebuild with scripts/prepare-scooter-audio.py and the source public previews listed below.

- https://cdn.freesound.org/previews/676/676835_10094482-hq.mp3
- https://cdn.freesound.org/previews/343/343686_3769350-hq.mp3

Three additional throttle opening takes (4.65–5.75 s, 12.75–13.65 s, 18.1–19.0 s) from the same ElementRS2 CC BY 4.0 recording are high/low-pass filtered and faded. They play once per new throttle press, alternate naturally, and stop on release; sustained engine loops remain uninterrupted. Rebuild with scripts/prepare-throttle-attacks.py.
