/** Fixed one-metre route stations, shared by cars in the same lane. */
export class TrafficHeightCache {
  private readonly heights = new Map<number, number>();
  constructor(readonly length: number, readonly spacing = 1) {}
  sample(progress: number, evaluate: (distance: number) => number) {
    const distance = Math.max(0, Math.min(this.length, progress));
    const lower = Math.min(Math.floor(distance / this.spacing), Math.max(0, Math.ceil(this.length / this.spacing) - 1));
    const a = lower * this.spacing, b = Math.min(this.length, a + this.spacing);
    const read = (station: number, at: number) => {
      let value = this.heights.get(station);
      if (value === undefined) { value = evaluate(at); this.heights.set(station, value); }
      return value;
    };
    const y0 = read(lower, a), y1 = read(lower + 1, b);
    const grade = (y1 - y0) / Math.max(.001, b - a);
    return { height: y0 + grade * (distance - a), grade };
  }
}
