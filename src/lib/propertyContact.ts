// THE CONTACT NUMBER A PROPERTY IS REACHED ON.
//
// One place that turns what somebody typed into what the database stores, so that the
// private-listing form, the import review and the edit screen cannot each decide
// differently what "+995 555 123 456" means.
//
// IT DOES NOT PARSE ANYTHING ITSELF. `src/lib/comm/phone.ts` already wraps libphonenumber
// for the campaign importer, it already has a generated mirror on the edge side, and it
// already knows that an explicit +44 beats a Georgian default. Writing a second parser
// here would be a second set of answers to the same question — which is precisely how
// "+995555123456" and "+995 555 123 456" become two contacts.
//
// WHAT IT ADDS IS THE PRODUCT RULE:
//
//   A property's contact number has to be REACHABLE, not merely well-formed. parsePhone
//   returns a confidence, and a number the library could read but that is not a real
//   number for its country comes back with an E.164 and `valid: false`. That is fine for
//   a campaign list a human will review; it is not fine for the one number a buyer will
//   call. So only a valid parse is accepted here.
//
//   The raw text is kept. A number we refused is shown back to the owner as they wrote
//   it, rather than replaced by our reading of it — they are the ones who know whether
//   the eighth digit is a 7.

import { maskPhone, parsePhone } from '@/lib/comm/phone';

/** What the database stores for one property's contact. */
export interface PropertyContact {
  contact_phone_e164: string;
  contact_phone_raw: string;
  contact_phone_country: string | null;
}

export type ContactPhoneProblem = 'EMPTY' | 'NO_COUNTRY' | 'UNREACHABLE';

export interface ContactPhoneReading {
  /** Present only when the number is one somebody could actually call. */
  contact: PropertyContact | null;
  /** Why not, for a message that says the useful thing. Null when it parsed. */
  problem: ContactPhoneProblem | null;
}

/**
 * Read a typed number against a country.
 *
 * `defaultCountry` is used ONLY for a number written in local form. A number carrying its
 * own international prefix is trusted over it, always — silently re-homing a +44 number to
 * Georgia because the page is Georgian is how a buyer calls the wrong continent.
 */
export function readContactPhone(
  raw: string,
  defaultCountry?: string | null,
): ContactPhoneReading {
  const text = String(raw ?? '').trim();
  if (!text) return { contact: null, problem: 'EMPTY' };

  const parsed = parsePhone(text, defaultCountry ?? null);

  /*
   * A BARE LOCAL NUMBER WITH NO COUNTRY IS ITS OWN PROBLEM, and a different message.
   * "555123456" is not wrong — it is incomplete, and telling somebody their number is
   * invalid when what we need is a country code sends them to check the digits.
   */
  if (parsed.reason === 'NO_COUNTRY') return { contact: null, problem: 'NO_COUNTRY' };

  /* Everything else that did not produce a callable number is one thing to the owner:
     this is not a number we could reach. */
  if (!parsed.valid || !parsed.e164) return { contact: null, problem: 'UNREACHABLE' };

  return {
    contact: {
      contact_phone_e164: parsed.e164,
      contact_phone_raw: text,
      contact_phone_country: parsed.country ?? null,
    },
    problem: null,
  };
}

/**
 * The number, shown to somebody who is allowed to see it.
 *
 * Canonical form rather than what was typed: it is unambiguous, it is what `tel:` will
 * dial, and it reads the same to a Georgian owner and an Arabic one. `dir="ltr"` is the
 * caller's job — a phone number is digits and runs left to right inside any sentence.
 */
export function displayContactPhone(e164: string | null | undefined): string {
  return String(e164 ?? '').trim();
}

/**
 * The number, shown to somebody who is not yet allowed to see it.
 *
 * Re-exported rather than re-implemented so the masking rule has one definition. A masked
 * number is a statement that a number EXISTS, which is itself a useful and disclosable
 * fact; the digits are a separate decision made server-side.
 */
export const maskContactPhone = maskPhone;

/** What `tel:` should carry. Null when there is nothing to dial. */
export function telHref(e164: string | null | undefined): string | null {
  const value = String(e164 ?? '').trim();
  return /^\+[1-9][0-9]{6,14}$/.test(value) ? `tel:${value}` : null;
}

/**
 * Whether this property can start a discovery campaign yet.
 *
 * A campaign finds people who want to talk to the owner, and it is worth spending on only
 * if there is a way for them to do that. A historical property with no number is not
 * broken and is not archived — it is asked, once, at the point where the reason is
 * visible.
 */
export function hasContactReadiness(
  property: { contact_phone_e164?: string | null } | null | undefined,
): boolean {
  return Boolean(property?.contact_phone_e164);
}
