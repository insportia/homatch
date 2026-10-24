// Matching workspace — locale-aware names and numbers, written once.
//
// Country and language names come from Intl.DisplayNames in the UI language (never a
// hand-typed table); credits are the server's numbers, formatted only; USD is derived at the
// fixed 10 credits = $1 rate, or from the server's cents when the price carries them.

import { intlLocaleFor } from '@/components/workspace/primitives';

const displayCache = new Map<string, Intl.DisplayNames | null>();
function display(lang: string, type: 'region' | 'language'): Intl.DisplayNames | null {
  const key = `${lang}:${type}`;
  if (!displayCache.has(key)) {
    let d: Intl.DisplayNames | null = null;
    try { d = new Intl.DisplayNames([intlLocaleFor(lang)], { type }); } catch { d = null; }
    displayCache.set(key, d);
  }
  return displayCache.get(key) ?? null;
}

export function countryName(code: string, lang: string): string {
  const c = String(code ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return c;
  try { return display(lang, 'region')?.of(c) ?? c; } catch { return c; }
}

export function languageName(code: string, lang: string): string {
  const c = String(code ?? '').toLowerCase();
  if (!c) return c;
  try {
    const name = display(lang, 'language')?.of(c) ?? c;
    /* Georgian / Russian return lower-case language names; a label starts with a capital. */
    return name.charAt(0).toLocaleUpperCase(intlLocaleFor(lang)) + name.slice(1);
  } catch { return c; }
}

/** 🇬🇪 from "GE" (regional indicators); empty for anything that is not a code. */
export function flagOf(code: string | null | undefined): string {
  const c = String(code ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

export function formatCredits(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(intlLocaleFor(lang), { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);
  } catch { return String(n); }
}

export function formatCount(n: number, lang: string): string {
  try { return new Intl.NumberFormat(intlLocaleFor(lang)).format(n); } catch { return String(n); }
}

export function formatUsd(amount: number, lang: string): string {
  try {
    return new Intl.NumberFormat(intlLocaleFor(lang), { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch { return `$${amount.toFixed(2)}`; }
}

/** 10 credits = $1 (BILLING.md). */
export const CREDITS_PER_USD = 10;
export function creditsToUsd(credits: number): number {
  return Math.round((credits / CREDITS_PER_USD) * 100) / 100;
}

export function formatDate(iso: string | null | undefined, lang: string): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(intlLocaleFor(lang), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch { return null; }
}

export function formatList(items: string[], lang: string): string {
  try {
    return new Intl.ListFormat(intlLocaleFor(lang), { style: 'long', type: 'conjunction' }).format(items);
  } catch { return items.join(', '); }
}
