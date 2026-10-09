import test from 'node:test';
import assert from 'node:assert/strict';
import { createVehicle, EMPTY_INPUT, stepVehicle } from '../app/game-core.ts';
import { createVerticalVehicle, stepVerticalVehicle } from '../app/vehicle-vertical-physics.ts';
import {
  MetroSystem, METRO_ALL_STATIONS, METRO_CAR_INTERIOR_CENTER, METRO_CAR_INTERIOR_HALF, METRO_DOORS,
  METRO_FLOOR, METRO_GANGWAY_HALF_LENGTH, METRO_GANGWAY_HALF_WIDTH, METRO_HALF_WIDTH, LIFT_HALF,
  metroGroundAccess, metroPlatform, metroToLocal,
} from '../app/metro-system.ts';
import { METRO_ROUTE, routePose, sampleRoute, trackPoint } from '../app/metro-route.ts';

const dt = 1 / 60;
const riderAt = (x, z, heading = 0) => ({ ...createVehicle(), x, z, heading });
function rideStep(system, rider, vertical, input = EMPTY_INPUT) {
  const before = vertical.height;
  const move = system.beginStep(rider, vertical.height, dt);
  rider = move.rider;
  if (move.carrierHeight !== undefined) vertical = { ...vertical, height: move.carrierHeight };
  const limit = system.speedLimitAt(rider, vertical.height);
  if (move.locked) rider = { ...rider, speed: 0, throttle: 0 };
  else {
    rider = stepVehicle(rider, input, dt, system.obstaclesAt(rider, vertical.height), 0, 0, 1, Number.isFinite(limit) ? .40 : .95);
    rider.speed = Math.max(-limit, Math.min(limit, rider.speed));
  }
  rider = system.endStep(rider, vertical.height);
  const floor = system.surfaceAt(rider, vertical.height) ?? 0;
  vertical = system.carrier ? { ...vertical, height: floor, grounded: true, lastGroundHeight: floor, velocity: (floor - before) / dt } : stepVerticalVehicle(vertical, floor, dt);
  return [rider, vertical];
}
const inCabin = (train, point) => train.cars.some((car, index) => {
  const local = metroToLocal(car, point), centre = METRO_CAR_INTERIOR_CENTER * (index === 0 ? -1 : 1);
  return Math.abs(local.x - centre) <= METRO_CAR_INTERIOR_HALF + 1e-6 && Math.abs(local.z) <= METRO_HALF_WIDTH + 1e-6;
}) || (() => { const local = metroToLocal({ x: train.x, z: train.z, yaw: train.yaw }, point); return Math.abs(local.x) <= METRO_GANGWAY_HALF_LENGTH + .3 && Math.abs(local.z) <= METRO_GANGWAY_HALF_WIDTH + .3; })();

test('the line continues past 東河門戶 through a continuous U-turn into the city with six stations in travel order', () => {
  assert.equal(METRO_ALL_STATIONS.length, 6);
  const samples = sampleRoute(0, METRO_ROUTE.length, 1);
  for (let i = 1; i < samples.length; i++) {
    const step = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
    assert.ok(Math.abs(step - (samples[i].s - samples[i - 1].s)) < 1e-3, 'The centre line has no jumps');
    assert.ok(samples[i].dirX * samples[i - 1].dirX + samples[i].dirZ * samples[i - 1].dirZ > .99, 'Heading changes smoothly');
  }
  for (let i = 1; i < METRO_ALL_STATIONS.length; i++) assert.ok(METRO_ALL_STATIONS[i].s - METRO_ALL_STATIONS[i - 1].s > 400, 'Stations are spaced along the line in order');
  for (const [index, station] of METRO_ALL_STATIONS.entries()) {
    for (const probe of [-45, 0, 45]) assert.equal(routePose(station.s + probe).curvature, 0, `${station.id} berths a whole train on straight track`);
    for (const track of [0, 1]) {
      const point = trackPoint(station.s, track);
      assert.ok(Math.abs(point.x - station.x) < 1e-6 && Math.abs(point.z - station.trackZ[track]) < 1e-6);
      const platform = metroPlatform(index, track), side = station.sides[track];
      assert.ok((platform.z - station.trackZ[track]) * side > 0, 'Each platform lies on the outer side of its track');
    }
  }
  // Tracks keep their 11 m spacing all the way round; the right-hand turn keeps door sides.
  for (let s = 0; s <= METRO_ROUTE.length; s += 5) {
    const a = trackPoint(s, 0), b = trackPoint(s, 1);
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.z - b.z) - 11) < 1e-6);
  }
  const city = METRO_ALL_STATIONS.filter(station => station.city);
  assert.deepEqual(city.map(station => station.id), ['MB04', 'MB05', 'MB06']);
  for (const station of city) assert.deepEqual(station.sides, [-1, 1], 'Track 0 is the inner (north) track after the U-turn');
});

test('a scooter boards at 南港生活區, stays inside the cabin through the U-turn and alights at 南町生活街', () => {
  const system = new MetroSystem(), train = system.trains[0];
  let rider = riderAt(train.x + METRO_DOORS.filter(door => door.car === 1)[1].x, train.z + METRO_HALF_WIDTH + 1.3);
  let vertical = createVerticalVehicle(METRO_FLOOR);
  for (let i = 0; i < 65; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
  assert.equal(system.carrier?.kind, 'train');
  for (let i = 0; i < 50; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
  const last = METRO_ALL_STATIONS.length - 1, seen = new Set();
  let steps = 0, fastestInCurve = 0, minHeading = Infinity, maxHeading = -Infinity;
  while (!(train.station === last && train.phase === 'dwell') && steps++ < 60 * 900) {
    [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
    assert.equal(system.carrier?.kind, 'train', 'The rider never falls out of the train');
    assert.ok(inCabin(train, rider), `Rider left the cabin at s=${train.s.toFixed(1)}`);
    assert.equal(vertical.height, METRO_FLOOR);
    if (routePose(train.s).curvature !== 0) fastestInCurve = Math.max(fastestInCurve, Math.abs(train.speed));
    minHeading = Math.min(minHeading, rider.heading); maxHeading = Math.max(maxHeading, rider.heading);
    if (train.phase === 'dwell') seen.add(train.station);
  }
  assert.ok(steps < 60 * 900, 'The train reaches the city terminus');
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3, 4, 5]);
  assert.ok(fastestInCurve > 5 && fastestInCurve < 10.5, `Curve speed ${fastestInCurve}`);
  assert.ok(maxHeading - minHeading > Math.PI * .95, 'The rider turns with the train through the U-turn');
  // Exit onto the north platform of the city leg.
  const stop = METRO_ALL_STATIONS[last];
  assert.equal(stop.sides[0], -1);
  rider = { ...rider, heading: 0, speed: 0 };
  for (let i = 0; i < 135; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
  assert.equal(system.carrier, null);
  assert.equal(system.surfaceAt(rider, vertical.height), METRO_FLOOR);
  assert.ok(rider.z < stop.trackZ[0] - METRO_HALF_WIDTH - .2, 'The scooter is on the platform, outside the train');
});

test('every city-station lift lifts a scooter from its own street to the platform and back down to the street', () => {
  const city = METRO_ALL_STATIONS.map((station, index) => ({ station, index })).filter(entry => entry.station.city);
  for (const { index } of city) for (const track of [0, 1]) {
    const system = new MetroSystem(), lift = system.lifts[index * 2 + track];
    assert.equal(lift.upperDoor, -lift.lowerDoor, 'Platform and street doors are on opposite faces');
    // Street side: drive from the road edge into the cabin.
    const street = metroGroundAccess(lift)[0];
    const roadEnd = riderAt(lift.x, street.z + lift.lowerDoor * (street.halfDepth - .3));
    assert.equal(system.surfaceAt(roadEnd, lift.lower), lift.lower, 'The street driveway is level with the lift floor out to the road');
    let rider = riderAt(lift.x, lift.z + lift.lowerDoor * 4.1, lift.lowerDoor > 0 ? 0 : Math.PI), vertical = createVerticalVehicle(lift.lower);
    for (let i = 0; i < 80; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
    for (let i = 0; i < 45; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
    assert.equal(system.carrier?.kind, 'lift', `${METRO_ALL_STATIONS[index].id} lift ${track} reachable from the street`);
    assert.match(system.operate(rider, vertical.height), /上行/);
    while (lift.phase !== 'idle') [rider, vertical] = rideStep(system, rider, vertical);
    assert.equal(lift.height, METRO_FLOOR);
    rider = { ...rider, heading: lift.upperDoor > 0 ? Math.PI : 0, speed: 0 };
    for (let i = 0; i < 140; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
    assert.equal(system.carrier, null);
    assert.equal(system.surfaceAt(rider, vertical.height), METRO_FLOOR, 'Exit onto the platform');
    assert.ok(Math.abs(rider.z - metroPlatform(index, track).z) < 8);
    // And back down.
    rider = { ...rider, heading: lift.upperDoor > 0 ? 0 : Math.PI, speed: 0 };
    for (let i = 0; i < 140; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
    for (let i = 0; i < 45; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
    assert.equal(system.carrier?.kind, 'lift');
    assert.match(system.operate(rider, vertical.height), /下行/);
    while (lift.phase !== 'idle') [rider, vertical] = rideStep(system, rider, vertical);
    rider = { ...rider, heading: lift.lowerDoor > 0 ? Math.PI : 0, speed: 0 };
    for (let i = 0; i < 140; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
    assert.equal(system.carrier, null);
    assert.ok((rider.z - lift.z) * lift.lowerDoor > LIFT_HALF + 1, 'Back out on the street side');
  }
});

test('piers carry the whole extension, avoid the river and stay off every lift approach', () => {
  const system = new MetroSystem();
  const extension = system.piers.filter(pier => pier.x > 1050 || pier.z > -800);
  assert.ok(extension.length > 40, 'The U-turn and city leg stand on piers');
  for (const pier of extension) {
    assert.ok(!(pier.z > -600 && pier.x > 590 && pier.x < 658), 'No pier in the river');
    for (const lift of system.lifts) for (const area of metroGroundAccess(lift))
      assert.ok(Math.abs(area.x - pier.x) >= area.halfWidth + pier.radius || Math.abs(area.z - pier.z) >= area.halfDepth + pier.radius);
  }
  // Supports at most ~60 m apart along the viaduct away from station decks.
  const along = extension.filter(pier => pier.kind === 'deck').map(pier => pier.x > 1100 || pier.z < -600 ? pier : pier).length;
  assert.ok(along > 30);
});
