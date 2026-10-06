import assert from "node:assert/strict";
import test from "node:test";
import { readModelGeometry, readModelHierarchy } from "./model-fixture.mjs";
import { BUILDING_MODELS } from "../app/stock-buildings.ts";
import { createHeadlessDocument } from "./headless-document.mjs";
import * as THREE from "three";
import {
  EMPTY_INPUT,
  DISTRICT_ORIGIN,
  REAL_MAP_ZOOM,
  TAICHUNG_LOCATIONS,
  coordinatesFromLocation,
  createVehicle,
  damp,
  distanceBetween,
  intersectsBuilding,
  locationFromCoordinates,
  locationFromTile,
  resolveVehiclePenetration,
  stepVehicle,
  tileFromLocation,
  tripFare,
} from "../app/game-core.ts";
import { createCharacterMotion, stepCharacterMotion } from "../app/character-animation.ts";
import { createPassengerAvatar, disposePassengerAvatar, stepTurboCharge } from "../app/driving-effects.ts";
import { decodeTerrariumElevation, fallbackTerrainElevation, MOUNTAIN_ROAD_POINTS, MOUNTAIN_VALLEY_POINTS, terrainGradeAt, trafficLightColor, TRAFFIC_CYCLE_SECONDS } from "../app/world-terrain.ts";
import { authoredExpresswayPlan, EXPRESSWAY_RING_HEIGHT, EXPRESSWAY_RING_POINTS, outlineOverlapsRoadCorridor, outlineOverlapsElevatedRoad, RealWorldMap } from "../app/real-world-map.ts";
import { createVerticalVehicle, stepVerticalVehicle } from "../app/vehicle-vertical-physics.ts";
import { stepPerformanceProfile } from "../app/performance-control.ts";
import { GridForgeCityGrid } from "../app/gridforge-city-grid.ts";
import { SHOPPING_STREET, shoppingStreetPlacement, shoppingStreetPoint, shoppingTerrainElevation, insideShoppingStreet, createShoppingStreetInstances } from "../app/shopping-street.ts";

const advance = (initial, input, seconds, buildings = []) => {
  let state = initial;
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) state = stepVehicle(state, input, 1 / 60, buildings);
  return state;
};

const mapCoordinate = (x, z) => {
  const location = locationFromCoordinates({ x, z });
  return [location.longitude, location.latitude];
};

const polygonFeature = (left, back, right, front, properties = {}) => ({
  properties,
  geometry: {
    type: "Polygon",
    coordinates: [[
      mapCoordinate(left, back),
      mapCoordinate(right, back),
      mapCoordinate(right, front),
      mapCoordinate(left, front),
      mapCoordinate(left, back),
    ]],
  },
});

const createHeadlessWorld = () => {
  const map = Object.create(RealWorldMap.prototype);
  Object.assign(map, {
    group: new THREE.Group(),
    textures: {
      ground: new THREE.Texture(),
      asphalt: new THREE.Texture(),
      asphaltNormal: new THREE.Texture(),
      asphaltRoughness: new THREE.Texture(),
      paving: new THREE.Texture(),
      pavingNormal: new THREE.Texture(),
      pavingRoughness: new THREE.Texture(),
      roof: new THREE.Texture(),
      waterNormal: new THREE.Texture(),
      facades: [new THREE.Texture()],
    },
    disposableMaterials: [],
    disposableTextures: [],
    facadeMaterials: [],
    streetSegments: [],
    roadJunctions: [],
    parkParcels: [],
    schoolCampuses: [],
    elevatedSegments: [],
    elevatedJunctions: [],
    bridgePierColliders: [],
    elevatedSegmentGrid: new GridForgeCityGrid(64),
    bridgePierGrid: new GridForgeCityGrid(64),
    riverSurfaces: [],
    waterChannels: [],
    trafficIntersections: [],
    trafficRoutes: [],
    trafficVehicles: [],
    signalMaterials: null,
    buildings: [],
    spawnPoint: null,
    maxAnisotropy: 1,
  });
  return map;
};

const disposeHeadlessWorld = (map) => {
  map.group.traverse((object) => { if (object.isMesh) object.geometry.dispose(); });
  map.disposableMaterials.forEach((material) => material.dispose());
  map.disposableTextures.forEach((texture) => texture.dispose());
};

test("complete shopping rows face one another without stretching, overlap or floating", () => {
  const datum = fallbackTerrainElevation(SHOPPING_STREET.center);
  for (const side of [-1, 1]) {
    const placement = shoppingStreetPlacement(side);
    assert.ok(Math.abs(placement.yOffset + SHOPPING_STREET.roadDatum * SHOPPING_STREET.scale - 0.082) < 1e-10);
    const roadEdge = shoppingStreetPoint(SHOPPING_STREET.sourceMinX, 0, side);
    assert.ok(Math.abs(roadEdge.z - (540 + side * 0.4)) < 1e-8);
    const front = shoppingStreetPoint(-178.8, 0, side);
    const back = shoppingStreetPoint(650, 0, side);
    assert.ok(side * (back.z - front.z) > 0, "Both facades must face the street, not outward");
    for (const x of [-1243.24267578125, 991.7315063476562]) for (const z of [-2408.462158203125, 2284.17822265625]) {
      const point = shoppingStreetPoint(x, z, side);
      assert.ok(insideShoppingStreet(point));
      assert.equal(shoppingTerrainElevation(point, fallbackTerrainElevation(point), datum), datum);
    }
  }
});

test("opposing shop rows reuse intact geometry in GPU instances instead of doubling draw calls", () => {
  const template = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 30), new THREE.MeshStandardMaterial());
  mesh.position.set(18, 25, 90);
  template.add(mesh);
  const result = createShoppingStreetInstances(template, 2.5);
  assert.equal(result.children.length, 1);
  const pair = result.children[0];
  assert.equal(pair.count, 2);
  assert.equal(pair.geometry, mesh.geometry);
  assert.equal(pair.material, mesh.material);
  assert.equal(pair.castShadow, false);
  assert.equal(result.position.y, 2.5);
  for (const [index, side] of [-1, 1].entries()) {
    const matrix = new THREE.Matrix4();
    pair.getMatrixAt(index, matrix);
    const point = new THREE.Vector3().applyMatrix4(matrix);
    const expected = shoppingStreetPoint(18, 90, side);
    assert.ok(Math.abs(point.x - expected.x) < 0.0001);
    assert.ok(Math.abs(point.z - expected.z) < 0.0001);
    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    assert.ok(Math.abs(scale.x - .02) < 1e-8 && Math.abs(scale.y - .02) < 1e-8 && Math.abs(scale.z - .02) < 1e-8);
  }
  mesh.geometry.dispose(); mesh.material.dispose();
});

test("shopping-street terrain, paved entrances and open road remain driveable", () => {
  const map = createHeadlessWorld();
  map.renderShoppingStreetGround();
  assert.equal(map.buildings.length, 2);
  assert.ok(map.group.getObjectByName("Continuous shopping boulevard and side-street aprons"));
  assert.ok(map.group.getObjectByName("Level continuous shopping-street plaza foundation"));
  for (let x = -480; x <= -365; x += 0.25) {
    for (const z of [536, 540, 544]) {
      const point = { x, z };
      assert.ok(!intersectsBuilding(point, map.buildings, 0.6), "No shop collider across the carriageway");
      const difference = Math.abs(map.elevationAt(point) - map.elevationAt({ x: x + 0.25, z }));
      assert.ok(difference < 0.08, `Abrupt entrance step at ${x},${z}`);
    }
  }
  disposeHeadlessWorld(map);
});

test("rendered shopping asphalt never rises through the source roadway and covers both full-width exits", () => {
  const map = createHeadlessWorld();
  map.renderShoppingStreetGround();
  map.group.updateMatrixWorld(true);
  const road = map.group.getObjectByName("Continuous shopping boulevard and side-street aprons");
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  let samples = 0;
  for (let x = -479.75; x <= -365.25; x += 2.5) {
    for (let z = 521.7; z <= 558.3; z += 2) {
      ray.set(new THREE.Vector3(x, 100, z), down);
      const hit = ray.intersectObject(road)[0];
      assert.ok(hit, `Missing actual rendered road at ${x},${z}`);
      const height = hit.point.y - map.elevationAt({ x, z });
      assert.ok(Math.abs(height - .044) < 0.00001, `Asphalt tilts through source road at ${x},${z}: ${height}`);
      assert.ok(height < .082 - .02, "Keep an explicit depth separation below the supplied asphalt");
      samples++;
    }
  }
  assert.ok(samples > 800);
  disposeHeadlessWorld(map);
});

test("the complete paved block reaches the surrounding road edges with no exposed grass strip", () => {
  const map = createHeadlessWorld();
  map.renderShoppingStreetGround();
  map.group.updateMatrixWorld(true);
  const pad = map.group.getObjectByName("Level continuous shopping-street plaza foundation");
  const ray = new THREE.Raycaster();
  for (const x of [-476.48, -469, -422, -376, -367.37]) {
    for (const z of [463.52, 480, 495, 520, 540, 570, 600, 613.38]) {
      ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(pad)[0];
      assert.ok(hit, `Paving does not reach the neighboring road at ${x},${z}`);
      assert.ok(Math.abs(hit.point.y - map.elevationAt({ x, z }) - .012) < 0.00001);
    }
  }
  // The original background is a 52 m terrain grid. Its interpolation must also
  // stay below the slab, not just the analytical vehicle-height function.
  const coarse = new THREE.PlaneGeometry(5000, 5000, 96, 96);
  coarse.rotateX(-Math.PI / 2);
  const p = coarse.getAttribute("position");
  for (let i = 0; i < p.count; i++) p.setY(i, map.elevationAt({ x: p.getX(i), z: p.getZ(i) }) - .11);
  const terrain = new THREE.Mesh(coarse, new THREE.MeshBasicMaterial());
  terrain.updateMatrixWorld(true);
  for (let x = -476; x < -367; x += 8) for (let z = 464; z < 613; z += 8) {
    ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(terrain)[0];
    assert.ok(hit && hit.point.y < map.elevationAt({ x, z }) - .09, `Coarse terrain protrudes through paving at ${x},${z}`);
  }
  coarse.dispose(); terrain.material.dispose();
  disposeHeadlessWorld(map);
});

test("supplied asphalt shares the connecting-road material without altering any model triangle", () => {
  const template = new THREE.Group();
  const original = new THREE.MeshStandardMaterial({ name: "Blacktop_New_1" });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 20), original);
  template.add(mesh);
  const material = new THREE.MeshStandardMaterial({ color: "#848586" });
  const before = [...mesh.geometry.attributes.position.array];
  const result = createShoppingStreetInstances(template, 0, material);
  const pair = result.children[0];
  assert.equal(pair.material, material);
  assert.notEqual(pair.geometry, mesh.geometry, "UV edits must not mutate the original asset");
  assert.deepEqual([...pair.geometry.attributes.position.array], before);
  assert.deepEqual([...pair.geometry.index.array], [...mesh.geometry.index.array]);
  assert.equal(pair.count, 2);
  pair.geometry.dispose(); mesh.geometry.dispose(); original.dispose(); material.dispose();
});

test("initialization creates a ready, stationary, finite vehicle", () => {
  const vehicle = createVehicle();
  assert.equal(vehicle.speed, 0);
  assert.equal(vehicle.x, 0);
  assert.equal(vehicle.z, 0);
  assert.ok(Object.values(vehicle).every((value) => typeof value === "boolean" || Number.isFinite(value)));
});

test("GridForge city cells return deterministic, deduplicated bounded queries", () => {
  const grid = new GridForgeCityGrid(16);
  const bridge = { id: "bridge" };
  const tower = { id: "tower" };
  grid.insert(bridge, { minX: -2, minZ: -2, maxX: 34, maxZ: 3 });
  grid.insert(tower, { minX: 40, minZ: 40, maxX: 43, maxZ: 43 });
  assert.deepEqual(grid.queryAround({ x: 15, z: 0 }, 20), [bridge]);
  assert.deepEqual(grid.queryAround({ x: 42, z: 42 }, 1), [tower]);
  assert.equal(grid.occupiedCellCount, 9);
});

test("leaving a raised deck produces a real ballistic arc instead of snapping to the ground", () => {
  let vertical = createVerticalVehicle(5.7);
  vertical = stepVerticalVehicle(vertical, 0, 1 / 60);
  assert.equal(vertical.grounded, false);
  assert.ok(vertical.height > 5.6, "The scooter must retain altitude on the first airborne frame");
  for (let frame = 0; frame < 24; frame++) vertical = stepVerticalVehicle(vertical, 0, 1 / 60);
  assert.ok(vertical.height > 3.5, "Gravity should create an arc rather than an instant ground snap");
  let maximumImpact = 0;
  for (let frame = 0; frame < 90; frame++) {
    vertical = stepVerticalVehicle(vertical, 0, 1 / 60);
    maximumImpact = Math.max(maximumImpact, vertical.impact);
  }
  assert.equal(vertical.grounded, true);
  assert.equal(vertical.height, 0);
  assert.ok(maximumImpact > 0.05, "Landing must feed an impact impulse into suspension and sound");
});

test("forward input accelerates and moves through the world", () => {
  const state = advance(createVehicle(), { ...EMPTY_INPUT, forward: true }, 2);
  assert.ok(state.speed > 12);
  assert.ok(state.z < -10);
});

test("riding reaches highway-paced scooter speed and turbo increases the real speed cap", () => {
  const input = { ...EMPTY_INPUT, forward: true };
  const cruising = advance(createVehicle(), input, 10);
  let turbo = createVehicle();
  for (let frame = 0; frame < 600; frame++) turbo = stepVehicle({ ...turbo, boost: 1 }, input, 1 / 60);
  assert.ok(cruising.speed >= 27.5, `Cruising should exceed 99 km/h, not ${cruising.speed * 3.6}`);
  assert.ok(turbo.speed >= 37, `Turbo should exceed 133 km/h, not ${turbo.speed * 3.6}`);
  assert.ok(turbo.speed > cruising.speed + 8);
});

test("releasing the throttle slows the scooter smoothly", () => {
  const moving = advance(createVehicle(), { ...EMPTY_INPUT, forward: true }, 1.4);
  const coasting = advance(moving, EMPTY_INPUT, 1.2);
  assert.ok(coasting.speed < moving.speed);
  assert.ok(coasting.speed >= 0);
});

test("braking reduces speed significantly", () => {
  const moving = advance(createVehicle(), { ...EMPTY_INPUT, forward: true }, 1.4);
  const braking = advance(moving, { ...EMPTY_INPUT, brake: true }, 0.65);
  assert.ok(braking.speed < moving.speed * 0.5);
});

test("reverse speed stays within its safe cap", () => {
  const state = advance(createVehicle(), { ...EMPTY_INPUT, reverse: true }, 4);
  assert.ok(state.speed < 0);
  assert.ok(state.speed >= -6.8);
});

test("pressing left really moves the scooter left and pressing right moves it right", () => {
  const left = advance(createVehicle(), { ...EMPTY_INPUT, forward: true, left: true }, 1.5);
  const right = advance(createVehicle(), { ...EMPTY_INPUT, forward: true, right: true }, 1.5);
  assert.ok(left.x < -3, `Left control incorrectly ended at x=${left.x}`);
  assert.ok(right.x > 3, `Right control incorrectly ended at x=${right.x}`);
  assert.ok(left.heading < 0);
  assert.ok(right.heading > 0);
  assert.ok(left.lean > 0);
  assert.ok(right.lean < 0);
});

test("simultaneous left and right input cancels out", () => {
  const state = advance(createVehicle(), { ...EMPTY_INPUT, forward: true, left: true, right: true }, 1.5);
  assert.ok(Math.abs(state.heading) < 0.0001);
  assert.ok(Math.abs(state.x) < 0.0001);
});

test("turning the handlebars while stopped does not spin the scooter in place", () => {
  const state = advance(createVehicle(), { ...EMPTY_INPUT, left: true }, 2);
  assert.equal(state.heading, 0);
  assert.equal(state.x, 0);
  assert.equal(state.z, 0);
});

test("holding the brake stops the scooter without sending it into reverse", () => {
  const moving = advance(createVehicle(), { ...EMPTY_INPUT, forward: true }, 1.8);
  const stopped = advance(moving, { ...EMPTY_INPUT, brake: true }, 2);
  assert.equal(stopped.speed, 0);
  assert.ok(stopped.z <= moving.z);
});

test("accelerator and reverse pressed together do not produce conflicting motion", () => {
  const state = advance(createVehicle(), { ...EMPTY_INPUT, forward: true, reverse: true }, 1.5);
  assert.equal(state.speed, 0);
  assert.equal(state.z, 0);
});

test("drifting charges a recoverable boost", () => {
  const moving = advance(createVehicle(), { ...EMPTY_INPUT, forward: true }, 1);
  const drifting = advance(moving, { ...EMPTY_INPUT, forward: true, left: true, drift: true }, 1.3);
  assert.ok(drifting.driftCharge > 0.5);
});

test("collision detection recognizes actual district building bounds", () => {
  const building = { x: 0, z: -8, halfWidth: 4, halfDepth: 2 };
  assert.equal(intersectsBuilding({ x: 0, z: -7 }, [building]), true);
  assert.equal(intersectsBuilding({ x: 20, z: 20 }, [building]), false);
  const state = advance(createVehicle(), { ...EMPTY_INPUT, forward: true }, 1.1, [building]);
  assert.ok(state.z > -7);
});

test("real building collision respects the actual footprint rather than its bounding rectangle", () => {
  const outline = [
    { x: 0, z: 0 },
    { x: 6, z: 0 },
    { x: 6, z: 2 },
    { x: 2, z: 2 },
    { x: 2, z: 6 },
    { x: 0, z: 6 },
    { x: 0, z: 0 },
  ];
  const building = { x: 3, z: 3, halfWidth: 3, halfDepth: 3, outline };
  assert.equal(intersectsBuilding({ x: 4.5, z: 4.5 }, [building], 0.25), false);
  assert.equal(intersectsBuilding({ x: 1, z: 4.5 }, [building], 0.25), true);
  assert.equal(intersectsBuilding({ x: 4.5, z: 1 }, [building], 0.25), true);
});

test("a frontal building impact stops instead of bouncing the scooter backwards", () => {
  const wall = { x: 0, z: -6, halfWidth: 8, halfDepth: 0.7 };
  const state = advance(createVehicle(), { ...EMPTY_INPUT, forward: true }, 1.4, [wall]);
  assert.ok(state.z > -6);
  assert.ok(state.speed >= 0, `Collision incorrectly reversed the vehicle to ${state.speed}`);
});

test("a high-speed impact cannot tunnel into or remain stuck inside another vehicle", () => {
  const traffic = { x: 0, z: -1.5, halfWidth: 1.05, halfDepth: 1.95 };
  let state = { ...createVehicle(), z: 2, speed: 38 };
  state = stepVehicle(state, { ...EMPTY_INPUT, forward: true }, 0.04, [traffic], 4);
  assert.equal(intersectsBuilding(state, [traffic]), false, "Swept collision must stop before the traffic body");
  assert.equal(state.collided, true);
  assert.ok(Math.abs(state.speed) < 5, `Impact speed remained ${state.speed.toFixed(2)} m/s`);

  const overlapped = resolveVehiclePenetration({ x: traffic.x, z: traffic.z }, [traffic]);
  assert.equal(intersectsBuilding(overlapped, [traffic]), false, "A moving car entering the rider must push the rider back out");
  const recovered = stepVehicle({ ...state, ...overlapped, speed: 0 }, EMPTY_INPUT, 1 / 60, [traffic]);
  assert.equal(intersectsBuilding(recovered, [traffic]), false, "The rider must remain free on the next frame");
});

test("fictional Taiwanese district destinations map to sensible local distances", () => {
  const first = coordinatesFromLocation(TAICHUNG_LOCATIONS[0]);
  const cmp = coordinatesFromLocation(TAICHUNG_LOCATIONS[1]);
  assert.ok(distanceBetween(first, cmp) > 150);
  assert.ok(distanceBetween(first, cmp) < 450);
  assert.equal(TAICHUNG_LOCATIONS.length, 6);
});

test("real-world coordinates remain correctly aligned with the riding simulation", () => {
  const location = TAICHUNG_LOCATIONS[3];
  const restored = locationFromCoordinates(coordinatesFromLocation(location));
  assert.ok(Math.abs(restored.longitude - location.longitude) < 1e-10);
  assert.ok(Math.abs(restored.latitude - location.latitude) < 1e-10);
});

test("OpenStreetMap slippy tiles enclose the actual Taichung origin", () => {
  const origin = { longitude: DISTRICT_ORIGIN.longitude, latitude: DISTRICT_ORIGIN.latitude };
  const tile = tileFromLocation(origin);
  const northwest = locationFromTile(tile.x, tile.y);
  const southeast = locationFromTile(tile.x + 1, tile.y + 1);
  assert.equal(tile.zoom, REAL_MAP_ZOOM);
  assert.ok(northwest.longitude <= origin.longitude && origin.longitude < southeast.longitude);
  assert.ok(northwest.latitude >= origin.latitude && origin.latitude > southeast.latitude);
});

test("passenger fares reward distance, comfort and punctuality", () => {
  const comfortable = tripFare(460, 70, 100, 1);
  const rough = tripFare(460, 0, 25, 0);
  assert.ok(comfortable.total > rough.total);
  assert.equal(comfortable.total, comfortable.base + comfortable.tip + comfortable.punctuality);
});

test("frame delta and smoothing remain stable during a long browser stall", () => {
  const state = stepVehicle(createVehicle(), { ...EMPTY_INPUT, forward: true }, 1000);
  assert.ok(Number.isFinite(state.speed));
  assert.ok(state.speed < 1);
  assert.ok(damp(0, 10, 4, 1 / 60) > 0);
});

test("the FPS governor reduces load only after sustained low frames and recovers conservatively", () => {
  let profile = { level: 0, lowSamples: 0, highSamples: 0 };
  profile = stepPerformanceProfile(profile, 31);
  assert.equal(profile.level, 0, "One transient slow sample must not cause a quality jump");
  profile = stepPerformanceProfile(profile, 30);
  assert.equal(profile.level, 0, "A short FPS dip must preserve clear rendering");
  profile = stepPerformanceProfile(profile, 28);
  profile = stepPerformanceProfile(profile, 27);
  assert.equal(profile.level, 1, "Sustained low FPS should reduce GPU load");
  profile = stepPerformanceProfile(profile, 28);
  profile = stepPerformanceProfile(profile, 27);
  profile = stepPerformanceProfile(profile, 28);
  profile = stepPerformanceProfile(profile, 27);
  assert.equal(profile.level, 2, "Persistent low FPS should reach performance mode");
  for (let sample = 0; sample < 24; sample++) profile = stepPerformanceProfile(profile, 60);
  assert.equal(profile.level, 0, "Stable high FPS should cautiously restore full quality");
});

test("character animation rotates both wheels from actual vehicle speed", () => {
  let vehicle = createVehicle();
  let motion = createCharacterMotion();
  const input = { ...EMPTY_INPUT, forward: true };
  for (let frame = 0; frame < 90; frame++) {
    vehicle = stepVehicle(vehicle, input, 1 / 60);
    motion = stepCharacterMotion(motion, vehicle, input, 1 / 60);
  }
  assert.ok(Math.abs(motion.wheelAngle) > 0.1);
  assert.ok(motion.cycle > 2);
  assert.ok(Math.abs(motion.riderBob) > 0.0001);
});

test("character animation follows steering, braking, suspension and rider weight transfer", () => {
  let vehicle = advance(createVehicle(), { ...EMPTY_INPUT, forward: true, right: true }, 1.2);
  let motion = createCharacterMotion();
  const turnInput = { ...EMPTY_INPUT, forward: true, right: true };
  for (let frame = 0; frame < 30; frame++) motion = stepCharacterMotion(motion, vehicle, turnInput, 1 / 60);
  assert.ok(Math.abs(motion.steeringAngle - vehicle.steering * .62) < .001);
  assert.ok(motion.riderSway < 0);

  const brakeInput = { ...EMPTY_INPUT, brake: true };
  for (let frame = 0; frame < 25; frame++) {
    vehicle = stepVehicle(vehicle, brakeInput, 1 / 60);
    motion = stepCharacterMotion(motion, vehicle, brakeInput, 1 / 60);
  }
  assert.ok(motion.chassisPitch > 0.01);
  assert.ok(motion.riderPitch > 0.025);
});

test("Taiwanese city roads follow varied but driveable urban terrain", () => {
  assert.equal(fallbackTerrainElevation({ x: 0, z: 0 }), 0);
  assert.ok(fallbackTerrainElevation({ x: 160, z: -135 }) > 2, "Dense neighborhoods need visible, gradual elevation changes");
  assert.ok(Math.abs(fallbackTerrainElevation({ x: 900, z: -650 })) > 4, "Outer districts need real slopes instead of a flat plane");
  assert.ok(fallbackTerrainElevation({ x: 1400, z: -1000 }) > 20, "Distant mountain foothills should remain visible");

  let minimum = Infinity;
  let maximum = -Infinity;
  let slopedSamples = 0;
  for (let x = -900; x <= 1200; x += 50) {
    for (let z = -800; z <= 800; z += 50) {
      const elevation = fallbackTerrainElevation({ x, z });
      minimum = Math.min(minimum, elevation);
      maximum = Math.max(maximum, elevation);
      for (const heading of [0, Math.PI / 2]) {
        const grade = Math.abs(terrainGradeAt({ x, z }, heading));
        assert.ok(grade < 0.065, `Urban grade ${(grade * 100).toFixed(2)}% is too steep for stable driving`);
        if (grade > 0.004) slopedSamples += 1;
      }
    }
  }
  assert.ok(maximum - minimum > 12, `Expanded city only changes by ${(maximum - minimum).toFixed(2)} meters`);
  assert.ok(maximum - minimum < 28, `City terrain is unnaturally distorted by ${(maximum - minimum).toFixed(2)} meters`);
  assert.ok(slopedSamples > 900, `Only ${slopedSamples} terrain samples contained a noticeable road grade`);
});

test("the mountain district has a continuous scenic road with a safe climb to the summit", () => {
  const start = fallbackTerrainElevation(MOUNTAIN_ROAD_POINTS[0]);
  const summit = fallbackTerrainElevation(MOUNTAIN_VALLEY_POINTS.at(-1));
  assert.ok(summit - start > 70, `The mountain road only climbs ${(summit - start).toFixed(1)} meters`);
  let maximumGrade = 0;
  let totalLength = 0;
  for(const road of [MOUNTAIN_ROAD_POINTS,MOUNTAIN_VALLEY_POINTS])for (let index = 0; index < road.length - 1; index++) {
    const a = road[index];
    const b = road[index + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const heading = Math.atan2(b.x - a.x, a.z - b.z);
    totalLength += length;
    for (let sample = 0; sample <= 20; sample++) {
      const progress = sample / 20;
      const point = { x: a.x + (b.x - a.x) * progress, z: a.z + (b.z - a.z) * progress };
      maximumGrade = Math.max(maximumGrade, Math.abs(terrainGradeAt(point, heading)));
    }
  }
  assert.ok(totalLength > 2100, `The two scenic roads are only ${totalLength.toFixed(0)} meters long`);
  assert.ok(maximumGrade <= 0.06, `Mountain-road grade ${(maximumGrade * 100).toFixed(2)}% is not safely driveable`);
});

test("Terrarium terrain pixels decode into actual elevation meters", () => {
  assert.equal(decodeTerrariumElevation(128, 50, 128), 50.5);
  assert.equal(decodeTerrariumElevation(127, 255, 0), -1);
});

test("uphill grades slow the scooter while downhill grades increase its speed", () => {
  let flat = createVehicle();
  let uphill = createVehicle();
  let downhill = createVehicle();
  const throttle = { ...EMPTY_INPUT, forward: true };
  for (let index = 0; index < 72; index++) {
    flat = stepVehicle(flat, throttle, 1 / 60, [], 0, 0);
    uphill = stepVehicle(uphill, throttle, 1 / 60, [], 0, 0.12);
    downhill = stepVehicle(downhill, throttle, 1 / 60, [], 0, -0.12);
  }
  assert.ok(uphill.speed < flat.speed, `Uphill ${uphill.speed} should be slower than flat ${flat.speed}`);
  assert.ok(downhill.speed > flat.speed, `Downhill ${downhill.speed} should be faster than flat ${flat.speed}`);
});

test("real intersections alternate protected green, amber and all-red traffic phases", () => {
  assert.equal(trafficLightColor(0, "main"), "green");
  assert.equal(trafficLightColor(0, "cross"), "red");
  assert.equal(trafficLightColor(20, "main"), "amber");
  assert.equal(trafficLightColor(23, "main"), "red");
  assert.equal(trafficLightColor(23, "cross"), "red");
  assert.equal(trafficLightColor(31, "main"), "red");
  assert.equal(trafficLightColor(31, "cross"), "green");
  assert.equal(trafficLightColor(44, "cross"), "amber");
  assert.equal(trafficLightColor(TRAFFIC_CYCLE_SECONDS, "main"), "green");
  for (let second = 0; second < TRAFFIC_CYCLE_SECONDS; second++) {
    assert.notEqual(trafficLightColor(second, "main") === "green" && trafficLightColor(second, "cross") === "green", true);
  }
});

test("turbo drains only while moving and regenerates after release", () => {
  const standing = stepTurboCharge(80, true, 0, 1 / 60);
  assert.equal(standing.engaged, false);
  const active = stepTurboCharge(80, true, 8, 1 / 60);
  assert.equal(active.engaged, true);
  assert.ok(active.charge < 80);
  const restored = stepTurboCharge(active.charge, false, 8, 1 / 60);
  assert.equal(restored.engaged, false);
  assert.ok(restored.charge > active.charge);
  assert.equal(stepTurboCharge(0, true, 12, 1 / 60).engaged, false);
});

test("every passenger is a rigged animated animal prepared for a seated riding pose", () => {
  const expected = ["pug", "pig", "sheep", "llama"];
  for (let index = 0; index < expected.length; index++) {
    const passenger = createPassengerAvatar(index);
    assert.equal(passenger.name, "Animated rigged animal taxi passenger with seated riding pose");
    assert.equal(passenger.userData.animalKind, expected[index]);
    assert.equal(passenger.userData.usesSkeletalAnimation, true);
    assert.match(passenger.userData.assetUrl, new RegExp(`${expected[index]}\\.glb$`));
    disposePassengerAvatar(passenger);
  }
});

test("real road geometry produces grounded streets, working signal heads and moving collidable traffic", async () => {
  const map = createHeadlessWorld();
  map.renderRoads([
    { properties: { class: "primary" }, geometry: { type: "LineString", coordinates: [mapCoordinate(-120, 0), mapCoordinate(0, 0), mapCoordinate(120, 0)] } },
    { properties: { class: "secondary" }, geometry: { type: "LineString", coordinates: [mapCoordinate(0, -120), mapCoordinate(0, 0), mapCoordinate(0, 120)] } },
  ]);

  // Populate traffic after all surface and elevated routes have been registered.
  map.createRoadTraffic();
  assert.equal(map.trafficIntersections.length, 1, "Crossing real-road centerlines should create a signalized junction");
  assert.equal(map.trafficIntersections[0].heads.length, 4, "All four incoming approaches need physical signal heads");
  assert.ok(map.trafficVehicles.length >= 4, "Both roads should carry multiple independent moving vehicles");
  map.trafficModelTemplates=new Map();
  for(const [kind,file] of [['car','tesla'],['taxi','tesla'],['suv','bmw'],['sports','ferrari-spider'],['motorcycle','motorcycle']]) {
    const {group}=await readModelHierarchy(new URL(`../public/models/traffic-real/${file}.glb`,import.meta.url).pathname);map.trafficModelTemplates.set(kind,group);
  }
  for(const kind of ['bear','bunny','pig']) {
    const {group}=await readModelGeometry(new URL(`../public/models/animal-riders/${kind}.glb`,import.meta.url).pathname);map.trafficModelTemplates.set(kind,group);
  }
  map.trafficVehicles.forEach((vehicle,index)=>map.upgradeTrafficVehicleModel(vehicle,index));
  assert.ok(map.trafficVehicles.every(v=>v.rig?.root.userData.completeTrafficModel&&v.visual.visible),'Every moving vehicle has its complete loaded wheel/chassis rig');
  const road = map.group.children.find((mesh) => mesh.geometry?.getAttribute("terrainBaseY"));
  assert.ok(road, "Generated road meshes must retain terrain-aware vertex heights");
  assert.ok(map.signalAhead({ x: 0, z: 20 }, 0, 0), "Approaching riders should receive traffic-light state");

  const before = map.trafficVehicles.map((vehicle) => vehicle.progress);
  for (let frame = 0; frame < 60; frame++) map.updateRoadTraffic(frame / 60, 1 / 60, { x: 999, z: 999 });
  const moved = map.trafficVehicles.filter((vehicle, index) => vehicle.progress !== before[index]);
  assert.ok(moved.length >= 2, "Traffic streams must start independently while red-light approaches remain stopped");
  map.trafficVehicles.forEach((vehicle) => assert.ok(Number.isFinite(vehicle.group.position.y), "Traffic must follow road elevation"));
  const nearby = map.nearbyTraffic(map.trafficVehicles[0].group.position);
  assert.ok(nearby.length >= 1, "Moving cars must participate in rider collision detection");
  assert.ok(nearby.every((obstacle) => obstacle.halfWidth < 2.6 && obstacle.halfDepth < 2.6), "Metric traffic collision footprints must fit a complete 4.7m sedan, not a shortened invisible box");
  const separatedVehicle = map.trafficVehicles[1];
  separatedVehicle.group.position.copy(map.trafficVehicles[0].group.position);
  separatedVehicle.group.position.y += 6;
  const sameLevel = map.nearbyTraffic(map.trafficVehicles[0].group.position, map.trafficVehicles[0].group.position.y);
  assert.equal(sameLevel.filter((obstacle) => obstacle.x === separatedVehicle.group.position.x && obstacle.z === separatedVehicle.group.position.z).length, 1, "Traffic on a bridge must not collide with a rider underneath");

  const crossingTraffic = map.trafficVehicles.find((vehicle) => Math.abs(vehicle.route.points[0].x - vehicle.route.points.at(-1).x) < 1);
  assert.ok(crossingTraffic, "A vertical cross-traffic stream must exist");
  crossingTraffic.progress = 145;
  crossingTraffic.direction = -1;
  crossingTraffic.speed = 8;
  for (let frame = 0; frame < 120; frame++) map.updateRoadTraffic(frame / 60, 1 / 60, { x: 999, z: 999 });
  const stoppedSignal = map.signalAhead(crossingTraffic.group.position, 0, 2);
  assert.equal(stoppedSignal?.color, "red", "Cross traffic must face the protected red phase");
  assert.ok(crossingTraffic.speed < 0.3, "Road traffic must stop instead of driving through a red light");
  assert.ok(stoppedSignal.distance > 0, "Cars must remain behind the physical stop line");

  disposeHeadlessWorld(map);
});

test("lane center lines stop before four-way intersections", () => {
  const map = createHeadlessWorld();
  const roads = [
    { properties: { class: "primary", lanes: 4 }, geometry: { type: "LineString", coordinates: [mapCoordinate(-55, 0), mapCoordinate(0, 0), mapCoordinate(55, 0)] } },
    { properties: { class: "primary", lanes: 4 }, geometry: { type: "LineString", coordinates: [mapCoordinate(0, -55), mapCoordinate(0, 0), mapCoordinate(0, 55)] } },
  ];
  map.renderRoads(roads);
  const markings = map.group.getObjectByName("Procedural city lane center markings");
  assert.ok(markings);
  const positions = markings.geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index++) {
    assert.ok(Math.hypot(positions.getX(index), positions.getZ(index)) > 5.8, "A lane divider was painted through the center of a four-way intersection");
  }
  disposeHeadlessWorld(map);
});

test("real mapped park polygons generate physical trees, walking paths and benches", () => {
  const map = createHeadlessWorld();
  const park = polygonFeature(35, 30, 105, 100, { class: "park", name: "臺中測試公園" });
  map.renderGroundFeatures([], [park], []);
  map.renderParkLandmarks();

  assert.equal(map.parkParcels.length, 1, "Park objects must come from the real vector parcel");
  assert.equal(map.parkParcels[0].name, "臺中測試公園");
  const trees = map.group.getObjectByName("Dense three-dimensional mapped park trees");
  const trunks = map.group.getObjectByName("Physical park tree trunks");
  const lawn = map.group.getObjectByName("Real mapped park lawns and green spaces");
  assert.ok(trees?.isInstancedMesh && trees.count >= 8, "Mapped parks need dense physical tree canopies");
  assert.ok(trunks?.isInstancedMesh && trunks.count === trees.count, "Every tree needs a real three-dimensional trunk");
  assert.ok(map.group.getObjectByName("Real park walking paths"));
  assert.ok(map.group.getObjectByName("Physical park benches"));
  assert.equal(lawn.geometry.getAttribute("terrainAnchorX"), undefined, "Park lawns must follow the same slope as the player's ground height");
  disposeHeadlessWorld(map);
});

test("mapped rivers create physical water, stone embankments and retaining walls", () => {
  const map = createHeadlessWorld();
  map.renderRiverChannels([
    { properties: { class: "river", width: 13 }, geometry: { type: "LineString", coordinates: [mapCoordinate(-110, 70), mapCoordinate(120, 70)] } },
  ], []);

  assert.ok(map.group.getObjectByName("Physical rivers and flowing urban canals"));
  assert.ok(map.group.getObjectByName("Visible submerged riverbed depth"));
  assert.ok(map.group.getObjectByName("Three-dimensional stone river embankments"));
  const walls = map.group.getObjectByName("Physical canal retaining walls");
  assert.ok(walls && walls.geometry.getAttribute("position").count >= 12);
  assert.equal(map.riverSurfaces.length, 1);
  assert.equal(map.riverSurfaces[0].ior, 1.333);
  assert.equal(map.riverSurfaces[0].transparent, true);
  assert.equal(map.riverSurfaces[0].normalMap, map.textures.waterNormal);
  assert.ok(map.riverSurfaces[0].transmission >= .45, "Preserve physical water refraction");
  assert.ok(map.riverSurfaces[0].opacity < 0.75 && !map.riverSurfaces[0].depthWrite, "Transparent water must reveal the actual submerged channel");
  const riverbed = map.group.getObjectByName("Visible submerged riverbed depth");
  riverbed.geometry.computeBoundingBox();
  assert.ok(riverbed.geometry.boundingBox.min.y < -2, "The river must have a genuinely deep bed instead of a flat blue plane");
  const center = { x: 0, z: 70 };
  assert.ok(map.elevationAt(center) < fallbackTerrainElevation(center) - 2, "Riding into the channel must drop the scooter onto the submerged bed");
  disposeHeadlessWorld(map);
});

test("two-point real bridge features become rideable raised overpasses with pillars", () => {
  const map = createHeadlessWorld();
  const bridge = {
    properties: { class: "primary", brunnel: "bridge" },
    geometry: { type: "LineString", coordinates: [mapCoordinate(-90, 52), mapCoordinate(90, 52)] },
  };
  map.renderElevatedRoads([bridge]);

  assert.ok(map.elevatedSegments.length >= 10, "Sparse real bridge vectors need interpolated ramp geometry");
  assert.ok(map.group.getObjectByName("Real elevated roads and bridge decks"));
  assert.ok(map.group.getObjectByName("Physical overpass concrete undersides"));
  assert.ok(map.group.getObjectByName("Continuous structural bridge box girders"));
  assert.ok(map.group.getObjectByName("Full-width bridge pier crossheads"));
  assert.ok(map.group.getObjectByName("Massive bridge pier foundations"));
  assert.ok(map.group.getObjectByName("Solid elevated-road bridge parapets"));
  const pillars = map.group.getObjectByName("Three-dimensional elevated-road support pillars");
  assert.ok(pillars?.isInstancedMesh && pillars.count >= 4, "Raised bridges must have structural columns");

  const heading = Math.PI / 2;
  const center = { x: 0, z: 52 };
  assert.ok(map.elevationAt(center, heading) > fallbackTerrainElevation(center) + 5);
  const groundBelowBridge = fallbackTerrainElevation(center);
  assert.ok(map.elevationAt(center, heading, groundBelowBridge) < groundBelowBridge + 0.2, "A rider under the bridge must not teleport onto its deck");
  assert.ok(map.bridgePierColliders.length >= 4, "Bridge piers must be physical driving obstacles");
  const pier = map.bridgePierColliders[0];
  const pierGround = fallbackTerrainElevation(pier);
  assert.ok(map.nearbyStaticObstacles(pier, 3, pierGround).includes(pier), "Bridge pier collision must block vehicles driving underneath");
  assert.ok(!map.nearbyStaticObstacles(pier, 3, pierGround + 3).includes(pier), "Bridge piers below the deck must not block vehicles already on the ramp");
  let rampHeight = fallbackTerrainElevation({ x: -90, z: 52 });
  for (let x = -90; x <= 0; x += 2) rampHeight = map.elevationAt({ x, z: 52 }, heading, rampHeight);
  assert.ok(rampHeight > groundBelowBridge + 5, "A vehicle following the approach ramp must reach the bridge deck continuously");
  assert.ok(map.elevationAt({ x: -85, z: 52 }, heading) < map.elevationAt(center, heading));
  assert.equal(map.trafficRoutes.length, 1, "Other vehicles should use the actual elevated route");

  const before = map.streetSegments.length;
  map.renderRoads([bridge]);
  assert.equal(map.streetSegments.length, before, "Bridges must not be duplicated as ordinary ground roads");
  disposeHeadlessWorld(map);
});

test("urban river crossings use a continuous arched deck and integrated structural ribs", () => {
  const map = createHeadlessWorld();
  const bridge = {
    properties: { class: "secondary", lanes: 2, layer: 1, brunnel: "bridge", urban_crossing: true },
    geometry: { type: "LineString", coordinates: [mapCoordinate(-55, 24), mapCoordinate(0, 24), mapCoordinate(55, 24)] },
  };
  map.renderElevatedRoads([bridge]);

  const heading = Math.PI / 2;
  let surface = fallbackTerrainElevation({ x: -55, z: 24 });
  const samples = [];
  for (let x = -55; x <= 55; x += 2.5) {
    surface = map.elevationAt({ x, z: 24 }, heading, surface);
    samples.push({ x, surface });
  }
  const start = samples[0].surface;
  const quarter = samples.find((sample) => sample.x === -27.5).surface;
  const crown = samples.find((sample) => sample.x === 0).surface;
  const farQuarter = samples.find((sample) => sample.x === 27.5).surface;
  const end = samples.at(-1).surface;
  assert.ok(Math.abs(start - fallbackTerrainElevation({ x: -55, z: 24 })) < 0.2 && Math.abs(end - fallbackTerrainElevation({ x: 55, z: 24 })) < 0.2, "The arched bridge must join both riverbanks at road level");
  assert.ok(crown > fallbackTerrainElevation({ x: 0, z: 24 }) + 2.25, "The bridge deck itself must form a visible central arch");
  assert.ok(quarter > start && crown > quarter && farQuarter > end, "The bridge surface must rise and fall as one continuous curve");
  assert.ok(map.group.getObjectByName("Integrated arched cross-river bridge ribs"));
  assert.equal(map.bridgePierColliders.length, 0, "Short urban arch bridges should span the water without piers in the river");
  disposeHeadlessWorld(map);
});

test("real school land-use parcels generate named physical school buildings and campuses", () => {
  const map = createHeadlessWorld();
  const campus = polygonFeature(-80, -105, -18, -42, { class: "school", name: "臺中測試國小" });
  map.identifySchoolCampuses([campus], []);
  map.renderGroundFeatures([], [], [], [campus]);

  const previousDocument = globalThis.document;
  globalThis.document = createHeadlessDocument();
  try {
    map.renderSchoolLandmarks();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.equal(map.schoolCampuses.length, 1);
  assert.equal(map.schoolCampuses[0].name, "臺中測試國小");
  assert.ok(map.group.getObjectByName("Actual school and university campus grounds"));
  const school = map.group.getObjectByName("Mapped physical school campus · 臺中測試國小");
  assert.ok(school && school.children.length >= 18, "Mapped schools require a building, windows, entrance, court and flagpole");
  assert.ok(school.getObjectByName("L-shaped photographic Taiwanese school classroom wing"));
  assert.ok(school.getObjectByName("Covered school courtyard circulation corridor"));
  assert.ok(school.getObjectByName("Correct-aspect photographic school facade bay"));
  disposeHeadlessWorld(map);
});

test("actual building footprints stay rigid instead of bending every wall to terrain", () => {
  const map = createHeadlessWorld();
  const footprint = polygonFeature(100, -90, 145, -50, { render_height: 16, render_min_height: 0 });
  map.renderBuildings([footprint]);

  const wall = map.group.children.find((mesh) => mesh.geometry?.getAttribute("terrainAnchorX") && mesh.geometry?.getAttribute("terrainAnchorZ"));
  assert.ok(wall, "Building geometry must retain one rigid terrain anchor");
  const positions = wall.geometry.getAttribute("position");
  const base = wall.geometry.getAttribute("terrainBaseY");
  const anchorsX = wall.geometry.getAttribute("terrainAnchorX");
  const anchorsZ = wall.geometry.getAttribute("terrainAnchorZ");
  const shift = positions.getY(0) - base.getX(0);
  for (let index = 1; index < positions.count; index++) {
    assert.ok(Math.abs(positions.getY(index) - base.getX(index) - shift) < 0.00001, "Building walls must not twist across unequal terrain heights");
    assert.equal(anchorsX.getX(index), anchorsX.getX(0));
    assert.equal(anchorsZ.getX(index), anchorsZ.getX(0));
  }
  disposeHeadlessWorld(map);
});

test("the district is fully playable immediately without waiting for external map downloads", async () => {
  const map = createHeadlessWorld();
  const previousDocument = globalThis.document;
  globalThis.document = createHeadlessDocument();
  try {
    map.renderAuthoredDistrict();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }

  assert.ok(map.buildings.length >= 350, `Immediate fallback only generated ${map.buildings.length} buildings`);
  assert.ok(map.buildings.length <= 620, `Taiwanese blocks need courtyards and setbacks instead of a wall of ${map.buildings.length} buildings`);
  assert.ok(map.streetSegments.length >= 45, `Players need a complete connected riding district immediately; found ${map.streetSegments.length}`);
  assert.ok(map.trafficVehicles.length >= 8, "The offline district still needs live street traffic");
  assert.ok(map.trafficVehicles.length <= 40, "Shared GLB traffic must keep enough GPU headroom for a stable city frame rate");
  assert.ok(map.trafficIntersections.length >= 4, "The offline district needs working traffic lights");
  assert.ok(map.parkParcels.some((park) => park.name.includes("中央綠園道")));
  assert.ok(map.schoolCampuses.length >= 1);
  assert.ok(map.elevatedSegments.length >= 60, "Every street crossing the river needs its own physical bridge");
  const expresswaySegments = map.elevatedSegments.filter((segment) =>
    Math.abs(segment.startHeight - (EXPRESSWAY_RING_HEIGHT + 0.082)) < 0.02
    && Math.abs(segment.endHeight - (EXPRESSWAY_RING_HEIGHT + 0.082)) < 0.02,
  );
  assert.ok(expresswaySegments.length >= 150, `The metropolitan expressway ring only has ${expresswaySegments.length} continuous elevated segments`);
  assert.ok(map.elevatedSegments.some((segment) => segment.startHeight < 0.2 && segment.endHeight > segment.startHeight + 0.01), "Interchange ramps must rise continuously from ground level");
  assert.ok(Math.max(...map.elevatedSegments.flatMap((segment) => [segment.startHeight, segment.endHeight])) > 8.7, "The driveable stack interchange needs a real second elevated level");
  assert.ok(map.elevatedSegments.some((segment) => segment.kitStyle === "suspension"), "The cross-river landmark must use the supplied suspension bridge kit");
  assert.ok(map.elevatedSegments.some((segment) => segment.kitStyle === "modular"), "Ordinary bridges must use the supplied modular road kit");
  const plan = authoredExpresswayPlan();
  const groundEntrances = [...plan.ramps, ...plan.ringExits].map(feature => {
    const points = feature.geometry.coordinates.map(([longitude, latitude]) => coordinatesFromLocation({ longitude, latitude }));
    if (feature.properties.ramp_direction === "down") points.reverse();
    return { name: String(feature.properties.name), points };
  });
  for (const [entranceIndex, entrance] of groundEntrances.entries()) {
    let surface = fallbackTerrainElevation(entrance.points[0]);
    for (let index = 0; index < entrance.points.length - 1; index++) {
      const a = entrance.points[index];
      const b = entrance.points[index + 1];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const heading = Math.atan2(b.x - a.x, a.z - b.z);
      for (let distance = 0; distance <= length; distance += 2) {
        const progress = Math.min(1, distance / length);
        const point = { x: a.x + (b.x - a.x) * progress, z: a.z + (b.z - a.z) * progress };
        const next = map.elevationAt(point, heading, surface);
        assert.ok(next - surface <= 0.72, `${entrance.name} entrance has an unreachable ${(next - surface).toFixed(2)} m vertical step`);
        surface = next;
      }
    }
    assert.ok(surface > fallbackTerrainElevation(entrance.points.at(-1)) + 5.1, `${entrance.name} entrance never reaches the expressway deck`);
    const junction = entrance.points.at(-1);
    const junctionHeadings = entranceIndex < 8 ? [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4] : [Math.PI / 2];
    for (const heading of junctionHeadings) {
      const turningSurface = map.elevationAt(junction, heading, surface);
      assert.ok(turningSurface >= surface - 0.18, `${entrance.name} junction drops the rider while turning onto the expressway`);
    }
  }
  const ringAccessGroundPoints = groundEntrances.slice(0, 8).map((entrance) => entrance.points[0]);
  for (let first = 0; first < ringAccessGroundPoints.length; first++) for (let second = first + 1; second < ringAccessGroundPoints.length; second++) {
    assert.ok(Math.hypot(
      ringAccessGroundPoints[first].x - ringAccessGroundPoints[second].x,
      ringAccessGroundPoints[first].z - ringAccessGroundPoints[second].z,
    ) >= 85, "Ring-road entrances and exits must use visibly separated ground corridors");
  }
  // Tangential merges do not require the former T-junction filler disks.
  // The driving checks above validate deck continuity rather than a filler count.
  assert.ok(map.group.getObjectByName("Continuous architectural bridge-edge fascias"));
  let shoulderSamples=0;
  for(const segment of map.elevatedSegments.filter(s=>s.startHeight>3&&s.endHeight>3)) {
    const center={x:(segment.a.x+segment.b.x)/2,z:(segment.a.z+segment.b.z)/2};
    const heading=Math.atan2(segment.b.x-segment.a.x,segment.a.z-segment.b.z);
    const baseline=map.elevationAt(center,heading,1000);
    for(const corner of segment.footprint){
      const point={x:center.x+(corner.x-center.x)*.96,z:center.z+(corner.z-center.z)*.96};
      assert.ok(map.elevatedSegmentGrid.queryAround(point,.05).includes(segment),'A real mitered shoulder must be present in the collision index');
      const surface=map.elevationAt(point,heading,baseline+.72);
      assert.ok(surface>baseline-1.6,'An outer junction shoulder cannot become unsupported ground');shoulderSamples++;
    }
  }
  assert.ok(shoulderSamples>2000,'Audit the complete high-road network, including its shoulders');
  for(const feature of [...plan.ramps,...plan.ringExits,...plan.cityInterchangeRamps]) {
    const points=feature.geometry.coordinates.map(([longitude,latitude])=>coordinatesFromLocation({longitude,latitude}));
    const length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.z-points[i].z),0);
    const rise=Math.abs(Number(feature.properties.elevated_height)-Number(feature.properties.base_elevated_height??0));
    assert.ok(rise*1.5/length<.085,`${feature.properties.name} requires a longer continuous ascent`);
  }
  assert.ok(map.group.getObjectByName('Real elevated roads and bridge decks').userData.spatialChunks>10,'The entire elevated network must not be submitted for every city view');
  const pillars = map.group.getObjectByName("Three-dimensional elevated-road support pillars");
  assert.equal(pillars.userData.minimumLongitudinalSpacing, 40, "Relocated bridge supports must retain at least 40 m longitudinal spacing");
  assert.equal(pillars.userData.placedSupportCount, pillars.userData.plannedSupportCount, "Traffic avoidance may relocate a bridge support but must never delete it");
  const pointToSegment = (point, a, b) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const squared = dx * dx + dz * dz;
    const progress = squared > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / squared)) : 0;
    return Math.hypot(point.x - a.x - dx * progress, point.z - a.z - dz * progress);
  };
  for (const pier of map.bridgePierColliders) for (const street of map.streetSegments) {
    assert.ok(
      pointToSegment(pier, street.a, street.b) >= street.width / 2 + 1.4,
      `Bridge pier at ${pier.x.toFixed(1)},${pier.z.toFixed(1)} blocks a ground traffic lane`,
    );
  }
  const insideOutline = (point, outline) => {
    let inside = false;
    for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
      const a = outline[index];
      const b = outline[previous];
      if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  };
  for (const pier of map.bridgePierColliders) for (const building of map.buildings) {
    const outline = building.outline;
    if (!outline) continue;
    const clearance = Math.min(...outline.slice(0, -1).map((point, index) => pointToSegment(pier, point, outline[index + 1])));
    assert.ok(!insideOutline(pier, outline) && clearance >= 1.9, `Bridge pier at ${pier.x.toFixed(1)},${pier.z.toFixed(1)} intersects a building`);
  }
  const transfer = plan.cityInterchangeRamps[0].geometry.coordinates.map(([longitude, latitude]) => coordinatesFromLocation({ longitude, latitude }));
  let transferHeight = fallbackTerrainElevation(transfer[0]) + EXPRESSWAY_RING_HEIGHT;
  for (let i = 1; i < transfer.length; i++) {
    const p = transfer[i], a = transfer[i - 1];
    const next = map.elevationAt(p, Math.atan2(p.x - a.x, a.z - p.z), transferHeight);
    assert.ok(Math.abs(next - transferHeight) < .72, "Ring-to-city transfer must remain continuously elevated");
    transferHeight = next;
  }
  assert.ok(transferHeight > fallbackTerrainElevation(transfer.at(-1)) + 5.1);
  assert.ok(map.group.getObjectByName("Physical rivers and flowing urban canals"));
  assert.equal(map.group.getObjectByName("Physical Taiwanese road underpass with sloped ramps and retaining walls"), undefined, "The old freestanding underpass must not block the school-side street");
  const schoolRoad = { x: -365, z: 90 };
  const schoolRoadGround = fallbackTerrainElevation(schoolRoad);
  assert.ok(Math.abs(map.elevationAt(schoolRoad, 0, schoolRoadGround) - schoolRoadGround) < 0.25, "The school-side street must remain a single connected ground-level road");
  assert.ok(map.stockBuildingEntries.length>=12 && map.stockBuildingEntries.length<=20,"Plan compatible full stock buildings without replacing landmarks");
  assert.ok(map.stockBuildingEntries.every(entry=>entry.fallback.visible),"Keep original buildings until optional stock asset finishes loading");
  const {group:stock}=await readModelGeometry(new URL('../public/models/buildings/urban-office.glb',import.meta.url).pathname);
  map.stockBuildingTemplates=new Map([['urban-office',stock]]);map.renderStockBuildingAssets();
  assert.ok(map.stockBuildingEntries.filter(e=>e.placement.kind!=='urban-office').every(e=>e.fallback.visible),'Unloaded tower variants keep complete original buildings');
  const {group:premium}=await readModelGeometry(new URL('../public/models/buildings/premium-towers.glb',import.meta.url).pathname);
  for(const model of premium.children)map.stockBuildingTemplates.set(model.name,model);
  map.renderStockBuildingAssets();
  assert.ok(map.stockBuildingEntries.every(entry=>!entry.fallback.visible),"No overlapping original facades after replacement");
  assert.equal(map.group.userData.stockBuildingAudit.buildings,map.stockBuildingEntries.length);
  assert.ok(map.group.userData.stockBuildingAudit.drawCalls<=16);
  assert.ok(Object.values(map.group.userData.stockBuildingAudit.kinds).every(count=>count>0),'All four model designs must appear');
  console.log('Stock building integration:',JSON.stringify(map.group.userData.stockBuildingAudit));
  const stockBatches=map.group.getObjectByName('Complete stock PBR office buildings');
  const stockRay=new THREE.Raycaster();map.group.updateMatrixWorld(true);
  for(const entry of map.stockBuildingEntries){
    const p=entry.placement;
    assert.ok(Math.abs(BUILDING_MODELS[p.kind].height*p.scale/p.originalHeight-1)<=.13);
    assert.equal(entry.collider.x,p.x);assert.equal(entry.collider.z,p.z);
    stockRay.set(new THREE.Vector3(p.x,150,p.z),new THREE.Vector3(0,-1,0));
    const hits=stockRay.intersectObject(stockBatches,true);assert.ok(hits.length>0,'Complete model must occupy the planned visible footprint');
    assert.ok(hits[0].point.y>25,'Physical building must have full height');
    const pavement=map.group.getObjectByName('Stock office foundations and connected entrance courts');
    stockRay.set(new THREE.Vector3(p.x,150,p.sidewalkZ+.15*Math.sign(p.z-p.sidewalkZ)),new THREE.Vector3(0,-1,0));
    assert.ok(stockRay.intersectObject(pavement).length>0,'Entrance path reaches the existing sidewalk');
  }
  assert.ok(map.group.getObjectByName("Dense three-dimensional mapped park trees"));
  assert.ok(map.group.getObjectByName("Layered realistic roadside tree canopies"));
  assert.ok(map.group.getObjectByName("Setback Taiwanese sidewalks that stop before road junctions"));
  assert.deepEqual(map.spawnPoint, { x: -92, z: -110, heading: Math.PI / 2 }, "The first frame must start on the intended downtown curb lane");
  const spawnGround = fallbackTerrainElevation(map.spawnPoint);
  const spawnSurface = map.elevationAt(map.spawnPoint, map.spawnPoint.heading, spawnGround);
  assert.ok(Math.abs(spawnSurface - spawnGround) < 0.25, "The rider must not spawn on grass or underneath an elevated deck");
  assert.equal(map.nearbyStaticObstacles(map.spawnPoint, 4, spawnSurface).length, 0, "The rider must have clear road space at startup");
  assert.ok(map.roadJunctions.length >= 80, `Only ${map.roadJunctions.length} road junctions received sidewalk setbacks`);
  assert.ok(map.group.getObjectByName("Driveable Taiwanese mountain road with switchbacks and guardrails"));
  assert.ok(map.group.getObjectByName("Mountain-road amber edge reflectors"));
  assert.ok(map.group.getObjectByName("Layered Taiwanese mountain forest"));
  const mountainDistrict = map.group.getObjectByName("Driveable Taiwanese mountain road with switchbacks and guardrails");
  const villas = mountainDistrict?.children.filter(child => child.name.startsWith("Coherent landscaped hillside estate")) ?? [];
  assert.equal(villas.length, 5, "Retain all five planned hillside estates");
  const luxury=mountainDistrict.getObjectByName('Grand mountain residence · complete architect model and landscaped estate');
  assert.ok(luxury,`The new grand estate must actually be placed: ${JSON.stringify(map.group.userData.luxuryEstatePlanning)}`);
  assert.equal(luxury.userData.parcelWidth,76);assert.equal(luxury.userData.parcelDepth,62);
  assert.ok(mountainDistrict.getObjectByName('Continuous luxury-estate mountain access road'));
  const entrance=map.group.userData.luxuryEstateSite.access;
  assert.ok(entrance.length>12);
  for(let i=1;i<entrance.length;i++)assert.ok(Math.abs(entrance[i].height-entrance[i-1].height)/Math.hypot(entrance[i].x-entrance[i-1].x,entrance[i].z-entrance[i-1].z)<.121,'Estate driveway has a real, bounded climb');
  const completeVilla=(await readModelHierarchy('public/models/estate/zigurat-residence.glb')).group;
  for (const villa of villas) {
    const holder=villa.userData.residence;
    assert.ok(holder,'Each planned parcel loads the complete source villa');
    holder.add(completeVilla.clone(true));
    const bounds = new THREE.Box3().setFromObject(villa), size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.x >= 28 && size.z >= 28 && size.y >= 7.5, "Estates must retain full plots, terraces and two storeys");
    let originalTriangles=0,placedTriangles=0;
    completeVilla.traverse(mesh=>{if(mesh.isMesh)originalTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;});
    holder.traverse(mesh=>{if(mesh.isMesh)placedTriangles+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;});
    assert.equal(placedTriangles,originalTriangles,'The villa keeps every triangle of the complete downloaded architecture');
    assert.equal(holder.scale.x,holder.scale.z,'The downloaded house keeps uniform proportions');
    assert.ok(villa.children.filter(child=>child.isMesh).length >= 4, "Retain separate landscaped stone, garden, pool and illuminated entrance surfaces");
  }
  assert.ok(mountainDistrict.getObjectByName("Driveable estate entrance road"));
  assert.ok(mountainDistrict.getObjectByName("Terrain-fitted driveway retaining walls"));
  for (const drive of map.elevatedSegments.filter(road=>road.surfaceHeightA!==undefined)) {
    const heading=Math.atan2(drive.b.x-drive.a.x,drive.a.z-drive.b.z);
    for(const t of [.1,.5,.9]) {
      const position={x:drive.a.x+(drive.b.x-drive.a.x)*t,z:drive.a.z+(drive.b.z-drive.a.z)*t};
      const expected=drive.surfaceHeightA+(drive.surfaceHeightB-drive.surfaceHeightA)*t-.082;
      assert.ok(Math.abs(map.elevationAt(position,heading,expected)-expected)<.1,"Estate collision surface must track the rendered driveway");
    }
  }
  const grass = map.group.getObjectByName("Dense collision-cleared urban grass tufts");
  assert.ok(grass && (grass.userData.instanceCount ?? grass.count) >= 3000, "Large open green parcels need dense physical grass detail");
  assert.equal(map.group.userData.spatialAudit?.passed, true, "The final static-layout audit found a building, road, elevated deck or bridge-pier intersection");
  map.group.updateMatrixWorld(true);
  const entranceRay = new THREE.Raycaster();
  for (const x of [-476.35, -367.50]) for (const z of [523, 527, 531, 535, 545, 549, 553, 557]) {
    entranceRay.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
    for (const name of ["Raised physical Taiwanese road curbs", "Setback Taiwanese sidewalks that stop before road junctions"]) {
      const object = map.group.getObjectByName(name);
      assert.equal(entranceRay.intersectObject(object).length, 0, `Old ${name} blocks the widened shopping-street mouth at ${x},${z}`);
    }
  }
  assert.ok(map.trafficVehicles.some((vehicle) => vehicle.group.name.includes("scooter")), "Traffic must include visible rider-equipped scooters");
  assert.ok(map.buildings.every((building) => building.x < 970 || building.x > 1050 || building.z < 550 || building.z > 610), "The planned parking base must remain free of buildings");
  const roadPoints = map.streetSegments.flatMap((street) => [street.a, street.b]);
  const cityWidth = Math.max(...roadPoints.map((point) => point.x)) - Math.min(...roadPoints.map((point) => point.x));
  const cityDepth = Math.max(...roadPoints.map((point) => point.z)) - Math.min(...roadPoints.map((point) => point.z));
  assert.ok(cityWidth >= 1800, `The fully interactive city core is only ${cityWidth.toFixed(0)} meters wide`);
  assert.ok(cityDepth >= 1500, `The authored city is only ${cityDepth.toFixed(0)} meters deep`);

  for (const z of [-760, -690, -610, -535, -460, -385, -205, -110, -18, 90, 180, 270, 365, 460, 540, 620, 690, 760]) {
    let surface = fallbackTerrainElevation({ x: 565, z });
    for (let x = 565; x <= 620; x += 2.5) surface = map.elevationAt({ x, z }, Math.PI / 2, surface);
    const ground = fallbackTerrainElevation({ x: 620, z });
    assert.ok(surface > ground + 2.2, `River crossing at z=${z} has no arched bridge deck`);
  }
  for (const building of map.buildings) {
    for (const street of map.streetSegments) {
      const sidewalk = street.width >= 8 ? 2.05 : 1.35;
      assert.equal(
        outlineOverlapsRoadCorridor(building.outline, street.a, street.b, street.width / 2 + sidewalk + 0.8),
        false,
        `Building at ${building.x.toFixed(1)},${building.z.toFixed(1)} overlaps a road or sidewalk corridor`,
      );
    }
    for (const elevated of map.elevatedSegments) {
      assert.equal(
        outlineOverlapsElevatedRoad(building.outline, elevated),
        false,
        `Building at ${building.x.toFixed(1)},${building.z.toFixed(1)} intrudes into bridge clearance`,
      );
    }
  }
  for (const building of [
    "Fictional Taiwanese department store · 晴川百貨",
    "Glass curtain-wall office district · 海灣金融中心",
    "Modern Taiwanese residential tower · 河景之森",
    "Traditional Taiwanese market block · 南町市場",
  ]) {
    assert.ok(map.group.getObjectByName(building), `The realistic district is missing ${building}`);
  }
  disposeHeadlessWorld(map);
});

test("the city plan has one closed metropolitan ring with four-sided coverage", () => {
  assert.ok(EXPRESSWAY_RING_POINTS.length >= 38, "Rounded corners need enough samples to remain driveable");
  assert.deepEqual(EXPRESSWAY_RING_POINTS[0], EXPRESSWAY_RING_POINTS.at(-1), "The expressway must form a closed loop");
  const xs = EXPRESSWAY_RING_POINTS.map((point) => point.x);
  const zs = EXPRESSWAY_RING_POINTS.map((point) => point.z);
  assert.ok(Math.max(...xs) - Math.min(...xs) >= 2300, "The ring must enclose the full east-west city plan");
  assert.ok(Math.max(...zs) - Math.min(...zs) >= 1750, "The ring must enclose the full north-south city plan");
  for (let index = 0; index < EXPRESSWAY_RING_POINTS.length - 1; index++) {
    const a = EXPRESSWAY_RING_POINTS[index];
    const b = EXPRESSWAY_RING_POINTS[index + 1];
    assert.ok(Math.hypot(b.x - a.x, b.z - a.z) > 0.5, `Ring segment ${index} is degenerate`);
  }
});

test("real building fronts contain windows, arcade columns, signage, air conditioners and rooftop tanks", () => {
  const map = createHeadlessWorld();
  map.renderRoads([
    { properties: { class: "primary" }, geometry: { type: "LineString", coordinates: [mapCoordinate(-95, 0), mapCoordinate(105, 0)] } },
  ]);
  map.renderBuildings([polygonFeature(10, 12, 33, 29, { render_height: 20, archetype: "old_apartment", building: "retail" })]);

  for (const object of [
    "Reflective real-street storefront glazing",
    "Physical Taiwanese arcade awnings",
    "Three-dimensional residential balcony slabs",
    "Inset reflective apartment windows",
    "Detailed wall-mounted air-conditioning units",
    "Taiwanese covered-sidewalk arcade columns",
    "Taiwanese rooftop water-storage tanks",
    "Illuminated Taiwanese storefront signs",
  ]) {
    assert.ok(map.group.getObjectByName(object), `A real street facade is missing ${object}`);
  }
  const glass = map.group.getObjectByName("Inset reflective apartment windows");
  assert.ok(glass?.isInstancedMesh && glass.count >= 8);

  // Existing street details must remain attached to the photographed building.
  const facade = map.group.getObjectByName("Photographic floor-aligned modular Taiwanese street blocks 1");
  assert.ok(facade && facade.material.map === map.textures.facades[0]);
  const foundation = facade.geometry.getAttribute("position").getY(0) - facade.geometry.getAttribute("terrainBaseY").getX(0);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const bounds = map.buildings[0];
  for (const name of ["Physical Taiwanese arcade awnings", "Three-dimensional residential balcony slabs", "Inset reflective apartment windows", "Detailed wall-mounted air-conditioning units", "Taiwanese covered-sidewalk arcade columns", "Taiwanese rooftop water-storage tanks", "Illuminated Taiwanese storefront signs"]) {
    const mesh = map.group.getObjectByName(name);
    for (let index = 0; index < mesh.count; index++) {
      const detail = mesh.userData.terrainInstances[index];
      mesh.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix);
      assert.ok(Math.abs(position.y - detail.y - foundation) < 0.0001, `${name} must share the wall's foundation`);
    }
  }
  const awning = map.group.getObjectByName("Physical Taiwanese arcade awnings");
  awning.getMatrixAt(0, matrix);
  assert.ok(new THREE.Vector3(0, 0, 1).transformDirection(matrix).z < -0.999, "The frontage must face the street, including reversed polygon winding");
  const ac = map.group.getObjectByName("Detailed wall-mounted air-conditioning units");
  ac.getMatrixAt(0, matrix);
  const innerFace = new THREE.Vector3(0, 0, -0.5).applyMatrix4(matrix);
  const upperWallZ = bounds.z - bounds.halfDepth * 0.97;
  assert.ok(Math.abs(innerFace.z - upperWallZ) < 0.03, "Air conditioners must meet the facade rather than float in front of it");
  const tanks = map.group.getObjectByName("Taiwanese rooftop water-storage tanks");
  tanks.getMatrixAt(0, matrix);
  assert.ok(Math.abs(new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrix).y - foundation - 20) < 0.0001, "Water tanks must rest on the roof");
  map.refreshTerrainMeshes();
  awning.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[13] - awning.userData.terrainInstances[0].y - foundation) < 0.0001, "Terrain refresh must not pull attachments off their building");
  disposeHeadlessWorld(map);
});

test("real road edges receive trees, planters, bollards and parked scooters", () => {
  const map = createHeadlessWorld();
  map.renderRoads([
    { properties: { class: "primary" }, geometry: { type: "LineString", coordinates: [mapCoordinate(-170, 0), mapCoordinate(170, 0)] } },
  ]);
  map.renderStreetLife();

  for (const object of [
    "Street-level Taiwanese tree trunks",
    "Layered realistic roadside tree canopies",
    "Secondary organic street-tree foliage",
    "Branched high-detail roadside tree structure",
    "Physical curbside tree planters",
    "Taiwanese sidewalk safety bollards",
    "Realistically parked sidewalk scooters",
    "Parked scooter saddle seats",
    "Parked scooter front wheels",
    "Parked scooter rear wheels",
  ]) {
    assert.ok(map.group.getObjectByName(object), `Ground-level city detail is missing ${object}`);
  }
  const trees = map.group.getObjectByName("Layered realistic roadside tree canopies");
  assert.ok(trees?.count >= 12, "A major avenue needs a visibly tree-lined streetscape");
  disposeHeadlessWorld(map);
});

test("live vector data can cleanly replace the offline district without duplicating buildings or streets", () => {
  const map = createHeadlessWorld();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial());
  ground.name = "Level urban ground with distant mountain foothills";
  map.group.add(ground);
  const previousDocument = globalThis.document;
  globalThis.document = createHeadlessDocument();
  try {
    map.renderAuthoredDistrict();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.ok(map.group.children.length > 10);
  const propCounts = { bench: 0, hydrant: 0, planter: 0 };
  map.group.updateMatrixWorld(true);
  const pavement = map.group.getObjectByName("Setback Taiwanese sidewalks that stop before road junctions");
  const ray = new THREE.Raycaster(); let maxGap = 0;
  for (const prop of map.streetPropPlacements) {
    propCounts[prop.kind]++;
    ray.set(new THREE.Vector3(prop.x, 500, prop.z), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObject(pavement)[0];
    assert.ok(hit, `Furniture must have an actual sidewalk beneath it: ${JSON.stringify(prop)}`);
    maxGap = Math.max(maxGap, Math.abs(hit.point.y - map.elevationAt(prop) - prop.y));
  }
  for (const [kind, count] of Object.entries(propCounts)) assert.ok(count >= 8, `${kind} placements: ${count}`);
  assert.ok(maxGap < .015, `Pavement contact error ${maxGap} m`);
  map.clearAuthoredDistrict();
  assert.deepEqual(map.group.children, [ground]);
  assert.equal(map.buildings.length, 0);
  assert.equal(map.streetSegments.length, 0);
  assert.equal(map.trafficVehicles.length, 0);
  assert.equal(map.parkParcels.length, 0);
  assert.equal(map.elevatedSegments.length, 0);
  ground.material.dispose();
  disposeHeadlessWorld(map);
});
