// A PLAN THE SERVER WOULD REALLY SEND BACK.
//
// The harness stubbed every edge function with `{}`, which for Find Property meant the
// plan stage was unreachable: planFromDescription() returned an empty object, `plan` was
// undefined, and the page fell through to the empty-BUY editor — so the one screen that
// had to be inspected could not be rendered at all.
//
// THE SHAPE IS THE DECLARED ONE, not one I invented to suit the component. Every field
// here exists because `SearchPlan` in src/services/findProperty.ts declares it and
// normalisePlan() in src/research-core/discovery/search-plan.ts produces it:
//
//   · nested PlanConstraint objects, `{ value, strength }`, never flattened
//   · `deal` is dealFor(goal) — SALE for BUY
//   · districts default to PREFERRED and a city to REQUIRED, which is the real default
//     and the reason the summary has two different strength words to show
//   · `languages` are codes from the supported six, lowercased
//   · `rejected` carries the server's own English sentence, for an operator, and
//     `rejections` the same discard as a key and the customer's own word — which is what
//     the interface renders, because the customer is not necessarily reading English
//
// A fixture that flattened the constraints, or that made everything REQUIRED, would have
// produced a screenshot of a page that cannot happen.

/**
 * The one thing the model offered that is not a place, in the language it was said in.
 *
 * A COMMA IS WHAT placeOf REALLY REFUSES. It is a shape check rather than a gazetteer, so
 * "somewhere near a metro" survives it, and a fixture discarding that phrase would be
 * showing a screen the product cannot produce. One string holding two places is what a
 * model asked for a list sometimes returns; it is discarded, the same way in every script.
 *
 * A customer writing Georgian does not type an English phrase, so a fixture that dropped
 * one would screenshot a sentence nobody could have produced — and the whole point of the
 * line is that it quotes the customer back at themselves.
 */
const DROPPED = {
  en: 'near a metro, with a park',
  ka: 'metro-სთან, პარკთან',
  ru: 'рядом с метро, с парком',
  tr: 'metroya yakın, parkı olan',
  ar: 'قريب من المترو, مع حديقة',
  he: 'ליד הרכבת התחתית, עם פארק',
};

/**
 * A draft reading of a real request: a family flat to buy in Tbilisi, Vake or Saburtalo
 * preferred, under $150,000, two bedrooms or more, from 70m².
 *
 * @param {string} text what the customer actually typed, echoed back as the server does
 */
export function planDraft(text, lang = 'en') {
  const dropped = DROPPED[lang] ?? DROPPED.en;
  return {
    success: true,
    mode: 'draft',
    interpreted: true,
    model: 'harness',
    note: null,
    plan: {
      goal: 'BUY',
      deal: 'SALE',
      countryCode: 'GE',
      city: { value: 'Tbilisi', strength: 'REQUIRED' },
      districts: { value: ['Vake', 'Saburtalo'], strength: 'PREFERRED' },
      propertyTypes: { value: ['APARTMENT'], strength: 'REQUIRED' },
      budget: { value: { min: null, max: 150000, currency: 'USD' }, strength: 'REQUIRED' },
      bedrooms: { value: { min: 2, max: null }, strength: 'PREFERRED' },
      areaSqm: { value: { min: 70, max: null }, strength: 'PREFERRED' },
      languages: ['ka', 'ru', 'en'],
      originalText: String(text ?? ''),
      originalLanguage: 'ka',
    },
    /* Both forms, as a redeployed server sends them: the operator sentence in English
       and the same discard as a key the interface can say in six languages. */
    rejected: [`district ${JSON.stringify(dropped)} is not a place name`],
    rejections: [{ key: 'plan_dropped_district', value: dropped }],
    readiness: { ready: true, missingKeys: [] },
    persisted: false,
    charged: { credits: 0 },
    elapsedMs: 780,
  };
}

/**
 * The same request, unread.
 *
 * `interpreted: false` is a state the page has to render — the model was unreachable and
 * the customer still has their words — and it is the one state a fixture will never reach
 * by accident, so it is written down.
 */
export function planUnread(text) {
  return {
    success: true,
    mode: 'draft',
    interpreted: false,
    model: null,
    note: 'model_unavailable',
    plan: null,
    rejected: [],
    readiness: { ready: false, missingKeys: ['plan_missing_goal'] },
    persisted: false,
    charged: { credits: 0 },
    elapsedMs: 40,
    originalText: String(text ?? ''),
  };
}

/** What a customer would type, in the language the screenshot is taken in. */
export const DESCRIPTIONS = {
  en: 'A two-bedroom flat in Vake or Saburtalo, up to $150,000, at least 70m². '
    + 'I would prefer a balcony near a metro, with a park, but the floor does not matter.',
  ka: 'მინდა ორსაძინებლიანი ბინა ვაკეში ან საბურთალოზე, 150 000 დოლარამდე, '
    + 'მინიმუმ 70 კვადრატული. სასურველია აივანი, metro-სთან, პარკთან; სართული არ მაინტერესებს.',
  ru: 'Ищу двухспальную квартиру в Ваке или на Сабуртало, до 150 000 долларов, '
    + 'не меньше 70 квадратов. Желательно с балконом, рядом с метро, с парком, этаж не важен.',
  tr: 'Vake veya Saburtalo\'da iki yatak odalı bir daire arıyorum, 150.000 dolara kadar, '
    + 'en az 70 metrekare. Balkon tercih ederim, metroya yakın, parkı olan, kat önemli değil.',
  ar: 'أبحث عن شقة بغرفتي نوم في فاكي أو سابورتالو، حتى 150,000 دولار، '
    + '70 مترًا مربعًا على الأقل. أفضّل وجود شرفة، قريب من المترو, مع حديقة، والطابق لا يهمني.',
  he: 'אני מחפש דירת שני חדרי שינה בוואקה או בסבורטלו, עד 150,000 דולר, '
    + 'לפחות 70 מ״ר. מעדיף מרפסת ליד הרכבת התחתית, עם פארק, הקומה לא משנה.',
};

/** Listing titles as a seller would write them, in the market's own languages. */
const TITLES = [
  '\u10d1\u10d8\u10dc\u10d0 \u10d5\u10d0\u10d9\u10d4\u10e8\u10d8, 3 \u10dd\u10d7\u10d0\u10ee\u10d8, \u10d0\u10d8\u10d5\u10d0\u10dc\u10d8\u10d7 \u10d3\u10d0 \u10d0\u10d5\u10e2\u10dd\u10e1\u10d0\u10d3\u10d2\u10dd\u10db\u10d8\u10d7',
  '\u041f\u0440\u043e\u0434\u0430\u0451\u0442\u0441\u044f \u0441\u0432\u0435\u0442\u043b\u0430\u044f \u043a\u0432\u0430\u0440\u0442\u0438\u0440\u0430 \u043d\u0430 \u0421\u0430\u0431\u0443\u0440\u0442\u0430\u043b\u043e',
  'Renovated two-bedroom near Vake Park',
];

/**
 * What the matcher found, ready to render.
 *
 * @param {number} count how many results, 1 to 3
 */
export function searchResults(count = 3) {
  const now = Date.now();
  const rows = [
    {
      id: 'r-1',
      score: 0.91,
      deal: 'SALE',
      roles: { demand: 'BUYER', supply: 'OWNER' },
      whyThisMatches: null,
      agreed: ['City matches', 'Property type matches', 'Budget overlaps'],
      preferenceMisses: [],
      notStated: [],
      flexible: [],
      freshness: {
        /* Eleven days. Days, on the shared scale. */
        publishedAt: new Date(now - 11 * 86400000).toISOString(),
        firstSeenAt: new Date(now - 10 * 86400000).toISOString(),
        lastVerifiedAt: new Date(now - 2 * 86400000).toISOString(),
        listingAgeCeilingDays: 180,
        listingAgeCeilingBasis: 'SOURCE_POLICY',
      },
      listing: {
        id: 'l-1', title: TITLES[0], url: 'https://www.myhome.ge/ka/pr/1234567',
        city: 'Tbilisi', district: 'Vake', transaction: 'SALE', propertyType: 'APARTMENT',
        areaSqm: 78, rooms: 3, bedrooms: 2,
        price: { amount: 142000, currency: 'USD' }, language: 'ka', source: 'myhome.ge',
      },
      supply: {
        role: 'BROKER',
        broker: {
          id: 'b-1', role: 'BROKER', name: 'Rustaveli Estate',
          provenance: {
            identifiedBy: 'LISTING_ATTRIBUTION', seenOnSources: 3, listingsAttributed: 12,
            firstSeenAt: null, lastSeenAt: null, lastVerifiedAt: null,
            validationState: 'OBSERVED',
          },
          coverage: { cities: ['Tbilisi'], languages: ['ka', 'ru'] },
          presentation: 'MARKET_INTELLIGENCE',
          /* The key broker-identity.ts really emits for an observed firm. */
          labelKey: 'broker_disclosure_observed',
          /* False, and it is false for every firm found by reading a portal. */
          registeredWithHomatch: false,
        },
      },
    },
    {
      id: 'r-2',
      score: 0.78,
      deal: 'SALE',
      roles: { demand: 'BUYER', supply: null },
      whyThisMatches: null,
      agreed: ['City matches', 'Property type matches'],
      /*
       * A preference this one misses, named rather than folded into the score. These are
       * MatchDimension enum values — not free text — which is what compatibility.ts puts
       * in the column and what the card has to be able to say in six languages.
       */
      preferenceMisses: ['DISTRICT'],
      notStated: [], flexible: [],
      freshness: {
        publishedAt: new Date(now - 140 * 86400000).toISOString(),
        firstSeenAt: null, lastVerifiedAt: null,
        listingAgeCeilingDays: null, listingAgeCeilingBasis: null,
      },
      listing: {
        id: 'l-2', title: TITLES[1], url: 'https://ss.ge/ka/real-estate/2345678',
        city: 'Tbilisi', district: 'Saburtalo', transaction: 'SALE', propertyType: 'APARTMENT',
        areaSqm: 71, rooms: 3, bedrooms: 2,
        price: { amount: 128500, currency: 'USD' }, language: 'ru', source: 'ss.ge',
      },
      /* No broker: a private seller, which is most of this market. */
      supply: { role: 'OWNER', broker: null },
    },
    {
      id: 'r-3',
      score: 0.66,
      deal: 'SALE',
      roles: { demand: 'BUYER', supply: null },
      whyThisMatches: null,
      agreed: ['City matches'],
      preferenceMisses: [], notStated: [], flexible: [],
      freshness: {
        /* Nobody recorded when this was published. The card says nothing about age
           rather than implying it is fresh. */
        publishedAt: null,
        firstSeenAt: new Date(now - 3 * 86400000).toISOString(),
        lastVerifiedAt: null,
        listingAgeCeilingDays: null, listingAgeCeilingBasis: null,
      },
      listing: {
        id: 'l-3', title: TITLES[2], url: 'https://home.ge/en/listing/3456789',
        city: 'Tbilisi', district: 'Vake', transaction: 'SALE', propertyType: 'APARTMENT',
        areaSqm: 64, rooms: 2, bedrooms: 1,
        price: { amount: 119000, currency: 'USD' }, language: 'en', source: 'home.ge',
      },
      supply: { role: null, broker: null },
    },
  ].slice(0, Math.max(1, Math.min(3, count)));

  return {
    success: true,
    searches: 1,
    results: rows,
    state: 'HAS_RESULTS',
    note: null,
    included: true,
  };
}
