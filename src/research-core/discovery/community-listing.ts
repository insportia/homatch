// PHASE 2 — A COMMUNITY POST THAT OFFERS PROPERTY, AS A SUPPLY OBSERVATION.
//
// Telegram communities carry far more listings than requests (production,
// 2026-10-02: 356 of 541 collected posts were offers). The demand classifier
// rightly refuses them as demand -- and until Phase 2 that refusal was the end
// of them. A listing is supply, and Find Property needs supply.
//
// This reads a post deterministically: no model, no network, closed outputs.
// Every field it fills says where it came from (field_origins), and a field it
// cannot read stays null. A post becomes an observation only when it is
// recognisably a listing with a place and at least a price or an area;
// anything vaguer stays a raw signal, which loses nothing.
//
// The city may come from the COMMUNITY when the post does not name one (a
// Batumi rentals channel rarely writes "Batumi"); that origin is recorded as
// SOURCE_CONTEXT so a matcher or an operator can weigh it differently.

import { extractAreas, toSqm } from '../normalize/area.ts';
import { extractMoney } from '../normalize/currency.ts';
import { resolvePlace } from '../normalize/place.ts';

export const COMMUNITY_LISTING_PARSER_VERSION = 'community-listing-1';

export type FieldOrigin = 'TEXT' | 'SOURCE_CONTEXT';

export interface CommunityListing {
  transaction: 'SALE' | 'RENT';
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | null;
  city: string | null;
  district: string | null;
  price: { amount: number; currency: string; period: 'MONTH' | null } | null;
  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  floor: number | null;
  totalFloors: number | null;
  origins: Record<string, FieldOrigin>;
  /** Share of the six core fields read (transaction, type, place, price, area, rooms). */
  quality: number;
}

const RENT = /(сда[её]тся|сдаю|аренд|ქირავდება|ქირით|for rent|to rent|\brent\b|kiral[iı]k|\/\s*(месяц|мес|month|თვე)|в месяц|per month|თვეში)/i;
const SALE = /(прода[её]тся|продаю|продажа|იყიდება|for sale|\bsale\b|sat[iı]l[iı]k)/i;

const TYPES: Array<[RegExp, CommunityListing['propertyType']]> = [
  [/(участ|земл|მიწ|\bland\b|\bplot\b|arsa)/i, 'LAND'],
  [/(отел|гостиниц|hotel|სასტუმრო|офис|office|ოფის|коммерч|commercial|კომერც|магазин|shop)/i, 'COMMERCIAL'],
  [/((?<!\p{L})дом(?!\p{L})|коттедж|house|villa|вилл|სახლ|აგარაკ)/iu, 'HOUSE'],
  [/(квартир|студи|апартамент|ბინ|სტუდიო|apartment|\bflat\b|studio|daire)/i, 'APARTMENT'],
];

const NUMBER_WORDS: Record<string, number> = {
  одно: 1, одн: 1, двух: 2, дву: 2, трёх: 3, трех: 3, четырёх: 4, четырех: 4, пяти: 5,
};

/** Areas the shared parser does not read: кв/м, Cyrillic м², spelled-out metres. */
const EXTRA_AREA = /(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:кв\.?\s*\/?\s*м(?!\p{L})|м²|м2(?!\d)|квадратн\p{L}*\s+метр\p{L}*|კვ\.?\s*მ)/giu;

function readArea(text: string): number | null {
  const candidates: number[] = [];
  for (const area of extractAreas(text)) candidates.push(toSqm(area));
  for (const match of text.matchAll(EXTRA_AREA)) candidates.push(Number(match[1].replace(',', '.')));
  const plausible = candidates.filter((v) => Number.isFinite(v) && v >= 8 && v <= 100_000);
  return plausible.length ? plausible[0] : null;
}

function readRooms(text: string): { rooms: number | null; bedrooms: number | null } {
  const plusOne = text.match(/\b(\d)\s*\+\s*1\b/);
  if (plusOne) return { rooms: Number(plusOne[1]) + 1, bedrooms: Number(plusOne[1]) };
  if (/(студи|სტუდიო|\bstudio\b)/i.test(text)) return { rooms: 1, bedrooms: 0 };
  let rooms: number | null = null;
  let bedrooms: number | null = null;
  const r = text.match(/(\d{1,2})\s*-?\s*(?:х\s*)?(?:ოთახ|комн|room|oda)/i);
  if (r) rooms = Number(r[1]);
  const b = text.match(/(\d{1,2})\s*(?:საძინებ|спальн|bedroom|yatak)/i);
  if (b) bedrooms = Number(b[1]);
  if (rooms === null) {
    const w = text.toLowerCase().match(/(одно|двух|трёх|трех|четырёх|четырех|пяти)\s*-?\s*комнатн/);
    if (w) rooms = NUMBER_WORDS[w[1]] ?? null;
  }
  if (bedrooms === null) {
    const w = text.toLowerCase().match(/(одн|дву|трем|тремя|двумя)\p{L}*\s+спальн/u);
    if (w) bedrooms = w[1].startsWith('дв') ? 2 : w[1].startsWith('тр') ? 3 : 1;
  }
  return { rooms, bedrooms };
}

function readFloor(text: string): { floor: number | null; totalFloors: number | null } {
  const slash = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:этаж|სართ|floor|kat)/i);
  if (slash) return { floor: Number(slash[1]), totalFloors: Number(slash[2]) };
  const one = text.match(/(\d{1,2})\s*-?\s*(?:м|й|ом)?\s*(?:этаж|floor|kat)/i) ?? text.match(/(?:სართული|этаж|floor)\s*:?\s*(?:მე-)?(\d{1,2})/i);
  return { floor: one ? Number(one[1]) : null, totalFloors: null };
}

/* Georgian nouns carry case endings ("ვაკეში" = in Vake, "თბილისში" = in Tbilisi);
   the place table holds the nominative. Strip one ending and try both stems. */
const KA_CASE = /(ში|ის|ზე|დან|თან|ით|ად|მდე)$/u;
function placeCandidates(word: string): string[] {
  const out = [word];
  if (KA_CASE.test(word)) {
    const stem = word.replace(KA_CASE, '');
    out.push(stem, `${stem}ი`);
  }
  return out;
}

function readPlace(text: string): { city: string | null; district: string | null } {
  const words = text.split(/[^\p{L}-]+/u).filter((w) => w.length >= 3);
  let city: string | null = null;
  let district: string | null = null;
  for (let i = 0; i < words.length; i += 1) {
    const tries = [...placeCandidates(words[i]), ...(i + 1 < words.length ? [`${words[i]} ${words[i + 1]}`] : [])];
    for (const candidate of tries) {
      const place = resolvePlace(candidate);
      if (!place) continue;
      if (place.kind === 'CITY' && !city) city = place.key;
      if (place.kind === 'DISTRICT' && !district) { district = place.key; city = city ?? place.cityKey; }
    }
  }
  return { city, district };
}

/* Currency written as a word after the number: "800 долларов", "500 лари". */
const WORD_CURRENCY: Array<[RegExp, string]> = [
  [/^(долл|доллар|dollar|დოლარ|бакс)/iu, 'USD'],
  [/^(лари|ლარ|lari|gel)/iu, 'GEL'],
  [/^(евро|euro|ევრო)/iu, 'EUR'],
];
function wordMoney(text: string): Array<{ amount: number; currency: string }> {
  const out: Array<{ amount: number; currency: string }> = [];
  for (const m of text.matchAll(/(\d[\d\s.,]{0,12}\d|\d)\s*(\p{L}+)/gu)) {
    const currency = WORD_CURRENCY.find(([re]) => re.test(m[2]))?.[1];
    if (!currency) continue;
    const amount = Number(m[1].replace(/[\s,]/g, '').replace(/\.(?=\d{3}\b)/g, ''));
    if (Number.isFinite(amount) && amount > 0) out.push({ amount, currency });
  }
  return out;
}

export function extractCommunityListing(
  text: string,
  context: { sourceCity?: string | null } = {},
): CommunityListing | null {
  const body = String(text || '').slice(0, 8000);
  if (body.trim().length < 20) return null;

  const rentHit = RENT.test(body);
  const saleHit = SALE.test(body);
  if (!rentHit && !saleHit) return null;
  /* An explicit sale verb wins over a "/month" mention only when no rent verb is present. */
  const transaction: 'SALE' | 'RENT' = saleHit && !/(сда[её]тся|сдаю|ქირავდება|for rent|kiral)/i.test(body) ? 'SALE' : 'RENT';

  const origins: Record<string, FieldOrigin> = { transaction: 'TEXT' };
  const propertyType = TYPES.find(([re]) => re.test(body))?.[1] ?? null;
  if (propertyType) origins.propertyType = 'TEXT';

  let { city, district } = readPlace(body);
  if (city) origins.city = 'TEXT';
  if (district) origins.district = 'TEXT';
  if (!city && context.sourceCity) {
    const fromSource = resolvePlace(context.sourceCity);
    city = fromSource?.cityKey ?? null;
    if (city) origins.city = 'SOURCE_CONTEXT';
  }

  const monthly = /(\/\s*(месяц|мес|month|თვე)|в месяц|per month|თვეში|ყოველთვიურ)/i.test(body);
  const [low, high] = transaction === 'RENT' ? [50, 30_000] : [3_000, 100_000_000];
  const money = extractMoney(body).find((m) => m.amount >= low && m.amount <= high)
    ?? wordMoney(body).find((m) => m.amount >= low && m.amount <= high)
    ?? null;
  const price = money
    ? { amount: money.amount, currency: String(money.currency).toUpperCase(), period: transaction === 'RENT' && monthly ? 'MONTH' as const : null }
    : null;
  if (price) origins.price = 'TEXT';

  const areaSqm = readArea(body);
  if (areaSqm !== null) origins.areaSqm = 'TEXT';
  const { rooms, bedrooms } = readRooms(body);
  if (rooms !== null) origins.rooms = 'TEXT';
  if (bedrooms !== null) origins.bedrooms = 'TEXT';
  const { floor, totalFloors } = readFloor(body);
  if (floor !== null) origins.floor = 'TEXT';

  /* A listing worth storing: a place, and something to compare on. */
  if (!city || (price === null && areaSqm === null)) return null;

  const core = [true, propertyType !== null, city !== null, price !== null, areaSqm !== null, rooms !== null];
  const quality = Math.round((core.filter(Boolean).length / core.length) * 100) / 100;
  return { transaction, propertyType, city, district, price, areaSqm, rooms, bedrooms, floor, totalFloors, origins, quality };
}
