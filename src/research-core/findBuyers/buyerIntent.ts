// FIND BUYERS — buyer intent gate and comment signals (Find Buyers 3.0, 2026-10-15).
//
// Runs on top of the demand classifier (who is speaking, which market) and decides
// what a piece of text IS for the owner, before any relevance score:
//
//   DIRECT    someone who states their own purchase / rental intent;
//   INTEREST  a meaningful question about a comparable listing (price, viewing,
//             availability, financing …) — potential interest, never a confirmed buyer;
//   EXCLUDED  everything else: sellers, agents, service and renovation requests,
//             people who already bought or are not looking, general praise, spam.
//
// One comment can carry several signals ("How much, and can I visit tomorrow?" is ONE
// comment with PRICE + VIEWING), so signals are a set and are never counted as people.
// Pure and deterministic: the edge pipeline stores the result, and the owner's page
// recomputes it on read for leads stored before this gate existed.

import { buyerViaBroker, classifyComment, classifyDemand, transactionUnconfirmed, type DemandReading, type DemandRole } from './demandClassifier.ts';

export type BuyerIntent =
  | 'ACTIVE_BUYER' | 'ACTIVE_TENANT' | 'PRICE_INQUIRY' | 'VIEWING_INQUIRY' | 'PROPERTY_INTEREST'
  | 'GENERAL_ENGAGEMENT' | 'SELLER' | 'REAL_ESTATE_AGENT' | 'SERVICE_REQUEST' | 'RENOVATION_REQUEST'
  | 'ALREADY_PURCHASED' | 'NOT_LOOKING' | 'SPAM' | 'UNKNOWN';

export type CommentSignal =
  | 'PRICE' | 'VIEWING' | 'AVAILABILITY' | 'LOCATION' | 'PARKING_AMENITIES' | 'NEGOTIATION'
  | 'FINANCING' | 'EXPLICIT_BUY' | 'EXPLICIT_RENT' | 'POSITIVE' | 'IRRELEVANT';

export type ResultType = 'DIRECT' | 'INTEREST' | 'EXCLUDED';

export const INTEREST_SIGNALS: readonly CommentSignal[] = ['PRICE', 'VIEWING', 'AVAILABILITY', 'LOCATION', 'PARKING_AMENITIES', 'NEGOTIATION', 'FINANCING'];

export interface IntentReading {
  intent: BuyerIntent;
  resultType: ResultType;
  signals: CommentSignal[];
  /** Rule ids that decided it (explainable; shown to Admin, never invented). */
  reasons: string[];
  role: DemandRole;
}

const L = (parts: string[]) => new RegExp(parts.join('|'), 'iu');
const B = '(?<![\\p{L}\\p{N}])';

const SIGNAL_RULES: Array<[CommentSignal, RegExp]> = [
  ['PRICE', L([`${B}(how much|price|cost|what'?s the price|pm price|asking)`, 'сколько стоит', 'цена', 'какая цена', 'почём', 'почем', 'რა ღირს', 'ფასი', 'რა ფასი', 'რამდენი ღირს', 'fiyat', 'ne kadar', 'kaç para', 'كم السعر', 'السعر', 'بكم', 'כמה עולה', 'מחיר', 'כמה זה'])],
  ['VIEWING', L([`${B}(can i (see|view|visit)|viewing|visit|come (and )?see|show me|tour)`, 'посмотреть', 'просмотр', 'можно приехать', 'показать', 'ნახვა', 'ვნახო', 'ნახვის', 'დათვალიერ', 'მოვიდე', 'görebilir miyim', 'gezmek', 'görmek', 'معاينة', 'أشوف', 'زيارة', 'לראות', 'לבקר', 'סיור'])],
  ['AVAILABILITY', L([`${B}(still available|is it available|available\\?|sold\\?|is it sold|still for sale)`, 'актуально', 'ещё продаётся', 'еще продается', 'продано', 'აქტუალურია', 'ისევ იყიდება', 'გაიყიდა', 'hala satılık', 'satıldı mı', 'müsait mi', 'متاحة', 'متاح', 'لسا موجود', 'עדיין זמין', 'עדיין למכירה', 'נמכר'])],
  ['LOCATION', L([`${B}(where is it|which street|exact location|address|location\\?|what area|which floor)`, 'где находится', 'какая улица', 'адрес', 'какой этаж', 'სად არის', 'რომელი ქუჩა', 'მისამართ', 'რომელ სართულ', 'nerede', 'hangi sokak', 'adres', 'kaçıncı kat', 'أين', 'العنوان', 'أي طابق', 'איפה', 'כתובת', 'איזו קומה'])],
  ['PARKING_AMENITIES', L([`${B}(parking|garage|elevator|lift|balcony|furnished|heating|gas|storage)`, 'парковк', 'гараж', 'лифт', 'балкон', 'мебел', 'отоплени', 'პარკინგ', 'ავტოსადგომ', 'ლიფტ', 'აივან', 'ავეჯ', 'გათბობ', 'otopark', 'asansör', 'balkon', 'eşyalı', 'موقف', 'مصعد', 'شرفة', 'مفروشة', 'חניה', 'מעלית', 'מרפסת', 'מרוהטת'])],
  ['NEGOTIATION', L([`${B}(negotiable|last price|final price|discount|lower the price|any flexibility|best price)`, 'торг', 'скидк', 'последняя цена', 'ფასი იკლებს', 'იკლებს', 'ფასდაკლ', 'ბოლო ფასი', 'pazarlık', 'indirim', 'son fiyat', 'قابل للتفاوض', 'آخر سعر', 'خصم', 'גמיש', 'מחיר סופי', 'הנחה'])],
  ['FINANCING', L([`${B}(mortgage|installments?|payment plan|bank loan|financing|down payment)`, 'ипотек', 'рассрочк', 'кредит', 'первоначальн', 'იპოთეკ', 'განვადებ', 'სესხ', 'შენატან', 'kredi', 'taksit', 'peşinat', 'تقسيط', 'رهن', 'قرض', 'משכנתא', 'תשלומים', 'הון עצמי'])],
  ['EXPLICIT_BUY', L([`${B}(i want to buy|i'?ll buy|we want to buy|looking to buy|i'?m buying)`, 'хочу купить', 'куплю', 'хотим купить', 'ვიყიდი', 'ვყიდულობ', 'მინდა ვიყიდო', 'შევიძენ', 'almak istiyorum', 'satın alacağım', 'أريد شراء', 'سأشتري', 'רוצה לקנות', 'אקנה'])],
  ['EXPLICIT_RENT', L([`${B}(i want to rent|i'?ll rent|looking to rent|we want to rent)`, 'хочу снять', 'сниму', 'ვიქირავებ', 'მინდა ვიქირავო', 'kiralamak istiyorum', 'أريد استئجار', 'רוצה לשכור', 'אשכור'])],
  ['POSITIVE', L([`${B}(beautiful|nice|great|amazing|wow|love it|gorgeous|congrats|congratulations)`, 'красив', 'отличн', 'супер', 'класс', 'шикарн', 'ლამაზ', 'მაგარი', 'სუპერ', 'მშვენიერ', 'güzel', 'harika', 'süper', 'جميل', 'رائع', 'ممتاز', 'יפה', 'מהמם', 'מדהים', '😍', '🔥', '👍', '❤'])],
];

const SPAM = L([`${B}(earn money|work from home|crypto|bitcoin|forex|casino|bet|click (the )?link|follow me|subscribe)`, 'заработок в интернете', 'крипт', 'казино', 'букмекер', 'подписывайтесь', 'შემოსავალ', 'კრიპტ', 'კაზინო', 'kazan', 'kripto', 'bahis', 'ربح', 'كازينو', 'עבודה מהבית', 'קזינו']);
const LINK_ONLY = /^\s*(https?:\/\/\S+\s*)+$/iu;

/** Every signal in the text (a set): several per comment is normal. */
export function detectSignals(text: string | null | undefined): CommentSignal[] {
  const s = String(text ?? '').normalize('NFKC');
  if (!s.trim()) return [];
  const found = SIGNAL_RULES.filter(([, re]) => re.test(s)).map(([k]) => k);
  return found.length ? found : ['IRRELEVANT'];
}

const has = (r: DemandReading, id: string) => r.evidence.includes(id);

export interface IntentInput {
  text: string | null | undefined;
  kind: 'POST' | 'COMMENT' | 'MESSAGE';
  /** For a comment: the post it was written under (role from the classifier, similarity 0–100). */
  parent?: { role: DemandRole | null; similarity: number } | null;
  /** A reading already computed by the pipeline (avoids classifying twice). */
  reading?: DemandReading;
}

export function classifyBuyerIntent(input: IntentInput): IntentReading {
  const text = String(input.text ?? '');
  const reading = input.reading ?? (input.kind === 'COMMENT' ? classifyComment(text, input.parent ?? null) : classifyDemand(text, { kind: input.kind }));
  const signals = detectSignals(text);
  const out = (intent: BuyerIntent, resultType: ResultType, reason: string): IntentReading =>
    ({ intent, resultType, signals, reasons: [...reading.evidence, reason], role: reading.role });

  /* Exclusions first: these never become a lead, whatever words they contain. */
  if (SPAM.test(text) || LINK_ONLY.test(text)) return out('SPAM', 'EXCLUDED', 'spam');
  if (has(reading, 'renovation_request')) return out('RENOVATION_REQUEST', 'EXCLUDED', 'renovation_request');
  if (has(reading, 'already_purchased')) return out('ALREADY_PURCHASED', 'EXCLUDED', 'already_purchased');
  if (has(reading, 'not_looking')) return out('NOT_LOOKING', 'EXCLUDED', 'not_looking');
  if (reading.role === 'SERVICE' || reading.role === 'JOB') return out('SERVICE_REQUEST', 'EXCLUDED', 'service');
  /* v11: the AI could not decide (or did not answer): unverified, never a lead. */
  if (has(reading, 'ai_unverified') || has(reading, 'ai_uncertain')) return out('UNKNOWN', 'EXCLUDED', has(reading, 'ai_unverified') ? 'ai_unverified' : 'ai_uncertain');
  /* A broker searching for a named client: demand to verify, never a qualified buyer. */
  if (buyerViaBroker(reading)) return out(reading.transaction === 'RENT' ? 'ACTIVE_TENANT' : 'ACTIVE_BUYER', 'INTEREST', 'buyer_via_broker');
  if (reading.role === 'AGENT') return out('REAL_ESTATE_AGENT', 'EXCLUDED', 'agent');
  if (reading.role === 'SALE_OFFER' || reading.role === 'RENT_OFFER') return out('SELLER', 'EXCLUDED', 'seller');

  /* A home seeker who never said buy or rent: an interested person to verify, not a buyer. */
  if (transactionUnconfirmed(reading)) return out(reading.role === 'RENT_SEEKER' ? 'ACTIVE_TENANT' : 'ACTIVE_BUYER', 'INTEREST', 'seeker_transaction_unconfirmed');

  /* Someone stating their own purchase / rental intent. */
  const ownIntent = (reading.role === 'BUY_SEEKER' || reading.role === 'RENT_SEEKER') && !has(reading, 'interest_under_listing');
  if (ownIntent) return out(reading.role === 'RENT_SEEKER' ? 'ACTIVE_TENANT' : 'ACTIVE_BUYER', 'DIRECT', 'own_intent');

  /* A question under a comparable listing: interest, never a confirmed buyer. */
  const underListing = input.kind === 'COMMENT' && (input.parent?.role === 'SALE_OFFER' || input.parent?.role === 'RENT_OFFER');
  const interest = signals.filter((sg) => INTEREST_SIGNALS.includes(sg));
  if (underListing && interest.length) {
    const intent: BuyerIntent = signals.includes('VIEWING') ? 'VIEWING_INQUIRY' : signals.includes('PRICE') ? 'PRICE_INQUIRY' : 'PROPERTY_INTEREST';
    return out(intent, 'INTEREST', 'question_under_comparable_listing');
  }
  if (underListing && has(reading, 'interest_under_listing')) return out('PROPERTY_INTEREST', 'INTEREST', 'interest_under_listing');

  if (signals.includes('POSITIVE') && !interest.length) return out('GENERAL_ENGAGEMENT', 'EXCLUDED', 'general_engagement');
  return out('UNKNOWN', 'EXCLUDED', 'no_evidence_of_intent');
}
