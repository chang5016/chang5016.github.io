# City realism revision

Preserves the complete supplied shopping street and previous performance improvements.

- Facade UV repeats now use fixed square physical modules rather than stretching a five-floor photograph across arbitrary heights or rounding each wall's horizontal repeat count.
- NPC riders use cloned skeletons aligned to the seat, with inverse-kinematics limb positioning and a restrained head animation. Standing idle clips no longer overwrite the seated pose. The four actual animal GLBs are exercised in a skeleton test; this does not constitute visual pose acceptance.
- Ring corners expand from 66 to 180 world units. Entrance, exit, and directional ramps use sampled cubic curves with tangents matching their connecting roads. Main decks use 16-unit width and lane separation. Upper central decks rise to 12.7 units to increase separation from the lower roadway.
- Downtown ring transfers preserve ring elevation instead of beginning beneath the ring. Both ends of ramp guardrails allow connection openings.
- Deck support no longer disappears when a vehicle turns across the deck direction at the same elevation. Height checks still reject bridges above a ground-level rider.

Reference inspected: the supplied road-pack demonstration image 00eb5c6e-db7e-4b86-b9da-2d2daa43e811.png and the existing complete supplied road GLB. These are game layout changes, not engineering certification.

Cloud preview was unavailable (missing sites-previewd mailbox). Full visual review, exact hand-to-grip contact, arterial merge barrier details, bridge-width transitions, and device FPS remain unverified. Do not represent this revision as complete visual acceptance of the entire game.
