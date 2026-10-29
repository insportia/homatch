// HOMATCH MARKETPLACE SEARCH — the deterministic query engine.
//
// Find Property reads a customer's sentence WITHOUT A MODEL (owner, 2026-10-29:
// zero AI calls anywhere on the search path, fallbacks included). This module
// turns free text in Georgian, English, Russian, Turkish, Arabic or Hebrew into
// the exact reading the Search Intelligence Brief expects, and hands it to the
// same gate the model's output used to pass (`briefFromModel`): every value
// comes out of a closed vocabulary or is absent, numbers are kept STATED only
// when they are traceable to the customer's digits, building age, finishing
// condition and numeric floors are read by the existing intent readers.
//
// WHAT IT READS
//
//   transaction    buy / monthly rent / daily rent, by verbs, nouns and price cues
//   property type  apartment, studio, penthouse, house, villa, townhouse, land,
//                  commercial, office
//   places         cities and districts/neighbourhoods (searchPlaces.ts), with
//                  Georgian case endings, Arabic/Hebrew clitics, Turkish suffixes,
//                  multi-word names and small typos (bounded edit distance)
//   price          ranges, ceilings, floors, "around", k / ათასი / тыс / bin /
//                  ألف / אלף / მლნ, USD / GEL / EUR; GEL and EUR are converted to
//                  USD with the supplied rates, never with an invented one
//   area, rooms, bedrooms, bathrooms, vague floors, amenities, furnished, parking
//
// AMBIGUITY IS ASKED, NEVER GUESSED. Conflicting transactions, several property
// types, a price without a currency, a typo that is equally close to two places,
// several cities: each becomes a clarification with ready-made answers (chips)
// and the field stays empty or PROPOSED until the customer picks one.
//
// Pure, total and synchronous: no I/O, no model, no randomness. The same
// sentence gives the same brief tomorrow.

import { foldDigits, readConstraints } from '../intent/constraints.ts';
import type { CurrencyConverter } from '../normalize/currency.ts';
import { type BriefEdit, briefFromModel, type NumericRange, type SearchIntelligenceBrief } from './brief.ts';
import { cityName, SEARCH_PLACES, type SearchPlace } from './searchPlaces.ts';
import type { Amenity, FloorPreference, MarketplacePropertyType, MarketplaceTransaction } from './taxonomy.ts';

export const QUERY_ENGINE_VERSION = 'query-engine-1';

/* ------------------------------------------------------------------ *
 * Output                                                              *
 * ------------------------------------------------------------------ */

export interface ClarificationOption {
  id: string;
  /** An i18n key (with vars) for the chip, or literal text (amounts), or per-language labels (places). */
  labelKey?: string;
  labelVars?: Record<string, string | number>;
  text?: string;
  labels?: Partial<Record<string, string>>;
  /** Applied in order to the brief when the chip is chosen (brief.ts applyEdit). */
  edits: BriefEdit[];
}

export type ClarificationKind = 'transaction' | 'propertyType' | 'currency' | 'place' | 'city';

export interface Clarification {
  id: ClarificationKind;
  /** i18n key of the question. */
  questionKey: string;
  options: ClarificationOption[];
}

export interface QueryUnderstanding {
  brief: SearchIntelligenceBrief;
  clarifications: Clarification[];
  /** The model-shaped reading handed to briefFromModel (tests and admin diagnostics). */
  reading: Record<string, unknown>;
  /** Did the engine read anything searchable at all. */
  understood: boolean;
  /** Typos it corrected: what was written and the place or word it was read as. */
  corrections: Array<{ written: string; read: string }>;
  engine: typeof QUERY_ENGINE_VERSION;
}

/* ------------------------------------------------------------------ *
 * Text helpers                                                        *
 * ------------------------------------------------------------------ */

const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const GEORGIAN = /[Ⴀ-ჿ]/;
const ARABIC = /[؀-ۿ]/;
const HEBREW = /[֐-׿]/;
const CYRILLIC = /[Ѐ-ӿ]/;

/** Lower-case without changing string length (positions stay valid). */
function lowerSameLength(text: string): string {
  return text.replace(/İ/g, 'i').toLowerCase().replace(/ё/g, 'е');
}

/**
 * A term at a word start. `stem*` matches any continuation, a plain term must end
 * at a word boundary. Arabic and Hebrew allow their attached clitics in front.
 */
function termRe(term: string, flags = 'iu'): RegExp {
  const stem = term.endsWith('*');
  const body = stem ? term.slice(0, -1) : term;
  const clitic = ARABIC.test(body[0] ?? '') ? '(?:[وفبلك]|ال|بال|وال|لل|في\\s)?' : HEBREW.test(body[0] ?? '') ? '[והשבלמכ]{0,2}' : '';
  const tail = stem ? '[\\p{L}\\p{M}]*' : GEORGIAN.test(body.slice(-1)) ? '(?:ს|ში|ზე|ით|ად|ის|ც)?' : '';
  const right = /[\p{L}\p{N}]$/u.test(body) ? '(?![\\p{L}\\p{N}])' : '';
  const left = /^[\p{L}\p{N}]/u.test(body) ? '(?<![\\p{L}\\p{N}])' : '';
  return new RegExp(`${left}${clitic}${escapeRe(body)}${tail}${right}`, flags);
}

const RE_CACHE = new Map<string, RegExp>();
const cachedRe = (term: string) => {
  let re = RE_CACHE.get(term);
  if (!re) { re = termRe(term, 'giu'); RE_CACHE.set(term, re); }
  re.lastIndex = 0;
  return re;
};

interface Hit { term: string; index: number; length: number }

function hitsOf(text: string, terms: readonly string[]): Hit[] {
  const out: Hit[] = [];
  for (const term of terms) {
    for (const m of text.matchAll(cachedRe(term))) out.push({ term, index: m.index ?? 0, length: m[0].length });
  }
  return out.sort((a, b) => a.index - b.index);
}

const hasAny = (text: string, terms: readonly string[]) => terms.some((t) => cachedRe(t).test(text));

/** Optimal string alignment distance, bounded: returns limit+1 as soon as it is exceeded. */
export function editDistance(a: string, b: string, limit = 2): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev2: number[] = new Array(b.length + 1).fill(0);
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j];
    prev = cur;
    if (rowMin > limit) return limit + 1;
  }
  return prev[b.length];
}

/** How many typos a word of this length may carry and still be recognised. */
const typoBudget = (length: number) => (length >= 8 ? 2 : length >= 5 ? 1 : 0);

/* ------------------------------------------------------------------ *
 * Vocabulary                                                          *
 * ------------------------------------------------------------------ */

const DAILY = ['დღიურ*', 'დღე-ღამ*', 'დღეღამ*', 'ღამით', 'ღამეში', 'посуточн*', 'на сутки', 'в сутки', 'daily', 'per night', 'a night', '/night', 'nightly', 'short-term', 'short term', 'short stay', 'günlük*', 'gecelik*', 'يومي', 'لليلة', 'بالليلة', 'في الليلة', 'ללילה', 'לטווח קצר', 'יומי*'];
const RENT = ['ქირ*', 'იქირავ*', 'ვიქირავ*', 'დაქირავ*', 'ვქირაობ*', 'аренд*', 'снять', 'сниму', 'снимать', 'съем*', 'сдается', 'сдаётся', 'rent*', 'lease*', 'to let', 'kiralık*', 'kiralam*', 'kiralay*', 'kira', 'kirada', 'إيجار', 'ايجار', 'للإيجار', 'للايجار', 'استئجار', 'أستأجر', 'استأجر', 'לשכור', 'להשכרה', 'שכירות', 'אשכור'];
const MONTHLY = ['თვეში', 'თვიურ*', 'ყოველთვიურ*', 'в месяц', 'в мес', '/мес', 'помесячн*', 'ежемесячн*', 'на длительный срок', 'долгосрочн*', 'per month', 'a month', '/month', '/mo', 'monthly', 'long-term', 'long term', 'aylık*', 'ayda', 'uzun dönem*', 'شهري*', 'في الشهر', 'بالشهر', 'לחודש', 'חודשי*', 'לטווח ארוך'];
const BUY = ['ყიდვ*', 'ვყიდულობ*', 'ვიყიდ*', 'შევიძინ*', 'შესაძენ*', 'საყიდლ*', 'იყიდება', 'გასაყიდ*', 'купить', 'куплю', 'покупк*', 'приобре*', 'продаж*', 'продается', 'продаётся', 'buy', 'buying', 'purchase*', 'for sale', 'to own', 'satın*', 'satılık*', 'almak', 'alacağım', 'شراء', 'أشتري', 'اشتري', 'للبيع', 'للشراء', 'لشراء', 'לקנות', 'אקנה', 'קנייה', 'לרכישה', 'למכירה', 'לרכוש'];
const INVEST = ['ინვესტ*', 'инвест*', 'invest*', 'yatırım*', 'استثمار*', 'للاستثمار', 'השקעה', 'להשקעה'];

const TYPE_TERMS: ReadonlyArray<readonly [MarketplacePropertyType, readonly string[]]> = [
  ['STUDIO', ['სტუდიო*', 'studio*', 'студи*', 'stüdyo*', 'ستوديو', 'סטודיו', '1+0']],
  ['PENTHOUSE', ['პენტჰაუს*', 'პენთჰაუს*', 'penthouse*', 'пентхаус*', 'çatı katı', 'çatı dubleks*', 'بنتهاوس', 'بنت هاوس', 'פנטהאוז', 'פנטהאוס', 'דירת גג']],
  ['TOWNHOUSE', ['თაუნჰაუს*', 'townhouse*', 'town house', 'таунхаус*', 'sıra ev*', 'تاون هاوس', 'קוטג\' טורי', 'בית טורי']],
  ['VILLA', ['ვილა', 'ვილას', 'ვილაში', 'villa*', 'вилл*', 'فيلا', 'فيلّا', 'וילה']],
  ['APARTMENT', ['ბინ*', 'კვარტირ*', 'აპარტამენტ*', 'apartment*', 'apartament*', 'apt', 'flat', 'flats', 'condo*', 'квартир*', 'двушк*', 'трешк*', 'трёшк*', 'однушк*', 'апартамент*', 'daire*', 'شقة', 'شقه', 'شقق', 'دירה', 'דירה', 'דירת', 'דירות']],
  ['HOUSE', ['სახლ*', 'აგარაკ*', 'house', 'houses', 'cottage*', 'дом', 'дома', 'домик*', 'коттедж*', 'дачу', 'дача', 'müstakil*', 'ev', 'evi', 'منزل', 'بيت', 'בית פרטי', 'בית', 'קוטג\'']],
  ['LAND', ['მიწა', 'მიწას', 'მიწის ნაკვეთ*', 'ნაკვეთ*', 'land', 'plot*', 'участ*', 'земл*', 'arsa*', 'arazi*', 'أرض', 'قطعة أرض', 'מגרש', 'קרקע']],
  ['OFFICE', ['ოფის*', 'office*', 'офис*', 'ofis*', 'مكتب', 'משרד']],
  ['COMMERCIAL', ['კომერციულ*', 'მაღაზი*', 'commercial*', 'shop', 'store', 'retail*', 'коммерческ*', 'магазин*', 'dükkan*', 'işyeri*', 'ticari*', 'محل', 'تجاري', 'מסחרי', 'חנות']],
];
/** A house word that only says WHERE a flat is ("in a house", "в доме"). */
const WEAK_HOUSE = ['სახლში', 'доме', 'в доме', 'дома', 'evi', 'בית'];

/** Words a typo can be measured against (Latin and Cyrillic only; Georgian stems are already loose). */
const TYPO_WORDS: ReadonlyArray<readonly [string, 'type' | 'tx', string]> = [
  ['apartment', 'type', 'APARTMENT'], ['penthouse', 'type', 'PENTHOUSE'], ['townhouse', 'type', 'TOWNHOUSE'],
  ['квартира', 'type', 'APARTMENT'], ['квартиру', 'type', 'APARTMENT'], ['пентхаус', 'type', 'PENTHOUSE'], ['коттедж', 'type', 'HOUSE'],
  ['commercial', 'type', 'COMMERCIAL'], ['purchase', 'tx', 'BUY'], ['аренду', 'tx', 'MONTHLY_RENT'], ['аренда', 'tx', 'MONTHLY_RENT'],
  ['купить', 'tx', 'BUY'], ['kiralık', 'tx', 'MONTHLY_RENT'], ['satılık', 'tx', 'BUY'],
];

const AMENITY_TERMS: ReadonlyArray<readonly [Amenity, readonly string[]]> = [
  ['PARKING', ['პარკინგ*', 'ავტოსადგომ*', 'ავტოფარეხ*', 'გარაჟ*', 'парков*', 'паркинг*', 'гараж*', 'машиноместо', 'parking', 'garage', 'otopark*', 'garaj*', 'موقف*', 'باركينج', 'كراج', 'חניה', 'חנייה']],
  ['BALCONY', ['აივან*', 'აივნ*', 'ლოჯი*', 'балкон*', 'лоджи*', 'balcony', 'balconies', 'balkon*', 'شرفة', 'بلكونة', 'בלקון', 'מרפסת']],
  ['TERRACE', ['ტერას*', 'террас*', 'terrace*', 'teras*', 'تراس', 'טרסה']],
  ['ELEVATOR', ['ლიფტ*', 'лифт*', 'elevator*', 'lift', 'asansör*', 'مصعد', 'מעלית']],
  ['GARDEN', ['ეზო*', 'ბაღ*', 'сад', 'садом', 'двор*', 'garden*', 'yard', 'bahçe*', 'حديقة', 'גינה', 'חצר']],
  ['POOL', ['აუზ*', 'бассейн*', 'pool', 'havuz*', 'مسبح', 'בריכה']],
  ['CENTRAL_HEATING', ['ცენტრალური გათბობ*', 'ცენტრალურ გათბობ*', 'центральн* отоплен*', 'central heating', 'merkezi ısıtma', 'kombi*', 'تدفئة مركزية', 'הסקה מרכזית', 'ქვაბ*']],
  ['VIEW', ['ხედით', 'ხედი', 'ხედზე', 'вид на', 'видом', 'view', 'views', 'manzara*', 'إطلالة', 'נוף']],
  ['PET_FRIENDLY', ['შინაური ცხოველ*', 'ძაღლ*', 'с животными', 'с собакой', 'pets', 'pet friendly', 'pet-friendly', 'evcil hayvan*', 'الحيوانات الأليفة', 'חיות מחמד']],
  ['STORAGE', ['სათავს*', 'სარდაფ*', 'кладов*', 'storage', 'depo*', 'مخزن', 'מחסן']],
  ['AIR_CONDITIONING', ['კონდიციონერ*', 'кондиционер*', 'air conditioning', 'air conditioner', 'a/c', 'klima*', 'مكيف', 'מזגן']],
];
const FURNISHED = ['ავეჯით', 'ავეჯიან*', 'მებლირებ*', 'меблир*', 'с мебелью', 'furnished', 'eşyalı', 'mobilyalı', 'مفروشة', 'مفروش', 'מרוהטת', 'מרוהט'];
const UNFURNISHED = ['ავეჯის გარეშე', 'უავეჯო', 'без мебели', 'unfurnished', 'not furnished', 'eşyasız', 'غير مفروشة', 'بدون أثاث', 'לא מרוהטת', 'ללא ריהוט'];

const NEG_BEFORE = /(?:^|[^\p{L}])(?:no|not|without|w\/o|без|не|нет|არ|არა|bez|olmadan|بدون|لا|غير|בלי|ללא|לא)\s+(?:\p{L}+\s+)?$/u;
const NEG_AFTER = /^[\p{L}\p{M}]{0,6}\s*(?:-?ის\s+)?(?:გარეშე|არ\s+მინდა|არ\s+მჭირდება|არ\s+არის\s+საჭირო|не\s+нуж\p{L}*|не\s+надо|olmasın|istemiyorum|gerekmez|değil|غير\s+مطلوب|לא\s+צריך)/u;
const PREFERRED = ['სასურველ*', 'კარგი იქნება', 'კარგი იქნებოდა', 'მირჩევნია', 'უკეთესია', 'ჯობია', 'თუ შეიძლება', 'желательно', 'предпочтительно', 'лучше', 'хорошо бы', 'preferably', 'ideally', 'prefer*', 'nice to have', 'would be nice', 'if possible', 'tercihen', 'olursa iyi', 'mümkünse', 'يفضل', 'ويفضل', 'إن أمكن', 'עדיף', 'רצוי', 'אם אפשר'];

const STREET_AFTER = /^[\s-]*(?:ქუჩ\p{L}*|ქ\.|გამზირ\p{L}*|ხეივან\p{L}*|street|str\.?|st\.|avenue|ave\.?|улиц\p{L}*|ул\.|проспект\p{L}*|caddesi|cad\.|sokak|sokağı|bulvarı)/u;
const STREET_BEFORE = /(?:ул\.?|улиц[аеуы]|проспект[ае]?|пр-т|street|شارع|רחוב|רח')\s*$/u;
const NEAR_METRO = ['მეტროსთან', 'მეტროს ახლოს', 'მეტროსთან ახლოს', 'near metro', 'near the metro', 'close to metro', 'рядом с метро', 'возле метро', 'у метро', 'metroya yakın', 'قرب المترو', 'ליד המטרו', 'ליד הרכבת התחתית'];
const NEAR_SEA = ['ზღვასთან', 'ზღვის პირას', 'near the sea', 'sea view', 'у моря', 'рядом с морем', 'denize yakın', 'قرب البحر', 'ליד הים'];

/* ------------------------------------------------------------------ *
 * Places                                                              *
 * ------------------------------------------------------------------ */

const GEO_SUFFIXES = ['ისკენ', 'იდან', 'ამდე', 'ებში', 'ებზე', 'ებთან', 'ების', 'ებს', 'თან', 'დან', 'მდე', 'ში', 'ზე', 'ის', 'ით', 'ად', 'ს', 'ც', 'ი'];
const TR_SUFFIXES = ['dan', 'den', 'tan', 'ten', 'nda', 'nde', 'da', 'de', 'ta', 'te', 'ya', 'ye'];

/** Normalised spellings a single written token (or token run) may stand for. */
function variantsOf(written: string): string[] {
  const out = new Set<string>([written]);
  const base = written.replace(/['’](?:s|\p{L}{1,4})$/u, '');
  out.add(base);
  if (GEORGIAN.test(written)) {
    const queue = [base];
    for (let round = 0; round < 2; round++) {
      const next: string[] = [];
      for (const w of queue) {
        for (const suf of GEO_SUFFIXES) {
          if (w.endsWith(suf) && w.length - suf.length >= 3) { const v = w.slice(0, -suf.length); if (!out.has(v)) { out.add(v); next.push(v); } }
        }
      }
      queue.splice(0, queue.length, ...next);
    }
  } else if (ARABIC.test(written)) {
    for (const p of ['وال', 'بال', 'لل', 'ال', 'و', 'ب', 'ل', 'ف', 'ك']) if (base.startsWith(p) && base.length - p.length >= 3) out.add(base.slice(p.length));
  } else if (HEBREW.test(written)) {
    let w = base;
    for (let i = 0; i < 2 && /^[והשבלמכ]/.test(w) && w.length > 4; i++) { w = w.slice(1); out.add(w); }
  } else if (!CYRILLIC.test(written)) {
    for (const suf of TR_SUFFIXES) if (base.endsWith(suf) && base.length - suf.length >= 4) out.add(base.slice(0, -suf.length));
  }
  return [...out];
}

interface PlaceIndex { exact: Map<string, Set<string>>; single: Array<{ form: string; key: string }>; byKey: Map<string, SearchPlace>; maxWords: number }

const normForm = (f: string) => lowerSameLength(f.normalize('NFKC')).replace(/['’]/g, "'").replace(/\s+/g, ' ').trim();

function buildPlaceIndex(): PlaceIndex {
  const exact = new Map<string, Set<string>>();
  const single: Array<{ form: string; key: string }> = [];
  const byKey = new Map<string, SearchPlace>();
  let maxWords = 1;
  const put = (form: string, key: string) => {
    if (form.length < 3) return;
    if (!exact.has(form)) exact.set(form, new Set());
    exact.get(form)!.add(key);
  };
  for (const p of SEARCH_PLACES) {
    byKey.set(p.key, p);
    for (const raw of p.forms) {
      const f = normForm(raw);
      if (!f) continue;
      const words = f.split(' ');
      maxWords = Math.max(maxWords, words.length);
      put(f, p.key);
      /* A Georgian nominative loses its final vowel before most case endings (თბილისი → თბილისში). */
      if (GEORGIAN.test(f) && /[ია]$/u.test(f) && f.length >= 5) put(f.slice(0, -1), p.key);
      if (words.length === 1 && f.length >= 5) single.push({ form: f, key: p.key });
    }
  }
  return { exact, single, byKey, maxWords };
}

let PLACE_INDEX: PlaceIndex | null = null;
const placeIndex = () => (PLACE_INDEX ??= buildPlaceIndex());

interface PlaceMatch { place: SearchPlace; start: number; end: number; written: string; typo: boolean; negated: boolean; street: boolean }
interface PlaceAmbiguity { written: string; candidates: SearchPlace[] }

const scriptOf = (s: string) => (GEORGIAN.test(s) ? 'ka' : CYRILLIC.test(s) ? 'ru' : ARABIC.test(s) ? 'ar' : HEBREW.test(s) ? 'he' : 'latin');

/** Words that are never places, even one typo away from one. */
const NOT_PLACES = new Set([
  'apartment', 'apartments', 'bedroom', 'bedrooms', 'balcony', 'parking', 'garden', 'budget', 'renovated', 'district', 'center', 'centre',
  'квартира', 'квартиру', 'комнаты', 'спальни', 'балкон', 'бюджет', 'ремонт', 'ремонтом', 'район', 'районе', 'центре',
  'ბინა', 'ბინას', 'ოთახიანი', 'საძინებლიანი', 'სართული', 'სართულზე', 'ბიუჯეტი', 'რემონტით', 'რაიონში', 'ცენტრში', 'სახლი',
  'daire', 'kiralık', 'satılık', 'odalı', 'bütçe',
]);

function readPlacesIn(lower: string): { matches: PlaceMatch[]; ambiguous: PlaceAmbiguity[]; streets: string[] } {
  const idx = placeIndex();
  const tokens = [...lower.matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}]+)?/gu)].map((m) => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const used = new Array(tokens.length).fill(false);
  const matches: PlaceMatch[] = [];
  const ambiguous: PlaceAmbiguity[] = [];
  const streets: string[] = [];

  const streetAround = (start: number, end: number) => STREET_AFTER.test(lower.slice(end, end + 14)) || STREET_BEFORE.test(lower.slice(Math.max(0, start - 12), start));
  const negatedAround = (start: number, end: number) => NEG_BEFORE.test(lower.slice(Math.max(0, start - 18), start))
    || /^[\p{L}]{0,4}\s*(?:გარდა|hariç|dışında|исключая|не\s+подходит|не\s+рассматриваю|не\s+интересует)/u.test(lower.slice(end, end + 24))
    || /(?:кроме|except|excluding|გარდა|חוץ\s+מ|מלבד|عدا)\s+$/u.test(lower.slice(Math.max(0, start - 14), start));

  const lookup = (written: string) => {
    for (const v of variantsOf(written)) {
      const hit = idx.exact.get(v);
      if (hit?.size) return [...hit];
    }
    return null;
  };

  /* Longest token runs first: "დიდი დიღომი" is not "დიღომი", "Old Tbilisi" is not Tbilisi. */
  for (let n = Math.min(idx.maxWords, 4); n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      if (used.slice(i, i + n).some(Boolean)) continue;
      const run = tokens.slice(i, i + n);
      if (run.some((t, k) => k > 0 && !/^[\s-]+$/.test(lower.slice(run[k - 1].end, t.start)))) continue;
      const written = run.map((t) => t.text).join(' ');
      const keys = lookup(written);
      if (!keys) continue;
      const start = run[0].start, end = run[n - 1].end;
      const place = idx.byKey.get(keys[0])!;
      for (let k = i; k < i + n; k++) used[k] = true;
      if (keys.length > 1) { ambiguous.push({ written, candidates: keys.map((k) => idx.byKey.get(k)!) }); continue; }
      matches.push({ place, start, end, written, typo: false, negated: negatedAround(start, end), street: place.kind === 'AREA' && streetAround(start, end) });
    }
  }

  /* Typos: one unread token at a time, against single-word spellings of the same script. */
  for (let i = 0; i < tokens.length; i++) {
    if (used[i]) continue;
    const t = tokens[i];
    if (t.text.length < 5 || NOT_PLACES.has(t.text)) continue;
    const script = scriptOf(t.text);
    let best = Number.POSITIVE_INFINITY;
    let found = new Map<string, SearchPlace>();
    for (const v of variantsOf(t.text)) {
      const budget = typoBudget(v.length);
      if (!budget) continue;
      for (const s of idx.single) {
        if (s.form[0] !== v[0] || scriptOf(s.form) !== script) continue;
        const d = editDistance(v, s.form, budget);
        if (d > budget || d === 0) continue;
        if (d < best) { best = d; found = new Map(); }
        if (d === best) found.set(s.key, idx.byKey.get(s.key)!);
      }
    }
    if (!found.size) continue;
    used[i] = true;
    if (found.size > 1) { ambiguous.push({ written: t.text, candidates: [...found.values()].slice(0, 4) }); continue; }
    const place = [...found.values()][0];
    matches.push({ place, start: t.start, end: t.end, written: t.text, typo: true, negated: negatedAround(t.start, t.end), street: place.kind === 'AREA' && streetAround(t.start, t.end) });
  }

  /* Streets the gazetteer does not know: "სუხიშვილის ქუჩა", "ул. Пекинская" stay a preference. */
  for (const m of lower.matchAll(/([\p{L}\p{M}-]{3,}(?:\s+[\p{L}\p{M}-]{3,})?)\s*(ქუჩ\p{L}*|გამზირ\p{L}*|street|avenue|caddesi|sokak)/gu)) {
    const words = m[1].split(/\s+/);
    const name = (GEORGIAN.test(m[1]) ? words.slice(-1) : words.slice(-2)).join(' ');
    streets.push(`${name} ${m[2]}`.slice(0, 60));
  }
  for (const m of lower.matchAll(/(?:ул\.?|улиц[аеуы]|проспект[ае]?)\s*([\p{L}-]{3,})/gu)) streets.push(m[0].slice(0, 60));
  return { matches: matches.sort((a, b) => a.start - b.start), ambiguous, streets };
}

/* ------------------------------------------------------------------ *
 * Numbers                                                             *
 * ------------------------------------------------------------------ */

type Currency = 'USD' | 'GEL' | 'EUR' | 'FOREIGN';

const AREA_UNIT = '(?:m²|m2|м²|м2|кв\\.?\\s*м\\.?|квм|кв\\.(?=\\s|$)|квадрат\\p{L}*|sq\\.?\\s*m|sqm|sq\\s*ft|square\\s+met\\p{L}*|kv\\.?\\s*m|მ²|მ2|კვ\\.?\\s*მ\\.?|კვმ|კვ\\.(?=\\s|$)|კვადრატ\\p{L}*|metrekare|m\\.kare|متر\\s*مربع|م²|م2|מ"ר|מ״ר|מטר\\s*רבוע|מטר)';
const COUNT_UNITS = {
  bedrooms: '(?:საძინებ\\p{L}*|bedrooms?|beds?\\b|br\\b|bdr\\b|спал\\p{L}*|yatak\\s*oda\\p{L}*|غرف(?:ة)?\\s*نوم|غرفتي\\s*نوم|חדרי\\s*שינה|חדר\\s*שינה)',
  rooms: '(?:ოთახ\\p{L}*|rooms?\\b|комнат\\p{L}*|комн\\.?|odalı|oda\\b|غرف(?:ة)?(?!\\s*(?:نوم|ال))|חדרים|חדר(?![יו]\\s))',
  bathrooms: '(?:სააბაზან\\p{L}*|სველი\\s+წერტილ\\p{L}*|bathrooms?|baths?\\b|санузл\\p{L}*|ванн\\p{L}*|banyo\\p{L}*|حمام\\p{L}*|חדרי\\s*רחצה|שירותים)',
} as const;
const FLOOR_WORD = /^[\s-]*(?:ე|ი)?[\s-]*(?:სართ\p{L}*|этаж\p{L}*|floor\p{L}*|\.?\s*kat\p{L}*|طابق|الطابق|קומה|קומת)/u;
const FLOOR_BEFORE = /(?:სართულ\p{L}*|этаж\p{L}*|floor|kat|الطابق|طابق|קומה|קומת|მე)[\s-]*(?:№|#)?$/u;
const YEAR_AFTER = /^\s*(?:წ\.|წლ\p{L}*|წელს|год\p{L}*|г\.|year|yılı|yil|عام|سنة|שנת)/u;
const STRIP_MONEY_WORDS = /[$€₾]|ათასი?|ათ\.|მლნ|(?<![\p{L}])(?:k|к|thousand|тыс\p{L}*\.?|bin|ألف|الف|אלף|usd|gel|eur|dollars?|დოლარ\p{L}*|ლარ\p{L}*|ევრო\p{L}*|дол\p{L}*|лари|евро|dolar\p{L}*|دولار|يورو|דולר|יורו)(?![\p{L}])/gu;
const RANGE_SEP = /^\s*(?:-|–|—|~|to|until|till|до|по|-?\s*დან|and|ile|ila|ve|إلى|الى|حتى|עד|ל-?|ან|or|или|veya|أو|או)\s*$/u;

const MULTIPLIER = /^[\s-]*(k|к|thousand|grand|ათას\p{L}*|ათ\.|тыс\p{L}*\.?|bin|ألف|الف|آلاف|אלף|אלפים|mln|მლნ|მილიონ\p{L}*|млн\.?|миллион\p{L}*|millions?|milyon|مليون|ملايين|מיליון|m(?![²2\p{L}]))(?![\p{L}])/u;
const CURRENCY_AFTER = /^[\s-]*(?:(?:-?\s*(?:მდე|დან|ამდე|ით|ად)|kadar|max)\s*)?((?:\$|€|₾|₺|₽|₪|£|us\$)(?!\s*\d)|usd|gel|eur|euros?|dollars?|bucks|lari|tl|დოლარ\p{L}*|დოლ\.?|ლარ\p{L}*|ევრო\p{L}*|дол\p{L}*|лари|евро|руб\p{L}*|dolar\p{L}*|türk\s+lirası|دولار\p{L}*|يورو|لاري|ليرة|דולר\p{L}*|יורו|לארי|שקל\p{L}*|ש"ח)/u;
const CURRENCY_BEFORE = /(\$|€|₾|₺|₽|₪|£|us\$|usd|gel|eur)\s*$/u;
const MAX_WORDS = ['მაქსიმუმ', 'მაქს', 'არაუმეტეს', 'არა უმეტეს', 'ბიუჯეტი', 'ბიუჯეტით', 'до', 'не более', 'не больше', 'не дороже', 'максимум', 'макс', 'бюджет', 'в пределах', 'up to', 'max', 'maximum', 'under', 'below', 'budget', 'no more than', 'within', 'less than', 'en fazla', 'maksimum', 'bütçe*', 'altında', 'حتى', 'بحد أقصى', 'حد أقصى', 'لا يزيد عن', 'ميزانية', 'ميزانيتي', 'أقل من', 'עד', 'מקסימום', 'תקציב', 'לא יותר מ'];
const MIN_WORDS = ['მინიმუმ', 'სულ მცირე', 'от', 'минимум', 'не менее', 'не меньше', 'from', 'at least', 'min', 'minimum', 'over', 'above', 'more than', 'en az', 'en az', 'üzeri', 'على الأقل', 'ابتداء من', 'أكثر من', 'לפחות', 'החל מ', 'מינימום', 'מעל'];
const APPROX_WORDS = ['დაახლოებით', 'დაახლ', 'მიახლოებით', 'около', 'примерно', 'порядка', 'приблизительно', 'где-то', 'around', 'about', 'approximately', 'approx', 'roughly', 'circa', 'yaklaşık', 'civarı*', 'حوالي', 'تقريبا', 'بحدود', 'בערך', 'כ-'];

interface NumberToken { value: number; start: number; end: number }

function numbersIn(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(/\d{1,3}(?:[ ,.'’ ]\d{3})+(?![\d])|\d+(?:[.,]\d+)?/g)) {
    const raw = m[0];
    const grouped = /^\d{1,3}(?:[ ,.'’ ]\d{3})+$/.test(raw);
    const value = grouped ? Number(raw.replace(/[ ,.'’ ]/g, '')) : Number(raw.replace(',', '.'));
    if (Number.isFinite(value)) out.push({ value, start: m.index ?? 0, end: (m.index ?? 0) + raw.length });
  }
  return out;
}

const overlaps = (spans: Array<[number, number]>, s: number, e: number) => spans.some(([a, b]) => s < b && e > a);

function wordsBefore(lower: string, at: number, words: readonly string[], span = 26): boolean {
  const before = lower.slice(Math.max(0, at - span), at);
  return words.some((w) => {
    const re = termRe(w, 'iu');
    const m = before.match(new RegExp(`${re.source}[\\s:,-]*(?:[$€₾]\\s*)?$`, 'iu'));
    return !!m;
  });
}

interface RangeReading { min: number | null; max: number | null; approx: boolean; span: [number, number] }

function readCountRange(lower: string, unit: string): RangeReading | null {
  const re = new RegExp(`(?:(\\d{1,2})\\s*(?:-|–|to|до|ან|or|или|veya|أو|או)\\s*)?(\\d{1,2})\\s*(\\+)?\\s*-?\\s*(?:x\\s*)?${unit}`, 'iu');
  const m = lower.match(re);
  if (!m || m.index === undefined) return null;
  const a = m[1] !== undefined ? Number(m[1]) : null;
  const b = Number(m[2]);
  if (!(b > 0 && b < 30)) return null;
  const span: [number, number] = [m.index, m.index + m[0].length];
  if (a !== null && a > 0) return { min: Math.min(a, b), max: Math.max(a, b), approx: false, span };
  const after = lower.slice(span[1], span[1] + 18);
  if (m[3] || wordsBefore(lower, m.index, ['მინიმუმ', 'at least', 'min', 'minimum', 'не менее', 'минимум', 'от', 'en az', 'على الأقل', 'לפחות'])
    || /^\s*(?:ან\s+მეტი|და\s+მეტი|or\s+more|\+|и\s+более|и\s+больше|или\s+больше|ve\s+üzeri|أو\s+أكثر|ומעלה)/u.test(after)) {
    return { min: b, max: null, approx: false, span };
  }
  if (wordsBefore(lower, m.index, ['მაქსიმუმ', 'up to', 'max', 'maximum', 'не более', 'до', 'en fazla', 'حتى', 'עד'])) return { min: null, max: b, approx: false, span };
  return { min: b, max: b, approx: false, span };
}

function readArea(lower: string): RangeReading | null {
  const re = new RegExp(`(?:(\\d{2,4})\\s*(?:${AREA_UNIT})?\\s*(?:-|–|—|to|до|-?\\s*დან|and|ile|ila|إلى|عد|עד)\\s*)?(\\d{2,4}(?:[.,]\\d)?)\\s*(-?\\s*(?:მდე|დან|ამდე|იდან))?\\s*${AREA_UNIT}([\\p{L}\\p{M}]*)`, 'iu');
  const m = lower.match(re);
  if (!m || m.index === undefined) return null;
  const a = m[1] !== undefined ? Number(m[1]) : null;
  const b = Number(String(m[2]).replace(',', '.'));
  if (!(b >= 8 && b <= 100000)) return null;
  const span: [number, number] = [m.index, m.index + m[0].length];
  if (a !== null) return { min: Math.min(a, b), max: Math.max(a, b), approx: false, span };
  const post = `${m[3] ?? ''} ${m[4] ?? ''} ${lower.slice(span[1], span[1] + 10)}`;
  if (/(?:^|\s|-)(?:იდან|დან)/u.test(post) || /^\s*(?:\+|or more|и более|и больше|და მეტი|ან მეტი|ve üzeri|ومعلה|ומעלה)/u.test(lower.slice(span[1], span[1] + 14))
    || wordsBefore(lower, m.index, MIN_WORDS)) return { min: b, max: null, approx: false, span };
  if (/(?:^|\s|-)(?:მდე|ამდე)/u.test(post) || wordsBefore(lower, m.index, MAX_WORDS)) return { min: null, max: b, approx: false, span };
  return { min: b, max: b, approx: true, span };
}

interface Money { value: number; currency: Currency | null; multiplied: boolean; start: number; end: number; tailEnd: number }

function currencyOf(word: string): Currency {
  const w = word.toLowerCase();
  if (/^(?:\$|us\$|usd|dollars?|bucks|დოლ|дол|dolar|دولار|דולר)/u.test(w)) return 'USD';
  if (/^(?:₾|gel|lari|ლარ|лари|لاري|לארי)/u.test(w)) return 'GEL';
  if (/^(?:€|eur|euro|ევრო|евро|يورو|יורו)/u.test(w)) return 'EUR';
  return 'FOREIGN';
}

function readMoney(lower: string, excluded: Array<[number, number]>): Money[] {
  const out: Money[] = [];
  for (const n of numbersIn(lower)) {
    if (overlaps(excluded, n.start, n.end)) continue;
    const after = lower.slice(n.end, n.end + 30);
    if (FLOOR_WORD.test(after) || FLOOR_BEFORE.test(lower.slice(Math.max(0, n.start - 14), n.start))) continue;
    if (n.value >= 1900 && n.value <= 2040 && Number.isInteger(n.value) && YEAR_AFTER.test(after)) continue;
    let value = n.value;
    let tail = n.end;
    let multiplied = false;
    const mult = after.match(MULTIPLIER);
    if (mult && !(mult[1] === 'm' && /^\s/.test(after))) {
      const word = mult[1];
      value *= /^(?:mln|მლნ|მილიონ|млн|миллион|million|milyon|مليون|ملايين|מיליון|m)/u.test(word) ? 1_000_000 : 1_000;
      multiplied = true;
      tail = n.end + mult[0].length;
    }
    let currency: Currency | null = null;
    const cur = lower.slice(tail, tail + 30).match(CURRENCY_AFTER);
    if (cur) { currency = currencyOf(cur[1]); tail += cur[0].length; }
    else {
      const before = lower.slice(Math.max(0, n.start - 6), n.start).match(CURRENCY_BEFORE);
      if (before) currency = currencyOf(before[1]);
    }
    out.push({ value, currency, multiplied, start: n.start, end: n.end, tailEnd: tail });
  }
  return out;
}

interface PriceReading { min: number | null; max: number | null; currency: Currency | null; approx: boolean; start: number; end: number }

function readPrice(lower: string, excluded: Array<[number, number]>): PriceReading | null {
  const money = readMoney(lower, excluded);
  const marked = (m: Money) => wordsBefore(lower, m.start, MAX_WORDS) || wordsBefore(lower, m.start, MIN_WORDS)
    || /^\s*-?\s*(?:მდე|დან)/u.test(lower.slice(m.tailEnd, m.tailEnd + 6));
  const priced = (m: Money) => !!m.currency || m.multiplied || m.value >= 1000;
  const candidates = money.filter((m) => priced(m) || (m.value >= 100 && marked(m)));

  /* A range: two amounts joined by "-", "to", "до", "დან … მდე", "ile", "إلى", "עד". */
  for (let i = 0; i + 1 < money.length; i++) {
    const a = money[i], b = money[i + 1];
    if (!priced(a) && !priced(b)) continue;
    const between = lower.slice(a.end, b.start).replace(STRIP_MONEY_WORDS, ' ');
    if (between.length > 40 || !RANGE_SEP.test(between)) continue;
    let av = a.value;
    /* "120-160 ათასი $": the multiplier written once applies to both ends. */
    if (!a.multiplied && b.multiplied && av < 1000) av *= b.value >= 1_000_000 && av < 100 ? 1_000_000 : 1_000;
    const currency = a.currency ?? b.currency;
    if (currency === 'FOREIGN') return { min: null, max: null, currency, approx: false, start: a.start, end: b.tailEnd };
    return { min: Math.min(av, b.value), max: Math.max(av, b.value), currency, approx: false, start: a.start, end: b.tailEnd };
  }
  if (!candidates.length) return null;
  const only = candidates.find((m) => m.currency && m.currency !== 'FOREIGN') ?? candidates[0];
  if (only.currency === 'FOREIGN') return { min: null, max: null, currency: 'FOREIGN', approx: false, start: only.start, end: only.tailEnd };
  const approx = wordsBefore(lower, only.start, APPROX_WORDS) || /~\s*[$€₾]?\s*$/.test(lower.slice(Math.max(0, only.start - 3), only.start));
  const afterTail = lower.slice(only.tailEnd, only.tailEnd + 16);
  const isMax = wordsBefore(lower, only.start, MAX_WORDS) || /^\s*-?\s*(?:მდე|ამდე)/u.test(afterTail) || /^\s*-?\s*(?:მდე|ამდე)/u.test(lower.slice(only.end, only.end + 6))
    || /^\s*(?:['’]?\p{L}{0,3}\s*kadar|or\s+less|и\s+меньше|или\s+меньше|ან\s+ნაკლები)/u.test(afterTail);
  const isMin = !isMax && (wordsBefore(lower, only.start, MIN_WORDS) || /^\s*-?\s*დან/u.test(afterTail) || /^\s*(?:\+|or\s+more|и\s+(?:более|больше)|ან\s+მეტი|ve\s+üzeri|ومعلה|ומעלה)/u.test(afterTail));
  if (approx && !isMax && !isMin) return { min: only.value, max: only.value, currency: only.currency, approx: true, start: only.start, end: only.tailEnd };
  if (isMin) return { min: only.value, max: null, currency: only.currency, approx: false, start: only.start, end: only.tailEnd };
  /* A single figure with no direction is a ceiling: people state what they can spend. */
  return { min: null, max: only.value, currency: only.currency, approx: false, start: only.start, end: only.tailEnd };
}

/* ------------------------------------------------------------------ *
 * The engine                                                          *
 * ------------------------------------------------------------------ */

function guessLanguage(text: string): string | null {
  if (GEORGIAN.test(text)) return 'ka';
  if (HEBREW.test(text)) return 'he';
  if (ARABIC.test(text)) return 'ar';
  if (CYRILLIC.test(text)) return 'ru';
  if (/[çğışöü]|\b(?:arıyorum|istiyorum|daire|kiralık|satılık|odalı|için|bin|ev|evi)\b/iu.test(text)) return 'tr';
  if (/[a-z]/i.test(text)) return 'en';
  return null;
}

const usdText = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const amountText = (v: number, currency: 'USD' | 'GEL' | 'EUR') =>
  currency === 'USD' ? usdText(v) : currency === 'EUR' ? `€${Math.round(v).toLocaleString('en-US')}` : `${Math.round(v).toLocaleString('en-US')} ₾`;
const rangeLabel = (r: NumericRange, currency: 'USD' | 'GEL' | 'EUR') =>
  r.min !== null && r.max !== null && r.min !== r.max ? `${amountText(r.min, currency)} – ${amountText(r.max, currency)}`
    : amountText((r.max ?? r.min) as number, currency);

function convertRange(r: NumericRange, from: 'GEL' | 'EUR' | 'USD', converter: CurrencyConverter | null | undefined): NumericRange | null {
  if (from === 'USD') return r;
  if (!converter) return null;
  const one = (v: number | null) => {
    if (v === null) return null;
    const c = converter.convert(v, from, 'USD');
    return c && Number.isFinite(c.amount) && c.amount > 0 ? Math.round(c.amount) : Number.NaN;
  };
  const min = one(r.min), max = one(r.max);
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return { min, max };
}

/** One chip per currency the amount can be read in (a currency without a current rate has none). */
function currencyOptions(stated: NumericRange, converter: CurrencyConverter | null | undefined): ClarificationOption[] {
  const out: ClarificationOption[] = [];
  for (const currency of ['USD', 'GEL', 'EUR'] as const) {
    const usd = convertRange(stated, currency, converter);
    if (!usd) continue;
    out.push({ id: currency, text: rangeLabel(stated, currency), edits: [{ field: 'price', value: usd }] });
  }
  return out;
}

/**
 * The customer's sentence → a brief and the questions it leaves open. Never throws.
 * `converter` supplies current USD rates for GEL and EUR (fx_rates, then NBG); without
 * one a non-USD budget is dropped with a reason, never converted at an invented rate.
 */
export function understandSearchText(input: string, options: { converter?: CurrencyConverter | null } = {}): QueryUnderstanding {
  const original = String(input ?? '').slice(0, 2000);
  const text = foldDigits(original).normalize('NFKC');
  const lower = lowerSameLength(text);
  const clarifications: Clarification[] = [];
  const corrections: Array<{ written: string; read: string }> = [];
  const raw: Record<string, unknown> = {
    transactionType: null, propertyType: null, country: 'GE', city: null, districts: [], locationPreferences: [],
    priceMinUsd: null, priceMaxUsd: null, priceCurrencyStated: null, areaMinSqm: null, areaMaxSqm: null,
    roomsMin: null, roomsMax: null, bedroomsMin: null, bedroomsMax: null, bathroomsMin: null,
    buildingStatuses: [], renovationPreferences: [], preferredBuildingStatuses: [], preferredRenovations: [],
    furnished: null, parking: null, floorPreferences: [], floorMin: null, floorMax: null,
    mustHave: [], niceToHave: [], exclusions: [], userLanguage: guessLanguage(text), relevantSearchLanguages: ['ka', 'en', 'ru'], proposals: [],
  };

  /* ---- counts and area first: their numbers are not money ---- */
  const excluded: Array<[number, number]> = [];
  const area = readArea(lower);
  if (area) {
    excluded.push(area.span);
    if (area.approx) (raw.proposals as unknown[]).push({ field: 'area', min: Math.round(area.min! * 0.9), max: Math.round(area.max! * 1.1) });
    else { raw.areaMinSqm = area.min; raw.areaMaxSqm = area.max; }
  }
  const legacy = readConstraints(text);
  const turkish = lower.match(/(?<!\d)(\d)\s*\+\s*(\d)(?!\d)/);
  for (const kind of ['bedrooms', 'rooms', 'bathrooms'] as const) {
    const r = readCountRange(lower, COUNT_UNITS[kind]);
    if (r) excluded.push(r.span);
    const min = r?.min ?? null, max = r?.max ?? null;
    if (kind === 'bedrooms') {
      const fallback = legacy.bedroomsMin ?? null;
      raw.bedroomsMin = r ? min : fallback;
      raw.bedroomsMax = r ? max : fallback;
    } else if (kind === 'rooms') {
      const fallback = legacy.roomsMin ?? null;
      raw.roomsMin = r ? min : fallback;
      raw.roomsMax = r ? max : fallback;
    } else if (r) raw.bathroomsMin = min ?? max;
  }
  if (turkish && turkish.index !== undefined) {
    excluded.push([turkish.index, turkish.index + turkish[0].length]);
    const bedrooms = Number(turkish[1]), salons = Number(turkish[2]);
    if (raw.bedroomsMin === null && bedrooms > 0) { raw.bedroomsMin = bedrooms; raw.bedroomsMax = bedrooms; }
    if (raw.roomsMin === null && bedrooms + salons > 0) { raw.roomsMin = bedrooms + salons; raw.roomsMax = bedrooms + salons; }
  }
  /* Floors stated as numbers (ka/ru/en are read by floor-intent from the original text). */
  for (const m of lower.matchAll(/(\d{1,2})\s*\.?\s*(?:-?ე|-?ი)?\s*(?:სართ|этаж|floor|kat|طابق|קומה)/gu)) excluded.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  for (const m of lower.matchAll(/(?:სართულ\p{L}*|этаж\p{L}*|floor|kat|الطابق|طابق|קומה|קומת|მე)[\s-]*(\d{1,2})/gu)) excluded.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  const trFloor = lower.match(/(?:en\s+az\s+)?(\d{1,2})\s*\.\s*kat(?:tan|dan)?\s*(?:itibaren|ve\s+üzeri|üstü)/u) ?? lower.match(/en\s+az\s+(\d{1,2})\s*\.\s*kat/u);
  const arFloor = lower.match(/(?:من|ابتداء\s+من)\s+الطابق\s+(\d{1,2})/u);
  const heFloor = lower.match(/מקומה\s+(\d{1,2})(?:\s+ומעלה)?/u);
  const floorMin = Number((trFloor ?? arFloor ?? heFloor)?.[1] ?? Number.NaN);
  if (Number.isInteger(floorMin) && floorMin >= -5 && floorMin <= 200) raw.floorMin = floorMin;

  /* ---- money ---- */
  const price = readPrice(lower, excluded);
  let priceNote: { kind: 'converted'; currency: 'GEL' | 'EUR'; stated: NumericRange } | { kind: 'no_currency'; stated: NumericRange } | null = null;
  if (price && price.currency === 'FOREIGN') {
    raw.priceCurrencyStated = 'OTHER'; // a currency this market does not quote in: dropped with mps_dropped_currency
  } else if (price && price.approx) {
    const v = price.max ?? price.min ?? 0;
    const stated = { min: Math.round(v * 0.9), max: Math.round(v * 1.1) };
    const usd = convertRange(stated, (price.currency ?? 'USD') as 'USD' | 'GEL' | 'EUR', options.converter);
    if (usd) (raw.proposals as unknown[]).push({ field: 'price', min: usd.min, max: usd.max });
  } else if (price) {
    const stated: NumericRange = { min: price.min, max: price.max };
    const currency = price.currency as 'USD' | 'GEL' | 'EUR' | null;
    if (currency === 'GEL' || currency === 'EUR') {
      const usd = convertRange(stated, currency, options.converter);
      if (usd) { raw.priceMinUsd = usd.min; raw.priceMaxUsd = usd.max; raw.priceCurrencyStated = 'USD'; priceNote = { kind: 'converted', currency, stated }; }
      else raw.priceCurrencyStated = currency;
    } else {
      raw.priceMinUsd = stated.min; raw.priceMaxUsd = stated.max; raw.priceCurrencyStated = 'USD';
      if (!currency) priceNote = { kind: 'no_currency', stated };
    }
  }

  /* ---- transaction ---- */
  const daily = hasAny(lower, DAILY);
  const monthly = hasAny(lower, MONTHLY);
  const rent = hasAny(lower, RENT);
  const buy = hasAny(lower, BUY) || hasAny(lower, INVEST);
  let typoTx: MarketplaceTransaction | null = null;
  let typoType: MarketplacePropertyType | null = null;
  const known = [...DAILY, ...RENT, ...MONTHLY, ...BUY, ...INVEST, ...TYPE_TERMS.flatMap(([, t]) => t)];
  for (const m of lower.matchAll(/[\p{L}]{5,}/gu)) {
    if (known.some((t) => termRe(t, 'iu').test(m[0]))) continue;
    for (const [word, kind, value] of TYPO_WORDS) {
      if (m[0] === word || m[0][0] !== word[0]) continue;
      const budget = typoBudget(word.length);
      if (budget && editDistance(m[0], word, budget) <= budget) {
        if (kind === 'tx' && !typoTx) typoTx = value as MarketplaceTransaction;
        if (kind === 'type' && !typoType) typoType = value as MarketplacePropertyType;
        corrections.push({ written: m[0], read: word });
        break;
      }
    }
  }
  let transaction: MarketplaceTransaction | null = null;
  const rentish = daily || rent || monthly;
  if (rentish && buy) {
    clarifications.push({ id: 'transaction', questionKey: 'mps_clarify_transaction', options: (['BUY', 'MONTHLY_RENT', 'DAILY_RENT'] as const)
      .map((v) => ({ id: v, labelKey: `mps_tx_${v}`, edits: [{ field: 'transactionType', value: v } as BriefEdit] })) });
  } else if (daily) transaction = 'DAILY_RENT';
  else if (rent || monthly) transaction = 'MONTHLY_RENT';
  else if (buy) transaction = 'BUY';
  else if (typoTx) transaction = typoTx;
  else if (legacy.goal === 'BUY' || legacy.goal === 'INVEST') transaction = 'BUY';
  else if (price && !price.approx && price.currency !== 'FOREIGN') {
    const top = Math.max(Number(raw.priceMaxUsd ?? 0), Number(raw.priceMinUsd ?? 0));
    /* Nobody pays this per month in this market: a price this high is a purchase. */
    if (top >= 20000) transaction = 'BUY';
  }
  raw.transactionType = transaction;

  /* ---- property type ---- */
  const typeHits = new Map<MarketplacePropertyType, Hit[]>();
  for (const [type, terms] of TYPE_TERMS) {
    const hits = hitsOf(lower, terms);
    if (hits.length) typeHits.set(type, hits);
  }
  if (typeHits.has('HOUSE') && typeHits.has('APARTMENT')
    && typeHits.get('HOUSE')!.every((h) => WEAK_HOUSE.some((w) => lower.slice(h.index, h.index + h.length) === w || lower.slice(Math.max(0, h.index - 2), h.index + h.length) === `в ${w}`))) {
    typeHits.delete('HOUSE');
  }
  /* The specific kind wins over its family word: a studio flat is a STUDIO, a villa house a VILLA. */
  for (const [specific, family] of [['STUDIO', 'APARTMENT'], ['PENTHOUSE', 'APARTMENT'], ['VILLA', 'HOUSE'], ['TOWNHOUSE', 'HOUSE']] as const) {
    if (typeHits.has(specific)) typeHits.delete(family);
  }
  /* "House" in "townhouse"-style words of other scripts is already resolved; land with a house is a house plot. */
  if (typeHits.has('LAND') && (typeHits.has('HOUSE') || typeHits.has('VILLA')) && /(?:მიწით|с участком|with (?:a )?(?:plot|land)|arsalı|مع أرض|עם מגרש)/u.test(lower)) typeHits.delete('LAND');
  const types = [...typeHits.keys()];
  let inferredType = false;
  if (types.length === 1) raw.propertyType = types[0];
  else if (types.length > 1) {
    clarifications.push({ id: 'propertyType', questionKey: 'mps_clarify_property_type', options: types
      .map((v) => ({ id: v, labelKey: `mps_pt_${v}`, edits: [{ field: 'propertyType', value: v } as BriefEdit] })) });
  } else if (typoType) raw.propertyType = typoType;
  else if (raw.roomsMin !== null || raw.bedroomsMin !== null) { raw.propertyType = 'APARTMENT'; inferredType = true; }

  /* ---- places ---- */
  const places = readPlacesIn(lower);
  for (const m of places.matches) if (m.typo) corrections.push({ written: m.written, read: m.place.name });
  const wanted = places.matches.filter((m) => !m.negated && !m.street);
  const cityKeys = [...new Set(wanted.filter((m) => m.place.kind === 'CITY').map((m) => m.place.key))];
  const areas = wanted.filter((m) => m.place.kind === 'AREA');
  const areaCities = [...new Set(areas.map((m) => m.place.city!))];
  let city: string | null = null;
  if (cityKeys.length === 1) city = cityKeys[0];
  else if (cityKeys.length > 1) {
    const fromAreas = areaCities.filter((c) => cityKeys.includes(c));
    if (fromAreas.length === 1) city = fromAreas[0];
    else clarifications.push({ id: 'city', questionKey: 'mps_clarify_city', options: cityKeys.slice(0, 4).map((k) => {
      const p = placeIndex().byKey.get(k)!;
      return { id: k, labels: p.labels, text: p.name, edits: [{ field: 'city', value: p.name } as BriefEdit] };
    }) });
  } else if (areaCities.length === 1) city = areaCities[0];
  else if (areaCities.length > 1) {
    clarifications.push({ id: 'city', questionKey: 'mps_clarify_city', options: areaCities.slice(0, 4).map((k) => ({
      id: k, labels: placeIndex().byKey.get(k)?.labels, text: cityName(k), edits: [
        { field: 'city', value: cityName(k) } as BriefEdit,
        { field: 'districts', value: [...new Set(areas.filter((a) => a.place.city === k).map((a) => a.place.name))] } as BriefEdit,
      ],
    })) });
  }
  const districts = city ? [...new Set(areas.filter((a) => a.place.city === city).map((a) => a.place.name))] : [];
  raw.city = city ? cityName(city) : null;
  raw.districts = districts;
  const preferences = [
    ...places.streets,
    ...places.matches.filter((m) => m.street && !m.negated).map((m) => text.slice(m.start, Math.min(text.length, m.end + 12)).replace(/[,;()'"`%*=<>|&{}[\]\\].*$/u, '').trim()),
  ];
  for (const phrase of [...NEAR_METRO, ...NEAR_SEA]) {
    const hit = hitsOf(lower, [phrase])[0];
    if (hit) preferences.push(text.slice(hit.index, hit.index + hit.length));
  }
  raw.locationPreferences = [...new Set(preferences.map((p) => p.trim()).filter((p) => p.length >= 3))].slice(0, 6);
  for (const amb of places.ambiguous) {
    clarifications.push({ id: 'place', questionKey: 'mps_clarify_place', options: amb.candidates.map((p) => ({
      id: p.key, labels: p.labels, text: p.name,
      edits: p.kind === 'CITY'
        ? [{ field: 'city', value: p.name } as BriefEdit]
        : [{ field: 'city', value: cityName(p.city!) } as BriefEdit, { field: 'districts', value: [...(p.city === city ? districts : []), p.name] } as BriefEdit],
    })) });
  }

  /* ---- amenities, furnishing, floors ---- */
  const clauses = [...lower.matchAll(/[^,;.!?\n،؛]+/gu)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] }));
  const clauseOf = (at: number) => clauses.find((c) => at >= c.start && at < c.end)?.text ?? '';
  const mustHave: Amenity[] = [], niceToHave: Amenity[] = [], exclusions: Amenity[] = [];
  for (const [amenity, terms] of AMENITY_TERMS) {
    const hit = hitsOf(lower, terms)[0];
    if (!hit) continue;
    const negated = NEG_BEFORE.test(lower.slice(Math.max(0, hit.index - 18), hit.index)) || NEG_AFTER.test(lower.slice(hit.index + hit.length, hit.index + hit.length + 30));
    if (negated) exclusions.push(amenity);
    else if (hasAny(clauseOf(hit.index), PREFERRED)) niceToHave.push(amenity);
    else mustHave.push(amenity);
  }
  raw.mustHave = mustHave; raw.niceToHave = niceToHave; raw.exclusions = exclusions;
  if (mustHave.includes('PARKING')) raw.parking = true;
  else if (exclusions.includes('PARKING')) raw.parking = false;
  if (hasAny(lower, UNFURNISHED)) raw.furnished = false;
  else if (hasAny(lower, FURNISHED)) raw.furnished = true;
  const floorPrefs: FloorPreference[] = [];
  if (/(?:მაღალ\p{L}*\s+სართულ|высок\p{L}*\s+этаж|high(?:er)?\s+floor|upper\s+floor|yüksek\s+kat|طابق\s+عال|קומה\s+גבוהה)/u.test(lower)) floorPrefs.push('HIGH');
  if (/(?:დაბალ\p{L}*\s+სართულ|низк\p{L}*\s+этаж|low(?:er)?\s+floor|alçak\s+kat|düşük\s+kat|طابق\s+منخفض|קומה\s+נמוכה)/u.test(lower)) floorPrefs.push('LOW');
  if (/(?:შუა\s+სართულ|средн\p{L}*\s+этаж|middle\s+floor|mid\s+floor|orta\s+kat|طابق\s+متوسط|קומת\s+ביניים)/u.test(lower)) floorPrefs.push('MIDDLE');
  if (/(?:არა\s+ბოლო|ბოლო\s+სართული\s+არ|не\s+последн|not\s+(?:on\s+)?(?:the\s+)?(?:last|top)\s+floor|son\s+kat\s+olmasın|ليس\s+الطابق\s+الأخير|לא\s+(?:ב)?קומה\s+אחרונה)/u.test(lower)) floorPrefs.push('NOT_LAST');
  if (/(?:ilk\s+kat\s+olmasın|zemin\s+kat\s+olmasın|giriş\s+kat\s+olmasın|ليس\s+الطابق\s+الأرضي|ليس\s+الطابق\s+الأول|לא\s+(?:ב)?קומת\s+קרקע|לא\s+(?:ב)?קומה\s+ראשונה)/u.test(lower)) floorPrefs.push('NOT_FIRST');
  raw.floorPreferences = floorPrefs;

  /* ---- the same gate the model's output used to pass ---- */
  const brief = briefFromModel(raw, original);
  if (priceNote?.kind === 'converted' && brief.price) {
    brief.price = { ...brief.price, status: 'STATED' };
    brief.statedPrice = { currency: priceNote.currency, min: priceNote.stated.min, max: priceNote.stated.max };
  }
  /* Counts read from words ("трёхкомнатную", "სამოთახიანი") or "2+1" are the customer's own statement. */
  for (const f of ['rooms', 'bedrooms'] as const) {
    const fld = brief[f];
    if (fld && fld.status === 'PROPOSED' && raw[`${f}Min`] !== null) brief[f] = { ...fld, status: 'STATED' };
  }
  /* A range or ceiling the engine read (inherited "150-200 тыс", "120-160k") is stated even where one end's digits stand alone. */
  if (brief.price && brief.price.status === 'PROPOSED' && price && !price.approx && price.currency && price.currency !== 'FOREIGN') brief.price = { ...brief.price, status: 'STATED' };
  if (brief.area && brief.area.status === 'PROPOSED' && area && !area.approx) brief.area = { ...brief.area, status: 'STATED' };
  if (inferredType && brief.propertyType) brief.propertyType = { ...brief.propertyType, status: 'PROPOSED' };
  if (priceNote?.kind === 'no_currency' && brief.price) {
    /* No currency: shown as dollars, searched only once the customer picks the currency. */
    brief.price = { ...brief.price, status: 'PROPOSED' };
    clarifications.push({ id: 'currency', questionKey: 'mps_clarify_currency', options: currencyOptions(priceNote.stated, options.converter) });
  }
  const understood = !!(brief.transactionType || brief.propertyType || brief.city || brief.price || brief.area || brief.rooms || brief.bedrooms
    || clarifications.length || brief.buildingStatuses || brief.renovationPreferences);
  return { brief, clarifications, reading: raw, understood, corrections, engine: QUERY_ENGINE_VERSION };
}
