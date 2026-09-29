// CUSTOM AUDIENCE IDENTIFIERS — normalized and hashed the one documented
// way, server-side, before anything leaves HOMATCH.
//
// Meta's customer-list spec (long-stable across API versions): identifiers
// are SHA-256 hex digests of normalized values — emails trimmed and
// lowercased; phones reduced to digits with country code and no leading
// zeros/plus. Raw identifiers are never sent when the integration requires
// preprocessing, and hashes are never handed to the frontend.
//
// WebCrypto only, so the same module runs in Deno (edge) and node:test.

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return null;
  return v;
}

/** Digits only, international form. "+995 555 12 34 56" → "995555123456". */
export function normalizePhone(raw: string): string | null {
  let v = raw.replace(/[^\d+]/g, '');
  if (v.startsWith('+')) v = v.slice(1);
  else if (v.startsWith('00')) v = v.slice(2);
  v = v.replace(/^0+/, '');
  if (v.length < 7 || v.length > 15) return null;
  return v;
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface HashedIdentifiers {
  /** Meta schema columns present, in order. */
  schema: Array<'EMAIL_SHA256' | 'PHONE_SHA256'>;
  /** One row per person; null-free, aligned with `schema`. */
  rows: string[][];
  accepted: number;
  rejected: number;
}

/** Builds the users payload for a customer-list audience. A row needs at
 *  least one valid identifier to survive; nothing is invented for the rest. */
export async function hashIdentifierRows(
  people: Array<{ email?: string | null; phone?: string | null }>,
): Promise<HashedIdentifiers> {
  const rows: string[][] = [];
  let rejected = 0;
  for (const p of people) {
    const email = p.email ? normalizeEmail(p.email) : null;
    const phone = p.phone ? normalizePhone(p.phone) : null;
    if (!email && !phone) { rejected += 1; continue; }
    rows.push([
      email ? await sha256Hex(email) : '',
      phone ? await sha256Hex(phone) : '',
    ]);
  }
  return { schema: ['EMAIL_SHA256', 'PHONE_SHA256'], rows, accepted: rows.length, rejected };
}

/* ── EXPORT SAFETY ─────────────────────────────────────────────────────
 * CSV cells that start with = + - @ are formula-injection vectors in
 * spreadsheet apps; a leading apostrophe defuses them. Shared here so the
 * lead export and any future export use one rule.
 */
export function csvSafeCell(value: unknown): string {
  const s = String(value ?? '');
  const defused = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${defused.replace(/"/g, '""')}"`;
}
