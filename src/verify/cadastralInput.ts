// What a customer may submit as a cadastral code, checked before anything runs.
//
// Prod 1ff4b786 (2026-10-24): "88.20.21.767.117.2" was accepted (the old
// check allowed any dotted digits), every official source searched that exact
// string, none matched, and the run produced a report with no registry data,
// documents, location or market — and was charged. A Georgian code is
// XX.XX.XX.XXX.XXX for the parcel, then optionally .XX (building), .XX
// (section) and .XXX (unit) — the same pattern propertyIdentity.ts reads. 97
// of 98 production cadastral runs used it; the 98th was that one.
// Pure: the page and research-agent share it.

export const CANONICAL_CADASTRAL = /^\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3}(?:\.\d{2}(?:\.\d{2}(?:\.\d{3})?)?)?$/;
const PREFIX = /^(\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3}(?:\.\d{2}(?:\.\d{2}(?:\.\d{3})?)?)?)/;

export interface CadastralCheck {
  ok: boolean;
  code: string;
  /** The longest valid code the input starts with, when it is not itself valid. */
  suggestion: string | null;
}

export function checkCadastralInput(raw: unknown): CadastralCheck {
  const code = String(raw ?? '').trim();
  if (CANONICAL_CADASTRAL.test(code)) return { ok: true, code, suggestion: null };
  const prefix = code.match(PREFIX)?.[1] ?? null;
  return { ok: false, code, suggestion: prefix && prefix !== code ? prefix : null };
}
