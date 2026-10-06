/** Original scooter faces -X. Keep wheel, fork and light attachments in this frame. */
export const SCOOTER_WHEEL = {
  front: { x: -.385, y: .103 }, rear: { x: .31, y: .102 },
  tireHalfWidth: .027 * 1.4, forkOffset: .056, forkRadius: .008, maxTravel: .045,
} as const;

// Game bearings increase clockwise; Three's positive Y yaw is anticlockwise.
// Wheels, forks and the headlight must all use this same physical yaw.
export function scooterSteeringYaw(steeringAngle: number) { return -steeringAngle * .42; }

/** Tailpipe outlet measured on the original, unscaled -X-facing scooter. */
export const SCOOTER_EXHAUST_OUTLET = { x: .472, y: .108, z: -.088 } as const;
