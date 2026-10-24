// What a customer types as a cadastral code, made into the code the registries know.
//
// Prod 1ff4b786 (2026-10-24): "88.20.21.767.117.2" was searched as typed by
// every official source; none matched, and the report had no registry data,
// documents, location or market. A Georgian code is XX.XX.XX.XXX.XXX for the
// parcel, then optionally .XX (building), .XX (section) and .XXX (unit) — the
// pattern propertyIdentity.ts reads. A group typed without its leading zeros
// ("2" for building 02) is the same code: it is padded, and the run searches
// the canonical form. Only input that cannot be read as a code (a group
// longer than its slot, too few or too many groups, non-digits) is refused.
// Pure: the page and research-agent share it.

export const CANONICAL_CADASTRAL = /^\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3}(?:\.\d{2}(?:\.\d{2}(?:\.\d{3})?)?)?$/;
/** Digits per group: zone, sector, quarter, parcel, plot, then building, section, unit. */
const WIDTHS = [2, 2, 2, 3, 3, 2, 2, 3];

export interface CadastralCheck {
  /** The input reads as a cadastral code (possibly after padding). */
  ok: boolean;
  /** The canonical code to search (the trimmed input when it cannot be read). */
  code: string;
  /** True when the canonical code differs from what was typed. */
  normalized: boolean;
  /** For unreadable input: the longest valid code it starts with, if any. */
  suggestion: string | null;
}

export function normalizeCadastral(raw: unknown): string | null {
  const typed = String(raw ?? '').trim().replace(/\s+/g, '').replace(/[,/\\-]/g, '.').replace(/\.+$/, '');
  if (!/^\d+(\.\d+)+$/.test(typed)) return null;
  const groups = typed.split('.');
  if (groups.length < 5 || groups.length > WIDTHS.length) return null;
  const padded: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i].replace(/^0+(?=\d)/, '');
    if (g.length > WIDTHS[i]) return null;
    padded.push(g.padStart(WIDTHS[i], '0'));
  }
  const code = padded.join('.');
  return CANONICAL_CADASTRAL.test(code) ? code : null;
}

export function checkCadastralInput(raw: unknown): CadastralCheck {
  const typed = String(raw ?? '').trim();
  const code = normalizeCadastral(typed);
  if (code) return { ok: true, code, normalized: code !== typed, suggestion: null };
  // Unreadable as a whole: offer the longest leading part that is a code.
  const groups = typed.replace(/\s+/g, '').split('.');
  for (let n = Math.min(groups.length - 1, WIDTHS.length); n >= 5; n--) {
    const prefix = normalizeCadastral(groups.slice(0, n).join('.'));
    if (prefix) return { ok: false, code: typed, normalized: false, suggestion: prefix };
  }
  return { ok: false, code: typed, normalized: false, suggestion: null };
}
