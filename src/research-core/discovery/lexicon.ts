// HOMATCH RESEARCH CORE — how people actually say it, in seven languages.
//
// A job typed in English must not be researched only in English. Somebody in
// Tbilisi looking for a flat writes "ვეძებ ბინას", a Russian speaker writes
// "ищу квартиру", and neither appears in an English query however many
// synonyms it carries. This table is what makes a one-language job into a
// seven-language search.
//
// SEMANTIC VARIANTS, NOT TRANSLATIONS
//
// "looking for" translated literally into Georgian is not what a Georgian
// writes. Each entry below is what a native speaker types into a Facebook
// group, which is a different thing from what a dictionary returns — so the
// lists are phrasings, and several of them are not translations of each other
// at all.
//
// WHY IT IS A TABLE AND NOT A PROMPT
//
// A model asked to expand a query returns something different every time,
// cannot be diffed, and cannot be reviewed by somebody who speaks the
// language. A table can be read by a Georgian speaker and corrected. AI may
// still widen a plan on top of this (Homatch already uses it that way in
// classify-signals-v2, deterministic filter first) — but it is never the
// floor, and it never decides what counts as evidence.
//
// ADDING A LANGUAGE is adding a key. Nothing in the planner, the classifier
// or the scorer knows which languages exist.

/**
 * The languages Homatch researches in.
 *
 * The first six are the product's own locales. `hi` is discovery-only: there
 * is a real Indian buyer population in Georgia, and a job typed in English
 * should reach it, but Homatch does not render a Hindi UI — so it appears
 * here and not in the i18n bundle. That asymmetry is deliberate and is why
 * this list is separate from the locale list rather than derived from it.
 */
export const RESEARCH_LANGUAGES = ['ka', 'en', 'ru', 'ar', 'tr', 'he', 'hi'] as const;

export type ResearchLanguage = (typeof RESEARCH_LANGUAGES)[number];

export function isResearchLanguage(value: string): value is ResearchLanguage {
  return (RESEARCH_LANGUAGES as readonly string[]).includes(value);
}

/** The phrase buckets a query plan draws on. */
export interface LanguageLexicon {
  /** "looking to buy", "ვეძებ საყიდლად" — somebody WANTS to buy. */
  wantToBuy: string[];
  /** Somebody WANTS to rent. */
  wantToRent: string[];
  /** Somebody wants to invest. */
  wantToInvest: string[];
  /** Somebody is moving here and will need somewhere. */
  relocating: string[];
  /**
   * "I am looking for" — the seeking verb, on its own.
   *
   * WHY THIS BUCKET HAD TO EXIST. Every phrase above is matched
   * CONTIGUOUSLY, and in most of these languages the verb and its object are
   * not adjacent: a Russian speaker writes "ищу КВАРТИРУ в Тбилиси для
   * инвестиций", not "ищу для инвестиций"; a Turk writes "satılık daire
   * ARIYORUM". The phrase table held the joined-up forms, so four of the six
   * languages silently failed to recognise their own most common way of
   * asking to buy a flat — and Turkish read "satılık daire arıyorum" (I am
   * looking for an apartment for sale) as a SELLER, because `satılık` matched
   * and nothing else did.
   *
   * A bare seeking verb is not evidence of property demand: "ищу
   * сантехника" is somebody looking for a plumber. So these count ONLY when
   * the text also names a property noun, which is the condition that makes
   * them safe to be this broad.
   */
  seeking: string[];
  /**
   * "Looking for a tenant" — a seeking verb pointing the other way.
   *
   * A landlord advertising for tenants and a tenant looking for a flat both
   * open with "looking for", and they are opposite sides of the market.
   * Checked BEFORE `seeking`, because it is the more specific reading and
   * getting it wrong files every landlord as a renter.
   */
  seekingCounterparty: string[];
  /** "for sale", "იყიდება" — somebody IS SELLING. Supply side. */
  forSale: string[];
  /** "for rent", "ქირავდება" — somebody IS LETTING. Supply side. */
  forRent: string[];
  /** Property nouns: apartment, house, land, commercial. */
  propertyTypes: Record<PropertyTerm, string[]>;
  /** "budget", "price up to". */
  budget: string[];
  /**
   * FIRST-PERSON AGENCY SPEECH. Not the word "agency".
   *
   * These decide agencyVoice, which disqualifies a post as DEMAND: "we have
   * clients looking for 2BR flats" is a sales pitch aimed at sellers, not a
   * lead.
   *
   * THE LIST USED TO CONTAIN BARE NOUNS -- agency, agent, broker, realtor,
   * სააგენტო, агентство -- and matched anybody who MENTIONED an agency.
   * Production, 2026-09-25, forum.ge board 92, all three flagged as agency
   * voice and all three real buyers:
   *
   *   "მე ბინას ვეძებ, ჯერ სააგენტო ... არ შემხვედრია რომელიც ტყუილში არ დავიჭირე"
   *     I'm looking for a flat; I have not met an agent who did not lie
   *   "მინდა ბინა შევიძინო ... სააგენტოები არ გამომეხმაურონო"
   *     I want to buy a flat; the seller says agencies should not call
   *   "ორი კვირაა რაც ვრეკავ უძრავი ქონების სააგენტოებში"
   *     for two weeks I have been ringing estate agencies
   *
   * The second one is a buyer explicitly saying agencies should not contact
   * her, marked as an agency. These are the three strongest leads the board
   * produced, and every one would have been discarded.
   *
   * A noun names a topic; only a verb in the first person names a speaker.
   * Same failure as "дом" inside "рядом": a keyword standing in for a
   * judgement.
   */
  agency: string[];
}

export type PropertyTerm =
  | 'apartment'
  | 'house'
  | 'land'
  | 'commercial'
  | 'property';

export const PROPERTY_TERMS: readonly PropertyTerm[] = [
  'apartment',
  'house',
  'land',
  'commercial',
  'property',
];

/* ────────────────────────────────────────────────────────────────────────
 * The table.
 *
 * Every phrase here is lowercase. Georgian, Arabic and Hebrew have no case,
 * so lowercasing is a no-op for them and the matcher stays uniform.
 * ──────────────────────────────────────────────────────────────────────── */

export const LEXICON: Record<ResearchLanguage, LanguageLexicon> = {
  en: {
    wantToBuy: [
      'looking to buy', 'want to buy', 'wanting to buy', 'need to buy',
      'searching for a place to buy', 'in the market for', 'buyer looking for',
      'anyone selling', 'any recommendations for buying', 'planning to purchase',
    ],
    wantToRent: [
      'looking to rent', 'want to rent', 'need to rent', 'looking for a rental',
      'searching for an apartment to rent', 'anyone renting out', 'need a place to stay long term',
      'tenant looking for',
    ],
    wantToInvest: [
      'looking to invest', 'investment opportunity wanted', 'investor looking for',
      'looking for rental yield', 'buy to let', 'looking for a rental investment',
    ],
    relocating: [
      'moving to', 'relocating to', 'just moved to', 'planning to move to',
      'settling in', 'coming to live in',
    ],
    seeking: [
      'looking for', 'searching for', 'in search of', 'need to find', 'hoping to find',
      'anyone got', 'anyone have', 'recommendations for',
    ],
    seekingCounterparty: [
      'looking for tenants', 'looking for a tenant', 'looking for buyers',
      'looking for a buyer', 'seeking tenants', 'tenant wanted', 'buyer wanted',
      'looking for a new owner',
    ],
    forSale: ['for sale', 'selling my', 'price negotiable', 'owner selling', 'direct from owner'],
    forRent: ['for rent', 'available for rent', 'renting out', 'now available', 'monthly rent'],
    propertyTypes: {
      apartment: ['apartment', 'flat', 'studio', 'condo', 'penthouse'],
      house: ['house', 'villa', 'townhouse', 'cottage', 'private house'],
      land: ['land', 'plot', 'land plot', 'parcel', 'agricultural land', 'building plot'],
      commercial: ['commercial', 'office', 'retail space', 'warehouse', 'shop', 'business space'],
      property: ['property', 'real estate', 'place'],
    },
    budget: ['budget', 'up to', 'max price', 'price range', 'around'],
    agency: ['we have', 'our listings', 'contact us'],
  },

  ka: {
    wantToBuy: [
      'ვეძებ საყიდლად', 'მინდა ვიყიდო', 'ვიყიდი', 'ბინის ყიდვა მინდა',
      'ვეძებ ბინას საყიდლად', 'ვყიდულობ', 'მჭირდება ბინა საყიდლად',
    ],
    wantToRent: [
      'ვეძებ ქირით', 'მინდა ვიქირაო', 'ვიქირავებ', 'ბინა მჭირდება ქირით',
      'ვეძებ გასაქირავებელ ბინას', 'დროებით საცხოვრებელი მჭირდება',
    ],
    wantToInvest: [
      'ინვესტიციისთვის ვეძებ', 'ინვესტორი ეძებს', 'ვეძებ საინვესტიციო ბინას',
      'შემოსავლიანი ბინა მაინტერესებს',
    ],
    relocating: ['გადმოვდივარ', 'გადავდივარ', 'ვსახლდები', 'ჩამოვდივარ საცხოვრებლად'],
    seeking: ['ვეძებ', 'ვეძებთ', 'მჭირდება', 'მინდა', 'მაინტერესებს', 'ვეძებდი'],
    seekingCounterparty: [
      'ვეძებ მდგმურს', 'ვეძებ დამქირავებელს', 'ვეძებ მყიდველს',
      'მდგმური მჭირდება', 'დამქირავებელი მჭირდება',
    ],
    forSale: ['იყიდება', 'ბინა იყიდება', 'გასაყიდია', 'მესაკუთრისგან'],
    forRent: ['ქირავდება', 'გასაქირავებელია', 'ბინა ქირავდება', 'თვიური ქირა'],
    propertyTypes: {
      apartment: ['ბინა', 'ბინას', 'სტუდიო', 'აპარტამენტი'],
      house: ['სახლი', 'სახლს', 'კერძო სახლი', 'აგარაკი', 'ვილა'],
      land: ['მიწა', 'ნაკვეთი', 'მიწის ნაკვეთი', 'სასოფლო სამეურნეო მიწა'],
      commercial: ['კომერციული', 'ოფისი', 'სავაჭრო ფართი', 'საწყობი', 'ფართი'],
      property: ['უძრავი ქონება', 'ქონება'],
    },
    budget: ['ბიუჯეტი', 'მაქსიმუმ', 'ფასი', 'დაახლოებით'],
    agency: ['დაგვიკავშირდით', 'გთავაზობთ'],
  },

  ru: {
    wantToBuy: [
      'ищу купить', 'хочу купить', 'куплю', 'ищу квартиру для покупки',
      'рассматриваю покупку', 'подскажите где купить', 'нужна квартира купить',
    ],
    wantToRent: [
      'ищу снять', 'хочу снять', 'сниму', 'нужна аренда', 'ищу квартиру в аренду',
      'сниму квартиру', 'ищу жилье надолго',
    ],
    wantToInvest: [
      'инвестор ищет', 'ищу для инвестиций', 'инвестиционная недвижимость',
      'ищу доходную недвижимость',
    ],
    relocating: ['переезжаю в', 'перебираюсь в', 'переехал в', 'планирую переезд'],
    seeking: [
      'ищу', 'ищем', 'нужна', 'нужен', 'нужно', 'подскажите', 'рассматриваю',
      'интересует', 'посоветуйте', 'хочу найти',
    ],
    seekingCounterparty: [
      'ищу арендатора', 'ищем арендатора', 'ищу квартиранта', 'ищу жильца',
      'ищу покупателя', 'нужен арендатор', 'нужен квартирант',
    ],
    forSale: ['продается', 'продаётся', 'продам', 'от собственника', 'срочно продам'],
    forRent: ['сдается', 'сдаётся', 'сдам', 'в аренду', 'помесячно'],
    propertyTypes: {
      apartment: ['квартира', 'квартиру', 'студия', 'апартаменты'],
      house: ['дом', 'вилла', 'таунхаус', 'частный дом', 'коттедж'],
      land: ['земля', 'участок', 'земельный участок', 'сельхоз участок'],
      commercial: ['коммерческая', 'офис', 'торговая площадь', 'склад', 'помещение'],
      property: ['недвижимость', 'жилье', 'жильё'],
    },
    budget: ['бюджет', 'до', 'максимум', 'в районе', 'ценовой диапазон'],
    agency: ['наши объекты', 'звоните'],
  },

  tr: {
    wantToBuy: [
      'satın almak istiyorum', 'ev almak istiyorum', 'alıcıyım', 'daire arıyorum satılık',
      'almak için arıyorum', 'yatırımlık almak istiyorum',
    ],
    wantToRent: [
      'kiralamak istiyorum', 'kiralık arıyorum', 'kiracıyım', 'ev arıyorum kiralık',
      'uzun dönem kiralık arıyorum',
    ],
    wantToInvest: ['yatırımcı arıyor', 'yatırım için arıyorum', 'yatırımlık gayrimenkul'],
    relocating: ['taşınıyorum', 'yerleşiyorum', 'taşınmayı planlıyorum'],
    seeking: [
      'arıyorum', 'arıyoruz', 'aranıyor', 'istiyorum', 'lazım', 'bakıyorum',
      'ihtiyacım var', 'tavsiye',
    ],
    seekingCounterparty: [
      'kiracı arıyorum', 'kiracı aranıyor', 'kiracı lazım', 'alıcı arıyorum',
      'müşteri arıyorum', 'alıcı aranıyor',
    ],
    forSale: ['satılık', 'sahibinden satılık', 'acil satılık'],
    forRent: ['kiralık', 'sahibinden kiralık', 'aylık kira'],
    propertyTypes: {
      apartment: ['daire', 'apartman dairesi', 'stüdyo', 'rezidans'],
      house: ['ev', 'villa', 'müstakil ev', 'yazlık'],
      land: ['arsa', 'arazi', 'tarla', 'imarlı arsa'],
      commercial: ['ticari', 'ofis', 'dükkan', 'depo', 'işyeri'],
      property: ['gayrimenkul', 'emlak', 'konut'],
    },
    budget: ['bütçe', 'en fazla', 'fiyat aralığı', 'civarında'],
    agency: ['bize ulaşın', 'ofisimiz'],
  },

  ar: {
    wantToBuy: [
      'أبحث عن شقة للشراء', 'أريد شراء', 'أرغب في شراء', 'مطلوب شقة للشراء',
      'أبحث عن عقار للشراء', 'من لديه شقة للبيع',
    ],
    wantToRent: [
      'أبحث عن شقة للإيجار', 'أريد استئجار', 'مطلوب شقة للإيجار',
      'أبحث عن سكن', 'أبحث عن إيجار طويل',
    ],
    wantToInvest: ['مستثمر يبحث عن', 'أبحث عن عقار استثماري', 'فرصة استثمارية عقارية'],
    relocating: ['انتقل إلى', 'سأنتقل إلى', 'أخطط للانتقال'],
    seeking: [
      'أبحث عن', 'ابحث عن', 'نبحث عن', 'مطلوب', 'أريد', 'اريد', 'أرغب في',
      'أحتاج', 'احتاج',
    ],
    seekingCounterparty: [
      'أبحث عن مستأجر', 'مطلوب مستأجر', 'أبحث عن مشتري', 'مطلوب مشتري',
    ],
    forSale: ['للبيع', 'شقة للبيع', 'من المالك مباشرة'],
    forRent: ['للإيجار', 'شقة للإيجار', 'إيجار شهري'],
    propertyTypes: {
      apartment: ['شقة', 'ستوديو', 'بنتهاوس'],
      house: ['منزل', 'فيلا', 'بيت'],
      land: ['أرض', 'قطعة أرض', 'أرض زراعية'],
      commercial: ['تجاري', 'مكتب', 'محل', 'مستودع'],
      property: ['عقار', 'عقارات'],
    },
    budget: ['الميزانية', 'حتى', 'السعر', 'حوالي'],
    agency: ['تواصل معنا', 'لدينا'],
  },

  he: {
    wantToBuy: [
      'מחפש לקנות', 'רוצה לקנות', 'מחפש דירה לקנייה', 'מעוניין לרכוש',
      'מחפשת דירה לקנייה',
    ],
    wantToRent: [
      'מחפש לשכור', 'רוצה לשכור', 'מחפש דירה להשכרה', 'מחפשת דירה להשכרה',
      'מחפש מקום למגורים',
    ],
    wantToInvest: ['משקיע מחפש', 'מחפש נכס להשקעה', 'הזדמנות השקעה בנדלן'],
    relocating: ['עובר ל', 'עוברת ל', 'מתכנן לעבור'],
    seeking: [
      'מחפש', 'מחפשת', 'מחפשים', 'מעוניין', 'מעוניינת', 'דרוש', 'דרושה',
      'צריך', 'צריכה',
    ],
    seekingCounterparty: [
      'מחפש שוכר', 'מחפש דייר', 'מחפשת שוכר', 'מחפש קונה', 'דרוש שוכר',
    ],
    forSale: ['למכירה', 'דירה למכירה', 'מהבעלים'],
    forRent: ['להשכרה', 'דירה להשכרה', 'שכר דירה חודשי'],
    propertyTypes: {
      apartment: ['דירה', 'סטודיו', 'פנטהאוז'],
      house: ['בית', 'וילה', 'בית פרטי'],
      land: ['קרקע', 'מגרש', 'חלקה'],
      commercial: ['מסחרי', 'משרד', 'חנות', 'מחסן'],
      property: ['נדלן', 'נדל"ן', 'נכס'],
    },
    budget: ['תקציב', 'עד', 'טווח מחירים', 'בערך'],
    agency: ['צרו קשר', 'יש לנו'],
  },

  hi: {
    wantToBuy: [
      'खरीदना चाहता हूं', 'फ्लैट खरीदना है', 'घर खरीदना है', 'खरीदने के लिए ढूंढ रहा हूं',
      'looking to buy flat', 'property kharidna hai',
    ],
    wantToRent: [
      'किराए पर चाहिए', 'रेंट पर चाहिए', 'किराए का घर चाहिए',
      'looking for rent flat', 'rent par chahiye',
    ],
    wantToInvest: ['निवेश के लिए', 'investment ke liye property', 'निवेश करना चाहता हूं'],
    relocating: ['शिफ्ट हो रहा हूं', 'move कर रहा हूं', 'रहने आ रहा हूं'],
    seeking: [
      'ढूंढ रहा हूं', 'ढूंढ रही हूं', 'चाहिए', 'तलाश है', 'looking for',
      'chahiye', 'dhoond raha hun',
    ],
    seekingCounterparty: [
      'किरायेदार चाहिए', 'किरायेदार की तलाश', 'खरीदार चाहिए', 'tenant chahiye',
    ],
    forSale: ['बिकाऊ', 'बिक्री के लिए', 'for sale', 'सेल में'],
    forRent: ['किराए के लिए', 'रेंट के लिए', 'available on rent'],
    propertyTypes: {
      apartment: ['फ्लैट', 'अपार्टमेंट', 'स्टूडियो'],
      house: ['घर', 'मकान', 'विला', 'बंगला'],
      land: ['जमीन', 'प्लॉट', 'भूमि'],
      commercial: ['कमर्शियल', 'ऑफिस', 'दुकान', 'गोदाम'],
      property: ['प्रॉपर्टी', 'संपत्ति'],
    },
    budget: ['बजट', 'तक', 'कीमत', 'लगभग'],
    agency: ['संपर्क करें', 'हमारे पास'],
  },
};

/** Every phrase in a bucket, across every language. Used by the classifier. */
export function allPhrases(
  bucket: Exclude<keyof LanguageLexicon, 'propertyTypes'>,
  languages: readonly ResearchLanguage[] = RESEARCH_LANGUAGES,
): string[] {
  const out: string[] = [];
  for (const language of languages) out.push(...LEXICON[language][bucket]);
  return out;
}

/** Every property noun for a term, across every language. */
export function allPropertyTerms(
  term: PropertyTerm,
  languages: readonly ResearchLanguage[] = RESEARCH_LANGUAGES,
): string[] {
  const out: string[] = [];
  for (const language of languages) out.push(...LEXICON[language].propertyTypes[term]);
  return out;
}

/**
 * Which languages a market is realistically written in.
 *
 * Not "the official language": a Tbilisi housing group carries Georgian,
 * Russian and English in the same thread, and the Arabic, Turkish, Hebrew and
 * Hindi-speaking buyer populations are real. Over-searching a language costs
 * a few queries; missing one loses the result entirely, so this errs wide.
 */
export function languagesForMarket(countryCode: string): ResearchLanguage[] {
  const code = countryCode.trim().toUpperCase();
  switch (code) {
    case 'GE':
      return ['ka', 'ru', 'en', 'tr', 'ar', 'he', 'hi'];
    case 'TR':
      return ['tr', 'en', 'ru', 'ar'];
    case 'AE':
    case 'SA':
    case 'QA':
      return ['ar', 'en', 'hi', 'ru'];
    case 'IL':
      return ['he', 'en', 'ru', 'ar'];
    case 'RU':
    case 'KZ':
    case 'AM':
      return ['ru', 'en'];
    case 'IN':
      return ['hi', 'en'];
    default:
      // An unknown market is not a reason to search in one language.
      return ['en', 'ru'];
  }
}
