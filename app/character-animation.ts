import type { VehicleInput, VehicleState } from "./game-core";
import { stepDamper } from "./suspension-dynamics";

export type CharacterMotion = {
  wheelAngle: number;
  steeringAngle: number;
  chassisPitch: number;
  riderPitch: number;
  riderSway: number;
  riderBob: number;
  cycle: number;
  frontCompression: number;
  rearCompression: number;
  frontVelocity: number;
  rearVelocity: number;
};

export function createCharacterMotion(): CharacterMotion {
  return {
    wheelAngle: 0,
    steeringAngle: 0,
    chassisPitch: 0,
    riderPitch: 0,
    riderSway: 0,
    riderBob: 0,
    cycle: 0,
    frontCompression: 0,
    rearCompression: 0,
    frontVelocity: 0,
    rearVelocity: 0,
  };
}

function smooth(current: number, target: number, response: number, seconds: number) {
  return current + (target - current) * (1 - Math.exp(-response * Math.max(0, seconds)));
}

function wrapAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export function stepCharacterMotion(
  previous: CharacterMotion,
  vehicle: VehicleState,
  input: VehicleInput,
  frameSeconds: number,
  wheelRadius = 0.34,
): CharacterMotion {
  const dt = Math.max(0, Math.min(frameSeconds, 0.04));
  const speed = Math.abs(vehicle.speed);
  const speedMix = Math.min(speed / 16, 1);
  const cycle = previous.cycle + dt * (2.15 + speed * 0.34);
  const brakeWeight = input.brake ? Math.min(speed / 8, 1) : 0;
  const accelerationWeight = Math.max(-1, Math.min(1, vehicle.throttle));
  const roadPulse = Math.sin(cycle * 1.9) * speedMix;
  const front = stepDamper(previous.frontCompression, previous.frontVelocity, brakeWeight * .055 + Math.max(0, vehicle.suspension) * .15, dt);
  const rear = stepDamper(previous.rearCompression, previous.rearVelocity, Math.max(0, accelerationWeight) * .028 + Math.max(0, vehicle.suspension) * .15, dt);

  return {
    wheelAngle: wrapAngle(previous.wheelAngle + vehicle.speed / Math.max(0.05, wheelRadius) * dt),
    steeringAngle: smooth(previous.steeringAngle, vehicle.steering * 0.62, 15, dt),
    chassisPitch: smooth(previous.chassisPitch, brakeWeight * 0.055 - accelerationWeight * 0.018 + vehicle.suspension * 0.55, 10, dt),
    riderPitch: smooth(previous.riderPitch, brakeWeight * 0.09 - accelerationWeight * 0.026, 8.5, dt),
    riderSway: smooth(previous.riderSway, vehicle.lean * 0.52 + roadPulse * 0.009, 9, dt),
    riderBob: Math.sin(cycle) * (0.0016 + speedMix * 0.0045) + Math.abs(vehicle.suspension) * 0.09,
    cycle,
    frontCompression: front.position,
    rearCompression: rear.position,
    frontVelocity: front.velocity,
    rearVelocity: rear.velocity,
  };
}
