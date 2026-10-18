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

const PARKING_WORDS = /parking|garage|паркинг|парковк|парковочн|машиноместо|гараж|პარკინგ|ავტოსადგომ|ავტოფარეხ|garaj|otopark|موقف|كراج|مرآب|חניה|חנייה/iu;

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
 * PROPERTY TAXONOMY (owner, 2026-10-18: "every property type, not just apartments"). Within a
 * family people ask for the specific thing — a studio, a villa, an office, a café, a warehouse,
 * farmland — so search phrases name it and qualification compares it. One table, extended here
 * and nowhere else; the database keeps its own `property_type` values (no schema change): a
 * subtype comes from the stored type (VILLA, OFFICE, PENTHOUSE, STUDIO, TOWNHOUSE) or, for the
 * generic types, from the listing title, the same way parking is. Unknown → null → the family.
 *
 * `group` decides compatibility (subtypeRelation): the same group is the same demand (warehouse
 * ≈ production hall); in a HARD family (commercial, land) another group is a material
 * contradiction — an office seeker is not a warehouse tenant, a farmland buyer not an industrial
 * plot buyer — while street-level premises (shop / café / salon) are NEAR, never rejected and
 * never Strong. In a SOFT family (apartment, house, parking) a different subtype only keeps a
 * lead from Strong. Every noun reads as its family to the demand classifier (tested), so a
 * phrase built from it is recognised as a seeker.
 */
type Lang = 'ka' | 'ru' | 'en' | 'ar' | 'he' | 'tr';
type Words = Record<Lang, string>;

export type PropertySubtype =
  | 'STUDIO' | 'PENTHOUSE' | 'DUPLEX'
  | 'VILLA' | 'COTTAGE' | 'TOWNHOUSE'
  | 'AGRICULTURAL' | 'COMMERCIAL_LAND' | 'INDUSTRIAL_LAND'
  | 'OFFICE' | 'RETAIL' | 'FOOD' | 'HOTEL' | 'MEDICAL' | 'BEAUTY' | 'FITNESS' | 'EDUCATION' | 'WAREHOUSE' | 'INDUSTRIAL'
  | 'GARAGE';

export interface SubtypeDef {
  key: PropertySubtype;
  family: PropertyFamily;
  /** Same group = the same demand. */
  group: string;
  /** How a title or a request names it, all six languages. */
  detect: RegExp;
  /** The object form a request uses ("ვეძებ საწყობს", "сниму склад"). */
  noun: Words;
  /** The nominative a listing or group name uses ("იყიდება საწყობი", "склады"). */
  nom: Words;
}

const W = (ka: string, ru: string, en: string, ar: string, he: string, tr: string): Words => ({ ka, ru, en, ar, he, tr });
const NB = '(?<![\\p{L}])';
const NA = '(?![\\p{L}])';
const R = (parts: string[]) => new RegExp(parts.join('|'), 'iu');

/* Order matters inside a family: the first match names a title ("industrial warehouse" is storage). */
export const SUBTYPES: readonly SubtypeDef[] = [
  { key: 'STUDIO', family: 'APARTMENT', group: 'STUDIO',
    detect: R(['სტუდიო', 'студи[яюйи]', `${NB}studio${NA}`, 'stüdyo', 'ستوديو', 'סטודיו']),
    noun: W('სტუდიო ბინას', 'квартиру-студию', 'studio apartment', 'شقة ستوديو', 'דירת סטודיו', 'stüdyo daire'),
    nom: W('სტუდიო ბინა', 'квартира-студия', 'studio apartment', 'شقة ستوديو', 'דירת סטודיו', 'stüdyo daire') },
  { key: 'PENTHOUSE', family: 'APARTMENT', group: 'PENTHOUSE',
    detect: R(['პენტჰაუს', 'пентхаус', 'penthouse', 'çatı katı', 'بنتهاوس', 'פנטהאוז', 'פנטהאוס']),
    noun: W('პენტჰაუსს', 'пентхаус', 'penthouse', 'شقة بنتهاوس', 'פנטהאוז', 'çatı katı daire'),
    nom: W('პენტჰაუსი', 'пентхаус', 'penthouse', 'شقة بنتهاوس', 'פנטהאוז', 'çatı katı daire') },
  { key: 'DUPLEX', family: 'APARTMENT', group: 'DUPLEX',
    detect: R(['დუპლექს', 'დუპლექ', 'დონიან ბინ', 'дуплекс', 'двухуровнев', 'трехуровнев', 'трёхуровнев', `${NB}(duplex|triplex)`, 'dubleks', 'tripleks', 'دوبلكس', 'דופלקס']),
    noun: W('დუპლექს ბინას', 'двухуровневую квартиру', 'duplex apartment', 'شقة دوبلكس', 'דירת דופלקס', 'dubleks daire'),
    nom: W('დუპლექს ბინა', 'двухуровневая квартира', 'duplex apartment', 'شقة دوبلكس', 'דירת דופלקס', 'dubleks daire') },

  { key: 'TOWNHOUSE', family: 'HOUSE', group: 'TOWNHOUSE',
    detect: R(['თაუნჰაუს', 'таунхаус', 'townhouse', 'town house', 'sıra ev', 'تاون هاوس', 'בית טורי', 'קוטג\' טורי']),
    noun: W('თაუნჰაუსს', 'таунхаус', 'townhouse', 'منزل تاون هاوس', 'בית טורי', 'sıra ev'),
    nom: W('თაუნჰაუსი', 'таунхаус', 'townhouse', 'منزل تاون هاوس', 'בית טורי', 'sıra ev') },
  { key: 'COTTAGE', family: 'HOUSE', group: 'COTTAGE',
    detect: R(['აგარაკ', 'კოტეჯ', 'дач[аиуеё]', 'дачн', 'коттедж', `${NB}(cottage|chalet|bungalow|cabin|farmhouse|summer house)`, 'yazlık', 'dağ evi', 'bungalov', 'شاليه', 'كوخ', 'منزل ريفي', 'קוטג', 'צימר']),
    noun: W('აგარაკს', 'коттедж', 'cottage', 'منزل ريفي', 'בית קוטג׳', 'müstakil yazlık ev'),
    nom: W('აგარაკი', 'коттедж', 'cottage', 'منزل ريفي', 'בית קוטג׳', 'müstakil yazlık ev') },
  { key: 'VILLA', family: 'HOUSE', group: 'VILLA',
    detect: R(['ვილა', 'вилл', `${NB}villa`, 'فيلا', 'וילה']),
    noun: W('ვილა-სახლს', 'дом-виллу', 'villa', 'فيلا', 'וילה', 'villa'),
    nom: W('ვილა-სახლი', 'дом-вилла', 'villa', 'فيلا', 'וילה', 'villa') },

  { key: 'COMMERCIAL_LAND', family: 'LAND', group: 'LAND_COMMERCIAL',
    detect: R(['კომერციული (მიწ|ნაკვეთ|დანიშნულ)', 'коммерческ\\S* (земл|земельн|участ|назначен)', 'commercial (land|plot)', 'land for (business|commercial)', 'ticari (arsa|arazi)', 'أرض تجارية', 'קרקע מסחרית', 'מגרש מסחרי']),
    noun: W('კომერციული დანიშნულების მიწის ნაკვეთს', 'коммерческий земельный участок', 'commercial land plot', 'أرض تجارية', 'מגרש מסחרי', 'ticari arsa'),
    nom: W('კომერციული დანიშნულების მიწის ნაკვეთი', 'коммерческий земельный участок', 'commercial land plot', 'أرض تجارية', 'מגרש מסחרי', 'ticari arsa') },
  { key: 'INDUSTRIAL_LAND', family: 'LAND', group: 'LAND_INDUSTRIAL',
    detect: R(['სამრეწველო', 'ინდუსტრიულ', 'ლოჯისტიკ', 'промышленн', 'промназнач', 'логистич', 'industrial (land|plot|zone)', 'logistics (land|plot)', 'sanayi (arsası|arazisi)', 'أرض صناعية', 'קרקע תעשייתית', 'מגרש תעשייתי']),
    noun: W('სამრეწველო მიწის ნაკვეთს', 'промышленный земельный участок', 'industrial land plot', 'أرض صناعية', 'מגרש תעשייתי', 'sanayi arsası'),
    nom: W('სამრეწველო მიწის ნაკვეთი', 'промышленный земельный участок', 'industrial land plot', 'أرض صناعية', 'מגרש תעשייתי', 'sanayi arsası') },
  { key: 'AGRICULTURAL', family: 'LAND', group: 'LAND_FARM',
    detect: R(['სასოფლო', 'ვენახ', 'ბაღ(?:ი|ს)', 'სახნავ', 'сельхоз', 'сельскохоз', 'фермер', 'виноградник', 'сад(?:ов)?(?:ый|ого)? участ', 'пашн', `${NB}(farmland|farm land|agricultur\\S*|orchard|vineyard|arable)`, 'tarım', 'tarla', 'bağ arazisi', 'زراع', 'مزرعة', 'חקלא', 'כרם', 'מטע']),
    noun: W('სასოფლო-სამეურნეო მიწის ნაკვეთს', 'сельхоз участок', 'agricultural land', 'أرض زراعية', 'מגרש חקלאי', 'tarım arsası'),
    nom: W('სასოფლო-სამეურნეო მიწის ნაკვეთი', 'сельхоз участок', 'agricultural land', 'أرض زراعية', 'מגרש חקלאי', 'tarım arsası') },

  { key: 'WAREHOUSE', family: 'COMMERCIAL', group: 'STORAGE',
    detect: R(['საწყობ', 'სამაცივრე', 'склад', 'холодильн\\S* (камер|склад)', 'логистическ\\S* (центр|комплекс)', 'warehouse', 'cold storage', 'distribution (center|centre)', 'storage facility', 'depo(?![\\p{L}]*z)', 'antrepo', 'مستودع', 'مخزن', 'מחסן', 'מרלו"ג']),
    noun: W('საწყობს', 'склад', 'warehouse', 'مستودع', 'מחסן', 'depo'),
    nom: W('საწყობი', 'склад', 'warehouse', 'مستودع', 'מחסן', 'depo') },
  { key: 'INDUSTRIAL', family: 'COMMERCIAL', group: 'STORAGE',
    detect: R(['საწარმო', 'ქარხან', 'სახელოსნო', 'ანგარ', 'производств', 'завод', '(?<![\\p{L}])цех', 'ангар', 'мастерск', `${NB}(industrial|factory|workshop|hangar|production (hall|facility|premises))`, 'fabrika', 'atölye', 'imalathane', 'sanayi', 'مصنع', 'صناعي', 'ورشة', 'מפעל', 'תעשי', 'סדנה']),
    noun: W('საწარმოო ფართს', 'производственное помещение', 'industrial warehouse space', 'مستودع صناعي', 'מחסן תעשייתי', 'sanayi deposu'),
    nom: W('საწარმოო ფართი', 'производственное помещение', 'industrial warehouse space', 'مستودع صناعي', 'מחסן תעשייתי', 'sanayi deposu') },
  { key: 'HOTEL', family: 'COMMERCIAL', group: 'HOSPITALITY',
    detect: R(['სასტუმრო', 'ჰოსტელ', 'საოჯახო სასტუმრო', 'гостиниц', 'отел[ья]', 'хостел', 'гостев\\S* дом', `${NB}(hotel|hostel|guest ?house|boutique hotel)`, `${NB}otel${NA}`, 'pansiyon', 'فندق', 'نزل', 'מלון', 'אכסניה']),
    noun: W('სასტუმროს შენობას', 'здание под гостиницу', 'hotel building', 'مبنى فندق', 'בניין למלון', 'otel binası'),
    nom: W('სასტუმროს შენობა', 'здание под гостиницу', 'hotel building', 'مبنى فندق', 'בניין למלון', 'otel binası') },
  { key: 'FOOD', family: 'COMMERCIAL', group: 'FOOD',
    detect: R(['რესტორ', 'კაფე', 'ресторан', '(?<![\\p{L}])кафе', `${NB}(restaurant|caf[eé]|coffee shop|bakery)`, 'restoran', `${NB}kafe`, 'مطعم', 'مقهى', 'מסעדה', 'בית קפה']),
    noun: W('ფართს რესტორნისთვის', 'помещение под кафе', 'restaurant premises', 'محل لمطعم', 'שטח מסחרי למסעדה', 'restoran için dükkan'),
    nom: W('ფართი რესტორნისთვის', 'помещение под кафе', 'restaurant premises', 'محل لمطعم', 'שטח מסחרי למסעדה', 'restoran için dükkan') },
  { key: 'BEAUTY', family: 'COMMERCIAL', group: 'BEAUTY',
    detect: R(['სილამაზის სალონ', 'სალონ', 'салон красоты', 'парикмахерск', 'beauty salon', `${NB}(salon|barbershop)`, 'güzellik salonu', 'kuaför', 'صالون', 'סלון יופי', 'מספרה']),
    noun: W('ფართს სილამაზის სალონისთვის', 'помещение под салон красоты', 'beauty salon premises', 'محل لصالون تجميل', 'שטח מסחרי לסלון יופי', 'güzellik salonu için dükkan'),
    nom: W('ფართი სილამაზის სალონისთვის', 'помещение под салон красоты', 'beauty salon premises', 'محل لصالون تجميل', 'שטח מסחרי לסלון יופי', 'güzellik salonu için dükkan') },
  { key: 'RETAIL', family: 'COMMERCIAL', group: 'RETAIL',
    detect: R(['მაღაზი', 'ობიექტი ქუჩის', 'შოურუმ', 'ბუტიკ', 'магазин', 'торгов', 'шоурум', 'шоу-рум', 'витрин', 'retail', 'showroom', 'storefront', `${NB}(shop|store)${NA}`, 'dükkan', 'mağaza', 'محل', 'متجر', 'معرض', 'חנות', 'אולם תצוגה']),
    noun: W('მაღაზიის ფართს', 'помещение под магазин', 'retail shop', 'محل تجاري', 'חנות', 'dükkan'),
    nom: W('მაღაზიის ფართი', 'помещение под магазин', 'retail shop', 'محل تجاري', 'חנות', 'dükkan') },
  { key: 'MEDICAL', family: 'COMMERCIAL', group: 'MEDICAL',
    detect: R(['კლინიკ', 'სამედიცინო', 'стоматолог', 'клиник', 'медицинск\\S* (центр|кабинет|помещен)', `${NB}(clinic|medical (center|centre|office|premises)|dental)`, 'klinik', 'muayenehane', 'عيادة', 'مركز طبي', 'מרפאה']),
    noun: W('ფართს კლინიკისთვის', 'помещение под клинику', 'medical clinic premises', 'محل لعيادة', 'שטח מסחרי למרפאה', 'klinik için işyeri'),
    nom: W('ფართი კლინიკისთვის', 'помещение под клинику', 'medical clinic premises', 'محل لعيادة', 'שטח מסחרי למרפאה', 'klinik için işyeri') },
  { key: 'FITNESS', family: 'COMMERCIAL', group: 'FITNESS',
    detect: R(['ფიტნეს', 'სპორტ(ული)? დარბაზ', 'спортзал', 'фитнес', 'тренажерн', `${NB}(gym|fitness)`, 'spor salonu', 'صالة رياضية', 'نادي رياضي', 'חדר כושר', 'מכון כושר']),
    noun: W('ფართს ფიტნეს დარბაზისთვის', 'помещение под спортзал', 'gym premises', 'محل لصالة رياضية', 'שטח מסחרי לחדר כושר', 'spor salonu için işyeri'),
    nom: W('ფართი ფიტნეს დარბაზისთვის', 'помещение под спортзал', 'gym premises', 'محل لصالة رياضية', 'שטח מסחרי לחדר כושר', 'spor salonu için işyeri') },
  { key: 'EDUCATION', family: 'COMMERCIAL', group: 'EDUCATION',
    detect: R(['საბავშვო ბაღისთვის', 'სასწავლო ცენტრ', 'под (школу|детский сад|учебн)', 'учебн\\S* центр', `${NB}(kindergarten|school premises|education(al)? (center|centre|premises))`, 'kreş', 'okul binası', 'eğitim merkezi', 'حضانة', 'مركز تعليمي', 'גן ילדים', 'מרכז לימוד']),
    noun: W('ფართს სასწავლო ცენტრისთვის', 'помещение под учебный центр', 'educational premises', 'محل لمركز تعليمي', 'שטח מסחרי למרכז לימוד', 'eğitim merkezi için işyeri'),
    nom: W('ფართი სასწავლო ცენტრისთვის', 'помещение под учебный центр', 'educational premises', 'محل لمركز تعليمي', 'שטח מסחרי למרכז לימוד', 'eğitim merkezi için işyeri') },
  { key: 'OFFICE', family: 'COMMERCIAL', group: 'OFFICE',
    detect: R(['ოფის', 'ქოვორქინგ', 'офис', 'коворкинг', `${NB}(office|coworking|co-working)`, 'ofis', 'مكتب', 'משרד']),
    noun: W('საოფისე ფართს', 'офис', 'office', 'مكتب', 'משרד', 'ofis'),
    nom: W('საოფისე ფართი', 'офис', 'office', 'مكتب', 'משרד', 'ofis') },

  { key: 'GARAGE', family: 'PARKING', group: 'GARAGE',
    detect: R(['ავტოფარეხ', 'гараж', `${NB}garage`, 'garaj', 'كراج', 'مرآب', 'חניה סגורה', 'חנייה סגורה']),
    noun: W('ავტოფარეხს', 'гараж', 'garage', 'مرآب', 'חניה סגורה', 'garaj'),
    nom: W('ავტოფარეხი', 'гараж', 'garage', 'مرآب', 'חניה סגורה', 'garaj') },
];

const SUBTYPE_BY_KEY = new Map(SUBTYPES.map((d) => [d.key, d]));
/** Stored `property_type` values that already are a subtype. */
const TYPE_SUBTYPE: Record<string, PropertySubtype> = { VILLA: 'VILLA', OFFICE: 'OFFICE', PENTHOUSE: 'PENTHOUSE', STUDIO: 'STUDIO', TOWNHOUSE: 'TOWNHOUSE' };
/** A different group here is a material contradiction; elsewhere it only keeps a lead from Strong. */
const HARD_FAMILIES: ReadonlySet<PropertyFamily> = new Set(['COMMERCIAL', 'LAND']);
/** Groups close enough to share demand in a hard family: street-level premises. */
const NEAR_GROUPS: ReadonlyArray<ReadonlySet<string>> = [new Set(['RETAIL', 'FOOD', 'BEAUTY']), new Set(['LAND_COMMERCIAL', 'LAND_INDUSTRIAL'])];

export function subtypeDef(key: PropertySubtype | null | undefined): SubtypeDef | null {
  return key ? SUBTYPE_BY_KEY.get(key) ?? null : null;
}

/** Every subtype a text names within a family (a demand can name "office or shop"). */
export function statedSubtypes(family: PropertyFamily | null, text: string | null | undefined): PropertySubtype[] {
  const t = String(text ?? '');
  if (!family || !t) return [];
  return SUBTYPES.filter((d) => d.family === family && d.detect.test(t)).map((d) => d.key);
}

export function propertySubtype(propertyType: string | null | undefined, title?: string | null): PropertySubtype | null {
  const t = String(propertyType ?? '').toUpperCase();
  if (TYPE_SUBTYPE[t]) return TYPE_SUBTYPE[t];
  const family = propertyFamily(propertyType, title);
  return statedSubtypes(family, title)[0] ?? null;
}

/**
 * The property's subtype against the subtypes a seeker STATED. MATCH: one is the same demand.
 * CONFLICT: a material contradiction (hard family, other group). SOFT: a different subtype that
 * is not a contradiction (a soft family, or near groups). UNKNOWN: either side unstated.
 */
export function subtypeRelation(own: PropertySubtype | null | undefined, stated: readonly PropertySubtype[]): 'MATCH' | 'SOFT' | 'CONFLICT' | 'UNKNOWN' {
  const o = subtypeDef(own);
  const s = stated.map(subtypeDef).filter((d): d is SubtypeDef => d != null && (!o || d.family === o.family));
  if (!o || !s.length) return 'UNKNOWN';
  if (s.some((d) => d.group === o.group)) return 'MATCH';
  if (!HARD_FAMILIES.has(o.family)) return 'SOFT';
  return s.some((d) => NEAR_GROUPS.some((g) => g.has(d.group) && g.has(o.group))) ? 'SOFT' : 'CONFLICT';
}

/** Each subtype's name in a request, in every search language (kept for callers of v9). */
export const SUBTYPE_NOUN = Object.fromEntries(SUBTYPES.map((d) => [d.key, d.noun])) as Record<PropertySubtype, Words>;

/** The noun a search phrase uses: the subtype's when known, else the family's. */
export function propertyNoun(family: PropertyFamily, subtype: PropertySubtype | null | undefined, lang: Lang): string {
  const d = subtypeDef(subtype);
  return (d && d.family === family && d.noun[lang]) || FAMILY_NOUN[family][lang];
}

/** The nominative: a listing headline or a group name ("იყიდება საწყობი"). */
export const FAMILY_NOM: Record<PropertyFamily, Words> = {
  APARTMENT: W('ბინა', 'квартира', 'apartment', 'شقة', 'דירה', 'daire'),
  HOUSE: W('სახლი', 'дом', 'house', 'منزل', 'בית', 'müstakil ev'),
  LAND: W('მიწის ნაკვეთი', 'земельный участок', 'land plot', 'أرض', 'מגרש', 'arsa'),
  COMMERCIAL: W('კომერციული ფართი', 'коммерческое помещение', 'commercial space', 'محل تجاري', 'שטח מסחרי', 'işyeri'),
  PARKING: W('პარკინგის ადგილი', 'парковочное место', 'parking space', 'موقف سيارة', 'חניה', 'otopark yeri'),
};
export function propertyNom(family: PropertyFamily, subtype: PropertySubtype | null | undefined, lang: Lang): string {
  const d = subtypeDef(subtype);
  return (d && d.family === family && d.nom[lang]) || FAMILY_NOM[family][lang];
}

/** Where a family's market gathers (group searches): the plural people name their groups with. */
/** "Real estate in <city>": the one group search every family shares. */
export const REAL_ESTATE_IN: Record<Lang, (city: string) => string> = {
  ka: (c) => `უძრავი ქონება ${c}`, ru: (c) => `недвижимость ${c}`, en: (c) => `real estate ${c}`,
  ar: (c) => `عقارات ${c}`, he: (c) => `נדל"ן ${c}`, tr: (c) => `${c} emlak`,
};

export const FAMILY_MARKET: Record<PropertyFamily, Words> = {
  APARTMENT: W('ბინები', 'квартиры', 'apartments', 'شقق', 'דירות', 'satılık daireler'),
  HOUSE: W('სახლები და აგარაკები', 'дома и коттеджи', 'houses', 'منازل', 'בתים', 'müstakil evler'),
  LAND: W('მიწის ნაკვეთები', 'земельные участки', 'land plots', 'أراضي', 'מגרשים', 'arsalar'),
  COMMERCIAL: W('კომერციული ფართები', 'коммерческая недвижимость', 'commercial real estate', 'عقارات تجارية', 'נדל"ן מסחרי', 'ticari gayrimenkul'),
  PARKING: W('პარკინგები და ავტოფარეხები', 'гаражи и парковки', 'parking and garages', 'مواقف سيارات', 'חניות', 'otopark'),
};

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
