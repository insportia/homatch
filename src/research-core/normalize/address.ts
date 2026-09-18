import { sha256 } from './hash.ts';

/**
 * Address normalization.
 *
 * The goal is not a postal-grade address parser - it is a *stable comparison
 * key*. "12 Chavchavadze Ave, Apt 47" and "Chavchavadze Avenue 12, apartment 47"
 * must produce the same key so that two portals describing one flat dedupe.
 */

export interface NormalizedAddress {
  /** Comparison key: lowercase, transliterated, abbreviation-folded, sorted. */
  key: string;
  /** Human-readable normalized form. */
  display: string;
  street: string | null;
  houseNumber: string | null;
  unit: string | null;
  city: string | null;
  raw: string;
}

const STREET_SUFFIXES: Array<[RegExp, string]> = [
  [/\b(avenue|ave|av)\b\.?/gi, 'ave'],
  [/\b(street|str|st)\b\.?/gi, 'st'],
  [/\b(road|rd)\b\.?/gi, 'rd'],
  [/\b(boulevard|blvd|bvd)\b\.?/gi, 'blvd'],
  [/\b(lane|ln)\b\.?/gi, 'ln'],
  [/\b(square|sq)\b\.?/gi, 'sq'],
  [/\b(highway|hwy)\b\.?/gi, 'hwy'],
  [/\b(drive|dr)\b\.?/gi, 'dr'],
  [/\b(court|ct)\b\.?/gi, 'ct'],
  [/\b(გამზირი|გამზ)\b\.?/gi, 'ave'],
  [/\b(ქუჩა|ქუჩ)\b\.?/gi, 'st'],
  [/\b(проспект|пр-т|пр)\b\.?/gi, 'ave'],
  [/\b(улица|ул)\b\.?/gi, 'st'],
];

const UNIT_TOKENS = /\b(?:apt|apartment|unit|suite|ste|flat|#|ბინა|кв|кварт\w*)\b\.?\s*([0-9]+[a-z]?)/i;
const HOUSE_NUMBER = /(?:^|[\s,])([0-9]+[a-z]?(?:[/-][0-9]+[a-z]?)?)(?=[\s,]|$)/i;

const NOISE = /\b(?:georgia|საქართველო|грузия)\b/gi;

export function normalizeAddress(raw: string, city?: string | null): NormalizedAddress {
  const trimmed = raw.replace(/\s+/g, ' ').trim();

  const unitMatch = trimmed.match(UNIT_TOKENS);
  const unit = unitMatch ? (unitMatch[1] as string).toLowerCase() : null;

  // Remove the unit before hunting for the house number so "Apt 47" does not
  // get mistaken for the building number.
  const withoutUnit = unitMatch ? trimmed.replace(unitMatch[0], ' ') : trimmed;

  const houseMatch = withoutUnit.match(HOUSE_NUMBER);
  const houseNumber = houseMatch ? (houseMatch[1] as string).toLowerCase() : null;

  let street = withoutUnit;
  if (houseMatch) street = street.replace(houseMatch[0], ' ');
  street = street
    .replace(NOISE, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let folded = street.toLowerCase();
  for (const [pattern, replacement] of STREET_SUFFIXES) {
    folded = folded.replace(pattern, replacement);
  }
  folded = folded.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

  const cityNormalized = (city ?? null)?.toLowerCase().trim() || null;
  if (cityNormalized) {
    folded = folded.replace(new RegExp(`\\b${escapeRegex(cityNormalized)}\\b`, 'g'), '').trim();
  }

  // Sorting the tokens makes word order irrelevant: "Chavchavadze ave" and
  // "ave Chavchavadze" (common in Georgian-to-English transliterations) match.
  const tokens = folded.split(' ').filter(Boolean).sort();

  const keyMaterial = [tokens.join(' '), houseNumber ?? '', unit ?? '', cityNormalized ?? ''].join('|');

  const display = [
    [street, houseNumber].filter(Boolean).join(' ').trim(),
    unit ? `unit ${unit}` : null,
    city ?? null,
  ]
    .filter(Boolean)
    .join(', ');

  return {
    key: sha256(keyMaterial).slice(0, 24),
    display: display || trimmed,
    street: tokens.length ? street.trim() : null,
    houseNumber,
    unit,
    city: city ?? null,
    raw: trimmed,
  };
}

export function addressesMatch(a: string, b: string, cityA?: string | null, cityB?: string | null): boolean {
  return normalizeAddress(a, cityA).key === normalizeAddress(b, cityB).key;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
