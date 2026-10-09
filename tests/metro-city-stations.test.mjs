import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createHeadlessDocument } from './headless-document.mjs';
import { MetroSystem, METRO_ALL_STATIONS, METRO_FLOOR, LIFT_HALF, metroGroundAccess, metroLiftSites, metroSupportPiers } from '../app/metro-system.ts';
import { METRO_ROUTE, routeDistance, sampleRoute } from '../app/metro-route.ts';

globalThis.document ??= createHeadlessDocument();
const { RealWorldMap } = await import('../app/real-world-map.ts');

const scene = new THREE.Scene(), world = new RealWorldMap(scene, 1);
const city = METRO_ALL_STATIONS.filter(station => station.city);
const extensionFrom = METRO_ALL_STATIONS[2].s + 40;
const segmentDistance = (p, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, square = dx * dx + dz * dz;
  const t = square ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / square)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
};
const insideRect = (p, r, margin = 0) => Math.abs(p.x - r.x) <= r.halfWidth + margin && Math.abs(p.z - r.z) <= r.halfDepth + margin;
const onRoad = p => world.streetSegments.find(road => segmentDistance(p, road.a, road.b) < road.width / 2);
const underElevated = p => world.elevatedSegments.find(road => segmentDistance(p, road.a, road.b) < Math.max(road.width, road.startWidth ?? 0, road.endWidth ?? 0) / 2);
const inBuilding = p => world.buildings.find(b => Math.abs(p.x - b.x) <= b.halfWidth && Math.abs(p.z - b.z) <= b.halfDepth);
// Plan footprint of a city station: roof (±43 × ±24.5) and the white body and wings below it.
const STATION_FOOTPRINT = { halfLength: 45.5, halfWidth: 24.5 };

test('the three city stations stand over open ground: no building, road surface or elevated road under any part', () => {
  for (const station of city) {
    for (let u = -STATION_FOOTPRINT.halfLength; u <= STATION_FOOTPRINT.halfLength; u += 1) for (let w = -STATION_FOOTPRINT.halfWidth; w <= STATION_FOOTPRINT.halfWidth; w += 1) {
      const p = { x: station.x + u, z: station.lineZ + w };
      assert.equal(inBuilding(p), undefined, `${station.id} is over a building at ${u},${w}`);
      assert.equal(onRoad(p), undefined, `${station.id} is over a road surface at ${u},${w}`);
      assert.equal(underElevated(p), undefined, `${station.id} is under an elevated road at ${u},${w}`);
    }
  }
  // Lift towers and their level driveways reach the kerb without covering the carriageway.
  for (const site of metroLiftSites().filter(site => METRO_ALL_STATIONS[site.station].city)) {
    const tower = { x: site.x, z: site.z, halfWidth: LIFT_HALF + .7, halfDepth: LIFT_HALF + .7 };
    const driveway = metroGroundAccess(site)[0], kerb = { x: driveway.x, z: site.z + site.lowerDoor * (LIFT_HALF + 4.2) };
    for (const area of [tower]) for (let dx = -area.halfWidth; dx <= area.halfWidth; dx += .5) for (let dz = -area.halfDepth; dz <= area.halfDepth; dz += .5) {
      const p = { x: area.x + dx, z: area.z + dz };
      assert.equal(inBuilding(p), undefined); assert.equal(onRoad(p), undefined, `${METRO_ALL_STATIONS[site.station].id} lift tower on a road`);
    }
    assert.equal(onRoad(kerb), undefined, 'The paved driveway stops at the kerb');
    const street = { x: driveway.x, z: site.z + site.lowerDoor * (LIFT_HALF + 7.6) };
    assert.ok(onRoad(street), `${METRO_ALL_STATIONS[site.station].id} lift opens onto a real street`);
  }
});

test('the new viaduct passes over no building and clears every road it crosses', () => {
  for (const point of sampleRoute(extensionFrom, METRO_ROUTE.length, 1)) for (const offset of [-10.4, -5.5, 0, 5.5, 10.4]) {
    const p = { x: point.x - point.dirZ * offset, z: point.z + point.dirX * offset };
    assert.equal(inBuilding(p), undefined, `Viaduct over a building at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    const road = onRoad(p);
    // 4.6 m is the minimum vertical clearance over Taiwanese roads.
    if (road) assert.ok(METRO_FLOOR - 3.96 - world.elevationAt(p) > 4.6, 'Road traffic passes beneath the girder');
    const elevated = underElevated(p);
    if (elevated) assert.ok(METRO_FLOOR - 3.96 - Math.max(...[elevated.height, elevated.startHeight, elevated.endHeight].filter(h => h !== undefined)) > 5.5, 'Clears an elevated road');
  }
  // Where the girder is low over the hillside, the deck is solid to a scooter underneath.
  const metro = new MetroSystem(p => world.elevationAt(p), (p, r) => world.transportSupportClears(p, r));
  const hill = { x: 1204, z: -797 }, ground = world.elevationAt(hill);
  assert.ok(METRO_FLOOR - 3.96 - ground < 3, 'The sample point is on the low hillside stretch');
  assert.ok(metro.obstaclesAt(hill, ground).some(o => Math.abs(o.x - hill.x) <= o.halfWidth && Math.abs(o.z - hill.z) <= o.halfDepth), 'Low deck blocks a rider');
  const piers = metroSupportPiers((p, r) => world.transportSupportClears(p, r)).filter(pier => pier.x > 1050 || pier.z > -800);
  assert.ok(piers.length > 40);
  for (const pier of piers) {
    assert.ok(world.transportSupportClears(pier, 2.05), `Pier footing clear of roads at ${pier.x.toFixed(1)},${pier.z.toFixed(1)}`);
    assert.equal(inBuilding(pier), undefined);
    // Piers slide along the tangent to find clear ground, so on the curve they sit a few cm off the arc.
    assert.ok(routeDistance(pier) < 1 || Math.abs(pier.z - METRO_ALL_STATIONS.find(s => Math.abs(s.x - pier.x) < 50 && s.city)?.lineZ) < 30, 'Piers stand under the line or its platforms');
  }
});

test('station blocks, lift driveways and the space under the new viaduct are cleared of trees and street furniture', () => {
  scene.updateMatrixWorld(true);
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  const driveways = metroLiftSites().filter(site => METRO_ALL_STATIONS[site.station].city).flatMap(site => metroGroundAccess(site));
  scene.traverse(object => {
    if (!object.isInstancedMesh || /elevated|bridge|pier|expressway/i.test(object.name)) return;
    object.geometry.computeBoundingBox();
    for (let i = 0; i < object.count; i++) {
      object.getMatrixAt(i, matrix); matrix.premultiply(object.matrixWorld).decompose(position, quaternion, scale);
      if (scale.y === 0 || position.z < -950 || position.z > -500) continue;
      const top = position.y + object.geometry.boundingBox.max.y * scale.y, standing = top - world.elevationAt(position) >= .3;
      for (const area of driveways) assert.ok(!insideRect(position, area), `${object.name} left on a lift driveway`);
      if (!standing) continue;
      for (const station of city) assert.ok(!insideRect(position, { x: station.x, z: station.lineZ, halfWidth: 46, halfDepth: 30 }), `${object.name} still stands in ${station.id}`);
      if (top > METRO_FLOOR - 5.2) assert.ok(routeDistance(position, extensionFrom) > 11.5, `${object.name} reaches the new viaduct girder`);
    }
  });
});
