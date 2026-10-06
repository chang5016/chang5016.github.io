import { MetroCommuter } from './metro-commuter';
import { MetroSystem } from './metro-system';
import {NeighborhoodLife,SHOP_RESERVATIONS,SHOP_SITES,shopBounds,shopParcelElevation,planSidewalkAnimals} from './neighborhood-life';
import { intersectsBuilding } from "./game-core";
import { createMountainTunnel, tunnelFloorAt, tunnelApproachTerrain, onTunnelRoad } from "./mountain-tunnel";
import { DRAW_DISTANCE, cameraWorldPosition, fogLimit, withinDistance } from "./draw-distance";
import { planStreetProps, streetPropFootprint, combineStreetPropMeshes, createStreetPropInstances, type StreetPropKind, type StreetPropPlacement } from "./street-props";
import { freezeStaticScene, invalidateShadowScene } from "./static-scene";
import { TrafficHeightCache } from "./traffic-height-cache";
import { advanceTrafficMotion, createTrafficMotion, VEHICLE_SPECS, type TrafficMotion, type VehicleClass } from './traffic-dynamics';
import { createTrafficRig, updateTrafficRig, type TrafficRig } from './traffic-rig';
import {createMotorcycleRider,MOTORCYCLE_RIDER_URL} from './motorcycle-rider';
import { smoothTrafficPoints } from './traffic-route';
import {sampleTrafficRoute,advanceTrafficProgress,trafficTravelDistance,trafficCornerSpeed,trafficStations,findTrafficConnection,type TrafficPath,type TrafficConnection} from './traffic-path';
import {TrafficPresentation} from './traffic-presentation';
import {TrafficRenderBatches} from './traffic-render-batches';
import { planLuxuryEstate, estateWorld, type LuxuryEstateSite } from './luxury-estate-site';
import { createLuxuryEstate } from './luxury-estate';
import { TerrainBuildCache } from "./terrain-build-cache";
import { createVegetationBatches } from "./vegetation-batches";
import { StaticSceneryBatches } from "./static-scenery-batches";
import { planEstateAccess, estateGroundAt, type EstateGrade, type EstateAccessPoint } from "./estate-access";
import { createEstateFinish, createRiverbedFinish } from "./estate-finishes";
import { createTaiwanGuideSign } from "./taiwan-guide-sign";
import { createHillsideEstate } from "./hillside-estate";
import { createConcretePierMaterial } from "./concrete-pier-material";
import { clearBridgeRailIntrusions } from "./bridge-clearance";
import { StreetPropPhysics } from "./street-prop-physics";
import type { VehicleState } from "./game-core";
import * as THREE from "three";
import { BUILDING_MODELS, planStockBuildings, createStockBuildingInstances, type StockBuildingKind, type StockBuildingPlacement } from "./stock-buildings";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinnedModel } from "three/addons/utils/SkeletonUtils.js";
import {
  DISTRICT_ORIGIN,
  TAICHUNG_LOCATIONS,
  coordinatesFromLocation,
  damp,
  locationFromCoordinates,
  tileFromLocation,
  type BuildingBounds,
  type Coordinates,
} from "./game-core";
import {
  decodeTerrariumElevation,
  fallbackTerrainElevation, naturalTerrainElevation,
  MOUNTAIN_ROAD_POINTS,
  MOUNTAIN_VALLEY_POINTS,
  terrainGradeAt,
  TERRAIN_TILE_ZOOM,
  trafficLightColor,
  type TrafficLightColor,
} from "./world-terrain";
import { GridForgeCityGrid } from "./gridforge-city-grid";
import { partitionCityMesh, refreshChunkBounds } from "./city-render-chunks";
import { batchCityMesh, refreshCityBatch, disposeCityBatch } from "./city-multidraw";
import { createReliefFacade, configureFacadeMaterial } from "./facade-relief";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { terrainVisibilityNode } from "./gpu-materials";
import { planUrbanBlocks, containsRectPoint, type UrbanPaving, type UrbanRect } from "./urban-blocks";
import { facadeBands } from "./facade-layout";
import { transitionWidth } from "./road-transition";
import { fitScooterRider } from "./riding-pose";
import { SHOPPING_STREET, insideShoppingStreet, createShoppingStreetInstances, shoppingStreetPoint, shoppingTerrainElevation, isShoppingStreetSpine } from "./shopping-street";
import { metroStationTerrain, metroConcourse, metroStreetApproach, METRO_STATIONS, METRO_TERRAIN_PATCH } from "./metro-system";

const VECTOR_TILE_JSON = "https://tiles.openfreemap.org/planet";
const TERRARIUM_ELEVATION_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const VECTOR_ZOOM = 14;
const WORLD_RADIUS = 1900;
export const EXPRESSWAY_RING_HEIGHT = 6.4;

function roundedExpresswayRing(left: number, back: number, right: number, front: number, radius: number, curveSteps = 9) {
  const points: Coordinates[] = [];
  const add = (x: number, z: number) => {
    const previous = points.at(-1);
    if (!previous || Math.hypot(previous.x - x, previous.z - z) > 0.01) points.push({ x, z });
  };
  const arc = (centerX: number, centerZ: number, start: number, end: number) => {
    for (let step = 0; step <= curveSteps; step++) {
      const angle = start + (end - start) * step / curveSteps;
      add(centerX + Math.cos(angle) * radius, centerZ + Math.sin(angle) * radius);
    }
  };
  add(left + radius, back);
  add(right - radius, back);
  arc(right - radius, back + radius, -Math.PI / 2, 0);
  add(right, front - radius);
  arc(right - radius, front - radius, 0, Math.PI / 2);
  add(left + radius, front);
  arc(left + radius, front - radius, Math.PI / 2, Math.PI);
  add(left, back + radius);
  arc(left + radius, back + radius, Math.PI, Math.PI * 1.5);
  add(left + radius, back);
  return points;
}

export const EXPRESSWAY_RING_POINTS = roundedExpresswayRing(-1040, -900, 1300, 900, 180, 24);

const AUTHORED_LANDMARK_CLEARANCES = [
  { left: -236, back: -290, right: -144, front: -215 },
  { left: 246, back: -2, right: 330, front: 80 },
  { left: 462, back: 190, right: 548, front: 262 },
  { left: -472, back: -456, right: -398, front: -396 },
];

type TrafficModelKind = "car" | "taxi" | "suv" | "sports" | "motorcycle" | "bear" | "bunny" | "pig" | "motoBear";
const TRAFFIC_MODEL_URLS: Record<TrafficModelKind, string> = {
  car: "/models/traffic-real/tesla.glb?v=complete-rig-1",
  taxi: "/models/traffic-real/tesla.glb?v=complete-rig-1",
  suv: "/models/traffic-real/bmw.glb?v=complete-rig-1",
  sports: "/models/traffic-real/ferrari-spider.glb?v=complete-rig-2",
  motorcycle: "/models/traffic-real/motorcycle.glb?v=complete-rig-1",
  bear: "/models/animal-riders/bear.glb?v=juggy-rig-1",
  bunny: "/models/animal-riders/bunny.glb?v=juggy-rig-1",
  pig: "/models/animal-riders/pig.glb?v=juggy-rig-1",
  motoBear: MOTORCYCLE_RIDER_URL,
};

type TileCoordinate = { x: number; y: number; zoom: number };
type TileFeature = { properties: Record<string, unknown>; geometry: GeoJSON.Geometry };
type SceneTextures = {
  ground: THREE.CanvasTexture;
  asphalt: THREE.CanvasTexture;
  asphaltNormal: THREE.CanvasTexture;
  asphaltRoughness: THREE.CanvasTexture;
  paving: THREE.CanvasTexture;
  pavingNormal: THREE.CanvasTexture;
  pavingRoughness: THREE.CanvasTexture;
  roof: THREE.CanvasTexture;
  waterNormal: THREE.CanvasTexture;
  facades: THREE.Texture[];
};
type ElevationRaster = { tile: TileCoordinate; data: Uint8ClampedArray; width: number; height: number; reference: number };
type SignalHead = { axis: "main" | "cross"; red: THREE.Mesh; amber: THREE.Mesh; green: THREE.Mesh };
type TrafficIntersection = { key: string; position: Coordinates; heading: number; width: number; offset: number; heads: SignalHead[] };
type IntersectionCandidate = { position: Coordinates; headings: number[]; width: number; count: number };
type TrafficRoute = TrafficPath;
type TrafficVehicle = { commuter?:MetroCommuter; motion?: TrafficMotion; presentation?:TrafficPresentation; rig?: TrafficRig; desiredSpeed?: number; nextDecisionAt?: number; group: THREE.Group; visual: THREE.Group; wheels: THREE.Object3D[]; frontWheels: THREE.Object3D[]; wheelRoll: number; steerAngle: number; route: TrafficRoute; progress: number; direction: 1 | -1; speed: number; cruise: number; previousSignal: string; brakeLights: THREE.Mesh[]; rearIndicators: Array<{ mesh: THREE.Mesh; side: -1 | 1 }>; modelKind: TrafficModelKind; animalKind?: TrafficModelKind; animalMixer?: THREE.AnimationMixer; animalBones?: Array<{ bone: THREE.Bone; delta: THREE.Quaternion }>; animalHead?: THREE.Bone };
type ParkParcel = { outline: Coordinates[]; center: Coordinates; area: number; name: string };
type SchoolCampus = { position: Coordinates; radius: number; name: string; outline?: Coordinates[] };
type ElevatedRoadSegment = { roadOwner?: string; roadPriority?: number; buildingClearance?: number; surfaceHeightA?: number; surfaceHeightB?: number; footprint?: Coordinates[]; a: Coordinates; b: Coordinates; width: number; startWidth?: number; endWidth?: number; startHeight: number; endHeight: number; kitStyle: "modular" | "suspension" };
type ElevatedJunction = { position: Coordinates; radius: number; height: number };
type StreetDetail = Coordinates & { terrainAnchorX?: number; terrainAnchorZ?: number; y: number; angle: number; width?: number; height?: number; style?: number };
type BuildingArchetype = "shop" | "restaurant" | "old_apartment" | "apartment" | "residential_tower" | "office" | "department_store" | "traditional_market";
type BuildingCandidate = { distance: number; rings: Coordinates[][]; height: number; style: number; bounds: BuildingBounds; archetype: BuildingArchetype; name: string };

let activeElevationRaster: ElevationRaster | null = null;

function terrariumHeightAt(point: Coordinates, raster: ElevationRaster) {
  const location = locationFromCoordinates(point);
  const count = 2 ** raster.tile.zoom;
  const latitude = location.latitude * Math.PI / 180;
  const tileX = (location.longitude + 180) / 360 * count - raster.tile.x;
  const tileY = (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * count - raster.tile.y;
  if (tileX < 0 || tileX > 1 || tileY < 0 || tileY > 1) return null;

  const sampleX = Math.max(0, Math.min(raster.width - 1.001, tileX * raster.width));
  const sampleY = Math.max(0, Math.min(raster.height - 1.001, tileY * raster.height));
  const left = Math.floor(sampleX);
  const top = Math.floor(sampleY);
  const right = Math.min(left + 1, raster.width - 1);
  const bottom = Math.min(top + 1, raster.height - 1);
  const read = (x: number, y: number) => {
    const index = (y * raster.width + x) * 4;
    return decodeTerrariumElevation(raster.data[index], raster.data[index + 1], raster.data[index + 2]);
  };
  const horizontal = sampleX - left;
  const vertical = sampleY - top;
  const upper = read(left, top) * (1 - horizontal) + read(right, top) * horizontal;
  const lower = read(left, bottom) * (1 - horizontal) + read(right, bottom) * horizontal;
  return upper * (1 - vertical) + lower * vertical;
}

function rawCityElevationAt(point: Coordinates) {
  const fallback = fallbackTerrainElevation(point);
  if (!activeElevationRaster) return fallback;
  const actual = terrariumHeightAt(point, activeElevationRaster);
  if (actual === null || !Number.isFinite(actual)) return fallback;
  const gentleRealRelief = Math.max(-1.65, Math.min(1.65, (actual - activeElevationRaster.reference) * 0.095));
  return fallback + gentleRealRelief;
}

const estateGrades: EstateGrade[] = [];
let terrainBuildCache: { ground: TerrainBuildCache; expressway: TerrainBuildCache } | null = null;
function cityElevationAt(point: Coordinates) {
  return terrainBuildCache ? terrainBuildCache.ground.sample(point, uncachedCityElevationAt) : uncachedCityElevationAt(point);
}
function uncachedCityElevationAt(point: Coordinates) {
  const raw = tunnelApproachTerrain(point,estateGroundAt(point,rawCityElevationAt(point),estateGrades));
  const stationGround = metroStationTerrain(point, shopParcelElevation(point,raw,rawCityElevationAt), fallbackTerrainElevation);
  if (!insideShoppingStreet(point, SHOPPING_STREET.terrainPadding + SHOPPING_STREET.terrainBlend + 0.01)) return stationGround;
  return shoppingTerrainElevation(point, raw, rawCityElevationAt(SHOPPING_STREET.center));
}

// The ring and its shoulder share one transverse design level.
function expresswayGroundAt(point: Coordinates) {
  return terrainBuildCache ? terrainBuildCache.expressway.sample(point, uncachedExpresswayGroundAt) : uncachedExpresswayGroundAt(point);
}
function uncachedExpresswayGroundAt(point: Coordinates) {
  const nearSpine = (point.x >= -960 && point.x <= 1220 && Math.abs(point.z + 300) < 60)
    || (point.z >= -710 && point.z <= 710 && Math.abs(point.x + 650) < 60);
  if (!nearSpine && ((point.x > -980 && point.x < 1240 && point.z > -840 && point.z < 840)
    || point.x < -1100 || point.x > 1360 || point.z < -960 || point.z > 960)) return cityElevationAt(point);
  let nearest: Coordinates = point, best = Infinity;
  for (let i = 1; i < EXPRESSWAY_RING_POINTS.length; i++) {
    const a = EXPRESSWAY_RING_POINTS[i - 1], b = EXPRESSWAY_RING_POINTS[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const x = a.x + dx * t, z = a.z + dz * t, distance = Math.hypot(point.x - x, point.z - z);
    if (distance < best) { best = distance; nearest = { x, z }; }
  }
  for (const [a, b] of [[{ x: -900, z: -300 }, { x: 1160, z: -300 }], [{ x: -650, z: -650 }, { x: -650, z: 650 }]]) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz)));
    const x = a.x + dx * t, z = a.z + dz * t, distance = Math.hypot(point.x - x, point.z - z);
    if (distance < best) { best = distance; nearest = { x, z }; }
  }
  if (best >= 60) return cityElevationAt(point);
  const t = Math.max(0, Math.min(1, (best - 24) / 36));
  const blend = t * t * (3 - 2 * t);
  const design=(p:Coordinates)=>p.x>1100&&p.z>330&&p.z<850?naturalTerrainElevation(p):cityElevationAt(p);
  return design(nearest) * (1 - blend) + design(point) * blend;
}

function conformGeometryToTerrain(geometry: THREE.BufferGeometry, rigid = false) {
  const positions = geometry.getAttribute("position");
  if (!positions) return geometry;
  let original = geometry.getAttribute("terrainBaseY") as THREE.BufferAttribute | undefined;
  if (!original) {
    const values = new Float32Array(positions.count);
    for (let index = 0; index < positions.count; index++) values[index] = positions.getY(index);
    original = new THREE.BufferAttribute(values, 1);
    geometry.setAttribute("terrainBaseY", original);
  }
  let anchorX = geometry.getAttribute("terrainAnchorX") as THREE.BufferAttribute | undefined;
  let anchorZ = geometry.getAttribute("terrainAnchorZ") as THREE.BufferAttribute | undefined;
  if (rigid && !anchorX && !anchorZ) {
    geometry.computeBoundingBox();
    const center = geometry.boundingBox?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3();
    anchorX = new THREE.BufferAttribute(new Float32Array(positions.count).fill(center.x), 1);
    anchorZ = new THREE.BufferAttribute(new Float32Array(positions.count).fill(center.z), 1);
    geometry.setAttribute("terrainAnchorX", anchorX);
    geometry.setAttribute("terrainAnchorZ", anchorZ);
  }
  for (let index = 0; index < positions.count; index++) {
    const x = anchorX ? anchorX.getX(index) : positions.getX(index);
    const z = anchorZ ? anchorZ.getX(index) : positions.getZ(index);
    positions.setY(index, original.getX(index) + (geometry.getAttribute("expresswayAnchor") ? expresswayGroundAt({ x, z }) : cityElevationAt({ x, z })));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function deterministicNoise(x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
  return value - Math.floor(value);
}

function distanceToSegment(point: Coordinates, a: Coordinates, b: Coordinates) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const squared = dx * dx + dz * dz;
  if (squared < 0.0001) return Math.hypot(point.x - a.x, point.z - a.z);
  const progress = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / squared));
  return Math.hypot(point.x - a.x - dx * progress, point.z - a.z - dz * progress);
}

function segmentsIntersect(a: Coordinates, b: Coordinates, c: Coordinates, d: Coordinates) {
  const cross = (p: Coordinates, q: Coordinates, r: Coordinates) =>
    (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  const epsilon = 0.000001;
  const onSegment = (p: Coordinates, q: Coordinates, r: Coordinates) =>
    q.x >= Math.min(p.x, r.x) - epsilon && q.x <= Math.max(p.x, r.x) + epsilon
    && q.z >= Math.min(p.z, r.z) - epsilon && q.z <= Math.max(p.z, r.z) + epsilon;
  if (((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon))
    && ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))) return true;
  if (Math.abs(abC) <= epsilon && onSegment(a, c, b)) return true;
  if (Math.abs(abD) <= epsilon && onSegment(a, d, b)) return true;
  if (Math.abs(cdA) <= epsilon && onSegment(c, a, d)) return true;
  if (Math.abs(cdB) <= epsilon && onSegment(c, b, d)) return true;
  return false;
}

function distanceBetweenSegments(a: Coordinates, b: Coordinates, c: Coordinates, d: Coordinates) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distanceToSegment(a, c, d),
    distanceToSegment(b, c, d),
    distanceToSegment(c, a, b),
    distanceToSegment(d, a, b),
  );
}

const outlineBoundsCache = new WeakMap<readonly Coordinates[], { minX: number; maxX: number; minZ: number; maxZ: number }>();
function outlineBounds(outline: readonly Coordinates[]) {
  let bounds = outlineBoundsCache.get(outline);
  if (!bounds) {
    bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const p of outline) {
      bounds.minX = Math.min(bounds.minX, p.x); bounds.maxX = Math.max(bounds.maxX, p.x);
      bounds.minZ = Math.min(bounds.minZ, p.z); bounds.maxZ = Math.max(bounds.maxZ, p.z);
    }
    outlineBoundsCache.set(outline, bounds);
  }
  return bounds;
}

export function outlineOverlapsRoadCorridor(outline: readonly Coordinates[], a: Coordinates, b: Coordinates, halfWidth: number) {
  const bounds = outlineBounds(outline);
  if (bounds.maxX < Math.min(a.x,b.x)-halfWidth || bounds.minX > Math.max(a.x,b.x)+halfWidth ||
      bounds.maxZ < Math.min(a.z,b.z)-halfWidth || bounds.minZ > Math.max(a.z,b.z)+halfWidth) return false;
  if (pointInsideOutline(a, outline) || pointInsideOutline(b, outline)) return true;
  for (let index = 0; index < outline.length - 1; index++) {
    if (distanceBetweenSegments(outline[index], outline[index + 1], a, b) < halfWidth) return true;
  }
  return false;
}

export function outlineOverlapsElevatedRoad(outline: readonly Coordinates[], road: ElevatedRoadSegment, clearance = 4.75) {
  if (road.buildingClearance === undefined || !road.footprint) return outlineOverlapsRoadCorridor(outline,road.a,road.b,road.width/2+clearance);
  // A private driveway ends at its rectangular forecourt. A circular corridor
  // end-cap would incorrectly extend it several metres into the villa/pool.
  const footprint = road.footprint;
  if (footprint.some(p=>pointInsideOutline(p,outline)) || outline.some(p=>pointInsideOutline(p,footprint))) return true;
  for(let i=0;i<outline.length-1;i++)for(let j=0;j<footprint.length;j++) {
    if(distanceBetweenSegments(outline[i],outline[i+1],footprint[j],footprint[(j+1)%footprint.length]) < road.buildingClearance) return true;
  }
  return false;
}

function botanicalLeafTexture(maxAnisotropy: number) {
  if (typeof document === "undefined" || !document.createElement("canvas").getContext("2d")) {
    const data = new Uint8Array([
      0, 0, 0, 0, 70, 121, 59, 255, 70, 121, 59, 255, 0, 0, 0, 0,
      70, 121, 59, 255, 111, 153, 83, 255, 111, 153, 83, 255, 70, 121, 59, 255,
      70, 121, 59, 255, 111, 153, 83, 255, 111, 153, 83, 255, 70, 121, 59, 255,
      0, 0, 0, 0, 70, 121, 59, 255, 70, 121, 59, 255, 0, 0, 0, 0,
    ]);
    const texture = new THREE.DataTexture(data, 4, 4, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  const texture = canvasTexture(512, (context, size) => {
    context.clearRect(0, 0, size, size);
    for (let leaf = 0; leaf < 44; leaf++) {
      const x = size * (0.1 + deterministicNoise(leaf, 111) * 0.8);
      const y = size * (0.08 + deterministicNoise(leaf, 117) * 0.84);
      const length = 20 + deterministicNoise(leaf, 121) * 38;
      const width = length * (0.28 + deterministicNoise(leaf, 127) * 0.19);
      const angle = deterministicNoise(leaf, 131) * Math.PI * 2;
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      const gradient = context.createLinearGradient(-length / 2, 0, length / 2, 0);
      gradient.addColorStop(0, "#183d25");
      gradient.addColorStop(0.48, leaf % 3 === 0 ? "#5f8c48" : "#3e723d");
      gradient.addColorStop(1, "#244f2d");
      context.fillStyle = gradient;
      context.beginPath();
      context.moveTo(-length / 2, 0);
      context.bezierCurveTo(-length * 0.18, -width, length * 0.28, -width * 0.72, length / 2, 0);
      context.bezierCurveTo(length * 0.2, width * 0.82, -length * 0.2, width, -length / 2, 0);
      context.fill();
      context.strokeStyle = "rgba(214,230,151,.34)";
      context.lineWidth = 1.15;
      context.beginPath();
      context.moveTo(-length * 0.42, 0);
      context.lineTo(length * 0.42, 0);
      context.stroke();
      context.restore();
    }
  }, maxAnisotropy);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function layeredLeafCardGeometry() {
  const cards: THREE.BufferGeometry[] = [];
  for (let card = 0; card < 5; card++) {
    const geometry = new THREE.PlaneGeometry(2.25, 1.62, 3, 2);
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      positions.setZ(index, Math.cos(x * 2.2 + card) * 0.09 + Math.sin(y * 2.5) * 0.06);
    }
    geometry.rotateY(card * Math.PI / 5);
    geometry.rotateX((card % 2 ? 1 : -1) * 0.13);
    geometry.translate(
      (deterministicNoise(card, 31) - 0.5) * 0.34,
      (deterministicNoise(card, 37) - 0.5) * 0.24,
      (deterministicNoise(card, 41) - 0.5) * 0.34,
    );
    geometry.computeVertexNormals();
    cards.push(geometry);
  }
  const merged = mergeGeometries(cards, false);
  cards.forEach((card) => card.dispose());
  return merged;
}

function grassTuftGeometry() {
  const blades: THREE.BufferGeometry[] = [];
  for (let blade = 0; blade < 5; blade++) {
    const geometry = new THREE.PlaneGeometry(0.72, 0.92, 2, 3);
    const positions = geometry.getAttribute("position");
    for (let index = 0; index < positions.count; index++) {
      const y = positions.getY(index) + 0.46;
      positions.setY(index, y);
      positions.setX(index, positions.getX(index) * Math.max(0.08, 1 - y * 0.92));
      positions.setZ(index, positions.getZ(index) + Math.sin(y * 2.4 + blade) * 0.09);
    }
    geometry.rotateY(blade * Math.PI / 5);
    geometry.translate(Math.cos(blade * 2.1) * 0.28, 0, Math.sin(blade * 2.1) * 0.28);
    geometry.computeVertexNormals();
    blades.push(geometry);
  }
  const merged = mergeGeometries(blades, false);
  blades.forEach((blade) => blade.dispose());
  return merged;
}

function grassBladeTexture(maxAnisotropy: number) {
  if (typeof document === "undefined") {
    const texture = new THREE.DataTexture(new Uint8Array([103, 145, 73, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) {
    const texture = new THREE.DataTexture(new Uint8Array([103, 145, 73, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  }
  context.clearRect(0, 0, 128, 128);
  for (let blade = 0; blade < 19; blade++) {
    const baseX = 10 + deterministicNoise(blade, 211) * 108;
    const height = 54 + deterministicNoise(blade, 223) * 66;
    const lean = (deterministicNoise(blade, 227) - 0.5) * 24;
    const width = 2.2 + deterministicNoise(blade, 229) * 3.8;
    const green = 92 + Math.floor(deterministicNoise(blade, 233) * 48);
    const gradient = context.createLinearGradient(baseX, 128, baseX + lean, 128 - height);
    gradient.addColorStop(0, `rgba(48,82,35,.92)`);
    gradient.addColorStop(0.48, `rgba(74,${green},49,.94)`);
    gradient.addColorStop(1, `rgba(153,181,91,.72)`);
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(baseX - width, 128);
    context.quadraticCurveTo(baseX + lean * 0.32, 128 - height * 0.55, baseX + lean, 128 - height);
    context.quadraticCurveTo(baseX + lean * 0.2 + width, 128 - height * 0.45, baseX + width, 128);
    context.closePath();
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

function canvasTexture(size: number, draw: (context: CanvasRenderingContext2D, size: number) => void, maxAnisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas textures are unavailable");
  draw(context, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, maxAnisotropy);
  return texture;
}

function createTextures(maxAnisotropy: number): SceneTextures {
  const ground = canvasTexture(256, (context, size) => {
    context.fillStyle = "#7f8f74";
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 3800; index++) {
      const light = 42 + Math.floor(deterministicNoise(index, 3) * 24);
      context.fillStyle = `rgba(${light},${light + 17},${light - 2},.13)`;
      context.fillRect(deterministicNoise(index, 1) * size, deterministicNoise(index, 2) * size, 1.5, 1.5);
    }
  }, maxAnisotropy);
  ground.repeat.set(8, 8);

  const asphalt = canvasTexture(256, (context, size) => {
    const gradient = context.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, "#3a3d3e");
    gradient.addColorStop(0.52, "#454849");
    gradient.addColorStop(1, "#343738");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 5200; index++) {
      const value = 70 + Math.floor(deterministicNoise(index, 6) * 48);
      context.fillStyle = `rgba(${value},${value},${value - 2},.22)`;
      const radius = deterministicNoise(index, 7) * 1.5 + 0.25;
      context.fillRect(deterministicNoise(index, 8) * size, deterministicNoise(index, 9) * size, radius, radius);
    }
    context.strokeStyle = "rgba(21,23,23,.26)";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(14, 0);
    context.bezierCurveTo(40, 76, 18, 167, 62, size);
    context.stroke();
    context.strokeStyle = "rgba(18,20,20,.54)";
    context.lineWidth = 3.2;
    for (let patch = 0; patch < 5; patch++) {
      const x = deterministicNoise(patch, 401) * size;
      const y = deterministicNoise(patch, 409) * size;
      context.strokeRect(x, y, 28 + deterministicNoise(patch, 419) * 58, 19 + deterministicNoise(patch, 421) * 48);
    }
  }, maxAnisotropy);
  const asphaltNormal = canvasTexture(256, (context, size) => {
    context.fillStyle = "rgb(128,128,255)";
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 6500; index++) {
      const nx = 112 + Math.floor(deterministicNoise(index, 431) * 32);
      const ny = 112 + Math.floor(deterministicNoise(index, 433) * 32);
      context.fillStyle = `rgb(${nx},${ny},${238 + Math.floor(deterministicNoise(index, 439) * 17)})`;
      context.fillRect(deterministicNoise(index, 443) * size, deterministicNoise(index, 449) * size, 1.2, 1.2);
    }
  }, maxAnisotropy);
  asphaltNormal.colorSpace = THREE.NoColorSpace;
  const asphaltRoughness = canvasTexture(256, (context, size) => {
    context.fillStyle = "#d7d7d7";
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 2600; index++) {
      const value = 150 + Math.floor(deterministicNoise(index, 457) * 95);
      context.fillStyle = `rgb(${value},${value},${value})`;
      context.fillRect(deterministicNoise(index, 461) * size, deterministicNoise(index, 463) * size, 2, 2);
    }
  }, maxAnisotropy);
  asphaltRoughness.colorSpace = THREE.NoColorSpace;

  const paving = canvasTexture(256, (context, size) => {
    context.fillStyle = "#aaa59b";
    context.fillRect(0, 0, size, size);
    context.strokeStyle = "rgba(67,65,61,.32)";
    context.lineWidth = 2;
    for (let row = 0; row <= 8; row++) {
      const y = row * 32;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
      const offset = row % 2 ? 32 : 0;
      for (let x = offset; x <= size; x += 64) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + 32);
        context.stroke();
      }
    }
    context.fillStyle = "rgba(255,255,255,.09)";
    for (let index = 0; index < 500; index++) {
      context.fillRect(deterministicNoise(index, 15) * size, deterministicNoise(index, 16) * size, 1, 1);
    }
  }, maxAnisotropy);
  const pavingNormal = canvasTexture(256, (context, size) => {
    context.fillStyle = "rgb(128,128,255)";
    context.fillRect(0, 0, size, size);
    context.strokeStyle = "rgb(105,105,228)";
    context.lineWidth = 4;
    for (let row = 0; row <= 8; row++) {
      const y = row * 32;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
      for (let x = row % 2 ? 32 : 0; x <= size; x += 64) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, y + 32);
        context.stroke();
      }
    }
  }, maxAnisotropy);
  pavingNormal.colorSpace = THREE.NoColorSpace;
  const pavingRoughness = canvasTexture(256, (context, size) => {
    context.fillStyle = "#e0e0e0";
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 800; index++) {
      const value = 178 + Math.floor(deterministicNoise(index, 467) * 56);
      context.fillStyle = `rgb(${value},${value},${value})`;
      context.fillRect(deterministicNoise(index, 479) * size, deterministicNoise(index, 487) * size, 2, 2);
    }
  }, maxAnisotropy);
  pavingRoughness.colorSpace = THREE.NoColorSpace;

  const roof = canvasTexture(256, (context, size) => {
    context.fillStyle = "#777b79";
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 1900; index++) {
      const value = 94 + Math.floor(deterministicNoise(index, 20) * 47);
      context.fillStyle = `rgba(${value},${value + 1},${value},.22)`;
      context.fillRect(deterministicNoise(index, 21) * size, deterministicNoise(index, 22) * size, 2, 2);
    }
    context.strokeStyle = "rgba(50,52,51,.38)";
    context.strokeRect(12, 12, size - 24, size - 24);
    context.fillStyle = "rgba(52,56,55,.34)";
    context.fillRect(34, 48, 48, 34);
    context.fillRect(162, 139, 58, 42);
  }, maxAnisotropy);
  roof.repeat.set(0.055, 0.055);

  const waterNormal = canvasTexture(128, (context, size) => {
    context.fillStyle = "rgb(128,128,255)";
    context.fillRect(0, 0, size, size);
    for (let wave = 0; wave < 22; wave++) {
      const y = wave / 22 * size;
      context.strokeStyle = wave % 2 ? "rgb(113,140,247)" : "rgb(143,116,250)";
      context.lineWidth = 1.6;
      context.beginPath();
      for (let x = -8; x <= size + 8; x += 4) {
        const ripple = Math.sin(x * 0.115 + wave * 1.73) * 3.4 + Math.sin(x * 0.041 - wave) * 2.1;
        if (x === -8) context.moveTo(x, y + ripple);
        else context.lineTo(x, y + ripple);
      }
      context.stroke();
    }
  }, maxAnisotropy);
  waterNormal.colorSpace = THREE.NoColorSpace;
  waterNormal.repeat.set(0.055, 0.22);

  const facadeDefinitions = [
    { wall: "#d1c6b5", inset: "#b9aa96", glass: "#61808b", frame: "#373c3c", balcony: "#857c70" },
    { wall: "#abb4b0", inset: "#939e9b", glass: "#557883", frame: "#323b3d", balcony: "#66716f" },
    { wall: "#c19c82", inset: "#a68068", glass: "#69818a", frame: "#4a3d36", balcony: "#745f53" },
    { wall: "#d8d4c9", inset: "#b9b8b0", glass: "#5b7d8b", frame: "#3b4142", balcony: "#85837d" },
  ];
  const facades = facadeDefinitions.map((palette, style) => {
    const texture = canvasTexture(512, (context, size) => {
      const gradient = context.createLinearGradient(0, 0, size, 0);
      gradient.addColorStop(0, palette.inset);
      gradient.addColorStop(0.14, palette.wall);
      gradient.addColorStop(0.84, palette.wall);
      gradient.addColorStop(1, palette.inset);
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
      context.fillStyle = "rgba(37,42,43,.34)";
      context.fillRect(66, 72, 380, 296);
      const glass = context.createLinearGradient(0, 72, 0, 368);
      glass.addColorStop(0, "#b9d1d5");
      glass.addColorStop(0.3, palette.glass);
      glass.addColorStop(0.65, "#334b54");
      glass.addColorStop(1, "#799097");
      context.fillStyle = glass;
      context.fillRect(78, 84, 356, 268);
      context.strokeStyle = palette.frame;
      context.lineWidth = 17;
      context.strokeRect(68, 74, 376, 288);
      context.lineWidth = 10;
      context.beginPath();
      context.moveTo(256, 78);
      context.lineTo(256, 358);
      context.stroke();
      context.fillStyle = "rgba(219,235,235,.23)";
      context.beginPath();
      context.moveTo(95, 92);
      context.lineTo(240, 92);
      context.lineTo(128, 338);
      context.lineTo(90, 338);
      context.closePath();
      context.fill();
      if (style !== 1) {
        context.fillStyle = palette.balcony;
        context.fillRect(42, 376, 428, 26);
        context.fillStyle = "rgba(38,42,42,.5)";
        for (let x = 55; x < 462; x += 32) context.fillRect(x, 398, 7, 66);
        context.fillRect(48, 458, 416, 11);
      } else {
        context.fillStyle = "rgba(225,235,232,.46)";
        context.fillRect(30, 30, 12, 452);
        context.fillRect(470, 30, 12, 452);
      }
      context.fillStyle = "rgba(55,51,46,.24)";
      context.fillRect(0, 488, size, 24);
      for (let index = 0; index < 900; index++) {
        context.fillStyle = `rgba(52,48,43,${deterministicNoise(index, style + 32) * 0.035})`;
        context.fillRect(deterministicNoise(index, style + 33) * size, deterministicNoise(index, style + 34) * size, 1.5, 1.5);
      }
    }, maxAnisotropy);
    // Facade geometry preserves photographic aspect ratios in floor-height
    // modules instead of stretching one square image over an entire tower.
    texture.repeat.set(1, 1);
    return texture;
  });

  return { ground, asphalt, asphaltNormal, asphaltRoughness, paving, pavingNormal, pavingRoughness, roof, waterNormal, facades };
}

function polygonCoordinates(geometry: GeoJSON.Geometry): number[][][][] {
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

function lineCoordinates(geometry: GeoJSON.Geometry): number[][][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function localPoint(coordinate: number[]) {
  return coordinatesFromLocation({ longitude: coordinate[0], latitude: coordinate[1] });
}

function localPolygon(polygon: number[][][]) {
  return polygon.map((ring) => ring.map(localPoint));
}

function pointGeometryCoordinates(geometry: GeoJSON.Geometry): Coordinates[] {
  if (geometry.type === "Point") return [localPoint(geometry.coordinates)];
  if (geometry.type === "MultiPoint") return geometry.coordinates.map(localPoint);
  return [];
}

function outlineSummary(outline: Coordinates[]) {
  const left = Math.min(...outline.map((point) => point.x));
  const right = Math.max(...outline.map((point) => point.x));
  const back = Math.min(...outline.map((point) => point.z));
  const front = Math.max(...outline.map((point) => point.z));
  return {
    left,
    right,
    back,
    front,
    center: { x: (left + right) / 2, z: (back + front) / 2 },
    area: Math.max(0, (right - left) * (front - back)),
  };
}

function pointInsideOutline(point: Coordinates, outline: readonly Coordinates[]) {
  const bounds = outlineBounds(outline);
  if (point.x < bounds.minX || point.x > bounds.maxX || point.z < bounds.minZ || point.z > bounds.maxZ) return false;
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const current = outline[index];
    const before = outline[previous];
    if ((current.z > point.z) !== (before.z > point.z)
      && point.x < (before.x - current.x) * (point.z - current.z) / (before.z - current.z) + current.x) {
      inside = !inside;
    }
  }
  return inside;
}

function featureDescription(properties: Record<string, unknown>) {
  return [properties.class, properties.subclass, properties.kind, properties.amenity, properties.name, properties.name_en]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

function makeShape(rings: Coordinates[][]) {
  const outline = rings[0];
  if (!outline || outline.length < 4) return null;
  const shape = new THREE.Shape();
  outline.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, -point.z);
    else shape.lineTo(point.x, -point.z);
  });
  for (const interior of rings.slice(1)) {
    const hole = new THREE.Path();
    interior.forEach((point, index) => {
      if (index === 0) hole.moveTo(point.x, -point.z);
      else hole.lineTo(point.x, -point.z);
    });
    shape.holes.push(hole);
  }
  return shape;
}

function flatPolygonGeometry(rings: Coordinates[][], height: number, followTerrain = false) {
  const shape = makeShape(rings);
  if (!shape) return null;
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height, 0);
  return conformGeometryToTerrain(geometry, !followTerrain);
}

type RoadPoint = Coordinates & { miter?: Coordinates };
function miterRoadGeometry(geometry: THREE.BufferGeometry, a: RoadPoint, b: RoadPoint) {
  if (!a.miter || !b.miter) return geometry;
  const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
  if (length < .01) return geometry;
  const nx = -dz / length, nz = dx / length;
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) - a.x, z = positions.getZ(i) - a.z;
    const t = Math.max(0, Math.min(1, (x * dx + z * dz) / (length * length)));
    const lateral = x * nx + z * nz;
    positions.setX(i, positions.getX(i) + lateral * (a.miter.x + (b.miter.x - a.miter.x) * t - nx));
    positions.setZ(i, positions.getZ(i) + lateral * (a.miter.z + (b.miter.z - a.miter.z) * t - nz));
  }
  const anchorX = new Float32Array(positions.count), anchorZ = new Float32Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    const t = Math.max(0, Math.min(1, ((positions.getX(i) - a.x) * dx + (positions.getZ(i) - a.z) * dz) / (length * length)));
    anchorX[i] = a.x + dx * t; anchorZ[i] = a.z + dz * t;
  }
  geometry.setAttribute("expresswayAnchor", new THREE.BufferAttribute(new Float32Array(positions.count).fill(1), 1));
  geometry.setAttribute("terrainAnchorX", new THREE.BufferAttribute(anchorX, 1));
  geometry.setAttribute("terrainAnchorZ", new THREE.BufferAttribute(anchorZ, 1));
  return geometry;
}

function roadSegmentGeometry(a: RoadPoint, b: RoadPoint, width: number, height: number, endHeight = height, endWidth = width) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.35) return null;
  const geometry = new THREE.PlaneGeometry(width, length, 1, Math.max(1, Math.min(18, Math.ceil(length / 16))));
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(Math.atan2(-dx, -dz));
  geometry.translate((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
  const positions = geometry.getAttribute("position");
  const squared = Math.max(length * length, 0.0001);
  for (let index = 0; index < positions.count; index++) {
    const progress = Math.max(0, Math.min(1, ((positions.getX(index) - a.x) * dx + (positions.getZ(index) - a.z) * dz) / squared));
    positions.setY(index, height + (endHeight - height) * progress);
    const lateral = ((positions.getX(index) - a.x) * -dz + (positions.getZ(index) - a.z) * dx) / length;
    const change = lateral * ((width + (endWidth - width) * progress) / width - 1);
    positions.setX(index, positions.getX(index) - dz / length * change);
    positions.setZ(index, positions.getZ(index) + dx / length * change);
  }
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index++) {
    uv.setXY(index, uv.getX(index) * width / 4, uv.getY(index) * length / 4);
  }
  return conformGeometryToTerrain(miterRoadGeometry(geometry, a, b));
}

function roadJointGeometry(point: Coordinates, radius: number, height: number) {
  const geometry = new THREE.CircleGeometry(radius, 16);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(point.x, height, point.z);
  return conformGeometryToTerrain(geometry);
}

function offsetRoadSegmentGeometry(a: RoadPoint, b: RoadPoint, width: number, height: number, offset: number, endHeight = height, endOffset = offset) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.35) return null;
  const normalX = -dz / length;
  const normalZ = dx / length;
  const geometry = roadSegmentGeometry(
    { x: a.x + normalX * offset, z: a.z + normalZ * offset },
    { x: b.x + normalX * endOffset, z: b.z + normalZ * endOffset },
    width,
    height,
    endHeight,
  );
  if (geometry && a.miter && b.miter) {
    const normal = { x: normalX, z: normalZ };
    return conformGeometryToTerrain(miterRoadGeometry(geometry, { ...a, miter: normal }, { ...b, miter: normal }));
  }
  return geometry;
}

function roadWidth(properties: Record<string, unknown>) {
  const authoredWidth = Number(properties.render_width ?? 0);
  if (Number.isFinite(authoredWidth) && authoredWidth >= 4.8 && authoredWidth <= 24) return authoredWidth;
  const roadClass = String(properties.class ?? properties.subclass ?? "minor");
  const lanes = Number(properties.lanes ?? properties["lanes:forward"] ?? 0);
  if (Number.isFinite(lanes) && lanes >= 1 && lanes <= 8) return Math.max(4.8, lanes * 3.1 + 0.9);
  if (roadClass === "motorway" || roadClass === "trunk") return 17.8;
  if (roadClass === "primary") return 13.3;
  if (roadClass === "secondary") return 11.2;
  if (roadClass === "tertiary") return 9.4;
  if (roadClass === "service") return 4.9;
  if (roadClass === "path" || roadClass === "track") return 2.5;
  return 6.8;
}

function wallGeometry(outline: Coordinates[], height: number, base = 0) {
  const positions: number[] = [];
  const uvs: number[] = [];
  let travelled = 0;
  for (let index = 0; index < outline.length - 1; index++) {
    const a = outline[index];
    const b = outline[index + 1];
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance < 0.25) continue;
    positions.push(
      a.x, base, a.z, b.x, base, b.z, b.x, height, b.z,
      a.x, base, a.z, b.x, height, b.z, a.x, height, a.z,
    );
    uvs.push(
      travelled, base, travelled + distance, base, travelled + distance, height,
      travelled, base, travelled + distance, height, travelled, height,
    );
    travelled += distance;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return conformGeometryToTerrain(geometry, true);
}

function scaledOutline(outline: Coordinates[], center: Coordinates, scale: number) {
  return outline.map((point) => ({
    x: center.x + (point.x - center.x) * scale,
    z: center.z + (point.z - center.z) * scale,
  }));
}

function facadeWallGeometry(outline: Coordinates[], height: number, base: number, completeHeight: number, bayWidth = 12, moduleHeight = completeHeight, style?: number, groundHeight = 4.1) {
  if(style!==undefined)return conformGeometryToTerrain(createReliefFacade(outline,height,base,style,groundHeight),true);
  const positions: number[] = [];
  const uvs: number[] = [];
  const safeHeight = Math.max(moduleHeight, 0.01);
  for (let index = 0; index < outline.length - 1; index++) {
    const a = outline[index];
    const b = outline[index + 1];
    const distance = Math.hypot(b.x - a.x, b.z - a.z);
    if (distance < 0.25) continue;
    const bands = style === undefined ? [{ bottom: base, top: height, lowerV: base / safeHeight, upperV: height / safeHeight, width: bayWidth }]
      : facadeBands(base, height, groundHeight, style);
    for (const band of bands) {
    const bays = distance / band.width;
    const { lowerV, upperV } = band;
    positions.push(
      a.x, band.bottom, a.z, b.x, band.bottom, b.z, b.x, band.top, b.z,
      a.x, band.bottom, a.z, b.x, band.top, b.z, a.x, band.top, a.z,
    );
    uvs.push(
      0, lowerV, bays, lowerV, bays, upperV,
      0, lowerV, bays, upperV, 0, upperV,
    );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  return conformGeometryToTerrain(geometry, true);
}

function bridgeRailGeometry(a: RoadPoint, b: RoadPoint, width: number, startHeight: number, endHeight: number, side: number, endWidth = width) {
  const endDepth=(height:number)=>.82*THREE.MathUtils.smoothstep(height,.12,1.5);
  const first=endDepth(startHeight),last=endDepth(endHeight);
  if(Math.max(first,last)<.001)return null;
  return bridgeBeamGeometry(a, b, .28, Math.max(.001,first), startHeight+first/2, endHeight+last/2, side*(width/2+.1),side*(endWidth/2+.1),Math.max(.001,last));
}

function bridgeBeamGeometry(a: RoadPoint, b: RoadPoint, width: number, depth: number, startHeight: number, endHeight: number, offset: number, endOffset = offset, endDepth = depth) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.35) return null;
  const normalX = -dz / length;
  const normalZ = dx / length;
  const geometry = new THREE.BoxGeometry(width, depth, length);
  geometry.rotateY(Math.atan2(-dx, -dz));
  geometry.translate(
    (a.x + b.x) / 2 + normalX * offset,
    (startHeight + endHeight) / 2,
    (a.z + b.z) / 2 + normalZ * offset,
  );
  const vertices = geometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const t = Math.max(0, Math.min(1, ((vertices.getX(i) - a.x) * dx + (vertices.getZ(i) - a.z) * dz) / (length * length)));
    const centre=(startHeight+endHeight)/2;
    vertices.setY(i, centre+(vertices.getY(i)-centre)*(1+(endDepth-depth)/depth*t)+(endHeight-startHeight)*(t-.5));
    vertices.setX(i, vertices.getX(i) + normalX * (endOffset - offset) * t);
    vertices.setZ(i, vertices.getZ(i) + normalZ * (endOffset - offset) * t);
  }
  if(endDepth!==depth)geometry.computeVertexNormals();
  return conformGeometryToTerrain(miterRoadGeometry(geometry, a, b));
}

function mergeOrDispose(geometries: THREE.BufferGeometry[]) {
  if (geometries.length === 0) return null;
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  return merged;
}

function authoredLine(points: Coordinates[], properties: Record<string, unknown>): TileFeature {
  points = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i-1].x, p.z - points[i-1].z) > .0001);
  return {
    properties,
    geometry: {
      type: "LineString",
      coordinates: points.map((point) => {
        const location = locationFromCoordinates(point);
        return [location.longitude, location.latitude];
      }),
    },
  };
}

function authoredParcel(left: number, back: number, right: number, front: number, properties: Record<string, unknown>): TileFeature {
  return {
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [[
        { x: left, z: back },
        { x: right, z: back },
        { x: right, z: front },
        { x: left, z: front },
        { x: left, z: back },
      ].map((point) => {
        const location = locationFromCoordinates(point);
        return [location.longitude, location.latitude];
      })],
    },
  };
}

function authoredSignatureBridge(): TileFeature {
  return authoredLine([
    { x: 465, z: -300 },
    { x: 540, z: -300 },
    { x: 620, z: -300 },
    { x: 700, z: -300 },
    { x: 775, z: -300 },
  ], { class: "primary", lanes: 4, render_width: 16, layer: 2, brunnel: "bridge", continuous_elevated: true, elevated_height: 5.7, kit_style: "suspension", name: "道路套件晴川懸索大橋" });
}

function designedExpresswayLine(points: Coordinates[], properties: Record<string, unknown>) {
  const spec: Record<string, unknown> = { ...properties, render_width: properties.class === "primary" ? 16 : 7.2 };
  if (/市區快速道路地面|南環轉南北|南北高架轉北/.test(String(properties.name))) {
    spec.render_width = 16; spec.lanes = 4; spec.mainline_connector = true;
  } else if (properties.ramp_direction) {
    spec.start_width = properties.ramp_direction === "down" || Number(properties.base_elevated_height) > 0 ? 10.8 : 7.2;
    spec.end_width = properties.ramp_direction === "up" || Number(properties.base_elevated_height) > 0 ? 10.8 : 7.2;
  }
  if (properties.two_way) {
    const width = Number(properties.approach_width ?? 7.1);
    spec.render_width = spec.start_width = spec.end_width = width;
    spec.lanes = width > 10 ? 4 : 2;
  }
  if (String(properties.name).includes("側市區快速道路地面")) {
    spec.base_elevated_height = EXPRESSWAY_RING_HEIGHT;
    spec.name = String(properties.name).replace("地面入口", "環線轉接匝道").replace("地面出口", "環線轉接匝道");
  }
  if (!properties.ramp_direction) return authoredLine(points, spec);
  const start = { ...points[0] }, end = { ...points[points.length - 1] };
  const name = String(properties.name);
  if (name.includes("南環轉")) start.x -= 180;
  if (name.includes("轉北環")) end.x += 180;
  // Meet the ring at its inner shoulder, not across the through carriageway.
  // Keep a 1.6 m shared pavement strip throughout the parallel merge lane.
  const ringJoinOffset = 8 + Number(spec.end_width ?? spec.render_width) / 2 - 1.6;
  const moveToShoulder = (point: Coordinates) => {
    if (Math.abs(point.z - 900) < .01) point.z -= ringJoinOffset;
    else if (Math.abs(point.z + 900) < .01) point.z += ringJoinOffset;
    else if (Math.abs(point.x + 1040) < .01) point.x += ringJoinOffset;
    else if (Math.abs(point.x - 1300) < .01) point.x -= ringJoinOffset;
  };
  moveToShoulder(start); moveToShoulder(end);
  // Reserve room for a monotonic quarter turn, rather than doubling back over
  // the mainline where the inner parapet would cross the ramp's own pavement.
  if (name.includes('西側市區快速道路')) start.z -= 160;
  if (name.includes('東側市區快速道路')) end.z += 160;
  if (name.includes("半定向")) {
    const shiftSpinePort = (point: Coordinates, neighbor: Coordinates) => {
      if (Math.abs(point.z + 300) < .01) point.z += Math.sign(neighbor.z - point.z) * 11.8;
      else if (Math.abs(point.x + 650) < .01) point.x += Math.sign(neighbor.x - point.x) * 11.8;
    };
    shiftSpinePort(start, points[1]); shiftSpinePort(end, points[points.length - 2]);
  }
  const dx = end.x - start.x, dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  const tangent = (p: Coordinates, fallback: Coordinates) => {
    if (Math.abs(Math.abs(p.z) - 900) < 17) return { x: Math.sign(dx) || 1, z: 0 };
    if (Math.abs(p.x + 1040) < 17 || Math.abs(p.x - 1300) < 17) return { x: 0, z: Math.sign(dz) || 1 };
    if (name.includes("半定向")) return Math.abs(p.z + 300) < 13
      ? { x: Math.sign(dx), z: 0 } : { x: 0, z: Math.sign(dz) };
    const d = Math.hypot(fallback.x, fallback.z) || 1;
    return { x: fallback.x / d, z: fallback.z / d };
  };
  const a = tangent(start, { x: points[1].x - start.x, z: points[1].z - start.z });
  const b = tangent(end, { x: end.x - points[points.length - 2].x, z: end.z - points[points.length - 2].z });
  if (name.includes("半定向")) {
    // Reserve approach distance on the adjacent shoulder before changing level.
    start.x -= a.x * 50; start.z -= a.z * 50;
    end.x += b.x * 50; end.z += b.z * 50;
  }
  const compactRamp = !spec.mainline_connector && !name.includes("半定向");
  const landing = compactRamp ? Math.min(24, length * .14) : Math.min(70, length * .3);
  const startElevated = properties.ramp_direction === "down" || Number(spec.base_elevated_height) > 0;
  const endElevated = properties.ramp_direction === "up" || Number(spec.base_elevated_height) > 0;
  spec.start_landing = startElevated ? landing + (compactRamp ? 10 : 22) : 12;
  spec.end_landing = endElevated ? landing + (compactRamp ? 10 : 22) : 12;
  const curveStart = { x: start.x + a.x * landing, z: start.z + a.z * landing };
  const curveEnd = { x: end.x - b.x * landing, z: end.z - b.z * landing };
  const handle = Math.hypot(curveEnd.x - curveStart.x, curveEnd.z - curveStart.z) * (compactRamp ? .32 : .48);
  const c1 = { x: curveStart.x + a.x * handle, z: curveStart.z + a.z * handle };
  const c2 = { x: curveEnd.x - b.x * handle, z: curveEnd.z - b.z * handle };
  const curve = [start, ...Array.from({ length: 65 }, (_, i) => {
    const t = i / 64, u = 1 - t;
    return { x: u*u*u*curveStart.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*curveEnd.x,
      z: u*u*u*curveStart.z + 3*u*u*t*c1.z + 3*u*t*t*c2.z + t*t*t*curveEnd.z };
  }), end];
  const terminal = (point: Coordinates, tangent: Coordinates, sign: number) => {
    let nearest: Coordinates | null = null, distance = Infinity;
    const lines = [...EXPRESSWAY_RING_POINTS.slice(1).map((b, i) => [EXPRESSWAY_RING_POINTS[i], b]),
      [{ x: -900, z: -300 }, { x: 1160, z: -300 }], [{ x: -650, z: -650 }, { x: -650, z: 650 }]];
    for (const [a, b] of lines) {
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const q = { x: a.x + dx * t, z: a.z + dz * t }, d = Math.hypot(point.x - q.x, point.z - q.z);
      if (d < distance) { distance = d; nearest = q; }
    }
    if (!nearest || distance < 8 || distance > 17) return null;
    const terminalWidth = spec.mainline_connector ? 16 : properties.two_way ? Number(spec.render_width) : 2.8;
    const shoulderOffset=Math.max(0,8-terminalWidth/2-.12);
    const run = spec.mainline_connector ? 96 : properties.two_way ? 72 : compactRamp ? 32 : 64;
    const points = Array.from({ length: 33 }, (_, i) => {
      const t = i / 32, smooth = t * t * (3 - 2 * t);
      const base={x:point.x+tangent.x*sign*run*t,z:point.z+tangent.z*sign*run*t};
      let target=nearest!,best=Infinity;
      for(const [a,b] of lines){
        const dx=b.x-a.x,dz=b.z-a.z;
        const u=Math.max(0,Math.min(1,((base.x-a.x)*dx+(base.z-a.z)*dz)/(dx*dx+dz*dz||1)));
        const q={x:a.x+dx*u,z:a.z+dz*u},d=Math.hypot(base.x-q.x,base.z-q.z);
        if(d<best){best=d;target=q;}
      }
      const nx=(base.x-target.x)/(best||1),nz=(base.z-target.z)/(best||1);
      return { x:base.x+(target.x+nx*shoulderOffset-base.x)*smooth,
        z:base.z+(target.z+nz*shoulderOffset-base.z)*smooth };
    });
    const arcLength = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.z - points[i].z), 0);
    return { points, arcLength };
  };
  const entry = startElevated ? terminal(start, a, -1) : null;
  const exit = endElevated ? terminal(end, b, 1) : null;
  if (entry) {
    curve.unshift(...entry.points.slice(1).reverse());
    spec.merge_start_length = entry.arcLength;
    spec.start_landing = Number(spec.start_landing) + entry.arcLength;
  }
  if (exit) {
    curve.push(...exit.points.slice(1));
    spec.merge_end_length = exit.arcLength;
    spec.end_landing = Number(spec.end_landing) + exit.arcLength;
  }
  return authoredLine(curve, spec);
}

export function authoredExpresswayPlan() {
  const ring = designedExpresswayLine(EXPRESSWAY_RING_POINTS, {
    class: "primary",
    lanes: 4,
    layer: 1,
    brunnel: "bridge",
    continuous_elevated: true,
    elevated_height: EXPRESSWAY_RING_HEIGHT,
    name: "海灣都會環狀快速道路",
  });
  const ramps = [
    [{ x: -650, z: 760 }, { x: -650, z: 810 }, { x: -670, z: 858 }, { x: -690, z: 900 }],
    [{ x: 340, z: -760 }, { x: 340, z: -815 }, { x: 360, z: -862 }, { x: 382, z: -900 }],
    [{ x: -860, z: 270 }, { x: -920, z: 270 }, { x: -980, z: 250 }, { x: -1040, z: 226 }],
    [{ x: 1160, z: -430 }, { x: 1212, z: -430 }, { x: 1258, z: -410 }, { x: 1300, z: -382 }],
  ].map((points, index) => designedExpresswayLine(points, {
    class: "secondary",
    lanes: 2,
    layer: 1,
    brunnel: "bridge",
    ramp_direction: "up",
    two_way: true, oneway: false, approach_width: index < 3 ? 13.3 : 7.1,
    elevated_height: EXPRESSWAY_RING_HEIGHT,
    name: ["北城交流道", "南港交流道", "西城交流道", "東河交流道"][index],
  }));
  const ringExits = [
    [{ x: -560, z: 900 }, { x: -560, z: 858 }, { x: -560, z: 810 }, { x: -560, z: 760 }],
    [{ x: 470, z: -900 }, { x: 470, z: -858 }, { x: 470, z: -810 }, { x: 470, z: -760 }],
    [{ x: -1040, z: 100 }, { x: -980, z: 100 }, { x: -920, z: 100 }, { x: -860, z: 100 }],
    [{ x: 1300, z: -180 }, { x: 1258, z: -170 }, { x: 1212, z: -155 }, { x: 1160, z: -150 }],
  ].map((points, index) => designedExpresswayLine(points, {
    class: "secondary",
    lanes: 2,
    layer: 1,
    brunnel: "bridge",
    ramp_direction: "down",
    elevated_height: EXPRESSWAY_RING_HEIGHT,
    name: ["北城分離式出口", "南港分離式出口", "西城分離式出口", "東河分離式出口"][index],
  }));
  const centralSpines = [
    designedExpresswayLine([{ x: -900, z: -300 }, { x: -650, z: -300 }, { x: -400, z: -300 }, { x: 120, z: -300 }, { x: 300, z: -300 }, { x: 465, z: -300 }], {
      class: "primary", lanes: 4, layer: 1, brunnel: "bridge", continuous_elevated: true, elevated_height: 5.7, name: "東西向市區架高快速道路西段",
    }),
    designedExpresswayLine([{ x: 775, z: -300 }, { x: 960, z: -300 }, { x: 1160, z: -300 }], {
      class: "primary", lanes: 4, layer: 1, brunnel: "bridge", continuous_elevated: true, elevated_height: 5.7, name: "東西向市區架高快速道路東段",
    }),
    designedExpresswayLine([{ x: -650, z: -650 }, { x: -650, z: -450 }, { x: -650, z: -150 }, { x: -650, z: 150 }, { x: -650, z: 450 }, { x: -650, z: 650 }], {
      class: "primary", lanes: 4, layer: 2, brunnel: "bridge", continuous_elevated: true, elevated_height: 12.7, name: "南北向市區第二層快速道路",
    }),
  ];
  const cityInterchangeRamps = [
    designedExpresswayLine([{ x: -1040, z: -300 }, { x: -970, z: -300 }, { x: -900, z: -300 }], { class: "secondary", lanes: 2, layer: 1, brunnel: "bridge", ramp_direction: "up", elevated_height: 5.7, name: "西側市區快速道路地面入口" }),
    designedExpresswayLine([{ x: 1160, z: -300 }, { x: 1230, z: -300 }, { x: 1300, z: -300 }], { class: "secondary", lanes: 2, layer: 1, brunnel: "bridge", ramp_direction: "down", elevated_height: 5.7, name: "東側市區快速道路地面出口" }),
    designedExpresswayLine([{ x: -650, z: -900 }, { x: -650, z: -780 }, { x: -650, z: -650 }], { class: "secondary", lanes: 2, layer: 1, brunnel: "bridge", ramp_direction: "up", base_elevated_height: EXPRESSWAY_RING_HEIGHT, elevated_height: 12.7, name: "南環轉南北高架匝道" }),
    designedExpresswayLine([{ x: -650, z: 650 }, { x: -650, z: 780 }, { x: -650, z: 900 }], { class: "secondary", lanes: 2, layer: 1, brunnel: "bridge", ramp_direction: "down", base_elevated_height: EXPRESSWAY_RING_HEIGHT, elevated_height: 12.7, name: "南北高架轉北環匝道" }),
    designedExpresswayLine([{ x: -810, z: -300 }, { x: -770, z: -245 }, { x: -710, z: -190 }, { x: -650, z: -150 }], { class: "secondary", lanes: 2, layer: 2, brunnel: "bridge", ramp_direction: "up", base_elevated_height: 5.7, elevated_height: 12.7, name: "西向轉北向半定向匝道" }),
    designedExpresswayLine([{ x: -650, z: -450 }, { x: -600, z: -420 }, { x: -545, z: -365 }, { x: -495, z: -300 }], { class: "secondary", lanes: 2, layer: 2, brunnel: "bridge", ramp_direction: "down", base_elevated_height: 5.7, elevated_height: 12.7, name: "南向轉東向半定向匝道" }),
    designedExpresswayLine([{ x: -495, z: -300 }, { x: -540, z: -245 }, { x: -595, z: -190 }, { x: -650, z: -150 }], { class: "secondary", lanes: 2, layer: 2, brunnel: "bridge", ramp_direction: "up", base_elevated_height: 5.7, elevated_height: 12.7, name: "東向轉北向半定向匝道" }),
    designedExpresswayLine([{ x: -650, z: -450 }, { x: -705, z: -415 }, { x: -765, z: -360 }, { x: -810, z: -300 }], { class: "secondary", lanes: 2, layer: 2, brunnel: "bridge", ramp_direction: "down", base_elevated_height: 5.7, elevated_height: 12.7, name: "南向轉西向半定向匝道" }),
  ];
  return { ring, ramps, ringExits, centralSpines, cityInterchangeRamps };
}

export class RealWorldMap {
  readonly buildings: BuildingBounds[] = [];
  spawnPoint: (Coordinates & { heading: number }) | null = null;

  private readonly group = new THREE.Group();
  private readonly textures: SceneTextures;
  private readonly disposableMaterials: THREE.Material[] = [];
  private readonly disposableTextures: THREE.Texture[] = [];
  private stockBuildingTemplates=new Map<StockBuildingKind,THREE.Object3D>();
  private stockBuildingEntries: Array<{ placement: StockBuildingPlacement; fallback: THREE.Group; collider: BuildingBounds }> = [];
  private streetPropPlacements: StreetPropPlacement[] = [];
  private urbanPaving: UrbanPaving[] = [];
  private urbanGardens: UrbanRect[] = [];
  private staticRenderBatches = new StaticSceneryBatches();
  private streetPropCells: THREE.Group | null = null;
  private readonly streetPropSphere = new THREE.Sphere();
  private readonly streetPropTemplates = new Map<StreetPropKind, THREE.Object3D>();
  private streetPropColliders: Array<BuildingBounds & {base:number;height:number}> = [];
  private streetPropPhysics?: StreetPropPhysics;
  private estateTemplatePromise?:Promise<THREE.Group>;
  private neighborhoodLife?:NeighborhoodLife;
  private readonly facadeMaterials: (THREE.MeshStandardMaterial | MeshStandardNodeMaterial)[] = [];
  private readonly schoolFacadeMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly streetSegments: Array<{ a: Coordinates; b: Coordinates; width: number }> = [];
  private readonly roadJunctions: Array<{ position: Coordinates; radius: number }> = [];
  private readonly parkParcels: ParkParcel[] = [];
  private readonly schoolCampuses: SchoolCampus[] = [];
  private readonly elevatedSegments: ElevatedRoadSegment[] = [];
  private readonly elevatedJunctions: ElevatedJunction[] = [];
  private readonly bridgePierColliders: BuildingBounds[] = [];
  private readonly elevatedSegmentGrid = new GridForgeCityGrid<ElevatedRoadSegment>(64);
  private readonly bridgePierGrid = new GridForgeCityGrid<BuildingBounds>(64);
  private readonly riverSurfaces: THREE.MeshPhysicalMaterial[] = [];
  private readonly waterChannels: Array<{ a: Coordinates; b: Coordinates; width: number; depth: number }> = [];
  private readonly roadSurfaceMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly trafficIntersections: TrafficIntersection[] = [];
  private readonly trafficRoutes: TrafficRoute[] = [];
  private readonly trafficVehicles: TrafficVehicle[] = [];
  private readonly trafficModelTemplates = new Map<TrafficModelKind, THREE.Object3D>();
  private readonly trafficModelAnimations = new Map<TrafficModelKind, THREE.AnimationClip[]>();
  private signalMaterials: Record<TrafficLightColor | "off", THREE.MeshStandardMaterial> | null = null;
  private liveDistrictLoaded = false;
  private readonly maxAnisotropy: number;
  private stopped = false;
  private qualityLevel: 0 | 1 | 2 = 0;
  private buildingCollisionGrid?: GridForgeCityGrid<BuildingBounds>;
  private indexedBuildingCount = -1;
  private signalGrid?: GridForgeCityGrid<TrafficIntersection>;
  private indexedSignalCount = -1;
  private trafficHeights = new WeakMap<TrafficRoute, Map<number, TrafficHeightCache>>();
  private trafficConnections = new WeakMap<TrafficRoute, Map<number,TrafficConnection|null>>();
  private trafficRenderBatches?:TrafficRenderBatches;
  private tunnelLights: THREE.PointLight[] = [];
  private nextSignalUpdate = 0;
  private readonly trafficHeadRotation = new THREE.Quaternion();
  private readonly trafficHeadAxis = new THREE.Vector3(0, 1, 0);

  constructor(private readonly scene: THREE.Scene, maxAnisotropy: number) {
    this.maxAnisotropy = Math.min(maxAnisotropy, 8);
    this.textures = createTextures(maxAnisotropy);
    this.group.name = "Fictional Taiwanese physical three-dimensional city";
    this.scene.add(this.group);
    const groundMaterial = new MeshStandardNodeMaterial({ color: "#9da195", map: this.textures.ground, roughness: 0.98 });
    groundMaterial.maskNode = terrainVisibilityNode();
    this.disposableMaterials.push(groundMaterial);
    const terrainGeometry = new THREE.PlaneGeometry(5000, 5000, 96, 96);
    terrainGeometry.rotateX(-Math.PI / 2);
    terrainGeometry.translate(0, -0.11, 0);
    const terrainPositions = terrainGeometry.getAttribute("position");
    for (let index = 0; index < terrainPositions.count; index++) {
      const x = terrainPositions.getX(index);
      const z = terrainPositions.getZ(index);
      terrainGeometry.getAttribute("uv").setXY(index, x / 64, z / 64);
      if (x > 1010 && x < 2310 && z > 200 && z < 930) terrainPositions.setY(index, terrainPositions.getY(index) - 30);
    }
    const base = new THREE.Mesh(conformGeometryToTerrain(terrainGeometry), groundMaterial);
    base.name = "Level urban ground with distant mountain foothills";
    base.receiveShadow = true;
    const mountainTerrainGeometry = new THREE.PlaneGeometry(1320, 740, 220, 124);
    mountainTerrainGeometry.rotateX(-Math.PI / 2);
    mountainTerrainGeometry.translate(1660, -0.105, 565);
    const mountainPositions = mountainTerrainGeometry.getAttribute("position");
    for (let i = 0; i < mountainPositions.count; i++) mountainTerrainGeometry.getAttribute("uv").setXY(i, mountainPositions.getX(i) / 64, mountainPositions.getZ(i) / 64);
    const mountainTerrain = new THREE.Mesh(conformGeometryToTerrain(mountainTerrainGeometry), groundMaterial);
    mountainTerrain.name = "High-resolution mountain terrain fitted around the driveable road";
    mountainTerrain.receiveShadow = true;
    this.group.add(base, mountainTerrain);
    // The original 52 m terrain triangles cannot represent an excavated lift
    // forecourt. Replace each parcel with a 2 m grid, using the same physics datum.
    const parcelMaterial = groundMaterial.clone();
    parcelMaterial.maskNode = terrainVisibilityNode(false, true);
    this.disposableMaterials.push(parcelMaterial);
    for (const station of METRO_STATIONS) {
      const patch = METRO_TERRAIN_PATCH;
      const geometry = new THREE.PlaneGeometry(patch.width, patch.depth, patch.width / 2, patch.depth / 2);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(station.x + patch.offsetX, -.11, patch.z);
      const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 64, p.getZ(i) / 64);
      const parcel = new THREE.Mesh(conformGeometryToTerrain(geometry), parcelMaterial);
      parcel.name = `${station.id} excavated and feathered station terrain / 2 m survey grid`;
      parcel.receiveShadow = true; parcel.userData.metroTerrain = station.id;
      this.group.add(parcel);
    }
    this.renderAuthoredDistrict();
    freezeStaticScene(this.group);
    if (typeof window !== "undefined") {
      this.loadSuppliedRoadPackStructures();
      this.loadSuppliedDistrictAssets();
      this.loadTrafficModelTemplates();
      void this.loadStreetPropAssets();
      void this.loadStockBuildingAssets();
      const blocked=(point:Coordinates)=>this.nearbyStaticObstacles(point,2,cityElevationAt(point)).some(box=>Math.abs(point.x-box.x)<box.halfWidth+.65&&Math.abs(point.z-box.z)<box.halfDepth+.65);
      this.neighborhoodLife=new NeighborhoodLife(this.group,cityElevationAt,planSidewalkAnimals(this.streetSegments,this.buildings,blocked),blocked);
      this.neighborhoodLife.ready.catch(()=>{this.group.userData.neighborhoodAssetError=true;});
    }
    this.loadPhotographicFacades();
  }

  private renderAuthoredDistrict() {
    estateGrades.length = 0;
    const previous = terrainBuildCache;
    const cache = { ground: new TerrainBuildCache(), expressway: new TerrainBuildCache() };
    terrainBuildCache = cache;
    try {
      this.buildAuthoredDistrict();
      this.staticRenderBatches ??= new StaticSceneryBatches();
      this.group.add(this.staticRenderBatches.group);
      const vegetation: THREE.InstancedMesh[] = [];
      this.group.traverse(object => {
        if (!(object as THREE.InstancedMesh).isInstancedMesh) return;
        for(let ancestor:THREE.Object3D|null=object;ancestor;ancestor=ancestor.parent)if(ancestor.userData.dynamicWorldObject)return;
        vegetation.push(object as THREE.InstancedMesh);
      });
      for (const source of vegetation) {
        if(this.staticRenderBatches.register(source))continue;
        const batches = createVegetationBatches(source);
        if (!batches || !source.parent) continue;
        source.parent.add(batches); source.removeFromParent(); source.dispose();
      }
    }
    finally {
      this.group.userData.terrainBuildCache = {
        hits: cache.ground.hits + cache.expressway.hits,
        misses: cache.ground.misses + cache.expressway.misses,
      };
      terrainBuildCache = previous;
    }
  }

  private buildAuthoredDistrict() {
    const rowCoordinates = [-760, -610, -460, -300, -110, 90, 270, 460, 620, 760];
    const columnCoordinates = [-860, -650, -480, -250, 0, 120, 340, 560, 780, 960, 1160];
    const horizontalAlleys = [-690, -535, -385, -205, -18, 180, 365, 540, 690];
    const verticalAlleys = [-750, -365, -130, 230, 450, 720, 870, 1060];
    const allRows = [...new Set([...rowCoordinates, ...horizontalAlleys])].sort((a, b) => a - b);
    const allColumns = [...new Set([...columnCoordinates, ...verticalAlleys])].sort((a, b) => a - b);
    const roads: TileFeature[] = [];
    const riverBridges: TileFeature[] = [];
    const horizontalRoads = [
      { z: -760, lanes: 2, roadClass: "tertiary", name: "南港路" },
      { z: -610, lanes: 4, roadClass: "secondary", name: "臨港路" },
      { z: -460, lanes: 2, roadClass: "tertiary", name: "南町路" },
      { z: -110, lanes: 4, roadClass: "secondary", name: "民景路" },
      { z: 90, lanes: 2, roadClass: "tertiary", name: "學府路" },
      { z: 270, lanes: 4, roadClass: "secondary", name: "中央路" },
      { z: 460, lanes: 2, roadClass: "tertiary", name: "北安路" },
      { z: 620, lanes: 4, roadClass: "secondary", name: "北城路" },
      { z: 760, lanes: 2, roadClass: "tertiary", name: "山景路" },
    ];
    const addRiverCrossingRoad = (z: number, roadClass: string, lanes: number, name: string) => {
      roads.push(authoredLine([z === 270 ? -860 : -900, ...allColumns.filter((x) => x <= 560 && (z !== 270 || x >= -860)), 565].map((x) => ({ x, z })), { class: roadClass, lanes, name }));
      roads.push(authoredLine([675, ...allColumns.filter((x) => x >= 720), 1200].map((x) => ({ x, z })), { class: roadClass, lanes, name }));
      riverBridges.push(authoredLine([{ x: 565, z }, { x: 620, z }, { x: 675, z }], {
        class: roadClass,
        lanes,
        layer: 1,
        brunnel: "bridge",
        urban_crossing: true,
        name: `${name}河橋`,
      }));
    };
    horizontalRoads.forEach((road) => addRiverCrossingRoad(road.z, road.roadClass, road.lanes, road.name));
    roads.push(authoredLine([-900, -860, -650, -480, -250, 0, 120].map((x) => ({ x, z: -300 })), { class: "primary", lanes: 6, name: "海灣大道" }));
    roads.push(authoredLine([825, 960, 1160, 1200].map((x) => ({ x, z: -300 })), { class: "primary", lanes: 6, name: "海灣大道" }));

    const verticalRoads = [
      { x: -860, lanes: 2, roadClass: "tertiary", name: "西城路" },
      { x: -650, lanes: 4, roadClass: "secondary", name: "港西路" },
      { x: -480, lanes: 2, roadClass: "tertiary", name: "市場路" },
      { x: -250, lanes: 4, roadClass: "secondary", name: "港角路" },
      { x: 0, lanes: 2, roadClass: "tertiary", name: "生活路" },
      { x: 120, lanes: 6, roadClass: "primary", name: "晴川大道" },
      { x: 340, lanes: 4, roadClass: "secondary", name: "商務路" },
      { x: 560, lanes: 2, roadClass: "tertiary", name: "河濱路" },
      { x: 780, lanes: 4, roadClass: "secondary", name: "東城路" },
      { x: 960, lanes: 2, roadClass: "tertiary", name: "新興路" },
      { x: 1160, lanes: 4, roadClass: "secondary", name: "東環路" },
    ];
    verticalRoads.forEach((road) => roads.push(authoredLine(
      [road.x === 340 ? -760 : -820, ...allRows.filter(z => (road.x !== 340 || z >= -760) && (road.x !== -650 || z <= 760)), road.x === -650 ? 760 : 820].map((z) => ({ x: road.x, z })),
      { class: road.roadClass, lanes: road.lanes, name: road.name },
    )));

    horizontalAlleys.forEach((z, index) => addRiverCrossingRoad(z, index % 3 === 0 ? "service" : "minor", 1, index % 2 === 0 ? "安居巷" : "日常弄"));
    verticalAlleys.forEach((x, index) => roads.push(authoredLine(allRows.map((z) => ({ x, z })), {
      class: index % 3 === 0 ? "service" : "minor",
      lanes: 1,
      name: index % 2 === 0 ? "安居巷" : "日常弄",
    })));
    roads.push(authoredLine(MOUNTAIN_ROAD_POINTS, { class: "tertiary", lanes: 2, name: "望岳景觀道路", mountain_road: true }));
    roads.push(authoredLine(MOUNTAIN_VALLEY_POINTS, { class:"tertiary",lanes:2,name:"東嶺景觀道路",mountain_road:true }));

    const parks = [
      authoredParcel(28, -82, 89, 250, { class: "park", name: "中央綠園道" }),
      authoredParcel(580, 100, 599, 170, { class: "park", name: "河濱公園西岸" }),
      authoredParcel(651, 100, 665, 170, { class: "park", name: "河濱公園東岸" }),
      authoredParcel(-825, 525, -690, 675, { class: "park", name: "西城運動公園" }),
      authoredParcel(985, -705, 1125, -565, { class: "park", name: "東港滯洪公園" }),
    ];
    const campuses = [authoredParcel(-470, 102, -390, 170, { class: "school", name: "海灣市立國小" })];
    const structures: TileFeature[] = [];
    const reserved = [
      { left: -232, back: -286, right: -148, front: -219 },
      { left: 250, back: 2, right: 326, front: 76 },
      { left: 466, back: 194, right: 544, front: 258 },
      { left: -468, back: -452, right: -402, front: -400 },
      { left: 20, back: -90, right: 96, front: 260 },
      { left: 572, back: 92, right: 660, front: 178 },
      { left: -478, back: 94, right: -382, front: 178 },
      { left: 588, back: -820, right: 662, front: 820 },
      { left: -835, back: 515, right: -680, front: 685 },
      { left: 975, back: -715, right: 1135, front: -555 },
      { left: 970, back: 550, right: 1050, front: 610 },
      // Dedicated block for the user-supplied Taiwanese low-rise streetscape.
      SHOPPING_STREET.parcel,
      ...SHOP_RESERVATIONS,
    ];
    const denseColumns = [-860, -750, -650, -480, -365, -250, -130, 0, 120, 230, 340, 450, 560, 675, 720, 780, 870, 960, 1060, 1160];
    const denseRows = [-760, -690, -610, -535, -460, -385, -300, -205, -110, -18, 90, 180, 270, 365, 460, 540, 620, 690, 760];
    const overlapsReserved = (left: number, back: number, right: number, front: number) => reserved.some((area) =>
      right > area.left && left < area.right && front > area.back && back < area.front,
    );
    const addBuilding = (left: number, back: number, right: number, front: number, buildingType: BuildingArchetype, zone: string, seed: number) => {
      if (right - left < 5.5 || front - back < 8 || overlapsReserved(left, back, right, front)) return;
      const center = { x: (left + right) / 2, z: (back + front) / 2 };
      if (TAICHUNG_LOCATIONS.some((location) => Math.hypot(center.x - coordinatesFromLocation(location).x, center.z - coordinatesFromLocation(location).z) < 13)) return;
      const baseHeight = buildingType === "office" ? 30 : buildingType === "residential_tower" ? 38 : buildingType === "old_apartment" ? 11 : buildingType === "shop" || buildingType === "restaurant" ? 7 : 13;
      const variation = buildingType === "office" || buildingType === "residential_tower" ? 26 : buildingType === "old_apartment" ? 8 : 13;
      structures.push(authoredParcel(left, back, right, front, {
        render_height: Math.round((baseHeight + deterministicNoise(seed, Math.round(center.x + center.z)) * variation) / 3.3) * 3.3,
        building_type: buildingType,
        archetype: buildingType,
        zone,
      }));
    };

    for (let row = 0; row < denseRows.length - 1; row++) {
      for (let column = 0; column < denseColumns.length - 1; column++) {
        const cellLeft = denseColumns[column] + 7.4;
        const cellRight = denseColumns[column + 1] - 7.4;
        const cellBack = denseRows[row] + 7.4;
        const cellFront = denseRows[row + 1] - 7.4;
        const usableWidth = cellRight - cellLeft;
        const usableDepth = cellFront - cellBack;
        if (usableWidth < 14 || usableDepth < 18) continue;

        const centerX = (cellLeft + cellRight) / 2;
        const centerZ = (cellBack + cellFront) / 2;
        const outerDistrict = Math.abs(centerX) > 790 || Math.abs(centerZ) > 545;
        const zone = centerZ < -360 && centerX < -180 ? "traditional"
          : centerZ < -120 && centerX < 260 ? "commercial"
          : centerX > 180 && centerX < 560 && centerZ > -220 && centerZ < 350 ? "office"
          : "residential";
        const targetFrontage = outerDistrict ? 54 : zone === "traditional" ? 24 : zone === "commercial" ? 27 : zone === "office" ? 46 : 38;
        const parcels = Math.max(1, Math.floor(usableWidth / targetFrontage));
        const gap = zone === "office" ? 7.2 : zone === "residential" ? 6.2 : 4.1;
        const frontage = usableWidth / parcels;
        const depth = zone === "office" ? Math.min(29, usableDepth * 0.39) : Math.min(zone === "residential" ? 24 : 19, usableDepth * 0.39);
        const courtyardRoom = usableDepth - depth * 2;
        // Both street frontages belong to the block, with a usable courtyard
        // between them instead of alternate roads facing vacant grass.
        const twoFronts = !outerDistrict && courtyardRoom > 12;

        for (let parcel = 0; parcel < parcels; parcel++) {
          const left = cellLeft + parcel * frontage + gap / 2;
          const right = cellLeft + (parcel + 1) * frontage - gap / 2;
          const chooseType = (frontSide: boolean): BuildingArchetype => {
            if (outerDistrict) return (parcel + row) % 3 === 0 ? "shop" : "old_apartment";
            if (zone === "traditional") return parcel % 4 === 0 ? "restaurant" : "old_apartment";
            if (zone === "commercial") return (parcel + row + (frontSide ? 1 : 0)) % 3 === 0 ? "restaurant" : "shop";
            if (zone === "office") return parcel % 3 === 2 ? "residential_tower" : "office";
            return (parcel + column + row) % 5 === 0 ? "residential_tower" : "apartment";
          };
          addBuilding(left, cellBack, right, cellBack + depth, chooseType(false), zone, row * 101 + column * 11 + parcel);
          if (twoFronts) addBuilding(left, cellFront - depth, right, cellFront, chooseType(true), zone, row * 151 + column * 17 + parcel + 47);
        }
      }
    }

    structures.push(
      authoredParcel(-232, -286, -148, -219, { render_height: 38, building_type: "department_store", zone: "commercial", name: "晴川百貨" }),
      authoredParcel(250, 2, 326, 76, { render_height: 58, building_type: "office", zone: "office", name: "海灣金融中心" }),
      authoredParcel(466, 194, 544, 258, { render_height: 66, building_type: "residential_tower", zone: "residential", name: "河景之森" }),
      authoredParcel(-468, -452, -402, -400, { render_height: 14, building_type: "traditional_market", zone: "traditional", name: "南町市場" }),
    );

    const river = authoredLine([
      { x: 616, z: -980 },
      { x: 616, z: -820 },
      { x: 624, z: -560 },
      { x: 628, z: -260 },
      { x: 616, z: -30 },
      { x: 630, z: 230 },
      { x: 620, z: 500 },
      { x: 632, z: 820 },
      { x: 628, z: 980 },
    ], { class: "river", width: 38 });
    const bridge = authoredSignatureBridge();
    const expressway = authoredExpresswayPlan();

    this.identifySchoolCampuses(campuses, []);
    this.renderGroundFeatures([], parks, [], campuses);
    this.renderRiverChannels([river], []);
    const elevatedRoads = [...riverBridges, bridge, expressway.ring, ...expressway.ramps, ...expressway.ringExits, ...expressway.centralSpines, ...expressway.cityInterchangeRamps];
    this.renderRoads([...roads, ...elevatedRoads]);
    this.renderElevatedRoads(elevatedRoads);
    const tunnelPoints=Array.from({length:125},(_,i)=>({x:1590+i*5,z:510}));
    this.trafficRoutes.push({points:tunnelPoints,width:8.15,length:620,district:'mountain',heightAt:distance=>tunnelFloorAt(1590+distance)-.082});
    this.createRoadTraffic();
    // A fixed curb-lane start keeps the first camera view inside the finished
    // streetscape and well clear of the multi-level interchange footprint.
    this.spawnPoint = { x: -92, z: -110, heading: Math.PI / 2 };
    this.renderMountainRoadside(MOUNTAIN_ROAD_POINTS);
    this.renderMountainRoadside(MOUNTAIN_VALLEY_POINTS,false);
    const tunnelConcrete=createConcretePierMaterial();tunnelConcrete.side=THREE.DoubleSide;
    const tunnelAsphalt=new THREE.MeshStandardMaterial({color:'#777b7a',map:this.textures.asphalt,normalMap:this.textures.asphaltNormal,roughness:.94,side:THREE.DoubleSide});
    const excavatedTunnel=createMountainTunnel(tunnelAsphalt,tunnelConcrete);
    this.tunnelLights = excavatedTunnel.userData.tunnelLights;
    const tunnelMaterials=new Set<THREE.Material>();excavatedTunnel.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.isMesh)(Array.isArray(mesh.material)?mesh.material:[mesh.material]).forEach(m=>tunnelMaterials.add(m));});
    this.disposableMaterials.push(...tunnelMaterials);this.group.add(excavatedTunnel);
    const tunnelSign=createTaiwanGuideSign('山腹隧道','Mountain Tunnel','right',false);
    tunnelSign.group.position.set(1581,cityElevationAt({x:1581,z:519}),519);this.disposableMaterials.push(...tunnelSign.materials);this.group.add(tunnelSign.group);
    for(const [x,z,title,english] of [[2185,518,'東嶺景觀道路','East Ridge Scenic Road'],[2255,695,'觀景台 500公尺','Scenic Viewpoint 500 m']] as const){
      const sign=createTaiwanGuideSign(title,english,'right',false);sign.group.position.set(x,cityElevationAt({x,z}),z);this.disposableMaterials.push(...sign.materials);this.group.add(sign.group);
    }

    this.renderTaiwanGuideSigns();
    this.renderTaiwanRoadFurniture();
    this.renderBuildings(structures);
    this.buildings.push(...SHOP_SITES.map(shopBounds));
    this.renderShopForecourts();
    this.renderUrbanBlocks(denseColumns, denseRows, reserved);
    this.renderShoppingStreetGround();
    this.renderUrbanGrassDetail();
    this.renderParkLandmarks();
    this.renderSchoolLandmarks();
    this.renderStreetLighting();
    this.renderStreetLife();
    this.auditSpatialLayout();
    // World-wide merged facades defeated frustum and shadow-camera culling.
    // Keep every triangle, but submit only the spatial chunks cameras can see.
    for (const child of [...this.group.children]) {
      if (!(child as THREE.Mesh).isMesh || (child as THREE.InstancedMesh).isInstancedMesh || /terrain|Level urban ground|Water|water|riverbed/i.test(child.name)) continue;
      const mesh = child as THREE.Mesh;
      if (Array.isArray(mesh.material) || mesh.material.transparent) continue;
      const batch=batchCityMesh(mesh);
      if(batch){
        mesh.add(batch);mesh.geometry.setDrawRange(0,0);mesh.userData.spatialChunks=batch.userData.cityMultidraw.sourceDraws;
        // Keep CPU source geometry for refitting, without uploading a second
        // city-wide buffer. Child layers are independent from this parent.
        mesh.layers.disableAll();continue;
      }
      const chunks = partitionCityMesh(mesh);
      if (chunks) {
        // Preserve the named source surface for refitting/inspection. Its tight
        // child ranges render the exact same triangles, rather than the whole city.
        for(const chunk of [...chunks.children])mesh.add(chunk);
        mesh.geometry.setDrawRange(0,0);mesh.userData.spatialChunks=mesh.children.length;
      }
    }
  }

  private async loadStockBuildingAssets() {
    for(const path of ['urban-office','premium-towers'])try {
      const model=(await new GLTFLoader().loadAsync(`/models/buildings/${path}.glb`)).scene;
      const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      model.traverse(object => {
        const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
        if(this.stopped)mesh.geometry.dispose();
        for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
          materials.add(material);
          for(const value of Object.values(material))if(value instanceof THREE.Texture){value.anisotropy=this.maxAnisotropy;textures.add(value);}
        }
      });
      if(this.stopped){materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());return;}
      this.disposableMaterials.push(...materials);this.disposableTextures.push(...textures);
      if(path==='urban-office')this.stockBuildingTemplates.set('urban-office',model);
      else for(const kind of Object.keys(BUILDING_MODELS) as StockBuildingKind[]){const building=model.getObjectByName(kind);if(building)this.stockBuildingTemplates.set(kind,building);}
      this.renderStockBuildingAssets();
    } catch { /* Keep complete original buildings if this optional model cannot load. */ }
  }

  private renderStockBuildingAssets() {
    if(!this.stockBuildingTemplates?.size || !this.stockBuildingEntries?.length)return;
    for(const child of [...this.group.children])if(child.userData.stockBuildingBatch || child.userData.stockBuildingPlaza){
      child.traverse(object=>{const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;if((object as THREE.InstancedMesh).isInstancedMesh)(object as THREE.InstancedMesh).dispose();else mesh.geometry.dispose();});child.removeFromParent();
    }
    const loadedEntries=this.stockBuildingEntries.filter(entry=>this.stockBuildingTemplates.has(entry.placement.kind));
    const placements=loadedEntries.map(entry=>entry.placement);
    const batch=createStockBuildingInstances(this.stockBuildingTemplates,placements,cityElevationAt);
    const forecourts:THREE.BufferGeometry[]=[];
    for(const {placement:p,fallback,collider} of loadedEntries){
      fallback.visible=false;
      Object.assign(collider,p.bounds);
      const anchorPad = (geometry:THREE.BufferGeometry) => {
        const count=geometry.getAttribute('position').count;
        geometry.setAttribute('terrainAnchorX',new THREE.BufferAttribute(new Float32Array(count).fill(p.x),1));
        geometry.setAttribute('terrainAnchorZ',new THREE.BufferAttribute(new Float32Array(count).fill(p.z),1));
        return conformGeometryToTerrain(geometry,true);
      };
      const pad=new THREE.BoxGeometry(p.bounds.halfWidth*2+.6,.14,p.bounds.halfDepth*2+.6);
      pad.translate(p.x,p.y-.085,p.z);forecourts.push(anchorPad(pad));
      const side=p.sidewalkZ<p.z?-1:1,front=p.z+side*(p.bounds.halfDepth+.25);
      const pathLength=Math.abs(front-p.sidewalkZ);
      if(pathLength>.05){const walk=new THREE.BoxGeometry(5.6,.14,pathLength);walk.translate(p.x,p.y-.085,(front+p.sidewalkZ)/2);forecourts.push(anchorPad(walk));}
    }
    const geometry=mergeOrDispose(forecourts);
    if(geometry){
      // Use the city's existing paving at a physical tile scale, with a full
      // foundation pad and an entrance path meeting the existing sidewalk.
      const positions=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
      for(let i=0;i<positions.count;i++)uv.setXY(i,positions.getX(i)/4,positions.getZ(i)/4);
      const material=new THREE.MeshStandardMaterial({map:this.textures.paving,roughness:.88,color:'#d5d4ca'});this.disposableMaterials.push(material);
      const pavement=new THREE.Mesh(geometry,material);pavement.name='Stock office foundations and connected entrance courts';pavement.receiveShadow=true;pavement.userData.stockBuildingPlaza=true;this.group.add(pavement);
    }
    this.group.add(batch);
    const kinds=Object.fromEntries(Object.keys(BUILDING_MODELS).map(kind=>[kind,placements.filter(p=>p.kind===kind).length]));
    this.group.userData.stockBuildingAudit={buildings:placements.length,kinds,drawCalls:batch.userData.drawCalls,sourceDrawCalls:placements.reduce((sum,p)=>sum+(p.kind==='urban-office'?7:1),0)};
    this.buildingCollisionGrid=undefined;this.indexedBuildingCount=-1;
    freezeStaticScene(this.group);
  }

  private async loadStreetPropAssets() {
    const loader = new GLTFLoader();
    const retain = (model: THREE.Object3D) => {
      const materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
      model.traverse(object=>{
        const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
        for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
          materials.add(material);const pbr=material as THREE.MeshStandardMaterial;
          for(const texture of [pbr.map,pbr.normalMap,pbr.roughnessMap,pbr.metalnessMap,pbr.aoMap])if(texture){texture.anisotropy=this.maxAnisotropy;textures.add(texture);}
        }
      });
      this.disposableMaterials.push(...materials);this.disposableTextures.push(...textures);
    };
    const results=await Promise.allSettled(['bench','hydrant','pot','plant'].map(async kind=>({kind,model:(await loader.loadAsync(`/models/street-props/${kind}.glb`)).scene})));
    const loaded=new Map<string,THREE.Object3D>();
    for(const result of results)if(result.status==='fulfilled'){
      const {kind,model}=result.value;
      if(this.stopped){model.traverse(object=>{const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;mesh.geometry.dispose();for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){for(const value of Object.values(material))if(value instanceof THREE.Texture)value.dispose();material.dispose();}});continue;}
      retain(model);loaded.set(kind,model);
    }
    if(this.stopped)return;
    for(const kind of ['bench','hydrant'] as const){const model=loaded.get(kind);if(model)this.streetPropTemplates.set(kind,combineStreetPropMeshes(model));}
    const pot=loaded.get('pot'),plant=loaded.get('plant');
    if(pot&&plant){
      const planter=new THREE.Group();plant.position.y=.345;planter.add(pot,plant);
      const soilMaterial=new THREE.MeshStandardMaterial({color:'#3a2c1f',map:this.textures.ground,roughness:1});this.disposableMaterials.push(soilMaterial);
      const soil=new THREE.Mesh(new THREE.CylinderGeometry(.212,.212,.018,24),soilMaterial);soil.position.y=.354;planter.add(soil);
      this.streetPropTemplates.set('planter',combineStreetPropMeshes(planter));
    }else for(const model of [pot,plant])model?.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.isMesh)mesh.geometry.dispose();});
    this.renderStreetPropAssets();
  }

  private renderStreetPropAssets() {
    if(!this.streetPropTemplates?.size)return;
    this.streetPropPhysics?.dispose();
    for(const child of [...this.group.children])if(child.userData.streetPropBatch){child.traverse(object=>{if((object as THREE.InstancedMesh).isInstancedMesh)(object as THREE.InstancedMesh).dispose();});child.removeFromParent();}
    const placements=[...(this.streetPropPlacements??[])];
    const estate=this.group.userData.luxuryEstateSite as LuxuryEstateSite|undefined;
    if(estate) {
      // Reuse the complete photographed PBR planter/plant models in a planned
      // garden strip and pool terrace; they share the city's existing buffers.
      for(const [x,z,raised] of [[-30,-26,.16],[-22,-26,.16],[-14,-26,.16],[-30,-19,.16],[-22,-19,.16],[-14,-19,.16],[-34,-3,.16],[34,-3,.16],[-34,18,.16],[34,18,.16],[-10,-13,0],[10,-13,0],[33,-27,0],[33,-17,0]]) {
        const p=estateWorld(estate,x,z);placements.push({...p,kind:'planter',angle:estate.angle,y:estate.floor-cityElevationAt(p)+raised+.012});
      }
      for(const [x,z,turn] of [[33,-22,Math.PI/2],[-9,-25,-Math.PI/2],[-19,-13,0],[19,-12,0]]) {
        const p=estateWorld(estate,x,z);placements.push({...p,kind:'bench',angle:estate.angle+turn,y:estate.floor-cityElevationAt(p)+.012});
      }
    }
    const instances=createStreetPropInstances(this.streetPropTemplates,placements,cityElevationAt);
    this.group.add(instances);
    this.streetPropCells=instances;
    const physics=new StreetPropPhysics(instances,this.streetPropTemplates,cityElevationAt,(point,height)=>this.nearbyStaticObstacles(point,7,height));
    this.streetPropPhysics=physics;
    for(const [kind,name] of [['bench','Street-side wooden public benches'],['hydrant','Physical Taiwanese fire hydrants']] as const){
      if(!this.streetPropTemplates.has(kind)||!placements.some(p=>p.kind===kind))continue;
      const old=this.group.getObjectByName(name) as THREE.InstancedMesh|undefined;
      if(old){old.removeFromParent();old.geometry.dispose();old.dispose();}
    }
    this.streetPropColliders=placements.filter(p=>this.streetPropTemplates.has(p.kind)).map(p=>({...streetPropFootprint(p,0,true),base:p.y,height:p.kind==='bench'?1.11:p.kind==='hydrant'?.78:1.65}));
    this.group.userData.streetPropAudit={planned:placements.length,loaded:this.streetPropColliders.length,assetKinds:[...this.streetPropTemplates.keys()]};
    void physics.ready.then(()=>{
      if(this.stopped||this.streetPropPhysics!==physics)return;
      this.streetPropColliders=placements.filter(p=>p.kind==='hydrant'&&this.streetPropTemplates.has(p.kind)).map(p=>({...streetPropFootprint(p,0,true),base:p.y,height:.78}));
      this.group.userData.streetPropAudit.physics=true;
    }).catch(error=>console.warn('Street furnishing physics unavailable; keeping installed colliders',error));
    freezeStaticScene(this.group);
  }

  stepStreetPropPhysics(before:VehicleState,after:VehicleState,beforeHeight:number,height:number,dt:number){
    const impact=this.streetPropPhysics?.step(before,after,beforeHeight,height,dt)??null;
    if(impact?.kind==='hydrant')this.streetPropColliders=this.streetPropPhysics!.props.map(prop=>prop.placement).filter(p=>p.kind==='hydrant'&&!this.streetPropPhysics!.brokenHydrants.has(p)).map(p=>({...streetPropFootprint(p,0,true),base:p.y,height:.78}));
    return impact;
  }
  renderStreetPropPhysics(alpha:number){this.streetPropPhysics?.render(alpha);}

  private async loadSuppliedDistrictAssets() {
    // Keep the Draco decoder out of the server Worker. It is needed only after
    // the browser starts streaming the optional district scenery.
    const { DRACOLoader } = await import("three/addons/loaders/DRACOLoader.js");
    if (this.stopped) return;
    const manager = new THREE.LoadingManager();
    const draco = new DRACOLoader(manager);
    draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader(manager);
    loader.setDRACOLoader(draco);
    manager.onLoad = () => draco.dispose();

    const retainMaterials = (root: THREE.Object3D) => {
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = this.qualityLevel === 0;
        mesh.receiveShadow = true;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(material);
          const standard = material as THREE.MeshStandardMaterial;
          for (const texture of [standard.map, standard.normalMap, standard.roughnessMap, standard.metalnessMap]) {
            if (!texture) continue;
            texture.anisotropy = this.maxAnisotropy;
            textures.add(texture);
          }
        }
      });
      this.disposableMaterials.push(...materials);
      this.disposableTextures.push(...textures);
    };
    const disposeLateAsset = (root: THREE.Object3D) => root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
    const fitAt = (root: THREE.Object3D, scale: number, target: Coordinates, name: string) => {
      root.name = name;
      root.scale.setScalar(scale);
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      const center = bounds.getCenter(new THREE.Vector3());
      root.position.set(target.x - center.x, cityElevationAt(target) - bounds.min.y, target.z - center.z);
      root.updateMatrixWorld(true);
      root.userData.source = "User-supplied optimized GLB";
      root.userData.terrainFitted = true;
      retainMaterials(root);
      this.group.add(root);
      freezeStaticScene(this.group);
    };

    loader.load("/models/environment/taiwan-street-intact.glb", (asset) => {
      if (this.stopped) return disposeLateAsset(asset.scene);
      // Both full rows share the original geometry and textures. The road datum,
      // not the lowest underground foundation vertex, determines grounding.
      retainMaterials(asset.scene);
      const road = this.group.getObjectByName("Continuous shopping boulevard and side-street aprons") as THREE.Mesh;
      this.group.add(createShoppingStreetInstances(asset.scene, cityElevationAt(SHOPPING_STREET.center), road?.material as THREE.Material | undefined));
      freezeStaticScene(this.group);
    });
    loader.load("/models/environment/park-facilities-optimized.glb", (asset) => {
      if (this.stopped) return disposeLateAsset(asset.scene);
      const removable: THREE.Object3D[] = [];
      asset.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.computeBoundingBox();
        const size = mesh.geometry.boundingBox?.getSize(new THREE.Vector3());
        if (/plane_grass/i.test(mesh.name) || (size && size.x > 1200 && size.z > 1200 && size.y < 20)) removable.push(mesh);
      });
      removable.forEach((object) => object.removeFromParent());
      fitAt(asset.scene, 0.014, { x: -758, z: 600 }, "User-supplied complete park facilities");
    });
  }

  private renderShoppingStreetGround() {
    const r = SHOPPING_STREET.parcel;
    const surfaceRectangle = (left: number, back: number, right: number, front: number, height: number) => {
      const geometry = new THREE.PlaneGeometry(right - left, front - back, Math.ceil((right - left) / 2), Math.ceil((front - back) / 2));
      geometry.rotateX(-Math.PI / 2);
      geometry.translate((left + right) / 2, height, (back + front) / 2);
      const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
      for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / 4, position.getZ(i) / 4);
      return conformGeometryToTerrain(geometry);
    };
    const pad = surfaceRectangle(r.left, r.back, r.right, r.front, 0.012);
    const paving = new THREE.MeshStandardMaterial({ color: "#aaa79b", map: this.textures.paving, roughness: 0.95 });
    const base = new THREE.Mesh(pad, paving);
    base.name = "Level continuous shopping-street plaza foundation";
    base.receiveShadow = true;
    this.disposableMaterials.push(paving);
    this.group.add(base);
    // A fully sampled, level surface rather than one large boundary-only
    // polygon that tilts through the original asphalt. The full-width mouth
    // reaches each adjacent road; side aprons finish the supplied T-junctions.
    const asphalt = new THREE.MeshStandardMaterial({ color: "#848586", map: this.textures.asphalt, roughness: 0.93 });
    asphalt.name = "Shared supplied-and-city shopping asphalt";
    this.disposableMaterials.push(asphalt);
    const back = 540 - SHOPPING_STREET.boulevardHalfWidth, front = 540 + SHOPPING_STREET.boulevardHalfWidth;
    const surfaces = [surfaceRectangle(-480, back, -365, front, 0.044)];
    for (const [left, right] of [[-476.5, -469.4], [-375.6, -367.35]]) {
      surfaces.push(surfaceRectangle(left, 494.9, right, back, 0.044));
      surfaces.push(surfaceRectangle(left, front, right, 585.1, 0.044));
    }
    const road = new THREE.Mesh(mergeOrDispose(surfaces)!, asphalt);
    road.name = "Continuous shopping boulevard and side-street aprons";
    road.receiveShadow = true;
    this.group.add(road);
    for (const side of [-1, 1] as const) {
      // Bodies only; leave the original front arcade, sidewalks and roadway open.
      const a = shoppingStreetPoint(-100, -2400, side);
      const b = shoppingStreetPoint(680, 1730, side);
      const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x);
      const back = Math.min(a.z, b.z), front = Math.max(a.z, b.z);
      this.buildings.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
        halfWidth: Math.abs(a.x - b.x) / 2, halfDepth: Math.abs(a.z - b.z) / 2,
        outline: [{ x: left, z: back }, { x: right, z: back }, { x: right, z: front }, { x: left, z: front }, { x: left, z: back }] });
    }
  }

  private loadSuppliedRoadPackStructures() {
    new GLTFLoader().load("/models/supplied-road-pack-optimized.glb?v=landmark-bridge-8", (asset) => {
      if (this.stopped) {
        asset.scene.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          materials.forEach((material) => {
            (material as THREE.MeshStandardMaterial).map?.dispose();
            material.dispose();
          });
        });
        return;
      }
      const suspensionSource = asset.scene.getObjectByName("SuppliedRoadPack_SuspensionBridge");

      if (!suspensionSource) return;
      const retained = new Set<string>();
      suspensionSource.traverse((object) => retained.add(object.uuid));


      asset.scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && !retained.has(mesh.uuid)) mesh.geometry.dispose();
      });

      const suspension = suspensionSource.clone(true);
      suspension.name = "Supplied suspension bridge fitted only to the matching river span";
      // The supplied bridge's asphalt deck is authored at local Y≈15. With
      // the retained 0.17 vertical scale, a 3.22 m base aligns that deck to
      // the single 5.78 m city approach surface instead of creating two tiers.
      suspension.position.set(465, cityElevationAt({ x: 620, z: -300 }) + 3.22, -300);
      suspension.rotation.y = -Math.PI / 2;
      // Source X is transverse, Z is the 310 m span. Keep the full span;
      // move the cable planes outside the 16 m carriageway (about ±9.75 m).
      suspension.scale.set(0.78, 0.17, 1);
      // Extend only the existing foundation bottom vertices; preserve the supplied
      // bridge geometry above its footings. The new toe is 0.6 m below the riverbed.
      suspension.traverse(object=>{
        const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
        const geometry=mesh.geometry.clone(),position=geometry.getAttribute('position');
        for(let i=0;i<position.count;i++)if(position.getY(i)<-28)position.setY(i,(-3.8-3.22)/.17);
        position.needsUpdate=true;geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.geometry=geometry;
      });
      suspension.updateMatrixWorld(true);
      const suspensionCenter = new THREE.Box3().setFromObject(suspension).getCenter(new THREE.Vector3());
      suspension.position.x += 620 - suspensionCenter.x;
      suspension.position.z += -300 - suspensionCenter.z;

      const bridgeSystem = new THREE.Group();
      bridgeSystem.name = "Complete supplied road-pack city infrastructure system";
      const landmarkBridge = new THREE.Group();
      landmarkBridge.name = "Dimension-matched supplied road-pack landmark bridge";
      landmarkBridge.add(suspension);
      bridgeSystem.add(landmarkBridge);
      const materialSet = new Set<THREE.Material>();
      const textureSet = new Set<THREE.Texture>();
      bridgeSystem.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = this.qualityLevel === 0;
        mesh.receiveShadow = true;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => {
          materialSet.add(material);
          const map = (material as THREE.MeshStandardMaterial).map;
          if (map) {
            map.anisotropy = this.maxAnisotropy;
            map.colorSpace = THREE.SRGBColorSpace;
            textureSet.add(map);
          }
        });
      });
      this.disposableMaterials.push(...materialSet);
      this.disposableTextures.push(...textureSet);
      this.group.add(bridgeSystem);
      freezeStaticScene(this.group);
    });
  }

  private registerElevatedSegment(segment: ElevatedRoadSegment) {
    const a = segment.a as RoadPoint, b = segment.b as RoadPoint;
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
    const na = a.miter ?? normal, nb = b.miter ?? normal;
    const wa = (segment.startWidth ?? segment.width) / 2, wb = (segment.endWidth ?? segment.width) / 2;
    segment.footprint = [
      { x: a.x + na.x * wa, z: a.z + na.z * wa },
      { x: b.x + nb.x * wb, z: b.z + nb.z * wb },
      { x: b.x - nb.x * wb, z: b.z - nb.z * wb },
      { x: a.x - na.x * wa, z: a.z - na.z * wa },
    ];
    this.elevatedSegments.push(segment);
    this.elevatedSegmentGrid.insert(segment, {
      minX: Math.min(...segment.footprint.map(p=>p.x))-.1,
      minZ: Math.min(...segment.footprint.map(p=>p.z))-.1,
      maxX: Math.max(...segment.footprint.map(p=>p.x))+.1,
      maxZ: Math.max(...segment.footprint.map(p=>p.z))+.1,
    });
  }

  private registerBridgePier(collider: BuildingBounds) {
    this.bridgePierColliders.push(collider);
    this.bridgePierGrid.insert(collider, {
      minX: collider.x - collider.halfWidth,
      minZ: collider.z - collider.halfDepth,
      maxX: collider.x + collider.halfWidth,
      maxZ: collider.z + collider.halfDepth,
    });
  }

  private renderMountainRoadside(points: Coordinates[],estates=true) {
    const group = new THREE.Group();
    group.name = "Driveable Taiwanese mountain road with switchbacks and guardrails";
    const galvanized = new THREE.MeshStandardMaterial({ color: "#aab0ad", roughness: 0.48, metalness: 0.71 });
    const reflector = new THREE.MeshStandardMaterial({ color: "#f5d96c", emissive: "#a97919", emissiveIntensity: 0.42, roughness: 0.44 });
    const bark = new THREE.MeshStandardMaterial({ color: "#5b4938", roughness: 0.98 });
    const mountainLeaves = botanicalLeafTexture(this.maxAnisotropy);
    const foliage = new THREE.MeshStandardMaterial({ color: "#72905e", map: mountainLeaves, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.88 });
    this.disposableTextures.push(mountainLeaves);
    this.disposableMaterials.push(galvanized, reflector, bark, foliage);

    const postEntries: Array<Coordinates & { angle: number }> = [];
    // The existing mountain road is the neighbourhood spine. Parcels get a
    // perpendicular, grade-checked entrance, never a long diagonal across other roads.
    if(estates)estateGrades.length=0;
    terrainBuildCache?.ground.clear(); terrainBuildCache?.expressway.clear();
    const villaIndices = estates?Array.from({length:34},(_,i)=>Math.min(points.length-2,Math.floor((.18+i*.023)*(points.length-1)))):[];
    const selectedEstateCenters: Coordinates[] = [];
    const plannedVillaCenters = villaIndices.map((pointIndex) => {
      if(selectedEstateCenters.length>=5)return null;
      const road = points[pointIndex], next = points[Math.min(points.length - 1, pointIndex + 1)];
      const length = Math.hypot(next.x-road.x,next.z-road.z) || 1;
      const tx=(next.x-road.x)/length, tz=(next.z-road.z)/length;
      let best: (Coordinates & {side:number;floor:number;score:number;entry:Coordinates;access:EstateAccessPoint[]}) | null=null;
      for(const fraction of [.12,.25,.5,.75,.88]) for(const side of [-1,1]) for(const offset of [40,48,56,64,80,96,112,128]) {
        const entry={x:road.x+(next.x-road.x)*fraction,z:road.z+(next.z-road.z)*fraction};
        const nx=-tz*side,nz=tx*side,center={x:entry.x+nx*offset,z:entry.z+nz*offset};
        if(center.x<1350 || selectedEstateCenters.some(p=>Math.hypot(p.x-center.x,p.z-center.z)<55))continue;
        const angle=Math.atan2(nx,nz);
        const world=(x:number,z:number)=>({x:center.x+Math.cos(angle)*x+Math.sin(angle)*z,z:center.z-Math.sin(angle)*x+Math.cos(angle)*z});
        const parcel=[[-17,-15],[17,-15],[17,15],[-17,15],[-17,-15]].map(([x,z])=>world(x,z));
        if(!this.buildingClearsInfrastructure(parcel))continue;
        if(points.slice(1).some((b,i)=>distanceToSegment(center,points[i],b)<30))continue;
        const heights=[-17,0,17].flatMap(x=>[-15,0,15].map(z=>cityElevationAt(world(x,z))));
        const floor=Math.max(cityElevationAt(entry)+2.5,Math.min(Math.max(...heights)+1.6,cityElevationAt(entry)+(offset-24)*.065)),gate=world(0,-15);
        const relief=Math.max(...heights)-Math.min(...heights);
        if(relief>12 || Math.max(...heights)-(floor-1.65)>7.5 || floor-1.65-Math.min(...heights)>8)continue;
        const access=planEstateAccess(entry,gate,floor,cityElevationAt);
        if(!access)continue;
        if(access.some((p,k)=>k>3 && points.slice(1).some((b,i)=>Math.abs(i-pointIndex)>2 && distanceToSegment(p,points[i],b)<8)))continue;
        if(access.some(p=>selectedEstateCenters.some(c=>Math.hypot(p.x-c.x,p.z-c.z)<25)))continue;
        const score=relief*4+offset*.08+Math.abs(floor-cityElevationAt(entry))*2;
        if(!best||score<best.score)best={...center,side,floor,score,entry,access};
      }
      if(best)selectedEstateCenters.push(best);
      return best;
    });
    plannedVillaCenters.forEach((site,i)=>{
      if(!site)return;const a=points[villaIndices[i]],b=points[villaIndices[i]+1];
      estateGrades.push({...site,angle:Math.atan2(-(b.z-a.z)*site.side,(b.x-a.x)*site.side)});
    });
    const estateDiagnostics:Record<string,number>={};
    const luxurySite=estates?(planLuxuryEstate(points,selectedEstateCenters,cityElevationAt,outline=>this.buildingClearsInfrastructure(outline),estateDiagnostics)
      ??planLuxuryEstate(MOUNTAIN_VALLEY_POINTS,selectedEstateCenters,cityElevationAt,outline=>this.buildingClearsInfrastructure(outline),estateDiagnostics)):null;
    if(estates)this.group.userData.luxuryEstatePlanning=estateDiagnostics;
    if(luxurySite) {
      estateGrades.push({...luxurySite,halfWidth:38,halfDepth:31,padDepth:.2,pool:{x:18,z:-22,halfWidth:11.9,halfDepth:5.9,depth:1.64}});
      this.group.userData.luxuryEstateSite={x:luxurySite.x,z:luxurySite.z,floor:luxurySite.floor,angle:luxurySite.angle,access:luxurySite.access};
    }
    terrainBuildCache?.ground.clear(); terrainBuildCache?.expressway.clear();
    for(const name of ['Level urban ground with distant mountain foothills','High-resolution mountain terrain fitted around the driveable road']) {
      const mesh=this.group.getObjectByName(name) as THREE.Mesh|undefined;
      if(mesh)conformGeometryToTerrain(mesh.geometry);
    }
    const grandEntry=luxurySite??this.group.userData.luxuryEstateSite;
    const isEstateEntrance=(p:Coordinates)=>(p.x>1583&&p.x<1613&&Math.abs(p.z-510)<8)||(grandEntry&&distanceToSegment(p,grandEntry.access[0],grandEntry.access[Math.min(5,grandEntry.access.length-1)])<6)||plannedVillaCenters.some(site=>site && distanceToSegment(p,site.entry,site.access[Math.min(5,site.access.length-1)])<5.5);
    const mountainGuardrails: THREE.BufferGeometry[] = [];
    const reflectorEntries: Array<Coordinates & { angle: number }> = [];
    const asphaltSurfaces: THREE.BufferGeometry[] = [];
    const shoulderMarkings: THREE.BufferGeometry[] = [];
    for (let index = 0; index < points.length - 1; index++) {
      const a = points[index];
      const b = points[index + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1) continue;
      const normalX = -dz / length;
      const normalZ = dx / length;
      const angle = Math.atan2(-dx, -dz);
      const asphalt = roadSegmentGeometry(a, b, 8.15, 0.082);
      if (asphalt) asphaltSurfaces.push(asphalt);
      for (const offset of [-3.62, 3.62]) {
        const steps=Math.ceil(length/2);
        for(let j=0;j<steps;j++) {
          const t=(j+.5)/steps;
          if(isEstateEntrance({x:a.x+dx*t+normalX*offset,z:a.z+dz*t+normalZ*offset}))continue;
          const aa={x:a.x+dx*j/steps,z:a.z+dz*j/steps},bb={x:a.x+dx*(j+1)/steps,z:a.z+dz*(j+1)/steps};
          const shoulder=offsetRoadSegmentGeometry(aa,bb,.16,.105,offset);if(shoulder)shoulderMarkings.push(shoulder);
        }
      }
      for (const side of [-1, 1]) {
        const startY = cityElevationAt(a) + 0.78;
        const endY = cityElevationAt(b) + 0.78;
        const railSteps=Math.ceil(length/2);
        for(let step=0;step<railSteps;step++) {
          const t=(step+.5)/railSteps;
          const at={x:a.x+dx*t+normalX*side*4.22,z:a.z+dz*t+normalZ*side*4.22};
          if(isEstateEntrance(at))continue;
          const rail=new THREE.BoxGeometry(.13,.19,length/railSteps+.015);
          rail.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.atan2(endY-startY,length),angle,0,'YXZ')));
          rail.translate(at.x,startY+(endY-startY)*t,at.z);mountainGuardrails.push(rail);
        }
        const postCount = Math.max(2, Math.ceil(length / 11));
        for (let post = 0; post <= postCount; post++) {
          const progress = post / postCount;
          const entry = {
            x: a.x + dx * progress + normalX * side * 4.22,
            z: a.z + dz * progress + normalZ * side * 4.22,
            angle,
          };
          if(isEstateEntrance(entry))continue;
          postEntries.push(entry);
          if ((post + index) % 2 === 0) reflectorEntries.push({ ...entry, x: entry.x - normalX * side * 0.08, z: entry.z - normalZ * side * 0.08 });
        }
      }
    }

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.055, 0.075, 1, 8), galvanized, postEntries.length);
    posts.name = "Mountain-road galvanized safety posts";
    postEntries.forEach((entry, index) => {
      position.set(entry.x, cityElevationAt(entry) + 0.48, entry.z);
      scale.set(1, 0.96, 1);
      matrix.compose(position, rotation, scale);
      posts.setMatrixAt(index, matrix);
    });
    posts.instanceMatrix.needsUpdate = true;
    posts.castShadow = true;
    group.add(posts);

    // A 24 × 12 × 4.5 cm reflector: rounded edges would be sub-centimetre, so a plain box keeps the look at 12 triangles.
    const markers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), reflector, reflectorEntries.length);
    markers.name = "Mountain-road amber edge reflectors";
    reflectorEntries.forEach((entry, index) => {
      position.set(entry.x, cityElevationAt(entry) + 0.83, entry.z);
      rotation.setFromAxisAngle(up, entry.angle);
      scale.set(0.24, 0.12, 0.045);
      matrix.compose(position, rotation, scale);
      markers.setMatrixAt(index, matrix);
    });
    markers.instanceMatrix.needsUpdate = true;
    group.add(markers);


    const asphaltGeometry = mergeOrDispose(asphaltSurfaces);
    if (asphaltGeometry) {
      const asphaltMaterial = new THREE.MeshStandardMaterial({ color: "#595d5e", map: this.textures.asphalt, normalMap: this.textures.asphaltNormal, roughnessMap: this.textures.asphaltRoughness, normalScale: new THREE.Vector2(0.62, 0.62), roughness: 0.91 });
      this.disposableMaterials.push(asphaltMaterial);
      this.roadSurfaceMaterials?.push(asphaltMaterial);
      const surface = new THREE.Mesh(asphaltGeometry, asphaltMaterial);
      surface.name = "Raised high-visibility mountain asphalt surface";
      surface.receiveShadow = true;
      group.add(surface);
    }
    const shoulderGeometry = mergeOrDispose(shoulderMarkings);
    if (shoulderGeometry) {
      const markingMaterial = new THREE.MeshStandardMaterial({ color: "#f0ead2", roughness: 0.75 });
      this.disposableMaterials.push(markingMaterial);
      const shoulders = new THREE.Mesh(shoulderGeometry, markingMaterial);
      shoulders.name = "Continuous mountain-road shoulder markings";
      group.add(shoulders);
    }

    const mountainRailGeometry=mergeOrDispose(mountainGuardrails);
    if(mountainRailGeometry){const mesh=new THREE.Mesh(mountainRailGeometry,galvanized);mesh.castShadow=true;mesh.name='Mountain guardrails with planned estate entrance openings';group.add(mesh);}
    const mountainTrees: Array<Coordinates & { scale: number }> = [];
    for (let row = 0; row < 10; row++) {
      for (let column = 0; column < 14; column++) {
        const candidate = {
          x: 1230 + column * 50 + deterministicNoise(row, column + 901) * 19,
          z: 330 + row * 54 + deterministicNoise(column, row + 907) * 18,
        };
        if (points.some((point) => Math.hypot(point.x - candidate.x, point.z - candidate.z) < 22)) continue;
        if (plannedVillaCenters.some((site) => site && Math.hypot(site.x - candidate.x, site.z - candidate.z) < 27)) continue;
        if(luxurySite&&Math.hypot(luxurySite.x-candidate.x,luxurySite.z-candidate.z)<53)continue;
        let nearRoad = false;
        for (let index = 0; index < points.length - 1; index++) {
          if (distanceToSegment(candidate, points[index], points[index + 1]) < 16) { nearRoad = true; break; }
        }
        if (estates && !nearRoad) mountainTrees.push({ ...candidate, scale: 0.8 + deterministicNoise(row + 41, column + 919) * 0.75 });
      }
    }
    if(mountainTrees.length){
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.22, 1, 8), bark, mountainTrees.length);
    const crowns = new THREE.InstancedMesh(layeredLeafCardGeometry(), foliage, mountainTrees.length);
    const branches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.095, 1, 7), bark, mountainTrees.length * 3);
    trunks.name = "Mountain forest tree trunks";
    crowns.name = "Layered Taiwanese mountain forest";
    branches.name = "High-detail mountain tree branches";
    mountainTrees.forEach((tree, index) => {
      position.set(tree.x, cityElevationAt(tree) + tree.scale * 1.55, tree.z);
      scale.set(tree.scale, tree.scale * 3.1, tree.scale);
      matrix.compose(position, rotation.identity(), scale);
      trunks.setMatrixAt(index, matrix);
      position.y = cityElevationAt(tree) + tree.scale * 4.05;
      scale.set(tree.scale * 2.25, tree.scale * 2.05, tree.scale * 2.25);
      matrix.compose(position, rotation, scale);
      crowns.setMatrixAt(index, matrix);
      for (let branch = 0; branch < 3; branch++) {
        const branchIndex = index * 3 + branch;
        const angle = branch * Math.PI * 2 / 3 + deterministicNoise(index, branch + 1001) * 0.7;
        position.set(tree.x + Math.cos(angle) * tree.scale * 0.5, cityElevationAt(tree) + tree.scale * (2.9 + branch * 0.34), tree.z + Math.sin(angle) * tree.scale * 0.5);
        rotation.setFromEuler(new THREE.Euler(0.75, angle, 0.55, "YXZ"));
        scale.set(tree.scale, tree.scale * 2.4, tree.scale);
        matrix.compose(position, rotation, scale);
        branches.setMatrixAt(branchIndex, matrix);
      }
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    branches.instanceMatrix.needsUpdate = true;
    trunks.castShadow = crowns.castShadow = true;
    branches.castShadow = true;
    group.add(trunks, branches, crowns);
    }

    const villaStone = createEstateFinish();
    const villaDark = new THREE.MeshStandardMaterial({ color: "#303a3e", roughness: .35, metalness: .6 });
    const villaWood = createEstateFinish(true);
    const villaGlass = new THREE.MeshPhysicalMaterial({ color: "#9ebbc2", roughness: .12, metalness: .12, transparent: true, opacity: .5, clearcoat: 1, side: THREE.DoubleSide });
    const villaLawn = new THREE.MeshStandardMaterial({ color: "#477341", map: this.textures.ground, roughness: .95 });
    const villaPool = new THREE.MeshPhysicalMaterial({ color: "#479da8", roughness: .1, transparent: true, opacity: .7, clearcoat: 1, normalMap: this.textures.waterNormal, normalScale: new THREE.Vector2(.12,.12) });
    const villaGlow = new THREE.MeshStandardMaterial({ color: "#ffe6b8", emissive: "#ffca79", emissiveIntensity: 1.8 });
    this.disposableMaterials.push(villaStone, villaDark, villaWood, villaGlass, villaLawn, villaPool, villaGlow);
    const estateAsphalt=new THREE.MeshStandardMaterial({color:'#8a8b89',map:this.textures.asphalt,normalMap:this.textures.asphaltNormal,roughness:.9});
    const estateRetaining=villaStone.clone();estateRetaining.side=THREE.DoubleSide;
    this.disposableMaterials.push(estateAsphalt,estateRetaining);
    villaIndices.forEach((pointIndex, villaIndex) => {
      const roadPoint = points[pointIndex];
      const next = points[Math.min(points.length - 1, pointIndex + 1)];
      const dx = next.x - roadPoint.x;
      const dz = next.z - roadPoint.z;
      const length = Math.max(1, Math.hypot(dx, dz));
      const side = plannedVillaCenters[villaIndex]?.side ?? 1;
      const normalX = -dz / length;
      const normalZ = dx / length;
      const center = plannedVillaCenters[villaIndex];
      if (!center) return;
      const estateAngle = Math.atan2(normalX * side, normalZ * side);
      const outline = [[-17,-15],[17,-15],[17,15],[-17,15],[-17,-15]].map(([x,z]) => ({
        x: center.x + Math.cos(estateAngle)*x + Math.sin(estateAngle)*z,
        z: center.z - Math.sin(estateAngle)*x + Math.cos(estateAngle)*z,
      }));
      if (!this.buildingClearsInfrastructure(outline)) return;
      const angle = estateAngle;
      const worldPoint = (x: number, z: number) => ({ x: center.x + Math.cos(angle) * x + Math.sin(angle) * z, z: center.z - Math.sin(angle) * x + Math.cos(angle) * z });
      const floor = center.floor;
      const villa = createHillsideEstate({ stone: villaStone, dark: villaDark, wood: villaWood, glass: villaGlass, lawn: villaLawn, water: villaPool, glow: villaGlow },
        (x,z) => cityElevationAt(worldPoint(x,z)) - floor);
      villa.name = `Coherent landscaped hillside estate ${villaIndex + 1}`;
      villa.position.set(center.x, floor, center.z);
      villa.rotation.y = angle;
      group.add(villa);
      this.loadCompleteEstate(villa.userData.residence as THREE.Group,villa,{stone:villaStone,dark:villaDark,wood:villaWood,glass:villaGlass});
      const gate = worldPoint(0,-15);
      const access=[...center.access,{...worldPoint(0,-11),height:floor,width:6.4}];
      const drivewayParts:THREE.BufferGeometry[]=[],kerbs:THREE.BufferGeometry[]=[],retaining:THREE.BufferGeometry[]=[];
      const absoluteStrip=(a:EstateAccessPoint,b:EstateAccessPoint,width:number,lateral=0,lift=0)=>{
        const length=Math.hypot(b.x-a.x,b.z-a.z),nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
        const aa={x:a.x+nx*lateral,z:a.z+nz*lateral},bb={x:b.x+nx*lateral,z:b.z+nz*lateral};
        const geometry=roadSegmentGeometry(aa,bb,width,0,0,lateral?width:b.width);
        if(!geometry)return null;
        const positions=geometry.getAttribute('position'),base=geometry.getAttribute('terrainBaseY');
        for(let i=0;i<positions.count;i++) {
          const x=positions.getX(i),z=positions.getZ(i),t=Math.max(0,Math.min(1,((x-aa.x)*(bb.x-aa.x)+(z-aa.z)*(bb.z-aa.z))/(length*length)));
          const y=a.height+(b.height-a.height)*t+lift;positions.setY(i,y);
          if(base)base.setX(i,y-cityElevationAt({x,z}));
        }
        geometry.computeVertexNormals();return geometry;
      };
      access.slice(1).forEach((b,i)=>{
        const a=access[i],geometry=absoluteStrip(a,b,a.width);
        if(geometry)drivewayParts.push(geometry);
        this.registerElevatedSegment({a,b,buildingClearance:.05,surfaceHeightA:a.height,surfaceHeightB:b.height,width:Math.max(a.width,b.width),startWidth:a.width,endWidth:b.width,startHeight:a.height-cityElevationAt(a),endHeight:b.height-cityElevationAt(b),kitStyle:'modular'});
        if(i<3||i>=center.access.length-1)return;
        const length=Math.hypot(b.x-a.x,b.z-a.z),nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
        for(const side of [-1,1]) {
          const kerb=absoluteStrip(a,b,.22,side*3.31,.10);if(kerb)kerbs.push(kerb);
          const aa={x:a.x+nx*side*3.4,z:a.z+nz*side*3.4},bb={x:b.x+nx*side*3.4,z:b.z+nz*side*3.4};
          const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([aa.x,a.height-.03,aa.z,bb.x,b.height-.03,bb.z,aa.x,cityElevationAt(aa)-.15,aa.z,bb.x,b.height-.03,bb.z,bb.x,cityElevationAt(bb)-.15,bb.z,aa.x,cityElevationAt(aa)-.15,aa.z],3));
          g.setAttribute('uv',new THREE.Float32BufferAttribute([0,a.height/2,length/2,b.height/2,0,cityElevationAt(aa)/2,length/2,b.height/2,length/2,cityElevationAt(bb)/2,0,cityElevationAt(aa)/2],2));g.computeVertexNormals();retaining.push(g);
        }
      });
      for(const [parts,material,name] of [[drivewayParts,estateAsphalt,'Driveable estate entrance road'],[kerbs,villaStone,'Estate driveway curbs'],[retaining,estateRetaining,'Terrain-fitted driveway retaining walls']] as const) {
        const geometry=mergeOrDispose(parts);if(geometry){const mesh=new THREE.Mesh(geometry,material);mesh.receiveShadow=true;mesh.name=name;group.add(mesh);}
      }
      const courtStart=worldPoint(0,-15),courtEnd=worldPoint(0,-10.9);
      this.registerElevatedSegment({a:courtStart,b:courtEnd,buildingClearance:.05,surfaceHeightA:floor,surfaceHeightB:floor,width:10.4,startHeight:floor-cityElevationAt(courtStart),endHeight:floor-cityElevationAt(courtEnd),kitStyle:'modular'});
      // The entrance court is traversable; only actual buildings, pool and boundary walls obstruct it.
      for(const [x,z,w,d] of [[0,3.65,16.15,19.9],[10,-10.4,8.6,5.8],[-16.4,0,.35,30],[16.4,0,.35,30],[0,14.6,33,.35],[-11,-14.6,10.8,.35],[11,-14.6,10.8,.35]]) {
        const footprint=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]].map(([dx,dz])=>worldPoint(x+dx,z+dz));
        const c=worldPoint(x,z);this.buildings.push({...c,halfWidth:Math.max(...footprint.map(p=>Math.abs(p.x-c.x))),halfDepth:Math.max(...footprint.map(p=>Math.abs(p.z-c.z))),outline:footprint});
      }
    });
    if(luxurySite)this.renderLuxuryEstate(luxurySite,group,{stone:villaStone,dark:villaDark,wood:villaWood,glass:villaGlass,lawn:villaLawn,water:villaPool,glow:villaGlow},estateAsphalt);
    this.group.add(group);
  }

  private renderLuxuryEstate(site:LuxuryEstateSite,group:THREE.Group,materials:Parameters<typeof createLuxuryEstate>[1],asphalt:THREE.Material) {
    const world=(x:number,z:number)=>estateWorld(site,x,z),floor=site.floor;
    const access=[...site.access,{...world(0,-7),height:floor,width:8.8}],parts:THREE.BufferGeometry[]=[];
    for(let i=1;i<access.length;i++) {
      const a=access[i-1],b=access[i],length=Math.hypot(b.x-a.x,b.z-a.z),nx=-(b.z-a.z)/length,nz=(b.x-a.x)/length;
      const vertices=[a.x-nx*a.width/2,a.height,a.z-nz*a.width/2,a.x+nx*a.width/2,a.height,a.z+nz*a.width/2,b.x-nx*b.width/2,b.height,b.z-nz*b.width/2,b.x+nx*b.width/2,b.height,b.z+nz*b.width/2];
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,a.width/2,0,0,length/2,b.width/2,length/2],2));geometry.setIndex([0,2,1,1,2,3]);geometry.computeVertexNormals();parts.push(geometry);
      this.registerElevatedSegment({a,b,buildingClearance:.05,surfaceHeightA:a.height,surfaceHeightB:b.height,width:Math.max(a.width,b.width),startWidth:a.width,endWidth:b.width,startHeight:a.height-cityElevationAt(a),endHeight:b.height-cityElevationAt(b),kitStyle:'modular'});
    }
    const driveway=mergeOrDispose(parts);if(driveway){const mesh=new THREE.Mesh(driveway,asphalt);mesh.name='Continuous luxury-estate mountain access road';mesh.receiveShadow=true;group.add(mesh);}
    const courtA=world(0,-15),courtB=world(0,-8.2);
    this.registerElevatedSegment({a:courtA,b:courtB,buildingClearance:.05,surfaceHeightA:floor,surfaceHeightB:floor,width:14.8,startHeight:floor-cityElevationAt(courtA),endHeight:floor-cityElevationAt(courtB),kitStyle:'modular'});
    for(const [x,z,w,d] of [[0,11.4,28.6,35.4],[18,-22,25.3,13],[-37.6,0,.5,62],[37.6,0,.5,62],[0,30.6,76,.5],[-21.5,-30.6,32.4,.5],[21.5,-30.6,32.4,.5]]) {
      const footprint=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2],[-w/2,-d/2]].map(([dx,dz])=>world(x+dx,z+dz)),center=world(x,z);
      this.buildings.push({...center,halfWidth:Math.max(...footprint.map(p=>Math.abs(p.x-center.x))),halfDepth:Math.max(...footprint.map(p=>Math.abs(p.z-center.z))),outline:footprint});
    }
    const residence=new THREE.Group(),estate=createLuxuryEstate(residence,materials);
    estate.position.set(site.x,floor,site.z);estate.rotation.y=site.angle;group.add(estate);
    this.loadCompleteEstate(residence,estate,materials);
  }

  private loadCompleteEstate(residence:THREE.Group,estate:THREE.Group,materials:{stone:THREE.Material;dark:THREE.Material;wood:THREE.Material;glass:THREE.Material}) {
    if(typeof window==='undefined')return;
    this.estateTemplatePromise??=new GLTFLoader().loadAsync('/models/estate/zigurat-residence.glb?v=complete-v89').then(asset=>{
      asset.scene.traverse(object=>{const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
        const finish=(material:THREE.Material)=>{const name=material.name.toLowerCase();return name.includes('glass')?materials.glass:name.includes('darkmetal')?materials.dark:name.includes('wood')?materials.wood:materials.stone;};
        mesh.material=Array.isArray(mesh.material)?mesh.material.map(finish):finish(mesh.material);mesh.castShadow=mesh.receiveShadow=true;
      });
      // Preserve all original triangles, merge only surfaces sharing the same PBR finish.
      return combineStreetPropMeshes(asset.scene);
    });
    void this.estateTemplatePromise.then(template=>{
      if(this.stopped)return;
      let parent:THREE.Object3D|null=estate;while(parent&&parent!==this.group)parent=parent.parent;
      if(!parent)return;
      residence.add(template.clone(true));estate.userData.residenceLoaded=true;estate.updateWorldMatrix(true,true);freezeStaticScene(estate);
    }).catch(()=>{estate.userData.residenceLoadError=true;});
  }

  private buildingClearsInfrastructure(outline: Coordinates[]) {
    for (const street of this.streetSegments) {
      const sidewalk = street.width >= 8 ? 2.05 : 1.35;
      if (outlineOverlapsRoadCorridor(outline, street.a, street.b, street.width / 2 + sidewalk + 0.82)) return false;
    }
    for (const elevated of this.elevatedSegments) {
      if (outlineOverlapsElevatedRoad(outline, elevated, 4.8)) return false;
    }
    for (const pier of this.bridgePierColliders) {
      if (pointInsideOutline(pier, outline)) return false;
      for (let index = 0; index < outline.length - 1; index++) {
        if (distanceToSegment(pier, outline[index], outline[index + 1]) < Math.hypot(pier.halfWidth, pier.halfDepth) + 0.8) return false;
      }
    }
    return true;
  }

  private auditSpatialLayout() {
    let roadBuildingOverlaps = 0;
    let elevatedBuildingOverlaps = 0;
    let pierBuildingOverlaps = 0;
    for (const building of this.buildings) {
      const outline = building.outline;
      if (!outline) continue;
      for (const street of this.streetSegments) {
        const sidewalk = street.width >= 8 ? 2.05 : 1.35;
        if (outlineOverlapsRoadCorridor(outline, street.a, street.b, street.width / 2 + sidewalk + 0.8)) roadBuildingOverlaps++;
      }
      for (const road of this.elevatedSegments) {
        if (outlineOverlapsElevatedRoad(outline, road)) elevatedBuildingOverlaps++;
      }
      for (const pier of this.bridgePierColliders) if (pointInsideOutline(pier, outline)) pierBuildingOverlaps++;
    }
    this.group.userData.spatialAudit = {
      checkedBuildings: this.buildings.length,
      checkedRoadSegments: this.streetSegments.length,
      checkedElevatedSegments: this.elevatedSegments.length,
      checkedBridgePiers: this.bridgePierColliders.length,
      roadBuildingOverlaps,
      elevatedBuildingOverlaps,
      pierBuildingOverlaps,
      passed: roadBuildingOverlaps === 0 && elevatedBuildingOverlaps === 0 && pierBuildingOverlaps === 0,
    };
  }

  private clearAuthoredDistrict() {
    this.neighborhoodLife?.dispose();this.neighborhoodLife=undefined;this.trafficVehicles.forEach(v=>v.commuter?.dispose());
    this.staticRenderBatches?.clear();
    this.trafficRenderBatches?.dispose();this.trafficRenderBatches=undefined;
    this.trafficConnections=new WeakMap();this.trafficHeights=new WeakMap();
    this.stockBuildingEntries = [];
    this.streetPropPhysics?.dispose();this.streetPropPhysics=undefined;
    this.streetPropPlacements = [];
    this.estateTemplatePromise=undefined;
    this.urbanPaving = [];this.urbanGardens = [];
    this.streetPropColliders = [];
    this.signalGrid = undefined;
    this.indexedSignalCount = -1;
    this.buildingCollisionGrid = undefined;
    this.indexedBuildingCount = -1;
    const preservedGround = new Set([
      this.group.getObjectByName("Level urban ground with distant mountain foothills"),
      this.group.getObjectByName("High-resolution mountain terrain fitted around the driveable road"),
    ]);
    for (const child of [...this.group.children]) {
      if (preservedGround.has(child)) continue;
      this.group.remove(child);
      child.traverse((object) => {
        if (object.userData.cityMultidraw) { disposeCityBatch(object as THREE.BatchedMesh); return; }
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh && !mesh.userData.sharedTrafficAsset && !mesh.userData.sharedStreetPropAsset && !mesh.userData.sharedStockBuildingAsset) mesh.geometry.dispose();
        if ((object as THREE.InstancedMesh).isInstancedMesh && (mesh.userData.sharedStreetPropAsset || mesh.userData.sharedStockBuildingAsset)) (object as THREE.InstancedMesh).dispose();
      });
    }
    this.buildings.length = 0;
    this.facadeMaterials.length = 0;
    if (this.schoolFacadeMaterials) this.schoolFacadeMaterials.length = 0;
    this.streetSegments.length = 0;
    this.roadJunctions.length = 0;
    this.parkParcels.length = 0;
    this.schoolCampuses.length = 0;
    this.elevatedSegments.length = 0;
    this.elevatedJunctions.length = 0;
    this.bridgePierColliders.length = 0;
    this.elevatedSegmentGrid.clear();
    this.bridgePierGrid.clear();
    this.riverSurfaces.length = 0;
    this.waterChannels.length = 0;
    if (this.roadSurfaceMaterials) this.roadSurfaceMaterials.length = 0;
    this.trafficIntersections.length = 0;
    this.trafficRoutes.length = 0;
    this.trafficVehicles.length = 0;
    this.signalMaterials = null;
    this.spawnPoint = null;
  }

  constrainTunnelCamera(camera:THREE.Vector3, rider:Coordinates, height:number) {
    if(!onTunnelRoad(rider,height)||rider.x<1630||rider.x>2130)return;
    camera.z=Math.max(506.1,Math.min(513.9,camera.z));
    camera.y=Math.min(camera.y,tunnelFloorAt(camera.x)+4.1);
  }

  update(_position: Coordinates) {
    this.tunnelLights?.forEach((light,i)=>{light.visible=_position.x>1620&&_position.x<2140&&Math.abs(_position.z-510)<8;const x=Math.max(1635,Math.min(2125,Math.round(_position.x/20)*20+(i-1)*20));light.position.set(x,tunnelFloorAt(x)+4.6,510);});
    const pulse = performance.now() * 0.0007;
    this.textures.waterNormal.offset.set(pulse * 0.055, pulse * 0.12);
    for (const material of this.riverSurfaces) material.clearcoatRoughness = 0.16 + Math.sin(pulse) * 0.045;
  }

  setQualityLevel(level: 0 | 1 | 2) {
    this.qualityLevel = level;
    // Geometry, textured materials and shadow casters remain intact at every load level.
  }

  updateTrafficRendering(camera:THREE.Camera,shadowCamera:THREE.Camera) {
    this.staticRenderBatches?.update(camera,shadowCamera,fogLimit(this.scene));
    this.trafficRenderBatches?.update(camera,shadowCamera);
    if(this.streetPropCells){
      const eye=cameraWorldPosition(camera);
      for(const cell of this.streetPropCells.children as THREE.InstancedMesh[]){
        if(!cell.boundingSphere)continue;
        cell.visible=withinDistance(this.streetPropSphere.copy(cell.boundingSphere).applyMatrix4(cell.matrixWorld),eye,DRAW_DISTANCE.props);
      }
    }
  }

  interpolateRoadTraffic(alpha:number,seconds:number) {
    for(const vehicle of this.trafficVehicles) {
      if(!vehicle.presentation||!vehicle.motion)continue;
      const pose=vehicle.presentation.apply(alpha,vehicle.motion);
      if(vehicle.rig)updateTrafficRig(vehicle.rig,pose.motion,vehicle.modelKind as VehicleClass,seconds,pose.axleResidual);
      if(vehicle.animalHead) {
        const rest=vehicle.animalHead.userData.ridingRest as THREE.Quaternion;
        if(rest)vehicle.animalHead.quaternion.copy(rest).multiply(this.trafficHeadRotation.setFromAxisAngle(this.trafficHeadAxis,Math.sin(seconds*.85+vehicle.progress*.03)*.035));
      }
    }
  }

  resetTrafficInterpolation() {
    for(const vehicle of this.trafficVehicles)if(vehicle.motion)vehicle.presentation?.reset(vehicle.motion);
  }

  setWeather(wet: boolean, dark: boolean) {
    for (const material of this.roadSurfaceMaterials ?? []) {
      material.roughness = wet ? 0.31 : 0.93;
      material.metalness = 0;
      material.color.set(wet ? "#60686a" : "#848586");
      material.envMapIntensity = wet ? 1.65 : dark ? 0.78 : 0.48;
    }
    for (const material of this.facadeMaterials) material.envMapIntensity = dark ? 1.35 : 0.74;
  }

  elevationAt(position: Coordinates, heading?: number, currentSurfaceHeight?: number) {
    if(currentSurfaceHeight!==undefined&&onTunnelRoad(position,currentSurfaceHeight))return tunnelFloorAt(position.x)-.082;
    const terrainGround = cityElevationAt(position);
    let ground = terrainGround;
    for (const channel of this.waterChannels) {
      const dx = channel.b.x - channel.a.x;
      const dz = channel.b.z - channel.a.z;
      const squared = dx * dx + dz * dz;
      if (squared < 0.01) continue;
      const progress = ((position.x - channel.a.x) * dx + (position.z - channel.a.z) * dz) / squared;
      if (progress < 0 || progress > 1) continue;
      const across = Math.abs((position.x - channel.a.x) * dz - (position.z - channel.a.z) * dx) / Math.sqrt(squared);
      if (across < channel.width * 0.5) ground = Math.min(ground, terrainGround - channel.depth);
    }
    if (heading === undefined) return ground;
    let highest = ground;
    if (currentSurfaceHeight !== undefined) {
      for (const junction of this.elevatedJunctions) {
        if (Math.hypot(position.x - junction.position.x, position.z - junction.position.z) > junction.radius * 0.94) continue;
        const deckHeight = expresswayGroundAt(position) + Math.max(0, junction.height - 0.082);
        if (deckHeight <= currentSurfaceHeight + 0.72) highest = Math.max(highest, deckHeight);
      }
    }
    const elevatedCandidates = this.elevatedSegmentGrid.occupiedCellCount
      ? this.elevatedSegmentGrid.queryAround(position, 2)
      : this.elevatedSegments;
    for (const elevated of elevatedCandidates) {
      const dx = elevated.b.x - elevated.a.x;
      const dz = elevated.b.z - elevated.a.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.1) continue;
      const alignment = Math.abs(Math.sin(heading) * dx / length - Math.cos(heading) * dz / length);
      const progress = ((position.x - elevated.a.x) * dx + (position.z - elevated.a.z) * dz) / (length * length);
      if (!elevated.footprint && (progress < -0.035 || progress > 1.035)) continue;
      const across = Math.abs((position.x - elevated.a.x) * dz - (position.z - elevated.a.z) * dx) / length;
      const localWidth = (elevated.startWidth ?? elevated.width) + ((elevated.endWidth ?? elevated.width) - (elevated.startWidth ?? elevated.width)) * Math.max(0, Math.min(1, progress));
      const onDeck = elevated.footprint
        ? pointInsideOutline(position, elevated.footprint) || elevated.footprint.some((point, i, outline) => distanceToSegment(position, point, outline[(i + 1) % outline.length]) < .035)
        : across <= localWidth / 2;
      if (!onDeck) continue;
      const height = elevated.startHeight + (elevated.endHeight - elevated.startHeight) * Math.max(0, Math.min(1, progress));
      if(elevated.roadOwner&&elevatedCandidates.some(other=>{
        if(other.roadOwner===elevated.roadOwner||(other.roadPriority??0)<=(elevated.roadPriority??0)||!other.footprint||!pointInsideOutline(position,other.footprint))return false;
        const dx=other.b.x-other.a.x,dz=other.b.z-other.a.z;
        const t=Math.max(0,Math.min(1,((position.x-other.a.x)*dx+(position.z-other.a.z)*dz)/(dx*dx+dz*dz||1)));
        return Math.abs(other.startHeight+(other.endHeight-other.startHeight)*t-height)<.065;
      }))continue;
      const t = Math.max(0, Math.min(1, progress));
      const centerGround = expresswayGroundAt({ x: elevated.a.x + dx * t, z: elevated.a.z + dz * t });
      const deckHeight = elevated.surfaceHeightA !== undefined
        ? elevated.surfaceHeightA + ((elevated.surfaceHeightB ?? elevated.surfaceHeightA) - elevated.surfaceHeightA) * t - .082
        : centerGround + Math.max(0, height - 0.082);
      // Once riding a deck, support depends on footprint and height, not facing direction.
      if (alignment < 0.72 && (currentSurfaceHeight === undefined || Math.abs(deckHeight - currentSurfaceHeight) > 0.72)) continue;
      if (currentSurfaceHeight !== undefined && deckHeight > currentSurfaceHeight + 0.72) continue;
      highest = Math.max(highest, deckHeight);
    }
    return highest;
  }

  gradeAt(position: Coordinates, heading: number, currentSurfaceHeight?: number) {
    return terrainGradeAt(position, heading, (point) => this.elevationAt(point, heading, currentSurfaceHeight));
  }

  /** Construction clearance includes every road level, not just ground colliders. */
  transportSupportClears(position: Coordinates, radius: number) {
    if (this.streetSegments.some(road => distanceToSegment(position, road.a, road.b) < road.width / 2 + radius + 1.8)) return false;
    if (this.elevatedSegmentGrid.queryAround(position, radius + 48).some(road =>
      distanceToSegment(position, road.a, road.b) < Math.max(road.width, road.startWidth ?? 0, road.endWidth ?? 0) / 2 + radius + 2.2)) return false;
    return !intersectsBuilding(position, this.nearbyStaticObstacles(position, 12, this.elevationAt(position)), radius + .4);
  }

  nearbyStaticObstacles(position: Coordinates, radius = 42, currentSurfaceHeight?: number) {
    if(currentSurfaceHeight!==undefined&&onTunnelRoad(position,currentSurfaceHeight)&&position.x>=1630&&position.x<=2130) {
      return [-1,1].map(side=>({x:1880,z:510+side*5.08,halfWidth:250,halfDepth:.18,outline:[{x:1630,z:510+side*5.08-.18},{x:2130,z:510+side*5.08-.18},{x:2130,z:510+side*5.08+.18},{x:1630,z:510+side*5.08+.18}]}));
    }
    const nearby: BuildingBounds[] = [];
    if (!this.buildingCollisionGrid || this.indexedBuildingCount !== this.buildings.length) {
      this.buildingCollisionGrid = new GridForgeCityGrid<BuildingBounds>(64);
      for (const obstacle of this.buildings) this.buildingCollisionGrid.insert(obstacle, {
        minX: obstacle.x - obstacle.halfWidth, maxX: obstacle.x + obstacle.halfWidth,
        minZ: obstacle.z - obstacle.halfDepth, maxZ: obstacle.z + obstacle.halfDepth,
      });
      this.indexedBuildingCount = this.buildings.length;
    }
    for (const obstacle of this.buildingCollisionGrid.queryAround(position, radius)) {
      if (Math.abs(obstacle.x - position.x) < radius + obstacle.halfWidth && Math.abs(obstacle.z - position.z) < radius + obstacle.halfDepth) nearby.push(obstacle);
    }
    const pierCandidates = this.bridgePierGrid.occupiedCellCount
      ? this.bridgePierGrid.queryAround(position, radius)
      : this.bridgePierColliders;
    for (const obstacle of pierCandidates) {
      if (Math.abs(obstacle.x - position.x) >= radius || Math.abs(obstacle.z - position.z) >= radius) continue;
      const groundHeight = cityElevationAt(obstacle);
      if (currentSurfaceHeight !== undefined && currentSurfaceHeight > groundHeight + 1.35) continue;
      nearby.push(obstacle);
    }
    for(const prop of this.streetPropColliders??[]){
      if(Math.abs(prop.x-position.x)>radius+prop.halfWidth||Math.abs(prop.z-position.z)>radius+prop.halfDepth)continue;
      const base=cityElevationAt(prop)+prop.base;
      if(currentSurfaceHeight!==undefined&&(currentSurfaceHeight>base+prop.height+.25||currentSurfaceHeight<base-1.5))continue;
      nearby.push(prop);
    }
    return nearby;
  }

  updateTrafficSignals(seconds: number) {
    if (!this.signalMaterials) return;
    for (const intersection of this.trafficIntersections) {
      for (const head of intersection.heads) {
        const color = trafficLightColor(seconds, head.axis, intersection.offset);
        head.red.material = color === "red" ? this.signalMaterials.red : this.signalMaterials.off;
        head.amber.material = color === "amber" ? this.signalMaterials.amber : this.signalMaterials.off;
        head.green.material = color === "green" ? this.signalMaterials.green : this.signalMaterials.off;
      }
    }
  }

  signalAhead(position: Coordinates, heading: number, seconds: number, surfaceHeight?: number) {
    const forwardX = Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    let best: { key: string; color: TrafficLightColor; distance: number } | null = null;
    if (!this.signalGrid || this.indexedSignalCount !== this.trafficIntersections.length) {
      this.signalGrid = new GridForgeCityGrid<TrafficIntersection>(64);
      for (const intersection of this.trafficIntersections) this.signalGrid.insert(intersection, {
        minX: intersection.position.x - intersection.width, maxX: intersection.position.x + intersection.width,
        minZ: intersection.position.z - intersection.width, maxZ: intersection.position.z + intersection.width,
      });
      this.indexedSignalCount = this.trafficIntersections.length;
    }
    for (const intersection of this.signalGrid.queryAround(position, 48)) {
      if(surfaceHeight!==undefined&&Math.abs(surfaceHeight-cityElevationAt(intersection.position))>1.5)continue;
      const dx = intersection.position.x - position.x;
      const dz = intersection.position.z - position.z;
      const along = dx * forwardX + dz * forwardZ;
      const lateral = Math.abs(dx * forwardZ - dz * forwardX);
      if (along < -6 || along > 44 || lateral > intersection.width * 0.64 + 2.4) continue;
      const axisX = Math.sin(intersection.heading);
      const axisZ = -Math.cos(intersection.heading);
      const approach = Math.abs(forwardX * axisX + forwardZ * axisZ) > 0.7 ? "main" : "cross";
      const distance = along - intersection.width * 0.52 - 2.1;
      if (!best || distance < best.distance) {
        best = { key: intersection.key, color: trafficLightColor(seconds, approach, intersection.offset), distance };
      }
    }
    return best;
  }

  nearbyTraffic(position: Coordinates, currentSurfaceHeight?: number): BuildingBounds[] {
    const result: BuildingBounds[] = [];
    for (const vehicle of this.trafficVehicles) {
      const p = vehicle.group.position;
      if(vehicle.group.userData.trafficReady===false)continue;
      if ((p.x-position.x)**2+(p.z-position.z)**2 >= 24*24 ||
          (currentSurfaceHeight !== undefined && Math.abs(p.y-currentSurfaceHeight) >= 1.45)) continue;
      const spec=VEHICLE_SPECS[vehicle.modelKind as VehicleClass];
      const width = spec.width*.47;
      const depth = spec.length*.47;
      const c = Math.cos(vehicle.group.rotation.y), s = Math.sin(vehicle.group.rotation.y);
      // Oriented footprints avoid the large empty corners of a rotated AABB.
      const outline = [[-width,-depth],[width,-depth],[width,depth],[-width,depth]].map(([x,z])=>({x:p.x+c*x+s*z,z:p.z-s*x+c*z}));
      result.push({x:p.x,z:p.z,halfWidth:Math.abs(c)*width+Math.abs(s)*depth,halfDepth:Math.abs(s)*width+Math.abs(c)*depth,outline});
    }
    return result;
  }

  nearestTrafficPosition(position: Coordinates, height: number, output: THREE.Vector3) {
    let distance = 65 * 65, found = false;
    for (const vehicle of this.trafficVehicles) {
      const p = vehicle.group.position;
      if(vehicle.group.userData.trafficReady===false)continue;
      if (Math.abs(p.y-height) >= 1.45) continue;
      const squared = (p.x-position.x)**2+(p.z-position.z)**2;
      if (squared < distance) { distance = squared; output.copy(p); found = true; }
    }
    return found;
  }

  private trafficSurface(route: TrafficRoute, progress: number, direction: 1 | -1) {
    this.trafficHeights ??= new WeakMap();
    let lanes = this.trafficHeights.get(route);
    if (!lanes) { lanes = new Map(); this.trafficHeights.set(route, lanes); }
    let cache = lanes.get(direction);
    if (!cache) { cache = new TrafficHeightCache(route.length); lanes.set(direction, cache); }
    const station=trafficStations(route).closed?((progress%route.length)+route.length)%route.length:progress;
    return cache.sample(station, distance => {
      const point = sampleTrafficRoute(route, distance, direction);
      return route.heightAt?route.heightAt(distance):cityElevationAt(point);
    });
  }

  private trafficConnection(route:TrafficRoute,direction:1|-1) {
    if(route.destination||trafficStations(route).closed)return null;
    this.trafficConnections??=new WeakMap();
    let entries=this.trafficConnections.get(route);
    if(!entries){entries=new Map();this.trafficConnections.set(route,entries);}
    if(!entries.has(direction))entries.set(direction,findTrafficConnection(route,direction,route.preferredExit?[route.preferredExit]:this.trafficRoutes,(r,p,d)=>this.trafficSurface(r,p,d).height));
    return entries.get(direction)??null;
  }

  private trafficSpeedLimit(route:TrafficRoute,progress:number,direction:1|-1,kind:VehicleClass,speed:number) {
    const spec=VEHICLE_SPECS[kind],braking=spec.braking*.6;
    let remaining=Math.max(10,speed*speed/(2*braking)+4),offset=0,limit=Infinity;
    for(let part=0;part<4&&remaining>0;part++) {
      const closed=trafficStations(route).closed,connection=this.trafficConnection(route,direction);
      const boundary=connection?.startAt??(direction===1?route.length:0);
      const available=closed?remaining:trafficTravelDistance(route,progress,boundary,direction);
      const corner=trafficCornerSpeed(route,progress,direction,Math.min(remaining,available),spec.lateral,braking);
      limit=Math.min(limit,Math.sqrt(corner*corner+2*braking*offset));
      if(available>=remaining||closed)break;
      remaining-=available;offset+=available;
      if(connection){route=connection.route;progress=0;direction=1;}
      else if(route.destination){const target=route.destination;route=target.route;progress=target.progress;direction=target.direction;}
      else break;
    }
    return limit;
  }

  updateRoadTraffic(seconds: number, dt: number, rider: Coordinates, riderSurfaceHeight?: number) {
    if(seconds>=(this.nextSignalUpdate??0)){this.updateTrafficSignals(seconds);this.nextSignalUpdate=seconds+.1;}
    const angleDelta=(a:number,b:number)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
    // All drivers observe the same instant, regardless of the array update order.
    const snapshots=this.trafficVehicles.map(vehicle=>({vehicle,...(vehicle.commuter&&vehicle.commuter.mode!=='road'?{x:vehicle.group.position.x,z:vehicle.group.position.z,heading:vehicle.commuter.state.heading}:sampleTrafficRoute(vehicle.route,vehicle.progress,vehicle.direction)),height:vehicle.group.position.y,speed:vehicle.speed,committed:vehicle.previousSignal}));
    for(const current of snapshots) {
      const vehicle=current.vehicle,kind=vehicle.modelKind as VehicleClass,spec=VEHICLE_SPECS[kind],route=vehicle.route;
      if(vehicle.commuter&&vehicle.commuter.mode!=='road'){
        const journey=vehicle.commuter,motion=journey.motion,presentation=vehicle.presentation??=new TrafficPresentation(vehicle.group,vehicle.visual,motion);presentation.capture(motion);
        journey.step(dt,rider,riderSurfaceHeight??cityElevationAt(rider),snapshots.filter(s=>s.vehicle!==vehicle).map(s=>({...s,length:VEHICLE_SPECS[s.vehicle.modelKind as VehicleClass].length,width:VEHICLE_SPECS[s.vehicle.modelKind as VehicleClass].width})));
        vehicle.speed=motion.speed;vehicle.group.position.set(journey.state.x,journey.height+.028,journey.state.z);vehicle.group.rotation.set(0,-journey.state.heading,motion.roll);vehicle.wheelRoll=motion.distance/VEHICLE_SPECS.motorcycle.radius;vehicle.steerAngle=motion.steer;
        if(vehicle.rig)updateTrafficRig(vehicle.rig,motion,'motorcycle',seconds);
        if(journey.mode==='road'){vehicle.route=journey.road;vehicle.progress=8;vehicle.direction=1;vehicle.cruise=10.2;vehicle.speed=motion.speed=motion.acceleration=0;}
        continue;
      }
      const closed=trafficStations(route).closed;
      const beforeAt=closed?vehicle.progress-2:Math.max(0,vehicle.progress-2),afterAt=closed?vehicle.progress+2:Math.min(route.length,vehicle.progress+2);
      const before=sampleTrafficRoute(route,beforeAt,vehicle.direction),after=sampleTrafficRoute(route,afterAt,vehicle.direction);
      const curvature=angleDelta(after.heading,before.heading)*vehicle.direction/Math.max(.1,trafficTravelDistance(route,beforeAt,afterAt,vehicle.direction));
      const connection=this.trafficConnection(route,vehicle.direction);
      const endDistance=trafficTravelDistance(route,vehicle.progress,vehicle.direction===1?route.length:0,vehicle.direction);
      let gap=closed||connection||route.destination?Infinity:endDistance-spec.length/2-.7,leaderSpeed=0;
      const signal=this.signalAhead(current,current.heading,seconds,current.height);
      const stopGap=signal?signal.distance-spec.length/2-.6:Infinity;
      if(!signal||signal.distance<-spec.length)vehicle.previousSignal='';
      if(signal&&(stopGap<-.15||(signal.color==='green'&&stopGap<.3)||(signal.color==='amber'&&stopGap<vehicle.speed*vehicle.speed/(2*spec.braking)+.5)))vehicle.previousSignal=signal.key;
      const committed=!!signal&&vehicle.previousSignal===signal.key;
      if(signal&&!committed&&signal.color!=='green'&&signal.distance>-.5)gap=Math.min(gap,stopGap);
      const fx=Math.sin(current.heading),fz=-Math.cos(current.heading);
      for(const other of snapshots) {
        if(other.vehicle===vehicle||Math.abs(other.height-current.height)>=1.45)continue;
        const dx=other.x-current.x,dz=other.z-current.z;if(dx*dx+dz*dz>55*55)continue;
        const alignment=Math.cos(current.heading-other.heading);
        // Crossing vehicles already admitted by the previous phase clear first.
        if(signal&&!committed&&other.committed===signal.key&&Math.abs(alignment)<.55){gap=Math.min(gap,stopGap);leaderSpeed=0;}
        const ahead=dx*fx+dz*fz,lateral=Math.abs(dx*fz-dz*fx),otherSpec=VEHICLE_SPECS[other.vehicle.modelKind as VehicleClass];
        if(alignment<.55||ahead<=0||lateral>(spec.width+otherSpec.width)*.43)continue;
        const bumperGap=ahead-(spec.length+otherSpec.length)/2;
        if(bumperGap<gap){gap=bumperGap;leaderSpeed=Math.max(0,other.speed*alignment);}
        // Do not enter a green junction whose exit queue has no room.
        if(signal&&!committed&&other.speed<.4&&ahead>signal.distance&&bumperGap<signal.distance+8){gap=Math.min(gap,stopGap);leaderSpeed=0;}
      }
      const dx=rider.x-current.x,dz=rider.z-current.z,ahead=dx*fx+dz*fz,lateral=Math.abs(dx*fz-dz*fx);
      if((riderSurfaceHeight===undefined||Math.abs(current.height-riderSurfaceHeight)<1.45)&&ahead>0&&ahead<50&&lateral<spec.width/2+.38) {
        const playerGap=ahead-spec.length/2-.85;if(playerGap<gap){gap=playerGap;leaderSpeed=0;}
      }
      const motion=vehicle.motion??=createTrafficMotion();
      if(Math.abs(motion.speed-vehicle.speed)>.001)motion.speed=vehicle.speed;
      const presentation=vehicle.presentation??=new TrafficPresentation(vehicle.group,vehicle.visual,motion);
      presentation.capture(motion);
      let teleported=false;
      const speedLimit=this.trafficSpeedLimit(route,vehicle.progress,vehicle.direction,kind,vehicle.speed);
      const travelled=advanceTrafficMotion(motion,kind,dt,vehicle.cruise,curvature,gap,leaderSpeed,speedLimit);
      vehicle.speed=motion.speed;vehicle.progress=advanceTrafficProgress(route,vehicle.progress,vehicle.direction,travelled);
      if(!closed&&connection&&(vehicle.direction===1?vehicle.progress>=connection.startAt:vehicle.progress<=connection.startAt)) {
        const excess=trafficTravelDistance(route,connection.startAt,vehicle.progress,vehicle.direction);
        vehicle.route=connection.route;vehicle.progress=advanceTrafficProgress(connection.route,0,1,excess);vehicle.direction=1;
      } else if(route.destination&&vehicle.progress>=route.length) {
        const excess=vehicle.progress-route.length,destination=route.destination;
        vehicle.route=destination.route;vehicle.progress=advanceTrafficProgress(destination.route,destination.progress,destination.direction,excess);vehicle.direction=destination.direction;
      } else if(!closed&&!connection&&!route.destination&&endDistance<spec.length/2+3&&vehicle.speed<.1&&Math.hypot(current.x-rider.x,current.z-rider.z)>180) {
        // Only a genuine dead end can recycle, and never into an occupied lane.
        const spawnProgress=vehicle.direction===1?spec.length/2+2:route.length-spec.length/2-2;
        const spawn=sampleTrafficRoute(route,spawnProgress,vehicle.direction);
        if(snapshots.every(other=>other.vehicle===vehicle||Math.hypot(other.x-spawn.x,other.z-spawn.z)>spec.length+3)){
          vehicle.progress=spawnProgress;vehicle.speed=motion.speed=motion.acceleration=0;teleported=true;
        }
      }
      const nextRoute=vehicle.route,next=sampleTrafficRoute(nextRoute,vehicle.progress,vehicle.direction);
      const surface=this.trafficSurface(nextRoute,vehicle.progress,vehicle.direction);
      const front=this.trafficSurface(nextRoute,advanceTrafficProgress(nextRoute,vehicle.progress,vehicle.direction,spec.wheelbase/2),vehicle.direction);
      const rear=this.trafficSurface(nextRoute,advanceTrafficProgress(nextRoute,vehicle.progress,vehicle.direction,-spec.wheelbase/2),vehicle.direction);
      vehicle.group.position.set(next.x,(front.height+rear.height)/2+.028,next.z);vehicle.group.rotation.y=-next.heading;
      vehicle.group.rotation.x=damp(vehicle.group.rotation.x,Math.atan2(front.height-rear.height,spec.wheelbase),12,dt);
      vehicle.group.rotation.z=kind==='motorcycle'?motion.roll:0;vehicle.wheelRoll=motion.distance/spec.radius;vehicle.steerAngle=motion.steer;
      presentation.axleResidual=((front.height+rear.height)/2-surface.height)*.5;
      if(vehicle.rig)updateTrafficRig(vehicle.rig,motion,kind,seconds,presentation.axleResidual);
      if(teleported)presentation.reset(motion);
    }
  }

  private loadElevationRaster() {
    const tile = tileFromLocation(DISTRICT_ORIGIN, TERRAIN_TILE_ZOOM);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (this.stopped) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const raster: ElevationRaster = { tile, data, width: canvas.width, height: canvas.height, reference: 0 };
        raster.reference = terrariumHeightAt({ x: 0, z: 0 }, raster) ?? 0;
        activeElevationRaster = raster;
        this.refreshTerrainMeshes();
      } catch {
        // Keep the immediately playable rolling-terrain fallback when CORS or a terrain provider is unavailable.
      }
    };
    image.src = `${TERRARIUM_ELEVATION_TILES}/${tile.zoom}/${tile.x}/${tile.y}.png`;
  }

  private refreshTerrainMeshes() {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const refreshed = new Set<THREE.BufferGeometry>();
    this.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if(object.userData.cityMultidraw){refreshCityBatch(object as THREE.BatchedMesh);return;}
      if (mesh.isMesh && mesh.geometry.getAttribute("terrainBaseY") && !refreshed.has(mesh.geometry)) {
        const source = mesh.geometry.userData.terrainSource as THREE.BufferGeometry | undefined;
        const terrainGeometry = source ?? mesh.geometry;
        if (!refreshed.has(terrainGeometry)) {
          conformGeometryToTerrain(terrainGeometry);
          refreshed.add(terrainGeometry);
        }
        if (source) refreshChunkBounds(mesh.geometry);
        refreshed.add(mesh.geometry);
      }
      if ((object as THREE.InstancedMesh).isInstancedMesh && Array.isArray(object.userData.terrainInstances)) {
        const instances = object as THREE.InstancedMesh;
        object.userData.terrainInstances.forEach((entry: Coordinates & { y: number; terrainAnchorX?: number; terrainAnchorZ?: number }, index: number) => {
          if(object.userData.struckStreetProps?.has(entry))return;
          instances.getMatrixAt(index, matrix);
          matrix.decompose(position, rotation, scale);
          const anchor = { x: entry.terrainAnchorX ?? entry.x, z: entry.terrainAnchorZ ?? entry.z };
          position.y = entry.y + (object.userData.expresswayAnchor ? expresswayGroundAt(anchor) : cityElevationAt(anchor));
          matrix.compose(position, rotation, scale);
          instances.setMatrixAt(index, matrix);
        });
        instances.instanceMatrix.needsUpdate = true;
        instances.computeBoundingBox();
        instances.computeBoundingSphere();
      }
      const anchor = object.userData.terrainAnchor as Coordinates | undefined;
      if (anchor) object.position.y = cityElevationAt(anchor) + Number(object.userData.terrainOffset ?? 0);
    });
    this.trafficHeights = new WeakMap();
    this.streetPropPhysics?.syncTerrain();
    this.staticRenderBatches?.invalidate();
    freezeStaticScene(this.group);
  }

  private loadPhotographicFacades() {
    const loader = new THREE.TextureLoader();
    const addresses = [
      "/textures/taiwan-facade-aged.webp",
      "/textures/taiwan-facade-office.webp",
      "/textures/taiwan-facade-market.webp",
      "/textures/taiwan-facade-residential.webp",
    ];
    addresses.forEach((address, appearance) => {
      loader.load(address, (texture) => {
        if (this.stopped) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1, 1);
        texture.anisotropy = this.maxAnisotropy;
        this.disposableTextures.push(texture);
        this.textures.facades.forEach((previous, index) => {
          if (index !== appearance) return;
          this.textures.facades[index] = texture;
          const material = this.facadeMaterials[index];
          if (material) {
            material.map = texture;
            material.needsUpdate = true;
          }
          previous.dispose();
        });
        if (appearance === 1 || appearance === 3) {
          for (const material of this.schoolFacadeMaterials) {
            material.map = texture;
            material.needsUpdate = true;
          }
        }
      });
    });
  }

  private async loadVectorCity() {
    try {
      const metadataResponse = await fetch(VECTOR_TILE_JSON);
      if (!metadataResponse.ok || this.stopped) return;
      const metadata = await metadataResponse.json() as { tiles?: string[] };
      const template = metadata.tiles?.[0];
      if (!template) return;
      const relevantLocations = [{ longitude: DISTRICT_ORIGIN.longitude, latitude: DISTRICT_ORIGIN.latitude }, ...TAICHUNG_LOCATIONS];
      const uniqueTiles = new Map<string, TileCoordinate>();
      for (const location of relevantLocations) {
        const tile = tileFromLocation(location, VECTOR_ZOOM);
        uniqueTiles.set(`${tile.x}/${tile.y}`, tile);
      }
      const settledTiles = await Promise.allSettled([...uniqueTiles.values()].map(async (tile) => {
        const url = template.replace("{z}", String(VECTOR_ZOOM)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
        const response = await fetch(url);
        if (!response.ok) throw new Error("Vector tile unavailable");
        return { tile, data: new VectorTile(new PbfReader(await response.arrayBuffer())) };
      }));
      const parsedTiles = settledTiles.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (parsedTiles.length === 0) return;
      if (this.stopped) return;
      const features = (layerName: string): TileFeature[] => {
        const result: TileFeature[] = [];
        for (const { tile, data } of parsedTiles) {
          const layer = data.layers[layerName];
          if (!layer) continue;
          for (let index = 0; index < layer.length; index++) {
            const feature = layer.feature(index);
            result.push({ properties: feature.properties as Record<string, unknown>, geometry: feature.toGeoJSON(tile.x, tile.y, VECTOR_ZOOM).geometry });
          }
        }
        return result;
      };
      const landcover = features("landcover");
      const parks = features("park");
      const landuse = features("landuse");
      const waterways = features("waterway");
      const water = features("water");
      const places = features("poi");
      const roads = features("transportation");
      if (roads.length === 0) return;
      this.clearAuthoredDistrict();
      this.liveDistrictLoaded = true;
      this.identifySchoolCampuses(landuse, places);
      this.renderGroundFeatures(landcover, parks, water, landuse);
      this.renderRiverChannels(waterways, water);
      const signatureBridge = authoredSignatureBridge();
      this.renderRoads([...roads, signatureBridge]);
      this.renderElevatedRoads([...roads, signatureBridge]);
      this.createRoadTraffic();
      this.renderTaiwanRoadFurniture();
      this.renderBuildings(features("building"));
      this.renderUrbanGrassDetail();
      this.renderParkLandmarks();
      this.renderSchoolLandmarks();
      this.renderStreetLighting();
      this.renderStreetLife();
      this.auditSpatialLayout();
    } catch {
      // The complete locally authored fictional district is always immediately playable.
    }
  }

  private identifySchoolCampuses(landuse: TileFeature[], places: TileFeature[]) {
    const describesSchool = (feature: TileFeature) => {
      const description = featureDescription(feature.properties);
      return ["school", "college", "university", "kindergarten", "education", "學校", "國小", "國中", "高中", "大學", "幼兒園"].some((word) => description.includes(word));
    };
    const register = (position: Coordinates, radius: number, name: string, outline?: Coordinates[]) => {
      if (Math.hypot(position.x, position.z) > WORLD_RADIUS) return;
      const existing = this.schoolCampuses.find((campus) => Math.hypot(campus.position.x - position.x, campus.position.z - position.z) < 58);
      if (existing) {
        if (name && existing.name === "城市學校") existing.name = name;
        if (outline && !existing.outline) existing.outline = outline;
        existing.radius = Math.max(existing.radius, radius);
        return;
      }
      this.schoolCampuses.push({ position, radius, name: name || "城市學校", outline });
    };

    for (const feature of landuse) {
      if (!describesSchool(feature)) continue;
      for (const polygon of polygonCoordinates(feature.geometry)) {
        const outline = localPolygon(polygon)[0];
        if (!outline || outline.length < 4) continue;
        const summary = outlineSummary(outline);
        register(summary.center, Math.max(18, Math.min(125, Math.sqrt(summary.area) * 0.57)), String(feature.properties.name ?? feature.properties.name_en ?? ""), outline);
      }
    }

    for (const feature of places) {
      if (!describesSchool(feature)) continue;
      for (const point of pointGeometryCoordinates(feature.geometry)) {
        register(point, 27, String(feature.properties.name ?? feature.properties.name_en ?? ""));
      }
    }
  }

  private renderRiverChannels(waterways: TileFeature[], _water: TileFeature[]) {
    const surfaces: THREE.BufferGeometry[] = [];
    const riverbeds: THREE.BufferGeometry[] = [];
    const embankments: THREE.BufferGeometry[] = [];
    const retainingWalls: THREE.BufferGeometry[] = [];
    for (const feature of waterways) {
      const description = featureDescription(feature.properties);
      if (["drain", "ditch"].some((type) => description.includes(type))) continue;
      const explicitWidth = Number(feature.properties.width ?? 0);
      const width = Number.isFinite(explicitWidth) && explicitWidth > 2
        ? Math.min(60, explicitWidth)
        : description.includes("river") ? 14 : description.includes("canal") ? 9 : 5.4;
      const mountainSource = feature.properties.mountain_source === true;
      const depth = mountainSource ? 1.35 : width >= 30 ? 3.2 : width >= 12 ? 2.25 : 1.55;
      for (const line of lineCoordinates(feature.geometry)) {
        const local: RoadPoint[] = line.map(localPoint);
        local.forEach((p,i)=>{
          const a=local[Math.max(0,i-1)], b=local[Math.min(local.length-1,i+1)];
          const previous=i?{x:p.x-a.x,z:p.z-a.z}:{x:b.x-p.x,z:b.z-p.z};
          const next=i<local.length-1?{x:b.x-p.x,z:b.z-p.z}:previous;
          const l1=Math.hypot(previous.x,previous.z)||1,l2=Math.hypot(next.x,next.z)||1;
          const nx=-previous.z/l1-next.z/l2,nz=previous.x/l1+next.x/l2,n=Math.hypot(nx,nz)||1;
          const dot=(nx/n)*(-next.z/l2)+(nz/n)*(next.x/l2);
          p.miter={x:nx/n/Math.max(.5,dot),z:nz/n/Math.max(.5,dot)};
        });
        if (!local.some((point) => Math.hypot(point.x, point.z) < WORLD_RADIUS)) continue;
        for (let index = 0; index < local.length - 1; index++) {
          const start = local[index];
          const end = local[index + 1];
          this.waterChannels.push({ a: start, b: end, width, depth });
          const surface = roadSegmentGeometry(start, end, width, -0.095);
          if (surface) surfaces.push(surface);
          const bed = roadSegmentGeometry(start, end, Math.max(2, width - 0.9), -depth);
          if (bed) riverbeds.push(bed);
          const length = Math.hypot(end.x - start.x, end.z - start.z);
          if (length < 1) continue;
          const normalX = -(end.z - start.z) / length;
          const normalZ = (end.x - start.x) / length;
          for (const side of [-1, 1]) {
            const bank = offsetRoadSegmentGeometry(start, end, 1.22, 0.045, side * (width / 2 + 0.6));
            if (bank) embankments.push(bank);
            const a = { x: start.x + normalX * side * width / 2, z: start.z + normalZ * side * width / 2 };
            const b = { x: end.x + normalX * side * width / 2, z: end.z + normalZ * side * width / 2 };
            retainingWalls.push(wallGeometry([a, b], 0.32, -depth + 0.06));
          }
        }
      }
    }

    if (this.waterChannels.length) {
      const count = this.waterChannels.length * 90;
      const stoneMaterial = new THREE.MeshStandardMaterial({ color: '#c1b29b', roughness: .92 });
      this.disposableMaterials.push(stoneMaterial);
      const stones = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1), stoneMaterial, count);
      stones.name = 'Submerged rounded river pebbles and boulders';
      const transform = new THREE.Object3D(); let instance=0;
      this.waterChannels.forEach((reach, reachIndex)=> {
        const dx=reach.b.x-reach.a.x, dz=reach.b.z-reach.a.z, length=Math.hypot(dx,dz);
        for(let n=0;n<90;n++) {
          const t=(n+.5)/90, offset=(deterministicNoise(n+reachIndex*91,17)-.5)*(reach.width-3);
          const x=reach.a.x+dx*t-dz/length*offset, z=reach.a.z+dz*t+dx/length*offset;
          const radius=.18+deterministicNoise(n,reachIndex+51)*.8;
          transform.position.set(x,cityElevationAt({x,z})-reach.depth+radius*.3,z);
          transform.scale.set(radius*1.3,radius*.45,radius); transform.rotation.set(0,n*2.4,.12); transform.updateMatrix();
          stones.setMatrixAt(instance,transform.matrix);
          stones.setColorAt(instance++,new THREE.Color().setHSL(.08+deterministicNoise(n,5)*.05,.09,.35+deterministicNoise(n,7)*.25));
        }
      });
      stones.instanceMatrix.needsUpdate=true; if(stones.instanceColor)stones.instanceColor.needsUpdate=true;
      stones.receiveShadow=true; this.group.add(stones);
    }

    const channel = mergeOrDispose(surfaces);
    if (channel) {
      const material = new THREE.MeshPhysicalMaterial({ color: "#8fc9c1", roughness: 0.12, metalness: 0.015, clearcoat: 1, clearcoatRoughness: 0.08, normalMap: this.textures.waterNormal, normalScale: new THREE.Vector2(0.12, 0.2), transparent: true, opacity: 0.7, transmission: 0.68, thickness: 3.2, attenuationColor: new THREE.Color("#3a8994"), attenuationDistance: 5.5, ior: 1.333, envMapIntensity: 1.18, depthWrite: false, side: THREE.DoubleSide });
      this.disposableMaterials.push(material);
      this.riverSurfaces.push(material);
      const mesh = new THREE.Mesh(channel, material);
      mesh.name = "Physical rivers and flowing urban canals";
      mesh.userData.flow = "terrain-following downhill water from the mountain catchment";
      this.group.add(mesh);
    }

    const riverbed = mergeOrDispose(riverbeds);
    if (riverbed) {
      const material = createRiverbedFinish();
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(riverbed, material);
      mesh.name = "Visible submerged riverbed depth";
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    const bankGeometry = mergeOrDispose(embankments);
    if (bankGeometry) {
      const material = new THREE.MeshStandardMaterial({ color: "#a69d8d", map: this.textures.paving, roughness: 0.96 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(bankGeometry, material);
      mesh.name = "Three-dimensional stone river embankments";
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    const wall = mergeOrDispose(retainingWalls);
    if (wall) {
      const material = new THREE.MeshStandardMaterial({ color: "#7f827d", map: this.textures.paving, roughness: 0.95, side: THREE.DoubleSide });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(wall, material);
      mesh.name = "Physical canal retaining walls";
      this.group.add(mesh);
    }
  }

  private renderGroundFeatures(landcover: TileFeature[], parks: TileFeature[], water: TileFeature[], landuse: TileFeature[] = []) {
    const grassGeometries: THREE.BufferGeometry[] = [];
    const waterGeometries: THREE.BufferGeometry[] = [];
    const campusGeometries: THREE.BufferGeometry[] = [];
    const addPolygons = (feature: TileFeature, list: THREE.BufferGeometry[], height: number, recordPark = false, followTerrain = false) => {
      for (const polygon of polygonCoordinates(feature.geometry)) {
        const local = localPolygon(polygon);
        if (!local[0]?.some((point) => Math.hypot(point.x, point.z) < WORLD_RADIUS)) continue;
        const geometry = flatPolygonGeometry(local, height, followTerrain);
        if (geometry) list.push(geometry);
        if (recordPark && local[0].length > 3) {
          const summary = outlineSummary(local[0]);
          if (summary.area > 95 && summary.area < 480_000 && !this.parkParcels.some((park) => Math.hypot(park.center.x - summary.center.x, park.center.z - summary.center.z) < 11)) {
            this.parkParcels.push({
              outline: local[0],
              center: summary.center,
              area: summary.area,
              name: String(feature.properties.name ?? feature.properties.name_en ?? "城市公園"),
            });
          }
        }
      }
    };
    for (const feature of parks) addPolygons(feature, grassGeometries, 0.026, true, true);
    for (const feature of [...landcover, ...landuse]) {
      const type = featureDescription(feature.properties);
      if (["grass", "wood", "park", "farmland", "meadow", "recreation_ground", "garden", "forest", "village_green"].some((name) => type.includes(name))) {
        addPolygons(feature, grassGeometries, 0.026, true, true);
      }
      if (["school", "college", "university", "kindergarten"].some((name) => type.includes(name))) {
        addPolygons(feature, campusGeometries, 0.035);
      }
    }
    for (const feature of water) addPolygons(feature, waterGeometries, -0.055);
    const grass = mergeOrDispose(grassGeometries);
    if (grass) {
      const material = new THREE.MeshStandardMaterial({ color: "#82a56e", map: this.textures.ground, roughness: 0.98, side: THREE.DoubleSide });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(grass, material);
      mesh.name = "Real mapped park lawns and green spaces";
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const campus = mergeOrDispose(campusGeometries);
    if (campus) {
      const material = new THREE.MeshStandardMaterial({ color: "#c6bbb0", map: this.textures.paving, roughness: 0.93, side: THREE.DoubleSide });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(campus, material);
      mesh.name = "Actual school and university campus grounds";
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const waterGeometry = mergeOrDispose(waterGeometries);
    if (waterGeometry) {
      const bedGeometry = waterGeometry.clone();
      bedGeometry.translate(0, -2.05, 0);
      const bedMaterial = new THREE.MeshStandardMaterial({ color: "#355f61", map: this.textures.ground, roughness: 0.97, side: THREE.DoubleSide });
      this.disposableMaterials.push(bedMaterial);
      const bed = new THREE.Mesh(bedGeometry, bedMaterial);
      bed.name = "Mapped submerged lake and river beds";
      bed.receiveShadow = true;
      this.group.add(bed);
      const material = new THREE.MeshPhysicalMaterial({ color: "#8fc9c1", roughness: 0.12, metalness: 0.015, clearcoat: 1, clearcoatRoughness: 0.08, normalMap: this.textures.waterNormal, normalScale: new THREE.Vector2(0.12, 0.2), transparent: true, opacity: 0.68, transmission: 0.48, thickness: 2.05, attenuationColor: new THREE.Color("#3a8994"), attenuationDistance: 5.5, ior: 1.333, envMapIntensity: 1.18, depthWrite: false, side: THREE.DoubleSide });
      this.disposableMaterials.push(material);
      this.riverSurfaces.push(material);
      const mesh = new THREE.Mesh(waterGeometry, material);
      mesh.name = "Real river and canal water surfaces";
      this.group.add(mesh);
    }
  }

  private renderUrbanBlocks(columns:number[],rows:number[],reserved:UrbanRect[]) {
    const layout=planUrbanBlocks(columns,rows,this.streetSegments,reserved,this.buildings);
    this.urbanPaving=layout.paving;this.urbanGardens=layout.gardens;
    const palettes={market:'#bbb4a9',business:'#b8bfc0',residential:'#b7b7ae'};
    for(const district of ['market','business','residential'] as const) {
      const parts:THREE.BufferGeometry[]=[];
      for(const r of layout.paving.filter(p=>p.district===district)) {
        const outline=[{x:r.left,z:r.back},{x:r.right,z:r.back},{x:r.right,z:r.front},{x:r.left,z:r.front},{x:r.left,z:r.back}];
        // Meet the existing 0.135 m sidewalk with a 7 mm drainage fall.
        const geometry=flatPolygonGeometry([outline],.128,true);if(!geometry)continue;
        const position=geometry.getAttribute('position'),uv=geometry.getAttribute('uv');
        for(let i=0;i<position.count;i++)uv.setXY(i,position.getX(i)/4.8,position.getZ(i)/4.8);
        parts.push(geometry);
      }
      const geometry=mergeOrDispose(parts);if(!geometry)continue;
      const material=new THREE.MeshStandardMaterial({color:palettes[district],map:this.textures.paving,normalMap:this.textures.pavingNormal,normalScale:new THREE.Vector2(.22,.22),roughness:.88});
      this.disposableMaterials.push(material);
      const mesh=new THREE.Mesh(geometry,material);mesh.name=`Connected ${district} block forecourts`;mesh.receiveShadow=true;this.group.add(mesh);
    }
    const borders:THREE.BufferGeometry[]=[];
    for(const r of layout.gardens)for(const [x,z,w,d] of [
      [(r.left+r.right)/2,r.back,r.right-r.left,.16],[(r.left+r.right)/2,r.front,r.right-r.left,.16],
      [r.left,(r.back+r.front)/2,.16,r.front-r.back],[r.right,(r.back+r.front)/2,.16,r.front-r.back],
    ]) {
      const geometry=new THREE.BoxGeometry(w,.14,d);geometry.translate(x,.145,z);borders.push(conformGeometryToTerrain(geometry,true));
    }
    const geometry=mergeOrDispose(borders);
    if(geometry){const material=new THREE.MeshStandardMaterial({color:'#aaa99e',map:this.textures.paving,roughness:.91});this.disposableMaterials.push(material);
      const mesh=new THREE.Mesh(geometry,material);mesh.name='Inset courtyard garden edging';mesh.receiveShadow=true;mesh.castShadow=true;this.group.add(mesh);}
    this.group.userData.urbanBlocks={pavedParcels:layout.paving.length,gardenCourts:layout.gardens.length,sidewalkStep:.007};
  }

  private renderUrbanGrassDetail() {
    const placements: Array<Coordinates & { scale: number; angle: number }> = [];
    const stationPaving = METRO_STATIONS.flatMap((_, index) => [metroConcourse(index), metroStreetApproach(index)]);
    for (let z = -810; z <= 810; z += 11.5) {
      for (let x = -890; x <= 1190; x += 11.5) {
        const candidate = {
          x: x + (deterministicNoise(x, z + 171) - 0.5) * 4.8,
          z: z + (deterministicNoise(z, x + 179) - 0.5) * 4.8,
        };
        if (Math.abs(candidate.x - 625) < 30) continue;
        if (stationPaving.some(area => Math.abs(candidate.x - area.x) < area.halfWidth + 3 && Math.abs(candidate.z - area.z) < area.halfDepth + 3)) continue;
        if (insideShoppingStreet(candidate, 1)) continue;
        if ((this.urbanPaving??[]).some(r=>containsRectPoint(r,candidate))) continue;
        if (this.streetSegments.some((street) => distanceToSegment(candidate, street.a, street.b) < street.width / 2 + 4.2)) continue;
        if (this.elevatedSegmentGrid.queryAround(candidate, 9).some((road) => distanceToSegment(candidate, road.a, road.b) < road.width / 2 + 2.8)) continue;
        if (this.buildings.some((building) => Math.abs(candidate.x - building.x) < building.halfWidth + 3.2 && Math.abs(candidate.z - building.z) < building.halfDepth + 3.2)) continue;
        placements.push({
          ...candidate,
          scale: 0.68 + deterministicNoise(x + 191, z) * 0.72,
          angle: deterministicNoise(x + 197, z + 199) * Math.PI,
        });
      }
    }
    if (placements.length === 0) return;
    const grassTexture = grassBladeTexture(this.maxAnisotropy);
    const material = new THREE.MeshStandardMaterial({ color: "#75965a", map: grassTexture, roughness: 0.96, side: THREE.DoubleSide, alphaTest: 0.42 });
    this.disposableTextures.push(grassTexture);
    this.disposableMaterials.push(material);
    const mesh = new THREE.InstancedMesh(grassTuftGeometry(), material, placements.length);
    mesh.name = "Dense collision-cleared urban grass tufts";
    mesh.userData.placementCount = placements.length;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    placements.forEach((placement, index) => {
      position.set(placement.x, cityElevationAt(placement) + 0.035, placement.z);
      rotation.setFromAxisAngle(up, placement.angle);
      scale.set(placement.scale, placement.scale, placement.scale);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      tint.setHSL(0.25 + deterministicNoise(index, 239) * 0.035, 0.31 + deterministicNoise(index, 241) * 0.14, 0.34 + deterministicNoise(index, 251) * 0.11);
      mesh.setColorAt(index, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  private renderElevatedRoads(features: TileFeature[]) {
    const decks: THREE.BufferGeometry[] = [];
    const undersides: THREE.BufferGeometry[] = [];
    const boxGirders: THREE.BufferGeometry[] = [];
    const edgeFascias: THREE.BufferGeometry[] = [];
    const integratedArchRibs: THREE.BufferGeometry[] = [];
    const urbanArchPieces: THREE.BufferGeometry[] = [], urbanHangers: THREE.BufferGeometry[] = [], urbanLights: THREE.BufferGeometry[] = [];
    const expansionJoints: THREE.BufferGeometry[] = [];
    const rails: THREE.BufferGeometry[] = [];
    const markings: THREE.BufferGeometry[] = [];
    const twoWayMarkings: THREE.BufferGeometry[] = [];
    const edgeMarkings: THREE.BufferGeometry[] = [];
    const ownedBuffers=[decks,undersides,boxGirders,edgeFascias,rails,markings,twoWayMarkings,edgeMarkings,expansionJoints];
    let roadNumber=0;
    const supports: Array<{
      x: number;
      z: number;
      height: number;
      width: number;
      angle: number;
      normalX: number;
      normalZ: number;
      pierOffsets: number[];
    }> = [];
    const junctionCandidates: Array<Coordinates & { height: number; width: number }> = [];
    let plannedSupportCount = 0;
    let relocatedSupportCount = 0;
    const pierClearsGround = (pier: Coordinates) =>
      this.streetSegments.every((street) => distanceToSegment(pier, street.a, street.b) >= street.width / 2 + 1.45)
      && AUTHORED_LANDMARK_CLEARANCES.every((area) => pier.x < area.left - 2 || pier.x > area.right + 2 || pier.z < area.back - 2 || pier.z > area.front + 2);

    for (const feature of features) {
      const roadOwner=String(feature.properties.name??`elevated-${roadNumber++}`);
      const roadPriority=feature.properties.continuous_elevated===true?3:feature.properties.mainline_connector===true?2:1;
      const starts=ownedBuffers.map(buffer=>buffer.length);
      const layer = Number(feature.properties.layer ?? 0);
      const bridge = String(feature.properties.brunnel ?? feature.properties.bridge ?? "").toLowerCase();
      if (bridge !== "bridge" && bridge !== "yes" && layer <= 0) continue;
      const roadClass = String(feature.properties.class ?? feature.properties.subclass ?? "minor");
      if (["rail", "transit", "ferry", "aerialway", "path", "footway"].includes(roadClass)) continue;
      const width = roadWidth(feature.properties);
      const urbanCrossing = feature.properties.urban_crossing === true;
      const authoredHeight = Number(feature.properties.elevated_height ?? Number.NaN);
      const maximumHeight = Number.isFinite(authoredHeight) ? authoredHeight : urbanCrossing
        ? 2.35
        : ["motorway", "trunk", "primary"].includes(roadClass) || layer > 0 ? 5.7 + Math.max(0, layer - 1) * 2.2 : 3.35;
      const authoredBaseHeight = Number(feature.properties.base_elevated_height ?? 0);
      const baseHeight = Number.isFinite(authoredBaseHeight) ? authoredBaseHeight : 0;
      const continuousElevated = feature.properties.continuous_elevated === true;
      const rampDirection = String(feature.properties.ramp_direction ?? "");
      const twoWayApproach = feature.properties.two_way === true;
      const suppliedBridgeProfile = feature.properties.supplied_bridge_profile === true;
      const kitStyle: ElevatedRoadSegment["kitStyle"] = feature.properties.kit_style === "suspension" ? "suspension" : "modular";
      const useSuppliedSignatureBridge = kitStyle === "suspension";

      for (const line of lineCoordinates(feature.geometry)) {
        const sourcePoints = line.map(localPoint);
        const local: RoadPoint[] = [];
        for (let index = 0; index < sourcePoints.length - 1; index++) {
          const start = sourcePoints[index];
          const end = sourcePoints[index + 1];
          const distance = Math.hypot(end.x - start.x, end.z - start.z);
          const subdivisions = Math.max(1, Math.min(72, Math.ceil(distance / 8)));
          for (let section = 0; section < subdivisions; section++) {
            const progress = section / subdivisions;
            local.push({
              x: start.x + (end.x - start.x) * progress,
              z: start.z + (end.z - start.z) * progress,
            });
          }
        }
        if (sourcePoints.length > 0) local.push(sourcePoints[sourcePoints.length - 1]);
        if (!local.some((point) => Math.hypot(point.x, point.z) < WORLD_RADIUS)) continue;
        let totalLength = 0;
        const cumulative = [0];
        for (let index = 0; index < local.length - 1; index++) {
          totalLength += Math.hypot(local[index + 1].x - local[index].x, local[index + 1].z - local[index].z);
          cumulative.push(totalLength);
        }
        if (totalLength < 9) continue;
        for (let i = 0; i < local.length; i++) {
          const closed = Math.hypot(local[0].x - local.at(-1)!.x, local[0].z - local.at(-1)!.z) < .01;
          const before = local[i === 0 && closed ? local.length - 2 : Math.max(0, i - 1)];
          const after = local[i === local.length - 1 && closed ? 1 : Math.min(local.length - 1, i + 1)];
          const point = local[i];
          const outgoing = i === local.length - 1 && !closed ? { x: point.x - before.x, z: point.z - before.z } : { x: after.x - point.x, z: after.z - point.z };
          const incoming = i === 0 && !closed ? outgoing : { x: point.x - before.x, z: point.z - before.z };
          const la = Math.hypot(incoming.x, incoming.z) || 1, lb = Math.hypot(outgoing.x, outgoing.z) || 1;
          const ax = -incoming.z / la, az = incoming.x / la, bx = -outgoing.z / lb, bz = outgoing.x / lb;
          const denominator = Math.max(.5, 1 + ax * bx + az * bz);
          point.miter = { x: (ax + bx) / denominator, z: (az + bz) / denominator };
        }

        const startLanding = Number(feature.properties.start_landing ?? 0);
        const endLanding = Number(feature.properties.end_landing ?? 0);
        const widthAt = (distance: number) => {
          const first = Number(feature.properties.start_width ?? width), last = Number(feature.properties.end_width ?? width);
          const startMerge = Number(feature.properties.merge_start_length ?? 0), endMerge = Number(feature.properties.merge_end_length ?? 0);
          const blend = (t: number) => t * t * (3 - 2 * t);
          const preserveThroughWidth = twoWayApproach || feature.properties.mainline_connector === true;
          if (!preserveThroughWidth && startMerge > 0 && distance < startMerge) return 2.8 + (first - 2.8) * blend(distance / startMerge);
          if (!preserveThroughWidth && endMerge > 0 && distance > totalLength - endMerge) return 2.8 + (last - 2.8) * blend((totalLength - distance) / endMerge);
          if (distance <= startLanding) return first;
          if (distance >= totalLength - endLanding) return last;
          return transitionWidth(distance - startLanding, Math.max(1, totalLength - startLanding - endLanding), width, first, last);
        };
        const rampLength = Math.min(totalLength * 0.48, Math.max(totalLength * 0.32, 55), 95);
        const smoothRise = (value: number) => {
          const progress = Math.max(0, Math.min(1, value));
          return progress * progress * (3 - 2 * progress);
        };
        const profile = (distance: number) => {
          const lowLanding = baseHeight > 0 ? Math.min(55, totalLength * .28) : Math.min(12, totalLength * .08);
          const highLanding = Math.min(55, totalLength * .28);
          const requestedStart = Number(feature.properties.start_landing ?? (rampDirection === "down" ? highLanding : lowLanding));
          const requestedEnd = Number(feature.properties.end_landing ?? (rampDirection === "down" ? lowLanding : highLanding));
          const landingBudget=Math.max(0,totalLength-Math.abs(maximumHeight-baseHeight)*1.5/.085);
          const mergeStart=Number(feature.properties.merge_start_length??0),mergeEnd=Number(feature.properties.merge_end_length??0);
          const extraStart=Math.max(0,requestedStart-mergeStart),extraEnd=Math.max(0,requestedEnd-mergeEnd);
          const landingScale=Math.min(1,Math.max(0,landingBudget-mergeStart-mergeEnd)/Math.max(1,extraStart+extraEnd));
          const startFlat=mergeStart+extraStart*landingScale,endFlat=mergeEnd+extraEnd*landingScale;
          const climb = Math.max(1, totalLength - startFlat - endFlat);
          const rise = smoothRise((distance - startFlat) / climb);
          if (continuousElevated) return maximumHeight;
          if (rampDirection === "up") return baseHeight + (maximumHeight - baseHeight) * rise;
          if (rampDirection === "down") return baseHeight + (maximumHeight - baseHeight) * (1 - rise);
          if (suppliedBridgeProfile) return maximumHeight + Math.sin(Math.PI * distance / totalLength) * 4.55;
          if (urbanCrossing) return maximumHeight * Math.pow(Math.sin(Math.PI * distance / totalLength), 2);
          return maximumHeight * Math.min(
            smoothRise(distance / rampLength),
            smoothRise((totalLength - distance) / rampLength),
          );
        };
        if (urbanCrossing && Number(feature.properties.lanes ?? 1) >= 2) {
          const archPieces=urbanArchPieces, hangers=urbanHangers, lights=urbanLights;
          const first=local[0],last=local[local.length-1];
          const ux=(last.x-first.x)/totalLength, uz=(last.z-first.z)/totalLength;
          const point=(distance:number,side:number,height:number)=>new THREE.Vector3(first.x+ux*distance-uz*side,expresswayGroundAt({x:first.x+ux*distance,z:first.z+uz*distance})+height,first.z+uz*distance+ux*side);
          const begin=20, span=totalLength-40;
          for(const side of [-1,1]) {
            const lateral=side*(width/2+1.05);
            const samples=Array.from({length:49},(_,i)=> {
              const t=i/48, distance=begin+span*t;
              return point(distance,lateral,profile(distance)+.25+10*Math.sin(Math.PI*t));
            });
            archPieces.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(samples),64,.28,8,false));
            for(let i=1;i<12;i++) {
              const t=i/12, distance=begin+span*t;
              const bottom=point(distance,lateral,profile(distance)+.15);
              const top=point(distance,lateral,profile(distance)+.25+10*Math.sin(Math.PI*t));
              const rod=new THREE.CylinderGeometry(.038,.038,top.distanceTo(bottom),6);
              rod.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),top.clone().sub(bottom).normalize()));
              rod.translate((top.x+bottom.x)/2,(top.y+bottom.y)/2,(top.z+bottom.z)/2);hangers.push(rod);
              const bracket=new THREE.BoxGeometry(2.1,.22,.25);bracket.rotateY(Math.atan2(-uz,ux));
              const at=point(distance,side*(width/2+.3),profile(distance)-.1);bracket.translate(at.x,at.y,at.z);archPieces.push(bracket);
            }
            const lightPoints=Array.from({length:49},(_,i)=>point(begin+span*i/48,side*(width/2+.24),profile(begin+span*i/48)+.85));
            lights.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(lightPoints),48,.028,4,false));
          }

        }
        const sampleRoute = (distance: number) => {
          const clamped = Math.max(0, Math.min(totalLength, distance));
          let segmentIndex = 0;
          while (segmentIndex < cumulative.length - 2 && cumulative[segmentIndex + 1] < clamped) segmentIndex++;
          const start = local[segmentIndex];
          const end = local[segmentIndex + 1];
          const length = Math.max(0.001, cumulative[segmentIndex + 1] - cumulative[segmentIndex]);
          const progress = Math.max(0, Math.min(1, (clamped - cumulative[segmentIndex]) / length));
          return {
            x: start.x + (end.x - start.x) * progress,
            z: start.z + (end.z - start.z) * progress,
            dx: (end.x - start.x) / length,
            dz: (end.z - start.z) / length,
            distance: clamped,
          };
        };
        for (const distance of [0, totalLength]) {
          const point = sampleRoute(distance);
          const height = 0.082 + Math.max(0, profile(distance));
          if (!urbanCrossing && !useSuppliedSignatureBridge && height > 1.2) junctionCandidates.push({ x: point.x, z: point.z, height, width });
        }
        if (!useSuppliedSignatureBridge && !urbanCrossing) {
          const supportSpacing = width >= 10 ? 54 : 48;
          let lastSupportDistance = -Infinity;
          for (let nominal = supportSpacing / 2; nominal <= totalLength - 12; nominal += supportSpacing) {
            if (0.082 + Math.max(0, profile(nominal)) < 1.55) continue;
            plannedSupportCount++;
            let selected: ReturnType<typeof sampleRoute> | null = null;
            let selectedOffsets: number[] = [];
            for (const shift of [0, -6, 6, -12, 12, -18, 18, -24, 24]) {
              const station = Math.max(12, Math.min(totalLength - 12, nominal + shift));
              if (station - lastSupportDistance < 40) continue;
              const point = sampleRoute(station);
              const normalX = -point.dz;
              const normalZ = point.dx;
              const offsets: number[] = [];
              for (const side of [-1, 1]) {
                for (let offset = width / 2 + 2.1; offset <= width / 2 + 4.1; offset += 1) {
                  const pier = { x: point.x + normalX * side * offset, z: point.z + normalZ * side * offset };
                  if (pierClearsGround(pier)) {
                    offsets.push(side * offset);
                    break;
                  }
                }
              }
              if (offsets.length > selectedOffsets.length) {
                selected = point;
                selectedOffsets = offsets;
              }
              if (offsets.length === 2) break;
            }
            if (!selected || selectedOffsets.length === 0) {
              for (const shift of [0, -6, 6, -12, 12, -18, 18, -24, 24]) {
                const station = Math.max(12, Math.min(totalLength - 12, nominal + shift));
                if (station - lastSupportDistance < 40) continue;
                const point = sampleRoute(station);
                const normalX = -point.dz;
                const normalZ = point.dx;
                const offsets: number[] = [];
                for (const side of [-1, 1]) {
                  for (let offset = width / 2 + 4.1; offset <= width / 2 + 22.1; offset += 1.5) {
                    const pier = { x: point.x + normalX * side * offset, z: point.z + normalZ * side * offset };
                    if (pierClearsGround(pier)) {
                      offsets.push(side * offset);
                      break;
                    }
                  }
                }
                if (offsets.length > 0) {
                  selected = point;
                  selectedOffsets = offsets;
                  break;
                }
              }
            }
            if (!selected || selectedOffsets.length === 0) continue;
            if (Math.abs(selected.distance - nominal) > 0.1) relocatedSupportCount++;
            const height = 0.082 + Math.max(0, profile(selected.distance));
            supports.push({
              x: selected.x,
              z: selected.z,
              height,
              width,
              angle: Math.atan2(-selected.dx, -selected.dz),
              normalX: -selected.dz,
              normalZ: selected.dx,
              pierOffsets: selectedOffsets,
            });
            lastSupportDistance = selected.distance;
          }
        }
        if (width >= 7 && totalLength > 48) {
          this.trafficRoutes.push({ points: local, width, length: totalLength, district:'highway', heightAt:distance=>{
            const point=sampleRoute(distance);return expresswayGroundAt(point)+profile(distance);
          }});
        }

        for (let index = 0; index < local.length - 1; index++) {
          const start = local[index];
          const end = local[index + 1];
          const startHeight = 0.082 + Math.max(0, profile(cumulative[index]));
          const endHeight = 0.082 + Math.max(0, profile(cumulative[index + 1]));
          const startWidth = widthAt(cumulative[index]), endWidth = widthAt(cumulative[index + 1]);
          const segmentLength = Math.max(0.001, Math.hypot(end.x - start.x, end.z - start.z));
          const seamOverlap = 0;
          const seamStart = { miter: start.miter, x: start.x - (end.x - start.x) / segmentLength * seamOverlap, z: start.z - (end.z - start.z) / segmentLength * seamOverlap };
          const seamEnd = { miter: end.miter, x: end.x + (end.x - start.x) / segmentLength * seamOverlap, z: end.z + (end.z - start.z) / segmentLength * seamOverlap };
          const deck = roadSegmentGeometry(seamStart, seamEnd, startWidth, startHeight, endHeight, endWidth);
          const underside = roadSegmentGeometry(seamStart, seamEnd, startWidth + 0.42, startHeight - 0.38, endHeight - 0.38, endWidth + .42);
          if (deck) decks.push(deck);
          if (underside) undersides.push(underside);
          for (const offset of [-width * 0.34, 0, width * 0.34]) {
            const girder = bridgeBeamGeometry(start, end, 0.48, 0.68, startHeight - 0.64, endHeight - 0.64, offset);
            if (girder) boxGirders.push(girder);
          }
          for (const side of [-1, 1]) {
            const fascia = bridgeBeamGeometry(start, end, 0.34, 0.58, startHeight - 0.43, endHeight - 0.43, side * (startWidth / 2 + 0.08), side * (endWidth / 2 + .08));
            if (fascia) edgeFascias.push(fascia);
            if (urbanCrossing) {
              const rib = bridgeBeamGeometry(start, end, 0.62, 1.08, startHeight - 0.72, endHeight - 0.72, side * Math.max(0.6, width / 2 - 0.7));
              if (rib) integratedArchRibs.push(rib);
            }
          }
          this.registerElevatedSegment({ roadOwner, roadPriority, a: start, b: end, width: Math.max(startWidth, endWidth), startWidth, endWidth, startHeight, endHeight, kitStyle });
          for (const side of [-1, 1]) {
            if (Math.max(startHeight, endHeight) > 0.12) {
              const rail = bridgeRailGeometry(start, end, startWidth, startHeight, endHeight, side, endWidth);
              if (rail) rails.push(rail);
            }
            const stripe = offsetRoadSegmentGeometry(start, end, 0.12, startHeight + 0.018, side * (startWidth / 2 - 0.46), endHeight + 0.018, side * (endWidth / 2 - .46));
            if (stripe) edgeMarkings.push(stripe);
          }
          if (twoWayApproach) {
            for (const offset of [-.16,.16]) {
              const stripe=offsetRoadSegmentGeometry(start,end,.105,startHeight+.023,offset,endHeight+.023);
              if(stripe)twoWayMarkings.push(stripe);
            }
          }
          if (twoWayApproach && Number(feature.properties.lanes) >= 4) {
            // Keep the original four-lane street pattern continuous over the grade.
            const begin = cumulative[index], finish = cumulative[index + 1];
            for (let dash = Math.floor(begin / 9) * 9; dash < finish; dash += 9) {
              const from = Math.max(begin, dash), to = Math.min(finish, dash + 3.6);
              if (to <= from) continue;
              const a = (from - begin) / segmentLength, b = (to - begin) / segmentLength;
              const at = (t: number) => ({ x: start.x + (end.x-start.x)*t, z: start.z + (end.z-start.z)*t, miter: { x: -(end.z-start.z)/segmentLength, z: (end.x-start.x)/segmentLength } });
              for (const sign of [-1,1]) {
                const line = offsetRoadSegmentGeometry(at(a), at(b), .105,
                  startHeight + (endHeight-startHeight)*a + .023,
                  sign * (startWidth + (endWidth-startWidth)*a) / 4,
                  startHeight + (endHeight-startHeight)*b + .023,
                  sign * (startWidth + (endWidth-startWidth)*b) / 4);
                if (line) markings.push(line);
              }
            }
          }
          if (width >= 8 && !twoWayApproach) {
            const middle = offsetRoadSegmentGeometry(start, end, 0.12, startHeight + 0.019, 0, endHeight + 0.019);
            if (middle) markings.push(middle);
          }
          if (width >= 14) {
            for (const offset of [-3.55, 3.55]) {
              if (Math.floor(cumulative[index] / 6) % 2 !== 0) continue;
              const dash = offsetRoadSegmentGeometry(start, end, 0.12, startHeight + 0.02, offset, endHeight + 0.02);
              if (dash) markings.push(dash);
            }
          }

          if (index % 12 === 0 && startHeight > 1.2) {
            const length = Math.hypot(end.x - start.x, end.z - start.z);
            const normalX = -(end.z - start.z) / Math.max(length, 0.001);
            const normalZ = (end.x - start.x) / Math.max(length, 0.001);
            const center = { x: start.x + (end.x - start.x) * 0.08, z: start.z + (end.z - start.z) * 0.08 };
            const joint = roadSegmentGeometry(
              { x: center.x - normalX * width * 0.46, z: center.z - normalZ * width * 0.46 },
              { x: center.x + normalX * width * 0.46, z: center.z + normalZ * width * 0.46 },
              0.18,
              startHeight + (endHeight - startHeight) * 0.08 + 0.028,
            );
            if (joint) expansionJoints.push(joint);
          }

        }
      }
      ownedBuffers.forEach((buffer,i)=>{
        for(let j=starts[i];j<buffer.length;j++)buffer[j].userData={roadOwner,roadPriority};
      });
    }

    for (const candidate of junctionCandidates) {
      const approaches: number[] = [];
      let radius = candidate.width / 2 + 1.65;
      for (const segment of this.elevatedSegmentGrid.queryAround(candidate, candidate.width + 5)) {
        const dx = segment.b.x - segment.a.x;
        const dz = segment.b.z - segment.a.z;
        const squared = dx * dx + dz * dz;
        if (squared < 0.01 || distanceToSegment(candidate, segment.a, segment.b) > segment.width / 2 + 0.8) continue;
        const progress = Math.max(0, Math.min(1, ((candidate.x - segment.a.x) * dx + (candidate.z - segment.a.z) * dz) / squared));
        const height = segment.startHeight + (segment.endHeight - segment.startHeight) * progress;
        if (Math.abs(height - candidate.height) > 0.72) continue;
        const heading = Math.atan2(dx, dz);
        if (!approaches.some((existing) => Math.acos(Math.min(1, Math.abs(Math.cos(existing - heading)))) < 0.2)) approaches.push(heading);
        radius = Math.max(radius, segment.width / 2 + 1.65);
      }
      const hasTurn = approaches.some((first, index) => approaches.slice(index + 1).some((second) =>
        Math.acos(Math.min(1, Math.abs(Math.cos(first - second)))) > 0.32,
      ));
      if (!hasTurn) continue;
      const existing = this.elevatedJunctions.find((junction) =>
        Math.hypot(junction.position.x - candidate.x, junction.position.z - candidate.z) < 2.5
        && Math.abs(junction.height - candidate.height) < 0.72,
      );
      if (existing) existing.radius = Math.max(existing.radius, radius);
      else this.elevatedJunctions.push({ position: { x: candidate.x, z: candidate.z }, radius, height: candidate.height });
    }

    const addMerged = (geometries: THREE.BufferGeometry[], material: THREE.Material, name: string) => {
      const families=new Map<string,{priority:number;pieces:THREE.BufferGeometry[]}>();
      for(const piece of geometries){
        const owner=String(piece.userData.roadOwner??''),family=families.get(owner)??{priority:piece.userData.roadPriority??0,pieces:[] as THREE.BufferGeometry[]};
        family.pieces.push(piece);families.set(owner,family);
      }
      const finished:THREE.BufferGeometry[]=[];
      const barrier=name.includes('parapets')||name.includes('fascias');
      const edge=name.includes('Boundary edge');
      const pavement=name.includes('bridge decks')||name.includes('undersides')||name.includes('lane markings')||name.includes('centre lines')||name.includes('expansion joints');
      for(const [owner,family] of families){
        let part=mergeOrDispose(family.pieces);if(!part)continue;
        if(owner&&(barrier||edge||pavement)){
          const query=(point:Coordinates,radius:number)=>this.elevatedSegmentGrid.queryAround(point,radius).filter(road=>road.roadOwner!==owner&&(barrier||edge||(road.roadPriority??0)>family.priority));
          part=clearBridgeRailIntrusions(part,query,expresswayGroundAt,{margin:0,below:barrier?1.1:name.includes('undersides')?.5:.06,above:barrier?3.2:.10,designHeight:true});
        }
        finished.push(part);
      }
      const geometry=mergeOrDispose(finished);
      if(!geometry){material.dispose();return;}
      this.disposableMaterials.push(material);
      if (name.includes("bridge decks") && (material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        this.roadSurfaceMaterials?.push(material as THREE.MeshStandardMaterial);
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.group.add(mesh);
    };
    addMerged(decks, new THREE.MeshStandardMaterial({ color: "#737577", map: this.textures.asphalt, normalMap: this.textures.asphaltNormal, roughnessMap: this.textures.asphaltRoughness, normalScale: new THREE.Vector2(0.58, 0.58), roughness: 0.92, side: THREE.DoubleSide }), "Real elevated roads and bridge decks");
    addMerged(twoWayMarkings, new THREE.MeshBasicMaterial({color:'#e8bd51',side:THREE.DoubleSide}), 'Double yellow centre lines on two-way city approach ramps');
    addMerged(undersides, new THREE.MeshStandardMaterial({ color: "#555d60", roughness: 0.98, metalness: 0, envMapIntensity: 0.12, side: THREE.DoubleSide }), "Physical overpass concrete undersides");
    addMerged(boxGirders, new THREE.MeshStandardMaterial({ color: "#62696a", roughness: 0.94, metalness: 0.02, envMapIntensity: 0.16 }), "Continuous structural bridge box girders");
    addMerged(edgeFascias, new THREE.MeshStandardMaterial({ color: "#737a78", roughness: 0.88, metalness: 0.03, envMapIntensity: 0.18 }), "Continuous architectural bridge-edge fascias");
    addMerged(integratedArchRibs, new THREE.MeshStandardMaterial({ color: "#697271", roughness: 0.91, metalness: 0.02, envMapIntensity: 0.14 }), "Integrated arched cross-river bridge ribs");
    addMerged(urbanArchPieces,new THREE.MeshStandardMaterial({color:'#e2ded3',metalness:.55,roughness:.31}),'Pearl steel river bridge tied arches');
    addMerged(urbanHangers,new THREE.MeshStandardMaterial({color:'#7a858b',metalness:.8,roughness:.28}),'Bridge hangers connected to edge brackets');
    addMerged(urbanLights,new THREE.MeshStandardMaterial({color:'#ffe6ad',emissive:'#ffd090',emissiveIntensity:1.4}),'Recessed warm bridge parapet lighting');
    addMerged(rails, new THREE.MeshStandardMaterial({ color: "#a8aba4", roughness: 0.7, metalness: 0.19, side: THREE.DoubleSide }), "Solid elevated-road bridge parapets");
    addMerged(edgeMarkings, new THREE.MeshStandardMaterial({ color: "#ece6cd", roughness: 0.79 }), "Boundary edge markings outside continuous merged pavement");
    addMerged(markings, new THREE.MeshStandardMaterial({ color: "#ece6cd", roughness: 0.79 }), "Bridge and ramp lane markings");
    addMerged(expansionJoints, new THREE.MeshStandardMaterial({ color: "#282d2e", roughness: 0.53, metalness: 0.58 }), "Visible bridge deck expansion joints");

    if (this.elevatedJunctions.length > 0) {
      const asphalt = new THREE.MeshStandardMaterial({ color: "#737577", map: this.textures.asphalt, normalMap: this.textures.asphaltNormal, roughnessMap: this.textures.asphaltRoughness, normalScale: new THREE.Vector2(0.58, 0.58), roughness: 0.92 });
      const concrete = new THREE.MeshStandardMaterial({ color: "#888e8c", roughness: 0.86, metalness: 0.05 });
      this.disposableMaterials.push(asphalt, concrete);
      this.roadSurfaceMaterials?.push(asphalt);
      const platforms = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 0.42, 24), [concrete, asphalt, concrete], this.elevatedJunctions.length);
      platforms.name = "Welded elevated-road junction platforms";
      platforms.userData.expresswayAnchor = true;
      platforms.userData.terrainInstances = this.elevatedJunctions.map(junction => ({ ...junction.position, y: junction.height - .19 }));
      platforms.userData.structure = "Continuous turn-safe bridge deck joints";
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      this.elevatedJunctions.forEach((junction, index) => {
        position.set(junction.position.x, expresswayGroundAt(junction.position) + junction.height - 0.19, junction.position.z);
        scale.set(junction.radius, 1, junction.radius);
        matrix.compose(position, rotation, scale);
        platforms.setMatrixAt(index, matrix);
      });
      platforms.instanceMatrix.needsUpdate = true;
      platforms.receiveShadow = true;
      platforms.castShadow = true;
      this.group.add(platforms);
    }

    if (supports.length > 0) {
      const material = createConcretePierMaterial();
      this.disposableMaterials.push(material);
      const pierCount = supports.reduce((total, support) => total + support.pierOffsets.length, 0);
      const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.88, 1.02, 1, 32), material, pierCount);
      mesh.name = "Three-dimensional elevated-road support pillars";
      mesh.userData.structure = "Road-clear reinforced-concrete bridge piers";
      mesh.userData.finish = "Tapered architectural pier shafts";
      mesh.userData.minimumLongitudinalSpacing = 40;
      mesh.userData.plannedSupportCount = plannedSupportCount;
      mesh.userData.placedSupportCount = supports.length;
      mesh.userData.relocatedSupportCount = relocatedSupportCount;
      const caps = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 3, 0.1), material, supports.length);
      caps.name = "Full-width bridge pier crossheads";
      caps.userData.expresswayAnchor = true;
      caps.userData.terrainInstances = supports.map(support => ({ x: support.x, z: support.z, y: support.height - 1.28 }));
      caps.userData.maximumTopBelowDeck = 0.92;
      const footings = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 3, 0.1), material, pierCount);
      footings.name = "Massive bridge pier foundations";
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const position = new THREE.Vector3();
      let pierIndex = 0;
      supports.forEach((support, index) => {
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), support.angle);
        for (const offset of support.pierOffsets) {
          const x = support.x + support.normalX * offset;
          const z = support.z + support.normalZ * offset;
          this.registerBridgePier({ x, z, halfWidth: 1.28, halfDepth: 1.28 });
          const ground = cityElevationAt({ x, z });
          const shaftTop = expresswayGroundAt(support) + support.height - 1.12;
          const shaftHeight = Math.max(.3, shaftTop - ground);
          position.set(x, ground + shaftHeight / 2, z);
          scale.set(1.18, shaftHeight, 1.36);
          matrix.compose(position, rotation, scale);
          mesh.setMatrixAt(pierIndex, matrix);
          position.set(x, cityElevationAt({ x, z }) + 0.16, z);
          scale.set(2.25, 0.32, 2.4);
          matrix.compose(position, rotation, scale);
          footings.setMatrixAt(pierIndex, matrix);
          pierIndex++;
        }
        position.set(support.x, expresswayGroundAt(support) + support.height - 1.28, support.z);
        const crossheadSpan = Math.max(support.width + 2.4, Math.max(...support.pierOffsets.map(Math.abs)) * 2 + 2.4);
        scale.set(crossheadSpan, 0.72, 1.72);
        matrix.compose(position, rotation, scale);
        caps.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      caps.instanceMatrix.needsUpdate = true;
      footings.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      caps.castShadow = true;
      footings.receiveShadow = true;
      this.group.add(mesh, caps, footings);
    }
  }

  private renderTaiwanGuideSigns() {
    const plan = authoredExpresswayPlan();
    const destinations = [["北城", "Beicheng"], ["南港", "Nangang"], ["西城", "Xicheng"], ["東河", "Donghe"]];
    plan.ringExits.forEach((route, index) => {
      const line = lineCoordinates(route.geometry)[0];
      if (!line || line.length < 2) return;
      const first = localPoint(line[0]), second = localPoint(line[1]);
      const dx = second.x-first.x, dz=second.z-first.z, length=Math.hypot(dx,dz)||1;
      const target={x:first.x-dx/length*65,z:first.z-dz/length*65};
      let location=target, nearest=Infinity;
      for(const segment of this.elevatedSegments) {
        if(segment.width<15 || Math.abs(segment.startHeight-(EXPRESSWAY_RING_HEIGHT+.082))>.2)continue;
        const sx=segment.b.x-segment.a.x,sz=segment.b.z-segment.a.z;
        const t=Math.max(0,Math.min(1,((target.x-segment.a.x)*sx+(target.z-segment.a.z)*sz)/(sx*sx+sz*sz||1)));
        const p={x:segment.a.x+sx*t,z:segment.a.z+sz*t},distance=Math.hypot(p.x-target.x,p.z-target.z);
        if(distance<nearest){nearest=distance;location=p;}
      }
      if(nearest>35)return;
      const after=localPoint(line[Math.min(20,line.length-1)]);
      const turn=dx*(after.z-first.z)-dz*(after.x-first.x);
      const sign=createTaiwanGuideSign(destinations[index][0],destinations[index][1],turn<0?"left":"right");
      sign.group.position.set(location.x,expresswayGroundAt(location)+EXPRESSWAY_RING_HEIGHT,location.z);
      sign.group.rotation.y=Math.atan2(-dx,-dz);
      this.disposableMaterials.push(...sign.materials);this.group.add(sign.group);
    });
    for(const [index,title,english] of [[1,"山麓別墅","Hillside Residences"],[7,"山景莊園","Mountain Estates"],[13,"觀景平台","Scenic Viewpoint"]] as const) {
      const at=Math.min(MOUNTAIN_ROAD_POINTS.length-2,Math.floor(index/16*MOUNTAIN_ROAD_POINTS.length));
      const p=MOUNTAIN_ROAD_POINTS[at], next=MOUNTAIN_ROAD_POINTS[at+1];
      const dx=next.x-p.x,dz=next.z-p.z,length=Math.hypot(dx,dz)||1;
      const location={x:p.x-dz/length*9,z:p.z+dx/length*9};
      const sign=createTaiwanGuideSign(title,english,"ahead",false);
      sign.group.position.set(location.x,cityElevationAt(location),location.z);sign.group.rotation.y=Math.atan2(-dx,-dz);
      this.disposableMaterials.push(...sign.materials);this.group.add(sign.group);
    }
  }

  private renderRoads(features: TileFeature[]) {
    const sidewalkGeometries: THREE.BufferGeometry[] = [];
    const curbGeometries: THREE.BufferGeometry[] = [];
    const solidCurbGeometries: THREE.BufferGeometry[] = [];
    const roadGeometries: THREE.BufferGeometry[] = [];
    const laneGeometries: THREE.BufferGeometry[] = [];
    const whiteMarkingGeometries: THREE.BufferGeometry[] = [];
    const crossingGeometries: THREE.BufferGeometry[] = [];
    const processedJoints = new Set<string>();
    const processedCrossings = new Set<string>();
    const intersectionCandidates = new Map<string, IntersectionCandidate>();
    const roadNodes = new Map<string, { position: Coordinates; approaches: Array<{ heading: number; width: number }> }>();
    const nodeKey = (point: Coordinates) => `${Math.round(point.x * 2)}/${Math.round(point.z * 2)}`;
    const registerNode = (point: Coordinates, heading: number, width: number) => {
      const key = nodeKey(point);
      const node = roadNodes.get(key) ?? { position: { ...point }, approaches: [] };
      node.approaches.push({ heading, width });
      roadNodes.set(key, node);
    };
    for (const feature of features) {
      const roadClass = String(feature.properties.class ?? feature.properties.subclass ?? "minor");
      const structure = String(feature.properties.brunnel ?? feature.properties.bridge ?? "").toLowerCase();
      if (["rail", "transit", "ferry", "aerialway", "path", "track", "pedestrian", "footway", "cycleway", "steps"].includes(roadClass)
        || structure === "tunnel" || structure === "bridge" || structure === "yes" || Number(feature.properties.layer ?? 0) > 0) continue;
      const width = roadWidth(feature.properties);
      for (const line of lineCoordinates(feature.geometry)) {
        const local = line.map(localPoint);
        for (let index = 0; index < local.length - 1; index++) {
          const a = local[index];
          const b = local[index + 1];
          const heading = Math.atan2(b.x - a.x, a.z - b.z);
          const junctionWidth = isShoppingStreetSpine(a, b) ? SHOPPING_STREET.boulevardHalfWidth * 2 : width;
          registerNode(a, heading, junctionWidth);
          registerNode(b, heading, junctionWidth);
        }
      }
    }
    const crossClearance = (point: Coordinates, heading: number) => {
      const node = roadNodes.get(nodeKey(point));
      if (!node) return 0;
      const crossing = node.approaches.filter((approach) => Math.abs(Math.sin(approach.heading - heading)) > 0.34);
      return crossing.length > 0 ? Math.max(...crossing.map((approach) => approach.width)) / 2 + 0.42 : 0;
    };
    for (const node of roadNodes.values()) {
      let radius = 0;
      for (const approach of node.approaches) radius = Math.max(radius, crossClearance(node.position, approach.heading));
      if (radius > 0) this.roadJunctions.push({ position: node.position, radius });
    }
    const recordIntersection = (point: Coordinates, heading: number, width: number) => {
      if (width < 6.5 || Math.hypot(point.x, point.z) > 650) return;
      const key = `${Math.round(point.x / 5)}/${Math.round(point.z / 5)}`;
      const previous = intersectionCandidates.get(key);
      if (previous) {
        previous.headings.push(heading);
        previous.width = Math.max(previous.width, width);
        previous.position.x = (previous.position.x * previous.count + point.x) / (previous.count + 1);
        previous.position.z = (previous.position.z * previous.count + point.z) / (previous.count + 1);
        previous.count++;
      } else {
        intersectionCandidates.set(key, { position: { ...point }, headings: [heading], width, count: 1 });
      }
    };
    let bestSpawnDistance = Infinity;
    for (const feature of features) {
      const roadClass = String(feature.properties.class ?? feature.properties.subclass ?? "minor");
      if (["rail", "transit", "ferry", "aerialway", "path", "track", "pedestrian", "footway", "cycleway", "steps"].includes(roadClass)) continue;
      const structure = String(feature.properties.brunnel ?? feature.properties.bridge ?? "").toLowerCase();
      if (structure === "tunnel" || structure === "bridge" || structure === "yes" || Number(feature.properties.layer ?? 0) > 0) continue;
      const width = roadWidth(feature.properties);
      const mountainRoad = feature.properties.mountain_road === true;
      for (const line of lineCoordinates(feature.geometry)) {
        const local = line.map(localPoint);
        if (!mountainRoad && !local.some((point) => Math.hypot(point.x, point.z) < WORLD_RADIUS)) continue;
        if (width >= 7 && (mountainRoad || local.some((point) => Math.hypot(point.x, point.z) < 1100))) {
          let length = 0;
          for (let segment = 0; segment < local.length - 1; segment++) {
            length += Math.hypot(local[segment + 1].x - local[segment].x, local[segment + 1].z - local[segment].z);
          }
          if (length > 48 && local.length > 1) this.trafficRoutes.push({ points: local, width, length, district:mountainRoad?'mountain':'city' });
        }
        for (let index = 0; index < local.length - 1; index++) {
          const a = local[index];
          const b = local[index + 1];
          if (!mountainRoad && Math.min(Math.hypot(a.x, a.z), Math.hypot(b.x, b.z)) > WORLD_RADIUS + 140) continue;
          const segmentHeading = Math.atan2(b.x - a.x, a.z - b.z);
          recordIntersection(a, segmentHeading, width);
          recordIntersection(b, segmentHeading, width);

          if (width >= 5) {
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const squared = dx * dx + dz * dz;
            if (squared > 0.01) {
              const progress = Math.max(0, Math.min(1, -(a.x * dx + a.z * dz) / squared));
              const x = a.x + dx * progress;
              const z = a.z + dz * progress;
              const distance = Math.hypot(x, z);
              if (distance < bestSpawnDistance) {
                bestSpawnDistance = distance;
                this.spawnPoint = { x, z, heading: Math.atan2(dx, -dz) };
              }
            }
          }

          const sidewalkWidth = width >= 8 ? 2.05 : 1.35;
          if (isShoppingStreetSpine(a, b)) {
            this.streetSegments.push({ a, b, width: SHOPPING_STREET.boulevardHalfWidth * 2 });
            continue;
          }
          const road = roadSegmentGeometry(a, b, width, 0.082);
          if (road) roadGeometries.push(road);
          if (width >= 4.8 && distanceToSegment({ x: 0, z: 0 }, a, b) < 1840) {
            this.streetSegments.push({ a, b, width });
          }
          if (!mountainRoad) {
            const length = Math.hypot(b.x - a.x, b.z - a.z);
            const startTrim = Math.min(length * 0.4, crossClearance(a, segmentHeading));
            const endTrim = Math.min(length * 0.4, crossClearance(b, segmentHeading));
            const trimmedA = { x: a.x + (b.x - a.x) / length * startTrim, z: a.z + (b.z - a.z) / length * startTrim };
            const trimmedB = { x: b.x - (b.x - a.x) / length * endTrim, z: b.z - (b.z - a.z) / length * endTrim };
            for (const side of [-1, 1]) {
              const sidewalk = offsetRoadSegmentGeometry(trimmedA, trimmedB, sidewalkWidth, 0.135, side * (width / 2 + sidewalkWidth / 2));
              const curb = offsetRoadSegmentGeometry(trimmedA, trimmedB, 0.2, 0.162, side * (width / 2 + 0.07));
              const solidCurb = bridgeBeamGeometry(trimmedA, trimmedB, 0.22, 0.24, 0.12, 0.12, side * (width / 2 + 0.09));
              if (sidewalk) sidewalkGeometries.push(sidewalk);
              if (curb) curbGeometries.push(curb);
              if (solidCurb) solidCurbGeometries.push(solidCurb);
              if (width >= 9) {
                const edge = offsetRoadSegmentGeometry(trimmedA, trimmedB, 0.1, 0.097, side * (width / 2 - 0.38));
                if (edge) whiteMarkingGeometries.push(edge);
              }
            }
          }

          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const length = Math.hypot(dx, dz);
          if (width >= 8.5 && length > 4) {
            const markingStartTrim = mountainRoad ? 0 : Math.min(length * 0.4, crossClearance(a, segmentHeading) + 0.65);
            const markingEndTrim = mountainRoad ? 0 : Math.min(length * 0.4, crossClearance(b, segmentHeading) + 0.65);
            const markingA = { x: a.x + dx / length * markingStartTrim, z: a.z + dz / length * markingStartTrim };
            const markingB = { x: b.x - dx / length * markingEndTrim, z: b.z - dz / length * markingEndTrim };
            const markingDx = markingB.x - markingA.x;
            const markingDz = markingB.z - markingA.z;
            const markingLength = Math.hypot(markingDx, markingDz);
            const centerOffsets = width >= 10.5 ? [-0.16, 0.16] : [0];
            if (markingLength > 1.2) {
              for (const offset of centerOffsets) {
                const stripe = offsetRoadSegmentGeometry(markingA, markingB, 0.105, 0.105, offset);
                if (stripe) laneGeometries.push(stripe);
              }
            }
            if (width >= 11 && markingLength > 4) {
              const segments = Math.floor(markingLength / 9);
              for (let dash = 0; dash < segments; dash++) {
                const start = (dash * 9 + 1.5) / markingLength;
                const end = Math.min(1, (dash * 9 + 5.1) / markingLength);
                const from = { x: markingA.x + markingDx * start, z: markingA.z + markingDz * start };
                const to = { x: markingA.x + markingDx * end, z: markingA.z + markingDz * end };
                for (const side of [-1, 1]) {
                  const stripe = offsetRoadSegmentGeometry(from, to, 0.135, 0.107, side * width * 0.25);
                  if (stripe) whiteMarkingGeometries.push(stripe);
                }
              }
            }

            if (length > 18 && (index === 0 || index === local.length - 2)) {
              const intersection = index === 0 ? a : b;
              const crossingKey = `${Math.round(intersection.x / 9)}/${Math.round(intersection.z / 9)}`;
              if (!processedCrossings.has(crossingKey)) {
                processedCrossings.add(crossingKey);
                const direction = index === 0 ? 1 : -1;
                const start = { x: intersection.x + dx / length * direction * 3.5, z: intersection.z + dz / length * direction * 3.5 };
                const finish = { x: intersection.x + dx / length * direction * 6.25, z: intersection.z + dz / length * direction * 6.25 };
                for (let offset = -width / 2 + 0.72; offset < width / 2 - 0.35; offset += 0.78) {
                  const stripe = offsetRoadSegmentGeometry(start, finish, 0.43, 0.112, offset);
                  if (stripe) crossingGeometries.push(stripe);
                }
              }
            }
          }
        }
        for (const point of local) {
          if (Math.hypot(point.x, point.z) > WORLD_RADIUS + 140) continue;
          const key = `${Math.round(point.x * 2)}/${Math.round(point.z * 2)}/${Math.round(width)}`;
          if (processedJoints.has(key)) continue;
          processedJoints.add(key);
          if (!mountainRoad && !roadNodes.get(nodeKey(point))?.approaches.some((approach) => crossClearance(point, approach.heading) > 0)) {
            sidewalkGeometries.push(roadJointGeometry(point, (width + 2.8) / 2, 0.061));
          }
          roadGeometries.push(roadJointGeometry(point, width / 2, 0.083));
        }
      }
    }
    const sidewalkGeometry = mergeOrDispose(sidewalkGeometries);
    if (sidewalkGeometry) {
      const material = new THREE.MeshStandardMaterial({ color: "#c4bfb4", map: this.textures.paving, normalMap: this.textures.pavingNormal, roughnessMap: this.textures.pavingRoughness, normalScale: new THREE.Vector2(0.48, 0.48), roughness: 0.96 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(sidewalkGeometry, material);
      mesh.name = "Setback Taiwanese sidewalks that stop before road junctions";
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const roadGeometry = mergeOrDispose(roadGeometries);
    if (roadGeometry) {
      const material = new THREE.MeshStandardMaterial({ color: "#848586", map: this.textures.asphalt, normalMap: this.textures.asphaltNormal, roughnessMap: this.textures.asphaltRoughness, normalScale: new THREE.Vector2(0.68, 0.68), roughness: 0.93 });
      this.disposableMaterials.push(material);
      this.roadSurfaceMaterials?.push(material);
      const mesh = new THREE.Mesh(roadGeometry, material);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const laneGeometry = mergeOrDispose(laneGeometries);
    if (laneGeometry) {
      const material = new THREE.MeshStandardMaterial({ color: "#edc764", roughness: 0.78 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(laneGeometry, material);
      mesh.name = "Procedural city lane center markings";
      this.group.add(mesh);
    }
    const curbs = mergeOrDispose(curbGeometries);
    if (curbs) {
      const material = new THREE.MeshStandardMaterial({ color: "#d0cac0", roughness: 0.92 });
      this.disposableMaterials.push(material);
      this.group.add(new THREE.Mesh(curbs, material));
    }
    const solidCurbs = mergeOrDispose(solidCurbGeometries);
    if (solidCurbs) {
      const material = new THREE.MeshStandardMaterial({ color: "#b6b0a5", roughness: 0.91 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(solidCurbs, material);
      mesh.name = "Raised physical Taiwanese road curbs";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const whiteMarkings = mergeOrDispose([...whiteMarkingGeometries, ...crossingGeometries]);
    if (whiteMarkings) {
      const material = new THREE.MeshStandardMaterial({ color: "#e9e8df", roughness: 0.81 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(whiteMarkings, material);
      mesh.name = "Procedural city white markings and crosswalks";
      this.group.add(mesh);
    }
    this.createTrafficSignals(intersectionCandidates);
  }

  private renderTaiwanRoadFurniture() {
    const redLines: THREE.BufferGeometry[] = [];
    const yellowLines: THREE.BufferGeometry[] = [];
    const arrows: THREE.BufferGeometry[] = [];
    const manholes: StreetDetail[] = [];
    const drains: StreetDetail[] = [];
    const parkingMarks: StreetDetail[] = [];

    for (const [streetIndex, street] of this.streetSegments.entries()) {
      if (isShoppingStreetSpine(street.a, street.b)) continue;
      const dx = street.b.x - street.a.x;
      const dz = street.b.z - street.a.z;
      const length = Math.hypot(dx, dz);
      if (length < 9 || Math.min(Math.hypot(street.a.x, street.a.z), Math.hypot(street.b.x, street.b.z)) > 780) continue;
      const directionX = dx / length;
      const directionZ = dz / length;
      const normalX = -directionZ;
      const normalZ = directionX;
      const angle = Math.atan2(dx, -dz);
      const junctionRadius = (point: Coordinates) => this.roadJunctions.find((junction) => Math.hypot(junction.position.x - point.x, junction.position.z - point.z) < 1.2)?.radius ?? 0;
      const startTrim = Math.min(length * 0.4, junctionRadius(street.a));
      const endTrim = Math.min(length * 0.4, junctionRadius(street.b));
      const paintedA = { x: street.a.x + directionX * startTrim, z: street.a.z + directionZ * startTrim };
      const paintedB = { x: street.b.x - directionX * endTrim, z: street.b.z - directionZ * endTrim };

      for (const side of [-1, 1]) {
        const paint = offsetRoadSegmentGeometry(paintedA, paintedB, 0.13, 0.18, side * (street.width / 2 + 0.01));
        if (paint) (streetIndex % 3 === 0 ? redLines : yellowLines).push(paint);
      }

      const samples = Math.max(1, Math.floor(length / 38));
      for (let sample = 0; sample < samples; sample++) {
        const progress = (sample + 0.5) / samples;
        const centerX = street.a.x + dx * progress;
        const centerZ = street.a.z + dz * progress;
        if ((sample + streetIndex) % 2 === 0) manholes.push({ x: centerX + normalX * Math.min(2.2, street.width * 0.19), z: centerZ + normalZ * Math.min(2.2, street.width * 0.19), y: 0.12, angle, style: streetIndex });
        for (const side of [-1, 1]) drains.push({ x: centerX + normalX * side * (street.width / 2 - 0.28), z: centerZ + normalZ * side * (street.width / 2 - 0.28), y: 0.13, angle, style: streetIndex });
        if (street.width >= 7 && (sample + streetIndex) % 2 === 1) {
          parkingMarks.push({ x: centerX + normalX * (street.width / 2 - 1.05), z: centerZ + normalZ * (street.width / 2 - 1.05), y: 0.125, angle, style: streetIndex });
        }
      }

      if (street.width >= 10 && length > 42) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 3.3);
        shape.lineTo(-1.2, 1.25);
        shape.lineTo(-0.42, 1.25);
        shape.lineTo(-0.42, -3.0);
        shape.lineTo(0.42, -3.0);
        shape.lineTo(0.42, 1.25);
        shape.lineTo(1.2, 1.25);
        shape.closePath();
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(angle);
        const progress = 0.58;
        geometry.translate(street.a.x + dx * progress, 0.126, street.a.z + dz * progress);
        arrows.push(conformGeometryToTerrain(geometry, true));
      }
    }

    const addMerged = (list: THREE.BufferGeometry[], color: string, name: string) => {
      const geometry = mergeOrDispose(list);
      if (!geometry) return;
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    addMerged(redLines, "#b63d39", "Taiwanese red no-parking curb lines");
    addMerged(yellowLines, "#e0bb46", "Taiwanese yellow curb markings");
    addMerged(arrows, "#e9e9e2", "Physical lane direction arrows");

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const addInstances = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, entries: StreetDetail[], dimensions: (entry: StreetDetail) => THREE.Vector3) => {
      if (entries.length === 0) {
        geometry.dispose();
        material.dispose();
        return;
      }
      this.disposableMaterials.push(material);
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.name = name;
      entries.forEach((entry, index) => {
        position.set(entry.x, cityElevationAt(entry) + entry.y, entry.z);
        rotation.setFromAxisAngle(up, entry.angle);
        scale.copy(dimensions(entry));
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.userData.terrainInstances = entries;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    addInstances("Cast-iron Taiwanese manhole covers", new THREE.CylinderGeometry(0.67, 0.67, 0.055, 28), new THREE.MeshStandardMaterial({ color: "#3f4544", roughness: 0.82, metalness: 0.52 }), manholes, () => new THREE.Vector3(1, 1, 1));
    addInstances("Road-edge storm-water drain grates", new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#414746", roughness: 0.73, metalness: 0.67 }), drains, () => new THREE.Vector3(0.78, 0.045, 0.32));
    addInstances("Painted roadside motorcycle parking bays", new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#e6e4da", roughness: 0.77 }), parkingMarks, () => new THREE.Vector3(1.55, 0.028, 0.075));

    if (this.trafficIntersections.length > 0) {
      const boxes = this.trafficIntersections.slice(0, 18);
      const material = new THREE.MeshStandardMaterial({ color: "#6c8e86", roughness: 0.84, transparent: true, opacity: 0.78 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, boxes.length);
      mesh.name = "Taiwanese motorcycle waiting and two-stage turn boxes";
      boxes.forEach((intersection, index) => {
        position.set(intersection.position.x, cityElevationAt(intersection.position) + 0.119, intersection.position.z);
        rotation.setFromAxisAngle(up, intersection.heading);
        scale.set(Math.min(6.2, intersection.width * 0.44), 0.026, 4.25);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private createTrafficSignals(candidates: Map<string, IntersectionCandidate>) {
    const selected: Array<{ key: string; candidate: IntersectionCandidate; heading: number }> = [];
    const ordered = [...candidates.entries()].sort((left, right) =>
      Math.hypot(left[1].position.x, left[1].position.z) - Math.hypot(right[1].position.x, right[1].position.z),
    );
    for (const [key, candidate] of ordered) {
      if (candidate.count < 3 || candidate.width < 8) continue;
      const heading = candidate.headings[0];
      const crosses = candidate.headings.some((other) => {
        const difference = Math.abs(Math.atan2(Math.sin(other - heading), Math.cos(other - heading)));
        return Math.min(difference, Math.abs(Math.PI - difference)) > 0.46;
      });
      if (!crosses || selected.some((item) => Math.hypot(item.candidate.position.x - candidate.position.x, item.candidate.position.z - candidate.position.z) < 39)) continue;
      selected.push({ key, candidate, heading });
      if (selected.length >= 32) break;
    }
    if (selected.length === 0) return;

    const steel = new THREE.MeshStandardMaterial({ color: "#738179", roughness: 0.49, metalness: 0.77 });
    const housing = new THREE.MeshStandardMaterial({ color: "#242923", roughness: 0.83, metalness: 0.17 });
    this.signalMaterials = {
      off: new THREE.MeshStandardMaterial({ color: "#1c2420", roughness: 0.5, metalness: 0.06 }),
      red: new THREE.MeshStandardMaterial({ color: "#ff513f", emissive: "#ff3026", emissiveIntensity: 3.8, roughness: 0.25, toneMapped: false }),
      amber: new THREE.MeshStandardMaterial({ color: "#ffc35a", emissive: "#ff9f27", emissiveIntensity: 3.5, roughness: 0.25, toneMapped: false }),
      green: new THREE.MeshStandardMaterial({ color: "#46f09b", emissive: "#12de78", emissiveIntensity: 3.6, roughness: 0.25, toneMapped: false }),
    };
    this.disposableMaterials.push(steel, housing, ...Object.values(this.signalMaterials));

    for (const { key, candidate, heading } of selected) {
      const intersection: TrafficIntersection = {
        key,
        position: candidate.position,
        heading,
        width: candidate.width,
        offset: deterministicNoise(Math.round(candidate.position.x), Math.round(candidate.position.z)) * 18,
        heads: [],
      };

      for (const [axis, axisHeading] of [["main", heading], ["cross", heading + Math.PI / 2]] as const) {
        for (const direction of [-1, 1]) {
          const travelHeading = axisHeading + (direction < 0 ? Math.PI : 0);
          const forwardX = Math.sin(travelHeading);
          const forwardZ = -Math.cos(travelHeading);
          const rightX = -forwardZ;
          const rightZ = forwardX;
          const setback = candidate.width * 0.48 + 3.7;
          const side = candidate.width * 0.48 + 1.45;
          const anchor = {
            x: candidate.position.x - forwardX * setback + rightX * side,
            z: candidate.position.z - forwardZ * setback + rightZ * side,
          };
          const fixture = new THREE.Group();
          fixture.name = `Taiwanese traffic signal ${axis}`;
          fixture.position.set(anchor.x, cityElevationAt(anchor), anchor.z);
          fixture.rotation.y = -travelHeading;
          fixture.userData.terrainAnchor = anchor;

          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.135, 5.15, 10), steel);
          pole.position.y = 2.66;
          pole.castShadow = true;
          const footing = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.22, 10), steel);
          footing.position.y = 0.18;
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.092, 3.65, 9), steel);
          arm.position.set(-1.77, 4.86, 0);
          arm.rotation.z = Math.PI / 2;
          const board = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.53, 0.28), housing);
          board.position.set(-2.93, 4.09, 0);
          board.castShadow = true;
          fixture.add(pole, footing, arm, board);

          const lenses = ["red", "amber", "green"].map((color, index) => {
            const lens = new THREE.Mesh(new THREE.CircleGeometry(0.19, 24), this.signalMaterials![color as TrafficLightColor]);
            lens.position.set(-2.93, 4.57 - index * 0.47, 0.151);
            const visor = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.045, 7, 20), housing);
            visor.position.copy(lens.position);
            visor.position.z += 0.035;
            fixture.add(lens, visor);
            return lens;
          });

          const pedestrian = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.53, 0.2), housing);
          pedestrian.position.set(0.16, 1.82, 0);
          fixture.add(pedestrian);
          intersection.heads.push({ axis, red: lenses[0], amber: lenses[1], green: lenses[2] });
          this.group.add(fixture);
        }
      }
      this.trafficIntersections.push(intersection);
    }

    this.updateTrafficSignals(performance.now() / 1000);
  }

  private loadTrafficModelTemplates() {
    const loader=new GLTFLoader(),byUrl=new Map<string,TrafficModelKind[]>();
    // Keep the metro motorcycle dependency available, and avoid fetching the
    // unused legacy quadruped rider templates after changing the bike fleet.
    const required=new Set<TrafficModelKind>(['motorcycle','motoBear']);
    for(const vehicle of this.trafficVehicles){required.add(vehicle.modelKind);if(vehicle.animalKind)required.add(vehicle.animalKind);}
    for(const [kind,url] of Object.entries(TRAFFIC_MODEL_URLS) as Array<[TrafficModelKind,string]>) {if(!required.has(kind))continue;const kinds=byUrl.get(url)??[];kinds.push(kind);byUrl.set(url,kinds);}
    for(const [url,kinds] of byUrl)loader.load(url,asset=>{
      if(this.stopped){asset.scene.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh.isMesh)mesh.geometry.dispose();});return;}
      asset.scene.name='Complete authored traffic model template';
      asset.scene.traverse(o=>{
        const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;
        mesh.castShadow=mesh.receiveShadow=true;mesh.userData.sharedTrafficAsset=true;
        for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
          const standard=m as THREE.MeshStandardMaterial;
          for(const texture of [standard.map,standard.normalMap,standard.roughnessMap,standard.metalnessMap])if(texture)texture.anisotropy=this.maxAnisotropy;
          standard.envMapIntensity=.85;
        }
      });
      for(const kind of kinds){this.trafficModelTemplates.set(kind,asset.scene);this.trafficModelAnimations.set(kind,asset.animations);}
      this.trafficVehicles.forEach((vehicle,index)=>this.upgradeTrafficVehicleModel(vehicle,index));
    },undefined,()=>{this.group.userData.trafficAssetError=url;});
  }

  private instantiateTrafficModel(kind: TrafficModelKind, target: { length?: number; height?: number }) {
    const template = this.trafficModelTemplates?.get(kind);
    if (!template) return null;
    const model = cloneSkinnedModel(template);
    // These authored GLBs contain separate wheel meshes, but their Blender
    // pivots were exported at the car origin. Move every wheel's vertices into
    // its own local pivot so it rolls in place instead of orbiting the chassis.
    model.traverse((object) => {
      const wheel = object as THREE.Mesh;
      if (!wheel.isMesh || !/wheel/i.test(wheel.name)) return;
      wheel.geometry = wheel.geometry.clone();
      wheel.geometry.computeBoundingBox();
      const center = wheel.geometry.boundingBox?.getCenter(new THREE.Vector3());
      if (!center) return;
      wheel.geometry.translate(-center.x, -center.y, -center.z);
      wheel.position.add(center);
      wheel.userData.sharedTrafficAsset = false;
      wheel.userData.correctedWheelPivot = true;
    });
    model.rotation.y = ["bear","pig"].includes(kind)?0:Math.PI;
    model.updateMatrixWorld(true);
    let initial = new THREE.Box3().setFromObject(model);
    let size = initial.getSize(new THREE.Vector3());
    if (target.length && size.x > size.z * 1.18) {
      model.rotation.y += Math.PI / 2;
      model.updateMatrixWorld(true);
      initial = new THREE.Box3().setFromObject(model);
      size = initial.getSize(new THREE.Vector3());
    }
    const scale = target.height
      ? target.height / Math.max(0.01, size.y)
      : (target.length ?? 1) / Math.max(0.01, size.z);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(model);
    const center = fitted.getCenter(new THREE.Vector3());
    model.position.set(-center.x, -fitted.min.y, -center.z);
    model.name = `Optimized colored GLB ${kind} instance`;
    return model;
  }

  private upgradeTrafficVehicleModel(vehicle: TrafficVehicle, index: number) {
    if(vehicle.rig)return;
    const template=this.trafficModelTemplates?.get(vehicle.modelKind);if(!template)return;
    const riderKind=vehicle.modelKind==='motorcycle'?'motoBear':vehicle.animalKind;
    if(riderKind&&!this.trafficModelTemplates.has(riderKind))return;
    const rig=createTrafficRig(template,vehicle.modelKind as VehicleClass,index);
    if(!rig.root.userData.completeTrafficModel)return;
    vehicle.rig=rig;vehicle.visual.clear();vehicle.visual.add(rig.root);
    vehicle.wheels=rig.wheels.map(w=>w.roll);vehicle.frontWheels=rig.wheels.filter(w=>w.front).map(w=>w.pivot);
    vehicle.brakeLights=[];vehicle.rearIndicators=[];
    const shared=new Set<THREE.Material>();template.traverse(o=>{const mesh=o as THREE.Mesh;if(mesh.isMesh)for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])shared.add(m);});
    const owned=new Set<THREE.Material>();
    rig.root.traverse(o=>{
      const mesh=o as THREE.Mesh;if(!mesh.isMesh)return;mesh.userData.sharedTrafficAsset=true;
      for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material]) {
        if(!shared.has(m))owned.add(m);
        if(m.name.toLowerCase().startsWith('brake'))vehicle.brakeLights.push(mesh);
      }
    });this.disposableMaterials.push(...owned);
    if(vehicle.animalKind) {
      const heights:Partial<Record<TrafficModelKind,number>>={bear:1.7,bunny:1.7,pig:1.7};
      const riding=vehicle.modelKind==='motorcycle'?createMotorcycleRider(this.trafficModelTemplates.get('motoBear')!,index):null;
      if(riding)this.disposableMaterials.push(...riding.materials);
      const animal=riding?.model??this.instantiateTrafficModel(vehicle.animalKind,{height:heights[vehicle.animalKind]??.86});
      if(animal) {
        if(!riding)animal.name=`Downloaded Juggy ${vehicle.animalKind} articulated animal rider`;
        rig.body.add(animal);
        if(!riding) {
          fitScooterRider(animal,{hip:new THREE.Vector3(-.36,.40,.16),hand:side=>new THREE.Vector3(-.36+side*.13,.80,-.38),foot:side=>new THREE.Vector3(-.36+side*.12,.20,-.60),riderHeight:.79,spineDirection:new THREE.Vector3(0,1,-.12)});
          animal.userData.vehicleDriver=true;
        }
        vehicle.animalHead=animal.getObjectByName('Head') as THREE.Bone|undefined;
        if(vehicle.animalHead)vehicle.animalHead.userData.ridingRest=vehicle.animalHead.quaternion.clone();
      }
    }
    vehicle.visual.visible=true;vehicle.group.userData.trafficReady=true;
    if(!this.trafficRenderBatches){this.trafficRenderBatches=new TrafficRenderBatches();this.group.add(this.trafficRenderBatches.group);}
    this.trafficRenderBatches.register(vehicle.group,rig);
    invalidateShadowScene(this.group,false);
    vehicle.visual.userData.assetSource='Complete attributed realistic vehicle collection';vehicle.visual.userData.assetInstanceIndex=index;
  }

  updateNeighborhood(dt:number,rider:Coordinates,camera:Coordinates){this.neighborhoodLife?.update(Math.min(.05,dt),rider,camera);}

  private renderShopForecourts(){
    const material=new THREE.MeshStandardMaterial({color:'#c4c5bd',map:this.textures.paving,normalMap:this.textures.pavingNormal,roughnessMap:this.textures.pavingRoughness,roughness:.87});this.disposableMaterials.push(material);
    for(const r of SHOP_RESERVATIONS){const width=r.right-r.left,depth=r.front-r.back,g=new THREE.PlaneGeometry(width,depth,Math.ceil(width/4),Math.ceil(depth/4));g.rotateX(-Math.PI/2);g.translate((r.left+r.right)/2,.134,(r.back+r.front)/2);const p=g.attributes.position,uv=g.attributes.uv;for(let i=0;i<p.count;i++)uv.setXY(i,p.getX(i)/4,p.getZ(i)/4);const mesh=new THREE.Mesh(conformGeometryToTerrain(g),material);mesh.name='Level neighborhood shop forecourt joined to original sidewalk';mesh.receiveShadow=true;this.group.add(mesh);}
  }

  enableMetroCommuters(system:MetroSystem){
    if(this.trafficVehicles.some(v=>v.commuter))return;
    for(const origin of [0,2]){
      const destination=origin===0?2:0,station=METRO_STATIONS[destination];
      const points=origin===0?[{x:station.x,z:-794},{x:station.x,z:460},{x:1200,z:460},...MOUNTAIN_ROAD_POINTS.slice(1),...Array.from({length:124},(_,i)=>({x:1595+i*5,z:510})),...MOUNTAIN_VALLEY_POINTS.slice(1)]:[{x:station.x,z:-794},{x:station.x,z:760}];
      const smooth=smoothTrafficPoints(points,7.1),road:TrafficRoute={points:smooth,width:origin===0?7.1:13.3,length:smooth.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-smooth[i].x,p.z-smooth[i].z),0),district:origin===0?'mountain':'city'};
      if(origin===0)road.heightAt=distance=>{const p=sampleTrafficRoute(road,distance,1);return p.x>=1590&&p.x<=2210&&Math.abs(p.z-510)<4.85?tunnelFloorAt(p.x)-.082:cityElevationAt(p);};
      else road.preferredExit=this.trafficRoutes.find(r=>r.district==='highway'&&Math.hypot(r.points[0].x+650,r.points[0].z-760)<4);
      this.trafficRoutes.push(road);const commuter=new MetroCommuter('metro-commuter-'+origin,origin,system,road,{ground:cityElevationAt,obstacles:(point,height)=>this.nearbyStaticObstacles(point,2,height)});
      const group=new THREE.Group(),visual=new THREE.Group();group.name='Real autonomous animal metro commuter';group.userData.isScooter=true;group.userData.dynamicWorldObject=true;group.userData.trafficReady=false;visual.visible=false;group.add(visual);group.position.set(commuter.state.x,commuter.height+.028,commuter.state.z);group.rotation.y=-commuter.state.heading;this.group.add(group);
      const vehicle:TrafficVehicle={group,visual,wheels:[],frontWheels:[],wheelRoll:0,steerAngle:0,route:road,progress:8,direction:1,speed:0,cruise:10.2,previousSignal:'',brakeLights:[],rearIndicators:[],modelKind:'motorcycle',animalKind:'motoBear',motion:commuter.motion,commuter};this.trafficVehicles.push(vehicle);this.upgradeTrafficVehicleModel(vehicle,this.trafficVehicles.length-1);
    }
    // Reuse six existing road motorcycles: a persistent service at all three
    // stations, without adding more animated rigs or increasing city traffic.
    const motorcycles=this.trafficVehicles.filter(v=>v.modelKind==='motorcycle'&&!v.commuter).slice(0,6);
    for(const [index,vehicle]of motorcycles.entries()){
      const origin=Math.floor(index/2),track=index%2,destination=origin===0?1:origin===2?1:track===0?2:0;
      const commuter=new MetroCommuter(`metro-local-${origin}-${track}`,origin,system,vehicle.route,{ground:cityElevationAt,obstacles:(p,h)=>this.nearbyStaticObstacles(p,2,h)},{track,destination,start:track===0?'platform':'street'});
      vehicle.commuter=commuter;vehicle.motion=commuter.motion;vehicle.speed=0;vehicle.previousSignal='';vehicle.wheelRoll=vehicle.steerAngle=0;
      vehicle.group.name='Recurring animal motorcycle metro passenger';vehicle.group.position.set(commuter.state.x,commuter.height+.028,commuter.state.z);vehicle.group.rotation.set(0,-commuter.state.heading,0);vehicle.presentation=undefined;
    }
  }

  private createRoadTraffic() {
    const near=(route:TrafficRoute)=>Math.min(...route.points.map(p=>Math.hypot(p.x,p.z)));
    const selected=[...this.trafficRoutes.filter(r=>!r.district||r.district==='city').sort((a,b)=>near(a)-near(b)).slice(0,14),...this.trafficRoutes.filter(r=>r.district==='highway').sort((a,b)=>b.length-a.length).slice(0,3),...this.trafficRoutes.filter(r=>r.district==='mountain').sort((a,b)=>b.length-a.length).slice(0,3)];
    for(const route of this.trafficRoutes) {
      if(!route.heightAt&&route.district!=='mountain')route.points=smoothTrafficPoints(route.points,route.width);
      route.length=route.points.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b.x-route.points[i].x,b.z-route.points[i].z),0);
    }
    const carKinds:TrafficModelKind[]=["car","taxi","suv","car","car","taxi","suv","sports"];
    const animalKinds:TrafficModelKind[]=["motoBear"];
    selected.flatMap(route=>[route,route]).forEach((route,index)=>{
      const isScooter=index%3===1,group=new THREE.Group(),visual=new THREE.Group();
      group.name=isScooter?'Realistic animal-ridden motorcycle scooter':'Complete realistic city vehicle';
      group.userData.isScooter=isScooter;group.userData.trafficReady=false;group.userData.dynamicWorldObject=true;
      visual.name='Complete shared-geometry traffic visual';visual.visible=false;group.add(visual);
      const direction:1|-1=index%2===0?1:-1,progress=route.length*(.19+deterministicNoise(index,73)*.62);
      const point=sampleTrafficRoute(route,progress,direction);
      group.position.set(point.x,this.trafficSurface(route,progress,direction).height+.028,point.z);group.rotation.y=-point.heading;this.group.add(group);
      const vehicle:TrafficVehicle={group,visual,wheels:[],frontWheels:[],wheelRoll:0,steerAngle:0,route,progress,direction,speed:0,cruise:(route.district==='highway'?16:route.district==='mountain'?7:6.4)+deterministicNoise(index,92)*4,previousSignal:'',brakeLights:[],rearIndicators:[],modelKind:isScooter?'motorcycle':carKinds[index%carKinds.length],animalKind:isScooter?animalKinds[Math.floor(index/3)%animalKinds.length]:carKinds[index%carKinds.length]==='sports'?'bear':undefined,motion:createTrafficMotion()};
      this.trafficVehicles.push(vehicle);this.upgradeTrafficVehicleModel(vehicle,index);
    });
  }

  private renderParkLandmarks() {
    const trees: Array<Coordinates & { trunk: number; crown: number; tint: string }> = [];
    const shrubs: Array<Coordinates & { size: number }> = [];
    const benches: Array<Coordinates & { angle: number }> = [];
    const paths: THREE.BufferGeometry[] = [];
    const colors = ["#789869", "#64805c", "#8ea875", "#587954", "#94a67d"];
    const sorted = [...this.parkParcels]
      .sort((left, right) => Math.hypot(left.center.x, left.center.z) - Math.hypot(right.center.x, right.center.z))
      .slice(0, 55);

    for (const [parkIndex, park] of sorted.entries()) {
      const bounds = outlineSummary(park.outline);
      const attempts = Math.min(160, Math.max(8, Math.round(park.area / 115)));
      for (let attempt = 0; attempt < attempts && trees.length < 560; attempt++) {
        const candidate = {
          x: bounds.left + deterministicNoise(attempt + parkIndex * 13, 121) * (bounds.right - bounds.left),
          z: bounds.back + deterministicNoise(attempt + parkIndex * 19, 127) * (bounds.front - bounds.back),
        };
        if (!pointInsideOutline(candidate, park.outline)) continue;
        const tooClose = trees.some((tree) => Math.abs(tree.x - candidate.x) < 4.2 && Math.abs(tree.z - candidate.z) < 4.2);
        if (tooClose) continue;
        let onRoad = false;
        for (const street of this.streetSegments) {
          if (candidate.x < Math.min(street.a.x, street.b.x) - 38 || candidate.x > Math.max(street.a.x, street.b.x) + 38) continue;
          if (candidate.z < Math.min(street.a.z, street.b.z) - 38 || candidate.z > Math.max(street.a.z, street.b.z) + 38) continue;
          const dx = street.b.x - street.a.x;
          const dz = street.b.z - street.a.z;
          const squared = dx * dx + dz * dz;
          if (squared < 0.01) continue;
          const progress = Math.max(0, Math.min(1, ((candidate.x - street.a.x) * dx + (candidate.z - street.a.z) * dz) / squared));
          if (Math.hypot(candidate.x - street.a.x - dx * progress, candidate.z - street.a.z - dz * progress) < street.width / 2 + 1.8) {
            onRoad = true;
            break;
          }
        }
        if (onRoad) continue;
        const variation = deterministicNoise(attempt, parkIndex + 29);
        trees.push({ ...candidate, trunk: 2 + variation * 1.8, crown: 1.55 + variation * 1.25, tint: colors[Math.floor(variation * colors.length)] });
        if (attempt % 4 === 0 && shrubs.length < 260) shrubs.push({ x: candidate.x + 1.9, z: candidate.z + 0.55, size: 0.62 + variation * 0.44 });
      }

      if (park.area > 620) {
        const horizontal = bounds.right - bounds.left > bounds.front - bounds.back;
        const half = Math.min(38, Math.max(8, Math.min(bounds.right - bounds.left, bounds.front - bounds.back) * 0.43));
        const start = horizontal ? { x: park.center.x - half, z: park.center.z } : { x: park.center.x, z: park.center.z - half };
        const end = horizontal ? { x: park.center.x + half, z: park.center.z } : { x: park.center.x, z: park.center.z + half };
        if (pointInsideOutline(start, park.outline) && pointInsideOutline(end, park.outline)) {
          const path = roadSegmentGeometry(start, end, 2.45, 0.058);
          if (path) paths.push(path);
          benches.push({ x: park.center.x + (horizontal ? 0 : 1.8), z: park.center.z + (horizontal ? 1.8 : 0), angle: horizontal ? 0 : Math.PI / 2 });
        }
      }
    }

    const walkway = mergeOrDispose(paths);
    if (walkway) {
      const material = new THREE.MeshStandardMaterial({ color: "#c5bb9f", map: this.textures.paving, roughness: 0.98 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(walkway, material);
      mesh.name = "Real park walking paths";
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (trees.length === 0) return;

    const parkLeaves = botanicalLeafTexture(this.maxAnisotropy);
    this.disposableTextures.push(parkLeaves);
    const bark = new THREE.MeshStandardMaterial({ color: "#6c563f", roughness: 0.99 });
    const foliage = new THREE.MeshStandardMaterial({ color: "#ffffff", map: parkLeaves, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 });
    const shrubbery = new THREE.MeshStandardMaterial({ color: "#729164", roughness: 0.95 });
    const benchMaterial = new THREE.MeshStandardMaterial({ color: "#876e56", roughness: 0.84 });
    this.disposableMaterials.push(bark, foliage, shrubbery, benchMaterial);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.22, 1, 14, 5), bark, trees.length);
    const crowns = new THREE.InstancedMesh(layeredLeafCardGeometry(), foliage, trees.length);
    trunks.name = "Physical park tree trunks";
    crowns.name = "Dense three-dimensional mapped park trees";
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const trunkAnchors: Array<Coordinates & { y: number }> = [];
    const crownAnchors: Array<Coordinates & { y: number }> = [];

    trees.forEach((tree, index) => {
      const ground = cityElevationAt(tree);
      const trunkY = tree.trunk / 2 + 0.05;
      position.set(tree.x, ground + trunkY, tree.z);
      scale.set(1, tree.trunk, 1);
      matrix.compose(position, rotation, scale);
      trunks.setMatrixAt(index, matrix);
      trunkAnchors.push({ ...tree, y: trunkY });

      const crownY = tree.trunk + tree.crown * 0.5;
      position.set(tree.x, ground + crownY, tree.z);
      scale.set(tree.crown, tree.crown * 0.82, tree.crown);
      matrix.compose(position, rotation, scale);
      crowns.setMatrixAt(index, matrix);
      crowns.setColorAt(index, new THREE.Color(tree.tint));
      crownAnchors.push({ ...tree, y: crownY });
    });
    trunks.userData.terrainInstances = trunkAnchors;
    crowns.userData.terrainInstances = crownAnchors;
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    trunks.castShadow = crowns.castShadow = true;
    trunks.receiveShadow = crowns.receiveShadow = true;
    this.group.add(trunks, crowns);

    const parkBranches = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.032, 0.082, 1, 8, 3), bark, trees.length * 5);
    parkBranches.name = "Natural branched park-tree skeletons";
    const branchDirection = new THREE.Vector3();
    const branchQuaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const branchAnchors: Array<Coordinates & { y: number }> = [];
    trees.forEach((tree, treeIndex) => {
      for (let branch = 0; branch < 5; branch++) {
        const index = treeIndex * 5 + branch;
        const angle = branch * 2.399 + deterministicNoise(treeIndex, branch + 307) * 0.72;
        const length = tree.crown * (0.54 + deterministicNoise(treeIndex + 19, branch + 311) * 0.38);
        branchDirection.set(Math.sin(angle), 0.46 + deterministicNoise(treeIndex, branch + 313) * 0.29, Math.cos(angle)).normalize();
        branchQuaternion.setFromUnitVectors(up, branchDirection);
        const baseY = tree.trunk * (0.54 + branch * 0.065);
        const y = baseY + branchDirection.y * length * 0.5;
        position.set(tree.x + branchDirection.x * length * 0.5, cityElevationAt(tree) + y, tree.z + branchDirection.z * length * 0.5);
        scale.set(1, length, 1);
        matrix.compose(position, branchQuaternion, scale);
        parkBranches.setMatrixAt(index, matrix);
        branchAnchors.push({ x: position.x, z: position.z, y });
      }
    });
    parkBranches.userData.terrainInstances = branchAnchors;
    parkBranches.instanceMatrix.needsUpdate = true;
    parkBranches.castShadow = true;
    this.group.add(parkBranches);

    if (shrubs.length > 0) {
      const plants = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 9, 7), shrubbery, shrubs.length);
      plants.name = "Physical park shrubs and landscaped gardens";
      const anchors: Array<Coordinates & { y: number }> = [];
      shrubs.forEach((shrub, index) => {
        const y = shrub.size * 0.46;
        position.set(shrub.x, cityElevationAt(shrub) + y, shrub.z);
        scale.set(shrub.size, shrub.size * 0.72, shrub.size);
        matrix.compose(position, rotation, scale);
        plants.setMatrixAt(index, matrix);
        anchors.push({ ...shrub, y });
      });
      plants.userData.terrainInstances = anchors;
      plants.instanceMatrix.needsUpdate = true;
      plants.castShadow = true;
      this.group.add(plants);
    }

    if (benches.length > 0) {
      const seats = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.045), benchMaterial, benches.length * 2);
      seats.name = "Physical park benches";
      const anchors: Array<Coordinates & { y: number }> = [];
      benches.forEach((bench, index) => {
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), bench.angle);
        for (let part = 0; part < 2; part++) {
          const y = part === 0 ? 0.51 : 0.84;
          position.set(bench.x, cityElevationAt(bench) + y, bench.z + (part === 0 ? 0 : 0.2));
          scale.set(1.62, part === 0 ? 0.13 : 0.56, part === 0 ? 0.46 : 0.09);
          matrix.compose(position, rotation, scale);
          seats.setMatrixAt(index * 2 + part, matrix);
          anchors.push({ x: bench.x, z: bench.z + (part === 0 ? 0 : 0.2), y });
        }
      });
      seats.userData.terrainInstances = anchors;
      seats.instanceMatrix.needsUpdate = true;
      seats.castShadow = true;
      this.group.add(seats);
    }
  }

  private renderSchoolLandmarks() {
    const campuses = [...this.schoolCampuses]
      .sort((left, right) => Math.hypot(left.position.x, left.position.z) - Math.hypot(right.position.x, right.position.z))
      .slice(0, 18);
    if (campuses.length === 0) return;
    const wall = new THREE.MeshStandardMaterial({ color: "#f1eadc", map: this.textures.facades[1] ?? this.textures.facades[0] ?? null, roughness: 0.76, metalness: 0.025 });
    const trim = new THREE.MeshStandardMaterial({ color: "#8f6155", roughness: 0.77 });
    const glass = new THREE.MeshStandardMaterial({ color: "#71939b", roughness: 0.29, metalness: 0.16 });
    const court = new THREE.MeshStandardMaterial({ color: "#8eaa86", roughness: 0.96 });
    const courtLine = new THREE.LineBasicMaterial({ color: "#f5eee0" });
    const pole = new THREE.MeshStandardMaterial({ color: "#b7b5aa", roughness: 0.49, metalness: 0.59 });
    this.disposableMaterials.push(wall, trim, glass, court, courtLine, pole);
    this.schoolFacadeMaterials?.push(wall);

    for (const campus of campuses) {
      const place = new THREE.Group();
      place.name = `Mapped physical school campus · ${campus.name}`;
      place.position.set(campus.position.x, cityElevationAt(campus.position), campus.position.z);
      place.userData.terrainAnchor = campus.position;
      const actualBuilding = this.buildings.some((building) => Math.hypot(building.x - campus.position.x, building.z - campus.position.z) < campus.radius * 0.78);

      if (!actualBuilding) {
        const buildingWidth = Math.max(14, Math.min(31, campus.radius * 0.95));
        const buildingDepth = Math.max(8, Math.min(16, campus.radius * 0.48));
        const structure = new THREE.Mesh(new RoundedBoxGeometry(buildingWidth, 8.4, buildingDepth, 2, 0.12), wall);
        structure.position.set(0, 4.32, campus.radius * 0.13);
        structure.castShadow = true;
        const roof = new THREE.Mesh(new RoundedBoxGeometry(buildingWidth + 0.55, 0.26, buildingDepth + 0.45, 2, 0.06), trim);
        roof.position.set(0, 8.62, campus.radius * 0.13);
        place.add(structure, roof);
        const sideWing = new THREE.Mesh(new RoundedBoxGeometry(buildingDepth, 6.2, buildingWidth * 0.62, 2, 0.12), wall);
        sideWing.name = "L-shaped photographic Taiwanese school classroom wing";
        sideWing.position.set(-buildingWidth / 2 + buildingDepth / 2, 3.22, campus.radius * 0.13 + buildingWidth * 0.3);
        sideWing.castShadow = true;
        const corridorRoof = new THREE.Mesh(new RoundedBoxGeometry(buildingWidth * 0.76, 0.24, 2.4, 2, 0.07), trim);
        corridorRoof.name = "Covered school courtyard circulation corridor";
        corridorRoof.position.set(buildingWidth * 0.08, 3.7, campus.radius * 0.13 + buildingDepth / 2 + 2.25);
        place.add(sideWing, corridorRoof);
        for (let column = 0; column < 7; column++) {
          const support = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 3.55, 8), pole);
          support.position.set(-buildingWidth * 0.29 + column * buildingWidth * 0.095, 1.82, campus.radius * 0.13 + buildingDepth / 2 + 2.25);
          place.add(support);
        }
        for (let row = 0; row < 2; row++) {
          for (let column = 0; column < 6; column++) {
            const window = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.19, 0.09), glass);
            window.position.set((column - 2.5) * (buildingWidth / 7.3), 3.15 + row * 2.48, campus.radius * 0.13 - buildingDepth / 2 - 0.055);
            place.add(window);
          }
        }
        for (let panel = 0; panel < 5; panel++) {
          const panelSize = buildingWidth / 5.45;
          const photoPanel = new THREE.Mesh(new THREE.PlaneGeometry(panelSize, panelSize), wall);
          photoPanel.name = "Correct-aspect photographic school facade bay";
          photoPanel.position.set((panel - 2) * buildingWidth / 5.35, 5.25, campus.radius * 0.13 - buildingDepth / 2 - 0.065);
          place.add(photoPanel);
        }
      }

      const gateWidth = Math.min(10.5, Math.max(5.4, campus.radius * 0.33));
      const gateZ = -Math.min(campus.radius * 0.72, 22);
      for (const side of [-1, 1]) {
        const gatePost = new THREE.Mesh(new RoundedBoxGeometry(0.68, 3.05, 0.78, 2, 0.08), trim);
        gatePost.position.set(side * gateWidth / 2, 1.54, gateZ);
        gatePost.castShadow = true;
        place.add(gatePost);
      }
      const gate = new THREE.Mesh(new RoundedBoxGeometry(gateWidth + 0.72, 0.55, 0.46, 2, 0.08), wall);
      gate.position.set(0, 3.18, gateZ);
      place.add(gate);

      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 512;
      labelCanvas.height = 128;
      const context = labelCanvas.getContext("2d");
      if (context) {
        context.fillStyle = "#f1eadb";
        context.fillRect(0, 0, 512, 128);
        context.fillStyle = "#59443c";
        context.font = "bold 56px sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(campus.name.slice(0, 12), 256, 66, 475);
        const texture = new THREE.CanvasTexture(labelCanvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.disposableTextures.push(texture);
        const label = new THREE.MeshBasicMaterial({ map: texture });
        this.disposableMaterials.push(label);
        const board = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(5.6, gateWidth * 0.76), 1.05), label);
        board.position.set(0, 2.22, gateZ - 0.27);
        place.add(board);
      }

      const courtSurface = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(15, campus.radius * 0.61), Math.min(9, campus.radius * 0.38)), court);
      courtSurface.rotation.x = -Math.PI / 2;
      courtSurface.position.set(campus.radius * 0.3, 0.071, campus.radius * 0.45);
      place.add(courtSurface);
      const courtLines = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(Math.min(14.4, campus.radius * 0.58), Math.min(8.4, campus.radius * 0.35))),
        courtLine,
      );
      courtLines.name = "Marked school multipurpose sports court";
      courtLines.rotation.x = -Math.PI / 2;
      courtLines.position.set(campus.radius * 0.3, 0.083, campus.radius * 0.45);
      place.add(courtLines);
      const flagpole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 6.7, 9), pole);
      flagpole.position.set(-gateWidth / 2 - 1.5, 3.39, gateZ + 2.2);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.78), trim);
      flag.position.set(-gateWidth / 2 - 0.85, 6.3, gateZ + 2.2);
      place.add(flagpole, flag);
      this.group.add(place);
    }
  }

  private renderStreetLighting() {
    const placements: Array<Coordinates & { angle: number }> = [];
    for (const [index, street] of this.streetSegments.entries()) {
      if (street.width < 7.2) continue;
      const dx = street.b.x - street.a.x;
      const dz = street.b.z - street.a.z;
      const length = Math.hypot(dx, dz);
      if (length < 20) continue;
      const count = Math.max(1, Math.floor(length / 46));
      for (let light = 0; light < count && placements.length < 175; light++) {
        const progress = (light + 0.5) / count;
        const side = index % 2 === 0 ? 1 : -1;
        const x = street.a.x + dx * progress + -dz / length * side * (street.width / 2 + 1.1);
        const z = street.a.z + dz * progress + dx / length * side * (street.width / 2 + 1.1);
        if (insideShoppingStreet({ x, z }, 6)) continue;
        if (placements.some((previous) => Math.hypot(previous.x - x, previous.z - z) < 18)) continue;
        placements.push({ x, z, angle: Math.atan2(dx, -dz) });
      }
    }
    if (placements.length === 0) return;
    const metal = new THREE.MeshStandardMaterial({ color: "#777e76", roughness: 0.58, metalness: 0.63 });
    const glow = new THREE.MeshStandardMaterial({ color: "#f8e6c0", emissive: "#ebdcb3", emissiveIntensity: 0.37, roughness: 0.35 });
    this.disposableMaterials.push(metal, glow);
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 1, 8), metal, placements.length);
    const lamps = new THREE.InstancedMesh(new RoundedBoxGeometry(0.47, 0.12, 0.79, 2, 0.04), glow, placements.length);
    poles.name = "Real street-side lamp posts";
    lamps.name = "Three-dimensional Taiwanese street lamps";
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();
    const anchors: Array<Coordinates & { y: number }> = [];
    const lightAnchors: Array<Coordinates & { y: number }> = [];
    placements.forEach((placement, index) => {
      const height = 4.7 + (index % 3) * 0.22;
      position.set(placement.x, cityElevationAt(placement) + height / 2, placement.z);
      scale.set(1, height, 1);
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.angle);
      matrix.compose(position, rotation, scale);
      poles.setMatrixAt(index, matrix);
      anchors.push({ ...placement, y: height / 2 });
      position.set(placement.x, cityElevationAt(placement) + height, placement.z);
      scale.set(1, 1, 1);
      matrix.compose(position, rotation, scale);
      lamps.setMatrixAt(index, matrix);
      lightAnchors.push({ ...placement, y: height });
    });
    poles.userData.terrainInstances = anchors;
    lamps.userData.terrainInstances = lightAnchors;
    poles.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    this.group.add(poles, lamps);
  }

  private renderStreetLife() {
    const trees: StreetDetail[] = [];
    const bollards: StreetDetail[] = [];
    const benches: StreetDetail[] = [];
    const parkedScooters: StreetDetail[] = [];
    const shelters: StreetDetail[] = [];
    const utilityPoles: StreetDetail[] = [];
    const electricalBoxes: StreetDetail[] = [];
    const hydrants: StreetDetail[] = [];
    const trashBags: StreetDetail[] = [];
    const deliveryCrates: StreetDetail[] = [];
    const constructionBarriers: StreetDetail[] = [];
    const nearbyStreets = this.streetSegments
      .filter((street) => Math.min(Math.hypot(street.a.x, street.a.z), Math.hypot(street.b.x, street.b.z)) < 1000)
      .slice(0, 360);

    for (const [streetIndex, street] of nearbyStreets.entries()) {
      const dx = street.b.x - street.a.x;
      const dz = street.b.z - street.a.z;
      const length = Math.hypot(dx, dz);
      if (length < 19 || street.width < 6.3) continue;
      const directionX = dx / length;
      const directionZ = dz / length;
      const samples = Math.min(10, Math.max(1, Math.floor(length / 21)));

      for (let sample = 0; sample < samples && trees.length < 230; sample++) {
        const progress = (sample + 0.55) / samples;
        for (const side of [-1, 1]) {
          const position = {
            x: street.a.x + dx * progress - directionZ * side * (street.width / 2 + 1.12),
            z: street.a.z + dz * progress + directionX * side * (street.width / 2 + 1.12),
          };
          if (Math.hypot(position.x, position.z) > 1040) continue;
          if (insideShoppingStreet(position, 2)) continue;
          if (trees.some((tree) => Math.hypot(tree.x - position.x, tree.z - position.z) < 9.5)) continue;
          if (this.buildings.some((building) =>
            Math.abs(building.x - position.x) < building.halfWidth + 0.72
            && Math.abs(building.z - position.z) < building.halfDepth + 0.72,
          )) continue;
          let crossing = false;
          for (const other of nearbyStreets) {
            if (other === street) continue;
            const otherX = other.b.x - other.a.x;
            const otherZ = other.b.z - other.a.z;
            const squared = otherX * otherX + otherZ * otherZ;
            if (squared < 0.1) continue;
            const along = Math.max(0, Math.min(1, ((position.x - other.a.x) * otherX + (position.z - other.a.z) * otherZ) / squared));
            if (Math.hypot(position.x - other.a.x - otherX * along, position.z - other.a.z - otherZ * along) < other.width / 2 + 0.4) {
              crossing = true;
              break;
            }
          }
          if (crossing) continue;

          const style = (streetIndex + sample + (side < 0 ? 1 : 0)) % 5;
          const height = 3.1 + deterministicNoise(streetIndex * 7 + sample, side + 19) * 2.1;
          const angle = Math.atan2(dx, -dz);
          trees.push({ ...position, y: 0, angle, height, style });
          bollards.push({ x: position.x + directionX * 1.3, z: position.z + directionZ * 1.3, y: 0.44, angle, style });
          if ((sample + streetIndex) % 5 === 1 && benches.length < 48) {
            benches.push({ x: position.x + directionX * 2.2, z: position.z + directionZ * 2.2, y: 0.48, angle, style });
          }
          if ((sample + streetIndex * 2) % 4 === 0 && parkedScooters.length < 76) {
            parkedScooters.push({ x: position.x - directionX * 2.3, z: position.z - directionZ * 2.3, y: 0, angle, style });
          }
          if (sample === 1 && side === 1 && street.width >= 10 && streetIndex % 5 === 0 && shelters.length < 12) {
            shelters.push({ x: position.x + directionX * 4.6, z: position.z + directionZ * 4.6, y: 0, angle, style });
          }
          if (sample % 4 === 0 && side === -1 && utilityPoles.length < 92) utilityPoles.push({ ...position, y: 4.6, angle, style: streetIndex });
          if ((sample + streetIndex) % 7 === 2 && side === 1 && electricalBoxes.length < 46) electricalBoxes.push({ x: position.x + directionX * 1.5, z: position.z + directionZ * 1.5, y: 0.72, angle, style });
          if ((sample + streetIndex) % 11 === 3 && side === 1 && hydrants.length < 28) hydrants.push({ x: position.x - directionX * 1.2, z: position.z - directionZ * 1.2, y: 0.39, angle, style });
          if ((sample * 2 + streetIndex) % 9 === 1 && trashBags.length < 55) trashBags.push({ x: position.x + directionX * 0.8, z: position.z + directionZ * 0.8, y: 0.28, angle, style });
          if ((sample + streetIndex) % 8 === 5 && deliveryCrates.length < 48) deliveryCrates.push({ x: position.x - directionX * 1.7, z: position.z - directionZ * 1.7, y: 0.31, angle, style });
          if (sample === samples - 1 && streetIndex % 9 === 2 && constructionBarriers.length < 22) constructionBarriers.push({ x: position.x, z: position.z, y: 0.58, angle, style });
        }
      }
    }
    // Plant courtyards with the same botanical assets as the adjoining streets.
    for(const garden of this.urbanGardens??[])for(const offset of [-2.8,2.8])
      trees.push({x:(garden.left+garden.right)/2+offset,z:(garden.back+garden.front)/2,y:0,angle:0,height:4.6,style:0});
    const occupied = [
      ...trees.map(p=>({...p,radius:.86})), ...bollards.map(p=>({...p,radius:.12})),
      ...parkedScooters.map(p=>({...p,radius:.8})), ...shelters.map(p=>({...p,radius:2})),
      ...utilityPoles.map(p=>({...p,radius:.2})), ...electricalBoxes.map(p=>({...p,radius:.5})),
      ...trashBags.map(p=>({...p,radius:.4})), ...deliveryCrates.map(p=>({...p,radius:.5})),
      ...constructionBarriers.map(p=>({...p,radius:1.2})),
      ...this.bridgePierColliders.map(p=>({...p,radius:Math.hypot(p.halfWidth,p.halfDepth)})),
    ];
    this.streetPropPlacements=planStreetProps(this.streetSegments,this.buildings,occupied,cityElevationAt,p=>
      insideShoppingStreet(p,3) || this.roadJunctions.some(j=>Math.hypot(p.x-j.position.x,p.z-j.position.z)<j.radius+.8)
      || this.waterChannels.some(channel=>{const dx=channel.b.x-channel.a.x,dz=channel.b.z-channel.a.z,square=dx*dx+dz*dz;const t=square?Math.max(0,Math.min(1,((p.x-channel.a.x)*dx+(p.z-channel.a.z)*dz)/square)):0;return Math.hypot(p.x-channel.a.x-t*dx,p.z-channel.a.z-t*dz)<channel.width/2+4;})
    );
    if (trees.length === 0) { this.renderStreetPropAssets(); return; }

    const leafTexture = botanicalLeafTexture(this.maxAnisotropy);
    this.disposableTextures.push(leafTexture);
    const bark = new THREE.MeshStandardMaterial({ color: "#62513c", roughness: 0.98, bumpScale: 0.18 });
    const foliage = new THREE.MeshStandardMaterial({ color: "#ffffff", map: leafTexture, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.88 });
    const concrete = new THREE.MeshStandardMaterial({ color: "#b6aea0", roughness: 0.94 });
    const steel = new THREE.MeshStandardMaterial({ color: "#747a75", roughness: 0.45, metalness: 0.67 });
    const timber = new THREE.MeshStandardMaterial({ color: "#8e6a48", roughness: 0.83 });
    const scooterPaint = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.39, metalness: 0.28 });
    const rubber = new THREE.MeshStandardMaterial({ color: "#262725", roughness: 0.96 });
    const shelterGlass = new THREE.MeshPhysicalMaterial({ color: "#b9d0cd", transparent: true, opacity: 0.36, roughness: 0.17, metalness: 0.04, transmission: 0.24 });
    const utilityMetal = new THREE.MeshStandardMaterial({ color: "#696e6b", roughness: 0.61, metalness: 0.54 });
    const electricalPaint = new THREE.MeshStandardMaterial({ color: "#76827a", roughness: 0.72, metalness: 0.34 });
    const hydrantPaint = new THREE.MeshStandardMaterial({ color: "#bd4d3e", roughness: 0.63, metalness: 0.27 });
    const blackPlastic = new THREE.MeshStandardMaterial({ color: "#272a29", roughness: 0.68, metalness: 0.02 });
    const cratePaint = new THREE.MeshStandardMaterial({ color: "#b98b52", roughness: 0.84 });
    const barrierPaint = new THREE.MeshStandardMaterial({ color: "#d48b3d", roughness: 0.67, metalness: 0.09 });
    this.disposableMaterials.push(bark, foliage, concrete, steel, timber, scooterPaint, rubber, shelterGlass, utilityMetal, electricalPaint, hydrantPaint, blackPlastic, cratePaint, barrierPaint);

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const addInstances = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      entries: StreetDetail[],
      configure: (entry: StreetDetail, index: number) => { y: number; width: number; height: number; depth: number; offsetX?: number; offsetZ?: number; angle?: number; color?: string },
    ) => {
      if (entries.length === 0) {
        geometry.dispose();
        return;
      }
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.name = name;
      const anchors: Array<Coordinates & { y: number }> = [];
      entries.forEach((entry, index) => {
        const dimensions = configure(entry, index);
        const x = entry.x + (dimensions.offsetX ?? 0);
        const z = entry.z + (dimensions.offsetZ ?? 0);
        position.set(x, cityElevationAt({ x, z }) + dimensions.y, z);
        rotation.setFromAxisAngle(up, dimensions.angle ?? entry.angle);
        scale.set(dimensions.width, dimensions.height, dimensions.depth);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
        if (dimensions.color) mesh.setColorAt(index, new THREE.Color(dimensions.color));
        anchors.push({ x, z, y: dimensions.y });
      });
      mesh.userData.terrainInstances = anchors;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };

    const greens = ["#779c65", "#8baa70", "#648b5c", "#9cb77c", "#587d50"];
    addInstances("Street-level Taiwanese tree trunks", new THREE.CylinderGeometry(0.12, 0.22, 1, 14, 5), bark, trees,
      (tree) => ({ y: (tree.height ?? 4) * 0.35, width: 1, height: (tree.height ?? 4) * 0.7, depth: 1 }));

    const branchEntries = trees.flatMap((tree, treeIndex) => Array.from({ length: 6 }, (_, branch) => {
      const angle = tree.angle + branch * 2.399 + deterministicNoise(treeIndex, branch + 211) * 0.58;
      const trunkHeight = (tree.height ?? 4) * 0.7;
      const length = 0.85 + deterministicNoise(treeIndex + 7, branch + 223) * 1.15;
      return { tree, treeIndex, branch, angle, trunkHeight, length };
    }));
    const branchMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.09, 1, 8, 3), bark, branchEntries.length);
    branchMesh.name = "Branched high-detail roadside tree structure";
    const branchUp = new THREE.Vector3(0, 1, 0);
    const branchDirection = new THREE.Vector3();
    const branchQuaternion = new THREE.Quaternion();
    const branchAnchors: Array<Coordinates & { y: number }> = [];
    branchEntries.forEach((entry, index) => {
      const vertical = 0.46 + deterministicNoise(entry.treeIndex, entry.branch + 229) * 0.25;
      branchDirection.set(Math.sin(entry.angle), vertical, Math.cos(entry.angle)).normalize();
      branchQuaternion.setFromUnitVectors(branchUp, branchDirection);
      const baseY = entry.trunkHeight * (0.54 + entry.branch * 0.055);
      const centerY = baseY + branchDirection.y * entry.length * 0.5;
      position.set(
        entry.tree.x + branchDirection.x * entry.length * 0.5,
        cityElevationAt(entry.tree) + centerY,
        entry.tree.z + branchDirection.z * entry.length * 0.5,
      );
      scale.set(1, entry.length, 1);
      matrix.compose(position, branchQuaternion, scale);
      branchMesh.setMatrixAt(index, matrix);
      branchAnchors.push({ x: position.x, z: position.z, y: centerY });
    });
    branchMesh.userData.terrainInstances = branchAnchors;
    branchMesh.instanceMatrix.needsUpdate = true;
    branchMesh.castShadow = true;
    this.group.add(branchMesh);

    addInstances("Layered realistic roadside tree canopies", layeredLeafCardGeometry(), foliage, trees,
      (tree, index) => ({ y: (tree.height ?? 4) * 0.82, width: 1.35 + (index % 3) * 0.16, height: 1.15 + (index % 3) * 0.1, depth: 1.42, color: greens[(tree.style ?? 0) % greens.length] }));
    addInstances("Secondary organic street-tree foliage", layeredLeafCardGeometry(), foliage, trees,
      (tree, index) => ({ y: (tree.height ?? 4) * 1.02, width: 0.95, height: 0.83, depth: 1.02, offsetX: Math.sin(tree.angle + index) * 0.48, offsetZ: Math.cos(tree.angle + index) * 0.4, color: greens[((tree.style ?? 0) + 1) % greens.length] }));
    addInstances("Physical curbside tree planters", new RoundedBoxGeometry(1, 1, 1, 2, 0.06), concrete, trees,
      () => ({ y: 0.12, width: 1.2, height: 0.16, depth: 1.2 }));
    addInstances("Taiwanese sidewalk safety bollards", new THREE.CylinderGeometry(0.08, 0.095, 1, 8), steel, bollards,
      (post) => ({ y: post.y, width: 1, height: 0.83, depth: 1 }));
    addInstances("Street-side wooden public benches", new RoundedBoxGeometry(1, 1, 1, 2, 0.045), timber, benches,
      (bench) => ({ y: bench.y, width: 1.52, height: 0.15, depth: 0.48 }));
    const scooterColors = ["#788579", "#a68f7a", "#455c67", "#d1c6b1", "#7f6360"];
    addInstances("Realistically parked sidewalk scooters", new RoundedBoxGeometry(1, 1, 1, 3, 0.13), scooterPaint, parkedScooters,
      (scooter) => ({ y: 0.69, width: 0.51, height: 0.69, depth: 1.38, color: scooterColors[(scooter.style ?? 0) % scooterColors.length] }));
    addInstances("Parked scooter saddle seats", new RoundedBoxGeometry(1, 1, 1, 2, 0.07), rubber, parkedScooters,
      () => ({ y: 1.03, width: 0.48, height: 0.12, depth: 0.73 }));
    addInstances("Parked scooter front wheels", new THREE.SphereGeometry(0.28, 10, 8), rubber, parkedScooters,
      (scooter) => ({ y: 0.25, width: 1, height: 1, depth: 0.48, offsetX: Math.sin(scooter.angle) * 0.54, offsetZ: -Math.cos(scooter.angle) * 0.54 }));
    addInstances("Parked scooter rear wheels", new THREE.SphereGeometry(0.28, 10, 8), rubber, parkedScooters,
      (scooter) => ({ y: 0.25, width: 1, height: 1, depth: 0.48, offsetX: -Math.sin(scooter.angle) * 0.54, offsetZ: Math.cos(scooter.angle) * 0.54 }));
    addInstances("Real street-side covered bus stops", new RoundedBoxGeometry(1, 1, 1, 2, 0.04), steel, shelters,
      () => ({ y: 2.52, width: 3.5, height: 0.12, depth: 1.48 }));
    addInstances("Transparent public-transit shelter walls", new THREE.BoxGeometry(1, 1, 1), shelterGlass, shelters,
      () => ({ y: 1.29, width: 3.3, height: 2.28, depth: 0.055 }));
    addInstances("Taiwanese utility and power poles", new THREE.CylinderGeometry(0.1, 0.15, 1, 10), utilityMetal, utilityPoles,
      () => ({ y: 4.6, width: 1, height: 9.1, depth: 1 }));
    addInstances("Street-side electrical utility cabinets", new RoundedBoxGeometry(1, 1, 1, 2, 0.06), electricalPaint, electricalBoxes,
      () => ({ y: 0.72, width: 0.7, height: 1.38, depth: 0.5 }));
    addInstances("Physical Taiwanese fire hydrants", new THREE.CylinderGeometry(0.14, 0.19, 1, 10), hydrantPaint, hydrants,
      () => ({ y: 0.39, width: 1, height: 0.72, depth: 1 }));
    addInstances("Lived-in streetside garbage bags", new THREE.SphereGeometry(1, 10, 8), blackPlastic, trashBags,
      (bag, index) => ({ y: bag.y, width: 0.31 + index % 3 * 0.04, height: 0.42, depth: 0.31 }));
    addInstances("Curbside delivery boxes and shop goods", new RoundedBoxGeometry(1, 1, 1, 2, 0.045), cratePaint, deliveryCrates,
      (box, index) => ({ y: box.y, width: 0.55 + index % 2 * 0.18, height: 0.58, depth: 0.48 }));
    addInstances("Taiwanese roadside construction barriers", new RoundedBoxGeometry(1, 1, 1, 2, 0.05), barrierPaint, constructionBarriers,
      () => ({ y: 0.58, width: 2.3, height: 0.84, depth: 0.18 }));

    if (utilityPoles.length > 1) {
      const positions: number[] = [];
      const byStreet = new Map<number, StreetDetail[]>();
      utilityPoles.forEach((pole) => {
        const key = pole.style ?? 0;
        const list = byStreet.get(key) ?? [];
        list.push(pole);
        byStreet.set(key, list);
      });
      byStreet.forEach((poles) => {
        for (let index = 0; index < poles.length - 1; index++) {
          const a = poles[index];
          const b = poles[index + 1];
          if (Math.hypot(a.x - b.x, a.z - b.z) > 75) continue;
          const sag = Math.max(cityElevationAt(a), cityElevationAt(b)) + 8.35;
          positions.push(a.x, cityElevationAt(a) + 8.7, a.z, (a.x + b.x) / 2, sag, (a.z + b.z) / 2, (a.x + b.x) / 2, sag, (a.z + b.z) / 2, b.x, cityElevationAt(b) + 8.7, b.z);
        }
      });
      if (positions.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        const material = new THREE.LineBasicMaterial({ color: "#292d2d", transparent: true, opacity: 0.82 });
        this.disposableMaterials.push(material);
        const cables = new THREE.LineSegments(geometry, material);
        cables.name = "Sagging overhead Taiwanese utility cables";
        this.group.add(cables);
      }
    }
    this.renderStreetPropAssets();
  }

  private renderRecognizableLandmarks() {
    const stone = new THREE.MeshStandardMaterial({ color: "#bcb7a9", roughness: 0.89 });
    const warmStone = new THREE.MeshStandardMaterial({ color: "#d1c1a7", roughness: 0.92 });
    const timber = new THREE.MeshStandardMaterial({ color: "#776653", roughness: 0.87 });
    const bronze = new THREE.MeshStandardMaterial({ color: "#b49b72", roughness: 0.37, metalness: 0.76 });
    const leaves = new THREE.MeshStandardMaterial({ color: "#708962", roughness: 0.96 });
    const lantern = new THREE.MeshStandardMaterial({ color: "#f4d49d", emissive: "#dfac69", emissiveIntensity: 0.7, roughness: 0.48 });
    const water = new THREE.MeshPhysicalMaterial({ color: "#6c9ba0", roughness: 0.12, clearcoat: 0.85, clearcoatRoughness: 0.12, transparent: true, opacity: 0.87 });
    this.disposableMaterials.push(stone, warmStone, timber, bronze, leaves, lantern, water);
    this.riverSurfaces.push(water);

    const anchoredGroup = (name: string, locationIndex: number, offsetX: number, offsetZ: number) => {
      const original = coordinatesFromLocation(TAICHUNG_LOCATIONS[locationIndex]);
      const anchor = { x: original.x + offsetX, z: original.z + offsetZ };
      const group = new THREE.Group();
      group.name = name;
      group.position.set(anchor.x, cityElevationAt(anchor), anchor.z);
      group.userData.terrainAnchor = anchor;
      this.group.add(group);
      return group;
    };
    const casting = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    const greenway = anchoredGroup("中央綠園道 · 木構休憩棚", 0, 18, -14);
    for (let index = 0; index < 4; index++) {
      for (const side of [-1, 1]) {
        const post = casting(new THREE.Mesh(new RoundedBoxGeometry(0.2, 3, 0.2, 2, 0.045), timber));
        post.position.set(side * 2.35, 1.55, (index - 1.5) * 2.18);
        greenway.add(post);
      }
      const roofBeam = casting(new THREE.Mesh(new RoundedBoxGeometry(5.1, 0.16, 0.23, 2, 0.035), timber));
      roofBeam.position.set(0, 3.03, (index - 1.5) * 2.18);
      greenway.add(roofBeam);
    }
    for (let slat = 0; slat < 12; slat++) {
      const beam = casting(new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.11, 7.1, 2, 0.025), timber));
      beam.position.set((slat - 5.5) * 0.39, 3.14, 0);
      greenway.add(beam);
    }

    const eslite = anchoredGroup("晴川百貨 · 垂直綠化入口", 1, 15, 11);
    const wall = casting(new THREE.Mesh(new RoundedBoxGeometry(7.8, 6.6, 0.36, 2, 0.06), stone));
    wall.position.set(0, 3.4, 0);
    eslite.add(wall);
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 6; column++) {
        const planter = casting(new THREE.Mesh(new RoundedBoxGeometry(0.99, 0.25, 0.41, 2, 0.045), timber));
        planter.position.set((column - 2.5) * 1.2, 1.02 + row * 1.43, 0.34);
        const plant = casting(new THREE.Mesh(new THREE.IcosahedronGeometry(0.54, 1), leaves));
        plant.scale.set(1.1, 0.72, 0.67);
        plant.position.set(planter.position.x, planter.position.y + 0.4, 0.47);
        eslite.add(planter, plant);
      }
    }

    const plaza = anchoredGroup("海灣市民廣場 · 實體石材噴泉與水池", 2, 27, 18);
    const plinth = casting(new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.8, 0.34, 40), warmStone));
    plinth.position.y = 0.18;
    const basin = casting(new THREE.Mesh(new THREE.TorusGeometry(5.35, 0.3, 11, 48), stone));
    basin.rotation.x = Math.PI / 2;
    basin.position.y = 0.55;
    const pool = new THREE.Mesh(new THREE.CircleGeometry(5.11, 40), water);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.38;
    const centerpiece = casting(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 1.15, 18), stone));
    centerpiece.position.y = 0.9;
    plaza.add(plinth, basin, pool, centerpiece);
    for (let jet = 0; jet < 6; jet++) {
      const angle = jet * Math.PI * 2 / 6;
      const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.9 + (jet % 3) * 0.33, 7), water);
      stream.position.set(Math.cos(angle) * 2.25, 0.98 + (jet % 3) * 0.16, Math.sin(angle) * 2.25);
      plaza.add(stream);
    }

    const audit = anchoredGroup("南町生活街 · 青年市集與老宅燈串", 3, 15, -8);
    for (const side of [-1, 1]) {
      const post = casting(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 4.2, 8), timber));
      post.position.set(side * 4.2, 2.14, 0);
      audit.add(post);
    }
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 8.5, 7), bronze);
    cable.position.y = 4.11;
    cable.rotation.z = Math.PI / 2;
    audit.add(cable);
    for (let light = 0; light < 9; light++) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), lantern);
      bulb.position.set((light - 4) * 0.93, 3.89 - Math.abs(light - 4) * 0.035, 0);
      audit.add(bulb);
    }

    const museum = anchoredGroup("城市文化館 · 入口公共藝術", 4, 17, 13);
    const pedestal = casting(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.7, 0.74, 28), stone));
    pedestal.position.y = 0.39;
    museum.add(pedestal);
    for (const [index, angle] of [0, Math.PI / 2, Math.PI / 4].entries()) {
      const ring = casting(new THREE.Mesh(new THREE.TorusGeometry(2.08, 0.085, 9, 54), bronze));
      ring.position.y = 2.85;
      ring.rotation.set(index === 1 ? Math.PI / 2 : 0, angle, index === 2 ? Math.PI / 3 : 0);
      museum.add(ring);
    }
    const planet = casting(new THREE.Mesh(new THREE.SphereGeometry(0.71, 18, 14), lantern));
    planet.position.y = 2.85;
    museum.add(planet);
  }

  private renderBuildings(features: TileFeature[]) {
    const candidates: BuildingCandidate[] = [];
    for (const feature of features) {
      for (const polygon of polygonCoordinates(feature.geometry)) {
        const rings = localPolygon(polygon);
        const outline = rings[0];
        if (!outline || outline.length < 4) continue;
        const left = Math.min(...outline.map((point) => point.x));
        const right = Math.max(...outline.map((point) => point.x));
        const back = Math.min(...outline.map((point) => point.z));
        const front = Math.max(...outline.map((point) => point.z));
        const x = (left + right) / 2;
        const z = (back + front) / 2;
        const distance = Math.hypot(x, z);
        const area = (right - left) * (front - back);
        if (distance > WORLD_RADIUS || right - left < 2 || front - back < 2 || area < 8) continue;
        const properties = feature.properties;
        if (!this.buildingClearsInfrastructure(outline)) continue;
        const explicitHeight = Number(properties.render_height ?? properties.height ?? 0);
        const levels = Number(properties.levels ?? properties.render_levels ?? 0);
        const variation = deterministicNoise(Math.round(x), Math.round(z));
        const inferredHeight = levels > 0 ? levels * 3.2 : 8 + Math.min(28, Math.sqrt(area) * 0.32 + variation * 18);
        let height = Math.min(92, Math.max(5, explicitHeight || inferredHeight));
        const rawType = String(properties.archetype ?? properties.building_type ?? properties.building ?? "").toLowerCase();
        const archetype: BuildingArchetype = rawType.includes("department") ? "department_store"
          : rawType.includes("market") ? "traditional_market"
          : rawType.includes("office") ? "office"
          : rawType.includes("tower") ? "residential_tower"
          : rawType.includes("old") ? "old_apartment"
          : rawType.includes("restaurant") ? "restaurant"
          : rawType.includes("shop") || String(properties.zone ?? "") === "commercial" ? "shop"
          : "apartment";
        if (archetype === "old_apartment") height = Math.min(height, 20);
        if (["shop", "restaurant", "traditional_market"].includes(archetype)) height = Math.min(height, 16.5);
        const facadeCount = Math.max(1, this.textures.facades.length);
        const style = (archetype === "office" || archetype === "department_store" ? 1
          : archetype === "old_apartment" ? 0
          : archetype === "traditional_market" || archetype === "shop" || archetype === "restaurant" ? 2
          : archetype === "residential_tower" || archetype === "apartment" ? 3
          : Math.floor(deterministicNoise(Math.round(x * 0.7), Math.round(z * 0.9)) * facadeCount)) % facadeCount;
        candidates.push({
          distance,
          rings,
          height,
          style,
          archetype,
          name: String(properties.name ?? ""),
          bounds: {
            x,
            z,
            halfWidth: (right - left) / 2,
            halfDepth: (front - back) / 2,
            outline,
          },
        });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const visible = candidates.slice(0, 1050);
    const stock = planStockBuildings(visible, this.streetSegments, cityElevationAt);
    const stockFallbacks: BuildingCandidate[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    const facadeTrims: THREE.BufferGeometry[] = [];
    const schoolFacades: THREE.BufferGeometry[] = [];
    const facades = this.textures.facades.map(() => [] as THREE.BufferGeometry[]);
    this.buildings.push(...visible.map((candidate) => candidate.bounds));
    for (const building of visible) {
      if (stock.has(building)) { stockFallbacks.push(building); continue; }
      const onCampus = this.schoolCampuses.some((campus) =>
        Math.hypot(building.bounds.x - campus.position.x, building.bounds.z - campus.position.z) < campus.radius * 0.85,
      );
      if (onCampus) {
        schoolFacades.push(facadeWallGeometry(building.rings[0], building.height, 0, building.height, 15, 15, 0, Math.min(4.1, building.height)));
        const roof = flatPolygonGeometry(building.rings, building.height);
        if (roof) roofs.push(roof);
        continue;
      }

      const center = { x: building.bounds.x, z: building.bounds.z };
      const simpleFootprint = building.rings.length === 1;
      const podiumHeight = Math.min(building.height, ["shop", "restaurant", "old_apartment", "traditional_market"].includes(building.archetype) ? 4.1 : 5.4);
      const upperScale = building.archetype === "office" ? 0.91
        : building.archetype === "residential_tower" ? 0.84
        : building.archetype === "apartment" ? 0.94
        : 0.97;
      const upperOutline = simpleFootprint ? scaledOutline(building.rings[0], center, upperScale) : building.rings[0];
      const crownHeight = building.height > 34 ? Math.min(4.2, building.height * 0.09) : 0;
      const crownBase = building.height - crownHeight;
      const crownOutline = crownHeight > 0 && simpleFootprint ? scaledOutline(building.rings[0], center, upperScale * 0.78) : upperOutline;
      // Preserve the square source atlas aspect at a consistent physical floor scale.
      const verticalModule = building.style === 0 ? 18 : 15;
      const bayWidth = verticalModule;

      facades[building.style].push(facadeWallGeometry(building.rings[0], podiumHeight, 0, building.height, bayWidth, verticalModule, building.style, podiumHeight));
      if (building.height > podiumHeight + 0.2) {
        facades[building.style].push(facadeWallGeometry(upperOutline, crownBase, podiumHeight, building.height, bayWidth, verticalModule, building.style, podiumHeight));
      }
      if (crownHeight > 0) facades[building.style].push(facadeWallGeometry(crownOutline, building.height, crownBase, building.height, bayWidth, verticalModule, building.style, podiumHeight));

      // Shallow concrete slab edges create real grazing shadows at floor lines.
      for (const level of facadeBands(podiumHeight, building.height, podiumHeight, building.style).map(band => band.top)) {
        const trimOutline = level > crownBase ? crownOutline : upperOutline;
        for (let edge = 0; edge < trimOutline.length - 1; edge++) {
          const a = trimOutline[edge], b = trimOutline[edge + 1];
          const length = Math.hypot(b.x - a.x, b.z - a.z);
          if (length < .25) continue;
          const trim = new THREE.BoxGeometry(length + .12, .12, .18);
          trim.rotateY(-Math.atan2(b.z - a.z, b.x - a.x));
          trim.translate((a.x + b.x) / 2, level - .06, (a.z + b.z) / 2);
          const vertexCount = trim.getAttribute("position").count;
          trim.setAttribute("terrainAnchorX", new THREE.BufferAttribute(new Float32Array(vertexCount).fill(center.x), 1));
          trim.setAttribute("terrainAnchorZ", new THREE.BufferAttribute(new Float32Array(vertexCount).fill(center.z), 1));
          facadeTrims.push(conformGeometryToTerrain(trim, true));
        }
      }

      if (simpleFootprint && building.height > podiumHeight + 0.2) {
        const podiumTerrace = flatPolygonGeometry([building.rings[0]], podiumHeight);
        if (podiumTerrace) roofs.push(podiumTerrace);
      }
      if (crownHeight > 0 && simpleFootprint) {
        const crownTerrace = flatPolygonGeometry([upperOutline], crownBase);
        if (crownTerrace) roofs.push(crownTerrace);
      }
      const roofRings = simpleFootprint ? [crownOutline] : building.rings;
      const roof = flatPolygonGeometry(roofRings, building.height);
      if (roof) roofs.push(roof);
    }
    const roofGeometry = mergeOrDispose(roofs);
    if (roofGeometry) {
      const material = new THREE.MeshStandardMaterial({ color: "#9b9d98", map: this.textures.roof, roughness: 0.88, side: THREE.DoubleSide });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(roofGeometry, material);
      mesh.name = "Modular Taiwanese stepped roof terraces";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const trimGeometry = mergeOrDispose(facadeTrims);
    if (trimGeometry) {
      const trimMaterial = new THREE.MeshStandardMaterial({ color: "#bdbbb3", roughness: .88, metalness: 0 });
      this.disposableMaterials.push(trimMaterial);
      const trimMesh = new THREE.Mesh(trimGeometry, trimMaterial);
      trimMesh.name = "Recessed facade floors with physical concrete slab edges";
      trimMesh.castShadow = trimMesh.receiveShadow = true;
      this.group.add(trimMesh);
    }
    facades.forEach((geometries, index) => {
      const geometry = mergeOrDispose(geometries);
      if (!geometry) return;
      const material = configureFacadeMaterial(new THREE.MeshStandardMaterial({ map: this.textures.facades[index], color: index % 2 === 0 ? "#f0eee9" : "#e9edef", roughness: index % 2 === 1 ? 0.8 : 0.91, metalness: 0, side: THREE.DoubleSide }));
      this.disposableMaterials.push(material);
      this.facadeMaterials[index] = material;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `Photographic floor-aligned modular Taiwanese street blocks ${index + 1}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    });
    const campusBuildings = mergeOrDispose(schoolFacades);
    if (campusBuildings) {
      const material = new THREE.MeshStandardMaterial({ color: "#e5d6ba", map: this.textures.facades[0], roughness: 0.81, metalness: 0.025, side: THREE.DoubleSide });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(campusBuildings, material);
      mesh.name = "Actual school and university building footprints";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.stockBuildingEntries = stockFallbacks.map(building => {
      const fallback = new THREE.Group(); fallback.name = 'Original office while full stock model loads';
      const wall = facadeWallGeometry(building.rings[0], building.height, 0, building.height, 15, 15, building.style, 5.4);
      const material = this.facadeMaterials[building.style] ?? configureFacadeMaterial(new THREE.MeshStandardMaterial({map:this.textures.facades[building.style],roughness:.85,side:THREE.DoubleSide}));
      if (!this.facadeMaterials[building.style]) {this.facadeMaterials[building.style]=material;this.disposableMaterials.push(material);}
      const facade = new THREE.Mesh(wall,material);facade.castShadow=facade.receiveShadow=true;fallback.add(facade);
      const roof = flatPolygonGeometry(building.rings,building.height);
      if(roof){const roofMaterial=new THREE.MeshStandardMaterial({color:'#9b9d98',map:this.textures.roof,roughness:.88,side:THREE.DoubleSide});this.disposableMaterials.push(roofMaterial);fallback.add(new THREE.Mesh(roof,roofMaterial));}
      this.group.add(fallback);
      return {placement:stock.get(building)!,fallback,collider:building.bounds};
    });
    const originalBuildings = visible.filter(building=>!stock.has(building));
    this.addArchitecturalDetails(originalBuildings);
    this.renderDistinctiveBuildingTypes(originalBuildings);
    this.renderStockBuildingAssets();
  }

  private renderDistinctiveBuildingTypes(buildings: BuildingCandidate[]) {
    const curtainGlass = new THREE.MeshPhysicalMaterial({ color: "#78939b", roughness: 0.13, metalness: 0.31, clearcoat: 0.82, clearcoatRoughness: 0.1, reflectivity: 0.88 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: "#303a3d", roughness: 0.34, metalness: 0.74 });
    const paleStone = new THREE.MeshStandardMaterial({ color: "#c8c2b6", roughness: 0.78, metalness: 0.04 });
    const warmConcrete = new THREE.MeshStandardMaterial({ color: "#ae8c72", roughness: 0.88 });
    const balconyGlass = new THREE.MeshPhysicalMaterial({ color: "#9eb1b3", transparent: true, opacity: 0.62, roughness: 0.2, metalness: 0.16, transmission: 0.16 });
    const marketAwning = new THREE.MeshStandardMaterial({ color: "#6b7771", roughness: 0.73, metalness: 0.12 });
    const warmLight = new THREE.MeshStandardMaterial({ color: "#ffe1a7", emissive: "#dd9e4d", emissiveIntensity: 1.35, roughness: 0.42, toneMapped: false });
    this.disposableMaterials.push(curtainGlass, darkMetal, paleStone, warmConcrete, balconyGlass, marketAwning, warmLight);

    const cast = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    };

    const makeLabel = (text: string, color: string, width: number, height: number) => {
      if (typeof document === "undefined") return null;
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 160;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "rgba(255,255,255,.32)";
      context.lineWidth = 6;
      context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
      context.fillStyle = "#fff7e8";
      context.font = "900 72px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, 256, 84, 460);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.maxAnisotropy;
      this.disposableTextures.push(texture);
      const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      this.disposableMaterials.push(material);
      return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    };

    for (const building of buildings) {
      if (!["department_store", "office", "residential_tower", "traditional_market"].includes(building.archetype)) continue;
      if (!building.name) continue;
      const group = new THREE.Group();
      group.position.set(building.bounds.x, cityElevationAt(building.bounds), building.bounds.z);
      group.userData.terrainAnchor = { x: building.bounds.x, z: building.bounds.z };
      const width = building.bounds.halfWidth * 2;
      const depth = building.bounds.halfDepth * 2;

      if (building.archetype === "department_store") {
        group.name = `Fictional Taiwanese department store · ${building.name || "晴川百貨"}`;
        const podium = cast(new THREE.Mesh(new RoundedBoxGeometry(width + 1.6, 8.4, depth + 1.4, 4, 0.32), paleStone));
        podium.position.y = 4.24;
        const glassBand = cast(new THREE.Mesh(new RoundedBoxGeometry(width + 1.72, 4.35, depth + 1.52, 4, 0.19), curtainGlass));
        glassBand.position.y = 11.1;
        const upper = cast(new THREE.Mesh(new RoundedBoxGeometry(width * 0.86, Math.max(12, building.height - 15), depth * 0.82, 4, 0.28), warmConcrete));
        upper.position.y = 15 + Math.max(12, building.height - 15) / 2;
        const entrance = cast(new THREE.Mesh(new RoundedBoxGeometry(Math.min(18, width * 0.42), 5.5, 0.34, 3, 0.09), curtainGlass));
        entrance.position.set(0, 3.0, -depth / 2 - 0.82);
        const canopy = cast(new THREE.Mesh(new RoundedBoxGeometry(Math.min(23, width * 0.56), 0.38, 4.4, 3, 0.12), darkMetal));
        canopy.position.set(0, 5.8, -depth / 2 - 2.2);
        const rooftop = cast(new THREE.Mesh(new RoundedBoxGeometry(width * 0.64, 1.2, depth * 0.58, 3, 0.16), darkMetal));
        rooftop.position.y = building.height + 0.62;
        group.add(podium, glassBand, upper, entrance, canopy, rooftop);
        for (let fin = -4; fin <= 4; fin++) {
          const verticalFin = cast(new THREE.Mesh(new RoundedBoxGeometry(0.34, Math.max(12, building.height - 17), 0.42, 2, 0.07), darkMetal));
          verticalFin.position.set(fin * width * 0.087, 17 + Math.max(12, building.height - 17) / 2, -depth / 2 - 0.31);
          group.add(verticalFin);
        }
        const label = makeLabel(building.name || "晴川百貨", "#526b67", Math.min(24, width * 0.48), 2.5);
        if (label) {
          label.position.set(0, 9.7, -depth / 2 - 0.9);
          group.add(label);
        }
      } else if (building.archetype === "office") {
        group.name = `Glass curtain-wall office district · ${building.name || "海灣商務中心"}`;
        const lobby = cast(new THREE.Mesh(new RoundedBoxGeometry(width + 1.1, 5.8, depth + 1.1, 3, 0.2), curtainGlass));
        lobby.position.y = 3;
        const crown = cast(new THREE.Mesh(new RoundedBoxGeometry(width + 0.6, 1.1, depth + 0.6, 3, 0.11), darkMetal));
        crown.position.y = building.height + 0.58;
        group.add(lobby, crown);
        const floors = Math.min(18, Math.floor((building.height - 6) / 3.25));
        for (let floor = 0; floor < floors; floor++) {
          const band = cast(new THREE.Mesh(new RoundedBoxGeometry(width + 0.52, 2.62, depth + 0.52, 2, 0.04), curtainGlass));
          band.position.y = 7.2 + floor * 3.25;
          group.add(band);
        }
        for (let fin = -3; fin <= 3; fin++) {
          const mullion = cast(new THREE.Mesh(new THREE.BoxGeometry(0.22, building.height - 5, 0.28), darkMetal));
          mullion.position.set(fin * width / 7, building.height / 2 + 2.5, -depth / 2 - 0.29);
          group.add(mullion);
        }
      } else if (building.archetype === "residential_tower") {
        group.name = `Modern Taiwanese residential tower · ${building.name || "河景之森"}`;
        const podium = cast(new THREE.Mesh(new RoundedBoxGeometry(width + 1.2, 5.6, depth + 1.2, 3, 0.24), paleStone));
        podium.position.y = 2.85;
        const crown = cast(new THREE.Mesh(new RoundedBoxGeometry(width * 0.72, 2.1, depth * 0.72, 3, 0.17), darkMetal));
        crown.position.y = building.height + 1.08;
        group.add(podium, crown);
        const floors = Math.min(16, Math.floor((building.height - 6) / 3.35));
        for (let floor = 0; floor < floors; floor += 2) {
          for (const side of [-1, 1]) {
            const balcony = cast(new THREE.Mesh(new RoundedBoxGeometry(width * 0.32, 0.17, 1.5, 2, 0.05), balconyGlass));
            balcony.position.set(side * width * 0.28, 7.2 + floor * 3.35, -depth / 2 - 0.67);
            group.add(balcony);
          }
        }
      } else {
        group.name = `Traditional Taiwanese market block · ${building.name || "南町市場"}`;
        const frontAwning = cast(new THREE.Mesh(new RoundedBoxGeometry(width + 1.4, 0.32, 4.8, 2, 0.08), marketAwning));
        frontAwning.position.set(0, 4.35, -depth / 2 - 2.25);
        group.add(frontAwning);
        for (let stall = 0; stall < 6; stall++) {
          const stallWidth = width / 6.5;
          const shutter = cast(new THREE.Mesh(new RoundedBoxGeometry(stallWidth * 0.82, 3.1, 0.16, 2, 0.035), stall % 2 ? warmConcrete : paleStone));
          shutter.position.set((stall - 2.5) * width / 6, 1.7, -depth / 2 - 0.12);
          const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), warmLight);
          bulb.position.set(shutter.position.x, 4.08, -depth / 2 - 1.1);
          group.add(shutter, bulb);
        }
        const label = makeLabel(building.name || "南町市場", "#8b5b45", Math.min(13, width * 0.62), 1.85);
        if (label) {
          label.position.set(0, 5.6, -depth / 2 - 0.5);
          group.add(label);
        }
      }
      this.group.add(group);
    }
  }

  private addArchitecturalDetails(buildings: BuildingCandidate[]) {
    const awnings: Array<StreetDetail & { width: number; style: number }> = [];
    const balconies: Array<StreetDetail & { width: number }> = [];
    const windows: StreetDetail[] = [];
    const airConditioners: StreetDetail[] = [];
    const shopSigns: StreetDetail[] = [];
    const projectingSigns: StreetDetail[] = [];
    const arcadeColumns: StreetDetail[] = [];
    const roofTanks: StreetDetail[] = [];
    const storefronts: THREE.BufferGeometry[] = [];

    // Attached details share the building's foundation, including after terrain refreshes.
    const detailGround = (entry: StreetDetail) => cityElevationAt({ x: entry.terrainAnchorX ?? entry.x, z: entry.terrainAnchorZ ?? entry.z });
    for (const building of buildings) {
      if (building.distance > 520 || building.height < 6.2) continue;
      const outline = building.rings[0];
      let best: { a: Coordinates; b: Coordinates; length: number; streetDistance: number } | null = null;

      for (let index = 0; index < outline.length - 1; index++) {
        const a = outline[index];
        const b = outline[index + 1];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        if (length < 4 || length > 42) continue;
        const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        let streetDistance = Infinity;

        for (const street of this.streetSegments) {
          if (midpoint.x < Math.min(street.a.x, street.b.x) - 70 || midpoint.x > Math.max(street.a.x, street.b.x) + 70) continue;
          if (midpoint.z < Math.min(street.a.z, street.b.z) - 70 || midpoint.z > Math.max(street.a.z, street.b.z) + 70) continue;
          const dx = street.b.x - street.a.x;
          const dz = street.b.z - street.a.z;
          const squared = dx * dx + dz * dz;
          if (squared < 0.01) continue;
          const progress = Math.max(0, Math.min(1, ((midpoint.x - street.a.x) * dx + (midpoint.z - street.a.z) * dz) / squared));
          const distance = Math.hypot(midpoint.x - street.a.x - dx * progress, midpoint.z - street.a.z - dz * progress) - street.width / 2;
          streetDistance = Math.min(streetDistance, distance);
        }

        if (streetDistance < 8.5 && (!best || streetDistance < best.streetDistance)) best = { a, b, length, streetDistance };
      }

      if (!best) continue;
      const terrainAnchor = { terrainAnchorX: building.bounds.x, terrainAnchorZ: building.bounds.z };
      const midpointX = (best.a.x + best.b.x) / 2;
      const midpointZ = (best.a.z + best.b.z) / 2;
      const outwardX = midpointX - building.bounds.x;
      const outwardZ = midpointZ - building.bounds.z;
      let nx = -(best.b.z - best.a.z) / best.length;
      let nz = (best.b.x - best.a.x) / best.length;
      if (nx * outwardX + nz * outwardZ < 0) { nx = -nx; nz = -nz; }
      const angle = Math.atan2(nx, nz);
      const frontA = { x: best.a.x + nx * 0.065, z: best.a.z + nz * 0.065 };
      const frontB = { x: best.b.x + nx * 0.065, z: best.b.z + nz * 0.065 };
      const commercialGround = ["shop", "restaurant", "old_apartment", "department_store", "traditional_market"].includes(building.archetype);
      if (commercialGround) {
        const storefront = wallGeometry([frontA, frontB], Math.min(3.12, building.height - 1), 0.17);
        const vertexCount = storefront.getAttribute("position").count;
        storefront.setAttribute("terrainAnchorX", new THREE.BufferAttribute(new Float32Array(vertexCount).fill(building.bounds.x), 1));
        storefront.setAttribute("terrainAnchorZ", new THREE.BufferAttribute(new Float32Array(vertexCount).fill(building.bounds.z), 1));
        storefronts.push(conformGeometryToTerrain(storefront, true));
        awnings.push({ ...terrainAnchor, x: midpointX + nx * 0.32, y: 3.18, z: midpointZ + nz * 0.32, width: best.length * 0.94, angle, style: building.style });
        const signStyle = Math.floor(deterministicNoise(Math.round(midpointX), Math.round(midpointZ)) * 18);
        shopSigns.push({ ...terrainAnchor, x: midpointX + nx * 0.53, z: midpointZ + nz * 0.53, y: 3.74, angle, width: Math.min(7.8, best.length * 0.68), style: signStyle });
        if (best.length > 7) projectingSigns.push({ ...terrainAnchor, x: best.a.x + (best.b.x - best.a.x) * 0.18 + nx * 0.92, z: best.a.z + (best.b.z - best.a.z) * 0.18 + nz * 0.92, y: 5.25, angle: angle + Math.PI / 2, style: signStyle });
        for (const edge of [0.08, 0.92]) {
          arcadeColumns.push({ ...terrainAnchor,
            x: best.a.x + (best.b.x - best.a.x) * edge + nx * 0.74,
            z: best.a.z + (best.b.z - best.a.z) * edge + nz * 0.74,
            y: 1.65,
            angle,
            style: building.style,
          });
        }
      }
      roofTanks.push({ ...terrainAnchor, x: building.bounds.x + Math.min(building.bounds.halfWidth * 0.38, 2.6), z: building.bounds.z, y: building.height + 1.33 / 2, angle, style: building.style });

      if (!["old_apartment", "apartment", "residential_tower", "shop", "restaurant"].includes(building.archetype)) continue;
      const groundFloor = Math.min(building.height, ["shop", "restaurant", "old_apartment", "traditional_market"].includes(building.archetype) ? 4.1 : 5.4);
      const facadeScale = building.rings.length !== 1 ? 1 : building.archetype === "residential_tower" ? .84 : building.archetype === "apartment" ? .94 : .97;
      const upperA = { x: building.bounds.x + (best.a.x - building.bounds.x) * facadeScale, z: building.bounds.z + (best.a.z - building.bounds.z) * facadeScale };
      const upperB = { x: building.bounds.x + (best.b.x - building.bounds.x) * facadeScale, z: building.bounds.z + (best.b.z - building.bounds.z) * facadeScale };
      const upperLength = best.length * facadeScale;
      const floors = Math.min(5, Math.floor((building.height - groundFloor) / 3.3));
      for (let floor = 1; floor <= floors; floor++) {
        const bays = Math.min(3, Math.max(1, Math.floor(upperLength / 4.3)));
        for (let bay = 0; bay < bays; bay++) {
          const progress = (bay + 0.5) / bays;
          const window = {
            ...terrainAnchor,
            x: upperA.x + (upperB.x - upperA.x) * progress + nx * 0.06,
            z: upperA.z + (upperB.z - upperA.z) * progress + nz * 0.06,
            y: groundFloor + (floor - 0.47) * 3.3,
            width: Math.min(2.65, upperLength / bays - 0.86),
            angle,
            style: building.style,
          };
          // The photographic windows now have their own recessed glazing.
          if(building.style!==1&&building.style!==3)windows.push(window);
          if ((floor + bay + building.style) % 3 === 0) {
            airConditioners.push({ ...terrainAnchor,
              x: window.x + nx * 0.095,
              z: window.z + nz * 0.095,
              y: window.y - 0.47,
              angle,
              style: building.style,
            });
          }
          if (building.archetype !== "shop" && building.archetype !== "restaurant") {
            balconies.push({ ...terrainAnchor,
              x: upperA.x + (upperB.x - upperA.x) * progress + nx * 0.2,
              y: groundFloor + (floor - 1) * 3.3,
              z: upperA.z + (upperB.z - upperA.z) * progress + nz * 0.2,
              width: Math.min(3.3, upperLength / bays - 0.35),
              angle,
            });
          }
        }
      }
    }

    const frontageGeometry = mergeOrDispose(storefronts);
    if (frontageGeometry) {
      const material = new THREE.MeshStandardMaterial({ color: "#485c62", roughness: 0.19, metalness: 0.22, envMapIntensity: 1.05, side: THREE.DoubleSide });
      this.disposableMaterials.push(material);
      const mesh = new THREE.Mesh(frontageGeometry, material);
      mesh.name = "Reflective real-street storefront glazing";
      this.group.add(mesh);
    }

    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    if (awnings.length > 0) {
      const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.78, metalness: 0.09 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, awnings.length);
      mesh.name = "Physical Taiwanese arcade awnings";
      const colors = ["#516560", "#8e6258", "#777870", "#465764"];
      awnings.forEach((awning, index) => {
        position.set(awning.x, awning.y + detailGround(awning), awning.z);
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), awning.angle);
        scale.set(awning.width, 0.18, 0.85);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, new THREE.Color(colors[awning.style % colors.length]));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.terrainInstances = awnings;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    if (balconies.length > 0) {
      const material = new THREE.MeshStandardMaterial({ color: "#888881", roughness: 0.73, metalness: 0.13 });
      this.disposableMaterials.push(material);
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, balconies.length);
      mesh.name = "Three-dimensional residential balcony slabs";
      balconies.forEach((balcony, index) => {
        position.set(balcony.x, balcony.y + detailGround(balcony), balcony.z);
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), balcony.angle);
        scale.set(balcony.width, 0.1, 0.52);
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.terrainInstances = balconies;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    const up = new THREE.Vector3(0, 1, 0);
    const addDetailInstances = (
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      entries: StreetDetail[],
      dimensions: (entry: StreetDetail, index: number) => THREE.Vector3,
      palette?: string[],
    ) => {
      if (entries.length === 0) {
        geometry.dispose();
        material.dispose();
        return;
      }
      this.disposableMaterials.push(material);
      const mesh = new THREE.InstancedMesh(geometry, material, entries.length);
      mesh.name = name;
      entries.forEach((entry, index) => {
        position.set(entry.x, detailGround(entry) + entry.y, entry.z);
        rotation.setFromAxisAngle(up, entry.angle);
        scale.copy(dimensions(entry, index));
        matrix.compose(position, rotation, scale);
        mesh.setMatrixAt(index, matrix);
        if (palette) mesh.setColorAt(index, new THREE.Color(palette[(entry.style ?? index) % palette.length]));
      });
      mesh.userData.terrainInstances = entries;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };

    addDetailInstances(
      "Inset reflective apartment windows",
      new RoundedBoxGeometry(1, 1, 1, 2, 0.035),
      new THREE.MeshPhysicalMaterial({ color: "#66818b", roughness: 0.18, metalness: 0.28, clearcoat: 0.67, clearcoatRoughness: 0.16 }),
      windows,
      (window) => new THREE.Vector3(window.width ?? 2.1, 1.72, 0.085),
    );
    addDetailInstances(
      "Detailed wall-mounted air-conditioning units",
      new RoundedBoxGeometry(1, 1, 1, 2, 0.055),
      new THREE.MeshStandardMaterial({ color: "#dedbd0", roughness: 0.78, metalness: 0.15 }),
      airConditioners,
      () => new THREE.Vector3(0.73, 0.42, 0.35),
    );
    addDetailInstances(
      "Taiwanese covered-sidewalk arcade columns",
      new RoundedBoxGeometry(1, 1, 1, 2, 0.035),
      new THREE.MeshStandardMaterial({ color: "#c7c1b7", roughness: 0.84 }),
      arcadeColumns,
      () => new THREE.Vector3(0.29, 3.18, 0.3),
    );
    addDetailInstances(
      "Taiwanese rooftop water-storage tanks",
      new THREE.CylinderGeometry(0.49, 0.49, 1, 12),
      new THREE.MeshStandardMaterial({ color: "#b2b7b2", roughness: 0.38, metalness: 0.73 }),
      roofTanks,
      () => new THREE.Vector3(1, 1.33, 1),
    );

    const signColors = ["#587465", "#95665c", "#4d6577", "#95774f"];
    addDetailInstances(
      "Illuminated Taiwanese storefront signs",
      new RoundedBoxGeometry(1, 1, 1, 2, 0.035),
      new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#312b22", emissiveIntensity: 0.33, roughness: 0.55 }),
      shopSigns,
      (sign) => new THREE.Vector3(sign.width ?? 5, Math.min(1.35, (sign.width ?? 5) / 3.9), 0.16),
      signColors,
    );
    addDetailInstances(
      "Projecting vertical Taiwanese shop signboards",
      new RoundedBoxGeometry(1, 1, 1, 2, 0.045),
      new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#382a22", emissiveIntensity: 0.46, roughness: 0.48 }),
      projectingSigns,
      () => new THREE.Vector3(0.92, 2.45, 0.18),
      signColors,
    );

    if (typeof document !== "undefined") {
      const labels = ["日日早餐", "晴川茶坊", "港角小吃", "康安藥局", "海灣診所", "南町市場", "東城書局", "安居五金", "河景咖啡", "生活麵館", "北城眼鏡", "山景花店", "中央電器", "新興車行", "西城百貨", "學府文具"];
      const verticalLabels = ["早餐", "茶坊", "小吃", "藥局", "診所", "市場", "書局", "五金", "咖啡", "麵館", "眼鏡", "花店", "電器", "車行", "百貨", "文具"];
      const limit = Math.min(42, shopSigns.length);
      const materials: THREE.MeshBasicMaterial[] = [];
      const verticalMaterials: THREE.MeshBasicMaterial[] = [];
      for (let index = 0; index < labels.length; index++) {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 96;
        const context = canvas.getContext("2d");
        if (!context) continue;
        context.fillStyle = signColors[index % signColors.length];
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#f7f3e8";
        context.font = "700 58px sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(labels[index], canvas.width / 2, canvas.height / 2 + 1, 450);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.disposableTextures.push(texture);
        const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
        this.disposableMaterials.push(material);
        materials.push(material);

        const verticalCanvas = document.createElement("canvas");
        verticalCanvas.width = 192;
        verticalCanvas.height = 576;
        const verticalContext = verticalCanvas.getContext("2d");
        if (verticalContext) {
          verticalContext.fillStyle = signColors[index % signColors.length];
          verticalContext.fillRect(0, 0, verticalCanvas.width, verticalCanvas.height);
          verticalContext.strokeStyle = "#d7c79d";
          verticalContext.lineWidth = 7;
          verticalContext.strokeRect(11, 11, 170, 554);
          verticalContext.fillStyle = "#f7f3e8";
          verticalContext.font = "700 108px sans-serif";
          verticalContext.textAlign = "center";
          verticalContext.textBaseline = "middle";
          [...verticalLabels[index]].forEach((character, row) => verticalContext.fillText(character, 96, 185 + row * 215, 150));
          const verticalTexture = new THREE.CanvasTexture(verticalCanvas);
          verticalTexture.colorSpace = THREE.SRGBColorSpace;
          this.disposableTextures.push(verticalTexture);
          const verticalMaterial = new THREE.MeshBasicMaterial({ map: verticalTexture, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
          this.disposableMaterials.push(verticalMaterial);
          verticalMaterials.push(verticalMaterial);
        }
      }
      if (materials.length > 0) {
        if (typeof Image !== "undefined") {
          new THREE.TextureLoader().load("/textures/taiwan-storefront-signboards-atlas.webp", (atlas) => {
            atlas.colorSpace = THREE.SRGBColorSpace;
            atlas.anisotropy = this.maxAnisotropy;
            this.disposableTextures.push(atlas);
            materials.forEach((material, index) => {
              const tile = atlas.clone();
              tile.repeat.set(0.25, 0.25);
              tile.offset.set((index % 4) * 0.25, 0.75 - Math.floor(index / 4) * 0.25);
              tile.needsUpdate = true;
              this.disposableTextures.push(tile);
              material.map = tile;
              material.needsUpdate = true;
            });
          });
          new THREE.TextureLoader().load("/textures/taiwan-authentic-vertical-signs-atlas.webp", (atlas) => {
            atlas.colorSpace = THREE.SRGBColorSpace;
            atlas.anisotropy = this.maxAnisotropy;
            this.disposableTextures.push(atlas);
            verticalMaterials.forEach((material, index) => {
              const tile = atlas.clone();
              tile.repeat.set(0.25, 0.25);
              tile.offset.set((index % 4) * 0.25, 0.75 - Math.floor(index / 4) * 0.25);
              tile.needsUpdate = true;
              this.disposableTextures.push(tile);
              material.map = tile;
              material.needsUpdate = true;
            });
          });
        }
        const labeled = new THREE.Group();
        labeled.name = "Readable fictional Taiwanese business signs";
        for (let index = 0; index < limit; index++) {
          const sign = shopSigns[index];
          const faceWidth = Math.min(7.1, (sign.width ?? 5) * 0.96);
          const face = new THREE.Mesh(new THREE.PlaneGeometry(faceWidth, Math.min(1.35, faceWidth / 3.9)), materials[index % materials.length]);
          face.position.set(sign.x + Math.sin(sign.angle) * 0.095, detailGround(sign) + sign.y, sign.z + Math.cos(sign.angle) * 0.095);
          face.rotation.y = sign.angle;
          face.userData.terrainAnchor = { x: sign.terrainAnchorX ?? sign.x, z: sign.terrainAnchorZ ?? sign.z };
          face.userData.terrainOffset = sign.y;
          labeled.add(face);
        }
        const projecting = new THREE.Group();
        projecting.name = "Readable projecting Chinese shop signboards";
        for (let index = 0; index < Math.min(36, projectingSigns.length); index++) {
          const sign = projectingSigns[index];
          const face = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 2.28), verticalMaterials[(sign.style ?? index) % verticalMaterials.length]);
          face.position.set(sign.x + Math.sin(sign.angle) * 0.105, detailGround(sign) + sign.y, sign.z + Math.cos(sign.angle) * 0.105);
          face.rotation.y = sign.angle;
          face.userData.terrainAnchor = { x: sign.terrainAnchorX ?? sign.x, z: sign.terrainAnchorZ ?? sign.z };
          face.userData.terrainOffset = sign.y;
          projecting.add(face);
        }
        this.group.add(projecting);
        this.group.add(labeled);
      }
    }
  }

  dispose() {
    this.stopped = true;
    this.neighborhoodLife?.dispose();this.neighborhoodLife=undefined;this.trafficVehicles.forEach(v=>v.commuter?.dispose());
    this.streetPropPhysics?.dispose();this.streetPropPhysics=undefined;
    this.staticRenderBatches?.clear();
    this.trafficRenderBatches?.dispose();
    this.stockBuildingTemplates?.forEach(model=>model.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.isMesh)mesh.geometry.dispose();}));
    this.stockBuildingTemplates?.clear();
    for(const template of this.streetPropTemplates?.values()??[])template.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.isMesh)mesh.geometry.dispose();});
    this.streetPropTemplates?.clear();
    this.trafficVehicles.forEach((vehicle) => vehicle.animalMixer?.stopAllAction());
    this.scene.remove(this.group);
    this.group.traverse((object) => {
      if(object.userData.cityMultidraw){disposeCityBatch(object as THREE.BatchedMesh);return;}
      if ((object as THREE.Mesh).isMesh && !object.userData.sharedStreetPropAsset && !object.userData.sharedStockBuildingAsset) (object as THREE.Mesh).geometry.dispose();
      if ((object as THREE.InstancedMesh).isInstancedMesh && (object.userData.sharedStreetPropAsset || object.userData.sharedStockBuildingAsset)) (object as THREE.InstancedMesh).dispose();
    });
    this.disposableMaterials.forEach((material) => material.dispose());
    const trafficMaterials = new Set<THREE.Material>();
    const trafficTextures = new Set<THREE.Texture>();
    for (const template of this.trafficModelTemplates.values()) template.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        trafficMaterials.add(material);
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.map) trafficTextures.add(standard.map);
      }
    });
    trafficTextures.forEach((texture) => texture.dispose());
    trafficMaterials.forEach((material) => material.dispose());
    this.textures.ground.dispose();
    this.textures.asphalt.dispose();
    this.textures.asphaltNormal.dispose();
    this.textures.asphaltRoughness.dispose();
    this.textures.paving.dispose();
    this.textures.pavingNormal.dispose();
    this.textures.pavingRoughness.dispose();
    this.textures.roof.dispose();
    this.textures.waterNormal.dispose();
    this.textures.facades.forEach((texture) => texture.dispose());
    this.disposableTextures.forEach((texture) => texture.dispose());
  }
}
