# Game optimization verification

- Static authored facade and roof meshes retain every triangle and share vertex buffers, with spatial index chunks and camera-local bounds. Terrain refresh updates the shared source once and rebuilds indexed bounds.
- Building collision broad phase uses a 64 m spatial index, includes large footprint edges, and preserves narrow-phase collision behavior.
- Main scene simulation and drawing pause while hidden or while the phone/character showroom is open. Trip timers pause with it.
- Daylight exposure and sun intensity are reduced to preserve facade detail. Mission panels have stronger contrast and a career progress display.
- Pickup positions are recorded for accurate fare distance. Comfortable on-time deliveries earn bounded streak bonuses and S grades; completed trips advance driver ranks.
- Existing complete shopping-street assets and road connection fixes are retained.

Validation: successful production build; 71 regression tests passed. After the final terrain-refresh adjustment, three relevant spatial/live-vector tests passed again and the production build passed again.

Preview could not start: sites-previewd mailbox was unavailable. No browser visual acceptance or measured FPS is claimed. Actual GPU cost and interface placement still need preview/device verification. This change does not modify the existing adaptive quality policy or lower model detail.
