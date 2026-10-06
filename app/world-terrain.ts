import type { Coordinates } from "./game-core";
import {MOUNTAIN_ROAD_POINTS,MOUNTAIN_VALLEY_POINTS} from './mountain-route';
export {MOUNTAIN_ROAD_POINTS,MOUNTAIN_VALLEY_POINTS} from './mountain-route';

export type TrafficLightColor = "green" | "amber" | "red";

export const TERRAIN_TILE_ZOOM = 12;
export const TRAFFIC_CYCLE_SECONDS = 48;

function smoothstep(minimum: number, maximum: number, value: number) {
  const progress = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return progress * progress * (3 - 2 * progress);
}

function gaussianHill(point: Coordinates, centerX: number, centerZ: number, width: number, depth: number, height: number) {
  const x = (point.x - centerX) / width;
  const z = (point.z - centerZ) / depth;
  return Math.exp(-(x * x + z * z)) * height;
}


function naturalTerrain(point: Coordinates) {
  const cityGrade = point.x * 0.0042 - point.z * 0.0034;
  const streetUndulation = Math.sin(point.x * 0.0062 + point.z * 0.0039) * 0.46
    + Math.sin(point.x * 0.0028 - point.z * 0.0061) * 0.31;
  const neighborhoodRamps = gaussianHill(point, 160, -135, 190, 145, 2.15)
    + gaussianHill(point, -420, 355, 245, 185, 2.72)
    + gaussianHill(point, 820, 510, 310, 240, 3.35)
    - gaussianHill(point, -90, 245, 145, 170, 0.92)
    - gaussianHill(point, 520, -520, 260, 205, 1.45);
  const easternMountain = gaussianHill(point, 1820, 600, 350, 360, 58);
  const distance = Math.hypot(point.x, point.z);
  const foothills = smoothstep(980, 2300, distance)
    * (38 + Math.sin(point.x * 0.0048) * 11 + Math.cos(point.z * 0.0043) * 8)
    * (0.72 + smoothstep(-950, 1550, point.x) * 0.53);
  return cityGrade + streetUndulation + neighborhoodRamps + easternMountain + foothills;
}

function prepareMountainRoad(points:Coordinates[]) {
  const cells=new Map<string,Array<{a:Coordinates;dx:number;dz:number;squared:number;length:number;travel:number}>>();
  let totalLength=0;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,squared=dx*dx+dz*dz,length=Math.sqrt(squared);
    if(length<1e-6)continue;
    const segment={a,dx,dz,squared,length,travel:totalLength};totalLength+=length;
    for(let x=Math.floor((Math.min(a.x,b.x)-34)/64);x<=Math.floor((Math.max(a.x,b.x)+34)/64);x++)
      for(let z=Math.floor((Math.min(a.z,b.z)-34)/64);z<=Math.floor((Math.max(a.z,b.z)+34)/64);z++){
        const key=`${x}:${z}`,entries=cells.get(key)??[];entries.push(segment);cells.set(key,entries);
      }
  }
  return {cells,totalLength};
}
const primaryRoad=prepareMountainRoad(MOUNTAIN_ROAD_POINTS),valleyRoad=prepareMountainRoad(MOUNTAIN_VALLEY_POINTS);
function mountainRoadSample(point: Coordinates,road:ReturnType<typeof prepareMountainRoad>) {
  let closestDistance = Infinity;
  let closestTravel = 0;
  for (const {a,dx,dz,squared,length,travel} of road.cells.get(`${Math.floor(point.x/64)}:${Math.floor(point.z/64)}`)??[]) {
    const progress = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / squared));
    const distance = Math.hypot(point.x - a.x - dx * progress, point.z - a.z - dz * progress);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestTravel = travel + length * progress;
    }
  }
  return { distance: closestDistance, travelled: closestTravel, totalLength:road.totalLength };
}

function shapedTerrain(point: Coordinates) {
  const natural = naturalTerrain(point);
  if (point.x < 1100) return natural;
  const primary=mountainRoadSample(point,primaryRoad),valley=mountainRoadSample(point,valleyRoad);
  const road=primary.distance<valley.distance?primary:valley;
  if(road.distance>=34)return natural;
  const t=road.travelled/road.totalLength,blend=t*t*(3-2*t),datum=naturalTerrain({x:0,z:0});
  const start=road===primary?naturalTerrain(MOUNTAIN_ROAD_POINTS[0]):51.92128093605147+datum;
  const end=road===primary?55.0552371058851+datum:92+datum;
  // Gentle vertical curves at both ends; the main road meets the tunnel at its exact datum.
  const roadElevation=start+(end-start)*blend;
  const influence=1-smoothstep(9,34,road.distance);
  return natural*(1-influence)+roadElevation*influence;
}

const DISTRICT_BASELINE = shapedTerrain({ x: 0, z: 0 });

export function fallbackTerrainElevation(point: Coordinates) {
  return shapedTerrain(point) - DISTRICT_BASELINE;
}

/** The highway's surveyed profile stays independent of mountain-road earthworks. */
export function naturalTerrainElevation(point:Coordinates) {
  return naturalTerrain(point)-DISTRICT_BASELINE;
}

export function decodeTerrariumElevation(red: number, green: number, blue: number) {
  return red * 256 + green + blue / 256 - 32768;
}

export function terrainGradeAt(position: Coordinates, heading: number, sample: (point: Coordinates) => number = fallbackTerrainElevation) {
  const distance = 2.6;
  const forward = { x: Math.sin(heading), z: -Math.cos(heading) };
  const ahead = { x: position.x + forward.x * distance, z: position.z + forward.z * distance };
  const behind = { x: position.x - forward.x * distance, z: position.z - forward.z * distance };
  return (sample(ahead) - sample(behind)) / (distance * 2);
}

export function trafficLightColor(seconds: number, approach: "main" | "cross", offset = 0): TrafficLightColor {
  const cycle = ((seconds + offset) % TRAFFIC_CYCLE_SECONDS + TRAFFIC_CYCLE_SECONDS) % TRAFFIC_CYCLE_SECONDS;
  if (approach === "main") {
    if (cycle < 19) return "green";
    if (cycle < 22) return "amber";
    return "red";
  }
  if (cycle >= 24 && cycle < 43) return "green";
  if (cycle >= 43 && cycle < 46) return "amber";
  return "red";
}
