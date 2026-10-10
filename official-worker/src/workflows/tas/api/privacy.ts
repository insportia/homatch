// privacy.ts — personal data that must never leave the worker toward a
// customer: Georgian personal ID numbers (11 digits), phone numbers and
// e-mail addresses. Names are kept (they are the public record's parties);
// organisation identification codes (9 digits) are kept.
//
// Applied to: case text (responses, attachments), detail/form label-value
// pairs, and the sanitized raw detail/form graphs stored as evidence.

/** Field names that carry a personal identifier or contact detail. */
export const SENSITIVE_KEY = /(personal|privatenumber|^pid$|passport|birth|phone|mobile|^tel$|^tel[A-Z_]|telephone|^fax|e-?mail|^mail$|contact(no|number)|piradi|პირად|ტელეფ|მობილ|ელ\.?\s?ფოსტ|დაბადებ)/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 11 digits standing alone: a Georgian personal number. */
const PERSONAL_ID = /(?<![\d.])\d{11}(?![\d.])/g;
/** Phones written with a country code or separators (mobile 5XX…, Tbilisi 032 2…). */
const PHONE_FORMATTED = /(?<![\d.])(?:(?:\+|00)\s?995[\s-]?\(?(?:5\d{2}|0?32)\)?[\s-]?\d{2,3}[\s-]?\d{2}[\s-]?\d{2,3}|\(?5\d{2}\)?[\s-]\d{2,3}[\s-]\d{2}[\s-]\d{2,3}|\(?0?32\)?[\s-]2\d{2}[\s-]?\d{2}[\s-]?\d{2})(?![\d.])/g;
/** An unformatted mobile (5XXXXXXXX) only next to a phone word — 9 digits are otherwise an organisation code. */
const PHONE_LABELLED = /((?:ტელ|მობ|tel|phone|mob|тел)[^\d\n]{0,15})(?:\+?995)?\d{9}(?![\d.])/gi;

export function maskId(digits: string): string {
  return `•••${digits.slice(-3)}`;
}

/** Redact personal IDs, phones and e-mails from free text. Names untouched. */
export function redactPersonalData(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL, '[email removed]')
    .replace(PHONE_LABELLED, (_m, lead) => `${lead}[phone removed]`)
    .replace(PHONE_FORMATTED, '[phone removed]')
    .replace(PERSONAL_ID, (d) => maskId(d));
}

/** True when the text still contains something redactPersonalData would remove. */
export function containsPersonalData(text: string): boolean {
  if (!text) return false;
  const t = String(text);
  return new RegExp(EMAIL.source).test(t) || new RegExp(PERSONAL_ID.source).test(t) || new RegExp(PHONE_FORMATTED.source).test(t) || new RegExp(PHONE_LABELLED.source, 'i').test(t);
}

export function isSensitiveKey(key: string | null | undefined): boolean {
  return !!key && SENSITIVE_KEY.test(key);
}

/**
 * A JSON-safe copy of a (plain) graph with sensitive fields removed and
 * every string redacted. A personal-number field keeps only its mask.
 */
export function sanitizeGraph(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return redactPersonalData(v);
  if (typeof v !== 'object') return v;
  if (depth > 40) return '[depth]';
  if (Array.isArray(v)) return v.map((x) => sanitizeGraph(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (isSensitiveKey(k)) {
      const digits = typeof x === 'string' || typeof x === 'number' ? String(x).replace(/\D/g, '') : '';
      if (/personal|pid|privatenumber|piradi|პირად/i.test(k) && digits.length >= 4) out[k] = maskId(digits);
      continue;
    }
    out[k] = sanitizeGraph(x, depth + 1);
  }
  return out;
}
