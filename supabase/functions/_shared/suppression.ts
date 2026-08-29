// ── Suppression & Compliance Engine (Phase 7) ────────────────
// Checks contacts against suppression lists, bounce/complaint history,
// do_not_contact, do_not_call, unsubscribed flags.
// Country-aware policy hooks (stubbed — no real enforcement yet).

export interface ContactEligibility {
  eligible: boolean;
  reason?: string;
}

export interface ContactRecord {
  id?: string;
  email?: string | null;
  phone?: string | null;
  do_not_contact?: boolean;
  do_not_call?: boolean;
  unsubscribed?: boolean;
  suppressed?: boolean;
  suppressed_reason?: string | null;
  bounce_count?: number;
  complaint_count?: number;
  country?: string | null;
}

/** Check whether a contact is eligible for a given channel */
export function checkEligibility(
  contact: ContactRecord,
  channel: 'EMAIL' | 'SMS' | 'AI_CALL' | 'COMMUNITY_POST'
): ContactEligibility {
  if (contact.do_not_contact) {
    return { eligible: false, reason: 'do_not_contact flag set' };
  }
  if (contact.suppressed) {
    return { eligible: false, reason: contact.suppressed_reason ?? 'suppressed' };
  }
  if (channel === 'EMAIL' || channel === 'SMS') {
    if (contact.unsubscribed) {
      return { eligible: false, reason: 'unsubscribed' };
    }
    if ((contact.bounce_count ?? 0) >= 3) {
      return { eligible: false, reason: 'bounce_limit_exceeded' };
    }
    if ((contact.complaint_count ?? 0) >= 1) {
      return { eligible: false, reason: 'complaint_registered' };
    }
    if (channel === 'EMAIL' && !contact.email) {
      return { eligible: false, reason: 'no_email' };
    }
    if (channel === 'SMS' && !contact.phone) {
      return { eligible: false, reason: 'no_phone' };
    }
  }
  if (channel === 'AI_CALL') {
    if (contact.do_not_call) {
      return { eligible: false, reason: 'do_not_call flag set' };
    }
    if (!contact.phone) {
      return { eligible: false, reason: 'no_phone' };
    }
    // Country-aware calling window hook (stub)
    const callingWindowBlocked = checkCallingWindow(contact.country);
    if (callingWindowBlocked) {
      return { eligible: false, reason: 'outside_calling_window' };
    }
  }
  return { eligible: true };
}

/** Idempotency key for queue items — prevents double-sends */
export function buildIdempotencyKey(
  campaignId: string,
  contactId: string,
  channel: string,
  attempt: number
): string {
  return `${campaignId}:${contactId}:${channel}:${attempt}`;
}

/** Country-aware calling window check (UTC-based stub) */
function checkCallingWindow(_country?: string | null): boolean {
  // Stub: always within window. Real impl would check UTC→local conversion.
  return false;
}

/** Normalize phone to E.164 with confidence scoring */
export function normalizePhone(
  raw: string,
  countryHint?: string
): { normalized: string | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED' } {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { normalized: null, confidence: 'UNRESOLVED' };

  // Already E.164-like: +XXXXXXXXXX
  if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) {
    return { normalized: `+${digits}`, confidence: 'HIGH' };
  }
  // With country hint — best-effort prefix
  if (countryHint && digits.length >= 7 && digits.length <= 12) {
    const countryPrefix: Record<string, string> = {
      GE: '+995', US: '+1', RU: '+7', TR: '+90', DE: '+49',
      IL: '+972', AE: '+971', SA: '+966', EG: '+20', UA: '+380',
    };
    const prefix = countryPrefix[countryHint.toUpperCase()];
    if (prefix) {
      return { normalized: `${prefix}${digits}`, confidence: 'MEDIUM' };
    }
  }
  if (digits.length >= 8 && digits.length <= 15) {
    return { normalized: null, confidence: 'LOW' };
  }
  return { normalized: null, confidence: 'UNRESOLVED' };
}

/** Normalize email — lowercase, trim, validate format */
export function normalizeEmail(raw: string): { email: string | null; valid: boolean } {
  const trimmed = raw.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
  return { email: valid ? trimmed : null, valid };
}

/** Infer probable country from phone prefix (low confidence) */
export function inferCountryFromPhone(
  e164: string
): { country: string | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW' } {
  const prefixes: Array<[string, string]> = [
    ['+1', 'US'], ['+7', 'RU'], ['+44', 'GB'], ['+49', 'DE'], ['+33', 'FR'],
    ['+90', 'TR'], ['+995', 'GE'], ['+972', 'IL'], ['+971', 'AE'], ['+380', 'UA'],
    ['+20', 'EG'], ['+966', 'SA'], ['+98', 'IR'], ['+86', 'CN'], ['+91', 'IN'],
  ];
  for (const [prefix, country] of prefixes.sort((a, b) => b[0].length - a[0].length)) {
    if (e164.startsWith(prefix)) return { country, confidence: 'MEDIUM' };
  }
  return { country: null, confidence: 'LOW' };
}
