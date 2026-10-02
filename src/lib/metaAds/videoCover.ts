// META ADS — "Let HOMATCH choose" the video cover. Pure and deterministic:
// ordinary frame statistics, no generative AI, no network. The browser samples
// a handful of frames (sampleTimes), reads each one's pixels (frameStats), and
// the best-scoring frame becomes the cover. The source video is never altered —
// the cover is a separate still saved beside it.

export interface FrameStats {
  t: number;
  /** Mean luminance 0–255. */
  luma: number;
  /** Luminance standard deviation (global contrast). */
  contrast: number;
  /** Mean absolute Laplacian response (edge detail / sharpness). */
  sharpness: number;
}

/** Evenly spread sample times, skipping the first/last moments (fades, black frames). */
export function sampleTimes(duration: number, count = 8): number[] {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return [0];
  if (d < 1) return [d / 2];
  const start = Math.min(0.5, d * 0.08);
  const end = Math.max(start, d - Math.min(0.5, d * 0.08));
  const n = Math.max(1, Math.min(count, Math.floor(d * 2)));
  if (n === 1) return [Math.round(((start + end) / 2) * 100) / 100];
  return Array.from({ length: n }, (_, i) => Math.round((start + ((end - start) * i) / (n - 1)) * 100) / 100);
}

/** Stats of one RGBA frame (canvas ImageData.data), downsampled by `step` for speed. */
export function frameStats(t: number, rgba: ArrayLike<number>, width: number, height: number, step = 2): FrameStats {
  const lum = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
  };
  let sum = 0; let sq = 0; let n = 0; let lap = 0; let ln = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const v = lum(x, y); sum += v; sq += v * v; n++;
      if (x >= step && y >= step && x < width - step && y < height - step) {
        lap += Math.abs(4 * v - lum(x - step, y) - lum(x + step, y) - lum(x, y - step) - lum(x, y + step)); ln++;
      }
    }
  }
  const mean = n ? sum / n : 0;
  return { t, luma: mean, contrast: Math.sqrt(Math.max(0, (n ? sq / n : 0) - mean * mean)), sharpness: ln ? lap / ln : 0 };
}

/**
 * A good feed cover is well exposed (not near-black or blown out), has
 * contrast, and is sharp (not a motion blur or a transition). Score 0–1.
 */
export function coverScore(s: FrameStats): number {
  const exposure = s.luma < 25 || s.luma > 235 ? 0 : 1 - Math.abs(s.luma - 128) / 128;
  const contrast = Math.min(1, s.contrast / 64);
  const sharp = Math.min(1, s.sharpness / 18);
  return Math.round((0.35 * exposure + 0.3 * contrast + 0.35 * sharp) * 1000) / 1000;
}

/** The best frame; ties go to the earlier one (stable, deterministic). */
export function bestCover(frames: FrameStats[]): FrameStats | null {
  let best: FrameStats | null = null; let bestScore = -1;
  for (const f of frames) {
    const sc = coverScore(f);
    if (sc > bestScore) { best = f; bestScore = sc; }
  }
  return best;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
