// HOW MUCH RENDERING THIS DEVICE GETS.
//
// A weaker phone gets a lower pixel ratio, no shadows and no antialiasing —
// a slightly softer picture, never a broken one. The tier is chosen once from
// what the browser reports and can be overridden for testing.

export type QualityTier = 'HIGH' | 'BALANCED' | 'LOW';

export interface QualityProfile {
  tier: QualityTier;
  maxPixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Largest texture edge the renderer should request for catalogue assets. */
  maxTextureSize: number;
}

export const QUALITY: Record<QualityTier, QualityProfile> = {
  HIGH: { tier: 'HIGH', maxPixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 2048, maxTextureSize: 2048 },
  BALANCED: { tier: 'BALANCED', maxPixelRatio: 1.5, antialias: true, shadows: false, shadowMapSize: 1024, maxTextureSize: 1024 },
  LOW: { tier: 'LOW', maxPixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 512, maxTextureSize: 512 },
};

export interface DeviceSignals {
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  shortestScreenEdge?: number;
  coarsePointer?: boolean;
  override?: string | null;
}

export function chooseQuality(s: DeviceSignals): QualityProfile {
  const forced = s.override?.toUpperCase();
  if (forced === 'HIGH' || forced === 'BALANCED' || forced === 'LOW') return QUALITY[forced];

  const cores = s.hardwareConcurrency ?? 4;
  const memory = s.deviceMemoryGb ?? 4;
  const phone = !!s.coarsePointer && (s.shortestScreenEdge ?? 1000) < 600;

  if (cores <= 4 || memory <= 2) return QUALITY.LOW;
  if (phone || cores <= 6 || memory <= 4) return QUALITY.BALANCED;
  return QUALITY.HIGH;
}

/** Signals from the running browser. Safe to call where `navigator` is missing. */
export function readDeviceSignals(): DeviceSignals {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return {};
  let override: string | null = null;
  try { override = new URLSearchParams(window.location.search).get('ds_quality'); } catch { /* ignore */ }
  return {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    shortestScreenEdge: Math.min(window.screen?.width ?? 1000, window.screen?.height ?? 1000),
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    override,
  };
}
