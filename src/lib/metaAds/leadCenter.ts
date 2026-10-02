// META LEAD CENTER — the pure rules behind the owner's lead pipeline. Shared by
// the Leads screen, the edge ingestion (_shared/metaLeads.ts) and the tests.
//
//   · Pipeline: NEW → CONTACTED → QUALIFIED → VIEWING → NEGOTIATING → WON / LOST.
//   · Quality: HIGH / MEDIUM / LOW / UNRATED from the lead's OWN answers, with
//     the reasons spelled out; a manual rating always wins (DB guard).
//   · One person, several submissions: a contact key groups them; it never
//     merges two Meta submissions into one row.
//   · Funnel and costs: counts and rates from HOMATCH outcomes, costs from
//     Meta's reported spend. No revenue is known, so no ROAS is shown.
//   · Breakdowns say "not enough data yet" under a sample threshold.
import { normalizeEmail, normalizePhone } from './hashing.ts';
import { Q, type QualifyingKey } from './leadForms.ts';

export const PIPELINE = ['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON', 'LOST'] as const;
export type LeadStage = (typeof PIPELINE)[number];
export const LOST_REASONS = ['NO_ANSWER', 'NOT_INTERESTED', 'BUDGET', 'LOCATION', 'ALREADY_FOUND', 'NOT_REAL', 'DUPLICATE', 'OTHER'] as const;
export type Quality = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRATED';

export interface LeadLike {
  id: string; status: string; received_at: string; fields?: Record<string, unknown> | null; answers?: Record<string, string> | null;
  follow_up_at?: string | null; quality?: Quality | null; campaign_id?: string | null; ad_external_id?: string | null;
  adset_external_id?: string | null; contact_key?: string | null; won_at?: string | null; lost_reason?: string | null;
}

/** The answer as HOMATCH's option key, whatever language Meta returned it in. */
export function answerKey(q: QualifyingKey, raw: unknown): string | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (!v) return null;
  for (const o of Q[q]?.options ?? []) {
    if (o.key === v || Object.values(o.label).some((l) => String(l).toLowerCase() === v)) return o.key;
  }
  return null;
}

const phoneOf = (l: Pick<LeadLike, 'fields' | 'answers'>) => String(l.answers?.phone ?? l.fields?.phone_number ?? l.fields?.phone ?? '');
const emailOf = (l: Pick<LeadLike, 'fields' | 'answers'>) => String(l.answers?.email ?? l.fields?.email ?? '');

/**
 * Quality from what the person told us — never from who they are. Reasons are
 * codes the screen explains. Nothing answered → UNRATED, not LOW.
 */
export function autoQuality(l: Pick<LeadLike, 'fields' | 'answers'>): { quality: Quality; reasons: string[] } {
  const reasons: string[] = [];
  const phone = normalizePhone(phoneOf(l));
  const email = normalizeEmail(emailOf(l));
  if (!phone && !email) return { quality: 'LOW', reasons: ['NO_REACHABLE_CONTACT'] };
  if (phone) reasons.push('PHONE_GIVEN');
  const a = l.answers ?? {};
  const timeframe = answerKey('timeframe', a.timeframe);
  const agent = answerKey('agent_contact', a.agent_contact);
  const budget = String(a.budget ?? '').trim();
  let score = phone ? 1 : 0;
  if (timeframe === 'now' || timeframe === 'three_months') { score += 2; reasons.push('BUYING_SOON'); }
  else if (timeframe === 'later') reasons.push('BUYING_LATER');
  if (budget) { score += 1; reasons.push('BUDGET_GIVEN'); }
  if (agent === 'yes') { score += 1; reasons.push('WANTS_CONTACT'); }
  const answered = ['timeframe', 'budget', 'agent_contact', 'preferred_location', 'buy_or_rent'].some((k) => String(a[k] ?? '').trim());
  if (!answered) return { quality: 'UNRATED', reasons };
  return { quality: score >= 4 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW', reasons };
}

/** What groups submissions of one person: the normalised phone, else e-mail. Hashed by the caller. */
export function contactMaterial(l: Pick<LeadLike, 'fields' | 'answers'>): string | null {
  const phone = normalizePhone(phoneOf(l));
  if (phone) return `p:${phone}`;
  const email = normalizeEmail(emailOf(l));
  return email ? `e:${email}` : null;
}

/** Follow-ups by the owner's own calendar day (their time zone). */
export function followUpBucket(at: string | null | undefined, now: Date, timeZone: string): 'OVERDUE' | 'TODAY' | 'UPCOMING' | null {
  if (!at) return null;
  const when = new Date(at);
  if (!Number.isFinite(when.getTime())) return null;
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  if (day(when) === day(now)) return when.getTime() < now.getTime() ? 'OVERDUE' : 'TODAY';
  return when.getTime() < now.getTime() ? 'OVERDUE' : 'UPCOMING';
}

const OPEN = new Set(['NEW', 'CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING']);

/** Who to call first: overdue follow-ups, then fresh uncontacted leads, then quality. Explainable. */
export function priorityOf(l: LeadLike, now: Date, timeZone = 'UTC'): { score: number; reason: string | null } {
  if (!OPEN.has(l.status)) return { score: 0, reason: null };
  const fu = followUpBucket(l.follow_up_at, now, timeZone);
  const ageH = (now.getTime() - Date.parse(l.received_at)) / 3_600_000;
  const q = l.quality ?? 'UNRATED';
  if (fu === 'OVERDUE') return { score: 100, reason: 'FOLLOW_UP_OVERDUE' };
  if (l.status === 'NEW' && ageH <= 24) return { score: 90 + (q === 'HIGH' ? 5 : 0), reason: 'NEW_UNCONTACTED' };
  if (fu === 'TODAY') return { score: 80, reason: 'FOLLOW_UP_TODAY' };
  if (l.status === 'NEW') return { score: 70, reason: 'WAITING_FOR_CONTACT' };
  return { score: q === 'HIGH' ? 50 : q === 'MEDIUM' ? 40 : 20, reason: q === 'HIGH' ? 'HIGH_QUALITY' : null };
}

const REACHED: Record<string, LeadStage[]> = {
  CONTACTED: ['CONTACTED', 'QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON'],
  QUALIFIED: ['QUALIFIED', 'VIEWING', 'NEGOTIATING', 'WON'],
  VIEWING: ['VIEWING', 'NEGOTIATING', 'WON'],
  NEGOTIATING: ['NEGOTIATING', 'WON'],
  WON: ['WON'],
};

export interface Funnel {
  leads: number; contacted: number; qualified: number; viewing: number; negotiating: number; won: number; lost: number;
  rates: { contacted: number | null; qualified: number | null; viewing: number | null; won: number | null };
  cost: { perLead: number | null; perQualified: number | null; perViewing: number | null; perWon: number | null };
}

/** The funnel and its costs. Spend is Meta's reported spend (minor units), or null when unknown. */
export function funnelOf(leads: LeadLike[], spendMinor: number | null): Funnel {
  const n = (stages: LeadStage[]) => leads.filter((l) => stages.includes(l.status as LeadStage)).length;
  const f = { leads: leads.length, contacted: n(REACHED.CONTACTED), qualified: n(REACHED.QUALIFIED), viewing: n(REACHED.VIEWING),
    negotiating: n(REACHED.NEGOTIATING), won: n(REACHED.WON), lost: n(['LOST']) };
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
  const cost = (k: number) => (spendMinor != null && spendMinor > 0 && k > 0 ? Math.round(spendMinor / k) : null);
  return {
    ...f,
    rates: { contacted: rate(f.contacted, f.leads), qualified: rate(f.qualified, f.leads), viewing: rate(f.viewing, f.leads), won: rate(f.won, f.leads) },
    cost: { perLead: cost(f.leads), perQualified: cost(f.qualified), perViewing: cost(f.viewing), perWon: cost(f.won) },
  };
}

export const MIN_BREAKDOWN_LEADS = 5;

/** Leads by campaign / ad / ad set, with "not enough data" below the threshold. */
export function breakdownOf(leads: LeadLike[], by: 'campaign_id' | 'ad_external_id' | 'adset_external_id') {
  const groups = new Map<string, LeadLike[]>();
  for (const l of leads) {
    const k = String(l[by] ?? '');
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  return [...groups.entries()].map(([key, ls]) => {
    const f = funnelOf(ls, null);
    return { key, leads: ls.length, qualified: f.qualified, won: f.won, qualifiedRate: ls.length >= MIN_BREAKDOWN_LEADS ? f.rates.qualified : null,
      enough: ls.length >= MIN_BREAKDOWN_LEADS };
  }).sort((a, b) => b.leads - a.leads);
}

/** How many submissions each person made (by contact key) — shown, never merged. */
export function submissionsByContact(leads: LeadLike[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of leads) if (l.contact_key) m.set(l.contact_key, (m.get(l.contact_key) ?? 0) + 1);
  return m;
}
