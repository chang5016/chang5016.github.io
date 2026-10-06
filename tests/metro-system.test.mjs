import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVehicle, EMPTY_INPUT, intersectsBuilding, stepVehicle } from '../app/game-core.ts';
import { createVerticalVehicle, stepVerticalVehicle } from '../app/vehicle-vertical-physics.ts';
import { SimulationClock, interpolate } from '../app/simulation-clock.ts';
import { MetroSystem, LIFT_HALF, METRO_DOORS, METRO_CAR_OFFSETS, METRO_FLOOR, METRO_HALF_WIDTH, METRO_STATIONS, METRO_TRACKS, metroGroundAccess, metroConcourse, metroPlatform } from '../app/metro-system.ts';
import { MetroScene } from '../app/metro-scene.ts';
import { createHeadlessDocument } from './headless-document.mjs';
import { withDownloadedMetroFiles } from './downloaded-metro-loader.mjs';

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

test('two independent metro tracks complete repeated journeys, reverse at terminals and never move with an open door', () => {
  const system = new MetroSystem();
  const player = riderAt(0, 0), visited = system.trains.map(() => new Set());
  const lastSpeed = [0, 0];
  for (let step = 0; step < 60 * 700; step++) {
    system.beginStep(player, 0, dt);
    for (const train of system.trains) {
      assert.ok(train.x >= METRO_STATIONS[0].x - .001 && train.x <= METRO_STATIONS[2].x + .001);
      assert.ok(Number.isFinite(train.speed));
      assert.ok(Math.abs(train.speed) <= 27.001);
      assert.ok(Math.abs(train.speed - lastSpeed[train.id]) / dt < 1.5, 'Bounded, continuous departure/braking acceleration');
      if (train.phase === 'running') assert.equal(train.door, 0);
      else { assert.equal(train.x, METRO_STATIONS[train.station].x); assert.equal(train.speed, 0); visited[train.id].add(train.station); }
      lastSpeed[train.id] = train.speed;
    }
  }
  for (const set of visited) assert.deepEqual([...set].sort(), [0, 1, 2]);
  assert.ok(system.trains.every(train => train.trips >= 8));
});

test('scooter physically rides across a level platform door, stays on the moving train and exits at the next station', () => {
  const system = new MetroSystem(), train = system.trains[0];
  let rider = riderAt(train.x + METRO_DOORS.filter(door => door.car === 1)[1].x, train.z + METRO_HALF_WIDTH + 1.3);
  let vertical = createVerticalVehicle(METRO_FLOOR);
  const forward = { ...EMPTY_INPUT, forward: true };
  for (let i = 0; i < 65; i++) [rider, vertical] = rideStep(system, rider, vertical, forward);
  assert.equal(system.carrier?.kind, 'train');
  assert.equal(system.carrier?.car, 1);
  assert.equal(system.boardings, 1);
  for (let i = 0; i < 50; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
  const localX = rider.x - train.x;
  let steps = 0;
  while (!(train.station === 1 && train.phase === 'dwell') && steps++ < 6000) {
    [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
    assert.ok(Math.abs(rider.x - train.x - localX) < 1e-8, 'The scooter must not drift relative to the train');
    assert.equal(vertical.height, METRO_FLOOR);
    assert.equal(vertical.grounded, true);
  }
  assert.ok(steps < 6000, 'Doors must depart once the entire bike is inside');
  assert.equal(train.x, METRO_STATIONS[1].x);
  rider = { ...rider, heading: Math.PI, speed: 0 };
  for (let i = 0; i < 135; i++) [rider, vertical] = rideStep(system, rider, vertical, forward);
  assert.equal(system.carrier, null);
  assert.equal(system.surfaceAt(rider, vertical.height), METRO_FLOOR);
  assert.equal(vertical.grounded, true);
  assert.ok(rider.z > train.z + METRO_HALF_WIDTH + .2);
});

test('doors sense the actual scooter length, hold a blocked platform and reopen during closing', () => {
  const system = new MetroSystem(), train = system.trains[0];
  const rider = riderAt(train.x + METRO_CAR_OFFSETS[0], train.z + METRO_HALF_WIDTH + .8);
  train.phase = 'closing'; train.elapsed = .5; train.door = .65;
  for (let i = 0; i < 2000; i++) system.beginStep(rider, METRO_FLOOR, dt);
  assert.equal(train.x, METRO_STATIONS[0].x);
  assert.equal(train.door, 1);
  assert.equal(train.blocked, true);
  assert.equal(train.phase, 'dwell');
  for (let i = 0; i < 110; i++) system.beginStep(riderAt(0, 0), 0, dt);
  assert.equal(train.phase, 'running');
  assert.equal(train.door, 0);
});

test('a road vehicle below the station never boards, snaps upward or obstructs a departing train', () => {
  const system = new MetroSystem(), train = system.trains[0];
  let rider = riderAt(train.x + METRO_CAR_OFFSETS[0], train.z + METRO_HALF_WIDTH);
  rider = system.endStep(rider, 0);
  assert.equal(system.carrier, null);
  assert.equal(system.surfaceAt(rider, 0), undefined);
  assert.equal(system.obstaclesAt(rider, 0).some(wall => Math.abs(wall.z - rider.z) < .01 && Math.abs(wall.x - rider.x) < 3), false);
  for (let i = 0; i < 60 * 27; i++) system.beginStep(rider, 0, dt);
  assert.equal(train.phase, 'running');
});

test('each of six scooter lifts carries the whole bike continuously between street and platform, then permits physical exit', () => {
  for (let id = 0; id < 6; id++) {
    const system = new MetroSystem(), lift = system.lifts[id];
    let rider = riderAt(lift.x, lift.z), vertical = createVerticalVehicle(lift.lower);
    rider = system.endStep(rider, vertical.height);
    assert.match(system.operate(rider, vertical.height), /上行/);
    let priorHeight = vertical.height;
    for (let step = 0; step < 60 * 13; step++) {
      [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
      // While moving the throttle cannot send the bike through a shaft or floor.
      if (lift.phase !== 'idle') { assert.equal(rider.speed, 0); assert.equal(rider.x, lift.x); assert.equal(rider.z, lift.z); }
      assert.ok(Math.abs(vertical.height - priorHeight) < .1);
      priorHeight = vertical.height;
      if (lift.phase === 'idle' && lift.height > 10) break;
    }
    assert.equal(lift.height, METRO_FLOOR);
    assert.equal(lift.phase, 'idle');
    assert.equal(vertical.grounded, true);
    rider = { ...rider, heading: lift.track === 0 ? 0 : Math.PI, speed: 0 };
    for (let i = 0; i < 140; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
    assert.equal(system.carrier, null, `Lift ${id} exit must reach the platform`);
    assert.equal(system.surfaceAt(rider, vertical.height), METRO_FLOOR);
  }
});

test('an empty elevator can be called from either floor; landing doors remain shut while the cabin is away', () => {
  const system = new MetroSystem(), lift = system.lifts[0];
  const outsideTop = riderAt(lift.x, lift.z - 4.1);
  assert.match(system.operate(outsideTop, METRO_FLOOR), /上行/);
  assert.equal(system.carrier, null);
  assert.ok(intersectsBuilding(riderAt(lift.x, lift.z - 2.7), system.obstaclesAt(outsideTop, METRO_FLOOR)));
  for (let i = 0; i < 60 * 12; i++) system.beginStep(outsideTop, METRO_FLOOR, dt);
  assert.equal(lift.height, METRO_FLOOR);
  assert.equal(lift.phase, 'idle');
  assert.equal(intersectsBuilding(riderAt(lift.x, lift.z - 2.7), system.obstaclesAt(outsideTop, METRO_FLOOR)), false);
  assert.match(system.operate(riderAt(lift.x, lift.z + 4.1), lift.lower), /下行/);
  for (let i = 0; i < 60 * 3; i++) system.beginStep(riderAt(lift.x, lift.z + 4.1), lift.lower, dt);
  assert.equal(system.surfaceAt(riderAt(lift.x, lift.z), METRO_FLOOR), undefined, 'A stationary landing must not cover the inside of the empty shaft');
});

test('lift interlocks reject moving bikes and bikes still crossing the door, and stationary shaft walls are solid', () => {
  const system = new MetroSystem(), lift = system.lifts[0];
  assert.match(system.operate({ ...riderAt(lift.x, lift.z), speed: 1 }, lift.lower), /停穩/);
  assert.match(system.operate(riderAt(lift.x, lift.z + LIFT_HALF - .3), lift.lower), /整台/);
  assert.equal(lift.phase, 'idle');
  assert.ok(intersectsBuilding(riderAt(lift.x + LIFT_HALF - .05, lift.z), system.obstaclesAt(lift, lift.lower)));
});

test('road approaches connect without passing through the other elevator or pier; platform and car floors meet without a height step', () => {
  const system = new MetroSystem();
  for (const lift of system.lifts) {
    const pieces = metroGroundAccess(lift), other = system.lifts[lift.id ^ 1];
    for (const area of pieces) {
      const hall=metroConcourse(lift.station);
      if(area.x===hall.x&&area.z===hall.z) {
        assert.ok(Math.abs(lift.x-hall.x)+LIFT_HALF<hall.halfWidth&&Math.abs(other.z-hall.z)+LIFT_HALF<hall.halfDepth,'The enlarged hall intentionally contains both lift towers');
        continue;
      }
      assert.ok(Math.abs(area.x - other.x) >= area.halfWidth + LIFT_HALF || Math.abs(area.z - other.z) >= area.halfDepth + LIFT_HALF, 'An approach must go around the other shaft');
      for (const pier of system.piers) assert.ok(Math.abs(area.x - pier.x) >= area.halfWidth + pier.radius || Math.abs(area.z - pier.z) >= area.halfDepth + pier.radius, 'Keep piers outside the approach pavement');
    }
    const platform = metroPlatform(lift.station, lift.track);
    assert.equal(system.surfaceAt(platform, METRO_FLOOR), METRO_FLOOR);
    assert.equal(system.surfaceAt({ x: lift.x, z: (platform.z + lift.z) / 2 }, METRO_FLOOR), METRO_FLOOR);
  }
  const train = system.trains[0];
  for (let z = train.z + 1; z < train.z + 5; z += .01) assert.equal(system.surfaceAt({ x: train.x + METRO_DOORS[0].x, z }, METRO_FLOOR), METRO_FLOOR);
});

test('metro simulation and riding interpolation give identical motion at 30, 60 and 144 rendered frames per second', () => {
  const samples = [30, 60, 144].map(fps => {
    const system = new MetroSystem(), clock = new SimulationClock();
    let rider = riderAt(METRO_STATIONS[0].x + METRO_CAR_OFFSETS[0], METRO_TRACKS[0].z), prior = rider;
    system.endStep(rider, METRO_FLOOR);
    for (let frame = 0; frame < fps * 70; frame++) clock.advance(1 / fps, seconds => {
      prior = rider;
      rider = system.beginStep(rider, METRO_FLOOR, seconds).rider;
      rider = system.endStep(rider, METRO_FLOOR);
    });
    return { rider, train: system.trains[0], localX: interpolate(prior.x, rider.x, .43) - interpolate(system.trains[0].previousX, system.trains[0].x, .43) };
  });
  for (const sample of samples) {
    assert.ok(Math.abs(sample.rider.x - samples[0].rider.x) < 1e-7);
    assert.ok(Math.abs(sample.train.x - samples[0].train.x) < 1e-7);
    assert.ok(Math.abs(sample.localX - METRO_CAR_OFFSETS[0]) < 1e-8);
  }
});

test('next-station information, pause/reset, platform gates and the mission transfer state remain correct after a train reverses', () => {
  const system = new MetroSystem(), train = system.trains[0];
  assert.equal(system.platformDestination(train, 1), METRO_STATIONS[2].name);
  assert.equal(system.platformDestination(train, 2), METRO_STATIONS[1].name);
  const ground = riderAt(system.lifts[0].x, system.lifts[0].z + 6);
  assert.equal(system.hud(ground, 0).timerPaused, false);
  assert.equal(system.hud(metroPlatform(0, 0), METRO_FLOOR).timerPaused, true);
  for (let i = 0; i < 60 * 38; i++) system.beginStep(riderAt(0, 0), 0, dt);
  const x = train.x, seconds = system.seconds;
  system.resetInterpolation();
  assert.equal(system.seconds, seconds); assert.equal(train.x, x); assert.equal(train.previousX, x);
  assert.ok(intersectsBuilding(riderAt(METRO_STATIONS[0].x + METRO_CAR_OFFSETS[0], METRO_TRACKS[0].z + METRO_HALF_WIDTH + .05), system.obstaclesAt(metroPlatform(0, 0), METRO_FLOOR)), 'The platform gate closes once its train leaves');
  while (!(train.station === 2 && train.phase === 'dwell')) system.beginStep(riderAt(0, 0), 0, dt);
  assert.equal(train.direction, -1);
  assert.equal(system.platformDestination(train, 1), METRO_STATIONS[0].name);
});

test('a scooter can enter a lift from the real doorway, reach the platform, call a returning lift and ride back to the street', () => {
  const system = new MetroSystem(), lift = system.lifts[0];
  let rider = riderAt(lift.x, lift.z + 4.1), vertical = createVerticalVehicle(lift.lower);
  for (let i = 0; i < 80; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
  for (let i = 0; i < 45; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
  assert.equal(system.carrier?.kind, 'lift');
  assert.equal(system.whollyInLift(lift, rider), true);
  assert.match(system.operate(rider, vertical.height), /上行/);
  while (lift.phase !== 'idle') [rider, vertical] = rideStep(system, rider, vertical);
  for (let i = 0; i < 140; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
  for (let i = 0; i < 45; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
  assert.equal(system.carrier, null);
  assert.equal(vertical.height, METRO_FLOOR);
  rider = { ...rider, heading: Math.PI, speed: 0 };
  for (let i = 0; i < 140; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
  for (let i = 0; i < 40; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, brake: true });
  assert.equal(system.whollyInLift(lift, rider), true);
  assert.match(system.operate(rider, vertical.height), /下行/);
  while (lift.phase !== 'idle') [rider, vertical] = rideStep(system, rider, vertical);
  for (let i = 0; i < 140; i++) [rider, vertical] = rideStep(system, rider, vertical, { ...EMPTY_INPUT, forward: true });
  assert.equal(system.carrier, null);
  assert.ok(vertical.height < .15);
  assert.ok(rider.z > lift.z + 3);
});

test('downloaded station and vehicle geometry remains finite, camera stays inside the cabin, and resources clean up', async () => withDownloadedMetroFiles(async () => {
  const system = new MetroSystem(), scene = new THREE.Scene(), metro = new MetroScene(scene, system, () => 0);
  await metro.ready;
  let meshes = 0, triangles = 0;
  scene.traverse(object => {
    if (!object.isMesh) return;
    meshes++; const positions = object.geometry.getAttribute('position');
    assert.ok(Array.from(positions.array).every(Number.isFinite));
    triangles += (object.geometry.index?.count ?? positions.count) / 3 * (object.isInstancedMesh ? object.count : 1);
  });
  assert.ok(meshes < 400, 'Common moving parts share native instances');
  assert.ok(triangles < 650000, 'Complete source detail stays bounded across all stations and vehicles');
  assert.equal(metro.root.userData.downloadedGeometryAudit.generatedVisiblePrimitives, 0);
  const train = system.trains[0], rider = riderAt(train.x + METRO_CAR_OFFSETS[0], train.z);
  system.endStep(rider, METRO_FLOOR);
  const camera = new THREE.Vector3(rider.x, 80, rider.z + 20);
  metro.constrainCamera(camera, rider, METRO_FLOOR, 1);
  assert.ok(camera.y < METRO_FLOOR + 4.4);
  assert.ok(Math.abs(camera.z - train.z) < METRO_HALF_WIDTH);
  assert.ok(Math.hypot(camera.x - rider.x, camera.z - rider.z) > 3);
  for (let i = 0; i < 2000; i++) system.beginStep(riderAt(0, 0), 0, dt);
  metro.render(.5);
  assert.equal(metro.trains[0].group.position.x, interpolate(train.previousX, train.x, .5));
  metro.dispose(); assert.equal(scene.children.length, 0);
}));
