/** Physics time is independent of display refresh. Bound catch-up after stalls. */
export class SimulationClock {
  readonly step = 1 / 60;
  private remainder = 0;
  advance(seconds: number, simulate: (dt: number) => void) {
    this.remainder += Math.max(0, Math.min(Number.isFinite(seconds) ? seconds : 0, .1));
    let steps = 0;
    while (this.remainder + 1e-10 >= this.step && steps < 6) {
      simulate(this.step);
      this.remainder -= this.step;
      steps++;
    }
    this.remainder = Math.max(0, this.remainder);
    return Math.min(1, this.remainder / this.step);
  }
  reset() { this.remainder = 0; }
}

export const interpolate = (a: number, b: number, alpha: number) => a + (b - a) * alpha;
export const interpolateAngle = (a: number, b: number, alpha: number) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * alpha;
