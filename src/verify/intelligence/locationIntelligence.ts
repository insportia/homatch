// HOMATCH — location intelligence.
//
// "Krtsanisi, Tbilisi" is a label, not intelligence. A buyer wants to know
// what the address MEANS: what is nearby, who competes for it, and who ends
// up living there.
//
// The honest constraint is that this pipeline has no geocoder and no
// points-of-interest feed. So this module does not pretend to measure
// distances. It does two things it CAN do truthfully:
//
//   1. resolves the address into city / district / street from evidence text;
//   2. attaches a curated, static characterisation of the district — the kind
//      of thing any Tbilisi agent knows — clearly labelled as general area
//      context rather than a finding about this property.
//
// Everything else (amenities, project scale, construction stage) already
// comes from real evidence and is passed through, not invented here.
//
// If the district is not recognised, this returns the address facts alone and
// no characterisation. An unknown area produces silence, never a guess.
//
// Measured distances DO exist since 2026-10-11, but not here: verify-synthesis
// attaches an OpenStreetMap lookup (neighborhood.ts) via withNeighborhood(),
// and that is the only place a metre figure may come from.

import type {
  CenterBasis,
  CenterConfidence,
  CenterIssue,
  NeighborhoodCategory,
  NeighborhoodCenter,
  NeighborhoodStatus,
  StoredNeighborhood,
} from './neighborhood.ts';

export interface AreaProfile {
  /** Canonical district name, as written in Georgian. */
  district: string;
  /** One sentence a local adviser would actually say about the area. */
  character: string;
  /** Who realistically competes for homes here. Evidence-free general context. */
  likelyResidents: string[];
  /** Notable context: proximity, landmarks, character. Never distances. */
  context: string[];
}

/*
 * A place near the property, as a source described it.
 *
 * There is deliberately no distance and no travel time. We have coordinates
 * for neither end, so any number here would be invented — and "350m from the
 * building" is precisely the kind of precise-sounding invention that makes a
 * report untrustworthy. `note` carries whatever relative context a source
 * actually stated, or nothing.
 *
 * `whyKey` is an i18n key, not prose: the reason a school or a pharmacy
 * matters to a buyer is the same sentence every time, and it should be
 * translated rather than re-written per report.
 */
export type PlaceCategory =
  | 'SCHOOL' | 'KINDERGARTEN' | 'SUPERMARKET' | 'PHARMACY' | 'CLINIC'
  | 'PARK' | 'TRANSPORT' | 'ROAD_ACCESS' | 'CITY_CENTRE' | 'SERVICE';

export interface NearbyPlace {
  category: PlaceCategory;
  name: string;
  /** Relative context a source actually stated. Never computed. */
  note?: string | null;
  /** Why this category matters to somebody living there. */
  whyKey: string;
}

/** Why each kind of place matters, said once, translated per language. */
export const PLACE_WHY_KEYS: Record<PlaceCategory, string> = {
  SCHOOL: 'verify_place_why_school',
  KINDERGARTEN: 'verify_place_why_kindergarten',
  SUPERMARKET: 'verify_place_why_supermarket',
  PHARMACY: 'verify_place_why_pharmacy',
  CLINIC: 'verify_place_why_clinic',
  PARK: 'verify_place_why_park',
  TRANSPORT: 'verify_place_why_transport',
  ROAD_ACCESS: 'verify_place_why_road',
  CITY_CENTRE: 'verify_place_why_centre',
  SERVICE: 'verify_place_why_service',
};

/** The order a buyer cares about: daily needs first, then getting around. */
const CATEGORY_ORDER: PlaceCategory[] = [
  'SUPERMARKET', 'PHARMACY', 'SCHOOL', 'KINDERGARTEN', 'CLINIC',
  'TRANSPORT', 'PARK', 'ROAD_ACCESS', 'CITY_CENTRE', 'SERVICE',
];

/**
 * The nearby places worth showing, deduplicated and ordered.
 *
 * A dozen supermarkets is an index, not intelligence, so this keeps the few
 * that answer "could I live here" and drops the rest.
 */
export function nearbyPlaces(raw: unknown): NearbyPlace[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: NearbyPlace[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const category = String(e.category ?? '').toUpperCase() as PlaceCategory;
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (!PLACE_WHY_KEYS[category] || !name) continue;

    const key = `${category}:${name.toLowerCase().replace(/\s+/g, ' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const said = typeof e.note === 'string' && e.note.trim() ? e.note.trim() : null;
    // A travel time or distance nobody measured is dropped, not softened.
    const note = said && !isUnverifiedReach(said) ? said : null;
    out.push({ category, name, note, whyKey: PLACE_WHY_KEYS[category] });
  }

  return out.sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  );
}

/*
 * TRAVEL TIMES NOBODY MEASURED (2026-10-11, job 8ba97da9).
 *
 * The research layer returned every place with "ფეხით დაახლოებით 3 წუთია"
 * attached, phrased as if sourced. Nothing measured those minutes. A note
 * that states a distance or a travel time is dropped here; measured
 * distances now come only from the OpenStreetMap lookup (neighborhood.ts).
 * Relative wording a source used ("on the same street") survives.
 */
export function isUnverifiedReach(note: string): boolean {
  return /\d+(?:[.,]\d+)?\s*(?:მ(?![ა-ჰ])|მეტრ|კმ(?![ა-ჰ])|წთ|წუთ|km\b|m\b|min|minutes?|метр|км|мин)/i.test(note)
    || /(წუთ|ფეხით|მანქანით|minute|walk|drive|by car|минут|пешком)/i.test(note);
}

/**
 * Attaches the OpenStreetMap lookup. When it succeeded it REPLACES the
 * research layer's place list: measured places beat named-but-unmeasured
 * ones, and keeping both would show the same supermarket twice with two
 * different kinds of claim.
 */
export function withNeighborhood(location: LocationIntelligence, neighborhood: StoredNeighborhood | null | undefined): LocationIntelligence {
  if (!neighborhood) return location;
  return {
    ...location,
    neighborhood,
    nearby: neighborhood.status === 'OK' ? [] : location.nearby,
    minimal: location.minimal && neighborhood.status !== 'OK',
    // F5 (2026-10-22): the centre and what was mentioned, kept apart from what was measured.
    center: contractCenter(neighborhood.center, neighborhood.fetchedAt),
    centerCandidates: contractCandidates(neighborhood),
    mentionedPlaces: mentionedPlaces(location.nearby),
  };
}

/* ── the location contract (V2), F5 2026-10-22 ─────────────────────────
 *
 * synthesis_json.location keeps its V1 fields (nearby, neighborhood) so every
 * stored report still renders. These optional fields, and locationContract(),
 * are the shape V2 builds against:
 *   - center: the ONE point distances are measured from, with provenance;
 *   - centerCandidates: every point any source gave, chosen or not, with its
 *     distance from the centre and a disagreement flag;
 *   - measuredPlaces: OpenStreetMap features with straight-line metres from
 *     a verified centre, and nothing else;
 *   - mentionedPlaces: names public descriptions gave, NEVER with a distance;
 *   - coverage: what was and was not possible.
 */

export interface LocationCenterV2 {
  lat: number;
  lon: number;
  source: CenterBasis;
  /** How the point was obtained. */
  method: 'MAP_VIEW_AFTER_PARCEL_SEARCH' | 'UTM_GRID_OF_CADASTRAL_PLAN' | 'UTM_GRID_OF_SITUATIONAL_DRAWING' | 'ADDRESS_GEOCODE';
  confidence: CenterConfidence;
  /** What the point stands for: the parcel itself, a drawing frame, a house or a street. */
  precision: 'PARCEL' | 'DRAWING_FRAME' | 'HOUSE' | 'STREET';
  parcel: string | null;
  /** Document title, map description or geocoder query the point was read from. */
  evidence: string | null;
  retrievedAt: string | null;
}

export interface LocationCenterCandidateV2 extends LocationCenterV2 {
  distanceFromCenterM: number | null;
  /** Further than CENTER_DISAGREEMENT_M (locationCenter.ts) from the centre, or from another candidate when none was chosen. */
  disagrees: boolean;
  chosen: boolean;
}

export interface MeasuredPlaceV2 {
  category: NeighborhoodCategory;
  name: string | null;
  /** OSM element, e.g. "n123", "w45". */
  osmId: string;
  /** Null in lookups stored before 2026-10-22. */
  lat: number | null;
  lon: number | null;
  /** Great-circle metres from `center`, rounded. Never a walking or driving time. */
  straightLineM: number;
  measure: 'STRAIGHT_LINE';
  source: 'OSM_OVERPASS';
  retrievedAt: string;
}

export interface MentionedPlaceV2 {
  name: string;
  category: PlaceCategory;
  /** A description, not a measurement: there is no distance field by design. */
  origin: 'PUBLIC_DESCRIPTION';
  /** The first URL the description cited, when it cited one. */
  sourceUrl: string | null;
  /** The source's own relative wording, already stripped of unmeasured distances and times. */
  description: string | null;
}

export type LocationLimitation =
  | 'NO_VERIFIED_CENTER' | 'CENTER_CONFLICT' | 'UNCORROBORATED_DRAWING' | 'DRAWING_SET_ASIDE' | 'OPEN_DATA_UNAVAILABLE'
  | 'DISTANCES_ARE_STRAIGHT_LINE' | 'OSM_INCOMPLETE' | 'MENTIONED_PLACES_UNMEASURED';

export interface LocationCoverageV2 {
  status: NeighborhoodStatus | 'NOT_RUN';
  centerIssue: CenterIssue | null;
  radiusM: number | null;
  /** Overpass's own map-data date. */
  osmBase: string | null;
  limitations: LocationLimitation[];
}

export interface LocationContract {
  version: 2;
  center: LocationCenterV2 | null;
  centerCandidates: LocationCenterCandidateV2[];
  measuredPlaces: MeasuredPlaceV2[];
  mentionedPlaces: MentionedPlaceV2[];
  coverage: LocationCoverageV2;
}

const METHOD: Record<CenterBasis, LocationCenterV2['method']> = {
  MS_MAP_PARCEL: 'MAP_VIEW_AFTER_PARCEL_SEARCH',
  MS_MAP_PARCEL_EARLIER: 'MAP_VIEW_AFTER_PARCEL_SEARCH',
  CADASTRAL_PLAN: 'UTM_GRID_OF_CADASTRAL_PLAN',
  SITUATIONAL_DRAWING: 'UTM_GRID_OF_SITUATIONAL_DRAWING',
  GEOCODED_ADDRESS: 'ADDRESS_GEOCODE',
};

/** A stored centre (any vintage) in the V2 shape, or null. */
export function contractCenter(c: NeighborhoodCenter | null | undefined, fallbackAt: string | null = null): LocationCenterV2 | null {
  if (!c || !Number.isFinite(c.lat) || !Number.isFinite(c.lng) || !METHOD[c.basis]) return null;
  const geocode = c.basis === 'GEOCODED_ADDRESS';
  const precision: LocationCenterV2['precision'] = geocode
    ? (c.precision === 'HOUSE' ? 'HOUSE' : 'STREET')
    : c.basis === 'SITUATIONAL_DRAWING' ? 'DRAWING_FRAME' : 'PARCEL';
  const confidence: CenterConfidence = c.confidence
    ?? (c.basis === 'SITUATIONAL_DRAWING' ? 'MEDIUM' : geocode ? (c.precision === 'HOUSE' ? 'MEDIUM' : 'LOW') : 'HIGH');
  return {
    lat: c.lat, lon: c.lng, source: c.basis, method: METHOD[c.basis], confidence, precision,
    parcel: c.parcel ?? null, evidence: c.evidence ?? null, retrievedAt: c.retrievedAt ?? fallbackAt,
  };
}

function contractCandidates(n: StoredNeighborhood): LocationCenterCandidateV2[] {
  const out: LocationCenterCandidateV2[] = [];
  for (const c of Array.isArray(n.candidates) ? n.candidates : []) {
    const v = contractCenter(c, n.fetchedAt);
    if (v) out.push({ ...v, distanceFromCenterM: c.distanceFromCenterM ?? null, disagrees: !!c.disagrees, chosen: !!c.chosen });
  }
  return out;
}

const firstUrl = (s: string | null | undefined): string | null => (String(s ?? '').match(/https?:\/\/[^\s)\]]+/) ?? [null])[0];

/** The research layer's places as descriptions: name, category, origin. Never a distance. */
export function mentionedPlaces(raw: unknown): MentionedPlaceV2[] {
  return nearbyPlaces(raw).map((p) => ({
    name: p.name,
    category: p.category,
    origin: 'PUBLIC_DESCRIPTION' as const,
    sourceUrl: firstUrl(p.note),
    description: p.note ?? null,
  }));
}

/**
 * The location exactly as the model saw it before F5: no contract fields, no
 * candidate list, no coordinates per place. Coordinates are for the code that
 * measures; the prose only cites the metres it was handed.
 */
export function locationForModel(location: LocationIntelligence | null | undefined): LocationIntelligence | undefined {
  if (!location) return undefined;
  const { center: _c, centerCandidates: _cc, mentionedPlaces: _m, ...v1 } = location;
  const n = v1.neighborhood;
  if (!n) return v1;
  const { candidates: _k, centerIssue: _i, ...nv1 } = n;
  const c = nv1.center;
  const center = c
    ? { lat: c.lat, lng: c.lng, basis: c.basis, ...(c.parcel !== undefined ? { parcel: c.parcel } : {}), ...(c.precision !== undefined ? { precision: c.precision } : {}) }
    : c;
  return { ...v1, neighborhood: { ...nv1, center, places: (nv1.places ?? []).map(({ lat: _a, lng: _b, ...p }) => p) } };
}

/**
 * The V2 location contract from a stored synthesis_json.location of any
 * vintage. A report stored before 2026-10-22 (no center, no candidates, no
 * mentionedPlaces) reads too: the centre comes from its neighbourhood lookup
 * and the mentioned places from `nearby`.
 *
 * Measured places exist only with a verified centre and an OK lookup; a
 * mentioned place never carries a distance, whatever its note said.
 */
export function locationContract(location: unknown): LocationContract {
  const l = (location && typeof location === 'object' ? location : {}) as Partial<LocationIntelligence>;
  const n = l.neighborhood && typeof l.neighborhood === 'object' ? l.neighborhood : null;
  const center = l.center ?? contractCenter(n?.center, n?.fetchedAt ?? null);
  const centerCandidates = Array.isArray(l.centerCandidates) ? l.centerCandidates : n ? contractCandidates(n) : [];
  const measured = !!center && n?.status === 'OK';
  const measuredPlaces: MeasuredPlaceV2[] = measured
    ? (Array.isArray(n!.places) ? n!.places : []).map((p) => ({
        category: p.category,
        name: p.name,
        osmId: p.osm,
        lat: typeof p.lat === 'number' ? p.lat : null,
        lon: typeof p.lng === 'number' ? p.lng : null,
        straightLineM: p.distanceM,
        measure: 'STRAIGHT_LINE' as const,
        source: 'OSM_OVERPASS' as const,
        retrievedAt: n!.fetchedAt,
      }))
    : [];
  const mentioned = Array.isArray(l.mentionedPlaces) ? l.mentionedPlaces : mentionedPlaces(l.nearby);
  const issue = n?.centerIssue ?? null;
  const limitations: LocationLimitation[] = [];
  if (!center) limitations.push('NO_VERIFIED_CENTER');
  if (issue) limitations.push(issue);
  if (n?.status === 'UNAVAILABLE') limitations.push('OPEN_DATA_UNAVAILABLE');
  if (measured) limitations.push('DISTANCES_ARE_STRAIGHT_LINE', 'OSM_INCOMPLETE');
  if (mentioned.length) limitations.push('MENTIONED_PLACES_UNMEASURED');
  return {
    version: 2,
    center,
    centerCandidates,
    measuredPlaces,
    // Rebuilt field by field: whatever a stored entry carried, no distance leaves here.
    mentionedPlaces: mentioned.map((m) => ({
      name: m.name, category: m.category, origin: 'PUBLIC_DESCRIPTION' as const, sourceUrl: m.sourceUrl ?? null, description: m.description ?? null,
    })),
    coverage: { status: n?.status ?? 'NOT_RUN', centerIssue: issue, radiusM: n?.radiusM ?? null, osmBase: n?.osmBase ?? null, limitations },
  };
}

export interface LocationIntelligence {
  city?: string;
  district?: string;
  street?: string;
  /** Present only for a district this module actually knows. */
  profile?: AreaProfile;
  /** Places a source actually named near this property. */
  nearby: NearbyPlace[];
  /** True when nothing beyond a raw address string could be resolved. */
  minimal: boolean;
  /** Source-verified OpenStreetMap lookup, attached at report build time. */
  neighborhood?: StoredNeighborhood | null;
  /** V2 contract fields (see locationContract); absent in reports stored before 2026-10-22. */
  center?: LocationCenterV2 | null;
  centerCandidates?: LocationCenterCandidateV2[];
  mentionedPlaces?: MentionedPlaceV2[];
}

/*
 * Curated Tbilisi district context.
 *
 * This is GENERAL AREA KNOWLEDGE, not research output, and the prompt is told
 * to present it that way. It is kept small and factual — character, who lives
 * there, what is around — with no claim about prices, growth or investment
 * return, because those would be exactly the invented facts this product
 * refuses to make.
 */
const AREAS: Record<string, Omit<AreaProfile, 'district'>> = {
  'კრწანისი': {
    character: 'ისტორიული, მწვანე უბანი ძველ თბილისთან და მტკვრის სანაპიროსთან ახლოს, სადაც ბოლო წლებში რამდენიმე ბუტიკური საცხოვრებელი პროექტი განვითარდა.',
    likelyResidents: ['დიპლომატიური და საერთაშორისო ორგანიზაციების თანამშრომლები', 'ექსპატები', 'ცენტრთან სიახლოვის მოყვარული ოჯახები', 'გრძელვადიანი პრემიუმ მოიჯარეები'],
    context: ['ძველი თბილისისა და ცენტრის სიახლოვე', 'საელჩოებისა და სახელმწიფო უწყებების ზონა', 'მტკვრის სანაპირო და გამწვანებული ტერიტორიები', 'შედარებით დაბალი სიმჭიდროვის განაშენიანება'],
  },
  'ვაკე': {
    character: 'თბილისის ერთ-ერთი ყველაზე მოთხოვნადი და პრესტიჟული საცხოვრებელი უბანი, განვითარებული ინფრასტრუქტურითა და მაღალი მოთხოვნით.',
    likelyResidents: ['ადგილობრივი შეძლებული ოჯახები', 'ექსპატები', 'კორპორაციული მენეჯმენტი', 'გრძელვადიანი პრემიუმ მოიჯარეები'],
    context: ['ვაკის პარკი', 'უნივერსიტეტები და სკოლები', 'რესტორნები და სერვისები', 'ისტორიულად სტაბილური მოთხოვნა'],
  },
  'საბურთალო': {
    character: 'დიდი, აქტიურად განაშენიანებული უბანი ბიზნეს-ცენტრებით, კლინიკებითა და უნივერსიტეტებით; მიწოდება შედარებით მაღალია.',
    likelyResidents: ['ახალგაზრდა ოჯახები', 'სტუდენტები და აკადემიური სექტორი', 'სამედიცინო და ბიზნეს-სექტორის თანამშრომლები'],
    context: ['მეტროსადგურები', 'ბიზნეს და სამედიცინო კლასტერები', 'ახალი განაშენიანების მაღალი ტემპი'],
  },
  'მთაწმინდა': {
    character: 'ცენტრალური, ისტორიული უბანი ქალაქის ხედებით; ძველი ფონდი და ახალი ბუტიკური პროექტები ერთმანეთს ენაცვლება.',
    likelyResidents: ['ექსპატები', 'მოკლევადიანი გაქირავების ბაზარი', 'ცენტრის მოყვარული მყიდველები'],
    context: ['ქალაქის ცენტრი და ისტორიული ნაწილი', 'ხედები და რელიეფი', 'ტურისტული აქტივობა'],
  },
  'ისანი': {
    character: 'შერეული ხასიათის უბანი მდინარის მარცხენა სანაპიროზე, ცენტრთან კარგი კავშირით და შედარებით ხელმისაწვდომი ფასებით.',
    likelyResidents: ['ადგილობრივი ოჯახები', 'პირველი ბინის მყიდველები', 'გრძელვადიანი მოიჯარეები'],
    context: ['ავლაბრისა და ცენტრის სიახლოვე', 'სატრანსპორტო კვანძები'],
  },
  'ჩუღურეთი': {
    character: 'ცენტრთან ახლოს მდებარე ისტორიული უბანი, სადაც ძველი განაშენიანება თანდათან ახლდება.',
    likelyResidents: ['ახალგაზრდა მყიდველები', 'ექსპატები', 'ცენტრთან სიახლოვის მოყვარულები'],
    context: ['ცენტრის სიახლოვე', 'ისტორიული განაშენიანება', 'მიმდინარე განახლების პროცესი'],
  },
  'დიდუბე': {
    character: 'სატრანსპორტო კვანძებთან ახლოს მდებარე მჭიდრო უბანი, უპირატესად ხელმისაწვდომი სეგმენტით.',
    likelyResidents: ['ადგილობრივი ოჯახები', 'ხელმისაწვდომი სეგმენტის მყიდველები'],
    context: ['სატრანსპორტო კვანძები', 'მჭიდრო განაშენიანება'],
  },
  'ვერა': {
    character: 'ცენტრალური, მწვანე და ისტორიული უბანი, რომელიც ტრადიციულად მაღალ მოთხოვნას ინარჩუნებს.',
    likelyResidents: ['ექსპატები', 'შეძლებული ოჯახები', 'პრემიუმ მოიჯარეები'],
    context: ['ვერის პარკი', 'ცენტრის სიახლოვე', 'განვითარებული სერვისები'],
  },
};

const CITY_HINTS = ['თბილისი', 'ბათუმი', 'ქუთაისი', 'რუსთავი', 'გორი', 'ზუგდიდი', 'თელავი'];

/*
 * THE SAME PLACE, WRITTEN IN LATIN.
 *
 * This module read Georgian only, and a real production report carried the
 * address as "Krtsanisi St, 6, Tbilisi" — so nothing resolved, `minimal` came
 * back true, and Location & Living produced no section for a property whose
 * district this module has a curated profile for. The research layer answers
 * in whichever script its sources used; an address is not less of an address
 * for being transliterated.
 *
 * Latin spellings map to the canonical GEORGIAN name, because that is the key
 * AREAS is written in and the language the report is written in. Variants are
 * the ones that actually appear in Georgian listing portals and registry
 * transliterations, not every conceivable romanisation.
 */
const LATIN_ALIASES: Record<string, string> = {
  // Cities
  tbilisi: 'თბილისი',
  batumi: 'ბათუმი',
  kutaisi: 'ქუთაისი',
  rustavi: 'რუსთავი',
  gori: 'გორი',
  zugdidi: 'ზუგდიდი',
  telavi: 'თელავი',
  // Districts
  krtsanisi: 'კრწანისი',
  vake: 'ვაკე',
  saburtalo: 'საბურთალო',
  mtatsminda: 'მთაწმინდა',
  isani: 'ისანი',
  chughureti: 'ჩუღურეთი',
  chugureti: 'ჩუღურეთი',
  didube: 'დიდუბე',
  vera: 'ვერა',
};

/*
 * The same places again, in Russian.
 *
 * Russian is one of the six languages this product is sold in, and Georgian
 * listing portals carry Russian-language descriptions as a matter of course —
 * "Тбилиси, Ваке, ул. Чавчавадзе 40" is an ordinary address here, not an edge
 * case. Matched separately from the Latin table because Cyrillic needs its own
 * word boundaries: a Latin `[^a-z]` guard would treat every Cyrillic letter as
 * a boundary and match fragments inside longer words.
 */
const CYRILLIC_ALIASES: Record<string, string> = {
  // Cities
  тбилиси: 'თბილისი',
  батуми: 'ბათუმი',
  кутаиси: 'ქუთაისი',
  рустави: 'რუსთავი',
  гори: 'გორი',
  зугдиди: 'ზუგდიდი',
  телави: 'თელავი',
  // Districts
  крцаниси: 'კრწანისი',
  ваке: 'ვაკე',
  сабуртало: 'საბურთალო',
  мтацминда: 'მთაწმინდა',
  исани: 'ისანი',
  чугурети: 'ჩუღურეთი',
  дидубе: 'დიდუბე',
  вера: 'ვერა',
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The canonical Georgian names a text mentions, in any supported script. */
function canonicalNames(text: string): Set<string> {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  // Word-bounded per script, so "Vera" does not match inside "Veranda",
  // "Gori" does not match inside "Gorgasali", and "Вера" does not match
  // inside "Веранда". A Latin boundary class would treat every Cyrillic
  // letter as a boundary and match fragments inside Russian words.
  for (const [alias, georgian] of Object.entries(LATIN_ALIASES)) {
    if (new RegExp(`(^|[^a-z])${alias}([^a-z]|$)`).test(lower)) found.add(georgian);
  }
  for (const [alias, georgian] of Object.entries(CYRILLIC_ALIASES)) {
    if (new RegExp(`(^|[^\\u0430-\\u044f\\u0451])${alias}([^\\u0430-\\u044f\\u0451]|$)`).test(lower)) {
      found.add(georgian);
    }
  }
  return found;
}

/**
 * Pulls a street phrase out of an address without inventing one.
 *
 * Georgian first, then Latin. The Latin form has to carry a street word —
 * "St", "Street", "Ave", "Avenue" — because without one there is nothing to
 * distinguish a street name from any other capitalised token in the string.
 */
export function streetOf(address: unknown): string | undefined {
  const a = str(address);
  if (!a) return undefined;
  const georgian = a.match(/([Ⴀ-ჿ'’\-\s]+?(?:ქუჩა|გამზირი|ჩიხი|მოედანი))\s*(?:N?\s*\d+)?/);
  if (georgian) return georgian[0].replace(/\s+/g, ' ').trim();
  const latin = a.match(/([A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*)*\s+(?:St|Str|Street|Ave|Avenue|Rd|Road|Sq|Square)\.?)(?:\s*,?\s*(?:N\s*)?\d+)?/);
  if (latin) return latin[0].replace(/\s+/g, ' ').replace(/\s*,\s*/g, ' ').trim();
  /*
   * Russian, where the street word usually comes FIRST and abbreviated:
   * "ул. Чавчавадзе 40", "проспект Руставели 12". The name is what follows
   * it, so this match is anchored on the word rather than on capitalisation —
   * Cyrillic street names are not reliably capitalised in listing text.
   */
  const cyrillic = a.match(/(?:ул\.?|улица|просп\.?|проспект|пр-т|пер\.?|переулок|пл\.?|площадь)\s+([А-ЯЁа-яё'’-]+(?:\s+[А-ЯЁа-яё'’-]+)*)\s*(?:д\.?\s*)?(\d+)?/);
  if (cyrillic) return cyrillic[0].replace(/\s+/g, ' ').trim();
  return undefined;
}

export function districtOfAddress(address: unknown): string | undefined {
  const a = str(address);
  const direct = Object.keys(AREAS).find((d) => a.includes(d));
  if (direct) return direct;
  const latin = canonicalNames(a);
  return Object.keys(AREAS).find((d) => latin.has(d));
}

export function cityOfAddress(address: unknown): string | undefined {
  const a = str(address);
  const direct = CITY_HINTS.find((c) => a.includes(c));
  if (direct) return direct;
  const latin = canonicalNames(a);
  return CITY_HINTS.find((c) => latin.has(c));
}

/**
 * Builds location intelligence from whatever the research produced.
 *
 * `texts` are any evidence strings that may carry the address — the subject
 * address, publicResearch facts, comparables' addresses. They are scanned in
 * order, so the most authoritative one wins.
 */
export function buildLocationIntelligence(
  texts: (string | undefined)[],
  places?: unknown
): LocationIntelligence {
  const candidates = texts.map(str).filter(Boolean);
  const joined = candidates.join(' \n ');

  const city = cityOfAddress(joined);
  const district = districtOfAddress(joined);
  const street = candidates.map(streetOf).find(Boolean);

  const known = district ? AREAS[district] : undefined;

  return {
    city,
    district,
    street,
    profile: known && district ? { district, ...known } : undefined,
    nearby: nearbyPlaces(places),
    minimal: !city && !district && !street,
  };
}
