import type { Coordinates } from "./game-core";

/** Exact-coordinate construction cache; never quantizes the road or terrain. */
export class TerrainBuildCache {
  private rows = new Map<number, Map<number, number>>();
  private size = 0;
  hits = 0;
  misses = 0;
  sample(point: Coordinates, evaluate: (point: Coordinates) => number) {
    let row = this.rows.get(point.x);
    const previous = row?.get(point.z);
    if (previous !== undefined) { this.hits++; return previous; }
    this.misses++;
    const height = evaluate(point);
    if (this.size < 300000) {
      if (!row) { row = new Map(); this.rows.set(point.x, row); }
      row.set(point.z, height); this.size++;
    }
    return height;
  }
  clear() { this.rows.clear(); this.size = 0; }
}
