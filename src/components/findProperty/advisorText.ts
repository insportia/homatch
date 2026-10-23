/*
 * Advisor points → friendly sentences. Only fpv_* keys and the existing building /
 * renovation labels are used, so a customer never sees a code or a field name.
 */
import type { AdvisorAssessment, AdvisorPoint } from '@/research-core/marketplace/advisor';
import { num, type T, usd } from './format';
import { amenityKey } from './requirementKeys';

/** A human label for any amenity code; unknown codes fall back to a neutral word, never the code. */
export const amenityLabel = (code: string, t: T) => t(amenityKey(code));

function params(point: AdvisorPoint, t: T): Record<string, string | number> {
  const p = point.params ?? {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === 'amenity') out.amenity = amenityLabel(String(v), t);
    else if (k === 'status') out.status = point.code === 'RENOVATION' || point.code === 'PREFERRED_RENOVATION' ? t(`mps_rn_${v}`) : t(`mps_bs_${v}`);
    else if (k === 'amount') out.amount = usd(Number(v));
    else if (k === 'v') out.v = num(Number(v));
    else out[k] = v;
  }
  return out;
}

export const fitText = (p: AdvisorPoint, t: T) => t(`fpv_fit_${p.code}`, params(p, t));
export const missText = (p: AdvisorPoint, t: T) => t(`fpv_miss_${p.code}`, params(p, t));
export const highlightText = (p: AdvisorPoint, t: T) =>
  p.code.startsWith('UPGRADE_') ? t(`mps_adv_${p.code.slice(8)}`, { n: Number(p.params?.n ?? 0) }) : t(`fpv_hi_${p.code}`, params(p, t));

/** The short noun for a point, used inside list sentences ("budget, size and rooms"). */
export const nounText = (p: AdvisorPoint, t: T) =>
  p.code === 'AMENITY' || p.code === 'AMENITY_MENTIONED' || p.code === 'EXCLUDED' ? amenityLabel(String(p.params?.amenity), t) : t(`fpv_noun_${p.code}`);

/**
 * "a, b and c" in the customer's language. Built from our own translated "and":
 * browsers lack list data for some locales (Georgian among them) and would mix
 * in English. Arabic and Hebrew attach their "and" to the last word.
 */
export function listText(items: string[], lang: string, t?: T): string {
  const unique = [...new Set(items)];
  if (unique.length < 2) return unique.join('');
  const and = t ? t('fpv_and') : 'and';
  const last = unique[unique.length - 1];
  const joined = lang === 'ar' || lang === 'he' ? `${and}${last}` : `${and} ${last}`;
  return `${unique.slice(0, -1).join(', ')} ${joined}`;
}

/** What the listing does not say, as one sentence. */
export const unknownText = (a: AdvisorAssessment, t: T, lang: string) =>
  a.unknown.length ? t('fpv_unknown_line', { list: listText(a.unknown.map((p) => nounText(p, t)), lang, t) }) : null;

/** The one-line recommendation shown on a result card and atop the assessment. */
export function summaryText(a: AdvisorAssessment, t: T, lang: string): string {
  const fitNouns = listText(a.fits.slice(0, 4).map((p) => nounText(p, t)), lang, t);
  if (a.verdict === 'UPGRADE') {
    const gains = a.highlights.filter((h) => h.code.startsWith('UPGRADE_')).slice(0, 2).map((h) => highlightText(h, t));
    return gains.length ? t('fpv_sum_upgrade', { list: listText(gains, lang, t) }) : t('fpv_sum_upgrade_plain');
  }
  if (a.verdict === 'TOP') return a.fits.length ? t('fpv_sum_top', { list: fitNouns }) : t('fpv_sum_top_plain');
  if (a.verdict === 'GOOD') {
    const ask = a.unknown.length ? listText(a.unknown.slice(0, 2).map((p) => nounText(p, t)), lang, t) : null;
    if (!a.fits.length) return ask ? t('fpv_sum_ask_only', { ask }) : t('fpv_sum_top_plain');
    return ask ? t('fpv_sum_good', { list: fitNouns, ask }) : t('fpv_sum_good_plain', { list: fitNouns });
  }
  if (!a.misses.length) {
    /* Nothing contradicts the request, but something required is not stated: say what to ask. */
    return t('fpv_sum_ask_only', { ask: listText(a.unknown.slice(0, 2).map((p) => nounText(p, t)), lang, t) });
  }
  const miss = missText(a.misses[0], t);
  return a.fits.length ? t('fpv_sum_consider', { list: fitNouns, miss }) : miss;
}
