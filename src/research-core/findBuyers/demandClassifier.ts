// DEMAND CLASSIFIER — what a public post/comment/message actually is, in
// the six languages (ka, ru, en, ar, he, tr). Pure and deterministic.
//
// The first production campaign (VILLION, 2026-10-09) showed why a phrase
// is never enough: "ищу работу" (job), "ищу нянечку" (hiring a nanny),
// "ищу квартиру … до 500$" (renting), "Apartment for Sale" (a seller) were
// all labelled buyers because "ищу / looking for / ვეძებ" matched. Here a
// reading is built from independent evidence:
//
//   domain        is this about residential real estate at all?
//                 (a property noun or a room spec — never a seeker verb alone)
//   job/service   job seeking, hiring, service ads → never property demand
//   direction     seeking (first person) vs offering (listing structure,
//                 "for sale", "сдаётся", "იყიდება" …), by which comes first
//   transaction   BUY vs RENT from explicit words, then from the money scale
//                 (a $500 budget is a monthly rent, a $53,000 one a purchase)
//   constraints   budget (range, currency, monthly vs total, a down payment
//                 is NOT a budget), places, rooms/bedrooms, area, type
//
// Unclear text is UNCLEAR (needsModel) — never promoted to demand by default.
// The model may resolve an UNCLEAR reading but cannot overturn a rule that
// found job/service/offer evidence (see boundModelReading).

import { CITY_NAMES, cityMentioned, districtsMentioned } from './places.ts';

export type DemandRole =
  | 'BUY_SEEKER' | 'RENT_SEEKER' | 'SALE_OFFER' | 'RENT_OFFER'
  | 'AGENT' | 'SERVICE' | 'JOB' | 'IRRELEVANT' | 'UNCLEAR';

export const DEMAND_ROLES: readonly DemandRole[] = ['BUY_SEEKER', 'RENT_SEEKER', 'SALE_OFFER', 'RENT_OFFER', 'AGENT', 'SERVICE', 'JOB', 'IRRELEVANT', 'UNCLEAR'];

export type Money = { amount: number; currency: 'USD' | 'GEL' | 'EUR' };

export interface Budget {
  min: number | null;
  max: number | null;
  currency: 'USD' | 'GEL' | 'EUR';
  period: 'TOTAL' | 'MONTHLY' | null;
  /** The literal text the numbers came from (evidence, never invented). */
  evidence: string;
}

export interface DemandReading {
  role: DemandRole;
  /** BUY / RENT for seekers and offers; null when the text does not say. */
  transaction: 'BUY' | 'RENT' | null;
  realEstate: boolean;
  residential: boolean;
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | null;
  /** Seeking on someone else's behalf ("for my client"). */
  intermediary: boolean;
  budget: Budget | null;
  downPayment: Money | null;
  cities: string[];
  districts: string[];
  /** "district doesn't matter" / "any area". */
  locationFlexible: boolean;
  rooms: number | null;
  bedrooms: number | null;
  areaSqm: number | null;
  /** Rule ids that decided the reading (explainable). */
  evidence: string[];
  confidence: number;
  needsModel: boolean;
}

/* ── lexicons ──────────────────────────────────────────────────────────── */

const L = (parts: string[]) => new RegExp(parts.join('|'), 'iu');
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

/** Residential property nouns. */
const RESIDENTIAL = L([
  `${B}(apartment|apartments|appartment|flat|flats|condo|studio|penthouse|duplex|house|villa|cottage|townhouse|home to buy|property|real estate)`,
  'квартир', 'жиль', 'недвижим', `${B}дом(?![\\p{L}])`, `${B}дома${E}`, 'коттедж', 'студи', 'пентхаус', 'однушк', 'двушк', 'трешк', 'трёшк', 'комнатн',
  'ბინ', 'სახლ', 'უძრავ', 'აპარტამენტ', 'ოთახიან', 'სტუდიო', 'აგარაკ',
  `${B}(daire|konut|emlak|stüdyo|villa|müstakil|rezidans)`, `${B}ev${E}`,
  'شقة', 'شقق', 'منزل', 'بيت', 'فيلا', 'عقار', 'سكن',
  'דירה', 'דירות', 'נכס', 'נדל', 'וילה', 'פנטהאוז', 'סטודיו',
]);
const COMMERCIAL_ONLY = L(['офис', 'кабинет', 'магазин', 'склад', 'помещени', 'ოფის', 'კაბინეტ', 'მაღაზი', 'საწყობ', `${B}(office|shop|warehouse|retail|salon space|commercial)`, 'dükkan', 'ofis', 'depo', 'مكتب', 'محل', 'مستودع', 'משרד', 'חנות', 'מחסן']);
const HOUSE = L([`${B}(house|villa|cottage|townhouse)`, `${B}дом(?![\\p{L}])`, 'коттедж', 'вилл', 'სახლ', 'აგარაკ', `${B}(müstakil|villa)`, 'منزل', 'فيلا', 'וילה', `${B}בית${B}`]);
const LAND = L([`${B}(land|plot)`, 'участ', 'მიწ', `${B}arsa`, 'أرض', 'מגרש']);
/** "2 bedroom", "3-room", "1+1", "სამ ოთახიან", "трёхкомнатн". */
const ROOM_SPEC = L([
  '\\d\\s*\\+\\s*1', '\\d\\s*-?\\s*(room|rooms|bedroom|bedrooms|br)\\b', '\\d\\s*-?\\s*(комн|спальн|к\\.)', '\\d\\s*-?\\s*(ოთახ|საძინებ)',
  `${B}(one|two|three|four)[- ]?(room|bedroom)`, '(одно|двух|трех|трёх|четырех|четырёх)комнат', '(ერთ|ორ|სამ|ოთხ)\\s*ოთახ', '\\d\\s*(oda|yatak odası)', 'غرف', 'חדרים', 'חדר',
]);

const JOB = L([
  'работ', 'ваканси', 'подработк', 'резюме', 'трудоустро', 'ищу работу', 'няня', 'нянечк', 'нянь', 'сиделк', 'гувернант', 'домработниц',
  `${B}(job|jobs|vacancy|vacancies|hiring|resume|cv|employment|babysitter|nanny|caregiver|work permit)`,
  'სამუშაო', 'ვაკანსი', 'დასაქმ', 'ძიძ', 'მომვლელ', 'რეზიუმე',
  `${B}(iş arıyorum|iş ilanı|eleman|bakıcı|özgeçmiş)`, 'وظيفة', 'وظائف', 'توظيف', 'مربية', 'עבודה', 'משרה', 'מטפלת', 'בייביסיטר',
]);
const SERVICE = L([
  'ремонт', 'мебел', 'перевоз', 'грузчик', 'уборк', 'клининг', 'юрист', 'нотариус', 'дизайн интерьер', 'массаж', 'маникюр', 'ипотечн брокер',
  `${B}(renovation|repair|furniture|moving company|movers|cleaning service|lawyer|notary|interior design|massage|manicure|we offer|our services)`,
  'რემონტ', 'ავეჯ', 'გადაზიდ', 'დალაგებ', 'ადვოკატ', 'ნოტარ', 'დიზაინ', 'მასაჟ', 'მანიკიურ',
  `${B}(tadilat|mobilya|nakliyat|temizlik|avukat|noter)`, 'ترميم', 'أثاث', 'نقل عفش', 'تنظيف', 'محامي', 'שיפוץ', 'רהיטים', 'הובלות', 'ניקיון', 'עורך דין',
]);
const AGENT = L([
  `${B}(i am an? (agent|realtor|broker)|i'm an? (agent|realtor|broker)|real estate agent|our agency|for my client|my client|on behalf of (a|my) client)`,
  'риелтор', 'риэлтор', 'агентство недвижим', 'агент по недвижим', 'мой клиент', 'для клиента', 'моего клиента',
  'აგენტი ვარ', 'სააგენტო', 'მყავს კლიენტი', 'ჩემი კლიენტ', 'კლიენტისთვის',
  `${B}(emlakçı|emlak ofisi|müşterim için)`, 'وسيط عقاري', 'مكتب عقار', 'لعميلي', 'מתווך', 'משרד תיווך', 'ללקוח שלי',
]);

/** First-person seeking (never "for those looking for"). */
const SEEK = L([
  `${B}(i'?m looking|i am looking|we are looking|we're looking|looking for|looking to|searching for|in search of|i need|we need|need an?|needed|want to (buy|rent)|wanted|send me|please send|dm me with options|is looking for|are looking for)`,
  'ищу', 'ищем', 'нужн[аоы]', 'нужен', 'хочу (купить|снять)', 'куплю', 'сниму', 'присмотр', 'пришлите', 'предложите варианты',
  'ვეძებ', 'ვეძებთ', 'ეძებს', 'ищет', 'ищут', 'arıyor', 'يبحث', 'მჭირდება', 'გვჭირდება', 'მინდა', 'გამომიგზავნეთ', 'შემომთავაზეთ', 'ვიყიდი', 'შევიძენ', 'ვყიდულობ', 'ვიქირავებ', 'ვქირაობ',
  `${B}(arıyorum|arıyoruz|almak istiyorum|kiralamak istiyorum|lazım)`, 'أبحث', 'ابحث', 'نبحث', 'أريد', 'اريد', 'محتاج', 'مطلوب',
  'מחפש', 'מחפשת', 'מחפשים', 'רוצה לקנות', 'רוצה לשכור', 'צריך', 'צריכה',
]);
/** First-person purchase/rent phrases that outrank an adjective like "satılık daire". */
const STRONG_SEEK = L([
  `${B}(want to buy|looking to buy|we want to buy|i want to buy|looking to rent|want to rent)`, 'хочу купить', 'хотим купить', 'куплю', 'сниму', 'хочу снять',
  'ვიყიდი', 'შევიძენ', 'ვყიდულობ', 'ვიქირავებ', 'almak istiyorum', 'satın almak istiyorum', 'kiralamak istiyorum', 'أريد شراء', 'أريد استئجار', 'רוצה לקנות', 'רוצה לשכור',
]);
/** A stated budget is a seeker's word; a seller states a price. */
const BUDGET_WORD = L([`${B}budget`, 'бюджет', 'ბიუჯეტ', 'bütçe', 'ميزانية', 'תקציב']);
const THIRD_PERSON_SEEK = L([`for (those|anyone|people) (who are )?looking`, 'для тех, кто ищ', 'для тех кто ищ', 'ვისაც ეძებ', 'arayanlar için', 'لمن يبحث', 'למי שמחפש']);

const BUY = L([
  `${B}(buy|buying|purchase|purchasing|to own|invest in)`, 'куплю', 'купить', 'покупк', 'покупа', 'приобрест', 'приобрет',
  'ვიყიდი', 'ვიყიდო', 'ყიდვ', 'შევიძენ', 'შეძენ', 'შესაძენ', 'ვყიდულობ', 'საყიდ', 'გასაყიდად',
  `${B}(satın al|almak istiyorum|alıcı|alacağım)`, 'شراء', 'أشتري', 'اشتري', 'نشتري', 'للشراء', 'לקנות', 'קונה', 'קונים', 'קניית', 'לקנייה', 'רכישה', 'לרכישה',
  /* paying for it over time is a purchase, not a rent */
  'ипотек', 'рассрочк', 'იპოთეკ', 'განვადებ', 'ეტაპობრივი გადახდ', `${B}(mortgage|installments?)`, 'taksit', 'تقسيط', 'משכנתא',
]);
const RENT = L([
  `${B}(rent|renting|rental|to let|lease|per month|a month|/month|monthly|month contract|months? contract|\\d+\\s*months?|long[- ]term|short[- ]term)`,
  'сниму', 'снять', 'аренд', 'съём', 'съем', 'длит', 'долгосроч', 'посуточ', 'в месяц', '/мес', 'на месяц', 'месяц', 'проживани',
  'ქირ', 'ვიქირავებ', 'ვქირაობ', 'თვეში', 'თვით', 'წლით', 'დღიურად',
  `${B}(kira|kiralık|kiralamak|aylık)`, 'إيجار', 'ايجار', 'استئجار', 'شهري', 'לשכור', 'שכירות', 'לחודש', 'להשכרה',
]);
const SALE_OFFER = L([
  `${B}(for sale|on sale|selling|sale price|sold by owner|apartment for sale|house for sale)`,
  'прода[её]тся', 'продаю', 'продам', 'в продаже', 'на продажу',
  'იყიდება', 'ვყიდი', 'გაიყიდება', 'იყიდება ბინა',
  `${B}(satılık|satıyorum|satılıktır)`, 'للبيع', 'أبيع', 'ابيع', 'למכירה', 'מוכר', 'מוכרת',
]);
const RENT_OFFER = L([
  `${B}(for rent|to let|for lease|available for rent|renting out)`, 'сда[её]тся', 'сдаю', 'сдам', 'в аренду сда',
  'ქირავდება', 'ვაქირავებ', 'გაქირავდება', `${B}(kiralıktır|kiraya veriyorum)`, 'للإيجار', 'للايجار', 'أؤجر', 'להשכרה', 'משכיר', 'משכירה',
]);
/** Listing-like structure: price + a spec line, with contact or hashtag cues. */
const LISTING_CUES = L(['📍', '📐', '💰', '🛏', '#', 'price:', 'цена:', 'ფასი:', `${B}(size|floor|rooms|bedrooms)\\s*:`, 'этаж', 'სართულ', 'call me', 'for more details', 'details in dm', 'звоните', 'დარეკეთ', 'დამირეკეთ', 'whatsapp', 'viber', 'вотсап', 'ватсап']);
const FLEX_LOCATION = L(['район не имеет значения', 'любой район', 'any (area|district|location)', 'location (is )?flexible', 'district doesn\'t matter', 'ნებისმიერ (ადგილ|უბან)', 'უბანს არ აქვს მნიშვნელობა', 'herhangi bir (semt|bölge)', 'أي منطقة', 'כל אזור']);
const DOWN_PAYMENT = L(['первоначальн', 'взнос', 'პირველადი შენატან', 'წინასწარ შენატან', `${B}(down payment|deposit|first payment)`, 'peşinat', 'دفعة أولى', 'מקדמה', 'הון עצמי']);

/* ── money ─────────────────────────────────────────────────────────────── */

const CUR_USD = '(?:\\$|usd|долл\\S*|дол\\.|დოლარ\\S*|dolar|دولار|דולר)';
const CUR_GEL = '(?:₾|gel|лари|лар\\.|ლარ\\S*|ლ(?![\\p{L}])|lari)';
const CUR_EUR = '(?:€|eur|евро|ევრო|euro|يورو|יורו)';
const NUM = '(\\d{1,3}(?:[ \\u00a0,.]\\d{3})+|\\d+(?:[.,]\\d+)?)[ \\u00a0]*(k(?![\\p{L}])|к(?![\\p{L}])|ათას|тыс\\.?|bin(?![\\p{L}])|ألف|אלף)?';

function toNumber(raw: string, mult?: string): number | null {
  let s = raw.replace(/[  ]/g, '');
  if (/^\d{1,3}([,.]\d{3})+$/.test(s)) s = s.replace(/[,.]/g, '');
  else s = s.replace(',', '.');
  let n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (mult) n *= 1000;
  return n;
}

interface MoneyHit extends Money { index: number; end: number; text: string }

/** Money amounts written next to a currency (never across a line break). */
export function moneyMentions(text: string): MoneyHit[] {
  const hits: MoneyHit[] = [];
  const cur: Array<[Money['currency'], string]> = [['USD', CUR_USD], ['GEL', CUR_GEL], ['EUR', CUR_EUR]];
  const SP = '[ \\t\\u00a0]*';
  const ok = (n: number | null): n is number => n != null && n >= 50 && n < 50_000_000;
  for (const [currency, c] of cur) {
    /* "50 000-70 000$" → both numbers carry the currency written after the second. */
    const range = new RegExp(`${NUM}${SP}(?:-|–|—|до|to)${SP}${NUM}${SP}${c}`, 'giu');
    for (const m of text.matchAll(range)) {
      const at = m.index ?? 0; const end = at + m[0].length;
      const a = toNumber(m[1], m[2]); const b = toNumber(m[3], m[4]);
      if (ok(a)) hits.push({ amount: a, currency, index: at, end, text: m[0] });
      if (ok(b)) hits.push({ amount: b, currency, index: at + 1, end, text: m[0] });
    }
    for (const re of [new RegExp(`${c}${SP}${NUM}`, 'giu'), new RegExp(`${NUM}${SP}${c}`, 'giu')]) {
      for (const m of text.matchAll(re)) {
        const at = m.index ?? 0; const end = at + m[0].length;
        const a = toNumber(m[1], m[2]);
        if (!ok(a)) continue;
        if (hits.some((h) => at < h.end && end > h.index)) continue;
        hits.push({ amount: a, currency, index: at, end, text: m[0] });
      }
    }
  }
  return hits.sort((x, y) => x.index - y.index);
}

const FX_TO_USD: Record<Money['currency'], number> = { USD: 1, GEL: 0.37, EUR: 1.08 };
export const toUsd = (m: Money, fx?: Partial<Record<string, number>>) => m.amount * (fx?.[m.currency] ?? FX_TO_USD[m.currency]);

/** Monthly-rent scale vs purchase scale, in USD. Between them: undecided. */
const RENT_SCALE_MAX_USD = 6000;
const BUY_SCALE_MIN_USD = 15000;

/* ── reading ───────────────────────────────────────────────────────────── */

const firstIndex = (re: RegExp, s: string) => { const m = s.match(re); return m && m.index != null ? m.index : -1; };

function numberNear(re: RegExp, s: string): number | null {
  const m = s.match(re);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 20 ? n : null;
}
const WORD_ROOMS: Array<[RegExp, number]> = [
  [/(one|single)[- ]?(room|bedroom)|одно(комнат)|однушк|ერთ\s*ოთახ/iu, 1],
  [/two[- ]?(room|bedroom)|двух(комнат)|двушк|ორ\s*ოთახ/iu, 2],
  [/three[- ]?(room|bedroom)|тр[её]х(комнат)|тр[её]шк|სამ\s*ოთახ/iu, 3],
  [/four[- ]?(room|bedroom)|четыр[её]х(комнат)|ოთხ\s*ოთახ/iu, 4],
];

export interface ClassifyOptions {
  kind?: 'POST' | 'COMMENT' | 'MESSAGE';
}

export function classifyDemand(text: string | null | undefined, opts: ClassifyOptions = {}): DemandReading {
  const raw = String(text ?? '').replace(/ /g, ' ');
  const s = raw.normalize('NFKC');
  const evidence: string[] = [];
  const empty = (role: DemandRole, why: string, confidence = 0.9): DemandReading => ({
    role, transaction: null, realEstate: false, residential: false, propertyType: null, intermediary: false,
    budget: null, downPayment: null, cities: [], districts: [], locationFlexible: false, rooms: null, bedrooms: null, areaSqm: null,
    evidence: [...evidence, why], confidence, needsModel: false,
  });
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  if (!s.trim() || letters < 3) return empty('IRRELEVANT', 'empty_or_emoji');

  const residentialNoun = RESIDENTIAL.test(s);
  const roomSpec = ROOM_SPEC.test(s);
  const commercialOnly = COMMERCIAL_ONLY.test(s) && !residentialNoun;
  const realEstate = residentialNoun || roomSpec || commercialOnly || LAND.test(s);

  /* Job seeking / hiring — the "ищу работу", "ищу нянечку" failure. */
  if (JOB.test(s) && !(residentialNoun && (SALE_OFFER.test(s) || RENT_OFFER.test(s) || BUY.test(s)))) {
    return empty('JOB', 'job_or_hiring');
  }
  const seekIdx = THIRD_PERSON_SEEK.test(s) ? -1 : firstIndex(SEEK, s);
  /* A listing that mentions its renovation is a listing, not a service ad. */
  const offerMarker = SALE_OFFER.test(s) || RENT_OFFER.test(s);
  if (SERVICE.test(s) && seekIdx < 0 && !offerMarker && !(residentialNoun && moneyMentions(s).length)) return empty('SERVICE', 'service_offer');
  if (!realEstate) return empty('IRRELEVANT', seekIdx >= 0 ? 'seeking_but_not_real_estate' : 'not_real_estate');

  const propertyType: DemandReading['propertyType'] = LAND.test(s) && !residentialNoun ? 'LAND'
    : commercialOnly ? 'COMMERCIAL' : HOUSE.test(s) && !/квартир|ბინ|apartment|flat|daire|شقة|דירה/iu.test(s) ? 'HOUSE' : 'APARTMENT';

  /* Constraints, from the text only. */
  const money = moneyMentions(s);
  const dpIdx = firstIndex(DOWN_PAYMENT, s);
  const downHit = dpIdx >= 0 ? money.find((m) => m.index >= dpIdx && m.index - dpIdx < 60) ?? null : null;
  const budgetHits = money.filter((m) => m !== downHit);
  let budget: Budget | null = null;
  if (budgetHits.length) {
    const cur = budgetHits[0].currency;
    const same = budgetHits.filter((m) => m.currency === cur).map((m) => m.amount);
    const min = same.length > 1 ? Math.min(...same) : null;
    const max = Math.max(...same);
    budget = { min, max, currency: cur, period: null, evidence: budgetHits.filter((m) => m.currency === cur).map((m) => m.text.trim()).join(' · ') };
  }
  const rentWords = RENT.test(s);
  const buyWords = BUY.test(s);
  const maxUsd = budget ? toUsd({ amount: budget.max ?? 0, currency: budget.currency }) : null;
  const scale: 'RENT' | 'BUY' | null = maxUsd == null ? null : maxUsd <= RENT_SCALE_MAX_USD ? 'RENT' : maxUsd >= BUY_SCALE_MIN_USD ? 'BUY' : null;
  if (budget) budget.period = scale === 'RENT' || (rentWords && !buyWords) ? 'MONTHLY' : scale === 'BUY' || buyWords ? 'TOTAL' : null;

  const cityKey = cityMentioned(s);
  const cities = cityKey ? [cityKey] : [];
  const districts = districtsMentioned(s);
  const locationFlexible = FLEX_LOCATION.test(s);
  const bedrooms = numberNear(/(\d{1,2})\s*-?\s*(?:bed(?:room)?s?\b|br\b|спальн|საძინებ|yatak odası|غرف? نوم|חדרי שינה)/iu, s);
  const rooms = numberNear(/(\d{1,2})\s*-?\s*(?:rooms?\b|комн|к\.|ოთახ|oda\b|غرف|חדרים|חד')/iu, s)
    ?? numberNear(/(\d)\s*\+\s*1\b/u, s) ?? (WORD_ROOMS.find(([re]) => re.test(s))?.[1] ?? null);
  const area = s.match(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sq\.?\s?m|sqm|кв\.?\s?м|м2|м²|კვ\.?\s?მ|კვმ|metrekare|متر مربع|م2|מ"ר|מטר|metr)/iu);
  const areaSqm = area ? Number(area[1].replace(',', '.')) : null;

  const base = {
    realEstate: true, residential: propertyType === 'APARTMENT' || propertyType === 'HOUSE', propertyType,
    intermediary: AGENT.test(s), budget, downPayment: downHit ? { amount: downHit.amount, currency: downHit.currency } : null,
    cities, districts, locationFlexible, rooms, bedrooms, areaSqm,
  };

  /* Direction: who is speaking — someone seeking, or someone offering. */
  const saleIdx = firstIndex(SALE_OFFER, s);
  const rentOfferIdx = firstIndex(RENT_OFFER, s);
  const offerIdx = [saleIdx, rentOfferIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  let direction: 'SEEK' | 'OFFER' | null = null;
  if (seekIdx >= 0 && (offerIdx < 0 || seekIdx < offerIdx)) { direction = 'SEEK'; evidence.push('first_person_seeking'); }
  else if (offerIdx >= 0) { direction = 'OFFER'; evidence.push(saleIdx === offerIdx ? 'sale_offer_marker' : 'rent_offer_marker'); }
  if (direction === 'OFFER' && STRONG_SEEK.test(s) && !LISTING_CUES.test(s)) { direction = 'SEEK'; evidence.push('first_person_purchase_phrase'); }
  /* "if you have one for sale, message me" is a seeker asking sellers. */
  if (direction === 'OFFER' && /(თუ გაქვთ|если у вас есть|if you have|eğer varsa|إذا كان لديك|אם יש לכם)/iu.test(s)) { direction = 'SEEK'; evidence.push('asks_sellers'); }
  if (!direction && (BUY.test(s) || /(снять|to rent|kiralamak|استئجار|לשכור)/iu.test(s) || BUDGET_WORD.test(s)) && !LISTING_CUES.test(s)) {
    /* "купить квартиру …", "buy apartment …", "שراء شقة": an explicit purchase/rent
       verb or a stated budget, with no listing cues, is someone who wants one. */
    direction = 'SEEK'; evidence.push('intent_verb_or_budget');
  }
  if (!direction) {
    /* No verb either way: a price + spec line + contact/hashtags is a listing. */
    const listing = (budget != null && (rooms != null || bedrooms != null || areaSqm != null || districts.length > 0)) && (LISTING_CUES.test(s) || /\+?\d[\d\s-]{7,}\d/.test(s) || s.length < 160);
    if (listing) { direction = 'OFFER'; evidence.push('listing_structure'); }
  }
  if (!direction) {
    return { ...base, role: 'UNCLEAR', transaction: scale, evidence: [...evidence, 'no_direction'], confidence: 0.3, needsModel: true };
  }

  /* Transaction: explicit words first; a contradiction is settled by the money scale. */
  let transaction: 'BUY' | 'RENT' | null = null;
  if (direction === 'OFFER') {
    transaction = rentOfferIdx >= 0 && (saleIdx < 0 || rentOfferIdx <= saleIdx) ? 'RENT' : saleIdx >= 0 ? 'BUY' : scale ?? (rentWords && !buyWords ? 'RENT' : buyWords && !rentWords ? 'BUY' : null);
    if (saleIdx >= 0 && scale === 'RENT' && rentOfferIdx < 0) transaction = 'BUY';
  } else {
    if (buyWords && !rentWords) transaction = 'BUY';
    else if (rentWords && !buyWords) transaction = 'RENT';
    else if (buyWords && rentWords) transaction = scale ?? (firstIndex(BUY, s) < firstIndex(RENT, s) ? 'BUY' : 'RENT');
    else transaction = scale;
    if (scale && transaction && scale !== transaction && !(buyWords && !rentWords)) transaction = scale;
    if (transaction) evidence.push(buyWords || rentWords ? 'transaction_words' : 'transaction_money_scale');
  }

  if (direction === 'OFFER') {
    if (base.intermediary) evidence.push('agent_listing');
    return { ...base, role: transaction === 'RENT' ? 'RENT_OFFER' : transaction === 'BUY' ? 'SALE_OFFER' : 'SALE_OFFER',
      transaction, evidence, confidence: transaction ? 0.85 : 0.55, needsModel: transaction == null };
  }
  if (base.intermediary) {
    return { ...base, role: 'AGENT', transaction, evidence: [...evidence, 'seeking_for_client'], confidence: 0.8, needsModel: false };
  }
  if (!transaction) {
    return { ...base, role: 'UNCLEAR', transaction: null, evidence: [...evidence, 'transaction_unknown'], confidence: 0.4, needsModel: true };
  }
  return { ...base, role: transaction === 'BUY' ? 'BUY_SEEKER' : 'RENT_SEEKER', transaction, evidence,
    confidence: buyWords || rentWords ? 0.9 : 0.7, needsModel: false };
}

/* ── comments in context ───────────────────────────────────────────────── */

const INTEREST = L([
  `${B}(interested|still available|is it available|available\\?|how much|price\\?|what is the price|can i (see|view)|viewing|send (me )?(the )?(price|details|location))`,
  'интересует', 'актуально', 'сколько стоит', 'какая цена', 'цена\\?', 'можно посмотреть', 'просмотр', 'в лс', 'в личку',
  'დაინტერესებ', 'აქტუალურია', 'რა ღირს', 'ფასი\\?', 'რა ფასი', 'ნახვა', 'შეიძლება ნახვა', 'მომწერეთ ფასი',
  'ilgileniyorum', 'fiyat', 'ne kadar', 'hala satılık', 'görebilir miyim', 'مهتم', 'كم السعر', 'السعر', 'متاحة', 'معاينة',
  'מעוניין', 'מעוניינת', 'כמה עולה', 'מחיר', 'עדיין זמין', 'לראות',
]);
const HAVE_ONE = L([`${B}(i have|we have|i've got)`, 'у меня есть', 'есть вариант', 'მაქვს', 'გვაქვს', `${B}(bende var|elimde var)`, 'لدي', 'יש לי']);
const BARE_CONTACT = /^(?:\s|[.!?+👍🙏🔥❤️])*(pm|dm|pm me|dm me|call me|call|interested|\+|ლს|в лс|в личку|пм|მომწერეთ|დამირეკეთ|интересует|actual\??|актуально\??)(?:\s|[.!?+👍🙏🔥❤️])*$/iu;

/**
 * A comment under a post. Interest under a comparable SALE listing can be a
 * buyer; under a RENT listing a tenant; under someone's request it is a
 * seller/agent replying. A bare "PM me"/"+"/"interested" is never enough on
 * its own (UNCLEAR, not demand) — the comment must carry its own content.
 */
export function classifyComment(text: string | null | undefined, parent: { role: DemandRole | null; similarity: number } | null): DemandReading {
  const own = classifyDemand(text, { kind: 'COMMENT' });
  if (['JOB', 'SERVICE', 'AGENT', 'SALE_OFFER', 'RENT_OFFER'].includes(own.role)) return own;
  if (own.role === 'BUY_SEEKER' || own.role === 'RENT_SEEKER') return own;
  const s = String(text ?? '');
  if (!parent?.role) return { ...own, role: 'UNCLEAR', evidence: [...own.evidence, 'comment_without_parent'], needsModel: INTEREST.test(s) };
  if (parent.role === 'BUY_SEEKER' || parent.role === 'RENT_SEEKER') {
    /* Replies under a request are offers ("I have one, call me"). */
    const offering = INTEREST.test(s) || BARE_CONTACT.test(s) || HAVE_ONE.test(s) || /(call me|dm me|pm me|позвоните|напишите|დამირეკეთ|მომწერეთ|beni ara|اتصل بي|תתקשר)/iu.test(s);
    return { ...own, role: offering ? (parent.role === 'RENT_SEEKER' ? 'RENT_OFFER' : 'SALE_OFFER') : 'UNCLEAR', transaction: parent.role === 'RENT_SEEKER' ? 'RENT' : 'BUY',
      evidence: [...own.evidence, 'reply_under_request'], confidence: 0.6, needsModel: false };
  }
  if ((parent.role === 'SALE_OFFER' || parent.role === 'RENT_OFFER') && INTEREST.test(s)) {
    if (BARE_CONTACT.test(s)) {
      return { ...own, role: 'UNCLEAR', transaction: parent.role === 'RENT_OFFER' ? 'RENT' : 'BUY', evidence: [...own.evidence, 'bare_interest_no_context'], confidence: 0.35, needsModel: false };
    }
    return { ...own, role: parent.role === 'RENT_OFFER' ? 'RENT_SEEKER' : 'BUY_SEEKER', transaction: parent.role === 'RENT_OFFER' ? 'RENT' : 'BUY',
      realEstate: true, residential: true, evidence: [...own.evidence, 'interest_under_listing'], confidence: parent.similarity >= 70 ? 0.75 : 0.55, needsModel: false };
  }
  return { ...own, role: own.role === 'IRRELEVANT' ? 'IRRELEVANT' : 'UNCLEAR', evidence: [...own.evidence, 'comment_no_intent'], needsModel: false };
}

/* ── model, bounded ────────────────────────────────────────────────────── */

/** Roles a model verdict may NOT overturn: the rules saw positive evidence. */
const RULE_FINAL = new Set<DemandRole>(['JOB', 'SERVICE', 'SALE_OFFER', 'RENT_OFFER', 'AGENT', 'IRRELEVANT', 'BUY_SEEKER', 'RENT_SEEKER']);

/**
 * Apply a model's reading to an UNCLEAR rule reading. The model chooses a
 * role/transaction only; budgets, places and rooms always come from the text
 * (never from the model), so nothing is invented.
 */
export function boundModelReading(rule: DemandReading, model: { role?: unknown; transaction?: unknown } | null): DemandReading {
  if (!model || RULE_FINAL.has(rule.role) && !rule.needsModel) return { ...rule, needsModel: false };
  const role = String(model.role ?? '').toUpperCase() as DemandRole;
  if (!DEMAND_ROLES.includes(role)) return { ...rule, needsModel: false, evidence: [...rule.evidence, 'model_invalid'] };
  const tx = String(model.transaction ?? '').toUpperCase();
  let transaction: 'BUY' | 'RENT' | null = tx === 'BUY' ? 'BUY' : tx === 'RENT' ? 'RENT' : null;
  /* The money scale outranks the model on the transaction. */
  const maxUsd = rule.budget?.max != null ? toUsd({ amount: rule.budget.max, currency: rule.budget.currency }) : null;
  if (maxUsd != null && maxUsd <= RENT_SCALE_MAX_USD) transaction = 'RENT';
  if (maxUsd != null && maxUsd >= BUY_SCALE_MIN_USD) transaction = 'BUY';
  let finalRole = role;
  if ((role === 'BUY_SEEKER' || role === 'RENT_SEEKER') && !rule.realEstate) finalRole = 'IRRELEVANT';
  if (role === 'BUY_SEEKER' && transaction === 'RENT') finalRole = 'RENT_SEEKER';
  if (role === 'RENT_SEEKER' && transaction === 'BUY') finalRole = 'BUY_SEEKER';
  if ((finalRole === 'BUY_SEEKER' || finalRole === 'RENT_SEEKER') && !transaction) transaction = finalRole === 'BUY_SEEKER' ? 'BUY' : 'RENT';
  return { ...rule, role: finalRole, transaction, needsModel: false, confidence: Math.min(0.75, rule.confidence + 0.3), evidence: [...rule.evidence, 'model_resolved'] };
}

export const DEMAND_MODEL_SCHEMA = {
  name: 'find_buyers_demand',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'role', 'transaction', 'reason'],
          properties: {
            id: { type: 'string' },
            role: { type: 'string', enum: [...DEMAND_ROLES] },
            transaction: { type: 'string', enum: ['BUY', 'RENT', 'UNKNOWN'] },
            reason: { type: 'string', maxLength: 160 },
          },
        },
      },
    },
  },
} as const;

export const DEMAND_SYSTEM_PROMPT = [
  'You read short public social-media posts/comments about real estate in Georgia (languages: Georgian, Russian, English, Arabic, Hebrew, Turkish).',
  'For each item decide who is speaking and what they want. Roles: BUY_SEEKER (the author personally wants to buy a home), RENT_SEEKER (wants to rent one),',
  'SALE_OFFER (offers a property for sale), RENT_OFFER (offers one for rent), AGENT (an intermediary acting for clients), SERVICE (offers a service),',
  'JOB (job seeking or hiring), IRRELEVANT (not about residential real estate), UNCLEAR (cannot tell).',
  'Seeking words alone ("looking for", "ищу", "ვეძებ") do not mean real estate. A monthly price, a lease term or a contract length means RENT.',
  'Choose BUY only when the text indicates purchasing. Never infer budgets, places or personal traits. Reason: max 20 words, factual.',
].join(' ');

/** For tests/diagnostics: the city keys we can recognise. */
export const KNOWN_CITIES = Object.keys(CITY_NAMES);
