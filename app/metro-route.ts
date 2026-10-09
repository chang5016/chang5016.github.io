import type { Coordinates } from './game-core';

/**
 * Centre line of the 海灣高架線 viaduct. The original north line runs east along
 * z = -842.5; past 東河門戶 it turns south along the open strip at the city's east
 * edge and returns west along the z = -570 corridor into the city.
 * Tracks sit 5.5 m either side of the centre line: track 0 on the right of the
 * direction of increasing s (south on the north leg, north on the city leg),
 * track 1 on the left. The right-hand U-turn keeps every train's door side.
 */
export type RouteSegment =
  | { kind: 'line'; start: Coordinates; end: Coordinates; length: number; from: number }
  | { kind: 'arc'; centre: Coordinates; radius: number; startAngle: number; sweep: number; length: number; from: number };

export type RoutePose = Coordinates & { dirX: number; dirZ: number; curvature: number };

export const METRO_TRACK_OFFSET = 5.5;
export const METRO_LINE_Z = -842.5;
export const METRO_CITY_LINE_Z = -570;
const NORTH_START = -734; // 南港生活區 west terminal run-off (unchanged)
const EAST_X = 1220;      // the leg running south along the open eastern strip
// The northern curve is tighter so its inner deck edge stays 6.8 m clear of the end of
// the x = 1160 street (z = -820); the southern curve keeps a 100 m radius.
const NORTH_RADIUS = 80;
const SOUTH_RADIUS = 100;
const TURN_X = EAST_X - NORTH_RADIUS; // the north leg continues past 東河門戶 to here
export const METRO_CITY_END = -271; // west terminal run-off of the city leg

function buildRoute() {
  const segments: RouteSegment[] = [];
  let from = 0;
  const line = (start: Coordinates, end: Coordinates) => {
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    segments.push({ kind: 'line', start, end, length, from }); from += length;
  };
  // Angles measured from +x toward +z (south); sweep > 0 turns right when heading east.
  const arc = (centre: Coordinates, radius: number, startAngle: number, sweep: number) => {
    const length = Math.abs(sweep) * radius;
    segments.push({ kind: 'arc', centre, radius, startAngle, sweep, length, from }); from += length;
  };
  line({ x: NORTH_START, z: METRO_LINE_Z }, { x: TURN_X, z: METRO_LINE_Z });
  arc({ x: TURN_X, z: METRO_LINE_Z + NORTH_RADIUS }, NORTH_RADIUS, -Math.PI / 2, Math.PI / 2);
  line({ x: EAST_X, z: METRO_LINE_Z + NORTH_RADIUS }, { x: EAST_X, z: METRO_CITY_LINE_Z - SOUTH_RADIUS });
  arc({ x: EAST_X - SOUTH_RADIUS, z: METRO_CITY_LINE_Z - SOUTH_RADIUS }, SOUTH_RADIUS, 0, Math.PI / 2);
  line({ x: EAST_X - SOUTH_RADIUS, z: METRO_CITY_LINE_Z }, { x: METRO_CITY_END, z: METRO_CITY_LINE_Z });
  return { segments, length: from };
}

export const METRO_ROUTE = buildRoute();

/** Centre-line position, unit direction of increasing s and signed curvature at s. */
export function routePose(s: number): RoutePose {
  const { segments, length } = METRO_ROUTE;
  const at = Math.min(length, Math.max(0, s));
  let segment = segments[segments.length - 1];
  for (const candidate of segments) if (at <= candidate.from + candidate.length) { segment = candidate; break; }
  const local = at - segment.from;
  if (segment.kind === 'line') {
    const dirX = (segment.end.x - segment.start.x) / segment.length, dirZ = (segment.end.z - segment.start.z) / segment.length;
    return { x: segment.start.x + dirX * local, z: segment.start.z + dirZ * local, dirX, dirZ, curvature: 0 };
  }
  const sign = Math.sign(segment.sweep), angle = segment.startAngle + sign * local / segment.radius;
  return {
    x: segment.centre.x + Math.cos(angle) * segment.radius, z: segment.centre.z + Math.sin(angle) * segment.radius,
    dirX: -Math.sin(angle) * sign, dirZ: Math.cos(angle) * sign, curvature: sign / segment.radius,
  };
}

/** Lateral offset of a track from the centre line: + is the right of increasing s. */
export const trackOffset = (track: number) => track === 0 ? METRO_TRACK_OFFSET : -METRO_TRACK_OFFSET;

export function trackPoint(s: number, track: number): Coordinates {
  const pose = routePose(s), offset = trackOffset(track);
  // Right of travel direction (dirX, dirZ) in the x/z plane is (-dirZ, dirX).
  return { x: pose.x - pose.dirZ * offset, z: pose.z + pose.dirX * offset };
}

/** three.js yaw that turns a model's +x axis onto a world direction. */
export const yawOf = (dirX: number, dirZ: number) => Math.atan2(-dirZ, dirX);

/** Arc length of the centre-line point nearest to a world point on a straight leg. */
export function routeS(point: Coordinates) {
  let best = 0, distance = Infinity;
  for (const segment of METRO_ROUTE.segments) {
    if (segment.kind !== 'line') continue;
    const dx = segment.end.x - segment.start.x, dz = segment.end.z - segment.start.z;
    const t = Math.max(0, Math.min(1, ((point.x - segment.start.x) * dx + (point.z - segment.start.z) * dz) / (segment.length * segment.length)));
    const d = Math.hypot(point.x - segment.start.x - dx * t, point.z - segment.start.z - dz * t);
    if (d < distance) { distance = d; best = segment.from + t * segment.length; }
  }
  return best;
}

/** True when the centre line between two arc lengths is free of curvature. */
export function routeStraight(from: number, to: number) {
  const low = Math.min(from, to), high = Math.max(from, to);
  return METRO_ROUTE.segments.every(segment => segment.kind === 'line' || segment.from >= high || segment.from + segment.length <= low);
}

/** Distance from a point to the centre line between two arc lengths. */
export function routeDistance(point: Coordinates, from = 0, to = METRO_ROUTE.length) {
  let best = Infinity;
  for (const segment of METRO_ROUTE.segments) {
    const a = Math.max(from, segment.from), b = Math.min(to, segment.from + segment.length);
    if (a >= b) continue;
    const p = routePose(a), q = routePose(b);
    if (segment.kind === 'line') {
      const dx = q.x - p.x, dz = q.z - p.z, square = dx * dx + dz * dz;
      const t = square ? Math.max(0, Math.min(1, ((point.x - p.x) * dx + (point.z - p.z) * dz) / square)) : 0;
      best = Math.min(best, Math.hypot(point.x - p.x - dx * t, point.z - p.z - dz * t));
      continue;
    }
    const sign = Math.sign(segment.sweep), start = segment.startAngle + sign * (a - segment.from) / segment.radius, span = (b - a) / segment.radius;
    const turn = ((sign * (Math.atan2(point.z - segment.centre.z, point.x - segment.centre.x) - start)) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    best = Math.min(best, turn <= span
      ? Math.abs(Math.hypot(point.x - segment.centre.x, point.z - segment.centre.z) - segment.radius)
      : Math.min(Math.hypot(point.x - p.x, point.z - p.z), Math.hypot(point.x - q.x, point.z - q.z)));
  }
  return best;
}

/** Sample the centre line (for rendering, piers and the map). */
export function sampleRoute(from: number, to: number, step: number) {
  const points: (RoutePose & { s: number })[] = [];
  const count = Math.max(1, Math.ceil(Math.abs(to - from) / step));
  for (let i = 0; i <= count; i++) { const s = from + (to - from) * i / count; points.push({ ...routePose(s), s }); }
  return points;
}
