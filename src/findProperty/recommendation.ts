/*
 * Find Property — the personal recommendation, in words, from server data only.
 *
 * Inputs are exactly what the server already decided for one property: its
 * reasons (or an upgrade's measured advantages), the requirements hardFilter()
 * could not confirm, the result evidence's preferences, tradeoffs and warnings.
 * Nothing is scored, ranked or invented here; there is no model call. This only
 * chooses which of those facts to say first and phrases them naturally.
 *
 * An unknown is always "not stated in the listing — ask the seller", never
 * "does not have". Only a structured "no" or a negated description counts as
 * contradicted.
 */
import { requirementLabel } from './requirementLabels.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;
export type ListJoin = (items: string[]) => string;

export interface RecommendationInput {
  group: string;
  reasons: ReadonlyArray<{ code: string; count?: number }>;
  upgrade?: { advantages: ReadonlyArray<{ code: string; delta: number | null }> } | null;
  unverified: readonly string[];
  tradeoffs?: readonly string[] | null;
  intelligence?: {
    section?: string | null; strong?: boolean; warnings: readonly string[];
    preferences: { confirmed: readonly string[]; mentioned: readonly string[]; unconfirmed: readonly string[]; contradicted: readonly string[] };
  } | null;
}

/** "Not stated" tradeoffs are unknowns, phrased as such, keyed to the requirement they leave open. */
const NOT_STATED: Record<string, string> = {
  FLOOR_NOT_STATED: 'FLOOR_RANGE', AREA_NOT_STATED: 'AREA', DISTRICT_NOT_STATED: 'DISTRICT', BUILDING_STATUS_NOT_STATED: 'BUILDING_STATUS',
};
const MAX_LISTED = 3;

/** Capitalise a Latin or Cyrillic first letter only: Georgian, Arabic and Hebrew stay as written. */
export function sentenceCase(s: string): string {
  return /^[a-zа-яё]/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function shortList(items: string[], t: T, join: ListJoin): string {
  if (items.length <= MAX_LISTED) return join(items);
  return join([...items.slice(0, MAX_LISTED), t('fpp_rec_more', { n: items.length - MAX_LISTED })]);
}

/** What the property has going for it, as the server phrased each reason. */
export function positives(p: RecommendationInput, t: T): string[] {
  if (p.upgrade) return p.upgrade.advantages.map((a) => t(`mps_adv_${a.code}`, { n: a.delta !== null ? Math.abs(a.delta) : 0 }));
  return p.reasons.filter((r) => r.code !== 'VERIFIED_RECENTLY').map((r) => t(`mps_reason_${r.code}`, { n: r.count ?? 0 }));
}

/** Requirement and preference codes the listing does not state, de-duplicated by their words. */
export function unknownLabels(p: RecommendationInput, t: T): string[] {
  const prefs = p.intelligence?.preferences;
  const codes = [
    ...p.unverified,
    ...(prefs?.unconfirmed ?? []),
    ...(p.tradeoffs ?? []).filter((c) => NOT_STATED[c]).map((c) => NOT_STATED[c]),
  ];
  const mentioned = new Set((prefs?.mentioned ?? []).map((c) => requirementLabel(c, t)));
  return [...new Set(codes.map((c) => requirementLabel(c, t)))].filter((label) => !mentioned.has(label));
}

/** The card's two short lines: why it fits, and what to ask. */
export function cardRecommendation(p: RecommendationInput, t: T, join: ListJoin): { lead: string | null; ask: string | null } {
  const good = positives(p, t);
  const confirmed = (p.intelligence?.preferences.confirmed ?? []).map((c) => requirementLabel(c, t));
  const lead = good.length ? good.slice(0, 2).join(' · ') : confirmed.length ? t('fpp_rec_confirmed', { list: shortList(confirmed, t, join) }) : null;
  const unknown = unknownLabels(p, t);
  return { lead, ask: unknown.length ? t('fpp_rec_ask', { list: shortList(unknown, t, join) }) : null };
}

export type LimitationKind = 'unknown' | 'mentioned' | 'contradicted' | 'tradeoff' | 'warning';

/** The property page's advantages, limitations and one closing sentence. */
export function detailInsights(p: RecommendationInput, t: T, join: ListJoin) {
  const prefs = p.intelligence?.preferences;
  const advantages = [
    ...positives(p, t),
    ...(prefs?.confirmed ?? []).map((c) => t('fpp_confirmed_item', { feature: sentenceCase(requirementLabel(c, t)) })),
  ];
  const unknown = unknownLabels(p, t);
  const limitations: Array<{ kind: LimitationKind; text: string }> = [
    ...(prefs?.contradicted ?? []).map((c) => ({ kind: 'contradicted' as const, text: t('fpp_contradicted_item', { feature: sentenceCase(requirementLabel(c, t)) }) })),
    ...(p.tradeoffs ?? []).filter((c) => !NOT_STATED[c]).map((c) => ({ kind: 'tradeoff' as const, text: t(`mps_tradeoff_${c}`) })),
    ...(p.intelligence?.warnings ?? []).map((c) => ({ kind: 'warning' as const, text: t(`fpr_warning_${c}`) })),
    ...[...new Set((prefs?.mentioned ?? []).map((c) => requirementLabel(c, t)))].map((label) => ({ kind: 'mentioned' as const, text: t('fpp_mentioned_item', { feature: sentenceCase(label) }) })),
    ...unknown.map((label) => ({ kind: 'unknown' as const, text: t('fpp_unknown_item', { feature: sentenceCase(label) }) })),
  ];
  const section = p.intelligence?.section;
  const lead = p.group === 'UPGRADE' || section === 'UPGRADE' ? 'fpp_sum_UPGRADE' : p.intelligence?.strong || section === 'BEST' ? 'fpp_sum_BEST' : 'fpp_sum_OTHER';
  const toCheck = limitations.filter((l) => l.kind !== 'unknown' && l.kind !== 'mentioned').length;
  const ask = [...new Set([...(prefs?.mentioned ?? []).map((c) => requirementLabel(c, t)), ...unknown])];
  const summary = [
    t(lead),
    advantages.length ? t('fpp_sum_advantages', { n: advantages.length }) : null,
    ask.length ? t('fpp_sum_ask', { list: shortList(ask, t, join) }) : null,
    toCheck ? t('fpp_sum_check', { n: toCheck }) : null,
  ].filter(Boolean).join(' ');
  return { advantages, limitations, summary };
}

/** Locale-aware "a, b and c"; a plain comma list where Intl.ListFormat is missing. */
export function listJoiner(lang: string | undefined): ListJoin {
  try {
    const f = new Intl.ListFormat(lang || undefined, { style: 'long', type: 'conjunction' });
    return (items) => f.format(items);
  } catch {
    return (items) => items.join(', ');
  }
}
