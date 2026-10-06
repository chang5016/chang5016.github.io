import type { BuildingBounds, Coordinates, VehicleState } from './game-core';

export const METRO_FLOOR = 21.6;
export const METRO_CAR_LENGTH = 35.719095;
export const METRO_CAR_OFFSETS = [-18.21, 18.21] as const;
export const METRO_CAR_INTERIOR_CENTER = -1.7;
export const METRO_CAR_INTERIOR_HALF = 14.5;
export const METRO_GANGWAY_HALF_WIDTH = 1.72;
export const METRO_GANGWAY_HALF_LENGTH = 2.15;
export const METRO_LOCAL_DOORS = [-11.846805, -1.740306, 8.349455] as const;
export const METRO_HALF_WIDTH = 3.302005;
export const METRO_PLATFORM_GAP = .32;
export const metroScreenEdge = (track:number) => METRO_TRACKS[track].z + METRO_TRACKS[track].side * (METRO_HALF_WIDTH + METRO_PLATFORM_GAP + .02);
export const METRO_DOOR_WIDTH = 3.05;
export const METRO_INTERIOR_HEIGHT = 4.4;
export const METRO_PLATFORM_HALF = 5.6;
export const METRO_PLATFORM_SPEED = 25 / 3.6;
export const METRO_DOORS = METRO_CAR_OFFSETS.flatMap((offset, car) => METRO_LOCAL_DOORS.map(at => ({ x: offset + at * (car === 0 ? -1 : 1), car }))).sort((a, b) => a.x - b.x);
export const METRO_STATIONS = [
  { id: 'MB01', name: '南港生活區', english: 'Nangang', x: -650 },
  { id: 'MB02', name: '晴川南站', english: 'Qingchuan South', x: 120 },
  { id: 'MB03', name: '東河門戶', english: 'East River', x: 960 },
] as const;
export const METRO_TRACKS = [
  { z: -837, side: 1 as const, destination: '東河門戶' },
  { z: -848, side: -1 as const, destination: '南港生活區' },
] as const;
export const METRO_DWELL = 24;
export const METRO_DOOR_SECONDS = 1.5;
const LIFT_DOOR_SECONDS = 1.2;
export const LIFT_HALF = 3.6;
export const METRO_HALL_COLUMNS = [22, 58] as const;
export const METRO_TERRAIN_PATCH = { offsetX: 42, z: -833, width: 76, depth: 146 } as const;
export const METRO_TERMINAL_RUNOFF = 84;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const ease = (t: number) => t * t * t * (10 + t * (-15 + t * 6));
const easeDerivative = (t: number) => 30 * t * t * (1 - t) * (1 - t);

/** Cut/fill one station parcel to the street design level; feather its perimeter.
 * A stable design datum keeps lift floors aligned when real elevation tiles load. */
export function metroStationTerrain(point: Coordinates, raw: number, designGround: (point: Coordinates) => number) {
  if (point.z <= -900 || point.z >= -764) return raw;
  for (const station of METRO_STATIONS) {
    if (point.x <= station.x + 4 || point.x >= station.x + 76) continue;
    const dx = Math.max(station.x + 16 - point.x, 0, point.x - station.x - 64);
    const dz = Math.max(-888 - point.z, 0, point.z + 776);
    const distance = Math.hypot(dx, dz);
    if (distance >= 12) continue;
    const blend = ease(distance / 12);
    return designGround({ x: station.x, z: -794 }) * (1 - blend) + raw * blend;
  }
  return raw;
}

export type TrainPhase = 'opening' | 'dwell' | 'closing' | 'running';
export type MetroTrain = {
  id: number; track: number; x: number; previousX: number; z: number;
  direction: 1 | -1; station: number; nextStation: number;
  phase: TrainPhase; elapsed: number; door: number; previousDoor: number;
  speed: number; blocked: boolean; trips: number;
};
export type MetroLift = {
  id: number; station: number; track: number; x: number; z: number;
  lower: number; height: number; previousHeight: number; from: number; target: number;
  phase: 'idle' | 'closing' | 'moving' | 'opening';
  elapsed: number; door: number; previousDoor: number; blocked: boolean;
};
export type MetroGate = { id: number; station: number; track: number; lane: number; x: number; z: number; open: number; previousOpen: number; accepted: boolean; lastSeen: number };
export const METRO_BIKE_CAPACITY = 16;
export const METRO_RAIL_HALF_WIDTH = 10.4;
export const METRO_RAIL_GAUGE_HALF = 1.6;
export type MetroCarrier = { kind: 'train'; id: number; car: number } | { kind: 'lift'; id: number };
export type MetroHud = {
  visible: boolean; mode: 'approach' | 'platform' | 'train' | 'lift';
  station: string; destination: string; status: string; instruction: string;
  seconds: number; trainSpeed: number; action: string;
  timerPaused: boolean;
  positions: { x: number; z: number; direction: number }[];
};
export const EMPTY_METRO_HUD: MetroHud = {
  visible: false, mode: 'approach', station: '', destination: '', status: '', instruction: '',
  seconds: 0, trainSpeed: 0, action: '', timerPaused: false, positions: [],
};

export function metroRunSeconds(from: number, to: number) {
  // Keep the same comfortable acceleration after relocating a station.
  // The quintic's peak second derivative is 5.7735; peak speed is 1.875.
  const distance=Math.abs(METRO_STATIONS[to].x - METRO_STATIONS[from].x);
  return Math.max(30, distance / 14.4, Math.sqrt(distance * 5.773502692 / 1.35));
}

export function metroPlatform(station: number, track: number) {
  const route = METRO_TRACKS[track];
  return { x: METRO_STATIONS[station].x, z: route.z + route.side * (METRO_HALF_WIDTH + METRO_PLATFORM_GAP + METRO_PLATFORM_HALF), halfWidth: 38, halfDepth: METRO_PLATFORM_HALF };
}

export function metroConcourse(station: number): BuildingBounds {
  return { x: METRO_STATIONS[station].x + 40, z: -833, halfWidth: 22.4, halfDepth: 54.4 };
}

/** The downloaded train's driver nose is excluded from its rideable cabin. */
export function metroCarBounds(train: MetroTrain, car: number): BuildingBounds {
  const orientation = car === 0 ? -1 : 1;
  return { x: train.x + METRO_CAR_OFFSETS[car] + METRO_CAR_INTERIOR_CENTER * orientation, z: train.z, halfWidth: METRO_CAR_INTERIOR_HALF, halfDepth: METRO_HALF_WIDTH };
}

export function metroGangwayBounds(train:MetroTrain):BuildingBounds {
  return {x:train.x,z:train.z,halfWidth:METRO_GANGWAY_HALF_LENGTH,halfDepth:METRO_GANGWAY_HALF_WIDTH};
}

/** A driveway meets the road edge; no hall or structural column occupies the road. */
export function metroStreetApproach(station: number): BuildingBounds {
  const x = METRO_STATIONS[station].x;
  return { x: x + 15, z: -794, halfWidth: 12, halfDepth: 3.4 };
}

export function metroGroundAccess(lift: MetroLift): BuildingBounds[] {
  const station = METRO_STATIONS[lift.station], hall = metroConcourse(lift.station);
  if (lift.track === 0) {
    const start = lift.z + LIFT_HALF, end = -802;
    return [{ x: lift.x, z: (start + end) / 2, halfWidth: 3.2, halfDepth: Math.abs(start - end) / 2 + .04 }, hall];
  }
  const approach = lift.z + LIFT_HALF + 3.2, outsideX = station.x + 44;
  return [
    { x: (lift.x + outsideX) / 2, z: approach, halfWidth: (outsideX - lift.x) / 2 + 3.2, halfDepth: 3.2 },
    { x: outsideX, z: (approach - 802) / 2, halfWidth: 3.2, halfDepth: Math.abs(approach + 802) / 2 + .04 }, hall,
  ];
}

export function metroLiftLanding(lift: MetroLift): BuildingBounds {
  const side = METRO_TRACKS[lift.track].side, platform = metroPlatform(lift.station, lift.track);
  const edge = platform.z + side * platform.halfDepth, cabinFace = lift.z - side * LIFT_HALF;
  return { x: lift.x, z: (edge + cabinFace) / 2, halfWidth: 2.7, halfDepth: Math.abs(edge - cabinFace) / 2 + .003 };
}

export function metroPierPositions(clears: (point: Coordinates, radius: number) => boolean = () => true) {
  const start = METRO_STATIONS[0].x - METRO_TERMINAL_RUNOFF, end = METRO_STATIONS[2].x + METRO_TERMINAL_RUNOFF;
  const planned: (Coordinates & { radius: number })[] = [];
  const add = (desired: Coordinates, radius: number, maximumShift: number) => {
    for (let shift = 0; shift <= maximumShift; shift += 3) for (const sign of shift ? [-1, 1] : [1]) {
      const point = { ...desired, x: desired.x + sign * shift };
      // Include the footing, road shoulders and existing bridge supports in clearance.
      if (point.x < start || point.x > end || !clears(point, Math.max(2.05, radius))) continue;
      if (planned.some(pier => Math.hypot(point.x - pier.x, point.z - pier.z) < 9)) continue;
      planned.push({ ...point, radius }); return;
    }
  };
  for (let x = start + 18; x < end; x += 54) {
    if (METRO_STATIONS.some(station => Math.abs(station.x - x) <= 42)) continue;
    if (x > 576 && x < 672) continue; // clear the river with a continuous long span
    add({ x, z: -842.5 }, 1.125, 39);
  }
  for (let index = 0; index < METRO_STATIONS.length; index++) {
    const station = METRO_STATIONS[index];
    for (const offset of [-46, 38]) add({ x: station.x + offset, z: -842.5 }, 1.125, 15);
    for (const track of [0, 1]) for (const offset of [-31, 31]) add({ x: station.x + offset, z: metroPlatform(index, track).z }, .8, 12);
  }
  add({ x: 570, z: -842.5 }, 1.125, 12); add({ x: 680, z: -842.5 }, 1.125, 12);
  return planned;
}

function inside(point: Coordinates, bounds: BuildingBounds, margin = 0) {
  return Math.abs(point.x - bounds.x) <= bounds.halfWidth - margin && Math.abs(point.z - bounds.z) <= bounds.halfDepth - margin;
}

/** The original scooter's oriented footprint, used by door and lift safety sensors. */
export function scooterFootprint(heading: number) {
  return {
    x: Math.abs(Math.sin(heading)) * 1.725 + Math.abs(Math.cos(heading)) * .63,
    z: Math.abs(Math.cos(heading)) * 1.725 + Math.abs(Math.sin(heading)) * .63,
  };
}

/** Fixed-step transport simulation. It never depends on wall-clock time or frame rate. */
export class MetroSystem {
  readonly trains: MetroTrain[];
  readonly lifts: MetroLift[];
  readonly gates: MetroGate[];
  ticketPasses = 0;
  readonly piers: (Coordinates & { radius: number; bottom: number; top: number })[];
  carrier: MetroCarrier | null = null;
  readonly participants = new Map<string,{rider:VehicleState;height:number;carrier:MetroCarrier|null}>();
  private participantContext:string|null = null;
  private heroCarrierContext:MetroCarrier|null = null;
  seconds = 0;
  boardings = 0;
  readonly fixtures: (BuildingBounds & { bottom: number; top: number })[] = [];
  addFixture(bounds: BuildingBounds, bottom: number, top: number) { this.fixtures.push({ ...bounds, bottom, top }); }

  constructor(ground: (point: Coordinates) => number = () => 0, clears: (point: Coordinates, radius: number) => boolean = () => true) {
    this.trains = METRO_TRACKS.map((track, id) => {
      const station = id === 0 ? 0 : 2;
      return {
        id, track: id, x: METRO_STATIONS[station].x, previousX: METRO_STATIONS[station].x,
        z: track.z, direction: id === 0 ? 1 : -1, station, nextStation: 1,
        phase: 'dwell', elapsed: id === 0 ? 0 : 10, door: 1, previousDoor: 1,
        speed: 0, blocked: false, trips: 0,
      };
    });
    this.lifts = METRO_STATIONS.flatMap((station, index) => METRO_TRACKS.map((track, side) => {
      const platform = metroPlatform(index, side);
      const point = { x: station.x + 30, z: platform.z + track.side * (platform.halfDepth + LIFT_HALF + .7) };
      const lower = ground({ x: station.x + 30, z: -809 }) + .06;
      return {
        ...point, id: index * 2 + side, station: index, track: side, lower,
        height: lower, previousHeight: lower, from: lower, target: lower,
        phase: 'idle' as const, elapsed: 0, door: 1, previousDoor: 1, blocked: false,
      };
    }));
    this.gates = []; // No ticket barriers in the motorcycle concourse.
    const safeSupport = (point: Coordinates, radius: number) => clears(point, radius) && this.lifts.every(lift => metroGroundAccess(lift).every(area =>
      Math.abs(point.x - area.x) >= area.halfWidth + radius || Math.abs(point.z - area.z) >= area.halfDepth + radius));
    this.piers = metroPierPositions(safeSupport).map(point => ({ ...point, bottom: ground(point) - .5, top: METRO_FLOOR - 1 }));
  }

  private trainDoorObstructed(train: MetroTrain, rider: VehicleState, height: number) {
    if (Math.abs(height - METRO_FLOOR) > .65) return false;
    const footprint = scooterFootprint(rider.heading);
    const side = METRO_TRACKS[train.track].side;
    if (Math.abs(rider.z - (train.z + side * METRO_HALF_WIDTH)) > footprint.z + .1) return false;
    return METRO_DOORS.some(door => Math.abs(rider.x - train.x - door.x) < METRO_DOOR_WIDTH / 2 + footprint.x);
  }

  private stepTrain(train: MetroTrain, dt: number, rider: VehicleState, height: number) {
    train.previousX = train.x; train.previousDoor = train.door;
    train.blocked = train.phase !== 'running' && (this.trainDoorObstructed(train, rider, height) || [...this.participants.values()].some(p=>this.trainDoorObstructed(train,p.rider,p.height)));
    if (train.phase === 'closing' && train.blocked) {
      train.phase = 'opening'; train.elapsed = train.door * METRO_DOOR_SECONDS;
    }
    train.elapsed += dt;
    if (train.phase === 'opening') {
      train.door = clamp(train.elapsed / METRO_DOOR_SECONDS, 0, 1);
      if (train.elapsed >= METRO_DOOR_SECONDS) { train.phase = 'dwell'; train.elapsed -= METRO_DOOR_SECONDS; train.door = 1; }
    } else if (train.phase === 'dwell') {
      train.door = 1;
      if (train.elapsed >= METRO_DWELL && !train.blocked) { train.phase = 'closing'; train.elapsed = Math.min(dt, train.elapsed - METRO_DWELL); }
    } else if (train.phase === 'closing') {
      train.door = 1 - clamp(train.elapsed / METRO_DOOR_SECONDS, 0, 1);
      if (train.elapsed >= METRO_DOOR_SECONDS) { train.phase = 'running'; train.elapsed -= METRO_DOOR_SECONDS; train.door = 0; }
    } else {
      const duration = metroRunSeconds(train.station, train.nextStation);
      const progress = clamp(train.elapsed / duration, 0, 1);
      const from = METRO_STATIONS[train.station].x, to = METRO_STATIONS[train.nextStation].x;
      train.x = from + (to - from) * ease(progress);
      train.speed = (to - from) / duration * easeDerivative(progress);
      train.door = 0;
      if (train.elapsed >= duration) {
        train.x = to; train.speed = 0; train.station = train.nextStation;
        if (train.station === 0) train.direction = 1;
        if (train.station === METRO_STATIONS.length - 1) train.direction = -1;
        train.nextStation = train.station + train.direction;
        train.phase = 'opening'; train.elapsed -= duration; train.trips++;
      }
    }
    if (train.phase !== 'running') train.speed = 0;
  }

  private liftThresholdBlocked(lift: MetroLift, rider: VehicleState, height: number) {
    if (Math.abs(lift.height - height) > .65) return false;
    const footprint = scooterFootprint(rider.heading);
    return Math.abs(rider.x - lift.x) < LIFT_HALF + footprint.x &&
      Math.abs(rider.z - lift.z) < LIFT_HALF + footprint.z &&
      !this.whollyInLift(lift, rider);
  }

  whollyInLift(lift: MetroLift, rider: VehicleState) {
    const footprint = scooterFootprint(rider.heading);
    return Math.abs(rider.x - lift.x) + footprint.x < LIFT_HALF - .12 &&
      Math.abs(rider.z - lift.z) + footprint.z < LIFT_HALF - .12;
  }

  private stepLift(lift: MetroLift, dt: number, rider: VehicleState, height: number) {
    lift.previousHeight = lift.height; lift.previousDoor = lift.door;
    lift.blocked = lift.phase === 'closing' && (this.liftThresholdBlocked(lift, rider, height) || [...this.participants.values()].some(p=>this.liftThresholdBlocked(lift,p.rider,p.height)));
    if (lift.blocked) { lift.elapsed = 0; lift.door = 1; return; }
    lift.elapsed += dt;
    if (lift.phase === 'closing') {
      lift.door = 1 - clamp(lift.elapsed / LIFT_DOOR_SECONDS, 0, 1);
      if (lift.elapsed >= LIFT_DOOR_SECONDS) { lift.phase = 'moving'; lift.elapsed = 0; lift.door = 0; }
    } else if (lift.phase === 'moving') {
      const duration = Math.max(5, Math.abs(lift.target - lift.from) / 2.5);
      lift.height = lift.from + (lift.target - lift.from) * ease(clamp(lift.elapsed / duration, 0, 1));
      if (lift.elapsed >= duration) { lift.height = lift.target; lift.phase = 'opening'; lift.elapsed = 0; }
    } else if (lift.phase === 'opening') {
      lift.door = clamp(lift.elapsed / LIFT_DOOR_SECONDS, 0, 1);
      if (lift.elapsed >= LIFT_DOOR_SECONDS) { lift.phase = 'idle'; lift.elapsed = 0; lift.door = 1; }
    }
  }

  private stepGates(rider: VehicleState, height: number, dt: number) {
    for (const gate of this.gates) {
      gate.previousOpen = gate.open;
      const sensorLength = Math.max(10, Math.abs(rider.speed) * .7 + scooterFootprint(rider.heading).z);
      const detected = Math.abs(height - METRO_FLOOR) < .6 && Math.abs(rider.x - gate.x) < 1.85 && Math.abs(rider.z - gate.z) < sensorLength;
      if (detected) {
        gate.lastSeen = this.seconds;
        if (!gate.accepted) { gate.accepted = true; this.ticketPasses++; }
      }
      const clear = this.seconds - gate.lastSeen > 1.5;
      gate.open = clamp(gate.open + dt * (clear ? -1.6 : 2), 0, 1);
      if (gate.open === 0 && clear) gate.accepted = false;
    }
  }

  collisionRadiusAt(rider: Coordinates, height: number) {
    return this.carrier || this.surfaceAt(rider, height) !== undefined ? .48 : .95;
  }

  boardingSignal(station: number, track: number): 'red' | 'amber' | 'green' {
    const train = this.trains[track];
    if (train.station !== station || train.phase === 'running') return 'red';
    return train.phase === 'dwell' && train.door > .98 ? 'green' : 'amber';
  }

  capacity(trainId:number) {
    const aboard=(c:MetroCarrier|null)=>c?.kind==='train'&&c.id===trainId?1:0;
    let count=aboard(this.carrier)+(this.participantContext?aboard(this.heroCarrierContext):0);
    for(const [id,p] of this.participants)if(id!==this.participantContext)count+=aboard(p.carrier);
    return Math.max(0,METRO_BIKE_CAPACITY-count);
  }
  registerParticipant(id:string,rider:VehicleState,height:number){if(!this.participants.has(id))this.participants.set(id,{rider:{...rider},height,carrier:null});}
  removeParticipant(id:string){this.participants.delete(id);}
  participantCarrier(id:string){return this.participants.get(id)?.carrier??null;}
  carryParticipant(id:string,rider:VehicleState,height:number){
    const c=this.participantCarrier(id);
    if(c?.kind==='train'){const train=this.trains[c.id];return{rider:{...rider,x:rider.x+train.x-train.previousX},height:METRO_FLOOR,locked:train.phase==='running'};}
    if(c?.kind==='lift'){const lift=this.lifts[c.id];return{rider,height:lift.height,locked:lift.phase!=='idle'};}
    return{rider,height,locked:false};
  }
  finishParticipant(id:string,rider:VehicleState,height:number){
    const p=this.participants.get(id);if(!p)return rider;const hero=this.carrier;
    try{this.participantContext=id;this.heroCarrierContext=hero;this.carrier=p.carrier;const result=this.endStep(rider,height);p.rider={...result};p.height=height;p.carrier=this.carrier;return result;}
    finally{this.carrier=hero;this.participantContext=null;this.heroCarrierContext=null;}
  }
  operateParticipant(id:string,rider:VehicleState,height:number){
    const p=this.participants.get(id);if(!p)return '';const hero=this.carrier;
    try{this.participantContext=id;this.heroCarrierContext=hero;this.carrier=p.carrier;const result=this.operate(rider,height);p.carrier=this.carrier;return result;}
    finally{this.carrier=hero;this.participantContext=null;this.heroCarrierContext=null;}
  }

  followingArrivalSeconds(train: MetroTrain, station: number) {
    return this.serviceArrivals(train, station, 2)[1];
  }

  beginStep(rider: VehicleState, height: number, dt: number) {
    dt = clamp(dt, 0, .04);
    this.seconds += dt;
    for (const train of this.trains) this.stepTrain(train, dt, rider, height);
    for (const lift of this.lifts) this.stepLift(lift, dt, rider, height);
    this.stepGates(rider, height, dt);
    let carried = rider;
    let carrierHeight: number | undefined;
    let locked = false;
    if (this.carrier?.kind === 'train') {
      const train = this.trains[this.carrier.id];
      carried = { ...rider, x: rider.x + train.x - train.previousX };
      carrierHeight = METRO_FLOOR;
    } else if (this.carrier?.kind === 'lift') {
      const lift = this.lifts[this.carrier.id];
      carrierHeight = lift.height;
      locked = lift.phase !== 'idle';
    }
    return { rider: carried, carrierHeight, locked };
  }

  resetInterpolation() {
    for (const gate of this.gates) gate.previousOpen = gate.open;
    for (const train of this.trains) { train.previousX = train.x; train.previousDoor = train.door; }
    for (const lift of this.lifts) { lift.previousHeight = lift.height; lift.previousDoor = lift.door; }
  }

  endStep(rider: VehicleState, height: number): VehicleState {
    if (this.carrier?.kind === 'lift') {
      const lift = this.lifts[this.carrier.id];
      if (lift.phase === 'idle' && !inside(rider, { ...lift, halfWidth: LIFT_HALF, halfDepth: LIFT_HALF })) this.carrier = null;
    } else if (this.carrier?.kind === 'train') {
      const train = this.trains[this.carrier.id];
      this.carrier.car=rider.x<train.x?0:1;
      const side = METRO_TRACKS[train.track].side;
      const towardPlatform = (rider.z - train.z) * side;
      if (train.door > .98 && towardPlatform > METRO_HALF_WIDTH + .12) this.carrier = null;
      else if (train.door < .98) {
        // Keep the whole model, not only its circular physics proxy, inside the cabin.
        const footprint = scooterFootprint(rider.heading);
        const outer=Math.abs(metroCarBounds(train,1).x-train.x)+METRO_CAR_INTERIOR_HALF;
        const x = clamp(rider.x, train.x-outer+footprint.x+.10, train.x+outer-footprint.x-.10);
        const half=Math.abs(rider.x-train.x)<METRO_GANGWAY_HALF_LENGTH+footprint.x?METRO_GANGWAY_HALF_WIDTH:METRO_HALF_WIDTH;
        const z = clamp(rider.z, train.z-half+Math.min(footprint.z,half-.16)+.13, train.z+half-Math.min(footprint.z,half-.16)-.13);
        if (x !== rider.x || z !== rider.z) rider = { ...rider, x, z, speed: 0 };
      }
    }
    if (!this.carrier) {
      for (const lift of this.lifts) {
        if (lift.phase === 'idle' && Math.abs(height - lift.height) < .4 && inside(rider, { ...lift, halfWidth: LIFT_HALF, halfDepth: LIFT_HALF }, .1)) {
          this.carrier = { kind: 'lift', id: lift.id }; break;
        }
      }
    }
    if (!this.carrier && Math.abs(height - METRO_FLOOR) < .45) {
      for (const train of this.trains) {
        if (train.phase === 'running' || train.door < .98 || this.capacity(train.id)===0) continue;
        const car = METRO_CAR_OFFSETS.findIndex((_, index) => inside(rider, metroCarBounds(train, index), .15));
        if (car >= 0) { this.carrier = { kind: 'train', id: train.id, car }; this.boardings++; break; }
      }
    }
    return rider;
  }

  surfaceAt(rider: Coordinates, height: number): number | undefined {
    if (this.carrier?.kind === 'train') return METRO_FLOOR;
    if (this.carrier?.kind === 'lift') return this.lifts[this.carrier.id].height;
    if (Math.abs(rider.z + 837) > 85 || rider.x < -850 || rider.x > 1060) return undefined;
    if (height >= METRO_FLOOR - .65) {
      for (let station = 0; station < METRO_STATIONS.length; station++) {
        for (let track = 0; track < METRO_TRACKS.length; track++) {
          if (inside(rider, metroPlatform(station, track))) return METRO_FLOOR;
          const lift = this.lifts[station * 2 + track];
          if (inside(rider, metroLiftLanding(lift))) return METRO_FLOOR;
        }
      }
      for (const train of this.trains) {
        if (METRO_CAR_OFFSETS.some((_, index) => inside(rider, metroCarBounds(train, index)))) return METRO_FLOOR;
        if(inside(rider,metroGangwayBounds(train)))return METRO_FLOOR;
        if (train.phase !== 'running' && train.door > .98) {
          const side = METRO_TRACKS[train.track].side;
          if (METRO_DOORS.some(door => inside(rider, { x: train.x + door.x, z: train.z + side * (METRO_HALF_WIDTH + METRO_PLATFORM_GAP/2), halfWidth: METRO_DOOR_WIDTH / 2, halfDepth: METRO_PLATFORM_GAP/2+.04 }))) return METRO_FLOOR;
        }
      }
    }
    for (const lift of this.lifts) {
      if (Math.abs(height - lift.height) <= .65 && inside(rider, { ...lift, halfWidth: LIFT_HALF, halfDepth: LIFT_HALF })) return lift.height;
      // A level landing joins the original asphalt. It cannot raise a vehicle below the station.
      if (Math.abs(height - lift.lower) < .75 && metroGroundAccess(lift).some(entry => inside(rider, entry))) return lift.lower;
    }
    return undefined;
  }

  speedLimitAt(rider: Coordinates, height: number) {
    if (this.carrier) return 3.2;
    if (Math.abs(height - METRO_FLOOR) < .75) {
      for (let station=0; station<METRO_STATIONS.length; station++) for (let track=0; track<METRO_TRACKS.length; track++) {
        if (inside(rider, metroPlatform(station,track)) || inside(rider, metroLiftLanding(this.lifts[station*2+track]))) return METRO_PLATFORM_SPEED;
      }
    }
    return Infinity;
  }

  operate(rider: VehicleState, height: number) {
    if (this.carrier?.kind === 'train') {
      const train = this.trains[this.carrier.id];
      return train.door > .98 ? `${METRO_STATIONS[train.station].name}站：從開啟的側門騎出，再搭升降梯到街道` : `列車前往 ${METRO_STATIONS[train.nextStation].name}；請等停妥、車門打開後再下車`;
    }
    const nearest = this.lifts.reduce((a, b) => Math.hypot(rider.x - a.x, rider.z - a.z) < Math.hypot(rider.x - b.x, rider.z - b.z) ? a : b);
    const distance = Math.hypot(rider.x - nearest.x, rider.z - nearest.z);
    if (distance > 9 || (Math.abs(height - nearest.lower) > .8 && Math.abs(height - METRO_FLOOR) > .8 && this.carrier?.kind !== 'lift')) {
      const station = this.nearestStation(rider);
      return `高架捷運 ${METRO_STATIONS[station].id} ${METRO_STATIONS[station].name} · 地面入口 ${Math.round(Math.hypot(rider.x - METRO_STATIONS[station].x, rider.z + 809))} m；騎進升降梯後按 T`;
    }
    if (nearest.phase !== 'idle') return nearest.blocked ? '機車仍在門口；請完整騎進升降梯，或退出門口' : '升降梯運行中，請等車門完全打開';
    const insideCabin = inside(rider, { ...nearest, halfWidth: LIFT_HALF, halfDepth: LIFT_HALF });
    if (insideCabin && Math.abs(height - nearest.height) < .6) {
      if (!this.whollyInLift(nearest, rider)) return '請把整台機車騎進黃色停車框，門口必須保持淨空';
      if (Math.abs(rider.speed) > .45) return '先煞車停穩，再按 T 搭升降梯';
      nearest.target = Math.abs(nearest.height - nearest.lower) < .5 ? METRO_FLOOR : nearest.lower;
      this.carrier = { kind: 'lift', id: nearest.id };
    } else {
      const occupied=this.heroCarrierContext?.kind==='lift'&&this.heroCarrierContext.id===nearest.id || [...this.participants].some(([id,p])=>id!==this.participantContext&&p.carrier?.kind==='lift'&&p.carrier.id===nearest.id);
      if(occupied)return '升降梯內有乘客；請等候乘客離開';
      nearest.target = Math.abs(height - METRO_FLOOR) < Math.abs(height - nearest.lower) ? METRO_FLOOR : nearest.lower;
      if (Math.abs(nearest.height - nearest.target) < .1) return '升降梯已到站；騎進黃色停車框，停穩後按 T';
    }
    nearest.from = nearest.height; nearest.phase = 'closing'; nearest.elapsed = 0;
    return nearest.target === METRO_FLOOR ? '升降梯上行至月台；到站後騎出車廂，依月台資訊候車' : '升降梯下行至街道；到站後再騎出車廂';
  }

  obstaclesAt(rider: Coordinates, height: number): BuildingBounds[] {
    const obstacles: BuildingBounds[] = [];
    if (Math.abs(rider.z + 837) > 85 || rider.x < -850 || rider.x > 1060) return obstacles;
    const wall = (x: number, z: number, width: number, depth: number) => {
      if (Math.abs(rider.x - x) < width / 2 + 42 && Math.abs(rider.z - z) < depth / 2 + 42) obstacles.push({ x, z, halfWidth: width / 2, halfDepth: depth / 2 });
    };
    const splitWall = (x: number, z: number, start: number, end: number, openings: { x: number; width: number; open: boolean }[]) => {
      let edge = start;
      for (const opening of openings) {
        const left = opening.x - opening.width / 2, right = opening.x + opening.width / 2;
        if (left > edge) wall(x + (edge + left) / 2, z, left - edge, .16);
        if (!opening.open) wall(x + opening.x, z, opening.width, .16);
        edge = right;
      }
      if (edge < end) wall(x + (edge + end) / 2, z, end - edge, .16);
    };
    for (const fixture of this.fixtures) if (height < fixture.top + .1 && height + 2.95 > fixture.bottom) wall(fixture.x, fixture.z, fixture.halfWidth * 2, fixture.halfDepth * 2);
    for (const pier of this.piers) if (height + 2.95 > pier.bottom && height < pier.top - 1.1) wall(pier.x, pier.z, pier.radius * 2, pier.radius * 2);
    if (height + 2.95 > METRO_FLOOR - .08 && height < METRO_FLOOR + 4.2) {
      for (let station = 0; station < METRO_STATIONS.length; station++) {
        for (let track = 0; track < METRO_TRACKS.length; track++) {
          const platform = metroPlatform(station, track), side = METRO_TRACKS[track].side;
          const train = this.trains[track];
          const open = train.station === station && train.phase !== 'running' && train.door > .98;
          splitWall(platform.x, metroScreenEdge(track), -38, 38,
            METRO_DOORS.map(door => ({ x: door.x, width: METRO_DOOR_WIDTH, open })));
          splitWall(platform.x, platform.z + side * METRO_PLATFORM_HALF, -38, 38, [{ x: 30, width: 5.4, open: true }]);
          for (const end of [-38, 38]) wall(platform.x + end, platform.z, .16, METRO_PLATFORM_HALF * 2);
          const landing = metroLiftLanding(this.lifts[station * 2 + track]);
          for (const dx of [-2.7, 2.7]) wall(landing.x + dx, landing.z, .08, landing.halfDepth * 2);
        }
      }
      for (const train of this.trains) {
        const side = METRO_TRACKS[train.track].side;
        for (let car = 0; car < METRO_CAR_OFFSETS.length; car++) {
          const body = metroCarBounds(train, car), x = body.x;
          splitWall(x, train.z + side * METRO_HALF_WIDTH, -body.halfWidth, body.halfWidth, METRO_DOORS.filter(door => door.car === car).map(door => ({ x: train.x + door.x - x, width: METRO_DOOR_WIDTH, open: train.door > .98 })));
          wall(x, train.z - side * METRO_HALF_WIDTH, body.halfWidth * 2, .16);
          const nose=car===0?-body.halfWidth:body.halfWidth;
          wall(x+nose,train.z,.16,METRO_HALF_WIDTH*2);
          const rear=car===0?body.halfWidth:-body.halfWidth;
          for(const edge of [-1,1])wall(x+rear,train.z+edge*(METRO_HALF_WIDTH+METRO_GANGWAY_HALF_WIDTH)/2,.16,METRO_HALF_WIDTH-METRO_GANGWAY_HALF_WIDTH);
        }
        for(const edge of [-1,1])wall(train.x,train.z+edge*METRO_GANGWAY_HALF_WIDTH,METRO_GANGWAY_HALF_LENGTH*2,.14);
      }
    }
    if (Math.abs(height - METRO_FLOOR) < .6) for (const gate of this.gates) {
      for (const edge of [-2, 2]) wall(gate.x + edge, gate.z, .26, 1.0);
      if (gate.open < .94) wall(gate.x, gate.z, 3.75, .12);
    }
    for (const lift of this.lifts) {
      if (Math.abs(rider.x - lift.x) > 42 || Math.abs(rider.z - lift.z) > 42) continue;
      if (height < lift.lower - 1 || height > METRO_FLOOR + 4.2) continue;
      for (const side of [-1, 1]) wall(lift.x + side * LIFT_HALF, lift.z, .18, LIFT_HALF * 2);
      const upper = Math.abs(height - METRO_FLOOR) < .8;
      const doorSide = upper && lift.track === 0 ? -1 : 1;
      const level = upper ? METRO_FLOOR : lift.lower;
      const docked = Math.abs(lift.height - level) < .08 && lift.door > .98;
      splitWall(lift.x, lift.z + doorSide * LIFT_HALF, -LIFT_HALF, LIFT_HALF, [{ x: 0, width: 4.8, open: docked }]);
      wall(lift.x, lift.z - doorSide * LIFT_HALF, LIFT_HALF * 2, .18);
    }
    // Columns, benches and fare equipment use bounds measured from their
    // downloaded meshes, registered by MetroScene after assets are loaded.
    return obstacles;
  }

  private nearestStation(rider: Coordinates) {
    return METRO_STATIONS.reduce((best, station, index) => Math.hypot(rider.x - station.x, rider.z + 809) < Math.hypot(rider.x - METRO_STATIONS[best].x, rider.z + 809) ? index : best, 0);
  }

  arrivalSeconds(train: MetroTrain, station: number) {
    return this.serviceArrivals(train, station, 1)[0];
  }

  /** Project actual shuttle events, including its current direction and dwell.
   * Door obstructions hold departure in the simulation; boards show the planned service. */
  private serviceArrivals(train: MetroTrain, station: number, count: number) {
    const arrivals: number[] = [];
    let remaining = train.phase === 'running' ? metroRunSeconds(train.station, train.nextStation) - train.elapsed :
      train.phase === 'opening' ? METRO_DOOR_SECONDS - train.elapsed + METRO_DWELL + METRO_DOOR_SECONDS :
      train.phase === 'dwell' ? Math.max(0, METRO_DWELL - train.elapsed) + METRO_DOOR_SECONDS : Math.max(0, METRO_DOOR_SECONDS - train.elapsed);
    if (train.station === station && train.phase !== 'running') arrivals.push(0);
    let from = train.phase === 'running' ? train.nextStation : train.station;
    let direction = train.direction;
    if (train.phase === 'running') {
      if (from === station) arrivals.push(remaining);
      remaining += METRO_DWELL + METRO_DOOR_SECONDS * 2;
    }
    for (let event = 0; arrivals.length < count && event < 12; event++) {
      if (from === 0) direction = 1;
      if (from === 2) direction = -1;
      const next = from + direction;
      remaining += metroRunSeconds(from, next);
      if (next === station) arrivals.push(remaining);
      remaining += METRO_DWELL + METRO_DOOR_SECONDS * 2;
      from = next;
    }
    return arrivals;
  }

  platformDestination(train: MetroTrain, station: number) {
    if (station === 0 || station === 2) return METRO_STATIONS[1].name;
    if (train.station === station && train.phase !== 'running') return METRO_STATIONS[train.nextStation].name;
    if (train.station === 0 || train.station === 2) return METRO_STATIONS[2 - train.station].name;
    return METRO_STATIONS[2 - train.nextStation].name;
  }

  hud(rider: VehicleState, height: number): MetroHud {
    const station = this.nearestStation(rider);
    const near = Math.hypot(rider.x - METRO_STATIONS[station].x, rider.z + 832);
    const base = { ...EMPTY_METRO_HUD, visible: near < 110 || !!this.carrier, station: METRO_STATIONS[station].name,
      timerPaused: !!this.carrier || (height > 20 && this.surfaceAt(rider, height) !== undefined),
      positions: this.trains.map(train => ({ x: train.x, z: train.z, direction: train.direction })) };
    if (this.carrier?.kind === 'train') {
      const train = this.trains[this.carrier.id];
      const atStation = train.phase !== 'running';
      const seconds = atStation ? Math.max(0, (train.phase === 'dwell' ? METRO_DWELL : METRO_DOOR_SECONDS) - train.elapsed) : metroRunSeconds(train.station, train.nextStation) - train.elapsed;
      return { ...base, mode: 'train', station: atStation ? METRO_STATIONS[train.station].name : '海灣高架線',
        destination: METRO_STATIONS[train.nextStation].name, seconds: Math.ceil(seconds), trainSpeed: Math.round(Math.abs(train.speed) * 3.6),
        status: train.blocked ? '門口受阻 · 列車等待淨空' : train.phase === 'running' ? '行駛中 · 下一站' : train.phase === 'closing' ? '車門關閉中' : train.phase === 'opening' ? '到站 · 車門開啟中' : '停站 · 可下車',
        instruction: atStation ? '沿開啟的側門騎出 → 月台升降梯 T → 街道' : '機車停妥，等待停站後從側門騎出；可連乘客一起搭乘', action: '',
      };
    }
    const nearbyLift = this.lifts.find(lift => Math.hypot(rider.x - lift.x, rider.z - lift.z) < 9);
    if (nearbyLift) {
      const moving = nearbyLift.phase !== 'idle';
      return { ...base, visible: true, mode: 'lift', destination: moving ? nearbyLift.target === METRO_FLOOR ? '捷運月台' : '地面街道' : Math.abs(height - METRO_FLOOR) < .8 ? '地面街道' : '捷運月台',
        status: nearbyLift.blocked ? '門口受阻 · 請完整騎進或退出' : moving ? nearbyLift.phase === 'moving' ? '升降梯運行中' : '升降梯車門開關中' : '機車專用升降梯',
        instruction: moving ? '保持停穩，等車門完全打開後再騎出' : '完整騎進黃色框並停穩；按 T 升降。梯廂不在本層時按 T 召喚。',
        action: moving ? '' : 'T · 搭乘 / 召喚升降梯',
      };
    }
    if (height > 20 && base.visible) {
      const track = Math.abs(rider.z - METRO_TRACKS[0].z) < Math.abs(rider.z - METRO_TRACKS[1].z) ? 0 : 1;
      const train = this.trains[track];
      const present = train.station === station && train.phase !== 'running';
      return { ...base, mode: 'platform', destination: this.platformDestination(train, station),
        seconds: Math.ceil(this.arrivalSeconds(train, station)), status: present ? train.phase === 'closing' ? '列車即將離站 · 請等下一班' : train.door > .98 ? '列車停妥 · 可騎入車廂' : '請等車門完全開啟' : '候車月台 · 列車即將進站',
        instruction: '從月台玻璃門騎入機車停車區；不需按鍵即可隨列車移動', action: '',
      };
    }
    return { ...base, destination: '南港生活區 — 晴川南站 — 東河門戶', status: '海灣高架捷運 · 免費試營運',
      instruction: '入口在市區南緣；騎進機車升降梯，停穩後按 T 上月台', action: 'T · 捷運搭乘指引' };
  }
}
