export type GridPoint = { x: number; z: number };

export type GridBounds = {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
};

/**
 * A browser-native rectangular sparse grid for the city simulation.
 *
 * Its explicit world ownership, deterministic cell addressing and bounded
 * spatial queries follow the architecture documented by GridForge for Unity.
 * The Unity runtime itself cannot run in a Three.js site, so this small,
 * typed adapter keeps those useful guarantees at the web boundary.
 */
export class GridForgeCityGrid<T> {
  private readonly cells = new Map<string, T[]>();

  constructor(readonly cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error("GridForge cellSize must be positive");
  }

  private coordinate(value: number) {
    return Math.floor(value / this.cellSize);
  }

  private key(x: number, z: number) {
    return `${x},${z}`;
  }

  insert(item: T, bounds: GridBounds) {
    const minX = this.coordinate(Math.min(bounds.minX, bounds.maxX));
    const maxX = this.coordinate(Math.max(bounds.minX, bounds.maxX));
    const minZ = this.coordinate(Math.min(bounds.minZ, bounds.maxZ));
    const maxZ = this.coordinate(Math.max(bounds.minZ, bounds.maxZ));
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      const key = this.key(x, z);
      const entries = this.cells.get(key) ?? [];
      entries.push(item);
      this.cells.set(key, entries);
    }
  }

  query(bounds: GridBounds) {
    const minX = this.coordinate(Math.min(bounds.minX, bounds.maxX));
    const maxX = this.coordinate(Math.max(bounds.minX, bounds.maxX));
    const minZ = this.coordinate(Math.min(bounds.minZ, bounds.maxZ));
    const maxZ = this.coordinate(Math.max(bounds.minZ, bounds.maxZ));
    const unique = new Set<T>();
    const result: T[] = [];
    for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
      for (const item of this.cells.get(this.key(x, z)) ?? []) {
        if (unique.has(item)) continue;
        unique.add(item);
        result.push(item);
      }
    }
    return result;
  }

  queryAround(point: GridPoint, radius = 0) {
    return this.query({
      minX: point.x - radius,
      minZ: point.z - radius,
      maxX: point.x + radius,
      maxZ: point.z + radius,
    });
  }

  clear() {
    this.cells.clear();
  }

  get occupiedCellCount() {
    return this.cells.size;
  }
}
