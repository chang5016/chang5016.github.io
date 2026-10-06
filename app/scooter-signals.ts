export type SignalMode = "off" | "left" | "right" | "hazard";

/** Shared clock keeps the front/rear lamps in phase at 90 flashes/minute. */
export function scooterLamps(mode: SignalMode, seconds: number, braking: boolean) {
  const pulse = seconds % (2 / 3) < 1 / 3;
  return {
    tail: braking ? 3.2 : 0.35,
    left: pulse && (mode === "left" || mode === "hazard") ? 3 : 0,
    right: pulse && (mode === "right" || mode === "hazard") ? 3 : 0,
  };
}
