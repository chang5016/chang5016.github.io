import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createHeadlessDocument } from "./headless-document.mjs";
import { CITY_LINE, CITY_LINE_STATIONS, CITY_LINE_STATION_HALF, cityLineStationRect, cityLineTrainState, CITY_LINE_PERIOD } from "../app/city-line.ts";

globalThis.document ??= createHeadlessDocument();
const { RealWorldMap } = await import("../app/real-world-map.ts");
const { CityLineScene } = await import("../app/city-line-scene.ts");

const segmentDistance = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, square = dx * dx + dz * dz;
  const t = square ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / square)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const rectPoints = rect => {
  const points = [];
  for (let x = rect.x - rect.halfWidth; x <= rect.x + rect.halfWidth + 1e-6; x += 1) for (let z = rect.z - rect.halfDepth; z <= rect.z + rect.halfDepth + 1e-6; z += 1) points.push({ x, z });
  return points;
};
const overlaps = (a, b) => Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth && Math.abs(a.z - b.z) < a.halfDepth + b.halfDepth;

const scene = new THREE.Scene();
const world = new RealWorldMap(scene, 1);
const buildings = world.buildings;

test("all three green-line stations stand on open ground: no building, road surface or elevated road", () => {
  assert.equal(CITY_LINE_STATIONS.length, 3);
  for (let index = 0; index < CITY_LINE_STATIONS.length; index++) {
    const rect = cityLineStationRect(index);
    const id = CITY_LINE_STATIONS[index].id;
    for (const building of buildings) assert.ok(!overlaps(rect, building), `${id} overlaps a building at ${building.x},${building.z}`);
    for (const point of rectPoints(rect)) {
      for (const road of world.streetSegments) assert.ok(segmentDistance(point, road.a, road.b) >= road.width / 2, `${id} footprint reaches a road surface at ${point.x},${point.z}`);
      for (const road of world.elevatedSegments) {
        const width = Math.max(road.width, road.startWidth ?? 0, road.endWidth ?? 0);
        assert.ok(segmentDistance(point, road.a, road.b) >= width / 2, `${id} footprint is under an elevated road`);
      }
    }
  }
});

test("the viaduct passes over no building and its piers stand clear of roads, ramps and buildings", () => {
  const corridor = { x: CITY_LINE.x, z: (CITY_LINE.north + CITY_LINE.south) / 2, halfWidth: 4.75, halfDepth: (CITY_LINE.south - CITY_LINE.north) / 2 };
  for (const building of buildings) assert.ok(!overlaps(corridor, building), `Viaduct crosses a building at ${building.x},${building.z}`);
  const piers = world.cityLinePiers;
  assert.ok(piers.length >= 20, "The viaduct is carried on piers");
  for (const pier of piers) {
    for (const road of world.streetSegments) assert.ok(segmentDistance(pier, road.a, road.b) > road.width / 2 + CITY_LINE.pierRadius, `Pier at z=${pier.z} stands in a road`);
    for (const building of buildings) assert.ok(!overlaps({ ...pier, halfWidth: CITY_LINE.pierRadius, halfDepth: CITY_LINE.pierRadius }, building), `Pier at z=${pier.z} stands in a building`);
  }
  // Every gap between supports (piers or station parcels) stays a buildable span.
  const supports = [...piers.map(p => [p.z, p.z]), ...CITY_LINE_STATIONS.map(s => [s.z - CITY_LINE_STATION_HALF.z + 2, s.z + CITY_LINE_STATION_HALF.z - 2])].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < supports.length; i++) assert.ok(supports[i][0] - supports[i - 1][1] <= 48, `Span of ${(supports[i][0] - supports[i - 1][1]).toFixed(1)} m near z=${supports[i][0]}`);
});

test("the viaduct clears the expressway it crosses with room for traffic", () => {
  const girderBottom = CITY_LINE.railY - 0.42 - CITY_LINE.girderDepth;
  const crossing = world.elevatedSegments.filter(road => segmentDistance({ x: CITY_LINE.x, z: road.a.z }, road.a, road.b) < road.width);
  assert.ok(crossing.length > 0, "The line does cross the z = -300 expressway");
  for (const road of crossing) {
    const deck = Math.max(...[road.startHeight, road.endHeight, road.height].filter(h => h !== undefined));
    assert.ok(girderBottom - deck > 5.5, `Only ${(girderBottom - deck).toFixed(1)} m between expressway deck and viaduct`);
  }
});

test("nothing tall is left standing inside a station parcel", () => {
  scene.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  scene.traverse(object => {
    if (!object.isInstancedMesh || /elevated|bridge|pier|expressway/i.test(object.name)) return;
    object.geometry.computeBoundingBox();
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix); matrix.premultiply(object.matrixWorld).decompose(position, quaternion, scale);
      if (scale.y === 0) continue;
      const top = position.y + object.geometry.boundingBox.max.y * scale.y;
      if (top - world.elevationAt(position) < 0.3) continue;
      for (let index = 0; index < 3; index++) {
        const rect = cityLineStationRect(index);
        assert.ok(Math.abs(position.x - rect.x) > rect.halfWidth || Math.abs(position.z - rect.z) > rect.halfDepth, `${object.name} still stands inside ${CITY_LINE_STATIONS[index].id}`);
      }
    }
  });
});

test("viaduct piers and station columns are solid for the scooter", () => {
  const pier = world.cityLinePiers[Math.floor(world.cityLinePiers.length / 2)];
  assert.ok(world.nearbyStaticObstacles(pier, 3, world.elevationAt(pier)).some(o => Math.abs(o.x - pier.x) < 0.01 && Math.abs(o.z - pier.z) < 0.01));
  const column = { x: CITY_LINE.x + 6.4, z: CITY_LINE_STATIONS[1].z + 8 };
  assert.ok(world.nearbyStaticObstacles(column, 3, world.elevationAt(column)).some(o => Math.abs(o.x - column.x) < 0.01 && Math.abs(o.z - column.z) < 0.01));
});

test("green-line trains stop at every station and stay on the viaduct", () => {
  const stops = new Set();
  for (let t = 0; t < CITY_LINE_PERIOD; t += 0.5) {
    const state = cityLineTrainState(t, 0);
    assert.ok(state.z >= CITY_LINE.north && state.z <= CITY_LINE.south);
    if (state.dwelling !== null) { stops.add(state.dwelling); assert.ok(Math.abs(state.z - CITY_LINE_STATIONS[state.dwelling].z) < 0.01); }
  }
  assert.deepEqual([...stops].sort(), [0, 1, 2]);
  const visuals = new CityLineScene(new THREE.Scene(), world.cityLinePiers, p => world.elevationAt(p));
  const before = visuals.trains[0].position.z;
  visuals.update(60);
  assert.notEqual(visuals.trains[0].position.z, before, "Trains move with simulation time");
  assert.equal(visuals.trains.length, 2);
  visuals.dispose();
});
