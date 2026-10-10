// THE SELECTED RENDER'S LIGHT, READ FROM ITS PIXELS.
//
// A walkthrough furnished from the selected render (renderPlan.ts) is lit as the render is: its time of day, the
// temperature of its light and how strongly its interior lamps glow are measured from the render itself (the home's
// pixels, the white page around a cut-away left out), never a fixed daylight. Pure (Deno + Node).

import type { BuildPlan } from './build.ts';

export type RenderLighting = BuildPlan['lighting'] & { evidence: { meanLuma: number; warmth: number; lampShare: number; pixels: number } };

/** The light every walkthrough had before it was measured (and the answer when nothing can be measured). */
export const NEUTRAL_LIGHTING: BuildPlan['lighting'] = { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.8 };

/**
 * `rgba` is the render (any size), `background` its page colour (#rrggbb, pictureGeometry.ts borderColor) or null.
 * Warmth is the mean (R − B) of the home's pixels; lamps are small, very bright, clearly warm highlights.
 */
export function lightingFromPicture(rgba: ArrayLike<number>, width: number, height: number, background: string | null): RenderLighting | null {
  const bg = background && /^#[0-9a-f]{6}$/i.test(background) ? [1, 3, 5].map((i) => parseInt(background.slice(i, i + 2), 16)) : null;
  let n = 0; let luma = 0; let warm = 0; let lamps = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 160_000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = rgba[i]; const g = rgba[i + 1]; const b = rgba[i + 2];
      if (bg && Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) < 24) continue;
      const yv = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      n += 1; luma += yv; warm += (r - b) / 255;
      if (yv > 0.82 && r - b > 40) lamps += 1;
    }
  }
  if (n < 1000) return null;
  const meanLuma = luma / n; const warmth = warm / n; const lampShare = lamps / n;
  const temperature: BuildPlan['lighting']['temperature'] = warmth > WARM_MIN ? 'WARM' : warmth < COOL_MAX ? 'COOL' : 'NEUTRAL';
  // Lit lamps in a dim, warm picture are an evening; a very dark picture is night; otherwise daylight.
  const timeOfDay: BuildPlan['lighting']['timeOfDay'] = meanLuma < NIGHT_LUMA ? 'NIGHT' : (lampShare > LAMP_SHARE_MIN && meanLuma < EVENING_LUMA) ? 'EVENING' : 'DAY';
  const interiorIntensity = timeOfDay === 'NIGHT' ? 1 : timeOfDay === 'EVENING' ? 0.9 : 0.75;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { timeOfDay, temperature, interiorIntensity, evidence: { meanLuma: r3(meanLuma), warmth: r3(warmth), lampShare: Math.round(lampShare * 1e5) / 1e5, pixels: n } };
}

const WARM_MIN = 0.05;
const COOL_MAX = -0.02;
const NIGHT_LUMA = 0.16;
const EVENING_LUMA = 0.5;
const LAMP_SHARE_MIN = 0.0015;
