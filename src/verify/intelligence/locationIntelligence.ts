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

    const note = typeof e.note === 'string' && e.note.trim() ? e.note.trim() : null;
    out.push({ category, name, note, whyKey: PLACE_WHY_KEYS[category] });
  }

  return out.sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  );
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
