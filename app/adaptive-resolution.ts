/**
 * Holds the frame rate near the display refresh by scaling the 3D render resolution.
 * Drops quickly when frames are slow, recovers slowly so it does not oscillate.
 */
export type ResolutionGovernor = { ratio: number; slow: number; fast: number };

export const MIN_RENDER_SCALE = 0.7;

export function createResolutionGovernor(maxRatio: number): ResolutionGovernor {
  return { ratio: maxRatio, slow: 0, fast: 0 };
}

/** Call once per second with that second's measured frames per second. */
export function stepResolution(governor: ResolutionGovernor, fps: number, maxRatio: number): ResolutionGovernor {
  const floor = Math.min(maxRatio, MIN_RENDER_SCALE);
  const slow = fps < 55 ? governor.slow + 1 : 0;
  const fast = fps >= 59 ? governor.fast + 1 : 0;
  if (slow >= 2 && governor.ratio > floor) {
    return { ratio: Math.max(floor, +(governor.ratio - (fps < 40 ? 0.15 : 0.08)).toFixed(2)), slow: 0, fast: 0 };
  }
  if (fast >= 6 && governor.ratio < maxRatio) {
    return { ratio: Math.min(maxRatio, +(governor.ratio + 0.05).toFixed(2)), slow: 0, fast: 0 };
  }
  return { ratio: governor.ratio, slow, fast };
}
