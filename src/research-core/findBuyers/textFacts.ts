// Deterministic facts read from a public post, in the six languages. Only
// what the text states; anything unstated stays null. Used by the similarity
// gate before any paid comment extraction.

import { cityMentioned, districtMentioned } from './places.ts';

export interface TextFacts {
  transaction: 'SALE' | 'RENT' | null;
  /** The author offers a property (listing) vs asks for one (request). */
  stance: 'OFFER' | 'REQUEST' | null;
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | null;
  bedrooms: number | null;
  rooms: number | null;
  areaSqm: number | null;
  price: number | null;
  currency: 'USD' | 'GEL' | 'EUR' | null;
  city: string | null;
  district: string | null;
  newBuild: boolean | null;
}

const RENT = /(?<!\p{L})(rent|rental|lease|for rent|per month|monthly|аренд|сда[её]тся|сдам|сдаю|сниму|снять|посуточно|в месяц|ქირ|თვეში|kiral|aylık|إيجار|ايجار|للإيجار|استئجار|شهري|להשכרה|לשכור|שכירות|לחודש)/iu;
const SALE = /(for sale|\bsale\b|\bsell|\bbuy|продаж|прода[её]тся|продам|куплю|купить|იყიდება|ვყიდი|ვყიდულობ|ყიდვ|satılık|satilik|almak|للبيع|شراء|للشراء|למכירה|לקנות|לקנייה|קונה)/i;
const OFFER = /(for sale|for rent|сда[её]тся|прода[её]тся|продам|сдам|იყიდება|ქირავდება|satılık|kiralık|للبيع|للإيجار|למכירה|להשכרה|new listing|listing|📍)/i;
const REQUEST = /(looking for|looking to|i need|need an?|want to (buy|rent)|searching|ищу|куплю|сниму|нужн|хочу|ვეძებ|მჭირდება|ვყიდულობ|ვქირაობ|მსურს|arıyorum|ariyorum|istiyorum|أبحث|ابحث|أريد|اريد|محتاج|מחפש|מחפשת|רוצה|צריך)/i;
const HOUSE = /(house|villa|cottage|дом|коттедж|вилла|სახლ|აგარაკ|\bev\b|villa|منزل|فيلا|بيت|בית|וילה)/i;
const LAND = /(\bland\b|plot|участ|მიწ|arsa|أرض|מגרש)/i;
const COMMERCIAL = /(commercial|office|shop|офис|коммерч|ოფის|კომერც|ofis|dükkan|مكتب|محل|משרד)/i;
const APARTMENT = /(apartment|\bflat\b|condo|квартир|ბინ|daire|شقة|شقق|דירה|דירות|studio|студи)/i;
const NEW_BUILD = /(new build|newly built|novostroy|новостро|ახალ(ი)? აშენებ|ახალაშენ|yeni bina|sıfır|جديد البناء|בנייה חדשה)/i;

function firstNumber(re: RegExp, s: string): number | null {
  const m = s.match(re);
  if (!m) return null;
  const n = Number(String(m[1]).replace(/[\s,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function extractTextFacts(text: string | null | undefined): TextFacts {
  const s = String(text ?? '').replace(/ /g, ' ');
  const rent = RENT.test(s);
  const sale = SALE.test(s);
  const transaction = rent && !sale ? 'RENT' : sale && !rent ? 'SALE' : rent && sale ? (/(аренд|rent|ქირ|kiral|إيجار|להשכרה)/i.test(s.slice(0, 120)) ? 'RENT' : 'SALE') : null;
  const offer = OFFER.test(s); const request = REQUEST.test(s);
  const stance = request && !offer ? 'REQUEST' : offer && !request ? 'OFFER' : request && offer ? 'REQUEST' : null;
  const propertyType = LAND.test(s) ? 'LAND' : COMMERCIAL.test(s) ? 'COMMERCIAL' : HOUSE.test(s) && !APARTMENT.test(s) ? 'HOUSE' : APARTMENT.test(s) ? 'APARTMENT' : null;

  const bedrooms =
    firstNumber(/(\d{1,2})\s*(?:-|\s)?\s*(?:bed(?:room)?s?|br\b|спальн|საძინებ|yatak odası|غرف? نوم|חדרי שינה)/i, s);
  const rooms =
    firstNumber(/(\d{1,2})\s*(?:-|\s)?\s*(?:room|комн|к\.|ოთახ|oda|غرف|חדרים|חד')/i, s)
    ?? firstNumber(/(\d)\s*\+\s*1\b/, s);
  const areaSqm = firstNumber(/(\d{2,4}(?:[.,]\d+)?)\s*(?:m2|m²|sq\.?\s?m|sqm|кв\.?\s?м|м2|м²|კვ\.?\s?მ|კვმ|metrekare|متر مربع|م2|מ"ר|מטר)/i, s);
  let currency: TextFacts['currency'] = null;
  let price: number | null = null;
  const pm = s.match(/(?:\$|usd|долл|დოლ|dolar|دولار|דולר)\s*(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?\s*k?)|(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?\s*k?)\s*(?:\$|usd|долл|დოლ|dolar|دولار|דולר)/i);
  const pg = s.match(/(?:₾|gel|лари|ლარ|lari)\s*(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?\s*k?)|(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?\s*k?)\s*(?:₾|gel|лари|ლარ|lari)/i);
  const pe = s.match(/(?:€|eur|евро|ევრო|euro|يورو|יורו)\s*(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?\s*k?)|(\d{1,3}(?:[ ,.]\d{3})+|\d+(?:[.,]\d+)?\s*k?)\s*(?:€|eur|евро|ევრო|euro|يورو|יורו)/i);
  const parse = (m: RegExpMatchArray | null) => {
    if (!m) return null;
    const g = String(m[1] ?? m[2] ?? '');
    const thousands = /k$/i.test(g.trim());
    const raw = g.replace(/k$/i, '').trim().replace(/[ ,](?=\d{3}\b)/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
    let n = Number(raw);
    if (thousands) n *= 1000;
    return Number.isFinite(n) && n >= 50 ? n : null;
  };
  if ((price = parse(pm)) != null) currency = 'USD';
  else if ((price = parse(pg)) != null) currency = 'GEL';
  else if ((price = parse(pe)) != null) currency = 'EUR';
  /* "120k" style without a currency word: price unknown rather than guessed. */

  return {
    transaction,
    stance,
    propertyType,
    bedrooms,
    rooms,
    areaSqm,
    price,
    currency,
    city: cityMentioned(s),
    district: districtMentioned(s),
    newBuild: NEW_BUILD.test(s) ? true : null,
  };
}
