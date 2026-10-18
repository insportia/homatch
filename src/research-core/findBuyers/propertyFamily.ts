// PROPERTY FAMILY — what kind of place a search is for, in the five families a
// buyer or tenant actually asks for: an apartment, a house, land, commercial space
// or a parking place. Pure; shared by the strategy, the query planner, the model
// planner and qualification so that all four agree.
//
// THE DEFECT THIS CLOSES (2026-10-12). Every phrase the engine searched with was an
// apartment phrase ("ვყიდულობ ბინას", "куплю квартиру"), and the type gate compared
// only HOUSE vs APARTMENT. A land plot or a shop was searched for with apartment
// queries, and an apartment seeker matched to it was kept as a WEAK lead and shown
// to the customer. Parking had no family at all: `property_type` has no PARKING
// value, so a parking place is stored as OTHER and recognised from its title.

export type PropertyFamily = 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | 'PARKING';

const PARKING_WORDS = /parking|garage|паркинг|парковк|парковочн|машиноместо|гараж|პარკინგ|ავტოსადგომ|ავტოფარეხ|garaj|otopark|موقف|كراج|חניה|חנייה/iu;

/** The family of a stored property type (the `property_type` enum), parking read from the title. */
export function propertyFamily(propertyType: string | null | undefined, title?: string | null): PropertyFamily {
  const t = String(propertyType ?? '').toUpperCase();
  if (t === 'PARKING' || (PARKING_WORDS.test(String(title ?? '')) && (t === 'OTHER' || t === 'COMMERCIAL' || t === ''))) return 'PARKING';
  if (t === 'HOUSE' || t === 'VILLA' || t === 'TOWNHOUSE') return 'HOUSE';
  if (t === 'LAND') return 'LAND';
  if (t === 'COMMERCIAL' || t === 'OFFICE') return 'COMMERCIAL';
  return 'APARTMENT';
}

export function isParkingText(text: string): boolean {
  return PARKING_WORDS.test(text);
}

/** How people name the family in each search language, in the accusative/object form a request uses. */
export const FAMILY_NOUN: Record<PropertyFamily, Record<'ka' | 'ru' | 'en' | 'ar' | 'he' | 'tr', string>> = {
  APARTMENT: { ka: 'ბინას', ru: 'квартиру', en: 'apartment', ar: 'شقة', he: 'דירה', tr: 'daire' },
  HOUSE: { ka: 'სახლს', ru: 'дом', en: 'house', ar: 'منزل', he: 'בית', tr: 'müstakil ev' },
  LAND: { ka: 'მიწის ნაკვეთს', ru: 'земельный участок', en: 'land plot', ar: 'أرض', he: 'מגרש', tr: 'arsa' },
  COMMERCIAL: { ka: 'კომერციულ ფართს', ru: 'коммерческое помещение', en: 'commercial space', ar: 'محل تجاري', he: 'שטח מסחרי', tr: 'işyeri' },
  PARKING: { ka: 'პარკინგის ადგილს', ru: 'парковочное место', en: 'parking space', ar: 'موقف سيارة', he: 'חניה', tr: 'otopark yeri' },
};

/*
 * PROPERTY SUBTYPE (owner, 2026-10-18: "every property type, not just apartments"). Within a
 * family, people ask for the specific thing — a villa, an office, a shop, a warehouse, farmland
 * — so search phrases name it. The subtype only changes the WORDS searched; qualification and
 * matching keep comparing families (a warehouse seeker is a COMMERCIAL seeker), unchanged.
 * Read from the stored type (VILLA, OFFICE …) or, for the generic types, the listing title,
 * the same way parking is. Unknown → null → the family noun. Extend here, nowhere else.
 */
export type PropertySubtype = 'VILLA' | 'COTTAGE' | 'OFFICE' | 'RETAIL' | 'WAREHOUSE' | 'INDUSTRIAL' | 'AGRICULTURAL';

const SUBTYPE_WORDS: ReadonlyArray<[PropertySubtype, PropertyFamily, RegExp]> = [
  ['AGRICULTURAL', 'LAND', /სასოფლო|ვენახ|ბაღ(?:ი|ს)|сельхоз|сельскохоз|фермер|виноградник|farmland|agricultur|orchard|vineyard|tarım|tarla|زراع|חקלא/iu],
  ['WAREHOUSE', 'COMMERCIAL', /საწყობ|склад|warehouse|depo(?![\p{L}]*z)|مستودع|מחסן/iu],
  ['INDUSTRIAL', 'COMMERCIAL', /საწარმო|ქარხან|производств|завод|цех|industrial|factory|fabrika|sanayi|مصنع|صناعي|מפעל|תעשי/iu],
  ['RETAIL', 'COMMERCIAL', /მაღაზი|ობიექტი ქუჩის|магазин|торгов|retail|(?<![\p{L}])(shop|store)(?![\p{L}])|dükkan|mağaza|محل|متجر|חנות/iu],
  ['OFFICE', 'COMMERCIAL', /ოფის|офис|(?<![\p{L}])office|ofis|مكتب|משרד/iu],
  ['COTTAGE', 'HOUSE', /აგარაკ|дача|дачу|коттедж|cottage|yazlık|كوخ|קוטג/iu],
  ['VILLA', 'HOUSE', /ვილა|вилл|(?<![\p{L}])villa|فيلا|וילה/iu],
];

export function propertySubtype(propertyType: string | null | undefined, title?: string | null): PropertySubtype | null {
  const t = String(propertyType ?? '').toUpperCase();
  if (t === 'VILLA') return 'VILLA';
  if (t === 'OFFICE') return 'OFFICE';
  const family = propertyFamily(propertyType, title);
  const text = String(title ?? '');
  if (!text) return null;
  for (const [sub, fam, re] of SUBTYPE_WORDS) if (fam === family && re.test(text)) return sub;
  return null;
}

/** Each subtype's name in a request, in every search language. Each still reads as its family
 *  to the demand classifier (house / land / commercial words), so a seeker is recognised. */
export const SUBTYPE_NOUN: Record<PropertySubtype, Record<'ka' | 'ru' | 'en' | 'ar' | 'he' | 'tr', string>> = {
  VILLA: { ka: 'ვილა-სახლს', ru: 'дом-виллу', en: 'villa', ar: 'فيلا', he: 'וילה', tr: 'villa' },
  COTTAGE: { ka: 'აგარაკს', ru: 'коттедж', en: 'cottage', ar: 'منزل ريفي', he: 'בית קוטג׳', tr: 'müstakil yazlık ev' },
  OFFICE: { ka: 'საოფისე ფართს', ru: 'офис', en: 'office', ar: 'مكتب', he: 'משרד', tr: 'ofis' },
  RETAIL: { ka: 'მაღაზიის ფართს', ru: 'помещение под магазин', en: 'retail shop', ar: 'محل تجاري', he: 'חנות', tr: 'dükkan' },
  WAREHOUSE: { ka: 'საწყობს', ru: 'склад', en: 'warehouse', ar: 'مستودع', he: 'מחסן', tr: 'depo' },
  INDUSTRIAL: { ka: 'საწარმოო კომერციულ ფართს', ru: 'производственное помещение', en: 'industrial warehouse space', ar: 'مستودع صناعي', he: 'מחסן תעשייתי', tr: 'sanayi deposu' },
  AGRICULTURAL: { ka: 'სასოფლო-სამეურნეო მიწის ნაკვეთს', ru: 'сельхоз участок', en: 'agricultural land', ar: 'أرض زراعية', he: 'מגרש חקלאי', tr: 'tarım arsası' },
};

/** The noun a search phrase uses: the subtype's when known, else the family's. */
export function propertyNoun(family: PropertyFamily, subtype: PropertySubtype | null | undefined, lang: 'ka' | 'ru' | 'en' | 'ar' | 'he' | 'tr'): string {
  return (subtype && SUBTYPE_NOUN[subtype]?.[lang]) || FAMILY_NOUN[family][lang];
}

/*
 * Not an apartment: a house, land, commercial space or a parking place. Apartment
 * phrasings ("ვყიდულობ ბინას", "куплю квартиру") found apartment seekers for a land
 * plot. These carry the same explicit purchase / rental verbs with the family's own
 * noun (FAMILY_NOUN), two per language.
 */
type FQ = (v: { noun: string; place: string; city: string }) => string;
/** English article for a noun: "an office", "a villa", none for uncountable land. */
const enArticle = (noun: string) => (/land$/i.test(noun) ? '' : /^[aeiou]/i.test(noun) ? 'an ' : 'a ');
export const FAMILY_BUY: Record<'ka' | 'ru' | 'en' | 'ar' | 'he' | 'tr', FQ[]> = {
  ka: [({ noun, place }) => `ვყიდულობ ${noun} ${place}`, ({ noun, city }) => `ვიყიდი ${noun} ${city}`],
  ru: [({ noun, place }) => `куплю ${noun} ${place}`, ({ noun, city }) => `хочу купить ${noun} в ${city}`],
  en: [({ noun, place }) => `looking to buy ${enArticle(noun)}${noun} in ${place}`, ({ noun, city }) => `want to buy ${noun} ${city}`],
  ar: [({ noun, city }) => `أبحث عن ${noun} للشراء في ${city}`, ({ noun, city }) => `أريد شراء ${noun} في ${city}`],
  he: [({ noun, city }) => `מחפש ${noun} לקנייה ב${city}`, ({ noun, city }) => `רוצה לקנות ${noun} ב${city}`],
  tr: [({ noun, city }) => `${city} ${noun} almak istiyorum`, ({ noun, city }) => `${city} ${noun} satın almak istiyorum`],
};
export const FAMILY_RENT: Record<'ka' | 'ru' | 'en' | 'ar' | 'he' | 'tr', FQ[]> = {
  ka: [({ noun, place }) => `ვიქირავებ ${noun} ${place}`, ({ noun, city }) => `ვეძებ ${noun} ქირით ${city}`],
  ru: [({ noun, place }) => `сниму ${noun} ${place}`, ({ noun, city }) => `ищу ${noun} в аренду ${city}`],
  en: [({ noun, place }) => `looking to rent ${enArticle(noun)}${noun} in ${place}`, ({ noun, city }) => `want to rent ${enArticle(noun)}${noun} in ${city}`],
  ar: [({ noun, city }) => `أبحث عن ${noun} للإيجار في ${city}`, ({ noun, city }) => `أريد استئجار ${noun} في ${city}`],
  he: [({ noun, city }) => `מחפש ${noun} להשכרה ב${city}`, ({ noun, city }) => `רוצה לשכור ${noun} ב${city}`],
  tr: [({ noun, city }) => `${city} ${noun} kiralamak istiyorum`, ({ noun, city }) => `${city} ${noun} kiralamak için arıyorum`],
};
