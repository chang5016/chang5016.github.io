export type EngineSoundState = { rpm: number; load: number };
export const ENGINE_LAYERS = [
  { name: 'idle', rpm: 1800 },
  { name: 'cruise', rpm: 3300 },
  { name: 'pull', rpm: 4700 },
  { name: 'high', rpm: 6400 },
] as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A scooter CVT holds the engine under load while road speed catches up. */
export function stepEngineSound(state: EngineSoundState, speed: number, throttle: number, boosted: boolean, seconds: number, running = true) {
  const dt = clamp(seconds, 0, .08);
  const velocity = Math.abs(speed);
  const demand = running ? clamp(Math.abs(throttle), 0, 1) : 0;
  const clutch = clamp((velocity - .4) / 3.6, 0, 1);
  const target = running ? clamp(1700 + clutch * (500 + velocity * 75) + demand * (2050 + clutch * 650) + (boosted ? 650 : 0), 1700, 7000) : 0;
  const rpm = state.rpm + (target - state.rpm) * (1 - Math.exp(-dt / (target > state.rpm ? .17 : .34)));
  const load = state.load + (demand - state.load) * (1 - Math.exp(-dt / .12));
  // Overlapping registers stay alive through throttle changes. At the same road
  // speed, opening the throttle adds the recorded exhaust/load texture; closing
  // it brings back the quieter mechanical register. No loop is restarted.
  const weights = ENGINE_LAYERS.map((layer, index) => {
    const distance = Math.log2(Math.max(1700,rpm) / layer.rpm);
    const register = Math.exp(-.5 * (distance / .42) ** 2);
    return register * (index < 2 ? 1 - load * .2 : .34 + load * .9);
  });
  const energy = Math.hypot(...weights);
  const volume = .42 + load * .3;
  return {
    rpm, load,
    layers: ENGINE_LAYERS.map((layer, index) => ({
      rate: clamp(rpm / layer.rpm, .62, 1.65),
      gain: running ? weights[index] / energy * volume : 0,
    })),
    cutoff: 1600 + load * 1900 + clamp((rpm - 2000) * .15, 0, 700),
    tyreGain: Math.min(.014, velocity * .00046),
    windGain: Math.min(.017, Math.max(0, velocity - 7) ** 2 * .00003),
  };
}
