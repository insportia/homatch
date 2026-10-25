// MY GEORGIA BY HOMI — places to visit: filters and the lazy language loader.
//
// The metadata is small and ships with the page; each language's text is its
// own chunk, loaded when the places are first shown. A language that fails to
// load falls back to English rather than showing an empty list.

import { PLACES } from './meta';
import type { PlaceMeta, PlaceTexts, PlaceType, Season } from './types';

export { PLACES } from './meta';
export * from './types';

const LOADERS: Record<string, () => Promise<{ default: PlaceTexts }>> = {
  ka: () => import('./content.ka'),
  en: () => import('./content.en'),
  ru: () => import('./content.ru'),
  tr: () => import('./content.tr'),
  ar: () => import('./content.ar'),
  he: () => import('./content.he'),
};

export async function loadPlaceTexts(lang: string): Promise<PlaceTexts> {
  try {
    return (await (LOADERS[lang] ?? LOADERS.en)()).default;
  } catch {
    return (await LOADERS.en()).default;
  }
}

export function filterPlaces(places: readonly PlaceMeta[], type: PlaceType | null, season: Season | null): PlaceMeta[] {
  return places.filter((p) => (!type || p.types.includes(type)) && (!season || p.seasons.includes(season)));
}

/** The season a date falls in (northern hemisphere, by month). */
export function seasonOf(date: Date): Season {
  const m = date.getMonth();
  if (m >= 2 && m <= 4) return 'SPRING';
  if (m >= 5 && m <= 7) return 'SUMMER';
  if (m >= 8 && m <= 10) return 'AUTUMN';
  return 'WINTER';
}

/** A few good trips for this season, nearest first, one per main type, never Tbilisi itself. */
export function seasonalPicks(season: Season, count = 3): PlaceMeta[] {
  const seen = new Set<PlaceType>();
  return PLACES
    .filter((p) => p.hours > 0 && p.seasons.includes(season))
    .slice()
    .sort((a, b) => a.hours - b.hours)
    .filter((p) => (seen.has(p.types[0]) ? false : (seen.add(p.types[0]), true)))
    .slice(0, count);
}
