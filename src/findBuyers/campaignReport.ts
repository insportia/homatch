// FIND BUYERS — the owner's campaign report, as the screen reads it.
//
// The server (find_buyers_campaign_report) computes every number and every
// Research NOTE code from the campaign's own records. This module only turns
// that payload into what the screen shows: which sentence a note becomes,
// which limitations and next-search options apply, how leads group by match
// category, and what a fit badge says. It never adds a number, never claims
// full market coverage, and never treats an UNKNOWN fit or an uncategorised
// (legacy) lead as qualified.

export type MatchCategory = 'STRONG' | 'POTENTIAL' | 'WEAK';
export type Fit = 'COMPATIBLE' | 'NEARBY' | 'INCOMPATIBLE' | 'UNKNOWN';

export interface ReportNote { code: string; params: Record<string, unknown> }
export interface ReportLimitation { code: string; [k: string]: unknown }

export interface CampaignReport {
  jobId: string;
  generatedAt: string;
  live: boolean;
  legacy: boolean;
  property: {
    transaction: 'SALE' | 'RENT' | null; counterpart: 'BUYER' | 'TENANT' | null; propertyType: string | null;
    rooms: number | null; bedrooms: number | null; areaSqm: number | null; price: number | null; currency: string | null;
    city: string | null; district: string | null; neighborhood: string | null;
  };
  buyerProfile: {
    basis: 'STRATEGY' | 'PROPERTY';
    personas: unknown[];
    budgetBand: { min?: number | null; max?: number | null; currency?: string | null } | null;
    places: unknown[];
    bedrooms: { min?: number | null; max?: number | null } | null;
    area: { min?: number | null; max?: number | null } | null;
  };
  coverage: {
    languages: string[];
    platforms: Array<{ platform: string; state: 'READ' | 'EMPTY' | 'FAILED' | 'RUNNING'; runs: number; items: number; qualified: number; uncategorised: number }>;
    telegramNative: boolean;
    locations: string[];
    communitiesDiscovered: number; telegramCommunitiesDiscovered: number; groupsFound: number; communitiesRead: number;
    postsRetrieved: number; signalsAnalysed: number; postsAnalysed: number; messagesAnalysed: number; commentsExamined: number;
    commentDecisions: Record<string, number>;
    staleSkipped: number; duplicatesRemoved: number;
  };
  budget: { creditsCommitted: number; usedPct: number | null; exhausted: boolean };
  timing: {
    createdAt: string; finalizedAt: string | null; stopReason: string | null; durationSeconds: number;
    phase1DeadlineAt: string | null; phase1EndedAt: string | null; firstVisibleAt: string | null; firstQualifiedAt: string | null;
  };
  results: {
    strong: number; potential: number; weak: number; uncategorised: number; rejected: number; expired: number; visible: number;
    signalRoles: Record<string, number>; candidateRoles: Record<string, number>;
    rejectionReasons: Record<string, number>; signalRejectionReasons: Record<string, number>;
    intentClasses: Record<string, number>; budgetFit: Record<string, number>; locationFit: Record<string, number>;
    genuineSeekers: number;
  };
  bestSources: Array<{ platform: string; community: string | null; qualified: number; weak: number; uncategorised: number; postsRead: number; budgetSharePct: number | null }>;
  coveragePlan: {
    planned: { phase1?: number; phase2SourceDependent?: number; phase2IndependentSearch?: number } | null;
    queue: { total: number; done: number; failed: number; cancelled: number; open: number };
    cancelledBy: Record<string, number>;
  };
  limitations: ReportLimitation[];
  notes: ReportNote[];
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const counts = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n)]));

/** A defensive read of the RPC payload: anything not shaped like a report is null. */
export function parseReport(data: unknown): CampaignReport | null {
  const d = obj(data);
  if (!d.results || !d.coverage || typeof d.jobId !== 'string') return null;
  const r = obj(d.results); const c = obj(d.coverage); const b = obj(d.budget); const tm = obj(d.timing); const p = obj(d.property);
  const bp = obj(d.buyerProfile); const cp = obj(d.coveragePlan); const q = obj(cp.queue);
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  const n0 = (v: unknown) => (v == null ? null : num(v, NaN)) as number | null;
  return {
    jobId: d.jobId as string,
    generatedAt: String(d.generatedAt ?? ''),
    live: Boolean(d.live),
    legacy: Boolean(d.legacy),
    property: {
      transaction: (str(p.transaction) as 'SALE' | 'RENT' | null), counterpart: (str(p.counterpart) as 'BUYER' | 'TENANT' | null),
      propertyType: str(p.propertyType), rooms: n0(p.rooms), bedrooms: n0(p.bedrooms), areaSqm: n0(p.areaSqm), price: n0(p.price),
      currency: str(p.currency), city: str(p.city), district: str(p.district), neighborhood: str(p.neighborhood),
    },
    buyerProfile: {
      basis: bp.basis === 'STRATEGY' ? 'STRATEGY' : 'PROPERTY',
      personas: Array.isArray(bp.personas) ? bp.personas : [],
      budgetBand: bp.budgetBand ? (obj(bp.budgetBand) as CampaignReport['buyerProfile']['budgetBand']) : null,
      places: Array.isArray(bp.places) ? bp.places : [],
      bedrooms: bp.bedrooms ? (obj(bp.bedrooms) as CampaignReport['buyerProfile']['bedrooms']) : null,
      area: bp.area ? (obj(bp.area) as CampaignReport['buyerProfile']['area']) : null,
    },
    coverage: {
      languages: strs(c.languages),
      platforms: (Array.isArray(c.platforms) ? c.platforms : []).map((x) => {
        const o = obj(x);
        return { platform: String(o.platform ?? ''), state: (['READ', 'EMPTY', 'FAILED', 'RUNNING'].includes(String(o.state)) ? o.state : 'FAILED') as 'READ',
          runs: num(o.runs), items: num(o.items), qualified: num(o.qualified), uncategorised: num(o.uncategorised) };
      }),
      telegramNative: Boolean(c.telegramNative),
      locations: strs(c.locations),
      communitiesDiscovered: num(c.communitiesDiscovered), telegramCommunitiesDiscovered: num(c.telegramCommunitiesDiscovered),
      groupsFound: num(c.groupsFound), communitiesRead: num(c.communitiesRead), postsRetrieved: num(c.postsRetrieved),
      signalsAnalysed: num(c.signalsAnalysed), postsAnalysed: num(c.postsAnalysed), messagesAnalysed: num(c.messagesAnalysed),
      commentsExamined: num(c.commentsExamined), commentDecisions: counts(c.commentDecisions),
      staleSkipped: num(c.staleSkipped), duplicatesRemoved: num(c.duplicatesRemoved),
    },
    budget: { creditsCommitted: num(b.creditsCommitted), usedPct: b.usedPct == null ? null : num(b.usedPct), exhausted: Boolean(b.exhausted) },
    timing: {
      createdAt: String(tm.createdAt ?? ''), finalizedAt: str(tm.finalizedAt), stopReason: str(tm.stopReason), durationSeconds: num(tm.durationSeconds),
      phase1DeadlineAt: str(tm.phase1DeadlineAt), phase1EndedAt: str(tm.phase1EndedAt), firstVisibleAt: str(tm.firstVisibleAt), firstQualifiedAt: str(tm.firstQualifiedAt),
    },
    results: {
      strong: num(r.strong), potential: num(r.potential), weak: num(r.weak), uncategorised: num(r.uncategorised), rejected: num(r.rejected),
      expired: num(r.expired), visible: num(r.visible),
      signalRoles: counts(r.signalRoles), candidateRoles: counts(r.candidateRoles), rejectionReasons: counts(r.rejectionReasons),
      signalRejectionReasons: counts(r.signalRejectionReasons), intentClasses: counts(r.intentClasses),
      budgetFit: counts(r.budgetFit), locationFit: counts(r.locationFit), genuineSeekers: num(r.genuineSeekers),
    },
    bestSources: (Array.isArray(d.bestSources) ? d.bestSources : []).map((x) => {
      const o = obj(x);
      return { platform: String(o.platform ?? ''), community: str(o.community), qualified: num(o.qualified), weak: num(o.weak), uncategorised: num(o.uncategorised),
        postsRead: num(o.postsRead), budgetSharePct: o.budgetSharePct == null ? null : num(o.budgetSharePct) };
    }),
    coveragePlan: {
      planned: cp.planned ? (obj(cp.planned) as CampaignReport['coveragePlan']['planned']) : null,
      queue: { total: num(q.total), done: num(q.done), failed: num(q.failed), cancelled: num(q.cancelled), open: num(q.open) },
      cancelledBy: counts(cp.cancelledBy),
    },
    limitations: (Array.isArray(d.limitations) ? d.limitations : []).map((x) => obj(x) as ReportLimitation).filter((x) => typeof x.code === 'string'),
    notes: (Array.isArray(d.notes) ? d.notes : []).map((x) => { const o = obj(x); return { code: String(o.code ?? ''), params: obj(o.params) }; })
      .filter((x) => x.code !== ''),
  };
}

/** A message the screen renders: an i18n key and its {{var}} values. */
export interface Message { key: string; vars: Record<string, string> }

/** Formatters the screen supplies (localised source and language names). */
export interface Formatters { sources: (codes: string[]) => string; languages: (codes: string[]) => string }

const plainFmt: Formatters = { sources: (c) => c.join(', '), languages: (c) => c.join(', ') };

/** NOTE codes the report can carry, in the order the server emits them. */
export const NOTE_CODES = [
  'PARTIAL_REPORT', 'LEGACY_UNCATEGORISED', 'NO_LOCATION_AND_PRICE_MATCH', 'NO_GENUINE_DEMAND', 'RENTAL_DEMAND_DOMINANT',
  'PURCHASE_DEMAND_DOMINANT', 'SUPPLY_DOMINANT', 'JOB_GROUP_NOISE', 'SOURCES_FAILED', 'BUDGET_LIMITED', 'TIME_LIMITED',
  'COMMENTS_NOT_EXAMINED', 'TELEGRAM_COVERAGE', 'NO_BUDGET_STATED', 'EXPANSION_OPTIONS',
] as const;

/**
 * The sentence a Research NOTE becomes. Null for a code this screen does not
 * word (a newer server) and for EXPANSION_OPTIONS, which is rendered as the
 * "next search" list instead.
 */
export function noteMessage(note: ReportNote, counterpart: 'BUYER' | 'TENANT' | null, fmt: Formatters = plainFmt): Message | null {
  const p = note.params ?? {};
  const tenants = counterpart === 'TENANT';
  const n = (k: string) => String(Math.max(0, Math.round(num(p[k]))));
  switch (note.code) {
    case 'PARTIAL_REPORT': return { key: 'fbr_note_partial', vars: {} };
    case 'LEGACY_UNCATEGORISED': return { key: 'fbr_note_legacy', vars: { n: n('leads') } };
    case 'NO_LOCATION_AND_PRICE_MATCH':
      return { key: tenants ? 'fbr_note_no_fit_tenants' : 'fbr_note_no_fit_buyers', vars: { n: n('genuineBuyers') } };
    case 'NO_GENUINE_DEMAND': return { key: tenants ? 'fbr_note_no_demand_tenants' : 'fbr_note_no_demand_buyers', vars: { n: n('signals') } };
    case 'RENTAL_DEMAND_DOMINANT': return { key: 'fbr_note_rental_dominant', vars: { share: n('share') } };
    case 'PURCHASE_DEMAND_DOMINANT': return { key: 'fbr_note_purchase_dominant', vars: { share: n('share') } };
    case 'SUPPLY_DOMINANT': return { key: 'fbr_note_supply_dominant', vars: { share: n('share') } };
    case 'JOB_GROUP_NOISE': return { key: 'fbr_note_job_noise', vars: { n: n('signals') } };
    case 'SOURCES_FAILED': {
      const list = strs(p.list);
      return list.length ? { key: 'fbr_note_sources_failed', vars: { sources: fmt.sources(list) } } : null;
    }
    case 'BUDGET_LIMITED':
      return p.usedPct == null ? { key: 'fbr_note_budget_limited_nopct', vars: {} } : { key: 'fbr_note_budget_limited', vars: { pct: n('usedPct') } };
    case 'TIME_LIMITED': return { key: 'fbr_note_time_limited', vars: { n: n('stoppedJobs') } };
    case 'COMMENTS_NOT_EXAMINED': return { key: 'fbr_note_comments', vars: { n: n('posts') } };
    case 'TELEGRAM_COVERAGE': {
      const free = num(p.free); const paid = num(p.paid);
      const vars = { free: n('free'), paid: n('paid'), freeChannels: n('freeChannels'), paidChannels: n('paidChannels'), discovered: n('discovered') };
      if (free > 0 && paid > 0) return { key: 'fbr_note_tg_both', vars };
      if (paid > 0) return { key: 'fbr_note_tg_paid_only', vars };
      if (free > 0) return { key: 'fbr_note_tg_free_only', vars };
      return { key: 'fbr_note_tg_none', vars };
    }
    case 'NO_BUDGET_STATED': return { key: tenants ? 'fbr_note_no_budget_tenants' : 'fbr_note_no_budget_buyers', vars: { share: n('share') } };
    default: return null;
  }
}

/** All notes worded, in server order; unknown codes are skipped, never invented. */
export function researchNotes(report: CampaignReport, fmt: Formatters = plainFmt): Message[] {
  return report.notes.map((x) => noteMessage(x, report.property.counterpart, fmt)).filter((m): m is Message => m !== null);
}

/** "What could improve the next search": options from the records, no promise of buyers. */
export function nextSearchOptions(report: CampaignReport, fmt: Formatters = plainFmt): Message[] {
  const out: Message[] = [];
  const exp = report.notes.find((x) => x.code === 'EXPANSION_OPTIONS')?.params ?? {};
  const langs = strs(exp.languages);
  if (langs.length) out.push({ key: 'fbr_next_languages', vars: { languages: fmt.languages(langs) } });
  if (num(exp.groupsUnread) > 0) out.push({ key: 'fbr_next_groups', vars: { n: String(num(exp.groupsUnread)) } });
  if (num(exp.telegramUnread) > 0) out.push({ key: 'fbr_next_telegram', vars: { n: String(num(exp.telegramUnread)) } });
  const failed = strs(exp.sources);
  if (failed.length) out.push({ key: 'fbr_next_sources', vars: { sources: fmt.sources(failed) } });
  if (report.notes.some((x) => x.code === 'BUDGET_LIMITED')) out.push({ key: 'fbr_next_budget', vars: {} });
  if (report.notes.some((x) => x.code === 'COMMENTS_NOT_EXAMINED')) out.push({ key: 'fbr_next_comments', vars: {} });
  if (report.notes.some((x) => x.code === 'NO_LOCATION_AND_PRICE_MATCH')) out.push({ key: 'fbr_next_area', vars: {} });
  return out;
}

/** Limitations worded; unknown codes skipped. */
export function limitationMessage(l: ReportLimitation, fmt: Formatters = plainFmt): Message | null {
  const n = (k: string) => String(Math.max(0, Math.round(num(l[k]))));
  switch (l.code) {
    case 'SOURCES_FAILED': return strs(l.platforms).length ? { key: 'fbr_lim_failed', vars: { sources: fmt.sources(strs(l.platforms)) } } : null;
    case 'SOURCES_EMPTY': return strs(l.platforms).length ? { key: 'fbr_lim_empty', vars: { sources: fmt.sources(strs(l.platforms)) } } : null;
    case 'DISCOVERY_BUDGET_CAP': return { key: 'fbr_lim_discovery_cap', vars: { n: n('jobs') } };
    case 'BUDGET_STOPS': return { key: 'fbr_lim_budget_stops', vars: { n: n('jobs') } };
    case 'TIME_LIMIT': return { key: 'fbr_lim_time', vars: { n: n('jobs') } };
    case 'BUDGET_EXHAUSTED': return { key: 'fbr_lim_budget_exhausted', vars: { pct: n('usedPct') } };
    case 'BUDGET_UNKNOWN': return { key: 'fbr_lim_budget_unknown', vars: { n: n('leads'), of: n('of') } };
    case 'LOCATION_UNKNOWN': return { key: 'fbr_lim_location_unknown', vars: { n: n('leads'), of: n('of') } };
    case 'COMMENTS_NOT_EXAMINED': return { key: 'fbr_lim_comments', vars: { n: n('posts') } };
    case 'LEGACY_UNCATEGORISED': return { key: 'fbr_lim_legacy', vars: { n: n('leads') } };
    default: return null;
  }
}

/** Rejection reasons the screen words; any other code is counted under "other". */
export const KNOWN_REJECTIONS = [
  'WRONG_TRANSACTION', 'JOB_SEARCH', 'SALE_ADVERTISEMENT', 'RENT_ADVERTISEMENT', 'AGENT_PROMOTION', 'SERVICE_PROMOTION',
  'IRRELEVANT', 'WRONG_LOCATION', 'BUDGET_MISMATCH', 'WRONG_PROPERTY_TYPE', 'STALE', 'DUPLICATE', 'UNCLEAR',
] as const;

/** Rejected candidates by reason, largest first; unknown codes fold into OTHER. */
export function rejectionBreakdown(report: CampaignReport): Array<{ reason: string; count: number }> {
  const src = Object.keys(report.results.rejectionReasons).length ? report.results.rejectionReasons : report.results.signalRejectionReasons;
  const acc = new Map<string, number>();
  for (const [k, v] of Object.entries(src)) {
    const key = (KNOWN_REJECTIONS as readonly string[]).includes(k) ? k : 'OTHER';
    acc.set(key, (acc.get(key) ?? 0) + v);
  }
  return [...acc.entries()].map(([reason, count]) => ({ reason, count })).filter((x) => x.count > 0).sort((a, b) => b.count - a.count);
}

/** What the analysed content was: roles once qualified, else the legacy intent mix (labelled as unreviewed). */
export function contentMix(report: CampaignReport): { basis: 'ROLE' | 'INTENT'; parts: Array<{ kind: string; count: number }> } {
  const roles = report.results.signalRoles;
  const known = Object.entries(roles).filter(([k]) => k !== 'UNCATEGORISED');
  if (known.length) {
    return { basis: 'ROLE', parts: known.map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count) };
  }
  const group: Record<string, string> = {
    BUYER_HIGH: 'DEMAND', BUYER_MEDIUM: 'DEMAND', TENANT_HIGH: 'DEMAND', TENANT_MEDIUM: 'DEMAND',
    SELLER: 'OFFERS', OWNER: 'OFFERS', AGENT: 'AGENTS', SERVICE_PROVIDER: 'AGENTS',
    QUESTION: 'UNCLEAR', UNCERTAIN: 'UNCLEAR', NOISE: 'UNRELATED',
  };
  const acc = new Map<string, number>();
  for (const [k, v] of Object.entries(report.results.intentClasses)) acc.set(group[k] ?? 'UNCLEAR', (acc.get(group[k] ?? 'UNCLEAR') ?? 0) + v);
  return { basis: 'INTENT', parts: [...acc.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count) };
}

/** Best sources the owner sees: only communities that produced qualified leads. */
export function bestSources(report: CampaignReport) {
  return report.bestSources.filter((s) => s.qualified > 0);
}

/** A readable community label: "groups/real.tbilisi" → "real.tbilisi", "t.me/x" → "@x". */
export function communityLabel(c: string | null): string | null {
  if (!c) return null;
  const tg = /^t\.me\/(.+)$/.exec(c);
  if (tg) return `@${tg[1]}`;
  const tail = c.split('/').filter(Boolean).pop() ?? c;
  return /^\d+$/.test(tail) ? null : tail;
}

/** Duration in whole minutes and seconds (never negative). */
export function splitDuration(seconds: number): { h: number; m: number; s: number } {
  const t = Math.max(0, Math.round(seconds));
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

/** Seconds from the campaign start to an instant, or null. */
export function secondsSinceStart(report: CampaignReport, iso: string | null): number | null {
  if (!iso || !report.timing.createdAt) return null;
  const a = Date.parse(report.timing.createdAt); const b = Date.parse(iso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

/* ── leads ──────────────────────────────────────────────────────────── */

export interface CategorisedLead { match_category?: string | null; budget_fit?: string | null; location_fit?: string | null }

/** Category order on screen; legacy leads (no category) follow, labelled unreviewed. */
export const CATEGORY_ORDER = ['STRONG', 'POTENTIAL', 'WEAK', 'UNCATEGORISED'] as const;
export type CategoryGroup = typeof CATEGORY_ORDER[number];

export function leadCategory(l: CategorisedLead): CategoryGroup | 'REJECTED' {
  const c = l.match_category;
  if (c === 'STRONG' || c === 'POTENTIAL' || c === 'WEAK' || c === 'REJECTED') return c;
  return 'UNCATEGORISED';
}

/** Group a page of leads by category, preserving server order inside each group; REJECTED never shows. */
export function groupLeads<T extends CategorisedLead>(rows: T[]): Array<{ category: CategoryGroup; rows: T[] }> {
  const by = new Map<CategoryGroup, T[]>();
  for (const r of rows) {
    const c = leadCategory(r);
    if (c === 'REJECTED') continue;
    by.set(c, [...(by.get(c) ?? []), r]);
  }
  return CATEGORY_ORDER.filter((c) => by.has(c)).map((c) => ({ category: c, rows: by.get(c)! }));
}

/** A fit as the badge shows it: UNKNOWN (or missing) is "unknown", never "compatible". */
export function fitTone(fit: string | null | undefined): { fit: Fit; tone: 'good' | 'near' | 'bad' | 'unknown' } {
  switch (fit) {
    case 'COMPATIBLE': return { fit: 'COMPATIBLE', tone: 'good' };
    case 'NEARBY': return { fit: 'NEARBY', tone: 'near' };
    case 'INCOMPATIBLE': return { fit: 'INCOMPATIBLE', tone: 'bad' };
    default: return { fit: 'UNKNOWN', tone: 'unknown' };
  }
}
