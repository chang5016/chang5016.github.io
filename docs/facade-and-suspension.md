# Facade and scooter revision

Existing full-resolution facade atlases are mapped as separate ground-floor and 3.3m upper-storey bands. Upper floors no longer repeat shutters. Each band's horizontal scale is derived from its vertical atlas span to preserve square texels, including partial floors at setbacks. Concrete slab edges have 12cm thickness and share the building's terrain anchor.

The original scooter mesh and its texture remain intact. Front telescopic forks and a rear coil-over use model-space attachment points. Brake dive, acceleration squat and landing compression drive their visible length; exponential damping returns them to rest. Wheel normals rotate with the existing wheel regions, and the rotation now blends rigid positions rather than twisting the angle across the tire edge.

Offline UV coverage and aspect checks passed for all four atlases. GPU visual acceptance is still required for attachment alignment and material rendering. Local dependency setup was blocked when network approval was cancelled, so no local production build or GPU acceptance is claimed; publication uses the Sites source-build path if available.
