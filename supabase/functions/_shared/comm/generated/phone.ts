// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/phone.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

// HOMATCH Communications — phone numbers.
//
// WHY THIS DELEGATES TO A LIBRARY
//
// supabase/functions/_shared/suppression.ts carries a hand-written parser with
// a ten-entry prefix table. It gets +995 599 12 34 56 right and it gets almost
// everything else wrong: it cannot tell a Georgian mobile from a Georgian
// landline, it will happily produce +9950599123456 from a local number written
// with its trunk zero, it treats any 8-to-15-digit string with a leading + as
// valid, and its country inference cannot distinguish +1 Canada from +1 US or
// +7 Kazakhstan from +7 Russia. Every one of those errors ends as a call that
// does not connect and a charge that does.
//
// libphonenumber-js is Google's metadata, which is the only thing that
// actually knows these rules. §14 requires it by name.
//
// The old parser is NOT deleted — outreach-send and outreach-unsubscribe still
// import it and historical rows were written by it. This is the parser the
// import wizard and the new send paths use.

import {
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumber,
} from 'https://esm.sh/libphonenumber-js@1.13.13';

export type PhoneConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED';

export interface ParsedPhone {
  /** E.164, or null when nothing defensible could be produced. */
  e164: string | null;
  /** ISO-3166 alpha-2, from the number itself where possible. */
  country: string | null;
  /** True only when the library says the number is valid for its country. */
  valid: boolean;
  confidence: PhoneConfidence;
  /** MOBILE / FIXED_LINE / … when the metadata can tell. Null when it cannot. */
  kind: string | null;
  /** Whether the country came from the number or from the import's default. */
  countryInferred: boolean;
  /** Machine-readable, so the import report can group rows by cause. */
  reason?: 'EMPTY' | 'TOO_SHORT' | 'TOO_LONG' | 'NOT_A_NUMBER' | 'INVALID_FOR_COUNTRY' | 'NO_COUNTRY';
}

const EMPTY: ParsedPhone = {
  e164: null, country: null, valid: false, confidence: 'UNRESOLVED',
  kind: null, countryInferred: false, reason: 'EMPTY',
};

/**
 * Strip the decorations a spreadsheet adds and a human types.
 *
 * Excel turns a phone column into a number and hands back "9.95599e+11", and
 * it drops the leading + and any leading zero. None of that is recoverable
 * here — it is recoverable at the READ, by asking the sheet for the cell's
 * displayed text rather than its value, which is what importFile.ts does. What
 * this handles is the ordinary mess: spaces, dashes, brackets, dots, a
 * trailing extension, Eastern Arabic digits, and the "00" international prefix
 * written instead of "+".
 */
export function cleanPhoneInput(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return '';

  // Eastern Arabic-Indic and Persian digits — Arabic and Hebrew are
  // first-class locales here (§82), and a pasted Arabic-script number arrives
  // in these code points.
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
       .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

  // An extension is not part of the number we can dial automatically.
  s = s.replace(/\b(?:ext|extension|x|доб)\.?\s*\d+\s*$/i, '');

  // "00995..." is the same number as "+995...".
  s = s.replace(/^\s*00(?=\d)/, '+');

  // Keep digits and a single leading +. Everything else is decoration.
  const plus = s.trimStart().startsWith('+');
  const digits = s.replace(/\D/g, '');
  return digits ? (plus ? `+${digits}` : digits) : '';
}

/**
 * Parse one number.
 *
 * `defaultCountry` is what the import wizard asked the user for at step 3. It
 * is used ONLY for numbers written in local form. A number that carries its
 * own international prefix is trusted over the default, always — §14 is
 * explicit that an explicit prefix wins, and silently re-homing a +44 number
 * to GE because the sheet was mostly Georgian is how a campaign dials the
 * wrong continent.
 */
export function parsePhone(raw: string, defaultCountry?: string | null): ParsedPhone {
  const cleaned = cleanPhoneInput(raw);
  if (!cleaned) return { ...EMPTY };

  const digitCount = cleaned.replace(/\D/g, '').length;
  if (digitCount < 4) return { ...EMPTY, reason: 'TOO_SHORT' };
  if (digitCount > 15) return { ...EMPTY, reason: 'TOO_LONG' };

  const hasInternationalPrefix = cleaned.startsWith('+');
  const hint = hasInternationalPrefix
    ? undefined
    : (normalizeCountryCode(defaultCountry) ?? undefined);

  if (!hasInternationalPrefix && !hint) {
    // A bare local number with no country to read it against is genuinely
    // ambiguous. §14: never manufacture a country code at low confidence.
    return { ...EMPTY, reason: 'NO_COUNTRY', confidence: 'UNRESOLVED' };
  }

  let parsed: PhoneNumber | undefined;
  try {
    parsed = parsePhoneNumberFromString(cleaned, hint as CountryCode | undefined);
  } catch {
    parsed = undefined;
  }
  if (!parsed) return { ...EMPTY, reason: 'NOT_A_NUMBER' };

  const valid = parsed.isValid();
  const country = parsed.country ?? null;
  let kind: string | null = null;
  try {
    kind = parsed.getType() ?? null;
  } catch {
    kind = null;
  }

  if (!valid) {
    // The library could read it but the number is not real for that country —
    // a digit short, or a prefix that country does not issue. Keep the E.164
    // so the row can be shown for review, but never mark it callable.
    return {
      e164: parsed.number ?? null,
      country,
      valid: false,
      confidence: 'LOW',
      kind,
      countryInferred: !hasInternationalPrefix,
      reason: 'INVALID_FOR_COUNTRY',
    };
  }

  return {
    e164: parsed.number,
    country,
    valid: true,
    // HIGH only when the number told us its own country. A valid number that
    // only became valid because we supplied the country is MEDIUM, and the
    // import report says so.
    confidence: hasInternationalPrefix ? 'HIGH' : 'MEDIUM',
    kind,
    countryInferred: !hasInternationalPrefix,
  };
}

/** Accepts "GE", "ge", "Georgia", "საქართველო", "+995". Returns null for anything it cannot place. */
export function normalizeCountryCode(input?: string | null): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();

  if (/^\+?\d{1,4}$/.test(s)) {
    const dial = s.startsWith('+') ? s : `+${s}`;
    return DIAL_TO_COUNTRY[dial] ?? null;
  }

  const key = s.toLowerCase();
  return COUNTRY_NAMES[key] ?? null;
}

/**
 * A deliberately small table. It exists so an import can accept a country
 * COLUMN written in any of Homatch's six locales, not to be a world atlas —
 * the authoritative country of a phone number always comes from
 * libphonenumber, never from here.
 */
const COUNTRY_NAMES: Record<string, string> = {
  georgia: 'GE', 'საქართველო': 'GE', грузия: 'GE', gürcistan: 'GE', 'جورجيا': 'GE', 'גאורגיה': 'GE',
  russia: 'RU', россия: 'RU', 'რუსეთი': 'RU', rusya: 'RU',
  turkey: 'TR', türkiye: 'TR', turkiye: 'TR', турция: 'TR', 'თურქეთი': 'TR',
  armenia: 'AM', армения: 'AM', 'სომხეთი': 'AM',
  azerbaijan: 'AZ', азербайджан: 'AZ', 'აზერბაიჯანი': 'AZ',
  ukraine: 'UA', украина: 'UA', 'უკრაინა': 'UA',
  israel: 'IL', израиль: 'IL', 'ისრაელი': 'IL', 'ישראל': 'IL',
  'united arab emirates': 'AE', uae: 'AE', оаэ: 'AE', 'الإمارات': 'AE',
  'saudi arabia': 'SA', 'السعودية': 'SA',
  'united states': 'US', usa: 'US', us: 'US', сша: 'US',
  'united kingdom': 'GB', uk: 'GB', великобритания: 'GB',
  germany: 'DE', германия: 'DE', deutschland: 'DE', 'გერმანია': 'DE',
  france: 'FR', франция: 'FR',
  italy: 'IT', италия: 'IT',
  greece: 'GR', греция: 'GR',
  kazakhstan: 'KZ', казахстан: 'KZ',
  belarus: 'BY', беларусь: 'BY',
  poland: 'PL', польша: 'PL',
  india: 'IN', индия: 'IN',
  china: 'CN', китай: 'CN',
};

const DIAL_TO_COUNTRY: Record<string, string> = {
  '+995': 'GE', '+7': 'RU', '+90': 'TR', '+374': 'AM', '+994': 'AZ', '+380': 'UA',
  '+972': 'IL', '+971': 'AE', '+966': 'SA', '+1': 'US', '+44': 'GB', '+49': 'DE',
  '+33': 'FR', '+39': 'IT', '+30': 'GR', '+48': 'PL', '+91': 'IN', '+86': 'CN',
};

/**
 * The key two rows are "the same person" on.
 *
 * Deliberately the E.164 string and nothing cleverer. Matching on the last
 * nine digits would collapse two genuinely different numbers in two countries,
 * and a duplicate that silently eats a real contact is worse than a duplicate
 * that survives.
 */
export function phoneDedupeKey(parsed: ParsedPhone): string | null {
  return parsed.e164;
}

/** Redaction for logs and telemetry (§74). Keeps enough to correlate, not enough to identify. */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const s = String(e164);
  if (s.length <= 5) return '***';
  return `${s.slice(0, 4)}${'*'.repeat(Math.max(0, s.length - 6))}${s.slice(-2)}`;
}
