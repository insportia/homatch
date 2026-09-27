// WHAT SOMEBODY ASKED FOR, READ WITHOUT A MODEL.
//
// A sentence in the common room — "ვეძებ 2 საძინებლიან ბინას ვაკეში $200,000-მდე" — states
// a city, a district, a property type, a bedroom count and a budget ceiling. Every one of
// those is a closed-vocabulary fact with a small number of spellings per language, and
// every one of them can be read deterministically, tested in all six languages the product
// speaks, and audited when a customer asks why they were matched with something.
//
// So this reads them. The model is a fallback for sentences this cannot read, not the
// first resort for sentences it can: a reading that costs nothing, answers in
// microseconds and says the same thing tomorrow is the one a matcher should be built on.
//
// WHAT THIS PRODUCES
//
// A `PlanDraft` — the SAME untrusted shape the Find Property model produces — so it passes
// through the SAME `normalisePlan()` gate. There is one definition of a valid search in
// this repository and this module does not get a second one by being deterministic.
//
// ROOMS ARE NOT BEDROOMS
//
// "3 ოთახიანი", "трёхкомнатная" and "דירת 3 חדרים" count the living room; "3 საძინებლიანი",
// "3 bedrooms" and "3 חדרי שינה" do not. A reader that stored the first as bedrooms would
// show a person asking for a three-room flat nothing smaller than a four-room one. Rooms
// and bedrooms are carried as separate fields and the matcher compares each with its own
// kind. Turkish "2+1" is two bedrooms and a salon, which is the one market where the room
// convention states bedrooms directly.
//
// ABSENT IS AN ANSWER
//
// Nothing here is defaulted into existence. A sentence that names no city produces no city;
// a price with no currency marker in a market that quotes in three currencies produces no
// budget rather than a budget in the wrong one. A missing constraint means "not stated",
// which the matcher already reads correctly; an invented one means a search the person
// never asked for.

import type { PlanDraft, SearchGoal, PlanPropertyType } from '../discovery/search-plan.ts';

export type Firmness = 'REQUIRED' | 'PREFERRED' | 'FLEXIBLE';

/** Everything read, in the plan's own draft shape plus the two fields a plan lacks. */
export interface ConstraintReading extends PlanDraft {
  /** Rooms including the living room, where the sentence counted that way. */
  roomsMin?: number | null;
  roomsMax?: number | null;
  /** Which scripts the sentence used — evidence for language, never a gate. */
  scripts: string[];
  /** How many distinct constraints were read. Zero means nothing searchable was said. */
  found: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Digits and scripts
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Arabic-Indic and Extended Arabic-Indic digits, and the Arabic separators, as ASCII.
 *
 * "٢٠٠٬٠٠٠ دولار" is two hundred thousand dollars. Locale formatting must never change
 * monetary meaning, so the digits are folded before anything reads a number.
 */
export function foldDigits(text: string): string {
  return String(text ?? '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٬/g, ',')
    .replace(/٫/g, '.')
    /* Narrow no-break and thin spaces used as thousands separators. */
    .replace(/[   ]/g, ' ');
}

export function scriptsOf(text: string): string[] {
  const out: string[] = [];
  if (/[Ⴀ-ჿ]/.test(text)) out.push('GEORGIAN');
  if (/[Ѐ-ӿ]/.test(text)) out.push('CYRILLIC');
  if (/[؀-ۿ]/.test(text)) out.push('ARABIC');
  if (/[֐-׿]/.test(text)) out.push('HEBREW');
  if (/[a-zçğıöşü]/i.test(text)) out.push('LATIN');
  return out;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A phrase at a letter boundary, with the clitic prefixes Arabic and Hebrew attach. */
function phraseRe(phrase: string, suffix = ''): RegExp {
  const clitics = /^[؀-ۿ]/.test(phrase)
    ? '(?:[وفبلك]{1,2})?'
    : /^[֐-׿]/.test(phrase) ? '(?:[והשבלמכ]{1,2})?' : '';
  return new RegExp(`(?<!\\p{L})${clitics}${escape(phrase)}${suffix}(?!\\p{L})`, 'iu');
}

const hasAnyPhrase = (text: string, phrases: readonly string[]) =>
  phrases.some((phrase) => phraseRe(phrase).test(text));

/* ────────────────────────────────────────────────────────────────────────
 * Places
 * ──────────────────────────────────────────────────────────────────────── */

interface Place {
  /** The value stored — the Latin name the pipeline already uses. */
  name: string;
  /** For a district, the city it is in. */
  city?: string;
  /** Every spelling, in every script. Georgian nominatives end in the case vowel. */
  spellings: readonly string[];
}

/**
 * The places a person in this market actually names.
 *
 * The same rows as normalize/place.ts, with the Arabic, Hebrew and Turkish spellings a
 * reader of those languages writes. A district implies its city: "ვაკეში" is a flat in
 * Tbilisi even when the sentence never says so.
 */
const PLACES: readonly Place[] = [
  { name: 'Tbilisi', spellings: ['tbilisi', 'თბილისი', 'тбилиси', 'tiflis', 'تبليسي', 'تبيليسي', 'טביליסי', 'טיביליסי'] },
  { name: 'Batumi', spellings: ['batumi', 'batum', 'ბათუმი', 'батуми', 'باتومي', 'בטומי', 'באטומי'] },
  { name: 'Kutaisi', spellings: ['kutaisi', 'ქუთაისი', 'кутаиси', 'كوتايسي', 'קוטאיסי'] },
  { name: 'Rustavi', spellings: ['rustavi', 'რუსთავი', 'рустави', 'روستافي', 'רוסטאבי'] },
  { name: 'Gudauri', spellings: ['gudauri', 'გუდაური', 'гудаури', 'غوداوري', 'גודאורי'] },
  { name: 'Bakuriani', spellings: ['bakuriani', 'ბაკურიანი', 'бакуриани', 'باكورياني', 'בקוריאני'] },
  { name: 'Kobuleti', spellings: ['kobuleti', 'ქობულეთი', 'кобулети', 'كوبوليتي', 'קובולטי'] },
  { name: 'Vake', city: 'Tbilisi', spellings: ['vake', 'ვაკე', 'ваке', 'فاكي', 'فاكه', 'ואקה', 'וואקה'] },
  { name: 'Saburtalo', city: 'Tbilisi', spellings: ['saburtalo', 'საბურთალო', 'сабуртало', 'سابورتالو', 'סבורטלו', 'סאבורטלו'] },
  { name: 'Krtsanisi', city: 'Tbilisi', spellings: ['krtsanisi', 'კრწანისი', 'крцаниси', 'كرتسانيسي', 'קרצאניסי'] },
  { name: 'Vera', city: 'Tbilisi', spellings: ['ვერა', 'вера'] },
  { name: 'Sololaki', city: 'Tbilisi', spellings: ['sololaki', 'სოლოლაკი', 'сололаки', 'سولولاكي', 'סולולאקי'] },
  { name: 'Mtatsminda', city: 'Tbilisi', spellings: ['mtatsminda', 'მთაწმინდა', 'мтацминда', 'متاتسميندا', 'מטאצמינדה'] },
  { name: 'Didube', city: 'Tbilisi', spellings: ['didube', 'დიდუბე', 'дидубе', 'ديدوبي', 'דידובה'] },
  { name: 'Digomi', city: 'Tbilisi', spellings: ['digomi', 'დიღომი', 'дигоми', 'ديغومي', 'דיגומי'] },
  { name: 'Gldani', city: 'Tbilisi', spellings: ['gldani', 'გლდანი', 'глдани', 'غلداني', 'גלדאני'] },
  { name: 'Isani', city: 'Tbilisi', spellings: ['isani', 'ისანი', 'исани', 'إيساني', 'איסאני'] },
  { name: 'Samgori', city: 'Tbilisi', spellings: ['samgori', 'სამგორი', 'самгори', 'سامغوري', 'סמגורי'] },
  { name: 'Nadzaladevi', city: 'Tbilisi', spellings: ['nadzaladevi', 'ნაძალადევი', 'надзаладеви'] },
  { name: 'Chughureti', city: 'Tbilisi', spellings: ['chughureti', 'ჩუღურეთი', 'чугурети'] },
  { name: 'Avlabari', city: 'Tbilisi', spellings: ['avlabari', 'ავლაბარი', 'авлабари', 'أفلاباري', 'אבלברי'] },
  { name: 'Ortachala', city: 'Tbilisi', spellings: ['ortachala', 'ორთაჭალა', 'ортачала'] },
];

/**
 * Georgian declines a place name and Turkish suffixes it after an apostrophe.
 *
 * "თბილისში" is "in Tbilisi" — the nominative's final -ი gives way to the case ending.
 * "Vake'de" is "in Vake". Both are the place, and a reader that wanted the nominative
 * would find neither.
 */
const GEORGIAN_CASES = '(?:ი|ის|ში|ს|ზე|თან|დან|იდან|ამდე|ისკენ|ელი|ში-ც)?';

function placeMatches(text: string, spelling: string): boolean {
  if (/^[Ⴀ-ჿ]/.test(spelling)) {
    const stem = spelling.endsWith('ი') ? spelling.slice(0, -1) : spelling;
    return new RegExp(`(?<!\\p{L})${escape(stem)}${GEORGIAN_CASES}(?!\\p{L})`, 'iu').test(text);
  }
  if (/^[a-z]/i.test(spelling)) {
    return new RegExp(`(?<!\\p{L})${escape(spelling)}(?:['’][\\p{L}]{1,4})?(?!\\p{L})`, 'iu').test(text);
  }
  return phraseRe(spelling).test(text);
}

function readPlaces(text: string): { city: string | null; districts: string[] } {
  let city: string | null = null;
  const districts: string[] = [];
  for (const place of PLACES) {
    if (!place.spellings.some((spelling) => placeMatches(text, spelling))) continue;
    if (place.city) {
      if (!districts.includes(place.name)) districts.push(place.name);
      city = city ?? place.city;
    } else if (!city) {
      city = place.name;
    }
  }
  return { city, districts };
}

/* ────────────────────────────────────────────────────────────────────────
 * What they want to do, and with what
 * ──────────────────────────────────────────────────────────────────────── */

const RENT_WORDS = [
  'ქირით', 'ქირაობა', 'ვიქირავებ', 'საქირაო', 'ქირავდება', 'ქირა', 'ქირაზე',
  'сниму', 'снять', 'аренда', 'аренду', 'арендовать', 'в аренду',
  'rent', 'to rent', 'for rent', 'lease', 'renting',
  'kiralık', 'kiralamak', 'kiralayacağım', 'kira',
  'للإيجار', 'إيجار', 'ايجار', 'أستأجر', 'استئجار', 'سأستأجر',
  'לשכור', 'להשכרה', 'שכירות', 'אשכור',
];
const SHORT_STAY_WORDS = [
  'დღიურად', 'დღიური', 'посуточно', 'на сутки', 'daily', 'short-term', 'short term',
  'nightly', 'günlük', 'إيجار يومي', 'يومي', 'לטווח קצר', 'ללילה',
];
const BUY_WORDS = [
  'ვიყიდი', 'ყიდვა', 'შევიძენ', 'საყიდლად', 'შესაძენად', 'ყიდვას',
  'купить', 'куплю', 'покупка', 'покупку', 'приобрести',
  'buy', 'to buy', 'purchase', 'buying',
  'satın almak', 'satın alacağım', 'almak istiyorum', 'satılık',
  'شراء', 'أشتري', 'اشتري', 'سأشتري', 'للشراء',
  'לקנות', 'אקנה', 'קנייה', 'לרכישה', 'לרכוש',
];
const INVEST_WORDS = [
  'ინვესტიცია', 'ინვესტიციისთვის', 'ინვესტირება', 'инвестиция', 'инвестиции', 'для инвестиций',
  'investment', 'invest', 'yatırım', 'yatırımlık', 'استثمار', 'للاستثمار', 'השקעה', 'להשקעה',
];

/**
 * A price stated per month is a rent. The only market-independent structural cue that a
 * bare budget belongs to a tenancy rather than a purchase.
 */
const PER_MONTH = [
  'თვეში', 'თვიურად', 'в месяц', 'в мес', '/мес', 'per month', '/month', 'a month', 'monthly',
  'aylık', 'ayda', 'شهريا', 'شهري', 'في الشهر', 'לחודש',
];

const TYPE_WORDS: ReadonlyArray<readonly [PlanPropertyType, readonly string[]]> = [
  ['APARTMENT', [
    'apartment', 'apartments', 'flat', 'flats', 'квартира', 'квартиру', 'квартиры', 'квартир',
    'двушка', 'двушку', 'трёшка', 'трешку', 'однушка', 'однушку', 'daire', 'dairesi',
    'شقة', 'شقه', 'شقق', 'דירה', 'דירת', 'דירות',
  ]],
  ['HOUSE', [
    'house', 'villa', 'townhouse', 'дом', 'дома', 'коттедж', 'villa', 'müstakil ev', 'müstakil',
    'منزل', 'بيت', 'فيلا', 'בית', 'וילה', 'בית פרטי',
  ]],
  ['LAND', [
    'land', 'plot', 'участок', 'земля', 'землю', 'arsa', 'arazi', 'أرض', 'قطعة أرض', 'مגרש', 'מגרש', 'קרקע',
  ]],
  ['OFFICE', ['office', 'офис', 'ofis', 'مكتب', 'משרד']],
  ['COMMERCIAL', [
    'commercial', 'shop', 'retail', 'коммерческое', 'коммерческую', 'магазин', 'dükkan', 'işyeri',
    'تجاري', 'محل', 'מסחרי', 'חנות',
  ]],
];

/** Georgian nouns decline, so the stem is what is matched. */
const GEORGIAN_TYPE_STEMS: ReadonlyArray<readonly [PlanPropertyType, string]> = [
  ['APARTMENT', 'ბინ'],
  ['HOUSE', 'სახლ'],
  ['LAND', 'მიწ'],
  ['LAND', 'ნაკვეთ'],
  ['OFFICE', 'ოფის'],
  ['COMMERCIAL', 'კომერციულ'],
];

function readTypes(text: string): PlanPropertyType[] {
  const kinds: PlanPropertyType[] = [];
  const push = (kind: PlanPropertyType) => { if (!kinds.includes(kind)) kinds.push(kind); };
  for (const [kind, words] of TYPE_WORDS) if (hasAnyPhrase(text, words)) push(kind);
  for (const [kind, stem] of GEORGIAN_TYPE_STEMS) {
    if (new RegExp(`(?<!\\p{L})${stem}(?:ა|ას|ის|აში|ით|ად|ები|ებს|ის|ი|ზე)?(?!\\p{L})`, 'u').test(text)) push(kind);
  }
  return kinds;
}

function readGoal(text: string, budgetMax: number | null, perMonth: boolean): SearchGoal | null {
  if (hasAnyPhrase(text, SHORT_STAY_WORDS)) return 'SHORT_STAY';
  if (hasAnyPhrase(text, RENT_WORDS) || perMonth) return 'RENT';
  if (hasAnyPhrase(text, INVEST_WORDS)) return 'INVEST';
  if (hasAnyPhrase(text, BUY_WORDS)) return 'BUY';
  /*
   * NO VERB, BUT A PRICE THAT ONLY A PURCHASE HAS.
   *
   * "ვეძებ ბინას ვაკეში $200,000-მდე" names no transaction; nobody pays two hundred
   * thousand dollars a month in rent. Twenty thousand in any of the three currencies this
   * market quotes is above every monthly rent it has, so a ceiling at or above it is read
   * as a purchase — and anything below it, with no month marker, is left unread rather
   * than guessed.
   */
  if (budgetMax !== null && budgetMax >= 20000) return 'BUY';
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Counts
 * ──────────────────────────────────────────────────────────────────────── */

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  /* ka */ 'ერთ': 1, 'ორ': 2, 'სამ': 3, 'ოთხ': 4, 'ხუთ': 5,
  /* ru */ 'одно': 1, 'одной': 1, 'двумя': 2, 'тремя': 3, 'четырьмя': 4, 'двух': 2, 'двух-': 2, 'трёх': 3, 'трех': 3, 'четырёх': 4, 'четырех': 4,
  /* en */ 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  /* tr */ 'bir': 1, 'iki': 2, 'üç': 3, 'dört': 4,
  /* ar */ 'واحدة': 1, 'غرفتين': 2, 'غرفتي': 2, 'ثلاث': 3, 'ثلاثة': 3, 'أربع': 4, 'أربعة': 4, 'خمس': 5,
  /* he */ 'אחד': 1, 'שני': 2, 'שתי': 2, 'שלושה': 3, 'שלוש': 3, 'ארבעה': 4, 'ארבע': 4, 'חמישה': 5,
};

const NUM = '(\\d{1,2}|ერთ|ორ|სამ|ოთხ|ხუთ|одно|двух|трёх|трех|четырёх|четырех|one|two|three|four|five|bir|iki|üç|dört)';

interface Counts { bedrooms: number | null; rooms: number | null }

function readCounts(text: string): Counts {
  let bedrooms: number | null = null;
  let rooms: number | null = null;
  const num = (raw: string | undefined) => {
    if (!raw) return null;
    const direct = Number(raw);
    if (Number.isFinite(direct) && direct > 0 && direct < 20) return direct;
    return WORD_NUMBERS[raw.toLowerCase()] ?? null;
  };
  const first = (patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = num(match[1]);
        if (value !== null) return value;
      }
    }
    return null;
  };

  /* Turkish states bedrooms and salons together: 2+1 is two bedrooms and one salon. */
  const turkish = text.match(/(?<!\d)(\d)\s*\+\s*(\d)(?!\d)/);

  bedrooms = first([
    /* ka — 2 საძინებლიანი / ორსაძინებლიანი / 2 საძინებელი */
    new RegExp(`${NUM}\\s*-?\\s*საძინებ`, 'iu'),
    /* en — 2 bedrooms / 2-bedroom / 2BR / 2 bed */
    new RegExp(`(?<!\\p{L})${NUM}\\s*-?\\s*(?:bedroom|bedrooms|br|bed|beds)(?!\\p{L})`, 'iu'),
    /* ru — 2 спальни / с двумя спальнями */
    new RegExp(`(?<!\\p{L})${NUM}\\s*-?\\s*спальн`, 'iu'),
    /(?<!\p{L})(одной|двумя|тремя|четырьмя)\s+спальн/iu,
    /* tr — 2 yatak odalı */
    new RegExp(`(?<!\\p{L})${NUM}\\s*yatak\\s*oda`, 'iu'),
    /* ar — 2 غرف نوم / غرفتي نوم / غرفة نوم واحدة */
    /(?<!\d)(\d{1,2})\s*غرف(?:ة)?\s*نوم/u,
    /(غرفتي|غرفتين)\s*نوم/u,
    /(ثلاث|ثلاثة|أربع|أربعة)\s*غرف\s*نوم/u,
    /* he — 2 חדרי שינה / שני חדרי שינה */
    /(?<!\d)(\d{1,2})\s*חדרי\s*שינה/u,
    /(שני|שתי|שלושה|שלוש|ארבעה|ארבע)\s*חדרי\s*שינה/u,
  ]);
  if (bedrooms === null && /غرفة\s*نوم\s*واحدة/u.test(text)) bedrooms = 1;
  if (bedrooms === null && turkish) bedrooms = Number(turkish[1]) || null;

  rooms = first([
    /* ka — 3 ოთახიანი / სამოთახიანი */
    new RegExp(`${NUM}\\s*-?\\s*ოთახ`, 'iu'),
    /* ru — 3-комнатная / 3 комнаты / трёхкомнатная */
    new RegExp(`(?<!\\p{L})${NUM}\\s*-?\\s*(?:х\\s*-?\\s*)?комнат`, 'iu'),
    /* en — 3 rooms / 3-room */
    new RegExp(`(?<!\\p{L})${NUM}\\s*-?\\s*rooms?(?!\\p{L})`, 'iu'),
    /* tr — 3 odalı (not "yatak odalı", read above) */
    new RegExp(`(?<!yatak\\s)(?<!\\p{L})${NUM}\\s*odalı`, 'iu'),
    /* ar — شقة من 3 غرف / 3 غرف (not followed by نوم) */
    /(?<!\d)(\d{1,2})\s*غرف(?!\s*(?:ة)?\s*نوم)/u,
    /* he — דירת 3 חדרים / 3 חדרים */
    /(?<!\d)(\d{1,2})\s*חדרים/u,
    /(שלושה|ארבעה|חמישה)\s*חדרים/u,
  ]);
  if (rooms === null) {
    if (/однушк/iu.test(text)) rooms = 1;
    else if (/двушк/iu.test(text)) rooms = 2;
    else if (/тр[её]шк/iu.test(text)) rooms = 3;
  }
  return { bedrooms, rooms };
}

/* ────────────────────────────────────────────────────────────────────────
 * Money
 * ──────────────────────────────────────────────────────────────────────── */

const CURRENCY_MARKERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['USD', ['$', 'usd', 'us$', 'dollar', 'dollars', 'დოლარი', 'დოლარად', 'დოლ', 'дол', 'долл',
    'доллар', 'долларов', 'доллара', 'dolar', 'دولار', 'دولارات', 'דולר', 'דולרים']],
  ['GEL', ['₾', 'gel', 'lari', 'ლარი', 'ლარად', 'ლარამდე', 'лари', 'lari', 'لاري', 'לארי']],
  ['EUR', ['€', 'eur', 'euro', 'euros', 'ევრო', 'евро', 'يورو', 'יורו']],
];

/** Currencies somebody might write that this market does not quote in. */
const FOREIGN_CURRENCY = /₪|\bils\b|שקל|₺|\btl\b|türk lirası|₽|руб|£|\bgbp\b/iu;

const MULTIPLIERS: ReadonlyArray<readonly [number, readonly string[]]> = [
  [1_000_000, ['m', 'mln', 'million', 'millions', 'მლნ', 'მილიონი', 'млн', 'миллион', 'milyon',
    'مليون', 'ملايين', 'מיליון']],
  [1_000, ['k', 'к', 'тыс', 'тыс.', 'тысяч', 'ათასი', 'ათას', 'ათ.', 'bin', 'ألف', 'الف', 'آلاف', 'אלף', 'אלפים', "א'"]],
];

const MAX_MARKERS = [
  'მდე', 'მაქსიმუმ', 'მაქს', 'არაუმეტეს', 'ბიუჯეტი', 'ბიუჯეტით',
  'до', 'не более', 'не больше', 'максимум', 'макс', 'бюджет',
  'up to', 'max', 'maximum', 'under', 'below', 'budget', 'no more than', 'within',
  'kadar', 'en fazla', 'maksimum', 'bütçe', 'bütçem',
  'حتى', 'بحد أقصى', 'حد أقصى', 'لا يزيد عن', 'ميزانية', 'ميزانيتي', 'أقل من',
  'עד', 'מקסימום', 'תקציב', 'לא יותר מ',
];
const MIN_MARKERS = [
  'დან', 'მინიმუმ', 'от', 'минимум', 'не менее', 'from', 'at least', 'min', 'minimum',
  'en az', 'minimum', 'على الأقل', 'ابتداء من', 'לפחות', 'החל מ', 'מינימום',
];

interface Amount {
  value: number;
  currency: string | null;
  start: number;
  end: number;
  multiplied: boolean;
}

/** "180,000" / "180.000" / "180 000" / "1,5" — separators read by shape, not locale. */
function parseNumber(raw: string): number | null {
  const compact = raw.replace(/\s+/g, '');
  if (/^\d{1,3}([.,'])\d{3}(\1\d{3})*$/.test(compact)) return Number(compact.replace(/[.,']/g, ''));
  if (/^\d+[.,]\d{1,2}$/.test(compact)) return Number(compact.replace(',', '.'));
  if (/^\d+$/.test(compact)) return Number(compact);
  return null;
}

function readAmounts(text: string): Amount[] {
  const amounts: Amount[] = [];
  const pattern = /(\$|€|₾|us\$)?\s?(\d{1,3}(?:[ ,.'](?:\d{3}))+|\d+(?:[.,]\d{1,2})?)\s?(\p{L}{1,10}\.?|['’]\p{L}+|\$|€|₾|₪)?/giu;
  for (const match of text.matchAll(pattern)) {
    const [whole, prefix, digits, suffixRaw] = match;
    const start = match.index ?? 0;
    const end = start + whole.length;
    let value = parseNumber(digits);
    if (value === null) continue;

    const suffix = (suffixRaw ?? '').toLowerCase().replace(/^['’]/, '');
    let multiplied = false;
    for (const [factor, words] of MULTIPLIERS) {
      if (words.includes(suffix)) { value *= factor; multiplied = true; break; }
    }
    /* A multiplier word written after a space — "180 ათასი", "200 ألف" — is read from
       what follows the number. */
    const after = text.slice(end, end + 14).toLowerCase();
    if (!multiplied) {
      for (const [factor, words] of MULTIPLIERS) {
        const hit = words.find((word) => word.length > 1 && new RegExp(`^\\s*${escape(word)}(?!\\p{L})`, 'iu').test(after));
        if (hit) { value *= factor; multiplied = true; break; }
      }
    }

    /* The currency, from the prefix, the suffix, or the next word or two. */
    const window = `${prefix ?? ''} ${suffix} ${text.slice(end, end + 24)} ${text.slice(Math.max(0, start - 12), start)}`.toLowerCase();
    let currency: string | null = null;
    for (const [code, markers] of CURRENCY_MARKERS) {
      if (markers.some((marker) => (/^[\p{L}]/u.test(marker)
        ? new RegExp(`(?<!\\p{L})(?:[وفبلك])?${escape(marker)}`, 'iu').test(window)
        : window.includes(marker)))) {
        currency = code;
        break;
      }
    }
    if (!currency && FOREIGN_CURRENCY.test(text.slice(Math.max(0, start - 6), end + 16))) currency = 'FOREIGN';

    amounts.push({ value, currency, start, end, multiplied });
  }
  return amounts;
}

interface Budget { min: number | null; max: number | null; currency: string | null }

function readBudget(text: string, excluded: Array<[number, number]>): Budget | null {
  const lower = text.toLowerCase();
  const candidates = readAmounts(text).filter((amount) => {
    /* A number that is a bedroom count, a floor area or a property reference is not money. */
    if (excluded.some(([a, b]) => amount.start < b && amount.end > a)) return false;
    return amount.currency !== null || amount.multiplied || amount.value >= 1000;
  });
  if (!candidates.length) return null;

  /* A currency this market does not quote in makes the figure unreadable, not USD. */
  const priced = candidates.filter((amount) => amount.currency !== 'FOREIGN');
  if (!priced.length) return null;
  const currency = priced.find((amount) => amount.currency)?.currency ?? null;
  /*
   * NO CURRENCY, NO BUDGET. Three currencies are quoted here and they differ by a factor
   * of three; a bare "200000" could be any of them. Stating a budget the person did not
   * state is worse than stating none.
   */
  if (!currency) return null;

  const marked = (amount: Amount, markers: readonly string[]) => {
    const before = lower.slice(Math.max(0, amount.start - 18), amount.start);
    const after = lower.slice(amount.end, amount.end + 12);
    return markers.some((marker) => {
      if (marker === 'მდე' || marker === 'დან') return new RegExp(`^-?\\s*${marker}`, 'u').test(after);
      if (marker === 'kadar') return /^\s*(?:['’]?\p{L}{0,3}\s*)?kadar/u.test(after);
      return phraseRe(marker).test(before) || (marker.length > 2 && new RegExp(`^\\s*${escape(marker)}`, 'iu').test(after));
    });
  };

  if (priced.length >= 2) {
    const values = priced.slice(0, 2).map((amount) => amount.value);
    return { min: Math.min(...values), max: Math.max(...values), currency };
  }
  const only = priced[0];
  if (marked(only, MIN_MARKERS) && !marked(only, MAX_MARKERS)) return { min: only.value, max: null, currency };
  /* A single figure with no direction is a ceiling: people state what they can spend. */
  return { min: null, max: only.value, currency };
}

/* ────────────────────────────────────────────────────────────────────────
 * Area
 * ──────────────────────────────────────────────────────────────────────── */

function readArea(text: string): { min: number | null; max: number | null; span: [number, number] | null } {
  const unit = '(?:m²|m2|кв\\.?\\s*м|м²|м2|sqm|sq\\.?\\s*m|კვ\\.?\\s*მ|კვმ|კვ\\.|metrekare|م²|متر\\s*مربع|מ"ר|מ״ר|מטר)';
  const range = text.match(new RegExp(`(\\d{2,4})\\s*[-–]\\s*(\\d{2,4})\\s*${unit}`, 'iu'));
  if (range && range.index !== undefined) {
    return { min: Number(range[1]), max: Number(range[2]), span: [range.index, range.index + range[0].length] };
  }
  const single = text.match(new RegExp(`(\\d{2,4})\\s*${unit}`, 'iu'));
  if (single && single.index !== undefined) {
    return { min: Number(single[1]), max: null, span: [single.index, single.index + single[0].length] };
  }
  return { min: null, max: null, span: null };
}

/* ────────────────────────────────────────────────────────────────────────
 * Firmness, per clause
 * ──────────────────────────────────────────────────────────────────────── */

const REQUIRED = ['აუცილებლად', 'აუცილებელია', 'მხოლოდ', 'обязательно', 'только', 'must', 'only',
  'definitely', 'strictly', 'kesinlikle', 'mutlaka', 'sadece', 'ضروري', 'فقط', 'يجب', 'لازم',
  'חייב', 'חייבת', 'רק', 'חובה'];
const PREFERRED = ['მირჩევნია', 'სასურველია', 'სასურველი', 'თუ შეიძლება', 'желательно',
  'предпочитаю', 'лучше', 'prefer', 'preferably', 'ideally', 'tercihen', 'tercih ederim',
  'يفضل', 'ويفضل', 'أفضل', 'إن أمكن', 'עדיף', 'מעדיף', 'מעדיפה', 'רצוי', 'אם אפשר'];
const FLEXIBLE = ['არ აქვს მნიშვნელობა', 'ნებისმიერი', 'не важно', 'неважно', 'любой', 'любая',
  "doesn't matter", 'does not matter', 'flexible', 'fark etmez', 'esnek', 'لا يهم', 'مرن',
  'לא משנה', 'גמיש', 'גמישה'];

function explicitFirmness(clause: string): Firmness | null {
  if (hasAnyPhrase(clause, FLEXIBLE)) return 'FLEXIBLE';
  if (hasAnyPhrase(clause, PREFERRED)) return 'PREFERRED';
  if (hasAnyPhrase(clause, REQUIRED)) return 'REQUIRED';
  return null;
}

/** Clauses, split where a sentence changes its mind. */
function clausesOf(text: string): string[] {
  return text
    .split(/,(?!\d{3})|[;!?\n،؛]|\.(?!\d)|\s(?:but|and|მაგრამ|და|но|а|и|ama|ve|لكن|و|אבל|ו)\s/u)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** The explicit firmness of whichever clause mentions a constraint, if it says one. */
function firmnessFor(text: string, test: (clause: string) => boolean): Firmness | null {
  for (const clause of clausesOf(text)) {
    if (test(clause)) {
      const stated = explicitFirmness(clause);
      if (stated) return stated;
    }
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * The reader
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Every constraint a sentence states, in the plan's draft shape.
 *
 * Pure and total. The result is UNTRUSTED in exactly the way a model's draft is, and the
 * caller passes it through normalisePlan() before anything relies on it.
 */
export function readConstraints(input: string): ConstraintReading {
  const text = foldDigits(String(input ?? '')).slice(0, 4000);
  const scripts = scriptsOf(text);

  const { city, districts } = readPlaces(text);
  const propertyTypes = readTypes(text);
  const counts = readCounts(text);
  const area = readArea(text);

  /* Spans that are not money: counts, areas, and anything next to a room word. */
  const excluded: Array<[number, number]> = [];
  if (area.span) excluded.push(area.span);
  for (const match of text.matchAll(/\d{1,2}\s*-?\s*(?:საძინებ|ოთახ|bed|br|room|спальн|комнат|yatak|oda|غرف|חדר)/giu)) {
    excluded.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  for (const match of text.matchAll(/(?<!\d)\d\s*\+\s*\d(?!\d)/g)) {
    excluded.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }
  const budget = readBudget(text, excluded);
  const perMonth = hasAnyPhrase(text, PER_MONTH);
  const goal = readGoal(text, budget?.max ?? budget?.min ?? null, perMonth);

  const placeTest = (names: string[]) => (clause: string) => PLACES
    .filter((place) => names.includes(place.name))
    .some((place) => place.spellings.some((spelling) => placeMatches(clause, spelling)));

  const draft: ConstraintReading = {
    goal,
    countryCode: 'GE',
    city,
    /* The city's own clause decides the city's firmness. A district preference ("ideally
       Saburtalo") is not a preference about being in Tbilisi at all. */
    cityStrength: city ? firmnessFor(text, placeTest([city])) : null,
    districts: districts.length ? districts : null,
    districtsStrength: districts.length ? firmnessFor(text, placeTest(districts)) : null,
    propertyTypes: propertyTypes.length ? propertyTypes : null,
    propertyTypesStrength: null,
    budgetMin: budget?.min ?? null,
    budgetMax: budget?.max ?? null,
    currency: budget?.currency ?? null,
    budgetStrength: budget ? firmnessFor(text, (clause) => /\d/.test(clause) && hasAnyPhrase(clause, [...MAX_MARKERS, ...MIN_MARKERS, '$', '€', '₾'])) : null,
    bedroomsMin: counts.bedrooms,
    bedroomsMax: counts.bedrooms,
    bedroomsStrength: counts.bedrooms !== null
      ? firmnessFor(text, (clause) => /საძინებ|bed|br\b|спальн|yatak|نوم|שינה|\+/iu.test(clause))
      : null,
    roomsMin: counts.rooms,
    roomsMax: counts.rooms,
    areaMin: area.min,
    areaMax: area.max,
    areaStrength: null,
    originalText: input,
    originalLanguage: languageGuess(text, scripts),
    scripts,
    found: [goal, city, districts.length ? 1 : null, propertyTypes.length ? 1 : null, budget,
      counts.bedrooms, counts.rooms, area.min].filter((value) => value !== null && value !== undefined).length,
  };
  return draft;
}

/** A guess at the dominant language, for display. Never a gate on reading. */
function languageGuess(text: string, scripts: string[]): string | null {
  if (scripts.includes('GEORGIAN')) return 'ka';
  if (scripts.includes('HEBREW')) return 'he';
  if (scripts.includes('ARABIC')) return 'ar';
  if (scripts.includes('CYRILLIC')) return 'ru';
  if (/[çğışöü]|\b(?:arıyorum|istiyorum|daire|kiralık|satılık)\b/iu.test(text)) return 'tr';
  if (scripts.includes('LATIN')) return 'en';
  return null;
}
