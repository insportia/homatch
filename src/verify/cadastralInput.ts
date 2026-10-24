// What a customer types as a cadastral code, checked before a run.
//
// The registries are the authority on what a code looks like, not a pattern
// of ours. Prod 1ff4b786 (2026-10-24): "88.20.21.767.117.2" has many records
// on MyGov exactly as typed — a single-digit last group is real — so the code
// is searched AS TYPED (spaces and stray separators cleaned). Padding it to
// ".02" would search a different string. Only input that cannot be a code at
// all (non-digits, fewer than four or more than twelve groups, a group longer
// than six digits — the shape research-agent always accepted) is refused.
// Pure: the page and research-agent share it.

/** Georgian cadastral codes as the registries print them: digit groups, dot-separated. */
export const CADASTRAL_SHAPE = /^\d{1,6}(\.\d{1,6}){3,11}$/;
/** The common full form (parcel, then optional building/section/unit), for reading parts only. */
export const CANONICAL_CADASTRAL = /^\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3}(?:\.\d{2}(?:\.\d{2}(?:\.\d{3})?)?)?$/;

export interface CadastralCheck {
  /** The input is a cadastral code. */
  ok: boolean;
  /** The code to search: exactly what was typed, cleaned of spaces and stray separators. */
  code: string;
  /** True when cleaning changed what was typed (spaces, commas, a trailing dot). */
  normalized: boolean;
  /** For input that is not a code: the longest leading part that is one, if any. */
  suggestion: string | null;
}

export function cleanCadastral(raw: unknown): string {
  return String(raw ?? '').trim().replace(/\s+/g, '').replace(/[,/\\-]/g, '.').replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
}

export function checkCadastralInput(raw: unknown): CadastralCheck {
  const typed = String(raw ?? '').trim();
  const code = cleanCadastral(typed);
  if (CADASTRAL_SHAPE.test(code)) return { ok: true, code, normalized: code !== typed, suggestion: null };
  const groups = code.split('.');
  for (let n = Math.min(groups.length - 1, 12); n >= 4; n--) {
    const prefix = groups.slice(0, n).join('.');
    if (CADASTRAL_SHAPE.test(prefix)) return { ok: false, code: typed, normalized: false, suggestion: prefix };
  }
  return { ok: false, code: typed, normalized: false, suggestion: null };
}

/**
 * The parent code to try when the full code finds nothing: the parcel
 * (first five groups) of a code that names a building, section or unit.
 * Null when the code already is a parcel (or shorter).
 */
export function parentCadastral(code: string): string | null {
  const groups = cleanCadastral(code).split('.');
  return groups.length > 5 ? groups.slice(0, 5).join('.') : null;
}
