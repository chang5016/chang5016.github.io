export type Coordinates = { x: number; z: number };
export type BuildingBounds = {
  x: number;
  z: number;
  halfWidth: number;
  halfDepth: number;
  outline?: readonly Coordinates[];
};
export type VehicleInput = { forward: boolean; reverse: boolean; left: boolean; right: boolean; brake: boolean; drift: boolean };
export type VehicleState = Coordinates & {
  heading: number;
  speed: number;
  throttle: number;
  steering: number;
  lean: number;
  suspension: number;
  suspensionVelocity: number;
  driftCharge: number;
  boost: number;
  collided: boolean;
};

export const DISTRICT_ORIGIN = { latitude: 24.150453, longitude: 120.663454 };
export const METERS_PER_LATITUDE = 110540;
export const METERS_PER_LONGITUDE = 111320 * Math.cos(DISTRICT_ORIGIN.latitude * Math.PI / 180);
export const REAL_MAP_ZOOM = 17;
export const EMPTY_INPUT: VehicleInput = { forward: false, reverse: false, left: false, right: false, brake: false, drift: false };

export const TAICHUNG_LOCATIONS = [
  { name: "中央綠園道", address: "和風大道・綠園道口", icon: "🌿", longitude: 120.663454, latitude: 24.14963881508956 },
  { name: "晴川百貨", address: "民景路 68 號", icon: "🏬", longitude: 120.6668012264707, latitude: 24.151448114890535 },
  { name: "海灣市民廣場", address: "中央大道廣場入口", icon: "⛲", longitude: 120.6668012264707, latitude: 24.148010445268678 },
  { name: "南町生活街", address: "南町路 36 巷", icon: "🥢", longitude: 120.66099280406567, latitude: 24.154614389542246 },
  { name: "城市文化館", address: "學府路 1 號", icon: "🏛️", longitude: 120.66463537404849, latitude: 24.14629161045775 },
  { name: "港角商圈", address: "臨河路商業街", icon: "🧋", longitude: 120.65872850380607, latitude: 24.151448114890535 },
] as const;

export function createVehicle(): VehicleState {
  return { x: 0, z: 0, heading: 0, speed: 0, throttle: 0, steering: 0, lean: 0, suspension: 0, suspensionVelocity: 0, driftCharge: 0, boost: 0, collided: false };
}

export function coordinatesFromLocation(point: { longitude: number; latitude: number }): Coordinates {
  return {
    x: (point.longitude - DISTRICT_ORIGIN.longitude) * METERS_PER_LONGITUDE,
    z: -(point.latitude - DISTRICT_ORIGIN.latitude) * METERS_PER_LATITUDE,
  };
}

export function locationFromCoordinates(point: Coordinates): { longitude: number; latitude: number } {
  return {
    longitude: DISTRICT_ORIGIN.longitude + point.x / METERS_PER_LONGITUDE,
    latitude: DISTRICT_ORIGIN.latitude - point.z / METERS_PER_LATITUDE,
  };
}

export function tileFromLocation(point: { longitude: number; latitude: number }, zoom = REAL_MAP_ZOOM) {
  const count = 2 ** zoom;
  const latitude = point.latitude * Math.PI / 180;
  return {
    x: Math.floor((point.longitude + 180) / 360 * count),
    y: Math.floor((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * count),
    zoom,
  };
}

export function locationFromTile(x: number, y: number, zoom = REAL_MAP_ZOOM) {
  const count = 2 ** zoom;
  return {
    longitude: x / count * 360 - 180,
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / count))) * 180 / Math.PI,
  };
}

export function distanceBetween(a: Coordinates, b: Coordinates): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function damp(current: number, target: number, response: number, seconds: number): number {
  return current + (target - current) * (1 - Math.exp(-response * seconds));
}

function distanceToSegment(point: Coordinates, start: Coordinates, end: Coordinates) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < 0.000001) return Math.hypot(point.x - start.x, point.z - start.z);
  const progress = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared,
  ));
  return Math.hypot(point.x - start.x - dx * progress, point.z - start.z - dz * progress);
}

function pointInsidePolygon(point: Coordinates, polygon: readonly Coordinates[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if ((a.z > point.z) !== (b.z > point.z) &&
        point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function intersectsBuilding(position: Coordinates, buildings: readonly BuildingBounds[], radius = 0.95): boolean {
  return buildings.some((building) => {
    if (Math.abs(position.x - building.x) > building.halfWidth + radius ||
        Math.abs(position.z - building.z) > building.halfDepth + radius) return false;

    if (building.outline && building.outline.length >= 3) {
      if (pointInsidePolygon(position, building.outline)) return true;
      for (let index = 0; index < building.outline.length; index++) {
        const start = building.outline[index];
        const end = building.outline[(index + 1) % building.outline.length];
        if (distanceToSegment(position, start, end) < radius) return true;
      }
      return false;
    }

    const closestX = Math.max(building.x - building.halfWidth, Math.min(position.x, building.x + building.halfWidth));
    const closestZ = Math.max(building.z - building.halfDepth, Math.min(position.z, building.z + building.halfDepth));
    return Math.hypot(position.x - closestX, position.z - closestZ) < radius;
  });
}

export function resolveVehiclePenetration(position: Coordinates, buildings: readonly BuildingBounds[], radius = 0.95): Coordinates {
  const resolved = { ...position };
  const epsilon = 0.035;
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const building of buildings) {
      if (!intersectsBuilding(resolved, [building], radius)) continue;
      const left = building.x - building.halfWidth - radius - epsilon;
      const right = building.x + building.halfWidth + radius + epsilon;
      const back = building.z - building.halfDepth - radius - epsilon;
      const front = building.z + building.halfDepth + radius + epsilon;
      const exits = [
        { distance: Math.abs(resolved.x - left), x: left, z: resolved.z },
        { distance: Math.abs(right - resolved.x), x: right, z: resolved.z },
        { distance: Math.abs(resolved.z - back), x: resolved.x, z: back },
        { distance: Math.abs(front - resolved.z), x: resolved.x, z: front },
      ].sort((a, b) => a.distance - b.distance);
      const exit = exits.find((candidate) => !intersectsBuilding(candidate, [building], radius)) ?? exits[0];
      resolved.x = exit.x;
      resolved.z = exit.z;
      changed = true;
    }
    if (!changed) break;
  }
  return resolved;
}

function sweptVehiclePosition(start: Coordinates, end: Coordinates, buildings: readonly BuildingBounds[], radius = 0.95) {
  const distance = Math.hypot(end.x - start.x, end.z - start.z);
  const steps = Math.max(1, Math.ceil(distance / 0.28));
  let safe = { ...start };
  let safeProgress = 0;
  for (let step = 1; step <= steps; step++) {
    const progress = step / steps;
    const sample = {
      x: start.x + (end.x - start.x) * progress,
      z: start.z + (end.z - start.z) * progress,
    };
    if (!intersectsBuilding(sample, buildings, radius)) {
      safe = sample;
      safeProgress = progress;
      continue;
    }
    let low = safeProgress;
    let high = progress;
    for (let iteration = 0; iteration < 8; iteration++) {
      const middle = (low + high) / 2;
      const candidate = {
        x: start.x + (end.x - start.x) * middle,
        z: start.z + (end.z - start.z) * middle,
      };
      if (intersectsBuilding(candidate, buildings, radius)) high = middle;
      else {
        low = middle;
        safe = candidate;
      }
    }
    return { position: safe, collided: true };
  }
  return { position: safe, collided: false };
}

export function stepVehicle(state: VehicleState, input: VehicleInput, frameSeconds: number, buildings: readonly BuildingBounds[] = [], motorLevel = 0, roadGrade = 0, grip = 1, collisionRadius = .95): VehicleState {
  const dt = Math.max(0, Math.min(frameSeconds, 0.04));
  const reversingAgainstMotion = input.reverse && !input.forward && state.speed > .25;
  const throttleTarget = input.brake || reversingAgainstMotion || input.forward === input.reverse ? 0 : input.forward ? 1 : -0.66;
  const throttle = damp(state.throttle, throttleTarget, input.forward || input.reverse ? 8.4 : 6.2, dt);
  const targetSteering = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const steering = damp(state.steering, targetSteering, input.drift ? 7.2 : 11.4, dt);
  const boost = Math.max(0, state.boost - dt);
  const aerodynamicDrag = Math.sign(state.speed) * state.speed * state.speed * 0.0048;
  const rollingResistance = Math.abs(state.speed) > 0.15 ? Math.sign(state.speed) * 0.62 : 0;
  const slopeResistance = Math.sin(Math.atan(Math.max(-0.3, Math.min(0.3, roadGrade)))) * 9.81;
  let speed = state.speed + ((input.brake || reversingAgainstMotion ? 0 : throttle) * (10.8 + motorLevel * 2.4) - aerodynamicDrag - rollingResistance - slopeResistance + (boost > 0 && !input.brake ? 11.5 : 0)) * dt;
  if (input.brake || reversingAgainstMotion) {
    const braking = (input.brake ? 9.5 : 7.4) * Math.max(.4, Math.min(1, grip));
    speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - braking * dt);
  } else {
    speed *= Math.exp(-(Math.abs(throttle) > 0.12 ? 0.07 : 0.16) * dt);
  }
  speed = Math.max(-5.8, Math.min(28 + motorLevel * 2.4 + (boost > 0 ? 10 : 0), speed));
  if (Math.abs(speed) < 0.035 && !input.forward && !input.reverse && Math.abs(slopeResistance) < .62) speed = 0;

  // Restore the established riding response, including high-speed steering authority.
  const lowSpeedAuthority = Math.min(Math.abs(speed) / 2.6, 1);
  const speedStability = Math.max(0.68, 1.22 - Math.abs(speed) * 0.023);
  const heading = state.heading + steering * lowSpeedAuthority * speedStability * (input.drift ? 1.27 : 1) * dt * Math.sign(speed || 1);
  const driftAngle = input.drift ? steering * 0.13 : 0;
  const separated = resolveVehiclePenetration(state, buildings, collisionRadius);
  const wasPenetrating = Math.hypot(separated.x - state.x, separated.z - state.z) > 0.001;
  const desired = {
    x: separated.x + Math.sin(heading + driftAngle) * speed * dt,
    z: separated.z - Math.cos(heading + driftAngle) * speed * dt,
  };
  const sweep = sweptVehiclePosition(separated, desired, buildings, collisionRadius);
  let next = sweep.position;
  const collided = wasPenetrating || sweep.collided;
  if (sweep.collided) {
    const slideX = sweptVehiclePosition(next, { x: desired.x, z: next.z }, buildings, collisionRadius);
    const slideZ = sweptVehiclePosition(next, { x: next.x, z: desired.z }, buildings, collisionRadius);
    const distanceX = Math.hypot(slideX.position.x - next.x, slideX.position.z - next.z);
    const distanceZ = Math.hypot(slideZ.position.x - next.x, slideZ.position.z - next.z);
    next = distanceX > distanceZ ? slideX.position : slideZ.position;
    speed *= Math.abs(speed) > 12 ? 0.08 : 0.24;
  } else if (wasPenetrating) {
    speed *= 0.16;
  }
  next = resolveVehiclePenetration(next, buildings, collisionRadius);
  const ripple = (Math.sin(next.x * 0.18 + next.z * 0.11) * 0.013 + Math.sin(next.z * 0.04) * 0.014) * Math.min(Math.abs(speed) / 10, 1);
  const suspensionTarget = ripple - (input.brake ? Math.min(Math.abs(speed), 13) * 0.005 : 0);
  const suspensionVelocity = state.suspensionVelocity + ((suspensionTarget - state.suspension) * 70 - state.suspensionVelocity * 12) * dt;
  const suspension = state.suspension + suspensionVelocity * dt;
  const lean = damp(state.lean, -steering * Math.min(Math.abs(speed) * 0.017, input.drift ? 0.3 : 0.23), 9.5, dt);
  const driftCharge = input.drift && Math.abs(steering) > 0.25 && Math.abs(speed) > 6 ? Math.min(4, state.driftCharge + dt) : Math.max(0, state.driftCharge - dt * 1.3);
  return {
    x: next.x,
    z: next.z,
    heading,
    speed,
    throttle,
    steering,
    lean,
    suspension,
    suspensionVelocity: collided ? suspensionVelocity - 0.7 : suspensionVelocity,
    driftCharge,
    boost,
    collided,
  };
}

export function tripFare(distance: number, secondsRemaining: number, comfort: number, comfortLevel = 0) {
  const base = 70 + Math.round(Math.max(0, distance) * 0.14);
  const tip = Math.round(Math.max(0, Math.min(100, comfort)) * 0.58 + comfortLevel * 11);
  const punctuality = Math.max(0, Math.round(secondsRemaining * 0.4));
  return { base, tip, punctuality, total: base + tip + punctuality };
}
