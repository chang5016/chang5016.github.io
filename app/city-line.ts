import type { BuildingBounds, Coordinates } from "./game-core";

/**
 * 海灣綠線: an elevated downtown line beside the central boulevard (x = 120).
 * The x = 88 corridor crosses no building or elevated-road footprint; every station
 * parcel (22 m x 64 m ground footprint) lies on open land with no road surface, and
 * piers are placed only where the city's own transport-support check allows them.
 */
export const CITY_LINE = {
  x: 88,
  /** Track centre offset from the corridor centre line (two tracks). */
  track: 2.3,
  /** Absolute rail-top height. Clears the z = -300 expressway deck (5.8 m) with room for traffic. */
  railY: 15.4,
  /** Viaduct box girder depth below the rails. */
  girderDepth: 2.1,
  north: -716,
  south: 472,
  pierRadius: 1.25,
  pierSpacing: 30,
} as const;

export const CITY_LINE_STATION_HALF = { x: 11, z: 32 } as const;

export const CITY_LINE_STATIONS = [
  { id: "G1", name: "晴川轉乘站", english: "Qingchuan Interchange", z: -653 },
  { id: "G2", name: "中央綠園道站", english: "Central Greenway", z: 34 },
  { id: "G3", name: "文化館站", english: "Culture Hall", z: 411 },
] as const;

/** Station column grid (local x, z from the station centre). All sit inside the open parcel. */
export const CITY_LINE_STATION_COLUMNS: readonly Coordinates[] = [-23, -8, 8, 23].flatMap(z => [-6.4, 6.4].map(x => ({ x, z })));

export type CityLinePlan = {
  piers: Coordinates[];
  stations: typeof CITY_LINE_STATIONS;
};

export function cityLineStationRect(index: number, margin = 0) {
  const station = CITY_LINE_STATIONS[index];
  return {
    x: CITY_LINE.x, z: station.z,
    halfWidth: CITY_LINE_STATION_HALF.x + margin, halfDepth: CITY_LINE_STATION_HALF.z + margin,
  };
}

export function insideCityLineStation(point: Coordinates, margin = 0) {
  return CITY_LINE_STATIONS.some((_, index) => {
    const rect = cityLineStationRect(index, margin);
    return Math.abs(point.x - rect.x) <= rect.halfWidth && Math.abs(point.z - rect.z) <= rect.halfDepth;
  });
}

/** Viaduct piers between stations: aim for even spans, slide each pier to the nearest clear spot. */
export function planCityLinePiers(clears: (point: Coordinates, radius: number) => boolean): Coordinates[] {
  const piers: Coordinates[] = [];
  const stops = [CITY_LINE.north, ...CITY_LINE_STATIONS.flatMap(station => [station.z - CITY_LINE_STATION_HALF.z, station.z + CITY_LINE_STATION_HALF.z]), CITY_LINE.south];
  // Runs: north end -> G1 start, G1 end -> G2 start, ..., G3 end -> south end.
  for (let run = 0; run < stops.length; run += 2) {
    const from = stops[run], to = stops[run + 1];
    const length = to - from;
    const spans = Math.max(1, Math.round(length / CITY_LINE.pierSpacing));
    for (let index = run === 0 ? 0 : 1; index < (run === stops.length - 2 ? spans + 1 : spans); index++) {
      const target = from + length * index / spans;
      for (let offset = 0; offset <= 14; offset += 0.5) {
        const found = [target + offset, target - offset].find(z => z >= from - 0.01 && z <= to + 0.01 && clears({ x: CITY_LINE.x, z }, CITY_LINE.pierRadius));
        if (found !== undefined) { piers.push({ x: CITY_LINE.x, z: found }); break; }
      }
    }
  }
  return piers.sort((a, b) => a.z - b.z);
}

/** Solid footprints for the scooter: viaduct piers and station columns. */
export function cityLineObstacles(piers: readonly Coordinates[]): BuildingBounds[] {
  const pier = piers.map(p => ({ x: p.x, z: p.z, halfWidth: CITY_LINE.pierRadius, halfDepth: CITY_LINE.pierRadius }));
  const columns = CITY_LINE_STATIONS.flatMap(station => CITY_LINE_STATION_COLUMNS.map(c => ({ x: CITY_LINE.x + c.x, z: station.z + c.z, halfWidth: 0.75, halfDepth: 0.75 })));
  // Street-level entrance pavilions with the lift and stairs, at the north end of each parcel.
  const entrances = CITY_LINE_STATIONS.map(station => ({ x: CITY_LINE.x, z: station.z - 27.5, halfWidth: 4.2, halfDepth: 3.2 }));
  return [...pier, ...columns, ...entrances];
}

/** True when an object at this point would clash with the line: under a station, at a pier, or tall under the viaduct. */
export function cityLineClearanceConflict(point: Coordinates & { top?: number }, piers: readonly Coordinates[]) {
  if (insideCityLineStation(point, 1)) return true;
  if (piers.some(p => Math.hypot(p.x - point.x, p.z - point.z) < CITY_LINE.pierRadius + 2.2)) return true;
  const underViaduct = Math.abs(point.x - CITY_LINE.x) <= 6.5 && point.z >= CITY_LINE.north - 4 && point.z <= CITY_LINE.south + 4;
  return underViaduct && (point.top ?? 0) > CITY_LINE.railY - CITY_LINE.girderDepth - 1.2;
}

// ---- Train operation (pure, deterministic from simulation time) ----

export const CITY_LINE_TRAIN = { cars: 2, carLength: 17.2, gap: 0.8, maxSpeed: 17, dwell: 20, turnback: 28 } as const;

const stops = CITY_LINE_STATIONS.map(station => station.z);
const ease = (t: number) => t * t * t * (10 + t * (-15 + t * 6));

function legDuration(distance: number) {
  return Math.max(10, distance / CITY_LINE_TRAIN.maxSpeed * 1.6);
}

/** One full round trip G1 -> G3 -> G1 as a list of timed segments. */
const cycle = (() => {
  const segments: Array<{ from: number; to: number; start: number; duration: number; station: number | null }> = [];
  let time = 0;
  const order = [0, 1, 2, 1, 0];
  for (let i = 0; i < order.length - 1; i++) {
    const here = order[i];
    const dwell = i === 0 || order[i] === 2 ? CITY_LINE_TRAIN.turnback : CITY_LINE_TRAIN.dwell;
    segments.push({ from: stops[here], to: stops[here], start: time, duration: dwell, station: here });
    time += dwell;
    const next = order[i + 1], duration = legDuration(Math.abs(stops[next] - stops[here]));
    segments.push({ from: stops[here], to: stops[next], start: time, duration, station: null });
    time += duration;
  }
  return { segments, period: time };
})();

export const CITY_LINE_PERIOD = cycle.period;

/** Position of a train along the corridor (z) and its heading (+1 southbound, -1 northbound). */
export function cityLineTrainState(seconds: number, phase: number) {
  const t = ((seconds + phase * cycle.period) % cycle.period + cycle.period) % cycle.period;
  const segment = cycle.segments.find(s => t >= s.start && t < s.start + s.duration) ?? cycle.segments[0];
  const progress = (t - segment.start) / segment.duration;
  const z = segment.from + (segment.to - segment.from) * ease(Math.min(1, Math.max(0, progress)));
  const direction = segment.to !== segment.from ? Math.sign(segment.to - segment.from) : (segment.station === 2 ? -1 : segment.station === 0 ? 1 : Math.sign(cycle.segments[cycle.segments.indexOf(segment) + 1]?.to - segment.from) || 1);
  return { z, direction, dwelling: segment.station, doorsOpen: segment.station !== null && progress > 0.08 && progress < 0.85 };
}
