export type VerticalVehicleState = {
  height: number;
  velocity: number;
  lastGroundHeight: number;
  grounded: boolean;
  compression: number;
  impact: number;
  airTime: number;
};

export function createVerticalVehicle(groundHeight = 0): VerticalVehicleState {
  return {
    height: groundHeight,
    velocity: 0,
    lastGroundHeight: groundHeight,
    grounded: true,
    compression: 0,
    impact: 0,
    airTime: 0,
  };
}

export function stepVerticalVehicle(
  previous: VerticalVehicleState,
  groundHeight: number,
  seconds: number,
): VerticalVehicleState {
  if (seconds <= 0) return previous;
  const dt = Math.max(0.001, Math.min(seconds, 0.04));
  const groundVelocity = Math.max(-7.5, Math.min(7.5, (groundHeight - previous.lastGroundHeight) / dt));
  let height = previous.height;
  let velocity = previous.velocity;
  let grounded = previous.grounded;
  let compression = previous.compression * Math.exp(-9.5 * dt);
  let impact = previous.impact * Math.exp(-7.2 * dt);
  let airTime = previous.airTime;

  if (grounded && groundHeight < height - 0.16) {
    grounded = false;
    airTime = 0;
    velocity = Math.max(velocity, Math.max(-0.7, groundVelocity));
  }

  if (grounded) {
    const displacement = groundHeight - height;
    velocity += (displacement * 118 - velocity * 17.5) * dt;
    height += velocity * dt;
    if (height < groundHeight - 0.035) {
      compression = Math.min(0.18, compression + groundHeight - height);
      height = groundHeight - 0.035;
      velocity = Math.max(velocity, groundVelocity);
    }
    if (Math.abs(height - groundHeight) < 0.008 && Math.abs(velocity - groundVelocity) < 0.12) {
      height = groundHeight;
      velocity = groundVelocity;
    }
  } else {
    airTime += dt;
    velocity -= 9.81 * dt;
    height += velocity * dt;
    if (height <= groundHeight) {
      const landingSpeed = Math.max(0, -velocity + Math.max(0, groundVelocity));
      height = groundHeight;
      grounded = true;
      airTime = 0;
      compression = Math.min(0.22, landingSpeed * 0.018);
      impact = Math.min(1, landingSpeed / 8.5);
      velocity = Math.max(groundVelocity, landingSpeed * 0.055);
    }
  }

  return { height, velocity, lastGroundHeight: groundHeight, grounded, compression, impact, airTime };
}
