// MY GEORGIA BY HOMI — places to visit, the shape of the data.
//
// Why a typed module and not the database: expat_places is a provider
// directory (cafes, clinics, notaries) with one-language names and price and
// rating columns. A destination needs other things: six languages, a season,
// a way to get there from Tbilisi and an official page to read more. The
// facts here change rarely and are editorial, so they live in code, reviewed
// like code, and each language is its own lazy chunk.

export const PLACE_TYPES = ['MOUNTAINS', 'SEA', 'WINE', 'HISTORIC', 'CAVES', 'LAKES', 'SPA', 'PARKS', 'CITIES'] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

export const SEASONS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'] as const;
export type Season = (typeof SEASONS)[number];

export const TRANSPORTS = ['CAR', 'MINIBUS', 'TRAIN', 'FLIGHT', 'JEEP', 'WALK', 'CITY'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export interface PlaceMeta {
  /** Stable key shared by every language file. */
  id: string;
  /** The first type is the main one (it picks the card's colour and icon). */
  types: readonly PlaceType[];
  seasons: readonly Season[];
  /** Typical door to door time from Tbilisi, in hours, by the first transport. 0 means in Tbilisi. */
  hours: number;
  transport: readonly Transport[];
  /** An official page: the national tourism site or the agency that runs the place. */
  source: { url: string; publisher: string };
}

export interface PlaceText {
  name: string;
  region: string;
  /** Two or three friendly sentences. */
  blurb: string;
  /** How to get there from Tbilisi, in one or two sentences. */
  getThere: string;
  /** Three short things to do. */
  todo: readonly string[];
}

export type PlaceTexts = Readonly<Record<string, PlaceText>>;
