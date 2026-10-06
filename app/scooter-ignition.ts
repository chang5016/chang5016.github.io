import { stepVehicle, type VehicleInput, type VehicleState, type BuildingBounds } from './game-core';

export type IgnitionPhase = 'off' | 'starting' | 'running';

/** Keep the existing driving response; ignition only controls engine torque. */
export class ScooterIgnition {
  phase: IgnitionPhase = 'running';
  private remaining = 0;
  get running() { return this.phase === 'running'; }
  toggle() {
    if (this.phase === 'off') { this.phase = 'starting'; this.remaining = .55; }
    else { this.phase = 'off'; this.remaining = 0; }
    return this.phase;
  }
  step(seconds: number) {
    if (this.phase !== 'starting') return false;
    this.remaining -= Math.max(0, Math.min(.1, seconds));
    if (this.remaining > 1e-6) return false;
    this.phase = 'running'; return true;
  }
}

export function ignitionInput(input: VehicleInput, state: VehicleState, running: boolean): VehicleInput {
  return running ? input : { ...input, forward: false, reverse: false, drift: false,
    brake: input.brake || (input.reverse && state.speed > .25) };
}

export function stepIgnitedVehicle(state: VehicleState, input: VehicleInput, running: boolean, seconds: number,
  buildings: readonly BuildingBounds[] = [], motorLevel = 0, roadGrade = 0, grip = 1, collisionRadius = .95) {
  const source = running ? state : { ...state, throttle: 0, boost: 0, driftCharge: 0 };
  return stepVehicle(source, ignitionInput(input, source, running), seconds, buildings, motorLevel, roadGrade, grip, collisionRadius);
}
