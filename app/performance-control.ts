export type QualityLevel = 0 | 1 | 2;

export type PerformanceProfile = {
  level: QualityLevel;
  lowSamples: number;
  highSamples: number;
};

export const QUALITY_LABELS = ["清晰即時", "清晰平衡", "清晰穩定"] as const;

export function stepPerformanceProfile(profile: PerformanceProfile, fps: number): PerformanceProfile {
  const lowSamples = fps < 54 ? profile.lowSamples + 1 : 0;
  const highSamples = fps >= 59 ? profile.highSamples + 1 : 0;
  if (lowSamples >= 4 && profile.level < 2) return { level: (profile.level + 1) as QualityLevel, lowSamples: 0, highSamples: 0 };
  if (highSamples >= 10 && profile.level > 0) return { level: (profile.level - 1) as QualityLevel, lowSamples: 0, highSamples: 0 };
  return { level: profile.level, lowSamples, highSamples };
}
